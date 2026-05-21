import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PriceSchedule,
  PriceScheduleCreateInput,
  ScheduleType,
  TimeSlot,
} from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money } from "../lib/format";
import { useToast } from "./Toast";
import { SalesReportModal } from "./SalesReportModal";
import { DateTimePicker } from "./DateTimePicker";
import "./PriceScheduleModal.css";

const browserTz =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DATES_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

type Tab = "single" | "weekly" | "monthly" | "sale";

interface SingleSlot {
  price: string;
  revertPrice: string;
  startDate: string; // datetime-local
  endDate: string;
  untilChanged: boolean;
}

interface WMSlot {
  startTime: string; // HH:MM
  endTime: string;
  price: string;
  revertPrice: string;
}

interface ScheduleList {
  items: PriceSchedule[];
  total: number;
}

export interface SkuTarget {
  id: string;
  sku: string;
  title: string;
  price: number;
  asin?: string | null;
  imageUrl?: string | null;
  channelStock?: number | null;
  fulfillmentChannel?: string | null;
  status?: string | null;
}

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function emptySingle(currentPrice: number): SingleSlot {
  return {
    price: String(currentPrice || ""),
    revertPrice: String(currentPrice || ""),
    startDate: "",
    endDate: "",
    untilChanged: false,
  };
}

function emptyWMSlot(): WMSlot {
  return { startTime: "09:00", endTime: "17:00", price: "", revertPrice: "" };
}

function initial(s: string): string {
  return (s.trim()[0] ?? "?").toUpperCase();
}

function fbaLabel(fc?: string | null): "FBA" | "FBM" | null {
  if (!fc) return null;
  return fc === "DEFAULT" ? "FBM" : "FBA";
}

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e8eaf0"/></svg>',
  );

/**
 * Price schedule drawer — slides in from the right with the redesign layout.
 * Replaces the legacy app's modal-style drawer; full feature parity (single
 * multi-slot, weekly per-day-multi-slot, monthly per-date-multi-slot, Amazon
 * Deal sale price) plus a mini calendar that highlights this SKU's existing
 * scheduled days.
 */
export function PriceScheduleModal({
  open,
  sku,
  onClose,
}: {
  open: boolean;
  sku: SkuTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("single");
  const [singleSlots, setSingleSlots] = useState<SingleSlot[]>([
    emptySingle(0),
  ]);
  const [weekly, setWeekly] = useState<Record<number, WMSlot[]>>({});
  const [monthly, setMonthly] = useState<Record<number, WMSlot[]>>({});
  const [saleStart, setSaleStart] = useState("");
  const [saleEnd, setSaleEnd] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [timezone, setTimezone] = useState(browserTz);
  const [calOffset, setCalOffset] = useState(0); // months relative to today
  const [reportOpen, setReportOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // `visible` = mounted in DOM; `mounted` = .show class applied (drives the
  // slide-in/out transform). On close, we drop .show first and only unmount
  // once the transition has finished — same trick the redesign HTML uses
  // (`drawer-panel` always rendered, `.show` toggled).
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Snapshot the SKU when the drawer opens so the contents don't blank out
  // while the close animation is running.
  const [displaySku, setDisplaySku] = useState<SkuTarget | null>(null);

  useEffect(() => {
    if (open && sku) {
      setVisible(true);
      setDisplaySku(sku);
      // Next paint → add .show → CSS transition slides it in.
      const t = setTimeout(() => setMounted(true), 10);
      return () => clearTimeout(t);
    }
    if (visible) {
      // Drop .show → slide out → unmount after the transition completes.
      setMounted(false);
      const t = setTimeout(() => {
        setVisible(false);
        setDisplaySku(null);
      }, 260);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sku]);

  useEffect(() => {
    if (!open || !sku) return;
    setTab("single");
    setSingleSlots([emptySingle(sku.price)]);
    setWeekly({});
    setMonthly({});
    setSaleStart("");
    setSaleEnd("");
    setSalePrice("");
    setErr(null);
    setTimezone(browserTz);
    setCalOffset(0);
  }, [open, sku]);

  const schedulesQ = useQuery({
    queryKey: ["schedules", { skuId: sku?.id }],
    queryFn: () =>
      api.get<ScheduleList>(
        "/schedules" + qs({ skuId: sku?.id ?? "" }),
      ),
    enabled: open && !!sku?.id,
  });

  const createMut = useMutation({
    mutationFn: (body: PriceScheduleCreateInput) =>
      api.post<PriceSchedule>("/schedules", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      toast.success("Schedule created");
      onClose();
    },
    onError: (e) =>
      setErr(e instanceof Error ? e.message : "Failed to create schedule."),
  });

  const salePriceMut = useMutation({
    mutationFn: (body: {
      skuId: string;
      value: number;
      startDate: string;
      endDate: string;
    }) => api.post<{ ok: boolean }>("/sale-price", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      toast.success("Sale price scheduled on Amazon");
      onClose();
    },
    onError: (e) =>
      setErr(e instanceof Error ? e.message : "Failed to set sale price."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
  });

  const existing = useMemo(
    () =>
      (schedulesQ.data?.items ?? []).filter((s) => s.status !== "cancelled"),
    [schedulesQ.data],
  );
  const hasWeekly = existing.some((s) => s.type === "weekly");
  const hasMonthly = existing.some((s) => s.type === "monthly");

  // ---- Single slot helpers ----
  function setSingleSlotField<K extends keyof SingleSlot>(
    i: number,
    key: K,
    val: SingleSlot[K],
  ) {
    setSingleSlots((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  }
  function addSingleSlot() {
    if (!sku) return;
    setSingleSlots((prev) => [...prev, emptySingle(sku.price)]);
  }
  function removeSingleSlot(i: number) {
    setSingleSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ---- Weekly/Monthly slot helpers ----
  function addWMSlot(map: "weekly" | "monthly", day: number) {
    const setMap = map === "weekly" ? setWeekly : setMonthly;
    setMap((prev) => ({
      ...prev,
      [day]: [...(prev[day] ?? []), emptyWMSlot()],
    }));
  }
  function removeWMSlot(map: "weekly" | "monthly", day: number, i: number) {
    const setMap = map === "weekly" ? setWeekly : setMonthly;
    setMap((prev) => {
      const next = { ...prev };
      next[day] = (next[day] ?? []).filter((_, idx) => idx !== i);
      if (next[day].length === 0) delete next[day];
      return next;
    });
  }
  function setWMSlot(
    map: "weekly" | "monthly",
    day: number,
    i: number,
    key: keyof WMSlot,
    val: string,
  ) {
    const setMap = map === "weekly" ? setWeekly : setMonthly;
    setMap((prev) => {
      const slots = [...(prev[day] ?? [])];
      slots[i] = { ...slots[i], [key]: val };
      return { ...prev, [day]: slots };
    });
  }

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text);
    toast.success("Copied", `${label} copied to clipboard.`);
  }

  // ---- Mini calendar: union of existing schedule dates for this SKU ----
  const eventDates = useMemo(() => {
    const dates = new Set<string>();
    const now = new Date();
    const view = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
    const year = view.getFullYear();
    const month = view.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    for (const s of existing) {
      if (s.type === "single" && s.startDate) {
        const d = new Date(s.startDate);
        if (d.getFullYear() === year && d.getMonth() === month) {
          dates.add(ymd(d));
        }
        if (s.endDate) {
          const e = new Date(s.endDate);
          if (e.getFullYear() === year && e.getMonth() === month) {
            dates.add(ymd(e));
          }
        }
      } else if (s.type === "weekly") {
        for (let d = 1; d <= lastDay; d++) {
          const cur = new Date(year, month, d);
          if ((s.timeSlots ?? []).some((sl) => sl.day === cur.getDay())) {
            dates.add(ymd(cur));
          }
        }
      } else if (s.type === "monthly") {
        for (const sl of s.timeSlots ?? []) {
          if (sl.day >= 1 && sl.day <= lastDay) {
            dates.add(ymd(new Date(year, month, sl.day)));
          }
        }
      }
    }
    return dates;
  }, [existing, calOffset]);

  const viewMonth = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  }, [calOffset]);

  // ---- Submit ----
  async function submit() {
    if (!sku) return;
    setErr(null);

    if (tab === "single") {
      for (let i = 0; i < singleSlots.length; i++) {
        const s = singleSlots[i];
        const price = Number(s.price);
        if (!s.price || !Number.isFinite(price) || price <= 0) {
          return setErr(`Slot ${i + 1}: enter a valid start price.`);
        }
        if (!s.startDate) {
          return setErr(`Slot ${i + 1}: pick a start date / time.`);
        }
        if (!s.untilChanged) {
          if (!s.endDate) {
            return setErr(
              `Slot ${i + 1}: pick an end date or check "Until changed".`,
            );
          }
          const revert = Number(s.revertPrice);
          if (!s.revertPrice || !Number.isFinite(revert) || revert <= 0) {
            return setErr(`Slot ${i + 1}: enter a valid revert (end) price.`);
          }
          if (new Date(s.endDate) <= new Date(s.startDate)) {
            return setErr(`Slot ${i + 1}: end must be after start.`);
          }
        }
      }
      for (const s of singleSlots) {
        const price = Number(s.price);
        const revert = s.untilChanged ? sku.price : Number(s.revertPrice);
        await createMut.mutateAsync({
          skuId: sku.id,
          type: "single",
          price,
          currentPrice: revert,
          startDate: toIso(s.startDate),
          endDate: s.untilChanged ? undefined : toIso(s.endDate),
          untilChanged: s.untilChanged,
          timeSlots: [],
          timezone,
        });
      }
      return;
    }

    if (tab === "weekly" || tab === "monthly") {
      const map = tab === "weekly" ? weekly : monthly;
      const slots: TimeSlot[] = [];
      for (const day of Object.keys(map).map(Number)) {
        for (const s of map[day]) {
          const price = Number(s.price);
          const revert = Number(s.revertPrice);
          if (!s.startTime || !s.endTime) {
            return setErr(`${tab}: every slot needs start and end times.`);
          }
          if (!Number.isFinite(price) || price <= 0) {
            return setErr(`${tab}: invalid price for slot on day ${day}.`);
          }
          if (!Number.isFinite(revert) || revert <= 0) {
            return setErr(
              `${tab}: invalid revert price for slot on day ${day}.`,
            );
          }
          if (s.endTime <= s.startTime) {
            return setErr(`${tab}: end time must be after start on day ${day}.`);
          }
          slots.push({
            day,
            startTime: s.startTime,
            endTime: s.endTime,
            price,
            revertPrice: revert,
          });
        }
      }
      if (slots.length === 0) {
        return setErr(`${tab}: add at least one time slot.`);
      }
      const firstPrice = slots[0].price;
      const firstRevert = slots[0].revertPrice ?? sku.price;
      await createMut.mutateAsync({
        skuId: sku.id,
        type: tab as ScheduleType,
        price: firstPrice,
        currentPrice: firstRevert,
        untilChanged: false,
        timeSlots: slots,
        timezone,
      });
      return;
    }

    if (tab === "sale") {
      const value = Number(salePrice);
      if (!salePrice || !Number.isFinite(value) || value <= 0) {
        return setErr("Sale price: enter a valid amount.");
      }
      if (value >= sku.price) {
        return setErr(
          `Sale price must be lower than the regular price (${money(sku.price)}).`,
        );
      }
      if (!saleStart || !saleEnd) {
        return setErr("Sale price: pick both start and end dates.");
      }
      if (new Date(saleEnd) <= new Date(saleStart)) {
        return setErr("Sale price: end must be after start.");
      }
      await salePriceMut.mutateAsync({
        skuId: sku.id,
        value,
        startDate: new Date(saleStart).toISOString(),
        endDate: new Date(saleEnd).toISOString(),
      });
      return;
    }
  }

  if (!visible || !displaySku) return null;
  const renderSku = displaySku;
  const fbm = fbaLabel(renderSku.fulfillmentChannel);

  return (
    <>
      <div
        className={"drawer-overlay" + (mounted ? " show" : "")}
        onClick={onClose}
      />
      <aside
        className={
          "drawer-panel drawer-panel-lg psm-drawer" + (mounted ? " show" : "")
        }
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="drawer-header psm-drawer-head">
          <div className="psm-drawer-head-main">
            {renderSku.imageUrl ? (
              <img
                className="psm-drawer-thumb"
                src={renderSku.imageUrl}
                alt=""
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = FALLBACK_IMG;
                }}
              />
            ) : (
              <div className="psm-drawer-thumb psm-drawer-thumb-fallback">
                {initial(renderSku.title)}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="psm-drawer-title" title={renderSku.title}>
                {renderSku.title}
              </div>
              <div className="psm-drawer-chips">
                <span className="psm-drawer-price-pill">
                  {money(renderSku.price)}
                </span>
                <span
                  className="copy-btn"
                  title="Click to copy SKU"
                  onClick={() => copy(renderSku.sku, "SKU")}
                >
                  {renderSku.sku}
                </span>
                {renderSku.asin && (
                  <span
                    className="copy-btn"
                    title="Click to copy ASIN"
                    onClick={() => copy(renderSku.asin!, "ASIN")}
                  >
                    {renderSku.asin}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body psm-drawer-body">
          {/* Stat row */}
          <div className="psm-stat-row">
            <div className="psm-stat-card">
              <div className="psm-stat-label">Channel Stock</div>
              <div className="psm-stat-value">
                {renderSku.channelStock != null
                  ? renderSku.channelStock.toLocaleString()
                  : "—"}
              </div>
            </div>
            <div className="psm-stat-card">
              <div className="psm-stat-label">Fulfillment</div>
              <div
                className="psm-stat-value"
                style={{ fontSize: 13, fontWeight: 600 }}
              >
                {fbm ? (
                  <>
                    <span
                      className={
                        "psm-dot " +
                        (renderSku.status === "active"
                          ? "psm-dot-success"
                          : "psm-dot-muted")
                      }
                    />
                    {fbm}{" "}
                    {renderSku.status === "active"
                      ? "· Active"
                      : (renderSku.status ?? "")}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>

          {/* Quick action — opens the Amazon orderMetrics-backed sales report */}
          <button
            type="button"
            className="btn btn-primary psm-report-btn"
            onClick={() => setReportOpen(true)}
          >
            See Pricing &amp; Sales Report
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>

          {/* Timezone field hidden — `timezone` state still defaults to the
              browser's IANA zone and is passed to /schedules so behavior is
              unchanged; field is just out of the UI for now. */}

          {err && <div className="psm-error">{err}</div>}

          {/* Inline tabs */}
          <div className="tabs-inline psm-tabs">
            <button
              className={tab === "single" ? "active" : ""}
              onClick={() => setTab("single")}
            >
              Single
            </button>
            <button
              className={tab === "weekly" ? "active" : ""}
              onClick={() => setTab("weekly")}
              disabled={hasWeekly}
              title={
                hasWeekly ? "A weekly schedule already exists on this SKU" : ""
              }
            >
              Weekly
            </button>
            <button
              className={tab === "monthly" ? "active" : ""}
              onClick={() => setTab("monthly")}
              disabled={hasMonthly}
              title={
                hasMonthly
                  ? "A monthly schedule already exists on this SKU"
                  : ""
              }
            >
              Monthly
            </button>
            <button
              className={tab === "sale" ? "active" : ""}
              onClick={() => setTab("sale")}
            >
              Sale Price
            </button>
          </div>

          {/* Tab content */}
          {tab === "single" && (
            <div className="psm-tab-pane">
              {singleSlots.map((s, i) => (
                <div key={i} className="psm-card">
                  <div className="psm-card-head">
                    <div className="psm-card-label">
                      Single Price Change {singleSlots.length > 1 && `· #${i + 1}`}
                    </div>
                    {singleSlots.length > 1 && (
                      <button
                        className="psm-card-x"
                        onClick={() => removeSingleSlot(i)}
                        title="Remove slot"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="psm-row3">
                    <span className="psm-row3-tag">Start</span>
                    <DateTimePicker
                      value={s.startDate}
                      onChange={(v) => setSingleSlotField(i, "startDate", v)}
                      placeholder="Pick start date / time"
                    />
                    <input
                      type="number"
                      className="form-control"
                      step="0.01"
                      min="0"
                      placeholder="Start price"
                      value={s.price}
                      onChange={(e) =>
                        setSingleSlotField(i, "price", e.target.value)
                      }
                    />
                  </div>
                  {!s.untilChanged && (
                    <div className="psm-row3">
                      <span className="psm-row3-tag">End</span>
                      <DateTimePicker
                        value={s.endDate}
                        onChange={(v) => setSingleSlotField(i, "endDate", v)}
                        placeholder="Pick end date / time"
                      />
                      <input
                        type="number"
                        className="form-control"
                        step="0.01"
                        min="0"
                        placeholder="End price"
                        value={s.revertPrice}
                        onChange={(e) =>
                          setSingleSlotField(i, "revertPrice", e.target.value)
                        }
                      />
                    </div>
                  )}
                  {i === singleSlots.length - 1 && (
                    <label className="psm-until-row">
                      <input
                        type="checkbox"
                        checked={s.untilChanged}
                        onChange={() =>
                          setSingleSlotField(
                            i,
                            "untilChanged",
                            !s.untilChanged,
                          )
                        }
                      />
                      Until change back (keep new price until manually reverted)
                    </label>
                  )}
                </div>
              ))}
              {!singleSlots.some((s) => s.untilChanged) && (
                <button
                  className="btn btn-secondary btn-sm psm-add-slot"
                  onClick={addSingleSlot}
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
                  Add Time Slot
                </button>
              )}

              {/* Mini calendar */}
              <div className="psm-mini-cal">
                <div className="psm-mini-cal-head">
                  <div className="psm-mini-cal-title">
                    {viewMonth.toLocaleString("default", {
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                  <div className="psm-mini-cal-nav">
                    <button
                      onClick={() => setCalOffset((v) => v - 1)}
                      aria-label="Previous month"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setCalOffset((v) => v + 1)}
                      aria-label="Next month"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                </div>
                <MiniCalendar viewMonth={viewMonth} eventDates={eventDates} />
                <div className="psm-mini-cal-legend">
                  <span>
                    <span className="psm-mini-dot" />
                    Existing schedule on this SKU
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === "weekly" && (
            <div className="psm-tab-pane">
              <div className="psm-help">
                For each day, add one or more (start time → price · end time →
                revert) slots. Times are interpreted in the timezone above.
              </div>
              <div className="psm-day-grid">
                {DAY_LABELS_FULL.map((label, day) => (
                  <div key={day} className="psm-day-card">
                    <div className="psm-day-head">
                      <span>{label}</span>
                      <button
                        className="psm-day-add"
                        onClick={() => addWMSlot("weekly", day)}
                        title={`Add slot for ${label}`}
                      >
                        +
                      </button>
                    </div>
                    {(weekly[day] ?? []).map((slot, i) => (
                      <WMSlotEditor
                        key={i}
                        slot={slot}
                        onChange={(k, v) => setWMSlot("weekly", day, i, k, v)}
                        onRemove={() => removeWMSlot("weekly", day, i)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "monthly" && (
            <div className="psm-tab-pane">
              <div className="psm-help">
                For each date of the month, add one or more (start time → price
                · end time → revert) slots.
              </div>
              <div className="psm-day-grid month">
                {DATES_OF_MONTH.map((date) => (
                  <div key={date} className="psm-day-card">
                    <div className="psm-day-head">
                      <span>Day {date}</span>
                      <button
                        className="psm-day-add"
                        onClick={() => addWMSlot("monthly", date)}
                        title={`Add slot for day ${date}`}
                      >
                        +
                      </button>
                    </div>
                    {(monthly[date] ?? []).map((slot, i) => (
                      <WMSlotEditor
                        key={i}
                        slot={slot}
                        onChange={(k, v) =>
                          setWMSlot("monthly", date, i, k, v)
                        }
                        onRemove={() => removeWMSlot("monthly", date, i)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "sale" && (
            <div className="psm-tab-pane">
              <div className="psm-help">
                Amazon Deal pricing — Amazon enforces the start/end window on its
                side. The listing shows a strike-through regular price during
                the window. No auto-revert job is queued.
              </div>
              <div className="psm-card">
                <div className="psm-sale-grid">
                  <div>
                    <div className="psm-field-label">
                      Sale Start <span className="req">*</span>
                    </div>
                    <DateTimePicker
                      value={saleStart}
                      onChange={setSaleStart}
                      placeholder="Pick sale start"
                    />
                  </div>
                  <div>
                    <div className="psm-field-label">
                      Sale End <span className="req">*</span>
                    </div>
                    <DateTimePicker
                      value={saleEnd}
                      onChange={setSaleEnd}
                      placeholder="Pick sale end"
                    />
                  </div>
                  <div>
                    <div className="psm-field-label">
                      Sale Price <span className="req">*</span>
                    </div>
                    <input
                      type="number"
                      className="form-control"
                      step="0.01"
                      min="0"
                      placeholder="$"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="psm-field-label">Regular Price</div>
                    <input
                      className="form-control"
                      value={money(renderSku.price)}
                      disabled
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="psm-field-label">Discount %</div>
                    <input
                      className="form-control"
                      value={
                        salePrice &&
                        Number(salePrice) > 0 &&
                        renderSku.price > 0
                          ? `${(((renderSku.price - Number(salePrice)) / renderSku.price) * 100).toFixed(1)}%`
                          : "—"
                      }
                      disabled
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Existing schedules */}
          {existing.length > 0 && (
            <div className="psm-existing">
              <div className="psm-existing-label">
                Existing schedules ({existing.length})
              </div>
              <div className="psm-existing-list">
                {existing.map((s) => (
                  <div key={s.id} className="psm-existing-row">
                    <div className="psm-existing-type">{s.type}</div>
                    <div className="psm-existing-price">
                      {money(s.price)} → {money(s.currentPrice)}
                    </div>
                    <div className="psm-existing-when">
                      {s.startDate
                        ? new Date(s.startDate).toLocaleString()
                        : `${s.timeSlots.length} slot${
                            s.timeSlots.length === 1 ? "" : "s"
                          }`}
                    </div>
                    <button
                      className="btn btn-secondary btn-xs"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(s.id)}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="drawer-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={createMut.isPending || salePriceMut.isPending}
            onClick={submit}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {createMut.isPending || salePriceMut.isPending
              ? "Saving…"
              : tab === "sale"
                ? "Set sale price"
                : "Update Price"}
          </button>
        </div>
      </aside>

      <SalesReportModal
        open={reportOpen}
        sku={renderSku.sku}
        asin={renderSku.asin ?? null}
        title={renderSku.title}
        imageUrl={renderSku.imageUrl ?? null}
        price={renderSku.price}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}

/* ----------------------- Sub-components ----------------------- */

function WMSlotEditor({
  slot,
  onChange,
  onRemove,
}: {
  slot: WMSlot;
  onChange: (k: keyof WMSlot, v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="psm-wm-slot">
      <div className="psm-wm-row">
        <span className="psm-wm-tag">Start</span>
        <input
          type="time"
          className="form-control"
          value={slot.startTime}
          onChange={(e) => onChange("startTime", e.target.value)}
        />
        <input
          type="number"
          className="form-control"
          step="0.01"
          min="0"
          placeholder="$"
          value={slot.price}
          onChange={(e) => onChange("price", e.target.value)}
        />
      </div>
      <div className="psm-wm-row">
        <span className="psm-wm-tag">End</span>
        <input
          type="time"
          className="form-control"
          value={slot.endTime}
          onChange={(e) => onChange("endTime", e.target.value)}
        />
        <input
          type="number"
          className="form-control"
          step="0.01"
          min="0"
          placeholder="$ revert"
          value={slot.revertPrice}
          onChange={(e) => onChange("revertPrice", e.target.value)}
        />
      </div>
      <button
        type="button"
        className="psm-wm-remove"
        onClick={onRemove}
        title="Remove slot"
      >
        ×
      </button>
    </div>
  );
}

function MiniCalendar({
  viewMonth,
  eventDates,
}: {
  viewMonth: Date;
  eventDates: Set<string>;
}) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0..6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthLast = new Date(year, month, 0).getDate();
  const today = new Date();
  const isToday = (d: number) =>
    d === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  const cells: Array<{ d: number; inMonth: boolean; iso?: string }> = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push({ d: prevMonthLast - firstDay + 1 + i, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      d,
      inMonth: true,
      iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cells.push({ d: i, inMonth: false });
  }

  return (
    <div className="psm-mini-cal-grid">
      {DAY_LABELS_SHORT.map((d) => (
        <div key={d} className="psm-mini-cal-dh">
          {d.slice(0, 2)}
        </div>
      ))}
      {cells.map((c, idx) => {
        const hasEvent = c.iso ? eventDates.has(c.iso) : false;
        return (
          <div
            key={idx}
            className={
              "psm-mini-cal-cell" +
              (!c.inMonth ? " out" : "") +
              (c.inMonth && isToday(c.d) ? " today" : "") +
              (hasEvent ? " has-event" : "")
            }
          >
            <span>{c.d}</span>
            {hasEvent && <span className="psm-mini-dot-inline" />}
          </div>
        );
      })}
    </div>
  );
}
