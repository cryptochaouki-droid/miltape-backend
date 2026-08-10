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

    players[socket.id] = {
        id: socket.id,
        username: "Anonyme",
        score: 0
    };

    updateGlobalStats();

    // CORRECTION : Le serveur valide et renvoie l'événement au client
    socket.on('setPseudo', (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            players[socket.id].username = pseudo.trim();
            socket.emit('pseudoAccepted', players[socket.id].username);
            updateGlobalStats();
        }
    });

    socket.on('playerTap', (data) => {
        if (players[socket.id]) {
            players[socket.id].score += data.points;
            updateGlobalStats();
        }
    });

    socket.on('sendMessage', (msg) => {
        const playerName = players[socket.id] ? players[socket.id].username : "Anonyme";
        io.emit('chatMessage', { sender: playerName, text: msg });
    });

    socket.on('disconnect', () => {
        console.log(`❌ Joueur déconnecté : ${socket.id}`);
        delete players[socket.id];
        updateGlobalStats();
    });
});

function updateGlobalStats() {
    let playerList = Object.values(players).map(p => ({
        username: p.username,
        score: p.score
    }));

    playerList.sort((a, b) => b.score - a.score);

    io.emit('updateLeaderboard', playerList);
    io.emit('updatePlayerCount', Object.keys(players).length);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur MILTAPE en ligne sur le port ${PORT}`);
});
