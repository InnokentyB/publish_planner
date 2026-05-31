import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, projectsApi, publicationTasksApi } from '../api'
import { useAuth } from '../context/AuthContext'

type JsonRecord = Record<string, any>

type SocialChannel = {
    id: number
    type: string
    name: string
    config?: JsonRecord | null
    is_active?: boolean
}

type ProjectDetails = {
    id: number
    name: string
    description?: string | null
    channels: SocialChannel[]
    settings: Array<{ key: string; value: string }>
    _count?: { weeks: number }
}

type PublicationTask = {
    id: number
    type: string
    title?: string | null
    status: string
    brief?: string | null
    schedule_at?: string | null
    published_link?: string | null
    assets?: JsonRecord | null
    quality_report?: JsonRecord | null
    metrics?: JsonRecord | null
    channel?: {
        id: number
        name: string
        type: string
        config?: JsonRecord | null
    } | null
}

const PUBLICATION_PLAN_TEMPLATE = `{
  "meta": {
    "plan_id": "distribution-cycle-2026-05-20",
    "cycle_start": "2026-05-20",
    "cycle_end": "2026-05-31",
    "timezone_default": "Europe/Lisbon"
  },
  "accounts": {},
  "assets": {},
  "actions": []
}`

function channelIcon(type: string) {
    if (type === 'linkedin') return 'work'
    if (type === 'reddit') return 'forum'
    if (type === 'google_search_console') return 'query_stats'
    if (type === 'tilda') return 'web'
    if (type === 'medium') return 'article'
    if (type === 'indiehackers') return 'groups'
    return 'alternate_email'
}

function statusLabel(status: string) {
    return status.replace(/_/g, ' ')
}

export default function ProjectWorkspace() {
    const queryClient = useQueryClient()
    const { currentProject, projects, createProject, setCurrentProject } = useAuth()

    const [showPlanModal, setShowPlanModal] = useState(false)
    const [planJson, setPlanJson] = useState(PUBLICATION_PLAN_TEMPLATE)
    const [planMessage, setPlanMessage] = useState<string | null>(null)

    const { data: projectData } = useQuery<ProjectDetails>({
        queryKey: ['project_workspace', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject
    })

    const { data: publicationTasks } = useQuery<PublicationTask[]>({
        queryKey: ['project_workspace_tasks', currentProject?.id],
        queryFn: () => publicationTasksApi.list({ manualOnly: false }),
        enabled: !!currentProject
    })

    const projectMeta = useMemo(() => {
        const map = Object.fromEntries((projectData?.settings || []).map((setting) => [setting.key, setting.value]))
        return {
            planId: map.publication_plan_id || null,
            planMeta: map.publication_plan_meta ? JSON.parse(map.publication_plan_meta) : null
        }
    }, [projectData?.settings])

    const importPlan = useMutation({
        mutationFn: () => projectsApi.importPublicationPlan(planJson),
        onSuccess: (result: any) => {
            const project = result?.project
            const imported = result?.imported
            setPlanMessage(`Plan synced: ${imported?.actions || 0} actions, ${imported?.accounts || 0} channels, ${imported?.updatedExistingProject ? 'existing project updated' : 'new project created'}.`)

            if (project) {
                const existingProject = projects.find((entry) => entry.id === project.id)
                if (existingProject) {
                    setCurrentProject(existingProject)
                } else {
                    createProject({ id: project.id, name: project.name })
                }
            }

            queryClient.invalidateQueries({ queryKey: ['project_workspace'] })
            queryClient.invalidateQueries({ queryKey: ['project_workspace_tasks'] })
            queryClient.invalidateQueries({ queryKey: ['publication_tasks'] })
        }
    })

    const taskTotals = useMemo(() => {
        const tasks = publicationTasks || []
        const now = Date.now()

        return {
            total: tasks.length,
            published: tasks.filter((task) => task.status === 'published').length,
            overdue: tasks.filter((task) => {
                if (!task.schedule_at) return false
                return ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(task.status)
                    && new Date(task.schedule_at).getTime() < now
            }).length,
            deferred: tasks.filter((task) => task.status === 'deferred').length,
            byStatus: tasks.reduce<Record<string, number>>((acc, task) => {
                acc[task.status] = (acc[task.status] || 0) + 1
                return acc
            }, {})
        }
    }, [publicationTasks])

    const channelCards = useMemo(() => {
        const tasks = publicationTasks || []
        return (projectData?.channels || []).map((channel) => {
            const channelTasks = tasks.filter((task) => task.channel?.id === channel.id)
            const published = channelTasks.filter((task) => task.status === 'published').length
            const overdue = channelTasks.filter((task) => {
                if (!task.schedule_at) return false
                return ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(task.status)
                    && new Date(task.schedule_at).getTime() < Date.now()
            }).length

            return {
                ...channel,
                taskCount: channelTasks.length,
                published,
                overdue,
                nextTask: channelTasks.find((task) => task.status !== 'published') || channelTasks[0] || null
            }
        })
    }, [projectData?.channels, publicationTasks])

    const upcomingTasks = useMemo(() => {
        return [...(publicationTasks || [])]
            .filter((task) => task.schedule_at)
            .sort((left, right) => new Date(left.schedule_at!).getTime() - new Date(right.schedule_at!).getTime())
            .slice(0, 5)
    }, [publicationTasks])

    const recentLiveContent = useMemo(() => {
        return [...(publicationTasks || [])]
            .filter((task) => task.published_link)
            .slice(0, 4)
    }, [publicationTasks])

    if (!currentProject) {
        return (
            <div className="flex-1 w-full p-8 lg:p-10">
                <div className="max-w-5xl mx-auto rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 text-on-surface-variant">
                    Choose a project first to open the workspace.
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 w-full p-8 lg:p-10 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto space-y-8">
                <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 lg:p-10">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
                        <div className="max-w-4xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Project Workspace</div>
                            <h1 className="mt-3 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                {currentProject.name}
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                The project is the primary content network: one publication plan, many channels, shared research inputs, and one execution layer for publishing and analytics.
                            </p>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {projectData?.channels?.length || 0} channels
                                </span>
                                <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {taskTotals.total} publication tasks
                                </span>
                                {projectMeta.planId && (
                                    <span className="px-3 py-1 rounded-full bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary">
                                        Plan: {projectMeta.planId}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 min-w-[420px]">
                            <button
                                onClick={() => setShowPlanModal(true)}
                                className="rounded-2xl ai-gradient text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all"
                            >
                                Load Plan
                            </button>
                            <Link
                                to="/parsers"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Open Parsers
                            </Link>
                            <Link
                                to="/publication-tasks"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Open Publishing
                            </Link>
                            <Link
                                to="/analytics"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                View Analytics
                            </Link>
                        </div>
                    </div>

                    {planMessage && (
                        <div className="mt-6 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                            {planMessage}
                        </div>
                    )}
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {[
                        { label: 'Published', value: taskTotals.published, tone: 'text-success' },
                        { label: 'Overdue', value: taskTotals.overdue, tone: taskTotals.overdue > 0 ? 'text-error' : 'text-on-surface' },
                        { label: 'Deferred', value: taskTotals.deferred, tone: 'text-yellow-900' },
                        { label: 'Live Statuses', value: Object.keys(taskTotals.byStatus).length, tone: 'text-primary' }
                    ].map((card) => (
                        <div key={card.label} className="rounded-[1.5rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{card.label}</div>
                            <div className={`mt-4 text-4xl font-headline font-black ${card.tone}`}>{card.value}</div>
                        </div>
                    ))}
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Channels</div>
                            <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">Project network</h2>
                            <p className="mt-2 text-sm text-on-surface-variant">
                                Open any channel workspace to manage plan sources, manual uploads, generated drafts, and parser handoffs.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-6">
                            {channelCards.map((channel) => (
                                <Link
                                    key={channel.id}
                                    to={`/channels/${channel.id}`}
                                    className="rounded-[1.5rem] bg-surface-container-low p-5 border border-outline-variant/10 hover:bg-primary/5 transition-all"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-12 h-12 rounded-2xl bg-white text-primary flex items-center justify-center shadow-sm">
                                                <span className="material-symbols-outlined">{channelIcon(channel.type)}</span>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/60">{channel.type}</div>
                                                <div className="mt-2 font-headline font-black text-xl text-on-surface truncate">{channel.name}</div>
                                            </div>
                                        </div>
                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white text-on-surface-variant">
                                            {channel.taskCount} tasks
                                        </span>
                                    </div>

                                    <div className="mt-5 flex flex-wrap gap-2">
                                        <span className="px-3 py-1 rounded-full bg-white text-[10px] font-black uppercase tracking-widest text-success">
                                            {channel.published} published
                                        </span>
                                        {channel.overdue > 0 && (
                                            <span className="px-3 py-1 rounded-full bg-error-container/40 text-[10px] font-black uppercase tracking-widest text-error">
                                                {channel.overdue} overdue
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-5 text-sm text-on-surface-variant leading-7">
                                        {channel.nextTask?.brief
                                            || channel.nextTask?.title
                                            || 'No linked content task yet. Load a plan or add channel content manually.'}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Operational Surfaces</div>
                            <div className="mt-4 grid grid-cols-1 gap-3">
                                <Link to="/parsers" className="rounded-2xl bg-surface-container-low px-4 py-4 hover:bg-primary/5 transition-all">
                                    <div className="font-bold text-on-surface">Parser Lab</div>
                                    <div className="mt-2 text-sm text-on-surface-variant">Set criteria, inspect results, and push signals into channel work.</div>
                                </Link>
                                <Link to="/recipes" className="rounded-2xl bg-surface-container-low px-4 py-4 hover:bg-primary/5 transition-all">
                                    <div className="font-bold text-on-surface">Saved Recipes</div>
                                    <div className="mt-2 text-sm text-on-surface-variant">Reuse parser setups instead of rebuilding discovery queries from scratch.</div>
                                </Link>
                                <Link to="/publication-tasks" className="rounded-2xl bg-surface-container-low px-4 py-4 hover:bg-primary/5 transition-all">
                                    <div className="font-bold text-on-surface">Publishing Console</div>
                                    <div className="mt-2 text-sm text-on-surface-variant">Confirm live URLs, handoffs, comment alerts, and metrics collection.</div>
                                </Link>
                                <Link to="/analytics" className="rounded-2xl bg-surface-container-low px-4 py-4 hover:bg-primary/5 transition-all">
                                    <div className="font-bold text-on-surface">Post-Publication Analytics</div>
                                    <div className="mt-2 text-sm text-on-surface-variant">Review channel performance, missing metrics, and outcome health.</div>
                                </Link>
                            </div>
                        </div>

                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Upcoming Queue</div>
                            <div className="mt-4 space-y-3">
                                {upcomingTasks.length > 0 ? upcomingTasks.map((task) => (
                                    <div key={task.id} className="rounded-2xl bg-surface-container-low px-4 py-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-bold text-sm text-on-surface">{task.title || task.type}</div>
                                                <div className="mt-2 text-xs text-on-surface-variant">{task.channel?.name || 'Unknown channel'}</div>
                                            </div>
                                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white text-on-surface-variant">
                                                {statusLabel(task.status)}
                                            </span>
                                        </div>
                                        {task.schedule_at && (
                                            <div className="mt-3 text-xs text-on-surface-variant">{new Date(task.schedule_at).toLocaleString()}</div>
                                        )}
                                    </div>
                                )) : (
                                    <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
                                        No scheduled tasks yet.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Latest Live Content</div>
                        <div className="mt-4 space-y-3">
                            {recentLiveContent.length > 0 ? recentLiveContent.map((task) => (
                                <a
                                    key={task.id}
                                    href={task.published_link!}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block rounded-2xl bg-surface-container-low px-4 py-4 hover:bg-primary/5 transition-all"
                                >
                                    <div className="font-bold text-on-surface">{task.title || task.type}</div>
                                    <div className="mt-2 text-sm text-on-surface-variant">{task.channel?.name || 'Unknown channel'}</div>
                                    <div className="mt-3 text-xs text-primary break-all">{task.published_link}</div>
                                </a>
                            )) : (
                                <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
                                    Published links will surface here after confirmation in the publishing console or channel workspace.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Status Snapshot</div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            {Object.entries(taskTotals.byStatus).map(([status, count]) => (
                                <div key={status} className="rounded-2xl bg-surface-container-low px-4 py-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/60">{statusLabel(status)}</div>
                                    <div className="mt-3 text-2xl font-headline font-black text-on-surface">{count}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>

            {showPlanModal && (
                <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="w-full max-w-4xl rounded-[2rem] bg-white border border-outline-variant/10 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10 flex items-start justify-between gap-6">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Publication Plan</div>
                                <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">Load or update project plan</h2>
                                <p className="mt-3 text-sm leading-7 text-on-surface-variant max-w-2xl">
                                    Import a plan into the current project network. The plan feeds channels, publishing tasks, analytics, and parser-driven follow-ups.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPlanModal(false)}
                                className="w-11 h-11 rounded-2xl bg-surface-container-high text-on-surface-variant hover:bg-primary hover:text-white transition-all"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <textarea
                                value={planJson}
                                onChange={(event) => setPlanJson(event.target.value)}
                                rows={20}
                                spellCheck={false}
                                className="w-full bg-surface-container-low border-none rounded-[1.5rem] p-5 text-sm font-mono leading-7 focus:ring-2 focus:ring-primary/20 outline-none"
                            />
                            <div className="flex justify-end">
                                <button
                                    onClick={() => importPlan.mutate()}
                                    disabled={importPlan.isPending}
                                    className="rounded-2xl bg-primary text-white px-6 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {importPlan.isPending ? 'Syncing Plan...' : 'Sync Publication Plan'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
