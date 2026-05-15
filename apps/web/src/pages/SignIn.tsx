import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { signIn, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      toast.error(err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="card w-full max-w-md card-pad">
        <div className="mb-6 flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1f47e5" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="15" fill="url(#g1)" />
            <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2" />
            <circle cx="16" cy="16" r="4" fill="#fff" />
          </svg>
          <div className="text-[18px] font-semibold tracking-tight">Priceobo</div>
        </div>

        <h1 className="text-[20px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[13px] text-ink-3">Welcome back — sign in to your workspace.</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center text-[12.5px] text-ink-3">
          New here?{' '}
          <Link to="/sign-up" className="font-semibold text-brand-700">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
