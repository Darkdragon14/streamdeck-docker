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

import { DOCKER_START_ERROR_STATE } from "../constants/docker";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";
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
		this.updateDockerState(ev);
		this.setIntervalFor(instanceId, () => this.updateDockerState(ev));
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerRunOrRmSettings>): void {
		const instanceId = (ev.action as any).id || (ev as any).context;
		this.clearIntervalFor(instanceId);
		const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
		unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerRunOrRmSettings>): Promise<void> {
		if (ev.payload.event == "getImages") {
			const instanceId = (ev.action as any).id || (ev as any).context;
			const previous = this.lastSettingsByContext.get(instanceId) || {};
			const effective = { ...previous, ...(ev.payload.settings as DockerRunOrRmSettings) };
			const context = await getEffectiveContext(effective);
			const images = await listImages(context);
			const imageNames = images.map((name) => ({ label: name, value: name }));
			streamDeck.ui.current?.sendToPropertyInspector({
				event: "getImages",
				items: imageNames,
			});
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
		const st = await getContainerState(ev.payload.settings.containerName, context);
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
