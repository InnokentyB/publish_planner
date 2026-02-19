import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { format } from 'date-fns'
import { api } from '../api'

interface Week {
    id: number
    theme: string
    week_start: string
    week_end: string
    status: string
    _count?: { posts: number }
}

import { useAuth } from '../context/AuthContext'

export default function WeeksList() {
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [showCreate, setShowCreate] = useState(false)
    const [theme, setTheme] = useState('')
    const [startDate, setStartDate] = useState('')

    const { data: weeks, isLoading, error } = useQuery<Week[]>({
        queryKey: ['weeks', currentProject?.id],
        queryFn: () => api.get('/api/weeks'),
        enabled: !!currentProject
    })

    const createWeek = useMutation({
        mutationFn: (data: { theme: string; startDate?: string }) =>
            api.post('/api/weeks', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['weeks'] })
            setShowCreate(false)
            setTheme('')
            setStartDate('')
        }
    })

    if (!currentProject) {
        return (
            <div className="container">
                <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
                    <h2>No Project Selected</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                        Please select a project from the top menu to view content weeks.
                    </p>
                </div>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Loading weeks...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="container">
                <div className="card" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
                    <h3>Error loading weeks</h3>
                    <p>{(error as Error).message}</p>
                </div>
            </div>
        )
    }

    // Categorize Weeks
    const now = new Date()
    // Reset time part for accurate date comparison
    now.setHours(0, 0, 0, 0)

    let activeWeek: Week | null = null
    const futureWeeks: Week[] = []
    const pastWeeks: Week[] = []

    if (weeks) {
        // Sort all weeks first to ensure consistent processing
        const sortedWeeks = [...weeks].sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime())

        sortedWeeks.forEach(week => {
            const start = new Date(week.week_start)
            const end = new Date(week.week_end)
            // Adjust end date to include the full day
            end.setHours(23, 59, 59, 999)

            if (now >= start && now <= end) {
                activeWeek = week
            } else if (start > now) {
                futureWeeks.push(week)
            } else {
                pastWeeks.push(week)
            }
        })
    }

    // Sort Future: Ascending (closest first) - already sorted by main sort
    // Sort Past: Descending (most recent first)
    pastWeeks.sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime())

    const WeekCard = ({ week, isActive = false }: { week: Week, isActive?: boolean }) => (
        <Link key={week.id} to={`/weeks/${week.id}`} style={{ textDecoration: 'none' }}>
            <div className={`card ${isActive ? 'active-week-card' : ''}`} style={{
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                border: isActive ? '2px solid var(--primary)' : undefined,
                backgroundColor: isActive ? 'var(--bg-secondary)' : undefined
            }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 4px 16px var(--shadow)'
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = '0 2px 8px var(--shadow)'
                }}>
                <div className="flex-between mb-2">
                    <h3 style={{ margin: 0, fontSize: isActive ? '1.5rem' : '1.25rem' }}>{week.theme}</h3>
                    <span className={`badge badge-${week.status}`}>
                        {week.status.replace(/_/g, ' ')}
                    </span>
                </div>
                <div className="text-muted">
                    {isActive && <span style={{ color: 'var(--primary)', fontWeight: 'bold', marginRight: '0.5rem' }}>CURRENT WEEK •</span>}
                    {format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d, yyyy')}
                </div>
                {week._count && (
                    <div className="text-muted mt-1">
                        {week._count.posts} posts
                    </div>
                )}
            </div>
        </Link>
    )

    return (
        <div className="container">
            <div className="flex-between mb-3">
                <h1>Content Weeks</h1>
                <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
                    {showCreate ? 'Cancel' : '+ New Week'}
                </button>
            </div>

            {showCreate && (
                <div className="card mb-3">
                    <h3>Create New Week</h3>
                    <div className="grid" style={{ gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                Theme
                            </label>
                            <input
                                type="text"
                                value={theme}
                                onChange={(e) => setTheme(e.target.value)}
                                placeholder="e.g., AI and Machine Learning"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                Start Date (optional)
                            </label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                            <div className="text-muted mt-1">Leave empty to use next available week</div>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={() => createWeek.mutate({ theme, startDate: startDate || undefined })}
                            disabled={!theme || createWeek.isPending}
                        >
                            {createWeek.isPending ? 'Creating...' : 'Create Week'}
                        </button>
                    </div>
                </div>
            )}

            {weeks && weeks.length === 0 && (
                <div className="card text-center" style={{ padding: '3rem' }}>
                    <p className="text-muted">No weeks yet. Create your first week to get started!</p>
                </div>
            )}

            {/* Active Week */}
            {activeWeek && (
                <section className="mb-4">
                    <h2 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>Active Week</h2>
                    <WeekCard week={activeWeek} isActive={true} />
                </section>
            )}

            {/* Future Weeks */}
            {futureWeeks.length > 0 && (
                <section className="mb-4">
                    <h2 className="mb-2">Upcoming Weeks</h2>
                    <div className="grid grid-2">
                        {futureWeeks.map(week => <WeekCard key={week.id} week={week} />)}
                    </div>
                </section>
            )}

            {/* Past Weeks - Collapsible */}
            {pastWeeks.length > 0 && (
                <section className="mb-4">
                    <details>
                        <summary style={{ cursor: 'pointer', fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                            Show Past Weeks ({pastWeeks.length})
                        </summary>
                        <div className="grid grid-2 mt-2">
                            {pastWeeks.map(week => <WeekCard key={week.id} week={week} />)}
                        </div>
                    </details>
                </section>
            )}
        </div>
    )
}
