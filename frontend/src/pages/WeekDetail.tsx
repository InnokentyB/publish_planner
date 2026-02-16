import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useState } from 'react'
import { api, presetsApi } from '../api' // Mock/real api
import CommentSection from '../components/CommentSection'
import { useAuth } from '../context/AuthContext'

interface Post {
    id: number
    topic: string
    category: string | null
    tags: string[]
    status: string
    publish_at: string
    generated_text: string | null
    image_url?: string | null
    telegram_message_id?: number | null
    published_link?: string | null
}

interface Week {
    id: number
    theme: string
    week_start: string
    week_end: string
    status: string
    posts: Post[]
}

interface PromptPreset {
    id: number
    name: string
    role: string
}

export default function WeekDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()

    // State
    const [isGeneratingTopics, setIsGeneratingTopics] = useState(false)
    const [generatingPostId, setGeneratingPostId] = useState<number | null>(null)
    const [selectedPresetId, setSelectedPresetId] = useState<number | ''>('')

    // Queries
    const { data: presets } = useQuery<PromptPreset[]>({
        queryKey: ['presets', currentProject?.id],
        queryFn: () => presetsApi.getAll(),
        enabled: !!currentProject
    })

    const { data: week, isLoading } = useQuery<Week>({
        queryKey: ['week', id],
        queryFn: () => api.get(`/api/weeks/${id}`),
        enabled: !!currentProject
    })

    // Mutations
    const generateTopics = useMutation({
        mutationFn: async ({ overwrite }: { overwrite?: boolean } = {}) => {
            setIsGeneratingTopics(true)
            const body: any = { overwrite }
            if (selectedPresetId) body.promptPresetId = selectedPresetId
            return api.post(`/api/weeks/${id}/generate-topics`, body)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] })
            setIsGeneratingTopics(false)
        },
        onError: () => setIsGeneratingTopics(false)
    })

    const approveTopic = useMutation({
        mutationFn: (postId: number) => api.post(`/api/posts/${postId}/approve-topic`, {}),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['week', id] })
    })

    const generatePost = useMutation({
        mutationFn: async ({ postId, withImage }: { postId: number, withImage: boolean }) => {
            setGeneratingPostId(postId)
            return api.post(`/api/posts/${postId}/generate`, { withImage, promptPresetId: selectedPresetId || undefined })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] })
            setGeneratingPostId(null)
        },
        onError: () => setGeneratingPostId(null)
    })

    const publishNow = useMutation({
        mutationFn: (postId: number) => api.post(`/api/posts/${postId}/publish-now`, {}),
        onSuccess: () => {
            alert('Post published to Telegram!');
            queryClient.invalidateQueries({ queryKey: ['week', id] })
        },
        onError: (err: any) => alert('Failed to publish: ' + (err.response?.data?.error || err.message))
    })

    const generateImage = useMutation({
        mutationFn: (postId: number) => api.post(`/api/posts/${postId}/generate-image`, { provider: 'dalle' }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['week', id] }),
        onError: (err: any) => alert('Failed to generate image: ' + (err.response?.data?.error || err.message))
    });

    // Filtering Helper
    const unapprovedPosts = week?.posts?.filter(p => p.status === 'topics_generated') || []
    const approvedPosts = week?.posts?.filter(p => p.status === 'topics_approved') || []
    const completedPosts = week?.posts?.filter(p => ['generated', 'scheduled', 'published'].includes(p.status)) || []

    if (!currentProject) return <div className="p-4">Please select a project.</div>
    if (isLoading) return <div className="p-4">Loading...</div>
    if (!week) return <div className="p-4">Week not found</div>

    return (
        <div className="container pb-5">
            <div className="mb-3">
                <Link to="/" style={{ color: 'var(--text-muted)' }}>← Back to weeks</Link>
            </div>

            <div className="flex-between mb-4">
                <div>
                    <h1>{week.theme}</h1>
                    <div className="text-muted">
                        {format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d, yyyy')}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <span className={`badge badge-${week.status}`}>
                        {week.status.replace(/_/g, ' ')}
                    </span>
                    <div className="text-small text-muted mt-1">
                        {week.posts.length} / 14 Slots
                    </div>
                </div>
            </div>

            {/* Comments */}
            <div className="mb-3">
                <CommentSection entityType="week" entityId={week.id} />
            </div>

            {/* Config Area */}
            <div className="card mb-4">
                <div className="flex-between">
                    <div>
                        <label className="text-muted mr-2">Creator Persona:</label>
                        <select
                            value={selectedPresetId}
                            onChange={(e) => setSelectedPresetId(e.target.value ? Number(e.target.value) : '')}
                            style={{ padding: '5px' }}
                        >
                            <option value="">Default Style</option>
                            {presets?.filter(p => p.role === 'topic_creator' || p.role === 'post_creator').map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
                            ))}
                        </select>
                    </div>
                    {/* Generate Topics Button */}
                    {(week.posts.length < 14) && (
                        <button
                            className="btn-primary"
                            onClick={() => generateTopics.mutate({ overwrite: false })}
                            disabled={isGeneratingTopics}
                        >
                            {isGeneratingTopics ? 'Generating...' : (week.posts.length === 0 ? 'Generate 14 Topics' : `Generate Remaining (${14 - week.posts.length})`)}
                        </button>
                    )}
                    {(week.posts.length > 0) && (
                        <button
                            className="btn-secondary ml-2"
                            onClick={() => {
                                if (confirm('Regenerate ALL topics? This will wipe existing topics.'))
                                    generateTopics.mutate({ overwrite: true })
                            }}
                            disabled={isGeneratingTopics}
                        >
                            Regenerate All
                        </button>
                    )}
                </div>
            </div>

            <div className="grid-cols-1" style={{ display: 'grid', gap: '2rem' }}>

                {/* 1. Unapproved Topics */}
                {unapprovedPosts.length > 0 && (
                    <section>
                        <h3 className="mb-3" style={{ color: 'var(--text-color)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                            Unapproved Topics ({unapprovedPosts.length})
                        </h3>
                        <div className="grid">
                            {unapprovedPosts.map(post => (
                                <div key={post.id} className="card" style={{ background: 'var(--bg-tertiary)' }}>
                                    <div className="flex-between mb-2">
                                        <span className="badge badge-topics_generated">Topic</span>
                                        <span className="text-muted text-small">{format(new Date(post.publish_at), 'EEE, HH:mm')}</span>
                                    </div>
                                    <h4 className="mb-2">{post.topic}</h4>

                                    <div className="flex-center mt-3" style={{ gap: '10px' }}>
                                        <button
                                            className="btn-success flex-1"
                                            onClick={() => approveTopic.mutate(post.id)}
                                            disabled={approveTopic.isPending}
                                        >
                                            {approveTopic.isPending ? '...' : 'Approve Topic'}
                                        </button>
                                        {/* Edit/Regenerate could go here */}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* 2. Approved Topics (Ready to Generate) */}
                {approvedPosts.length > 0 && (
                    <section>
                        <h3 className="mb-3" style={{ color: 'var(--success)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                            Approved Topics ({approvedPosts.length})
                        </h3>
                        <div className="grid">
                            {approvedPosts.map(post => (
                                <div key={post.id} className="card" style={{ borderColor: 'var(--success)' }}>
                                    <div className="flex-between mb-2">
                                        <span className="badge badge-topics_approved">Approved</span>
                                        <span className="text-muted text-small">{format(new Date(post.publish_at), 'EEE, HH:mm')}</span>
                                    </div>
                                    <h4 className="mb-2">{post.topic}</h4>
                                    <div className="badges mb-3">
                                        {post.category && <span className="badge" style={{ background: 'var(--accent)' }}>{post.category}</span>}
                                    </div>

                                    <div className="actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <button
                                            className="btn-primary"
                                            onClick={() => generatePost.mutate({ postId: post.id, withImage: true })}
                                            disabled={generatingPostId === post.id}
                                        >
                                            {generatingPostId === post.id ? 'Generating...' : 'Generate Post'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* 3. Generated / Completed Posts */}
                {completedPosts.length > 0 && (
                    <section>
                        <h3 className="mb-3" style={{ color: 'var(--accent)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                            Ready to Publish ({completedPosts.length})
                        </h3>
                        {/* Use existing card style roughly */}
                        <div className="grid">
                            {completedPosts.map(post => (
                                <div
                                    key={post.id}
                                    className="card"
                                    style={{ cursor: 'pointer', opacity: post.status === 'published' ? 0.7 : 1 }}
                                    onClick={() => navigate(`/posts/${post.id}`)}
                                >
                                    <div className="flex-between mb-2">
                                        <span className={`badge badge-${post.status}`}>{post.status}</span>
                                        <span className="text-muted text-small">{format(new Date(post.publish_at), 'MMM d, HH:mm')}</span>
                                    </div>
                                    <h4 className="mb-2">{post.topic}</h4>
                                    {post.image_url && (
                                        <div className="mb-2">
                                            <img src={post.image_url} alt="Cover" style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '4px' }} />
                                        </div>
                                    )}
                                    <div className="flex-between mt-2">
                                        <button
                                            className="btn-success small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm('Publish now?')) publishNow.mutate(post.id);
                                            }}
                                            disabled={post.status === 'published'}
                                        >
                                            {post.status === 'published' ? 'Published' : 'Publish Now'}
                                        </button>
                                        <button
                                            className="btn-secondary small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                generateImage.mutate(post.id);
                                            }}
                                        >
                                            {post.image_url ? 'Regen Img' : 'Add Img'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {week.posts.length === 0 && !isGeneratingTopics && (
                    <div className="text-center p-5 text-muted">
                        No topics generated yet. Start by generating topics above.
                    </div>
                )}
            </div>
        </div>
    )
}
