import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SALES_CHANNELS,
  CHANNEL_LABELS,
  type PriceAlert as PriceAlertConfig,
} from "@fbm/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import "./BuyBoxAlert.css";

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
  alert: PriceAlertConfig;
  libraryTags: LibraryTag[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState(alert.name);
  const [enabled, setEnabled] = useState(alert.enabled);
  const [sendTime, setSendTime] = useState(alert.sendTime);
  const [timezone, setTimezone] = useState(alert.timezone);
  const [emailsText, setEmailsText] = useState(alert.emails.join(", "));
  const [dropPct, setDropPct] = useState(alert.dropPct);
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
      api.put<PriceAlertConfig>(`/price-alert/${alert.id}`, {
        name: name.trim() || "Price alert",
        enabled,
        sendTime,
        timezone,
        emails: parseEmails(),
        dropPct,
        tagLabels,
        channels,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price-alert"] });
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
    mutationFn: () =>
      api.post<{ ok: boolean; sent: boolean; matched: number }>(
        "/price-alert/test",
        { emails: parseEmails(), dropPct, tagLabels, channels },
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
          "The filter matched 0 SKUs at this threshold. Loosen the threshold or filter and try again.",
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
    mutationFn: () => api.del(`/price-alert/${alert.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price-alert"] });
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
          <div className="bba-label">Drop threshold</div>
          <div className="bba-sub">
            Fire when current price is at least this far below base price.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            className="form-control"
            style={{ maxWidth: 100, textAlign: "right" }}
            min={1}
            max={99}
            value={dropPct}
            onChange={(e) =>
              setDropPct(Math.max(1, Math.min(99, Number(e.target.value) || 1)))
            }
          />
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>% below base</span>
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
          title="Send this alert's email now (using the form's recipients & filter) so you can check it"
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

export function PriceAlert() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["price-alert"],
    queryFn: () => api.get<{ items: PriceAlertConfig[] }>("/price-alert"),
  });

  // Tag library for the filter chips. Workspace-scoped, "sku" kind matches
  // the per-SKU tagging on the SKUs page.
  const tagsQ = useQuery({
    queryKey: ["tag-library", "sku"],
    queryFn: () => api.get<{ items: LibraryTag[] }>("/tags/sku"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<PriceAlertConfig>("/price-alert", {
        name: "New price alert",
        timezone: browserTz,
        emails: user?.email ? [user.email] : [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["price-alert"] }),
    onError: (err) =>
      toast.error(
        "Couldn't add alert",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState />;

  const items = query.data?.items ?? [];
  const libraryTags = tagsQ.data?.items ?? [];

  return (
    <div>
      <div className="card bba-card" style={{ padding: 22, marginBottom: 16 }}>
        <p className="bba-note" style={{ marginBottom: 14 }}>
          Each alert below sends one email a day — at its chosen time — listing
          every SKU whose current price is at least the configured percent
          below its base price. Add multiple alerts to route different
          thresholds, tags, or channels to different recipients. No email is
          sent when nothing matches.
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
          message="Add an alert to start getting the daily price-drop digest."
        />
      ) : (
        items.map((a) => (
          <AlertCard key={a.id} alert={a} libraryTags={libraryTags} />
        ))
      )}
    </div>
  );
}
