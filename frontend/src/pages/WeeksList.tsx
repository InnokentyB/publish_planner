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

            <div className="grid grid-2">
                {weeks?.map((week) => (
                    <Link key={week.id} to={`/weeks/${week.id}`} style={{ textDecoration: 'none' }}>
                        <div className="card" style={{ cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px)'
                                e.currentTarget.style.boxShadow = '0 4px 16px var(--shadow)'
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)'
                                e.currentTarget.style.boxShadow = '0 2px 8px var(--shadow)'
                            }}>
                            <div className="flex-between mb-2">
                                <h3 style={{ margin: 0 }}>{week.theme}</h3>
                                <span className={`badge badge-${week.status}`}>
                                    {week.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <div className="text-muted">
                                {format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d, yyyy')}
                            </div>
                            {week._count && (
                                <div className="text-muted mt-1">
                                    {week._count.posts} posts
                                </div>
                            )}
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    )
}
