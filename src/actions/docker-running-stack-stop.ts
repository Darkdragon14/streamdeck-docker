import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";
import { getDockerContextsSnapshot } from "../utils/contextsStore";
import { listContainers } from "../utils/dockerCli";
import { listDockerContexts } from "../utils/dockerContext";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { pingDocker } from "../utils/pingDocker";
import { stopStackLifecycle } from "../utils/stackLifecycle";
import { getStacksSnapshot, subscribeStacks, unsubscribeStacks } from "../utils/stacksStore";
import type { StackInfo } from "../utils/stacksStore";

type RunningStackStopSettings = {
	contextName?: string;
};

type VisibleInstance = {
	id: string;
	action: any;
	context?: string;
	deviceId?: string;
	row?: number;
	column?: number;
};

const visibleByContext = new Map<string, Map<string, VisibleInstance>>();
const assignedStackByInstance = new Map<string, string | undefined>();
const swarmDesiredByInstance = new Map<string, Record<string, number>>();
const stackSlotByContext = new Map<string, Map<string, string>>();

function keyFor(context?: string): string {
	return context || "__local__";
}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-running-stack-stop" })
export class DockerRunningStackStop extends SingletonAction<RunningStackStopSettings> {
	private lastSettingsByContext: Map<string, RunningStackStopSettings> = new Map();
	private lastStateByContext: Map<string, number | undefined> = new Map();
	private lastTitleByContext: Map<string, string | undefined> = new Map();
	private updateIntervalsByContext: Map<string, NodeJS.Timeout> = new Map();
	private updatingByContext: Map<string, boolean> = new Map();

	override async onWillAppear(ev: WillAppearEvent<RunningStackStopSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		const context = await getEffectiveContext(ev.payload.settings);
		this.registerVisibleInstance(instanceId, ev.action, context);
		this.startUpdateLoop(context);

		subscribeContextHealth(context, instanceId, (up) => {
			if (!up) {
				this.applyIfChanged(ev.action, instanceId, "Please,\nlaunch\nDocker", DOCKER_START_ERROR_STATE);
				return;
			}
			this.updateAssignments(context);
		});

		subscribeStacks(context, instanceId, (stacks) => {
			this.updateAssignments(context, stacks);
		});

		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		await this.refreshAssignments(context);
	}

	override onWillDisappear(ev: WillDisappearEvent<RunningStackStopSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		const context = getContextFromSettings(this.lastSettingsByContext.get(instanceId));
		this.unregisterVisibleInstance(instanceId, context);
		unsubscribeContextHealth(context, instanceId);
		unsubscribeStacks(context, instanceId);
		assignedStackByInstance.delete(instanceId);
		swarmDesiredByInstance.delete(instanceId);
		this.lastSettingsByContext.delete(instanceId);
		this.lastStateByContext.delete(instanceId);
		this.lastTitleByContext.delete(instanceId);
		this.stopUpdateLoopIfUnused(context);
		this.refreshAssignments(context).catch(() => undefined);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RunningStackStopSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		const previousContext = getContextFromSettings(this.lastSettingsByContext.get(instanceId));
		const nextSettings = ev.payload.settings || {};
		const nextContext = await getEffectiveContext(nextSettings);

		this.unregisterVisibleInstance(instanceId, previousContext);
		unsubscribeContextHealth(previousContext, instanceId);
		unsubscribeStacks(previousContext, instanceId);

		this.lastSettingsByContext.set(instanceId, nextSettings);
		this.registerVisibleInstance(instanceId, ev.action, nextContext);
		this.stopUpdateLoopIfUnused(previousContext);
		this.startUpdateLoop(nextContext);
		subscribeContextHealth(nextContext, instanceId, (up) => {
			if (!up) {
				this.applyIfChanged(ev.action, instanceId, "Please,\nlaunch\nDocker", DOCKER_START_ERROR_STATE);
				return;
			}
			this.updateAssignments(nextContext);
		});
		subscribeStacks(nextContext, instanceId, (stacks) => this.updateAssignments(nextContext, stacks));

		await this.refreshAssignments(previousContext);
		await this.refreshAssignments(nextContext);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, RunningStackStopSettings>): Promise<void> {
		if (ev.payload.event === "getDockerContexts") {
			const snap = getDockerContextsSnapshot();
			const items = snap
				? Array.from(snap.values()).map((c) => ({ label: c.name, value: c.name }))
				: (await listDockerContexts()).map((c) => ({ label: c.name, value: c.name }));
			streamDeck.ui.sendToPropertyInspector({ event: "getDockerContexts", items });
		}
	}

	override async onKeyDown(ev: KeyDownEvent<RunningStackStopSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		const context = await getEffectiveContext(ev.payload.settings);
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const stackName = assignedStackByInstance.get(instanceId);
		if (!stackName) {
			this.applyIfChanged(ev.action, instanceId, "Empty", 1);
			return;
		}

		const result = await stopStackLifecycle(stackName, context, (desired) => swarmDesiredByInstance.set(instanceId, desired));
		if (result === "not-found") {
			this.applyIfChanged(ev.action, instanceId, "Not\nFound", 1);
			return;
		}

		await this.refreshAssignments(context);
	}

	private registerVisibleInstance(id: string, actionRef: any, context?: string): void {
		const key = keyFor(context);
		let instances = visibleByContext.get(key);
		if (!instances) {
			instances = new Map();
			visibleByContext.set(key, instances);
		}
		instances.set(id, {
			id,
			action: actionRef,
			context,
			deviceId: actionRef?.device?.id,
			row: actionRef?.coordinates?.row,
			column: actionRef?.coordinates?.column,
		});
	}

	private unregisterVisibleInstance(id: string, context?: string): void {
		const key = keyFor(context);
		const instances = visibleByContext.get(key);
		if (!instances) return;
		instances.delete(id);
		if (instances.size === 0) visibleByContext.delete(key);
	}

	private updateAssignments(context?: string, stacks = getStacksSnapshot(context)): void {
		const contextKey = keyFor(context);
		const instances = Array.from(visibleByContext.get(contextKey)?.values() || []).sort(compareInstancesByPosition);
		const runningStacks = Array.from(stacks?.values() || [])
			.filter((stack) => stack.running > 0)
			.sort((a, b) => a.name.localeCompare(b.name));
		const visibleInstanceIds = new Set(instances.map((instance) => instance.id));
		const slots = this.getStackSlots(contextKey);
		for (const [stackName, instanceId] of slots) {
			if (!visibleInstanceIds.has(instanceId)) slots.delete(stackName);
		}

		const assignedInstanceIds = new Set<string>();
		for (const stack of runningStacks) {
			const slottedInstanceId = slots.get(stack.name);
			if (slottedInstanceId && visibleInstanceIds.has(slottedInstanceId) && !assignedInstanceIds.has(slottedInstanceId)) {
				assignedInstanceIds.add(slottedInstanceId);
			}
		}

		for (const stack of runningStacks) {
			const slottedInstanceId = slots.get(stack.name);
			if (slottedInstanceId && assignedInstanceIds.has(slottedInstanceId)) continue;

			const nextInstance = instances.find((instance) => !assignedInstanceIds.has(instance.id));
			if (!nextInstance) continue;

			removeReservationsForInstance(slots, stack.name, nextInstance.id);
			slots.set(stack.name, nextInstance.id);
			assignedInstanceIds.add(nextInstance.id);
		}

		const runningStackByInstance = new Map<string, StackInfo>();
		for (const stack of runningStacks) {
			const instanceId = slots.get(stack.name);
			if (instanceId) runningStackByInstance.set(instanceId, stack);
		}

		instances.forEach((instance) => {
			const stack = runningStackByInstance.get(instance.id);
			assignedStackByInstance.set(instance.id, stack?.name);
			if (!stack) {
				this.applyIfChanged(instance.action, instance.id, "Empty", 1);
				return;
			}
			this.applyIfChanged(instance.action, instance.id, this.formatTitle(stack), 0);
		});
	}

	private getStackSlots(contextKey: string): Map<string, string> {
		let slots = stackSlotByContext.get(contextKey);
		if (!slots) {
			slots = new Map();
			stackSlotByContext.set(contextKey, slots);
		}
		return slots;
	}

	private async refreshAssignments(context?: string): Promise<void> {
		const contextKey = keyFor(context);
		if (this.updatingByContext.get(contextKey)) return;
		this.updatingByContext.set(contextKey, true);
		try {
			const stacks = await this.listRunningStacks(context);
			this.updateAssignments(context, stacks);
		} catch {
			this.updateAssignments(context);
		} finally {
			this.updatingByContext.delete(contextKey);
		}
	}

	private async listRunningStacks(context?: string): Promise<Map<string, StackInfo>> {
		const containers = await listContainers(true, context);
		const stacks = new Map<string, StackInfo>();
		for (const container of containers) {
			const labels = container.labels || {};
			const name = labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"];
			if (!name) continue;

			const existing = stacks.get(name) || { name, running: 0, total: 0 };
			existing.total += 1;
			if (container.state === CONTAINER_STATUS_RUNNING) existing.running += 1;
			stacks.set(name, existing);
		}
		for (const [name, stack] of stacks) {
			if (stack.running === 0) stacks.delete(name);
		}
		return stacks;
	}

	private startUpdateLoop(context?: string): void {
		const contextKey = keyFor(context);
		if (this.updateIntervalsByContext.has(contextKey)) return;
		const handle = setInterval(() => {
			this.refreshAssignments(context).catch(() => undefined);
		}, 1500);
		this.updateIntervalsByContext.set(contextKey, handle as any);
	}

	private stopUpdateLoopIfUnused(context?: string): void {
		const contextKey = keyFor(context);
		if ((visibleByContext.get(contextKey)?.size || 0) > 0) return;
		const handle = this.updateIntervalsByContext.get(contextKey);
		if (!handle) return;
		clearInterval(handle);
		this.updateIntervalsByContext.delete(contextKey);
		this.updatingByContext.delete(contextKey);
	}

	private formatTitle(stack: StackInfo): string {
		return stack.name.split("-").join("\n");
	}

	private applyIfChanged(actionRef: any, id: string, title: string, state: number): void {
		const prevTitle = this.lastTitleByContext.get(id);
		const prevState = this.lastStateByContext.get(id);
		if (prevTitle !== title) {
			actionRef.setTitle(title);
			this.lastTitleByContext.set(id, title);
		}
		if (prevState !== state) {
			actionRef.setState(state);
			this.lastStateByContext.set(id, state);
		}
	}
}

function getContextFromSettings(settings?: RunningStackStopSettings): string | undefined {
	const contextName = (settings?.contextName ?? "").toString();
	if (!contextName || contextName === "default") return undefined;
	return contextName;
}

function compareInstancesByPosition(a: VisibleInstance, b: VisibleInstance): number {
	const device = (a.deviceId || "").localeCompare(b.deviceId || "");
	if (device !== 0) return device;

	const aHasPosition = Number.isFinite(a.row) && Number.isFinite(a.column);
	const bHasPosition = Number.isFinite(b.row) && Number.isFinite(b.column);
	if (aHasPosition && bHasPosition) {
		const row = (a.row as number) - (b.row as number);
		if (row !== 0) return row;
		const column = (a.column as number) - (b.column as number);
		if (column !== 0) return column;
	}
	if (aHasPosition !== bHasPosition) return aHasPosition ? -1 : 1;

	return a.id.localeCompare(b.id);
}

function removeReservationsForInstance(slots: Map<string, string>, currentStackName: string, instanceId: string): void {
	for (const [stackName, slottedInstanceId] of slots) {
		if (stackName !== currentStackName && slottedInstanceId === instanceId) slots.delete(stackName);
	}
}
