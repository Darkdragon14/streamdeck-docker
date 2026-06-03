import streamDeck, {
	action,
	DialDownEvent,
	DialRotateEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { CONTAINER_STATUS_RUNNING, DOCKER_START_ERROR_STATE } from "../constants/docker";
import { containersByComposeProject, isSwarmStack, listComposeProjects } from "../utils/dockerCli";
import { getEffectiveContext } from "../utils/getEffectiveContext";
import { pingDockerForDials } from "../utils/pingDocker";
import { startStackLifecycle } from "../utils/stackLifecycle";

type DockerStackSelectStartSettings = {
	contextName?: string;
	remoteHost?: string;
};

type StackDialState = {
	stacks: string[];
	currentIndex: number;
	updateInterval?: NodeJS.Timeout;
	rememberedSwarmDesired?: Record<string, number>;
	updating?: boolean;
};

const RUNNING_COLOR = "#3fb950";
const STOPPED_COLOR = "#f85149";

@action({ UUID: "com.darkdragon14.elgato-docker.docker-stack-select-start" })
export class DockerStackSelectStart extends SingletonAction<DockerStackSelectStartSettings> {
	private stateByInstance: Map<string, StackDialState> = new Map();

	override async onWillAppear(ev: WillAppearEvent<DockerStackSelectStartSettings>): Promise<void> {
		if (!ev.action.isDial()) return;

		const instanceId = this.getInstanceId(ev);
		const context = await getEffectiveContext(ev.payload.settings as DockerStackSelectStartSettings);
		const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
		const state = this.getState(instanceId);

		if (dockerIsUp) {
			await this.updateStacksList(state, context);
			this.clampIndex(state);
			await this.updateStackFeedback(ev, context);
		}

		this.startUpdateLoop(ev, context);
	}

	override onWillDisappear(ev: WillDisappearEvent<DockerStackSelectStartSettings>): void {
		const instanceId = this.getInstanceId(ev);
		const state = this.stateByInstance.get(instanceId);
		if (state?.updateInterval) clearInterval(state.updateInterval);
		this.stateByInstance.delete(instanceId);
	}

	override async onDialRotate(ev: DialRotateEvent<DockerStackSelectStartSettings>): Promise<void> {
		const instanceId = this.getInstanceId(ev);
		const context = await getEffectiveContext(ev.payload.settings as DockerStackSelectStartSettings);
		const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const state = this.getState(instanceId);
		if (state.stacks.length === 0) {
			await this.updateStacksList(state, context);
		}
		if (state.stacks.length === 0) {
			this.setFeedback(ev, "No Stack", STOPPED_COLOR);
			return;
		}

		const ticks = (ev.payload as any).ticks;
		const direction = typeof ticks === "number" && ticks < 0 ? -1 : 1;
		state.currentIndex = (state.currentIndex + direction + state.stacks.length) % state.stacks.length;
		await this.updateStackFeedback(ev, context);
	}

	override async onDialDown(ev: DialDownEvent<DockerStackSelectStartSettings>): Promise<void> {
		const instanceId = this.getInstanceId(ev);
		const context = await getEffectiveContext(ev.payload.settings as DockerStackSelectStartSettings);
		const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
		if (!dockerIsUp) return;

		const state = this.getState(instanceId);
		if (state.stacks.length === 0) {
			await this.updateStacksList(state, context);
		}

		const stackName = state.stacks[state.currentIndex];
		if (!stackName) {
			this.setFeedback(ev, "No Stack", STOPPED_COLOR);
			return;
		}

		const result = await startStackLifecycle(stackName, context, state.rememberedSwarmDesired);
		if (result === "not-found") {
			this.setFeedback(ev, "Not Found", STOPPED_COLOR);
			return;
		}

		await this.updateStacksList(state, context);
		this.selectStack(state, stackName);
		await this.updateStackFeedback(ev, context);
	}

	private startUpdateLoop(ev: any, context?: string): void {
		const instanceId = this.getInstanceId(ev);
		const state = this.getState(instanceId);
		if (state.updateInterval) clearInterval(state.updateInterval);
		state.updateInterval = setInterval(async () => {
			await this.updateStackFeedback(ev, context);
		}, 1000);
	}

	private async updateStacksList(state: StackDialState, context?: string): Promise<void> {
		const selected = state.stacks[state.currentIndex];
		state.stacks = await listComposeProjects(context);
		if (selected) this.selectStack(state, selected);
		this.clampIndex(state);
	}

	private async updateStackFeedback(ev: any, context?: string): Promise<void> {
		const instanceId = this.getInstanceId(ev);
		const state = this.getState(instanceId);
		if (state.updating) return;
		state.updating = true;
		try {
			const dockerIsUp = await pingDockerForDials(ev, DOCKER_START_ERROR_STATE, context);
			if (!dockerIsUp) return;

			if (state.stacks.length === 0) {
				await this.updateStacksList(state, context);
			}

			const stackName = state.stacks[state.currentIndex];
			if (!stackName) {
				this.setFeedback(ev, "No Stack", STOPPED_COLOR);
				return;
			}

			const containers = await containersByComposeProject(stackName, context);
			let swarm = false;
			try {
				swarm = await isSwarmStack(stackName, context);
			} catch {}

			if (!swarm && containers.length === 0) {
				this.setFeedback(ev, "Not Found", STOPPED_COLOR);
				return;
			}

			const running = containers.filter((container) => container.state === CONTAINER_STATUS_RUNNING).length;
			const isRunning = swarm ? running > 0 : running === containers.length && containers.length > 0;
			this.setFeedback(ev, stackName, isRunning ? RUNNING_COLOR : STOPPED_COLOR);
		} catch (error: any) {
			streamDeck.logger.error(`Failed updating stack dial feedback: ${error?.message || error}`);
		} finally {
			state.updating = false;
		}
	}

	private setFeedback(ev: any, title: string, statusColor: string): void {
		ev.action.setFeedback({
			canvas: {
				value: createDockerTile(statusColor, title),
			},
			title: "",
		});
	}

	private selectStack(state: StackDialState, stackName: string): void {
		const index = state.stacks.indexOf(stackName);
		state.currentIndex = index >= 0 ? index : 0;
	}

	private clampIndex(state: StackDialState): void {
		if (state.currentIndex < 0) state.currentIndex = 0;
		if (state.currentIndex >= state.stacks.length) state.currentIndex = 0;
	}

	private getState(instanceId: string): StackDialState {
		let state = this.stateByInstance.get(instanceId);
		if (!state) {
			state = { stacks: [], currentIndex: 0 };
			this.stateByInstance.set(instanceId, state);
		}
		return state;
	}

	private getInstanceId(ev: any): string {
		return (ev.action as any).id || ev.context;
	}

	private formatTitle(title: string): string {
		return title.split("-").join("\n");
	}
}

function createDockerTile(background: string, title: string): string {
	const lines = formatCanvasTitle(title);
	const lineHeight = lines.length > 1 ? 22 : 24;
	const firstLineY = lines.length > 1 ? 58 : 66;
	const titleNodes = lines
		.map(
			(line, index) =>
				`<text x="100" y="${firstLineY + index * lineHeight}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" letter-spacing="0" fill="#ffffff">${escapeXml(line)}</text>`,
		)
		.join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
<rect width="200" height="100" fill="#151515"/>
<rect x="0" y="0" width="200" height="24" fill="${background}"/>
<text x="100" y="18" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600" letter-spacing="0" fill="#000000">docker</text>
${titleNodes}
</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function formatCanvasTitle(title: string): string[] {
	const normalized = title.replace(/\s+/g, " ").trim() || "No Stack";
	const parts = normalized.split("-").filter(Boolean);
	if (parts.length > 1 && parts.every((part) => part.length <= 12)) {
		return parts.slice(0, 2);
	}
	if (normalized.length <= 16) return [normalized];
	return [`${normalized.slice(0, 15)}...`];
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
