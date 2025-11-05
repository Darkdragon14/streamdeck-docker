import { DockerContextInfo, listDockerContexts } from "./dockerContext";

type ContextsSubscriber = (items: Map<string, DockerContextInfo>) => void;

type CtxState = {
	timer: NodeJS.Timeout;
	subs: Map<string, ContextsSubscriber>;
	snapshot: Map<string, DockerContextInfo>;
	polling: boolean;
};

let state: CtxState | undefined;

async function tick() {
	if (!state || state.polling) return;
	state.polling = true;
	try {
		const items = await listDockerContexts();
		const next = new Map<string, DockerContextInfo>();
		for (const it of items) next.set(it.name, it);

		// Detect changes (size or membership)
		let changed = false;
		if (!state.snapshot || next.size !== state.snapshot.size) {
			changed = true;
		} else {
			for (const [name] of next) {
				if (!state.snapshot.has(name)) {
					changed = true;
					break;
				}
			}
		}
		if (changed) {
			state.snapshot = next;
			for (const [, cb] of state.subs) {
				try {
					cb(state.snapshot);
				} catch {}
			}
		}
	} catch {
		// ignore polling errors; next tick will retry
	} finally {
		if (state) state.polling = false;
	}
}

export function subscribeDockerContexts(id: string, sub: ContextsSubscriber, intervalMs = 5000) {
	if (!state) {
		state = {
			timer: setInterval(() => {
				tick().catch(() => undefined);
			}, intervalMs) as any,
			subs: new Map(),
			snapshot: new Map(),
			polling: false,
		};
		// Kick first tick
		setTimeout(() => tick().catch(() => undefined), 10);
	}
	state.subs.set(id, sub);
	if (state.snapshot.size > 0) {
		try {
			sub(state.snapshot);
		} catch {}
	}
}

export function unsubscribeDockerContexts(id: string) {
	if (!state) return;
	state.subs.delete(id);
	if (state.subs.size === 0) {
		clearInterval(state.timer);
		state = undefined;
	}
}

export function getDockerContextsSnapshot(): Map<string, DockerContextInfo> | undefined {
	return state?.snapshot;
}
