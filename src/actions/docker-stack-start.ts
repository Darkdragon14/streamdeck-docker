import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	JsonObject,
	KeyDownEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";
import {
	containersByComposeProject,
	listComposeProjects,
	startContainer,
	stopContainer,
	waitContainer,
} from "../utils/dockerCli";
import { listDockerContexts } from "../utils/dockerContext";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { pingDocker } from "../utils/pingDocker";

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

	override async onWillAppear(ev: WillAppearEvent<DockerStackStartSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		const context = await getEffectiveContext(ev.payload.settings as DockerStackStartSettings);
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) {
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

		const { stackName } = ev.payload.settings;
		this.currentStackNameByContext.set(instanceId, stackName);
		if (stackName) {
			ev.action.setTitle(this.formatTitle(stackName));
		}

		await this.updateStackState(ev, context);
		this.startUpdateLoop(ev, context);
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerStackStartSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);
		const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
		unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerStackStartSettings>): Promise<void> {
		if (ev.payload.event === "getStacks") {
			const instanceId = (ev.action as any).id || (ev as any).context;
			const previous = this.lastSettingsByContext.get(instanceId) || {};
			const effective = { ...previous, ...(ev.payload.settings as DockerStackStartSettings) };
			const context = await getEffectiveContext(effective);
			const stacks = await this.listComposeStacks(context);
			const items = stacks.map((name) => ({ label: name, value: name }));
			streamDeck.ui.current?.sendToPropertyInspector({ event: "getStacks", items });
		}
		if (ev.payload.event === "getDockerContexts") {
			const contexts = await listDockerContexts();
			const items = [
				...contexts.map((c) => ({ label: c.name, value: c.name })),
			];
			streamDeck.ui.current?.sendToPropertyInspector({ event: "getDockerContexts", items });
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
			const stacks = await this.listComposeStacks(ctx);
			streamDeck.ui.current?.sendToPropertyInspector({
				event: "getStacks",
				items: stacks.map((n) => ({ label: n, value: n })),
			});
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
		if (containers.length === 0) {
			ev.action.setTitle("Not\nFound");
			return;
		}

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

	private startUpdateLoop(ev: any, context?: string) {
		const instanceId2 = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId2);
		const handle = setInterval(async () => {
			await this.updateStackState(ev, context);
		}, 1000);
		this.updateIntervals.set(instanceId2, handle as any);
	}

	private async updateStackState(ev: any, context?: string): Promise<void> {
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const instanceId = (ev.action as any).id || (ev as any).context;
		const stackName = this.currentStackNameByContext.get(instanceId);
		if (!stackName) {
			ev.action.setTitle("No\nStack");
			ev.action.setState(1);
			return;
		}

		const containers = await containersByComposeProject(stackName, context);
		if (containers.length === 0) {
			ev.action.setTitle("Not\nFound");
			ev.action.setState(1);
			return;
		}

		const running = containers.filter((c) => c.state === CONTAINER_STATUS_RUNNING).length;
		const allRunning = running === containers.length;
		ev.action.setTitle(this.formatTitle(stackName));
		ev.action.setState(allRunning ? 0 : 1);
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
}
