import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, projectsApi, publicationTasksApi } from '../api'
import { useAuth } from '../context/AuthContext'
import ContentMarkupRenderer from '../components/ContentMarkupRenderer'

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
    key_points?: JsonRecord[] | null
    schedule_at?: string | null
    published_link?: string | null
    assets?: JsonRecord | null
    metrics?: JsonRecord | null
    quality_report?: JsonRecord | null
    channel?: {
        id: number
        name: string
        type: string
        config?: JsonRecord | null
    } | null
}

type ResourceFile = {
    ref?: string
    role?: string | null
    purpose?: string | null
    file_name?: string | null
    relative_path?: string | null
    full_path?: string | null
    section_marker?: string | null
    exists?: boolean
    url?: string | null
    content?: string | null
}

type PublicationOutcome = 'published' | 'blocked' | 'removed' | 'restricted'

function statusTone(status?: string | null) {
    if (status === 'published') return 'bg-success text-white'
    if (status === 'deferred') return 'bg-yellow-200 text-yellow-950'
    if (status === 'awaiting_manual_publication') return 'bg-primary text-white'
    return 'bg-surface-container-high text-on-surface-variant'
}

function channelIcon(type: string) {
    if (type === 'linkedin') return 'work'
    if (type === 'reddit') return 'forum'
    if (type === 'google_search_console') return 'query_stats'
    if (type === 'tilda') return 'web'
    if (type === 'medium') return 'article'
    if (type === 'indiehackers') return 'groups'
    return 'alternate_email'
}

function resourceContent(entry: JsonRecord | null | undefined) {
    if (!entry) return ''
    if (typeof entry.content === 'string' && entry.content.trim()) return entry.content
    if (typeof entry.asset?.content === 'string' && entry.asset.content.trim()) return entry.asset.content
    return ''
}

function mergeChannelResourceFiles(task: PublicationTask | null) {
    const handoffFiles = ((task?.quality_report?.handoff_bundle as JsonRecord | undefined)?.resource_files as ResourceFile[] | undefined) || []
    const resolvedAssets = ((task?.assets?.resolved_assets as JsonRecord[] | undefined) || []) as ResourceFile[]
    const merged = new Map<string, ResourceFile>()

    const score = (entry: ResourceFile) => {
        let total = 0
        if (resourceContent(entry as JsonRecord)) total += 10
        if (entry.exists === true) total += 5
        if (entry.relative_path) total += 3
        if (entry.file_name || entry.ref) total += 1
        return total
    }

    ;[...handoffFiles, ...resolvedAssets].forEach((entry, index) => {
        const key = String(entry?.ref || entry?.file_name || entry?.relative_path || `resource-${index}`)
        const current = merged.get(key)
        if (!current || score(entry) > score(current)) {
            merged.set(key, entry)
        }
    })

    return Array.from(merged.values())
}

export default function ChannelWorkspace() {
    const { channelId } = useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()

    const [sourceMode, setSourceMode] = useState<'plan' | 'manual' | 'generate' | 'mcp'>('plan')
    const [manualMessage, setManualMessage] = useState<string | null>(null)
    const [manualFileName, setManualFileName] = useState('')
    const [manualFileContent, setManualFileContent] = useState('')
    const [manualFileType, setManualFileType] = useState<'markdown' | 'html' | 'unknown'>('unknown')
    const [manualNote, setManualNote] = useState('')
    const [manualPublishedLink, setManualPublishedLink] = useState('')
    const [manualPublishNow, setManualPublishNow] = useState(false)
    const [manualOutcome, setManualOutcome] = useState<PublicationOutcome>('published')

    const channelIdNumber = Number(channelId)

    const { data: projectData } = useQuery<ProjectDetails>({
        queryKey: ['channel_workspace_project', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject
    })

    const { data: publicationTasks } = useQuery<PublicationTask[]>({
        queryKey: ['channel_workspace_tasks', currentProject?.id],
        queryFn: () => publicationTasksApi.list({ manualOnly: false }),
        enabled: !!currentProject
    })

    const selectedChannel = useMemo(() => {
        if (!projectData?.channels?.length || Number.isNaN(channelIdNumber)) return null
        return projectData.channels.find((channel) => channel.id === channelIdNumber) || null
    }, [projectData?.channels, channelIdNumber])

    useEffect(() => {
        if (!currentProject || !projectData?.channels?.length) return
        if (!channelId || Number.isNaN(channelIdNumber) || !selectedChannel) {
            navigate(`/channels/${projectData.channels[0].id}`, { replace: true })
        }
    }, [channelId, channelIdNumber, currentProject, navigate, projectData?.channels, selectedChannel])

    const selectedChannelTasks = useMemo(() => {
        if (!selectedChannel || !publicationTasks) return []
        return publicationTasks.filter((task) => task.channel?.id === selectedChannel.id)
    }, [publicationTasks, selectedChannel])

    const selectedTask = selectedChannelTasks[0] || null
    const resourceFiles = mergeChannelResourceFiles(selectedTask)
    const publishedTasks = selectedChannelTasks.filter((task) => task.status === 'published').length
    const overdueTasks = selectedChannelTasks.filter((task) => {
        if (!task.schedule_at) return false
        return ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(task.status)
            && new Date(task.schedule_at).getTime() < Date.now()
    }).length

    const saveManualContent = useMutation({
        mutationFn: () => {
            if (!currentProject?.id || !selectedChannel?.id) {
                throw new Error('Сначала выбери канал проекта')
            }
            if (!manualFileContent.trim()) {
                throw new Error('Сначала загрузи файл')
            }
            return projectsApi.saveManualChannelContent(currentProject.id, selectedChannel.id, {
                fileName: manualFileName || 'manual-content',
                fileType: manualFileType,
                content: manualFileContent,
                note: manualNote || undefined,
                publishedLink: manualPublishedLink || undefined,
                publishNow: manualPublishNow,
                outcome: manualOutcome
            })
        },
        onSuccess: () => {
            setManualMessage(manualPublishNow
                ? `Сохранено в канал ${selectedChannel?.name} и связано с уже опубликованным материалом.`
                : `Сохранено в канал ${selectedChannel?.name}.`)
            queryClient.invalidateQueries({ queryKey: ['channel_workspace_tasks'] })
            queryClient.invalidateQueries({ queryKey: ['publication_tasks'] })
        }
    })

    const handleManualFile = (file: File) => {
        const reader = new FileReader()
        reader.onload = () => {
            setManualFileName(file.name)
            setManualFileContent(String(reader.result || ''))
            setManualMessage(null)
            if (file.name.endsWith('.md')) setManualFileType('markdown')
            else if (file.name.endsWith('.html') || file.name.endsWith('.htm')) setManualFileType('html')
            else setManualFileType('unknown')
        }
        reader.readAsText(file)
    }

    if (!currentProject) {
        return (
            <div className="flex-1 w-full p-8 lg:p-10">
                <div className="max-w-5xl mx-auto rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 text-on-surface-variant">
                    Сначала выбери проект, чтобы открыть рабочую область канала.
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
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Рабочая область канала</div>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.24em]">
                                <Link to="/projects" className="text-primary/70 hover:text-primary transition-colors">Проект</Link>
                                <span className="text-on-surface-variant/50">/</span>
                                <span className="text-on-surface-variant">{currentProject.name}</span>
                            </div>
                            <h1 className="mt-4 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                {selectedChannel?.name || 'Загружаем канал'}
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                Этот канал — исполнительная поверхность, где перед публикацией сходятся файлы из плана, входы из парсеров, ручные загрузки и сгенерированные черновики.
                            </p>
                            {selectedChannel && (
                                <div className="mt-6 flex flex-wrap gap-3">
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-primary">
                                        {selectedChannel.type}
                                    </span>
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                        {selectedChannelTasks.length} задач
                                    </span>
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                        {publishedTasks} опубликовано
                                    </span>
                                    {overdueTasks > 0 && (
                                        <span className="px-3 py-1 rounded-full bg-error-container/40 text-[10px] font-black uppercase tracking-widest text-error">
                                            {overdueTasks} просрочено
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-[320px]">
                            <Link
                                to="/publication-tasks"
                                className="rounded-2xl ai-gradient text-white px-5 py-4 text-sm font-black text-center shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all"
                            >
                                Открыть публикации
                            </Link>
                            <Link
                                to="/analytics"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Смотреть аналитику
                            </Link>
                            <Link
                                to="/parsers"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Лаборатория парсеров
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Каналы проекта</div>
                            <h2 className="mt-2 text-xl font-headline font-black text-on-surface">Сеть</h2>
                            <p className="mt-2 text-sm text-on-surface-variant">
                                Переключайся между соседними каналами, не теряя контекст проекта.
                            </p>
                        </div>
                        <div className="max-h-[900px] overflow-y-auto">
                            {(projectData?.channels || []).map((channel) => {
                                const isSelected = channel.id === selectedChannel?.id
                                const taskCount = publicationTasks?.filter((task) => task.channel?.id === channel.id).length || 0

                                return (
                                    <Link
                                        key={channel.id}
                                        to={`/channels/${channel.id}`}
                                        className={`block px-5 py-4 border-b border-outline-variant/10 transition-all ${isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-lowest'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${isSelected ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant'}`}>
                                                    <span className="material-symbols-outlined">{channelIcon(channel.type)}</span>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-on-surface truncate">{channel.name}</div>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 mt-1">{channel.type}</div>
                                                </div>
                                            </div>
                                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                {taskCount}
                                            </span>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    </div>

                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        {!selectedChannel ? (
                            <div className="h-full min-h-[720px] flex items-center justify-center p-10 text-center text-on-surface-variant">
                                Загружаем рабочую область канала...
                            </div>
                        ) : (
                            <div className="h-full overflow-y-auto">
                                <div className="p-7 border-b border-outline-variant/10">
                                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">
                                                {selectedChannel.type} channel
                                            </div>
                                            <h2 className="mt-2 text-3xl font-headline font-black text-on-surface">{selectedChannel.name}</h2>
                                            <p className="mt-3 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                Выбери, как контент попадает в этот канал, посмотри связанные плановые ресурсы и отправь готовый материал в публикации и аналитику.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'plan', label: 'Файлы плана' },
                                                { id: 'manual', label: 'Ручная загрузка' },
                                                { id: 'generate', label: 'Генерация' },
                                                { id: 'mcp', label: 'Парсер / MCP' }
                                            ].map((mode) => (
                                                <button
                                                    key={mode.id}
                                                    onClick={() => setSourceMode(mode.id as typeof sourceMode)}
                                                    className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${sourceMode === mode.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-surface-container-high text-on-surface hover:bg-primary/10 hover:text-primary'}`}
                                                >
                                                    {mode.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-7 space-y-7">
                                    <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Сводка канала</div>
                                            <div className="mt-4 space-y-3 text-sm text-on-surface-variant">
                                                <div><span className="font-bold text-on-surface">Тип:</span> {selectedChannel.type}</div>
                                                <div><span className="font-bold text-on-surface">Название:</span> {selectedChannel.name}</div>
                                                <div><span className="font-bold text-on-surface">Задачи:</span> {selectedChannelTasks.length}</div>
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Связанная сеть</div>
                                            <div className="mt-4 text-sm leading-7 text-on-surface-variant">
                                                Этот канал остаётся связанным с остальным проектом через план публикаций, граф зависимостей, общие parser recipes и пост-публикационную аналитику.
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Следующие действия</div>
                                            <div className="mt-4 flex flex-col gap-3">
                                                <Link to="/publication-tasks" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Открыть задачи канала
                                                </Link>
                                                <Link to="/analytics" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Посмотреть метрики
                                                </Link>
                                            </div>
                                        </div>
                                    </section>

                                    {sourceMode === 'plan' && (
                                        <section className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6">
                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Источники из плана</div>
                                                {selectedChannelTasks.length > 0 ? selectedChannelTasks.map((task) => (
                                                    <div key={task.id} className="rounded-2xl bg-white px-4 py-4 space-y-2">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <div className="font-bold text-sm text-on-surface">{task.title || task.type}</div>
                                                                {task.brief && (
                                                                    <div className="mt-2 text-xs leading-6 text-on-surface-variant">{task.brief}</div>
                                                                )}
                                                            </div>
                                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusTone(task.status)}`}>
                                                                {task.status}
                                                            </span>
                                                        </div>
                                                        {task.published_link && (
                                                            <a
                                                                href={task.published_link}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-xs font-bold text-primary hover:underline"
                                                            >
                                                                Открыть live URL
                                                            </a>
                                                        )}
                                                    </div>
                                                )) : (
                                                    <div className="rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant">
                                                        С этим каналом пока не связаны задачи из плана публикаций.
                                                    </div>
                                                )}
                                            </div>

                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Разрешённые ресурсные файлы</div>
                                                {resourceFiles.length > 0 ? (
                                                    <div className="space-y-4">
                                                        {resourceFiles.map((file, index) => (
                                                            <div key={`${file.ref || file.file_name || 'resource'}-${index}`} className="rounded-2xl bg-white px-4 py-4 space-y-2">
                                                                {(() => {
                                                                    const inlineContent = resourceContent(file as JsonRecord)
                                                                    const isMissing = file.exists === false && !inlineContent
                                                                    return (
                                                                        <>
                                                                <div className="font-bold text-sm text-on-surface">{file.file_name || file.url || file.ref || 'Ресурс'}</div>
                                                                {file.role && <div className="text-xs text-on-surface-variant">Роль: {file.role}</div>}
                                                                {file.relative_path && <div className="text-xs text-on-surface-variant break-all">{file.relative_path}</div>}
                                                                {file.section_marker && <div className="text-xs text-on-surface-variant">Секция: {file.section_marker}</div>}
                                                                {file.url && <div className="text-xs text-on-surface-variant break-all">{file.url}</div>}
                                                                {file.purpose && <div className="text-xs leading-6 text-on-surface-variant">{file.purpose}</div>}
                                                                <div className={`text-xs font-bold ${isMissing ? 'text-error' : 'text-success'}`}>
                                                                    {isMissing ? 'Недоступно в текущем runtime-пути' : 'Доступно'}
                                                                </div>
                                                                {inlineContent && (
                                                                    <ContentMarkupRenderer
                                                                        content={inlineContent}
                                                                        contentType="auto"
                                                                        title={file.file_name || file.ref || `resource-${index}`}
                                                                        className="mt-3"
                                                                    />
                                                                )}
                                                                        </>
                                                                    )
                                                                })()}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant">
                                                        Подготовь handoff публикационной задачи, чтобы здесь появились связанные исходные файлы.
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    {sourceMode === 'manual' && (
                                        <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
                                            <div
                                                className="rounded-[1.5rem] bg-surface-container-low p-5 border border-dashed border-outline-variant/20"
                                                onDragOver={(event) => event.preventDefault()}
                                                onDrop={(event) => {
                                                    event.preventDefault()
                                                    const file = event.dataTransfer.files?.[0]
                                                    if (file) handleManualFile(file)
                                                }}
                                            >
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Ручная загрузка</div>
                                                <h3 className="mt-3 text-xl font-headline font-black text-on-surface">Перетащи `.md` или `.html`</h3>
                                                <p className="mt-3 text-sm leading-7 text-on-surface-variant">
                                                    Используй этот режим, когда контент канала не приходит из плана публикаций. Файл загружается в рабочую область, где его можно просмотреть, сохранить и при желании привязать к уже опубликованному URL.
                                                </p>
                                                <button
                                                    onClick={() => document.getElementById('manual-content-file')?.click()}
                                                    className="mt-6 rounded-2xl bg-primary text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all"
                                                >
                                                    Выбрать файл
                                                </button>
                                                <input
                                                    id="manual-content-file"
                                                    type="file"
                                                    accept=".md,.markdown,.html,.htm,text/markdown,text/html"
                                                    className="hidden"
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0]
                                                        if (file) handleManualFile(file)
                                                    }}
                                                />
                                                {manualFileName && (
                                                    <div className="mt-6 rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant">
                                                        <div className="font-bold text-on-surface">{manualFileName}</div>
                                                        <div className="mt-2 text-xs uppercase tracking-widest">{manualFileType}</div>
                                                    </div>
                                                )}
                                                <textarea
                                                    value={manualNote}
                                                    onChange={(event) => setManualNote(event.target.value)}
                                                    rows={4}
                                                    className="mt-4 w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:ring-2 focus:ring-primary/20 outline-none"
                                                    placeholder="Необязательная заметка для этого элемента контента"
                                                />
                                                <label className="mt-4 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-on-surface">
                                                    <input
                                                        type="checkbox"
                                                        checked={manualPublishNow}
                                                        onChange={(event) => setManualPublishNow(event.target.checked)}
                                                        className="w-4 h-4 rounded border-outline-variant/20 text-primary focus:ring-primary/20"
                                                    />
                                                    Этот контент уже опубликован
                                                </label>
                                                {manualPublishNow && (
                                                    <div className="mt-4 space-y-4">
                                                        <input
                                                            type="url"
                                                            value={manualPublishedLink}
                                                            onChange={(event) => setManualPublishedLink(event.target.value)}
                                                            className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                            placeholder="https://..."
                                                        />
                                                        <select
                                                            value={manualOutcome}
                                                            onChange={(event) => setManualOutcome(event.target.value as PublicationOutcome)}
                                                            className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        >
                                                            <option value="published">Опубликовано нормально</option>
                                                            <option value="blocked">Заблокировано, но URL есть</option>
                                                            <option value="removed">Удалено, но URL есть</option>
                                                            <option value="restricted">Ограниченная видимость</option>
                                                        </select>
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => saveManualContent.mutate()}
                                                    disabled={saveManualContent.isPending || !manualFileContent.trim() || (manualPublishNow && !manualPublishedLink.trim())}
                                                    className="mt-4 w-full rounded-2xl bg-primary text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {saveManualContent.isPending ? 'Сохраняем в канал...' : 'Сохранить в канал'}
                                                </button>
                                                {manualMessage && (
                                                    <div className="mt-4 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                                                        {manualMessage}
                                                    </div>
                                                )}
                                                {saveManualContent.error instanceof Error && (
                                                    <div className="mt-4 rounded-2xl bg-error-container/30 text-error px-4 py-3 text-sm font-medium">
                                                        {saveManualContent.error.message}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Предпросмотр контента</div>
                                                    {manualFileName && (
                                                        <span className="text-xs text-on-surface-variant">{manualFileName}</span>
                                                    )}
                                                </div>
                                                <ContentMarkupRenderer
                                                    content={manualFileContent}
                                                    contentType={manualFileType === 'unknown' ? 'auto' : manualFileType}
                                                    title={manualFileName || 'manual-upload-preview'}
                                                    emptyMessage="Загрузи markdown или HTML-файл, чтобы увидеть здесь предпросмотр контента канала."
                                                />
                                            </div>
                                        </section>
                                    )}

                                    {sourceMode === 'generate' && (
                                        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                            {[
                                                {
                                                    title: 'Сгенерировать новый пост',
                                                    body: 'Используй существующие сценарии генерации постов, циклы критики и генерацию изображений прямо внутри проекта.',
                                                    href: '/'
                                                },
                                                {
                                                    title: 'Очередь публикаций',
                                                    body: 'Переходи в очередь исполнения после подготовки контента и не теряй связь канала с планом.',
                                                    href: '/publication-tasks'
                                                },
                                                {
                                                    title: 'Настройки агентов',
                                                    body: 'Настраивай промпты, модели, skill connections и словарь под поведение генерации в этом проекте.',
                                                    href: '/settings'
                                                }
                                            ].map((card) => (
                                                <Link key={card.title} to={card.href} className="rounded-[1.5rem] bg-surface-container-low p-6 border border-outline-variant/10 hover:bg-primary/5 transition-all">
                                                    <div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
                                                        <span className="material-symbols-outlined">auto_awesome</span>
                                                    </div>
                                                    <h3 className="mt-5 text-xl font-headline font-black text-on-surface">{card.title}</h3>
                                                    <p className="mt-3 text-sm leading-7 text-on-surface-variant">{card.body}</p>
                                                </Link>
                                            ))}
                                        </section>
                                    )}

                                    {sourceMode === 'mcp' && (
                                        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
                                            <div className="rounded-[1.5rem] bg-surface-container-low p-6">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Парсер и MCP</div>
                                                <h3 className="mt-3 text-2xl font-headline font-black text-on-surface">Поверхность исследования и intake</h3>
                                                <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                    Переводи внешние исследования в материал для канала: запускай parser jobs, смотри результаты, переиспользуй рецепты и передавай сильнейшие сигналы в контентный поток.
                                                </p>
                                            </div>
                                            <div className="space-y-4">
                                                <Link to="/parsers" className="block rounded-[1.5rem] ai-gradient text-white p-6 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">Исследовательская лаборатория</div>
                                                    <h3 className="mt-3 text-2xl font-headline font-black">Открыть парсеры</h3>
                                                    <p className="mt-4 text-sm leading-7 text-white/80">
                                                        Перейди в интерфейс парсеров для discovery, скоринга и работы с источниками через MCP.
                                                    </p>
                                                </Link>
                                                <Link to="/recipes" className="block rounded-[1.5rem] bg-surface-container-low p-6 border border-outline-variant/10 hover:bg-primary/5 transition-all">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Переиспользуемые активы</div>
                                                    <h3 className="mt-3 text-xl font-headline font-black text-on-surface">Сохранённые рецепты</h3>
                                                    <p className="mt-3 text-sm leading-7 text-on-surface-variant">
                                                        Просматривай рецепты парсеров и заново запускай те, что подходят под discovery-паттерн этого канала.
                                                    </p>
                                                </Link>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    )
}
