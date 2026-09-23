import { extname, join, normalize, resolve } from 'node:path'

const PORT = Number(Deno.env.get('PORT') ?? 17170)
const BACKEND = Deno.env.get('BACKEND') ?? 'http://localhost:17172'
const DIST = resolve('dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

async function serveStatic(urlPath) {
  let path = normalize(join(DIST, urlPath))
  if (!path.startsWith(DIST)) return null
  try {
    const info = await Deno.stat(path)
    if (info.isFile) {
      const data = await Deno.readFile(path)
      const ext = extname(path).toLowerCase()
      return new Response(data, {
        headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
      })
    }
  } catch {
    // fall through to SPA fallback
  }
  const index = await Deno.readFile(join(DIST, 'index.html'))
  return new Response(index, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

async function proxyHttp(req, urlPath) {
  const backendUrl = BACKEND + urlPath
  const headers = new Headers(req.headers)
  headers.delete('host')
  headers.delete('origin')
  let body = null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer()
  }
  const upstream = await fetch(backendUrl, {
    method: req.method,
    headers,
    body: body ? body : undefined,
    redirect: 'manual',
  })
  const resHeaders = new Headers(upstream.headers)
  resHeaders.delete('content-encoding')
  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  })
}

async function proxyWebSocket(req, urlPath) {
  const { socket, response } = Deno.upgradeWebSocket(req)
  const wsUrl = BACKEND.replace(/^http/, 'ws') + urlPath
  const pending = []
  let open = false
  let upstream = null
  try {
    upstream = new WebSocket(wsUrl)
  } catch {
    socket.close()
    return response
  }
  const flush = () => {
    while (pending.length) {
      const data = pending.shift()
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.send(data)
        } catch {
          /* ignore */
        }
      }
    }
  }
  upstream.onopen = () => {
    open = true
    flush()
  }
  upstream.onmessage = (ev) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(ev.data)
  }
  upstream.onerror = () => {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
  }
  upstream.onclose = () => {
    open = false
    try {
      if (socket.readyState === WebSocket.OPEN) socket.close()
    } catch {
      /* ignore */
    }
  }
  socket.onmessage = (ev) => {
    if (open) {
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.send(ev.data)
        } catch {
          /* ignore */
        }
      }
    } else {
      pending.push(ev.data)
    }
  }
  socket.onclose = () => {
    try {
      if (upstream.readyState === WebSocket.OPEN) upstream.close()
    } catch {
      /* ignore */
    }
  }
  return response
}

Deno.serve({ port: PORT, hostname: '0.0.0.0' }, async (req) => {
  const url = new URL(req.url)
  const urlPath = url.pathname

  if (urlPath.startsWith('/api')) {
    return await proxyHttp(req, urlPath + url.search)
  }
  if (urlPath.startsWith('/card-art')) {
    return await proxyHttp(req, urlPath + url.search)
  }
  if (urlPath.startsWith('/ws')) {
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return await proxyWebSocket(req, urlPath)
    }
    return await proxyHttp(req, urlPath + url.search)
  }
  return await serveStatic(urlPath)
})

console.log(`Campus Forge frontend serving ${DIST} on http://0.0.0.0:${PORT} (proxy -> ${BACKEND})`)
