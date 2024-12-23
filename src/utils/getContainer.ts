import { Docker } from "node-docker-api";

interface DockerContainerData {
	Names: string[];
	State: string;
}

/**
 * Retrieves a Docker container by its name.
 *
 * @param docker - An instance of the Docker API.
 * @param containerName - The name of the container to retrieve.
 * @returns A promise that resolves to the container object if found, otherwise undefined.
 */
export async function getContainer(docker: Docker, containerName: String) {
	const containers = await docker.container.list({ all: true });
	return containers.find((c) => {
		const data = c.data as DockerContainerData;
		return data.Names.includes(`/${containerName}`);
	});
}
