import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import WeeksList from './pages/WeeksList'
import WeekDetail from './pages/WeekDetail'
import PostEditor from './pages/PostEditor'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'
import ProjectSelector from './components/ProjectSelector'
import './index.css'

const queryClient = new QueryClient()

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <div className="flex-center" style={{ height: '100vh' }}><div className="loading" /></div>
  if (!isAuthenticated) return <Navigate to="/login" />
  return <>{children}</>
}

function Navbar() {
  const { isAuthenticated, user, logout } = useAuth()

  return (
    <nav style={{
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      padding: '1rem 2rem',
      marginBottom: '2rem'
    }}>
      <div className="flex-between" style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div className="flex-center" style={{ gap: '2rem' }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h2 style={{ margin: 0 }}>📅 Post Planner</h2>
          </Link>
          {isAuthenticated && <ProjectSelector />}
        </div>
        <div className="flex-center" style={{ gap: '2rem' }}>
          {isAuthenticated ? (
            <>
              <Link to="/">Weeks</Link>
              <Link to="/settings">Settings</Link>
              <div className="flex-center" style={{ gap: '1rem' }}>
                <span className="text-muted" style={{ fontSize: '0.9rem' }}>{user?.email}</span>
                <button className="btn-secondary" onClick={logout} style={{ padding: '0.25rem 0.75rem' }}>Logout</button>
              </div>
            </>
          ) : (
            <>
              <Link to="/login">Login</Link>
              <Link to="/register">Register</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

function AppContent() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <Navbar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<ProtectedRoute><WeeksList /></ProtectedRoute>} />
        <Route path="/weeks/:id" element={<ProtectedRoute><WeekDetail /></ProtectedRoute>} />
        <Route path="/posts/:id" element={<ProtectedRoute><PostEditor /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      </Routes>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
