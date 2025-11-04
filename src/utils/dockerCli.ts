import { execFile as cpExecFile } from "child_process";
import { promisify } from "util";

const execFile = promisify(cpExecFile as any) as (
	file: string,
	args: string[],
) => Promise<{ stdout: string; stderr: string }>;

// Simple global concurrency limiter + per-context scheduling with priority
const MAX_GLOBAL_CONCURRENCY = parseInt(process.env.DOCKER_CLI_MAX_CONCURRENCY || "5", 10);
let globalRunning = 0;
const globalWaiters: Array<() => void> = [];

function acquireGlobal(): Promise<void> {
	if (globalRunning < MAX_GLOBAL_CONCURRENCY) {
		globalRunning++;
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		globalWaiters.push(() => {
			globalRunning++;
			resolve();
		});
	});
}

function releaseGlobal() {
	globalRunning = Math.max(0, globalRunning - 1);
	const next = globalWaiters.shift();
	if (next) next();
}

type Priority = "normal" | "high" | "urgent";
type QueueTask<T> = { fn: () => Promise<T>; resolve: (v: T) => void; reject: (e: any) => void; priority: Priority };

const ctxQueues = new Map<
	string,
	{ running: boolean; qUrg: QueueTask<unknown>[]; qHigh: QueueTask<unknown>[]; qNorm: QueueTask<unknown>[] }
>();

async function runNextInContext(ctxKey: string): Promise<void> {
	const state = ctxQueues.get(ctxKey);
	if (!state) return;
	if (state.running) return;
	const next =
		state.qUrg.length > 0 ? state.qUrg.shift() : state.qHigh.length > 0 ? state.qHigh.shift() : state.qNorm.shift();
	if (!next) return; // nothing to run
	state.running = true;
	await acquireGlobal();
	try {
		const res = await next.fn();
		(next.resolve as (v: unknown) => void)(res);
	} catch (e) {
		next.reject(e);
	} finally {
		releaseGlobal();
		state.running = false;
		// Schedule the next one if any
		if (state.qHigh.length > 0 || state.qNorm.length > 0) {
			// fire and forget to avoid stack buildup
			setImmediate(() => {
				runNextInContext(ctxKey).catch(() => undefined);
			});
		}
	}
}

function scheduleInContext<T>(contextKey: string, task: () => Promise<T>, priority: Priority): Promise<T> {
	let state = ctxQueues.get(contextKey);
	if (!state) {
		state = { running: false, qUrg: [], qHigh: [], qNorm: [] };
		ctxQueues.set(contextKey, state);
	}
	return new Promise<T>((resolve, reject) => {
		const entry: QueueTask<T> = { fn: task, resolve, reject, priority };
		if (priority === "urgent") state!.qUrg.push(entry as unknown as QueueTask<unknown>);
		else if (priority === "high") state!.qHigh.push(entry as unknown as QueueTask<unknown>);
		else state!.qNorm.push(entry as unknown as QueueTask<unknown>);
		// Attempt to run if idle
		setImmediate(() => {
			runNextInContext(contextKey).catch(() => undefined);
		});
	});
}

export async function runDocker(args: string[], context?: string, opts?: { priority?: Priority }) {
	const finalArgs = [] as string[];
	if (context && context !== "") finalArgs.push("--context", context);
	finalArgs.push(...args);
	const ctxKey = context && context !== "" ? context : "<default>";
	const priority = opts?.priority ?? "normal";
	return scheduleInContext(
		ctxKey,
		async () => {
			const { stdout } = await execFile("docker", finalArgs);
			return stdout;
		},
		priority,
	);
}

// Lightweight cache to avoid spamming `docker version` across many keys
const pingCache = new Map<string, { ok: boolean; ts: number }>();
const PING_TTL_MS = parseInt(process.env.DOCKER_PING_TTL_MS || "5000", 10);

export async function ping(context?: string): Promise<boolean> {
	const key = context && context !== "" ? context : "<default>";
	const now = Date.now();
	const cached = pingCache.get(key);
	if (cached && now - cached.ts < PING_TTL_MS) return cached.ok;
	try {
		await runDocker(["version"], context, { priority: "normal" });
		pingCache.set(key, { ok: true, ts: now });
		return true;
	} catch {
		pingCache.set(key, { ok: false, ts: now });
		return false;
	}
}

export type PsItem = { name: string; state: string; labels?: Record<string, string> };

export async function listContainers(all: boolean, context?: string, filters: string[] = []): Promise<PsItem[]> {
	const format = "{{.Names}}\t{{.State}}\t{{json .Labels}}";
	const args = ["ps", all ? "-a" : "", ...filters.flatMap((f) => ["--filter", f]), "--format", format].filter(
		Boolean,
	) as string[];
	const out = await runDocker(args, context, { priority: "high" });
	const items: PsItem[] = [];
	for (const line of out.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const [name, state, labelsJson] = line.split("\t");
		let labels: Record<string, string> | undefined;
		try {
			labels = labelsJson ? JSON.parse(labelsJson) : undefined;
		} catch {
			labels = undefined;
		}
		items.push({ name, state, labels });
	}
	return items;
}

export async function getContainerState(name: string, context?: string): Promise<string | undefined> {
	try {
		const out = await runDocker(["inspect", "-f", "{{.State.Status}}", name], context, { priority: "normal" });
		return out.trim();
	} catch {
		return undefined;
	}
}

export async function startContainer(name: string, context?: string): Promise<void> {
	await runDocker(["start", name], context, { priority: "urgent" });
}

export async function stopContainer(name: string, context?: string): Promise<void> {
	await runDocker(["stop", name], context, { priority: "urgent" });
}

export async function waitContainer(name: string, context?: string): Promise<void> {
	await runDocker(["wait", name], context, { priority: "normal" });
}

export async function removeContainer(name: string, context?: string): Promise<void> {
	await runDocker(["rm", "-f", name], context, { priority: "normal" });
}

export async function runDetached(image: string, name: string, context?: string): Promise<void> {
	await runDocker(["run", "-d", "--name", name, image], context, { priority: "normal" });
}

export async function listImages(context?: string): Promise<string[]> {
	const out = await runDocker(["images", "--format", "{{.Repository}}:{{.Tag}}"], context, { priority: "normal" });
	return out
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s && s !== "<none>:<none>");
}

export async function listComposeProjects(context?: string): Promise<string[]> {
	const items = await listContainers(true, context);
	const set = new Set<string>();
	for (const it of items) {
		const composeProject = it.labels?.["com.docker.compose.project"]; // Compose v2
		const swarmStack = it.labels?.["com.docker.stack.namespace"]; // Swarm stack
		if (composeProject) set.add(composeProject);
		if (swarmStack) set.add(swarmStack);
	}
	try {
		const out = await runDocker(["compose", "ls", "-a", "--format", "json"], context, { priority: "high" });
		const arr: { Name: string }[] = JSON.parse(out);
		arr.forEach((it) => set.add(it.Name));
	} catch {}
	// Try Swarm stacks as well (if Swarm enabled)
	try {
		const out = await runDocker(["stack", "ls", "-a", "--format", "{{.Name}}"], context, { priority: "high" });
		out
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter(Boolean)
			.forEach((n) => set.add(n));
	} catch {}
	return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function containersByComposeProject(project: string, context?: string): Promise<PsItem[]> {
	// Match both compose and swarm label to support both workflows
	const viaCompose = await listContainers(true, context, ["label=com.docker.compose.project=" + project]).catch(
		() => [] as PsItem[],
	);
	const viaSwarm = await listContainers(true, context, ["label=com.docker.stack.namespace=" + project]).catch(
		() => [] as PsItem[],
	);
	// Merge unique by name
	const map = new Map<string, PsItem>();
	[...viaCompose, ...viaSwarm].forEach((it) => map.set(it.name, it));
	return Array.from(map.values());
}

// ---- Swarm helpers ----
export type SwarmService = { name: string; mode: string; replicasDesired?: number };

export async function listSwarmServicesInStack(stack: string, context?: string): Promise<SwarmService[]> {
	try {
		// Filter by stack label; parse name, mode, replicas (current/desired)
		const out = await runDocker(
			[
				"service",
				"ls",
				"--filter",
				`label=com.docker.stack.namespace=${stack}`,
				"--format",
				"{{.Name}}\t{{.Mode}}\t{{.Replicas}}",
			],
			context,
			{ priority: "normal" },
		);
		const services: SwarmService[] = [];
		for (const line of out.split(/\r?\n/)) {
			if (!line.trim()) continue;
			const [name, mode, replicas] = line.split("\t");
			let replicasDesired: number | undefined = undefined;
			if (replicas && replicas.includes("/")) {
				const parts = replicas.split("/");
				const desiredStr = parts[1];
				const parsed = parseInt(desiredStr, 10);
				replicasDesired = Number.isFinite(parsed) ? parsed : undefined;
			}
			services.push({ name, mode, replicasDesired });
		}
		return services;
	} catch {
		return [];
	}
}

export async function scaleSwarmService(name: string, replicas: number, context?: string): Promise<void> {
	await runDocker(["service", "scale", `${name}=${replicas}`], context, { priority: "normal" });
}

export async function isSwarmStack(stack: string, context?: string): Promise<boolean> {
	const svcs = await listSwarmServicesInStack(stack, context);
	return svcs.length > 0;
}
