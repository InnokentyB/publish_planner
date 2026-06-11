import React, { createContext, useContext, useState, useEffect } from 'react';

interface User {
    id: number;
    email: string;
    name?: string;
}

interface Project {
    id: number;
    name: string;
}

interface AuthContextType {
    user: User | null;
    currentProject: Project | null;
    projects: Project[];
    token: string | null;
    login: (token: string, user: User, projects: Project[]) => void;
    logout: () => void;
    setCurrentProject: (project: Project) => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    createProject: (project: Project) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [currentProject, setCurrentProjectState] = useState<Project | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [isLoading, setIsLoading] = useState(true);

    const syncSessionFromBackend = async (activeToken: string, fallbackProjects?: Project[]) => {
        const apiBaseUrl = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
            headers: {
                Authorization: `Bearer ${activeToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Auth sync failed with status ${response.status}`);
        }

        const data = await response.json();
        const backendUser = data.user as User;
        const backendProjects = (data.projects || []) as Project[];
        const savedProjectId = localStorage.getItem('projectId');

        setUser(backendUser);
        setProjects(backendProjects);
        localStorage.setItem('user', JSON.stringify(backendUser));
        localStorage.setItem('projects', JSON.stringify(backendProjects));

        const preferredProjectId = savedProjectId ? parseInt(savedProjectId, 10) : fallbackProjects?.[0]?.id;
        const resolvedProject = preferredProjectId
            ? backendProjects.find((project) => project.id === preferredProjectId) || null
            : null;

        if (resolvedProject) {
            setCurrentProjectState(resolvedProject);
            localStorage.setItem('projectId', resolvedProject.id.toString());
        } else if (backendProjects.length > 0) {
            setCurrentProjectState(backendProjects[0]);
            localStorage.setItem('projectId', backendProjects[0].id.toString());
        } else {
            setCurrentProjectState(null);
            localStorage.removeItem('projectId');
        }
    };

    useEffect(() => {
        const savedUser = localStorage.getItem('user');
        const savedProjects = localStorage.getItem('projects');
        const savedProjectId = localStorage.getItem('projectId');

        const bootstrapAuth = async () => {
            if (savedUser && savedProjects && token) {
                try {
                    const parsedUser = JSON.parse(savedUser);
                    const parsedProjects = JSON.parse(savedProjects);
                    setUser(parsedUser);
                    setProjects(parsedProjects);

                    if (savedProjectId) {
                        const project = parsedProjects.find((p: Project) => p.id === parseInt(savedProjectId));
                        if (project) setCurrentProjectState(project);
                    } else if (parsedProjects.length > 0) {
                        setCurrentProjectState(parsedProjects[0]);
                        localStorage.setItem('projectId', parsedProjects[0].id.toString());
                    }

                    await syncSessionFromBackend(token, parsedProjects);
                } catch (e) {
                    console.error('Failed to parse or sync auth data', e);
                    localStorage.clear();
                    setToken(null);
                    setUser(null);
                    setProjects([]);
                    setCurrentProjectState(null);
                } finally {
                    setIsLoading(false);
                }
                return;
            }

            if (token) {
                try {
                    await syncSessionFromBackend(token);
                } catch (e) {
                    console.error('Failed to sync auth data', e);
                    localStorage.clear();
                    setToken(null);
                    setUser(null);
                    setProjects([]);
                    setCurrentProjectState(null);
                } finally {
                    setIsLoading(false);
                }
                return;
            }

            setIsLoading(false);
        };

        bootstrapAuth();
    }, [token]);

    const login = (token: string, user: User, projects: Project[]) => {
        setToken(token);
        setUser(user);
        setProjects(projects);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('projects', JSON.stringify(projects));

        if (projects.length > 0) {
            setCurrentProjectState(projects[0]);
            localStorage.setItem('projectId', projects[0].id.toString());
        }
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        setProjects([]);
        setCurrentProjectState(null);
        localStorage.clear();
        window.location.href = '/login';
    };

    const setCurrentProject = (project: Project) => {
        setCurrentProjectState(project);
        localStorage.setItem('projectId', project.id.toString());
        window.location.reload(); // Simplest way to re-fetch all data with new project header
    };

    const createProject = (project: Project) => {
        const updatedProjects = [...projects, project];
        setProjects(updatedProjects);
        localStorage.setItem('projects', JSON.stringify(updatedProjects));
        setCurrentProject(project);
    };

    return (
        <AuthContext.Provider value={{
            user,
            currentProject,
            projects,
            token,
            login,
            logout,
            setCurrentProject,
            createProject,
            isAuthenticated: !!token,
            isLoading
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
