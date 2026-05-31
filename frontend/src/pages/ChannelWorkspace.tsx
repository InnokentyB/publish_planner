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
    const resourceFiles = ((selectedTask?.quality_report?.handoff_bundle?.resource_files as ResourceFile[] | undefined)
        || []) as ResourceFile[]
    const publishedTasks = selectedChannelTasks.filter((task) => task.status === 'published').length
    const overdueTasks = selectedChannelTasks.filter((task) => {
        if (!task.schedule_at) return false
        return ['planned', 'ready_for_execution', 'awaiting_manual_publication'].includes(task.status)
            && new Date(task.schedule_at).getTime() < Date.now()
    }).length

    const saveManualContent = useMutation({
        mutationFn: () => {
            if (!currentProject?.id || !selectedChannel?.id) {
                throw new Error('Select a project channel first')
            }
            if (!manualFileContent.trim()) {
                throw new Error('Upload a file first')
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
                ? `Saved to ${selectedChannel?.name} and linked to the already published content.`
                : `Saved to ${selectedChannel?.name}.`)
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
                    Select a project first to open a channel workspace.
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
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Channel Workspace</div>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.24em]">
                                <Link to="/projects" className="text-primary/70 hover:text-primary transition-colors">Project</Link>
                                <span className="text-on-surface-variant/50">/</span>
                                <span className="text-on-surface-variant">{currentProject.name}</span>
                            </div>
                            <h1 className="mt-4 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                {selectedChannel?.name || 'Loading channel'}
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                This channel is the execution surface where plan files, parser inputs, manual uploads, and generated drafts come together before publication.
                            </p>
                            {selectedChannel && (
                                <div className="mt-6 flex flex-wrap gap-3">
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-primary">
                                        {selectedChannel.type}
                                    </span>
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                        {selectedChannelTasks.length} tasks
                                    </span>
                                    <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                        {publishedTasks} published
                                    </span>
                                    {overdueTasks > 0 && (
                                        <span className="px-3 py-1 rounded-full bg-error-container/40 text-[10px] font-black uppercase tracking-widest text-error">
                                            {overdueTasks} overdue
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
                                Open Publishing
                            </Link>
                            <Link
                                to="/analytics"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                View Analytics
                            </Link>
                            <Link
                                to="/parsers"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Parser Lab
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Project Channels</div>
                            <h2 className="mt-2 text-xl font-headline font-black text-on-surface">Network</h2>
                            <p className="mt-2 text-sm text-on-surface-variant">
                                Jump across sibling channels without leaving the project context.
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
                                Loading channel workspace...
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
                                                Choose how content enters this channel, inspect linked plan assets, and route the finished material into publishing and analytics.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'plan', label: 'Plan Files' },
                                                { id: 'manual', label: 'Manual Upload' },
                                                { id: 'generate', label: 'Generate' },
                                                { id: 'mcp', label: 'Parser / MCP' }
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
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Channel Summary</div>
                                            <div className="mt-4 space-y-3 text-sm text-on-surface-variant">
                                                <div><span className="font-bold text-on-surface">Type:</span> {selectedChannel.type}</div>
                                                <div><span className="font-bold text-on-surface">Name:</span> {selectedChannel.name}</div>
                                                <div><span className="font-bold text-on-surface">Tasks:</span> {selectedChannelTasks.length}</div>
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Connected Network</div>
                                            <div className="mt-4 text-sm leading-7 text-on-surface-variant">
                                                This channel stays linked to the rest of the project through the publication plan, dependency graph, shared parser recipes, and post-publication analytics.
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Next Actions</div>
                                            <div className="mt-4 flex flex-col gap-3">
                                                <Link to="/publication-tasks" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Open channel tasks
                                                </Link>
                                                <Link to="/analytics" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Review metrics
                                                </Link>
                                            </div>
                                        </div>
                                    </section>

                                    {sourceMode === 'plan' && (
                                        <section className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6">
                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Plan Sources</div>
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
                                                                Open live URL
                                                            </a>
                                                        )}
                                                    </div>
                                                )) : (
                                                    <div className="rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant">
                                                        No publication-plan tasks are linked to this channel yet.
                                                    </div>
                                                )}
                                            </div>

                                            <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Resolved Resource Files</div>
                                                {resourceFiles.length > 0 ? (
                                                    <div className="space-y-4">
                                                        {resourceFiles.map((file, index) => (
                                                            <div key={`${file.ref || file.file_name || 'resource'}-${index}`} className="rounded-2xl bg-white px-4 py-4 space-y-2">
                                                                <div className="font-bold text-sm text-on-surface">{file.file_name || file.url || file.ref || 'Resource'}</div>
                                                                {file.role && <div className="text-xs text-on-surface-variant">Role: {file.role}</div>}
                                                                {file.relative_path && <div className="text-xs text-on-surface-variant break-all">{file.relative_path}</div>}
                                                                {file.section_marker && <div className="text-xs text-on-surface-variant">Section: {file.section_marker}</div>}
                                                                {file.url && <div className="text-xs text-on-surface-variant break-all">{file.url}</div>}
                                                                {file.purpose && <div className="text-xs leading-6 text-on-surface-variant">{file.purpose}</div>}
                                                                <div className={`text-xs font-bold ${file.exists === false ? 'text-error' : 'text-success'}`}>
                                                                    {file.exists === false ? 'Not available in current runtime path' : 'Available'}
                                                                </div>
                                                                {file.content && (
                                                                    <ContentMarkupRenderer
                                                                        content={file.content}
                                                                        contentType="auto"
                                                                        title={file.file_name || file.ref || `resource-${index}`}
                                                                        className="mt-3"
                                                                    />
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant">
                                                        Prepare a publication task handoff to populate linked source files here.
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
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Manual Upload</div>
                                                <h3 className="mt-3 text-xl font-headline font-black text-on-surface">Drop `.md` or `.html`</h3>
                                                <p className="mt-3 text-sm leading-7 text-on-surface-variant">
                                                    Use this when the channel content does not come from the publication plan. The file is loaded into the workspace so you can review it, save it, and optionally attach the already published URL.
                                                </p>
                                                <button
                                                    onClick={() => document.getElementById('manual-content-file')?.click()}
                                                    className="mt-6 rounded-2xl bg-primary text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all"
                                                >
                                                    Choose File
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
                                                    placeholder="Optional note for this channel content item"
                                                />
                                                <label className="mt-4 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-on-surface">
                                                    <input
                                                        type="checkbox"
                                                        checked={manualPublishNow}
                                                        onChange={(event) => setManualPublishNow(event.target.checked)}
                                                        className="w-4 h-4 rounded border-outline-variant/20 text-primary focus:ring-primary/20"
                                                    />
                                                    This content is already published
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
                                                            <option value="published">Published normally</option>
                                                            <option value="blocked">Blocked but URL exists</option>
                                                            <option value="removed">Removed but URL exists</option>
                                                            <option value="restricted">Restricted / limited visibility</option>
                                                        </select>
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => saveManualContent.mutate()}
                                                    disabled={saveManualContent.isPending || !manualFileContent.trim() || (manualPublishNow && !manualPublishedLink.trim())}
                                                    className="mt-4 w-full rounded-2xl bg-primary text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {saveManualContent.isPending ? 'Saving To Channel...' : 'Save To Channel'}
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
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Content Preview</div>
                                                    {manualFileName && (
                                                        <span className="text-xs text-on-surface-variant">{manualFileName}</span>
                                                    )}
                                                </div>
                                                <ContentMarkupRenderer
                                                    content={manualFileContent}
                                                    contentType={manualFileType === 'unknown' ? 'auto' : manualFileType}
                                                    title={manualFileName || 'manual-upload-preview'}
                                                    emptyMessage="Upload a markdown or HTML file to preview channel content here."
                                                />
                                            </div>
                                        </section>
                                    )}

                                    {sourceMode === 'generate' && (
                                        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                            {[
                                                {
                                                    title: 'Generate New Post',
                                                    body: 'Use the planner’s existing post generation flows, critique loops, and image generation inside the project.',
                                                    href: '/'
                                                },
                                                {
                                                    title: 'Publishing Queue',
                                                    body: 'Jump into the execution queue after content is ready and keep the channel workflow connected to the plan.',
                                                    href: '/publication-tasks'
                                                },
                                                {
                                                    title: 'Agent Settings',
                                                    body: 'Tune prompts, models, skill connections, and dictionary rules for project-specific generation behavior.',
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
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Parser & MCP Intake</div>
                                                <h3 className="mt-3 text-2xl font-headline font-black text-on-surface">Research and ingestion surface</h3>
                                                <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                    Move from external research into channel-ready material: run parser jobs, inspect results, reuse saved recipes, and hand off the strongest signals into the content flow.
                                                </p>
                                            </div>
                                            <div className="space-y-4">
                                                <Link to="/parsers" className="block rounded-[1.5rem] ai-gradient text-white p-6 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">Research Lab</div>
                                                    <h3 className="mt-3 text-2xl font-headline font-black">Open Parsers</h3>
                                                    <p className="mt-4 text-sm leading-7 text-white/80">
                                                        Go to the parser interface for discovery, scoring, and MCP-connected source work.
                                                    </p>
                                                </Link>
                                                <Link to="/recipes" className="block rounded-[1.5rem] bg-surface-container-low p-6 border border-outline-variant/10 hover:bg-primary/5 transition-all">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Reusable Assets</div>
                                                    <h3 className="mt-3 text-xl font-headline font-black text-on-surface">Saved Recipes</h3>
                                                    <p className="mt-3 text-sm leading-7 text-on-surface-variant">
                                                        Browse parser recipes and rerun the ones that fit this channel’s discovery pattern.
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
