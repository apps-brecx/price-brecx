import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import "./History.css";

interface HistoryEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface HistoryList {
  items: HistoryEntry[];
  total: number;
}

export function History() {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["history"],
    queryFn: () => api.get<HistoryList>("/history"),
  });

  const items = query.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? items.filter(
        (e) =>
          e.summary.toLowerCase().includes(term) ||
          e.actor.toLowerCase().includes(term),
      )
    : items;

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="A chronological record of everything that happened"
      />

      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Filter by summary or actor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No history"
          message="No events match the current filter."
        />
      ) : (
        <div className="card">
          <ul className="timeline">
            {filtered.map((e) => (
              <li key={e.id} className="timeline-item">
                <span className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-head">
                    <span className="badge badge-neutral">{e.action}</span>
                    <span className="timeline-time muted">
                      {relativeTime(e.createdAt)}
                    </span>
                  </div>
                  <div className="timeline-summary">{e.summary}</div>
                  <div className="timeline-actor muted">{e.actor}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
