import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import "./Auth.css";

export function SignUp() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [form, setForm] = useState({
    name: "",
    workspaceName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/sign-up", form);
      await refresh();
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="logo-dot" />
          Priceobo
        </div>
        <h1>Create your workspace</h1>
        <p className="muted">Start managing multi-channel pricing</p>

        {error && <div className="auth-error">{error}</div>}

        <div className="field">
          <label>Your name</label>
          <input className="input" required value={form.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label>Workspace name</label>
          <input
            className="input"
            required
            value={form.workspaceName}
            onChange={set("workspaceName")}
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            required
            value={form.email}
            onChange={set("email")}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={set("password")}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
        <p className="auth-foot muted">
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
