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
import {
	containersByComposeProject,
	isSwarmStack,
	listComposeProjects,
	listSwarmServicesInStack,
	scaleSwarmService,
	startContainer,
	stopContainer,
	waitContainer,
} from "../utils/dockerCli";
import { listDockerContexts } from "../utils/dockerContext";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { pingDocker } from "../utils/pingDocker";
import { getStacksSnapshot, subscribeStacks, unsubscribeStacks } from "../utils/stacksStore";

type DockerStackStartSettings = {
	stackName?: string;
	remoteHost?: string;
	contextName?: string;
};

interface DockerContainerData {}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-stack-start" })
export class DockerStackStart extends SingletonAction<DockerStackStartSettings> {
	private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
	private currentStackNameByContext: Map<string, string | undefined> = new Map();
	private lastSettingsByContext: Map<string, DockerStackStartSettings> = new Map();

	// Prevent overlapping async updates and reduce flicker by only applying changes
	private updatingByContext: Map<string, boolean> = new Map();
	private lastStateByContext: Map<string, number | undefined> = new Map();
	private lastTitleByContext: Map<string, string | undefined> = new Map();
	// For Swarm stacks, remember desired replicas per service when scaling down
	private swarmDesiredByInstance: Map<string, Record<string, number>> = new Map();

	override async onWillAppear(ev: WillAppearEvent<DockerStackStartSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		const context = await getEffectiveContext(ev.payload.settings as DockerStackStartSettings);

		// Always record/display the selected stack name, even if Docker is down
		const { stackName } = ev.payload.settings;
		this.currentStackNameByContext.set(instanceId, stackName);
		if (stackName) {
			ev.action.setTitle(this.formatTitle(stackName));
		}

		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) {
			// Start polling so that when Docker starts, the state refreshes and
			// uses the previously remembered stack name instead of showing "No Stack".
			this.startUpdateLoop(ev, context);
			return;
		}
		// subscribe to health changes
		subscribeContextHealth(context, instanceId, (up) => {
			if (!up) {
				if (ev.action.isKey()) ev.action.setState(DOCKER_START_ERROR_STATE);
				ev.action.setTitle("Please, launch Docker");
			} else {
				this.updateStackState(ev, context);
			}
		});

		// Subscribe to stacks changes derived from container store
		subscribeStacks(context, instanceId, (stacks) => {
			const stackName2 = this.currentStackNameByContext.get(instanceId);
			if (!stackName2) return;
			const info = stacks.get(stackName2);
			if (!info) {
				this.applyIfChanged(ev, instanceId, "Not\nFound", 1);
				return;
			}
			this.applyIfChanged(ev, instanceId, this.formatTitle(stackName2), info.running > 0 ? 0 : 1);
		});

		// stackName already recorded above; keep UI in sync if provided

		await this.updateStackState(ev, context);
		this.startUpdateLoop(ev, context);
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerStackStartSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);
		this.lastStateByContext.delete(instanceId);
		this.lastTitleByContext.delete(instanceId);
		this.updatingByContext.delete(instanceId);
		const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
		unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
		unsubscribeStacks(context === "default" ? undefined : context, instanceId);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerStackStartSettings>): Promise<void> {
		if (ev.payload.event === "getStacks") {
			const instanceId = (ev.action as any).id || (ev as any).context;
			const previous = this.lastSettingsByContext.get(instanceId) || {};
			const effective = { ...previous, ...(ev.payload.settings as DockerStackStartSettings) };
			const context = await getEffectiveContext(effective);
			const snap = getStacksSnapshot(context);
			const items = snap
				? Array.from(snap.values()).map((s) => ({ label: s.name, value: s.name }))
				: (await this.listComposeStacks(context)).map((name) => ({ label: name, value: name }));
			streamDeck.ui.sendToPropertyInspector({ event: "getStacks", items });
		}
		if (ev.payload.event === "getDockerContexts") {
			const snap = getDockerContextsSnapshot();
			const items = snap
				? Array.from(snap.values()).map((c) => ({ label: c.name, value: c.name }))
				: (await listDockerContexts()).map((c) => ({ label: c.name, value: c.name }));
			streamDeck.ui.sendToPropertyInspector({ event: "getDockerContexts", items });
		}
		streamDeck.connect();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerStackStartSettings>): void {
		const { stackName } = ev.payload.settings || {};
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.currentStackNameByContext.set(instanceId, stackName);
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		ev.action.setTitle(this.formatTitle(stackName || "No\nStack"));
		// Refresh stacks in PI to reflect context change
		(async () => {
			const ctx = await getEffectiveContext(this.lastSettingsByContext.get(instanceId));
			const snap = getStacksSnapshot(ctx);
			const items = snap
				? Array.from(snap.values()).map((s) => ({ label: s.name, value: s.name }))
				: (await this.listComposeStacks(ctx)).map((n) => ({ label: n, value: n }));
			streamDeck.ui.sendToPropertyInspector({ event: "getStacks", items });
		})();
		// Immediate refresh
		getEffectiveContext(this.lastSettingsByContext.get(instanceId)).then((ctx) => {
			this.updateStackState(ev as any, ctx);
			this.clearIntervalFor(instanceId);
			this.startUpdateLoop(ev as any, ctx);
		});
	}

	override async onKeyDown(ev: KeyDownEvent<DockerStackStartSettings>): Promise<void> {
		const context = await getEffectiveContext(ev.payload.settings as DockerStackStartSettings);
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const instanceId = (ev.action as any).id || (ev as any).context;
		const stackName = this.currentStackNameByContext.get(instanceId);
		if (!stackName) {
			streamDeck.logger.error("No stack selected.");
			return;
		}

		const containers = await containersByComposeProject(stackName, context);
		let swarm = false;
		// If no containers, still check if it's a swarm stack (scaled to 0)
		try {
			swarm = await isSwarmStack(stackName, context);
		} catch {}

		if (!swarm && containers.length === 0) {
			ev.action.setTitle("Not\nFound");
			return;
		}

		if (swarm) {
			// Toggle by scaling services
			const running = containers.some((c) => c.state === CONTAINER_STATUS_RUNNING);
			if (running) {
				// Scale all services to 0 and remember desired replicas
				const services = await listSwarmServicesInStack(stackName, context);
				const desired: Record<string, number> = {};
				for (const s of services) {
					if (s.mode?.toLowerCase() === "global") {
						streamDeck.logger.warn(`Global service ${s.name} cannot be scaled; skipping.`);
						continue;
					}
					const target = Number.isFinite(s.replicasDesired as any) ? (s.replicasDesired as number) : 1;
					desired[s.name] = target;
					try {
						await scaleSwarmService(s.name, 0, context);
					} catch (e: any) {
						streamDeck.logger.warn(`Failed scaling service ${s.name} to 0: ${e?.message || e}`);
					}
				}
				this.swarmDesiredByInstance.set(instanceId, desired);
			} else {
				// Scale back to previous desired replicas (default 1)
				const remembered = this.swarmDesiredByInstance.get(instanceId) || {};
				const services = await listSwarmServicesInStack(stackName, context);
				for (const s of services) {
					if (s.mode?.toLowerCase() === "global") continue;
					const target =
						remembered[s.name] ?? (Number.isFinite(s.replicasDesired as any) ? (s.replicasDesired as number) : 1);
					try {
						await scaleSwarmService(s.name, Math.max(1, target), context);
					} catch (e: any) {
						streamDeck.logger.warn(`Failed scaling service ${s.name}: ${e?.message || e}`);
					}
				}
			}
		} else {
			// Compose-style: start/stop each container
			const allRunning = containers.every((c) => c.state === CONTAINER_STATUS_RUNNING);
			if (allRunning) {
				for (const c of containers) {
					try {
						await stopContainer(c.name, context).catch(() => {});
						await waitContainer(c.name, context).catch(() => {});
					} catch (e: any) {
						streamDeck.logger.warn(`Failed stopping container: ${e?.message || e}`);
					}
				}
			} else {
				for (const c of containers) {
					try {
						if (c.state !== CONTAINER_STATUS_RUNNING) {
							await startContainer(c.name, context).catch(() => {});
						}
					} catch (e: any) {
						streamDeck.logger.warn(`Failed starting container: ${e?.message || e}`);
					}
				}
			}
		}
	}

	private startUpdateLoop(ev: any, context?: string) {
		const instanceId2 = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId2);
		const handle = setInterval(async () => {
			await this.updateStackState(ev, context);
		}, 1000);
		this.updateIntervals.set(instanceId2, handle as any);
	}

	private async updateStackState(ev: any, context?: string): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		if (this.updatingByContext.get(instanceId)) return;
		this.updatingByContext.set(instanceId, true);
		try {
			const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
			if (!dockerIsUp) {
				// When Docker is down, remember last applied state to avoid oscillation
				this.lastStateByContext.set(instanceId, DOCKER_START_ERROR_STATE);
				this.lastTitleByContext.set(instanceId, undefined);
				return;
			}

			const stackName = this.currentStackNameByContext.get(instanceId);
			if (!stackName) {
				this.applyIfChanged(ev, instanceId, "No\nStack", 1);
				return;
			}

			const containers = await containersByComposeProject(stackName, context);
			let swarm = false;
			try {
				swarm = await isSwarmStack(stackName, context);
			} catch {}

			let title = this.formatTitle(stackName);
			if (swarm) {
				// For swarm stacks, existence is based on services, not containers
				const running = containers.filter((c) => c.state === CONTAINER_STATUS_RUNNING).length;
				this.applyIfChanged(ev, instanceId, title, running > 0 ? 0 : 1);
			} else {
				if (containers.length === 0) {
					this.applyIfChanged(ev, instanceId, "Not\nFound", 1);
					return;
				}
				const running = containers.filter((c) => c.state === CONTAINER_STATUS_RUNNING).length;
				const allRunning = running === containers.length;
				this.applyIfChanged(ev, instanceId, title, allRunning ? 0 : 1);
			}
		} finally {
			this.updatingByContext.delete(instanceId);
		}
	}

	private async listComposeStacks(context?: string): Promise<string[]> {
		return listComposeProjects(context);
	}

	private clearIntervalFor(id: string) {
		const h = this.updateIntervals.get(id);
		if (h) {
			clearInterval(h);
			this.updateIntervals.delete(id);
		}
	}

	private formatTitle(title: string) {
		return title.split("-").join("\n");
	}

	private applyIfChanged(ev: any, id: string, title: string, state: number) {
		const prevTitle = this.lastTitleByContext.get(id);
		const prevState = this.lastStateByContext.get(id);
		if (prevTitle !== title) {
			ev.action.setTitle(title);
			this.lastTitleByContext.set(id, title);
		}
		if (prevState !== state) {
			ev.action.setState(state);
			this.lastStateByContext.set(id, state);
		}
	}
}
