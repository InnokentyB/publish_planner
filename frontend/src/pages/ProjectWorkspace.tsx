import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
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
    assets?: JsonRecord | null
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

export default function ProjectWorkspace() {
    const queryClient = useQueryClient()
    const { currentProject, projects, createProject, setCurrentProject } = useAuth()

    const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
    const [sourceMode, setSourceMode] = useState<'plan' | 'manual' | 'generate' | 'mcp'>('plan')
    const [showPlanModal, setShowPlanModal] = useState(false)
    const [planJson, setPlanJson] = useState(PUBLICATION_PLAN_TEMPLATE)
    const [planMessage, setPlanMessage] = useState<string | null>(null)
    const [manualMessage, setManualMessage] = useState<string | null>(null)
    const [manualFileName, setManualFileName] = useState('')
    const [manualFileContent, setManualFileContent] = useState('')
    const [manualFileType, setManualFileType] = useState<'markdown' | 'html' | 'unknown'>('unknown')
    const [manualNote, setManualNote] = useState('')
    const [manualPublishedLink, setManualPublishedLink] = useState('')
    const [manualPublishNow, setManualPublishNow] = useState(false)
    const [manualOutcome, setManualOutcome] = useState<PublicationOutcome>('published')

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

    const selectedChannel = useMemo(() => {
        if (!projectData?.channels?.length) return null
        return projectData.channels.find((channel) => channel.id === selectedChannelId) || projectData.channels[0]
    }, [projectData?.channels, selectedChannelId])

    const selectedChannelTasks = useMemo(() => {
        if (!selectedChannel || !publicationTasks) return []
        return publicationTasks.filter((task) => task.channel?.id === selectedChannel.id)
    }, [publicationTasks, selectedChannel])

    const selectedTask = selectedChannelTasks[0] || null
    const resourceFiles = ((selectedTask?.quality_report?.handoff_bundle?.resource_files as ResourceFile[] | undefined)
        || []) as ResourceFile[]

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
                ? `Saved to channel ${selectedChannel?.name} and linked to the already published content.`
                : `Saved to channel ${selectedChannel?.name}.`)
            queryClient.invalidateQueries({ queryKey: ['project_workspace_tasks'] })
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

    const projectMeta = useMemo(() => {
        const map = Object.fromEntries((projectData?.settings || []).map((setting) => [setting.key, setting.value]))
        return {
            planId: map.publication_plan_id || null,
            planMeta: map.publication_plan_meta ? JSON.parse(map.publication_plan_meta) : null
        }
    }, [projectData?.settings])

    return (
        <div className="flex-1 w-full p-8 lg:p-10 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto space-y-8">
                <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 lg:p-10">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
                        <div className="max-w-4xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Project Workspace</div>
                            <h1 className="mt-3 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                {currentProject?.name || 'Select a project'}
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                A project is the primary content network: a set of connected channels, one publication plan,
                                and several ways to bring content into each channel, from plan files and MCP to manual uploads and native generation.
                            </p>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {projectData?.channels?.length || 0} channels
                                </span>
                                <span className="px-3 py-1 rounded-full bg-surface-container-high text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {publicationTasks?.length || 0} publication tasks
                                </span>
                                {projectMeta.planId && (
                                    <span className="px-3 py-1 rounded-full bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary">
                                        Plan: {projectMeta.planId}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-[320px]">
                            <button
                                onClick={() => setShowPlanModal(true)}
                                className="rounded-2xl ai-gradient text-white px-5 py-4 text-sm font-black shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all"
                            >
                                Load Plan
                            </button>
                            <Link
                                to="/publication-tasks"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Open Publishing
                            </Link>
                            <Link
                                to="/parsers"
                                className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all"
                            >
                                Parser Interface
                            </Link>
                        </div>
                    </div>

                    {planMessage && (
                        <div className="mt-6 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                            {planMessage}
                        </div>
                    )}
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 min-h-[720px]">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Level Two</div>
                            <h2 className="mt-2 text-xl font-headline font-black text-on-surface">Channels</h2>
                            <p className="mt-2 text-sm text-on-surface-variant">
                                Every channel is a reusable execution surface inside the project network.
                            </p>
                        </div>

                        <div className="max-h-[720px] overflow-y-auto">
                            {(projectData?.channels || []).map((channel) => {
                                const isSelected = channel.id === selectedChannel?.id
                                const taskCount = publicationTasks?.filter((task) => task.channel?.id === channel.id).length || 0

                                return (
                                    <button
                                        key={channel.id}
                                        onClick={() => setSelectedChannelId(channel.id)}
                                        className={`w-full text-left px-5 py-4 border-b border-outline-variant/10 transition-all ${isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-lowest'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${isSelected ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant'}`}>
                                                        <span className="material-symbols-outlined">{channelIcon(channel.type)}</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-sm text-on-surface truncate">{channel.name}</div>
                                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 mt-1">{channel.type}</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                {taskCount} tasks
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}

                            {!projectData?.channels?.length && (
                                <div className="p-8 text-sm text-on-surface-variant">
                                    No channels yet. Start by loading a publication plan or add channels in Settings.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        {!selectedChannel && (
                            <div className="h-full min-h-[720px] flex items-center justify-center p-10 text-center text-on-surface-variant">
                                Select a project channel to manage its content intake and execution surfaces.
                            </div>
                        )}

                        {selectedChannel && (
                            <div className="h-full max-h-[720px] overflow-y-auto">
                                <div className="p-7 border-b border-outline-variant/10">
                                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">
                                                {selectedChannel.type} channel
                                            </div>
                                            <h2 className="mt-2 text-3xl font-headline font-black text-on-surface">{selectedChannel.name}</h2>
                                            <p className="mt-3 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                This channel can ingest content from publication-plan files, future MCP sources, manual markdown or HTML uploads, or native generation flows already available in the planner.
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
                                                Project channels stay linked by a shared publication plan, content dependencies, analytics, and follow-up actions.
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Next Actions</div>
                                            <div className="mt-4 flex flex-col gap-3">
                                                <Link to="/publication-tasks" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Open channel tasks
                                                </Link>
                                                <Link to="/settings" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-white transition-all">
                                                    Edit project channels
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
                                                    Use this when the channel content does not come from the publication plan. The file is loaded directly into the UI workspace so you can review and route it into the channel flow.
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
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Local Content Preview</div>
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
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Parser & MCP Ingestion</div>
                                                <h3 className="mt-3 text-2xl font-headline font-black text-on-surface">Future source orchestration surface</h3>
                                                <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                    This slot is intentionally reserved for parser outputs, MCP-connected content sources, and structured external ingestion flows. The navigation is already wired so the parser product area can be designed next without another IA refactor.
                                                </p>
                                            </div>
                                            <Link to="/parsers" className="rounded-[1.5rem] ai-gradient text-white p-6 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">Next Workspace</div>
                                                <h3 className="mt-3 text-2xl font-headline font-black">Open Parsers</h3>
                                                <p className="mt-4 text-sm leading-7 text-white/80">
                                                    Go to the parser interface scaffold and design the next layer around discovery, ingestion, and MCP.
                                                </p>
                                            </Link>
                                        </section>
                                    )}
                                </div>
                            </div>
                        )}
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
                                    Import a plan into the current project network. This keeps project-first workflow front and center while publishing remains a second-level execution surface.
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
