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

// Connexion à MongoDB (Assure-toi d'ajouter MONGO_URI dans les variables Railway)
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("📦 Connecté à MongoDB"))
  .catch(err => console.error("Erreur MongoDB :", err));

// Schéma du Joueur
const playerSchema = new mongoose.Schema({
    socketId: String,
    username: String,
    balance: { type: Number, default: 0 }, // Solde USDT
    score: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// Gestion des rooms de tournoi (10 minutes)
const GAME_DURATION = 10 * 60 * 1000; 
let waitingPlayers = []; // Joueurs en attente pour former un groupe de 5
let activeTournaments = {};

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur connecté : ${socket.id}`);

    // Enregistrement du pseudo
    socket.on('setPseudo', async (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            const cleanPseudo = pseudo.trim();
            // Sauvegarde ou mise à jour dans MongoDB
            await Player.findOneAndUpdate(
                { socketId: socket.id },
                { username: cleanPseudo, score: 0 },
                { upsert: true, new: true }
            );
            socket.emit('pseudoAccepted', cleanPseudo);
        }
    });

    // Le joueur rejoint la file d'attente pour un tournoi (Mise de 1 USDT par exemple)
    socket.on('joinQueue', async () => {
        let player = await Player.findOne({ socketId: socket.id });
        if(!player) return;

        // Vérification si le joueur a assez d'argent (Simulation : on autorise ou on vérifie le solde)
        // if(player.balance < 1) { socket.emit('errorMsg', "Solde insuffisant !"); return; }

        // Retirer le joueur de la liste d'attente s'il y est déjà
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        waitingPlayers.push(player);

        socket.emit('inQueue', { position: waitingPlayers.length });

        // Si on a 5 joueurs, on lance un salon de tournoi !
        if(waitingPlayers.length >= 5) {
            let roomPlayers = waitingPlayers.splice(0, 5); // Prend les 5 premiers
            let roomId = 'room_' + Date.now();

            activeTournaments[roomId] = {
                players: roomPlayers,
                status: 'playing',
                endTime: Date.now() + GAME_DURATION
            };

            // Mettre les joueurs dans la socket room
            roomPlayers.forEach(p => {
                const s = io.sockets.sockets.get(p.socketId);
                if(s) {
                    s.join(roomId);
                    s.emit('startTournament', { duration: GAME_DURATION });
                }
            });

            // Chrono de fin de partie de 10 minutes géré par le serveur
            setTimeout(() => {
                endTournament(roomId);
            }, GAME_DURATION);
        }
    });

    // ANTI-TRICHE : Clic validé par le serveur avec vérification du temps (pas plus de 15 clics/sec)
    let lastTapTimes = {};
    socket.on('playerTap', async () => {
        let now = Date.now();
        if(lastTapTimes[socket.id] && (now - lastTapTimes[socket.id] < 60)) {
            return; // Bloqué : Clics trop suspects (Auto-clicker / Bot)
        }
        lastTapTimes[socket.id] = now;

        // Incrémente le score en base de données
        let updatedPlayer = await Player.findOneAndUpdate(
            { socketId: socket.id },
            { $inc: { score: 1 } },
            { new: true }
        );

        if(updatedPlayer) {
            // Envoyer le nouveau score au joueur concerné
            socket.emit('scoreUpdated', updatedPlayer.score);
        }
    });

    socket.on('disconnect', async () => {
        console.log(`❌ Déconnecté : ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(p => p.socketId !== socket.id);
        await Player.deleteOne({ socketId: socket.id });
    });
});

// Fin du tournoi de 10 minutes
async function endTournament(roomId) {
    let tournament = activeTournaments[roomId];
    if(!tournament) return;

    tournament.status = 'ended';

    // Récupérer les scores finaux des 5 joueurs de la room depuis MongoDB
    let playersInRoom = await Player.find({ socketId: { $in: tournament.players.map(p => p.socketId) } });
    
    // Trier du plus grand au plus petit score
    playersInRoom.sort((a, b) => b.score - a.score);

    // Distribution des gains (1er gagne le double ou plus selon ta règle)
    // Exemple : 1er = 4 USDT, 2ème = 2 USDT, etc.
    let results = playersInRoom.map((p, index) => ({
        rank: index + 1,
        username: p.username,
        score: p.score,
        prize: index === 0 ? 4 : (index === 1 ? 2 : 0) // Exemple de répartition
    }));

    // Envoyer les résultats finaux à la room
    io.to(roomId).emit('tournamentResults', results);

    // Nettoyage
    delete activeTournaments[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur sécurisé MILTAPE en ligne sur le port ${PORT}`);
});
