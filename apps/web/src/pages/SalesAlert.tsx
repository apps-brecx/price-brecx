import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SALES_CHANNELS,
  CHANNEL_LABELS,
  type Alert,
  type SalesAlert as SalesAlertConfig,
} from "@fbm/shared";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import "./BuyBoxAlert.css";

interface AlertList {
  items: Alert[];
  total: number;
}

type SeverityFilter = "all" | "critical" | "warning" | "info";

const DOT_CLASS: Record<Alert["severity"], string> = {
  critical: "red",
  warning: "amber",
  info: "blue",
};

const FILTERS: { key: SeverityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
];

const browserTz =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "America/New_York — US Eastern" },
  { value: "America/Chicago", label: "America/Chicago — US Central" },
  { value: "America/Denver", label: "America/Denver — US Mountain" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles — US Pacific" },
  { value: "Asia/Dhaka", label: "Asia/Dhaka — Bangladesh" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata — India" },
  { value: "Asia/Dubai", label: "Asia/Dubai — Gulf" },
  { value: "Europe/London", label: "Europe/London — UK" },
  { value: "Europe/Berlin", label: "Europe/Berlin — Central Europe" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai — China" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];

interface LibraryTag {
  id: string;
  label: string;
  color: string;
}

function AlertCard({
  alert,
  libraryTags,
}: {
  alert: SalesAlertConfig;
  libraryTags: LibraryTag[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState(alert.name);
  const [enabled, setEnabled] = useState(alert.enabled);
  const [sendTime, setSendTime] = useState(alert.sendTime);
  const [timezone, setTimezone] = useState(alert.timezone);
  const [emailsText, setEmailsText] = useState(alert.emails.join(", "));
  const [dropPct, setDropPct] = useState(alert.thresholdDropPct);
  const [zeroDays, setZeroDays] = useState(alert.thresholdZeroDays);
  const [lowDays, setLowDays] = useState(alert.thresholdLowDays);
  const [tagLabels, setTagLabels] = useState<string[]>(alert.tagLabels);
  const [channels, setChannels] = useState<string[]>(alert.channels);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parseEmails = () =>
    emailsText
      .split(/[,\n;]+/)
      .map((e) => e.trim())
      .filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      api.put<SalesAlertConfig>(`/sales-alert/${alert.id}`, {
        name: name.trim() || "Sales alert",
        enabled,
        sendTime,
        timezone,
        emails: parseEmails(),
        thresholdDropPct: dropPct,
        thresholdZeroDays: zeroDays,
        thresholdLowDays: lowDays,
        tagLabels,
        channels,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-alert"] });
      toast.success(
        "Saved",
        enabled
          ? `This alert will email its recipients daily at ${sendTime}.`
          : "This alert is turned off.",
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't save",
        err instanceof Error
          ? err.message
          : "Check the emails / thresholds and try again.",
      ),
  });

  const sendTest = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; sent: boolean; matched: number }>(
        "/sales-alert/test",
        {
          emails: parseEmails(),
          thresholdDropPct: dropPct,
          thresholdZeroDays: zeroDays,
          thresholdLowDays: lowDays,
          tagLabels,
          channels,
        },
      ),
    onSuccess: (res) => {
      if (res.sent) {
        toast.success(
          "Test email sent",
          `${res.matched} matching SKU${res.matched === 1 ? "" : "s"} sent to the recipients.`,
        );
      } else {
        toast.info(
          "Nothing to send",
          "The filter matched 0 SKUs at these thresholds. Loosen the thresholds or filter and try again.",
        );
      }
    },
    onError: (err) =>
      toast.error(
        "Couldn't send test",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const del = useMutation({
    mutationFn: () => api.del(`/sales-alert/${alert.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-alert"] });
      toast.success("Alert deleted");
    },
    onError: (err) =>
      toast.error(
        "Couldn't delete",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  function toggleTag(label: string) {
    setTagLabels((prev) =>
      prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label],
    );
  }
  function toggleChannel(c: string) {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  return (
    <div className="card bba-card" style={{ padding: 22, marginBottom: 16 }}>
      <div className="bba-card-head">
        <input
          className="form-control bba-name"
          value={name}
          placeholder="Alert name"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-xs"
          disabled={del.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {del.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Email alerts</div>
          <div className="bba-sub">Turn this alert on or off.</div>
        </div>
        <div
          className={"bba-toggle" + (enabled ? " on" : "")}
          role="switch"
          aria-checked={enabled}
          aria-label="Enable this alert"
          onClick={() => setEnabled((v) => !v)}
        />
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Sales drop threshold</div>
          <div className="bba-sub">
            Trigger if 7-day sales fall ≥ N% below the prior 23-day average.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={100}
            className="form-control"
            style={{ maxWidth: 88, textAlign: "right" }}
            value={dropPct}
            onChange={(e) => setDropPct(Number(e.target.value) || 1)}
          />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>%</span>
        </div>
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Stalled SKU threshold</div>
          <div className="bba-sub">
            Active SKU with zero sales for ≥ N consecutive days.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={365}
            className="form-control"
            style={{ maxWidth: 88, textAlign: "right" }}
            value={zeroDays}
            onChange={(e) => setZeroDays(Number(e.target.value) || 1)}
          />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>days</span>
        </div>
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Low days-of-supply</div>
          <div className="bba-sub">
            Warn when stock / (30-day daily velocity) falls below N days.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={365}
            className="form-control"
            style={{ maxWidth: 88, textAlign: "right" }}
            value={lowDays}
            onChange={(e) => setLowDays(Number(e.target.value) || 1)}
          />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>days</span>
        </div>
      </div>

      <div className="bba-row" style={{ alignItems: "flex-start" }}>
        <div style={{ paddingTop: 4 }}>
          <div className="bba-label">Tag filter</div>
          <div className="bba-sub">
            Only SKUs carrying one of the selected tags. None selected = all SKUs.
          </div>
        </div>
        <div className="bba-filter">
          {libraryTags.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              No tags yet — create them in Settings → Tags → SKU.
            </div>
          )}
          {libraryTags.map((t) => (
            <div
              key={t.id}
              className={
                "filter-chip" + (tagLabels.includes(t.label) ? " active" : "")
              }
              onClick={() => toggleTag(t.label)}
            >
              {t.label}
            </div>
          ))}
        </div>
      </div>

      <div className="bba-row" style={{ alignItems: "flex-start" }}>
        <div style={{ paddingTop: 4 }}>
          <div className="bba-label">Channel filter</div>
          <div className="bba-sub">
            Only SKUs on the selected channels. None selected = all channels.
          </div>
        </div>
        <div className="bba-filter">
          {SALES_CHANNELS.map((c) => (
            <div
              key={c}
              className={"filter-chip" + (channels.includes(c) ? " active" : "")}
              onClick={() => toggleChannel(c)}
            >
              {CHANNEL_LABELS[c]}
            </div>
          ))}
        </div>
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Send time</div>
          <div className="bba-sub">Local time of day to send the digest.</div>
        </div>
        <input
          type="time"
          className="form-control"
          style={{ maxWidth: 140 }}
          value={sendTime}
          onChange={(e) => setSendTime(e.target.value)}
        />
      </div>

      <div className="bba-row">
        <div>
          <div className="bba-label">Timezone</div>
          <div className="bba-sub">
            The send time is interpreted in this timezone.
          </div>
        </div>
        <select
          className="form-control"
          style={{ maxWidth: 300 }}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {!TIMEZONES.some((t) => t.value === timezone) && (
            <option value={timezone}>{timezone}</option>
          )}
          {TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="bba-row" style={{ alignItems: "flex-start" }}>
        <div style={{ paddingTop: 6 }}>
          <div className="bba-label">Recipients</div>
          <div className="bba-sub">Comma-separated email addresses.</div>
        </div>
        <textarea
          className="form-control"
          style={{ maxWidth: 320, minHeight: 64, resize: "vertical" }}
          placeholder="ops@brecx.com, alerts@brecx.com"
          value={emailsText}
          onChange={(e) => setEmailsText(e.target.value)}
        />
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}
      >
        <button
          className="btn btn-primary btn-sm"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          title="Send this alert's email now (using the form's recipients & filter)"
          disabled={sendTest.isPending || !emailsText.trim()}
          onClick={() => sendTest.mutate()}
        >
          {sendTest.isPending ? "Sending…" : "Send test now"}
        </button>
        {alert.lastSentOn && (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            Last digest sent on: {alert.lastSentOn}
          </span>
        )}
        {alert.updatedAt && !alert.lastSentOn && (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            Updated {relativeTime(alert.updatedAt)}
          </span>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Delete alert?"
        message={`"${alert.name}" will stop sending and its history will be removed. This can't be undone.`}
        confirmLabel="Delete alert"
        destructive
        busy={del.isPending}
        onConfirm={() => {
          del.mutate();
          setConfirmOpen(false);
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export function SalesAlert() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  // ---- Multi-alert settings ----
  const settingsQ = useQuery({
    queryKey: ["sales-alert"],
    queryFn: () => api.get<{ items: SalesAlertConfig[] }>("/sales-alert"),
  });

  const tagsQ = useQuery({
    queryKey: ["tag-library", "sku"],
    queryFn: () => api.get<{ items: LibraryTag[] }>("/tags/sku"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<SalesAlertConfig>("/sales-alert", {
        name: "New sales alert",
        timezone: browserTz,
        emails: user?.email ? [user.email] : [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales-alert"] }),
    onError: (err) =>
      toast.error(
        "Couldn't add alert",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  // ---- Triggered-alerts inbox (read-only list of past evaluator hits) ----
  const inboxQ = useQuery({
    queryKey: ["alerts", "sales"],
    queryFn: () => api.get<AlertList>("/alerts" + qs({ kind: "sales" })),
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/alerts/${id}/ack`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts", "sales"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const items = inboxQ.data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const unacked = items.filter((a) => !a.acknowledged).length;
    const critical = items.filter((a) => a.severity === "critical").length;
    return { total, unacked, critical };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (severity !== "all" && a.severity !== severity) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, severity]);

  if (settingsQ.isLoading) return <Loading />;
  if (settingsQ.isError) return <ErrorState />;

  const alerts = settingsQ.data?.items ?? [];
  const libraryTags = tagsQ.data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: 4,
            }}
          >
            Sales Alert
          </h1>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Get emailed when sales velocity drops, SKUs stall, or stock runs low.
          </div>
        </div>
      </div>

      {/* Alert settings (multi-alert) */}
      <div className="card bba-card" style={{ padding: 22, marginBottom: 16 }}>
        <p className="bba-note" style={{ marginBottom: 14 }}>
          Sales data is refreshed by the daily 11:30 AM (Asia/Dhaka) sync. Each
          alert below sends one email a day — at its chosen time — listing every
          SKU whose sales dropped beyond your threshold, stalled, or is running
          out of stock. Add multiple alerts to route different thresholds, tags,
          or channels to different recipients. No email is sent when nothing
          matches.
        </p>
        <button
          className="btn btn-primary btn-sm"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Adding…" : "+ Add alert"}
        </button>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="No alerts yet"
          message="Add an alert to start getting the daily sales-alert digest."
        />
      ) : (
        alerts.map((a) => (
          <AlertCard key={a.id} alert={a} libraryTags={libraryTags} />
        ))
      )}

      {/* Triggered-alerts inbox */}
      <div style={{ marginTop: 32 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "0 0 12px",
            color: "var(--text)",
          }}
        >
          Recent triggered alerts
        </h2>

        {inboxQ.isLoading ? (
          <Loading />
        ) : inboxQ.isError ? (
          <ErrorState />
        ) : (
          <>
            <div className="dash-kpi-grid" style={{ marginBottom: 18 }}>
              <div className="dash-kpi">
                <div className="dash-kpi-label">Total alerts</div>
                <div className="dash-kpi-value">{stats.total}</div>
                <div className="dash-kpi-foot">
                  <span className="dash-chip flat">→</span>
                  <span>since last check</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-label">Unacknowledged</div>
                <div className="dash-kpi-value">{stats.unacked}</div>
                <div className="dash-kpi-foot">
                  <span className="dash-chip flat">→</span>
                  <span>needs review</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-label">Critical</div>
                <div className="dash-kpi-value">{stats.critical}</div>
                <div className="dash-kpi-foot">
                  <span className="dash-chip down">High</span>
                  <span>priority</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-label">Acknowledged</div>
                <div className="dash-kpi-value">
                  {stats.total - stats.unacked}
                </div>
                <div className="dash-kpi-foot">
                  <span className="dash-chip flat">→</span>
                  <span>handled</span>
                </div>
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
              <div className="input-wrap" style={{ flex: 1, maxWidth: 380 }}>
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
                  placeholder="Search alerts..."
                  style={{ width: "100%" }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {FILTERS.map((f) => (
                <div
                  key={f.key}
                  className={
                    "filter-chip" + (severity === f.key ? " active" : "")
                  }
                  onClick={() => setSeverity(f.key)}
                >
                  {f.label}
                </div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title={items.length === 0 ? "No triggered alerts yet" : "No matches"}
                message={
                  items.length === 0
                    ? "Triggered alerts appear here once the daily evaluator runs against your enabled alerts above."
                    : "Try a different search or filter."
                }
              />
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="sa-list">
                  {filtered.map((a) => (
                    <div
                      key={a.id}
                      className="sa-alert"
                      style={a.acknowledged ? { opacity: 0.6 } : undefined}
                    >
                      <div
                        className={"sa-alert-dot " + DOT_CLASS[a.severity]}
                      />
                      <div className="sa-alert-body">
                        <div className="sa-alert-title">{a.title}</div>
                        <div className="sa-alert-desc">{a.message}</div>
                        <div className="sa-alert-meta">
                          <span className="sa-alert-time">
                            {relativeTime(a.createdAt)}
                          </span>
                          <div className="sa-alert-tags">
                            {a.sku && (
                              <span className="sa-alert-tag">{a.sku}</span>
                            )}
                            <span className="sa-alert-tag">{a.severity}</span>
                            {a.acknowledged && (
                              <span className="sa-alert-tag">Acked</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {!a.acknowledged && (
                        <div className="sa-alert-actions">
                          <div
                            className="sa-alert-action-btn"
                            title="Mark acknowledged"
                            onClick={() => ack.mutate(a.id)}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
