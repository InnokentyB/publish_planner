import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
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
    published_link?: string | null
    image_url?: string | null
    image_prompt?: string | null
    metrics?: any | null
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
        enabled: !!currentProject,
        refetchInterval: (query) => {
            const data = query.state.data as Week | undefined;
            return (data?.status === 'generating' || data?.posts.some(p => p.status === 'generating')) ? 3000 : false;
        }
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
        onSuccess: (response) => {
            const data = response.data;
            if (data?.warning) {
                alert(`⚠️ Пост опубликован, но есть предупреждение:\n\n${data.warning}\n\nЧтобы вернуть MTProto, проверьте Telegram Account в настройках.`);
            } else {
                const method = data?.publishMethod === 'mtproto' ? '✅ MTProto' : '🤖 Bot API';
                alert(`Пост опубликован через ${method}`);
            }
            queryClient.invalidateQueries({ queryKey: ['week', id] })
        },
        onError: (err: any) => alert('Не удалось опубликовать: ' + (err.response?.data?.error || err.message))
    })

    const generateImage = useMutation({
        mutationFn: ({ postId, provider }: { postId: number, provider: 'dalle' | 'nano' | 'full' }) => {
            setGeneratingPostId(postId);
            return api.post(`/api/posts/${postId}/generate-image`, { provider });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['week', id] });
            setGeneratingPostId(null);
        },
        onError: (err: any) => {
            alert('Failed to generate image: ' + (err.response?.data?.error || err.message));
            setGeneratingPostId(null);
        }
    });

    const isImageFailure = (p: Post) => p.status === 'failed' && Boolean(p.image_prompt?.includes('[Image Gen Failed]'));
    const isTextFailure = (p: Post) => p.status === 'failed' && !isImageFailure(p);

    const unapprovedPosts = week?.posts?.filter(p => p.status === 'topics_generated') || []
    
    // Execution Nodes: topics_approved, planned, or text generation failed, or text generating
    const approvedPosts = week?.posts?.filter(p => 
        ['topics_approved', 'planned'].includes(p.status) || 
        isTextFailure(p) ||
        (p.status === 'generating' && !p.generated_text)
    ) || []
    
    // Deployment Queue: generated, scheduled, published, publishing, or image generating, or image failed
    const completedPosts = week?.posts?.filter(p => 
        ['generated', 'scheduled', 'scheduled_native', 'published', 'publishing'].includes(p.status) ||
        isImageFailure(p) ||
        (p.status === 'generating' && !!p.generated_text)
    ) || []

    if (!currentProject) return (
        <div className="flex-1 flex items-center justify-center">
            <div className="glass-panel p-10 rounded-[2rem] text-center border border-primary/10">
                <span className="material-symbols-outlined text-4xl text-primary mb-4">account_tree</span>
                <p className="font-bold">Please select a strategic stream.</p>
            </div>
        </div>
    )
    
    if (isLoading) return (
        <div className="flex-1 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
        </div>
    )

    if (!week) return (
        <div className="flex-1 flex items-center justify-center p-12">
             <div className="glass-panel p-12 rounded-[3rem] text-center border border-error/20">
                <span className="material-symbols-outlined text-4xl text-error mb-4">warning</span>
                <p className="text-on-surface font-black">Tactical node not synchronized or invalid ID.</p>
                <button onClick={() => navigate('/')} className="mt-8 btn-primary px-8">Return to Archives</button>
             </div>
        </div>
    )

    return (
        <div className="flex-1 w-full p-8 lg:p-12 space-y-12 max-h-full overflow-y-auto scrollbar-hide pb-32">
            {/* Header / Nav */}
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-6">
                    <button 
                        onClick={() => navigate('/')}
                        className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-on-surface-variant hover:text-primary shadow-sm border border-outline-variant/10 group"
                    >
                        <span className="material-symbols-outlined group-hover:-translate-x-1 transition-transform">arrow_back</span>
                    </button>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">Deployment Cockpit</span>
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${
                                week.status === 'approved' ? 'bg-success text-white' : 'bg-surface-container-high text-on-surface-variant'
                            }`}>
                                {week.status}
                            </span>
                        </div>
                        <h1 className="text-4xl font-headline font-black tracking-tight text-on-surface">{week.theme}</h1>
                        <p className="text-sm font-bold text-on-surface-variant mt-1 opacity-60">
                            {format(new Date(week.week_start), 'MMM d')} — {format(new Date(week.week_end), 'MMM d, yyyy')}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-outline-variant/10 shadow-sm">
                        <select
                            value={selectedPresetId}
                            onChange={(e) => setSelectedPresetId(e.target.value ? Number(e.target.value) : '')}
                            className="bg-transparent border-none text-xs font-black uppercase tracking-widest focus:ring-0"
                        >
                            <option value="">Default Persona</option>
                            {presets?.filter(p => p.role === 'topic_creator' || p.role === 'post_creator').map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <div className="h-6 w-[1px] bg-outline-variant/20 mx-1"></div>
                        <button 
                            onClick={() => generateTopics.mutate({ overwrite: false })}
                            disabled={isGeneratingTopics || week.posts.length >= 14}
                            className="bg-primary text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-40 transition-all flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined text-sm">auto_awesome</span>
                            {isGeneratingTopics ? 'SYNTHESIZING...' : `FILL SLOTS (${14 - week.posts.length})`}
                        </button>
                    </div>
                    {week.posts.length > 0 && (
                        <button 
                            onClick={() => confirm('Wipe and regenerate all content nodes?') && generateTopics.mutate({ overwrite: true })}
                            className="text-[9px] font-black uppercase tracking-widest text-on-surface/20 hover:text-error transition-colors"
                        >
                            EMERGENCY REGENERATION
                        </button>
                    )}
                </div>
            </div>

            {/* Strategy Review Section */}
            <div className="mb-8 p-6 bg-surface-container-low rounded-[2rem] border border-outline-variant/5">
                <CommentSection entityType="week" entityId={week.id} />
            </div>

            {/* Three Column Cockpit Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                
                {/* 1. Content Research / Unapproved */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-2 h-2 rounded-full bg-on-surface/20"></div>
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-on-surface/40">Raw Concepts ({unapprovedPosts.length})</h3>
                    </div>
                    <div className="space-y-4">
                        {unapprovedPosts.map(post => (
                            <div key={post.id} className="bg-white p-6 rounded-[2rem] border border-outline-variant/10 shadow-sm hover:shadow-lg transition-all group">
                                <div className="flex justify-between items-start mb-4">
                                    <span className="text-[9px] font-black uppercase tracking-tight text-primary/40 leading-none">
                                        {format(new Date(post.publish_at), 'EEE, HH:mm')}
                                    </span>
                                    <span className="material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 transition-opacity">drag_indicator</span>
                                </div>
                                <h4 className="text-sm font-black text-on-surface leading-tight mb-6">{post.topic}</h4>
                                <button 
                                    onClick={() => approveTopic.mutate(post.id)}
                                    disabled={approveTopic.isPending}
                                    className="w-full py-3 bg-surface-container-high hover:bg-success hover:text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                                >
                                    {approveTopic.isPending ? 'STAMPING...' : 'COMMIT CONCEPT'}
                                </button>
                            </div>
                        ))}
                        {unapprovedPosts.length === 0 && (
                            <div className="p-8 border-2 border-dashed border-outline-variant/10 rounded-[2rem] text-center opacity-20">
                                <span className="material-symbols-outlined text-4xl block mb-2">lightbulb</span>
                                <p className="text-xs font-bold uppercase tracking-widest">No raw concepts</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Tactical Execution / Approved */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-2 h-2 rounded-full bg-success"></div>
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-on-surface/40">Execution Nodes ({approvedPosts.length})</h3>
                    </div>
                    <div className="space-y-4">
                        {approvedPosts.map(post => (
                            <div key={post.id} className={`p-6 rounded-[2rem] border shadow-sm transition-all group ${
                                post.status === 'failed' ? 'bg-error/5 border-error/20' : 'bg-white border-success/20'
                            }`}>
                                <div className="flex justify-between items-start mb-4">
                                    <span className="text-[9px] font-black uppercase tracking-tight text-success/60 leading-none">
                                         {format(new Date(post.publish_at), 'EEE, HH:mm')}
                                    </span>
                                    {post.category && <span className="px-2 py-0.5 bg-surface-container-high rounded-md text-[8px] font-black uppercase tracking-widest leading-none">{post.category}</span>}
                                </div>
                                <h4 className="text-sm font-black text-on-surface leading-tight mb-6">{post.topic}</h4>
                                
                                {isTextFailure(post) ? (
                                    <button 
                                        onClick={() => generatePost.mutate({ postId: post.id, withImage: true })}
                                        disabled={generatingPostId === post.id || post.status === 'generating'}
                                        className="w-full py-3 bg-error text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-error/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {generatingPostId === post.id || post.status === 'generating' ? 'SYNTHESIZING...' : 'REBOOT NODE'}
                                    </button>
                                ) : (
                                    <button 
                                        onClick={() => generatePost.mutate({ postId: post.id, withImage: true })}
                                        disabled={generatingPostId === post.id || post.status === 'generating'}
                                        className="w-full py-3 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100"
                                    >
                                        {generatingPostId === post.id || post.status === 'generating' ? 'SYNTHESIZING...' : 'SYNTHESIZE CONTENT'}
                                    </button>
                                )}

                                {isTextFailure(post) && post.generated_text && (
                                     <div className="mt-4 p-3 bg-error/10 rounded-xl text-[10px] font-medium text-error leading-relaxed overflow-hidden">
                                         {post.generated_text}
                                     </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Deployment Queue / Completed */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-2 h-2 rounded-full bg-primary/40"></div>
                        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-on-surface/40">Deployment Queue ({completedPosts.length})</h3>
                    </div>
                    <div className="space-y-4">
                        {completedPosts.map(post => (
                            <div 
                                key={post.id} 
                                onClick={() => navigate(`/posts/${post.id}`)}
                                className="bg-white p-6 rounded-[2rem] border border-outline-variant/10 shadow-sm hover:shadow-xl transition-all cursor-pointer overflow-hidden relative group"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest leading-none ${
                                        post.status === 'published' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant'
                                    }`}>{post.status}</span>
                                    <span className="text-[9px] font-black uppercase tracking-tight text-on-surface/30 leading-none">
                                        {format(new Date(post.publish_at), 'MMM d, HH:mm')}
                                    </span>
                                </div>
                                <h4 className="text-sm font-black text-on-surface leading-tight mb-4 group-hover:text-primary transition-colors">{post.topic}</h4>
                                
                                {post.image_url && (
                                    <div className="aspect-video w-full rounded-2xl overflow-hidden mb-6 filter group-hover:brightness-110 transition-all">
                                        <img src={post.image_url} alt="Cover" className="w-full h-full object-cover" />
                                    </div>
                                )}
                                
                                {isImageFailure(post) && (
                                    <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-xl">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="material-symbols-outlined text-[10px] text-error">warning</span>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-error">Image Generation Failed</span>
                                        </div>
                                        <p className="text-[10px] font-medium text-error/80 leading-relaxed truncate">{post.image_prompt?.replace(/\[Image Gen Failed\]\nError: /g, '') || ''}</p>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 mb-6">
                                    {post.metrics && (
                                        <div className="flex gap-4 text-[10px] font-black text-on-surface/40">
                                            {post.metrics.views !== undefined && <span>👁 {post.metrics.views}</span>}
                                            {post.metrics.likes !== undefined && <span>❤️ {post.metrics.likes}</span>}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); if(confirm('Fire deployment now?')) publishNow.mutate(post.id); }}
                                        disabled={post.status === 'published' || post.status === 'publishing' || publishNow.isPending}
                                        className="flex-1 py-3 bg-surface-container-low hover:bg-primary hover:text-white rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface-container-low disabled:hover:text-primary"
                                    >
                                        {post.status === 'published' ? 'DEPLOYED' : (post.status === 'publishing' || publishNow.isPending) ? 'PUBLISHING...' : 'DEPLOY NOW'}
                                    </button>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); generateImage.mutate({ postId: post.id, provider: 'full' }); }}
                                        disabled={generatingPostId === post.id || post.status === 'generating'}
                                        title="Auto-generate image"
                                        className="w-12 h-12 bg-surface-container-low hover:bg-surface-container-high rounded-xl flex items-center justify-center text-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {generatingPostId === post.id || post.status === 'generating' ? (
                                             <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                        ) : (
                                             <span className="material-symbols-outlined text-lg">auto_fix</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
