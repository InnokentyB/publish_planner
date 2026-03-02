import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { format } from 'date-fns'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

interface WeekPackage {
    id: number
    theme: string
    core_thesis: string
    week_start: string
    week_end: string
    approval_status: string
    _count?: { content_items: number }
}

export default function V2Dashboard() {
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [showCreate, setShowCreate] = useState(false)
    const [themeHint, setThemeHint] = useState('')
    const [startDate, setStartDate] = useState('')

    const { data: weeks, isLoading, error } = useQuery<WeekPackage[]>({
        queryKey: ['v2_weeks', currentProject?.id],
        queryFn: () => api.get('/api/v2/weeks'),
        enabled: !!currentProject
    })

    const createWeek = useMutation({
        mutationFn: (data: { themeHint: string; startDate?: string }) =>
            api.post('/api/v2/plan-week', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_weeks'] })
            setShowCreate(false)
            setThemeHint('')
            setStartDate('')
        },
        onError: (err: any) => {
            alert(`Planning failed: ${err.message}`)
        }
    })

    const runSweep = useMutation({
        mutationFn: () => api.post('/api/v2/factory-sweep', {}),
        onSuccess: (data: any) => {
            alert(`Sweep completed! Processed: ${data.processed} items.`)
        },
        onError: (err: any) => {
            alert(`Sweep failed: ${err.message}`)
        }
    })

    if (!currentProject) {
        return (
            <div className="container">
                <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
                    <h2>No Project Selected</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Select a project to view V2 Orchestrator.</p>
                </div>
            </div>
        )
    }

    if (isLoading) return <div className="container">Loading Orchestrator...</div>
    if (error) return <div className="container" style={{ color: 'red' }}>Error: {(error as Error).message}</div>

    return (
        <div className="container">
            <div className="flex-between mb-3">
                <div>
                    <h1>V2 Orchestrator</h1>
                    <p className="text-muted">Strategic Planning & Distribution</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn-secondary" onClick={() => runSweep.mutate()} disabled={runSweep.isPending}>
                        {runSweep.isPending ? 'Sweeping...' : 'Run Factory Sweep'}
                    </button>
                    <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
                        {showCreate ? 'Cancel' : '+ Plan New Week'}
                    </button>
                </div>
            </div>

            {showCreate && (
                <div className="card mb-3" style={{ border: '2px solid var(--primary)' }}>
                    <h3>Plan Week (SMO &gt; DA &gt; NCC)</h3>
                    <div className="grid grid-2" style={{ gap: '1rem' }}>
                        <div>
                            <label className="text-muted">Theme Hint (Optional)</label>
                            <input
                                type="text"
                                value={themeHint}
                                onChange={e => setThemeHint(e.target.value)}
                                placeholder="e.g. System Analysis Focus"
                            />
                        </div>
                        <div>
                            <label className="text-muted">Start Date (Monday)</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <button
                        className="btn-primary mt-2"
                        onClick={() => createWeek.mutate({ themeHint, startDate: startDate || undefined })}
                        disabled={createWeek.isPending}
                    >
                        {createWeek.isPending ? 'Agents are planning (may take 60s)...' : 'Generate Strategic Plan'}
                    </button>
                </div>
            )}

            <div className="grid grid-2">
                {weeks?.map(wp => (
                    <Link key={wp.id} to={`/v2/weeks/${wp.id}`} style={{ textDecoration: 'none' }}>
                        <div className="card" style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>

                            <div className="flex-between mb-1">
                                <h3 style={{ margin: 0 }}>{wp.theme}</h3>
                                <span className={`badge badge-${wp.approval_status}`}>
                                    {wp.approval_status.toUpperCase()}
                                </span>
                            </div>

                            <p className="text-muted mb-2" style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                {wp.core_thesis}
                            </p>

                            <div className="flex-between text-muted" style={{ fontSize: '0.85rem' }}>
                                <span>{format(new Date(wp.week_start), 'MMM d')} - {format(new Date(wp.week_end), 'MMM d, yyyy')}</span>
                                <span>{wp._count?.content_items || 0} items</span>
                            </div>
                        </div>
                    </Link>
                ))}

                {weeks && weeks.length === 0 && (
                    <div className="card text-center text-muted" style={{ gridColumn: '1 / -1', padding: '3rem' }}>
                        No V2 plans generated yet. Click 'Plan New Week' to start.
                    </div>
                )}
            </div>
        </div>
    )
}
