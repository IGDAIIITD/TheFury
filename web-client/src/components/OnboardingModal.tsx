import { useEffect, useState } from 'react'

const STORAGE_KEY = 'cf_onboard_seen'

export default function OnboardingModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    const timer = setTimeout(() => setOpen(true), 900)
    return () => clearTimeout(timer)
  }, [])

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="onboard-overlay" onClick={dismiss}>
      <div className="onboard-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Install guide">
        <h3>Welcome to Campus Forge</h3>
        <p className="meta">Install the app for the full experience.</p>
        <ul className="onboard-list">
          <li>
            <strong>iOS Safari:</strong> tap the Share button, then “Add to Home Screen”.
          </li>
          <li>
            <strong>Android Chrome:</strong> tap the menu, then “Install app”.
          </li>
        </ul>
        <p className="meta">
          Battles, QR scans and trades need a live connection. Your card catalog and stats are cached
          so you can keep browsing offline.
        </p>
        <button className="btn" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
