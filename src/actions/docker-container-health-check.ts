import streamDeck, {
	action,
	DidReceiveSettingsEvent, SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import {
	CONTAINER_COUNT_ERROR_STATE, CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE
} from "../constants/docker";
import {getContainerState} from "../utils/dockerCli";
import {getEffectiveContext} from "../utils/getEffectiveContext";
import {pingDocker} from "../utils/pingDocker";
import type {JsonObject} from "@elgato/utils";
import {getDockerContextsSnapshot} from "../utils/contextsStore";
import {listDockerContexts} from "../utils/dockerContext";
import {subscribeContextHealth, unsubscribeContextHealth} from "../utils/contextHealth";
import {getContainersSnapshot, subscribeContainers, unsubscribeContainers} from "../utils/containerStore";

type DockerHealthSettings = {
	contextName?: string;
	containerName?: string;
};

@action({UUID: "com.darkdragon14.elgato-docker.container-health-check"})
export class DockerContainerHealthCheck extends SingletonAction<DockerHealthSettings> {
	private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
	private lastSettingsByContext: Map<string, DockerHealthSettings> = new Map();

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerHealthSettings>): Promise<void> {
		if (ev.payload.event === "getDockerContexts") {
			const snap = getDockerContextsSnapshot();
			const items = snap
				? Array.from(snap.values()).map((c) => ({label: c.name, value: c.name}))
				: (await listDockerContexts()).map((c) => ({label: c.name, value: c.name}));
			await streamDeck.ui.sendToPropertyInspector({event: "getDockerContexts", items});
		}
		await streamDeck.connect();
	}

	override async onWillAppear(ev: WillAppearEvent<DockerHealthSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		let {containerName}: DockerHealthSettings = ev.payload.settings;

		if (!containerName) {
			if (ev.action.isKey()) {
				await ev.action.setState(3);
			} else {
				await ev.action.setTitle("Container name not set");
			}
			return
		}

		const ctx = await getEffectiveContext(ev.payload.settings as any);
		subscribeContextHealth(ctx, instanceId, (up) => {
			if (!up) {
				if (ev.action.isKey()) {
					ev.action.setState(DOCKER_START_ERROR_STATE);
				} else {
					ev.action.setTitle("Please, launch Docker");
				}
			} else {
				const cur = this.lastSettingsByContext.get(instanceId)?.containerName;
				if (cur) this.updateContainersList(ev, cur);
			}
		});

		// Subscribe to central container store for this context
		subscribeContainers(ctx, instanceId, () => {
			const cur = this.lastSettingsByContext.get(instanceId)?.containerName;
			if (cur) this.updateContainersList(ev, cur);
		});

		this.updateContainersList(ev, containerName)
			.then(() => {
				this.setIntervalFor(instanceId, () => {
					const cur = this.lastSettingsByContext.get(instanceId)?.containerName;
					if (cur) return this.updateContainersList(ev, cur);
				});
			});
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerHealthSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);
		const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
		unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
		unsubscribeContainers(context === "default" ? undefined : context, instanceId);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerHealthSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);

		const containerName = ev.payload?.settings?.containerName
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		if (!containerName) {
			if (ev.action.isKey()) {
				ev.action.setState(3);
			} else {
				ev.action.setTitle("Container name not set");
			}
			return
		}

		this.updateContainersList(ev, containerName)
			.then(() => {
				this.setIntervalFor(instanceId, () => {
					const cur = this.lastSettingsByContext.get(instanceId)?.containerName;
					if (cur) return this.updateContainersList(ev, cur);
				});
			});
	}

	private async updateContainersList(ev: any, containerName: string) {
		const instanceId = (ev.action as any).id || (ev as any).context;
		const previous = this.lastSettingsByContext.get(instanceId) || {};
		const effective = {...previous, ...(ev.payload.settings as DockerHealthSettings)};
		const context = await getEffectiveContext(effective);
		const dockerIsUp = await pingDocker(ev, CONTAINER_COUNT_ERROR_STATE, context);
		if (!dockerIsUp) {
			if (ev.action.isKey()) {
				ev.action.setState(DOCKER_START_ERROR_STATE);
			} else {
				ev.action.setTitle("Please, launch Docker");
			}
			return;
		}

		// Prefer snapshot from central store; fallback to direct CLI if not ready
		let status: string | undefined = undefined;
		const snap = getContainersSnapshot(context);
		if (snap && snap.size >= 0) {
			for (const [, it] of snap) if (it.state === CONTAINER_STATUS_RUNNING && it.name === containerName) status = it.state;
		} else {
			status = await getContainerState(containerName, context);
		}

		if (!status) {
			ev.action.setState(3);
			return
		}

		ev.action.setState(status === CONTAINER_STATUS_RUNNING ? 1 : 0);
	}

	private setIntervalFor(id: string, fn: () => Promise<void> | void) {
		const h = this.updateIntervals.get(id);
		if (h) clearInterval(h);
		const handle = setInterval(async () => {
			await fn();
		}, 1000);
		this.updateIntervals.set(id, handle as any);
	}

	private clearIntervalFor(id: string) {
		const h = this.updateIntervals.get(id);
		if (h) {
			clearInterval(h);
			this.updateIntervals.delete(id);
		}
	}
}
