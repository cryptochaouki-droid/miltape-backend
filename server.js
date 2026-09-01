    // Inscription / Connexion au jeu (Sécurisée et ultra-permissive pour la démo)
    socket.on("player:join", async (data) => {
        try {
            console.log("📥 Données de join reçues du client :", data);
            
            const name = String(data?.name || "Joueur Anonyme").trim().substring(0, 30);
            const wallet = String(data?.wallet || "DEMO_WALLET").trim();
            const deviceId = String(data?.deviceId || socket.id);
            
            // Si le client clique sur démo, bet est 0 ou non défini
            const bet = Number(data?.bet) || 0;
            const isDemo = (bet === 0 || data?.token === "DEMO" || !data?.bet);
            
            const token = isDemo ? "USDT" : String(data?.token || "USDT").toUpperCase();
            const paid = true; // On force à true pour ne bloquer personne en test / démo
            const paymentTxId = isDemo ? "DEMO_" + Date.now() : ("TX_" + Date.now());
            const sessionToken = "SESS-" + Math.random().toString(36).substring(2) + Date.now().toString(36);

            let existingPlayer = await Player.findOne({ deviceId, gameId: game.id });

            if (existingPlayer) {
                existingPlayer.name = name;
                existingPlayer.wallet = wallet;
                existingPlayer.bet = bet;
                existingPlayer.token = token;
                existingPlayer.paid = paid;
                existingPlayer.paymentTxId = paymentTxId;
                existingPlayer.sessionToken = sessionToken;
                await existingPlayer.save();

                socket.data.playerId = existingPlayer._id.toString();
                socket.data.playerName = existingPlayer.name;
                socket.data.sessionToken = sessionToken;

                console.log("✅ Joueur mis à jour et connecty (Démo/Réel):", existingPlayer.name);
                socket.emit("player:joined", { success: true, player: existingPlayer, game: getGameStateObject() });
            } else {
                const player = await Player.create({
                    gameId: game.id,
                    name,
                    wallet,
                    deviceId,
                    taps: 0,
                    weeklyTaps: 0,
                    bet,
                    paid: paid,
                    paymentTxId: paymentTxId,
                    token,
                    depositAmount: bet,
                    sessionToken: sessionToken
                });

                socket.data.playerId = player._id.toString();
                socket.data.playerName = player.name;
                socket.data.sessionToken = sessionToken;

                console.log("✅ Nouveau joueur créé avec succès:", player.name);
                socket.emit("player:joined", { success: true, player, game: getGameStateObject() });
            }

            socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds() });
            await emitLeaderboard();
        } catch (error) {
            console.error("❌ Erreur critique player:join :", error);
            socket.emit("error", { message: "Erreur serveur lors de l'inscription." });
        }
    });
