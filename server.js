const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
// Correction de l'import TronWeb (Syntaxe exacte pour extraire la classe)
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const PORT = Number(process.env.PORT) || 3000;

const GAME_DURATION_SECONDS = 10 * 60; // 10 minutes

// ============================================================
// TOKENS SUPPORTÉS (TRC20 + TRX natif)
// ============================================================
const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN441q1LZ", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhRZL4Ciao6eb6yA3xHPPzLtNQvXsHq", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

// Variables d'environnement
const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";

// ---------- JACKPOT CONFIG ----------
const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20; // 20% du bénéfice
const JACKPOT_HOUR = 20; // 20h (heure du tirage le samedi)

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();
const spectatorSockets = new Set();

// ============================================================
// PAIEMENT AUTOMATIQUE – ÉVITER LES DOUBLONS
// ============================================================
let processedTxIds = new Set();

let game = {
    id: null,
    status: "waiting",
    startedAt: null,
    endsAt: null,
    durationSeconds: GAME_DURATION_SECONDS
};

// ============================================================
// VÉRIFICATIONS
// ============================================================
if (!MONGODB_URI) {
    console.error("❌ MONGO_URI ou MONGODB_URI manque dans Railway.");
    process.exit(1);
}
if (!PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY manque dans Railway.");
    process.exit(1);
}

// ============================================================
// TRONWEB
// ============================================================
try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    console.log("✅ TronWeb initialisé.");
} catch (error) {
    console.error("❌ Erreur TronWeb :", error.message);
    process.exit(1);
}

// ============================================================
// WALLET
// ============================================================
try {
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    if (!MILTAPE_WALLET) throw new Error("Wallet vide.");
} catch (error) {
    console.error("❌ MILTAPE_PRIVATE_KEY invalide :", error.message);
    process.exit(1);
}

console.log("");
console.log("==============================================");
console.log("        TRON CONFIGURATION");
console.log("==============================================");
console.log("💰 Wallet :", MILTAPE_WALLET);
console.log("💵 USDT :", SUPPORTED_TOKENS.USDT.contract);
console.log("==============================================");
console.log("");

// ============================================================
// EXPRESS
// ============================================================
const app = express();
const server = http.createServer(app);

app.use(helmet());

const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." }
});
app.use('/api/', limiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============================================================
// SOCKET.IO
// ============================================================
const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// ============================================================
// MONGOOSE
// ============================================================
mongoose.set("strictQuery", true);

// ============================================================
// SCHEMAS
// ============================================================
const playerSchema = new mongoose.Schema(
    {
        gameId: { type: String, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 30 },
        wallet: { type: String, required: true, trim: true, index: true },
        taps: { type: Number, default: 0, min: 0 },
        bet: { type: Number, default: 0, min: 0 },
        paid: { type: Boolean, default: false },
        paymentTxId: { type: String, default: null },
        token: { type: String, default: 'USDT' }
    },
    { timestamps: true }
);

const messageSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 30 },
        message: { type: String, required: true, trim: true, maxlength: 300 },
        gameId: { type: String, default: null }
    },
    { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
    {
        txId: { type: String, required: true, unique: true, index: true },
        from: { type: String, required: true },
        to: { type: String, required: true },
        amount: { type: Number, required: true },
        verified: { type: Boolean, default: false },
        gameId: { type: String, default: null },
        token: { type: String, default: 'USDT' }
    },
    { timestamps: true }
);

const historySchema = new mongoose.Schema(
    {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
        playerName: { type: String, required: true },
        wallet: { type: String, required: true },
        gameId: { type: String, required: true },
        rank: { type: Number, required: true },
        bet: { type: Number, required: true },
        gain: { type: Number, required: true },
        taps: { type: Number, required: true },
        token: { type: String, default: 'USDT' },
        createdAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

const jackpotSchema = new mongoose.Schema(
    {
        weekStart: { type: Date, required: true },
        weekEnd: { type: Date, required: true },
        prize: { type: Number, default: 0 },
        accumulatedFund: { type: Number, default: 0 },
        winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
        drawn: { type: Boolean, default: false },
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }]
    },
    { timestamps: true }
);

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

// ============================================================
// MONGODB
// ============================================================
mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté."))
    .catch((error) => {
        console.error("❌ MongoDB erreur :", error.message);
        process.exit(1);
    });

// ============================================================
// UTILITAIRES
// ============================================================
function normalizeWallet(address) {
    return String(address || "").trim();
}

function isValidTronAddress(address) {
    const wallet = normalizeWallet(address);
    if (!wallet) return false;
    try {
        return tronWeb.isAddress(wallet);
    } catch {
        return false;
    }
}

function sameWallet(a, b) {
    return normalizeWallet(a) === normalizeWallet(b);
}

function generateGameId() {
    return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRemainingSeconds() {
    if (game.status !== "running" || !game.endsAt) return 0;
    return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function sendNotification(type, message, data = {}) {
    io.emit("notification:new", { type, message, data, timestamp: Date.now() });
}

// ============================================================
// LEADERBOARD
// ============================================================
async function getLeaderboard() {
    if (!game.id) return [];
    const players = await Player.find({ gameId: game.id }).sort({ taps: -1, createdAt: 1 }).limit(5).lean();
    return players.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        wallet: p.wallet,
        taps: p.taps,
        bet: p.bet,
        paid: p.paid,
        id: p._id,
        token: p.token || 'USDT'
    }));
}

// ============================================================
// TOTAL DES MISES
// ============================================================
async function getTotalStakes() {
    if (!game.id) return 0;
    const result = await Player.aggregate([
        { $match: { gameId: game.id } },
        { $group: { _id: null, total: { $sum: "$bet" } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
}

// ============================================================
// BROADCAST
// ============================================================
async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        const totalStakes = await getTotalStakes();
        const state = {
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds: game.durationSeconds,
            remainingSeconds: getRemainingSeconds(),
            onlinePlayers: onlineSockets.size,
            spectators: spectatorSockets.size,
            leaderboard
        };
        io.emit("game:state", state);
        io.emit("online:count", onlineSockets.size + spectatorSockets.size);
        io.emit("leaderboard:update", leaderboard);
        io.emit("timer:update", { remainingSeconds: getRemainingSeconds(), status: game.status });
        io.emit("totalStakes:update", { totalStakes });
    } catch (error) {
        console.error("broadcastGameState:", error.message);
    }
}

// ============================================================
// TRANSFERTS (USDT / TRX)
// ============================================================
async function sendTokenToWinner(wallet, amount, token = 'USDT') {
    if (!tronWeb || amount <= 0) return;

    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error(`Token non supporté : ${token}`);

    try {
        if (token === 'TRX') {
            const result = await tronWeb.trx.sendTransaction(wallet, amount * 1e6);
            console.log(`✅ ${amount} TRX envoyé à ${wallet} – TX: ${result}`);
            return result;
        } else {
            const contract = await tronWeb.contract().at(tokenInfo.contract);
            const amountInSun = tronWeb.toBigNumber(amount * Math.pow(10, tokenInfo.decimals));
            const tx = await contract.transfer(wallet, amountInSun);
            console.log(`✅ ${amount} ${token} envoyé à ${wallet} – TX: ${tx}`);
            return tx;
        }
    } catch (error) {
        console.error(`❌ Erreur transfert ${token} vers ${wallet} :`, error.message);
        throw error;
    }
}

// ============================================================
// CAGNOTTE DU SAMEDI
// ============================================================
async function getCurrentJackpot() {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    let jackpot = await Jackpot.findOne({
        weekStart: { $gte: start, $lte: now },
        weekEnd: { $gte: now, $lte: end }
    });

    if (!jackpot) {
        jackpot = await Jackpot.create({
            weekStart: start,
            weekEnd: end,
            prize: 0,
            accumulatedFund: 0,
            drawn: false,
            participants: []
        });
        console.log("🎁 Nouvelle cagnotte créée pour la semaine.");
    }
    return jackpot;
}

async function addToJackpotFund(serverProfit) {
    if (serverProfit <= 0) return;
    const jackpot = await getCurrentJackpot();
    if (!jackpot || jackpot.drawn) return;

    const contribution = Math.round(serverProfit * (JACKPOT_PERCENT / 100) * 100) / 100;
    if (contribution <= 0) return;

    jackpot.accumulatedFund += contribution;
    jackpot.prize = jackpot.accumulatedFund;
    await jackpot.save();

    io.emit("chat:message", {
        name: "💰 Cagnotte",
        message: `🎯 ${contribution} USDT ajoutés à la cagnotte du samedi ! (Total : ${jackpot.accumulatedFund} USDT)`,
        createdAt: new Date()
    });
    await emitJackpotUpdate();
}

function getNextSaturday() {
    const now = new Date();
    const nextSat = new Date(now);
    nextSat.setDate(now.getDate() + (6 - now.getDay()));
    nextSat.setHours(JACKPOT_HOUR, 0, 0, 0);
    if (nextSat < now) nextSat.setDate(nextSat.getDate() + 7);
    return nextSat.getTime();
}

async function emitJackpotUpdate() {
    const jackpot = await getCurrentJackpot();
    if (!jackpot) return;
    const nextDraw = getNextSaturday();
    let winnerName = null;
    if (jackpot.winner) {
        const winner = await Player.findById(jackpot.winner).select('name');
        if (winner) winnerName = winner.name;
    }
    io.emit("jackpot:update", {
        prize: jackpot.prize,
        participants: jackpot.participants.length,
        nextDraw: nextDraw,
        drawn: jackpot.drawn,
        winner: winnerName
    });
}

// ============================================================
// START GAME & TIMER (LE COEUR DU CHRONO)
// ============================================================
async function startGame() {
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    game = {
        id: generateGameId(),
        status: "running",
        startedAt: Date.now(),
        endsAt: Date.now() + GAME_DURATION_SECONDS * 1000,
        durationSeconds: GAME_DURATION_SECONDS
    };

    console.log("");
    console.log("🎮 NOUVELLE PARTIE :", game.id);
    console.log("⏱️ Durée : 10 minutes");

    await broadcastGameState();

    // Boucle du chrono exécutée chaque seconde
    gameTimer = setInterval(async () => {
        try {
            const remaining = getRemainingSeconds();
            io.emit("timer:update", { remainingSeconds: remaining, status: game.status });
            if (remaining === 60) sendNotification('warning', `⏱️ DERNIÈRE MINUTE ! Tapez plus vite !`);
            if (remaining <= 0) await finishGame();
        } catch (error) {
            console.error("gameTimer:", error.message);
        }
    }, 1000);
}

// ============================================================
// FIN GAME
// ============================================================
async function finishGame() {
    if (game.status !== "running") return;
    game.status = "finished";
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }

    const allPlayers = await Player.find({ gameId: game.id }).lean();
    const top5 = await Player.find({ gameId: game.id }).sort({ taps: -1 }).limit(5).lean();
    const totalStakes = allPlayers.reduce((sum, p) => sum + p.bet, 0);

    const winners = top5.map((p, index) => ({
        rank: index + 1,
        name: p.name,
        wallet: p.wallet,
        bet: p.bet,
        gain: p.bet * 2,
        taps: p.taps,
        _id: p._id,
        token: p.token || 'USDT'
    }));

    const totalPayout = winners.reduce((sum, w) => sum + w.gain, 0);
    const deficit = totalPayout - totalStakes;
    const serverProfit = deficit > 0 ? 0 : Math.abs(deficit);

    if (serverProfit > 0) await addToJackpotFund(serverProfit);

    for (const w of winners) {
        await Player.findByIdAndUpdate(w._id, { paid: true });
        await History.create({
            playerId: w._id,
            playerName: w.name,
            wallet: w.wallet,
            gameId: game.id,
            rank: w.rank,
            bet: w.bet,
            gain: w.gain,
            taps: w.taps,
            token: w.token
        });
    }

    io.emit("game:finished", {
        gameId: game.id,
        winners,
        totalStakes,
        totalPayout,
        deficit,
        onlinePlayers: onlineSockets.size,
        spectators: spectatorSockets.size
    });

    await broadcastGameState();
    await emitJackpotUpdate();

    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    nextGameTimeout = setTimeout(async () => {
        nextGameTimeout = null;
        await startGame();
    }, 5000);
}

// ============================================================
// SOCKET.IO
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    await broadcastGameState();
    await emitJackpotUpdate();

    const totalStakes = await getTotalStakes();
    socket.emit("totalStakes:update", { totalStakes });

    socket.on("jackpot:get", async () => { await emitJackpotUpdate(); });

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim();

            if (!name || !isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0) return;
            if (game.status !== "running") return socket.emit("error", { message: "La partie n'est pas ouverte." });

            let player = await Player.findOne({ gameId: game.id, wallet });
            if (!player) {
                player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false, token });
            } else {
                player.name = name;
                player.bet = bet;
                player.token = token;
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.wallet = wallet;
            socket.data.name = name;

            socket.emit("player:joined", {
                success: true,
                player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token }
            });

            await broadcastGameState();
            const newTotalStakes = await getTotalStakes();
            io.emit("totalStakes:update", { totalStakes: newTotalStakes });
        } catch (error) {
            console.error("player:join:", error.message);
        }
    });

    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;
            const player = await Player.findById(socket.data.playerId);
            if (!player || player.gameId !== game.id) return;

            player.taps += 1;
            await player.save();

            socket.emit("player:score", { taps: player.taps });
            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);
        } catch (error) {
            console.error("player:tap:", error.message);
        }
    });

    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || socket.data.name || "Joueur").trim().substring(0, 30);
            const message = String(data?.message || "").trim().substring(0, 300);
            if (!message) return;
            const saved = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: saved._id, name, message, createdAt: saved.createdAt });
        } catch (error) {
            console.error("chat:send:", error.message);
        }
    });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        spectatorSockets.delete(socket.id);
        await broadcastGameState();
    });
});

// ============================================================
// ROUTES API & STATS
// ============================================================
app.get("/api/game", async (req, res) => {
    try {
        const leaderboard = await getLeaderboard();
        res.json({
            success: true,
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds: game.durationSeconds,
            remainingSeconds: getRemainingSeconds(),
            onlinePlayers: onlineSockets.size,
            spectators: spectatorSockets.size,
            leaderboard
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post("/api/payment/verify", async (req, res) => {
    try {
        const { playerId, amount } = req.body;
        if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." });

        const player = await Player.findByIdAndUpdate(playerId, { paid: true, paymentTxId: "DEMO_" + Date.now() }, { new: true });
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });

        io.emit("payment:verified", {
            verified: true,
            wallet: player.wallet,
            amount: amount || player.bet,
            playerName: player.name,
            automatic: true,
            token: player.token || 'USDT'
        });

        res.json({ success: true, verified: true, message: "Paiement validé." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/api/player/history", async (req, res) => {
    try {
        const playerId = String(req.query?.playerId || "").trim();
        const wallet = normalizeWallet(req.query?.wallet);
        if (!playerId && !wallet) return res.status(400).json({ success: false, message: "playerId ou wallet requis." });

        const query = {};
        if (playerId) query._id = playerId;
        else query.wallet = wallet;

        const history = await History.find(query).sort({ createdAt: -1 }).limit(50).lean();
        const totalGain = history.reduce((sum, h) => sum + h.gain, 0);
        const gamesPlayed = history.length;
        const bestScore = history.length > 0 ? Math.max(...history.map(h => h.taps)) : 0;

        res.json({
            success: true,
            player: { wallet: wallet || "inconnu", totalGain, gamesPlayed, bestScore },
            history: history.map(h => ({ gameId: h.gameId, rank: h.rank, bet: h.bet, gain: h.gain, taps: h.taps, token: h.token || 'USDT', createdAt: h.createdAt }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// START SERVEUR
// ============================================================
server.listen(PORT, async () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    try {
        await startGame();
    } catch (error) {
        console.error("❌ Impossible de démarrer le jeu :", error.message);
    }
});
