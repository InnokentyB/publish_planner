import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

interface AgentConfig {
    role: string
    prompt: string
    apiKey: string
    model: string
}

interface AgentRun {
    id: number
    topic: string
    final_score: number | null
    total_iterations: number | null
    created_at: string
}

export default function Settings() {
    const queryClient = useQueryClient()
    const [selectedRole, setSelectedRole] = useState<string>('post_creator')
    const [prompt, setPrompt] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [model, setModel] = useState('')

    const { data: agents } = useQuery<AgentConfig[]>({
        queryKey: ['agents'],
        queryFn: async () => {
            const res = await fetch('/api/settings/agents')
            if (!res.ok) throw new Error('Failed to fetch agents')
            return res.json()
        }
    })

    const { data: runs } = useQuery<AgentRun[]>({
        queryKey: ['runs'],
        queryFn: async () => {
            const res = await fetch('/api/settings/runs')
            if (!res.ok) throw new Error('Failed to fetch runs')
            return res.json()
        }
    })

    const updateAgent = useMutation({
        mutationFn: async (data: { role: string; prompt: string; apiKey: string; model: string }) => {
            const res = await fetch(`/api/settings/agents/${data.role}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            if (!res.ok) throw new Error('Failed to update agent')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agents'] })
        }
    })

    const currentAgent = agents?.find(a => a.role === selectedRole)

    const handleSelectRole = (role: string) => {
        setSelectedRole(role)
        const agent = agents?.find(a => a.role === role)
        if (agent) {
            setPrompt(agent.prompt)
            setApiKey(agent.apiKey)
            setModel(agent.model)
        }
    }

    const handleSave = () => {
        updateAgent.mutate({ role: selectedRole, prompt, apiKey, model })
    }

    return (
        <div className="container">
            <h1 className="mb-3">Settings</h1>

            <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: '2rem', alignItems: 'start' }}>
                <div>
                    <div className="card mb-3">
                        <h2>Agent Configuration</h2>

                        <div className="mb-2">
                            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                Select Agent Role
                            </label>
                            <select value={selectedRole} onChange={(e) => handleSelectRole(e.target.value)}>
                                <option value="post_creator">Post Creator</option>
                                <option value="post_critic">Post Critic</option>
                                <option value="post_fixer">Post Fixer</option>
                                <option value="topic_creator">Topic Creator</option>
                                <option value="topic_critic">Topic Critic</option>
                                <option value="topic_fixer">Topic Fixer</option>
                            </select>
                        </div>

                        {currentAgent && (
                            <div className="grid" style={{ gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                        System Prompt
                                    </label>
                                    <textarea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        rows={8}
                                        style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                        API Key
                                    </label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="sk-..."
                                    />
                                    <div className="text-muted mt-1">
                                        Starts with: sk-ant (Anthropic), AIza (Gemini), or sk- (OpenAI)
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                        Model Name
                                    </label>
                                    <input
                                        type="text"
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        placeholder="e.g., gpt-4o, claude-3-haiku-20240307, gemini-1.5-flash"
                                    />
                                </div>

                                <button
                                    className="btn-primary"
                                    onClick={handleSave}
                                    disabled={updateAgent.isPending}
                                >
                                    {updateAgent.isPending ? 'Saving...' : 'Save Configuration'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="card" style={{ position: 'sticky', top: '2rem' }}>
                    <h3>Recent Agent Runs</h3>
                    {runs && runs.length > 0 ? (
                        <div style={{ maxHeight: '600px', overflow: 'auto' }}>
                            {runs.slice(0, 20).map((run) => (
                                <div key={run.id} className="mb-2" style={{
                                    padding: '0.75rem',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '6px'
                                }}>
                                    <div style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                                        {run.topic}
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        Score: {run.final_score || 'N/A'} | Iterations: {run.total_iterations || 'N/A'}
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                        {new Date(run.created_at).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-muted">No runs yet</p>
                    )}
                </div>
            </div>
        </div>
    )
}
