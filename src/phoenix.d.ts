declare module "phoenix" {
  export class Socket {
    constructor(endPoint: string, opts?: Record<string, unknown>);
    connect(): void;
    disconnect(): void;
    isConnected(): boolean;
    connectionState(): "connecting" | "open" | "closing" | "closed";
    channel(topic: string, chanParams?: Record<string, unknown>): Channel;
    onOpen(callback: () => void): void;
    onClose(callback: () => void): void;
    onError(callback: (error: unknown) => void): void;
  }

  export class Channel {
    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    push(event: string, payload: Record<string, unknown>, timeout?: number): Push;
    on(event: string, callback: (payload: Record<string, unknown>) => void): number;
    off(event: string, ref?: number): void;
  }

  export class Push {
    receive(status: string, callback: (response: Record<string, unknown>) => void): Push;
  }

  export class Presence {
    constructor(channel: Channel);
    onSync(callback: () => void): void;
    onJoin(callback: (id: string, current: unknown, newPres: unknown) => void): void;
    onLeave(callback: (id: string, current: unknown, leftPres: unknown) => void): void;
    list<T>(chooser?: (id: string, presence: unknown) => T): T[];
    static syncState(state: Record<string, unknown>, newState: Record<string, unknown>): Record<string, unknown>;
    static syncDiff(state: Record<string, unknown>, diff: { joins: Record<string, unknown>; leaves: Record<string, unknown> }): Record<string, unknown>;
  }
}
