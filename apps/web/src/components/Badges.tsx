const STATUS_MAP: Record<string, { badge: string; dot: string }> = {
  active:    { badge: "badge-success", dot: "dot-success" },
  running:   { badge: "badge-success", dot: "dot-success" },
  completed: { badge: "badge-success", dot: "dot-success" },
  scheduled: { badge: "badge-info",    dot: "dot-info" },
  inactive:  { badge: "badge-neutral", dot: "dot-muted" },
  incomplete:{ badge: "badge-warning", dot: "dot-warn" },
  reverted:  { badge: "badge-warning", dot: "dot-warn" },
  cancelled: { badge: "badge-neutral", dot: "dot-muted" },
  failed:    { badge: "badge-danger",  dot: "dot-danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_MAP[status] ?? { badge: "badge-neutral", dot: "dot-muted" };
  // Backend stores the value lowercase (e.g. "active") so the SQL filters
  // stay simple; in the UI we always show it title-cased.
  const label = status ? status[0].toUpperCase() + status.slice(1) : status;
  return (
    <span className={`badge ${meta.badge}`}>
      <span className={`badge-dot ${meta.dot}`} />
      {label}
    </span>
  );
}

const SEVERITY_MAP: Record<string, string> = {
  info: "badge-info",
  warning: "badge-warning",
  critical: "badge-danger",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`badge ${SEVERITY_MAP[severity] ?? "badge-neutral"}`}>
      {severity}
    </span>
  );
}

export function Tags({
  tags,
}: {
  tags: { label: string; color: string }[];
}) {
  if (!tags?.length) return <span className="muted">—</span>;
  return (
    <>
      {tags.map((t, i) => (
        <span key={i} className={`tag tag-${t.color}`}>
          {t.label}
        </span>
      ))}
    </>
  );
}
