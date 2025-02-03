import streamDeck, { action, SingletonAction, WillAppearEvent, DialRotateEvent, DialDownEvent } from "@elgato/streamdeck";

import { Docker } from "node-docker-api";
import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { getContainer } from "../utils/getContainer";
import { pingDocker } from "../utils/pingDocker";

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
            await this.updateContainersList();
            this.updateContainerName(ev);
			
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
        const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		streamDeck.logger.info(`Docker is up: ${dockerIsUp}`);
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
        this.containers = containers.map(c => c.data as DockerContainerData);
    }

    private updateContainerName(ev: WillAppearEvent<DockerSelectToggleSettings> | DialRotateEvent<DockerSelectToggleSettings>): void {
        const containerName = this.containers[this.currentIndex]?.Names[0].slice(1) || "No Container";
        ev.action.setTitle(containerName);
    }

	private async updateContainerState(ev: any, containerName: String) {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) {
			return;
		}

		const running = await this.isContainerRunning(containerName);
		const newState = running ? 0 : 1;
		// ev.action.setState(newState);
	}

	private async isContainerRunning(containerName: String) {
		const container = await getContainer(this.docker, containerName);

		if (!container) {
			return false;
		}

		const data = container.data as DockerContainerData;

		return data.State === CONTAINER_STATUS_RUNNING ? true : false;
	}
}