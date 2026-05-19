import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type {
  Sku,
  Paginated,
  SkuCreateInput,
  TimeSlot,
  ScheduleType,
} from "@fbm/shared";
import { CHANNEL_LABELS, SALES_CHANNELS, SKU_STATUSES } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge, Tags } from "../components/Badges";
import { Modal } from "../components/Modal";
import { BarcodeScanner } from "../components/BarcodeScanner";

const PAGE_SIZE = 25;

const emptyDraft: SkuCreateInput = {
  sku: "",
  title: "",
  asin: "",
  channel: "amazon",
  price: 0,
  basePrice: null,
  cost: null,
  stock: 0,
  status: "active",
};

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#f59e0b"/></svg>',
  );

function ProductImg({
  src,
  className,
}: {
  src: string | null;
  className: string;
}) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      className={className}
      src={!src || errored ? FALLBACK_IMG : src}
      alt=""
      onError={() => setErrored(true)}
    />
  );
}

export function SKUs() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<SkuCreateInput>(emptyDraft);
  const [scheduleFor, setScheduleFor] = useState<Sku | null>(null);

  // Debounce search → resets to page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["skus", { search, page }],
    queryFn: () =>
      api.get<Paginated<Sku>>(
        `/skus${qs({ search, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const createMut = useMutation({
    mutationFn: (body: SkuCreateInput) => api.post<Sku>("/skus", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      setCreateOpen(false);
      setDraft(emptyDraft);
    },
  });

  const favMut = useMutation({
    mutationFn: (s: Sku) =>
      api.patch<Sku>(`/skus/${s.id}`, { favorite: !s.favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skus"] }),
  });

  const scheduleMut = useMutation({
    mutationFn: (vars: {
      sku: Sku;
      type: ScheduleType;
      price: number;
      startDate?: string;
      endDate?: string;
      timeSlots: TimeSlot[];
    }) =>
      api.post("/schedules", {
        skuId: vars.sku.id,
        type: vars.type,
        price: vars.price,
        currentPrice: vars.sku.price,
        startDate: vars.startDate,
        endDate: vars.endDate,
        timeSlots: vars.timeSlots,
        timezone: "America/New_York",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setScheduleFor(null);
    },
  });

  const data = query.data;
  const total = data?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const items = data?.items ?? [];
  const fromN = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toN = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      {/* Top toolbar — search left, action buttons right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div className="input-wrap" style={{ flex: 1, maxWidth: 520 }}>
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
            placeholder="Search by Title, ASIN or SKU…"
            style={{ width: "100%", paddingRight: 60 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setScanOpen(true)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={() => setCreateOpen(true)}
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
          Add SKU
        </button>
      </div>

      {/* Result count row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Showing{" "}
          <strong style={{ color: "var(--text)" }}>
            {fromN}–{toN}
          </strong>{" "}
          of <strong style={{ color: "var(--text)" }}>{num(total)}</strong>
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No SKUs yet"
          message="Add a SKU or connect a marketplace to sync listings."
          action={
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + Add SKU
            </button>
          }
        />
      ) : (
        <>
          <div className="card card-table-wrap" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 75 }}>Favourite</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 62 }}>Image</th>
                  <th>Product details</th>
                  <th style={{ width: 90 }}>Price</th>
                  <th style={{ width: 90 }}>Channel</th>
                  <th style={{ width: 120 }}>Tags</th>
                  <th style={{ width: 120, textAlign: "right" }}>
                    Channel Stock
                  </th>
                  <th style={{ width: 80, textAlign: "right" }}>30d Sales</th>
                  <th style={{ width: 110, textAlign: "center" }}>
                    Update Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "center" }}>
                      <span
                        className={"star" + (s.favorite ? " active" : "")}
                        onClick={() => favMut.mutate(s)}
                        role="button"
                        aria-label="Toggle favorite"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill={s.favorite ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      <ProductImg src={s.imageUrl} className="product-img" />
                    </td>
                    <td>
                      <div style={{ minWidth: 0, maxWidth: 380 }}>
                        <div
                          style={{
                            fontWeight: 550,
                            fontSize: 13,
                            lineHeight: 1.4,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {s.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            marginTop: 4,
                          }}
                        >
                          {s.asin && (
                            <span className="copy-btn">{s.asin}</span>
                          )}
                          <span className="copy-btn">{s.sku}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {money(s.price)}
                      </span>
                      {s.basePrice != null && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--text-3)",
                            marginTop: 2,
                          }}
                        >
                          {money(s.basePrice)}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral">
                        {CHANNEL_LABELS[s.channel]}
                      </span>
                    </td>
                    <td>
                      <Tags tags={s.tags} />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 550,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s.stock > 0 ? (
                        num(s.stock)
                      ) : (
                        <span style={{ color: "var(--text-4)" }}>0</span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s.sales30d > 0 ? (
                        <span
                          style={{
                            color: "var(--success-fg)",
                            fontWeight: 600,
                          }}
                        >
                          {num(s.sales30d)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-4)" }}>0</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        className="btn btn-primary btn-icon btn-sm"
                        title="Update price / Open schedule"
                        onClick={() => setScheduleFor(s)}
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
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              padding: "0 4px",
            }}
          >
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Page {page} of {totalPages}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((p) => Math.min(totalPages, p + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(text) => {
          setSearchInput(text);
        }}
      />

      {/* Add SKU modal */}
      <Modal
        open={createOpen}
        title="Add SKU"
        subtitle="Create a listing manually"
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
              disabled={
                createMut.isPending ||
                !draft.sku.trim() ||
                !draft.title.trim() ||
                !draft.price
              }
              onClick={() => createMut.mutate(draft)}
            >
              {createMut.isPending ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            SKU <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.sku}
            onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Title <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">ASIN</label>
          <input
            className="form-control"
            value={draft.asin ?? ""}
            onChange={(e) => setDraft({ ...draft, asin: e.target.value })}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Channel <span className="req">*</span>
            </label>
            <select
              className="form-control"
              value={draft.channel}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  channel: e.target.value as Sku["channel"],
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
              Status <span className="req">*</span>
            </label>
            <select
              className="form-control"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as Sku["status"],
                })
              }
            >
              {SKU_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Price <span className="req">*</span>
            </label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.price || ""}
              onChange={(e) =>
                setDraft({ ...draft, price: Number(e.target.value) })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Base price</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.basePrice ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  basePrice:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cost</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.cost ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  cost: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Stock</label>
            <input
              className="form-control"
              type="number"
              value={draft.stock ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, stock: Number(e.target.value) })
              }
            />
          </div>
        </div>
        {createMut.isError && (
          <div className="form-help" style={{ color: "var(--danger-fg)" }}>
            Could not create SKU. Check the fields and try again.
          </div>
        )}
      </Modal>

      <ScheduleDrawer
        sku={scheduleFor}
        onClose={() => setScheduleFor(null)}
        busy={scheduleMut.isPending}
        error={scheduleMut.isError}
        onSubmit={(payload) =>
          scheduleFor &&
          scheduleMut.mutate({ sku: scheduleFor, ...payload })
        }
      />
    </div>
  );
}

/* ------------------------- Schedule drawer ------------------------ */

type DrawerTab = "single" | "weekly" | "monthly" | "sale";

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ScheduleDrawer({
  sku,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  sku: Sku | null;
  onClose: () => void;
  onSubmit: (p: {
    type: ScheduleType;
    price: number;
    startDate?: string;
    endDate?: string;
    timeSlots: TimeSlot[];
  }) => void;
  busy: boolean;
  error: boolean;
}) {
  const [tab, setTab] = useState<DrawerTab>("single");

  // Single
  const [singlePrice, setSinglePrice] = useState("");
  const [singleStart, setSingleStart] = useState("");
  const [singleEnd, setSingleEnd] = useState("");

  // Weekly
  const [weekDays, setWeekDays] = useState<number[]>([1, 3, 5]);
  const [weekStartTime, setWeekStartTime] = useState("09:00");
  const [weekEndTime, setWeekEndTime] = useState("17:00");
  const [weekSalePrice, setWeekSalePrice] = useState("");
  const [weekRevertPrice, setWeekRevertPrice] = useState("");

  // Monthly
  const [monthDay, setMonthDay] = useState("15");
  const [monthTime, setMonthTime] = useState("00:00");
  const [monthDuration, setMonthDuration] = useState("24");
  const [monthSalePrice, setMonthSalePrice] = useState("");
  const [monthRevertPrice, setMonthRevertPrice] = useState("");

  // Sale
  const [saleStart, setSaleStart] = useState("");
  const [saleEnd, setSaleEnd] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const lastSku = useRef<string | null>(null);
  useEffect(() => {
    if (sku && sku.id !== lastSku.current) {
      lastSku.current = sku.id;
      setTab("single");
      setSinglePrice("");
      setSingleStart("");
      setSingleEnd("");
      setWeekDays([1, 3, 5]);
      setWeekStartTime("09:00");
      setWeekEndTime("17:00");
      setWeekSalePrice("");
      setWeekRevertPrice(String(sku.price));
      setMonthDay("15");
      setMonthTime("00:00");
      setMonthDuration("24");
      setMonthSalePrice("");
      setMonthRevertPrice(String(sku.price));
      setSaleStart("");
      setSaleEnd("");
      setSalePrice("");
    }
  }, [sku]);

  if (!sku) return null;

  const isoOf = (local: string) =>
    local ? new Date(local).toISOString() : undefined;

  const toggleDay = (d: number) =>
    setWeekDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort(),
    );

  let canSubmit = false;
  if (tab === "single") canSubmit = !!singlePrice && !!singleStart;
  else if (tab === "weekly")
    canSubmit =
      !!weekSalePrice && weekDays.length > 0 && !!weekStartTime && !!weekEndTime;
  else if (tab === "monthly")
    canSubmit = !!monthSalePrice && !!monthDay && !!monthTime;
  else if (tab === "sale") canSubmit = !!salePrice && !!saleStart;

  function submit() {
    if (tab === "single") {
      onSubmit({
        type: "single",
        price: Number(singlePrice),
        startDate: isoOf(singleStart),
        endDate: isoOf(singleEnd),
        timeSlots: [],
      });
      return;
    }
    if (tab === "weekly") {
      const price = Number(weekSalePrice);
      const slots: TimeSlot[] = weekDays.map((day) => ({
        day,
        startTime: weekStartTime,
        endTime: weekEndTime,
        price,
      }));
      onSubmit({ type: "weekly", price, timeSlots: slots });
      return;
    }
    if (tab === "monthly") {
      const price = Number(monthSalePrice);
      const start = monthTime;
      // derive an end time from duration (hours) on the same clock
      const [h, m] = monthTime.split(":").map(Number);
      const endH = (h + Number(monthDuration)) % 24;
      const end = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const slots: TimeSlot[] = [
        {
          day: Number(monthDay),
          startTime: start,
          endTime: end,
          price,
        },
      ];
      onSubmit({ type: "monthly", price, timeSlots: slots });
      return;
    }
    // sale → best-effort single with sale window
    onSubmit({
      type: "single",
      price: Number(salePrice),
      startDate: isoOf(saleStart),
      endDate: isoOf(saleEnd),
      timeSlots: [],
    });
  }

  const discountPct =
    salePrice && sku.price > 0
      ? (((sku.price - Number(salePrice)) / sku.price) * 100).toFixed(1)
      : "—";

  return (
    <>
      <div className="drawer-overlay show" onClick={onClose} />
      <div className="drawer-panel drawer-panel-lg show">
        <div className="drawer-header">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flex: 1,
              minWidth: 0,
            }}
          >
            <ProductImg
              src={sku.imageUrl}
              className="product-img"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.35,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {sku.title}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 5,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    background: "var(--brand-600)",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 5,
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  {money(sku.price)}
                </span>
                <span className="copy-btn">{sku.sku}</span>
                {sku.asin && <span className="copy-btn">{sku.asin}</span>}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          {/* Stat row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: "var(--surface-2)",
                padding: "10px 12px",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                }}
              >
                Channel Stock
              </div>
              <div
                style={{ fontSize: 18, fontWeight: 650, marginTop: 2 }}
              >
                {num(sku.stock)}
              </div>
            </div>
            <div
              style={{
                background: "var(--surface-2)",
                padding: "10px 12px",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                }}
              >
                Channel
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginTop: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span className="badge-dot dot-success" />
                {CHANNEL_LABELS[sku.channel]} · {sku.status}
              </div>
            </div>
          </div>

          {/* Single/Weekly/Monthly/Sale tabs */}
          <div className="tabs-inline" style={{ marginTop: 4 }}>
            <button
              className={tab === "single" ? "active" : ""}
              onClick={() => setTab("single")}
            >
              Single
            </button>
            <button
              className={tab === "weekly" ? "active" : ""}
              onClick={() => setTab("weekly")}
            >
              Weekly
            </button>
            <button
              className={tab === "monthly" ? "active" : ""}
              onClick={() => setTab("monthly")}
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
            <div
              style={{
                background: "var(--surface-2)",
                padding: 14,
                borderRadius: 10,
                marginTop: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 10,
                }}
              >
                Single Price Change
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr 1fr",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-3)",
                    padding: "0 6px",
                  }}
                >
                  Start
                </div>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={singleStart}
                  onChange={(e) => setSingleStart(e.target.value)}
                />
                <input
                  className="form-control"
                  type="number"
                  step="0.01"
                  placeholder="New Price"
                  value={singlePrice}
                  onChange={(e) => setSinglePrice(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr 1fr",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-3)",
                    padding: "0 6px",
                  }}
                >
                  End
                </div>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={singleEnd}
                  onChange={(e) => setSingleEnd(e.target.value)}
                />
                <input
                  className="form-control"
                  disabled
                  value={money(sku.price)}
                />
              </div>
              <div className="form-help">
                The new price applies at the start time and reverts to{" "}
                {money(sku.price)} at the end time.
              </div>
            </div>
          )}

          {tab === "weekly" && (
            <div
              style={{
                background: "var(--surface-2)",
                padding: 14,
                borderRadius: 10,
                marginTop: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  letterSpacing: ".04em",
                }}
              >
                Recurring Weekly
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  marginBottom: 6,
                }}
              >
                Select days of week
              </div>
              <div className="day-picker" style={{ marginBottom: 14 }}>
                {WEEK_DAYS.map((label, idx) => (
                  <div
                    key={label}
                    className={
                      "day-pick" +
                      (weekDays.includes(idx) ? " selected" : "")
                    }
                    onClick={() => toggleDay(idx)}
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start time</label>
                  <input
                    type="time"
                    className="form-control"
                    value={weekStartTime}
                    onChange={(e) => setWeekStartTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End time</label>
                  <input
                    type="time"
                    className="form-control"
                    value={weekEndTime}
                    onChange={(e) => setWeekEndTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Sale Price <span className="req">*</span>
                  </label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    value={weekSalePrice}
                    onChange={(e) => setWeekSalePrice(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Revert Price</label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    value={weekRevertPrice}
                    onChange={(e) => setWeekRevertPrice(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === "monthly" && (
            <div
              style={{
                background: "var(--surface-2)",
                padding: 14,
                borderRadius: 10,
                marginTop: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  letterSpacing: ".04em",
                }}
              >
                Recurring Monthly
              </div>
              <div className="form-group">
                <label className="form-label">Day of month</label>
                <input
                  type="number"
                  className="form-control"
                  min="1"
                  max="31"
                  value={monthDay}
                  onChange={(e) => setMonthDay(e.target.value)}
                />
                <div className="form-help">
                  Will execute on this day every month
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Time</label>
                  <input
                    type="time"
                    className="form-control"
                    value={monthTime}
                    onChange={(e) => setMonthTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Duration (hours)</label>
                  <input
                    className="form-control"
                    type="number"
                    value={monthDuration}
                    onChange={(e) => setMonthDuration(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Sale Price <span className="req">*</span>
                  </label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    value={monthSalePrice}
                    onChange={(e) => setMonthSalePrice(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Revert Price</label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    value={monthRevertPrice}
                    onChange={(e) => setMonthRevertPrice(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === "sale" && (
            <div
              style={{
                background: "var(--surface-2)",
                padding: 14,
                borderRadius: 10,
                marginTop: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  letterSpacing: ".04em",
                }}
              >
                Sale Price (Amazon Deal)
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Sale Start <span className="req">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    className="form-control"
                    value={saleStart}
                    onChange={(e) => setSaleStart(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Sale End</label>
                  <input
                    type="datetime-local"
                    className="form-control"
                    value={saleEnd}
                    onChange={(e) => setSaleEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Sale Price <span className="req">*</span>
                  </label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Regular Price</label>
                  <input
                    className="form-control"
                    disabled
                    value={money(sku.price)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Discount %</label>
                <input
                  className="form-control"
                  disabled
                  value={discountPct === "—" ? "—" : `${discountPct}%`}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              className="form-help"
              style={{ color: "var(--danger-fg)", marginTop: 12 }}
            >
              Could not save the schedule. Check the values and try again.
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !canSubmit}
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
            {busy ? "Saving…" : "Update Price"}
          </button>
        </div>
      </div>
    </>
  );
}
