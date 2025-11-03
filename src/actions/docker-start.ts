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
import { pingDocker } from "../utils/pingDocker";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { listContainers, getContainerState, startContainer, stopContainer, waitContainer } from "../utils/dockerCli";
import { listDockerContexts } from "../utils/dockerContext";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";

/**
 * Settings for {@link DockerStart}.
 */
type DockerStartSettings = {
	containerName?: string;
	status?: string;
    contextName?: string;
};

interface DockerContainerData {}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-start" })
export class DockerStart extends SingletonAction<DockerStartSettings> {
	private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
    private lastSettingsByContext: Map<string, DockerStartSettings> = new Map();

	override async onWillAppear(ev: WillAppearEvent<DockerStartSettings>): Promise<void> {
		let { containerName, status }: DockerStartSettings = ev.payload.settings;
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
		if (!containerName) {
			containerName = "";
		}

		const context = await getEffectiveContext(ev.payload.settings as DockerStartSettings);
        const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
        // subscribe to context health changes to update immediately across keys
        subscribeContextHealth(context, instanceId, (up) => {
            if (!up) {
                if (ev.action.isKey()) ev.action.setState(DOCKER_START_ERROR_STATE);
                ev.action.setTitle("Please, launch Docker");
            } else {
                const cn = (this.lastSettingsByContext.get(instanceId) || {}).containerName || "";
                if (cn) this.updateContainerState(ev, cn, context);
            }
        });
        if (!dockerIsUp) {
            this.setIntervalFor((ev as any).context, () => this.updateContainerState(ev, containerName!, context));
            return;
        }

		const state = await getContainerState(containerName, context);

		if (state) {
			status = state;
			const title = `${containerName}`;
			ev.action.setTitle(this.formatTitle(title));
		} else {
			ev.action.setTitle("Not\nFound");
		}

		await this.updateContainerState(ev, containerName, context);

        this.setIntervalFor(instanceId, () => this.updateContainerState(ev, containerName!, context));
	}

    override onWillDisappear(ev: WillDisappearEvent<DockerStartSettings>): void {
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.clearIntervalFor(instanceId);
        const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
        unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
    }

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerStartSettings>): Promise<void> {
		if (ev.payload.event == "getContainers") {
            const instanceId = (ev.action as any).id || (ev as any).context;
            const previous = this.lastSettingsByContext.get(instanceId) || {};
			const effective = { ...previous, ...(ev.payload.settings as DockerStartSettings) };
			const context = await getEffectiveContext(effective);
			const items = await listContainers(true, context);
			const containerNames = items.map((it) => ({ label: it.name, value: it.name }));
			streamDeck.ui.current?.sendToPropertyInspector({
				event: "getContainers",
				items: containerNames,
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

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerStartSettings>): void {
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.lastSettingsByContext.set(instanceId, ev.payload?.settings || {});
		const cn = ev.payload?.settings?.containerName;
		if (cn) ev.action.setTitle(this.formatTitle(cn));
		// Re-evaluate state immediately to avoid flicker
        const { containerName } = this.lastSettingsByContext.get(instanceId) || {};
		if (containerName) {
            getEffectiveContext(this.lastSettingsByContext.get(instanceId)).then((ctx) => {
                this.updateContainerState(ev, containerName!, ctx);
                this.clearIntervalFor(instanceId);
                this.setIntervalFor(instanceId, () => this.updateContainerState(ev, containerName!, ctx));
            });
		}
		// Refresh PI containers list according to context
		(async () => {
            const ctx = await getEffectiveContext(this.lastSettingsByContext.get(instanceId));
            const items = await listContainers(true, ctx);
            streamDeck.ui.current?.sendToPropertyInspector({ event: "getContainers", items: items.map((it) => ({ label: it.name, value: it.name })) });
        })();
    }

	override async onKeyDown(ev: KeyDownEvent) {
		const context = await getEffectiveContext(ev.payload.settings as DockerStartSettings);
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) {
			return;
		}

        const instanceId = (ev.action as any).id || (ev as any).context;
        this.clearIntervalFor(instanceId);
		const { containerName }: DockerStartSettings = ev.payload.settings;

		if (!containerName) {
			streamDeck.logger.error(`Container not found in key.`);
			return;
		}

		const state = await getContainerState(containerName, context);
		if (!state) {
			ev.action.setTitle("Not\nFound");
			return;
		}

		if (state === CONTAINER_STATUS_RUNNING) {
			await stopContainer(containerName, context);
			await waitContainer(containerName, context);
		} else {
			await startContainer(containerName, context);
		}

        this.setIntervalFor(instanceId, () => this.updateContainerState(ev, containerName!, context));
	}

	private async updateContainerState(ev: any, containerName: String, context?: string) {
		const dockerIsUp = await pingDocker(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) {
			return;
		}

		ev.action.setTitle(this.formatTitle(containerName));
		const st = await getContainerState(containerName.toString(), context);
		const newState = st === CONTAINER_STATUS_RUNNING ? 0 : 1;
		ev.action.setState(newState);
	}

	private formatTitle(title: String) {
		return title.split("-").join("\n");
	}

	private setIntervalFor(id: string, fn: () => Promise<void>) {
		this.clearIntervalFor(id);
		const handle = setInterval(async () => { await fn(); }, 1000);
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
