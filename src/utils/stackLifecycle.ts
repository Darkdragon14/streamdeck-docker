import streamDeck from "@elgato/streamdeck";

import { CONTAINER_STATUS_RUNNING } from "../constants/docker";
import {
	containersByComposeProject,
	isSwarmStack,
	listSwarmServicesInStack,
	scaleSwarmService,
	startContainer,
	stopContainer,
	waitContainer,
} from "./dockerCli";

export type StackToggleResult = "ok" | "not-found";

export async function toggleStackLifecycle(
	stackName: string,
	context: string | undefined,
	rememberedSwarmDesired: Record<string, number> | undefined,
	rememberSwarmDesired: (desired: Record<string, number>) => void,
): Promise<StackToggleResult> {
	const containers = await containersByComposeProject(stackName, context);
	let swarm = false;
	try {
		swarm = await isSwarmStack(stackName, context);
	} catch {}

	if (!swarm && containers.length === 0) return "not-found";

	if (swarm) {
		const running = containers.some((c) => c.state === CONTAINER_STATUS_RUNNING);
		if (running) {
			await stopSwarmStack(stackName, context, rememberSwarmDesired);
		} else {
			await startSwarmStack(stackName, context, rememberedSwarmDesired);
		}
		return "ok";
	}

	const allRunning = containers.every((c) => c.state === CONTAINER_STATUS_RUNNING);
	if (allRunning) {
		await stopComposeStack(containers, context);
	} else {
		for (const c of containers) {
			try {
				if (c.state !== CONTAINER_STATUS_RUNNING) {
					await startContainer(c.name, context).catch(() => {});
				}
			} catch (e: any) {
				streamDeck.logger.warn(`Failed starting container: ${e?.message || e}`);
			}
		}
	}

	return "ok";
}

export async function stopStackLifecycle(
	stackName: string,
	context: string | undefined,
	rememberSwarmDesired: (desired: Record<string, number>) => void,
): Promise<StackToggleResult> {
	const containers = await containersByComposeProject(stackName, context);
	let swarm = false;
	try {
		swarm = await isSwarmStack(stackName, context);
	} catch {}

	if (!swarm && containers.length === 0) return "not-found";

	if (swarm) {
		await stopSwarmStack(stackName, context, rememberSwarmDesired);
	} else {
		await stopComposeStack(containers, context);
	}

	return "ok";
}

async function stopComposeStack(containers: { name: string }[], context?: string): Promise<void> {
	for (const c of containers) {
		try {
			await stopContainer(c.name, context).catch(() => {});
			await waitContainer(c.name, context).catch(() => {});
		} catch (e: any) {
			streamDeck.logger.warn(`Failed stopping container: ${e?.message || e}`);
		}
	}
}

async function stopSwarmStack(
	stackName: string,
	context: string | undefined,
	rememberSwarmDesired: (desired: Record<string, number>) => void,
): Promise<void> {
	const services = await listSwarmServicesInStack(stackName, context);
	const desired: Record<string, number> = {};
	for (const s of services) {
		if (s.mode?.toLowerCase() === "global") {
			streamDeck.logger.warn(`Global service ${s.name} cannot be scaled; skipping.`);
			continue;
		}
		const target = Number.isFinite(s.replicasDesired as any) ? (s.replicasDesired as number) : 1;
		desired[s.name] = target;
		try {
			await scaleSwarmService(s.name, 0, context);
		} catch (e: any) {
			streamDeck.logger.warn(`Failed scaling service ${s.name} to 0: ${e?.message || e}`);
		}
	}
	rememberSwarmDesired(desired);
}

async function startSwarmStack(
	stackName: string,
	context: string | undefined,
	rememberedSwarmDesired: Record<string, number> | undefined,
): Promise<void> {
	const remembered = rememberedSwarmDesired || {};
	const services = await listSwarmServicesInStack(stackName, context);
	for (const s of services) {
		if (s.mode?.toLowerCase() === "global") continue;
		const target =
			remembered[s.name] ?? (Number.isFinite(s.replicasDesired as any) ? (s.replicasDesired as number) : 1);
		try {
			await scaleSwarmService(s.name, Math.max(1, target), context);
		} catch (e: any) {
			streamDeck.logger.warn(`Failed scaling service ${s.name}: ${e?.message || e}`);
		}
	}
}
