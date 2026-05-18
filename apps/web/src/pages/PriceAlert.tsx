import "./PriceAlert.css";
import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { Sku, PriceSchedule } from "@fbm/shared";
import { CHANNEL_LABELS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num, dateShort } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge, Tags } from "../components/Badges";
import { Modal } from "../components/Modal";

const PAGE_SIZE = 20;

interface SkuList {
  items: Sku[];
  total: number;
  page: number;
  pageSize: number;
}

interface ScheduleList {
  items: PriceSchedule[];
  total: number;
}

/** Per-channel mini-card icon, mirroring the redesign's .channel-icon chips. */
const CHANNEL_ICON: Record<string, { short: string; cls: string }> = {
  amazon: { short: "a", cls: "ch-amz" },
  walmart: { short: "W", cls: "ch-wal" },
  shopify: { short: "S", cls: "ch-shop" },
  tiktok: { short: "T", cls: "ch-tik" },
  ebay: { short: "e", cls: "ch-eb" },
  etsy: { short: "E", cls: "ch-eb" },
  faire: { short: "F", cls: "ch-eb" },
};

function initial(title: string): string {
  return (title.trim()[0] ?? "?").toUpperCase();
}

/** Convert a datetime-local value (no tz) → ISO, or undefined if blank. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function PriceAlert() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Sku | null>(null);

  // Debounce the search box (resets to page 1 on a new term).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const skuQuery = useQuery({
    queryKey: ["skus", { search, page, pageSize: PAGE_SIZE }],
    queryFn: () =>
      api.get<SkuList>(`/skus${qs({ search, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const schedQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<ScheduleList>("/schedules"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const createMut = useMutation({
    mutationFn: (body: {
      skuId: string;
      type: "single";
      price: number;
      currentPrice: number;
      startDate?: string;
      endDate?: string;
      timeSlots: never[];
      timezone: string;
    }) => api.post<PriceSchedule>("/schedules", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setScheduleFor(null);
    },
  });

  const data = skuQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selected = useMemo(
    () => items.find((s) => s.id === selectedId) ?? null,
    [items, selectedId],
  );

  const schedulesForSelected = useMemo(() => {
    if (!selected) return [];
    return (schedQuery.data?.items ?? []).filter(
      (s) => s.skuId === selected.id,
    );
  }, [schedQuery.data, selected]);

  return (
    <div id="page-price-alert">
      {/* Top toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          className="input-wrap"
          style={{ flex: 1, maxWidth: 520 }}
        >
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
            placeholder="Search by SKU / ASIN / Title..."
            style={{ width: "100%" }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text)" }}>{num(total)}</strong>{" "}
          products
        </div>
      </div>

      {/* Main split: table + right details panel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* LEFT: Table */}
        <div
          className="card"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {skuQuery.isLoading ? (
            <Loading />
          ) : skuQuery.isError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title={
                search ? `No products match "${search}"` : "No products"
              }
              message={
                search
                  ? "Try a different search term."
                  : "Connect a marketplace or add SKUs to start managing prices."
              }
            />
          ) : (
            <table className="pa-table">
              <thead>
                <tr>
                  <th style={{ width: 38 }}>
                    <input type="checkbox" disabled />
                  </th>
                  <th>
                    <div className="pa-th-inner">
                      <span>Product Detail and Tags</span>
                    </div>
                  </th>
                  <th style={{ width: 100 }}>
                    <div className="pa-th-inner">
                      <span>Base Price</span>
                    </div>
                  </th>
                  <th style={{ width: 200 }}>
                    <div className="pa-th-inner">
                      <span>Channel Price</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const isSelected = selectedId === s.id;
                  const meta = CHANNEL_ICON[s.channel] ?? {
                    short: "?",
                    cls: "",
                  };
                  const hasAlert =
                    s.basePrice != null && s.price < s.basePrice;
                  return (
                    <tr
                      key={s.id}
                      className={isSelected ? "pa-selected" : ""}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <td
                        onClick={(e) => e.stopPropagation()}
                        style={{ verticalAlign: "middle" }}
                      >
                        <input type="checkbox" />
                      </td>
                      <td>
                        <div className="pa-product-cell">
                          {s.imageUrl ? (
                            <img src={s.imageUrl} alt="" />
                          ) : (
                            <img
                              src={
                                "data:image/svg+xml;utf8," +
                                encodeURIComponent(
                                  `<svg xmlns='http://www.w3.org/2000/svg' width='52' height='52'><rect width='52' height='52' fill='%23e8eaf0'/><text x='50%' y='54%' font-size='22' font-family='sans-serif' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>${initial(
                                    s.title,
                                  )}</text></svg>`,
                                )
                              }
                              alt=""
                            />
                          )}
                          <div className="pa-product-info">
                            <div className="pa-product-title-row">
                              <span className="pa-product-title">
                                {s.title}
                              </span>
                            </div>
                            <div className="pa-tags-row">
                              <Tags tags={s.tags} />
                              <button
                                className="pa-add-tag-btn"
                                title="Add tag"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <line
                                    x1="12"
                                    y1="5"
                                    x2="12"
                                    y2="19"
                                  />
                                  <line
                                    x1="5"
                                    y1="12"
                                    x2="19"
                                    y2="12"
                                  />
                                </svg>
                              </button>
                            </div>
                            <div className="pa-product-meta">
                              <span className="copy-btn pa-sku-copy">
                                {s.sku}
                              </span>
                              {s.asin && (
                                <span className="pa-meta-pill">
                                  <span
                                    style={{ color: "var(--text-3)" }}
                                  >
                                    ASIN:
                                  </span>{" "}
                                  <strong>{s.asin}</strong>
                                </span>
                              )}
                              <span className="pa-meta-pill">
                                <span style={{ color: "var(--text-3)" }}>
                                  Channel:
                                </span>{" "}
                                <strong>
                                  {CHANNEL_LABELS[s.channel] ??
                                    s.channel}
                                </strong>
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="pa-base-cell">
                        {s.basePrice != null ? (
                          <div className="pa-base-price-value">
                            {money(s.basePrice)}
                          </div>
                        ) : (
                          <div className="pa-base-price-empty">—</div>
                        )}
                        <div className="pa-base-label">Base Price</div>
                        <div
                          className="pa-base-edit"
                          title="Schedule price"
                          onClick={(e) => {
                            e.stopPropagation();
                            setScheduleFor(s);
                          }}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                          Edit
                        </div>
                      </td>
                      <td className="pa-channel-cell">
                        <div className="pa-channel-mini">
                          <div className="pa-channel-mini-head">
                            <span
                              className={`channel-icon ${meta.cls}`}
                            >
                              {meta.short}
                            </span>
                            <span className="pa-channel-mini-name">
                              {CHANNEL_LABELS[s.channel] ?? s.channel}
                            </span>
                            {hasAlert && (
                              <span className="pa-channel-alert">
                                ALERT
                              </span>
                            )}
                          </div>
                          <div
                            className={
                              "pa-channel-mini-price" +
                              (hasAlert ? " has-alert" : "")
                            }
                          >
                            {money(s.price)}
                          </div>
                          <div className="pa-channel-mini-stock">
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                            Stock: {num(s.stock)}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT: Details panel */}
        <div
          className="card"
          style={{
            padding: 0,
            position: "sticky",
            top: 78,
            maxHeight: "calc(100vh - 100px)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {!selected ? (
            <div style={{ padding: "80px 20px", textAlign: "center" }}>
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                style={{
                  margin: "0 auto 10px",
                  color: "var(--text-4)",
                }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "var(--text-2)",
                }}
              >
                Select a product to see details
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-3)",
                  marginTop: 4,
                  maxWidth: 240,
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                Click any row to view channel pricing and price schedules.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: 10,
                  }}
                >
                  {selected.imageUrl ? (
                    <img
                      src={selected.imageUrl}
                      className="product-img"
                      alt=""
                    />
                  ) : (
                    <div
                      className="product-img"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        background: "var(--surface-2)",
                        fontWeight: 700,
                        color: "var(--text-3)",
                      }}
                    >
                      {initial(selected.title)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                      }}
                    >
                      Product Details
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 650,
                        marginTop: 3,
                        lineHeight: 1.35,
                      }}
                    >
                      {selected.title}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 5,
                        alignItems: "center",
                      }}
                    >
                      <span className="copy-btn">{selected.sku}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Body (scrollable) */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "14px 18px" }}>
                  {/* Channel summary */}
                  <div style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                        }}
                      >
                        <span
                          className={`channel-icon ${
                            (CHANNEL_ICON[selected.channel] ?? { cls: "" })
                              .cls
                          }`}
                          style={{ width: 20, height: 20 }}
                        >
                          {
                            (
                              CHANNEL_ICON[selected.channel] ?? {
                                short: "?",
                              }
                            ).short
                          }
                        </span>
                        <span
                          style={{ fontWeight: 650, fontSize: 13 }}
                        >
                          {CHANNEL_LABELS[selected.channel] ??
                            selected.channel}
                        </span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-3)",
                          }}
                        >
                          Base{" "}
                          {selected.basePrice != null
                            ? money(selected.basePrice)
                            : "—"}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {money(selected.price)}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        fontSize: 11.5,
                        color: "var(--text-3)",
                      }}
                    >
                      <span className="pa-meta-pill">
                        Stock: <strong>{num(selected.stock)}</strong>
                      </span>
                      <span className="pa-meta-pill">
                        Sales 30d:{" "}
                        <strong>{num(selected.sales30d)}</strong>
                      </span>
                      <span className="pa-meta-pill">
                        Cost:{" "}
                        <strong>
                          {selected.cost != null
                            ? money(selected.cost)
                            : "—"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Schedules */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 650, fontSize: 13 }}>
                      Price Schedules
                    </div>
                    <button
                      className="btn btn-primary btn-xs"
                      onClick={() => setScheduleFor(selected)}
                    >
                      Schedule price
                    </button>
                  </div>

                  {schedQuery.isLoading ? (
                    <Loading />
                  ) : schedQuery.isError ? (
                    <ErrorState />
                  ) : schedulesForSelected.length === 0 ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--text-3)",
                        padding: "16px 0",
                        textAlign: "center",
                      }}
                    >
                      No schedules for this SKU yet.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {schedulesForSelected.map((sch) => (
                        <div
                          key={sch.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "10px 12px",
                            background: "var(--surface)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: "var(--text-2)",
                                textTransform: "capitalize",
                              }}
                            >
                              {sch.type}
                            </span>
                            <StatusBadge status={sch.status} />
                            <span
                              style={{
                                marginLeft: "auto",
                                fontWeight: 700,
                                fontSize: 13,
                              }}
                            >
                              {money(sch.price)}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 11.5,
                              color: "var(--text-3)",
                            }}
                          >
                            <span>
                              {dateShort(sch.startDate)} →{" "}
                              {dateShort(sch.endDate)}
                            </span>
                            <button
                              className="btn btn-secondary btn-xs"
                              disabled={delMut.isPending}
                              onClick={() => delMut.mutate(sch.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
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
          Page{" "}
          <strong style={{ color: "var(--text)" }}>{page}</strong> of{" "}
          <strong style={{ color: "var(--text)" }}>{totalPages}</strong>{" "}
          · <strong style={{ color: "var(--text)" }}>{num(total)}</strong>{" "}
          products
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

      <ScheduleModal
        sku={scheduleFor}
        onClose={() => setScheduleFor(null)}
        busy={createMut.isPending}
        onSubmit={(price, start, end) => {
          if (!scheduleFor) return;
          createMut.mutate({
            skuId: scheduleFor.id,
            type: "single",
            price,
            currentPrice: scheduleFor.price,
            startDate: toIso(start),
            endDate: toIso(end),
            timeSlots: [],
            timezone: "America/New_York",
          });
        }}
      />
    </div>
  );
}

function ScheduleModal({
  sku,
  onClose,
  onSubmit,
  busy,
}: {
  sku: Sku | null;
  onClose: () => void;
  onSubmit: (price: number, start: string, end: string) => void;
  busy: boolean;
}) {
  const [price, setPrice] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Re-seed when a different SKU opens the modal.
  const seedKey = sku?.id ?? "";
  const [lastKey, setLastKey] = useState("");
  if (sku && seedKey !== lastKey) {
    setLastKey(seedKey);
    setPrice(String(sku.price));
    setStart("");
    setEnd("");
  }

  const value = Number(price);
  const valid = price !== "" && Number.isFinite(value) && value > 0;

  return (
    <Modal
      open={!!sku}
      title={sku ? `Schedule price · ${sku.sku}` : ""}
      subtitle={sku?.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !valid}
            onClick={() => valid && onSubmit(value, start, end)}
          >
            {busy ? "Scheduling…" : "Create schedule"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Current price {sku ? money(sku.price) : ""} on{" "}
        {sku ? CHANNEL_LABELS[sku.channel] ?? sku.channel : ""}. Creates a
        one-time (single) price schedule.
      </p>
      <div className="form-group">
        <label className="form-label">Scheduled price (USD)</label>
        <input
          className="form-control"
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          autoFocus
        />
      </div>
      <div className="form-group">
        <label className="form-label">Start (optional)</label>
        <input
          className="form-control"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">End (optional)</label>
        <input
          className="form-control"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
    </Modal>
  );
}
