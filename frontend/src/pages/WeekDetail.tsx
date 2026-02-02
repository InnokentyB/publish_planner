import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useState } from 'react'
import { api } from '../api'

interface Post {
    id: number
    topic: string
    category: string | null
    tags: string[]
    status: string
    publish_at: string
    generated_text: string | null
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

import { useAuth } from '../context/AuthContext'

export default function WeekDetail() {
    const { id } = useParams()
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [isGeneratingTopics, setIsGeneratingTopics] = useState(false)
    const [isGeneratingPosts, setIsGeneratingPosts] = useState(false)

    const { data: week, isLoading } = useQuery<Week>({
        queryKey: ['week', id],
        queryFn: () => api.get(`/api/weeks/${id}`),
        enabled: !!currentProject
    })

    const generateTopics = useMutation({
        mutationFn: async () => {
            setIsGeneratingTopics(true)
            return api.post(`/api/weeks/${id}/generate-topics`, {})
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

            {week.status === 'planning' && (
                <div className="card mb-3">
                    <h3>Generate Topics</h3>
                    <p className="text-muted mb-2">
                        Use AI to generate 2 topic ideas for this week's theme.
                    </p>
                    <button
                        className="btn-primary"
                        onClick={() => generateTopics.mutate()}
                        disabled={isGeneratingTopics}
                    >
                        {isGeneratingTopics ? (
                            <span className="flex-center"><div className="loading"></div> Generating...</span>
                        ) : 'Generate Topics'}
                    </button>
                </div>
            )}

            {week.status === 'topics_generated' && week.topics && (
                <div className="card mb-3">
                    <h3>Review Topics</h3>
                    <div className="grid" style={{ gap: '1rem', marginBottom: '1rem' }}>
                        {week.topics.map((topic, idx) => (
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
                    <button
                        className="btn-success"
                        onClick={() => approveTopics.mutate()}
                        disabled={approveTopics.isPending}
                    >
                        {approveTopics.isPending ? 'Approving...' : 'Approve Topics'}
                    </button>
                </div>
            )}

            {(week.status === 'topics_approved' || week.status === 'generating' || week.status === 'generated' || week.status === 'completed') && (
                <div className="card mb-3">
                    <h3>Posts</h3>
                    {week.posts.length === 0 ? (
                        <p className="text-muted">No posts yet.</p>
                    ) : (
                        <div className="grid" style={{ gap: '1rem' }}>
                            {week.posts.map((post) => (
                                <Link key={post.id} to={`/posts/${post.id}`} style={{ textDecoration: 'none' }}>
                                    <div className="card" style={{ background: 'var(--bg-tertiary)', cursor: 'pointer' }}>
                                        <div className="flex-between mb-2">
                                            <h4 style={{ margin: 0 }}>{post.topic}</h4>
                                            <span className={`badge badge-${post.status}`}>
                                                {post.status}
                                            </span>
                                        </div>
                                        <div className="text-muted">
                                            📅 {format(new Date(post.publish_at), 'MMM d, HH:mm')}
                                        </div>
                                        {post.category && (
                                            <div className="flex-center mt-1" style={{ gap: '0.5rem' }}>
                                                <span className="badge" style={{ background: 'var(--accent)' }}>{post.category}</span>
                                                {post.tags.map((tag, i) => (
                                                    <span key={i} className="badge" style={{ background: 'var(--bg-primary)' }}>
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Link>
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
                </div>
            )}
        </div>
    )
}
