const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

/* =========================================================
   MILTAPE WORLD CHALLENGE - BACKEND (OPTIMISÉ)
   ========================================================= */

const app = express();
const server = http.createServer(app);

/* =========================================================
   CORS & MIDDLEWARE
   ========================================================= */

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);

/* =========================================================
   SOCKET.IO
   ========================================================= */

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 30000,
    pingInterval: 10000
});

/* =========================================================
   CONFIGURATION
   ========================================================= */

const PORT = Number(process.env.PORT) || 8080;
const MONGO_URI = process.env.MONGO_URI || "";
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

/* =========================================================
   JEU
   ========================================================= */

const GAME_DURATION = 600;
const TOP_WINNERS = 5;
const MAX_TAPS_PER_SECOND = 25;

/* =========================================================
   WALLET MILTAPE
   ========================================================= */

const MILTAPE_WALLET = "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

/* =========================================================
   USDT TRC20
   ========================================================= */

const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_DECIMALS = 6;
const NETWORK = "TRON";
const TOKEN = "USDT";
const CHAIN = "TRC20";

/* =========================================================
   MISE
   ========================================================= */

const MINIMUM_BET = 1;
const MAXIMUM_BET = null;

/* =========================================================
   CAGNOTTE SAMEDI
   ========================================================= */

const SATURDAY_JACKPOT_PERCENT = Number(process.env.SATURDAY_JACKPOT_PERCENT) || 5;
const JACKPOT_PERCENT = Math.min(100, Math.max(0, SATURDAY_JACKPOT_PERCENT));

/* =========================================================
   ÉTAT SERVEUR & CACHE MÉMOIRE
   ========================================================= */

let mongoConnected = false;
let gameId = 1;
let timerLeft = GAME_DURATION;

const activePlayers = new Map(); // playerId -> socketId
const tapRate = new Map(); // playerId -> { startedAt, count }
const scoresCache = new Map(); // playerId -> score (en mémoire pour fluidité)

/* =========================================================
   LOGS INITIALISATION
   ========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE WORLD CHALLENGE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log("Durée :", GAME_DURATION, "secondes");
console.log("Gagnants : TOP", TOP_WINNERS);
console.log("Réseau :", NETWORK);
console.log("Token :", TOKEN);
console.log("Standard :", CHAIN);
console.log("Wallet :", MILTAPE_WALLET);
console.log("Mise minimale :", MINIMUM_BET, "USDT");
console.log("Cagnotte samedi :", JACKPOT_PERCENT, "%");
console.log("TronGrid API Key :", TRONGRID_API_KEY ? "CONFIGURÉE" : "NON CONFIGURÉE");
console.log("MongoDB :", MONGO_URI ? "CONFIGURÉ" : "❌ MANQUANT");
console.log("======================================");

/* =========================================================
   SCHEMA PLAYER
   ========================================================= */

const playerSchema = new mongoose.Schema(
    {
        playerId: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
            index: true
        },
        playerName: {
            type: String,
            default: "Anonyme",
            trim: true,
            maxlength: 30
        },
        score: {
            type: Number,
            default: 0,
            min: 0
        },
        amount: {
            type: Number,
            required: true,
            min: MINIMUM_BET
        },
        cryptoAddress: {
            type: String,
            default: "",
            trim: true,
            maxlength: 64
        },
        transactionHash: {
            type: String,
            trim: true,
            maxlength: 100,
            default: undefined
        },
        paymentStatus: {
            type: String,
            enum: ["pending", "paid", "rejected"],
            default: "pending",
            index: true
        },
        gameId: {
            type: Number,
            required: true,
            index: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        paidAt: {
            type: Date,
            default: null
        }
    },
    { versionKey: false }
);

playerSchema.index(
    { transactionHash: 1 },
    { unique: true, sparse: true, name: "unique_transaction_hash" }
);

playerSchema.index(
    { gameId: 1, paymentStatus: 1, playerId: 1, score: -1 },
    { name: "game_payment_player_score" }
);

const Player = mongoose.model("Player", playerSchema);

/* =========================================================
   CONNEXION MONGODB
   ========================================================= */

async function connectMongoDB() {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI manquant.");
        return false;
    }
    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });
        mongoConnected = true;
        console.log("✅ MongoDB connecté");
        return true;
    } catch (error) {
        mongoConnected = false;
        console.error("❌ MongoDB :", error.message);
        return false;
    }
}
connectMongoDB();

/* =========================================================
   UTILITAIRES
   ========================================================= */

function cleanString(value, maxLength = 100) {
    return String(value ?? "").trim().substring(0, maxLength);
}

function isValidTronAddress(address) {
    const value = cleanString(address, 64);
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}

function isValidTxid(txid) {
    const value = cleanString(txid, 100);
    return /^[a-fA-F0-9]{64}$/.test(value);
}

function usdtToUnits(amount) {
    return Math.round(Number(amount) * Math.pow(10, USDT_DECIMALS));
}

function unitsToUsdt(units) {
    return Number(units) / Math.pow(10, USDT_DECIMALS);
}

function isValidBet(amount) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric < MINIMUM_BET) return false;
    if (MAXIMUM_BET !== null && numeric > MAXIMUM_BET) return false;
    const units = usdtToUnits(numeric);
    return Number.isSafeInteger(units);
}

function tronHeaders() {
    const headers = { Accept: "application/json" };
    if (TRONGRID_API_KEY) {
        headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
    }
    return headers;
}

async function fetchJson(url, options = {}) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                ...tronHeaders(),
                ...(options.headers || {})
            }
        });
        clearTimeout(timeout);
        const data = await response.json().catch(() => null);
        return { response, data };
    } catch {
        return { response: null, data: null };
    }
}

/* =========================================================
   CAGNOTTE DATES & CALCULS
   ========================================================= */

function getSaturdayStart() {
    const now = new Date();
    const day = now.getUTCDay();
    const daysSinceSaturday = (day + 1) % 7;
    const saturday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    saturday.setUTCDate(saturday.getUTCDate() - daysSinceSaturday);
    return saturday;
}

function getNextSaturday() {
    const start = getSaturdayStart();
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
}

async function getSaturdayJackpot() {
    if (!mongoConnected) {
        return {
            totalStakes: 0,
            jackpot: 0,
            percent: JACKPOT_PERCENT,
            periodStart: getSaturdayStart().toISOString(),
            nextSaturday: getNextSaturday().toISOString()
        };
    }

    const periodStart = getSaturdayStart();
    const nextSaturday = getNextSaturday();

    const result = await Player.aggregate([
        {
            $match: {
                paymentStatus: "paid",
                paidAt: { $gte: periodStart, $lt: nextSaturday }
            }
        },
        {
            $group: {
                _id: null,
                totalStakes: { $sum: "$amount" }
            }
        }
    ]);

    const totalStakes = result.length ? Number(result[0].totalStakes || 0) : 0;
    const jackpot = totalStakes * (JACKPOT_PERCENT / 100);

    return {
        totalStakes: Number(totalStakes.toFixed(6)),
        jackpot: Number(jackpot.toFixed(6)),
        percent: JACKPOT_PERCENT,
        periodStart: periodStart.toISOString(),
        nextSaturday: nextSaturday.toISOString()
    };
}

async function broadcastSaturdayJackpot() {
    try {
        const jackpot = await getSaturdayJackpot();
        io.emit("saturdayJackpot", jackpot);
    } catch (error) {
        console.error("❌ Jackpot broadcast:", error.message);
    }
}

/* =========================================================
   LEADERBOARD (UTILISATION DU CACHE MÉMOIRE)
   ========================================================= */

async function getLeaderboard() {
    if (!mongoConnected) return [];

    try {
        const players = await Player.aggregate([
            {
                $match: {
                    gameId: Number(gameId),
                    paymentStatus: "paid"
                }
            },
            {
                $project: {
                    _id: 0,
                    playerId: 1,
                    playerName: 1,
                    score: 1,
                    amount: 1
                }
            }
        ]);

        // Mise à jour avec les scores temps réel en mémoire
        const merged = players.map((p) => ({
            ...p,
            score: scoresCache.has(p.playerId) ? scoresCache.get(p.playerId) : p.score
        }));

        return merged.sort((a, b) => b.score - a.score).slice(0, TOP_WINNERS);
    } catch (error) {
        console.error("❌ Leaderboard Error:", error.message);
        return [];
    }
}

/* =========================================================
   ENDPOINTS HTTP API
   ========================================================= */

app.get("/", async (req, res) => {
    try {
        const jackpot = await getSaturdayJackpot();
        res.json({
            success: true,
            app: "Miltape World Challenge",
            status: "online",
            mongo: mongoConnected,
            gameId,
            gameDuration: GAME_DURATION,
            timerLeft,
            saturdayJackpot: jackpot,
            payment: {
                token: TOKEN,
                network: NETWORK,
                chain: CHAIN,
                address: MILTAPE_WALLET,
                contract: USDT_CONTRACT,
                decimals: USDT_DECIMALS,
                minimumBet: MINIMUM_BET,
                maximumBet: MAXIMUM_BET
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "ROOT_ERROR" });
    }
});

app.post("/api/admin/login", (req, res) => {
    const password = cleanString(req.body.password, 100);
    if (!password) {
        return res.status(400).json({ success: false, message: "Mot de passe requis." });
    }
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true, message: "Connexion réussie." });
    }
    return res.status(401).json({ success: false, message: "Mot de passe incorrect !" });
});

app.get("/api/status", async (req, res) => {
    try {
        const jackpot = await getSaturdayJackpot();
        res.json({
            success: true,
            server: "online",
            mongo: mongoConnected,
            gameId,
            timerLeft,
            gameDuration: GAME_DURATION,
            saturdayJackpot: jackpot,
            payment: {
                token: TOKEN,
                network: NETWORK,
                chain: CHAIN,
                wallet: MILTAPE_WALLET,
                contract: USDT_CONTRACT,
                decimals: USDT_DECIMALS,
                minimumBet: MINIMUM_BET,
                maximumBet: MAXIMUM_BET
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "STATUS_ERROR" });
    }
});

app.get("/api/game-config", async (req, res) => {
    try {
        const jackpot = await getSaturdayJackpot();
        res.json({
            success: true,
            game: {
                name: "Miltape World Challenge",
                duration: GAME_DURATION,
                gameId,
                topWinners: TOP_WINNERS
            },
            saturdayJackpot: jackpot,
            jackpotConfig: {
                percent: JACKPOT_PERCENT,
                minimumBet: MINIMUM_BET
            },
            payment: {
                token: TOKEN,
                network: NETWORK,
                chain: CHAIN,
                address: MILTAPE_WALLET,
                contract: USDT_CONTRACT,
                decimals: USDT_DECIMALS,
                minimumBet: MINIMUM_BET,
                maximumBet: MAXIMUM_BET
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "GAME_CONFIG_ERROR" });
    }
});

app.get("/api/saturday-jackpot", async (req, res) => {
    try {
        const jackpot = await getSaturdayJackpot();
        return res.json({ success: true, ...jackpot });
    } catch (error) {
        return res.status(500).json({ success: false, jackpot: 0, error: "SATURDAY_JACKPOT_ERROR" });
    }
});

app.get("/api/total-stakes", async (req, res) => {
    try {
        if (!mongoConnected) return res.json({ success: true, totalStakes: 0 });
        const result = await Player.aggregate([
            { $match: { paymentStatus: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const total = result.length ? Number(result[0].total || 0) : 0;
        return res.json({ success: true, totalStakes: Number(total.toFixed(6)) });
    } catch (error) {
        return res.status(500).json({ success: false, totalStakes: 0, error: "TOTAL_STAKES_ERROR" });
    }
});

app.get("/api/player-stats/:playerId", async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({ success: true, totalTaps: 0, totalUsdt: 0, history: [] });
        }
        const playerId = cleanString(req.params.playerId, 100);
        if (!playerId) {
            return res.status(400).json({ success: false, error: "PLAYER_ID_REQUIRED" });
        }

        const records = await Player.find({ playerId }).sort({ createdAt: -1 }).lean();
        const totalTaps = records.reduce((sum, p) => sum + Number(p.score || 0), 0);
        const totalUsdt = records.reduce(
            (sum, p) => sum + (p.paymentStatus === "paid" ? Number(p.amount || 0) : 0),
            0
        );

        return res.json({
            success: true,
            totalTaps,
            totalUsdt: Number(totalUsdt.toFixed(6)),
            history: records.map((p) => ({
                date: p.createdAt,
                score: p.score || 0,
                amount: p.amount || 0,
                paymentStatus: p.paymentStatus,
                gameId: p.gameId,
                transactionHash: p.transactionHash || ""
            }))
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: "PLAYER_STATS_ERROR" });
    }
});

app.get("/api/leaderboard", async (req, res) => {
    const leaderboard = await getLeaderboard();
    res.json({ success: true, gameId, leaderboard });
});

/* =========================================================
   VÉRIFICATION TRANSACTIONS TRONGRID
   ========================================================= */

app.post("/api/verify-payment", async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, message: "Base de données indisponible." });
        }

        const playerId = cleanString(req.body.playerId, 100);
        const playerName = cleanString(req.body.playerName || "Anonyme", 30);
        const txid = cleanString(req.body.txid, 100);
        const amount = Number(req.body.amount);

        if (!playerId || !isValidTxid(txid) || !isValidBet(amount)) {
            return res.status(400).json({ success: false, message: "Paramètres invalides." });
        }

        const existingTx = await Player.findOne({ transactionHash: txid });
        if (existingTx) {
            return res.status(400).json({ success: false, message: "Transaction déjà utilisée." });
        }

        const url = `https://api.trongrid.io/v1/transactions/${txid}/events`;
        const { data } = await fetchJson(url);

        if (!data || !data.data || data.data.length === 0) {
            return res.status(400).json({ success: false, message: "Transaction introuvable sur le réseau TRON." });
        }

        const transferEvent = data.data.find((e) => e.event_name === "Transfer");
        if (!transferEvent) {
            return res.status(400).json({ success: false, message: "Événement de transfert USDT introuvable." });
        }

        const result = transferEvent.result;
        const rawValue = result.value || result[2];
        const valueUsdt = unitsToUsdt(rawValue);

        if (valueUsdt < amount) {
            return res.status(400).json({ success: false, message: "Montant payé insuffisant." });
        }

        const newPlayer = new Player({
            playerId,
            playerName,
            amount,
            score: 0,
            transactionHash: txid,
            paymentStatus: "paid",
            gameId,
            paidAt: new Date()
        });

        await newPlayer.save();
        scoresCache.set(playerId, 0);

        await broadcastSaturdayJackpot();

        const leaderboard = await getLeaderboard();
        io.emit("leaderboardUpdate", leaderboard);

        return res.json({ success: true, message: "Paiement validé avec succès !", player: newPlayer });
    } catch (error) {
        console.error("❌ Erreur validation paiement:", error.message);
        return res.status(500).json({ success: false, message: "Erreur serveur lors de la vérification." });
    }
});

/* =========================================================
   BOUCLE DU JEU & SOCKET.IO
   ========================================================= */

setInterval(async () => {
    if (timerLeft > 0) {
        timerLeft--;
        io.emit("timerUpdate", { timerLeft, gameId });
    } else {
        // Sauvegarde finale des scores en base de données
        for (const [pId, score] of scoresCache.entries()) {
            await Player.updateOne(
                { playerId: pId, gameId, paymentStatus: "paid" },
                { $set: { score } }
            );
        }

        // Fin de la partie
        const winners = await getLeaderboard();
        io.emit("gameOver", { gameId, winners });

        // Réinitialisation de session
        gameId++;
        timerLeft = GAME_DURATION;
        scoresCache.clear();

        io.emit("gameStart", { gameId, duration: GAME_DURATION });
    }
}, 1000);

io.on("connection", (socket) => {
    socket.on("joinGame", async (data) => {
        const playerId = cleanString(data?.playerId, 100);
        if (playerId) {
            activePlayers.set(playerId, socket.id);
        }
        socket.emit("initGame", {
            gameId,
            timerLeft,
            leaderboard: await getLeaderboard()
        });
    });

    socket.on("tap", async (data) => {
        const playerId = cleanString(data?.playerId, 100);
        if (!playerId || timerLeft <= 0 || !mongoConnected) return;

        // Anti-autoclicker / Rate limiting
        const now = Date.now();
        const userTapInfo = tapRate.get(playerId) || { startedAt: now, count: 0 };

        if (now - userTapInfo.startedAt > 1000) {
            userTapInfo.startedAt = now;
            userTapInfo.count = 1;
        } else {
            userTapInfo.count++;
        }

        tapRate.set(playerId, userTapInfo);

        if (userTapInfo.count > MAX_TAPS_PER_SECOND) {
            return; // Ignorer les clics excessifs
        }

        // Mettre à jour le score en mémoire instantanément
        const currentScore = scoresCache.get(playerId) || 0;
        scoresCache.set(playerId, currentScore + 1);

        const leaderboard = await getLeaderboard();
        io.emit("leaderboardUpdate", leaderboard);
    });

    socket.on("disconnect", () => {
        for (const [pId, sId] of activePlayers.entries()) {
            if (sId === socket.id) {
                activePlayers.delete(pId);
                tapRate.delete(pId);
                break;
            }
        }
    });
});

/* =========================================================
   LANCEMENT DU SERVEUR
   ========================================================= */

server.listen(PORT, () => {
    console.log(`🚀 Serveur en écoute sur le port ${PORT}`);
});
