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
import { pingDocker } from "../utils/pingDocker";

type DockerStackStartSettings = {
	stackName?: string;
};

interface DockerContainerData {
	Names: string[];
	State: string;
	Labels?: Record<string, string>;
}

@action({ UUID: "com.darkdragon14.elgato-docker.docker-stack-start" })
export class DockerStackStart extends SingletonAction<DockerStackStartSettings> {
    private updateInterval: NodeJS.Timeout | undefined;
    private docker: Docker;
    private currentStackName: string | undefined;

	constructor(docker: Docker) {
		super();
		this.docker = docker;
	}

    override async onWillAppear(ev: WillAppearEvent<DockerStackStartSettings>): Promise<void> {
        const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
        if (!dockerIsUp) {
            this.startUpdateLoop(ev);
            return;
        }

        const { stackName } = ev.payload.settings;
        this.currentStackName = stackName;
        if (this.currentStackName) {
            ev.action.setTitle(this.formatTitle(this.currentStackName));
        }

		await this.updateStackState(ev);
		this.startUpdateLoop(ev);
	}

	override onWillDisappear(_ev: WillDisappearEvent<DockerStackStartSettings>): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonObject, DockerStackStartSettings>): Promise<void> {
		if (ev.payload.event === "getStacks") {
			const stacks = await this.listComposeStacks();
			const items = stacks.map((name) => ({ label: name, value: name }));
			streamDeck.ui.current?.sendToPropertyInspector({ event: "getStacks", items });
		}
		streamDeck.connect();
	}

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DockerStackStartSettings>): void {
        const { stackName } = ev.payload.settings || {};
        this.currentStackName = stackName;
        ev.action.setTitle(this.formatTitle(this.currentStackName || "No\nStack"));
    }

	override async onKeyDown(ev: KeyDownEvent<DockerStackStartSettings>): Promise<void> {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) return;

        const stackName = this.currentStackName;
        if (!stackName) {
            streamDeck.logger.error("No stack selected.");
            return;
        }

        const containers = await this.getContainersByComposeProject(stackName);
		if (containers.length === 0) {
			ev.action.setTitle("Not\nFound");
			return;
		}

		const allRunning = containers.every((c) => (c.data as DockerContainerData).State === CONTAINER_STATUS_RUNNING);

		if (allRunning) {
			for (const c of containers) {
				try {
					await c.stop().catch(() => {});
					await c.wait().catch(() => {});
				} catch (e: any) {
					streamDeck.logger.warn(`Failed stopping container: ${e?.message || e}`);
				}
			}
		} else {
			for (const c of containers) {
				try {
					const data = c.data as DockerContainerData;
					if (data.State !== CONTAINER_STATUS_RUNNING) {
						await c.start().catch(() => {});
					}
				} catch (e: any) {
					streamDeck.logger.warn(`Failed starting container: ${e?.message || e}`);
				}
			}
		}
	}

	private startUpdateLoop(ev: WillAppearEvent<DockerStackStartSettings>) {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
		}
		this.updateInterval = setInterval(async () => {
			await this.updateStackState(ev);
		}, 1000);
	}

	private async updateStackState(ev: any): Promise<void> {
		const dockerIsUp = await pingDocker(this.docker, ev, DOCKER_START_ERROR_STATE);
		if (!dockerIsUp) return;

        const stackName = this.currentStackName;
        if (!stackName) {
            ev.action.setTitle("No\nStack");
            ev.action.setState(1);
            return;
        }

        const containers = await this.getContainersByComposeProject(stackName);
        if (containers.length === 0) {
            ev.action.setTitle("Not\nFound");
            ev.action.setState(1);
            return;
        }

        const running = containers.filter((c) => (c.data as DockerContainerData).State === CONTAINER_STATUS_RUNNING).length;
        const allRunning = running === containers.length;
        ev.action.setTitle(this.formatTitle(stackName));
        ev.action.setState(allRunning ? 0 : 1);
    }

	private async listComposeStacks(): Promise<string[]> {
		const containers = await this.docker.container.list({ all: true });
		const names = new Set<string>();
		for (const c of containers) {
			const data = c.data as DockerContainerData;
			const project = data.Labels?.["com.docker.compose.project"]; // Compose v2 label
			if (project) names.add(project);
		}
		return Array.from(names).sort((a, b) => a.localeCompare(b));
	}

	private async getContainersByComposeProject(project: string) {
		const containers = await this.docker.container.list({ all: true });
		return containers.filter((c) => {
			const data = c.data as DockerContainerData;
			return data.Labels?.["com.docker.compose.project"] === project;
		});
	}

	private formatTitle(title: string) {
		return title.split("-").join("\n");
	}
}
