import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type BuyboxAlert, LOST_BUYBOX_REASONS } from "@fbm/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import "./BuyBoxAlert.css";

const browserTz =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

/** Curated IANA timezones for the digest schedule. */
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

type Reason = (typeof LOST_BUYBOX_REASONS)[number];
const REASON_OPTIONS: { key: Reason; label: string }[] = [
  { key: "other_seller_winning", label: "Lost to seller" },
  { key: "no_featured_offer", label: "No featured offer" },
  { key: "unknown_winner_anonymized", label: "Winner hidden" },
];

function AlertCard({ alert }: { alert: BuyboxAlert }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState(alert.name);
  const [enabled, setEnabled] = useState(alert.enabled);
  const [sendTime, setSendTime] = useState(alert.sendTime);
  const [timezone, setTimezone] = useState(alert.timezone);
  const [emailsText, setEmailsText] = useState(alert.emails.join(", "));
  const [reasons, setReasons] = useState<Reason[]>(alert.reasons);
  const [specialOnly, setSpecialOnly] = useState(alert.specialOnly);

  const save = useMutation({
    mutationFn: () => {
      const emails = emailsText
        .split(/[,\n;]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      return api.put<BuyboxAlert>(`/buybox-alert/${alert.id}`, {
        name: name.trim() || "Buy Box alert",
        enabled,
        sendTime,
        timezone,
        emails,
        reasons,
        specialOnly,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buybox-alert"] });
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
        err instanceof Error ? err.message : "Check the emails and try again.",
      ),
  });

  const sendTest = useMutation({
    mutationFn: () => {
      const emails = emailsText
        .split(/[,\n;]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      return api.post<{
        ok: boolean;
        sent: boolean;
        matched: number;
        total: number;
      }>("/buybox-alert/test", { emails, reasons, specialOnly });
    },
    onSuccess: (res) => {
      if (res.sent) {
        toast.success(
          "Test email sent",
          `${res.matched} matching ASIN${
            res.matched === 1 ? "" : "s"
          } sent to the recipients.`,
        );
      } else {
        toast.info(
          "Nothing to send",
          `The filter matched 0 of ${res.total} current losses. Loosen the filter and try again.`,
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
    mutationFn: () => api.del(`/buybox-alert/${alert.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buybox-alert"] });
      toast.success("Alert deleted");
    },
    onError: (err) =>
      toast.error(
        "Couldn't delete",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  function toggleReason(key: Reason) {
    setReasons((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key],
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
          onClick={() => {
            if (window.confirm(`Delete "${alert.name}"?`)) del.mutate();
          }}
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

      <div className="bba-row" style={{ alignItems: "flex-start" }}>
        <div style={{ paddingTop: 4 }}>
          <div className="bba-label">Filter</div>
          <div className="bba-sub">
            Which lost-Buy-Box rows trigger this alert. No reason selected =
            all reasons.
          </div>
        </div>
        <div className="bba-filter">
          {REASON_OPTIONS.map((o) => (
            <div
              key={o.key}
              className={
                "filter-chip" + (reasons.includes(o.key) ? " active" : "")
              }
              onClick={() => toggleReason(o.key)}
            >
              {o.label}
            </div>
          ))}
          <div className="bba-filter-divider" />
          <div
            className={"filter-chip" + (specialOnly ? " active" : "")}
            title="Non-FBM SKUs that have a price and 'Syruvia' or 'Bursting' in the title"
            onClick={() => setSpecialOnly((v) => !v)}
          >
            Syruvia / Bursting
          </div>
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
          title="Send this alert's email now (using the recipients & filter shown) so you can check it"
          disabled={sendTest.isPending || !emailsText.trim()}
          onClick={() => sendTest.mutate()}
        >
          {sendTest.isPending ? "Sending…" : "Send test now"}
        </button>
        {alert.lastSentOn && (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            Last digest handled: {alert.lastSentOn}
          </span>
        )}
        {alert.updatedAt && !alert.lastSentOn && (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            Updated {relativeTime(alert.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

export function BuyBoxAlert() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["buybox-alert"],
    queryFn: () => api.get<{ items: BuyboxAlert[] }>("/buybox-alert"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<BuyboxAlert>("/buybox-alert", {
        name: "New alert",
        timezone: browserTz,
        emails: user?.email ? [user.email] : [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buybox-alert"] }),
    onError: (err) =>
      toast.error(
        "Couldn't add alert",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState />;

  const items = query.data?.items ?? [];

  return (
    <div>
      <div className="card bba-card" style={{ padding: 22, marginBottom: 16 }}>
        <p className="bba-note" style={{ marginBottom: 14 }}>
          The Lost Buy Box report refreshes automatically every hour. Each alert
          below sends one email a day — at its chosen time — listing the ASINs
          not winning the Buy Box that match its filter. Add multiple alerts to
          route different filters to different recipients. No email is sent when
          nothing matches.
        </p>
        <button
          className="btn btn-primary btn-sm"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Adding…" : "+ Add alert"}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No alerts yet"
          message="Add an alert to start getting the daily Buy Box loss digest."
        />
      ) : (
        items.map((a) => <AlertCard key={a.id} alert={a} />)
      )}
    </div>
  );
}
