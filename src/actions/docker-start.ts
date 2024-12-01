import streamDeck, { action, KeyDownEvent, SingletonAction, WillAppearEvent, Logger } from "@elgato/streamdeck";
import { Docker } from "node-docker-api";

const docker = new Docker({socketPath: '//./pipe/docker_engine'});

interface DockerContainerData {
    Names: string[];
    State: string;
}


@action({ UUID: "com.darkdragon14.elgato-docker.docker-start" })
export class DockerStart extends SingletonAction<DockerStartSettings> {
    override async onWillAppear(ev: WillAppearEvent<DockerStartSettings>): Promise<void> {
        let { containerName, status }:DockerStartSettings = ev.payload.settings;

        const containers = await docker.container.list({all: true});
        // const containerNames = containers.map(c => ({ name: c.data.Names[0].replace("/", "") }));
        if (!containerName) {
            containerName = ''
        }
        streamDeck.logger.info(JSON.stringify(containers[1].data))
        const container = containers.find(c => {
            const data = c.data as DockerContainerData;
            return data.Names.includes(`/${containerName}`)
        });

        if (container) {
            const data = container.data as DockerContainerData;
            status = data.State; 
            const title = `${containerName}`;
            ev.action.setTitle(title);
        } else {
            ev.action.setTitle("Not Found");
        }
    }

    override async onKeyDown(ev: KeyDownEvent) {
        const { containerName }:DockerStartSettings = ev.payload.settings;

        if (!containerName) {
            streamDeck.logger.error(`Container not found in key.`);
            return;
        }        

        const containers = await docker.container.list({all: true});
        const container = containers.find(c => {
            const data = c.data as DockerContainerData;
            return data.Names.includes(`/${containerName}`)
        });

        if (!container) {
            streamDeck.logger.error(`Container ${containerName} not found.`);
            ev.action.setTitle("Not Found");
            return;
        }

        const data = container.data as DockerContainerData;
        if (data.State === "running") {
            await container.stop(); 
            streamDeck.logger.info(`Container ${containerName} stopped.`);
        } else {
            await container.start();
            streamDeck.logger.info(`Container ${containerName} started.`);
        }
	}
}


/**
 * Settings for {@link DockerStart}.
 */
type DockerStartSettings = {
    containerName?: string;
    status?: string;
};