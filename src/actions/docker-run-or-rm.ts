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

import { DOCKER_START_ERROR_STATE } from "../constants/docker";
import { getContainer } from "../utils/getContainer";
import { pingDocker } from "../utils/pingDocker";

/**
 * Settings for {@link DockerRunOrRm}.
 */
type DockerRunOrRmSettings = {
	containerName?: string;
	imageName?: string;
	status?: string;
};

interface DockerImageData {
	RepoTags: string[];
}

interface DockerContainerData {
	Names: string[];
	State: string;
}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-run-or-rm" })
export class DockerRunOrRm extends SingletonAction<DockerRunOrRmSettings> {
	private updateInterval: NodeJS.Timeout | undefined;
	private docker: Docker;

	constructor(docker: Docker) {
		super();
		this.docker = docker;
	}

	override async onWillAppear(ev: WillAppearEvent<DockerRunOrRmSettings>): Promise<void> {
		this.updateDockerState(ev);
		this.updateInterval = setInterval(async () => {
			await this.updateDockerState(ev);
		}, 1000);
	}

	override onWillDisappear(_ev: WillDisappearEvent<DockerRunOrRmSettings>): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerRunOrRmSettings>): Promise<void> {
		if (ev.payload.event == "getImages") {
			const images = await this.docker.image.list({ all: true });
			streamDeck.logger.debug(images);
			const imageNames = images.map((c) => {
				const data = c.data as DockerImageData;
				const name = data.RepoTags[0];
				return {
					label: name,
					value: name,
				};
			});
			streamDeck.ui.current?.sendToPropertyInspector({
				event: "getImages",
				items: imageNames,
			});
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
			const container = await getContainer(this.docker, containerName.toString());

			if (container) {
				await container.delete({ force: true });
			} else {
				const container = await this.docker.container.create({
					Image: imageName,
					name: containerName,
				});
				await container.start();
			}
		} catch (error: any) {
			streamDeck.logger.error(`Error handling container: ${error.message}`);
		}
	}

	private async updateDockerState(ev: any) {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) {
			return;
		}
		const container = await getContainer(this.docker, ev.payload.settings.containerName);
		const state = container ? 0 : 1;
		ev.action.setState(state);
	}
}
