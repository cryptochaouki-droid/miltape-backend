const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

let db;
let games;
let players;
let messages;
let payments;

async function connectMongoDB() {

    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI n'est pas configurée dans Railway");
    }

    const client = new MongoClient(MONGODB_URI);

    await client.connect();

    db = client.db("miltape");

    games = db.collection("games");
    players = db.collection("players");
    messages = db.collection("messages");
    payments = db.collection("payments");

    console.log("✅ MongoDB connecté");
}


/* =====================================================
   PARTIE ACTIVE (GÉRÉE AVEC PAUSE DE 10 SECONDES)
===================================================== */

async function getActiveGame() {
    const now = new Date();

    let game = await games.findOne({
        status: { $in: ["running", "break"] },
        endsAt: { $gt: now }
    });

    if (!game) {
        const expiredGame = await games.findOne({
            status: { $in: ["running", "break"] },
            endsAt: { $lte: now }
        });

        if (expiredGame) {
            if (expiredGame.status === "running") {
                const breakEndsAt = new Date(now.getTime() + 10 * 1000);
                await games.updateOne(
                    { _id: expiredGame._id },
                    { $set: { status: "break", endsAt: breakEndsAt } }
                );
                game = await games.findOne({ _id: expiredGame._id });
                console.log("⏸️ Fin de partie : Début de la pause de mise de 10 secondes");
            } else if (expiredGame.status === "break") {
                await games.updateOne(
                    { _id: expiredGame._id },
                    { $set: { status: "finished" } }
                );

                const endsAt = new Date(now.getTime() + 10 * 60 * 1000);
                const result = await games.insertOne({
                    status: "running",
                    startsAt: now,
                    endsAt,
                    createdAt: now
                });

                game = await games.findOne({ _id: result.insertedId });
                console.log("🎮 Nouvelle partie globale de 10 minutes créée");
                io.emit("game:restart");
            }
        } else {
            const endsAt = new Date(now.getTime() + 10 * 60 * 1000);
            const result = await games.insertOne({
                status: "running",
                startsAt: now,
                endsAt,
                createdAt: now
            });

            game = await games.findOne({ _id: result.insertedId });
            console.log("🎮 Première partie globale initialisée");
        }
    }

    return game;
}


/* =====================================================
   TEST
===================================================== */

app.get("/", (req, res) => {
    res.json({
        success: true,
        project: "Miltape World Challenge",
        status: "online",
        database: db ? "connected" : "not connected"
    });
});


/* =====================================================
   PANNEAU ADMIN — STATS GLOBALES & GESTION
===================================================== */

app.get("/api/admin/stats", async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ success: false, error: "DB_NOT_CONNECTED" });
        }

        const totalPlayers = await players.countDocuments();
        const activeGame = await getActiveGame();
        
        const pipeline = [
            { $group: { _id: null, totalTaps: { $sum: "$score" } } }
        ];
        const tapResult = await players.aggregate(pipeline).toArray();
        const totalTapsAll = tapResult.length > 0 ? tapResult[0].totalTaps : 0;

        const recentPlayers = await players.find({}).sort({ createdAt: -1 }).limit(20).toArray();

        res.json({
            success: true,
            stats: {
                totalPlayers,
                totalTapsAll,
                currentGameStatus: activeGame.status,
                currentGameEndsAt: activeGame.endsAt
            },
            recentPlayers: recentPlayers.map(p => ({
                playerId: p.playerId,
                playerName: p.playerName,
                score: p.score,
                createdAt: p.createdAt
            }))
        });

    } catch (error) {
        console.error("ADMIN STATS ERROR:", error);
        res.status(500).json({ success: false, error: "ADMIN_ERROR" });
    }
});


/* =====================================================
   GAME (RÉCUPÉRER LE STATUT ET LE TEMPS RESTANT GLOBAL)
===================================================== */

app.get("/api/game", async (req, res) => {
    try {
        const game = await getActiveGame();
        const now = new Date();
        const timeLeftSec = Math.max(0, Math.floor((new Date(game.endsAt) - now) / 1000));

        res.json({
            success: true,
            game: {
                id: game._id.toString(),
                status: game.status,
                timeLeft: timeLeftSec,
                startsAt: game.startsAt,
                endsAt: game.endsAt
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "GAME_ERROR" });
    }
});


/* =====================================================
   JOIN (AVEC VÉRIFICATION DU PSEUDO UNIQUE)
===================================================== */

app.post("/api/join", async (req, res) => {
    try {
        const playerId = String(req.body.playerId || "");
        const playerName = String(req.body.playerName || "").trim().slice(0, 30);

        if (!playerId || !playerName) {
            return res.status(400).json({ success: false, error: "PLAYER_REQUIRED" });
        }

        const game = await getActiveGame();

        const existingPlayer = await players.findOne({
            gameId: game._id,
            playerId: { $ne: playerId },
            playerName: { $regex: new RegExp("^" + playerName + "$", "i") }
        });

        if (existingPlayer) {
            return res.status(400).json({
                success: false,
                error: "Ce pseudo est déjà pris, choisis-en un autre !"
            });
        }

        await players.updateOne(
            { playerId, gameId: game._id },
            {
                $set: { playerId, playerName, gameId: game._id, updatedAt: new Date() },
                $setOnInsert: { score: 0, createdAt: new Date() }
            },
            { upsert: true }
        );

        res.json({
            success: true,
            game: {
                id: game._id.toString(),
                status: game.status,
                endsAt: game.endsAt
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "JOIN_ERROR" });
    }
});


/* =====================================================
   TAP (OPTIMISÉ AVEC SUPPORT DU BATCH DE CLICS)
===================================================== */

app.post("/api/tap", async (req, res) => {
    try {
        const playerId = String(req.body.playerId || "");
        const tapCount = parseInt(req.body.count || 1, 10);

        if (!playerId) {
            return res.status(400).json({ success: false, error: "PLAYER_REQUIRED" });
        }

        const game = await getActiveGame();

        if (game.status === "break" || new Date() >= new Date(game.endsAt)) {
            return res.status(400).json({ success: false, error: "GAME_BREAK_OR_FINISHED" });
        }

        const result = await players.findOneAndUpdate(
            { playerId, gameId: game._id },
            {
                $inc: { score: tapCount },
                $set: { updatedAt: new Date() }
            },
            { returnDocument: "after" }
        );

        if (!result) {
            return res.status(400).json({ success: false, error: "PLAYER_NOT_IN_GAME" });
        }

        io.emit("leaderboard:update");

        res.json({ success: true, score: result.score });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "TAP_ERROR" });
    }
});


/* =====================================================
   LEADERBOARD TOP 5
===================================================== */

app.get("/api/leaderboard", async (req, res) => {
    try {
        const game = await getActiveGame();

        const topPlayers = await players
            .find({ gameId: game._id })
            .sort({ score: -1 })
            .limit(5)
            .toArray();

        res.json({
            success: true,
            players: topPlayers.map((player, index) => ({
                position: index + 1,
                playerId: player.playerId,
                playerName: player.playerName,
                score: player.score
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "LEADERBOARD_ERROR" });
    }
});


/* =====================================================
   CHAT — LIRE
===================================================== */

app.get("/api/chat", async (req, res) => {
    try {
        const chat = await messages.find({}).sort({ createdAt: -1 }).limit(100).toArray();

        res.json({
            success: true,
            messages: chat.reverse().map(message => ({
                playerName: message.playerName,
                message: message.message,
                createdAt: message.createdAt
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "CHAT_ERROR" });
    }
});


/* =====================================================
   CHAT — ENVOYER
===================================================== */

app.post("/api/chat", async (req, res) => {
    try {
        const playerId = String(req.body.playerId || "");
        const playerName = String(req.body.playerName || "").trim().slice(0, 30);
        const message = String(req.body.message || "").trim().slice(0, 250);

        if (!playerId || !playerName || !message) {
            return res.status(400).json({ success: false, error: "MESSAGE_REQUIRED" });
        }

        const newMessage = { playerId, playerName, message, createdAt: new Date() };

        await messages.insertOne(newMessage);
        io.emit("chat:new", newMessage);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "CHAT_SEND_ERROR" });
    }
});


/* =====================================================
   CRÉATION DE FACTURE NOWPAYMENTS (MONTANT LIBRE & MULTI-STABLECOINS)
===================================================== */

app.post("/api/create-payment", async (req, res) => {
    try {
        const { playerId, playerName, amount } = req.body;

        if (!playerId || !amount) {
            return res.status(400).json({ success: false, error: "PLAYER_AND_AMOUNT_REQUIRED" });
        }

        const apiKey = process.env.NOWPAYMENTS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: "NOWPAYMENTS_API_KEY_NOT_CONFIGURED" });
        }

        // Montant libre choisi par le joueur sans imposer de minimum
        const finalAmount = parseFloat(amount) || 1;

        // Appel à l'API invoice pour afficher le choix des stablecoins au joueur
        const response = await fetch("https://api.nowpayments.io/v1/invoice", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey
            },
            body: JSON.stringify({
                price_amount: finalAmount,
                price_currency: "usd",
                order_id: playerId,
                order_description: `Mise Miltape pour ${playerName || playerId}`,
                ipn_callback_url: "https://miltape-backend-production.up.railway.app/api/ipn",
                success_url: "https://cryptochaouki-droid.github.io/miltape-backend/",
                cancel_url: "https://cryptochaouki-droid.github.io/miltape-backend/"
            })
        });

        const invoiceData = await response.json();

        if (!response.ok) {
            console.error("Erreur API Invoice NOWPayments:", invoiceData);
            return res.status(400).json({ success: false, error: invoiceData.message || "INVOICE_API_ERROR" });
        }

        res.json({
            success: true,
            invoice_url: invoiceData.invoice_url,
            payment_id: invoiceData.id
        });

    } catch (error) {
        console.error("❌ ERREUR CREATE INVOICE:", error);
        res.status(500).json({ success: false, error: "PAYMENT_SERVER_ERROR" });
    }
});


/* =====================================================
   NOWPAYMENTS IPN (WEBHOOK DE PAIEMENT)
===================================================== */

app.post("/api/ipn", async (req, res) => {
    try {
        const paymentData = req.body;
        console.log("🔔 Notification IPN reçue de NOWPayments :", paymentData);

        const paymentId = paymentData.payment_id;
        const paymentStatus = paymentData.payment_status; 
        const orderId = paymentData.order_id; 
        const priceAmount = paymentData.price_amount;
        const payCurrency = paymentData.pay_currency;

        if (!paymentId) {
            return res.status(400).json({ success: false, error: "INVALID_IPN_DATA" });
        }

        if (payments) {
            await payments.updateOne(
                { paymentId: String(paymentId) },
                { 
                    $set: { 
                        paymentStatus, 
                        orderId, 
                        priceAmount, 
                        payCurrency, 
                        rawdata: paymentData,
                        updatedAt: new Date() 
                    },
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
        }

        if (paymentStatus === "finished" || paymentStatus === "confirmed") {
            console.log(`✅ Paiement validé pour la commande/joueur : ${orderId}`);
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("❌ ERREUR IPN :", error);
        return res.status(500).json({ success: false, error: "IPN_HANDLER_ERROR" });
    }
});


/* =====================================================
   SOCKET.IO & CHRONO MONDIAL / PAUSE EN DIRECT
===================================================== */

io.on("connection", socket => {
    console.log("👤 Joueur connecté :", socket.id);
    io.emit("online:count", io.engine.clientsCount);

    socket.on("disconnect", () => {
        console.log("👋 Joueur déconnecté :", socket.id);
        io.emit("online:count", io.engine.clientsCount);
    });
});


/* =====================================================
   START
===================================================== */

async function startServer() {
    try {
        await connectMongoDB();

        setInterval(async () => {
            try {
                if (!db) return;
                const game = await getActiveGame();
                
                const now = new Date();
                const endsAt = new Date(game.endsAt);
                const timeLeftSec = Math.max(0, Math.floor((endsAt - now) / 1000));

                io.emit("global:timer", {
                    timeLeft: timeLeftSec,
                    status: game.status
                });
            } catch (e) {
                console.error("Erreur timer global:", e);
            }
        }, 1000);

        server.listen(PORT, "0.0.0.0", () => {
            console.log(`🚀 Miltape lancé sur le port ${PORT}`);
        });

    } catch (error) {
        console.error("❌ ERREUR SERVEUR :", error.message);
        process.exit(1);
    }
}

startServer();
