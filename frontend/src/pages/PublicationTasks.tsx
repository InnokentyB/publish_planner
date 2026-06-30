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
    key_points?: JsonRecord[] | null
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
    project_context?: {
        glossary_available?: boolean
        glossary_yaml?: string | null
        atoma_files_description?: string | null
        atoma_files_payload?: JsonRecord | JsonRecord[] | null
    } | null
    workspace_context?: {
        plan_item_ref?: string | null
        target_resource_url?: string | null
        target_resource_label?: string | null
        source_content?: string | null
        source_file_name?: string | null
    } | null
}

type PublicationOutcome = 'published' | 'blocked' | 'removed' | 'restricted'

type CriticReview = {
    checked_at?: string
    overall_score?: number
    dictionary?: {
        valid?: boolean
        score?: number
        findings?: Array<{
            severity?: 'error' | 'warning' | 'info'
            message?: string
            matched?: string
            suggestion?: string
        }>
    }
    llm_critic?: {
        score?: number
        critique?: string
    } | null
    llm_error?: string | null
    glossary_available?: boolean
    atoma_files_description?: string | null
    atoma_files_payload?: JsonRecord | JsonRecord[] | null
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
    if (status === 'deferred') return 'bg-yellow-200 text-yellow-950'
    if (status === 'ready_for_execution' || status === 'scheduled') return 'bg-primary/10 text-primary'
    if (status === 'failed') return 'bg-error text-white'
    return 'bg-surface-container-high text-on-surface-variant'
}

function taskChannel(task: PublicationTask) {
    return task.channel?.name || task.layer || task.type
}

function supportsAutoMetrics(task: PublicationTask | null | undefined) {
    if (!task) return false

    if (task.channel?.type === 'reddit' || task.channel?.type === 'linkedin' || task.channel?.type === 'google_search_console') {
        return true
    }

    if (task.channel?.type === 'tilda') {
        return Boolean(task.metrics?.monitoring?.needs_analytics_collection)
    }

    return false
}

function assetInlineContent(entry: JsonRecord | null | undefined) {
    if (!entry) return ''
    if (typeof entry.content === 'string' && entry.content.trim()) return entry.content
    if (typeof entry.asset?.content === 'string' && entry.asset.content.trim()) return entry.asset.content
    return ''
}

function mergeSourceFiles(task: PublicationTask | null | undefined) {
    const handoffFiles = ((task?.quality_report?.handoff_bundle as JsonRecord | undefined)?.resource_files as JsonRecord[] | undefined) || []
    const resolvedAssets = (task?.assets?.resolved_assets as JsonRecord[] | undefined) || []
    const merged = new Map<string, JsonRecord>()

    const score = (entry: JsonRecord) => {
        let total = 0
        if (assetInlineContent(entry)) total += 10
        if (entry.exists === true) total += 5
        if (entry.relative_path || entry.asset?.path) total += 3
        if (entry.file_name || entry.ref) total += 1
        return total
    }

    ;[...handoffFiles, ...resolvedAssets].forEach((entry, index) => {
        const key = String(entry?.ref || entry?.file_name || entry?.asset?.path || `fallback-${index}`)
        const current = merged.get(key)
        if (!current || score(entry) > score(current)) {
            merged.set(key, entry)
        }
    })

    return Array.from(merged.values())
}

function resolvePrimarySourceContent(task: PublicationTask | null | undefined, sourceFiles: JsonRecord[]) {
    if (typeof task?.workspace_context?.source_content === 'string' && task.workspace_context.source_content.trim()) {
        return task.workspace_context.source_content
    }

    const handoffBody = (task?.quality_report?.handoff_bundle as JsonRecord | undefined)?.publication?.body
    if (typeof handoffBody === 'string' && handoffBody.trim()) {
        return handoffBody
    }

    for (const entry of sourceFiles) {
        const content = assetInlineContent(entry)
        if (content) return content
    }

    const keyPoints = (task?.key_points as JsonRecord[] | undefined) || []
    for (const entry of keyPoints) {
        const content = assetInlineContent(entry)
        if (content) return content
    }

    return ''
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
    const [publicationOutcome, setPublicationOutcome] = useState<PublicationOutcome>('published')
    const [metricsJson, setMetricsJson] = useState('{\n  "views": 0,\n  "clicks": 0,\n  "comments": 0\n}')
    const [commentAuthor, setCommentAuthor] = useState('')
    const [commentUrl, setCommentUrl] = useState('')
    const [commentText, setCommentText] = useState('')
    const [criticReport, setCriticReport] = useState<CriticReview | null>(null)

    const resolvedStatusFilter = statusFilter

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
        setPublicationOutcome((selectedTask?.quality_report?.publication_outcome || selectedTask?.metrics?.publication_outcome || 'published') as PublicationOutcome)
        setMetricsJson(prettyJson(selectedTask?.metrics?.collected_metrics || { views: 0, clicks: 0, comments: 0 }))
        setCriticReport((selectedTask?.quality_report?.critic_review as CriticReview | undefined) || null)
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
            setTaskMessage('Handoff-пакет подготовлен.')
            refreshTasks()
        }
    })

    const confirmPublication = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.confirmPublication(selectedTaskId, {
                publishedLink,
                note: publicationNote || undefined,
                outcome: publicationOutcome
            })
        },
        onSuccess: () => {
            setTaskMessage(publicationOutcome === 'published'
                ? 'Публикация подтверждена. Теперь можно подтянуть метрики из канала или сохранить их вручную.'
                : `Ссылка на публикацию сохранена с исходом: ${publicationOutcome}. Задача остаётся подтверждённой, даже если пост заблокирован или ограничен.`)
            refreshTasks()
        }
    })

    const runCriticCheck = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
            const reviewText = (selectedTask?.quality_report?.handoff_bundle as JsonRecord | undefined)?.publication?.body
                || selectedTask?.workspace_context?.source_content
                || ''
            return publicationTasksApi.criticCheck(selectedTaskId, { text: reviewText })
        },
        onSuccess: (result: CriticReview) => {
            setCriticReport(result)
            setTaskMessage('Проверка критиком завершена. Отчёт обновлён.')
            refreshTasks()
        }
    })

    const generateTaskImage = useMutation({
        mutationFn: (provider: 'gpt-image' | 'nano' = 'gpt-image') => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.generateImage(selectedTaskId, { provider })
        },
        onSuccess: () => {
            setTaskMessage('Изображение для публикации сгенерировано.')
            refreshTasks()
        }
    })

    const collectMetrics = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.collectMetrics(selectedTaskId)
        },
        onSuccess: (result: any) => {
            setTaskMessage(result?.updated
                ? `Метрики получены из канала${result?.reason ? `. ${result.reason}` : '.'}`
                : (result?.reason || 'Метрики не были обновлены.'))
            refreshTasks()
        }
    })

    const recordMetrics = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.recordMetrics(selectedTaskId, JSON.parse(metricsJson))
        },
        onSuccess: () => {
            setTaskMessage('Снимок метрик сохранён вручную.')
            refreshTasks()
        }
    })

    const sendCommentAlert = useMutation({
        mutationFn: () => {
            if (!selectedTaskId) throw new Error('Задача не выбрана')
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
            setTaskMessage('Внешний алерт по комментарию сохранён.')
            refreshTasks()
        }
    })

    const activeTask = selectedTask || selectedFromList
    const handoffBundle = activeTask?.quality_report?.handoff_bundle as JsonRecord | undefined
    const sourceFiles = mergeSourceFiles(activeTask)
    const primarySourceContent = resolvePrimarySourceContent(activeTask, sourceFiles)
    const executionMode = handoffBundle?.mode || activeTask?.quality_report?.execution_mode || 'manual'
    const activeOutcome = (activeTask?.quality_report?.publication_outcome || activeTask?.metrics?.publication_outcome || 'published') as PublicationOutcome
    const isTaskOverdue = !!activeTask?.schedule_at
        && ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(activeTask.status)
        && new Date(activeTask.schedule_at).getTime() < Date.now()
    const canPrepareHandoff = !!activeTask && !['published', 'skipped'].includes(activeTask.status)
    const canFetchMetrics = !!activeTask?.published_link && supportsAutoMetrics(activeTask)
    const targetResourceUrl = activeTask?.workspace_context?.target_resource_url || handoffBundle?.publication?.link_url || ''
    const planItemRef = activeTask?.workspace_context?.plan_item_ref || (activeTask?.assets as JsonRecord | undefined)?.action?.id || (activeTask?.metrics as JsonRecord | undefined)?.task_id || ''
    const glossaryAvailable = activeTask?.project_context?.glossary_available === true
    const glossaryYaml = activeTask?.project_context?.glossary_yaml || ''
    const atomaDescription = activeTask?.project_context?.atoma_files_description || ''
    const atomaPayload = activeTask?.project_context?.atoma_files_payload
    const latestGeneratedImage = (((activeTask?.assets as JsonRecord | undefined)?.generated_visuals as JsonRecord[] | undefined)?.[0])
        || ((activeTask?.quality_report as JsonRecord | undefined)?.generated_image as JsonRecord | undefined)

    return (
        <div className="flex-1 w-full p-8 lg:p-10 space-y-8 overflow-y-auto">
            <section className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
                    <div className="bg-white rounded-[2rem] border border-outline-variant/10 shadow-sm overflow-hidden sticky top-6">
                        <div className="p-6 border-b border-outline-variant/10 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Консоль публикаций</div>
                                    <h2 className="text-xl font-headline font-black text-on-surface mt-2">Задачи на публикацию</h2>
                                    <p className="text-xs text-on-surface-variant mt-2">
                                        {currentProject ? `Проект: ${currentProject.name}` : 'Выбери или импортируй проект с планом публикаций.'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="text-xs text-on-surface-variant">
                                        {tasks?.length || 0} элементов
                                    </div>
                                    <button
                                        onClick={() => setShowPlanModal(true)}
                                        className="w-11 h-11 rounded-2xl ai-gradient text-white flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                                        title="Импортировать или обновить план публикаций"
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
                                    <option value="active">Активные</option>
                                    <option value="planned">Запланированные</option>
                                    <option value="awaiting_manual_publication">Ждут ручной публикации</option>
                                    <option value="ready_for_execution">Готовы</option>
                                    <option value="deferred">Отложенные</option>
                                    <option value="published">Опубликованные</option>
                                    <option value="failed">С ошибкой</option>
                                </select>

                                <button
                                    onClick={() => setManualOnly((value) => !value)}
                                    className={`rounded-xl px-4 py-3 text-sm font-black transition-all ${manualOnly ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}`}
                                >
                                    {manualOnly ? 'Только ручные' : 'Все режимы'}
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[720px] overflow-y-auto">
                            {!currentProject && (
                                <div className="p-8 text-sm text-on-surface-variant">
                                    Сначала импортируй план публикаций, а затем выбери проект для работы с очередью задач.
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
                                    Под текущий фильтр задач не найдено. Попробуй отключить режим `Только ручные` или синхронизировать свежий план публикаций.
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
                            <div className="min-h-[560px] flex items-center justify-center p-10 text-center">
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
                            <div>
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
                                                {activeTask.published_link && activeOutcome !== 'published' && (
                                                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-yellow-200 text-yellow-950">
                                                        {activeOutcome}
                                                    </span>
                                                )}
                                            </div>
                                            {activeTask.brief && (
                                                <p className="text-sm text-on-surface-variant max-w-3xl leading-relaxed">
                                                    {activeTask.brief}
                                                </p>
                                            )}
                                        </div>

                                        {canPrepareHandoff && (
                                            <button
                                                onClick={() => prepareHandoff.mutate(activeTask.id)}
                                                disabled={prepareHandoff.isPending || isLoadingTask}
                                                className="bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                            >
                                                {prepareHandoff.isPending ? 'Preparing...' : 'Prepare Handoff'}
                                            </button>
                                        )}
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
                                                {activeTask.published_link && (
                                                    <div><span className="font-bold text-on-surface">Outcome:</span> {activeOutcome}</div>
                                                )}
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

                                    <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)] gap-6 items-start">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Текст публикации</div>
                                                <span className="text-xs text-on-surface-variant">{handoffBundle?.publication?.body?.length || 0} chars</span>
                                            </div>
                                            <textarea
                                                readOnly
                                                value={handoffBundle?.publication?.body || ''}
                                                rows={16}
                                                className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:outline-none resize-none"
                                            />
                                        </div>

                                        <div className="space-y-6">
                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Контекст публикации</div>
                                                <div className="space-y-4">
                                                    <div>
                                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Ресурс для редактирования / публикации</div>
                                                        {targetResourceUrl ? (
                                                            <a
                                                                href={targetResourceUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-primary break-all hover:underline"
                                                            >
                                                                <span className="material-symbols-outlined text-base">open_in_new</span>
                                                                {targetResourceUrl}
                                                            </a>
                                                        ) : (
                                                            <div className="mt-2 text-sm text-on-surface-variant">Не указан в плане.</div>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Ссылка на пункт плана</div>
                                                        <div className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-on-surface">
                                                            {planItemRef || 'Не привязано'}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Исходный ресурс</div>
                                                        <div className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm text-on-surface">
                                                            {activeTask?.workspace_context?.source_file_name || sourceFiles[0]?.file_name || sourceFiles[0]?.relative_path || 'Не найден'}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Ссылка на сам пост</div>
                                                        <input
                                                            type="url"
                                                            value={publishedLink}
                                                            onChange={(event) => setPublishedLink(event.target.value)}
                                                            placeholder="https://..."
                                                            className="mt-2 w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Подтверждение публикации</div>
                                                <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                    Сохраняй permalink даже если платформа позже заблокирует, удалит или ограничит пост. Для Reddit это оставляет задачу подтверждённой и позволяет отслеживать те метрики, которые ещё доступны.
                                                </div>
                                                <select
                                                    value={publicationOutcome}
                                                    onChange={(event) => setPublicationOutcome(event.target.value as PublicationOutcome)}
                                                    className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                >
                                                    <option value="published">Опубликовано нормально</option>
                                                    <option value="blocked">Заблокировано, но URL есть</option>
                                                    <option value="removed">Удалено, но URL есть</option>
                                                    <option value="restricted">Ограниченная видимость</option>
                                                </select>
                                                <textarea
                                                    value={publicationNote}
                                                    onChange={(event) => setPublicationNote(event.target.value)}
                                                    rows={3}
                                                    className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                    placeholder="Необязательная заметка о публикации"
                                                />
                                                <button
                                                    onClick={() => confirmPublication.mutate()}
                                                    disabled={!publishedLink.trim() || confirmPublication.isPending}
                                                    className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {confirmPublication.isPending ? 'Сохраняем...' : 'Подтвердить live URL'}
                                                </button>
                                            </div>

                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Изображение к посту</div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <button
                                                        onClick={() => generateTaskImage.mutate('gpt-image')}
                                                        disabled={generateTaskImage.isPending}
                                                        className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        {generateTaskImage.isPending ? 'Генерируем...' : 'Сгенерировать через GPT-Image'}
                                                    </button>
                                                    <button
                                                        onClick={() => generateTaskImage.mutate('nano')}
                                                        disabled={generateTaskImage.isPending}
                                                        className="w-full bg-surface-container-highest text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                    >
                                                        {generateTaskImage.isPending ? 'Подготовка...' : 'Сгенерировать через Nano'}
                                                    </button>
                                                </div>
                                                {latestGeneratedImage?.url ? (
                                                    <div className="space-y-3">
                                                        <img
                                                            src={String(latestGeneratedImage.url)}
                                                            alt="Generated post visual"
                                                            className="w-full rounded-2xl border border-outline-variant/10 bg-white object-cover"
                                                        />
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                            <div><span className="font-bold text-on-surface">Provider:</span> {String(latestGeneratedImage.provider || 'n/a')}</div>
                                                            {latestGeneratedImage.prompt && (
                                                                <div className="mt-2 whitespace-pre-wrap break-words">{String(latestGeneratedImage.prompt)}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                        Сгенерированное изображение пока не добавлено.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)] gap-6 items-start">
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

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Source Files</div>
                                            <div className="space-y-3">
                                                {sourceFiles.length > 0 ? sourceFiles.map((entry, index) => {
                                                    const fileName = entry.file_name || entry.asset?.path?.split('/').pop() || entry.ref || `asset-${index + 1}`
                                                    const relativePath = entry.relative_path || entry.asset?.path || null
                                                    const sectionMarker = entry.section_marker || entry.asset?.section_marker || null
                                                    const exists = typeof entry.exists === 'boolean' ? entry.exists : null
                                                    const purpose = entry.purpose || null
                                                    const role = entry.role || null
                                                    const url = entry.url || null
                                                    const inlineContent = assetInlineContent(entry)

                                                    return (
                                                        <div key={`${entry.ref || fileName}-${index}`} className="rounded-2xl bg-white px-4 py-3 text-sm space-y-1">
                                                            <div className="font-bold text-on-surface">{fileName}</div>
                                                            {role && (
                                                                <div className="text-xs text-on-surface-variant">Role: {role}</div>
                                                            )}
                                                            {relativePath && (
                                                                <div className="text-xs text-on-surface-variant break-all">{relativePath}</div>
                                                            )}
                                                            {url && (
                                                                <div className="text-xs text-on-surface-variant break-all">{url}</div>
                                                            )}
                                                            {sectionMarker && (
                                                                <div className="text-xs text-on-surface-variant">Section: {sectionMarker}</div>
                                                            )}
                                                            {purpose && (
                                                                <div className="text-xs text-on-surface-variant">{purpose}</div>
                                                            )}
                                                            {exists === false && !inlineContent && (
                                                                <div className="text-xs font-bold text-error">File not found from pipeline root.</div>
                                                            )}
                                                        </div>
                                                    )
                                                }) : (
                                                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                        No resource files were attached to this task.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4 xl:col-start-2 xl:row-span-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Source Content</div>
                                                {!handoffBundle && (
                                                    <span className="text-xs text-on-surface-variant">Prepare handoff to load file content</span>
                                                )}
                                            </div>
                                            <textarea
                                                readOnly
                                                value={primarySourceContent}
                                                rows={14}
                                                className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:outline-none resize-none"
                                                placeholder={handoffBundle
                                                    ? 'No readable source text was found in the linked resource files.'
                                                    : 'Prepare handoff to pull text from the linked resource file or section marker.'}
                                            />
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 items-start">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Критик и правила</div>
                                                <button
                                                    onClick={() => runCriticCheck.mutate()}
                                                    disabled={runCriticCheck.isPending}
                                                    className="bg-primary text-white font-black text-xs px-4 py-2 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {runCriticCheck.isPending ? 'Проверяем...' : 'Проверить критиком'}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Глоссарий</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{glossaryAvailable ? 'Подключён' : 'Не загружен'}</div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Atoma</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{atomaDescription ? 'Контекст есть' : 'Не загружен'}</div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Итоговый score</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{criticReport?.overall_score ?? '—'}</div>
                                                </div>
                                            </div>

                                            {criticReport ? (
                                                <div className="space-y-4">
                                                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                        <div><span className="font-bold text-on-surface">Dictionary score:</span> {criticReport.dictionary?.score ?? '—'}</div>
                                                        {criticReport.llm_critic?.score !== undefined && (
                                                            <div className="mt-1"><span className="font-bold text-on-surface">LLM critic score:</span> {criticReport.llm_critic.score}</div>
                                                        )}
                                                        {criticReport.checked_at && (
                                                            <div className="mt-1"><span className="font-bold text-on-surface">Проверено:</span> {formatDate(criticReport.checked_at)}</div>
                                                        )}
                                                    </div>

                                                    {criticReport.llm_critic?.critique && (
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-on-surface whitespace-pre-wrap">
                                                            {criticReport.llm_critic.critique}
                                                        </div>
                                                    )}

                                                    {criticReport.llm_error && (
                                                        <div className="rounded-2xl bg-error-container/30 px-4 py-3 text-sm text-error">
                                                            {criticReport.llm_error}
                                                        </div>
                                                    )}

                                                    <div className="space-y-2">
                                                        {(criticReport.dictionary?.findings || []).length === 0 ? (
                                                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                                По словарю и обязательным правилам замечаний нет.
                                                            </div>
                                                        ) : (
                                                            (criticReport.dictionary?.findings || []).map((finding, index) => (
                                                                <div key={`${finding.message}-${index}`} className="rounded-2xl bg-white px-4 py-3 text-sm">
                                                                    <div className="font-bold text-on-surface">{finding.message}</div>
                                                                    {(finding.matched || finding.suggestion) && (
                                                                        <div className="mt-2 text-xs text-on-surface-variant">
                                                                            {finding.matched && <div>Найдено: {finding.matched}</div>}
                                                                            {finding.suggestion && <div>Предлагается: {finding.suggestion}</div>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                    Запусти критика, чтобы проверить текст по глоссарию, atoma-контексту и агентной критике.
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Глоссарий и atoma-контекст</div>
                                            <div className="grid grid-cols-1 gap-4">
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Глоссарий проекта</div>
                                                    <textarea
                                                        readOnly
                                                        value={glossaryYaml || 'Глоссарий не загружен вместе с планом или через настройки проекта.'}
                                                        rows={8}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Описание atoma files</div>
                                                    <textarea
                                                        readOnly
                                                        value={atomaDescription || 'Описание atoma files не загружено.'}
                                                        rows={4}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Atoma payload</div>
                                                    <textarea
                                                        readOnly
                                                        value={prettyJson(atomaPayload || {})}
                                                        rows={8}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs font-mono leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
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
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Ассеты и визуалы</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson({
                                                    visuals: handoffBundle?.publication?.visuals || [],
                                                    html_bundle: handoffBundle?.publication?.html_bundle || []
                                                })}
                                            </pre>
                                        </div>
                                    </section>

                                    <section>
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Сохранение метрик</div>
                                            <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                {activeTask.channel?.type === 'linkedin'
                                                    ? 'Для LinkedIn мы подтягиваем аналитику из подключённого канала. Если токен был выдан до нового analytics scope, сначала переподключи LinkedIn.'
                                                    : activeTask.channel?.type === 'tilda'
                                                        ? 'Tilda не отдаёт постовую аналитику напрямую через этот интерфейс. Автоматический сбор сработает только если у проекта также привязана Google Search Console property для опубликованного URL.'
                                                    : 'Используй сбор из канала, если адаптер поддерживает аналитику, или сохраняй ручной снимок, если площадка работает только вручную.'}
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
                                                    disabled={collectMetrics.isPending || !canFetchMetrics}
                                                    className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {collectMetrics.isPending ? 'Получаем...' : 'Получить из канала'}
                                                </button>
                                                <button
                                                    onClick={() => recordMetrics.mutate()}
                                                    disabled={recordMetrics.isPending}
                                                    className="w-full bg-surface-container-highest text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                >
                                                    {recordMetrics.isPending ? 'Сохраняем метрики...' : 'Сохранить снимок метрик'}
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Внешний алерт по комментарию</div>
                                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                            <input
                                                type="text"
                                                value={commentAuthor}
                                                onChange={(event) => setCommentAuthor(event.target.value)}
                                                placeholder="Автор"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <input
                                                type="url"
                                                value={commentUrl}
                                                onChange={(event) => setCommentUrl(event.target.value)}
                                                placeholder="URL комментария"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <button
                                                onClick={() => sendCommentAlert.mutate()}
                                                disabled={sendCommentAlert.isPending || !commentText.trim()}
                                                className="bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                            >
                                                {sendCommentAlert.isPending ? 'Сохраняем...' : 'Записать алерт по комментарию'}
                                            </button>
                                        </div>
                                        <textarea
                                            value={commentText}
                                            onChange={(event) => setCommentText(event.target.value)}
                                            rows={4}
                                            className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            placeholder="Вставь текст комментария или заметку модерации"
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
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Импорт плана</div>
                                <h2 className="text-2xl font-headline font-black tracking-tight text-on-surface mt-2">Синхронизировать план публикаций</h2>
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
                                placeholder="Вставь сюда publication-plan.json"
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
                                    {currentProject ? `Текущий проект: ${currentProject.name}` : 'Импорт создаст или обновит связанный проект.'}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowPlanModal(false)}
                                        className="bg-surface-container-high text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-surface-container-highest transition-all"
                                    >
                                        Закрыть
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPlanMessage(null)
                                            importPlan.mutate()
                                        }}
                                        disabled={!planJson.trim() || importPlan.isPending}
                                        className="bg-primary text-white font-black text-sm px-6 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {importPlan.isPending ? 'Синхронизируем план...' : 'Синхронизировать план публикаций'}
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
