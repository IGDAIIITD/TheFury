import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import CollectionPage from './pages/CollectionPage'
import TradePage from './pages/TradePage'
import EventsPage from './pages/EventsPage'
import DeckBuilderPage from './pages/DeckBuilderPage'
import BattlePage from './pages/BattlePage'
import BattleUnavailable from './pages/BattleUnavailable'
import ScanPage from './pages/ScanPage'
import ProfilePage from './pages/ProfilePage'
import LeaderboardPage from './pages/LeaderboardPage'
import Layout from './components/Layout'
import { battleEngineConfigured } from './api/battleConfig'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/collection/trades" element={<TradePage />} />
        <Route path="/collection/events" element={<EventsPage />} />
        <Route path="/decks" element={<DeckBuilderPage />} />
        <Route path="/battle" element={battleEngineConfigured() ? <BattlePage /> : <BattleUnavailable />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/" element={<Navigate to="/collection" replace />} />
      </Route>
    </Routes>
  )
}
