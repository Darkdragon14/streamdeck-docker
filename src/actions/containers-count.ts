import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	JsonObject,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { CONTAINER_COUNT_ERROR_STATE, CONTAINER_LIST_ALL_STATUS } from "../constants/docker";
import { pingDocker } from "../utils/pingDocker";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { listDockerContexts } from "../utils/dockerContext";
import { listContainers } from "../utils/dockerCli";
import { subscribeContextHealth, unsubscribeContextHealth } from "../utils/contextHealth";

/**
 * Settings for {@link containersList}.
 */
type ContainersListSettings = {
	status?: string;
    remoteHost?: string;
    contextName?: string;
};

type ContainerListOptions = {
	all?: boolean;
	status?: string;
};

@action({ UUID: "com.darkdragon14.elgato-docker.containers-count" })
export class ContainersCount extends SingletonAction<ContainersListSettings> {
    private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
    private lastSettingsByContext: Map<string, ContainersListSettings> = new Map();

    constructor() { super(); }

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, ContainersListSettings>): Promise<void> {
		if (ev.payload.event === "getDockerContexts") {
			const contexts = await listDockerContexts();
			const items = [
				...contexts.map((c) => ({ label: c.name, value: c.name })),
			];
			streamDeck.ui.current?.sendToPropertyInspector({ event: "getDockerContexts", items });
		}
		streamDeck.connect();
	}

    override async onWillAppear(ev: WillAppearEvent<ContainersListSettings>): Promise<void> {
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
        let { status }: ContainersListSettings = ev.payload.settings;

		if (!status) {
			status = CONTAINER_LIST_ALL_STATUS;
		}

        const ctx = await getEffectiveContext(ev.payload.settings as any);
        subscribeContextHealth(ctx, instanceId, (up) => {
            if (!up) {
                ev.action.setTitle("Please, launch Docker");
                if (ev.action.isKey()) ev.action.setState(CONTAINER_COUNT_ERROR_STATE);
            } else {
                const cur = (this.lastSettingsByContext.get(instanceId) || {}).status || CONTAINER_LIST_ALL_STATUS;
                this.updateContainersList(ev, cur);
            }
        });
        this.updateContainersList(ev, status);
        this.setIntervalFor(instanceId, () => {
            const cur = (this.lastSettingsByContext.get(instanceId) || {}).status || CONTAINER_LIST_ALL_STATUS;
            return this.updateContainersList(ev, cur);
        });
    }

    override onWillDisappear(ev: WillDisappearEvent<ContainersListSettings>): void {
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.clearIntervalFor(instanceId);
        const context = (this.lastSettingsByContext.get(instanceId) || {}).contextName;
        unsubscribeContextHealth(context === "default" ? undefined : context, instanceId);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ContainersListSettings>): void {
        const instanceId = (ev.action as any).id || (ev as any).context;
        this.clearIntervalFor(instanceId);
        const status = ev.payload?.settings?.status || CONTAINER_LIST_ALL_STATUS;
        this.lastSettingsByContext.set(instanceId, ev.payload.settings || {});
        this.updateContainersList(ev, status);
        // Interval reads latest status dynamically
        this.setIntervalFor(instanceId, () => {
            const cur = (this.lastSettingsByContext.get(instanceId) || {}).status || CONTAINER_LIST_ALL_STATUS;
            return this.updateContainersList(ev, cur);
        });
    }

	private async updateContainersList(ev: any, status: string) {
        const instanceId = (ev.action as any).id || (ev as any).context;
        const previous = this.lastSettingsByContext.get(instanceId) || {};
        const effective = { ...previous, ...(ev.payload.settings as ContainersListSettings) };
        const context = await getEffectiveContext(effective);
		const dockerIsUp = await pingDocker(ev, CONTAINER_COUNT_ERROR_STATE, context);
		if (!dockerIsUp) {
			return;
		}
		ev.action.setState(0);

		const options: ContainerListOptions = {};
		if (status === CONTAINER_LIST_ALL_STATUS) {
			options.all = true;
		} else {
			options.status = status;
		}
		const filters: string[] = [];
		if (options.status) filters.push(`status=${options.status}`);
		const containers = await listContainers(!!options.all, context, filters);

		const title = `${status}\n${containers.length}`;

		ev.action.setTitle(title);
	}

    private setIntervalFor(id: string, fn: () => Promise<void>) {
        const h = this.updateIntervals.get(id);
        if (h) clearInterval(h);
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
