import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { Docker } from "node-docker-api";
import * as os from "os";

import { ContainersCount } from "./actions/containers-count";
import { DockerRunOrRm } from "./actions/docker-run-or-rm";
import { DockerStart } from "./actions/docker-start";

const socketPath = os.platform() === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock";
const docker = new Docker({ socketPath });

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register the increment action.
streamDeck.actions.registerAction(new DockerRunOrRm(docker));
streamDeck.actions.registerAction(new DockerStart(docker));
streamDeck.actions.registerAction(new ContainersCount(docker));

// Finally, connect to the Stream Deck.
streamDeck.connect();
