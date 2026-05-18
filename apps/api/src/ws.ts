import type { WebSocket } from "@fastify/websocket";

/** workspaceId -> set of connected sockets */
const rooms = new Map<string, Set<WebSocket>>();

export function addSocket(workspaceId: string, socket: WebSocket): void {
  let set = rooms.get(workspaceId);
  if (!set) {
    set = new Set();
    rooms.set(workspaceId, set);
  }
  set.add(socket);
  socket.on("close", () => {
    set?.delete(socket);
    if (set && set.size === 0) rooms.delete(workspaceId);
  });
}

export function broadcast(workspaceId: string, payload: unknown): void {
  const set = rooms.get(workspaceId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(msg);
  }
}
