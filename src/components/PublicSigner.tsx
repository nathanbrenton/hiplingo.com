import { hiplingoLogoUrl } from "@hiplingo/brand";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  PUBLIC_SIGNER_API_BASE,
  publicSignerRequest,
} from "../lib/publicSignerApi";
import {
  getInitialHiplingoTheme,
  rememberHiplingoTheme,
  type HiplingoTheme,
} from "../lib/hiplingoTheme";

import "./public-signer.css";

type PublicSignerParticipant = {
  legal_name: string;
  credited_name: string | null;
};

type PublicSignerAgreement = {
  version: string;
  title: string;
  effective_date: string | null;
  body_markdown: string;
  document_sha256: string;
};

type RightsShare = {
  participant_id: number;
  legal_name: string;
  credited_name: string | null;
  master_ownership_ppm: number;
  master_net_receipts_ppm: number;
  composition_ownership_ppm: number;
  composition_credit: string | null;
};

type RightsShareInstrument = {
  asset?: {
    title?: string | null;
    asset_code?: string;
    session_code?: string;
    session_date?: string;
  };
  shares?: RightsShare[];
  recoupment_notes?: string | null;
};

type PublicSignerPayload = {
  invitation_id: number;
  purpose: "prospective_joinder" | "rights_share" | string;
  expires_at: string;
  participant: PublicSignerParticipant;
  agreement: PublicSignerAgreement;
  intent_statement: string;
  instrument: RightsShareInstrument;
  email_verification_required: boolean;
  email_verified: boolean;
  masked_email: string | null;
};

type PublicSignerOtpSend = {
  status: string;
  delivery_status: string;
  delivery_mode: string;
  expires_at: string | null;
  retry_after_seconds: number | null;
};

type PublicSignerOtpVerify = {
  status: string;
  verified: boolean;
  verified_at: string | null;
};

type PublicSignerComplete = {
  status: string;
  execution_record_id: number;
  document_sha256: string;
  signed_at: string;
  receipt_path: string;
  copy_delivery_status: string;
};

function ThemePicker({
  theme,
  onChange,
}: {
  theme: HiplingoTheme;
  onChange: (theme: HiplingoTheme) => void;
}) {
  return (
    <div className="public-signer-theme-picker" role="group" aria-label="Appearance">
      {(["gray", "purple", "blue"] as HiplingoTheme[]).map((option) => (
        <button
          key={option}
          type="button"
          className={theme === option ? "is-active" : ""}
          aria-pressed={theme === option}
          onClick={() => onChange(option)}
        >
          {option[0].toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}

function BrandRow({
  theme,
  onThemeChange,
}: {
  theme: HiplingoTheme;
  onThemeChange: (theme: HiplingoTheme) => void;
}) {
  return (
    <header className="public-signer-brand-row">
      <a className="public-signer-brand" href="/" aria-label="Hiplingo home">
        <img src={hiplingoLogoUrl} alt="" />
        <span>
          <strong>HIPLINGO</strong>
          <small>Secure agreement</small>
        </span>
      </a>
      <ThemePicker theme={theme} onChange={onThemeChange} />
    </header>
  );
}

function AgreementText({ markdown }: { markdown: string }) {
  const rendered: ReactNode[] = markdown.split(/\n/).map((line, index) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      return <h3 key={index}>{trimmed.slice(4)}</h3>;
    }

    if (trimmed.startsWith("## ")) {
      return <h2 key={index}>{trimmed.slice(3)}</h2>;
    }

    if (trimmed.startsWith("# ")) {
      return <h1 key={index}>{trimmed.slice(2)}</h1>;
    }

    if (trimmed.startsWith("- ")) {
      return (
        <p className="public-signer-agreement-bullet" key={index}>
          • {trimmed.slice(2)}
        </p>
      );
    }

    if (!trimmed) {
      return <div className="public-signer-agreement-space" key={index} />;
    }

    return <p key={index}>{line}</p>;
  });

  return <div className="public-signer-agreement-text">{rendered}</div>;
}

function ppmToPercent(value: number) {
  return `${(value / 10000).toFixed(2).replace(/\.00$/, "")}%`;
}

function signerErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error:\s*/, "");
}

export default function PublicSigner({ token }: { token: string }) {
  const [data, setData] = useState<PublicSignerPayload | null>(null);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<PublicSignerComplete | null>(null);
  const [consent, setConsent] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpStatus, setOtpStatus] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [theme, setTheme] = useState<HiplingoTheme>(getInitialHiplingoTheme);

  useEffect(() => {
    rememberHiplingoTheme(theme);
  }, [theme]);

  useEffect(() => {
    let active = true;

    document.body.classList.add("hiplingo-public-signer-mode");
    document.title = "Secure Agreement · Hiplingo";

    publicSignerRequest<PublicSignerPayload>(
      `/public/signer/${encodeURIComponent(token)}`,
    )
      .then((payload) => {
        if (active) {
          setData(payload);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(signerErrorMessage(requestError));
        }
      });

    return () => {
      active = false;
      document.body.classList.remove("hiplingo-public-signer-mode");
    };
  }, [token]);

  async function sendOtp() {
    setError("");
    setOtpStatus("");
    setOtpSending(true);

    try {
      const result = await publicSignerRequest<PublicSignerOtpSend>(
        `/public/signer/${encodeURIComponent(token)}/otp/send`,
        { method: "POST" },
      );

      if (result.status === "already_verified") {
        setData((current) =>
          current ? { ...current, email_verified: true } : current,
        );
        setOtpStatus("Email verification is already complete.");
      } else if (result.delivery_mode === "file") {
        setOtpStatus(
          "Development verification message written to the local Rights mail outbox. Enter the six-digit code from that message.",
        );
      } else {
        setOtpStatus("Verification code sent. Check your email for the six-digit code.");
      }
    } catch (requestError) {
      setError(signerErrorMessage(requestError));
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(otpCode)) {
      setError("Enter the six-digit verification code.");
      return;
    }

    setError("");
    setOtpVerifying(true);

    try {
      const result = await publicSignerRequest<PublicSignerOtpVerify>(
        `/public/signer/${encodeURIComponent(token)}/otp/verify`,
        {
          method: "POST",
          body: JSON.stringify({ code: otpCode }),
        },
      );

      if (result.verified) {
        setData((current) =>
          current ? { ...current, email_verified: true } : current,
        );
        setOtpStatus("Email verification complete.");
        setOtpCode("");
      }
    } catch (requestError) {
      setError(signerErrorMessage(requestError));
    } finally {
      setOtpVerifying(false);
    }
  }

  async function submitSignature() {
    if (data?.email_verification_required && !data.email_verified) {
      setError("Verify your email before signing.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const result = await publicSignerRequest<PublicSignerComplete>(
        `/public/signer/${encodeURIComponent(token)}/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            signature_name: signatureName,
            electronic_consent: consent,
            agreement_acknowledged: acknowledged,
            signature_intent_confirmed: intentConfirmed,
          }),
        },
      );

      setCompleted(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(signerErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  function changeTheme(nextTheme: HiplingoTheme) {
    setTheme(nextTheme);
  }

  if (error && !data) {
    return (
      <main className="hiplingo-public-signer" data-theme={theme}>
        <div className="public-signer-shell">
          <BrandRow theme={theme} onThemeChange={changeTheme} />
          <section className="public-signer-card public-signer-error-card">
            <p className="public-signer-eyebrow">Secure signing</p>
            <h1>Signing link unavailable</h1>
            <p>{error}</p>
          </section>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="hiplingo-public-signer" data-theme={theme}>
        <div className="public-signer-shell">
          <BrandRow theme={theme} onThemeChange={changeTheme} />
          <section className="public-signer-card public-signer-loading-card">
            <div className="public-signer-loading-dot" aria-hidden="true" />
            <p>Loading secure agreement…</p>
          </section>
        </div>
      </main>
    );
  }

  if (completed) {
    return (
      <main className="hiplingo-public-signer" data-theme={theme}>
        <div className="public-signer-shell">
          <BrandRow theme={theme} onThemeChange={changeTheme} />
          <section className="public-signer-card public-signer-complete-card">
            <div className="public-signer-success-mark" aria-hidden="true">
              ✓
            </div>
            <p className="public-signer-eyebrow">Execution recorded</p>
            <h1>
              Thank you, {data.participant.credited_name || data.participant.legal_name}.
            </h1>
            <p>
              Your electronic signature has been tied to this exact agreement and
              retained in Hiplingo&apos;s private rights record.
            </p>
            <a
              className="public-signer-download"
              href={`${PUBLIC_SIGNER_API_BASE}${completed.receipt_path}`}
            >
              Download signed copy (PDF)
            </a>
            <p className="public-signer-fine">
              {completed.copy_delivery_status === "emailed"
                ? "A signed PDF copy was also emailed to the address on file."
                : completed.copy_delivery_status === "email_outbox_ready"
                  ? "A delivery copy was prepared in the local development mail outbox."
                  : completed.copy_delivery_status === "email_failed"
                    ? "Automatic email delivery could not be confirmed. Download and retain the PDF here."
                    : "This secure receipt remains available from this invitation until it expires."}
            </p>
            <div className="public-signer-hash-block">
              <span>Execution SHA-256</span>
              <code>{completed.document_sha256}</code>
            </div>
            <p className="public-signer-fine">
              Execution record #{completed.execution_record_id} ·{" "}
              {new Date(completed.signed_at).toLocaleString()}
            </p>
            <a className="public-signer-home-link" href="/">
              Return to Hiplingo
            </a>
          </section>
        </div>
      </main>
    );
  }

  const verificationReady =
    !data.email_verification_required || data.email_verified;
  const shares = data.instrument.shares || [];
  const asset = data.instrument.asset;

  return (
    <main className="hiplingo-public-signer" data-theme={theme}>
      <div className="public-signer-shell">
        <BrandRow theme={theme} onThemeChange={changeTheme} />

        <div className="public-signer-progress" aria-label="Signing progress">
          <span className="is-active">1 Review</span>
          {data.email_verification_required && (
            <span className={data.email_verified ? "is-active" : ""}>2 Verify</span>
          )}
          <span>{data.email_verification_required ? "3 Confirm" : "2 Confirm"}</span>
          <span>{data.email_verification_required ? "4 Sign" : "3 Sign"}</span>
        </div>

        <section className="public-signer-hero">
          <p className="public-signer-eyebrow">Secure signing invitation</p>
          <h1>{data.agreement.title}</h1>
          <p>
            Prepared for <strong>{data.participant.legal_name}</strong>
            {data.participant.credited_name &&
            data.participant.credited_name !== data.participant.legal_name
              ? ` (${data.participant.credited_name})`
              : ""}
            .
          </p>
          <div className="public-signer-meta">
            <span>Version {data.agreement.version}</span>
            <span>Expires {new Date(data.expires_at).toLocaleString()}</span>
          </div>
        </section>

        {data.purpose === "rights_share" && asset && (
          <section className="public-signer-card">
            <p className="public-signer-eyebrow">Asset-specific terms</p>
            <h2>{asset.title || asset.asset_code || "Session asset"}</h2>
            {(asset.session_code || asset.session_date) && (
              <p className="public-signer-fine">
                {[asset.session_code, asset.session_date].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="public-signer-share-grid">
              {shares.map((share) => (
                <article className="public-signer-share-card" key={share.participant_id}>
                  <strong>{share.credited_name || share.legal_name}</strong>
                  <span>Master ownership {ppmToPercent(share.master_ownership_ppm)}</span>
                  <span>Master receipts {ppmToPercent(share.master_net_receipts_ppm)}</span>
                  <span>Composition {ppmToPercent(share.composition_ownership_ppm)}</span>
                  {share.composition_credit && (
                    <span>Credit: {share.composition_credit}</span>
                  )}
                </article>
              ))}
            </div>
            {data.instrument.recoupment_notes && (
              <div className="public-signer-note">
                <strong>Recoupment / service note</strong>
                <p>{data.instrument.recoupment_notes}</p>
              </div>
            )}
          </section>
        )}

        <section className="public-signer-card public-signer-agreement-card">
          <div className="public-signer-agreement-top">
            <div>
              <p className="public-signer-eyebrow">Agreement text</p>
              <h2>Review the complete terms</h2>
            </div>
            <span className="public-signer-hash-badge">SHA-256 verified</span>
          </div>
          <AgreementText markdown={data.agreement.body_markdown} />
          <div className="public-signer-hash-block">
            <span>Published agreement SHA-256</span>
            <code>{data.agreement.document_sha256}</code>
          </div>
        </section>

        {data.email_verification_required && (
          <section
            className={`public-signer-card public-signer-verify-card ${
              data.email_verified ? "is-verified" : ""
            }`}
          >
            <p className="public-signer-eyebrow">Email verification</p>
            <h2>{data.email_verified ? "Email verified" : "Verify before signing"}</h2>
            <p>
              {data.email_verified
                ? `Verification is complete for ${data.masked_email || "the email address on file"}.`
                : `Request a six-digit code sent to ${data.masked_email || "the email address on file"}.`}
            </p>
            {!data.email_verified && (
              <div className="public-signer-otp-actions">
                <button type="button" onClick={sendOtp} disabled={otpSending}>
                  {otpSending ? "Sending…" : "Send verification code"}
                </button>
                <div className="public-signer-otp-entry">
                  <input
                    aria-label="Six-digit verification code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otpCode}
                    placeholder="000000"
                    onChange={(event) =>
                      setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                  <button
                    type="button"
                    className="is-primary"
                    onClick={verifyOtp}
                    disabled={otpVerifying || otpCode.length !== 6}
                  >
                    {otpVerifying ? "Verifying…" : "Verify code"}
                  </button>
                </div>
              </div>
            )}
            {otpStatus && <div className="public-signer-status">{otpStatus}</div>}
          </section>
        )}

        <section
          className={`public-signer-card public-signer-confirm-card ${
            verificationReady ? "" : "is-locked"
          }`}
        >
          <p className="public-signer-eyebrow">Confirm & sign</p>
          <h2>Your electronic signature</h2>
          {!verificationReady && (
            <div className="public-signer-lock-notice">
              Complete email verification above before signing.
            </div>
          )}
          <p>{data.intent_statement}</p>

          <label className="public-signer-check-row">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!verificationReady}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I have reviewed the agreement and the terms shown above.</span>
          </label>
          <label className="public-signer-check-row">
            <input
              type="checkbox"
              checked={consent}
              disabled={!verificationReady}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I consent to conduct this transaction electronically and receive/retain
              electronic records.
            </span>
          </label>
          <label className="public-signer-check-row">
            <input
              type="checkbox"
              checked={intentConfirmed}
              disabled={!verificationReady}
              onChange={(event) => setIntentConfirmed(event.target.checked)}
            />
            <span>
              I intend my typed legal name below to serve as my electronic signature.
            </span>
          </label>

          <label className="public-signer-signature-field">
            <span>Type your full legal name exactly</span>
            <input
              autoComplete="name"
              disabled={!verificationReady}
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder={data.participant.legal_name}
            />
          </label>

          {error && <div className="public-signer-inline-error">{error}</div>}

          <button
            className="public-signer-submit"
            disabled={
              !verificationReady ||
              submitting ||
              !acknowledged ||
              !consent ||
              !intentConfirmed ||
              !signatureName.trim()
            }
            onClick={submitSignature}
          >
            {submitting ? "Recording signature…" : "Sign & complete"}
          </button>

          <p className="public-signer-fine">
            This secure link is single-use for signing. Hiplingo retains the exact
            published agreement, execution evidence, and document hashes in its private
            rights records.
          </p>
        </section>
      </div>
    </main>
  );
}
