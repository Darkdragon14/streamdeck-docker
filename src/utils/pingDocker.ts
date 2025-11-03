import { DOCKER_NOT_RUNNING_TITLE, DOCKER_NOT_RUNNING_TITLE_FOR_DIALS } from "../constants/docker";
import { ping as pingCli } from "./dockerCli";

/**
 * Pings the Docker daemon to check if it is reachable.
 *
 * @param {Docker} docker - The Docker instance used to send the ping request.
 * @param {any} ev - The event object containing the action to update the state in case of failure.
 * @param {number} state - The state to set if the ping fails.
 * @returns {Promise<boolean>} - Resolves to `true` if the ping succeeds, `false` otherwise.
 * @throws {Error} - Propagates any unexpected errors during the ping process.
 */
export async function pingDocker(ev: any, state: number, context?: string): Promise<boolean> {
	try {
		const ok = await pingCli(context);
		if (ok) return true;
	} catch {}
	ev.action.setState(state);
	(ev.action || ev).setTitle(DOCKER_NOT_RUNNING_TITLE);
	return false;
}

export async function pingDockerForDials(ev: any, state: number, context?: string): Promise<boolean> {
	try {
		const ok = await pingCli(context);
		if (ok) return true;
	} catch {}
	ev.action.setFeedback({
		icon: "imgs/actions/error/key",
		title: DOCKER_NOT_RUNNING_TITLE_FOR_DIALS,
	});
	return false;
}
