import "./ActivityLog.css";
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Activity, Paginated } from "@fbm/shared";
import { ACTIVITY_ACTIONS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { date, relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";

const PAGE_SIZE = 25;

type BadgeKind = "success" | "info" | "danger" | "warning" | "neutral";

function actionBadge(action: string): BadgeKind {
  switch (action) {
    case "created":
      return "success";
    case "updated":
      return "info";
    case "deleted":
      return "danger";
    case "price_changed":
    case "price_reverted":
      return "warning";
    default:
      return "neutral";
  }
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

export function ActivityLog() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);

  // Debounce the search input and reset to page 1 when it changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["activity", { search, action, page }],
    queryFn: () =>
      api.get<Paginated<Activity>>(
        `/activity${qs({
          page,
          pageSize: PAGE_SIZE,
          action: action === "all" ? "" : action,
          search,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Audit trail of every change across your workspace"
      />

      <div className="rp-page-wrap">
        {/* Top toolbar */}
        <div className="rp-toolbar">
          <div
            className="input-wrap"
            style={{ flex: 1, maxWidth: "380px" }}
          >
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
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder="Search by SKU, product or marketplace..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <select
            className="form-control"
            style={{ width: "auto" }}
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All actions</option>
            {ACTIVITY_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </div>

        {/* Table card */}
        <div className="card rp-table-card" style={{ flex: 1, minHeight: 0 }}>
          {query.isLoading ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title="No activity"
              message="No events match your filters yet."
            />
          ) : (
            <>
              <div className="rp-table-scroll">
                <table className="act-table">
                  <thead>
                    <tr>
                      <th style={{ width: "150px" }}>Time</th>
                      <th style={{ width: "150px" }}>User</th>
                      <th style={{ width: "150px" }}>Action</th>
                      <th>Summary</th>
                      <th style={{ width: "150px" }}>Entity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => {
                      const kind = actionBadge(a.action);
                      return (
                        <tr key={a.id}>
                          <td>
                            <div
                              className="act-time"
                              title={date(a.createdAt)}
                            >
                              {relativeTime(a.createdAt)}
                            </div>
                            <div
                              style={{
                                fontSize: "11px",
                                color: "var(--text-4)",
                                marginTop: "1px",
                              }}
                            >
                              {date(a.createdAt)}
                            </div>
                          </td>
                          <td>{a.actor}</td>
                          <td>
                            <span className={`badge badge-${kind}`}>
                              {actionLabel(a.action)}
                            </span>
                          </td>
                          <td>
                            <div className="act-product">{a.summary}</div>
                          </td>
                          <td>
                            <div className="act-entity">
                              <span className="act-entity-type">
                                {a.entityType}
                              </span>
                              {a.entityId ? (
                                <span
                                  className="act-entity-id"
                                  title={a.entityId}
                                >
                                  {a.entityId}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rp-pagination-footer">
                <div
                  style={{ fontSize: "12.5px", color: "var(--text-3)" }}
                >
                  Showing{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {rangeStart}–{rangeEnd}
                  </strong>{" "}
                  of{" "}
                  <strong style={{ color: "var(--text)" }}>{total}</strong>{" "}
                  changes
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ alignSelf: "center", fontSize: "12px" }}
                    disabled
                  >
                    Page {page} of {totalPages}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={page >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
