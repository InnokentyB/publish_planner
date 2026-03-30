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
        <div className="flex flex-col h-[600px] rounded-3xl overflow-hidden glass-panel border border-outline-variant/10 shadow-2xl">
            {/* Header */}
            <div className="px-6 py-5 border-b border-outline-variant/10 flex justify-between items-center bg-white/10 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full ai-gradient flex items-center justify-center text-white shadow-lg shadow-primary/20">
                        <span className="material-symbols-outlined text-xl">psychology</span>
                    </div>
                    <div>
                        <div className="font-headline font-bold text-sm tracking-tight text-on-surface">Strategy Assistant</div>
                        <div className="text-[10px] uppercase tracking-widest font-bold text-primary/60">Live Intelligence</div>
                    </div>
                </div>
                <div className="flex gap-2">
                    {messages.length > 0 && (
                        <button 
                            onClick={() => setMessages([])}
                            className="p-2 hover:bg-white/20 rounded-full transition-colors text-on-surface-variant"
                        >
                            <span className="material-symbols-outlined text-lg">delete_sweep</span>
                        </button>
                    )}
                    <button 
                        onClick={() => setShowPromptEditor(!showPromptEditor)}
                        className={`p-2 rounded-full transition-colors ${showPromptEditor ? 'bg-primary text-white' : 'hover:bg-white/20 text-on-surface-variant'}`}
                    >
                        <span className="material-symbols-outlined text-lg">settings</span>
                    </button>
                </div>
            </div>

            {/* System prompt editor */}
            {showPromptEditor && (
                <div className="p-4 bg-primary-container/20 border-b border-outline-variant/10 animate-in slide-in-from-top duration-300">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2 block">System Directive</label>
                    <textarea
                        value={systemPrompt}
                        onChange={e => setSystemPrompt(e.target.value)}
                        rows={5}
                        className="w-full bg-white/50 border-outline-variant/20 rounded-xl text-xs font-body p-3 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                    />
                    <div className="flex justify-end gap-2 mt-3">
                        <button 
                            onClick={savePrompt}
                            disabled={isSavingPrompt}
                            className="bg-primary text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
                        >
                            {isSavingPrompt ? 'Saving...' : 'Deploy Directive'}
                        </button>
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center px-8 space-y-4">
                        <div className="w-16 h-16 rounded-3xl ai-gradient flex items-center justify-center text-white text-3xl shadow-2xl rotate-3">
                            <span className="material-symbols-outlined text-3xl">auto_awesome</span>
                        </div>
                        <h3 className="font-headline font-black text-xl text-on-surface">How can I help you scale?</h3>
                        <p className="text-sm text-on-surface-variant leading-relaxed">I have full access to your 3-month strategy and target audience profiles.</p>
                        <div className="flex flex-wrap justify-center gap-2 pt-4">
                            {['Improve my hooks', 'Content gaps?', 'Audit strategy', 'Engagement ideas'].map(hint => (
                                <button 
                                    key={hint}
                                    onClick={() => setInput(hint)}
                                    className="px-4 py-2 bg-white/60 hover:bg-white rounded-full text-xs font-bold text-primary shadow-sm border border-primary/5 transition-all"
                                >
                                    {hint}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start underline-none'}`}>
                        <div className={`max-w-[85%] px-5 py-4 rounded-3xl text-sm leading-relaxed shadow-sm ${
                            msg.role === 'user' 
                                ? 'bg-primary text-white rounded-tr-none font-medium' 
                                : 'bg-white rounded-tl-none border border-outline-variant/10 text-on-surface'
                        }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white px-5 py-4 rounded-3xl rounded-tl-none border border-outline-variant/10 text-xs text-primary font-bold flex items-center gap-2 shadow-sm">
                            <div className="flex gap-1">
                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></span>
                            </div>
                            <span>Analyzing Strategy...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white/30 backdrop-blur-md border-t border-outline-variant/10">
                <div className="relative group">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                        placeholder="Message AI..."
                        rows={1}
                        disabled={isLoading}
                        className="w-full bg-white border-2 border-transparent focus:border-primary/20 rounded-2xl py-4 pl-5 pr-14 text-sm font-medium transition-all shadow-lg outline-none resize-none"
                    />
                    <button 
                        onClick={sendMessage}
                        disabled={isLoading || !input.trim()}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 ai-gradient text-white rounded-xl flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-30"
                    >
                        <span className="material-symbols-outlined">send</span>
                    </button>
                </div>
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
    const [selectedChannels, setSelectedChannels] = useState<Record<number, string>>({})

    const { data: weeks, isLoading: loadingWeeks, error: errorWeeks } = useQuery<WeekPackage[]>({
        queryKey: ['v2_weeks', currentProject?.id],
        queryFn: () => api.get('/api/v2/weeks'),
        enabled: !!currentProject && activeTab === 'weeks'
    })

    const { data: quarters, isLoading: loadingQuarters, error: errorQuarters } = useQuery<QuarterPlan[]>({
        queryKey: ['v2_quarters', currentProject?.id],
        queryFn: () => api.get('/api/v2/quarters'),
        enabled: !!currentProject && activeTab === 'quarters'
    })

    const { data: projectData } = useQuery({
        queryKey: ['project', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject && showCreateQuarter
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
        mutationFn: (data: { goalHint: string; startDate?: string; plannedChannels?: any }) =>
            api.post('/api/v2/plan-quarter', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_quarters'] })
            setShowCreateQuarter(false)
            setQGoalHint('')
            setQStartDate('')
            setSelectedChannels({})
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
            <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="max-w-md w-full glass-panel p-12 text-center rounded-[3rem] border border-outline-variant/10 shadow-3xl animate-in zoom-in duration-500">
                    <div className="w-24 h-24 bg-surface-container-high rounded-3xl mx-auto mb-8 flex items-center justify-center text-primary/30">
                        <span className="material-symbols-outlined text-5xl">folder_off</span>
                    </div>
                    <h2 className="text-3xl font-headline font-black text-on-surface mb-4">Space is Empty</h2>
                    <p className="text-on-surface-variant mb-10 leading-relaxed font-body">Select a project from the sidebar to initialize your cognitive workspace.</p>
                    <button className="w-full ai-gradient text-white font-bold py-5 rounded-2xl shadow-xl hover:opacity-90 transition-opacity">
                        Connect Project
                    </button>
                </div>
            </div>
        )
    }

    const activeLoading = activeTab === 'weeks' ? loadingWeeks : loadingQuarters;
    const activeError = activeTab === 'weeks' ? errorWeeks : errorQuarters;

    if (activeLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-surface">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
                    <p className="font-label text-xs uppercase tracking-widest text-primary font-bold">Synchronizing Node...</p>
                </div>
            </div>
        )
    }

    if (activeError) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="max-w-md w-full glass-panel p-12 text-center rounded-[3rem] border border-error/20 shadow-3xl animate-in zoom-in duration-500">
                    <div className="w-24 h-24 bg-error/10 text-error rounded-3xl mx-auto mb-8 flex items-center justify-center">
                        <span className="material-symbols-outlined text-5xl">warning</span>
                    </div>
                    <h2 className="text-2xl font-headline font-black text-on-surface mb-2">Synchronization Failed</h2>
                    <p className="text-on-surface-variant mb-10 leading-relaxed font-body text-sm">
                        {(activeError as any)?.message || 'Unable to connect to the intelligence layer. Please try again later.'}
                    </p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="w-full bg-error text-white font-bold py-4 rounded-2xl shadow-xl hover:opacity-90 transition-opacity"
                    >
                        Reboot Node
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 w-full p-8 max-h-full overflow-y-auto space-y-10 scrollbar-hide">
            {/* Page Header */}
            <div className="flex justify-between items-end">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest rounded-full">Orchestrator V2</span>
                        <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                    </div>
                    <h1 className="text-4xl font-headline font-black tracking-tight text-on-surface">Factory Matrix</h1>
                    <p className="text-on-surface-variant font-body mt-2">Scale your knowledge across every platform in 1-click.</p>
                </div>
                <div className="flex gap-4">
                    <button 
                        onClick={() => runSweep.mutate()} 
                        className="flex items-center gap-2 bg-surface-container-high hover:bg-surface-container-highest px-6 py-3 rounded-2xl font-bold text-sm transition-colors"
                    >
                        <span className="material-symbols-outlined text-lg">cyclone</span>
                        {runSweep.isPending ? 'Processing...' : 'Run Sweep'}
                    </button>
                    {activeTab === 'weeks' ? (
                        <button 
                            onClick={() => setShowCreate(!showCreate)}
                            className="flex items-center gap-2 ai-gradient text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                        >
                            <span className="material-symbols-outlined">add</span>
                            <span>Tactical Week</span>
                        </button>
                    ) : (
                        <button 
                            onClick={() => setShowCreateQuarter(!showCreateQuarter)}
                            className="flex items-center gap-2 ai-gradient text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                        >
                            <span className="material-symbols-outlined">auto_awesome</span>
                            <span>Strategic Quarter</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Matrix Tabs */}
            <div className="flex gap-2 p-1.5 bg-surface-container-high/50 rounded-2xl w-fit">
                {(['quarters', 'weeks'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-8 py-3 rounded-xl font-bold text-sm transition-all ${
                            activeTab === tab 
                                ? 'bg-white text-primary shadow-sm' 
                                : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                    >
                        {tab === 'quarters' ? 'Quarter Architecture' : 'Tactical Execution'}
                    </button>
                ))}
            </div>

            {/* Creation Panels */}
            {showCreateQuarter && activeTab === 'quarters' && (
                <div className="p-8 rounded-[2rem] bg-surface-container border-2 border-primary/20 shadow-xl animate-in slide-in-from-top-4 duration-500">
                    <div className="max-w-2xl mx-auto space-y-6">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white">
                                <span className="material-symbols-outlined">architecture</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-headline font-black">Plan Strategic Quarter</h3>
                                <p className="text-sm text-on-surface-variant">Architecture through QSP › MTA › SMO frameworks</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-primary ml-1">Global Project Goal</label>
                                <input
                                    type="text"
                                    value={qGoalHint}
                                    onChange={e => setQGoalHint(e.target.value)}
                                    placeholder="e.g. Lead generation for SEO tool"
                                    className="w-full bg-white border-none rounded-xl py-4 px-5 text-sm shadow-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-primary ml-1">Quarter Start</label>
                                <input 
                                    type="date" 
                                    value={qStartDate} 
                                    onChange={e => setQStartDate(e.target.value)} 
                                    className="w-full bg-white border-none rounded-xl py-4 px-5 text-sm shadow-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                />
                            </div>
                        </div>
                        <div className="space-y-4">
                            <label className="text-xs font-bold uppercase tracking-widest text-primary ml-1">Plan for Channels</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {projectData?.channels?.map((ch: any) => (
                                    <div key={ch.id} className="flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm border border-outline-variant/10">
                                        <input
                                            type="checkbox"
                                            checked={!!selectedChannels[ch.id]}
                                            onChange={(e) => {
                                                const newSelected = { ...selectedChannels };
                                                if (e.target.checked) newSelected[ch.id] = 'value'; // Default role
                                                else delete newSelected[ch.id];
                                                setSelectedChannels(newSelected);
                                            }}
                                            className="w-5 h-5 rounded border-outline-variant text-primary focus:ring-primary/20"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold truncate">{ch.name}</div>
                                            <div className="text-[10px] text-on-surface-variant uppercase font-black">{ch.type}</div>
                                        </div>
                                        {selectedChannels[ch.id] && (
                                            <select
                                                value={selectedChannels[ch.id]}
                                                onChange={(e) => setSelectedChannels({ ...selectedChannels, [ch.id]: e.target.value })}
                                                className="bg-surface-container-high border-none rounded-lg py-1 px-2 text-[10px] font-bold uppercase tracking-widest focus:ring-1 focus:ring-primary/20 transition-all outline-none"
                                            >
                                                <option value="onboarding">Onboarding</option>
                                                <option value="sales">Sales</option>
                                                <option value="value">Value</option>
                                                <option value="hybrid">Hybrid</option>
                                            </select>
                                        )}
                                    </div>
                                ))}
                                {(!projectData?.channels || projectData.channels.length === 0) && (
                                    <p className="col-span-full text-xs text-on-surface-variant italic p-4 text-center">No channels connected. Please add channels in Settings first.</p>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={() => createQuarter.mutate({ 
                                goalHint: qGoalHint, 
                                startDate: qStartDate || undefined,
                                plannedChannels: selectedChannels
                            })}
                            disabled={createQuarter.isPending}
                            className="w-full ai-gradient text-white font-black py-5 rounded-2xl shadow-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                        >
                            {createQuarter.isPending ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    <span>Simulating 3 Months of Content...</span>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined">bolt</span>
                                    <span>Assemble Full Quarter Strategy</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {showCreate && activeTab === 'weeks' && (
                <div className="p-8 rounded-[2rem] bg-surface-container border-2 border-primary/20 shadow-xl animate-in slide-in-from-top-4 duration-500">
                    <div className="max-w-2xl mx-auto space-y-6">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white">
                                <span className="material-symbols-outlined">event_upcoming</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-headline font-black">Generate Tactical Week</h3>
                                <p className="text-sm text-on-surface-variant">Detailed mapping using SMO › DA › NCC flows</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-primary ml-1">Theme / Focus</label>
                                <input
                                    type="text"
                                    value={themeHint}
                                    onChange={e => setThemeHint(e.target.value)}
                                    placeholder="e.g. Case studies & social proof"
                                    className="w-full bg-white border-none rounded-xl py-4 px-5 text-sm shadow-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-primary ml-1">Week Monday</label>
                                <input 
                                    type="date" 
                                    value={startDate} 
                                    onChange={e => setStartDate(e.target.value)} 
                                    className="w-full bg-white border-none rounded-xl py-4 px-5 text-sm shadow-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                />
                            </div>
                        </div>
                        <button
                            onClick={() => createWeek.mutate({ themeHint, startDate: startDate || undefined })}
                            disabled={createWeek.isPending}
                            className="w-full ai-gradient text-white font-black py-5 rounded-2xl shadow-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                        >
                            {createWeek.isPending ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    <span>Planning Strategic Topics...</span>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined">insights</span>
                                    <span>Plan Tactical Week</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Matrix Content */}
            {activeTab === 'weeks' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {weeks?.map(wp => (
                        <Link key={wp.id} to={`/v2/weeks/${wp.id}`} className="group transition-transform hover:-translate-y-2 active:scale-95 duration-300">
                            <div className="bg-white p-8 rounded-[2.5rem] border border-outline-variant/10 shadow-sm hover:shadow-2xl hover:border-primary/20 transition-all h-full flex flex-col">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="w-12 h-12 bg-primary-fixed text-primary rounded-2xl flex items-center justify-center font-black group-hover:scale-110 transition-transform">
                                        W{format(new Date(wp.week_start), 'w')}
                                    </div>
                                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter shadow-sm  ${
                                        wp.approval_status === 'approved' 
                                            ? 'bg-success text-white shadow-success/20' 
                                            : wp.approval_status === 'generating' 
                                                ? 'bg-primary text-white shadow-primary/20' 
                                                : 'bg-surface-container-high text-on-surface-variant'
                                    }`}>
                                        {wp.approval_status}
                                    </span>
                                </div>
                                <h3 className="text-xl font-headline font-black mb-3 text-on-surface leading-tight">{wp.theme}</h3>
                                <p className="text-sm text-on-surface-variant font-body line-clamp-3 mb-8 leading-relaxed italic border-l-4 border-primary/10 pl-4">{wp.core_thesis}</p>
                                <div className="mt-auto pt-6 border-t border-outline-variant/5 flex justify-between items-center text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">schedule</span>
                                        <span>{format(new Date(wp.week_start), 'MMM d')} - {format(new Date(wp.week_end), 'MMM d')}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">view_timeline</span>
                                        <span>{wp._count?.content_items || 0} Items</span>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                    {weeks && weeks.length === 0 && (
                        <div className="col-span-full py-24 text-center glass-panel rounded-[3rem] border-dashed border-2 border-outline-variant/20">
                            <div className="text-4xl mb-4 opacity-30">🕳️</div>
                            <h4 className="text-xl font-headline font-black text-on-surface/40">No tactical deployment found</h4>
                            <p className="text-on-surface-variant/40 mt-1">Start by generating your first week plan.</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'quarters' && (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-10 items-start pb-20">
                    {/* Architecture Feed */}
                    <div className="space-y-12">
                        {quarters?.map(q => (
                            <div key={q.id} className="relative pl-12">
                                {/* Timeline line */}
                                <div className="absolute left-[23px] top-6 bottom-[-48px] w-1 bg-surface-container-highest/50 rounded-full"></div>
                                <div className="absolute left-0 top-0 w-12 h-12 rounded-full bg-white border-4 border-surface-container-highest flex items-center justify-center z-10 shadow-sm">
                                    <span className="material-symbols-outlined text-primary text-xl font-black">rocket_launch</span>
                                </div>
                                
                                <div className="bg-white p-10 rounded-[3rem] border border-outline-variant/10 shadow-sm">
                                    <div className="flex justify-between items-start mb-8">
                                        <div>
                                            <h2 className="text-2xl font-headline font-black tracking-tight mb-1">
                                                {format(new Date(q.quarter_start), 'MMM yyyy')} — Quarter Scale
                                            </h2>
                                            <p className="text-on-surface-variant text-sm font-medium">{format(new Date(q.quarter_start), 'MMMM do')} to {format(new Date(q.quarter_end), 'MMMM do, yyyy')}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="px-4 py-2 bg-primary-fixed text-primary text-[10px] font-black uppercase tracking-widest rounded-xl">Strategic Phase</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                                        <div className="space-y-1 p-5 rounded-2xl bg-surface-container-low border border-outline-variant/5">
                                            <span className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1">North Star Goal</span>
                                            <p className="text-sm font-bold leading-relaxed">{q.strategic_goal}</p>
                                        </div>
                                        <div className="space-y-1 p-5 rounded-2xl bg-surface-container-low border border-outline-variant/5">
                                            <span className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1">Primary Content Pillar</span>
                                            <p className="text-sm font-bold leading-relaxed">{q.primary_pillar}</p>
                                        </div>
                                    </div>

                                    <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide">
                                        {q.month_arcs.map((m, i) => (
                                            <div key={m.id} className="min-w-[320px] bg-surface-container-low/50 rounded-[2rem] p-6 border border-outline-variant/5 hover:border-primary/20 transition-all group">
                                                <div className="flex items-center gap-3 mb-5">
                                                    <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center font-black text-xs shadow-sm text-primary group-hover:scale-110 transition-transform">
                                                        M{i + 1}
                                                    </div>
                                                    <h4 className="font-headline font-black uppercase tracking-tight text-sm">{format(new Date(m.month), 'MMMM')} Arc</h4>
                                                </div>
                                                <div className="space-y-4">
                                                    <div>
                                                        <span className="text-[9px] font-bold uppercase text-primary/50 tracking-widest block mb-1">Theme</span>
                                                        <p className="text-xs font-black text-on-surface line-clamp-1">{m.arc_theme}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-[9px] font-bold uppercase text-primary/50 tracking-widest block mb-1">Core Narrative</span>
                                                        <p className="text-xs font-body text-on-surface-variant line-clamp-3 leading-relaxed">{m.arc_thesis}</p>
                                                    </div>
                                                    <div className="pt-4 border-t border-outline-variant/5">
                                                        <span className="text-[9px] font-bold uppercase text-primary/50 tracking-widest block mb-4">Deployment Trace</span>
                                                        <div className="space-y-2">
                                                            {m.week_packages.map(wp => (
                                                                <Link 
                                                                    key={wp.id} 
                                                                    to={`/v2/weeks/${wp.id}`} 
                                                                    className="flex items-center justify-between p-3 bg-white rounded-xl border border-outline-variant/5 hover:border-primary/20 hover:shadow-sm transition-all text-[11px] font-bold text-on-surface"
                                                                >
                                                                    <span className="truncate pr-4 leading-none">{wp.theme}</span>
                                                                    <span className="material-symbols-outlined text-primary text-xs shrink-0">arrow_forward</span>
                                                                </Link>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {quarters && quarters.length === 0 && (
                            <div className="py-24 text-center glass-panel rounded-[3rem] border-dashed border-2 border-outline-variant/20 ml-12">
                                <div className="text-4xl mb-4 opacity-30">🏗️</div>
                                <h4 className="text-xl font-headline font-black text-on-surface/40">Blueprint Matrix Empty</h4>
                                <p className="text-on-surface-variant/40 mt-1">Architecture your next 3 months with a single prompt.</p>
                            </div>
                        )}
                    </div>

                    {/* Matrix AI Sideboard */}
                    <div className="sticky top-10 space-y-6">
                        <StrategyChat />
                        
                        <div className="bg-primary text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
                           <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
                           <h4 className="text-xl font-headline font-black mb-2 relative z-10">Usage Metrics</h4>
                           <p className="text-white/60 text-xs font-medium mb-6 relative z-10">Your engine is performing above target thresholds.</p>
                           <div className="space-y-4 relative z-10">
                              {[
                                { label: 'Token Efficiency', value: '98.2%' },
                                { label: 'Agent Uptime', value: '100%' },
                                { label: 'Content Relevancy', value: 'Auto-Optimizing' }
                              ].map(m => (
                                <div key={m.label} className="flex justify-between items-center py-2 border-b border-white/10 last:border-0 text-[11px] font-bold uppercase tracking-widest">
                                    <span className="text-white/40">{m.label}</span>
                                    <span>{m.value}</span>
                                </div>
                              ))}
                           </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
