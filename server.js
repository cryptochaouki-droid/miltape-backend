const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Initialisation de l'application
const app = express();
app.use(cors());

const server = http.createServer(app);

// Configuration de Socket.io avec les autorisations CORS
const io = new Server(server, {
    cors: {
        origin: "*", // Autorise ton front-end à se connecter depuis n'importe où
        methods: ["GET", "POST"]
    }
});

// Variable pour stocker les joueurs en ligne
let players = {};

// Écoute des connexions entrantes
io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur : ${socket.id}`);

    // Création du profil du joueur
    players[socket.id] = {
        id: socket.id,
        score: 0,
        currentBet: 0,
        inGame: false
    };

    io.emit('updatePlayerCount', Object.keys(players).length);

    // Écoute du matchmaking (quand le joueur choisit sa mise)
    socket.on('joinMatchmaking', (betAmount) => {
        players[socket.id].currentBet = betAmount;
        players[socket.id].inGame = true;
        
        // Simule le lancement de la partie
        socket.emit('matchFound', { timeLimit: 10 }); 
    });

    // Écoute des Taps
    socket.on('playerTap', (data) => {
        if (players[socket.id] && players[socket.id].inGame) {
            players[socket.id].score += data.points;
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log(`❌ Joueur déconnecté : ${socket.id}`);
        delete players[socket.id];
        io.emit('updatePlayerCount', Object.keys(players).length);
    });
});

// Port dynamique pour le déploiement
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur MILTAPE en ligne sur le port ${PORT}`);
});

