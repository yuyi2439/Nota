import type { WebSocketConnection } from "./router.js";

export interface Subscription {
  sessionId: string;
  connection: WebSocketConnection;
}

type SubscriptionChangeHandler = (sub: Subscription | null, sessionId: string) => void;

export class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>();
  private handlers: SubscriptionChangeHandler[] = [];

  subscribe(sessionId: string, connection: WebSocketConnection): boolean {
    if (this.subscriptions.has(sessionId)) return false;
    
    const sub: Subscription = { sessionId, connection };
    this.subscriptions.set(sessionId, sub);
    connection.onClose(() => {
      if (this.subscriptions.get(sessionId) === sub) {
        this.subscriptions.delete(sessionId);
        this.emit(null, sessionId);
      }
    });
    this.emit(sub, sessionId);
    return true;
  }

  unsubscribe(sessionId: string): void {
    const sub = this.subscriptions.get(sessionId);
    if (!sub) return;
    sub.connection.close();
    this.subscriptions.delete(sessionId);
    this.emit(null, sessionId);
  }

  get(sessionId: string): Subscription | undefined {
    return this.subscriptions.get(sessionId);
  }

  isSubscribed(sessionId: string): boolean {
    return this.subscriptions.has(sessionId);
  }

  push(sessionId: string, event: string, data: unknown): boolean {
    const sub = this.subscriptions.get(sessionId);
    if (!sub) return false;
    
    sub.connection.send({ event, data, sessionId });
    return true;
  }

  //? What's this for?
  onChange(handler: SubscriptionChangeHandler): void {
    this.handlers.push(handler);
  }

  //? What's this?
  private emit(sub: Subscription | null, sessionId: string): void {
    for (const h of this.handlers) h(sub, sessionId);
  }
}

export interface SSEWriter {
  write: (event: string, data: unknown) => void;
  close: () => void;
  onClose: (handler: () => void) => void;
}

export class SSEManager {
  private channels = new Map<string, Set<SSEWriter>>();

  register(channelId: string, writer: SSEWriter): void {
    let set = this.channels.get(channelId);
    if (!set) {
      set = new Set();
      this.channels.set(channelId, set);
    }
    set.add(writer);
    writer.onClose(() => {
      const s = this.channels.get(channelId);
      if (s) {
        s.delete(writer);
        if (s.size === 0) this.channels.delete(channelId);
      }
    });
  }

  broadcast(channelId: string, event: string, data: unknown): void {
    const set = this.channels.get(channelId);
    if (!set) return;
    for (const w of set) w.write(event, data);
  }
}
