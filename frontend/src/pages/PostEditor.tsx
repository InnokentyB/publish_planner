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
    channel_id?: number | null
}

interface PromptPreset {
    id: number
    name: string
    role: string
}

interface SocialChannel {
    id: number;
    type: string;
    name: string;
}

import { useAuth } from '../context/AuthContext'

export default function PostEditor() {
    const { id } = useParams()
    const queryClient = useQueryClient()
    const [currentProject] = [useAuth().currentProject] // Destructure safely
    console.log('[PostEditor] Rendering', { id, currentProject: currentProject?.id });

    const [topic, setTopic] = useState('')
    const [category, setCategory] = useState('')
    const [tags, setTags] = useState('')
    const [text, setText] = useState('')
    const [publishAt, setPublishAt] = useState('')
    const [selectedPresetId, setSelectedPresetId] = useState<number | ''>('')
    const [showPresetSelect, setShowPresetSelect] = useState(false)
    const [imageTimestamp, setImageTimestamp] = useState(Date.now())
    const [channelId, setChannelId] = useState<number | ''>('')

    const { data: presets } = useQuery<PromptPreset[]>({
        queryKey: ['presets', currentProject?.id],
        queryFn: () => presetsApi.getAll(),
        enabled: !!currentProject
    })

    const { data: projectData } = useQuery({
        queryKey: ['project', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject
    })

    const { data: post, isLoading } = useQuery<Post>({
        queryKey: ['post', id],
        queryFn: () => api.get(`/api/posts/${id}`),
        refetchInterval: (query) => query.state.data?.status === 'generating' ? 3000 : false
    })

    useEffect(() => {
        if (post) {
            setTopic(post.topic || '')
            setCategory(post.category || '')
            setTags(post.tags.join(', '))
            setText(post.final_text || post.generated_text || '')
            setPublishAt(format(new Date(post.publish_at), "yyyy-MM-dd'T'HH:mm"))
            setChannelId(post.channel_id || '')
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
        mutationFn: (provider: 'dalle' | 'nano' | 'full' = 'dalle') => api.post(`/api/posts/${id}/generate-image`, { provider }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
            setImageTimestamp(Date.now())
        },
        onError: (err: any) => alert('Failed to generate image: ' + (err.response?.data?.error || err.message))
    })

    const uploadImage = useMutation({
        mutationFn: (file: File) => api.upload(`/api/posts/${id}/upload-image`, file),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
            setImageTimestamp(Date.now())
        },
        onError: (err: any) => alert('Failed to upload image: ' + err.message)
    })

    // Global paste handler
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            console.log('[PostEditor] Paste event detected', { items: items?.length });

            if (!items) return;

            for (const item of items) {
                console.log('[PostEditor] Item type:', item.type);
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        console.log('[PostEditor] Image found in clipboard', file.name, file.type, file.size);
                        // Prevent default paste (e.g. into textarea)
                        e.preventDefault();
                        uploadImage.mutate(file);
                        return; // Stop after first image
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [uploadImage]);

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
            publish_at: new Date(publishAt).toISOString(),
            channel_id: channelId ? Number(channelId) : null
        })
    }

    const handleApprove = async () => {
        // Save first
        await updatePost.mutateAsync({
            topic,
            category: category || null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            final_text: text,
            publish_at: new Date(publishAt).toISOString(),
            channel_id: channelId ? Number(channelId) : null
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
                                    Target Channel
                                </label>
                                <select
                                    value={channelId}
                                    onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : '')}
                                    style={{ width: '100%' }}
                                >
                                    <option value="">(Default) Automatic Selection</option>
                                    {(projectData as any)?.channels?.map((c: SocialChannel) => (
                                        <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                                    ))}
                                </select>
                            </div>
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

                <div
                    className="card mb-2"
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file && file.type.startsWith('image/')) {
                            uploadImage.mutate(file);
                        }
                    }}
                >
                    <h3>Image</h3>
                    {post.image_url ? (
                        <div className="mb-2 text-center">
                            <img src={`${post.image_url}?t=${imageTimestamp}`} alt="Post visual" style={{ maxWidth: '100%', borderRadius: '4px' }} />
                        </div>
                    ) : (
                        <p className="text-muted" style={{ border: '2px dashed var(--border)', padding: '2rem', textAlign: 'center', borderRadius: '8px' }}>
                            Drag & Drop image here<br />
                            <span style={{ fontSize: '0.8rem' }}>or paste from clipboard (Ctrl+V)</span>
                        </p>
                    )}

                    {post.image_prompt && (
                        <div className="mb-2 p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.8rem' }}>
                            <strong>Generation Prompt:</strong>
                            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>{post.image_prompt}</p>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button
                            className="btn-secondary"
                            style={{ width: '100%' }}
                            onClick={() => {
                                if (window.confirm('Generate basic DALL-E image?')) {
                                    generateImage.mutate('dalle');
                                }
                            }}
                            disabled={generateImage.isPending}
                        >
                            {generateImage.isPending ? 'Generating...' : (post.image_url ? 'Regenerate DALL-E' : 'Generate DALL-E')}
                        </button>
                        <button
                            className="btn-secondary"
                            style={{ width: '100%' }}
                            onClick={() => {
                                if (window.confirm('Generate Nano Banana image?')) {
                                    generateImage.mutate('nano');
                                }
                            }}
                            disabled={generateImage.isPending}
                        >
                            {generateImage.isPending ? 'Generating...' : (post.image_url ? 'Regenerate Nano Banana' : 'Generate Nano Banana')}
                        </button>
                        <button
                            className="btn-primary"
                            style={{ width: '100%' }}
                            onClick={() => {
                                if (window.confirm('Run full pipeline: DALL-E -> Image Critic -> Nano Banana? This may take up to a minute.')) {
                                    generateImage.mutate('full');
                                }
                            }}
                            disabled={generateImage.isPending}
                        >
                            🧠 {generateImage.isPending ? 'Running Pipeline...' : 'DALL-E -> Critic -> Nano'}
                        </button>
                    </div>

                    <div className="mt-2 text-center" style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        or
                    </div>

                    <div className="mt-2">
                        <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            id="image-upload"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    uploadImage.mutate(file);
                                }
                            }}
                        />
                        <label
                            htmlFor="image-upload"
                            className="btn-secondary"
                            style={{
                                display: 'block',
                                textAlign: 'center',
                                width: '100%',
                                cursor: 'pointer',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '8px'
                            }}
                        >
                            {uploadImage.isPending ? 'Uploading...' : 'Upload Image'}
                        </label>
                    </div>
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
