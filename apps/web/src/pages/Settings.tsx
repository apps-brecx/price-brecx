import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SalesChannel } from "@fbm/shared";
import { SALES_CHANNELS, CHANNEL_LABELS } from "@fbm/shared";
import { api } from "../lib/api";
import { dateShort } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import "./Settings.css";

interface WorkspaceSettings {
  workspaceId: string;
  name: string;
  timezone: string;
  currency: string;
  defaultChannel: string;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface SettingsResponse {
  settings: WorkspaceSettings;
  team: TeamMember[];
}

interface Marketplace {
  id: string;
  channel: string;
  label: string;
  sellerId: string | null;
  marketplaceId: string | null;
  connected: boolean;
  createdAt: string;
}

interface MarketplacesResponse {
  items: Marketplace[];
  amazonMode: "live" | "stub";
}

interface SettingsForm {
  name: string;
  timezone: string;
  currency: string;
  defaultChannel: string;
}

interface ConnectDraft {
  channel: SalesChannel;
  label: string;
  sellerId: string;
  marketplaceId: string;
  refreshToken: string;
  lwaAppId: string;
  lwaClientSecret: string;
}

const emptyConnect: ConnectDraft = {
  channel: "amazon",
  label: "",
  sellerId: "",
  marketplaceId: "",
  refreshToken: "",
  lwaAppId: "",
  lwaClientSecret: "",
};

type Tab = "general" | "team" | "marketplaces";

export function Settings() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("general");
  const [form, setForm] = useState<SettingsForm>({
    name: "",
    timezone: "",
    currency: "",
    defaultChannel: "amazon",
  });
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectDraft, setConnectDraft] =
    useState<ConnectDraft>(emptyConnect);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
  });

  const marketplacesQuery = useQuery({
    queryKey: ["marketplaces"],
    queryFn: () => api.get<MarketplacesResponse>("/marketplaces"),
  });

  const settings = settingsQuery.data?.settings;

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name,
        timezone: settings.timezone,
        currency: settings.currency,
        defaultChannel: settings.defaultChannel,
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (body: SettingsForm) =>
      api.patch("/settings", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const connectMut = useMutation({
    mutationFn: (body: ConnectDraft) => api.put("/marketplaces", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplaces"] });
      setConnectOpen(false);
      setConnectDraft(emptyConnect);
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Workspace configuration" />
        <Loading />
      </div>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Workspace configuration" />
        <ErrorState />
      </div>
    );
  }

  const team = settingsQuery.data.team;
  const marketplaces = marketplacesQuery.data;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace configuration" />

      <div className="toolbar settings-tabs">
        <button
          className={"btn btn-sm " + (tab === "general" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          className={"btn btn-sm " + (tab === "team" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("team")}
        >
          Team
        </button>
        <button
          className={"btn btn-sm " + (tab === "marketplaces" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("marketplaces")}
        >
          Marketplaces
        </button>
      </div>

      {tab === "general" && (
        <div className="card settings-form">
          <div className="field">
            <label>Workspace name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Timezone</label>
            <input
              className="input"
              value={form.timezone}
              onChange={(e) =>
                setForm({ ...form, timezone: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>Currency</label>
            <input
              className="input"
              value={form.currency}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>Default channel</label>
            <select
              className="select"
              value={form.defaultChannel}
              onChange={(e) =>
                setForm({ ...form, defaultChannel: e.target.value })
              }
            >
              {SALES_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="right">
            <button
              className="btn btn-primary"
              disabled={saveMut.isPending || !form.name}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {tab === "team" && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="muted">{m.email}</td>
                  <td>
                    <span className="badge badge-neutral">{m.role}</span>
                  </td>
                  <td>{dateShort(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "marketplaces" && (
        <div>
          <div className="toolbar">
            {marketplaces &&
              (marketplaces.amazonMode === "live" ? (
                <span className="badge badge-success">
                  Amazon SP-API: live
                </span>
              ) : (
                <span className="badge badge-warning">
                  Amazon SP-API: stub (no credentials)
                </span>
              ))}
            <button
              className="btn btn-primary right"
              onClick={() => setConnectOpen(true)}
            >
              + Connect
            </button>
          </div>

          {marketplacesQuery.isLoading ? (
            <Loading />
          ) : marketplacesQuery.isError ? (
            <ErrorState />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Channel</th>
                    <th>Connected</th>
                    <th>Seller ID</th>
                  </tr>
                </thead>
                <tbody>
                  {(marketplaces?.items ?? []).map((m) => (
                    <tr key={m.id}>
                      <td>{m.label}</td>
                      <td>{m.channel}</td>
                      <td>
                        <span
                          className={
                            "badge " +
                            (m.connected
                              ? "badge-success"
                              : "badge-neutral")
                          }
                        >
                          {m.connected ? "connected" : "not connected"}
                        </span>
                      </td>
                      <td className="muted">{m.sellerId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal
        open={connectOpen}
        title="Connect marketplace"
        onClose={() => setConnectOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setConnectOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={connectMut.isPending || !connectDraft.label}
              onClick={() => connectMut.mutate(connectDraft)}
            >
              {connectMut.isPending ? "Saving…" : "Connect"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Channel</label>
          <select
            className="select"
            value={connectDraft.channel}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                channel: e.target.value as SalesChannel,
              })
            }
          >
            {SALES_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Label</label>
          <input
            className="input"
            value={connectDraft.label}
            onChange={(e) =>
              setConnectDraft({ ...connectDraft, label: e.target.value })
            }
          />
        </div>
        <div className="field">
          <label>Seller ID</label>
          <input
            className="input"
            value={connectDraft.sellerId}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                sellerId: e.target.value,
              })
            }
          />
        </div>
        <div className="field">
          <label>Marketplace ID</label>
          <input
            className="input"
            value={connectDraft.marketplaceId}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                marketplaceId: e.target.value,
              })
            }
          />
        </div>
        <div className="field">
          <label>Refresh token</label>
          <input
            className="input"
            value={connectDraft.refreshToken}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                refreshToken: e.target.value,
              })
            }
          />
        </div>
        <div className="field">
          <label>LWA App ID</label>
          <input
            className="input"
            value={connectDraft.lwaAppId}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                lwaAppId: e.target.value,
              })
            }
          />
        </div>
        <div className="field">
          <label>LWA Client Secret</label>
          <input
            className="input"
            value={connectDraft.lwaClientSecret}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                lwaClientSecret: e.target.value,
              })
            }
          />
        </div>
      </Modal>
    </div>
  );
}
