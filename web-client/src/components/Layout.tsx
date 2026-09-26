import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import OnboardingModal from './OnboardingModal'
import logo from '../assets/igda-iiitd-logo.png'
import { battleEngineConfigured } from '../api/battleConfig'

const TABS = [
  {
    to: '/collection',
    label: 'Collection',
    icon: <path d="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" />,
  },
  {
    to: '/decks',
    label: 'Decks',
    icon: <path d="M12 2 2 7l10 5 10-5-10-5z M2 12l10 5 10-5 M2 17l10 5 10-5" />,
  },
  {
    to: '/battle',
    label: 'Battle',
    icon: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
  },
  {
    to: '/scan',
    label: 'Scan',
    icon: <path d="M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4" />,
  },
  {
    to: '/profile',
    label: 'Profile',
    icon: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M5 21c0-4 3-6 7-6s7 2 7 6" />
      </>
    ),
  },
  {
    to: '/leaderboard',
    label: 'Leaderboard',
    icon: <path d="M8 21h8 M12 17v4 M7 4h10v6a5 5 0 0 1-10 0V4z M7 6H4a2 2 0 0 0 2 4h1 M17 6h3a2 2 0 0 1-2 4h-1" />,
  },
]

function TabIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon}
    </svg>
  )
}

export default function Layout() {
  const { player, logout } = useAuth()
  const navigate = useNavigate()
  const tabs = TABS.filter((tab) => tab.to !== '/battle' || battleEngineConfigured())

  const onLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      <nav className="navbar">
        <span className="brand">
          <img src={logo} alt="IGDA IIIT-Delhi" />
          <span className="brand-title">The Fury</span>
        </span>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="nav-link">
            {tab.label}
          </NavLink>
        ))}
        <span className="spacer" />
        {player && <span className="nav-player">{player.displayName} · Lv {player.level}</span>}
        <button className="btn ghost" onClick={onLogout}>
          Logout
        </button>
      </nav>
      <div className="content">
        <Outlet />
      </div>
      <nav className="tabbar">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="tab-item">
            <TabIcon icon={tab.icon} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
      <OnboardingModal />
    </>
  )
}
