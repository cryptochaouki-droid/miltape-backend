const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/* =========================================================
   CONFIGURATION
========================================================= */

const PORT = process.env.PORT || 8080;

const MONGO_URI = process.env.MONGO_URI;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "https://uki-droid.github.io";

const IPN_URL =
    process.env.IPN_URL ||
    "https://miltape-backend-production.up.railway.app/api/ipn";

const MIN_BET = 13;
const GAME_DURATION = 600; // 10 minutes

let mongoConnected = false;

/* =========================================================
   LOGS DE DÉMARRAGE
========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log("Minimum mise :", MIN_BET, "USDT");
console.log("Paiement : USDT TRC20");
console.log("Partie : 10 minutes");
console.log("MongoDB :", MONGO_URI ? "CONFIGURÉ" : "❌ MANQUANT");
console.log(
    "NOWPayments :",
    NOWPAYMENTS_API_KEY ? "CONFIGURÉ" : "❌ MANQUANT"
);
console.log("Frontend :", FRONTEND_URL);
console.log("======================================");

/* =========================================================
   MONGODB (Avec Solde Interne / Balance)
========================================================= */

const playerSchema = new mongoose.Schema({
    playerId: {
        type: String,
        required: true,
        index: true
    },

    playerName: {
        type: String,
        default: "Anonyme"
    },

    score: {
        type: Number,
        default: 0
    },

    balance: {
        type: Number,
        default: 0
    },

    amount: {
        type: Number,
        default: 0
    },

    cryptoAddress: {
        type: String,
        default: ""
    },

    paymentId: {
        type: String,
        default: ""
    },

    paymentStatus: {
        type: String,
        default: "pending"
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Player = mongoose.model("Player", playerSchema);

async function connectMongoDB() {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI manquant dans Railway.");
        console.error(
            "➡️ Railway > Variables > MONGO_URI = ton URL MongoDB Atlas"
        );
        return;
    }

    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });

        mongoConnected = true;

        console.log("✅ MongoDB connecté");
    } catch (error) {
        mongoConnected = false;

        console.error("❌ Erreur MongoDB :", error.message);
    }
}

connectMongoDB();

/* =========================================================
   ROUTE TEST
========================================================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "Miltape World Challenge",
        status: "online",
        mongo: mongoConnected,
        minBet: MIN_BET,
        paymentCurrency: "USDTTRC20",
        gameDuration: GAME_DURATION
    });
});

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        server: "online",
        mongo: mongoConnected,
        nowpayments: !!NOWPAYMENTS_API_KEY,
        minimumBet: MIN_BET,
        paymentCurrency: "USDTTRC20",
        gameDuration: GAME_DURATION
    });
});

/* =========================================================
   CRÉATION FACTURE NOWPAYMENTS (Dépôt pour recharger le solde)
========================================================= */

app.post("/api/create-payment", async (req, res) => {

    try {

        const {
            playerId,
            playerName,
            amount,
            cryptoAddress
        } = req.body;

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_ID_REQUIRED"
            });
        }

        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_AMOUNT"
            });
        }

        if (numericAmount < MIN_BET) {

            return res.status(400).json({
                success: false,
                error: `MINIMUM_BET_${MIN_BET}_USDT`,
                message: `La mise minimum est de ${MIN_BET} USDT.`
            });

        }

        if (!NOWPAYMENTS_API_KEY) {

            console.error("❌ NOWPAYMENTS_API_KEY manquante.");

            return res.status(500).json({
                success: false,
                error: "NOWPAYMENTS_API_KEY_MISSING"
            });

        }

        const orderId =
            `MILTAPE_${playerId}_${Date.now()}`;

        const invoiceData = JSON.stringify({

            price_amount: numericAmount,

            price_currency: "usd",

            order_id: orderId,

            order_description:
                `Miltape - Crédit de ${numericAmount} USDT`,

            ipn_callback_url: IPN_URL,

            success_url:
                FRONTEND_URL,

            cancel_url:
                FRONTEND_URL

        });

        const options = {

            hostname: "api.nowpayments.io",

            path: "/v1/invoice",

            method: "POST",

            headers: {

                "Content-Type":
                    "application/json",

                "Content-Length":
                    Buffer.byteLength(invoiceData),

                "x-api-key":
                    NOWPAYMENTS_API_KEY

            }

        };

        const paymentReq =
            https.request(options, (apiRes) => {

                let data = "";

                apiRes.on("data", (chunk) => {
                    data += chunk;
                });

                apiRes.on("end", async () => {

                    let responseJson;

                    try {

                        responseJson =
                            JSON.parse(data);

                    } catch (error) {

                        return res.status(502).json({
                            success: false,
                            error: "NOWPAYMENTS_INVALID_RESPONSE"
                        });

                    }

                    if (
                        apiRes.statusCode < 200 ||
                        apiRes.statusCode >= 300
                    ) {

                        const message =
                            responseJson.message ||
                            responseJson.error ||
                            "Erreur NOWPayments";

                        return res.status(400).json({

                            success: false,

                            error:
                                `NOWPAYMENTS_ERROR: ${message}`,

                            details:
                                responseJson

                        });

                    }

                    const invoiceUrl =
                        responseJson.invoice_url ||
                        responseJson.invoiceUrl;

                    if (!invoiceUrl) {

                        return res.status(502).json({

                            success: false,

                            error:
                                "NOWPAYMENTS_INVOICE_URL_MISSING",

                            details:
                                responseJson

                        });

                    }

                    if (mongoConnected) {

                        try {

                            // On enregistre la tentative de recharge (le solde sera crédité via l'IPN)
                            await Player.create({

                                playerId,

                                playerName:
                                    playerName || "Anonyme",

                                amount:
                                    numericAmount,

                                cryptoAddress:
                                    cryptoAddress || "",

                                paymentId:
                                    responseJson.id ||
                                    responseJson.invoice_id ||
                                    "",

                                paymentStatus:
                                    "pending",

                                score: 0

                            });

                        } catch (mongoError) {

                            console.error(
                                "⚠️ Erreur sauvegarde MongoDB :",
                                mongoError.message
                            );

                        }

                    }

                    return res.json({

                        success: true,

                        invoice_url:
                            invoiceUrl,

                        invoice_id:
                            responseJson.id ||
                            responseJson.invoice_id ||
                            null,

                        order_id:
                            orderId,

                        amount:
                            numericAmount,

                        currency:
                            "USDTTRC20"

                    });

                });

            });

        paymentReq.on("error", (error) => {
            return res.status(500).json({
                success: false,
                error: "NOWPAYMENTS_CONNECTION_ERROR"
            });
        });

        paymentReq.write(invoiceData);
        paymentReq.end();

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "SERVER_ERROR"
        });
    }

});

/* =========================================================
   IPN NOWPAYMENTS (Automatisation de l'ajout au solde)
========================================================= */

app.post("/api/ipn", async (req, res) => {

    try {

        const data = req.body;
        const orderId = data.order_id;
        const paymentStatus = data.payment_status || "unknown";

        console.log("📩 IPN NOWPayments reçu :", orderId, "| Status :", paymentStatus);

        if (mongoConnected && orderId) {

            const parts = String(orderId).split("_");
            const playerId = parts.length >= 2 ? parts[1] : null;

            if (playerId) {
                // Met à jour le statut du paiement
                await Player.updateMany(
                    { paymentId: data.id || data.invoice_id || orderId },
                    { $set: { paymentStatus } }
                );

                // Si le paiement est validé/terminé avec succès, on crédite automatiquement le solde du joueur !
                if (["finished", "confirmed", "sending"].includes(paymentStatus)) {
                    const record = await Player.findOne({ paymentId: data.id || data.invoice_id || orderId });
                    if (record && record.amount > 0) {
                        await Player.updateMany(
                            { playerId },
                            { $inc: { balance: record.amount } }
                        );
                        console.log(`✅ Solde crédité de ${record.amount} USDT pour le joueur ${playerId}`);
                    }
                }
            }

        }

        res.status(200).json({ success: true });

    } catch (error) {
        console.error("❌ IPN error :", error.message);
        res.status(200).json({ success: false });
    }

});

/* =========================================================
   LANCER UNE PARTIE EN 1 CLIC (Déduction de la balance)
========================================================= */

app.post("/api/play-game", async (req, res) => {
    try {
        const { playerId, playerName } = req.body;
        if (!playerId || !mongoConnected) {
            return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
        }

        // On cherche ou crée le profil du joueur
        let player = await Player.findOne({ playerId });
        
        const currentBalance = player ? player.balance : 0;

        if (currentBalance < MIN_BET) {
            return res.status(400).json({
                success: false,
                error: "INSUFFICIENT_BALANCE",
                message: "Solde insuffisant. Recharge ton compte !"
            });
        }

        // Déduction automatique de la mise de la balance
        await Player.updateOne(
            { playerId },
            { 
                $inc: { balance: -MIN_BET },
                $set: { playerName: playerName || player.playerName || "Anonyme" }
            },
            { upsert: true }
        );

        return res.json({
            success: true,
            message: "Partie lancée avec succès !",
            newBalance: currentBalance - MIN_BET
        });

    } catch (error) {
        console.error("❌ Erreur play-game :", error);
        return res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }
});

/* =========================================================
   TOTAL DES MISES
========================================================= */

app.get("/api/total-stakes", async (req, res) => {

    if (!mongoConnected) {
        return res.json({
            success: true,
            totalStakes: 0,
            mongo: false
        });
    }

    try {

        const result =
            await Player.aggregate([
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: "$amount"
                        }
                    }
                }
            ]);

        const totalStakes =
            result.length
                ? Number(result[0].total || 0)
                : 0;

        res.json({
            success: true,
            totalStakes: Number(totalStakes.toFixed(2))
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: "TOTAL_STAKES_ERROR",
            totalStakes: 0
        });
    }

});

/* =========================================================
   STATS JOUEUR (Inclut le solde actuel)
========================================================= */

app.get(
    "/api/player-stats/:playerId",
    async (req, res) => {

        try {

            if (!mongoConnected) {
                return res.json({
                    success: true,
                    totalTaps: 0,
                    totalUsdt: 0,
                    balance: 0,
                    history: []
                });
            }

            const playerId = req.params.playerId;

            const records =
                await Player
                    .find({ playerId })
                    .sort({ createdAt: -1 })
                    .lean();

            const playerDoc = records[0] || {};
            const balance = playerDoc.balance || 0;

            const totalTaps =
                records.reduce(
                    (sum, p) =>
                        sum + Number(p.score || 0),
                    0
                );

            const totalUsdt =
                records.reduce(
                    (sum, p) =>
                        sum + Number(p.amount || 0),
                    0
                );

            res.json({
                success: true,
                totalTaps,
                totalUsdt,
                balance,
                history: records.map(p => ({
                    date: p.createdAt,
                    score: p.score || 0,
                    amount: p.amount || 0,
                    paymentStatus: p.paymentStatus || "pending"
                }))
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: "PLAYER_STATS_ERROR"
            });
        }

    }
);

/* =========================================================
   LEADERBOARD
========================================================= */

async function broadcastLeaderboard() {

    if (!mongoConnected) {
        io.emit("leaderboard", []);
        return;
    }

    try {

        const topPlayers =
            await Player.aggregate([
                {
                    $group: {
                        _id: "$playerId",
                        playerName: { $last: "$playerName" },
                        score: { $sum: "$score" }
                    }
                },
                {
                    $sort: {
                        score: -1
                    }
                },
                {
                    $limit: 5
                }
            ]);

        io.emit("leaderboard", topPlayers);

    } catch (error) {
        console.error("❌ leaderboard :", error.message);
    }

}

/* =========================================================
   TIMER
========================================================= */

let timerLeft = GAME_DURATION;

setInterval(() => {

    timerLeft--;

    if (timerLeft <= 0) {
        timerLeft = GAME_DURATION;
        console.log("🔥 NOUVELLE PARTIE");
        io.emit("newGame");
    }

    io.emit("timer", timerLeft);

}, 1000);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {

    console.log("👤 Joueur connecté :", socket.id);

    socket.emit("timer", timerLeft);

    socket.on("join", async (data) => {
        socket.data = data || {};
        io.emit("onlineCount", io.engine.clientsCount);
        await broadcastLeaderboard();
    });

    socket.on("chatMessage", (msg) => {
        if (!msg) return;

        const message = String(msg.message || msg.text || "").trim().substring(0, 250);
        if (!message) return;

        io.emit("chatMessage", {
            playerName: String(msg.playerName || "Anonyme").substring(0, 30),
            message
        });
    });

    socket.on("tap", async (data) => {
        try {
            if (!mongoConnected || !data || !data.playerId) return;

            await Player.create({
                playerId: data.playerId,
                playerName: data.playerName || "Anonyme",
                score: Number(data.taps) || 1,
                amount: 0,
                paymentStatus: "finished"
            });

            await broadcastLeaderboard();
        } catch (error) {
            console.error("❌ Erreur tap :", error.message);
        }
    });

    socket.on("disconnect", () => {
        console.log("🔌 Joueur déconnecté :", socket.id);
        io.emit("onlineCount", io.engine.clientsCount);
    });

});

/* =========================================================
   START SERVER
========================================================= */

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Miltape lancé sur le port ${PORT}`);
    console.log(`💰 Mise minimum : ${MIN_BET} USDT`);
    console.log("🪙 Paiement : USDT TRC20 (Système de solde interne activé)");
    console.log("⏱️ Partie : 10 minutes");
});
