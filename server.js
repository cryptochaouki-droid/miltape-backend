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

let timerLeft = 600;
setInterval(() => {
    timerLeft--;
    if (timerLeft <= 0) timerLeft = 600;
    io.emit("timer", timerLeft);
}, 1000);

io.on("connection", (socket) => {
    console.log("👤 Joueur connecté :", socket.id);

    socket.on("join", (data) => {
        socket.data = data;
        io.emit("onlineCount", io.engine.clientsCount);
    });

    socket.on("chatMessage", (msg) => {
        io.emit("chatMessage", msg);
    });

    socket.on("tap", async (data) => {
        try {
            if (data && data.playerId) {
                await players.create({
                    playerId: data.playerId,
                    playerName: data.playerName || "Anonyme",
                    score: data.taps || 1
                });
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
