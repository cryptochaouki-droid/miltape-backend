// server.js (Structure sécurisée)
const express = require('express');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

// Connexion à la base de données
mongoose.connect(process.env.MONGO_URI);

// Modèle de Joueur
const PlayerSchema = new mongoose.Schema({
    username: String,
    walletAddress: String,
    balance: { type: Number, default: 0 }, // Solde en USDT
    totalScore: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', PlayerSchema);

// ... (config socket.io ici)

// ANTI-TRICHE : Le client ne dit pas "j'ai 100 points", il dit "j'ai fait un clic"
socket.on('playerTap', async (playerId) => {
    // Vérification : Le serveur vérifie le temps entre 2 clics pour bloquer les bots/auto-clickers
    const now = Date.now();
    if (userLastTapTime[playerId] && (now - userLastTapTime[playerId] < 50)) {
        return; // Clic trop rapide, probablement un tricheur
    }
    userLastTapTime[playerId] = now;

    // Mise à jour sécurisée du score en base de données
    await Player.updateOne({ _id: playerId }, { $inc: { totalScore: 1 } });
});
// Durée d'une partie : 10 minutes en millisecondes
const GAME_DURATION = 10 * 60 * 1000; 

// Gestion d'une session de tournoi de 10 minutes
function startTournamentRoom(roomId) {
    let room = activeRooms[roomId];
    room.status = "playing";
    room.endTime = Date.now() + GAME_DURATION;

    // Le serveur prévient tous les joueurs que les 10 minutes commencent
    io.to(roomId).emit('tournamentStarted', { duration: GAME_DURATION });

    // Timer de fin de partie géré par le serveur (et non par le téléphone du joueur)
    setTimeout(async () => {
        room.status = "ended";
        
        // Trier les joueurs du salon par score du plus grand au plus petit
        let sortedPlayers = room.players.sort((a, b) => b.score - a.score);

        // Distribuer les gains (1er, 2ème, 3ème...)
        await distributePrizes(sortedPlayers, room.entryFee);

        io.to(roomId).emit('tournamentEnded', sortedPlayers);
    }, GAME_DURATION);
}
