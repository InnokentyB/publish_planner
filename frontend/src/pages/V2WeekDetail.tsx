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
        mutationFn: () => api.post(`/api/v2/approve-week/${id}`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_week', id] })
            queryClient.invalidateQueries({ queryKey: ['v2_weeks'] })
        }
    })

    const architectWeek = useMutation({
        mutationFn: () => api.post(`/api/v2/architect-week/${id}`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['v2_week', id] })
        },
        onError: (err: any) => alert(`Architecture failed: ${err.message}`)
    })

    if (isLoading) return (
        <div className="flex-1 flex items-center justify-center bg-surface">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
                <p className="font-label text-xs uppercase tracking-widest text-primary font-bold">Synchronizing Pack...</p>
            </div>
        </div>
    )

    if (error || !week) return (
        <div className="flex-1 p-12 flex items-center justify-center">
             <div className="glass-panel p-12 rounded-[3rem] text-center border border-error/20">
                <div className="w-20 h-20 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="material-symbols-outlined text-4xl">warning</span>
                </div>
                <h2 className="text-2xl font-headline font-black text-on-surface mb-2">Week Package Not Found</h2>
                <p className="text-on-surface-variant font-body">
                    {error instanceof Error ? error.message : 'This week package does not exist or you do not have access to it.'}
                </p>
                <p className="text-xs text-on-surface-variant/50 font-mono mt-2">ID: {id}</p>
                <button onClick={() => navigate('/orchestrator')} className="mt-8 btn-primary px-8">Return to Force Matrix</button>
             </div>
        </div>
    )

    return (
        <div className="flex-1 w-full p-8 max-h-full overflow-y-auto space-y-10 scrollbar-hide pb-32">
            {/* Header / Navigation */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-6">
                    <button 
                        onClick={() => navigate('/orchestrator')}
                        className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-all shadow-sm group"
                    >
                        <span className="material-symbols-outlined group-hover:-translate-x-1 transition-transform">arrow_back</span>
                    </button>
                    <div>
                         <div className="flex items-center gap-3 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60">Tactical Package</span>
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${
                                week.approval_status === 'approved' ? 'bg-success text-white' : 'bg-surface-container-high text-on-surface-variant'
                            }`}>
                                {week.approval_status}
                            </span>
                         </div>
                         <h1 className="text-3xl font-headline font-black tracking-tight text-on-surface">{week.theme}</h1>
                    </div>
                </div>
                
                <div className="flex gap-4">
                    {week.content_items?.length === 0 && (
                        <button
                            onClick={() => architectWeek.mutate()}
                            disabled={architectWeek.isPending}
                            className="bg-primary text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined">architecture</span>
                            {architectWeek.isPending ? 'ARCHITECTING...' : 'ARCHITECT DISTRIBUTION'}
                        </button>
                    )}
                    {week.approval_status === 'draft' && week.content_items?.length > 0 && (
                        <button
                            onClick={() => approveWeek.mutate()}
                            disabled={approveWeek.isPending}
                            className="bg-success text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg shadow-success/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined">verified</span>
                            {approveWeek.isPending ? 'DEPLOYING...' : 'DEPOY WEEK PACKAGE'}
                        </button>
                    )}
                    <button className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-on-surface-variant hover:text-primary transition-all shadow-sm">
                        <span className="material-symbols-outlined">share</span>
                    </button>
                </div>
            </div>

            {/* Strategy Hub Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Strategy Context Card */}
                <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border border-outline-variant/10 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-primary-fixed text-primary rounded-2xl flex items-center justify-center">
                            <span className="material-symbols-outlined">ads_click</span>
                        </div>
                        <h3 className="text-xl font-headline font-black">Strategic Intent</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                        <div className="space-y-1 relative">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Core Thesis</span>
                            <p className="text-sm font-medium leading-relaxed italic border-l-4 border-primary/10 pl-4">{week.core_thesis}</p>
                        </div>
                        <div className="space-y-6">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant">
                                    <span className="material-symbols-outlined text-lg">track_changes</span>
                                </div>
                                <div className="flex-1">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 block">Intent Tag</span>
                                    <span className="text-sm font-bold">{week.intent_tag}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant">
                                    <span className="material-symbols-outlined text-lg">groups</span>
                                </div>
                                <div className="flex-1">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 block">Audience Focus</span>
                                    <span className="text-sm font-bold">{week.audience_focus}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-12 pt-10 border-t border-outline-variant/5">
                        <div className="flex items-center gap-4 mb-6">
                            <span className="material-symbols-outlined text-primary">currency_exchange</span>
                            <h4 className="font-headline font-black uppercase tracking-tight text-sm">Monetization Tie-in</h4>
                        </div>
                        <div className="p-6 bg-surface-container-low rounded-2xl border border-outline-variant/5">
                            <p className="text-sm font-medium">{week.monetization_tie}</p>
                        </div>
                    </div>
                </div>

                {/* Narrative Arc Sideboard */}
                <div className="bg-surface-container-low p-10 rounded-[3rem] border border-outline-variant/5 space-y-8 shadow-inner">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-primary shadow-sm border border-outline-variant/5">
                            <span className="material-symbols-outlined">timeline</span>
                        </div>
                        <h3 className="text-xl font-headline font-black">7-Day Arc</h3>
                    </div>

                    <div className="space-y-4">
                        {week.narrative_arc.map((point, i) => (
                            <div key={i} className="flex gap-4 group">
                                <div className="flex flex-col items-center">
                                    <div className="w-8 h-8 rounded-full bg-white border-2 border-primary/20 flex items-center justify-center text-[10px] font-black group-hover:bg-primary group-hover:text-white transition-all z-10 shrink-0">
                                        {i + 1}
                                    </div>
                                    {i < week.narrative_arc.length - 1 && <div className="w-0.5 h-full bg-primary/10 -my-1"></div>}
                                </div>
                                <div className="pb-4">
                                    <p className="text-xs font-bold leading-relaxed text-on-surface group-hover:text-primary transition-colors">{point}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {week.risks_warnings?.length > 0 && (
                        <div className="bg-error/5 border-2 border-error/10 p-6 rounded-[2rem] space-y-4 mt-8 animate-pulse hover:animate-none">
                            <div className="flex items-center gap-3 text-error">
                                <span className="material-symbols-outlined">report</span>
                                <span className="text-xs font-black uppercase tracking-widest">NCC Warnings</span>
                            </div>
                            <ul className="space-y-2">
                                {week.risks_warnings.map((risk, i) => (
                                    <li key={i} className="text-[10px] font-bold text-error flex gap-2">
                                        <span className="mt-1 w-1 h-1 bg-error rounded-full shrink-0"></span>
                                        <span className="leading-relaxed">{risk}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* Execution Roadmap */}
            <div className="space-y-8 pt-10">
                <div className="flex items-end justify-between px-4">
                    <div>
                        <h2 className="text-3xl font-headline font-black tracking-tight">Deployment roadmap</h2>
                        <p className="text-on-surface-variant font-body mt-1">Found {week.content_items?.length || 0} tactical items across 5 layers.</p>
                    </div>
                    <div className="flex gap-2">
                         <span className="w-3 h-3 bg-primary rounded-full"></span>
                         <span className="w-3 h-3 bg-primary/30 rounded-full"></span>
                         <span className="w-3 h-3 bg-primary/10 rounded-full"></span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                    {week.content_items?.map(item => (
                        <div key={item.id} className="group bg-white p-8 rounded-[2.5rem] border border-outline-variant/10 shadow-sm hover:shadow-2xl hover:border-primary/20 transition-all flex flex-col h-full">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex flex-col items-center">
                                     <span className="text-[10px] font-black uppercase tracking-tighter text-primary">{format(new Date(item.schedule_at), 'HH:mm')}</span>
                                     <div className="w-12 h-12 bg-surface-container-low rounded-2xl flex flex-col items-center justify-center mt-1 group-hover:scale-110 transition-transform">
                                         <span className="text-[9px] font-black uppercase opacity-40">{format(new Date(item.schedule_at), 'MMM')}</span>
                                         <span className="text-sm font-black -mt-1">{format(new Date(item.schedule_at), 'd')}</span>
                                     </div>
                                </div>
                                <span className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm  ${
                                    item.status === 'generated' ? 'bg-success text-white shadow-success/20' : 'bg-surface-container-high text-on-surface-variant'
                                }`}>
                                    {item.status}
                                </span>
                            </div>

                            <div className="flex-1 space-y-4">
                                <div>
                                    <div className="flex items-baseline gap-2 mb-1">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-primary/40">{item.layer}</span>
                                        <span className="w-1 h-1 bg-outline-variant rounded-full"></span>
                                        <span className="text-[10px] font-bold text-on-surface-variant">{item.type}</span>
                                    </div>
                                    <h3 className="text-lg font-headline font-black leading-tight group-hover:text-primary transition-colors">{item.title}</h3>
                                </div>
                                <p className="text-xs text-on-surface-variant font-body line-clamp-3 leading-relaxed">{item.context_brief}</p>
                            </div>

                            <button
                                onClick={() => navigate(`/posts/${item.id}`)}
                                className="mt-8 flex items-center justify-center gap-2 w-full py-4 bg-surface-container-low hover:bg-primary hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                            >
                                {item.status === 'generated' ? 'Audit content' : 'Sync node'}
                                <span className="material-symbols-outlined text-sm">rocket_launch</span>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
