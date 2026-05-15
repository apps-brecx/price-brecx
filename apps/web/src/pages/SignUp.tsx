import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth';

export default function SignUp() {
  const { signUp, user, loading } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signUp(form);
    } catch (err: any) {
      toast.error(err.message || 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="card w-full max-w-md card-pad">
        <h1 className="text-[20px] font-semibold">Create your workspace</h1>
        <p className="mt-1 text-[13px] text-ink-3">Start managing prices across marketplaces.</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div>
            <label className="label">Your name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Workspace name</label>
            <input
              className="input"
              required
              value={form.workspaceName}
              onChange={(e) => setForm({ ...form, workspaceName: e.target.value })}
              placeholder="e.g. Brecx US"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <div className="mt-1 text-[11.5px] text-ink-3">At least 8 characters.</div>
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div className="mt-4 text-center text-[12.5px] text-ink-3">
          Already have an account?{' '}
          <Link to="/sign-in" className="font-semibold text-brand-700">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
