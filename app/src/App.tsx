import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { session, type User } from './api'
import Login from './pages/Login'
import Home from './pages/Home'
import TripPage from './pages/TripPage'
import Admin from './pages/Admin'

export default function App() {
  const [user, setUser] = useState<User | null>(session.user)
  if (!user || !session.token) return <Login onLogin={setUser} />
  const logout = () => { session.clear(); setUser(null) }
  return (
    <Routes>
      <Route path="/" element={<Home user={user} onLogout={logout} />} />
      <Route path="/t/:tripId/*" element={<TripPage user={user} />} />
      <Route path="/admin" element={user.admin ? <Admin /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
