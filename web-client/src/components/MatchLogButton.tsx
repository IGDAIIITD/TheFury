import { useState } from 'react'
import { getMatchLog } from '../api/endpoints'

/** "Log" button for a finished match: loads the saved text game log and shows it in an overlay. */
export default function MatchLogButton({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const show = async () => {
    setOpen(true)
    if (state === 'done') return
    setState('loading')
    try {
      setText(await getMatchLog(matchId))
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <button type="button" className="btn ghost history-log-btn" onClick={show}>
        Log
      </button>
      {open && (
        <div className="log-overlay" onClick={() => setOpen(false)}>
          <div className="log-panel panel" role="dialog" aria-label="Match log" onClick={(e) => e.stopPropagation()}>
            <div className="log-panel-head">
              <h3>Match log</h3>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {state === 'loading' && <div className="meta">Loading…</div>}
            {state === 'error' && <div className="problem">Could not load the log.</div>}
            {state === 'done' &&
              (text ? (
                <pre className="log-text">{text}</pre>
              ) : (
                <div className="meta">
                  No log was saved for this match. Logs are recorded for battles played after the battle server was
                  last updated.
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  )
}
