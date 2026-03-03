import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
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

interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
}

// ─── Strategy Assistant Chat Panel ──────────────────────────────────────────

function StrategyChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [showPromptEditor, setShowPromptEditor] = useState(false)
    const [systemPrompt, setSystemPrompt] = useState('')
    const [isSavingPrompt, setIsSavingPrompt] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const { data: settings } = useQuery<{ systemPrompt: string }>({
        queryKey: ['strategy_chat_settings'],
        queryFn: () => api.get('/api/v2/strategy-chat/settings'),
    })

    useEffect(() => {
        if (settings?.systemPrompt) setSystemPrompt(settings.systemPrompt)
    }, [settings])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const sendMessage = async () => {
        const trimmed = input.trim()
        if (!trimmed || isLoading) return

        const newMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
        setMessages(newMessages)
        setInput('')
        setIsLoading(true)

        try {
            const res = await api.post('/api/v2/strategy-chat', {
                message: trimmed,
                history: messages.slice(-10)
            })
            setMessages([...newMessages, { role: 'assistant', content: res.data.reply }])
        } catch (e: any) {
            setMessages([...newMessages, {
                role: 'assistant',
                content: `⚠️ Ошибка: ${e.response?.data?.error || e.message}`
            }])
        } finally {
            setIsLoading(false)
        }
    }

    const savePrompt = async () => {
        setIsSavingPrompt(true)
        try {
            await api.put('/api/v2/strategy-chat/settings', { systemPrompt })
            setShowPromptEditor(false)
        } finally {
            setIsSavingPrompt(false)
        }
    }

    return (
        <div style={{
            border: '1px solid var(--border)',
            borderRadius: '12px',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            height: '560px'
        }}>
            {/* Header */}
            <div style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🧠</span>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Стратегический Ассистент</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Знает твой текущий квартальный план</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {messages.length > 0 && (
                        <button
                            onClick={() => setMessages([])}
                            style={{
                                background: 'none', border: '1px solid var(--border)',
                                borderRadius: '6px', padding: '0.3rem 0.6rem',
                                fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)'
                            }}
                        >
                            Очистить
                        </button>
                    )}
                    <button
                        onClick={() => setShowPromptEditor(!showPromptEditor)}
                        style={{
                            background: showPromptEditor ? 'var(--primary)' : 'none',
                            border: '1px solid var(--border)',
                            borderRadius: '6px', padding: '0.3rem 0.7rem',
                            fontSize: '0.75rem', cursor: 'pointer',
                            color: showPromptEditor ? '#fff' : 'var(--text-muted)'
                        }}
                        title="Настроить системный промпт"
                    >
                        ⚙️ Промпт
                    </button>
                </div>
            </div>

            {/* System prompt editor */}
            {showPromptEditor && (
                <div style={{
                    padding: '1rem',
                    borderBottom: '1px solid var(--border)',
                    background: 'rgba(var(--primary-rgb, 99,102,241), 0.05)'
                }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                        Системный промпт ассистента
                    </label>
                    <textarea
                        value={systemPrompt}
                        onChange={e => setSystemPrompt(e.target.value)}
                        rows={6}
                        style={{
                            width: '100%', resize: 'vertical', fontSize: '0.82rem',
                            fontFamily: 'monospace', padding: '0.6rem',
                            background: 'var(--bg-main)', border: '1px solid var(--border)',
                            borderRadius: '6px', color: 'var(--text-main)', lineHeight: 1.5,
                            boxSizing: 'border-box'
                        }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button
                            onClick={() => setShowPromptEditor(false)}
                            style={{
                                padding: '0.35rem 0.8rem', fontSize: '0.8rem',
                                background: 'none', border: '1px solid var(--border)',
                                borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)'
                            }}
                        >
                            Отмена
                        </button>
                        <button
                            onClick={savePrompt}
                            disabled={isSavingPrompt}
                            style={{
                                padding: '0.35rem 0.8rem', fontSize: '0.8rem',
                                background: 'var(--primary)', color: '#fff',
                                border: 'none', borderRadius: '6px', cursor: 'pointer'
                            }}
                        >
                            {isSavingPrompt ? 'Сохраняю...' : '✓ Сохранить'}
                        </button>
                    </div>
                </div>
            )}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {messages.length === 0 && (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '1rem',
                        color: 'var(--text-muted)', textAlign: 'center', padding: '2rem'
                    }}>
                        <div style={{ fontSize: '2.5rem' }}>🎯</div>
                        <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                            Спроси меня о стратегии для своих каналов.<br />
                            Я знаю твой текущий квартальный план и помогу его доработать.
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                            {[
                                'Как выстроить контент под разные каналы?',
                                'Проверь мою стратегию',
                                'Что публиковать в период прогрева?',
                                'Как часто публиковать?'
                            ].map(hint => (
                                <button
                                    key={hint}
                                    onClick={() => { setInput(hint); }}
                                    style={{
                                        padding: '0.35rem 0.7rem', fontSize: '0.78rem',
                                        background: 'var(--bg-main)', border: '1px solid var(--border)',
                                        borderRadius: '20px', cursor: 'pointer', color: 'var(--text-secondary)'
                                    }}
                                >
                                    {hint}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} style={{
                        display: 'flex',
                        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                    }}>
                        <div style={{
                            maxWidth: '85%',
                            padding: '0.65rem 0.9rem',
                            borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                            background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-main)',
                            color: msg.role === 'user' ? '#fff' : 'var(--text-main)',
                            fontSize: '0.875rem',
                            lineHeight: 1.55,
                            border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                            whiteSpace: 'pre-wrap'
                        }}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                            padding: '0.65rem 1rem',
                            borderRadius: '12px 12px 12px 2px',
                            background: 'var(--bg-main)',
                            border: '1px solid var(--border)',
                            fontSize: '0.875rem',
                            color: 'var(--text-muted)'
                        }}>
                            <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>⏳ Думаю...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
                <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Задай вопрос по стратегии... (Enter — отправить, Shift+Enter — новая строка)"
                    rows={2}
                    disabled={isLoading}
                    style={{
                        flex: 1, resize: 'none', fontSize: '0.875rem',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main)', border: '1px solid var(--border)',
                        borderRadius: '8px', color: 'var(--text-main)',
                        fontFamily: 'inherit', lineHeight: 1.45,
                        boxSizing: 'border-box'
                    }}
                />
                <button
                    onClick={sendMessage}
                    disabled={isLoading || !input.trim()}
                    style={{
                        padding: '0 1rem',
                        background: 'var(--primary)', color: '#fff',
                        border: 'none', borderRadius: '8px',
                        cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
                        opacity: isLoading || !input.trim() ? 0.5 : 1,
                        fontSize: '1.1rem',
                        flexShrink: 0
                    }}
                    title="Отправить"
                >
                    ➤
                </button>
            </div>
        </div>
    )
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

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
        onError: (err: any) => alert(`Planning failed: ${err.message}`)
    })

    const createQuarter = useMutation({
        mutationFn: (data: { goalHint: string; startDate?: string }) =>
            api.post('/api/v2/plan-quarter', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_quarters'] })
            setShowCreateQuarter(false)
            setQGoalHint('')
            setQStartDate('')
        },
        onError: (err: any) => alert(`Quarter Planning failed: ${err.message}`)
    })

    const runSweep = useMutation({
        mutationFn: () => api.post('/api/v2/factory-sweep', {}),
        onSuccess: (data: any) => alert(`Sweep completed! Processed: ${data.processed} items.`),
        onError: (err: any) => alert(`Sweep failed: ${err.message}`)
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
            {/* Header */}
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

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
                {(['quarters', 'weeks'] as const).map(tab => (
                    <button
                        key={tab}
                        style={{
                            background: 'none', border: 'none', padding: '10px 20px', cursor: 'pointer',
                            borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                            color: activeTab === tab ? 'var(--primary)' : 'var(--text-main)'
                        }}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'quarters' ? 'Quarter Strategy (Top-Down)' : 'Tactical Weeks'}
                    </button>
                ))}
            </div>

            {/* Create Quarter form */}
            {showCreateQuarter && activeTab === 'quarters' && (
                <div className="card mb-3" style={{ border: '2px solid var(--primary)' }}>
                    <h3>Plan Quarter (QSP › MTA › SMO)</h3>
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
                            <input type="date" value={qStartDate} onChange={e => setQStartDate(e.target.value)} />
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

            {/* Create Week form */}
            {showCreate && activeTab === 'weeks' && (
                <div className="card mb-3" style={{ border: '2px solid var(--primary)' }}>
                    <h3>Plan Week (SMO › DA › NCC)</h3>
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
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
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

            {/* WEEKS TAB */}
            {activeTab === 'weeks' && (
                <div className="grid grid-2">
                    {weeks?.map(wp => (
                        <Link key={wp.id} to={`/v2/weeks/${wp.id}`} style={{ textDecoration: 'none' }}>
                            <div className="card" style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
                                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}>
                                <div className="flex-between mb-1">
                                    <h3 style={{ margin: 0 }}>{wp.theme}</h3>
                                    <span className={`badge badge-${wp.approval_status}`}>{wp.approval_status.toUpperCase()}</span>
                                </div>
                                <p className="text-muted mb-2" style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>{wp.core_thesis}</p>
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

            {/* QUARTERS TAB */}
            {activeTab === 'quarters' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
                    {/* Left: Quarter cards */}
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

                        {quarters && quarters.length === 0 && !showCreateQuarter && (
                            <div className="card text-center text-muted" style={{ padding: '3rem' }}>
                                No strategic quarters planned yet. Click '+ Plan Strategic Quarter' to build your 3-month strategy.
                            </div>
                        )}
                    </div>

                    {/* Right: Strategy Assistant Chat */}
                    <div style={{ position: 'sticky', top: '1rem' }}>
                        <StrategyChat />
                    </div>
                </div>
            )}
        </div>
    )
}
