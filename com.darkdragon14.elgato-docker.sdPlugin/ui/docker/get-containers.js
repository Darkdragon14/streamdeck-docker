let websocket = null;

window.addEventListener('load', () => {
    connectElgatoStreamDeckSocket();
});

// Connexion au WebSocket de Stream Deck
function connectElgatoStreamDeckSocket() {
    const params = new URLSearchParams(window.location.search);
    const port = params.get("port");
    const uuid = params.get("uuid");
    const registerEvent = params.get("registerEvent");

    websocket = new WebSocket(`ws://127.0.0.1:${port}`);
    websocket.onopen = () => websocket.send(JSON.stringify({ event: registerEvent, uuid }));

    // Gestion des messages
    websocket.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.event === "sendToContainers" && data.payload.containers) {
            updateContainerList(data.payload.containers);
        }
    };
}

// Mise à jour de la liste des conteneurs
function updateContainerList(containers) {
    const select = document.getElementById("containes-selector");
    select.innerHTML = ""; // Efface les options actuelles

    containers.forEach(container => {
        const option = document.createElement("option");
        option.value = container.name;
        option.textContent = container.name;
        select.appendChild(option);
    });
}