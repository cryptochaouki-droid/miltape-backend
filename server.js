const express = require("express");
const http = require("http");
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

const MONGO_URI = process.env.MONGO_URI || "TA_CHAINE_MONGODB_ATLAS";
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDb connecté"))
    .catch(err => console.error("Erreur MongoDB :", err));

const playerSchema = new mongoose.Schema({
    playerId: String,
    playerName: String,
    score: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const players = mongoose.model("Player", playerSchema);

app.get("/api/player-stats/:playerId", async (req, res) => {
    try {
        const { playerId } = req.params;
        const playerRecords = await players.find({ playerId }).lean();
        const totalTaps = playerRecords.reduce((sum, p) => sum + (p.score || 0), 0);
        
        res.json({
            success: true,
            totalTaps,
            totalUsdt: 0,
            history: playerRecords.map(p => ({ date: p.createdAt, score: p.score || 0 }))
        });
    } catch (e) {
        res.status(500).json({ success: false, error: "PLAYER_STATS_ERROR" });
    }
});

app.get("/api/total-stakes", (req, res) => {
    res.json({ success: true, totalStakes: 0 });
});

// Fonction pour calculer et diffuser le Top 5 en direct
async function broadcastLeaderboard() {
    try {
        // Agrégation pour sommer les scores par joueur sur la session en cours
        const topPlayers = await players.aggregate([
            {
                $group: {
                    _id: "$playerId",
                    playerName: { $last: "$playerName" },
                    score: { $sum: "$score" }
                }
            },
            { $sort: { score: -1 } },
            { $limit: 5 }
        ]);
        io.emit("leaderboard", topPlayers);
    } catch (e) {
        console.error("Erreur calcul leaderboard:", e);
    }
}

let timerLeft = 600;
setInterval(async () => {
    timerLeft--;
    if (timerLeft <= 0) {
        timerLeft = 600;
        // Fin de partie : tu pourras archiver les gagnants du Top 5 ici si besoin
        // Optionnel : reset des scores en base pour un nouveau round propre
        // await players.deleteMany({}); 
    }
    io.emit("timer", timerLeft);
}, 1000);

io.on("connection", (socket) => {
    console.log("👤 Joueur connecté :", socket.id);

    socket.on("join", async (data) => {
        socket.data = data;
        io.emit("onlineCount", io.engine.clientsCount);
        // Envoyer le classement immédiatement au joueur qui se connecte
        await broadcastLeaderboard();
    });

    socket.on("chatMessage", (msg) => {
        const chatData = {
            playerName: msg.playerName || "Anonyme",
            message: msg.message || msg.text || ""
        };
        io.emit("chatMessage", chatData);
    });

    socket.on("tap", async (data) => {
        try {
            if (data && data.playerId) {
                await players.create({
                    playerId: data.playerId,
                    playerName: data.playerName || "Anonyme",
                    score: data.taps || 1
                });
                // Met à jour le classement pour tout le monde en temps réel à chaque tap
                await broadcastLeaderboard();
            }
        } catch (e) {
            console.error("Erreur enregistrement tap:", e);
        }
    });

    socket.on("disconnect", () => {
        console.log("🔌 Joueur déconnecté :", socket.id);
        io.emit("onlineCount", io.engine.clientsCount);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Miltape lancé sur le port ${PORT}`);
});
