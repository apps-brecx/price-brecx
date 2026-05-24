import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import "./Auth.css";

/** Server response from /auth/sign-in (step 1). */
interface SignInResp {
  requireOtp: true;
  email: string;
  expiresInMinutes: number;
}

export function SignIn() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Two-step state. After password verification we move to "otp" mode and
   *  show the 6-digit code input instead of email/password. */
  const [step, setStep] = useState<"creds" | "otp">("creds");
  const [code, setCode] = useState("");
  /** Wall-clock expiry of the issued OTP for the countdown display. */
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  /** Tick state for the live countdown — incrementing this re-renders the
   *  "Expires in X:XX" label without forcing the whole form to re-mount. */
  const [, setTick] = useState(0);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Countdown ticker — runs only while we're on the OTP step.
  useEffect(() => {
    if (step !== "otp" || expiresAt == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [step, expiresAt]);

  // Auto-focus the OTP input as soon as we switch to step 2.
  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus();
  }, [step]);

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.post<SignInResp>("/auth/sign-in", {
        email,
        password,
      });
      setExpiresAt(Date.now() + res.expiresInMinutes * 60_000);
      setCode("");
      setStep("otp");
      setInfo(`Sign-in code emailed to ${res.email}. Check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Enter the full 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/verify-otp", { email, code });
      await refresh();
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await api.post<SignInResp>("/auth/sign-in", {
        email,
        password,
      });
      setExpiresAt(Date.now() + res.expiresInMinutes * 60_000);
      setCode("");
      setInfo(`New code sent to ${res.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resend code");
    } finally {
      setBusy(false);
    }
  }

  function backToCreds() {
    setStep("creds");
    setCode("");
    setError(null);
    setInfo(null);
    setExpiresAt(null);
  }

  /** Countdown label — returns "4:32" form, or "Expired" when past the deadline. */
  function countdownLabel(): string {
    if (expiresAt == null) return "";
    const remaining = Math.max(0, expiresAt - Date.now());
    if (remaining === 0) return "Expired";
    const mins = Math.floor(remaining / 60_000);
    const secs = Math.floor((remaining % 60_000) / 1000);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const expired = expiresAt != null && Date.now() > expiresAt;

  return (
    <div className="auth-shell">
      {step === "creds" ? (
        <form className="auth-card" onSubmit={submitCreds}>
          <div className="auth-brand">
            <Logo size={24} />
            Priceobo
          </div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your workspace</p>

          {error && <div className="auth-error">{error}</div>}

          <div className="field">
            <label>Email</label>
            <input
              className="form-control"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="form-control"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Sending code…" : "Continue"}
          </button>
          <p className="auth-foot muted">
            Access is invite-only. Ask an admin to invite you.
          </p>
        </form>
      ) : (
        <form className="auth-card" onSubmit={submitOtp}>
          <div className="auth-brand">
            <Logo size={24} />
            Priceobo
          </div>
          <h1>Check your email</h1>
          <p className="muted">
            We sent a 6-digit code to <strong>{email}</strong>. It expires in{" "}
            <strong>{countdownLabel()}</strong>.
          </p>

          {info && <div className="auth-info">{info}</div>}
          {error && <div className="auth-error">{error}</div>}

          <div className="field">
            <label>Verification code</label>
            <input
              ref={otpInputRef}
              className="form-control auth-otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              placeholder="••••••"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
            />
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={busy || code.length !== 6 || expired}
          >
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              fontSize: 12.5,
            }}
          >
            <button
              type="button"
              className="auth-link"
              onClick={backToCreds}
              disabled={busy}
            >
              ← Back
            </button>
            <button
              type="button"
              className="auth-link"
              onClick={resendCode}
              disabled={busy}
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
