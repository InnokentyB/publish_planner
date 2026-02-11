import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Markdown from 'markdown-to-jsx'
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
    final_text: string | null
    week_id: number
    image_url?: string | null
    image_prompt?: string | null
}

interface PromptPreset {
    id: number
    name: string
    role: string
}

import { useAuth } from '../context/AuthContext'

export default function PostEditor() {
    const { id } = useParams()
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()

    const [topic, setTopic] = useState('')
    const [category, setCategory] = useState('')
    const [tags, setTags] = useState('')
    const [text, setText] = useState('')
    const [publishAt, setPublishAt] = useState('')
    const [selectedPresetId, setSelectedPresetId] = useState<number | ''>('')
    const [showPresetSelect, setShowPresetSelect] = useState(false)
    const [imageTimestamp, setImageTimestamp] = useState(Date.now())

    const { data: presets } = useQuery<PromptPreset[]>({
        queryKey: ['presets', currentProject?.id],
        queryFn: () => presetsApi.getAll(),
        enabled: !!currentProject
    })

    const { data: post, isLoading } = useQuery<Post>({
        queryKey: ['post', id],
        queryFn: () => api.get(`/api/posts/${id}`)
    })

    useEffect(() => {
        if (post) {
            setTopic(post.topic || '')
            setCategory(post.category || '')
            setTags(post.tags.join(', '))
            setText(post.final_text || post.generated_text || '')
            setPublishAt(format(new Date(post.publish_at), "yyyy-MM-dd'T'HH:mm"))
        }
    }, [post])

    const updatePost = useMutation({
        mutationFn: (data: Partial<Post>) => api.put(`/api/posts/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
    })

    const approvePost = useMutation({
        mutationFn: () => api.post(`/api/posts/${id}/approve`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
    })

    const regenerate = useMutation({
        mutationFn: () => {
            const body: any = {}
            if (selectedPresetId) body.promptPresetId = selectedPresetId
            return api.post(`/api/posts/${id}/generate`, body)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
    })

    const generateImage = useMutation({
        mutationFn: () => api.post(`/api/posts/${id}/generate-image`, { provider: 'dalle' }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
            setImageTimestamp(Date.now())
        },
        onError: (err: any) => alert('Failed to generate image: ' + (err.response?.data?.error || err.message))
    })

    if (isLoading) {
        return (
            <div className="container">
                <div className="flex-center" style={{ justifyContent: 'center', padding: '4rem' }}>
                    <div className="loading"></div>
                    <span>Loading post...</span>
                </div>
            </div>
        )
    }

    if (!post) {
        return (
            <div className="container">
                <div className="error">Post not found</div>
            </div>
        )
    }

    const handleSave = () => {
        updatePost.mutate({
            topic,
            category: category || null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            final_text: text,
            publish_at: new Date(publishAt).toISOString()
        })
    }

    const handleApprove = async () => {
        // Save first
        await updatePost.mutateAsync({
            topic,
            category: category || null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            final_text: text,
            publish_at: new Date(publishAt).toISOString()
        });

        // Then approve
        approvePost.mutate();
    }

    return (
        <div className="container">
            <div className="mb-3">
                <Link to={`/weeks/${post.week_id}`} style={{ color: 'var(--text-muted)' }}>← Back to week</Link>
            </div>

            <div className="flex-between mb-3">
                <h1>Edit Post</h1>
                <span className={`badge badge-${post.status}`}>
                    {post.status}
                </span>
            </div>

            <div className="mb-3">
                <CommentSection entityType="post" entityId={post.id} />
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' }}>
                <div>
                    <div className="card mb-2">
                        <h3>Post Details</h3>
                        <div className="grid" style={{ gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                    Topic
                                </label>
                                <input
                                    type="text"
                                    value={topic}
                                    onChange={(e) => setTopic(e.target.value)}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                    Category
                                </label>
                                <input
                                    type="text"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    placeholder="e.g., Soft Skills"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                    Tags (comma-separated)
                                </label>
                                <input
                                    type="text"
                                    value={tags}
                                    onChange={(e) => setTags(e.target.value)}
                                    placeholder="e.g., communication, feedback"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                    Publish Time
                                </label>
                                <input
                                    type="datetime-local"
                                    value={publishAt}
                                    onChange={(e) => setPublishAt(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <h3>Content</h3>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={20}
                            style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
                            placeholder="Post content (Markdown supported)"
                        />
                    </div>

                    <div className="flex mt-2" style={{ gap: '1rem' }}>
                        <button
                            className="btn-primary"
                            onClick={handleSave}
                            disabled={updatePost.isPending}
                        >
                            {updatePost.isPending ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                            className="btn-success"
                            onClick={handleApprove}
                            disabled={updatePost.isPending || approvePost.isPending || post.status === 'scheduled' || post.status === 'published'}
                        >
                            {updatePost.isPending || approvePost.isPending ? 'Saving & Approving...' : 'Approve & Schedule'}
                        </button>


                        <div style={{ position: 'relative' }}>
                            <button
                                className="btn-secondary"
                                onClick={() => setShowPresetSelect(!showPresetSelect)}
                                disabled={regenerate.isPending || !currentProject}
                            >
                                {regenerate.isPending ? 'Regenerating...' : '🔄 Regenerate'}
                            </button>
                            {showPresetSelect && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    left: 0,
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    padding: '1rem',
                                    borderRadius: '8px',
                                    zIndex: 10,
                                    width: '250px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                                }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Select Style Preset</label>
                                    <select
                                        style={{ marginBottom: '0.5rem', width: '100%' }}
                                        value={selectedPresetId}
                                        onChange={(e) => setSelectedPresetId(e.target.value ? Number(e.target.value) : '')}
                                    >
                                        <option value="">Default Style</option>
                                        {presets?.filter(p => p.role === 'post_creator').map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        className="btn-primary"
                                        style={{ width: '100%', padding: '0.5rem' }}
                                        onClick={() => {
                                            regenerate.mutate()
                                            setShowPresetSelect(false)
                                        }}
                                    >
                                        Regenerate Now
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="card mb-2">
                    <h3>Image</h3>
                    {post.image_url ? (
                        <div className="mb-2 text-center">
                            <img src={`${post.image_url}?t=${imageTimestamp}`} alt="Post visual" style={{ maxWidth: '100%', borderRadius: '4px' }} />
                        </div>
                    ) : (
                        <p className="text-muted">No image generated.</p>
                    )}

                    {post.image_prompt && (
                        <div className="mb-2 p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.8rem' }}>
                            <strong>Generation Prompt:</strong>
                            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>{post.image_prompt}</p>
                        </div>
                    )}

                    <button
                        className="btn-secondary"
                        style={{ width: '100%' }}
                        onClick={() => {
                            if (window.confirm('Generate image for this post?')) {
                                generateImage.mutate();
                            }
                        }}
                        disabled={generateImage.isPending}
                    >
                        {generateImage.isPending ? 'Generating...' : (post.image_url ? 'Regenerate Image' : 'Generate Image')}
                    </button>
                </div>

                <div className="card" style={{ position: 'sticky', top: '2rem' }}>
                    <h3>Preview</h3>
                    <div style={{
                        padding: '1rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '8px',
                        minHeight: '400px',
                        maxHeight: '80vh',
                        overflow: 'auto'
                    }}>
                        {text ? (
                            <Markdown>{text}</Markdown>
                        ) : (
                            <p className="text-muted">No content yet...</p>
                        )}
                    </div>
                </div>
            </div>
        </div >
    )
}
