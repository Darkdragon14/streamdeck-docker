# StreamDeck Docker

[![Release](https://img.shields.io/github/v/release/Darkdragon14/streamdeck-docker.svg)](https://github.com/Darkdragon14/streamdeck-docker/releases)
[![Prettier with elgao's config](https://github.com/Darkdragon14/streamdeck-docker/actions/workflows/prettier.yml/badge.svg)](https://github.com/Darkdragon14/streamdeck-docker/actions/workflows/prettier.yml)

A powerful plugin for Elgato Stream Deck that allows you to manage Docker containers directly from your Stream Deck. With this tool, you can start, stop, and monitor Docker containers with ease, all while keeping your workflow streamlined.

## Features

- Start/Stop Containers: Control Docker container lifecycle with a single key press.
- Display Container Status: Show the current state (for example, running or stopped) directly on your Stream Deck keys.
- User-Friendly Interface: Integrates seamlessly with Stream Deck for effortless container management.
- Multi-Container Support: Manage multiple Docker containers simultaneously.
- Stack Start/Stop: Control an entire Docker Compose stack with a single key press.
- Running Stack Stop: Automatically bind a key to a running stack and stop it when pressed.
- Docker Stack Select and Toggle: Use a Stream Deck + dial to browse stacks and start or stop the selected stack.
- Fast Stack Refresh: Refresh running stacks every 10 seconds.
- Docker Context Support: Select a Docker Context per key. TLS certificates are handled by the Docker Context.

## Future improvements

- Enable container deletion using a dial.
- Extend functionality to include more services beyond containers.
- Support remote connections to manage containers.

## Prerequisites

Before using this plugin, ensure you have the following installed:

- Elgato Stream Deck Software (latest version)
- Docker (with the Docker Engine API enabled)
- Node.js (for development and building the plugin)

## Installation

### Get the plugin

Install it from the [Elgato Marketplace](https://marketplace.elgato.com/product/elgato-docker-b4403038-98e1-4f4b-a336-cdb0cb84019a).

Or go in the [Releases](https://github.com/Darkdragon14/streamdeck-docker/releases) section and download the .streamDeckPlugin file from the latest release.

### Clone the repository:

```bash
git clone https://github.com/Darkdragon14/streamdeck-docker.git
```

### Install the dependencies:

```bash
npm install
```

### Build the project:

```bash
npm run build
```

### Import the plugin into your Stream Deck software:

Locate the built .streamDeckPlugin file in the dist directory.
Double-click it to install the plugin in the Stream Deck software.

## Usage

- Open the Stream Deck software.
- Drag a Docker action to a key.
- Optional: set the `Remote (optional)` field to target a remote Docker (leave empty for local; ensures backward compatibility).
- Preferred: pick a `Context` per key. Select `default (local)` to use the local Docker; choose a named Docker Context to target a remote.
- Configure the action-specific fields (container, stack, image, etc.).
- Press the key to start/stop or query status.

## Development

To contribute or modify the plugin, follow these steps:

Clone the repository and navigate to the project directory:

```bash
git clone https://github.com/Darkdragon14/streamdeck-docker.git
cd streamdeck-docker
npm i
npm run watch
```

## Contributing

Contributions are welcome! Please submit issues and pull requests to improve the plugin.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/Darkdragon14/streamdeck-docker?tab=MIT-1-ov-file) file for details.

## Acknowledgments

Thanks to [Elgato](https://www.elgato.com/) for providing the Stream Deck platform.
