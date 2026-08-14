const express = require("express");
const http = require("http");
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

const GAME_DURATION = 600; // 10 minutes

let mongoConnected = false;

/* =========================================================
   LOGS DE DÉMARRAGE
========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log("Partie : 10 minutes");
console.log("MongoDB :", MONGO_URI ? "CONFIGURÉ" : "❌ MANQUANT");
console.log("======================================");

/* =========================================================
   MONGODB (Scores & Joueurs)
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

    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Player = mongoose.model("Player", playerSchema);

async function connectMongoDB() {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI manquant dans Railway.");
        console.error("➡️ Railway > Variables > MONGO_URI = ton URL MongoDB Atlas");
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
        gameDuration: GAME_DURATION
    });
});

/* =========================================================
   STATS JOUEUR
========================================================= */

app.get("/api/player-stats/:playerId", async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({
                success: true,
                totalTaps: 0,
                history: []
            });
        }

        const playerId = req.params.playerId;

        const records = await Player.find({ playerId }).sort({ createdAt: -1 }).lean();

        const totalTaps = records.reduce((sum, p) => sum + Number(p.score || 0), 0);

        res.json({
            success: true,
            totalTaps,
            history: records.map(p => ({
                date: p.createdAt,
                score: p.score || 0
            }))
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: "PLAYER_STATS_ERROR"
        });
    }
});

/* =========================================================
   LEADERBOARD
========================================================= */

async function broadcastLeaderboard() {
    if (!mongoConnected) {
        io.emit("leaderboard", []);
        return;
    }

    try {
        const topPlayers = await Player.aggregate([
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
                score: Number(data.taps) || 1
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
    console.log("⏱️ Partie : 10 minutes");
});
