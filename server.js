const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Servir le fichier index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
    console.log('Un utilisateur est connecté');
    
    // Envoyer le nombre de joueurs en temps réel
    io.emit('playerCountUpdate', io.engine.clientsCount);

    socket.on('disconnect', () => {
        io.emit('playerCountUpdate', io.engine.clientsCount);
    });

    socket.on('playerTap', () => {
        // Logique de jeu ici
    });
});

// IMPORTANT : Le port dynamique pour Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
