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
import { Docker } from "node-docker-api";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { getContainer } from "../utils/getContainer";
import { isContainerRunning } from "../utils/getContainerRunning";
import { pingDocker } from "../utils/pingDocker";

/**
 * Settings for {@link DockerStart}.
 */
type DockerStartSettings = {
	containerName?: string;
	status?: string;
};

interface DockerContainerData {
	Names: string[];
	State: string;
}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-start" })
export class DockerStart extends SingletonAction<DockerStartSettings> {
	private updateInterval: NodeJS.Timeout | undefined;
	private docker: Docker;

	constructor(docker: Docker) {
		super();
		this.docker = docker;
	}

	override async onWillAppear(ev: WillAppearEvent<DockerStartSettings>): Promise<void> {
		let { containerName, status }: DockerStartSettings = ev.payload.settings;
		if (!containerName) {
			containerName = "";
		}

		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) {
			this.updateInterval = setInterval(async () => {
				await this.updateContainerState(ev, containerName);
			}, 1000);
			return;
		}

		const container = await getContainer(this.docker, containerName);

		if (container) {
			const data = container.data as DockerContainerData;
			status = data.State;
			const title = `${containerName}`;
			ev.action.setTitle(this.formatTitle(title));
		} else {
			ev.action.setTitle("Not\nFound");
		}

		await this.updateContainerState(ev, containerName);

		this.updateInterval = setInterval(async () => {
			await this.updateContainerState(ev, containerName);
		}, 1000);
	}

	override onWillDisappear(_ev: WillDisappearEvent<DockerStartSettings>): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerStartSettings>): Promise<void> {
		if (ev.payload.event == "getContainers") {
			const containers = await this.docker.container.list({ all: true });
			const containerNames = containers.map((c) => {
				const data = c.data as DockerContainerData;
				const name = data.Names[0].replace("/", "");
				return {
					label: name,
					value: name,
				};
			});
			streamDeck.ui.current?.sendToPropertyInspector({
				event: "getContainers",
				items: containerNames,
			});
		}
		streamDeck.connect();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerStartSettings>): void {
		ev.action.setTitle(this.formatTitle(ev.payload?.settings?.containerName || "No\nTitle"));
	}

	override async onKeyDown(ev: KeyDownEvent) {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) {
			return;
		}

		clearInterval(this.updateInterval);
		const { containerName }: DockerStartSettings = ev.payload.settings;

		if (!containerName) {
			streamDeck.logger.error(`Container not found in key.`);
			return;
		}

		const container = await getContainer(this.docker, containerName);

		if (!container) {
			ev.action.setTitle("Not\nFound");
			return;
		}

		const data = container.data as DockerContainerData;
		if (data.State === CONTAINER_STATUS_RUNNING) {
			await container.stop();
			// Waiting the container are stopped
			await container.wait();
		} else {
			await container.start();
		}

		this.updateInterval = setInterval(async () => {
			await this.updateContainerState(ev, containerName);
		}, 1000);
	}

	private async updateContainerState(ev: any, containerName: String) {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) {
			return;
		}

		ev.action.setTitle(this.formatTitle(containerName));
		const running = await isContainerRunning(this.docker, containerName);
		const newState = running ? 0 : 1;
		ev.action.setState(newState);
	}

	private formatTitle(title: String) {
		return title.split("-").join("\n");
	}
}
