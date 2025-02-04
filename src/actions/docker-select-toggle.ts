import streamDeck, {
	action,
	DialDownEvent,
	DialRotateEvent,
	SingletonAction,
	WillAppearEvent,
} from "@elgato/streamdeck";
import { Docker } from "node-docker-api";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { getContainer } from "../utils/getContainer";
import { isContainerRunning } from "../utils/getContainerRunning";
import { pingDockerForDials } from "../utils/pingDocker";

/**
 * Settings for {@link DockerSelectToggle}.
 */
type DockerSelectToggleSettings = {
	containerName?: string;
	status?: string;
};

interface DockerContainerData {
	Names: string[];
	State: string;
}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-select-toggle" })
export class DockerSelectToggle extends SingletonAction<DockerSelectToggleSettings> {
	private containers: DockerContainerData[] = [];
	private currentIndex: number = 0;
	private updateInterval: NodeJS.Timeout | undefined;
	private docker: Docker;

	constructor(docker: Docker) {
		super();
		this.docker = docker;
	}

	/**
	 * Occurs when the action will appear.
	 */
	override async onWillAppear(ev: WillAppearEvent<DockerSelectToggleSettings>): Promise<void> {
		if (ev.action.isDial()) {
			const dockerIsUp = await pingDockerForDials(this.docker, ev, DOCKER_START_ERROR_STATE);
			if (dockerIsUp) {
				await this.updateContainersList();
				this.updateContainerName(ev);
			}

			this.updateInterval = setInterval(async () => {
				await this.updateContainerState(ev, this.containers[this.currentIndex]?.Names[0].slice(1));
			}, 1000);
		}
	}

	/**
	 * Occurs when the dial is rotated.
	 */
	override async onDialRotate(ev: DialRotateEvent<DockerSelectToggleSettings>): Promise<void> {
		if (this.containers.length === 0) return;
		this.currentIndex++;
		if (this.currentIndex >= this.containers.length) {
			this.currentIndex = 0;
		}
		this.updateContainerName(ev);
	}

	/**
	 * Occurs when the dial is pressed.
	 */
	override async onDialDown(ev: DialDownEvent<DockerSelectToggleSettings>): Promise<void> {
		const dockerIsUp = await pingDockerForDials(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) return;

		const containerName = this.containers[this.currentIndex].Names[0].slice(1);
		const container = await getContainer(this.docker, containerName);
		if (!container) return;

		const data = container.data as DockerContainerData;
		if (data.State === CONTAINER_STATUS_RUNNING) {
			await container.stop();
			await container.wait();
		} else {
			await container.start();
		}
		this.updateInterval = setInterval(async () => {
			await this.updateContainerState(ev, containerName);
		}, 1000);
	}

	private async updateContainersList(): Promise<void> {
		const containers = await this.docker.container.list({ all: true });
		this.containers = containers.map((c) => c.data as DockerContainerData);
	}

	private updateContainerName(
		ev: WillAppearEvent<DockerSelectToggleSettings> | DialRotateEvent<DockerSelectToggleSettings>,
	): void {
		const containerName = this.containers[this.currentIndex]?.Names[0].slice(1) || "No Container";
		ev.action.setTitle(containerName);
	}

	private async updateContainerState(ev: any, containerName: String) {
		streamDeck.logger.info("Updating container state for " + containerName);
		const dockerIsUp = await pingDockerForDials(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) return;

		if (this.containers.length === 0) {
			await this.updateContainersList();
			this.updateContainerName(ev);
			containerName = this.containers[this.currentIndex]?.Names[0].slice(1);
		}

		const running = await isContainerRunning(this.docker, containerName);
		const newState = running ? "imgs/actions/docker-running/key" : "imgs/actions/docker-stopped/key";
		ev.action.setFeedback({
			icon: newState,
		});
	}
}
