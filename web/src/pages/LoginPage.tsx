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
    <main className="login-page">
      <section className="login-visual" aria-label="Zygal operations platform">
        <div className="login-visual-top">
          <div className="login-visual-mark">
            <LogoFull width={74} />
          </div>
          <span>
            ZYGAL<sup>®</sup>
          </span>
        </div>

        <div className="login-visual-copy">
          <span className="login-kicker">Internal operations platform</span>
          <h2>
            Connecting
            <br />
            <em>Structures.</em>
          </h2>
          <p>
            One connected workspace for the teams, sites and support systems
            that keep operations moving.
          </p>
        </div>

        <div className="login-brand-triad" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="login-visual-footer">Deekshaa Infosystems pvt ltd</span>
      </section>

      <section className="login-form-panel" aria-label="Sign in">
        <div className="login-card">
          <header className="login-brand">
            <div className="login-card-mark">
              <LogoFull width={92} />
            </div>
            <div>
              <span className="login-kicker">ZYGAL®</span>
              <h1>{step === "email" ? "Welcome back" : "Check your email"}</h1>
              <p>
                {step === "email"
                  ? "Team Operations & Support Management"
                  : `Enter the verification code sent to ${cleanEmail}`}
              </p>
            </div>
          </header>

          {notice && <div className="banner warn">{notice}</div>}

          {step === "email" ? (
            <form onSubmit={sendCode} noValidate>
              <label htmlFor="email">Authorized email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your authorized email"
                disabled={busy}
              />
              <label className="login-remember">
                <input type="checkbox" checked readOnly />
                <span>Keep me signed in</span>
              </label>
              {error && <div className="banner error">{error}</div>}
              <button type="submit" className="login-submit" disabled={busy}>
                <span>{busy ? "Sending..." : "Continue"}</span>
                <span aria-hidden="true">→</span>
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} noValidate>
              {info && <div className="banner info">{info}</div>}
              <label htmlFor="code">Verification code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter the 6 to 8 digit code"
                disabled={busy}
              />
              {error && <div className="banner error">{error}</div>}
              <button type="submit" className="login-submit" disabled={busy}>
                <span>{busy ? "Checking..." : "Verify and sign in"}</span>
                <span aria-hidden="true">→</span>
              </button>
              <div className="login-actions">
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

          <p className="login-note">
            Only emails authorized by an administrator can receive a
            verification code.
          </p>
        </div>
      </section>
    </main>
  );
}
