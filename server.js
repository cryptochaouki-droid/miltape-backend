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
