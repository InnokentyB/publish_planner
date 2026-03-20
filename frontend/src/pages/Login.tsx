import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');

            login(data.token, data.user, data.projects);
            navigate('/orchestrator');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-4 relative overflow-hidden font-body">
            {/* Background elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute top-0 right-0 w-96 h-96 bg-success/10 rounded-full blur-[100px] pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-96 h-96 ai-gradient opacity-10 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="w-full max-w-md glass-panel p-10 md:p-14 rounded-[3rem] border border-outline-variant/20 shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex flex-col items-center mb-10 text-center">
                    <div className="w-20 h-20 ai-gradient text-white rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-primary/20 rotate-3 group hover:rotate-0 transition-transform duration-300">
                        <span className="material-symbols-outlined text-4xl">rocket_launch</span>
                    </div>
                    <h1 className="text-3xl font-headline font-black tracking-tight text-on-surface mb-2">Project Alpha</h1>
                    <p className="text-sm font-label uppercase tracking-widest text-primary font-bold">Intelligence Matrix</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-error/10 border-l-4 border-error rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2">
                        <span className="material-symbols-outlined text-error text-xl">error</span>
                        <p className="text-xs font-bold text-error leading-relaxed">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2 relative group">
                        <label htmlFor="email" className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1 group-focus-within:text-primary transition-colors">Digital Identity</label>
                        <div className="relative">
                            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">mail</span>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@company.com"
                                className="w-full bg-white/60 border-2 border-transparent focus:border-primary/20 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium shadow-sm transition-all focus:bg-white outline-none"
                                required
                            />
                        </div>
                    </div>
                    
                    <div className="space-y-2 relative group">
                        <label htmlFor="password" className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1 group-focus-within:text-primary transition-colors">Access Key</label>
                        <div className="relative">
                            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">lock</span>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-white/60 border-2 border-transparent focus:border-primary/20 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium shadow-sm transition-all focus:bg-white outline-none"
                                required
                            />
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        disabled={loading}
                        className="w-full mt-4 ai-gradient text-white font-black uppercase tracking-[0.2em] text-xs py-5 rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:animate-pulse flex items-center justify-center gap-3"
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                <span>Authenticating...</span>
                            </>
                        ) : (
                            <>
                                <span>Initialize Node</span>
                                <span className="material-symbols-outlined text-sm">arrow_forward</span>
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-10 text-center border-t border-outline-variant/10 pt-8">
                    <p className="text-xs font-bold text-on-surface-variant">
                        No authorization access?{' '}
                        <Link to="/register" className="text-primary hover:underline underline-offset-4 font-black">Request Clearance</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
