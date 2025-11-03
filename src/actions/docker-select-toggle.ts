import streamDeck, {
	action,
	DialDownEvent,
	DialRotateEvent,
	SingletonAction,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { pingDockerForDials } from "../utils/pingDocker";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { listContainers as listContainersCli, getContainerState, startContainer, stopContainer, waitContainer } from "../utils/dockerCli";
// Note: Docker Context support for dial action can be added similarly if desired.

/**
 * Settings for {@link DockerSelectToggle}.
 */
type DockerSelectToggleSettings = {
	containerName?: string;
	status?: string;
    contextName?: string;
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

	constructor() { super(); }

	/**
	 * Occurs when the action will appear.
	 */
	override async onWillAppear(ev: WillAppearEvent<DockerSelectToggleSettings>): Promise<void> {
		if (ev.action.isDial()) {
			const context = await getEffectiveContext(ev.payload.settings as any);
			const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
			if (dockerIsUp) {
				await this.updateContainersList(context);
				this.updateContainerName(ev);
			}

			this.updateInterval = setInterval(async () => {
				await this.updateContainerState(ev, this.containers[this.currentIndex]?.Names?.[0]?.slice(1), context);
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
		const context = await getEffectiveContext(ev.payload.settings as any);
		const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const containerName = this.containers[this.currentIndex].Names?.[0]?.slice(1);
		if (!containerName) return;

		const state = await getContainerState(containerName, context);
		if (state === CONTAINER_STATUS_RUNNING) {
			await stopContainer(containerName, context);
			await waitContainer(containerName, context);
		} else {
			await startContainer(containerName, context);
		}
		this.updateInterval = setInterval(async () => {
			await this.updateContainerState(ev, containerName, context);
		}, 1000);
	}

	private async updateContainersList(context?: string): Promise<void> {
		const items = await listContainersCli(true, context);
		this.containers = items.map((it: any) => ({ Names: ["/" + it.name], State: it.state } as any));
	}

	private updateContainerName(
		ev: WillAppearEvent<DockerSelectToggleSettings> | DialRotateEvent<DockerSelectToggleSettings>,
	): void {
		const containerName = this.containers[this.currentIndex]?.Names[0].slice(1) || "No Container";
		ev.action.setTitle(containerName);
	}

	private async updateContainerState(ev: any, containerName: String, context?: string) {
		streamDeck.logger.info("Updating container state for " + containerName);
		const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		if (this.containers.length === 0) {
			await this.updateContainersList(context);
			this.updateContainerName(ev);
			containerName = this.containers[this.currentIndex]?.Names?.[0]?.slice(1);
		}

		const state = await getContainerState(containerName.toString(), context);
		const newState = state === CONTAINER_STATUS_RUNNING ? "imgs/actions/docker-running/key" : "imgs/actions/docker-stopped/key";
		ev.action.setFeedback({
			icon: newState,
		});
	}
}
