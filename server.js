const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let players = {};

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur : ${socket.id}`);

    // Inscription / Profil initial par défaut
    players[socket.id] = {
        id: socket.id,
        username: "Joueur_" + socket.id.substr(0, 4),
        score: 0,
        inGame: false
    };

    updateGlobalStats();

    // Gestion du choix du pseudo (Inscription rapide)
    socket.on('setPseudo', (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            players[socket.id].username = pseudo.trim();
            socket.emit('pseudoAccepted', players[socket.id].username);
            updateGlobalStats();
        }
    });

    // Écoute des Taps et mise à jour du classement instantané
    socket.on('playerTap', (data) => {
        if (players[socket.id]) {
            players[socket.id].score += data.points;
            updateGlobalStats(); // Diffuse le nouveau classement à tout le monde
        }
    });

    // Gestion du Chat en direct
    socket.on('sendMessage', (msg) => {
        const playerName = players[socket.id] ? players[socket.id].username : "Anonyme";
        // Envoie le message à tous les clients connectés
        io.emit('chatMessage', { sender: playerName, text: msg });
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log(`❌ Joueur déconnecté : ${socket.id}`);
        delete players[socket.id];
        updateGlobalStats();
    });
});

// Fonction pour envoyer le nombre de joueurs et le classement trié
function updateGlobalStats() {
    let playerList = Object.values(players).map(p => ({
        username: p.username,
        score: p.score
    }));

    // Trie du plus grand au plus petit score pour le classement direct
    playerList.sort((a, b) => b.score - a.score);

    io.emit('updateLeaderboard', playerList);
    io.emit('updatePlayerCount', Object.keys(players).length);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur MILTAPE en ligne sur le port ${PORT}`);
});
