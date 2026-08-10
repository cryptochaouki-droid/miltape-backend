// ... (garde tout le début de ton server.js)

// Fonction pour envoyer le nombre de joueurs à tout le monde
function updatePlayerCount() {
    const count = io.engine.clientsCount;
    io.emit('playerCountUpdate', count);
}

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur connecté : ${socket.id}`);
    updatePlayerCount(); // Met à jour dès qu'un joueur arrive

    // ... (garde tes autres événements ici)

    socket.on('disconnect', () => {
        console.log(`❌ Déconnecté : ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        updatePlayerCount(); // Met à jour dès qu'un joueur part
    });
});

// ... (garde le reste du server.js)
