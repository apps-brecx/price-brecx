const STATUS_MAP: Record<string, string> = {
  active: "badge-success",
  running: "badge-success",
  completed: "badge-success",
  scheduled: "badge-info",
  inactive: "badge-neutral",
  incomplete: "badge-warning",
  reverted: "badge-warning",
  cancelled: "badge-neutral",
  failed: "badge-danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_MAP[status] ?? "badge-neutral"}`}>
      {status}
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
