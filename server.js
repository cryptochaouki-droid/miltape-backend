socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = String(data?.wallet || "").trim();
            const deviceId = String(data?.deviceId || socket.id);
            const token = String(data?.token || "USDT").toUpperCase();
            const bet = Number(data?.bet);

            if (!name) {
                return socket.emit("error", { message: "Le pseudo est obligatoire." });
            }

            // Détection du mode démo (si bet = 0 ou non défini)
            const isDemo = (!Number.isFinite(bet) || bet <= 0);
            const paid = isDemo ? true : false;
            const paymentTxId = isDemo ? "DEMO_" + Date.now() : null;

            // ... la suite de votre code pour enregistrer ou récupérer le joueur en BDD ...
