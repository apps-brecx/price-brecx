import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AUTOMATION_TYPES } from "@fbm/shared";
import type { AutomationType } from "@fbm/shared";
import { api } from "../lib/api";
import { dateShort } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import "./Automation.css";

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
  intervalHours: number;
  amount: string;
}

const emptyDraft: RuleDraft = {
  name: "",
  type: AUTOMATION_TYPES[0],
  intervalHours: 0,
  amount: "",
};

export function Automation() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);

  const query = useQuery({
    queryKey: ["automation-rules"],
    queryFn: () => api.get<RuleList>("/automation-rules"),
  });

  const createMut = useMutation({
    mutationFn: (body: RuleDraft) =>
      api.post("/automation-rules", {
        name: body.name,
        type: body.type,
        intervalHours: body.intervalHours || undefined,
        amount: body.amount,
        active: true,
        skuIds: [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-rules"] });
      setCreateOpen(false);
      setDraft(emptyDraft);
    },
  });

  const toggleMut = useMutation({
    mutationFn: (r: AutomationRuleRow) =>
      api.patch(`/automation-rules/${r.id}`, { active: !r.active }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["automation-rules"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/automation-rules/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["automation-rules"] }),
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Rule-based repricing strategies that run on a schedule"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            + New rule
          </button>
        }
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No automation rules"
          message="Create a rule to automatically adjust prices over time."
          action={
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + New rule
            </button>
          }
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Interval</th>
                <th>Amount</th>
                <th className="right">Products</th>
                <th>Active</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="auto-name">{r.name}</td>
                  <td>
                    <span className="badge badge-info">{r.type}</span>
                  </td>
                  <td>{r.intervalHours ? `${r.intervalHours}h` : "—"}</td>
                  <td className="mono">{r.amount}</td>
                  <td className="right">{r.skuIds.length}</td>
                  <td>
                    <button
                      className={
                        "btn btn-sm " +
                        (r.active ? "btn-primary" : "btn-secondary")
                      }
                      disabled={toggleMut.isPending}
                      onClick={() => toggleMut.mutate(r)}
                    >
                      {r.active ? "On" : "Off"}
                    </button>
                  </td>
                  <td className="muted">{dateShort(r.createdAt)}</td>
                  <td className="right">
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(r.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="New automation rule"
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
              disabled={createMut.isPending || !draft.name || !draft.amount}
              onClick={() => createMut.mutate(draft)}
            >
              {createMut.isPending ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Type</label>
          <select
            className="select"
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as AutomationType })
            }
          >
            {AUTOMATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Interval (hours)</label>
          <input
            className="input"
            type="number"
            value={draft.intervalHours}
            onChange={(e) =>
              setDraft({ ...draft, intervalHours: Number(e.target.value) })
            }
          />
        </div>
        <div className="field">
          <label>Amount</label>
          <input
            className="input"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
