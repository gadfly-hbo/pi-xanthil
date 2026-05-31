import type { ClientMessage, ServerMessage } from "@/types";

type Listener = (msg: ServerMessage) => void;

/** Single auto-reconnecting gateway connection shared across the app. */
export class Gateway {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) this.send(m);
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      for (const l of this.listeners) l(msg);
    };
    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 1000);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else {
      this.queue.push(msg);
      this.connect();
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const gateway = new Gateway();
