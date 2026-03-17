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
            <div className="flex-1 flex items-center justify-center bg-surface p-12">
                <div className="glass-panel p-12 rounded-[3rem] text-center border border-primary/10 max-w-lg">
                    <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-6">
                        <span className="material-symbols-outlined text-4xl">inventory_2</span>
                    </div>
                    <h2 className="text-2xl font-headline font-black text-on-surface mb-2">No Active Stream</h2>
                    <p className="text-on-surface-variant font-body">Connect a project node to initialize the weekly content architecture.</p>
                </div>
            </div>
        )
    }

    if (isLoading) return (
        <div className="flex-1 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
        </div>
    )

    if (error) return (
        <div className="flex-1 flex items-center justify-center p-12">
             <div className="glass-panel p-12 rounded-[3rem] text-center border border-error/20">
                <span className="material-symbols-outlined text-4xl text-error mb-4">error</span>
                <p className="text-on-surface font-bold">{(error as Error).message}</p>
             </div>
        </div>
    )

    const now = new Date()
    now.setHours(0, 0, 0, 0)

    let activeWeek: Week | null = null
    const futureWeeks: Week[] = []
    const pastWeeks: Week[] = []

    if (weeks) {
        const sortedWeeks = [...weeks].sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime())
        sortedWeeks.forEach(week => {
            const start = new Date(week.week_start)
            const end = new Date(week.week_end)
            end.setHours(23, 59, 59, 999)
            if (now >= start && now <= end) activeWeek = week
            else if (start > now) futureWeeks.push(week)
            else pastWeeks.push(week)
        })
    }
    pastWeeks.sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime())

    const WeekCard = ({ week, isActive = false }: { week: Week, isActive?: boolean }) => (
        <Link key={week.id} to={`/weeks/${week.id}`} className="block group">
            <div className={`relative p-8 rounded-[2.5rem] border transition-all duration-500 overflow-hidden ${
                isActive 
                ? 'bg-white border-primary shadow-2xl shadow-primary/10 scale-[1.02]' 
                : 'bg-white border-outline-variant/10 hover:border-primary/30 hover:shadow-xl'
            }`}>
                {isActive && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
                )}
                
                <div className="flex justify-between items-start mb-6">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary/60 mb-1">
                            {isActive ? 'Current Deployment' : 'Node Period'}
                        </span>
                        <h3 className="text-xl font-headline font-black text-on-surface group-hover:text-primary transition-colors leading-tight">
                            {week.theme}
                        </h3>
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        week.status === 'approved' ? 'bg-success text-white' : 'bg-surface-container-high text-on-surface-variant'
                    }`}>
                        {week.status}
                    </span>
                </div>

                <div className="flex items-center gap-6 text-on-surface-variant">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-lg opacity-40">calendar_today</span>
                        <span className="text-xs font-bold">{format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d')}</span>
                    </div>
                    {week._count && (
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-lg opacity-40">sticky_note_2</span>
                            <span className="text-xs font-bold">{week._count.posts} Items</span>
                        </div>
                    )}
                </div>

                <div className="mt-8 flex items-center justify-between">
                    <div className="flex -space-x-2">
                         {[1,2,3].map(i => (
                             <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-surface-container-high"></div>
                         ))}
                    </div>
                    <span className="material-symbols-outlined text-primary opacity-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all">arrow_forward</span>
                </div>
            </div>
        </Link>
    )

    return (
        <div className="flex-1 w-full p-8 lg:p-12 space-y-12 max-h-full overflow-y-auto scrollbar-hide pb-32">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-headline font-black tracking-tight text-on-surface">Content Architecture</h1>
                    <p className="text-on-surface-variant font-body mt-2">Manage your tactical weekly packages and deployments.</p>
                </div>
                <button 
                    onClick={() => setShowCreate(!showCreate)}
                    className="bg-primary text-white px-8 py-4 rounded-2xl font-black text-sm shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                    <span className="material-symbols-outlined">{showCreate ? 'close' : 'add'}</span>
                    {showCreate ? 'ABORT' : 'INITIATE WEEK'}
                </button>
            </div>

            {showCreate && (
                <div className="glass-panel p-8 rounded-[3rem] border border-primary/20 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg">
                            <span className="material-symbols-outlined text-xl">rocket_launch</span>
                        </div>
                        <h2 className="text-xl font-headline font-black">Design New Deployment</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 ml-2 text-on-surface">Strategic Theme</label>
                            <input
                                value={theme}
                                onChange={(e) => setTheme(e.target.value)}
                                className="w-full bg-surface-container-low border-none rounded-2xl py-4 px-6 text-sm font-bold focus:ring-4 focus:ring-primary/10 transition-all"
                                placeholder="e.g., Scaling Engineering Culture"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary/60 ml-2">Node Activation Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full bg-surface-container-low border-none rounded-2xl py-4 px-6 text-sm font-bold focus:ring-4 focus:ring-primary/10 transition-all"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end pt-4">
                        <button
                            onClick={() => createWeek.mutate({ theme, startDate: startDate || undefined })}
                            disabled={!theme || createWeek.isPending}
                            className="btn-primary px-10 py-4 shadow-lg"
                        >
                            {createWeek.isPending ? 'PROCESSING...' : 'INITIALIZE DEPLOYMENT'}
                        </button>
                    </div>
                </div>
            )}

            {/* Content Sections */}
            <div className="space-y-16">
                {activeWeek && (
                    <section className="space-y-6">
                        <div className="flex items-center gap-4 px-4">
                            <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-on-surface/40">Active Deployment</h2>
                        </div>
                        <WeekCard week={activeWeek} isActive={true} />
                    </section>
                )}

                {futureWeeks.length > 0 && (
                    <section className="space-y-6">
                        <div className="flex items-center gap-4 px-4">
                            <span className="w-2 h-2 bg-primary/40 rounded-full"></span>
                            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-on-surface/40">Upcoming Nodes</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            {futureWeeks.map(week => <WeekCard key={week.id} week={week} />)}
                        </div>
                    </section>
                )}

                {pastWeeks.length > 0 && (
                    <section className="space-y-6">
                        <details className="group">
                            <summary className="list-none flex items-center gap-4 px-4 cursor-pointer">
                                <span className="material-symbols-outlined text-lg text-on-surface/20 group-open:rotate-180 transition-transform">keyboard_arrow_down</span>
                                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-on-surface/40">Legacy Archives ({pastWeeks.length})</h2>
                            </summary>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 pt-6">
                                {pastWeeks.map(week => <WeekCard key={week.id} week={week} />)}
                            </div>
                        </details>
                    </section>
                )}
            </div>
        </div>
    )
}
