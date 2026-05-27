import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type LostBuyboxRun,
  type LostBuyboxRow,
  type IgnoredAsin,
  matchesBuyboxSpecial,
} from "@fbm/shared";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import "./LostBuyBox.css";
import "./Inventory.css";

interface ScanProgress {
  phase: "report" | "pricing" | "retry" | "analyze";
  message: string;
  processed?: number;
  total?: number;
}

const REASON_LABEL: Record<string, string> = {
  other_seller_winning: "Lost to seller",
  no_featured_offer: "No featured offer",
  unknown_winner_anonymized: "Winner hidden",
};

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

/** Amazon listing URL for an ASIN. */
const amazonUrl = (asin: string) => `https://www.amazon.com/dp/${asin}`;

/** Amazon storefront URL for a seller ID — opens the seller's page, which
 *  shows their real business name (the SP-API only ever returns the ID). */
const sellerUrl = (sellerId: string) =>
  `https://www.amazon.com/sp?seller=${encodeURIComponent(sellerId)}`;

const CopyIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ opacity: 0.6 }}
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const ExtLinkIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ flex: "none", opacity: 0.7 }}
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#f59e0b"/></svg>',
  );

function ProductImg({ src }: { src: string | null }) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      className="product-img"
      src={!src || errored ? FALLBACK_IMG : src}
      alt=""
      onError={() => setErrored(true)}
    />
  );
}

/** CSV-escape a cell (quote when it contains a comma/quote/newline). */
function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Quick filter shared with the Buy Box alert digest: no "FBM" in any SKU,
 *  has a price, and "Syruvia"/"Bursting" in the title. */
const matchesSpecial = matchesBuyboxSpecial;

/** Product name (links to the Amazon listing) + click-to-copy ASIN & every
 *  seller SKU mapped to that ASIN. */
function ProductCell({
  asin,
  skus,
  productName,
  onCopy,
}: {
  asin: string;
  skus: string[];
  productName: string | null;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <td>
      <div style={{ minWidth: 0, maxWidth: 360 }}>
        <a
          className="lbb-link"
          href={amazonUrl(asin)}
          target="_blank"
          rel="noreferrer"
          title={productName ?? asin}
        >
          <span className="lbb-title">{productName ?? asin}</span>
          <ExtLinkIcon />
        </a>
        <div
          style={{
            display: "flex",
            gap: 5,
            marginTop: 3,
            flexWrap: "wrap",
          }}
        >
          <span
            className="copy-btn"
            title="Click to copy ASIN"
            onClick={() => onCopy(asin, "ASIN")}
          >
            {asin} <CopyIcon />
          </span>
          {skus.map((sku) => (
            <span
              key={sku}
              className="copy-btn"
              title="Click to copy SKU"
              onClick={() => onCopy(sku, "SKU")}
            >
              {sku} <CopyIcon />
            </span>
          ))}
        </div>
      </div>
    </td>
  );
}

type Tab = "losses" | "ignored";

export function LostBuyBox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("losses");
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [specialOnly, setSpecialOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedIgnored, setSelectedIgnored] = useState<Set<string>>(
    new Set(),
  );

  const run = useQuery({
    queryKey: ["lost-buybox"],
    queryFn: () => api.get<LostBuyboxRun>("/lost-buybox"),
  });

  const ignored = useQuery({
    queryKey: ["lost-buybox", "ignored"],
    queryFn: () =>
      api.get<{ items: IgnoredAsin[]; total: number }>(
        "/lost-buybox/ignored",
      ),
  });

  // Live scan progress — pushed into this cache key by useRealtime() over the
  // websocket; reset to null on completion. enabled:false → queryFn never runs.
  const progressQ = useQuery<ScanProgress | null>({
    queryKey: ["lost-buybox", "progress"],
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });
  const progress = progressQ.data;

  const scan = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; alreadyRunning?: boolean }>(
        "/lost-buybox/scan",
      ),
    onSuccess: (res) => {
      // Server dedupes: if a scan is already in flight we get back
      //   { ok: false, alreadyRunning: true }
      // Surface that as a friendly warning instead of pretending the click
      // queued anything — without this users keep mashing the button.
      if (res.alreadyRunning) {
        toast.warning(
          "Scan already running",
          "A Buy Box scan is in progress for this workspace. It'll finish in a few minutes — no need to click again.",
        );
        return;
      }
      qc.setQueryData<ScanProgress | null>(["lost-buybox", "progress"], {
        phase: "report",
        message: "Starting scan…",
      });
      toast.info(
        "Scan started",
        "Pulling listings & checking the Buy Box on every ASIN — the report refreshes automatically when it's done (can take a few minutes).",
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't start scan",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const cancelScan = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean }>("/lost-buybox/scan/cancel"),
    onSuccess: (res) =>
      res.ok
        ? toast.info(
            "Cancelling scan…",
            "It will stop after the current batch finishes.",
          )
        : toast.info("Nothing to cancel", "No scan is currently running."),
    onError: (err) =>
      toast.error(
        "Couldn't cancel",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const ignoreMut = useMutation({
    mutationFn: (rowsToIgnore: LostBuyboxRow[]) =>
      api.post("/lost-buybox/ignored", {
        asins: rowsToIgnore.map((r) => r.asin),
        rows: rowsToIgnore,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lost-buybox"] });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of vars) next.delete(r.asin);
        return next;
      });
      toast.success(
        vars.length === 1
          ? "ASIN ignored"
          : `${vars.length} ASINs ignored`,
        "They won't show up or trigger an alert.",
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't ignore",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const unignoreMut = useMutation({
    mutationFn: (asins: string[]) =>
      api.post("/lost-buybox/ignored/bulk-delete", { asins }),
    onSuccess: (_data, asins) => {
      qc.invalidateQueries({ queryKey: ["lost-buybox", "ignored"] });
      setSelectedIgnored((prev) => {
        const next = new Set(prev);
        for (const a of asins) next.delete(a);
        return next;
      });
      toast.success(
        asins.length === 1
          ? "Removed from ignore list"
          : `${asins.length} removed from ignore list`,
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't un-ignore",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const rows = run.data?.rows ?? [];
  const summary = run.data?.summary;
  const ignoredItems = ignored.data?.items ?? [];
  const scanning = progress != null || scan.isPending;

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text);
    toast.success("Copied", `${label} copied to clipboard.`);
  }

  function exportCsv() {
    if (rows.length === 0) return;
    const header = [
      "ASIN",
      "SKU",
      "Product",
      "My Price",
      "Buy Box",
      "Winner",
      "Reason",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.asin,
          r.skus?.length ? r.skus.join("; ") : (r.sellerSku ?? ""),
          r.productName ?? "",
          r.myPrice ?? "",
          r.buyboxPrice ?? "",
          r.buyboxSellerId ?? "",
          r.reason,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lost-buybox-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const reasonCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: rows.length,
      other_seller_winning: 0,
      no_featured_offer: 0,
      unknown_winner_anonymized: 0,
    };
    for (const r of rows) c[r.reason] = (c[r.reason] ?? 0) + 1;
    return c;
  }, [rows]);

  const specialCount = useMemo(
    () => rows.filter(matchesSpecial).length,
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reasonFilter !== "all" && r.reason !== reasonFilter) return false;
      if (specialOnly && !matchesSpecial(r)) return false;
      if (!q) return true;
      const skus = r.skus?.length ? r.skus : r.sellerSku ? [r.sellerSku] : [];
      return (
        r.asin.toLowerCase().includes(q) ||
        skus.some((s) => s.toLowerCase().includes(q)) ||
        (r.productName ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, reasonFilter, specialOnly]);

  const filteredIgnored = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ignoredItems;
    return ignoredItems.filter(
      (r) =>
        r.asin.toLowerCase().includes(q) ||
        (r.sellerSku ?? "").toLowerCase().includes(q) ||
        (r.productName ?? "").toLowerCase().includes(q),
    );
  }, [ignoredItems, search]);

  // Reset to page 1 when the visible set shifts under us. Bulk-selection
  // still operates on the entire filtered list, not just the current page.
  useEffect(() => {
    setPage(1);
  }, [tab, search, reasonFilter, specialOnly, pageSize]);

  const activeList = tab === "losses" ? filteredRows : filteredIgnored;
  const totalPages = Math.max(1, Math.ceil(activeList.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = currentPage * pageSize;
  const pagedRows = useMemo(
    () => filteredRows.slice(pageStart, pageEnd),
    [filteredRows, pageStart, pageEnd],
  );
  const pagedIgnored = useMemo(
    () => filteredIgnored.slice(pageStart, pageEnd),
    [filteredIgnored, pageStart, pageEnd],
  );
  const fromN = activeList.length === 0 ? 0 : pageStart + 1;
  const toN = Math.min(pageEnd, activeList.length);

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

  // Drop selections for ASINs no longer in the report (e.g. after a re-scan
  // or after they were ignored elsewhere).
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(rows.map((r) => r.asin));
      let changed = false;
      const next = new Set<string>();
      for (const a of prev) {
        if (valid.has(a)) next.add(a);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const selectedRows = useMemo(
    () => filteredRows.filter((r) => selected.has(r.asin)),
    [filteredRows, selected],
  );
  const allFilteredSelected =
    filteredRows.length > 0 && selectedRows.length === filteredRows.length;
  const someSelected =
    selectedRows.length > 0 && !allFilteredSelected;

  const headCbRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headCbRef.current) headCbRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleRow(asin: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const r of filteredRows) next.delete(r.asin);
        return next;
      }
      const next = new Set(prev);
      for (const r of filteredRows) next.add(r.asin);
      return next;
    });
  }

  // --- Ignored tab selection (mirrors the Losses tab) ---
  useEffect(() => {
    setSelectedIgnored((prev) => {
      const valid = new Set(ignoredItems.map((r) => r.asin));
      let changed = false;
      const next = new Set<string>();
      for (const a of prev) {
        if (valid.has(a)) next.add(a);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [ignoredItems]);

  const selectedIgnoredRows = useMemo(
    () => filteredIgnored.filter((r) => selectedIgnored.has(r.asin)),
    [filteredIgnored, selectedIgnored],
  );
  const allIgnSelected =
    filteredIgnored.length > 0 &&
    selectedIgnoredRows.length === filteredIgnored.length;
  const someIgnSelected =
    selectedIgnoredRows.length > 0 && !allIgnSelected;

  const headCbIgnRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headCbIgnRef.current) {
      headCbIgnRef.current.indeterminate = someIgnSelected;
    }
  }, [someIgnSelected]);

  function toggleIgnRow(asin: string) {
    setSelectedIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  }
  function toggleIgnAll() {
    setSelectedIgnored((prev) => {
      if (allIgnSelected) {
        const next = new Set(prev);
        for (const r of filteredIgnored) next.delete(r.asin);
        return next;
      }
      const next = new Set(prev);
      for (const r of filteredIgnored) next.add(r.asin);
      return next;
    });
  }

  return (
    <div>
      {/* Stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div className="stat-card">
          <div className="stat-label">ASINs Checked</div>
          <div className="stat-value">{summary?.total ?? 0}</div>
          <div className="stat-trend">
            {run.data?.updatedAt
              ? `scanned ${relativeTime(run.data.updatedAt)}`
              : "never scanned"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Lost Buy Box</div>
          <div className="stat-value">{rows.length}</div>
          <div className="stat-trend down">not winning</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Winning</div>
          <div className="stat-value">{summary?.won ?? 0}</div>
          <div className="stat-trend up">holding buy box</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ignored</div>
          <div className="stat-value">{ignoredItems.length}</div>
          <div className="stat-trend">excluded from scan</div>
        </div>
      </div>

      {/* Live progress */}
      {scanning && (
        <div className="lbb-progress">
          <span className="spinner-sm" />
          <span>
            {progress?.message ?? "Starting scan…"}
            {progress?.processed != null && progress.total
              ? ` (${progress.processed}/${progress.total})`
              : ""}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-secondary btn-xs"
            disabled={cancelScan.isPending}
            onClick={() => cancelScan.mutate()}
          >
            {cancelScan.isPending ? "Cancelling…" : "Cancel scan"}
          </button>
        </div>
      )}

      {/* Tabs + search + scan */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          className={"filter-chip" + (tab === "losses" ? " active" : "")}
          onClick={() => setTab("losses")}
        >
          Losses <span className="count">{rows.length}</span>
        </div>
        <div
          className={"filter-chip" + (tab === "ignored" ? " active" : "")}
          onClick={() => setTab("ignored")}
        >
          Ignored <span className="count">{ignoredItems.length}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="input-wrap" style={{ minWidth: 240 }}>
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
            placeholder="Search ASIN, SKU, product…"
            style={{ width: "100%" }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          title="Download the current report as CSV"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
        <button
          className="btn btn-primary btn-sm"
          title="Pull listings and check the Buy Box on every ASIN"
          disabled={scanning}
          onClick={() => scan.mutate()}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          {scanning ? "Scanning…" : "Run scan"}
        </button>
      </div>

      {/* Reason filters (losses tab) */}
      {tab === "losses" && rows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          {(
            [
              ["all", "All"],
              ["other_seller_winning", REASON_LABEL.other_seller_winning],
              ["no_featured_offer", REASON_LABEL.no_featured_offer],
              [
                "unknown_winner_anonymized",
                REASON_LABEL.unknown_winner_anonymized,
              ],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className={
                "filter-chip" + (reasonFilter === key ? " active" : "")
              }
              onClick={() => setReasonFilter(key)}
            >
              {label}{" "}
              <span className="count">{reasonCounts[key] ?? 0}</span>
            </div>
          ))}
          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--border)",
              margin: "0 4px",
            }}
          />
          <div
            className={"filter-chip" + (specialOnly ? " active" : "")}
            onClick={() => setSpecialOnly((v) => !v)}
            title="Non-FBM SKUs that have a price and 'Syruvia' or 'Bursting' in the title"
          >
            Syruvia / Bursting{" "}
            <span className="count">{specialCount}</span>
          </div>
        </div>
      )}

      {/* Selection / bulk-ignore bar (losses tab) */}
      {tab === "losses" && filteredRows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>
            <strong style={{ color: "var(--text)" }}>
              {filteredRows.length}
            </strong>{" "}
            ASIN{filteredRows.length === 1 ? "" : "s"} missed Buy Box
            {run.isFetching && !run.isLoading && (
              <span
                className="spinner-inline"
                style={{ marginLeft: 8 }}
                aria-label="Loading"
              />
            )}
            {selectedRows.length > 0 && (
              <>
                {" · "}
                <strong style={{ color: "var(--text)" }}>
                  {selectedRows.length}
                </strong>{" "}
                selected
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {selectedRows.length > 0 && (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={ignoreMut.isPending}
                onClick={() => ignoreMut.mutate(selectedRows)}
              >
                {ignoreMut.isPending
                  ? "Ignoring…"
                  : `Ignore ${selectedRows.length} selected`}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={ignoreMut.isPending}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* Selection / bulk-unignore bar (ignored tab) */}
      {tab === "ignored" && filteredIgnored.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>
            <strong style={{ color: "var(--text)" }}>
              {filteredIgnored.length}
            </strong>{" "}
            ignored ASIN{filteredIgnored.length === 1 ? "" : "s"}
            {ignored.isFetching && !ignored.isLoading && (
              <span
                className="spinner-inline"
                style={{ marginLeft: 8 }}
                aria-label="Loading"
              />
            )}
            {selectedIgnoredRows.length > 0 && (
              <>
                {" · "}
                <strong style={{ color: "var(--text)" }}>
                  {selectedIgnoredRows.length}
                </strong>{" "}
                selected
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {selectedIgnoredRows.length > 0 && (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={unignoreMut.isPending}
                onClick={() =>
                  unignoreMut.mutate(
                    selectedIgnoredRows.map((r) => r.asin),
                  )
                }
              >
                {unignoreMut.isPending
                  ? "Removing…"
                  : `Un-ignore ${selectedIgnoredRows.length} selected`}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={unignoreMut.isPending}
                onClick={() => setSelectedIgnored(new Set())}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* Losses */}
      {tab === "losses" &&
        (run.isLoading ? (
          <Loading />
        ) : run.isError ? (
          <ErrorState />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="No lost Buy Boxes"
            message={
              run.data?.updatedAt
                ? "You're winning the Buy Box on every scanned ASIN."
                : "Run a scan to check the Buy Box on all your listings."
            }
          />
        ) : (
          <>
          <div
            className={
              "card card-table-wrap" +
              (run.isFetching && !run.isLoading ? " is-refetching" : "")
            }
            style={{ padding: 0 }}
          >
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th style={{ width: 34, textAlign: "center" }}>
                    <input
                      ref={headCbRef}
                      type="checkbox"
                      aria-label="Select all"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ width: 62 }}>Image</th>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>My Price</th>
                  <th style={{ textAlign: "right" }}>Buy Box</th>
                  <th style={{ textAlign: "center" }}>Winner</th>
                  <th style={{ textAlign: "center" }}>Reason</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const isSel = selected.has(r.asin);
                  return (
                  <tr
                    key={r.asin}
                    style={
                      isSel ? { background: "var(--surface-2)" } : undefined
                    }
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.asin}`}
                        checked={isSel}
                        onChange={() => toggleRow(r.asin)}
                      />
                    </td>
                    <td>
                      <ProductImg src={r.imageUrl ?? null} />
                    </td>
                    <ProductCell
                      asin={r.asin}
                      skus={r.skus ?? (r.sellerSku ? [r.sellerSku] : [])}
                      productName={r.productName}
                      onCopy={copy}
                    />
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(r.myPrice)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(r.buyboxPrice)}
                    </td>
                    <td
                      style={{
                        textAlign: "center",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        fontSize: 12,
                        color: "var(--text-3)",
                      }}
                    >
                      {r.buyboxSellerId ? (
                        <a
                          className="lbb-link"
                          href={sellerUrl(r.buyboxSellerId)}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open seller ${r.buyboxSellerId} on Amazon`}
                        >
                          <span>{r.buyboxSellerId}</span>
                          <ExtLinkIcon />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={"lbb-reason " + r.reason}>
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-secondary btn-xs"
                        disabled={ignoreMut.isPending}
                        onClick={() => ignoreMut.mutate([r])}
                      >
                        Ignore
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="inv-pagination">
              <button
                className="inv-page-arrow"
                title="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="inv-page-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={"inv-page-btn" + (p === currentPage ? " active" : "")}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                className="inv-page-arrow"
                title="Next page"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <select
                className="inv-pagesize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-3)" }}>
                {fromN}-{toN} of {activeList.length}
              </span>
            </div>
          )}
          </>
        ))}

      {/* Ignored */}
      {tab === "ignored" &&
        (ignored.isLoading ? (
          <Loading />
        ) : ignored.isError ? (
          <ErrorState />
        ) : filteredIgnored.length === 0 ? (
          <EmptyState
            title="Nothing ignored"
            message="ASINs you ignore from the Losses tab are excluded from scans and never trigger an email."
          />
        ) : (
          <>
          <div
            className={
              "card card-table-wrap" +
              (ignored.isFetching && !ignored.isLoading ? " is-refetching" : "")
            }
            style={{ padding: 0 }}
          >
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th style={{ width: 34, textAlign: "center" }}>
                    <input
                      ref={headCbIgnRef}
                      type="checkbox"
                      aria-label="Select all"
                      checked={allIgnSelected}
                      onChange={toggleIgnAll}
                    />
                  </th>
                  <th style={{ width: 62 }}>Image</th>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>My Price</th>
                  <th style={{ textAlign: "right" }}>Buy Box</th>
                  <th style={{ textAlign: "right" }}>Ignored</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedIgnored.map((r) => {
                  const isSel = selectedIgnored.has(r.asin);
                  return (
                  <tr
                    key={r.asin}
                    style={
                      isSel ? { background: "var(--surface-2)" } : undefined
                    }
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.asin}`}
                        checked={isSel}
                        onChange={() => toggleIgnRow(r.asin)}
                      />
                    </td>
                    <td>
                      <ProductImg src={r.imageUrl ?? null} />
                    </td>
                    <ProductCell
                      asin={r.asin}
                      skus={r.sellerSku ? [r.sellerSku] : []}
                      productName={r.productName}
                      onCopy={copy}
                    />
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(r.myPrice)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(r.buyboxPrice)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: "var(--text-3)",
                        fontSize: 12,
                      }}
                    >
                      {relativeTime(r.ignoredAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-secondary btn-xs"
                        disabled={unignoreMut.isPending}
                        onClick={() => unignoreMut.mutate([r.asin])}
                      >
                        Un-ignore
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="inv-pagination">
              <button
                className="inv-page-arrow"
                title="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="inv-page-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={"inv-page-btn" + (p === currentPage ? " active" : "")}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                className="inv-page-arrow"
                title="Next page"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <select
                className="inv-pagesize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-3)" }}>
                {fromN}-{toN} of {activeList.length}
              </span>
            </div>
          )}
          </>
        ))}
    </div>
  );
}
