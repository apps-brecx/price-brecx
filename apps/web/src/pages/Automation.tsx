import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AUTOMATION_TYPES } from "@fbm/shared";
import type { AutomationType } from "@fbm/shared";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";

interface AutomationRuleRow {
  id: string;
  name: string;
  type: string;
  intervalHours: number | null;
  amount: string;
  active: boolean;
  skuIds: string[];
  createdBy: string;
  createdAt: string;
}

interface RuleList {
  items: AutomationRuleRow[];
  total: number;
}

interface RuleDraft {
  name: string;
  type: AutomationType;
  intervalHours: string;
  amount: string;
}

const emptyDraft: RuleDraft = {
  name: "",
  type: AUTOMATION_TYPES[0],
  intervalHours: "",
  amount: "0",
};

type TypeFilter = "all" | string;

const TYPE_BADGE: Record<string, string> = {
  increasing: "badge-success",
  "decreasing-cycling": "badge-warning",
  random: "badge-info",
  "quantity-cycling": "badge-purple",
  "age-by-day": "badge-neutral",
};

function humanType(type: string): string {
  return type
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function typeBadgeClass(type: string): string {
  return TYPE_BADGE[type] ?? "badge-neutral";
}

function scheduleLabel(intervalHours: number | null): string {
  if (intervalHours == null) return "—";
  return `Every ${intervalHours}h`;
}

export function Automation() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const query = useQuery({
    queryKey: ["automation-rules"],
    queryFn: () => api.get<RuleList>("/automation-rules"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["automation-rules"] });
    qc.invalidateQueries({ queryKey: ["nav-counts"] });
  };

  const createMut = useMutation({
    mutationFn: (body: RuleDraft) => {
      const trimmed = body.intervalHours.trim();
      return api.post("/automation-rules", {
        name: body.name.trim(),
        type: body.type,
        intervalHours: trimmed === "" ? null : Number(trimmed),
        amount: body.amount.trim() === "" ? "0" : body.amount.trim(),
        active: true,
        skuIds: [],
      });
    },
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setDraft(emptyDraft);
    },
  });

  const toggleMut = useMutation({
    mutationFn: (r: AutomationRuleRow) =>
      api.patch(`/automation-rules/${r.id}`, { active: !r.active }),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/automation-rules/${id}`),
    onSuccess: invalidate,
  });

  const items = query.data?.items ?? [];

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of items) counts[r.type] = (counts[r.type] ?? 0) + 1;
    return counts;
  }, [items]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((r) => r.active).length;
    const paused = total - active;
    const skuSet = new Set<string>();
    for (const r of items) for (const s of r.skuIds) skuSet.add(s);
    return { total, active, paused, skus: skuSet.size };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q)
      );
    });
  }, [items, search, typeFilter]);

  const openCreate = () => {
    setDraft(emptyDraft);
    setCreateOpen(true);
  };

  const onDelete = (r: AutomationRuleRow) => {
    if (window.confirm(`Delete rule "${r.name}"? This cannot be undone.`)) {
      deleteMut.mutate(r.id);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          marginBottom: 18,
        }}
      >
        <div>
          <div className="page-title">Automation</div>
          <div className="page-subtitle">
            Rule-based repricing strategies that run on a schedule
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Rule
        </button>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
              marginBottom: 18,
            }}
          >
            <div className="stat-card">
              <div className="stat-label">Total Rules</div>
              <div className="stat-value">{stats.total}</div>
              <div className="stat-trend up">
                {stats.active} active · {stats.paused} paused
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">SKUs Automated</div>
              <div className="stat-value">{stats.skus}</div>
              <div className="stat-trend up">across all rules</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Rules</div>
              <div className="stat-value">{stats.active}</div>
              <div className="stat-trend up">running on schedule</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Paused Rules</div>
              <div className="stat-value">{stats.paused}</div>
              <div className="stat-trend up">currently disabled</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <div
              className={`filter-chip${typeFilter === "all" ? " active" : ""}`}
              onClick={() => setTypeFilter("all")}
            >
              All Types <span className="count">{items.length}</span>
            </div>
            {AUTOMATION_TYPES.map((t) => (
              <div
                key={t}
                className={`filter-chip${typeFilter === t ? " active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {humanType(t)}{" "}
                <span className="count">{typeCounts[t] ?? 0}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <div className="input-wrap">
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
                placeholder="Search rules…"
                style={{ width: 240 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="No automation rules"
              message="Create a rule to automatically adjust prices over time."
              action={
                <button className="btn btn-primary" onClick={openCreate}>
                  Create Rule
                </button>
              }
            />
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Status</th>
                    <th style={{ width: 120 }}>Rule ID</th>
                    <th>Rule Name</th>
                    <th>Type</th>
                    <th>Schedule</th>
                    <th>Adjustment</th>
                    <th style={{ textAlign: "center" }}>Products</th>
                    <th>Created</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        style={{
                          textAlign: "center",
                          padding: 40,
                          color: "var(--text-3)",
                        }}
                      >
                        No rules found
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={r.active}
                              disabled={toggleMut.isPending}
                              onChange={() => toggleMut.mutate(r)}
                            />
                            <span className="switch-slider" />
                          </label>
                        </td>
                        <td className="mono">{r.id}</td>
                        <td>
                          <div style={{ fontWeight: 550 }}>{r.name}</div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              marginTop: 3,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-3)",
                              }}
                            >
                              {scheduleLabel(r.intervalHours)}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-3)",
                                paddingLeft: 5,
                                borderLeft: "1px solid var(--border)",
                              }}
                            >
                              {r.amount}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${typeBadgeClass(r.type)}`}
                          >
                            {humanType(r.type)}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 12.5,
                              color: "var(--text-2)",
                            }}
                          >
                            {scheduleLabel(r.intervalHours)}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{ fontWeight: 600, fontSize: 12.5 }}
                          >
                            {r.amount}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              color: "var(--text-2)",
                            }}
                          >
                            {r.skuIds.length} SKUs
                          </span>
                        </td>
                        <td>
                          <div
                            style={{ fontSize: 12, fontWeight: 550 }}
                          >
                            {r.createdBy || "—"}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-3)",
                            }}
                          >
                            {relativeTime(r.createdAt)}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Delete"
                            style={{ color: "var(--danger-fg)" }}
                            disabled={deleteMut.isPending}
                            onClick={() => onDelete(r)}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1.5 14a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2L5 6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        title="Create Rule"
        subtitle="Define a rule-based repricing strategy"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={createMut.isPending || !draft.name.trim()}
              onClick={() => createMut.mutate(draft)}
            >
              {createMut.isPending ? "Saving…" : "Create Rule"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Name <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.name}
            placeholder="e.g. Weekend price boost"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Type <span className="req">*</span>
          </label>
          <select
            className="form-control"
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as AutomationType })
            }
          >
            {AUTOMATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanType(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Interval hours</label>
            <input
              className="form-control"
              type="number"
              min={0}
              value={draft.intervalHours}
              placeholder="Optional"
              onChange={(e) =>
                setDraft({ ...draft, intervalHours: e.target.value })
              }
            />
            <div className="form-help">
              Leave blank to run with no fixed schedule.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Amount</label>
            <input
              className="form-control"
              value={draft.amount}
              placeholder="0"
              onChange={(e) =>
                setDraft({ ...draft, amount: e.target.value })
              }
            />
            <div className="form-help">Adjustment amount for the rule.</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
