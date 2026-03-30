import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, projects, currentProject, setCurrentProject, logout } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { label: 'Projects', path: '/orchestrator', icon: 'folder_open' },
    { label: 'Guide', path: '/guide', icon: 'help_outline' },
    { label: 'Calendar', path: '/', icon: 'calendar_month' },
    { label: 'Settings', path: '/settings', icon: 'settings' },
  ];

  return (
    <div className="bg-surface font-body text-on-surface flex min-h-screen overflow-hidden">
      {/* SideNavBar */}
      <aside className="bg-surface-container-low w-64 h-full flex flex-col py-8 px-4 border-r-0 shrink-0 border-outline-variant/10">
        <div className="mb-10 px-2 space-y-4">
          <Link to="/" className="block hover:opacity-80 transition-opacity">
            <h1 className="text-2xl font-black text-primary tracking-tighter font-headline">Project Alpha</h1>
            <p className="text-xs text-on-surface-variant font-label mt-1">Status Tracking Beta</p>
          </Link>
          
          {/* Project Switcher */}
          {projects.length > 0 && (
            <div className="relative group">
              <select
                className="w-full appearance-none bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/10 rounded-xl py-3 pl-4 pr-10 text-sm font-bold text-on-surface cursor-pointer focus:ring-2 focus:ring-primary/20 transition-all outline-none shadow-sm group-hover:shadow-md"
                value={currentProject?.id || ''}
                onChange={(e) => {
                  const selectedId = parseInt(e.target.value);
                  const selectedProject = projects.find(p => p.id === selectedId);
                  if (selectedProject) {
                    setCurrentProject(selectedProject);
                  }
                }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none group-hover:text-primary transition-colors text-lg">
                expand_more
              </span>
            </div>
          )}
        </div>
        
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
                isActive(item.path)
                  ? 'text-primary font-bold border-r-4 border-primary bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-1">
          <button 
            className="w-full ai-gradient-bg text-white font-bold py-4 rounded-xl mb-6 shadow-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            onClick={() => {/* TODO: Global New Post Trigger */}}
          >
            <span className="material-symbols-outlined">add</span>
            <span className="font-headline tracking-tight">New Post</span>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/10 transition-all duration-200"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="font-label">Logout</span>
          </button>

          <div className="mt-8 pt-6 border-t border-outline-variant/15 flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold">
              {user?.name?.[0] || user?.email?.[0] || 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user?.name || 'User'}</p>
              <p className="text-xs text-on-surface-variant truncate">Pro Plan</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface relative overflow-y-auto">
        {/* TopNavBar */}
        <header className="flex justify-between items-center w-full px-8 h-20 sticky top-0 bg-surface/80 backdrop-blur-xl z-30 border-b border-outline-variant/5">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold text-primary font-headline">Cognitive Assistant</span>
            <div className="relative hidden lg:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
              <input 
                className="bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm w-64 focus:ring-2 focus:ring-primary/20" 
                placeholder="Search..." 
                type="text"
              />
            </div>
          </div>
          <nav className="flex items-center gap-8 h-full">
            <Link to="/orchestrator" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">Dashboard</Link>
            <Link to="/" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">Weekly</Link>
            <div className="flex items-center gap-4 ml-4">
              <button className="p-2 text-on-surface-variant hover:opacity-80 transition-opacity">
                <span className="material-symbols-outlined">notifications_active</span>
              </button>
              <button className="bg-primary text-white px-5 py-2 rounded-full font-bold text-sm shadow-sm hover:opacity-90 transition-opacity">
                Generate AI
              </button>
            </div>
          </nav>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 w-full flex flex-col overflow-hidden">
           {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
