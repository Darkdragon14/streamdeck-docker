import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { ContainersCount } from "./actions/containers-count";
import { DockerStart } from "./actions/docker-start";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register the increment action.
streamDeck.actions.registerAction(new DockerStart());
streamDeck.actions.registerAction(new ContainersCount());

// Finally, connect to the Stream Deck.
streamDeck.connect();
