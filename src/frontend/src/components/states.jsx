import { useEffect, useState } from "react";

export function LoadingSkeleton({ rows = 5, label = "Loading" }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton row" style={{ width: `${92 - index * 6}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "26px 16px" }}>
      <h3>{title}</h3>
      {message ? <p className="muted">{message}</p> : null}
      {action ? <div className="mt">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const code = error?.code ?? "ERROR";
  const message = error?.message ?? "Unexpected error";
  return (
    <div className="banner danger" role="alert">
      <strong>
        {code}
        {error?.status ? ` · HTTP ${error.status}` : ""}
      </strong>
      {message}
      {onRetry ? (
        <div className="mt">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Banner({ tone = "info", title, children }) {
  return (
    <div className={`banner ${tone}`}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  );
}

export function UnknownReviewBanner({ reason }) {
  return (
    <Banner tone="review" title="Unknown / review required">
      The system cannot conclude from the available data{reason ? `: ${reason}` : "."} Do not assume the cargo is safe.
    </Banner>
  );
}

export function NotActionableBanner({ reason }) {
  return (
    <Banner tone="info" title={`Not actionable (${reason ?? "status"})`}>
      This shipment is read-only; no new recommendations can be created for it.
    </Banner>
  );
}

export function FieldErrors({ error }) {
  const issues = error?.isValidation?.() ? error.details?.issues : null;
  if (!issues || issues.length === 0) return null;
  return (
    <div className="banner danger" role="alert">
      <strong>Please fix the following</strong>
      <ul className="reasons">
        {issues.map((issue, index) => (
          <li key={index}>
            <span className="muted">{issue.path || "field"}:</span> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Toast({ message, tone = "info", onDismiss, autoDismissMs = 6000 }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (!autoDismissMs) return undefined;
    const id = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(id);
  }, [message, autoDismissMs, onDismiss]);

  if (!visible || !message) return null;
  return (
    <div className={`toast ${tone}`} role="status">
      <div className="row">
        <span>{message}</span>
        <span className="spacer" />
        <button type="button" className="link" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
