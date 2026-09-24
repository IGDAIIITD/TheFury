export default function BattleUnavailable() {
  return (
    <div className="page">
      <h2>Battle</h2>
      <div className="panel">
        <p className="empty">Battles are not available in this build.</p>
        <p className="meta">
          The battle engine is a separate service and is not configured for this deployment. Your
          collection, decks, trades, events, and scanning all work normally.
        </p>
      </div>
    </div>
  )
}
