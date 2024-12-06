# StreamDeck Docker

<div align="center">
  <h2>🚧 Project Under Development 🚧</h2>
  <p>
    This project is in its early stages of development. I'm actively working on it to bring the best features and a seamless experience for users. Stay tuned for updates!
  </p>
  <hr/>
</div>

A powerful plugin for Elgato Stream Deck that allows you to manage Docker containers directly from your Stream Deck. With this tool, you can start, stop, and monitor Docker containers with ease, all while keeping your workflow streamlined.

## Features

- Start/Stop Containers: Control the lifecycle of Docker containers with a single key press.
- Display Container Status: Show the current state (e.g., running, stopped) directly on your Stream Deck keys.
- User-Friendly: Integrates seamlessly with the Stream Deck interface for effortless container management.
- Multi-Container Support: Handles multiple Docker containers simultaneously.

## Prerequisites

Before using this plugin, ensure you have the following installed:

- Elgato Stream Deck Software (latest version)
- Docker (with the Docker Engine API enabled)
- Node.js (for development and building the plugin)

## Installation

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
- Drag the Docker Control action to a key on your Stream Deck.
- Configure the container name in the action's settings.
- Press the key to start stop, or check the status of the container.

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

Built with [node-docker-api](https://www.npmjs.com/package/node-docker-api) for Docker integration.
