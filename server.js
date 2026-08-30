const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const path = require("path");

// ⚠️ IMPORTANT : Utilisation correcte du port dynamique de Railway
const PORT = Number(process.env.PORT) || 3000;
const GAME_DURATION_SECONDS = 10 * 60;
const PREPARATION_DURATION_SECONDS = 2 * 60;
const JACKPOT_PERCENT = 0.05;

const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_MODE_ENABLED_ON_SERVER = process.env.ALLOW_DEMO_MODE === "true";

process.on("uncaughtException", (err) => console.error("❌", err?.message || err));
process.on("unhandledRejection", (reason) => console.error("❌", reason));

if (!MONGODB_URI || !PRIVATE_KEY || !ADMIN_PASSWORD) {
    console.error("❌ Variables d'environnement manquantes.");
    process.exit(1);
}

let tronWeb = null;
let MILTAPE_WALLET = "";
try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}
    });
    tronWeb.setPrivateKey(PRIVATE_KEY);
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    console.log("✅ Wallet Miltape :", MILTAPE_WALLET);
} catch (error) {
    console.error("❌ Erreur initialisation TronWeb :", error?.message || error);
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de requêtes." } });
app.use("/api/", limiter);

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000,
    pingTimeout: 60000
});

mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ Mongoose connecté."));
mongoose.connection.on("error", (err) => console.error("❌ Mongoose erreur :", err?.message || err));

// ===== MODÈLES =====
const playerSchema = new mongoose.Schema({
    gameId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    wallet: { type: String, trim: true, index: true },
    deviceId: { type: String, trim: true, index: true },
    taps: { type: Number, default: 0, min: 0 },
    weeklyTaps: { type: Number, default: 0 },
    bet: { type: Number, default: 0, min: 0 },
    paid: { type: Boolean, default: false },
    paymentTxId: { type: String, unique: true, sparse: true },
    token: { type: String, default: "USDT" },
    depositAmount: { type: Number, default: null },
    depositExpiresAt: { type: Date, default: null }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({ name: String, message: String, gameId: String }, { timestamps: true });
const paymentSchema = new mongoose.Schema({ txId: { type: String, unique: true }, from: String, to: String, amount: Number, verified: Boolean, gameId: String, token: String }, { timestamps: true });
const historySchema = new mongoose.Schema({ playerId: mongoose.Schema.Types.ObjectId, playerName: String, wallet: String, gameId: String, rank: Number, bet: Number, gain: Number, taps: Number, token: String, paidOut: Boolean, payoutTxId: String }, { timestamps: true });
const jackpotSchema = new mongoose.Schema({ weekStart: Date, weekEnd: Date, accumulatedFund: Number, winner: mongoose.Schema.Types.ObjectId, drawn: Boolean }, { timestamps: true });
const gameStateSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['waiting', 'preparing', 'running', 'finished'], default: 'waiting' },
    startedAt: Date,
    endsAt: Date,
    preparationEndsAt: Date,
    durationSeconds: Number,
    updatedAt: { type: Date, default: Date.now }
});

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);
const GameState = mongoose.model("GameState", gameStateSchema);

async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, connectTimeoutMS: 10000 });
        console.log("✅ MongoDB connecté.");
    } catch (error) { 
        console.error("❌ MongoDB erreur :", error?.message || error); 
        process.exit(1); 
    }
}

function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) { try { return tronWeb.isAddress(normalizeWallet(address)); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) { const controller = new AbortController(); const id = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(id); } }

let gameTimer = null, nextGameTimeout = null;
const onlineSockets = new Set();
let game = { id: null, status: "waiting", startedAt: null, endsAt: null, durationSeconds: GAME_DURATION_SECONDS, preparationEndsAt: null };

// (Le reste des fonctions de jeu, de persistance, socket.io et routes API reste identique à votre code original)
// ... [Insérez ici toutes vos fonctions existantes : loadOrCreateGameState, saveGameState, startPreparationPhase, beginActualGame, finishGame, etc.] ...

// Placeholder pour les fonctions (à copier-coller depuis votre code original)
async function loadOrCreateGameState() { /* Votre code original */ 
    try {
        let gameState = await GameState.findOne().sort({ updatedAt: -1 });
        if (!gameState) {
            gameState = new GameState({ gameId: generateGameId(), status: 'waiting', durationSeconds: GAME_DURATION_SECONDS });
            await gameState.save();
        }
        game.id = gameState.gameId;
        game.status = gameState.status;
        game.startedAt = gameState.startedAt;
        game.endsAt = gameState.endsAt;
        game.preparationEndsAt = gameState.preparationEndsAt;
        game.durationSeconds = gameState.durationSeconds || GAME_DURATION_SECONDS;
        console.log("✅ État du jeu chargé :", { id: game.id, status: game.status });
        return gameState;
    } catch (error) {
        console.error("❌ Erreur chargement état :", error);
        return new GameState({ gameId: generateGameId(), status: 'waiting', durationSeconds: GAME_DURATION_SECONDS });
    }
}

// Placeholder pour les fonctions (à copier-coller depuis votre code original)
async function saveGameState() { /* Votre code original */ }
async function startPreparationPhase() { /* Votre code original */ }
async function beginActualGame() { /* Votre code original */ }
async function finishGame() { /* Votre code original */ }
async function broadcastGameState() { /* Votre code original */ }
async function broadcastTimer() { /* Votre code original */ }
async function checkPendingPayments() { /* Votre code original */ }

// ===== DÉMARRAGE SÉCURISÉ POUR RAILWAY =====
async function startServer() {
    try {
        await connectMongoDB();
        
        const weekStart = new Date(); 
        weekStart.setHours(0, 0, 0, 0); 
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        
        if (!(await Jackpot.findOne({ weekStart }))) {
            await Jackpot.create({ 
                weekStart, 
                weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
                accumulatedFund: 0,
                drawn: false
            });
        }
        
        // Charge l'état du jeu (n'essaye pas de forcer une partie si elle est en attente)
        await loadOrCreateGameState();
        
        // ⚠️ IMPORTANT : On démarre l'écoute du serveur IMMÉDIATEMENT
        // Railway a besoin que le port soit ouvert pour considérer le déploiement comme réussi.
        // La partie ne démarrera que lorsque le premier joueur se connectera (dans player:join).
        server.listen(PORT, async () => {
            console.log("🚀 BACKEND ONLINE (Sécurisé)");
            console.log(`🌐 Port : ${PORT}`);
            console.log(`🔬 Mode Démo Gratuit : ${DEMO_MODE_ENABLED_ON_SERVER ? 'ACTIF' : 'INACTIF'}`);
            console.log(`🎮 État initial du jeu : ${game.status}`);
        });
    } catch (error) {
        console.error("❌ Impossible de démarrer :", error);
        process.exit(1);
    }
}

startServer();

// Gestion propre de l'arrêt de Railway (SIGTERM) pour éviter l'erreur npm
process.on("SIGTERM", async () => {
    console.log("🛑 SIGTERM reçu. Fermeture propre...");
    if (gameTimer) clearTimeout(gameTimer);
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    try {
        // On ferme d'abord le serveur HTTP pour arrêter les nouvelles connexions
        await new Promise((resolve) => server.close(() => { 
            console.log("🔌 Serveur HTTP fermé."); 
            resolve(); 
        }));
        // On déconnecte ensuite MongoDB
        await mongoose.connection.close();
        console.log("✅ Fermeture propre terminée.");
        process.exit(0);
    } catch (error) { 
        console.error("❌ Erreur lors de la fermeture :", error?.message || error); 
        process.exit(1); 
    }
});
