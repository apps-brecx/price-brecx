import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Alert, SalesAlert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
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

export function SalesAlert() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  // ---- Settings ----
  const settingsQ = useQuery({
    queryKey: ["sales-alert"],
    queryFn: () => api.get<SalesAlert>("/sales-alert"),
  });

  const [enabled, setEnabled] = useState(false);
  const [sendTime, setSendTime] = useState("09:00");
  const [timezone, setTimezone] = useState(browserTz);
  const [emailsText, setEmailsText] = useState("");
  const [dropPct, setDropPct] = useState(30);
  const [zeroDays, setZeroDays] = useState(14);
  const [lowDays, setLowDays] = useState(14);

  useEffect(() => {
    const d = settingsQ.data;
    if (!d) return;
    setEnabled(d.enabled);
    setSendTime(d.sendTime);
    setTimezone(d.timezone);
    setEmailsText(d.emails.length ? d.emails.join(", ") : (user?.email ?? ""));
    setDropPct(d.thresholdDropPct);
    setZeroDays(d.thresholdZeroDays);
    setLowDays(d.thresholdLowDays);
  }, [settingsQ.data, user?.email]);

  const save = useMutation({
    mutationFn: () => {
      const emails = emailsText
        .split(/[,\n;]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      return api.put<SalesAlert>("/sales-alert", {
        enabled,
        sendTime,
        timezone,
        emails,
        thresholdDropPct: dropPct,
        thresholdZeroDays: zeroDays,
        thresholdLowDays: lowDays,
      });
    },
    onSuccess: (data) => {
      qc.setQueryData(["sales-alert"], data);
      toast.success(
        "Saved",
        data.enabled
          ? `You'll get the sales-alert digest daily at ${data.sendTime}.`
          : "Sales email alerts are turned off.",
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

  // ---- Alerts list ----
  const query = useQuery({
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

  const items = query.data?.items ?? [];

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
            Get notified when sales velocity drops, SKUs stall, or stock runs low.
          </div>
        </div>
      </div>

      {/* Settings card */}
      {settingsQ.isLoading ? (
        <Loading />
      ) : settingsQ.isError ? (
        <ErrorState />
      ) : (
        <div className="card bba-card" style={{ padding: 22, marginBottom: 18 }}>
          <p className="bba-note">
            Sales data is refreshed by the daily 11:30 AM (Asia/Dhaka) sync.
            Enable this to get one email a day — at the time you choose — listing
            every SKU whose 7-day sales dropped beyond your threshold, has stalled,
            or is running out of stock. No email is sent on days where nothing
            crosses a threshold.
          </p>

          <div className="bba-row">
            <div>
              <div className="bba-label">Email alerts</div>
              <div className="bba-sub">
                Turn the daily sales-alert digest on or off.
              </div>
            </div>
            <div
              className={"bba-toggle" + (enabled ? " on" : "")}
              role="switch"
              aria-checked={enabled}
              aria-label="Enable email alerts"
              onClick={() => setEnabled((v) => !v)}
            />
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

          <div className="bba-row">
            <div>
              <div className="bba-label">Sales drop threshold</div>
              <div className="bba-sub">
                Trigger if 7-day sales fall ≥ N% below the prior 23-day average.
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="number"
                min={1}
                max={100}
                className="form-control"
                style={{ maxWidth: 88 }}
                value={dropPct}
                onChange={(e) => setDropPct(Number(e.target.value) || 0)}
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="number"
                min={1}
                max={365}
                className="form-control"
                style={{ maxWidth: 88 }}
                value={zeroDays}
                onChange={(e) => setZeroDays(Number(e.target.value) || 0)}
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="number"
                min={1}
                max={365}
                className="form-control"
                style={{ maxWidth: 88 }}
                value={lowDays}
                onChange={(e) => setLowDays(Number(e.target.value) || 0)}
              />
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>days</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 18,
            }}
          >
            <button
              className="btn btn-primary btn-sm"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            {settingsQ.data?.lastSentOn && (
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                Last digest sent on: {settingsQ.data.lastSentOn}
              </span>
            )}
            {settingsQ.data?.updatedAt && !settingsQ.data.lastSentOn && (
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                Updated {relativeTime(settingsQ.data.updatedAt)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Alert list */}
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
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
              <div className="dash-kpi-value">{stats.total - stats.unacked}</div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>handled</span>
              </div>
            </div>
          </div>

          {/* Filters */}
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
              title={items.length === 0 ? "No sales alerts yet" : "No matches"}
              message={
                items.length === 0
                  ? "Alerts appear here once the daily evaluator runs. Enable email alerts above to also get a digest."
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
  );
}
