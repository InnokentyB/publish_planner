import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import WeeksList from './pages/WeeksList'
import WeekDetail from './pages/WeekDetail'
import PostEditor from './pages/PostEditor'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'
import V2Dashboard from './pages/V2Dashboard'
import V2WeekDetail from './pages/V2WeekDetail'
import Guide from './pages/Guide'
import PublicationTasks from './pages/PublicationTasks'
import './index.css'

import Layout from './components/Layout'

const queryClient = new QueryClient()


function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        {/* V2 Orchestrator Routes */}
        <Route path="/orchestrator" element={<V2Dashboard />} />
        <Route path="/v2/weeks/:id" element={<V2WeekDetail />} />

        {/* V1 Routes */}
        <Route path="/" element={<WeeksList />} />
        <Route path="/weeks/:id" element={<WeekDetail />} />
        <Route path="/posts/:id" element={<PostEditor />} />

        <Route path="/settings" element={<Settings />} />
        <Route path="/publication-tasks" element={<PublicationTasks />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="*" element={<Navigate to="/orchestrator" />} />
      </Routes>
    </Layout>
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
