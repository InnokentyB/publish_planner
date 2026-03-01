import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '../api'

interface ContentItem {
    id: number
    type: string
    layer: string
    title: string
    context_brief: string
    schedule_at: string
    status: string
}

interface WeekPackageDetail {
    id: number
    theme: string
    core_thesis: string
    audience_focus: string
    intent_tag: string
    monetization_tie: string
    narrative_arc: string[]
    risks_warnings: string[]
    approval_status: string
    week_start: string
    week_end: string
    content_items: ContentItem[]
}

export default function V2WeekDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const { data: week, isLoading, error } = useQuery<WeekPackageDetail>({
        queryKey: ['v2_week', id],
        queryFn: () => api.get(`/api/v2/weeks/${id}`)
    })

    const approveWeek = useMutation({
        mutationFn: () => api.post(`/api/v2/approve-week/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_week', id] })
            queryClient.invalidateQueries({ queryKey: ['v2_weeks'] })
        }
    })

    if (isLoading) return <div className="container" style={{ textAlign: 'center', marginTop: '4rem' }}>Loading Approval Pack...</div>
    if (error || !week) return <div className="container" style={{ color: 'red' }}>Error loading V2 Week. Wait a few seconds if you just generated it.</div>

    return (
        <div className="container" style={{ maxWidth: '900px' }}>
            <div className="flex-between mb-4">
                <button className="btn-secondary" onClick={() => navigate('/orchestrator')}>← Back</button>
                {week.approval_status === 'draft' && (
                    <button
                        className="btn-primary"
                        onClick={() => approveWeek.mutate()}
                        disabled={approveWeek.isPending}
                        style={{ background: 'var(--success)' }}
                    >
                        {approveWeek.isPending ? 'Approving...' : '✓ Approve Week Package'}
                    </button>
                )}
            </div>

            <div className="card mb-4">
                <div className="flex-between mb-2">
                    <h1 style={{ margin: 0 }}>{week.theme}</h1>
                    <span className={`badge badge-${week.approval_status}`} style={{ fontSize: '1.2rem', padding: '0.5rem 1rem' }}>
                        {week.approval_status.toUpperCase()}
                    </span>
                </div>
                <div className="text-muted mb-4">
                    {format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d, yyyy')}
                </div>

                <div className="grid grid-2 mb-4" style={{ gap: '2rem' }}>
                    <div>
                        <h3 className="mb-2">Strategy Context</h3>
                        <p><strong>Thesis:</strong> {week.core_thesis}</p>
                        <p><strong>Intent:</strong> {week.intent_tag}</p>
                        <p><strong>Focus:</strong> {week.audience_focus}</p>
                        <p><strong>Monetization:</strong> {week.monetization_tie}</p>
                    </div>

                    {week.risks_warnings?.length > 0 && (
                        <div style={{ background: '#3a2020', padding: '1rem', borderRadius: '8px' }}>
                            <h3 className="mb-2" style={{ color: 'var(--error)' }}>⚠️ NCC Warnings</h3>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--error)' }}>
                                {week.risks_warnings.map((risk, i) => (
                                    <li key={i}>{risk}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="mb-4">
                    <h3 className="mb-2">7-Day Narrative Arc</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {week.narrative_arc.map((day, i) => (
                            <div key={i} style={{ padding: '0.8rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                                <strong>Day {i + 1}:</strong> {day}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <h2 className="mb-3">Content Items ({week.content_items?.length || 0})</h2>
            <div className="grid">
                {week.content_items?.map(item => (
                    <div key={item.id} className="card p-3 mb-2" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: '100px', textAlign: 'center' }}>
                            <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                {format(new Date(item.schedule_at), 'E, MMM d')}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                {format(new Date(item.schedule_at), 'HH:mm')}
                            </div>
                        </div>

                        <div style={{ flex: 1 }}>
                            <div className="flex-between mb-1">
                                <strong>{item.title}</strong>
                                <span className={`badge badge-${item.status}`}>{item.status}</span>
                            </div>

                            <div className="flex-between text-muted mb-2" style={{ fontSize: '0.85rem' }}>
                                <span><span style={{ color: 'var(--primary)' }}>Format:</span> {item.type}</span>
                                <span><span style={{ color: 'var(--primary)' }}>Layer:</span> {item.layer}</span>
                            </div>

                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                {item.context_brief}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
