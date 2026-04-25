import streamDeck from "@elgato/streamdeck";

import { ContainersCount } from "./actions/containers-count";
import { DockerRunOrRm } from "./actions/docker-run-or-rm";
import { DockerSelectToggle } from "./actions/docker-select-toggle";
import { DockerStackStart } from "./actions/docker-stack-start";
import { DockerStart } from "./actions/docker-start";
import { DockerContainerHealthCheck } from "./actions/docker-container-health-check";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the increment action.
streamDeck.actions.registerAction(new DockerRunOrRm());
streamDeck.actions.registerAction(new DockerStart());
streamDeck.actions.registerAction(new DockerStackStart());
streamDeck.actions.registerAction(new ContainersCount());
streamDeck.actions.registerAction(new DockerSelectToggle());
streamDeck.actions.registerAction(new DockerContainerHealthCheck());

// Finally, connect to the Stream Deck.
streamDeck.connect();
