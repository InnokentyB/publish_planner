import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
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
    metrics?: any | null
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
    const navigate = useNavigate()
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
    const [channelId, setChannelId] = useState<number | ''>('')
    const [aiPrompt, setAiPrompt] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, [text]);

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
        mutationFn: (data: Partial<Post>) => api.post(`/api/posts/${id}/approve`, data),
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

    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        e.preventDefault();
                        uploadImage.mutate(file);
                        return;
                    }
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [uploadImage]);

    if (isLoading) return (
        <div className="flex-1 flex items-center justify-center">
            <div className="loading"></div>
        </div>
    )

    if (!post) return (
        <div className="flex-1 flex items-center justify-center text-error font-bold">
            Post not found
        </div>
    )

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

    const handleApprove = () => {
        approvePost.mutate({
            topic,
            category: category || null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            final_text: text,
            publish_at: new Date(publishAt).toISOString(),
            channel_id: channelId ? Number(channelId) : null
        });
    }

    return (
        <div className="flex-1 w-full bg-[#F8F9FB] flex overflow-hidden">
            {/* Left: Ghost Writer Workspace */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-outline-variant/10">
                {/* Minimal Header */}
                <div className="h-16 px-6 flex items-center justify-between bg-white border-b border-outline-variant/5">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => navigate(`/v2/weeks/${post.week_id}`)}
                            className="text-on-surface-variant hover:text-primary"
                        >
                            <span className="material-symbols-outlined text-xl">arrow_back</span>
                        </button>
                        <span className="text-[10px] font-black uppercase tracking-widest text-on-surface/40">Canvas ID: {post.id}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm  ${
                            post.status === 'generated' ? 'bg-success text-white shadow-success/20' : 'bg-surface-container-high text-on-surface-variant'
                        }`}>
                            {post.status}
                        </span>
                        <div className="h-4 w-[1px] bg-outline-variant/20 mx-2"></div>
                        <button onClick={handleSave} className="text-xs font-black text-primary hover:opacity-80">SAVE DRAFT</button>
                        <button 
                            onClick={handleApprove}
                            disabled={post.status === 'scheduled' || post.status === 'published'}
                            className="bg-primary text-white px-4 py-2 rounded-lg text-xs font-black shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all ml-2"
                        >
                            {post.status === 'scheduled' ? 'SCHEDULED' : 'PUBLISH'}
                        </button>
                    </div>
                </div>

                {/* Editor Surface */}
                <div className="flex-1 overflow-y-auto p-12 lg:p-24">
                    <div className="max-w-3xl mx-auto space-y-12">
                        {/* Title/Topic Area */}
                        <div className="group border-l-4 border-transparent hover:border-primary/20 pl-6 -ml-7 transition-all">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary/40 block mb-2 opacity-0 group-hover:opacity-100 transition-opacity">Post Concept</span>
                            <textarea 
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                className="w-full text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface border-none p-0 focus:ring-0 resize-none bg-transparent placeholder:text-on-surface/10"
                                placeholder="The hook goes here..."
                                rows={2}
                            />
                        </div>

                        {/* Ghost Writer Input */}
                        <div className="relative pb-32">
                            <textarea 
                                ref={textareaRef}
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                className="w-full font-body text-xl leading-relaxed text-on-surface border-none p-0 focus:ring-0 resize-none bg-transparent placeholder:text-on-surface/5"
                                placeholder="Start writing or use AI to generate..."
                            />
                            {text.length === 0 && (
                                <div className="absolute top-0 left-0 pointer-events-none opacity-20">
                                    <p className="text-xl italic font-serif leading-relaxed">
                                        "The screen was white, the cursor blinking, waiting for the first word to drop like a seed into the earth..."
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* AI Prompt Bar - Floating at bottom */}
                <div className="px-6 pb-6 mt-auto">
                    <div className="max-w-4xl mx-auto bg-white/80 backdrop-blur-xl border border-outline-variant/10 p-2 rounded-[2rem] shadow-2xl flex items-center gap-2 group focus-within:ring-4 focus-within:ring-primary/5 transition-all">
                        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white shrink-0 shadow-lg shadow-primary/20">
                            <span className="material-symbols-outlined text-sm">auto_awesome</span>
                        </div>
                        <input 
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-bold text-on-surface placeholder:text-on-surface/30"
                            placeholder="Transform this draft into a LinkedIn thought leader thread..."
                        />
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={() => setShowPresetSelect(!showPresetSelect)}
                                className="p-2 text-on-surface-variant hover:text-primary transition-colors relative"
                            >
                                <span className="material-symbols-outlined text-lg">tune</span>
                                {showPresetSelect && (
                                    <div className="absolute bottom-full right-0 mb-4 w-64 bg-white border border-outline-variant p-4 rounded-3xl shadow-2xl z-50">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-on-surface/40 mb-3">Writer Persona</h4>
                                        <div className="space-y-1">
                                            <button 
                                                onClick={() => { setSelectedPresetId(''); setShowPresetSelect(false); }}
                                                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${selectedPresetId === '' ? 'bg-primary/5 text-primary' : 'hover:bg-surface'}`}
                                            >
                                                Default
                                            </button>
                                            {presets?.filter(p => p.role === 'post_creator').map(p => (
                                                <button 
                                                    key={p.id}
                                                    onClick={() => { setSelectedPresetId(p.id); setShowPresetSelect(false); }}
                                                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors ${selectedPresetId === p.id ? 'bg-primary/5 text-primary' : 'hover:bg-surface'}`}
                                                >
                                                    {p.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </button>
                            <button 
                                onClick={() => regenerate.mutate()}
                                disabled={regenerate.isPending || post.status === 'generating'}
                                className="bg-surface-container-high hover:bg-primary hover:text-white text-on-surface-variant px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {regenerate.isPending || post.status === 'generating' ? 'Processing...' : 'Execute'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: Asset & Intelligence Panel */}
            <div className="w-[450px] bg-white border-l border-outline-variant/10 flex flex-col h-full hidden 2xl:flex overflow-hidden">
                {/* Intelligence Tabs */}
                <div className="flex border-b border-outline-variant/5">
                    <button className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-primary border-b-2 border-primary">Assets & Preview</button>
                    <button className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-on-surface/20">Strategy Review</button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-10 scrollbar-hide">
                    {/* Visual Asset Card */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-on-surface/40">Visual Asset</h3>
                            <button 
                                onClick={() => document.getElementById('image-upload')?.click()}
                                className="text-primary"
                            >
                                <span className="material-symbols-outlined text-lg">upload</span>
                            </button>
                            <input type="file" id="image-upload" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage.mutate(e.target.files[0])} />
                        </div>

                        <div 
                            className="aspect-square w-full rounded-[2rem] bg-surface-container-low border-2 border-dashed border-outline-variant/20 overflow-hidden relative group"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); e.dataTransfer.files?.[0] && uploadImage.mutate(e.dataTransfer.files[0]); }}
                        >
                            {post.image_url ? (
                                <img src={post.image_url.startsWith('data:') ? post.image_url : `${post.image_url}?t=${imageTimestamp}`} className="w-full h-full object-cover" alt="Post" />
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center gap-4">
                                    <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-primary/30">
                                        <span className="material-symbols-outlined text-3xl">image</span>
                                    </div>
                                    <p className="text-sm font-bold opacity-30">Drag visual asset here</p>
                                </div>
                            )}
                            
                            {/* Generation Loading Overlay */}
                            {(generateImage.isPending || post.status === 'generating') && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20">
                                    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Synthesizing...</span>
                                </div>
                            )}
                        </div>

                        {/* Explicit Generation Controls */}
                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={() => generateImage.mutate('dalle')}
                                disabled={generateImage.isPending || post.status === 'generating'}
                                className="flex items-center justify-center gap-2 py-3 bg-white border border-outline-variant/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-container-low transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="material-symbols-outlined text-sm">palette</span>
                                DALL-E 3
                            </button>
                            <button 
                                onClick={() => generateImage.mutate('full')}
                                disabled={generateImage.isPending || post.status === 'generating'}
                                className="flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100"
                            >
                                <span className="material-symbols-outlined text-sm">psychology</span>
                                Agent
                            </button>
                        </div>
                        {post.image_prompt && (
                            <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/5">
                                <span className="text-[9px] font-black uppercase text-primary mb-1 block">AI Prompt Node</span>
                                <p className="text-[11px] font-medium leading-relaxed italic opacity-60 underline decoration-primary/10">{post.image_prompt}</p>
                            </div>
                        )}
                    </div>

                    {/* Metadata Synthesis */}
                    <div className="space-y-6">
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-on-surface/40">Execution Protocol</h3>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-surface-container-low p-5 rounded-3xl space-y-1">
                                <span className="text-[9px] font-black uppercase text-on-surface/40">Schedule</span>
                                <input 
                                    type="datetime-local" 
                                    value={publishAt} 
                                    onChange={(e) => setPublishAt(e.target.value)}
                                    className="block w-full bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                                />
                            </div>
                            <div className="bg-surface-container-low p-5 rounded-3xl space-y-1">
                                <span className="text-[9px] font-black uppercase text-on-surface/40">Channel</span>
                                <select 
                                    value={channelId}
                                    onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : '')}
                                    className="block w-full bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                                >
                                    <option value="">Default Node</option>
                                    {(projectData as any)?.channels?.map((c: SocialChannel) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="bg-surface-container-low p-5 rounded-3xl space-y-1">
                            <span className="text-[9px] font-black uppercase text-on-surface/40">Layer Distribution</span>
                            <input 
                                value={category} 
                                onChange={(e) => setCategory(e.target.value)}
                                className="block w-full bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                                placeholder="Distribution node..."
                            />
                        </div>

                        <div className="bg-surface-container-low p-5 rounded-3xl space-y-1">
                            <span className="text-[9px] font-black uppercase text-on-surface/40">Strategy Tags</span>
                            <input 
                                value={tags} 
                                onChange={(e) => setTags(e.target.value)}
                                className="block w-full bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                                placeholder="#tag1, #tag2..."
                            />
                        </div>
                    </div>

                    {/* Live Preview / Render */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-on-surface/40">Synthesized Preview</h3>
                        <div className="p-8 bg-[#F8F9FB] rounded-[2rem] border border-outline-variant/10 min-h-[400px]">
                            <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-strong:text-primary prose-a:text-primary">
                                {text ? <Markdown>{text}</Markdown> : <p className="italic opacity-20">Awaiting content for synthesis...</p>}
                            </div>
                        </div>
                    </div>

                    <div className="pt-8 border-t border-outline-variant/10">
                         <CommentSection entityType="post" entityId={post.id} />
                    </div>
                </div>
            </div>
        </div>
    )
}
