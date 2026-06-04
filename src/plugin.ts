import streamDeck from "@elgato/streamdeck";

import { ContainersCount } from "./actions/containers-count";
import { DockerRunOrRm } from "./actions/docker-run-or-rm";
import { DockerRunningStackStop } from "./actions/docker-running-stack-stop";
import { DockerSelectToggle } from "./actions/docker-select-toggle";
import { DockerStackSelectToggle } from "./actions/docker-stack-select-toggle";
import { DockerStackStart } from "./actions/docker-stack-start";
import { DockerStart } from "./actions/docker-start";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the increment action.
streamDeck.actions.registerAction(new DockerRunOrRm());
streamDeck.actions.registerAction(new DockerStart());
streamDeck.actions.registerAction(new DockerStackStart());
streamDeck.actions.registerAction(new DockerRunningStackStop());
streamDeck.actions.registerAction(new ContainersCount());
streamDeck.actions.registerAction(new DockerSelectToggle());
streamDeck.actions.registerAction(new DockerStackSelectToggle());

// Finally, connect to the Stream Deck.
streamDeck.connect();
