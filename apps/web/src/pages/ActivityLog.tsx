import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Activity, Paginated } from "@fbm/shared";
import { ACTIVITY_ACTIONS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { date } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import "./ActivityLog.css";

const PAGE_SIZE = 25;

export function ActivityLog() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);

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
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Audit trail of every change across your workspace"
      />

      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Search activity…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="select"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All actions</option>
          {ACTIVITY_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No activity"
          message="No events match your filters yet."
        />
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Summary</th>
                  <th>Entity</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="badge badge-neutral">{a.action}</span>
                    </td>
                    <td>{a.actor}</td>
                    <td>{a.summary}</td>
                    <td className="muted">{a.entityType}</td>
                    <td>{date(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <span className="muted">
              {data.total} events · page {page} / {totalPages}
            </span>
            <div className="pager-btns">
              <button
                className="btn btn-sm btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
