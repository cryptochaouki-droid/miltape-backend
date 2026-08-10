const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let waitingPlayers = []; 
let activeTournaments = {};
const GAME_DURATION = 10 * 60 * 1000; // 10 minutes

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur connecté : ${socket.id}`);

    socket.on('setPseudo', (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            const cleanPseudo = pseudo.trim();
            socket.data.username = cleanPseudo;
            socket.emit('pseudoAccepted', cleanPseudo);
        }
    });

    socket.on('joinQueue', () => {
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        waitingPlayers.push({ socketId: socket.id, username: socket.data.username || "Joueur", score: 0 });

        socket.emit('inQueue', { position: waitingPlayers.length });

        // LANCEMENT IMMÉDIAT DÈS QU'UN JOUEUR ENTRE (pas d'attente inutile)
        if(waitingPlayers.length >= 1) {
            let roomPlayers = waitingPlayers.splice(0, 1);
            let roomId = 'room_' + Date.now();

            activeTournaments[roomId] = {
                players: roomPlayers,
                status: 'playing',
                endTime: Date.now() + GAME_DURATION
            };

            roomPlayers.forEach(p => {
                const s = io.sockets.sockets.get(p.socketId);
                if(s) {
                    s.join(roomId);
                    s.currentRoom = roomId;
                    s.emit('startTournament', { duration: GAME_DURATION });
                }
            });

            setTimeout(() => {
                endTournament(roomId);
            }, GAME_DURATION);
        }
    });

    let lastTapTimes = {};
    socket.on('playerTap', () => {
        let now = Date.now();
        if(lastTapTimes[socket.id] && (now - lastTapTimes[socket.id] < 60)) {
            return; 
        }
        lastTapTimes[socket.id] = now;

        let room = socket.currentRoom;
        if(room && activeTournaments[room]) {
            let p = activeTournaments[room].players.find(x => x.socketId === socket.id);
            if(p) {
                p.score += 1;
                socket.emit('scoreUpdated', p.score);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Déconnecté : ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
    });
});

function endTournament(roomId) {
    let tournament = activeTournaments[roomId];
    if(!tournament) return;

    tournament.status = 'ended';
    // Trie par score décroissant et garde les 5 meilleurs maximum
    tournament.players.sort((a, b) => b.score - a.score);
    let topPlayers = tournament.players.slice(0, 5);

    let results = topPlayers.map((p, index) => ({
        rank: index + 1,
        username: p.username,
        score: p.score
    }));

    io.to(roomId).emit('tournamentResults', results);
    delete activeTournaments[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur MILTAPE en ligne sur le port ${PORT}`);
});
