import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { commentsApi } from '../api';

interface Comment {
    id: number;
    text: string;
    author_role: string;
    created_at: string;
}

interface CommentSectionProps {
    entityType: 'week' | 'post';
    entityId: number;
}

export default function CommentSection({ entityType, entityId }: CommentSectionProps) {
    const [text, setText] = useState('');
    const queryClient = useQueryClient();

    const { data: comments, isLoading } = useQuery({
        queryKey: ['comments', entityType, entityId],
        queryFn: () => commentsApi.get(entityType, entityId)
    });

    const mutation = useMutation({
        mutationFn: (newText: string) => commentsApi.create(entityType, entityId, newText),
        onSuccess: () => {
            setText('');
            queryClient.invalidateQueries({ queryKey: ['comments', entityType, entityId] });
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;
        mutation.mutate(text);
    };

    if (isLoading) return <div>Loading comments...</div>;

    return (
        <div className="card mt-2">
            <h3>💬 Comments & Instructions</h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {comments?.length === 0 && <p className="text-muted">No comments yet. Add instructions for the agent here.</p>}
                {comments?.map((c: Comment) => (
                    <div key={c.id} style={{
                        background: c.author_role === 'user' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        alignSelf: c.author_role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%'
                    }}>
                        <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.2rem' }}>
                            {c.author_role === 'user' ? 'You' : 'Agent'} • {new Date(c.created_at).toLocaleString()}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="flex">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type instructions or feedback..."
                    disabled={mutation.isPending}
                />
                <button type="submit" className="btn-primary" disabled={mutation.isPending || !text.trim()}>
                    Send
                </button>
            </form>
        </div>
    );
}
