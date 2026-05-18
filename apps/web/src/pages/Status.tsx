import "./Status.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PriceSchedule } from "@fbm/shared";
import { SCHEDULE_STATUSES } from "@fbm/shared";
import { api } from "../lib/api";
import { money, dateShort, relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";

interface ScheduleList {
  items: PriceSchedule[];
  total: number;
}

const PAGE_SIZE = 12;

const STATUS_FILTERS = ["all", ...SCHEDULE_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const TYPE_OPTIONS = ["all", "single", "weekly", "monthly"] as const;
type TypeFilter = (typeof TYPE_OPTIONS)[number];

const TYPE_LABEL: Record<string, string> = {
  all: "All Types",
  single: "Single",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** Mirrors the redesign's schedTypePill: a colored badge per schedule type. */
function typeBadgeClass(type: string): string {
  if (type === "weekly") return "badge-info";
  if (type === "monthly") return "badge-purple";
  return "badge-warning"; // single
}

/** Stable color for the user avatar, derived from the email (no fabricated data). */
const AVATAR_COLORS = [
  "#1f47e5",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f59e0b",
  "#10b981",
  "#dc2626",
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(email: string): string {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Compact "scheduled for" cell: a single date, a range, or em-dash. */
function scheduledFor(s: PriceSchedule): string {
  if (s.startDate && s.endDate) {
    return `${dateShort(s.startDate)} – ${dateShort(s.endDate)}`;
  }
  if (s.startDate) return dateShort(s.startDate);
  if (s.endDate) return dateShort(s.endDate);
  return "—";
}

const SearchIcon = () => (
  <svg
    className="input-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const ChevronLeft = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRight = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function Status() {
  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<ScheduleList>("/schedules"),
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);

  // Counts by status — computed client-side from real items.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const s of items) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    return {
      total: items.length,
      scheduled: byStatus.scheduled ?? 0,
      running: byStatus.running ?? 0,
      completed: byStatus.completed ?? 0,
      byStatus,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (
        q &&
        !s.sku.toLowerCase().includes(q) &&
        !s.title.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [items, search, statusFilter, typeFilter]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, total);
  const pageRows = filtered.slice(startIdx, endIdx);

  function goto(p: number) {
    if (p < 1 || p > pageCount) return;
    setPage(p);
  }

  // Page numbers with ellipsis, mirroring renderStatusPagination.
  const pageNumbers = useMemo(() => {
    const show = new Set<number>([1, pageCount]);
    for (let i = Math.max(1, safePage - 1); i <= Math.min(pageCount, safePage + 1); i++)
      show.add(i);
    if (safePage <= 3) for (let i = 1; i <= Math.min(5, pageCount); i++) show.add(i);
    if (safePage >= pageCount - 2)
      for (let i = Math.max(1, pageCount - 4); i <= pageCount; i++) show.add(i);
    const sorted = [...show].sort((a, b) => a - b);
    const out: (number | "gap")[] = [];
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) out.push("gap");
      out.push(p);
      prev = p;
    }
    return out;
  }, [pageCount, safePage]);

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState />;

  return (
    <div className="rp-page-wrap">
      {/* Stat strip: status counts computed from real data */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div className="stat-card">
          <div className="stat-label">Total Schedules</div>
          <div className="stat-value">{counts.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Scheduled</div>
          <div className="stat-value">{counts.scheduled}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Running</div>
          <div className="stat-value">{counts.running}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{counts.completed}</div>
        </div>
      </div>

      {/* Top toolbar: search + status filter chips + type filter */}
      <div className="rp-toolbar">
        <div className="input-wrap" style={{ flex: 1, maxWidth: 340 }}>
          <SearchIcon />
          <input
            className="input"
            placeholder="Search by SKU, title..."
            style={{ width: "100%" }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {STATUS_FILTERS.map((f) => (
          <div
            key={f}
            className={`filter-chip${statusFilter === f ? " active" : ""}`}
            onClick={() => {
              setStatusFilter(f);
              setPage(1);
            }}
          >
            {f === "all" ? "All" : f}{" "}
            <span className="count">
              {f === "all" ? counts.total : counts.byStatus[f] ?? 0}
            </span>
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <div className="segmented">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              className={typeFilter === t ? "active" : ""}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Table card: scrollable body + sticky pagination */}
      <div className="card rp-table-card" style={{ flex: 1, minHeight: 0 }}>
        <div className="rp-table-scroll">
          <table className="status-table">
            <thead>
              <tr>
                <th style={{ width: 64 }}>Image</th>
                <th style={{ width: 128 }}>SKU</th>
                <th>Title</th>
                <th style={{ width: 130 }}>Schedule Type</th>
                <th style={{ width: 175 }}>Scheduled For</th>
                <th style={{ width: 90, textAlign: "right" }}>Price</th>
                <th style={{ width: 180 }}>User</th>
                <th style={{ width: 115 }}>Created</th>
                <th
                  style={{
                    width: 130,
                    textAlign: "right",
                    paddingRight: 20,
                  }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 0 }}>
                    <EmptyState
                      title="No schedules found"
                      message={
                        search || statusFilter !== "all" || typeFilter !== "all"
                          ? "No price schedules match the current filters."
                          : "There are no price schedules yet."
                      }
                    />
                  </td>
                </tr>
              ) : (
                pageRows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {/* No image field on the API — derived letter thumb. */}
                      <div
                        className="product-thumb"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: avatarColor(s.sku),
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 14,
                        }}
                      >
                        {s.sku.charAt(0).toUpperCase()}
                      </div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12.5 }}>
                        {s.sku}
                      </span>
                    </td>
                    <td>
                      <div className="title-text" title={s.title}>
                        {s.title}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${typeBadgeClass(s.type)}`}>
                        {s.type}
                      </span>
                    </td>
                    <td>
                      <span className="sched-text">{scheduledFor(s)}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="price-text">{money(s.price)}</span>
                    </td>
                    <td>
                      <div className="user-cell">
                        <div
                          className="avatar-xs"
                          style={{ background: avatarColor(s.createdBy) }}
                        >
                          {initials(s.createdBy)}
                        </div>
                        <span className="user-email">{s.createdBy}</span>
                      </div>
                    </td>
                    <td>
                      <span className="created-text">
                        {relativeTime(s.createdAt)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Sticky pagination footer */}
        <div className="rp-pagination-footer">
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
            Showing{" "}
            <strong style={{ color: "var(--text)" }}>
              {total === 0 ? "0" : `${startIdx + 1}–${endIdx}`}
            </strong>{" "}
            of <strong style={{ color: "var(--text)" }}>{total}</strong>{" "}
            schedules
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-secondary btn-icon btn-sm"
              disabled={safePage === 1}
              onClick={() => goto(safePage - 1)}
            >
              <ChevronLeft />
            </button>
            {pageNumbers.map((p, i) =>
              p === "gap" ? (
                <span
                  key={`gap-${i}`}
                  style={{ padding: 6, color: "var(--text-4)" }}
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={`btn ${
                    p === safePage ? "btn-primary" : "btn-secondary"
                  } btn-icon btn-sm`}
                  style={{ width: "auto", padding: "0 8px", fontSize: 12 }}
                  onClick={() => goto(p)}
                >
                  {p}
                </button>
              ),
            )}
            <button
              className="btn btn-secondary btn-icon btn-sm"
              disabled={safePage === pageCount}
              onClick={() => goto(safePage + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
