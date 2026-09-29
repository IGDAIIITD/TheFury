import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CardEntry } from '../api/battleTypes'
import BattleCard, { ManaCostPips } from '../components/BattleCard'
import { HealthBar, ManaPanel, PhaseStrip } from '../components/BattleHud'
import { availableMana, canAfford, describeManaCost } from './battleUi'
import { MAX_UNLOCK_COPIES } from '../lib/ownership'

const land = (id: number, name: 'Mountain' | 'Forest', tapped = false): CardEntry => ({
  id,
  name,
  type: 'Basic Land',
  tapped,
})
const creature = (id: number, name: string, cost: string, power: number, toughness: number, extra: Partial<CardEntry> = {}): CardEntry => ({
  id,
  name,
  type: 'Creature',
  cost,
  power,
  toughness,
  ...extra,
})

const DEMO_LANDS: CardEntry[] = [land(1, 'Mountain'), land(2, 'Mountain'), land(3, 'Forest'), land(4, 'Forest'), land(5, 'Forest')]
const DEMO_HAND: CardEntry[] = [
  creature(11, 'Raging Goblin', '{R}', 1, 1),
  creature(12, 'Grizzly Bears', '{1}{G}', 2, 2),
  creature(13, 'Hill Giant', '{3}{R}', 3, 3),
  creature(14, 'Craw Wurm', '{4}{G}{G}', 6, 4),
]

const SECTIONS = [
  { id: 'goal', label: 'The goal' },
  { id: 'turn', label: 'A turn' },
  { id: 'mana', label: 'Mana' },
  { id: 'combat', label: 'Attacking' },
  { id: 'qr', label: 'QR codes' },
  { id: 'progress', label: 'XP & decks' },
]

/** Tap the lands to spend mana and watch which cards in hand you can still cast. */
function ManaDemo() {
  const [lands, setLands] = useState(DEMO_LANDS)
  const mana = availableMana(lands, null)
  const toggle = (id: number) => setLands((ls) => ls.map((l) => (l.id === id ? { ...l, tapped: !l.tapped } : l)))

  return (
    <div className="guide-demo">
      <div className="guide-demo-label">Your lands (tap one to use it)</div>
      <div className="battle-lands guide-lands">
        {lands.map((l) => (
          <BattleCard key={l.id} card={l} small selectable onClick={() => toggle(l.id)} />
        ))}
      </div>
      <ManaPanel battlefield={lands} pool={null} />
      <div className="guide-demo-label">Your hand</div>
      <div className="guide-hand">
        {DEMO_HAND.map((c) => {
          const ok = canAfford(c.cost, mana)
          return (
            <figure key={c.id} className="guide-hand-card">
              <BattleCard card={c} disabled={!ok} />
              <figcaption className={ok ? 'ok' : 'no'}>
                {ok ? 'Can cast' : 'Not enough mana'}
                <small>{describeManaCost(c.cost)}</small>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <button type="button" className="btn ghost" onClick={() => setLands(DEMO_LANDS)}>
        Untap all
      </button>
    </div>
  )
}

function CostExample({ cost, name, text }: { cost: string; name: string; text: string }) {
  return (
    <div className="guide-cost-row">
      <span className="guide-cost-pips">
        <ManaCostPips cost={cost} />
      </span>
      <span>
        <strong>{name}</strong> · {text}
      </span>
    </div>
  )
}

export default function HowToPlayPage() {
  return (
    <div className="guide">
      <header className="guide-hero panel">
        <h2>How to play The Fury</h2>
        <p>
          The Fury is Magic: The Gathering, played on your phone with cards you collect by scanning QR codes around
          campus. This page covers everything you need for your first battle.
        </p>
        <nav className="guide-toc" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="chip">
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <section id="goal" className="guide-section panel">
        <h3>1 · The goal</h3>
        <p>
          Both players start with <strong>20 life</strong>. Bring your opponent to <strong>0</strong> and you win. Each
          segment is one life point, and the bar changes color at 10 and again at 5.
        </p>
        <div className="guide-health">
          <div>
            <span className="guide-demo-label">Start of the game</span>
            <HealthBar life={20} />
          </div>
          <div>
            <span className="guide-demo-label">Taking a beating</span>
            <HealthBar life={9} />
          </div>
          <div>
            <span className="guide-demo-label">In danger</span>
            <HealthBar life={3} />
          </div>
        </div>
        <p className="meta">You also lose if you have to draw from an empty deck, or if you press Concede.</p>
      </section>

      <section id="turn" className="guide-section panel">
        <h3>2 · A turn</h3>
        <p>Players take turns. The strip at the top of the battle screen shows where you are:</p>
        <PhaseStrip phase="MAIN1" />
        <ul className="guide-list">
          <li>
            <strong>Untap, Upkeep, Draw:</strong> your tapped cards straighten up and you draw a card. This happens by itself.
          </li>
          <li>
            <strong>Main:</strong> play <em>one land</em> per turn and cast creatures by tapping cards in your hand.
          </li>
          <li>
            <strong>Combat (Attack → Block → Damage):</strong> send creatures at your opponent; see <a href="#combat">Attacking</a>.
          </li>
          <li>
            <strong>Main 2, End:</strong> cast anything you held back, then the turn passes.
          </li>
        </ul>
        <p className="meta">
          When there is nothing to do, press <strong>Pass</strong>. The game skips steps where no one can act, so the
          board may move on without you touching it.
        </p>
      </section>

      <section id="mana" className="guide-section panel">
        <h3>3 · Mana: paying for cards</h3>
        <p>
          Every land makes <strong>one mana</strong> of its color when you tap it: a <strong>Mountain</strong> makes red,
          a <strong>Forest</strong> makes green. Tapped lands can't be used again until your next turn. The orbs show what
          you can still spend right now.
        </p>
        <p>The dots in a card's top corner are its cost:</p>
        <div className="guide-costs">
          <CostExample cost="{R}" name="Raging Goblin" text="one red mana." />
          <CostExample cost="{1}{G}" name="Grizzly Bears" text="one green + one of any color = 2 mana." />
          <CostExample cost="{3}{R}" name="Hill Giant" text="one red + three of any color = 4 mana." />
          <CostExample cost="{4}{G}{G}" name="Craw Wurm" text="two green + four of any color = 6 mana." />
        </div>
        <p>
          The grey circle with a number is <strong>generic</strong> mana: any color pays for it. Each colored dot must be
          paid with <strong>that</strong> color. So a card is castable when you have enough mana in total{' '}
          <em>and</em> enough of each color it asks for.
        </p>
        <ManaDemo />
        <p className="meta">
          Try it: tap both Mountains and Hill Giant goes grey. You still have 3 mana, but none of it is red.
        </p>
      </section>

      <section id="combat" className="guide-section panel">
        <h3>4 · Attacking and blocking</h3>
        <ol className="guide-list">
          <li>
            In the <strong>Attack</strong> step, tap the creatures you want to attack with. A green tick marks each one;
            then press <strong>Attack</strong>. Attacking taps the creature.
          </li>
          <li>
            Your opponent then picks <strong>blockers</strong> from their untapped creatures. Each blocker stands in front
            of one attacker.
          </li>
          <li>
            <strong>Damage:</strong> creatures deal damage equal to their <strong>power</strong> (the first number). A
            creature dies when the damage it takes reaches its <strong>toughness</strong> (the second number). An attacker
            nobody blocks hits the player instead.
          </li>
        </ol>

        <div className="guide-combat">
          <div className="guide-combat-side">
            <span className="guide-demo-label">Your attackers</span>
            <div className="guide-cards">
              <BattleCard card={creature(21, 'Hill Giant', '{3}{R}', 3, 3, { attacking: true, tapped: true, damage: 2 })} emphasis="attack" />
              <BattleCard card={creature(22, 'Raging Goblin', '{R}', 1, 1, { attacking: true, tapped: true })} emphasis="attack" />
            </div>
          </div>
          <div className="guide-combat-vs" aria-hidden>
            vs
          </div>
          <div className="guide-combat-side">
            <span className="guide-demo-label">Their blocker</span>
            <div className="guide-cards">
              <BattleCard card={creature(31, 'Grizzly Bears', '{1}{G}', 2, 2, { blocking: true, damage: 3 })} emphasis="block" />
            </div>
          </div>
        </div>
        <ul className="guide-list">
          <li>
            <strong>Hill Giant (3/3)</strong> is blocked by <strong>Grizzly Bears (2/2)</strong>. The Giant deals 3: the
            Bears die. The Bears deal 2 back: the overlay shows <strong>3/3 −2</strong>, one short of killing it, so the
            Giant survives. Damage wears off at the end of the turn.
          </li>
          <li>
            <strong>Raging Goblin (1/1)</strong> is unblocked, so your opponent loses 1 life.
          </li>
        </ul>

        <div className="guide-legend">
          <div>
            <BattleCard card={creature(41, 'Goblin Piker', '{1}{R}', 2, 1)} selectable selected />
            <span>Selected (green tick)</span>
          </div>
          <div>
            <BattleCard card={creature(42, 'Elvish Warrior', '{G}{G}', 2, 3, { attacking: true, tapped: true })} emphasis="attack" />
            <span>Attacking (red frame, tilted = tapped)</span>
          </div>
          <div>
            <BattleCard card={creature(43, 'Grizzly Bears', '{1}{G}', 2, 2, { blocking: true })} emphasis="block" />
            <span>Blocking (blue frame)</span>
          </div>
          <div>
            <BattleCard card={creature(44, 'Craw Wurm', '{4}{G}{G}', 6, 4, { damage: 3 })} />
            <span>Power/toughness, −3 = damage taken</span>
          </div>
        </div>
        <p className="meta">
          A creature can't attack on the turn it arrives (it needs a turn to settle in), unless its text says{' '}
          <strong>haste</strong>, like Raging Goblin. Tapped creatures can't block, so attacking with everything leaves you
          open. Long-press (or right-click) any card in battle to see it full size and read its text.
        </p>
      </section>

      <section id="qr" className="guide-section panel">
        <h3>5 · QR codes: collecting cards</h3>
        <p>
          Cards are printed as QR codes around campus. Open <Link to="/scan">Scan</Link>, point your camera at a code, and
          the card joins your collection. Each code is signed, so fakes are
          rejected.
        </p>
        <div className="guide-qr-grid">
          <div className="guide-qr">
            <strong>Free</strong>
            <p>Basic lands and the 10 starter creatures. Everyone has unlimited copies from day one.</p>
          </div>
          <div className="guide-qr">
            <strong>Scan once, unlock forever</strong>
            <p>Most commons. The first scan of any of its codes gives you unlimited copies.</p>
          </div>
          <div className="guide-qr">
            <strong>Scan a code per copy</strong>
            <p>
              Uncommons and rares. Each <em>different</em> code for the card gives one more copy, up to{' '}
              {MAX_UNLOCK_COPIES}. Rescanning the same code does nothing, so hunt for the others.
            </p>
          </div>
          <div className="guide-qr">
            <strong>One of a kind</strong>
            <p>Mythics. Each code works once, for whoever scans it first. You can trade these with other players.</p>
          </div>
        </div>
        <p className="meta">
          Every tile in <Link to="/collection">Collection</Link> says which rule applies and how many copies you have. A
          scan that gives you a new card or copy earns <strong>10 XP</strong>.
        </p>
      </section>

      <section id="progress" className="guide-section panel">
        <h3>6 · Decks, XP and battles</h3>
        <ul className="guide-list">
          <li>
            You start with a ready-made <strong>Red-Green Starter</strong> deck (60 cards). Build your own in{' '}
            <Link to="/decks">Decks</Link>: at least 60 cards, at most 4 of each card except basic lands.
          </li>
          <li>
            In <strong>Battle</strong>, create a lobby and share its 6-letter code, or join one from the Events page.
            Lobbies close after 2 minutes if nobody joins.
          </li>
          <li>
            Winning a battle gives <strong>50 XP</strong>; every 100 XP is a level. The Leaderboard ranks everyone by XP.
          </li>
          <li>
            If you reload or lose signal mid-battle, open Battle again: you rejoin your match. After a minute away you
            forfeit.
          </li>
          <li>Finished battles have a <strong>Log</strong> in your match history: a turn-by-turn record of what happened.</li>
        </ul>
      </section>
    </div>
  )
}
