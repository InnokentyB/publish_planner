import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { api, presetsApi, keysApi, modelsApi, projectsApi } from '../api'
import { useAuth } from '../context/AuthContext'

interface AgentConfig {
    role: string
    prompt: string
    apiKey: string
    model: string
    provider?: string
}

interface PromptPreset {
    id: number
    name: string
    role: string
    prompt_text: string
}

interface ProviderKey {
    id: number
    name: string
    key: string
    provider: string
}

interface SocialChannel {
    id: number;
    type: string;
    name: string;
    config: any;
    is_active: boolean;
}

export default function Settings() {
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()
    const [activeTab, setActiveTab] = useState<'general' | 'keys' | 'channels' | 'team' | 'agents' | 'presets'>('general')

    // Project State
    const [projectName, setProjectName] = useState('')
    const [projectDesc, setProjectDesc] = useState('')
    const [nativeScheduling, setNativeScheduling] = useState(false)

    // Channel State
    const [newChannelName, setNewChannelName] = useState('')
    const [newChannelId, setNewChannelId] = useState('')
    const [newChannelUsername, setNewChannelUsername] = useState('')

    // Agent State
    const [selectedRole, setSelectedRole] = useState<string>('post_creator')
    const [prompt, setPrompt] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [model, setModel] = useState('')
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [isLoadingModels, setIsLoadingModels] = useState(false)

    // Key State
    const [newKeyName, setNewKeyName] = useState('')
    const [newKeyValue, setNewKeyValue] = useState('')

    // Member State
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState('viewer')

    // Preset State
    const [presetName, setPresetName] = useState('')
    const [presetRole, setPresetRole] = useState('post_creator')
    const [presetPrompt, setPresetPrompt] = useState('')
    const [editingPresetId, setEditingPresetId] = useState<number | null>(null)

    // Queries
    const { data: projectData } = useQuery({
        queryKey: ['project', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject && (activeTab === 'general' || activeTab === 'team' || activeTab === 'channels')
    })

    const { data: agents } = useQuery<AgentConfig[]>({
        queryKey: ['agents', currentProject?.id],
        queryFn: () => api.get('/api/settings/agents'),
        enabled: !!currentProject && activeTab === 'agents'
    })

    const { data: keys } = useQuery<ProviderKey[]>({
        queryKey: ['keys', currentProject?.id],
        queryFn: () => keysApi.getAll(),
        enabled: !!currentProject && (activeTab === 'keys' || activeTab === 'agents')
    })

    const { data: presets } = useQuery<PromptPreset[]>({
        queryKey: ['presets', currentProject?.id],
        queryFn: () => presetsApi.getAll(),
        enabled: !!currentProject && activeTab === 'presets'
    })

    // Mutations
    const updateProject = useMutation({
        mutationFn: (data: { name: string; description: string }) => projectsApi.update(currentProject!.id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
            alert('Project updated')
        }
    })

    const updateSetting = useMutation({
        mutationFn: (data: { key: string; value: string }) => api.post(`/api/projects/${currentProject!.id}/settings`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
        }
    })

    const addChannel = useMutation({
        mutationFn: (data: { type: string, name: string, config: any }) => api.post(`/api/projects/${currentProject!.id}/channels`, data),
        onSuccess: () => {
            setNewChannelName('')
            setNewChannelId('')
            setNewChannelUsername('')
            queryClient.invalidateQueries({ queryKey: ['project'] })
            alert('Channel added')
        },
        onError: (err: any) => alert(err.message || 'Failed to add channel')
    })

    // Note: Delete channel endpoint might need to be added or we just hide it?
    // Reviewing api routes: we don't have a specific delete channel route in project.routes.ts...
    // Wait, let's check if we can delete. 
    // We didn't add a delete route in project.routes.ts.
    // I should probably add it or just allow adding for now.
    // The user asked for "visual binding", adding is most important. 
    // I can add delete logic to `project.routes.ts` quickly if needed, but let's stick to adding first.

    const addKey = useMutation({
        mutationFn: (data: { name: string; key: string }) => keysApi.create(data),
        onSuccess: () => {
            setNewKeyName('')
            setNewKeyValue('')
            queryClient.invalidateQueries({ queryKey: ['keys'] })
        }
    })

    const deleteKey = useMutation({
        mutationFn: (id: number) => keysApi.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] })
    })

    const updateAgent = useMutation({
        mutationFn: (data: { role: string; prompt: string; apiKey: string; model: string }) =>
            api.put(`/api/settings/agents/${data.role}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agents'] })
            alert('Agent configuration saved')
        }
    })

    const addMember = useMutation({
        mutationFn: (data: { email: string; role: string }) => projectsApi.addMember(currentProject!.id, data.email, data.role),
        onSuccess: () => {
            setInviteEmail('')
            queryClient.invalidateQueries({ queryKey: ['project'] })
            alert('Member added')
        },
        onError: (err: any) => alert(err.message)
    })

    const removeMember = useMutation({
        mutationFn: (userId: number) => projectsApi.removeMember(currentProject!.id, userId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
        }
    })

    const createPreset = useMutation({
        mutationFn: (data: { name: string; role: string; prompt_text: string }) => presetsApi.create(data),
        onSuccess: () => {
            setPresetName('')
            setPresetPrompt('')
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        }
    })

    const updatePreset = useMutation({
        mutationFn: (data: { id: number; name: string; role: string; prompt_text: string }) =>
            presetsApi.update(data.id, { name: data.name, role: data.role, prompt_text: data.prompt_text }),
        onSuccess: () => {
            setEditingPresetId(null)
            setPresetName('')
            setPresetPrompt('')
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        }
    })

    const deletePreset = useMutation({
        mutationFn: (id: number) => presetsApi.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presets'] })
    })

    // Effects
    useEffect(() => {
        if (projectData && activeTab === 'general') {
            setProjectName(projectData.name)
            setProjectDesc(projectData.description || '')
            const settings = (projectData as any).settings || []
            const native = settings.find((s: any) => s.key === 'telegram_native_scheduling')
            setNativeScheduling(native?.value === 'true')
        }
    }, [projectData, activeTab])

    const currentAgent = agents?.find(a => a.role === selectedRole)

    useEffect(() => {
        if (currentAgent) {
            setPrompt(currentAgent.prompt)
            setApiKey(currentAgent.apiKey)
            setModel(currentAgent.model)
            setAvailableModels([]) // Reset on agent switch
        }
    }, [currentAgent])

    const handleLoadModels = async () => {
        if (!apiKey) return
        setIsLoadingModels(true)
        try {
            // Check if apiKey is a pk_ ID
            let params: any = {}
            if (apiKey.startsWith('pk_')) {
                params.keyId = apiKey.substring(3)
            } else {
                params.key = apiKey
            }

            const res = await modelsApi.fetch(params)
            setAvailableModels(res.models)
        } catch (e: any) {
            alert('Failed to load models: ' + e.message)
        } finally {
            setIsLoadingModels(false)
        }
    }

    const handleSavePreset = () => {
        if (!presetName || !presetPrompt) return
        if (editingPresetId) {
            updatePreset.mutate({ id: editingPresetId, name: presetName, role: presetRole, prompt_text: presetPrompt })
        } else {
            createPreset.mutate({ name: presetName, role: presetRole, prompt_text: presetPrompt })
        }
    }

    const startEditPreset = (p: PromptPreset) => {
        setEditingPresetId(p.id)
        setPresetName(p.name)
        setPresetRole(p.role)
        setPresetPrompt(p.prompt_text)
    }

    const cancelEditPreset = () => {
        setEditingPresetId(null)
        setPresetName('')
        setPresetPrompt('')
    }

    const handleSelectRole = (role: string) => {
        setSelectedRole(role)
    }

    const handleSaveAgent = () => {
        updateAgent.mutate({ role: selectedRole, prompt, apiKey, model })
    }

    const handleAddChannel = () => {
        if (!newChannelName || !newChannelId) return;
        const config: any = { telegram_channel_id: newChannelId };
        if (newChannelUsername) config.channel_username = newChannelUsername;

        addChannel.mutate({
            type: 'telegram',
            name: newChannelName,
            config
        });
    }

    if (!currentProject) {
        return (
            <div className="container">
                <div className="card text-center p-3">
                    <h2>No Project Selected</h2>
                    <p className="text-muted">Please select a project to configure settings.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="container">
            <h1 className="mb-3">Project Settings</h1>

            <div className="flex mb-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
                {['general', 'keys', 'channels', 'team', 'agents', 'presets'].map(tab => (
                    <button
                        key={tab}
                        className={activeTab === tab ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => setActiveTab(tab as any)}
                        style={{ marginRight: '0.5rem', textTransform: 'capitalize', whiteSpace: 'nowrap' }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {activeTab === 'general' && (
                <div className="card">
                    <h2>General Information</h2>
                    <div className="mb-2">
                        <label>Project Name</label>
                        <input value={projectName} onChange={e => setProjectName(e.target.value)} />
                    </div>
                    <div className="mb-2">
                        <label>Description</label>
                        <textarea value={projectDesc} onChange={e => setProjectDesc(e.target.value)} rows={3} />
                    </div>
                    <button className="btn-primary" onClick={() => updateProject.mutate({ name: projectName, description: projectDesc })}>
                        Save Changes
                    </button>

                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                        <h3>Advanced Features</h3>
                        <div className="flex-center">
                            <input
                                type="checkbox"
                                id="nativeScheduling"
                                checked={nativeScheduling}
                                onChange={e => {
                                    setNativeScheduling(e.target.checked)
                                    updateSetting.mutate({ key: 'telegram_native_scheduling', value: e.target.checked.toString() })
                                }}
                                style={{ marginRight: '0.5rem' }}
                            />
                            <label htmlFor="nativeScheduling">
                                <strong>Enable Native Telegram Scheduling</strong>
                                <p className="text-muted" style={{ fontSize: '0.9rem', margin: 0 }}>
                                    If enabled, posts scheduled for the future will be sent safely to Telegram's "Scheduled Messages" list.
                                    This allows you to turn off this planner app and still have posts published.
                                </p>
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'channels' && (
                <div className="card">
                    <h2>Social Channels</h2>
                    <p className="text-muted mb-2">Connect Telegram channels to publish posts directly.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>Add Telegram Channel</h3>
                        <div className="grid-2" style={{ gap: '1rem' }}>
                            <div>
                                <label>Channel Name (Internal)</label>
                                <input
                                    placeholder="e.g. My Tech Blog"
                                    value={newChannelName}
                                    onChange={e => setNewChannelName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label>Channel ID (starts with -100) or Chat ID</label>
                                <input
                                    placeholder="-100..."
                                    value={newChannelId}
                                    onChange={e => setNewChannelId(e.target.value)}
                                />
                            </div>
                            <div>
                                <label>Username (Optional, for links)</label>
                                <input
                                    placeholder="my_channel"
                                    value={newChannelUsername}
                                    onChange={e => setNewChannelUsername(e.target.value)}
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <button
                                    className="btn-primary"
                                    onClick={handleAddChannel}
                                    disabled={!newChannelName || !newChannelId || addChannel.isPending}
                                    style={{ width: '100%' }}
                                >
                                    {addChannel.isPending ? 'Adding...' : 'Add Channel'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid">
                        {(projectData as any)?.channels?.map((channel: SocialChannel) => (
                            <div key={channel.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div>
                                    <div className="flex-center">
                                        <strong>{channel.name}</strong>
                                        <span className="badge" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{channel.type}</span>
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                        ID: {channel.config?.telegram_channel_id}
                                        {channel.config?.channel_username && ` • @${channel.config.channel_username}`}
                                    </div>
                                </div>
                                {/* <button className="btn-danger">Disconnect</button> */ /* Delete endpoint not yet implemented */}
                            </div>
                        ))}
                        {(!projectData || !(projectData as any).channels?.length) && (
                            <p className="text-muted">No channels connected.</p>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'keys' && (
                <div className="card">
                    <h2>Provider Keys</h2>
                    <p className="text-muted mb-2">Manage API keys for AI providers (OpenAI, Anthropic, Gemini). Keys are stored securely and can be reused.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>Add New Key</h3>
                        <div className="grid-2" style={{ gap: '1rem' }}>
                            <input
                                placeholder="Key Name (e.g. My OpenAI Key)"
                                value={newKeyName}
                                onChange={e => setNewKeyName(e.target.value)}
                            />
                            <div className="flex">
                                <input
                                    type="password"
                                    placeholder="sk-..."
                                    value={newKeyValue}
                                    onChange={e => setNewKeyValue(e.target.value)}
                                    style={{ flex: 1, marginRight: '0.5rem' }}
                                />
                                <button
                                    className="btn-primary"
                                    onClick={() => addKey.mutate({ name: newKeyName, key: newKeyValue })}
                                    disabled={!newKeyName || !newKeyValue}
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid">
                        {keys?.map(key => (
                            <div key={key.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div>
                                    <strong>{key.name}</strong>
                                    <span className="badge ml-1" style={{ fontSize: '0.8rem' }}>{key.provider}</span>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>{key.key}</div>
                                </div>
                                <button className="btn-danger" onClick={() => deleteKey.mutate(key.id)}>Delete</button>
                            </div>
                        ))}
                        {keys?.length === 0 && <p className="text-muted">No keys found.</p>}
                    </div>
                </div>
            )}

            {activeTab === 'team' && (
                <div className="card">
                    <h2>Team Members</h2>
                    <p className="text-muted mb-2">Invite users to collaborate on this project.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>Invite Member</h3>
                        <div className="flex">
                            <input
                                type="email"
                                placeholder="User Email"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                style={{ flex: 1, marginRight: '0.5rem' }}
                            />
                            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ marginRight: '0.5rem' }}>
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                                <option value="owner">Owner</option>
                            </select>
                            <button
                                className="btn-primary"
                                onClick={() => addMember.mutate({ email: inviteEmail, role: inviteRole })}
                                disabled={!inviteEmail}
                            >
                                Invite
                            </button>
                        </div>
                    </div>

                    <div className="grid">
                        {(projectData as any)?.members?.map((m: any) => (
                            <div key={m.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div>
                                    <strong>{m.user?.name || m.user?.email || 'Unknown'}</strong>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>{m.role} • {m.user?.email}</div>
                                </div>
                                {m.role !== 'owner' && (
                                    <button className="btn-danger" onClick={() => removeMember.mutate(m.user_id)}>Remove</button>
                                )}
                            </div>
                        ))}
                        {!(projectData as any)?.members && <p>Loading members...</p>}
                    </div>
                </div>
            )}

            {activeTab === 'agents' && (
                <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: '2rem', alignItems: 'start' }}>
                    <div className="card">
                        <h2>Agent Configuration</h2>
                        <div className="mb-2">
                            <label>Select Agent Role</label>
                            <select value={selectedRole} onChange={(e) => handleSelectRole(e.target.value)}>
                                <option value="post_creator">Post Creator</option>
                                <option value="post_critic">Post Critic</option>
                                <option value="post_fixer">Post Fixer</option>
                                <option value="topic_creator">Topic Creator</option>
                                <option value="topic_critic">Topic Critic</option>
                                <option value="topic_fixer">Topic Fixer</option>
                                <option disabled>--- Image Generation Chain ---</option>
                                <option value="visual_architect">Visual Architect</option>
                                <option value="structural_critic">Structural Critic</option>
                                <option value="precision_fixer">Precision Fixer</option>
                                <option disabled>--- Legacy / Simple Image ---</option>
                                <option value="dalle_image_gen">DALL-E Prompt</option>
                                <option value="nano_image_gen">Nano Banana Prompt</option>
                            </select>
                        </div>

                        {currentAgent && (
                            <div className="grid" style={{ gap: '1rem' }}>
                                <div>
                                    <label>System Prompt</label>
                                    <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={8} style={{ fontFamily: 'monospace' }} />
                                </div>

                                <div>
                                    <label>
                                        API Key
                                        {currentAgent.provider && <span className="badge ml-1">{currentAgent.provider}</span>}
                                    </label>
                                    <select
                                        value={apiKey.startsWith('pk_') ? apiKey : 'custom'}
                                        onChange={e => {
                                            if (e.target.value === 'custom') setApiKey('')
                                            else setApiKey(e.target.value)
                                        }}
                                        style={{ marginBottom: '0.5rem' }}
                                    >
                                        {keys?.map(k => (
                                            <option key={k.id} value={`pk_${k.id}`}>{k.name} ({k.provider})</option>
                                        ))}
                                        <option value="custom">Use Custom Key...</option>
                                    </select>

                                    {(!apiKey.startsWith('pk_')) && (
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={e => setApiKey(e.target.value)}
                                            placeholder="Paste raw API key..."
                                        />
                                    )}
                                </div>

                                <div>
                                    <label>Model Name</label>
                                    <div className="flex">
                                        <input
                                            type="text"
                                            value={model}
                                            onChange={e => setModel(e.target.value)}
                                            style={{ flex: 1 }}
                                            list="model-options"
                                        />
                                        <button
                                            type="button"
                                            className="btn-secondary ml-1"
                                            onClick={handleLoadModels}
                                            disabled={!apiKey || isLoadingModels}
                                        >
                                            {isLoadingModels ? 'Loading...' : '🔍 Load Models'}
                                        </button>
                                    </div>
                                    <datalist id="model-options">
                                        {availableModels.map(m => (
                                            <option key={m} value={m} />
                                        ))}
                                    </datalist>
                                    {availableModels.length > 0 && (
                                        <div className="mt-1">
                                            <small className="text-muted">Detected models: {availableModels.join(', ')}</small>
                                        </div>
                                    )}
                                </div>

                                <button className="btn-primary" onClick={handleSaveAgent} disabled={updateAgent.isPending}>
                                    {updateAgent.isPending ? 'Saving...' : 'Save Configuration'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'presets' && (
                <div className="card">
                    <h2>Style Presets</h2>
                    <div className="card" style={{ background: 'var(--bg-tertiary)', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1rem' }}>{editingPresetId ? 'Edit Preset' : 'New Preset'}</h3>
                        <div className="grid-2 mb-2">
                            <div>
                                <label>Name</label>
                                <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="e.g. LinkedIn Professional" />
                            </div>
                            <div>
                                <label>Role</label>
                                <select value={presetRole} onChange={e => setPresetRole(e.target.value)}>
                                    <option value="post_creator">Post Creator</option>
                                    <option value="topic_creator">Topic Creator</option>
                                </select>
                            </div>
                        </div>
                        <div className="mb-2">
                            <label>System Prompt</label>
                            <textarea value={presetPrompt} onChange={e => setPresetPrompt(e.target.value)} rows={4} placeholder="You are an expert..." />
                        </div>
                        <div className="flex">
                            <button className="btn-primary" onClick={handleSavePreset} disabled={!presetName || !presetPrompt}>
                                {editingPresetId ? 'Update' : 'Create'}
                            </button>
                            {editingPresetId && <button className="btn-secondary" onClick={cancelEditPreset}>Cancel</button>}
                        </div>
                    </div>
                    <div className="grid" style={{ gap: '1rem' }}>
                        {presets?.map(p => (
                            <div key={p.id} style={{ border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px' }}>
                                <div className="flex-between mb-1">
                                    <strong>{p.name} <span className="text-muted" style={{ fontWeight: 'normal' }}>({p.role})</span></strong>
                                    <div>
                                        <button className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginRight: '0.5rem' }} onClick={() => startEditPreset(p)}>Edit</button>
                                        <button className="btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deletePreset.mutate(p.id)}>Delete</button>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'hidden' }}>
                                    {p.prompt_text}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
