socket.emit("player:joined", { success: true, player, game: getGameStateObject() });
            }

            socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
            await broadcastGameState();
        } catch (error) {
            console.error("❌ Erreur player:join :", error?.message || error);
            socket.emit("error", { message: "Erreur lors de l'inscription." });
        }
    });

    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running") return;
            const playerId = socket.data.playerId;
            if (!playerId) return;

            const player = await Player.findOne({ _id: playerId, gameId: game.id });
            if (!player || !player.paid) return;

            player.taps += 1;
            player.weeklyTaps += 1;
            await player.save();

            await emitLeaderboard();
        } catch (e) {
            console.error("❌ Erreur player:tap :", e?.message || e);
        }
    });

    // ===== GESTION DES DUELS 1V1 =====
    socket.on("duel:find", async (data) => {
        try {
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").toUpperCase();
            const playerId = socket.data.playerId;

            if (!playerId || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token]) {
                return socket.emit("error", { message: "Paramètres de duel invalides." });
            }

            const player = await Player.findById(playerId);
            if (!player) return socket.emit("error", { message: "Joueur introuvable." });

            const poolKey = `${token}_${bet}`;
            if (!duelPools[poolKey]) duelPools[poolKey] = [];

            // Éviter les doublons dans le pool
            duelPools[poolKey] = duelPools[poolKey].filter(p => p.socketId !== socket.id);

            if (duelPools[poolKey].length > 0) {
                // Adversaire trouvé ! Création du match en attente de paiement
                const opponent = duelPools[poolKey].shift();
                const opponentSocket = io.sockets.sockets.get(opponent.socketId);

                if (!opponentSocket) {
                    // Si l'adversaire s'est déconnecté, on remet le joueur actuel dans le pool
                    duelPools[poolKey].push({ socketId: socket.id, playerId });
                    return socket.emit("duel:searching", { message: "Recherche d'un adversaire..." });
                }

                const matchId = "DUEL-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                
                duelMatches[matchId] = {
                    player1: { socketId: opponent.socketId, playerId: opponent.playerId, paid: false },
                    player2: { socketId: socket.id, playerId: playerId, paid: false },
                    bet,
                    token,
                    createdAt: Date.now()
                };

                // Notifier les deux joueurs qu'un adversaire a été trouvé, invite au paiement
                opponentSocket.emit("duel:matched", { matchId, bet, token, timeoutMs: DUEL_PAYMENT_TIMEOUT_MS });
                socket.emit("duel:matched", { matchId, bet, token, timeoutMs: DUEL_PAYMENT_TIMEOUT_MS });

                console.log(`⚔️ Duel trouvé (${matchId}) : ${bet} ${token} entre ${opponent.playerId} et ${playerId}`);

            } else {
                // Aucun adversaire, ajout au pool
                duelPools[poolKey].push({ socketId: socket.id, playerId });
                socket.emit("duel:searching", { message: "En attente d'un adversaire..." });
            }
        } catch (e) {
            console.error("❌ Erreur duel:find :", e);
            socket.emit("error", { message: "Erreur lors de la recherche du duel." });
        }
    });

    socket.on("duel:pay", async (data) => {
        try {
            const { matchId, txId } = data;
            const match = duelMatches[matchId];
            const playerId = socket.data.playerId;

            if (!match || !playerId) return socket.emit("error", { message: "Match ou joueur invalide." });

            const isPlayer1 = match.player1.playerId === playerId;
            const isPlayer2 = match.player2.playerId === playerId;

            if (!isPlayer1 && !isPlayer2) return socket.emit("error", { message: "Non autorisé pour ce match." });

            const currentPlayerObj = isPlayer1 ? match.player1 : match.player2;
            const player = await Player.findById(playerId);

            if (!player) return socket.emit("error", { message: "Joueur introuvable." });

            // Mode Démo ou Vérification On-Chain
            let verified = false;
            if (txId && txId.startsWith('DEMO_') && DEMO_MODE_ENABLED_ON_SERVER) {
                verified = true;
            } else {
                verified = await verifyOnChain(txId, match.bet, match.token, player.wallet);
            }

            if (!verified) {
                return socket.emit("error", { message: "Échec de la vérification de la transaction du duel." });
            }

            currentPlayerObj.paid = true;
            currentPlayerObj.paymentTxId = txId;
            socket.emit("duel:payment:verified", { success: true });

            // Vérifier si les deux joueurs ont payé
            if (match.player1.paid && match.player2.paid) {
                delete duelMatches[matchId];
                
                const p1Socket = io.sockets.sockets.get(match.player1.socketId);
                const p2Socket = io.sockets.sockets.get(match.player2.socketId);

                const duelGameId = "GAME-DUEL-" + Date.now();
                const totalPot = match.bet * 2;
                const commission = totalPot * DUEL_COMMISSION_PERCENT;
                const winnerPrize = totalPot - commission;

                const duelData = {
                    matchId,
                    winnerPrize,
                    token: match.token,
                    durationSeconds: 30 // 30 secondes de tap pour le duel
                };

                if (p1Socket) p1Socket.emit("duel:start", duelData);
                if (p2Socket) p2Socket.emit("duel:start", duelData);

                // Initialiser l'état actif du duel
                activeDuels[matchId] = {
                    socket1: match.player1.socketId,
                    socket2: match.player2.socketId,
                    player1Id: match.player1.playerId,
                    player2Id: match.player2.playerId,
                    taps1: 0,
                    taps2: 0,
                    winnerPrize,
                    token: match.token,
                    ended: false
                };

                // Timer de fin de duel (30 sec)
                setTimeout(async () => {
                    const duel = activeDuels[matchId];
                    if (!duel || duel.ended) return;
                    duel.ended = true;

                    let winnerId = null;
                    let loserId = null;
                    let winnerSocketId = null;
                    let isDraw = false;

                    if (duel.taps1 > duel.taps2) {
                        winnerId = duel.player1Id;
                        loserId = duel.player2Id;
                        winnerSocketId = duel.socket1;
                    } else if (duel.taps2 > duel.taps1) {
                        winnerId = duel.player2Id;
                        loserId = duel.player1Id;
                        winnerSocketId = duel.socket2;
                    } else {
                        isDraw = true;
                    }

                    let payoutTxId = "DRAW";
                    if (!isDraw && winnerSocketId) {
                        const winnerPlayer = await Player.findById(winnerId);
                        if (winnerPlayer) {
                            payoutTxId = await sendPrizeToWinner({
                                wallet: winnerPlayer.wallet,
                                gain: duel.winnerPrize,
                                token: duel.token,
                                playerName: winnerPlayer.name
                            });
                        }
                    }

                    const resultPayload = {
                        isDraw,
                        winnerId,
                        prize: duel.winnerPrize,
                        token: duel.token,
                        taps1: duel.taps1,
                        taps2: duel.taps2,
                        payoutTxId
                    };

                    const s1 = io.sockets.sockets.get(duel.socket1);
                    const s2 = io.sockets.sockets.get(duel.socket2);

                    if (s1) s1.emit("duel:ended", resultPayload);
                    if (s2) s2.emit("duel:ended", resultPayload);

                    delete activeDuels[matchId];
                }, 30000);
            }
        } catch (e) {
            console.error("❌ Erreur duel:pay :", e);
            socket.emit("error", { message: "Erreur lors du traitement du paiement du duel." });
        }
    });

    socket.on("duel:tap", (data) => {
        try {
            const { matchId } = data;
            const duel = activeDuels[matchId];
            if (!duel || duel.ended) return;

            const playerId = socket.data.playerId;
            if (playerId === duel.player1Id) {
                duel.taps1 += 1;
            } else if (playerId === duel.player2Id) {
                duel.taps2 += 1;
            }
        } catch (e) {
            console.error("❌ Erreur duel:tap :", e);
        }
    });

    // ===== CHAT =====
    socket.on("chat:message", async (data) => {
        try {
            const message = String(data?.message || "").trim().substring(0, 250);
            const name = String(socket.data.playerName || data?.name || "Anonyme").trim().substring(0, 30);
            if (!message) return;

            const msgDoc = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { name: msgDoc.name, message: msgDoc.message, createdAt: msgDoc.createdAt });
        } catch (e) {
            console.error("❌ Erreur chat :", e);
        }
    });

    // ===== DÉCONNEXION =====
    socket.on("disconnect", () => {
        onlineSockets.delete(socket.id);
        console.log(`🔴 Déconnexion Socket : ${socket.id}`);
        broadcastOnlineCount();

        // Nettoyage des pools de duels si le joueur était en attente
        for (const poolKey of Object.keys(duelPools)) {
            duelPools[poolKey] = duelPools[poolKey].filter(p => p.socketId !== socket.id);
        }
    });
});

// ===== ROUTES API EXPRESS =====
app.get("/api/game/state", async (req, res) => {
    try {
        res.json({ game: getGameStateObject() });
    } catch (e) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.get("/api/leaderboard", async (req, res) => {
    try {
        if (!game.id) return res.json({ leaderboard: [] });
        const players = await Player.find({ gameId: game.id }).select("name taps -_id").sort({ taps: -1 }).limit(50).lean();
        res.json({ leaderboard: players.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps })) });
    } catch (e) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// ===== DÉMARRAGE DU SERVEUR =====
async function startServer() {
    await connectMongoDB();
    await loadOrCreateGameState();

    server.listen(PORT, () => {
        console.log(`🚀 Serveur Miltape démarré sur le port ${PORT}`);
    });

    // Tâches de fond régulières
    setInterval(() => {
        checkPendingPayments().catch(err => console.error(err));
    }, 10000);
}

startServer().catch(err => {
    console.error("❌ Erreur critique au démarrage :", err);
    process.exit(1);
});
