import { listContainers, PsItem } from "./dockerCli";

type ContainersSubscriber = (items: Map<string, PsItem>) => void;

type CtxState = {
  timer: NodeJS.Timeout;
  subs: Map<string, ContainersSubscriber>;
  snapshot: Map<string, PsItem>;
  polling: boolean;
};

const stores = new Map<string, CtxState>();

function keyFor(ctx?: string): string {
  return ctx || "__local__";
}

async function tick(ctxKey: string) {
  const st = stores.get(ctxKey);
  if (!st || st.polling) return;
  st.polling = true;
  try {
    const ctx = ctxKey === "__local__" ? undefined : ctxKey;
    const items = await listContainers(true, ctx);
    const next = new Map<string, PsItem>();
    for (const it of items) next.set(it.name, it);
    // Detect changes
    let changed = false;
    if (next.size !== st.snapshot.size) {
      changed = true;
    } else {
      for (const [name, it] of next) {
        const prev = st.snapshot.get(name);
        if (!prev || prev.state !== it.state) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      st.snapshot = next;
      for (const [, cb] of st.subs) {
        try { cb(st.snapshot); } catch {}
      }
    }
  } catch {
    // ignore polling errors; next tick will retry
  } finally {
    st.polling = false;
  }
}

export function subscribeContainers(ctx: string | undefined, id: string, sub: ContainersSubscriber, intervalMs = 1500) {
  const key = keyFor(ctx);
  let st = stores.get(key);
  if (!st) {
    st = {
      timer: setInterval(() => {
        tick(key).catch(() => undefined);
      }, intervalMs) as any,
      subs: new Map(),
      snapshot: new Map(),
      polling: false,
    };
    stores.set(key, st);
    // Kick first tick faster
    setTimeout(() => tick(key).catch(() => undefined), 10);
  }
  st.subs.set(id, sub);
  // If we already have data, push it immediately
  if (st.snapshot.size > 0) {
    try { sub(st.snapshot); } catch {}
  }
}

export function unsubscribeContainers(ctx: string | undefined, id: string) {
  const key = keyFor(ctx);
  const st = stores.get(key);
  if (!st) return;
  st.subs.delete(id);
  if (st.subs.size === 0) {
    clearInterval(st.timer);
    stores.delete(key);
  }
}

export function getContainersSnapshot(ctx?: string): Map<string, PsItem> | undefined {
  const key = keyFor(ctx);
  return stores.get(key)?.snapshot;
}

