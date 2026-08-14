const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors());
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

if (!MONGO_URI) {
    console.error("❌ MONGO_URI n'est pas configurée dans Railway.");
}

/* =========================================================
   MONGODB
========================================================= */

mongoose.set("strictQuery", true);

let mongoConnected = false;

async function connectMongoDB() {
    if (!MONGO_URI) {
        console.error("❌ Impossible de connecter MongoDB : MONGO_URI absente.");
        return;
    }

    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            maxPoolSize: 10,
            minPoolSize: 1
        });

        mongoConnected = true;

        console.log("✅ MongoDB connecté");
        console.log(`📦 Base MongoDB : ${mongoose.connection.name}`);

    } catch (error) {
        mongoConnected = false;

        console.error("❌ Erreur connexion MongoDB :", error.message);

        // Nouvelle tentative dans 5 secondes
        setTimeout(connectMongoDB, 5000);
    }
}

mongoose.connection.on("connected", () => {
    mongoConnected = true;
    console.log("🟢 MongoDB ONLINE");
});

mongoose.connection.on("disconnected", () => {
    mongoConnected = false;
    console.error("🔴 MongoDB déconnecté");
});

mongoose.connection.on("error", (error) => {
    mongoConnected = false;
    console.error("⚠️ MongoDB error :", error.message);
});

/* =========================================================
   PLAYER MODEL
========================================================= */

const playerSchema = new mongoose.Schema(
    {
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
            default: 0,
            min: 0
        },

        amount: {
            type: Number,
            default: 0,
            min: 0
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        versionKey: false
    }
);

playerSchema.index({ playerId: 1 });
playerSchema.index({ score: -1 });

const players = mongoose.model("Player", playerSchema);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        game: "Miltape World Challenge",
        status: "online",
        mongodb: mongoConnected ? "connected" : "disconnected",
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        server: "online",
        mongodb: mongoConnected
    });
});

/* =========================================================
   CREATE NOWPAYMENTS PAYMENT
========================================================= */

app.post("/api/create-payment", async (req, res) => {
    try {
        const {
            playerId,
            playerName,
            amount
        } = req.body;

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_ID_REQUIRED"
            });
        }

        const numericAmount = parseFloat(amount);

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: "INVALID_AMOUNT"
            });
        }

        const apiKey = process.env.NOWPAYMENTS_API_KEY;

        if (!apiKey) {
            console.error("❌ NOWPAYMENTS_API_KEY absente.");

            return res.status(500).json({
                success: false,
                error: "PAYMENT_CONFIGURATION_ERROR"
            });
        }

        const paymentData = JSON.stringify({
            price_amount: numericAmount,
            price_currency: "usd",
            pay_currency: "usdttrc20",

            ipn_callback_url:
                "https://miltape-backend-production.up.railway.app/api/ipn",

            order_id: `${playerId}_${Date.now()}`,

            order_description:
                `Mise Miltape World Challenge - ${playerName || "Anonyme"}`
        });

        const options = {
            hostname: "api.nowpayments.io",
            path: "/v1/payment",
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(paymentData),
                "x-api-key": apiKey
            }
        };

        const paymentReq = https.request(options, (apiRes) => {

            let data = "";

            apiRes.on("data", (chunk) => {
                data += chunk;
            });

            apiRes.on("end", () => {

                console.log(
                    "NOWPayments status:",
                    apiRes.statusCode
                );

                try {
                    const responseJson = JSON.parse(data);

                    console.log(
                        "Réponse NOWPayments:",
                        JSON.stringify(responseJson)
                    );

                    if (
                        responseJson &&
                        responseJson.invoice_url
                    ) {
                        return res.json({
                            success: true,
                            invoice_url: responseJson.invoice_url
                        });
                    }

                    return res.status(400).json({
                        success: false,
                        error:
                            responseJson.message ||
                            responseJson.error ||
                            "Erreur création paiement"
                    });

                } catch (error) {

                    console.error(
                        "❌ Parsing NOWPayments:",
                        error.message
                    );

                    return res.status(500).json({
                        success: false,
                        error: "PAYMENT_RESPONSE_ERROR"
                    });
                }
            });
        });

        paymentReq.setTimeout(15000, () => {
            paymentReq.destroy(
                new Error("NOWPayments timeout")
            );
        });

        paymentReq.on("error", (error) => {

            console.error(
                "❌ Erreur NOWPayments:",
                error.message
            );

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: "PAYMENT_CONNECTION_ERROR"
                });
            }
        });

        paymentReq.write(paymentData);
        paymentReq.end();

    } catch (error) {

        console.error(
            "❌ /api/create-payment:",
            error.message
        );

        res.status(500).json({
            success: false,
            error: "SERVER_ERROR"
        });
    }
});

/* =========================================================
   TOTAL STAKES
========================================================= */

app.get("/api/total-stakes", async (req, res) => {

    if (!mongoConnected) {
        return res.status(503).json({
            success: false,
            error: "DATABASE_UNAVAILABLE",
            totalStakes: 0
        });
    }

    try {

        /*
         * On regroupe par playerId.
         *
         * Cela évite de compter plusieurs fois une même mise
         * si d'anciens documents existent.
         */

        const result = await players.aggregate([
            {
                $group: {
                    _id: "$playerId",

                    amount: {
                        $max: {
                            $ifNull: ["$amount", 0]
                        }
                    }
                }
            },

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
            result.length > 0
                ? Number(result[0].total || 0)
                : 0;

        return res.json({
            success: true,
            totalStakes
        });

    } catch (error) {

        console.error(
            "❌ Erreur total-stakes:",
            error.message
        );

        return res.status(500).json({
            success: false,
            error: "TOTAL_STAKES_ERROR",
            totalStakes: 0
        });
    }
});

/* =========================================================
   PLAYER STATS
========================================================= */

app.get("/api/player-stats/:playerId", async (req, res) => {

    if (!mongoConnected) {
        return res.status(503).json({
            success: false,
            error: "DATABASE_UNAVAILABLE"
        });
    }

    try {

        const playerId = req.params.playerId;

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_ID_REQUIRED"
            });
        }

        const playerRecords =
            await players
                .find({ playerId })
                .sort({ createdAt: -1 })
                .lean();

        const totalTaps =
            playerRecords.reduce(
                (sum, player) =>
                    sum + Number(player.score || 0),
                0
            );

        const totalUsdt =
            playerRecords.reduce(
                (sum, player) =>
                    sum + Number(player.amount || 0),
                0
            );

        return res.json({
            success: true,

            totalTaps,

            totalUsdt,

            history: playerRecords.map((player) => ({
                date: player.createdAt,

                score:
                    Number(player.score || 0),

                amount:
                    Number(player.amount || 0)
            }))
        });

    } catch (error) {

        console.error(
            "❌ Erreur player-stats:",
            error.message
        );

        return res.status(500).json({
            success: false,
            error: "PLAYER_STATS_ERROR"
        });
    }
});

/* =========================================================
   LEADERBOARD
========================================================= */

let leaderboardBusy = false;

async function broadcastLeaderboard() {

    if (!mongoConnected) {
        return;
    }

    // Empêche plusieurs aggregate simultanés
    if (leaderboardBusy) {
        return;
    }

    leaderboardBusy = true;

    try {

        const topPlayers =
            await players.aggregate([

                {
                    $group: {
                        _id: "$playerId",

                        playerName: {
                            $last: "$playerName"
                        },

                        score: {
                            $sum: {
                                $ifNull: ["$score", 0]
                            }
                        }
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

        io.emit(
            "leaderboard",
            topPlayers
        );

    } catch (error) {

        console.error(
            "❌ Erreur leaderboard:",
            error.message
        );

    } finally {

        leaderboardBusy = false;
    }
}

/* =========================================================
   LEADERBOARD REFRESH
========================================================= */

/*
 * Au lieu de recalculer le leaderboard après CHAQUE tap,
 * on le met à jour toutes les 2 secondes.
 */

let leaderboardRefreshRunning = false;

setInterval(async () => {

    if (leaderboardRefreshRunning) {
        return;
    }

    leaderboardRefreshRunning = true;

    try {
        await broadcastLeaderboard();
    } catch (error) {
        console.error(
            "Erreur refresh leaderboard:",
            error.message
        );
    } finally {
        leaderboardRefreshRunning = false;
    }

}, 2000);

/* =========================================================
   GAME TIMER
========================================================= */

const GAME_DURATION = 600;

let timerLeft = GAME_DURATION;

setInterval(() => {

    timerLeft--;

    if (timerLeft <= 0) {

        timerLeft = GAME_DURATION;

        console.log(
            "🔄 Nouvelle manche Miltape"
        );
    }

    io.emit(
        "timer",
        timerLeft
    );

}, 1000);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {

    console.log(
        "👤 Joueur connecté :",
        socket.id
    );

    /*
     * Envoyer immédiatement le timer
     */

    socket.emit(
        "timer",
        timerLeft
    );

    /*
     * Envoyer immédiatement le nombre de joueurs
     */

    io.emit(
        "onlineCount",
        io.engine.clientsCount
    );

    /*
     * Envoyer immédiatement le leaderboard
     */

    broadcastLeaderboard();

    /* =====================================================
       JOIN
    ===================================================== */

    socket.on("join", async (data) => {

        try {

            socket.data = data || {};

            console.log(
                "🎮 Joueur rejoint :",
                data?.playerName || "Anonyme"
            );

            io.emit(
                "onlineCount",
                io.engine.clientsCount
            );

        } catch (error) {

            console.error(
                "Erreur join:",
                error.message
            );
        }
    });

    /* =====================================================
       CHAT
    ===================================================== */

    socket.on("chatMessage", (msg) => {

        try {

            const chatData = {

                playerName:
                    msg?.playerName ||
                    "Anonyme",

                message:
                    msg?.message ||
                    msg?.text ||
                    ""
            };

            /*
             * Limitation anti-spam basique
             */

            if (
                typeof chatData.message !== "string" ||
                chatData.message.length === 0
            ) {
                return;
            }

            chatData.message =
                chatData.message
                    .substring(0, 300);

            io.emit(
                "chatMessage",
                chatData
            );

        } catch (error) {

            console.error(
                "Erreur chat:",
                error.message
            );
        }
    });

    /* =====================================================
       TAP
    ===================================================== */

    socket.on("tap", async (data) => {

        if (!mongoConnected) {

            socket.emit(
                "tapError",
                {
                    success: false,
                    error: "DATABASE_UNAVAILABLE"
                }
            );

            return;
        }

        try {

            if (!data || !data.playerId) {
                return;
            }

            const playerId =
                String(data.playerId);

            const playerName =
                String(
                    data.playerName ||
                    "Anonyme"
                ).substring(0, 50);

            /*
             * IMPORTANT :
             *
             * Avant :
             *
             * players.create()
             *
             * à CHAQUE tap.
             *
             * Maintenant :
             *
             * $inc score
             *
             * donc un joueur ne crée pas
             * des milliers de documents.
             */

            let taps =
                Number(data.taps);

            if (
                !Number.isFinite(taps) ||
                taps <= 0
            ) {
                taps = 1;
            }

            /*
             * Sécurité :
             * empêche un client d'envoyer
             * une quantité énorme de taps.
             */

            taps = Math.min(
                Math.floor(taps),
                100
            );

            const amount =
                Number(data.amount);

            const update = {

                $inc: {
                    score: taps
                },

                $set: {
                    playerName,
                    updatedAt: new Date()
                },

                $setOnInsert: {
                    playerId,
                    createdAt: new Date(),
                    amount:
                        Number.isFinite(amount) &&
                        amount > 0
                            ? amount
                            : 0
                }
            };

            await players.findOneAndUpdate(
                { playerId },
                update,
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );

            /*
             * On NE recalcul plus le leaderboard
             * immédiatement ici.
             *
             * Le refresh automatique toutes les 2 sec
             * s'en occupe.
             */

        } catch (error) {

            console.error(
                "❌ Erreur enregistrement tap:",
                error.message
            );

            socket.emit(
                "tapError",
                {
                    success: false,
                    error: "TAP_SAVE_ERROR"
                }
            );
        }
    });

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on("disconnect", () => {

        console.log(
            "🔌 Joueur déconnecté :",
            socket.id
        );

        io.emit(
            "onlineCount",
            io.engine.clientsCount
        );
    });
});

/* =========================================================
   ERROR HANDLER EXPRESS
========================================================= */

app.use((err, req, res, next) => {

    console.error(
        "❌ Express error:",
        err.message
    );

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        success: false,
        error: "SERVER_ERROR"
    });
});

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Miltape lancé sur le port ${PORT}`
        );

        console.log(
            `🌐 Environment: ${process.env.NODE_ENV || "production"}`
        );

        connectMongoDB();
    }
);
