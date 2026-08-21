const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const PORT = Number(process.env.PORT) || 3000;

const GAME_DURATION_SECONDS = 10 * 60;

const USDT_CONTRACT = (process.env.USDT_CONTRACT || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t").trim();
const USDT_DECIMALS = 6;
const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();
const spectatorSockets = new Set();

let processedTxIds = new Set();

let game = {
    id: null,
    status: "waiting",
    startedAt: null,
    endsAt: null,
    durationSeconds: GAME_DURATION_SECONDS
};

if (!MONGODB_URI) { console.error("❌ MONGO_URI manque."); process.exit(1); }
if (!PRIVATE_KEY) { console.error("❌ MILTAPE_PRIVATE_KEY manque."); process.exit(1); }

try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    console.log("✅ TronWeb initialisé.");
} catch (error) { console.error("❌ Erreur TronWeb :", error.message); process.exit(1); }

try {
    MILTAPE_WALLET = TronWeb.address.fromPrivateKey(PRIVATE_KEY);
    if (!MILTAPE_WALLET) throw new Error("Wallet vide.");
} catch (error) { console.error("❌ MILTAPE_PRIVATE_KEY invalide :", error.message); process.exit(1); }

// ============================================================
// EXPRESS
// ============================================================
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1); 

app.use(helmet());

const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes." }
});
app.use('/api/', limiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============================================================
// SOCKET.IO
// ============================================================
const io = new Server(server, {
    cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"], credentials: true }
});

mongoose.set("strictQuery", true);

// ============================================================
// SCHEMAS (MISE À JOUR POUR LE COMBO)
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
        // AJOUT POUR LE COMBO :
        combo: { type: Number, default: 0 },
        lastTapTime: { type: Number, default: 0 }
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
        gameId: { type: String, default: null }
    },
    { timestamps: true }
);

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);

mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté."))
    .catch((error) => { console.error("❌ MongoDB erreur :", error.message); process.exit(1); });

// ============================================================
// UTILITAIRES
// ============================================================
function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) {
    const wallet = normalizeWallet(address);
    if (!wallet) return false;
    try { return tronWeb.isAddress(wallet); } catch { return false; }
}
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() {
    return ("GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase());
}
function getRemainingSeconds() {
    if (game.status !== "running" || !game.endsAt) return 0;
    return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
}

async function getLeaderboard() {
    if (!game.id) return [];
    const players = await Player.find({ gameId: game.id }).sort({ taps: -1, createdAt: 1 }).limit(5).lean();
    return players.map((player, index) => ({ rank: index + 1, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid }));
}

// ============================================================
// BROADCAST & CHRONO
// ============================================================
async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        const state = { gameId: game.id, status: game.status, startedAt: game.startedAt, endsAt: game.endsAt, durationSeconds: game.durationSeconds, remainingSeconds: getRemainingSeconds(), onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, leaderboard };

        io.emit("game:state", state);
        io.emit("online:count", onlineSockets.size + spectatorSockets.size);
        io.emit("leaderboard:update", leaderboard);
        io.emit("timer:update", { remainingSeconds: getRemainingSeconds(), status: game.status });
    } catch (error) { console.error("broadcastGameState:", error.message); }
}

// ============================================================
// START GAME (C'est ici que le CHRONO est émis)
// ============================================================
async function startGame() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }

    game = {
        id: generateGameId(),
        status: "running",
        startedAt: Date.now(),
        endsAt: Date.now() + GAME_DURATION_SECONDS * 1000,
        durationSeconds: GAME_DURATION_SECONDS
    };

    console.log("🎮 NOUVELLE PARTIE :", game.id);
    await broadcastGameState();

    gameTimer = setInterval(async () => {
        try {
            const remaining = getRemainingSeconds();
            io.emit("timer:update", { remainingSeconds: remaining, status: game.status });
            if (remaining <= 0) { await finishGame(); }
        } catch (error) { console.error("gameTimer:", error.message); }
    }, 1000);
}

// ============================================================
// SOCKET EVENTS
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log("🟢 Socket connecté :", socket.id);
    await broadcastGameState();

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const bet = Number(data?.bet);

            if (!name) return socket.emit("error", { message: "Nom invalide." });
            if (!isValidTronAddress(wallet)) return socket.emit("error", { message: "Adresse TRON invalide." });
            if (!Number.isFinite(bet) || bet <= 0) return socket.emit("error", { message: "Montant invalide." });
            if (game.status !== "running") return socket.emit("error", { message: "La partie n'est pas ouverte." });

            let player = await Player.findOne({ gameId: game.id, wallet });
            if (!player) { player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false }); }
            else { player.name = name; player.bet = bet; await player.save(); }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.wallet = wallet;
            socket.data.name = name;
            socket.data.isSpectator = false;

            socket.emit("player:joined", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid } });
            await broadcastGameState();
        } catch (error) { console.error("player:join:", error.message); socket.emit("error", { message: "Impossible de rejoindre la partie." }); }
    });

    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;
            if (socket.data.isSpectator) return;

            const player = await Player.findById(socket.data.playerId);
            if (!player || player.gameId !== game.id) return;

            // GESTION DU COMBO (AJOUTÉ)
            const now = Date.now();
            if (player.lastTapTime && now - player.lastTapTime < 900) {
                player.combo = (player.combo || 0) + 1;
            } else {
                player.combo = 1;
            }
            player.lastTapTime = now;

            const pointsToAdd = 1 + Math.min(player.combo, 5); 
            player.taps += pointsToAdd;

            await player.save();

            socket.emit("player:score", { taps: player.taps, combo: player.combo });
            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);
        } catch (error) { console.error("player:tap:", error.message); }
    });

    // ============================================================
    // LE CHAT (ICI, RÉPARÉ POUR LE FRONTEND)
    // ============================================================
    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || socket.data.name || "Joueur").trim().substring(0, 30);
            const message = String(data?.message || "").trim().substring(0, 300);
            if (!message) return;

            const saved = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: saved._id, name, message, createdAt: saved.createdAt });
        } catch (error) { console.error("chat:send:", error.message); }
    });

    // ... (Le reste de vos événements : spectateur, restauration, etc. restent inchangés)
    socket.on("spectator:join", async (data) => { /* ... */ });
    socket.on("player:restore", async (data) => { /* ... */ });
    socket.on("disconnect", async () => { /* ... */ });
});

// ... (Toutes vos routes API existantes restent inchangées en bas de fichier)
// [Votre code pour les routes API et le démarrage du serveur reste ici]
