import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import "./Auth.css";

interface InviteInfo {
  email: string;
  name: string;
  workspaceName: string;
  role: string;
}

export function AcceptInvite() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This invitation link is missing its token.");
      setLoading(false);
      return;
    }
    api
      .get<InviteInfo>(`/auth/invite/${token}`)
      .then((data) => {
        setInfo(data);
        setName(data.name);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "This invitation is invalid or has expired.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/accept-invite", { token, name, password });
      await refresh();
      nav("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not accept invitation",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={24} />
          Priceobo
        </div>

        {loading ? (
          <div className="center-fill" style={{ padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : loadError ? (
          <>
            <h1>Invitation unavailable</h1>
            <div className="auth-error">{loadError}</div>
            <p className="auth-foot muted">
              Ask your admin to send a new invitation.
            </p>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: "contents" }}>
            <h1>Set up your account</h1>
            <p className="muted">
              You were invited to <strong>{info?.workspaceName}</strong> as{" "}
              <strong>{info?.role}</strong>.
            </p>

            {error && <div className="auth-error">{error}</div>}

            <div className="field">
              <label>Email</label>
              <input
                className="form-control"
                type="email"
                value={info?.email ?? ""}
                disabled
                readOnly
              />
            </div>
            <div className="field">
              <label>Your name</label>
              <input
                className="form-control"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="form-control"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
