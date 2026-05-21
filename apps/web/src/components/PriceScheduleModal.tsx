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
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import "./PriceScheduleModal.css";

const browserTz =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

const DAY_LABELS = [
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

interface SkuTarget {
  id: string;
  sku: string;
  title: string;
  price: number;
}

/** Convert datetime-local (no tz) → ISO 8601 (treated as workspace local). */
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
  // Weekly: day index 0..6 → list of slots
  const [weekly, setWeekly] = useState<Record<number, WMSlot[]>>({});
  // Monthly: date 1..31 → list of slots
  const [monthly, setMonthly] = useState<Record<number, WMSlot[]>>({});
  // Sale Price (Amazon Deal)
  const [saleStart, setSaleStart] = useState("");
  const [saleEnd, setSaleEnd] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [timezone, setTimezone] = useState(browserTz);
  const [err, setErr] = useState<string | null>(null);

  // Seed when a new SKU opens the modal.
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
  }, [open, sku]);

  // Schedules already on this SKU — surfaced under the form.
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

  async function submit() {
    if (!sku) return;
    setErr(null);

    if (tab === "single") {
      // Validate each single slot before any are sent.
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
            return setErr(`${tab}: invalid revert price for slot on day ${day}.`);
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

  if (!open) return null;
  return (
    <Modal
      open={open}
      title={sku ? `Schedule price · ${sku.sku}` : ""}
      subtitle={sku?.title}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={
              createMut.isPending || salePriceMut.isPending || !sku
            }
            onClick={submit}
          >
            {createMut.isPending || salePriceMut.isPending
              ? "Saving…"
              : tab === "sale"
                ? "Set sale price"
                : tab === "weekly"
                  ? "Save weekly schedule"
                  : tab === "monthly"
                    ? "Save monthly schedule"
                    : singleSlots.length > 1
                      ? `Save ${singleSlots.length} schedules`
                      : "Save schedule"}
          </button>
        </>
      }
    >
      {/* Header summary */}
      {sku && (
        <div className="psm-summary">
          <div>
            <div className="psm-summary-label">Current price</div>
            <div className="psm-summary-value">{money(sku.price)}</div>
          </div>
          <div className="psm-summary-divider" />
          <div style={{ flex: 1 }}>
            <div className="psm-summary-label">Timezone</div>
            <input
              className="form-control"
              style={{ fontSize: 12.5, padding: "4px 8px", maxWidth: 260 }}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
        </div>
      )}

      {err && (
        <div className="psm-error">{err}</div>
      )}

      {/* Tabs */}
      <div className="psm-tabs">
        <button
          className={"psm-tab" + (tab === "single" ? " active" : "")}
          onClick={() => setTab("single")}
        >
          Single
        </button>
        <button
          className={"psm-tab" + (tab === "weekly" ? " active" : "")}
          onClick={() => setTab("weekly")}
          disabled={hasWeekly}
          title={hasWeekly ? "A weekly schedule already exists on this SKU" : ""}
        >
          Weekly
        </button>
        <button
          className={"psm-tab" + (tab === "monthly" ? " active" : "")}
          onClick={() => setTab("monthly")}
          disabled={hasMonthly}
          title={hasMonthly ? "A monthly schedule already exists on this SKU" : ""}
        >
          Monthly
        </button>
        <button
          className={"psm-tab" + (tab === "sale" ? " active" : "")}
          onClick={() => setTab("sale")}
        >
          Sale Price
        </button>
      </div>

      {/* Single tab */}
      {tab === "single" && (
        <div className="psm-pane">
          {singleSlots.map((s, i) => (
            <div key={i} className="psm-slot-card">
              <div className="psm-slot-grid">
                <div className="psm-slot-label">Start</div>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={s.startDate}
                  onChange={(e) =>
                    setSingleSlotField(i, "startDate", e.target.value)
                  }
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

                {!s.untilChanged && (
                  <>
                    <div className="psm-slot-label">End</div>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={s.endDate}
                      onChange={(e) =>
                        setSingleSlotField(i, "endDate", e.target.value)
                      }
                    />
                    <input
                      type="number"
                      className="form-control"
                      step="0.01"
                      min="0"
                      placeholder="Revert price"
                      value={s.revertPrice}
                      onChange={(e) =>
                        setSingleSlotField(i, "revertPrice", e.target.value)
                      }
                    />
                  </>
                )}
              </div>

              {i === singleSlots.length - 1 && (
                <label className="psm-until">
                  <input
                    type="checkbox"
                    checked={s.untilChanged}
                    onChange={() =>
                      setSingleSlotField(i, "untilChanged", !s.untilChanged)
                    }
                  />
                  Until changed back (no auto-revert)
                </label>
              )}

              {singleSlots.length > 1 && (
                <button
                  className="psm-slot-remove"
                  onClick={() => removeSingleSlot(i)}
                  title="Remove slot"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {!singleSlots.some((s) => s.untilChanged) && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={addSingleSlot}
            >
              + Add another time slot
            </button>
          )}
        </div>
      )}

      {/* Weekly tab */}
      {tab === "weekly" && (
        <div className="psm-pane">
          <div className="psm-help">
            For each day, add one or more (start time → price · end time → revert)
            slots. Times are interpreted in the timezone above.
          </div>
          <div className="psm-day-grid">
            {DAY_LABELS.map((label, day) => (
              <div key={day} className="psm-day-card">
                <div className="psm-day-head">
                  <span>{label}</span>
                  <button
                    className="psm-day-add"
                    onClick={() => addWMSlot("weekly", day)}
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

      {/* Monthly tab */}
      {tab === "monthly" && (
        <div className="psm-pane">
          <div className="psm-help">
            For each date of the month, add one or more (start time → price · end
            time → revert) slots.
          </div>
          <div className="psm-day-grid month">
            {DATES_OF_MONTH.map((date) => (
              <div key={date} className="psm-day-card">
                <div className="psm-day-head">
                  <span>Day {date}</span>
                  <button
                    className="psm-day-add"
                    onClick={() => addWMSlot("monthly", date)}
                  >
                    +
                  </button>
                </div>
                {(monthly[date] ?? []).map((slot, i) => (
                  <WMSlotEditor
                    key={i}
                    slot={slot}
                    onChange={(k, v) => setWMSlot("monthly", date, i, k, v)}
                    onRemove={() => removeWMSlot("monthly", date, i)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sale tab */}
      {tab === "sale" && (
        <div className="psm-pane">
          <div className="psm-help">
            Amazon Deal pricing — Amazon enforces the start/end window on its
            side. The listing shows a strike-through regular price and the
            discounted sale price during the window. No auto-revert job is
            queued; Amazon handles it.
          </div>
          <div className="psm-sale-grid">
            <div>
              <div className="psm-field-label">
                Sale Start <span className="req">*</span>
              </div>
              <input
                type="datetime-local"
                className="form-control"
                value={saleStart}
                onChange={(e) => setSaleStart(e.target.value)}
              />
            </div>
            <div>
              <div className="psm-field-label">
                Sale End <span className="req">*</span>
              </div>
              <input
                type="datetime-local"
                className="form-control"
                value={saleEnd}
                onChange={(e) => setSaleEnd(e.target.value)}
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
                value={sku ? money(sku.price) : ""}
                disabled
              />
            </div>
            <div>
              <div className="psm-field-label">Discount %</div>
              <input
                className="form-control"
                value={
                  sku && salePrice && Number(salePrice) > 0 && sku.price > 0
                    ? `${(((sku.price - Number(salePrice)) / sku.price) * 100).toFixed(1)}%`
                    : "—"
                }
                disabled
              />
            </div>
          </div>
        </div>
      )}

      {/* Existing schedules on this SKU */}
      {existing.length > 0 && (
        <div className="psm-existing">
          <div className="psm-existing-label">
            Existing schedules on this SKU
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
                    : `${s.timeSlots.length} slot${s.timeSlots.length === 1 ? "" : "s"}`}
                </div>
                <div className="psm-existing-status">{s.status}</div>
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
    </Modal>
  );
}

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
          placeholder="$ Start price"
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
          placeholder="$ Revert price"
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
