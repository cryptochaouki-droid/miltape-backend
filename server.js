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

const MONGO_URI = process.env.MONGO_URI || "TA_CHAINE_MONGODB_ATLAS";
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDb connecté"))
    .catch(err => console.error("Erreur MongoDB :", err));

const playerSchema = new mongoose.Schema({
    playerId: String,
    playerName: String,
    score: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }, // Stocke la mise du joueur
    createdAt: { type: Date, default: Date.now }
});
const players = mongoose.model("Player", playerSchema);

// Route pour créer un paiement via NOWPayments
app.post("/api/create-payment", async (req, res) => {
    try {
        const { playerId, playerName, amount } = req.body;
        const numericAmount = parseFloat(amount) || 1;

        // Appel à l'API NOWPayments (Sandbox ou Live selon ta clé)
        const paymentData = JSON.stringify({
            price_amount: numericAmount,
            price_currency: "usd",
            pay_currency: "usdttrc20",
            ipn_callback_url: "https://miltape-backend-production.up.railway.app/api/ipn",
            order_id: `${playerId}_${Date.now()}`,
            order_description: `Mise Miltape World Challenge - ${playerName}`
        });

        const options = {
            hostname: 'api.nowpayments.io',
            path: '/v1/payment',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.NOWPAYMENTS_API_KEY || 'TA_CLE_API_NOWPAYMENTS'
            }
        };

        const paymentReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', (chunk) => { data += chunk; });
            apiRes.on('end', () => {
                console.log("Réponse brute NOWPayments:", data); // Permet de voir le détail exact dans les logs Railway
                try {
                    const responseJson = JSON.parse(data);
                    if (responseJson && responseJson.invoice_url) {
                        res.json({ success: true, invoice_url: responseJson.invoice_url });
                    } else {
                        res.json({ success: false, error: responseJson.message || responseJson.error || "Erreur création facture NOWPayments" });
                    }
                } catch (e) {
                    res.json({ success: false, error: "Erreur de parsing de la réponse de paiement" });
                }
            });
        });

        paymentReq.on('error', (e) => {
            console.error("Erreur requête NOWPayments:", e);
            res.status(500).json({ success: false, error: "Erreur de connexion au service de paiement" });
        });

        paymentReq.write(paymentData);
        paymentReq.end();

    } catch (e) {
        console.error("Erreur /api/create-payment:", e);
        res.status(500).json({ success: false, error: "SERVER_ERROR" });
    }
});

// Route pour retourner la somme totale misée par tous les joueurs
app.get("/api/total-stakes", async (req, res) => {
    try {
        const result = await players.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: "$amount" }
                }
            }
        ]);
        const totalStakes = result.length > 0 ? result[0].total : 0;
        res.json({ success: true, totalStakes });
    } catch (e) {
        console.error("Erreur calcul total-stakes:", e);
        res.status(500).json({ success: false, error: "TOTAL_STAKES_ERROR", totalStakes: 0 });
    }
});

app.get("/api/player-stats/:playerId", async (req, res) => {
    try {
        const { playerId } = req.params;
        const playerRecords = await players.find({ playerId }).lean();
        const totalTaps = playerRecords.reduce((sum, p) => sum + (p.score || 0), 0);
        const totalUsdt = playerRecords.reduce((sum, p) => sum + (p.amount || 0), 0);
        
        res.json({
            success: true,
            totalTaps,
            totalUsdt,
            history: playerRecords.map(p => ({ date: p.createdAt, score: p.score || 0 }))
        });
    } catch (e) {
        res.status(500).json({ success: false, error: "PLAYER_STATS_ERROR" });
    }
});

// Fonction pour calculer et diffuser le Top 5 en direct
async function broadcastLeaderboard() {
    try {
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
    }
    io.emit("timer", timerLeft);
}, 1000);

io.on("connection", (socket) => {
    console.log("👤 Joueur connecté :", socket.id);

    socket.on("join", async (data) => {
        socket.data = data;
        io.emit("onlineCount", io.engine.clientsCount);
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
                    score: data.taps || 1,
                    amount: data.amount || 0
                });
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
