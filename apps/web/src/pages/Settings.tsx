import "./Settings.css";
import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { SalesChannel, AlertKind } from "@fbm/shared";
import {
  SALES_CHANNELS,
  CHANNEL_LABELS,
  ALERT_KINDS,
  DEFAULT_TIMEZONE,
  DEFAULT_CURRENCY,
} from "@fbm/shared";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";

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

interface NotificationRule {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  emails: string[];
  active: boolean;
  createdAt: string;
}

interface NotificationRulesResponse {
  items: NotificationRule[];
  total: number;
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

interface RuleDraft {
  kind: AlertKind;
  name: string;
  emails: string;
}

const emptyRule: RuleDraft = { kind: "stock", name: "", emails: "" };

type Tab =
  | "general"
  | "security"
  | "users"
  | "billing"
  | "notifications"
  | "tags"
  | "marketplaces"
  | "api";

const labelStyle: React.CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 600,
  color: "var(--text-4)",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  padding: "8px 10px",
};

function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

function NotAvailable({ feature }: { feature: string }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{feature}</div>
          <div className="card-subtitle">Not available in this build</div>
        </div>
      </div>
      <div style={{ padding: "48px 18px" }}>
        <EmptyState
          title="Not available"
          message={`${feature} is not backed by an API in this build.`}
        />
      </div>
    </div>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("general");

  const [form, setForm] = useState<SettingsForm>({
    name: "",
    timezone: DEFAULT_TIMEZONE,
    currency: DEFAULT_CURRENCY,
    defaultChannel: "amazon",
  });

  const [connectOpen, setConnectOpen] = useState(false);
  const [connectDraft, setConnectDraft] =
    useState<ConnectDraft>(emptyConnect);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRule);
  const [deleteRule, setDeleteRule] = useState<NotificationRule | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
  });

  const marketplacesQuery = useQuery({
    queryKey: ["marketplaces"],
    queryFn: () => api.get<MarketplacesResponse>("/marketplaces"),
    enabled: tab === "marketplaces",
  });

  const rulesQuery = useQuery({
    queryKey: ["notification-rules"],
    queryFn: () =>
      api.get<NotificationRulesResponse>("/notification-rules"),
    enabled: tab === "notifications",
  });

  const settings = settingsQuery.data?.settings;

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name,
        timezone: settings.timezone || DEFAULT_TIMEZONE,
        currency: settings.currency || DEFAULT_CURRENCY,
        defaultChannel: settings.defaultChannel || "amazon",
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (body: SettingsForm) => api.patch("/settings", body),
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

  const createRuleMut = useMutation({
    mutationFn: (draft: RuleDraft) =>
      api.post("/notification-rules", {
        kind: draft.kind,
        name: draft.name,
        config: {},
        emails: draft.emails
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
        active: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rules"] });
      setRuleOpen(false);
      setRuleDraft(emptyRule);
    },
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: string) => api.del(`/notification-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rules"] });
      setDeleteRule(null);
    },
  });

  const team = settingsQuery.data?.team ?? [];
  const marketplaces = marketplacesQuery.data;
  const rules = rulesQuery.data?.items ?? [];

  const navItem = (id: Tab, label: string, badge?: number) => (
    <div
      className={"nav-item" + (tab === id ? " active" : "")}
      style={{ fontSize: "13px" }}
      onClick={() => setTab(id)}
    >
      {label}
      {badge != null && <span className="nav-badge">{badge}</span>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 24, alignItems: "start" }}>
        {/* Settings sub-nav */}
        <div
          style={{
            width: 200,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            position: "sticky",
            top: 78,
          }}
        >
          <div style={labelStyle}>Personal</div>
          {navItem("general", "General")}
          {navItem("security", "Security")}

          <div style={{ ...labelStyle, padding: "12px 10px 8px" }}>
            Workspace
          </div>
          {navItem("users", "Users", team.length)}
          {navItem("billing", "Billing")}
          {navItem("notifications", "Notifications")}
          {navItem("tags", "Tags")}

          <div style={{ ...labelStyle, padding: "12px 10px 8px" }}>
            Integrations
          </div>
          {navItem(
            "marketplaces",
            "Marketplaces",
            marketplaces?.items.length,
          )}
          {navItem("api", "API & Webhooks")}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, maxWidth: 760 }}>
          {settingsQuery.isLoading ? (
            <Loading />
          ) : settingsQuery.isError || !settingsQuery.data ? (
            <ErrorState />
          ) : (
            <>
              {tab === "general" && (
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Workspace</div>
                      <div className="card-subtitle">
                        General workspace configuration
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: 18 }}>
                    <div className="form-group">
                      <label className="form-label">
                        Workspace name{" "}
                        <span className="req">*</span>
                      </label>
                      <input
                        className="form-control"
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Timezone</label>
                        <input
                          className="form-control"
                          value={form.timezone}
                          placeholder={DEFAULT_TIMEZONE}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              timezone: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Currency</label>
                        <input
                          className="form-control"
                          value={form.currency}
                          placeholder={DEFAULT_CURRENCY}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              currency: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Default channel
                      </label>
                      <select
                        className="form-control"
                        value={form.defaultChannel}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            defaultChannel: e.target.value,
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
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                        marginTop: 18,
                      }}
                    >
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={saveMut.isPending || !form.name}
                        onClick={() => saveMut.mutate(form)}
                      >
                        {saveMut.isPending
                          ? "Saving…"
                          : "Save changes"}
                      </button>
                    </div>
                    {saveMut.isError && (
                      <div
                        style={{
                          marginTop: 10,
                          fontSize: "12.5px",
                          color: "var(--danger-fg)",
                          textAlign: "right",
                        }}
                      >
                        Failed to save. Please retry.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === "security" && (
                <NotAvailable feature="Security" />
              )}

              {tab === "users" && (
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Team Members</div>
                      <div className="card-subtitle">
                        {team.length}{" "}
                        {team.length === 1 ? "user" : "users"}
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled
                      title="Invite is not available in this build"
                    >
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
                      Invite member
                    </button>
                  </div>
                  {team.length === 0 ? (
                    <div style={{ padding: "48px 18px" }}>
                      <EmptyState
                        title="No team members"
                        message="No users found for this workspace."
                      />
                    </div>
                  ) : (
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.map((m) => (
                          <tr key={m.id}>
                            <td style={{ fontWeight: 600 }}>
                              {m.name}
                            </td>
                            <td
                              style={{ color: "var(--text-3)" }}
                            >
                              {m.email}
                            </td>
                            <td>
                              <span
                                className={
                                  "badge " +
                                  (m.role === "admin" ||
                                  m.role === "owner"
                                    ? "badge-info"
                                    : "badge-neutral")
                                }
                              >
                                {m.role}
                              </span>
                            </td>
                            <td
                              style={{ color: "var(--text-3)" }}
                            >
                              {date(m.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "billing" && (
                <NotAvailable feature="Billing" />
              )}

              {tab === "notifications" && (
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">
                        Notification Rules
                      </div>
                      <div className="card-subtitle">
                        Manage stock, price, sales and buy box
                        alerts
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setRuleDraft(emptyRule);
                        setRuleOpen(true);
                      }}
                    >
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
                      New rule
                    </button>
                  </div>
                  {rulesQuery.isLoading ? (
                    <div style={{ padding: "48px 18px" }}>
                      <Loading />
                    </div>
                  ) : rulesQuery.isError ? (
                    <div style={{ padding: "48px 18px" }}>
                      <ErrorState />
                    </div>
                  ) : rules.length === 0 ? (
                    <div style={{ padding: "48px 18px" }}>
                      <EmptyState
                        title="No notification rules"
                        message='Click "New rule" to create your first alert.'
                      />
                    </div>
                  ) : (
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Kind</th>
                          <th>Recipients</th>
                          <th>Active</th>
                          <th>Created</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rules.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 600 }}>
                              {r.name}
                            </td>
                            <td>
                              <span className="badge badge-neutral">
                                {r.kind}
                              </span>
                            </td>
                            <td
                              style={{
                                color: "var(--text-3)",
                                fontSize: "12px",
                              }}
                            >
                              {r.emails.length > 0
                                ? r.emails.join(", ")
                                : "—"}
                            </td>
                            <td>
                              <label
                                className="switch"
                                title="Read-only — toggling is not supported by the API"
                              >
                                <input
                                  type="checkbox"
                                  checked={r.active}
                                  readOnly
                                  disabled
                                />
                                <span className="switch-slider" />
                              </label>
                            </td>
                            <td
                              style={{
                                color: "var(--text-3)",
                                fontSize: "12px",
                              }}
                            >
                              {date(r.createdAt)}
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{
                                  color: "var(--danger-fg)",
                                }}
                                onClick={() => setDeleteRule(r)}
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
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "tags" && <NotAvailable feature="Tags" />}

              {tab === "marketplaces" && (
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">
                        Connected Marketplaces
                      </div>
                      <div className="card-subtitle">
                        Manage your channel integrations
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    {marketplaces &&
                      (marketplaces.amazonMode === "live" ? (
                        <span className="badge badge-success">
                          Amazon SP-API: live
                        </span>
                      ) : (
                        <span className="badge badge-warning">
                          Amazon SP-API: stub
                        </span>
                      ))}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setConnectDraft(emptyConnect);
                        setConnectOpen(true);
                      }}
                    >
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
                      Connect
                    </button>
                  </div>
                  {marketplacesQuery.isLoading ? (
                    <div style={{ padding: "48px 18px" }}>
                      <Loading />
                    </div>
                  ) : marketplacesQuery.isError ? (
                    <div style={{ padding: "48px 18px" }}>
                      <ErrorState />
                    </div>
                  ) : (marketplaces?.items ?? []).length === 0 ? (
                    <div style={{ padding: "48px 18px" }}>
                      <EmptyState
                        title="No marketplaces connected"
                        message='Click "Connect" to add a channel credential.'
                      />
                    </div>
                  ) : (
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Channel</th>
                          <th>Label</th>
                          <th>Seller ID</th>
                          <th>Marketplace ID</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(marketplaces?.items ?? []).map((m) => (
                          <tr key={m.id}>
                            <td style={{ fontWeight: 600 }}>
                              {channelLabel(m.channel)}
                            </td>
                            <td>{m.label}</td>
                            <td
                              style={{
                                color: "var(--text-3)",
                                fontSize: "12px",
                              }}
                            >
                              {m.sellerId ?? "—"}
                            </td>
                            <td
                              style={{
                                color: "var(--text-3)",
                                fontSize: "12px",
                              }}
                            >
                              {m.marketplaceId ?? "—"}
                            </td>
                            <td>
                              <span
                                className={
                                  "badge " +
                                  (m.connected
                                    ? "badge-success"
                                    : "badge-neutral")
                                }
                              >
                                {m.connected
                                  ? "Connected"
                                  : "Disconnected"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setConnectDraft({
                                    ...emptyConnect,
                                    channel: (SALES_CHANNELS.includes(
                                      m.channel as SalesChannel,
                                    )
                                      ? (m.channel as SalesChannel)
                                      : "amazon"),
                                    label: m.label,
                                    sellerId: m.sellerId ?? "",
                                    marketplaceId:
                                      m.marketplaceId ?? "",
                                  });
                                  setConnectOpen(true);
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "api" && (
                <NotAvailable feature="API & Webhooks" />
              )}
            </>
          )}
        </div>
      </div>

      {/* Connect / Edit marketplace modal */}
      <Modal
        open={connectOpen}
        title="Connect marketplace"
        subtitle="Channel credentials. Secrets are write-only."
        onClose={() => setConnectOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setConnectOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={connectMut.isPending || !connectDraft.label}
              onClick={() => connectMut.mutate(connectDraft)}
            >
              {connectMut.isPending ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Channel <span className="req">*</span>
          </label>
          <select
            className="form-control"
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
        <div className="form-group">
          <label className="form-label">
            Label <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={connectDraft.label}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                label: e.target.value,
              })
            }
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Seller ID</label>
            <input
              className="form-control"
              value={connectDraft.sellerId}
              onChange={(e) =>
                setConnectDraft({
                  ...connectDraft,
                  sellerId: e.target.value,
                })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Marketplace ID</label>
            <input
              className="form-control"
              value={connectDraft.marketplaceId}
              onChange={(e) =>
                setConnectDraft({
                  ...connectDraft,
                  marketplaceId: e.target.value,
                })
              }
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Refresh token</label>
          <input
            className="form-control"
            type="password"
            placeholder="Write-only — leave blank to keep current"
            value={connectDraft.refreshToken}
            onChange={(e) =>
              setConnectDraft({
                ...connectDraft,
                refreshToken: e.target.value,
              })
            }
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">LWA App ID</label>
            <input
              className="form-control"
              value={connectDraft.lwaAppId}
              onChange={(e) =>
                setConnectDraft({
                  ...connectDraft,
                  lwaAppId: e.target.value,
                })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              LWA Client Secret
            </label>
            <input
              className="form-control"
              type="password"
              placeholder="Write-only"
              value={connectDraft.lwaClientSecret}
              onChange={(e) =>
                setConnectDraft({
                  ...connectDraft,
                  lwaClientSecret: e.target.value,
                })
              }
            />
          </div>
        </div>
        {connectMut.isError && (
          <div
            style={{
              fontSize: "12.5px",
              color: "var(--danger-fg)",
            }}
          >
            Failed to save credentials. Please retry.
          </div>
        )}
      </Modal>

      {/* New notification rule modal */}
      <Modal
        open={ruleOpen}
        title="New notification rule"
        subtitle="Create an alert rule"
        onClose={() => setRuleOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setRuleOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                createRuleMut.isPending || !ruleDraft.name
              }
              onClick={() => createRuleMut.mutate(ruleDraft)}
            >
              {createRuleMut.isPending
                ? "Creating…"
                : "Create rule"}
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
            value={ruleDraft.name}
            onChange={(e) =>
              setRuleDraft({ ...ruleDraft, name: e.target.value })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Kind <span className="req">*</span>
          </label>
          <select
            className="form-control"
            value={ruleDraft.kind}
            onChange={(e) =>
              setRuleDraft({
                ...ruleDraft,
                kind: e.target.value as AlertKind,
              })
            }
          >
            {ALERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Recipient emails</label>
          <input
            className="form-control"
            placeholder="alerts@brecx.com, ops@brecx.com"
            value={ruleDraft.emails}
            onChange={(e) =>
              setRuleDraft({
                ...ruleDraft,
                emails: e.target.value,
              })
            }
          />
          <div className="form-help">
            Comma-separated list of email addresses.
          </div>
        </div>
        {createRuleMut.isError && (
          <div
            style={{
              fontSize: "12.5px",
              color: "var(--danger-fg)",
            }}
          >
            Failed to create rule. Please retry.
          </div>
        )}
      </Modal>

      {/* Delete rule confirm modal */}
      <Modal
        open={deleteRule !== null}
        title="Delete notification rule"
        onClose={() => setDeleteRule(null)}
        footer={
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setDeleteRule(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              style={{ background: "var(--danger-fg)" }}
              disabled={deleteRuleMut.isPending}
              onClick={() =>
                deleteRule && deleteRuleMut.mutate(deleteRule.id)
              }
            >
              {deleteRuleMut.isPending
                ? "Deleting…"
                : "Confirm delete"}
            </button>
          </>
        }
      >
        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>
          Delete rule{" "}
          <strong>{deleteRule?.name}</strong>? This action cannot
          be undone.
        </div>
      </Modal>
    </div>
  );
}
