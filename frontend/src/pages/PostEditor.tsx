import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Markdown from 'markdown-to-jsx'

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
}

export default function PostEditor() {
    const { id } = useParams()
    const queryClient = useQueryClient()

    const [topic, setTopic] = useState('')
    const [category, setCategory] = useState('')
    const [tags, setTags] = useState('')
    const [text, setText] = useState('')
    const [publishAt, setPublishAt] = useState('')

    const { data: post, isLoading } = useQuery<Post>({
        queryKey: ['post', id],
        queryFn: async () => {
            const res = await fetch(`/api/posts/${id}`)
            if (!res.ok) throw new Error('Failed to fetch post')
            return res.json()
        }
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
        mutationFn: async (data: Partial<Post>) => {
            const res = await fetch(`/api/posts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            if (!res.ok) throw new Error('Failed to update post')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
    })

    const approvePost = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/posts/${id}/approve`, { method: 'POST' })
            if (!res.ok) throw new Error('Failed to approve post')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
    })

    const regenerate = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/posts/${id}/generate`, { method: 'POST' })
            if (!res.ok) throw new Error('Failed to regenerate post')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['post', id] })
        }
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
                            onClick={() => approvePost.mutate()}
                            disabled={approvePost.isPending || post.status === 'scheduled'}
                        >
                            {approvePost.isPending ? 'Approving...' : 'Approve & Schedule'}
                        </button>
                        <button
                            className="btn-secondary"
                            onClick={() => regenerate.mutate()}
                            disabled={regenerate.isPending}
                        >
                            {regenerate.isPending ? 'Regenerating...' : '🔄 Regenerate'}
                        </button>
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
        </div>
    )
}
