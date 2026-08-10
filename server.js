const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    }).then(() => console.log("📦 Connecté à MongoDB"))
      .catch(err => console.error("Erreur MongoDB :", err));
}

const playerSchema = new mongoose.Schema({
    socketId: String,
    username: String,
    score: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

const GAME_DURATION = 10 * 60 * 1000; 
let waitingPlayers = []; 
let activeTournaments = {};

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur connecté : ${socket.id}`);

    socket.on('setPseudo', async (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            const cleanPseudo = pseudo.trim();
            await Player.findOneAndUpdate(
                { socketId: socket.id },
                { username: cleanPseudo, score: 0 },
                { upsert: true, new: true }
            );
            socket.emit('pseudoAccepted', cleanPseudo);
        }
    });

    socket.on('joinQueue', async () => {
        let player = await Player.findOne({ socketId: socket.id });
        if(!player) return;

        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        waitingPlayers.push(player);

        socket.emit('inQueue', { position: waitingPlayers.length });

        // LANCEMENT IMMÉDIAT (1 joueur requis pour tes tests)
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
                    s.emit('startTournament', { duration: GAME_DURATION });
                }
            });

            setTimeout(() => {
                endTournament(roomId);
            }, GAME_DURATION);
        }
    });

    let lastTapTimes = {};
    socket.on('playerTap', async () => {
        let now = Date.now();
        if(lastTapTimes[socket.id] && (now - lastTapTimes[socket.id] < 60)) {
            return; 
        }
        lastTapTimes[socket.id] = now;

        let updatedPlayer = await Player.findOneAndUpdate(
            { socketId: socket.id },
            { $inc: { score: 1 } },
            { new: true }
        );

        if(updatedPlayer) {
            socket.emit('scoreUpdated', updatedPlayer.score);
        }
    });

    socket.on('disconnect', async () => {
        console.log(`❌ Déconnecté : ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        await Player.deleteOne({ socketId: socket.id });
    });
});

async function endTournament(roomId) {
    let tournament = activeTournaments[roomId];
    if(!tournament) return;

    tournament.status = 'ended';
    let playersInRoom = await Player.find({ socketId: { $in: tournament.players.map(p => p.socketId) } });
    playersInRoom.sort((a, b) => b.score - a.score);

    let results = playersInRoom.map((p, index) => ({
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
