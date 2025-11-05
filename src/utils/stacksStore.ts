import { CONTAINER_STATUS_RUNNING } from "../constants/docker";
import { getContainersSnapshot, subscribeContainers, unsubscribeContainers } from "./containerStore";
import type { PsItem } from "./dockerCli";

export type StackInfo = { name: string; running: number; total: number };
type StacksSubscriber = (items: Map<string, StackInfo>) => void;

type CtxState = {
	subs: Map<string, StacksSubscriber>;
	snapshot: Map<string, StackInfo>;
	// internal subscription id for containerStore
	containerSubId: string;
};

const stores = new Map<string, CtxState>();

function keyFor(ctx?: string): string {
	return ctx || "__local__";
}

function aggregateStacks(containers: Map<string, PsItem>): Map<string, StackInfo> {
	const map = new Map<string, StackInfo>();
	for (const [, it] of containers) {
		const labels = it.labels || {};
		const name = labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"];
		if (!name) continue;
		const entry = map.get(name) || { name, running: 0, total: 0 };
		entry.total += 1;
		if (it.state === CONTAINER_STATUS_RUNNING) entry.running += 1;
		map.set(name, entry);
	}
	return map;
}

function areEqual(a: Map<string, StackInfo>, b: Map<string, StackInfo>): boolean {
	if (a.size !== b.size) return false;
	for (const [k, v] of a) {
		const other = b.get(k);
		if (!other || other.running !== v.running || other.total !== v.total) return false;
	}
	return true;
}

export function subscribeStacks(ctx: string | undefined, id: string, sub: StacksSubscriber) {
	const key = keyFor(ctx);
	let st = stores.get(key);
	if (!st) {
		st = {
			subs: new Map(),
			snapshot: new Map(),
			containerSubId: `stacks-${Math.random().toString(36).slice(2)}`,
		};
		stores.set(key, st);
		// subscribe to container store and aggregate
		subscribeContainers(ctx, st.containerSubId, (conts) => {
			const next = aggregateStacks(conts as any);
			if (!areEqual(next, st!.snapshot)) {
				st!.snapshot = next;
				for (const [, cb] of st!.subs) {
					try {
						cb(st!.snapshot);
					} catch {}
				}
			}
		});
		// initialize snapshot immediately if we have containers snapshot
		const contSnap = getContainersSnapshot(ctx);
		if (contSnap) st.snapshot = aggregateStacks(contSnap as any);
	}
	st.subs.set(id, sub);
	if (st.snapshot.size > 0) {
		try {
			sub(st.snapshot);
		} catch {}
	}
}

export function unsubscribeStacks(ctx: string | undefined, id: string) {
	const key = keyFor(ctx);
	const st = stores.get(key);
	if (!st) return;
	st.subs.delete(id);
	if (st.subs.size === 0) {
		// remove container subscription and clear store
		unsubscribeContainers(ctx, st.containerSubId);
		stores.delete(key);
	}
}

export function getStacksSnapshot(ctx?: string): Map<string, StackInfo> | undefined {
	const key = keyFor(ctx);
	return stores.get(key)?.snapshot;
}
