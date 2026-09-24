import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { discoverBattleEngine } from './api/battleEngineDiscovery'
import { AuthProvider } from './auth/AuthContext'
import App from './App'
import './index.css'

registerSW({ immediate: true })

// Vite's base ('/TheFury/' on GitHub Pages, '/' locally) is the router basename.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

const root = ReactDOM.createRoot(document.getElementById('root')!)

function render() {
  root.render(
    <React.StrictMode>
      <BrowserRouter basename={basename}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  )
}

render()
// The Battle tab appears (or disappears) once the engine URL is discovered.
discoverBattleEngine(render)
