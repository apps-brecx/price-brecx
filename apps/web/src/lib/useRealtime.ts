import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/Toast";

/**
 * Subscribes to the API WebSocket and invalidates affected queries when the
 * backend pushes events (e.g. a scheduled price was applied by pg-boss).
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    const base = import.meta.env.VITE_API_URL ?? "";
    const url =
      (base
        ? base.replace(/^http/, "ws")
        : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`) +
      "/ws";
    let ws: WebSocket | null = null;
    let closed = false;

    function connect() {
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "price_applied") {
            qc.invalidateQueries({ queryKey: ["skus"] });
            qc.invalidateQueries({ queryKey: ["schedules"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            qc.invalidateQueries({ queryKey: ["activity"] });
          } else if (msg.type === "lost_buybox_progress") {
            const { type: _t, ...progress } = msg;
            qc.setQueryData(["lost-buybox", "progress"], progress);
          } else if (msg.type === "lost_buybox_synced") {
            qc.setQueryData(["lost-buybox", "progress"], null);
            qc.invalidateQueries({ queryKey: ["lost-buybox"] });
            qc.invalidateQueries({ queryKey: ["activity"] });
            qc.invalidateQueries({ queryKey: ["nav-counts"] });
            if (msg.cancelled) {
              toast.info(
                "Scan cancelled",
                "The Buy Box scan was stopped.",
              );
            } else if (msg.ok === false) {
              toast.error(
                "Buy Box scan failed",
                msg.error || "See the Activity Log for details.",
              );
            } else if (msg.mode === "stub") {
              toast.warning(
                "Scan ran in stub mode",
                "SP-API credentials not loaded — restart the API so apps/api/.env is read.",
              );
            } else if (!msg.count) {
              toast.success(
                "Buy Box scan finished",
                "You're winning the Buy Box on every scanned ASIN.",
              );
            } else {
              toast.warning(
                `${msg.count} lost the Buy Box`,
                "Open Lost Buy Box for the full report.",
              );
            }
          } else if (msg.type === "skus_synced") {
            qc.invalidateQueries({ queryKey: ["skus"] });
            qc.invalidateQueries({ queryKey: ["nav-counts"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            qc.invalidateQueries({ queryKey: ["activity"] });
            if (msg.ok === false) {
              toast.error(
                msg.stage ? `${msg.stage} sync failed` : "Amazon sync failed",
                msg.error || "See the Activity Log for details.",
              );
            } else if (msg.stage) {
              // One of the 4 staged daily crons (listings/images/fba/sales).
              const labels: Record<string, string> = {
                listings: "Listings",
                images: "Images",
                fba: "FBA stock",
                sales: "Sales metrics",
              };
              const label = labels[msg.stage] ?? msg.stage;
              toast.info(
                `${label} synced`,
                msg.count != null ? `${msg.count} SKUs updated` : "",
              );
            } else if (msg.mode === "stub") {
              toast.warning(
                "Sync ran in stub mode",
                "SP-API credentials not loaded — restart the API so apps/api/.env is read.",
              );
            } else if (!msg.count) {
              toast.info(
                "Amazon sync finished",
                "No listings were returned for this seller account.",
              );
            } else {
              toast.success(`Synced ${msg.count} SKUs from Amazon`);
            }
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 4000);
      };
    }
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [qc, toast]);
}
