import "./PricingV2.css";
import { useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { Sku, Paginated } from "@fbm/shared";
import { CHANNEL_LABELS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";

const PAGE_SIZE = 50;

/** Marketplace badge styling, mirroring the redesign's per-channel chips.
 *  Keyed loosely so it survives the channel field being relaxed to `string`
 *  after the NineYard cutover (new channels like "wholesale", "mirakl" land
 *  with a neutral fallback rather than a type error). */
const CHANNEL_ICON: Record<
  string,
  { short: string; bg: string; color: string; border?: boolean }
> = {
  amazon: { short: "a", bg: "#e47911", color: "#fff" },
  walmart: { short: "W", bg: "#ffc220", color: "#0071ce" },
  shopify: { short: "S", bg: "#5d8b2f", color: "#fff" },
  tiktok: { short: "T", bg: "#000", color: "#fff" },
  ebay: { short: "e", bg: "#fff", color: "#0064d2", border: true },
  etsy: { short: "E", bg: "#f1641e", color: "#fff" },
  faire: { short: "F", bg: "#1a1a1a", color: "#fff" },
  wholesale: { short: "W", bg: "#475569", color: "#fff" },
  mirakl: { short: "M", bg: "#0ea5e9", color: "#fff" },
  unknown: { short: "?", bg: "#94a3b8", color: "#fff" },
};

/** Map API tag colors → the redesign's .pv2-tag tone classes. */
const TAG_TONE: Record<string, string> = {
  orange: "tag-reg",
  green: "tag-fbm",
  neutral: "tag-custom",
  blue: "tag-sf",
  purple: "tag-spices",
};

function marginPct(s: Sku): string {
  if (s.basePrice != null && s.cost != null && s.basePrice !== 0) {
    return (((s.basePrice - s.cost) / s.basePrice) * 100).toFixed(1) + "%";
  }
  return "—";
}

function initial(title: string): string {
  return (title.trim()[0] ?? "?").toUpperCase();
}

export function PricingV2() {
  const qc = useQueryClient();
  const [priceFor, setPriceFor] = useState<Sku | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["skus", { pageSize: PAGE_SIZE }],
    queryFn: () =>
      api.get<Paginated<Sku>>(`/skus${qs({ pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const priceMut = useMutation({
    mutationFn: (vars: { id: string; price: number }) =>
      api.patch<Sku>(`/skus/${vars.id}`, { price: vars.price }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      setPriceFor(null);
    },
  });

  const items = query.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.sku.toLowerCase().includes(q) ||
        (s.asin ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const channelCount = useMemo(
    () => new Set(items.map((s) => s.channel)).size,
    [items],
  );

  function toggleCheck(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div id="page-pricing-v2">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            All products, marketplace prices, stock and bundle SKUs in one
            view.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          className="input-wrap"
          style={{ flex: 1, maxWidth: 380 }}
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
            placeholder="Search products..."
            style={{ width: "100%" }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          {selected.size > 0 ? (
            <>
              <strong style={{ color: "var(--text)" }}>
                {num(selected.size)}
              </strong>{" "}
              selected ·{" "}
            </>
          ) : null}
          Showing{" "}
          <strong style={{ color: "var(--text)" }}>
            {num(filtered.length)}
          </strong>{" "}
          products across{" "}
          <strong style={{ color: "var(--text)" }}>
            {num(channelCount)}
          </strong>{" "}
          channels
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No products to price"
          message="Add SKUs or connect a marketplace to start managing prices."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matching products"
          message="Try a different search term."
        />
      ) : (
        <div className="pv2-table">
          {/* Header row */}
          <div className="pv2-header">
            <div />
            <div className="pv2-ph-cell">
              Product Detail and Tags
              <svg
                className="pv2-ph-filter"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
            </div>
            <div
              className="pv2-ph-cell"
              style={{ justifyContent: "center" }}
            >
              Base Price
            </div>
            <div className="pv2-ph-cell">Current Price</div>
            <div className="pv2-ph-cell">Cost</div>
            <div className="pv2-ph-cell">Margin</div>
            <div className="pv2-ph-cell">Stock</div>
            <div className="pv2-ph-cell">Sales 30d</div>
            <div className="pv2-ph-cell">Status</div>
            <div
              className="pv2-ph-cell"
              style={{ justifyContent: "center" }}
            >
              Extra
            </div>
          </div>

          {/* Rows */}
          <div className="pv2-rows">
            {filtered.map((s) => {
              const ch = (CHANNEL_ICON[s.channel] ?? CHANNEL_ICON.unknown);
              const checked = selected.has(s.id);
              const isSelected = selectedRow === s.id;
              return (
                <div
                  key={s.id}
                  className={"pv2-row" + (isSelected ? " selected" : "")}
                  onClick={() => setSelectedRow(s.id)}
                >
                  {/* Checkbox */}
                  <div
                    className={"pv2-check" + (checked ? " checked" : "")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCheck(s.id);
                    }}
                  />

                  {/* Product detail */}
                  <div className="pv2-detail">
                    <div className="pv2-thumb">
                      {s.imageUrl ? (
                        <img src={s.imageUrl} alt="" />
                      ) : (
                        <span>{initial(s.title)}</span>
                      )}
                    </div>
                    <div className="pv2-info">
                      <div className="pv2-name-row">
                        <span
                          className="pv2-name"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRow(s.id);
                          }}
                        >
                          {s.title}
                        </span>
                        {s.tags.map((t, i) => (
                          <span
                            key={i}
                            className={
                              "pv2-tag " +
                              (TAG_TONE[t.color] ?? "tag-custom")
                            }
                          >
                            {t.label}
                          </span>
                        ))}
                      </div>
                      <div className="pv2-meta">
                        {s.asin ? (
                          <a
                            className="pv2-sku-link"
                            href={`https://www.amazon.com/dp/${s.asin}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.sku}
                          </a>
                        ) : (
                          <span className="pv2-sku-link">{s.sku}</span>
                        )}
                        <span className="pv2-meta-chip">
                          <span
                            className="pv2-mp-icon"
                            style={{
                              background: ch.bg,
                              color: ch.color,
                              border: ch.border
                                ? "1px solid var(--border)"
                                : undefined,
                              width: 11,
                              height: 11,
                              fontSize: 7,
                              display: "inline-grid",
                              placeItems: "center",
                              borderRadius: 2,
                              marginRight: 4,
                              verticalAlign: "middle",
                            }}
                          >
                            {ch.short}
                          </span>
                          {((CHANNEL_LABELS as Record<string, string>)[s.channel] ?? s.channel)}
                        </span>
                        <span
                          className={
                            "pv2-meta-chip" +
                            (s.status === "active"
                              ? " fbm"
                              : s.status === "incomplete"
                                ? " shelves"
                                : "")
                          }
                        >
                          {s.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Base price */}
                  <div className="pv2-base">
                    {s.basePrice != null ? (
                      <>
                        <div className="pv2-base-value">
                          {money(s.basePrice)}
                          <svg
                            className="pv2-base-edit"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPriceFor(s);
                            }}
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </div>
                        <div className="pv2-base-label">Base Price</div>
                      </>
                    ) : (
                      <>
                        <div className="pv2-base-empty">—</div>
                        <div
                          className="pv2-base-label"
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPriceFor(s);
                          }}
                        >
                          Set price
                        </div>
                      </>
                    )}
                  </div>

                  {/* Current price */}
                  <div
                    className="pv2-mp-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPriceFor(s);
                    }}
                  >
                    <div className="pv2-mp-head">
                      <span
                        className="mp-icon-sm"
                        style={{
                          background: ch.bg,
                          color: ch.color,
                          border: ch.border
                            ? "1px solid var(--border)"
                            : undefined,
                        }}
                      >
                        {ch.short}
                      </span>
                      {((CHANNEL_LABELS as Record<string, string>)[s.channel] ?? s.channel)}
                    </div>
                    <div className="pv2-mp-price">{money(s.price)}</div>
                    <div className="pv2-mp-stock-row">
                      <span className="stock-label">
                        Stock: {num(s.stock)}
                      </span>
                    </div>
                  </div>

                  {/* Cost */}
                  <div className="pv2-mp-cell">
                    <div className="pv2-mp-head">Cost</div>
                    <div className="pv2-mp-price">{money(s.cost)}</div>
                  </div>

                  {/* Margin */}
                  <div className="pv2-mp-cell">
                    <div className="pv2-mp-head">Margin</div>
                    <div className="pv2-mp-price">{marginPct(s)}</div>
                  </div>

                  {/* Stock */}
                  <div className="pv2-mp-cell">
                    <div className="pv2-mp-head">Stock</div>
                    <div className="pv2-mp-price">{num(s.stock)}</div>
                  </div>

                  {/* Sales 30d */}
                  <div className="pv2-mp-cell">
                    <div className="pv2-mp-head">Sales 30d</div>
                    <div className="pv2-mp-price">{num(s.sales30d)}</div>
                  </div>

                  {/* Status */}
                  <div className="pv2-mp-cell empty">
                    <div
                      className="pv2-mp-head"
                      style={{ justifyContent: "center", width: "100%" }}
                    >
                      {s.favorite ? "★ Fav" : s.status}
                    </div>
                  </div>

                  {/* Extra / set price */}
                  <div
                    className="pv2-mp-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPriceFor(s);
                    }}
                  >
                    <div className="pv2-mp-more-count">$</div>
                    <div className="pv2-mp-more-label">Set price</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SetPriceModal
        sku={priceFor}
        onClose={() => setPriceFor(null)}
        onSubmit={(price) =>
          priceFor && priceMut.mutate({ id: priceFor.id, price })
        }
        busy={priceMut.isPending}
      />
    </div>
  );
}

function SetPriceModal({
  sku,
  onClose,
  onSubmit,
  busy,
}: {
  sku: Sku | null;
  onClose: () => void;
  onSubmit: (price: number) => void;
  busy: boolean;
}) {
  const [price, setPrice] = useState("");

  // Re-seed the input whenever a different SKU opens the modal.
  const seedKey = sku?.id ?? "";
  const [lastKey, setLastKey] = useState("");
  if (sku && seedKey !== lastKey) {
    setLastKey(seedKey);
    setPrice(String(sku.price));
  }

  const value = Number(price);
  const valid = price !== "" && Number.isFinite(value) && value >= 0;

  return (
    <Modal
      open={!!sku}
      title={sku ? `Set price · ${sku.sku}` : ""}
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
            onClick={() => valid && onSubmit(value)}
          >
            {busy ? "Saving…" : "Save price"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Current price {sku ? money(sku.price) : ""} on{" "}
        {sku ? ((CHANNEL_LABELS as Record<string, string>)[sku.channel] ?? sku.channel) : ""}.
      </p>
      <div className="form-group">
        <label className="form-label">New price (USD)</label>
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
    </Modal>
  );
}
