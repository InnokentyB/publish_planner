import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { projectsApi, publicationTasksApi } from '../api'
import { useAuth } from '../context/AuthContext'

type JsonRecord = Record<string, any>

interface PublicationTask {
    id: number
    type: string
    layer?: string | null
    title?: string | null
    brief?: string | null
    status: string
    schedule_at?: string | null
    published_link?: string | null
    quality_report?: JsonRecord | null
    metrics?: JsonRecord | null
    assets?: JsonRecord | null
    channel?: {
        id: number
        name: string
        type: string
        config?: JsonRecord | null
    } | null
}

const PUBLICATION_PLAN_TEMPLATE = `{
  "meta": {
    "plan_id": "distribution-cycle-2026-04-24",
    "cycle_start": "2026-04-24",
    "cycle_end": "2026-05-01",
    "timezone_default": "Europe/Lisbon"
  },
  "accounts": {
    "reddit_main": {
      "platform": "reddit",
      "subreddit": "artificial"
    }
  },
  "assets": {},
  "actions": []
}`

function formatDate(value?: string | null) {
    if (!value) return 'Not scheduled'

    try {
        return format(new Date(value), 'MMM d, HH:mm')
    } catch {
        return value
    }
}

function prettyJson(value: unknown) {
    if (value == null) return ''
    return JSON.stringify(value, null, 2)
}

function statusTone(status: string) {
    if (status === 'published') return 'bg-success text-white'
    if (status === 'awaiting_manual_publication') return 'bg-primary text-white'
    if (status === 'ready_for_execution' || status === 'scheduled') return 'bg-primary/10 text-primary'
    if (status === 'failed') return 'bg-error text-white'
    return 'bg-surface-container-high text-on-surface-variant'
}

function taskChannel(task: PublicationTask) {
    return task.channel?.name || task.layer || task.type
}

export default function PublicationTasks() {
    const queryClient = useQueryClient()
    const { currentProject, projects, createProject, setCurrentProject } = useAuth()

    const [statusFilter, setStatusFilter] = useState('active')
    const [manualOnly, setManualOnly] = useState(true)
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
    const [planJson, setPlanJson] = useState(PUBLICATION_PLAN_TEMPLATE)
    const [planMessage, setPlanMessage] = useState<string | null>(null)
    const [taskMessage, setTaskMessage] = useState<string | null>(null)
    const [showPlanModal, setShowPlanModal] = useState(false)

    const [publishedLink, setPublishedLink] = useState('')
    const [publicationNote, setPublicationNote] = useState('')
    const [metricsJson, setMetricsJson] = useState('{\n  "views": 0,\n  "clicks": 0,\n  "comments": 0\n}')
    const [commentAuthor, setCommentAuthor] = useState('')
    const [commentUrl, setCommentUrl] = useState('')
    const [commentText, setCommentText] = useState('')

    const resolvedStatusFilter = statusFilter === 'active' ? undefined : statusFilter

    const { data: tasks, isLoading, error } = useQuery<PublicationTask[]>({
        queryKey: ['publication_tasks', currentProject?.id, resolvedStatusFilter || 'active', manualOnly],
        queryFn: () => publicationTasksApi.list({ status: resolvedStatusFilter, manualOnly }),
        enabled: !!currentProject
    })

    const selectedFromList = useMemo(
        () => tasks?.find((task) => task.id === selectedTaskId) || null,
        [tasks, selectedTaskId]
    )

    const { data: selectedTask, isFetching: isLoadingTask } = useQuery<PublicationTask>({
        queryKey: ['publication_task_detail', selectedTaskId],
        queryFn: () => publicationTasksApi.get(selectedTaskId as number),
        enabled: !!selectedTaskId && !!currentProject
    })

    useEffect(() => {
        if (!tasks?.length) {
            setSelectedTaskId(null)
            return
        }

        const exists = tasks.some((task) => task.id === selectedTaskId)
        if (!exists) {
            setSelectedTaskId(tasks[0].id)
        }
    }, [tasks, selectedTaskId])

    useEffect(() => {
        setPublishedLink(selectedTask?.published_link || '')
        setPublicationNote(selectedTask?.quality_report?.manual_publication_note || '')
        setMetricsJson(prettyJson(selectedTask?.metrics?.collected_metrics || { views: 0, clicks: 0, comments: 0 }))
        setCommentAuthor('')
        setCommentUrl('')
        setCommentText('')
        setTaskMessage(null)
    }, [selectedTask?.id])

    const refreshTasks = () => {
        queryClient.invalidateQueries({ queryKey: ['publication_tasks'] })
        queryClient.invalidateQueries({ queryKey: ['publication_task_detail'] })
    }

    const importPlan = useMutation({
        mutationFn: () => projectsApi.importPublicationPlan(planJson),
        onSuccess: (result: any) => {
            const project = result?.project
            const imported = result?.imported
            setPlanMessage(`Plan synced: ${imported?.actions || 0} actions, ${imported?.accounts || 0} adapters, ${imported?.updatedExistingProject ? 'existing project updated' : 'new project created'}.`)

            if (!project) {
                refreshTasks()
                return
            }

            if (currentProject?.id === project.id) {
                refreshTasks()
                return
            }

            const existingProject = projects.find((entry) => entry.id === project.id)
            if (existingProject) {
                setCurrentProject(existingProject)
                return
            }

            createProject({ id: project.id, name: project.name })
        }
    })

    const prepareHandoff = useMutation({
        mutationFn: (taskId: number) => publicationTasksApi.prepareHandoff(taskId),
        onSuccess: () => {
            setTaskMessage('Handoff bundle prepared.')
            refreshTasks()
        }
    })

    const confirmPublication = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('No task selected')
            return publicationTasksApi.confirmPublication(selectedTaskId, {
                publishedLink,
                note: publicationNote || undefined
            })
        },
        onSuccess: () => {
            setTaskMessage('Publication confirmed. You can now fetch metrics from the channel or save them manually.')
            refreshTasks()
        }
    })

    const collectMetrics = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('No task selected')
            return publicationTasksApi.collectMetrics(selectedTaskId)
        },
        onSuccess: (result: any) => {
            setTaskMessage(result?.updated
                ? `Metrics fetched from channel${result?.reason ? `. ${result.reason}` : '.'}`
                : (result?.reason || 'Metrics were not updated.'))
            refreshTasks()
        }
    })

    const recordMetrics = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('No task selected')
            return publicationTasksApi.recordMetrics(selectedTaskId, JSON.parse(metricsJson))
        },
        onSuccess: () => {
            setTaskMessage('Metrics snapshot saved manually.')
            refreshTasks()
        }
    })

    const sendCommentAlert = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('No task selected')
            return publicationTasksApi.externalCommentAlert(selectedTaskId, {
                author: commentAuthor || undefined,
                commentUrl: commentUrl || undefined,
                text: commentText || undefined
            })
        },
        onSuccess: () => {
            setCommentAuthor('')
            setCommentUrl('')
            setCommentText('')
            setTaskMessage('External comment alert saved.')
            refreshTasks()
        }
    })

    const activeTask = selectedTask || selectedFromList
    const handoffBundle = activeTask?.quality_report?.handoff_bundle as JsonRecord | undefined
    const executionMode = handoffBundle?.mode || activeTask?.quality_report?.execution_mode || 'manual'
    const isTaskOverdue = !!activeTask?.schedule_at
        && ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(activeTask.status)
        && new Date(activeTask.schedule_at).getTime() < Date.now()

    return (
        <div className="flex-1 w-full p-8 lg:p-10 space-y-8 overflow-y-auto">
            <section className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-6 min-h-[720px]">
                    <div className="bg-white rounded-[2rem] border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Publishing Console</div>
                                    <h2 className="text-xl font-headline font-black text-on-surface mt-2">Publication Tasks</h2>
                                    <p className="text-xs text-on-surface-variant mt-2">
                                        {currentProject ? `Project: ${currentProject.name}` : 'Choose or import a publication plan project.'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="text-xs text-on-surface-variant">
                                        {tasks?.length || 0} items
                                    </div>
                                    <button
                                        onClick={() => setShowPlanModal(true)}
                                        className="w-11 h-11 rounded-2xl ai-gradient text-white flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                                        title="Import or update publication plan"
                                    >
                                        <span className="material-symbols-outlined text-xl">hub</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <select
                                    value={statusFilter}
                                    onChange={(event) => setStatusFilter(event.target.value)}
                                    className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                >
                                    <option value="active">Active</option>
                                    <option value="planned">Planned</option>
                                    <option value="awaiting_manual_publication">Awaiting Manual</option>
                                    <option value="ready_for_execution">Ready</option>
                                    <option value="published">Published</option>
                                    <option value="failed">Failed</option>
                                </select>

                                <button
                                    onClick={() => setManualOnly((value) => !value)}
                                    className={`rounded-xl px-4 py-3 text-sm font-black transition-all ${manualOnly ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}`}
                                >
                                    {manualOnly ? 'Manual Only' : 'All Modes'}
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[720px] overflow-y-auto">
                            {!currentProject && (
                                <div className="p-8 text-sm text-on-surface-variant">
                                    Import a publication plan first, then choose the project to work with the task queue.
                                </div>
                            )}

                            {currentProject && isLoading && (
                                <div className="p-8 flex items-center justify-center">
                                    <div className="w-10 h-10 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
                                </div>
                            )}

                            {currentProject && error && (
                                <div className="p-8 text-sm text-error font-medium">
                                    {(error as Error).message}
                                </div>
                            )}

                            {currentProject && !isLoading && !tasks?.length && (
                                <div className="p-8 text-sm text-on-surface-variant leading-relaxed">
                                    No tasks match the current filter. Try turning off `Manual Only` or sync a fresh publication plan.
                                </div>
                            )}

                            {tasks?.map((task) => {
                                const isSelected = task.id === activeTask?.id
                                const mode = task.quality_report?.execution_mode || 'manual'
                                const isOverdue = !!task.schedule_at
                                    && ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(task.status)
                                    && new Date(task.schedule_at).getTime() < Date.now()

                                return (
                                    <button
                                        key={task.id}
                                        onClick={() => setSelectedTaskId(task.id)}
                                        className={`w-full text-left px-5 py-4 border-b transition-all ${
                                            isOverdue
                                                ? isSelected
                                                    ? 'bg-error-container/35 border-error/20'
                                                    : 'bg-error-container/20 border-error/10 hover:bg-error-container/30'
                                                : isSelected
                                                    ? 'bg-primary/5 border-outline-variant/10'
                                                    : 'border-outline-variant/10 hover:bg-surface-container-lowest'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">
                                                    {taskChannel(task)}
                                                </div>
                                                <div className="font-bold text-sm text-on-surface mt-2 truncate">
                                                    {task.title || task.type}
                                                </div>
                                                <div className="text-xs text-on-surface-variant mt-2">
                                                    {formatDate(task.schedule_at)}
                                                </div>
                                                {isOverdue && (
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-error mt-2">
                                                        Overdue
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-2 shrink-0">
                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusTone(task.status)}`}>
                                                    {task.status}
                                                </span>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                                    {mode}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="bg-white rounded-[2rem] border border-outline-variant/10 shadow-sm overflow-hidden">
                        {!activeTask && (
                            <div className="h-full min-h-[720px] flex items-center justify-center p-10 text-center">
                                <div className="max-w-md space-y-4">
                                    <div className="w-16 h-16 mx-auto rounded-3xl bg-surface-container-high flex items-center justify-center text-primary">
                                        <span className="material-symbols-outlined text-3xl">task_alt</span>
                                    </div>
                                    <h3 className="text-2xl font-headline font-black">Select a task</h3>
                                    <p className="text-sm text-on-surface-variant leading-relaxed">
                                        Pick a publication task to inspect the ready-to-publish bundle, confirm the live URL, and collect follow-up analytics.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTask && (
                            <div className="h-full max-h-[720px] overflow-y-auto">
                                <div className="p-7 border-b border-outline-variant/10">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">
                                                {taskChannel(activeTask)}
                                            </div>
                                            <h2 className="text-2xl font-headline font-black tracking-tight text-on-surface">
                                                {activeTask.title || activeTask.type}
                                            </h2>
                                            <div className="flex flex-wrap gap-2">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusTone(activeTask.status)}`}>
                                                    {activeTask.status}
                                                </span>
                                                {isTaskOverdue && (
                                                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-error text-white">
                                                        overdue
                                                    </span>
                                                )}
                                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                    {executionMode}
                                                </span>
                                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                    {formatDate(activeTask.schedule_at)}
                                                </span>
                                            </div>
                                            {activeTask.brief && (
                                                <p className="text-sm text-on-surface-variant max-w-3xl leading-relaxed">
                                                    {activeTask.brief}
                                                </p>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => prepareHandoff.mutate(activeTask.id)}
                                            disabled={prepareHandoff.isPending || isLoadingTask}
                                            className="bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                        >
                                            {prepareHandoff.isPending ? 'Preparing...' : 'Prepare Handoff'}
                                        </button>
                                    </div>

                                    {taskMessage && (
                                        <div className="mt-4 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                                            {taskMessage}
                                        </div>
                                    )}

                                    {(prepareHandoff.error || confirmPublication.error || collectMetrics.error || recordMetrics.error || sendCommentAlert.error) && (
                                        <div className="mt-4 rounded-2xl bg-error-container/30 text-error px-4 py-3 text-sm font-medium">
                                            {[
                                                prepareHandoff.error,
                                                confirmPublication.error,
                                                collectMetrics.error,
                                                recordMetrics.error,
                                                sendCommentAlert.error
                                            ].find(Boolean) instanceof Error
                                                ? (([
                                                    prepareHandoff.error,
                                                    confirmPublication.error,
                                                    collectMetrics.error,
                                                    recordMetrics.error,
                                                    sendCommentAlert.error
                                                ].find(Boolean) as Error).message)
                                                : 'Something went wrong'}
                                        </div>
                                    )}
                                </div>

                                <div className="p-7 space-y-7">
                                    <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Task Context</div>
                                            <div className="text-sm text-on-surface-variant space-y-2">
                                                <div><span className="font-bold text-on-surface">Type:</span> {activeTask.type}</div>
                                                <div><span className="font-bold text-on-surface">Adapter:</span> {activeTask.channel?.type || activeTask.layer || 'n/a'}</div>
                                                <div><span className="font-bold text-on-surface">Account:</span> {activeTask.channel?.name || activeTask.metrics?.account_ref || 'n/a'}</div>
                                                <div><span className="font-bold text-on-surface">Published:</span> {activeTask.published_link ? 'yes' : 'no'}</div>
                                            </div>
                                            {activeTask.published_link && (
                                                <a
                                                    href={activeTask.published_link}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                                                >
                                                    <span className="material-symbols-outlined text-base">open_in_new</span>
                                                    Open published post
                                                </a>
                                            )}
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Monitoring</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson(activeTask.metrics?.monitoring || {})}
                                            </pre>
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Publication Body</div>
                                                <span className="text-xs text-on-surface-variant">{handoffBundle?.publication?.body?.length || 0} chars</span>
                                            </div>
                                            <textarea
                                                readOnly
                                                value={handoffBundle?.publication?.body || ''}
                                                rows={14}
                                                className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:outline-none resize-none"
                                            />
                                            {handoffBundle?.publication?.link_url && (
                                                <div className="text-sm text-on-surface-variant">
                                                    <span className="font-bold text-on-surface">Canonical link:</span> {handoffBundle.publication.link_url}
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Manual Checklist</div>
                                            <div className="space-y-3">
                                                {(handoffBundle?.manual_checklist || ['Prepare the handoff bundle to see channel-specific checklist.']).map((item: string, index: number) => (
                                                    <div key={`${item}-${index}`} className="flex items-start gap-3 text-sm text-on-surface-variant">
                                                        <span className="w-6 h-6 rounded-full bg-white text-primary flex items-center justify-center font-black text-xs shrink-0">{index + 1}</span>
                                                        <span className="leading-6">{item}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Verification Rules</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson(handoffBundle?.verification || activeTask.quality_report?.verification || [])}
                                            </pre>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Post Actions</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson(handoffBundle?.post_actions || activeTask.quality_report?.post_actions || [])}
                                            </pre>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Assets & Visuals</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson({
                                                    visuals: handoffBundle?.publication?.visuals || [],
                                                    html_bundle: handoffBundle?.publication?.html_bundle || []
                                                })}
                                            </pre>
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Confirm Publication</div>
                                            <input
                                                type="url"
                                                value={publishedLink}
                                                onChange={(event) => setPublishedLink(event.target.value)}
                                                placeholder="https://..."
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <textarea
                                                value={publicationNote}
                                                onChange={(event) => setPublicationNote(event.target.value)}
                                                rows={4}
                                                className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                placeholder="Optional publication note"
                                            />
                                            <button
                                                onClick={() => confirmPublication.mutate()}
                                                disabled={!publishedLink.trim() || confirmPublication.isPending}
                                                className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                            >
                                                {confirmPublication.isPending ? 'Saving...' : 'Confirm Live URL'}
                                            </button>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Record Metrics</div>
                                            <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                {activeTask.channel?.type === 'linkedin'
                                                    ? 'For LinkedIn we can fetch likes and comments from the connected channel. View counts for personal posts are not available in the current API flow, so `views` may stay 0.'
                                                    : 'Use channel fetch when the adapter supports analytics, or save a manual snapshot if the platform is manual-only.'}
                                            </div>
                                            <textarea
                                                value={metricsJson}
                                                onChange={(event) => setMetricsJson(event.target.value)}
                                                rows={9}
                                                spellCheck={false}
                                                className="w-full bg-white border-none rounded-2xl p-4 text-xs font-mono leading-6 focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                                <button
                                                    onClick={() => collectMetrics.mutate()}
                                                    disabled={collectMetrics.isPending || !activeTask.published_link}
                                                    className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {collectMetrics.isPending ? 'Fetching...' : 'Fetch From Channel'}
                                                </button>
                                                <button
                                                    onClick={() => recordMetrics.mutate()}
                                                    disabled={recordMetrics.isPending}
                                                    className="w-full bg-surface-container-highest text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                >
                                                    {recordMetrics.isPending ? 'Saving Metrics...' : 'Save Metrics Snapshot'}
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">External Comment Alert</div>
                                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                            <input
                                                type="text"
                                                value={commentAuthor}
                                                onChange={(event) => setCommentAuthor(event.target.value)}
                                                placeholder="Author"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <input
                                                type="url"
                                                value={commentUrl}
                                                onChange={(event) => setCommentUrl(event.target.value)}
                                                placeholder="Comment URL"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <button
                                                onClick={() => sendCommentAlert.mutate()}
                                                disabled={sendCommentAlert.isPending || !commentText.trim()}
                                                className="bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                            >
                                                {sendCommentAlert.isPending ? 'Sending...' : 'Log Comment Alert'}
                                            </button>
                                        </div>
                                        <textarea
                                            value={commentText}
                                            onChange={(event) => setCommentText(event.target.value)}
                                            rows={4}
                                            className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            placeholder="Paste the comment text or moderation note"
                                        />
                                    </section>
                                </div>
                            </div>
                        )}
                    </div>
            </section>

            {showPlanModal && (
                <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="w-full max-w-4xl bg-white rounded-[2rem] border border-outline-variant/10 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Plan Import</div>
                                <h2 className="text-2xl font-headline font-black tracking-tight text-on-surface mt-2">Sync Publication Plan</h2>
                                <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                                    Загрузи или обнови внешний `publication-plan.json`, не занимая место на основной рабочей странице.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPlanModal(false)}
                                className="w-11 h-11 rounded-2xl bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-all"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <textarea
                                value={planJson}
                                onChange={(event) => setPlanJson(event.target.value)}
                                rows={18}
                                spellCheck={false}
                                className="w-full bg-surface-container-low border-none rounded-[1.5rem] p-5 text-xs font-mono leading-6 focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                                placeholder="Paste publication-plan.json here"
                            />

                            {planMessage && (
                                <div className="rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                                    {planMessage}
                                </div>
                            )}

                            {importPlan.error && (
                                <div className="rounded-2xl bg-error-container/30 text-error px-4 py-3 text-sm font-medium">
                                    {(importPlan.error as Error).message}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-3 justify-between items-center">
                                <div className="text-xs text-on-surface-variant">
                                    {currentProject ? `Current project: ${currentProject.name}` : 'Import will create or update the mapped project.'}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowPlanModal(false)}
                                        className="bg-surface-container-high text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-surface-container-highest transition-all"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPlanMessage(null)
                                            importPlan.mutate()
                                        }}
                                        disabled={!planJson.trim() || importPlan.isPending}
                                        className="bg-primary text-white font-black text-sm px-6 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {importPlan.isPending ? 'Syncing Plan...' : 'Sync Publication Plan'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
