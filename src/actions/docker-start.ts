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

		const dockerIsUp = await pingDocker(this.docker, ev, 2);
		if (!dockerIsUp) {
			this.updateInterval = setInterval(async () => {
				await this.updateContainerState(ev, containerName);
			}, 1000);
			return;
		}

		const containers = await this.docker.container.list({ all: true });
		const container = containers.find((c) => {
			const data = c.data as DockerContainerData;
			return data.Names.includes(`/${containerName}`);
		});

		if (container) {
			const data = container.data as DockerContainerData;
			status = data.State;
			const title = `${containerName}`;
			ev.action.setTitle(this.formatTitle(title));
		} else {
			ev.action.setTitle("Not Found");
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
		ev.action.setTitle(this.formatTitle(ev.payload?.settings?.containerName || "No\ntitle"));
	}

	override async onKeyDown(ev: KeyDownEvent) {
		const dockerIsUp = await pingDocker(this.docker, ev, 2);
		if (!dockerIsUp) {
			return;
		}
		
		clearInterval(this.updateInterval);
		const { containerName }: DockerStartSettings = ev.payload.settings;

		if (!containerName) {
			streamDeck.logger.error(`Container not found in key.`);
			return;
		}

		const containers = await this.docker.container.list({ all: true });
		const container = containers.find((c) => {
			const data = c.data as DockerContainerData;
			return data.Names.includes(`/${containerName}`);
		});

		if (!container) {
			streamDeck.logger.error(`Container ${containerName} not found.`);
			ev.action.setTitle("Not\nFound");
			return;
		}

		const data = container.data as DockerContainerData;
		if (data.State === "running") {
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
		const dockerIsUp = await pingDocker(this.docker, ev, 2);
		if (!dockerIsUp) {
			return;
		}

		ev.action.setTitle(this.formatTitle(containerName));
		const running = await this.isContainerRunning(containerName);
		const newState = running ? 0 : 1;
		ev.action.setState(newState);
	}

	private async isContainerRunning(containerName: String) {
		const containers = await this.docker.container.list({ all: true });
		const container = containers.find((c) => {
			const data = c.data as DockerContainerData;
			return data.Names.includes(`/${containerName}`);
		});

		if (!container) {
			return false;
		}

		const data = container.data as DockerContainerData;

		return data.State === "running" ? true : false;
	}

	private formatTitle(title: String) {
		return title.split("-").join("\n")
	}
}
