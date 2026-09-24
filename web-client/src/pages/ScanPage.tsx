import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { ClaimApiError, claimToken } from '../api/qrEndpoints'
import type { ClaimResult } from '../api/types'

type CameraState = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported'

type Outcome =
  | { kind: 'success'; result: ClaimResult }
  | { kind: 'already'; result: ClaimResult }
  | { kind: 'error'; status: number; message: string }

function outcomeMessage(outcome: Outcome): string {
  if (outcome.kind === 'error') return outcome.message || 'Could not claim that code.'
  if (outcome.kind === 'already') {
    const { card, reason, copiesOwned, maxCopies } = outcome.result
    if (reason === 'SAME_CODE') {
      return `You already scanned this code. Find a different ${card.forgeName} code for another copy (${copiesOwned ?? 1} of ${maxCopies ?? 4}).`
    }
    if (reason === 'MAX_COPIES') return `You have all ${maxCopies ?? 4} copies of ${card.forgeName}.`
    if (reason === 'UNLIMITED') return `${card.forgeName} is already unlocked: you have unlimited copies.`
    return 'Already discovered. Keep scanning!'
  }
  return `Claimed ${outcome.result.card.forgeName}!`
}

/** "+10 XP · copy 2 of 4 · discovery #5" or "+10 XP · unlimited copies · discovery #1" */
function successDetail(result: ClaimResult): string {
  const parts = [`+${result.experienceAwarded} XP`]
  if (result.maxCopies && result.copiesOwned) parts.push(`copy ${result.copiesOwned} of ${result.maxCopies}`)
  else if (result.card.ownershipType === 'UNLIMITED') parts.push('unlimited copies')
  parts.push(`discovery #${result.discoveryCount}`)
  return parts.join(' · ')
}

export default function ScanPage() {
  const [camera, setCamera] = useState<CameraState>('idle')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [manualToken, setManualToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const activeRef = useRef(false)
  const submittingRef = useRef(false)

  const cameraSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

  const stopCamera = useCallback(() => {
    activeRef.current = false
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const doClaim = useCallback(async (token: string) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    stopCamera()
    try {
      const result = await claimToken(token.trim().toUpperCase())
      setOutcome(result.unlocked ? { kind: 'success', result } : { kind: 'already', result })
    } catch (err) {
      if (err instanceof ClaimApiError) {
        setOutcome({ kind: 'error', status: err.status, message: err.message })
      } else {
        setOutcome({ kind: 'error', status: 0, message: 'Unexpected error while claiming.' })
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [stopCamera])

  const handleScanRef = useRef<(token: string) => void>(() => {})
  handleScanRef.current = (token: string) => {
    void doClaim(token)
  }

  const decodeLoop = useCallback(() => {
    if (!activeRef.current) {
      rafRef.current = 0
      return
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState >= 2) {
      const w = video.videoWidth
      const h = video.videoHeight
      if (w > 0 && h > 0) {
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h)
          const image = ctx.getImageData(0, 0, w, h)
          const qr = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
          if (qr?.data) {
            handleScanRef.current(qr.data)
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(decodeLoop)
  }, [])

  const startCamera = useCallback(() => {
    if (!cameraSupported) {
      setCamera('unsupported')
      return
    }
    setCamera('requesting')
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
        setCamera('live')
      })
      .catch(() => setCamera('denied'))
  }, [cameraSupported])

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  useEffect(() => {
    if (camera === 'live') {
      activeRef.current = true
      rafRef.current = requestAnimationFrame(decodeLoop)
    }
  }, [camera, decodeLoop])

  const reset = useCallback(() => {
    setOutcome(null)
    setManualToken('')
    setSubmitting(false)
    startCamera()
  }, [startCamera])

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const token = manualToken.trim()
    if (token) void doClaim(token)
  }

  const busy = submitting
  const showManual = camera === 'denied' || camera === 'unsupported'

  return (
    <div className="page">
      <h2>Scan</h2>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        Scan a campus QR code to claim a card. Codes are single-use for unique cards.
      </p>

      <div className="panel" style={{ marginTop: 16, maxWidth: 560 }}>
        {outcome ? (
          <div className={outcome.kind === 'success' ? 'reveal-sheet' : undefined}>
            <div
              className={outcome.kind === 'success' ? 'reveal-badge' : undefined}
              style={{
                fontSize: 40,
                marginBottom: 8,
                color: outcome.kind === 'error' ? 'var(--bad)' : 'var(--good)',
              }}
            >
              {outcome.kind === 'success' ? '✦' : outcome.kind === 'already' ? '∞' : '!'}
            </div>
            <h3 style={{ margin: 0 }}>
              {outcome.kind === 'success'
                ? `Claimed ${outcome.result.card.forgeName}`
                : outcome.kind === 'already'
                  ? 'Already discovered'
                  : 'Not claimed'}
            </h3>
            <p style={{ color: 'var(--muted)' }}>
              {outcome.kind === 'success' && outcome.result.experienceAwarded > 0
                ? successDetail(outcome.result)
                : outcome.kind === 'error'
                  ? 'Could not claim that code.'
                  : outcomeMessage(outcome)}
            </p>
            {outcome.kind === 'error' && (
              <p style={{ color: 'var(--bad)', fontSize: 14 }}>{outcome.message}</p>
            )}
            <button className="btn" onClick={reset}>
              Scan another
            </button>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', borderRadius: 8, background: '#000', minHeight: 180 }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {camera !== 'live' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--muted)',
                    background: 'rgba(0,0,0,0.55)',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {camera === 'idle' || camera === 'requesting'
                    ? 'Requesting camera…'
                    : camera === 'denied'
                      ? 'Camera access denied.'
                      : 'Camera not supported on this device.'}
                </div>
              )}
            </div>

            {(camera === 'denied' || camera === 'unsupported') && (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
                Camera unavailable (needs HTTPS or a secure localhost). Enter the code printed on
                the card instead:
              </p>
            )}
          </>
        )}

        <form onSubmit={onManualSubmit} style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <input
            data-testid="manual-token"
            placeholder="12-character code (e.g. H7KQ2MXP9RTA)"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            style={{ flex: 1, padding: 10 }}
            disabled={!!outcome}
          />
          <button className="btn" type="submit" disabled={busy || !manualToken.trim() || !!outcome}>
            {busy ? 'Claiming…' : 'Claim'}
          </button>
        </form>
        {!showManual && (
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            Tip: no camera handy? Type the code above.
          </p>
        )}
      </div>
    </div>
  )
}
