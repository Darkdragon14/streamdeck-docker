import { ping as pingCli } from "./dockerCli";

type Subscriber = (up: boolean) => void;

const monitors = new Map<string, { up?: boolean; timer: NodeJS.Timeout; subs: Map<string, Subscriber> }>();

function keyFor(ctx?: string): string { return ctx || "__local__"; }

export function subscribeContextHealth(ctx: string | undefined, id: string, sub: Subscriber) {
  const key = keyFor(ctx);
  let m = monitors.get(key);
  if (!m) {
    m = { up: undefined, timer: setInterval(async () => { await tick(key); }, 1000) as any, subs: new Map() };
    monitors.set(key, m);
  }
  m.subs.set(id, sub);
}

export function unsubscribeContextHealth(ctx: string | undefined, id: string) {
  const key = keyFor(ctx);
  const m = monitors.get(key);
  if (!m) return;
  m.subs.delete(id);
  if (m.subs.size === 0) {
    clearInterval(m.timer);
    monitors.delete(key);
  }
}

async function tick(key: string) {
  const m = monitors.get(key);
  if (!m) return;
  try {
    const up = await pingCli(key === "__local__" ? undefined : key);
    if (m.up !== up) {
      m.up = up;
      for (const [, fn] of m.subs) {
        try { fn(up); } catch {}
      }
    }
  } catch {
    if (m.up !== false) {
      m.up = false;
      for (const [, fn] of m.subs) {
        try { fn(false); } catch {}
      }
    }
  }
}

