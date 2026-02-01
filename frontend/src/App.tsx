import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WeeksList from './pages/WeeksList'
import WeekDetail from './pages/WeekDetail'
import PostEditor from './pages/PostEditor'
import Settings from './pages/Settings'
import './index.css'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div style={{ minHeight: '100vh' }}>
          <nav style={{
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
            padding: '1rem 2rem',
            marginBottom: '2rem'
          }}>
            <div className="flex-between" style={{ maxWidth: '1400px', margin: '0 auto' }}>
              <div className="flex-center">
                <h2 style={{ margin: 0 }}>📅 Post Planner</h2>
              </div>
              <div className="flex-center" style={{ gap: '2rem' }}>
                <Link to="/">Weeks</Link>
                <Link to="/settings">Settings</Link>
              </div>
            </div>
          </nav>

          <Routes>
            <Route path="/" element={<WeeksList />} />
            <Route path="/weeks/:id" element={<WeekDetail />} />
            <Route path="/posts/:id" element={<PostEditor />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
