import { Docker } from "node-docker-api";
import { DOCKER_NOT_RUNNING_TITLE } from "../constants/docker";

/**
 * Pings the Docker daemon to check if it is reachable.
 *
 * @param {Docker} docker - The Docker instance used to send the ping request.
 * @param {any} ev - The event object containing the action to update the state in case of failure.
 * @param {number} state - The state to set if the ping fails.
 * @returns {Promise<boolean>} - Resolves to `true` if the ping succeeds, `false` otherwise.
 * @throws {Error} - Propagates any unexpected errors during the ping process.
 */
export async function pingDocker(docker: Docker, ev: any, state: number): Promise<boolean> {
	try {
		await docker.ping();
		return true;
	} catch (error) {
		ev.action.setState(state);
		if (ev.action){
			ev.action.setTitle(DOCKER_NOT_RUNNING_TITLE);
		} else {
			ev.setTitle(DOCKER_NOT_RUNNING_TITLE);
		}
		return false;
	}
}
