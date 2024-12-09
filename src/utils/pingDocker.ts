import { Docker } from "node-docker-api";

export async function pingDocker(docker: Docker, ev: any, state: number): Promise<boolean> {
    try {
      await docker.ping();
      return true;
    } catch (error) {
      ev.action.setState(state);
      return false;
    }
  }