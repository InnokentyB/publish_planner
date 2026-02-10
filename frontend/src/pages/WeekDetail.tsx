import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useState } from 'react'
import { api, presetsApi } from '../api'
import CommentSection from '../components/CommentSection'

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
    topics?: { topic: string; category: string; tags: string[] }[]
}

interface PromptPreset {
    id: number
    name: string
    role: string
}

import { useAuth } from '../context/AuthContext'

export default function WeekDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [isGeneratingTopics, setIsGeneratingTopics] = useState(false)
    const [isGeneratingPosts, setIsGeneratingPosts] = useState(false)
    const [selectedPresetId, setSelectedPresetId] = useState<number | ''>('')

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

    const generateTopics = useMutation({
        mutationFn: async () => {
            setIsGeneratingTopics(true)
            const body: any = {}
            if (selectedPresetId) body.promptPresetId = selectedPresetId
            return api.post(`/api/weeks/${id}/generate-topics`, body)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] })
            setIsGeneratingTopics(false)
        },
        onError: () => setIsGeneratingTopics(false)
    })

    const approveTopics = useMutation({
        mutationFn: () => api.post(`/api/weeks/${id}/approve-topics`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] })
        }
    })

    const generatePosts = useMutation({
        mutationFn: async () => {
            setIsGeneratingPosts(true)
            return api.post(`/api/weeks/${id}/generate-posts`, {})
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] })
            setIsGeneratingPosts(false)
        },
        onError: () => setIsGeneratingPosts(false)
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
        mutationFn: (postId: number) => api.post(`/api/posts/${postId}/generate-image`, { provider: 'dalle' }), // Default to dalle for now
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] });
        },
        onError: (err: any) => alert('Failed to generate image: ' + (err.response?.data?.error || err.message))
    });

    if (!currentProject) {
        return (
            <div className="container">
                <div className="card text-center p-3">
                    <h2>No Project Selected</h2>
                    <p className="text-muted">Please select a project to view week details.</p>
                </div>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="container">
                <div className="flex-center" style={{ justifyContent: 'center', padding: '4rem' }}>
                    <div className="loading"></div>
                    <span>Loading week...</span>
                </div>
            </div>
        )
    }

    if (!week) {
        return (
            <div className="container">
                <div className="error">Week not found</div>
            </div>
        )
    }

    return (
        <div className="container">
            <div className="mb-3">
                <Link to="/" style={{ color: 'var(--text-muted)' }}>← Back to weeks</Link>
            </div>

            <div className="flex-between mb-3">
                <div>
                    <h1>{week.theme}</h1>
                    <div className="text-muted">
                        {format(new Date(week.week_start), 'MMM d')} - {format(new Date(week.week_end), 'MMM d, yyyy')}
                    </div>
                </div>
                <span className={`badge badge-${week.status}`}>
                    {week.status.replace(/_/g, ' ')}
                </span>
            </div>

            <div className="mb-3">
                <CommentSection entityType="week" entityId={week.id} />
            </div>

            {week.status === 'planning' && (
                <div className="card mb-3">
                    <h3>Generate Topics</h3>
                    <h3>Generate Topics</h3>
                    <p className="text-muted mb-2">
                        Use AI to generate the first <b>5 topic ideas</b> for this week's theme.
                    </p>

                    <div className="mb-2" style={{ maxWidth: '300px' }}>
                        <label className="text-muted" style={{ fontSize: '0.9rem' }}>Style Preset (Creator)</label>
                        <select
                            value={selectedPresetId}
                            onChange={(e) => setSelectedPresetId(e.target.value ? Number(e.target.value) : '')}
                        >
                            <option value="">Default Style</option>
                            {presets?.filter(p => p.role === 'topic_creator').map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <button
                        className="btn-primary"
                        onClick={() => generateTopics.mutate()}
                        disabled={isGeneratingTopics}
                    >
                        {isGeneratingTopics ? (
                            <span className="flex-center"><div className="loading"></div> Generating...</span>
                        ) : 'Generate 5 Topics'}
                    </button>
                </div>
            )}

            {week.status === 'topics_generated' && (week.topics || week.posts.some(p => p.status === 'topics_generated')) && (
                <div className="card mb-3">
                    <h3>Review Topics</h3>
                    <div className="grid" style={{ gap: '1rem', marginBottom: '1rem' }}>
                        {(week.topics || week.posts.filter(p => p.status === 'topics_generated')).map((topic, idx) => (
                            <div key={idx} className="card" style={{ background: 'var(--bg-tertiary)' }}>
                                <h4>{topic.topic}</h4>
                                <div className="flex-center" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <span className="badge" style={{ background: 'var(--accent)' }}>{topic.category}</span>
                                    {topic.tags.map((tag, i) => (
                                        <span key={i} className="badge" style={{ background: 'var(--bg-primary)' }}>
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex-center" style={{ gap: '1rem' }}>
                        <button
                            className="btn-secondary"
                            onClick={() => {
                                if (window.confirm('Are you sure? This will overwrite existing topics.')) {
                                    generateTopics.mutate()
                                }
                            }}
                            disabled={isGeneratingTopics || approveTopics.isPending}
                        >
                            {isGeneratingTopics ? 'Regenerating...' : 'Regenerate Topics'}
                        </button>
                        <button
                            className="btn-success"
                            onClick={() => approveTopics.mutate()}
                            disabled={approveTopics.isPending || isGeneratingTopics}
                        >
                            {approveTopics.isPending ? 'Approving...' : 'Approve Topics'}
                        </button>
                    </div>
                </div>
            )}

            {(week.posts.length > 0) && (
                <div className="card mb-3">
                    <h3>Posts</h3>
                    {week.posts.filter(p => p.status !== 'topics_generated').length === 0 ? (
                        <p className="text-muted">No posts yet.</p>
                    ) : (
                        <div className="grid" style={{ gap: '1rem' }}>
                            {week.posts.filter(p => p.status !== 'topics_generated').map((post) => (
                                <div
                                    key={post.id}
                                    className="card"
                                    style={{ background: 'var(--bg-tertiary)', cursor: 'pointer' }}
                                    onClick={() => navigate(`/posts/${post.id}`)}
                                >
                                    <div className="flex-between mb-2">
                                        <h4 style={{ margin: 0 }}>{post.topic}</h4>
                                        <span className={`badge badge-${post.status}`}>
                                            {post.status}
                                        </span>
                                    </div>
                                    <div className="text-muted">
                                        📅 {format(new Date(post.publish_at), 'MMM d, HH:mm')}
                                    </div>
                                    {post.image_url && (
                                        <div className="mt-2 text-center">
                                            <img src={post.image_url} alt="Post visual" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '4px' }} />
                                        </div>
                                    )}
                                    <div className="flex-center mt-2" style={{ gap: '0.5rem' }}>
                                        {post.category && (
                                            <span className="badge" style={{ background: 'var(--accent)' }}>{post.category}</span>
                                        )}
                                        {post.tags.map((tag, i) => (
                                            <span key={i} className="badge" style={{ background: 'var(--bg-primary)' }}>
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex-center mt-2" style={{ gap: '0.5rem' }}>
                                        <button
                                            className="btn-secondary"
                                            style={{ flex: 1, fontSize: '0.9rem', padding: '5px' }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (window.confirm('Generate image for this post?')) {
                                                    generateImage.mutate(post.id);
                                                }
                                            }}
                                            disabled={generateImage.isPending}
                                        >
                                            {generateImage.isPending ? 'Generating...' : (post.image_url ? 'Regenerate Image' : 'Generate Image')}
                                        </button>
                                        {post.status === 'published' && post.published_link && (
                                            <a
                                                href={post.published_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn-primary"
                                                style={{ flex: 1, fontSize: '0.9rem', padding: '5px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                View on Telegram
                                            </a>
                                        )}
                                        <button
                                            className="btn-success"
                                            style={{ flex: 1, fontSize: '0.9rem', padding: '5px' }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (window.confirm('Publish this post to Telegram immediately?')) {
                                                    publishNow.mutate(post.id);
                                                }
                                            }}
                                            disabled={publishNow.isPending || post.status === 'published'}
                                        >
                                            {publishNow.isPending ? 'Publishing...' : 'Publish Now'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {week.status === 'topics_approved' && (
                        <button
                            className="btn-primary mt-2"
                            onClick={() => generatePosts.mutate()}
                            disabled={isGeneratingPosts}
                        >
                            {isGeneratingPosts ? (
                                <span className="flex-center"><div className="loading"></div> Generating Posts...</span>
                            ) : 'Generate All Posts'}
                        </button>
                    )}

                    {/* Generate More Topics Button (Staged Generation) */}
                    {(week.status === 'topics_approved' || week.status === 'generated' || week.status === 'completed') && week.posts.length < 14 && (
                        <div className="mt-3 p-3 card" style={{ border: '1px dashed var(--border-color)', background: 'transparent' }}>
                            <h4>Need more topics?</h4>
                            <p className="text-muted">
                                You currently have {week.posts.length} topics.
                                {week.posts.length < 10 ? ' Generate 5 more.' : ' Generate final 4.'}
                            </p>
                            <div className="mb-2" style={{ maxWidth: '300px' }}>
                                <label className="text-muted" style={{ fontSize: '0.9rem' }}>Style Preset</label>
                                <select
                                    value={selectedPresetId}
                                    onChange={(e) => setSelectedPresetId(e.target.value ? Number(e.target.value) : '')}
                                >
                                    <option value="">Default Style</option>
                                    {presets?.filter(p => p.role === 'topic_creator').map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                className="btn-secondary"
                                onClick={() => generateTopics.mutate()}
                                disabled={isGeneratingTopics}
                            >
                                {isGeneratingTopics ? (
                                    <span className="flex-center"><div className="loading"></div> Generating...</span>
                                ) : (week.posts.length < 10 ? '+ Generate 5 More Topics' : '+ Generate 4 More Topics')}
                            </button>
                        </div>
                    )}
                </div>
            )
            }
        </div >
    )
}
