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
import { getContainersSnapshot, subscribeContainers, unsubscribeContainers } from "../utils/containerStore";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";
import { getDockerContextsSnapshot } from "../utils/contextsStore";
import { getContainerState, listImages, removeContainer, runDetached } from "../utils/dockerCli";
import { listDockerContexts } from "../utils/dockerContext";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { pingDocker } from "../utils/pingDocker";

/**
 * Settings for {@link DockerRunOrRm}.
 */
type DockerRunOrRmSettings = {
	containerName?: string;
	imageName?: string;
	status?: string;
	remoteHost?: string;
	contextName?: string;
};

interface DockerImageData {}
interface DockerContainerData {}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-run-or-rm" })
export class DockerRunOrRm extends SingletonAction<DockerRunOrRmSettings> {
	private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
	private lastSettingsByContext: Map<string, DockerRunOrRmSettings> = new Map();

	override async onWillAppear(ev: WillAppearEvent<DockerRunOrRmSettings>): Promise<void> {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		const context = await getEffectiveContext(ev.payload.settings as DockerRunOrRmSettings);
		subscribeContextHealth(context, instanceId, (up) => {
			if (!up) {
				ev.action.setTitle("Please, launch Docker");
				if (ev.action.isKey()) ev.action.setState(DOCKER_START_ERROR_STATE);
			} else {
				this.updateDockerState(ev);
			}
		});

		// Subscribe to container updates for immediate UI refresh
		subscribeContainers(context, instanceId, (map) => {
			const cn = (this.lastSettingsByContext.get(instanceId) || {}).containerName || "";
			if (!cn) return;
			const it = map.get(cn);
			if (!it) return;
			const newState = it.state === CONTAINER_STATUS_RUNNING ? 0 : 1;
			if (ev.action.isKey()) ev.action.setState(newState);
		});
		this.updateDockerState(ev);
		this.setIntervalFor(instanceId, () => this.updateDockerState(ev));
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerRunOrRmSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);
		const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
		unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
		unsubscribeContainers(context === "default" ? undefined : context, instanceId);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerRunOrRmSettings>): Promise<void> {
		if (ev.payload.event == "getImages") {
			const instanceId = (ev.action as any).id || (ev as any).context;
			const previous = this.lastSettingsByContext.get(instanceId) || {};
			const effective = { ...previous, ...(ev.payload.settings as DockerRunOrRmSettings) };
			const context = await getEffectiveContext(effective);
			const images = await listImages(context);
			const imageNames = images.map((name) => ({ label: name, value: name }));
			streamDeck.ui.sendToPropertyInspector({
				event: "getImages",
				items: imageNames,
			});
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

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const { imageName, containerName } = ev.payload.settings;
		if (!imageName) {
			streamDeck.logger.error("No image name specified.");
			return;
		}
		if (!containerName) {
			streamDeck.logger.error("No container name specified.");
			return;
		}

		try {
			const context = await getEffectiveContext(ev.payload.settings as DockerRunOrRmSettings);
			const state = await getContainerState(containerName.toString(), context);
			if (state) {
				await removeContainer(String(containerName), context);
			} else {
				await runDetached(String(imageName), String(containerName), context);
			}
		} catch (error: any) {
			streamDeck.logger.error(`Error handling container: ${error.message}`);
		}
	}

	private async updateDockerState(ev: any) {
		const context = await getEffectiveContext(ev.payload.settings as DockerRunOrRmSettings);
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) {
			return;
		}
		// Prefer store snapshot to avoid CLI call when possible
		const snap = getContainersSnapshot(context);
		let st: string | undefined = undefined;
		const cn = ev.payload.settings.containerName;
		if (snap && cn) st = snap.get(cn)?.state;
		if (!st && cn) st = await getContainerState(cn, context);
		const state = st ? 0 : 1;
		ev.action.setState(state);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerRunOrRmSettings>): void {
		this.lastSettingsByContext.set((ev as any).context, ev.payload?.settings || {});
	}

	private setIntervalFor(id: string, fn: () => Promise<void>) {
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
