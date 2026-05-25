import "./PriceAlert.css";
import { useEffect, useMemo, useState } from "react";
import amazonIcon from "../assets/marketplaces/amazon.png";
import shopifyIcon from "../assets/marketplaces/shopify.png";
import walmartIcon from "../assets/marketplaces/walmart.png";
import tiktokIcon from "../assets/marketplaces/tiktok.png";
import ebayIcon from "../assets/marketplaces/ebay.png";
import cencoraIcon from "../assets/marketplaces/cencora.png";
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { PriceSchedule } from "@fbm/shared";
import { CHANNEL_LABELS } from "@fbm/shared";
import { api } from "../lib/api";
import { money, num, dateShort, relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge, Tags } from "../components/Badges";
import { Modal } from "../components/Modal";
import { PriceScheduleModal } from "../components/PriceScheduleModal";
import { TagPicker, type LibraryTag } from "../components/TagPicker";

/* ------------------------- Constants ------------------------- */

const CHANNEL_ICON: Record<string, { short: string; cls: string }> = {
  amazon: { short: "a", cls: "ch-amz" },
  walmart: { short: "W", cls: "ch-wal" },
  shopify: { short: "S", cls: "ch-shop" },
  tiktok: { short: "T", cls: "ch-tik" },
  ebay: { short: "e", cls: "ch-eb" },
  etsy: { short: "E", cls: "ch-eb" },
  faire: { short: "F", cls: "ch-eb" },
  wholesale: { short: "W", cls: "ch-shop" },
  mirakl: { short: "M", cls: "ch-wal" },
  unknown: { short: "?", cls: "" },
};

/** Marketplace logo PNGs from the previous app. Imported once and reused
 *  everywhere instead of repeating url() in CSS — keeps the icon source the
 *  single source of truth and lets the bundler hash/cache them. */
const CHANNEL_LOGO: Record<string, string> = {
  amazon: amazonIcon,
  shopify: shopifyIcon,
  walmart: walmartIcon,
  tiktok: tiktokIcon,
  ebay: ebayIcon,
  // Mirakl-operated B2B portals share Cencora's logo as a placeholder until
  // we have per-account graphics.
  mirakl: cencoraIcon,
  wholesale: cencoraIcon,
};

/** Renders a marketplace logo, falling back to the legacy lettered badge for
 *  channels we don't have a PNG for (etsy, faire, unknown). */
function ChannelLogo({
  channel,
  size = 22,
}: {
  channel: string;
  size?: number;
}) {
  const logo = CHANNEL_LOGO[channel];
  if (logo) {
    return (
      <img
        src={logo}
        alt={channel}
        className="pa-channel-logo"
        style={{ width: size, height: size }}
      />
    );
  }
  const meta = CHANNEL_ICON[channel] ?? CHANNEL_ICON.unknown;
  return (
    <span
      className={`channel-icon ${meta.cls}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {meta.short}
    </span>
  );
}

/* ------------------------- Types ----------------------------- */

interface Listing {
  skuId: string;
  sku: string;
  account: string;
  channel: string;
  channelId: string | null;
  asin: string | null;
  price: number;
  basePrice: number | null;
  defaultPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  stock: number;
  reserve: number | null;
  inboundStock: number | null;
  fulfillmentChannel: string | null;
  isActive: boolean;
  status: string;
}

interface GridRow {
  id: string;
  nineyardItemId: number;
  name: string;
  itemName: string;
  imageUrl: string | null;
  brand: string | null;
  totalStock: number;
  qtyOnHand: number;
  inboundStock: number;
  /** Per-warehouse stock map keyed by NineYard warehouse name.
   *  Example: { "Brecx FBM": 45, "Brecx-Shelves": 0 }. */
  warehouseStock: Record<string, number>;
  tags: { label: string; color: string }[];
  listings: Listing[];
}

interface AccountChannel {
  account: string;
  channel: string;
}

interface GridResp {
  items: GridRow[];
  total: number;
  accountChannels: AccountChannel[];
  agg: {
    totalProducts: number;
    issuesCount: number;
    fullyListedCount: number;
    accountChannelCount: number;
  };
}

/* ------------------------- Helpers --------------------------- */

function initial(title: string): string {
  return (title.trim()[0] ?? "?").toUpperCase();
}
function channelLabel(c: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[c] ?? c;
}
function placeholderImg(title: string): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='52' height='52'><rect width='52' height='52' fill='%23e8eaf0'/><text x='50%' y='54%' font-size='22' font-family='sans-serif' fill='%236b7280' text-anchor='middle' dominant-baseline='middle'>${initial(title)}</text></svg>`,
    )
  );
}
function listingHasAlert(l: Listing): boolean {
  if (l.basePrice == null) return false;
  return l.price < l.basePrice;
}
function productHasIssue(p: GridRow): boolean {
  return p.listings.some(listingHasAlert);
}

/** Compact label for an (account, channel) column header. Amazon accounts
 *  end in "US"/"CA" — surface that as a region badge. Other channels show
 *  the account as a smaller subtitle. */
function acctChanLabel({ account, channel }: AccountChannel): {
  primary: string;
  secondary: string;
} {
  const ch = channelLabel(channel);
  if (channel === "amazon") {
    // "FF US" → "US", "FF CA" → "CA"; fall back to full account.
    const region = account.match(/\b(US|CA|MX|UK|EU|AU|JP|IN)\b/)?.[1];
    return region
      ? { primary: `${ch} ${region}`, secondary: account }
      : { primary: ch, secondary: account };
  }
  return { primary: ch, secondary: account };
}

function acctChanKey(ac: AccountChannel): string {
  return `${ac.account}${ac.channel}`;
}

/* ------------------------- Main Page ------------------------- */

export function Pricing() {
  const qc = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [acctChanFilter, setAcctChanFilter] = useState<AccountChannel | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsSkuId, setDetailsSkuId] = useState<string | null>(null);
  const [scheduleSku, setScheduleSku] = useState<{
    id: string;
    sku: string;
    title: string;
    price: number;
    asin?: string | null;
    imageUrl?: string | null;
    channelStock?: number | null;
    fulfillmentChannel?: string | null;
    status?: string | null;
  } | null>(null);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  /** Product whose base prices the user is editing (null = modal closed). */
  const [editBasesFor, setEditBasesFor] = useState<GridRow | null>(null);
  /** Bulk selection — product IDs the user has checked. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change resets to page 1 — otherwise users get a confusing
  // "no rows on this page" state when they narrow the result set below
  // their current page number.
  useEffect(() => {
    setPage(1);
  }, [search, issuesOnly, tagFilter, acctChanFilter, pageSize]);

  const gridQuery = useQuery({
    queryKey: ["pricing", "grid"],
    queryFn: () => api.get<GridResp>("/pricing/grid"),
    placeholderData: keepPreviousData,
  });
  const schedulesQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () =>
      api.get<{ items: PriceSchedule[]; total: number }>("/schedules"),
  });

  // Toggle a SKU's active state — used by the right-panel switch. We use the
  // existing PATCH /skus/:id route since it already validates ownership.
  const setActiveMut = useMutation({
    mutationFn: ({ skuId, isActive }: { skuId: string; isActive: boolean }) =>
      api.patch<{ id: string }>(`/skus/${skuId}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing", "grid"] });
    },
  });

  // Apply or remove a tag across every SKU of a product. The server fans
  // out so we only need one HTTP call per toggle.
  const [tagBusyLabel, setTagBusyLabel] = useState<string | null>(null);
  const productTagMut = useMutation({
    mutationFn: async (vars: {
      nineyardItemId: number;
      tag: LibraryTag;
      apply: boolean;
    }) => {
      setTagBusyLabel(vars.tag.label);
      try {
        if (vars.apply) {
          return await api.post<{ ok: true }>(
            `/pricing/products/${vars.nineyardItemId}/tags`,
            { label: vars.tag.label, color: vars.tag.color },
          );
        }
        return await api.del<{ ok: true }>(
          `/pricing/products/${vars.nineyardItemId}/tags/${encodeURIComponent(
            vars.tag.label,
          )}`,
        );
      } finally {
        setTagBusyLabel(null);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "grid"] }),
  });

  // Bulk base-price update — accepts a per-account map and fans out on the
  // server so the modal only does one round-trip.
  const setBasesMut = useMutation({
    mutationFn: (data: {
      nineyardItemId: number;
      prices: Record<string, number | null>;
    }) => api.post<{ ok: true; touched: number }>("/pricing/base-prices", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing", "grid"] });
      setEditBasesFor(null);
    },
  });

  const products = gridQuery.data?.items ?? [];
  const accountChannels = gridQuery.data?.accountChannels ?? [];
  const schedules = schedulesQuery.data?.items ?? [];

  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      for (const t of p.tags) {
        if (!seen.has(t.label)) seen.set(t.label, t.color);
      }
    }
    return [...seen.entries()].map(([label, color]) => ({ label, color }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (issuesOnly && !productHasIssue(p)) return false;
      if (acctChanFilter) {
        const hit = p.listings.some(
          (l) =>
            l.account === acctChanFilter.account &&
            l.channel === acctChanFilter.channel,
        );
        if (!hit) return false;
      }
      if (tagFilter && !p.tags.some((t) => t.label === tagFilter)) return false;
      if (!q) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.itemName.toLowerCase().includes(q)) return true;
      if (p.brand?.toLowerCase().includes(q)) return true;
      for (const l of p.listings) {
        if (l.sku.toLowerCase().includes(q)) return true;
        if (l.asin?.toLowerCase().includes(q)) return true;
        if (l.channelId?.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [products, search, issuesOnly, acctChanFilter, tagFilter]);

  const selected = useMemo(
    () => filtered.find((p) => p.id === selectedId) ?? null,
    [filtered, selectedId],
  );
  const detailsListing = useMemo<Listing | null>(() => {
    if (!detailsSkuId) return null;
    for (const p of products) {
      const hit = p.listings.find((l) => l.skuId === detailsSkuId);
      if (hit) return hit;
    }
    return null;
  }, [detailsSkuId, products]);
  const detailsProductName = useMemo(() => {
    if (!detailsSkuId) return "";
    for (const p of products) {
      if (p.listings.some((l) => l.skuId === detailsSkuId)) return p.name;
    }
    return "";
  }, [detailsSkuId, products]);

  const isLoading = gridQuery.isLoading;
  const isError = gridQuery.isError;
  const isEmpty = !isLoading && !isError && products.length === 0;

  // Client-side pagination — /pricing/grid returns the full set in one shot
  // (bounded by a workspace's product count, typically <1k), so slicing in
  // React is simpler than a server round-trip per page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );
  const fromN = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toN = Math.min(currentPage * pageSize, filtered.length);

  /* ---------- Bulk selection helpers ---------- */
  const idsOnPage = useMemo(() => pageItems.map((p) => p.id), [pageItems]);
  const selectedOnPage = useMemo(
    () => idsOnPage.filter((id) => selectedIds.has(id)),
    [idsOnPage, selectedIds],
  );
  const allOnPageSelected =
    idsOnPage.length > 0 && selectedOnPage.length === idsOnPage.length;
  const someOnPageSelected =
    selectedOnPage.length > 0 && selectedOnPage.length < idsOnPage.length;
  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const id of idsOnPage) next.delete(id);
      } else {
        for (const id of idsOnPage) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  /** Bulk activate/inactivate — fans out PATCH /skus/:id for every SKU under
   *  each selected product. The product itself doesn't have an `active`
   *  field; toggling at the product level just propagates to every listing.
   */
  async function bulkSetActive(isActive: boolean) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const targetSkuIds: string[] = [];
      for (const p of products) {
        if (!selectedIds.has(p.id)) continue;
        for (const l of p.listings) targetSkuIds.push(l.skuId);
      }
      // Sequential-in-chunks to avoid hammering the API.
      const CHUNK = 8;
      for (let i = 0; i < targetSkuIds.length; i += CHUNK) {
        const chunk = targetSkuIds.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((skuId) =>
            api.patch<{ id: string }>(`/skus/${skuId}`, { isActive }),
          ),
        );
      }
      qc.invalidateQueries({ queryKey: ["pricing", "grid"] });
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  /** Build a CSV from the given product rows. Each row is one listing —
   *  so a product with 8 marketplace SKUs contributes 8 lines. */
  function buildCsv(rows: GridRow[]): string {
    const head = [
      "Product",
      "Master SKU",
      "Brand",
      "Account",
      "Channel",
      "SKU",
      "ASIN",
      "Price",
      "Base Price",
      "Stock",
      "Inbound",
      "Active",
    ];
    const lines: string[] = [head.join(",")];
    function esc(v: unknown): string {
      if (v == null) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }
    for (const p of rows) {
      for (const l of p.listings) {
        lines.push(
          [
            esc(p.name),
            esc(p.itemName),
            esc(p.brand ?? ""),
            esc(l.account),
            esc(l.channel),
            esc(l.sku),
            esc(l.asin ?? ""),
            esc(l.price),
            esc(l.basePrice ?? ""),
            esc(l.stock),
            esc(l.inboundStock ?? 0),
            esc(l.isActive ? "yes" : "no"),
          ].join(","),
        );
      }
    }
    return lines.join("\n");
  }

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportSelected() {
    const rows = products.filter((p) => selectedIds.has(p.id));
    downloadCsv(buildCsv(rows), `pricing-export-${rows.length}.csv`);
  }
  function exportAll() {
    downloadCsv(buildCsv(filtered), `pricing-all-${filtered.length}.csv`);
  }

  /** Compact page-number window: 1 … (curr-2)..(curr+2) … total. */
  function pageWindow(current: number, totalP: number): (number | "…")[] {
    if (totalP <= 7) return Array.from({ length: totalP }, (_, i) => i + 1);
    const out: (number | "…")[] = [1];
    const lo = Math.max(2, current - 2);
    const hi = Math.min(totalP - 1, current + 2);
    if (lo > 2) out.push("…");
    for (let i = lo; i <= hi; i++) out.push(i);
    if (hi < totalP - 1) out.push("…");
    out.push(totalP);
    return out;
  }

  return (
    <div id="page-price-alert">
      {/* Top toolbar */}
      <div className="pa-toolbar">
        <div className="input-wrap pa-search-wrap">
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
            placeholder="Search by SKU / ASIN / Title / Brand…"
            style={{ width: "100%" }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        {/* Tags filter */}
        <div style={{ position: "relative" }}>
          <button
            className={
              "btn btn-secondary btn-sm" + (tagFilter ? " pa-filter-active" : "")
            }
            onClick={() => setTagFilterOpen((v) => !v)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Tags
            {tagFilter && (
              <span className="pa-filter-chip">{tagFilter}</span>
            )}
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {tagFilterOpen && (
            <div className="dropdown-menu show pa-tag-menu">
              {allTags.length === 0 ? (
                <div className="muted" style={{ padding: 8, fontSize: 12 }}>
                  No tags yet.
                </div>
              ) : (
                <>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setTagFilter(null);
                      setTagFilterOpen(false);
                    }}
                  >
                    <span style={{ color: "var(--text-3)" }}>All tags</span>
                  </button>
                  {allTags.map((t) => (
                    <button
                      key={t.label}
                      className="dropdown-item"
                      onClick={() => {
                        setTagFilter(t.label);
                        setTagFilterOpen(false);
                      }}
                    >
                      <span className={`tag tag-${t.color}`}>{t.label}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Issues toggle */}
        <button
          className={
            "btn btn-sm " +
            (issuesOnly ? "btn-primary" : "btn-secondary")
          }
          onClick={() => setIssuesOnly((v) => !v)}
          title="Show only products where any listing is priced below its base price"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Issues only
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text)" }}>{num(filtered.length)}</strong>{" "}
          of <strong style={{ color: "var(--text)" }}>{num(products.length)}</strong>{" "}
          products · {accountChannels.length} channels
        </div>

        {/* Panel toggle — collapse the right side so the wide multi-channel
            table can use the full viewport. */}
        <button
          className="btn btn-secondary btn-sm btn-icon"
          title={panelOpen ? "Hide details panel" : "Show details panel"}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="13 17 18 12 13 7" />
              <polyline points="6 17 11 12 6 7" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          )}
        </button>
      </div>

      {/* Main split — collapses to a single column when the right panel is
          hidden so the wide multi-channel table can use the full viewport. */}
      <div className={"pa-layout" + (panelOpen ? "" : " pa-panel-hidden")}>
        <div className="card pa-table-card">
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <ErrorState />
          ) : isEmpty ? (
            <EmptyState
              title="No NineYard data yet"
              message="Run an inventory sync to populate this page. The Pricing grid is driven by the NineYard /api/Items + /api/Skus feeds; until the first sync finishes there's nothing to render."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No products match the current filter"
              message="Try clearing search or filters."
            />
          ) : (
            <div className="pa-cards">
              {/* Header bar — column labels + per-channel filter chips. Sits
                  outside the card list so cards can use a fluid grid for
                  marketplace cells without needing to align with the header. */}
              {/* Header — uses the SAME 3-column grid as the cards below so
                  channel chips line up over their corresponding mini-cards. */}
              <div className="pa-cards-head">
                <div className="pa-cards-head-left">
                  <label
                    className="pa-cards-head-check"
                    title={
                      allOnPageSelected
                        ? "Deselect all on this page"
                        : "Select all on this page"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected;
                      }}
                      onChange={toggleAllOnPage}
                    />
                  </label>
                  <span className="pa-cards-head-label">
                    Product Detail and Tags
                  </span>
                </div>
                <div className="pa-cards-head-base">
                  <span className="pa-cards-head-label">Base Price</span>
                </div>
                <div className="pa-cards-head-channels">
                  {accountChannels.map((ac) => {
                    const active =
                      acctChanFilter?.account === ac.account &&
                      acctChanFilter?.channel === ac.channel;
                    const lbl = acctChanLabel(ac);
                    return (
                      <button
                        key={acctChanKey(ac)}
                        className={
                          "pa-channel-filter" + (active ? " active" : "")
                        }
                        title={`${lbl.primary} · ${lbl.secondary}`}
                        onClick={() =>
                          setAcctChanFilter((cur) =>
                            cur &&
                            cur.account === ac.account &&
                            cur.channel === ac.channel
                              ? null
                              : ac,
                          )
                        }
                      >
                        <ChannelLogo channel={ac.channel} size={18} />
                        <span className="pa-channel-filter-name">
                          {lbl.primary}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {pageItems.map((p) => {
                const isSelected = selectedId === p.id;
                const baseCandidate = p.listings.find(
                  (l) => l.basePrice != null,
                )?.basePrice;
                return (
                  <div
                    key={p.id}
                    className={"pa-card" + (isSelected ? " pa-selected" : "")}
                    onClick={() => setSelectedId(p.id)}
                  >
                    {/* Left: checkbox + image + name + tags + meta */}
                    <div className="pa-card-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleRow(p.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <img
                        src={p.imageUrl || placeholderImg(p.name)}
                        alt=""
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = placeholderImg(
                            p.name,
                          );
                        }}
                      />
                      <div className="pa-card-info">
                        <div className="pa-card-title">{p.name}</div>
                        <div
                          className="pa-tags-row"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Tags tags={p.tags} />
                          <TagPicker
                            kind="price-alert"
                            applied={p.tags}
                            pendingLabel={tagBusyLabel}
                            onToggle={(tag, applied) =>
                              productTagMut.mutate({
                                nineyardItemId: p.nineyardItemId,
                                tag,
                                apply: applied,
                              })
                            }
                          >
                            {(open) => (
                              <button
                                className="pa-add-tag-btn"
                                title="Add or remove a tag"
                                onClick={open}
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <line x1="12" y1="5" x2="12" y2="19" />
                                  <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                              </button>
                            )}
                          </TagPicker>
                        </div>
                        <div className="pa-card-meta">
                          <span className="copy-btn pa-sku-copy">
                            {p.itemName}
                          </span>
                          {p.brand && (
                            <span className="pa-meta-pill">
                              <span style={{ color: "var(--text-3)" }}>
                                Brand:
                              </span>{" "}
                              <strong>{p.brand}</strong>
                            </span>
                          )}
                          {/* Per-warehouse pills (FBM, Shelves, …) — drop the
                              "Brecx " prefix the company uses on every
                              warehouse so the labels stay readable. Falls back
                              to the aggregate totalStock pill when warehouse
                              data hasn't been synced yet. */}
                          {Object.keys(p.warehouseStock).length > 0 ? (
                            Object.entries(p.warehouseStock).map(
                              ([wh, qty]) => {
                                const label =
                                  wh.replace(/^Brecx[\s-]+/i, "").trim() || wh;
                                return (
                                  <span key={wh} className="pa-meta-pill">
                                    <span style={{ color: "var(--text-3)" }}>
                                      {label}:
                                    </span>{" "}
                                    <strong>{num(qty)}</strong>
                                  </span>
                                );
                              },
                            )
                          ) : (
                            <span className="pa-meta-pill">
                              <span style={{ color: "var(--text-3)" }}>
                                Stock:
                              </span>{" "}
                              <strong>{num(p.totalStock)}</strong>
                            </span>
                          )}
                          <span className="pa-meta-pill">
                            <span style={{ color: "var(--text-3)" }}>
                              SKUs:
                            </span>{" "}
                            <strong>{p.listings.length}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: base price + edit */}
                    <div className="pa-card-base">
                      {baseCandidate != null ? (
                        <div className="pa-base-price-value">
                          {money(baseCandidate)}
                        </div>
                      ) : (
                        <div className="pa-base-price-empty">—</div>
                      )}
                      <div className="pa-base-label">Base Price</div>
                      <button
                        className="pa-base-edit"
                        title="Edit base prices for each account"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditBasesFor(p);
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
                      </button>
                    </div>

                    {/* Right: marketplace mini-cards in a fluid grid (4×2 for 8 channels) */}
                    <div className="pa-card-grid">
                      {accountChannels.map((ac) => {
                        const listing = p.listings.find(
                          (l) =>
                            l.account === ac.account &&
                            l.channel === ac.channel,
                        );
                        if (!listing) {
                          return (
                            <div
                              key={acctChanKey(ac)}
                              className="pa-channel-mini pa-channel-mini-empty"
                            >
                              <div className="pa-channel-mini-head">
                                <ChannelLogo channel={ac.channel} size={18} />
                                <span className="pa-channel-mini-name">
                                  {channelLabel(ac.channel)}
                                </span>
                              </div>
                              <div className="pa-channel-mini-price">
                                <span className="pa-dash">—</span>
                              </div>
                              <div className="pa-channel-mini-stock">
                                Not listed
                              </div>
                            </div>
                          );
                        }
                        const alerting = listingHasAlert(listing);
                        const positive =
                          !alerting &&
                          listing.basePrice != null &&
                          listing.price > listing.basePrice;
                        const inbound = listing.inboundStock ?? 0;
                        return (
                          <div
                            key={acctChanKey(ac)}
                            className="pa-channel-mini pa-channel-mini-click"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailsSkuId(listing.skuId);
                            }}
                          >
                            <div className="pa-channel-mini-head">
                              <ChannelLogo channel={ac.channel} size={18} />
                              <span className="pa-channel-mini-name">
                                {channelLabel(ac.channel)}
                              </span>
                              {alerting && (
                                <span className="pa-channel-alert">ALERT</span>
                              )}
                            </div>
                            <div
                              className={
                                "pa-channel-mini-price" +
                                (alerting
                                  ? " has-alert"
                                  : positive
                                    ? " has-positive"
                                    : "")
                              }
                            >
                              {money(listing.price)}
                            </div>
                            <div className="pa-channel-mini-stockrow">
                              <span className="pa-channel-mini-stock">
                                Stock: {num(listing.stock)}
                              </span>
                              <span
                                className="pa-truck-pill"
                                title="Inbound / in-transit units"
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
                                </svg>
                                {num(inbound)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}


          {/* Pagination footer — only when we actually have rows */}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="pa-pagination">
              <span className="pa-pagination-range">
                {filtered.length === 0
                  ? "0 of 0"
                  : `${num(fromN)}-${num(toN)} of ${num(filtered.length)}`}
              </span>
              <button
                className="pa-page-arrow"
                title="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="pa-pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    className={
                      "pa-page-btn" + (p === currentPage ? " active" : "")
                    }
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                className="pa-page-arrow"
                title="Next page"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setPage((p) => Math.min(totalPages, p + 1))
                }
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <select
                className="pa-pagesize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* RIGHT: per-account marketplace SKU list. Mounted but visibility
            toggles via .pa-panel-hidden on the layout so the table can use
            the full viewport when the user hides it. */}
        <div className="card pa-right-card">
          {!selected ? (
            <div className="pa-right-empty">
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                style={{ color: "var(--text-4)" }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div className="pa-right-empty-title">
                Select a product to see marketplaces
              </div>
              <div className="pa-right-empty-sub">
                Click any row to view its per-account listings.
              </div>
            </div>
          ) : (
            <RightPanel
              product={selected}
              schedules={schedules}
              onOpenDetails={(skuId) => setDetailsSkuId(skuId)}
              onSchedule={(listing) =>
                setScheduleSku({
                  id: listing.skuId,
                  sku: listing.sku,
                  title: selected.name,
                  price: listing.price,
                  asin: listing.asin,
                  imageUrl: selected.imageUrl,
                  channelStock: listing.stock,
                  fulfillmentChannel: listing.fulfillmentChannel,
                  status: listing.status,
                })
              }
              onToggleActive={(skuId, isActive) =>
                setActiveMut.mutate({ skuId, isActive })
              }
              togglePendingId={
                setActiveMut.isPending
                  ? setActiveMut.variables?.skuId ?? null
                  : null
              }
            />
          )}
        </div>
      </div>

      {detailsListing && (
        <MarketplaceDetailsModal
          listing={detailsListing}
          productName={detailsProductName}
          schedules={schedules.filter((s) => s.skuId === detailsListing.skuId)}
          onClose={() => setDetailsSkuId(null)}
        />
      )}

      {editBasesFor && (
        <EditBasePricesModal
          product={editBasesFor}
          accountChannels={accountChannels}
          onClose={() => setEditBasesFor(null)}
          onSubmit={(prices) =>
            setBasesMut.mutate({
              nineyardItemId: editBasesFor.nineyardItemId,
              prices,
            })
          }
          busy={setBasesMut.isPending}
        />
      )}

      <PriceScheduleModal
        open={!!scheduleSku}
        sku={scheduleSku}
        onClose={() => {
          setScheduleSku(null);
          qc.invalidateQueries({ queryKey: ["schedules"] });
        }}
      />

      {/* Floating bulk-action bar — reuses the SKUs page pattern. Slides up
          when at least one product is selected via the row checkboxes. */}
      <div className={"bulk-bar" + (selectedIds.size > 0 ? " show" : "")}>
        <div className="bulk-bar-count">
          <strong>{selectedIds.size}</strong>
          <span>selected</span>
        </div>
        <div className="bulk-bar-actions">
          <button
            type="button"
            title="Export selected products (.csv)"
            onClick={exportSelected}
            disabled={bulkBusy}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export
          </button>
          <button
            type="button"
            title="Export every product matching the current filter (.csv)"
            onClick={exportAll}
            disabled={bulkBusy}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export all
          </button>
          <div className="bulk-bar-divider" />
          <button
            type="button"
            className="primary"
            title="Activate every SKU under the selected products"
            onClick={() => bulkSetActive(true)}
            disabled={bulkBusy}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {bulkBusy ? "Working…" : "Activate"}
          </button>
          <button
            type="button"
            title="Inactivate every SKU under the selected products"
            onClick={() => bulkSetActive(false)}
            disabled={bulkBusy}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            Inactivate
          </button>
          <div className="bulk-bar-divider" />
          <button
            type="button"
            className="close-btn"
            title="Clear selection"
            onClick={clearSelection}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- Right Panel ------------------------- */

function RightPanel({
  product,
  schedules,
  onOpenDetails,
  onToggleActive,
  togglePendingId,
}: {
  product: GridRow;
  schedules: PriceSchedule[];
  onOpenDetails: (skuId: string) => void;
  /** Reserved for the row-level "Schedule" affordance — currently the
   *  details modal hosts scheduling, but we keep the prop wired so we can
   *  surface it without a parent contract change. */
  onSchedule?: (l: Listing) => void;
  onToggleActive: (skuId: string, isActive: boolean) => void;
  togglePendingId: string | null;
}) {
  const [tab, setTab] = useState<"marketplace" | "history">("marketplace");

  const scheduledSkuIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of schedules) {
      if (s.status === "scheduled" || s.status === "running") {
        ids.add(s.skuId);
      }
    }
    return ids;
  }, [schedules]);
  const productSchedules = useMemo(() => {
    const set = new Set(product.listings.map((l) => l.skuId));
    return schedules.filter((s) => set.has(s.skuId));
  }, [product.listings, schedules]);

  // Group listings by account so the panel mirrors the reference page's
  // "FF US / FRESH FINEST LLC / Cencora / Sysco" sectioning.
  const byAccount = useMemo(() => {
    const m = new Map<string, Listing[]>();
    for (const l of product.listings) {
      const arr = m.get(l.account) ?? [];
      arr.push(l);
      m.set(l.account, arr);
    }
    return m;
  }, [product.listings]);

  return (
    <div className="pa-right-content">
      <div className="pa-right-head">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="pa-right-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="pa-right-img pa-right-img-fallback">
            {initial(product.name)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pa-right-eyebrow">Product</div>
          <div className="pa-right-title">{product.name}</div>
          <div className="pa-right-sub">
            <span className="copy-btn">{product.itemName}</span>
            {product.brand && (
              <span className="pa-meta-pill">{product.brand}</span>
            )}
          </div>
        </div>
      </div>

      <div className="pa-right-tabs">
        <button
          className={tab === "marketplace" ? "active" : undefined}
          onClick={() => setTab("marketplace")}
        >
          Marketplace SKU
        </button>
        <button
          className={tab === "history" ? "active" : undefined}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      <div className="pa-right-body">
        {tab === "marketplace" ? (
          product.listings.length === 0 ? (
            <div className="muted pa-right-empty-inline">
              No marketplace listings linked to this product.
            </div>
          ) : (
            <div className="pa-right-groups">
              {[...byAccount.entries()].map(([account, list]) => {
                // Per-account base price: take any non-null basePrice across the
                // account's listings. They should be in sync once the user has
                // used the "Edit base prices" modal, but we fall back to the
                // first defined one for the pre-edit state.
                const accountBase =
                  list.find((l) => l.basePrice != null)?.basePrice ?? null;
                // Delta = best (max) current price across the account vs base.
                // Positive = "we're listed above target", negative = "alert".
                const maxPrice = list.length
                  ? Math.max(...list.map((l) => l.price))
                  : 0;
                const delta =
                  accountBase != null ? maxPrice - accountBase : null;
                const deltaPct =
                  accountBase != null && accountBase > 0
                    ? (delta! / accountBase) * 100
                    : null;
                const deltaClass =
                  delta == null
                    ? "pa-delta-neutral"
                    : delta > 0
                      ? "pa-delta-pos"
                      : delta < 0
                        ? "pa-delta-neg"
                        : "pa-delta-neutral";
                return (
                  <div key={account} className="pa-right-group">
                    <div className="pa-right-group-head">
                      <ChannelLogo
                        channel={list[0]?.channel ?? "unknown"}
                        size={18}
                      />
                      <span className="pa-right-group-name">{account}</span>
                      <div className="pa-right-group-base">
                        <span style={{ color: "var(--text-3)" }}>
                          Base Price :
                        </span>{" "}
                        <strong>
                          {accountBase != null ? money(accountBase) : "—"}
                        </strong>
                      </div>
                      <span className={`pa-delta-chip ${deltaClass}`}>
                        {delta == null
                          ? "—"
                          : `${delta >= 0 ? "+" : ""}${money(delta)} (${
                              deltaPct == null
                                ? ""
                                : (deltaPct >= 0 ? "+" : "") +
                                  deltaPct.toFixed(0) +
                                  "%"
                            })`}
                      </span>
                    </div>
                    {list.map((l) => {
                      const isPending = togglePendingId === l.skuId;
                      return (
                        <div
                          key={l.skuId}
                          className={
                            "pa-right-row" +
                            (l.isActive ? "" : " pa-right-row-inactive")
                          }
                        >
                          <button
                            className={
                              "pa-toggle" + (l.isActive ? " on" : "")
                            }
                            disabled={isPending}
                            onClick={() =>
                              onToggleActive(l.skuId, !l.isActive)
                            }
                            title={
                              l.isActive ? "Set inactive" : "Set active"
                            }
                            aria-pressed={l.isActive}
                          >
                            <span className="pa-toggle-knob" />
                          </button>
                          <ChannelLogo channel={l.channel} size={18} />
                          <div className="pa-right-row-main">
                            <div className="pa-right-row-sku">
                              {l.sku}
                              {scheduledSkuIds.has(l.skuId) && (
                                <span
                                  className="pa-right-sched-dot"
                                  title="Has a scheduled price change"
                                />
                              )}
                            </div>
                            <div className="pa-right-row-meta">
                              <span>Stock {num(l.stock)}</span>
                              {l.defaultPrice != null && l.defaultPrice > 0 && (
                                <span>· Default {money(l.defaultPrice)}</span>
                              )}
                            </div>
                          </div>
                          <div className="pa-right-row-price">
                            {money(l.price)}
                          </div>
                          <button
                            className="btn btn-primary btn-xs"
                            onClick={() => onOpenDetails(l.skuId)}
                          >
                            Details
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )
        ) : productSchedules.length === 0 ? (
          <div className="muted pa-right-empty-inline">
            No price schedules recorded for this product.
          </div>
        ) : (
          <div className="pa-right-history">
            {productSchedules
              .slice()
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .map((sch) => (
                <div key={sch.id} className="pa-right-history-row">
                  <div className="pa-right-history-head">
                    <StatusBadge status={sch.status} />
                    <span style={{ fontWeight: 650, marginLeft: "auto" }}>
                      {money(sch.price)}
                    </span>
                  </div>
                  <div className="pa-right-history-meta">
                    <span className="copy-btn" style={{ fontSize: 11 }}>
                      {sch.sku}
                    </span>
                    <span>· {sch.type}</span>
                    <span style={{ marginLeft: "auto" }}>
                      {relativeTime(sch.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------- Details Modal ------------------------- */

function MarketplaceDetailsModal({
  listing,
  productName,
  schedules,
  onClose,
}: {
  listing: Listing;
  productName: string;
  schedules: PriceSchedule[];
  onClose: () => void;
}) {
  const points = useMemo<{ t: number; price: number; label: string }[]>(() => {
    const pts: { t: number; price: number; label: string }[] = [];
    for (const sch of schedules) {
      if (sch.status === "running" || sch.status === "reverted") {
        const t = sch.startDate
          ? new Date(sch.startDate).getTime()
          : new Date(sch.createdAt).getTime();
        if (Number.isFinite(t)) {
          pts.push({ t, price: sch.price, label: dateShort(sch.startDate) });
        }
      }
    }
    pts.push({ t: Date.now(), price: listing.price, label: "Now" });
    pts.sort((a, b) => a.t - b.t);
    const filtered: typeof pts = [];
    for (const p of pts) {
      const last = filtered[filtered.length - 1];
      if (!last || last.price !== p.price || last.label !== p.label) {
        filtered.push(p);
      }
    }
    return filtered;
  }, [listing, schedules]);

  const low = points.length ? Math.min(...points.map((p) => p.price)) : 0;
  const high = points.length ? Math.max(...points.map((p) => p.price)) : 0;
  const change =
    points.length >= 2 ? points[points.length - 1].price - points[0].price : 0;

  return (
    <Modal
      open={true}
      title={`Marketplace Details · ${listing.sku}`}
      subtitle={productName}
      size="xl"
      onClose={onClose}
    >
      <div className="pa-details">
        <div className="pa-details-head">
          <div className="pa-details-head-col">
            <div className="pa-details-label">SKU</div>
            <div className="pa-details-value mono">{listing.sku}</div>
            <div className="pa-details-label" style={{ marginTop: 10 }}>
              Current Price
            </div>
            <div className="pa-details-value pa-details-price">
              {money(listing.price)}
            </div>
          </div>
          <div className="pa-details-head-col">
            <div className="pa-details-label">Channel</div>
            <div className="pa-details-value">
              {channelLabel(listing.channel)}
            </div>
            <div className="pa-details-label" style={{ marginTop: 10 }}>
              Fulfillment
            </div>
            <div className="pa-details-value">
              {listing.fulfillmentChannel === "DEFAULT"
                ? "FBM"
                : listing.fulfillmentChannel
                  ? "FBA"
                  : "—"}
            </div>
          </div>
          <div className="pa-details-head-col">
            <div className="pa-details-label">Account</div>
            <div className="pa-details-value">{listing.account}</div>
            <div className="pa-details-label" style={{ marginTop: 10 }}>
              Stock
            </div>
            <div className="pa-details-value">{num(listing.stock)}</div>
          </div>
        </div>

        <div className="pa-stat-cards">
          <div className="pa-stat-card pa-stat-blue">
            <div className="pa-stat-value">{money(listing.price)}</div>
            <div className="pa-stat-label">Current Price</div>
            <div className="pa-stat-sub">Live marketplace price</div>
          </div>
          <div className="pa-stat-card pa-stat-green">
            <div className="pa-stat-value">{money(low)}</div>
            <div className="pa-stat-label">Period Low</div>
            <div className="pa-stat-sub">
              {points.length > 0 ? "Lowest across history" : "No history"}
            </div>
          </div>
          <div className="pa-stat-card pa-stat-purple">
            <div className="pa-stat-value">{money(high)}</div>
            <div className="pa-stat-label">Period High</div>
            <div className="pa-stat-sub">
              {points.length > 0 ? "Highest across history" : "No history"}
            </div>
          </div>
          <div
            className={
              "pa-stat-card " +
              (change > 0
                ? "pa-stat-up"
                : change < 0
                  ? "pa-stat-down"
                  : "pa-stat-neutral")
            }
          >
            <div className="pa-stat-value">
              {change === 0 ? "—" : (change > 0 ? "+" : "") + money(change)}
            </div>
            <div className="pa-stat-label">Net Change</div>
            <div className="pa-stat-sub">
              {points.length > 0
                ? `Last: ${relativeTime(
                    new Date(points[points.length - 1].t).toISOString(),
                  )}`
                : "—"}
            </div>
          </div>
        </div>

        {/* Pricing window */}
        <div className="pa-pricing-window">
          <div className="pa-pw-cell">
            <div className="pa-details-label">Min Price</div>
            <div className="pa-details-value">
              {listing.minPrice != null ? money(listing.minPrice) : "—"}
            </div>
          </div>
          <div className="pa-pw-cell">
            <div className="pa-details-label">Default Price</div>
            <div className="pa-details-value">
              {listing.defaultPrice != null ? money(listing.defaultPrice) : "—"}
            </div>
          </div>
          <div className="pa-pw-cell">
            <div className="pa-details-label">Max Price</div>
            <div className="pa-details-value">
              {listing.maxPrice != null ? money(listing.maxPrice) : "—"}
            </div>
          </div>
          <div className="pa-pw-cell">
            <div className="pa-details-label">Base Price</div>
            <div className="pa-details-value">
              {listing.basePrice != null ? money(listing.basePrice) : "—"}
            </div>
          </div>
        </div>

        <div className="pa-chart-wrap">
          <div className="pa-chart-title">Price History</div>
          <PriceHistoryChart points={points} />
        </div>
      </div>
    </Modal>
  );
}

/* --------------------- SVG line chart ------------------------ */

function PriceHistoryChart({
  points,
}: {
  points: { t: number; price: number; label: string }[];
}) {
  if (points.length === 0) {
    return (
      <div className="pa-chart-empty">
        No applied price changes recorded yet — chart will populate once a
        schedule runs.
      </div>
    );
  }
  const W = 720;
  const H = 240;
  const padX = 50;
  const padY = 30;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const minP = Math.min(...points.map((p) => p.price));
  const maxP = Math.max(...points.map((p) => p.price));
  const range = Math.max(maxP - minP, 0.01);
  const lo = minP - range * 0.1;
  const hi = maxP + range * 0.1;

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const tRange = Math.max(maxT - minT, 1);

  const x = (t: number) =>
    points.length === 1 ? W / 2 : padX + ((t - minT) / tRange) * innerW;
  const y = (p: number) =>
    padY + innerH - ((p - lo) / (hi - lo)) * innerH;

  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`,
    )
    .join(" ");

  const yTicks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="pa-chart-svg"
    >
      {yTicks.map((v, i) => {
        const yy = padY + innerH - (i / 4) * innerH;
        return (
          <g key={i}>
            <line
              x1={padX}
              y1={yy}
              x2={W - padX}
              y2={yy}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? undefined : "3 3"}
            />
            <text
              x={padX - 6}
              y={yy + 3}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-3)"
            >
              {money(v)}
            </text>
          </g>
        );
      })}
      {points.length > 1 && (
        <path
          d={path}
          fill="none"
          stroke="var(--brand-600)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={x(p.t)}
            cy={y(p.price)}
            r={4}
            fill="var(--brand-600)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
          <text
            x={x(p.t)}
            y={H - padY + 16}
            textAnchor="middle"
            fontSize="10.5"
            fill="var(--text-3)"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------- Edit base prices modal ---------------- */

function EditBasePricesModal({
  product,
  accountChannels,
  onClose,
  onSubmit,
  busy,
}: {
  product: GridRow;
  accountChannels: AccountChannel[];
  onClose: () => void;
  onSubmit: (prices: Record<string, number | null>) => void;
  busy: boolean;
}) {
  // Distinct accounts this product is listed under. We seed each input from
  // any existing base_price on the product's listings — typing in any field
  // overrides on submit, blank fields clear that account's base.
  const accounts = useMemo(() => {
    const set = new Set<string>(accountChannels.map((a) => a.account));
    return [...set].sort();
  }, [accountChannels]);

  const initial = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const acct of accounts) {
      const existing = product.listings.find(
        (l) => l.account === acct && l.basePrice != null,
      )?.basePrice;
      m[acct] = existing != null ? existing.toString() : "";
    }
    return m;
  }, [accounts, product.listings]);

  const [values, setValues] = useState<Record<string, string>>(initial);

  function submit() {
    const out: Record<string, number | null> = {};
    for (const [acct, str] of Object.entries(values)) {
      if (str === "") {
        out[acct] = null;
      } else {
        const n = Number(str);
        if (Number.isFinite(n) && n >= 0) out[acct] = n;
      }
    }
    onSubmit(out);
  }

  return (
    <Modal
      open={true}
      title="Edit base prices"
      subtitle={product.name}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save base prices"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        Each account's base price applies to every marketplace SKU listed
        under that account for this product. Leave a field blank to clear
        that account's base.
      </p>
      <div className="pa-base-edit-grid">
        {accounts.map((acct) => (
          <div key={acct} className="pa-base-edit-row">
            <label>{acct}</label>
            <div className="pa-base-edit-input">
              <span className="pa-base-edit-prefix">$</span>
              <input
                className="form-control"
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter price…"
                value={values[acct] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [acct]: e.target.value }))
                }
              />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
