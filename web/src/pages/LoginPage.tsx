import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { LogoFull } from "../components/Logo";

const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6,8}$/;

export default function LoginPage() {
  const { status, notice, requestCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (status === "signed_in") return <Navigate to="/" replace />;

  const cleanEmail = email.trim().toLowerCase();

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError("");
    if (!EMAIL_RE.test(cleanEmail)) {
      setError("Enter your official email address.");
      return;
    }
    setBusy(true);
    const result = await requestCode(cleanEmail);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Something went wrong. Please try again.");
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_SECONDS);
    setInfo(
      "If this email is registered, a code is on its way. Check your inbox and spam folder.",
    );
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!CODE_RE.test(code)) {
      setError("Enter the 6 to 8 digit code from the email.");
      return;
    }
    setBusy(true);
    const result = await verifyCode(cleanEmail, code);
    setBusy(false);
    if (!result.ok) setError(result.message ?? "Could not verify the code.");
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setError("");
    setInfo("");
  }

  return (
    <main className="login-wrap">
      <div className="login-layout">
        <div className="login-card">
          <div className="login-brand">
            <LogoFull width={170} />
          </div>
          <h1>Team Operations</h1>
          <p
            className="muted small"
            style={{ textAlign: "center", marginTop: -8 }}
          >
            Sign in with your office email
          </p>

          {notice && <div className="banner warn">{notice}</div>}

          {step === "email" ? (
            <form onSubmit={sendCode} noValidate>
              <label htmlFor="email">Official email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@zygal.io"
                disabled={busy}
              />
              {error && <div className="banner error">{error}</div>}
              <button type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send code"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} noValidate>
              <p className="muted small">
                Code sent to <strong>{cleanEmail}</strong>
              </p>
              {info && <div className="banner info">{info}</div>}
              <label htmlFor="code">One-time code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="12345678"
                disabled={busy}
              />
              {error && <div className="banner error">{error}</div>}
              <button type="submit" disabled={busy}>
                {busy ? "Checking..." : "Verify and sign in"}
              </button>
              <div className="row">
                <button
                  type="button"
                  className="link"
                  disabled={busy || cooldown > 0}
                  onClick={() => void sendCode()}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={changeEmail}
                  disabled={busy}
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}
        </div>
        <aside className="login-side-panel">
          <div className="login-side-content">
            <div className="login-side-logo">
              <LogoFull width={240} />
            </div>
            <p>Manage installations, support calls, and site data — all in one place.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
