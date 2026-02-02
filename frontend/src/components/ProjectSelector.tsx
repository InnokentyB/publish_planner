import { useAuth } from '../context/AuthContext';

export default function ProjectSelector() {
    const { currentProject, projects, setCurrentProject } = useAuth();

    if (projects.length === 0) return null;

    return (
        <div className="flex-center" style={{ gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Project:</span>
            <select
                value={currentProject?.id || ''}
                onChange={(e) => {
                    const project = projects.find(p => p.id === parseInt(e.target.value));
                    if (project) setCurrentProject(project);
                }}
                style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border)'
                }}
            >
                {projects.map(project => (
                    <option key={project.id} value={project.id}>
                        {project.name}
                    </option>
                ))}
            </select>
        </div>
    );
}
