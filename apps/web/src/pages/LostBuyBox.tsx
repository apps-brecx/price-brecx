import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LostBuyboxRun, LostBuyboxRow, IgnoredAsin } from "@fbm/shared";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import "./LostBuyBox.css";

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
const sellerShort = (s: string | null) =>
  s ? `${s.slice(0, 5)}…${s.slice(-3)}` : "—";

type Tab = "losses" | "ignored";

export function LostBuyBox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("losses");
  const [search, setSearch] = useState("");

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
    mutationFn: () => api.post<{ ok: boolean }>("/lost-buybox/scan"),
    onSuccess: () => {
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

  const ignoreMut = useMutation({
    mutationFn: (row: LostBuyboxRow) =>
      api.post("/lost-buybox/ignored", {
        asins: [row.asin],
        rows: [row],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lost-buybox"] });
      toast.success("ASIN ignored", "It won't show up or trigger an alert.");
    },
  });

  const unignoreMut = useMutation({
    mutationFn: (asin: string) =>
      api.del(`/lost-buybox/ignored/${encodeURIComponent(asin)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lost-buybox", "ignored"] });
      toast.success("Removed from ignore list");
    },
  });

  const rows = run.data?.rows ?? [];
  const summary = run.data?.summary;
  const ignoredItems = ignored.data?.items ?? [];
  const scanning = progress != null || scan.isPending;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.asin.toLowerCase().includes(q) ||
        (r.sellerSku ?? "").toLowerCase().includes(q) ||
        (r.productName ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

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
          <div className="card card-table-wrap" style={{ padding: 0 }}>
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>My Price</th>
                  <th style={{ textAlign: "right" }}>Buy Box</th>
                  <th style={{ textAlign: "center" }}>Winner</th>
                  <th style={{ textAlign: "center" }}>Reason</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.asin}>
                    <td>
                      <div style={{ minWidth: 0, maxWidth: 360 }}>
                        <div className="lbb-title">
                          {r.productName ?? r.asin}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 5,
                            marginTop: 3,
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="copy-btn">{r.asin}</span>
                          {r.sellerSku && (
                            <span className="copy-btn">{r.sellerSku}</span>
                          )}
                        </div>
                      </div>
                    </td>
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
                      {sellerShort(r.buyboxSellerId)}
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
                        onClick={() => ignoreMut.mutate(r)}
                      >
                        Ignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div className="card card-table-wrap" style={{ padding: 0 }}>
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>My Price</th>
                  <th style={{ textAlign: "right" }}>Buy Box</th>
                  <th style={{ textAlign: "right" }}>Ignored</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIgnored.map((r) => (
                  <tr key={r.asin}>
                    <td>
                      <div style={{ minWidth: 0, maxWidth: 360 }}>
                        <div className="lbb-title">
                          {r.productName ?? r.asin}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 5,
                            marginTop: 3,
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="copy-btn">{r.asin}</span>
                          {r.sellerSku && (
                            <span className="copy-btn">{r.sellerSku}</span>
                          )}
                        </div>
                      </div>
                    </td>
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
                        onClick={() => unignoreMut.mutate(r.asin)}
                      >
                        Un-ignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
