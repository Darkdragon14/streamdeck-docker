import {
	action,
	DidReceiveSettingsEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import { Docker } from "node-docker-api";

import { pingDocker } from "../utils/pingDocker";

/**
 * Settings for {@link containersList}.
 */
type ContainersListSettings = {
	status?: string;
};

@action({ UUID: "com.darkdragon14.elgato-docker.containers-count" })
export class ContainersCount extends SingletonAction<ContainersListSettings> {
	private updateInterval: NodeJS.Timeout | undefined;
	private docker: Docker;

	constructor(docker: Docker) {
		super();
		this.docker = docker;
	}

	override async onWillAppear(ev: WillAppearEvent<ContainersListSettings>): Promise<void> {
		let { status }: ContainersListSettings = ev.payload.settings;

		if (!status) {
			status = "all";
		}

		this.updateContainersList(ev, status);

		this.updateInterval = setInterval(async () => {
			await this.updateContainersList(ev, status);
		}, 1000);
	}

	override onWillDisappear(_ev: WillDisappearEvent<ContainersListSettings>): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ContainersListSettings>): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
		const status = ev.payload?.settings?.status || "all";
		this.updateContainersList(ev, status);

		this.updateInterval = setInterval(async () => {
			await this.updateContainersList(ev, status);
		}, 1000);
	}

	private async updateContainersList(ev: any, status: String) {
		const dockerIsUp = await pingDocker(this.docker, ev, 1);
		if (!dockerIsUp) {
			return;
		}
		ev.action.setState(0);

		let containers = [];
		if (status === "all") {
			containers = await this.docker.container.list({ all: true });
		} else {
			containers = await this.docker.container.list({ status });
		}

		const title = `${status}\n${containers.length}`;

		ev.action.setTitle(title);
	}
}
