import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribes to the API WebSocket and invalidates affected queries when the
 * backend pushes events (e.g. a scheduled price was applied by pg-boss).
 */
export function useRealtime(): void {
  const qc = useQueryClient();
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
  }, [qc]);
}
