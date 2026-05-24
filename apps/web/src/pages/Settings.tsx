import "./Settings.css";
import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { SalesChannel, AlertKind, UserRole } from "@fbm/shared";
import {
  SALES_CHANNELS,
  CHANNEL_LABELS,
  ALERT_KINDS,
  USER_ROLES,
  USER_ROLE_LABELS,
  DEFAULT_TIMEZONE,
  DEFAULT_CURRENCY,
} from "@fbm/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { date, relativeTime } from "../lib/format";
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

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  workspaceId: string;
  createdAt: string;
}

interface InvitationRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

interface UsersResponse {
  users: UserRow[];
  invitations: InvitationRow[];
  isAdmin: boolean;
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
  const toast = useToast();
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

  /* ---------------------- Users & invitations ---------------------- */
  const { user: me, refresh: refreshAuth } = useAuth();

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UsersResponse>("/users"),
    enabled: tab === "users",
  });
  const usersData = usersQuery.data;
  const users = usersData?.users ?? [];
  const invitations = usersData?.invitations ?? [];
  const isAdmin = usersData?.isAdmin ?? me?.role === "admin";

  const [profile, setProfile] = useState({ name: "", password: "" });
  const [profileSaved, setProfileSaved] = useState(false);
  useEffect(() => {
    const self = users.find((u) => u.id === me?.id);
    if (self) setProfile((p) => ({ ...p, name: self.name }));
  }, [users, me?.id]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<{
    email: string;
    name: string;
    role: UserRole;
  }>({ email: "", name: "", role: "user" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);

  const profileMut = useMutation({
    mutationFn: (body: { name?: string; password?: string }) =>
      api.patch(`/users/${me?.id}`, body),
    onSuccess: async () => {
      setProfile((p) => ({ ...p, password: "" }));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
      await qc.invalidateQueries({ queryKey: ["users"] });
      await refreshAuth();
    },
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.patch(`/users/${id}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const inviteMut = useMutation({
    mutationFn: (body: { email: string; name: string; role: UserRole }) =>
      api.post<{ acceptUrl: string }>("/users/invite", body),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setInviteOpen(false);
      setInviteDraft({ email: "", name: "", role: "user" });
      setInviteLink(res.acceptUrl);
      toast.success("Invitation sent", `Invite email sent to ${vars.email}`);
    },
    onError: (err) => {
      toast.error(
        "Couldn't send invite",
        err instanceof Error ? err.message : "Please try again.",
      );
    },
  });

  const deleteUserMut = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setDeleteUser(null);
    },
  });

  const revokeInviteMut = useMutation({
    mutationFn: (id: string) => api.del(`/users/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const resendInviteMut = useMutation({
    mutationFn: (id: string) =>
      api.post<{ acceptUrl: string }>(`/users/invitations/${id}/resend`),
    onSuccess: (res) => {
      setInviteLink(res.acceptUrl);
      toast.success("Invitation resent", "A fresh invite email is on its way.");
    },
    onError: (err) => {
      toast.error(
        "Couldn't resend invite",
        err instanceof Error ? err.message : "Please try again.",
      );
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
          {navItem("notifications", "Notifications")}
          {navItem("tags", "Tags")}

          {/* Hidden by request — code below still renders these tabs so the
              feature can be revealed later by re-adding the nav items:
                {navItem("billing", "Billing")}
                {navItem("marketplaces", "Marketplaces", marketplaces?.items.length)}
                {navItem("api", "API & Webhooks")}
              Integrations group label was the only thing pinning them, so it
              goes too. */}
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

              {tab === "security" && <SecurityPanel />}

              {tab === "users" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  {usersQuery.isLoading ? (
                    <Loading />
                  ) : usersQuery.isError ? (
                    <ErrorState />
                  ) : (
                    <>
                      {inviteLink && (
                        <div
                          className="card"
                          style={{
                            padding: "12px 14px",
                            background: "var(--info-bg)",
                            border: "1px solid var(--info-fg)",
                            fontSize: "12.5px",
                          }}
                        >
                          <strong>Invite link</strong> — share this if the
                          email doesn't arrive:
                          <div
                            style={{
                              wordBreak: "break-all",
                              marginTop: 4,
                            }}
                          >
                            <a href={inviteLink}>{inviteLink}</a>
                          </div>
                          <button
                            className="btn btn-ghost btn-xs"
                            style={{ marginTop: 6 }}
                            onClick={() => setInviteLink(null)}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}

                      {/* Your profile — available to every member */}
                      <div className="card">
                        <div className="card-header">
                          <div>
                            <div className="card-title">Your profile</div>
                            <div className="card-subtitle">
                              Update your name or password
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: 18 }}>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label">Name</label>
                              <input
                                className="form-control"
                                value={profile.name}
                                onChange={(e) =>
                                  setProfile({
                                    ...profile,
                                    name: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Email</label>
                              <input
                                className="form-control"
                                value={me?.email ?? ""}
                                disabled
                                readOnly
                              />
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              New password
                            </label>
                            <input
                              className="form-control"
                              type="password"
                              placeholder="Leave blank to keep current"
                              value={profile.password}
                              onChange={(e) =>
                                setProfile({
                                  ...profile,
                                  password: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              justifyContent: "flex-end",
                              marginTop: 14,
                            }}
                          >
                            {profileSaved && (
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  color: "var(--success-fg)",
                                }}
                              >
                                Saved
                              </span>
                            )}
                            {profileMut.isError && (
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  color: "var(--danger-fg)",
                                }}
                              >
                                Failed to save
                              </span>
                            )}
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={
                                profileMut.isPending ||
                                !profile.name ||
                                (profile.password.length > 0 &&
                                  profile.password.length < 8)
                              }
                              onClick={() =>
                                profileMut.mutate({
                                  name: profile.name,
                                  ...(profile.password
                                    ? { password: profile.password }
                                    : {}),
                                })
                              }
                            >
                              {profileMut.isPending
                                ? "Saving…"
                                : "Save profile"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Team management — admins only */}
                      {isAdmin && (
                        <div className="card">
                          <div className="card-header">
                            <div>
                              <div className="card-title">
                                Team Members
                              </div>
                              <div className="card-subtitle">
                                {users.length}{" "}
                                {users.length === 1 ? "user" : "users"}
                              </div>
                            </div>
                            <div style={{ flex: 1 }} />
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setInviteDraft({
                                  email: "",
                                  name: "",
                                  role: "user",
                                });
                                setInviteOpen(true);
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
                              Invite member
                            </button>
                          </div>
                          <table className="tbl tbl-compact">
                            <thead>
                              <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Joined</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {users.map((u) => {
                                const isSelf = u.id === me?.id;
                                return (
                                  <tr key={u.id}>
                                    <td style={{ fontWeight: 600 }}>
                                      {u.name}
                                      {isSelf && (
                                        <span
                                          className="badge badge-neutral"
                                          style={{ marginLeft: 6 }}
                                        >
                                          You
                                        </span>
                                      )}
                                    </td>
                                    <td
                                      style={{
                                        color: "var(--text-3)",
                                      }}
                                    >
                                      {u.email}
                                    </td>
                                    <td>
                                      <select
                                        className="form-control"
                                        style={{
                                          height: 28,
                                          // Keep right room for the chevron
                                          // background (drawn at right 10px) —
                                          // a plain "0 8px" shorthand clips it.
                                          padding: "0 28px 0 8px",
                                          fontSize: "12px",
                                          width: "auto",
                                        }}
                                        value={u.role}
                                        disabled={
                                          roleMut.isPending
                                        }
                                        onChange={(e) =>
                                          roleMut.mutate({
                                            id: u.id,
                                            role: e.target
                                              .value as UserRole,
                                          })
                                        }
                                      >
                                        {USER_ROLES.map((r) => (
                                          <option key={r} value={r}>
                                            {USER_ROLE_LABELS[r]}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td
                                      style={{
                                        color: "var(--text-3)",
                                      }}
                                    >
                                      {date(u.createdAt)}
                                    </td>
                                    <td>
                                      {!isSelf && (
                                        <button
                                          className="btn btn-ghost btn-sm"
                                          style={{
                                            color:
                                              "var(--danger-fg)",
                                          }}
                                          title="Delete user"
                                          onClick={() =>
                                            setDeleteUser(u)
                                          }
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
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {roleMut.isError && (
                            <div
                              style={{
                                padding: "10px 14px",
                                fontSize: "12.5px",
                                color: "var(--danger-fg)",
                              }}
                            >
                              Could not change role —{" "}
                              {roleMut.error instanceof Error
                                ? roleMut.error.message
                                : "please retry"}
                              .
                            </div>
                          )}
                        </div>
                      )}

                      {/* Pending invitations — admins only */}
                      {isAdmin && (
                        <div className="card">
                          <div className="card-header">
                            <div>
                              <div className="card-title">
                                Pending invitations
                              </div>
                              <div className="card-subtitle">
                                {invitations.length} awaiting
                                acceptance
                              </div>
                            </div>
                          </div>
                          {invitations.length === 0 ? (
                            <div style={{ padding: "36px 18px" }}>
                              <EmptyState
                                title="No pending invitations"
                                message="Invite a member to add them to this workspace."
                              />
                            </div>
                          ) : (
                            <table className="tbl tbl-compact">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Email</th>
                                  <th>Role</th>
                                  <th>Invited by</th>
                                  <th>Expires</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {invitations.map((inv) => (
                                  <tr key={inv.id}>
                                    <td style={{ fontWeight: 600 }}>
                                      {inv.name}
                                    </td>
                                    <td
                                      style={{
                                        color: "var(--text-3)",
                                      }}
                                    >
                                      {inv.email}
                                    </td>
                                    <td>
                                      <span className="badge badge-neutral">
                                        {USER_ROLE_LABELS[inv.role]}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        color: "var(--text-3)",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {inv.invitedBy}
                                    </td>
                                    <td
                                      style={{
                                        color: "var(--text-3)",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {date(inv.expiresAt)}
                                    </td>
                                    <td
                                      style={{
                                        display: "flex",
                                        gap: 4,
                                      }}
                                    >
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        disabled={
                                          resendInviteMut.isPending
                                        }
                                        onClick={() =>
                                          resendInviteMut.mutate(
                                            inv.id,
                                          )
                                        }
                                      >
                                        Resend
                                      </button>
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        style={{
                                          color:
                                            "var(--danger-fg)",
                                        }}
                                        disabled={
                                          revokeInviteMut.isPending
                                        }
                                        onClick={() =>
                                          revokeInviteMut.mutate(
                                            inv.id,
                                          )
                                        }
                                      >
                                        Revoke
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </>
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

              {tab === "tags" && <TagsPanel />}

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

      {/* Invite member modal */}
      <Modal
        open={inviteOpen}
        title="Invite member"
        subtitle="They'll get an email to set their password"
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                inviteMut.isPending ||
                !inviteDraft.email ||
                !inviteDraft.name
              }
              onClick={() => inviteMut.mutate(inviteDraft)}
            >
              {inviteMut.isPending ? "Sending…" : "Send invite"}
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
            placeholder="Jane Doe"
            value={inviteDraft.name}
            onChange={(e) =>
              setInviteDraft({ ...inviteDraft, name: e.target.value })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Email <span className="req">*</span>
          </label>
          <input
            className="form-control"
            type="email"
            placeholder="teammate@brecx.com"
            value={inviteDraft.email}
            onChange={(e) =>
              setInviteDraft({ ...inviteDraft, email: e.target.value })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">Role</label>
          <select
            className="form-control"
            value={inviteDraft.role}
            onChange={(e) =>
              setInviteDraft({
                ...inviteDraft,
                role: e.target.value as UserRole,
              })
            }
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {USER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <div className="form-help">
            Admins can manage members; Users can only edit their own
            profile.
          </div>
        </div>
      </Modal>

      {/* Delete user confirm modal */}
      <Modal
        open={deleteUser !== null}
        title="Delete user"
        onClose={() => setDeleteUser(null)}
        footer={
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setDeleteUser(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              style={{ background: "var(--danger-fg)" }}
              disabled={deleteUserMut.isPending}
              onClick={() =>
                deleteUser && deleteUserMut.mutate(deleteUser.id)
              }
            >
              {deleteUserMut.isPending ? "Deleting…" : "Confirm delete"}
            </button>
          </>
        }
      >
        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>
          Delete <strong>{deleteUser?.name}</strong> ({deleteUser?.email})?
          They will be signed out and lose access immediately. This action
          cannot be undone.
        </div>
        {deleteUserMut.isError && (
          <div
            style={{
              marginTop: 10,
              fontSize: "12.5px",
              color: "var(--danger-fg)",
            }}
          >
            {deleteUserMut.error instanceof Error
              ? deleteUserMut.error.message
              : "Failed to delete user."}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* =====================================================================
   Tags library panel — three sub-sections (SKU / Buy Box / Price Alert),
   each its own CRUD list with a label input, a color picker, and inline
   edit/delete. Backed by /tags/:kind on the API.
   ===================================================================== */

const TAG_COLORS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "pink",
  "teal",
] as const;
type TagColor = (typeof TAG_COLORS)[number];

interface TagRow {
  id: string;
  label: string;
  color: TagColor;
  createdAt: string;
  updatedAt: string;
}

const TAG_KINDS: { id: "sku" | "buybox" | "price-alert"; title: string; subtitle: string }[] = [
  {
    id: "sku",
    title: "SKU Tags",
    subtitle: "Applied on the SKUs page to flag individual marketplace listings.",
  },
  {
    id: "buybox",
    title: "Buy Box Tags",
    subtitle: "Applied on the Buy Box Alert page to categorise lost-buybox ASINs.",
  },
  {
    id: "price-alert",
    title: "Price Alert Tags",
    subtitle: "Applied on the Pricing page to label products across marketplaces.",
  },
];

function TagsPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {TAG_KINDS.map((k) => (
        <TagCatalogCard key={k.id} kind={k.id} title={k.title} subtitle={k.subtitle} />
      ))}
    </div>
  );
}

function TagCatalogCard({
  kind,
  title,
  subtitle,
}: {
  kind: "sku" | "buybox" | "price-alert";
  title: string;
  subtitle: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["tag-library", kind] as const;
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState<TagColor>("blue");
  const [createErr, setCreateErr] = useState<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ items: TagRow[] }>(`/tags/${kind}`),
  });

  const createMut = useMutation({
    mutationFn: (body: { label: string; color: TagColor }) =>
      api.post<{ id: string }>(`/tags/${kind}`, body),
    onSuccess: () => {
      setLabel("");
      setColor("blue");
      setCreateErr(null);
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => setCreateErr(e.message),
  });
  const editMut = useMutation({
    mutationFn: ({
      id,
      label,
      color,
    }: {
      id: string;
      label: string;
      color: TagColor;
    }) => api.patch<TagRow>(`/tags/${kind}/${id}`, { label, color }),
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/tags/${kind}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const items = query.data?.items ?? [];

  function startEdit(t: TagRow) {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditColor(t.color);
  }
  function saveEdit() {
    if (!editingId) return;
    editMut.mutate({ id: editingId, label: editLabel, color: editColor });
  }
  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    createMut.mutate({ label: label.trim(), color });
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{title}</div>
        <div className="card-subtitle">{subtitle}</div>
      </div>

      {/* Create form */}
      <div
        className="card-body"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <form
          onSubmit={submitCreate}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="form-group" style={{ flex: "1 1 240px", margin: 0 }}>
            <label className="form-label">New tag label</label>
            <input
              className="form-control"
              placeholder="e.g. FBM, SF Case-6, Custom"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!label.trim() || createMut.isPending}
          >
            {createMut.isPending ? "Adding…" : "Add tag"}
          </button>
        </form>
        {createErr && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "var(--danger-fg)",
            }}
          >
            {createErr}
          </div>
        )}
      </div>

      {/* Existing list */}
      <div className="card-body" style={{ padding: 0 }}>
        {query.isLoading ? (
          <div style={{ padding: 14 }}>
            <Loading />
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              padding: 20,
              fontSize: 13,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            No tags yet — add one above.
          </div>
        ) : (
          items.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                borderTop: "1px solid var(--border)",
              }}
            >
              {editingId === t.id ? (
                <>
                  <input
                    className="form-control"
                    style={{ maxWidth: 220, height: 32 }}
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    maxLength={40}
                  />
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <div style={{ flex: 1 }} />
                  <button
                    className="btn btn-primary btn-xs"
                    disabled={editMut.isPending || !editLabel.trim()}
                    onClick={saveEdit}
                  >
                    {editMut.isPending ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className={`tag tag-${t.color}`}>{t.label}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() => startEdit(t)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-secondary btn-xs"
                    style={{
                      color: "var(--danger-fg)",
                      borderColor: "var(--danger-border)",
                    }}
                    disabled={deleteMut.isPending}
                    onClick={() => {
                      if (confirm(`Delete tag "${t.label}"?`)) {
                        deleteMut.mutate(t.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Color swatch picker. Renders all available tag colors as inline circular
 *  swatches; the active one gets a ring. */
function ColorPicker({
  value,
  onChange,
}: {
  value: TagColor;
  onChange: (c: TagColor) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={"tag-swatch tag-swatch-" + c}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          style={{
            outline: value === c ? "2px solid var(--brand-600)" : "none",
            outlineOffset: 1,
          }}
        />
      ))}
    </div>
  );
}

/* =====================================================================
   Security panel — change password, active sessions, login history.
   Composed inline as a sub-component so it can use react-query hooks
   without polluting the main Settings component's mutation list.
   ===================================================================== */

interface SessionItem {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  current: boolean;
}
interface LoginEvent {
  id: string;
  createdAt: string;
  summary: string;
  meta: { ip?: string | null; userAgent?: string | null } | null;
}

/** Very lightweight UA → short label. We only do it client-side because the
 *  raw user_agent string is ugly to surface as-is. OS detection extracts
 *  the Windows NT version (NT 10.0 = Windows 10/11, NT 6.1 = Windows 7, …)
 *  since that's the only OS detail UAs still expose; macOS has been frozen
 *  at 10.15.7 by every browser for years so we don't bother showing it. */
function uaLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Browser";
  let os: string;
  const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
  if (winMatch) {
    const nt = winMatch[1];
    const winName =
      nt === "10.0" ? "Windows 10/11" :
      nt === "6.3" ? "Windows 8.1" :
      nt === "6.2" ? "Windows 8" :
      nt === "6.1" ? "Windows 7" :
      nt === "6.0" ? "Windows Vista" :
      nt === "5.1" ? "Windows XP" :
      "Windows";
    os = winName;
  } else if (/Mac OS|Macintosh/.test(ua)) {
    os = "macOS";
  } else if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+(?:\.\d+)?)/);
    os = m ? `Android ${m[1]}` : "Android";
  } else if (/iPhone|iPad|iOS/.test(ua)) {
    const m = ua.match(/OS (\d+)_(\d+)/);
    os = m ? `iOS ${m[1]}.${m[2]}` : "iOS";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  } else {
    os = "Unknown OS";
  }
  return `${browser} on ${os}`;
}

/** Format the resolved geo into a single line, gracefully handling either
 *  field being null. */
function geoLabel(country: string | null, city: string | null): string | null {
  if (!country && !city) return null;
  if (country && city) return `${city}, ${country}`;
  return country ?? city;
}

function SecurityPanel() {
  const qc = useQueryClient();
  const [curr, setCurr] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["me-sessions"],
    queryFn: () => api.get<{ items: SessionItem[] }>("/me/sessions"),
  });
  const historyQuery = useQuery({
    queryKey: ["me-login-history"],
    queryFn: () => api.get<{ items: LoginEvent[] }>("/me/login-history"),
  });

  const changePwMut = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>("/me/change-password", body),
    onSuccess: () => {
      setPwMsg({
        kind: "ok",
        text: "Password updated. Other devices have been signed out.",
      });
      setCurr("");
      setNext("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["me-sessions"] });
    },
    onError: (e: Error) => setPwMsg({ kind: "err", text: e.message }),
  });

  const revokeOneMut = useMutation({
    mutationFn: (tokenHash: string) =>
      api.del<{ ok: true }>(
        `/me/sessions/${encodeURIComponent(tokenHash)}`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["me-sessions"] }),
  });
  const revokeAllMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; revoked: number }>(
        "/me/sessions/revoke-others",
        {},
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["me-sessions"] }),
  });

  function submitChangePw(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (next.length < 8) {
      setPwMsg({
        kind: "err",
        text: "New password must be at least 8 characters.",
      });
      return;
    }
    if (next !== confirm) {
      setPwMsg({ kind: "err", text: "New password and confirmation differ." });
      return;
    }
    changePwMut.mutate({ currentPassword: curr, newPassword: next });
  }

  const sessions = sessionsQuery.data?.items ?? [];
  const history = historyQuery.data?.items ?? [];
  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* --- Change password ---------------------------------------- */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Change password</div>
          <div className="card-subtitle">
            Updating your password signs out every other device automatically.
          </div>
        </div>
        <div className="card-body">
          <form
            onSubmit={submitChangePw}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="form-group">
              <label className="form-label">Current password</label>
              <input
                className="form-control"
                type="password"
                autoComplete="current-password"
                value={curr}
                onChange={(e) => setCurr(e.target.value)}
                required
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div className="form-group">
                <label className="form-label">New password</label>
                <input
                  className="form-control"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm new password</label>
                <input
                  className="form-control"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            </div>
            {pwMsg && (
              <div
                style={{
                  fontSize: 12.5,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background:
                    pwMsg.kind === "ok"
                      ? "var(--success-bg)"
                      : "var(--danger-bg)",
                  color:
                    pwMsg.kind === "ok"
                      ? "var(--success-fg)"
                      : "var(--danger-fg)",
                }}
              >
                {pwMsg.text}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={changePwMut.isPending}
              >
                {changePwMut.isPending ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* --- Active sessions ---------------------------------------- */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Active sessions</div>
          <div className="card-subtitle">
            Devices currently signed in to your account. Revoke any that you
            don't recognise.
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {sessionsQuery.isLoading ? (
            <div style={{ padding: 14 }}>
              <Loading />
            </div>
          ) : sessions.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No active sessions.
            </div>
          ) : (
            <>
              {sessions.map((s) => (
                <div
                  key={s.tokenHash}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 50,
                      background: s.current
                        ? "var(--success-fg)"
                        : "var(--text-4)",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {uaLabel(s.userAgent)}
                      {s.current && (
                        <span
                          style={{
                            background: "var(--success-bg)",
                            color: "var(--success-fg)",
                            padding: "1px 7px",
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 700,
                          }}
                        >
                          THIS DEVICE
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-3)",
                        marginTop: 2,
                      }}
                    >
                      {(() => {
                        const where = geoLabel(s.country, s.city);
                        return where ? <span>{where} · </span> : null;
                      })()}
                      {s.ip ? <span>IP {s.ip} · </span> : null}
                      Last seen {relativeTime(s.lastSeenAt)} · Expires{" "}
                      {new Date(s.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      className="btn btn-secondary btn-xs"
                      disabled={revokeOneMut.isPending}
                      onClick={() => revokeOneMut.mutate(s.tokenHash)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              {otherCount > 0 && (
                <div
                  style={{
                    padding: "10px 16px",
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={revokeAllMut.isPending}
                    onClick={() => revokeAllMut.mutate()}
                  >
                    {revokeAllMut.isPending
                      ? "Signing out…"
                      : `Sign out ${otherCount} other device${
                          otherCount === 1 ? "" : "s"
                        }`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* --- Recent sign-ins ---------------------------------------- */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent sign-ins</div>
          <div className="card-subtitle">
            Last 20 successful logins on your account. Anything unfamiliar
            means you should change your password.
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {historyQuery.isLoading ? (
            <div style={{ padding: 14 }}>
              <Loading />
            </div>
          ) : history.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No sign-in history yet.
            </div>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border)",
                  fontSize: 12.5,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>
                    {uaLabel(h.meta?.userAgent)}
                  </div>
                  <div
                    style={{
                      color: "var(--text-3)",
                      fontSize: 11.5,
                      marginTop: 1,
                    }}
                  >
                    {h.meta?.ip ? `IP ${h.meta.ip}` : "Unknown IP"}
                  </div>
                </div>
                <div style={{ color: "var(--text-3)" }}>
                  {relativeTime(h.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
