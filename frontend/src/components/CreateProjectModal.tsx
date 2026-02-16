import React, { useState } from 'react';
import { projectsApi } from '../api';

interface CreateProjectModalProps {
    onClose: () => void;
    onSuccess: (project: any) => void;
}

export default function CreateProjectModal({ onClose, onSuccess }: CreateProjectModalProps) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const project = await projectsApi.create({ name, slug, description });
            onSuccess(project);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create project');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div className="card" style={{ width: '400px', maxWidth: '90%' }}>
                <h2 className="mb-3">Create New Project</h2>

                {error && <div className="error mb-3">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            placeholder="My Awesome Project"
                        />
                    </div>

                    <div className="mb-3">
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Slug (Optional)</label>
                        <input
                            type="text"
                            value={slug}
                            onChange={e => setSlug(e.target.value)}
                            placeholder="my-awesome-project"
                        />
                        <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
                            Unique identifier for URLs. Leave empty to auto-generate.
                        </div>
                    </div>

                    <div className="mb-3">
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            placeholder="What is this project about?"
                        />
                    </div>

                    <div className="flex-between">
                        <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn-primary" disabled={isLoading}>
                            {isLoading ? 'Creating...' : 'Create Project'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
