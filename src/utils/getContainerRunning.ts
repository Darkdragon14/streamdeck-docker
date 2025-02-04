import { Docker } from "node-docker-api";

import { CONTAINER_STATUS_RUNNING } from "../constants/docker";
import { getContainer } from "./getContainer";

interface DockerContainerData {
	Names: string[];
	State: string;
}

export async function isContainerRunning(docker: Docker, containerName: String) {
	const container = await getContainer(docker, containerName);

	if (!container) {
		return false;
	}

	const data = container.data as DockerContainerData;

	return data.State === CONTAINER_STATUS_RUNNING ? true : false;
}
