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

interface QuarterPlan {
    id: number
    quarter_start: string
    quarter_end: string
    strategic_goal: string
    primary_pillar: string
    month_arcs: MonthArc[]
}

interface MonthArc {
    id: number
    month: string
    arc_theme: string
    arc_thesis: string
    week_packages: WeekPackage[]
}

export default function V2Dashboard() {
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [activeTab, setActiveTab] = useState<'weeks' | 'quarters'>('quarters')
    const [showCreate, setShowCreate] = useState(false)
    const [showCreateQuarter, setShowCreateQuarter] = useState(false)

    // Week State
    const [themeHint, setThemeHint] = useState('')
    const [startDate, setStartDate] = useState('')

    // Quarter state
    const [qGoalHint, setQGoalHint] = useState('')
    const [qStartDate, setQStartDate] = useState('')

    const { data: weeks, isLoading: loadingWeeks } = useQuery<WeekPackage[]>({
        queryKey: ['v2_weeks', currentProject?.id],
        queryFn: () => api.get('/api/v2/weeks'),
        enabled: !!currentProject && activeTab === 'weeks'
    })

    const { data: quarters, isLoading: loadingQuarters } = useQuery<QuarterPlan[]>({
        queryKey: ['v2_quarters', currentProject?.id],
        queryFn: () => api.get('/api/v2/quarters'),
        enabled: !!currentProject && activeTab === 'quarters'
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

    const createQuarter = useMutation({
        mutationFn: (data: { goalHint: string; startDate?: string }) =>
            api.post('/api/v2/plan-quarter', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_quarters'] })
            setShowCreateQuarter(false)
            setQGoalHint('')
            setQStartDate('')
            setActiveTab('quarters')
        },
        onError: (err: any) => {
            alert(`Quarter Planning failed: ${err.message}`)
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

    if (loadingWeeks || loadingQuarters) return <div className="container">Loading Orchestrator...</div>

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
                    {activeTab === 'weeks' ? (
                        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
                            {showCreate ? 'Cancel' : '+ Plan New Week'}
                        </button>
                    ) : (
                        <button className="btn-primary" onClick={() => setShowCreateQuarter(!showCreateQuarter)}>
                            {showCreateQuarter ? 'Cancel' : '+ Plan Strategic Quarter'}
                        </button>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
                <button
                    style={{ background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer', borderBottom: activeTab === 'quarters' ? '2px solid var(--primary)' : '2px solid transparent', color: activeTab === 'quarters' ? 'var(--primary)' : 'var(--text-main)' }}
                    onClick={() => setActiveTab('quarters')}
                >
                    Quarter Strategy (Top-Down)
                </button>
                <button
                    style={{ background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer', borderBottom: activeTab === 'weeks' ? '2px solid var(--primary)' : '2px solid transparent', color: activeTab === 'weeks' ? 'var(--primary)' : 'var(--text-main)' }}
                    onClick={() => setActiveTab('weeks')}
                >
                    Tactical Weeks
                </button>
            </div>

            {showCreateQuarter && activeTab === 'quarters' && (
                <div className="card mb-3" style={{ border: '2px solid var(--primary)' }}>
                    <h3>Plan Quarter (QSP &gt; MTA &gt; SMO)</h3>
                    <div className="grid grid-2" style={{ gap: '1rem' }}>
                        <div>
                            <label className="text-muted">Global Strategic Goal</label>
                            <input
                                type="text"
                                value={qGoalHint}
                                onChange={e => setQGoalHint(e.target.value)}
                                placeholder="e.g. Sell the analytics course in Month 3"
                            />
                        </div>
                        <div>
                            <label className="text-muted">Quarter Start Date</label>
                            <input
                                type="date"
                                value={qStartDate}
                                onChange={e => setQStartDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <button
                        className="btn-primary mt-2"
                        onClick={() => createQuarter.mutate({ goalHint: qGoalHint, startDate: qStartDate || undefined })}
                        disabled={createQuarter.isPending}
                    >
                        {createQuarter.isPending ? 'Architecting 3 Months & 12 Weeks (may take 2 mins)...' : 'Generate Full Quarter'}
                    </button>
                </div>
            )}

            {showCreate && activeTab === 'weeks' && (
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

            {activeTab === 'weeks' && (
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
                            No tactical weeks found.
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'quarters' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {quarters?.map(q => (
                        <div key={q.id} className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
                            <div className="flex-between mb-2">
                                <h2>Q: {format(new Date(q.quarter_start), 'MMM yyyy')} - {format(new Date(q.quarter_end), 'MMM yyyy')}</h2>
                                <span className="badge badge-draft">STRATEGY</span>
                            </div>
                            <p><strong>Goal:</strong> {q.strategic_goal}</p>
                            <p><strong>Pillar:</strong> {q.primary_pillar}</p>

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                                {q.month_arcs.map((m, i) => (
                                    <div key={m.id} className="card" style={{ minWidth: '300px', background: 'var(--bg-secondary)' }}>
                                        <h4>Month {i + 1}: {format(new Date(m.month), 'MMMM')}</h4>
                                        <p style={{ fontSize: '0.9rem', color: 'var(--primary)' }}><strong>Focus:</strong> {m.arc_theme}</p>
                                        <p style={{ fontSize: '0.85rem' }} className="text-muted"><strong>Thesis:</strong> {m.arc_thesis}</p>

                                        <div style={{ marginTop: '1rem' }}>
                                            <strong style={{ fontSize: '0.8rem' }}>WEEKS:</strong>
                                            <ul style={{ paddingLeft: '1.2rem', margin: '0.5rem 0', fontSize: '0.85rem' }}>
                                                {m.week_packages.map(wp => (
                                                    <li key={wp.id} style={{ marginBottom: '0.5rem' }}>
                                                        <Link to={`/v2/weeks/${wp.id}`} style={{ color: 'var(--text-main)' }}>
                                                            {wp.theme} <span style={{ color: 'var(--text-muted)' }}>({wp.approval_status})</span>
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {quarters && quarters.length === 0 && (
                        <div className="card text-center text-muted" style={{ padding: '3rem' }}>
                            No strategic quarters planned yet. Click '+ Plan Strategic Quarter' to build your 3-month strategy.
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
