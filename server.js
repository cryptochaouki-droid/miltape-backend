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
const crypto = require("crypto");
const { z } = require("zod");

// ============ CONFIG ============
const PORT = Number(process.env.PORT) || 3000;
const GAME_DURATION_SECONDS = 10 * 60;
const PREPARATION_DURATION_SECONDS = 2 * 60;
const JACKPOT_PERCENT = 0.05;
const DUEL_COMMISSION_PERCENT = 0.10;
const DUEL_PAYMENT_TIMEOUT_MS = 60000;
const DUEL_FORFEIT_GRACE_MS = 15000;
const MIN_TAP_INTERVAL_MS = 60;
const MIN_CHAT_INTERVAL_MS = 2000;
const REFERRAL_PERCENT = 0.03;
const REFERRAL_MIN_BET = 1;
const MAX_BET = 100000;
const NAME_REGEX = /^[\p{L}\p{N} _'-]{1,30}$/u;
const REFERRAL_DAILY_CAP_PER_REFERRER = 20;
const POW_DIFFICULTY = 4;
const MAX_SOCKETS_PER_IP = 40;
const MAX_NEW_CONNECTIONS_PER_IP_PER_MIN = 120;
const MIN_CONFIRMATIONS = Number(process.env.MIN_CONFIRMATIONS || 19);
const DAILY_OUTFLOW_CAP = Number(process.env.DAILY_OUTFLOW_CAP || 500);
const SUSPICIOUS_SOURCE_THRESHOLD = 5;

// ✅ FIX 5.1 : CORS strict
if (!process.env.ALLOWED_ORIGINS) {
    console.error("❌ ALLOWED_ORIGINS obligatoire.");
    process.exit(1);
}
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.some(o => o === "*")) {
    console.error("❌ Wildcard interdit.");
    process.exit(1);
}

const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_MODE_ENABLED_ON_SERVER = process.env.ALLOW_DEMO_MODE === "true";
const ADMIN_WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL || "";

const MASTER_KEY = (process.env.MASTER_KEY || "").trim();
const ENCRYPTED_PRIVATE_KEY = (process.env.ENCRYPTED_PRIVATE_KEY || "").trim();

if (!MASTER_KEY || !ENCRYPTED_PRIVATE_KEY) {
    console.error("❌ MASTER_KEY et ENCRYPTED_PRIVATE_KEY obligatoires.");
    process.exit(1);
}
if (process.env.MILTAPE_PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY détecté (fuite). Supprime-le.");
    process.exit(1);
}
if (MASTER_KEY.length !== 64) {
    console.error("❌ MASTER_KEY doit faire 64 caractères hex.");
    process.exit(1);
}

function decryptPrivateKey() {
    const key = Buffer.from(MASTER_KEY, 'hex');
    const encrypted = Buffer.from(ENCRYPTED_PRIVATE_KEY, 'hex');
    const iv = encrypted.slice(0, 16);
    const data = encrypted.slice(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

process.on("uncaughtException", (err) => console.error("❌", err?.message || err));
process.on("unhandledRejection", (reason) => console.error("❌", reason));

if (!MONGODB_URI || !ADMIN_PASSWORD) {
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
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(decryptPrivateKey());
    console.log("✅ Wallet Miltape :", MILTAPE_WALLET, "(clé chiffrée)");
} catch (error) {
    console.error("❌ Erreur initialisation TronWeb :", error?.message || error);
    process.exit(1);
}

const outflowsByDay = new Map();
function getTodayKey() { return new Date().toISOString().slice(0, 10); }
function getTodayOutflow() { return outflowsByDay.get(getTodayKey()) || 0; }
function recordOutflow(amount) {
    outflowsByDay.set(getTodayKey(), getTodayOutflow() + Number(amount));
}

async function alertAdmins(message) {
    if (!ADMIN_WEBHOOK_URL) { console.warn("⚠️ [ALERTE]", message); return; }
    try {
        await fetch(ADMIN_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: message })
        });
    } catch (e) { console.error("❌ Alerte :", e?.message); }
}

const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ✅ NOUVEAU : routes explicites pour les fichiers HTML statiques
app.get('/crypto-tool.html', (req, res) => res.sendFile(path.join(__dirname, 'crypto-tool.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/conditions.html', (req, res) => res.sendFile(path.join(__dirname, 'conditions.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de requêtes." } });
app.use("/api/", limiter);

const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true }, pingInterval: 25000, pingTimeout: 60000 });

io.use((socket, next) => {
    const ip = getClientIp(socket);
    socket.data.clientIp = ip;
    const cookies = parseCookies(socket.handshake.headers.cookie);
    socket.data.cookieSessionToken = cookies['miltape_session'] || null;
    if (!ip) return next();
    const activeForIp = socketsByIp.get(ip);
    if (activeForIp && activeForIp.size >= MAX_SOCKETS_PER_IP) return next(new Error("Trop de connexions."));
    const now = Date.now();
    const attempt = connectionAttemptsByIp.get(ip) || { count: 0, windowStart: now };
    if (now - attempt.windowStart > 60000) { attempt.count = 0; attempt.windowStart = now; }
    attempt.count += 1;
    connectionAttemptsByIp.set(ip, attempt);
    if (attempt.count > MAX_NEW_CONNECTIONS_PER_IP_PER_MIN) return next(new Error("Trop de tentatives."));
    next();
});

mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ Mongoose connecté."));
mongoose.connection.on("error", (err) => console.error("❌ Mongoose erreur :", err?.message || err));

// ============ MODÈLES ============
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
    depositExpiresAt: { type: Date, default: null },
    sessionToken: { type: String, unique: true, sparse: true },
    duelPaid: { type: Boolean, default: false },
    duelPaymentTxId: { type: String, sparse: true },
    referralCode: { type: String, unique: true, sparse: true },
    referredByCode: { type: String, default: null },
    referralCounted: { type: Boolean, default: false },
    referralEarnings: { type: Number, default: 0 },
    referralCount: { type: Number, default: 0 },
    depositExpiredAt: { type: Date, default: null }
}, { timestamps: true });

const duelEntrySchema = new mongoose.Schema({
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
    bet: { type: Number, required: true },
    token: { type: String, default: "USDT" },
    paid: { type: Boolean, default: false },
    paymentTxId: { type: String, unique: true, sparse: true },
    createdAt: { type: Date, default: Date.now }
});
const DuelEntry = mongoose.model("DuelEntry", duelEntrySchema);

const referralPayoutSchema = new mongoose.Schema({
    referrerId: mongoose.Schema.Types.ObjectId,
    referrerWallet: String,
    referredPlayerId: mongoose.Schema.Types.ObjectId,
    referredName: String,
    referredWallet: String,
    betAmount: Number,
    commission: Number,
    token: String,
    txId: String,
    held: { type: Boolean, default: false }
}, { timestamps: true });
const ReferralPayout = mongoose.model("ReferralPayout", referralPayoutSchema);

const bannedWalletSchema = new mongoose.Schema({
    wallet: { type: String, required: true, unique: true },
    reason: { type: String, default: "" }
}, { timestamps: true });
const BannedWallet = mongoose.model("BannedWallet", bannedWalletSchema);

const adminAuditLogSchema = new mongoose.Schema({
    route: String, method: String, ip: String, payload: mongoose.Schema.Types.Mixed
}, { timestamps: true });
const AdminAuditLog = mongoose.model("AdminAuditLog", adminAuditLogSchema);

const unmatchedPaymentSchema = new mongoose.Schema({
    txId: { type: String, unique: true, required: true },
    from: { type: String, index: true },
    to: String,
    amount: Number,
    token: String,
    suspectedPlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    suspectedPlayerName: String,
    suspectedGameId: String,
    reason: { type: String, enum: ['no_player_found', 'deposit_expired', 'round_too_old', 'amount_mismatch', 'suspicious_source'], default: 'no_player_found' },
    resolved: { type: Boolean, default: false },
    resolvedAction: { type: String, default: null },
    resolvedTxId: String,
    resolvedAt: Date
}, { timestamps: true });
const UnmatchedPayment = mongoose.model("UnmatchedPayment", unmatchedPaymentSchema);

const messageSchema = new mongoose.Schema({ name: String, message: String, gameId: String }, { timestamps: true });
const paymentSchema = new mongoose.Schema({ txId: { type: String, unique: true }, from: String, to: String, amount: Number, verified: Boolean, gameId: String, token: String }, { timestamps: true });

const historySchema = new mongoose.Schema({
    playerId: mongoose.Schema.Types.ObjectId,
    playerName: String,
    wallet: String,
    gameId: String,
    rank: Number,
    bet: Number,
    gain: Number,
    taps: Number,
    token: String,
    paidOut: Boolean,
    payoutTxId: String,
    payoutAttempts: { type: Number, default: 0 },
    payoutLastError: { type: String, default: null },
    payoutFailed: { type: Boolean, default: false },
    paying: { type: Boolean, default: false },
    payingStartedAt: { type: Date, default: null }
}, { timestamps: true });

const jackpotSchema = new mongoose.Schema({ weekStart: Date, weekEnd: Date, accumulatedFund: Number, winner: mongoose.Schema.Types.ObjectId, drawn: Boolean }, { timestamps: true });

const gameStateSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['waiting', 'preparing', 'running', 'finished'], default: 'waiting' },
    startedAt: Date, endsAt: Date, preparationEndsAt: Date, durationSeconds: Number,
    updatedAt: { type: Date, default: Date.now }
});
gameStateSchema.index({ updatedAt: -1 });

const adminUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    totpSecret: { type: String, required: true },
    role: { type: String, enum: ["super_admin", "moderator"], default: "moderator" },
    lastLoginAt: Date,
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: Date
}, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);
const GameState = mongoose.model("GameState", gameStateSchema);
const AdminUser = mongoose.model("AdminUser", adminUserSchema);

async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, connectTimeoutMS: 10000 });
        console.log("✅ MongoDB connecté.");
    } catch (error) { console.error("❌ MongoDB erreur :", error?.message || error); process.exit(1); }
}

// ============ VALIDATION ZOD ============
const PlayerJoinSchema = z.object({
    name: z.string().regex(NAME_REGEX, "Pseudo invalide"),
    wallet: z.string().startsWith("T").length(34, "Wallet TRON invalide"),
    bet: z.number().positive().min(0.5).max(MAX_BET),
    token: z.enum(["USDT", "USDC", "TUSD", "TRX"]),
    deviceId: z.string().max(100).optional(),
    referralCode: z.string().max(20).regex(/^[A-Z0-9]*$/).optional(),
    powNonce: z.string().min(1).max(50)
});

const ChatSendSchema = z.object({
    message: z.string().min(1).max(300)
});

const DuelJoinSchema = z.object({
    bet: z.number().positive()
});

// ============ UTILITAIRES ============
function normalizeWallet(address) { return String(address || "").trim(); }
function sanitizeText(str, maxLength) {
    if (typeof str !== "string") return "";
    return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().substring(0, maxLength);
}
function isValidTronAddress(address) { try { return tronWeb.isAddress(normalizeWallet(address)); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
function generateSessionToken() { return crypto.randomBytes(32).toString('hex'); }

async function generateUniqueReferralCode() {
    for (let i = 0; i < 10; i++) {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const exists = await Player.findOne({ referralCode: code });
        if (!exists) return code;
    }
    return "R" + Date.now().toString(36).toUpperCase();
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) { const controller = new AbortController(); const id = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(id); } }

let gameTimer = null, nextGameTimeout = null;
const onlineSockets = new Set();
let game = { id: null, status: "waiting", startedAt: null, endsAt: null, durationSeconds: GAME_DURATION_SECONDS, preparationEndsAt: null };

const activeDuels = {};
const duelPools = {};
const pendingDuelPayments = {};
const duelMatches = {};
const lastTapTimestamps = new Map();
const lastDuelTapTimestamps = new Map();
const lastChatTimestamps = new Map();
const bannedWallets = new Set();
const socketsByIp = new Map();
const connectionAttemptsByIp = new Map();

function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader) return out;
    String(cookieHeader).split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) { try { out[key] = decodeURIComponent(val); } catch { out[key] = val; } }
    });
    return out;
}

function getClientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return null;
}

function issuePowChallenge(socket) {
    const challenge = crypto.randomBytes(16).toString('hex');
    socket.data.powChallenge = challenge;
    socket.data.powUsed = false;
    socket.emit("pow:challenge", { challenge, difficulty: POW_DIFFICULTY });
}

// ============ GAME STATE ============
async function loadOrCreateGameState() {
    try {
        let gameState = await GameState.findOne().sort({ updatedAt: -1 });
        if (!gameState) {
            gameState = new GameState({ gameId: generateGameId(), status: 'preparing', durationSeconds: GAME_DURATION_SECONDS });
            await gameState.save();
        }
        game.id = gameState.gameId;
        game.status = gameState.status;
        game.startedAt = gameState.startedAt;
        game.endsAt = gameState.endsAt;
        game.preparationEndsAt = gameState.preparationEndsAt;
        game.durationSeconds = gameState.durationSeconds || GAME_DURATION_SECONDS;

        if (game.status === 'waiting' || game.status === 'finished' || !game.id) {
            await startPreparationPhase();
        } else if (game.status === 'preparing' && game.preparationEndsAt) {
            const now = Date.now();
            if (game.preparationEndsAt.getTime() > now) {
                gameTimer = setTimeout(() => beginActualGame().catch(err => console.error(err)), game.preparationEndsAt.getTime() - now);
            } else await beginActualGame();
        } else if (game.status === 'running' && game.endsAt) {
            const now = Date.now();
            if (game.endsAt.getTime() > now) {
                gameTimer = setTimeout(() => finishGame().catch(err => console.error(err)), game.endsAt.getTime() - now);
            } else await finishGame();
        }
        return gameState;
    } catch (error) {
        console.error("❌ Erreur état :", error);
        const newState = new GameState({ gameId: generateGameId(), status: 'preparing', durationSeconds: GAME_DURATION_SECONDS });
        await newState.save();
        await startPreparationPhase();
        return newState;
    }
}

async function saveGameState() {
    try {
        await GameState.findOneAndUpdate(
            { gameId: game.id },
            { status: game.status, startedAt: game.startedAt, endsAt: game.endsAt, preparationEndsAt: game.preparationEndsAt, durationSeconds: game.durationSeconds, updatedAt: new Date() },
            { upsert: true }
        );
    } catch (error) { console.error("❌ Erreur sauvegarde :", error); }
}

function getRemainingSeconds() {
    if (game.status === "preparing" && game.preparationEndsAt) return Math.max(0, Math.ceil((game.preparationEndsAt.getTime() - Date.now()) / 1000));
    if (game.status !== "running" || !game.endsAt) return 0;
    return Math.max(0, Math.ceil((game.endsAt.getTime() - Date.now()) / 1000));
}

function getGameStateObject() {
    return { id: game.id, status: game.status, startsAt: game.startedAt, endsAt: game.endsAt, remainingSeconds: getRemainingSeconds(), durationSeconds: game.status === "preparing" ? PREPARATION_DURATION_SECONDS : game.durationSeconds, preparationEndsAt: game.preparationEndsAt };
}

function broadcastTimer() {
    if (!game.id) return;
    io.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
}

function broadcastOnlineCount() { io.emit("online:count", { count: onlineSockets.size }); }

async function emitLeaderboard() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps -_id").sort({ taps: -1 }).limit(50).lean();
        io.emit("leaderboard:update", players.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps })));
    } catch (error) { console.error("❌ emitLeaderboard :", error?.message || error); }
}

async function emitTotalStakes() {
    try {
        const result = await Player.aggregate([{ $match: { gameId: game.id } }, { $group: { _id: null, total: { $sum: "$bet" } } }]);
        io.emit("totalStakes:update", { totalStakes: result.length > 0 ? result[0].total : 0 });
    } catch (error) { console.error("❌ emitTotalStakes :", error?.message || error); }
}

async function broadcastGameState() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps -_id").sort({ taps: -1 }).limit(50).lean();
        io.emit("game:state", { game: getGameStateObject(), players });
        await emitLeaderboard();
        await emitTotalStakes();
    } catch (error) { console.error("❌ broadcastGameState :", error?.message || error); }
}

async function startPreparationPhase() {
    console.log("⏳ Préparation (2 min)...");
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    if (nextGameTimeout) { clearTimeout(nextGameTimeout); nextGameTimeout = null; }
    game.id = generateGameId();
    game.status = "preparing";
    game.startedAt = new Date();
    game.endsAt = null;
    game.preparationEndsAt = new Date(Date.now() + PREPARATION_DURATION_SECONDS * 1000);
    await saveGameState();
    await Player.updateMany({}, { $set: { taps: 0 } });
    io.emit("game:preparing", { gameId: game.id, preparationEndsAt: game.preparationEndsAt, duration: PREPARATION_DURATION_SECONDS });
    broadcastTimer();
    gameTimer = setTimeout(() => { beginActualGame().catch(err => console.error(err)); }, PREPARATION_DURATION_SECONDS * 1000);
    try { await broadcastGameState(); await emitJackpotUpdate(); }
    catch (error) { console.error("❌ post-préparation :", error?.message || error); }
}

async function beginActualGame() {
    if (game.status !== "preparing") return;
    console.log("🚀 Le jeu commence ! (10 min)");
    game.status = "running";
    game.startedAt = new Date();
    game.endsAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
    game.preparationEndsAt = null;
    await saveGameState();
    io.emit("game:started", { gameId: game.id, startsAt: game.startedAt, endsAt: game.endsAt, duration: GAME_DURATION_SECONDS, remainingSeconds: GAME_DURATION_SECONDS });
    broadcastTimer();
    gameTimer = setTimeout(() => { finishGame().catch(err => console.error(err)); }, GAME_DURATION_SECONDS * 1000);
    try { await broadcastGameState(); await emitJackpotUpdate(); }
    catch (error) { console.error("❌ post-démarrage :", error?.message || error); }
}

async function finishGame() {
    if (game.status !== "running") return;
    console.log("🏁 Fin de la partie...");
    game.status = "finished";
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    await saveGameState();
    broadcastTimer();
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    nextGameTimeout = setTimeout(() => { startPreparationPhase().catch(err => console.error(err)); }, 3000);
    try {
        const players = await Player.find({ gameId: game.id, paid: true }).sort({ taps: -1 });
        if (players.length === 0) {
            io.emit("game:finished", { gameId: game.id, winners: [] });
            io.emit("chat:message", { name: "🏆 Système", message: "🏁 Terminé ! Aucun gagnant.", createdAt: new Date() });
            return;
        }
        const isDemoGame = players.some(p => p.paymentTxId && p.paymentTxId.startsWith('DEMO_'));
        const topPlayers = players.slice(0, 5);
        const winners = [];
        for (let i = 0; i < topPlayers.length; i++) {
            const p = topPlayers[i];
            const gain = Number((p.bet * 2).toFixed(6));
            const history = await History.create({ playerId: p._id, playerName: p.name, wallet: p.wallet, gameId: game.id, rank: i + 1, bet: p.bet, gain, taps: p.taps, token: p.token, paidOut: false });
            winners.push({ player: p, gain, history });
        }
        if (isDemoGame) {
            for (const { history } of winners) { history.paidOut = true; history.payoutTxId = "DEMO_TX_" + Date.now().toString(36); await history.save(); }
        } else {
            for (const { player, gain, history } of winners) {
                retryFailedPayout(history._id).catch(e => console.error("❌ Retry initial :", e?.message));
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        const winnersList = topPlayers.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps, bet: p.bet, token: p.token, gain: Number((p.bet * 2).toFixed(6)) }));
        io.emit("game:finished", { gameId: game.id, winners: winnersList });
        io.emit("chat:message", { name: "🏆 Système", message: `🏁 ${winnersList.length} gagnants !`, createdAt: new Date() });
    } catch (error) { console.error("❌ finishGame :", error?.message || error); }
}

async function checkHotWalletBalance(token, amountNeeded) {
    try {
        if (token === "TRX") {
            const balance = await tronWeb.trx.getBalance(MILTAPE_WALLET);
            return balance >= amountNeeded * 1e6 + 5e6;
        }
        const tokenInfo = SUPPORTED_TOKENS[token];
        const contract = await tronWeb.contract().at(tokenInfo.contract);
        const balanceRaw = await contract.balanceOf(MILTAPE_WALLET).call();
        const balance = Number(balanceRaw) / Math.pow(10, tokenInfo.decimals);
        const trxBalance = await tronWeb.trx.getBalance(MILTAPE_WALLET);
        return balance >= amountNeeded && trxBalance >= 15e6;
    } catch (error) { console.error("❌ checkBalance :", error?.message); return false; }
}

async function canPayout(amount) {
    const total = getTodayOutflow() + Number(amount);
    if (total > DAILY_OUTFLOW_CAP) {
        await alertAdmins(`🚨 Plafond atteint : ${total.toFixed(2)} > ${DAILY_OUTFLOW_CAP} USDT`);
        return false;
    }
    return true;
}

async function sendPrizeToWinner(historyEntry) {
    try {
        const { wallet, gain, token, playerName } = historyEntry;
        if (!wallet || gain <= 0) return false;
        if (!isValidTronAddress(wallet)) return false;
        const tokenInfo = SUPPORTED_TOKENS[token];
        if (!tokenInfo) throw new Error("Token non supporté");

        const balanceOK = await checkHotWalletBalance(token, gain);
        if (!balanceOK) {
            console.error(`🚨 [SOLDE INSUFFISANT] ${gain} ${token} à ${playerName}`);
            await alertAdmins(`🚨 Solde insuffisant pour payer ${gain} ${token} à ${playerName}`);
            throw new Error("SOLDE_INSUFFISANT");
        }
        const capOK = await canPayout(gain);
        if (!capOK) throw new Error("PLAFOND_ATTEINT");

        const signingTronWeb = new TronWeb({ fullHost: "https://api.trongrid.io", headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} });
        signingTronWeb.setPrivateKey(decryptPrivateKey());

        let txId = null;
        if (token === "TRX") { const tx = await signingTronWeb.trx.sendTransaction(wallet, Math.floor(gain * 1e6)); txId = tx.txid; }
        else { const contract = await signingTronWeb.contract().at(tokenInfo.contract); const tx = await contract.transfer(wallet, Math.floor(gain * Math.pow(10, tokenInfo.decimals))).send(); txId = tx.txid; }
        console.log(`✅ ${gain} ${token} envoyé à ${playerName}`);
        recordOutflow(gain);
        return txId;
    } catch (error) { console.error("❌ sendPrize :", error?.message); return null; }
}

async function retryFailedPayout(historyId, attempt = 1, maxAttempts = 3) {
    try {
        const history = await History.findOneAndUpdate(
            { _id: historyId, paidOut: false, paying: { $ne: true } },
            { $set: { paying: true, payingStartedAt: new Date() }, $inc: { payoutAttempts: 1 } },
            { new: true }
        );
        if (!history) {
            const check = await History.findById(historyId);
            if (check?.paidOut) return true;
            return false;
        }
        if (!history.gain || history.gain <= 0) {
            await History.findByIdAndUpdate(historyId, { paying: false, payoutFailed: true, payoutLastError: "Gain invalide" });
            return false;
        }
        console.log(`🔄 [Retry ${attempt}/${maxAttempts}] ${history.gain} ${history.token} à ${history.playerName}...`);
        const txId = await sendPrizeToWinner({ wallet: history.wallet, gain: history.gain, token: history.token, playerName: history.playerName });
        if (txId) {
            await History.findByIdAndUpdate(historyId, { paidOut: true, paying: false, payoutTxId: txId, payoutFailed: false, payoutLastError: null });
            console.log(`✅ [Retry ${attempt}] OK ${txId}`);
            io.emit("payout:success", { playerName: history.playerName, gain: history.gain, token: history.token, txId });
            return true;
        }
        throw new Error("sendPrize null");
    } catch (error) {
        const errMsg = error?.message || String(error);
        console.error(`❌ [Retry ${attempt}/${maxAttempts}] #${historyId} : ${errMsg}`);
        await History.findByIdAndUpdate(historyId, { paying: false, payoutLastError: errMsg }).catch(() => {});
        if (attempt < maxAttempts) {
            const backoffMs = 2000 * Math.pow(2, attempt - 1);
            setTimeout(() => retryFailedPayout(historyId, attempt + 1, maxAttempts).catch(e => console.error(e?.message)), backoffMs);
        } else {
            await History.findByIdAndUpdate(historyId, { payoutFailed: true });
            io.emit("payout:failed", { playerName: history?.playerName, historyId });
            await alertAdmins(`🚨 Payout abandonné #${historyId}`);
        }
        return false;
    }
}

async function payReferralCommission(referredPlayer, betAmount, token) {
    try {
        if (!referredPlayer.referredByCode) return;
        if (referredPlayer.referralCounted) return;
        if (Number(betAmount) < REFERRAL_MIN_BET) return;
        const referrer = await Player.findOne({ referralCode: referredPlayer.referredByCode });
        if (!referrer) return;
        if (sameWallet(referrer.wallet, referredPlayer.wallet)) return;
        if (referrer.deviceId && referredPlayer.deviceId && referrer.deviceId === referredPlayer.deviceId) return;
        if (referrer.referredByCode && referrer.referredByCode === referredPlayer.referralCode) return;
        const commission = Number((Number(betAmount) * REFERRAL_PERCENT).toFixed(6));
        if (commission <= 0) return;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentAgg = await ReferralPayout.aggregate([
            { $match: { referrerId: referrer._id, createdAt: { $gte: since }, held: false } },
            { $group: { _id: null, total: { $sum: "$commission" } } }
        ]);
        const alreadyPaid24h = recentAgg.length ? recentAgg[0].total : 0;
        const held = (alreadyPaid24h + commission) > REFERRAL_DAILY_CAP_PER_REFERRER;
        let txId = null;
        if (!held) {
            txId = await sendPrizeToWinner({ wallet: referrer.wallet, gain: commission, token, playerName: referrer.name });
            referrer.referralEarnings = Number((Number(referrer.referralEarnings || 0) + commission).toFixed(6));
            referrer.referralCount = Number(referrer.referralCount || 0) + 1;
            await referrer.save();
        }
        referredPlayer.referralCounted = true;
        await referredPlayer.save();
        await ReferralPayout.create({ referrerId: referrer._id, referrerWallet: referrer.wallet, referredPlayerId: referredPlayer._id, referredName: referredPlayer.name, referredWallet: referredPlayer.wallet, betAmount, commission, token, txId: txId || null, held });
    } catch (error) { console.error("❌ payReferral :", error?.message || error); }
}

async function verifyOnChain(txId, expectedAmount, token = "USDT", expectedSender = null) {
    try {
        const tx = await tronWeb.trx.getTransaction(txId);
        if (!tx) return false;
        const contract = tx.raw_data?.contract?.[0];
        if (!contract) return false;
        let amount = 0, sender = null;
        if (token === "TRX") {
            if (contract.type !== "TransferContract") return false;
            const value = contract.parameter?.value;
            if (!sameWallet(tronWeb.address.fromHex(value.to_address), MILTAPE_WALLET)) return false;
            sender = tronWeb.address.fromHex(value.owner_address);
            amount = Number(value.amount) / 1e6;
        } else {
            if (contract.type !== "TriggerSmartContract") return false;
            const value = contract.parameter?.value;
            if (!sameWallet(tronWeb.address.fromHex(value.contract_address), SUPPORTED_TOKENS[token].contract)) return false;
            const data = String(value.data || "");
            if (!sameWallet(tronWeb.address.fromHex("41" + data.substring(32, 72)), MILTAPE_WALLET)) return false;
            sender = tronWeb.address.fromHex(value.owner_address);
            const rawAmount = BigInt("0x" + data.substring(72, 136));
            amount = Number(rawAmount) / Math.pow(10, SUPPORTED_TOKENS[token].decimals);
        }
        if (expectedSender && !sameWallet(sender, expectedSender)) return false;
        const txInfo = await tronWeb.trx.getTransactionInfo(txId);
        if (!txInfo || txInfo.receipt?.result !== "SUCCESS") return false;
        try {
            const currentBlock = await tronWeb.trx.getCurrentBlock();
            const confirmations = currentBlock.block_header.raw_data.number - txInfo.blockNumber;
            if (confirmations < MIN_CONFIRMATIONS) { console.log(`⏳ Tx ${txId} : ${confirmations}/${MIN_CONFIRMATIONS}`); return false; }
        } catch (e) { console.warn("⚠️ Confirmations non vérifiées :", e?.message); }
        return Math.abs(amount - Number(expectedAmount)) < 0.0000001;
    } catch (e) { return false; }
}

async function getNextSaturday() {
    const now = new Date(); const day = now.getDay(); const diff = (6 - day + 7) % 7; const next = new Date(now);
    next.setDate(now.getDate() + diff); next.setHours(0, 0, 0, 0); if (day === 6 && now.getHours() >= 0) next.setDate(next.getDate() + 7); return next.getTime();
}

async function emitJackpotUpdate() {
    try {
        const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        let jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot) jackpot = await Jackpot.create({ weekStart, weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), accumulatedFund: 0, drawn: false });
        io.emit("jackpot:update", { prize: jackpot ? jackpot.accumulatedFund : 0, nextDraw: await getNextSaturday() });
    } catch (error) { console.error("❌ jackpot :", error?.message || error); }
}

async function getIncomingTrxTransactions(address, minTimestamp = null) {
    try {
        let url = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=100&order_by=block_timestamp,desc`;
        if (minTimestamp) url += `&min_timestamp=${minTimestamp}`;
        const res = await fetchWithTimeout(url, { headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} });
        if (!res.ok) return [];
        return (await res.json()).data || [];
    } catch (error) { return []; }
}

async function getIncomingTrc20Transactions(address, minTimestamp = null) {
    try {
        let url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=100&order_by=block_timestamp,desc`;
        if (minTimestamp) url += `&min_timestamp=${minTimestamp}`;
        const res = await fetchWithTimeout(url, { headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} });
        if (!res.ok) return [];
        return (await res.json()).data || [];
    } catch (error) { return []; }
}

async function detectSuspiciousSource(senderAddress) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Payment.find({ from: senderAddress, createdAt: { $gte: since } }).select("gameId").lean();
    const uniqueGameIds = new Set(recent.map(p => p.gameId));
    if (uniqueGameIds.size >= SUSPICIOUS_SOURCE_THRESHOLD) {
        await alertAdmins(`🚨 [Anti-fraude] Wallet ${senderAddress} a payé pour ${uniqueGameIds.size} manches en 24h.`);
        return true;
    }
    return false;
}

async function checkPendingPayments() {
    try {
        const recentGames = await GameState.find().sort({ updatedAt: -1 }).limit(3).select("gameId").lean();
        const recentGameIds = recentGames.map(g => g.gameId);
        const unpaidPlayers = await Player.find({
            gameId: { $in: recentGameIds }, paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null }, depositExpiresAt: { $gt: new Date() }
        });
        if (unpaidPlayers.length === 0) return;
        const oldestExpiry = unpaidPlayers.reduce((min, p) => { const t = p.depositExpiresAt ? p.depositExpiresAt.getTime() : Date.now(); return t < min ? t : min; }, Date.now());
        const minTimestamp = oldestExpiry - (5 * 60 * 1000);
        const allTransactions = [...(await getIncomingTrxTransactions(MILTAPE_WALLET, minTimestamp)), ...(await getIncomingTrc20Transactions(MILTAPE_WALLET, minTimestamp))];

        for (const tx of allTransactions) {
            const txId = tx.transaction_id || tx.txID;
            if (!txId) continue;
            let token = null, amount = 0, senderAddress = null;
            if (tx.token_info) {
                token = String(tx.token_info.symbol || "").toUpperCase();
                amount = Number(tx.value) / Math.pow(10, Number(tx.token_info.decimals || 6));
                senderAddress = tx.owner_address || tx.from;
            } else if (tx.raw_data?.contract?.[0]) {
                if (tx.raw_data.contract[0].type !== "TransferContract") continue;
                const value = tx.raw_data.contract[0].parameter?.value;
                if (!value) continue;
                if (!sameWallet(tronWeb.address.fromHex(value.to_address), MILTAPE_WALLET)) continue;
                token = "TRX"; amount = Number(value.amount) / 1e6;
                senderAddress = tronWeb.address.fromHex(value.owner_address);
            }
            if (!SUPPORTED_TOKENS[token]) continue;

            const matchingPlayer = unpaidPlayers.find(p =>
                p.token === token && sameWallet(senderAddress, p.wallet) &&
                Math.abs(amount - Number(p.depositAmount)) < 0.0000001 &&
                !p.paymentTxId?.startsWith('DEMO_')
            );
            if (!matchingPlayer) {
                try {
                    await UnmatchedPayment.create({ txId, from: senderAddress, to: MILTAPE_WALLET, amount, token, reason: 'no_player_found' });
                } catch (e) { if (e.code !== 11000) console.error(e); }
                continue;
            }

            if (await detectSuspiciousSource(senderAddress)) {
                try {
                    await UnmatchedPayment.create({ txId, from: senderAddress, to: MILTAPE_WALLET, amount, token, reason: 'suspicious_source', suspectedPlayerName: matchingPlayer.name });
                } catch (e) { if (e.code !== 11000) console.error(e); }
                continue;
            }

            try {
                await Payment.create({ txId, from: senderAddress, to: MILTAPE_WALLET, amount, verified: true, gameId: matchingPlayer.gameId, token });
            } catch (err) {
                if (err.code === 11000) { console.log(`ℹ️ [Anti-rejeu] ${txId} déjà traité`); continue; }
                throw err;
            }

            const updated = await Player.findOneAndUpdate(
                { _id: matchingPlayer._id, paid: false },
                { $set: { paid: true, paymentTxId: txId, depositAmount: null, depositExpiresAt: null } },
                { new: true }
            );
            if (!updated) { console.warn(`⚠️ [Race] ${matchingPlayer.name} déjà crédité`); continue; }

            const isLate = matchingPlayer.gameId !== game.id;
            if (!isLate) await payReferralCommission(matchingPlayer, matchingPlayer.bet, token);

            io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name, token, late: isLate });
            io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`, createdAt: new Date() });

            if (!isLate) {
                const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                const jackpot = await Jackpot.findOne({ weekStart });
                if (jackpot) { jackpot.accumulatedFund += (matchingPlayer.bet * JACKPOT_PERCENT); await jackpot.save(); }
            }
        }
    } catch (error) { console.error("❌ checkPendingPayments :", error?.message || error); }
}

async function distributeWeeklyJackpot() {
    try {
        const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot || jackpot.drawn || jackpot.accumulatedFund <= 0) return;
        const winner = await Player.findOne({}).sort({ weeklyTaps: -1 }).limit(1).select("name wallet weeklyTaps");
        if (!winner || winner.weeklyTaps === 0) return;
        jackpot.winner = winner._id; jackpot.drawn = true; await jackpot.save();
        const txId = await sendPrizeToWinner({ wallet: winner.wallet, gain: jackpot.accumulatedFund, token: "USDT", playerName: winner.name });
        io.emit("jackpot:winner", { winner: winner.name, amount: jackpot.accumulatedFund, taps: winner.weeklyTaps, txId: txId || "pending" });
        await Player.updateMany({}, { $set: { weeklyTaps: 0 } });
    } catch (error) { console.error("❌ distributeJackpot :", error?.message || error); }
}

cron.schedule('0 0 * * 6', () => { distributeWeeklyJackpot().catch(err => console.error(err)); });

// ============ SOCKET.IO ============
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log(`🟢 Connexion Socket : ${socket.id}`);
    broadcastOnlineCount();
    const clientIp = socket.data.clientIp;
    if (clientIp) { if (!socketsByIp.has(clientIp)) socketsByIp.set(clientIp, new Set()); socketsByIp.get(clientIp).add(socket.id); }
    issuePowChallenge(socket);

    socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
    socket.emit("jackpot:update", { prize: 0, nextDraw: await getNextSaturday() });
    if (game.status === "preparing" && game.preparationEndsAt) socket.emit("game:preparing", { gameId: game.id, preparationEndsAt: game.preparationEndsAt, duration: PREPARATION_DURATION_SECONDS });
    if (game.status === "running" && game.endsAt) socket.emit("game:started", { gameId: game.id, startsAt: game.startedAt, endsAt: game.endsAt, duration: GAME_DURATION_SECONDS, remainingSeconds: getRemainingSeconds() });

    socket.on("timer:request", () => socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt }));

    socket.on("player:restore", async (data) => {
        try {
            const token = socket.data.cookieSessionToken;
            if (!token) return socket.emit("player:restored", { success: false });
            const player = await Player.findOne({ sessionToken: token }).select("-sessionToken");
            if (!player) return socket.emit("player:restored", { success: false });
            socket.data.playerId = player._id.toString();
            socket.data.playerName = player.name;
            socket.data.sessionToken = token;
            if (player.gameId !== game.id) return socket.emit("player:restored", { success: false, staleRound: true, player: { name: player.name, wallet: player.wallet } });
            socket.emit("player:restored", { success: true, player });
        } catch (e) { socket.emit("player:restored", { success: false }); }
    });

    socket.on("referral:stats", async () => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId) return socket.emit("referral:stats", { success: false });
            const player = await Player.findById(playerId).select("referralCode referralEarnings referralCount");
            if (!player) return socket.emit("referral:stats", { success: false });
            socket.emit("referral:stats", { success: true, referralCode: player.referralCode, referralEarnings: player.referralEarnings, referralCount: player.referralCount });
        } catch (e) { socket.emit("referral:stats", { success: false }); }
    });

    socket.on("player:join", async (data) => {
        try {
            let parsed;
            try {
                parsed = PlayerJoinSchema.parse({
                    name: String(data?.name || "").trim(),
                    wallet: String(data?.wallet || "").trim(),
                    bet: Number(data?.bet),
                    token: String(data?.token || "USDT").trim().toUpperCase(),
                    deviceId: data?.deviceId ? String(data.deviceId).trim() : undefined,
                    referralCode: data?.referralCode ? String(data.referralCode).trim().toUpperCase() : undefined,
                    powNonce: String(data?.powNonce || "")
                });
            } catch (err) {
                return socket.emit("error", { message: "Données invalides : " + (err.errors?.[0]?.message || err.message) });
            }

            const { name, wallet, bet, token } = parsed;
            const referralCodeInput = parsed.referralCode && /^[A-Z0-9]+$/.test(parsed.referralCode) ? parsed.referralCode : "";
            const deviceId = parsed.deviceId || "";

            if (!socket.data.powChallenge || socket.data.powUsed) return socket.emit("error", { message: "Anti-bot manquant." });
            const powHash = crypto.createHash('sha256').update(socket.data.powChallenge + parsed.powNonce).digest('hex');
            if (!powHash.startsWith('0'.repeat(POW_DIFFICULTY))) return socket.emit("error", { message: "Anti-bot invalide." });
            socket.data.powUsed = true;
            issuePowChallenge(socket);

            if (bannedWallets.has(wallet)) return socket.emit("error", { message: "Ce wallet est banni." });
            if (!game.id || game.status === "waiting" || game.status === "finished") await startPreparationPhase();
            if (!isValidTronAddress(wallet) || !SUPPORTED_TOKENS[token]) return socket.emit("error", { message: "Données invalides." });

            const existingPlayer = await Player.findOne({ wallet });
            const isSameActiveRound = existingPlayer && existingPlayer.gameId === game.id && (game.status === "preparing" || game.status === "running");

            if (isSameActiveRound && existingPlayer.sessionToken) {
                if (!socket.data.cookieSessionToken || socket.data.cookieSessionToken !== existingPlayer.sessionToken) return socket.emit("error", { message: "Wallet déjà utilisé." });
                socket.data.playerId = existingPlayer._id.toString();
                socket.data.playerName = existingPlayer.name;
                socket.data.sessionToken = existingPlayer.sessionToken;
                existingPlayer.name = name; existingPlayer.gameId = game.id; existingPlayer.bet = bet; existingPlayer.token = token;
                existingPlayer.paid = false; existingPlayer.paymentTxId = undefined;
                existingPlayer.depositAmount = bet; existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000); existingPlayer.depositExpiredAt = null;
                if (!existingPlayer.referralCode) existingPlayer.referralCode = await generateUniqueReferralCode();
                await existingPlayer.save();
                socket.emit("player:joined", { success: true, player: existingPlayer, game: getGameStateObject() });
                socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
                await broadcastGameState();
                return;
            }

            const sessionToken = generateSessionToken();
            if (existingPlayer) {
                existingPlayer.name = name; existingPlayer.gameId = game.id; existingPlayer.bet = bet; existingPlayer.token = token;
                existingPlayer.paid = false; existingPlayer.paymentTxId = undefined;
                existingPlayer.depositAmount = bet; existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000); existingPlayer.depositExpiredAt = null;
                existingPlayer.sessionToken = sessionToken;
                if (!existingPlayer.referralCode) existingPlayer.referralCode = await generateUniqueReferralCode();
                await existingPlayer.save();
                socket.data.playerId = existingPlayer._id.toString();
                socket.data.playerName = existingPlayer.name;
                socket.data.sessionToken = sessionToken;
                socket.emit("player:joined", { success: true, player: existingPlayer, game: getGameStateObject() });
            } else {
                const ownReferralCode = await generateUniqueReferralCode();
                let referredByCode = null;
                if (referralCodeInput) { const referrer = await Player.findOne({ referralCode: referralCodeInput }); if (referrer) referredByCode = referralCodeInput; }
                const player = await Player.create({
                    gameId: game.id, name, wallet, deviceId, taps: 0, weeklyTaps: 0, bet, paid: false, token,
                    depositAmount: bet, depositExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
                    sessionToken, referralCode: ownReferralCode, referredByCode
                });
                socket.data.playerId = player._id.toString();
                socket.data.playerName = player.name;
                socket.data.sessionToken = sessionToken;
                socket.emit("player:joined", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token, depositAmount: player.depositAmount, sessionToken, referralCode: player.referralCode, referralEarnings: player.referralEarnings, referralCount: player.referralCount }, game: getGameStateObject() });
            }
            socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
            await broadcastGameState();
        } catch (error) { console.error("❌ player:join :", error?.message || error); socket.emit("error", { message: "Impossible de rejoindre." }); }
    });

    socket.on("player:tap", async () => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId || game.status !== "running") return;
            const now = Date.now();
            const lastTap = lastTapTimestamps.get(playerId) || 0;
            if (now - lastTap < MIN_TAP_INTERVAL_MS) return;
            lastTapTimestamps.set(playerId, now);
            const result = await Player.findOneAndUpdate({ _id: playerId, gameId: game.id, paid: true }, { $inc: { taps: 1, weeklyTaps: 1 } }, { new: true }).select("name taps");
            if (!result) return;
            socket.emit("player:score", { taps: result.taps });
            await emitLeaderboard();
        } catch (error) { console.error("❌ player:tap :", error?.message || error); }
    });

    socket.on("chat:send", async (data) => {
        try {
            const now = Date.now();
            const lastChat = lastChatTimestamps.get(socket.id) || 0;
            if (now - lastChat < MIN_CHAT_INTERVAL_MS) return;
            lastChatTimestamps.set(socket.id, now);
            let parsed;
            try { parsed = ChatSendSchema.parse({ message: String(data?.message || "") }); }
            catch (err) { return; }
            const name = socket.data.playerName || "Anonyme";
            const message = sanitizeText(parsed.message, 300).replace(/[<>]/g, "");
            if (!message) return;
            const msg = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: msg._id, name, message, createdAt: msg.createdAt });
        } catch (error) { console.error("❌ chat:send :", error?.message || error); }
    });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        console.log(`🔴 Déconnexion : ${socket.id}`);
        broadcastOnlineCount();
        lastDuelTapTimestamps.delete(socket.id);
        lastChatTimestamps.delete(socket.id);
        const ip = socket.data.clientIp;
        const ipSet = socketsByIp.get(ip);
        if (ipSet) { ipSet.delete(socket.id); if (ipSet.size === 0) socketsByIp.delete(ip); }

        for (const bet in duelPools) {
            duelPools[bet] = duelPools[bet].filter(entry => entry.socketId !== socket.id);
            if (duelPools[bet].length === 0) delete duelPools[bet];
        }

        for (const matchId in duelMatches) {
            const match = duelMatches[matchId];
            if (!match || match.started) continue;
            if (match.entry1.socketId === socket.id || match.entry2.socketId === socket.id) {
                clearTimeout(match.timeout);
                const otherSocketId = match.entry1.socketId === socket.id ? match.entry2.socketId : match.entry1.socketId;
                io.to(otherSocketId).emit("duel:cancelled", { message: "Adversaire déconnecté." });
                delete pendingDuelPayments[match.entry1.socketId];
                delete pendingDuelPayments[match.entry2.socketId];
                delete duelMatches[matchId];
            }
        }
        delete pendingDuelPayments[socket.id];

        for (const duelId in activeDuels) {
            const duel = activeDuels[duelId];
            if (duel.socket1 === socket.id || duel.socket2 === socket.id) {
                const opponentSocketId = duel.socket1 === socket.id ? duel.socket2 : duel.socket1;
                const disconnectedPlayerId = duel.socket1 === socket.id ? duel.player1Id : duel.player2Id;
                console.warn(`⚠️ [Duel] Joueur ${disconnectedPlayerId} déconnecté. Grâce 15s.`);
                duel.disconnectedPlayerId = disconnectedPlayerId;
                duel.disconnectedAt = Date.now();

                const capturedDuelId = duelId;
                const capturedWinnerId = duel.socket1 === socket.id ? duel.player2Id : duel.player1Id;
                const capturedOpponentSocketId = opponentSocketId;

                setTimeout(async () => {
                    if (!activeDuels[capturedDuelId]) return;
                    if (activeDuels[capturedDuelId].disconnectedPlayerId !== disconnectedPlayerId) return;
                    console.warn(`🚨 [Duel] Forfait confirmé pour ${disconnectedPlayerId}`);
                    const winner = await Player.findById(capturedWinnerId);
                    if (winner) {
                        const gain = duel.bet * 2 - (duel.bet * 2 * DUEL_COMMISSION_PERCENT);
                        const txId = await sendPrizeToWinner({ wallet: winner.wallet, gain, token: "USDT", playerName: winner.name });
                        io.to(capturedOpponentSocketId).emit("duel:finished", { winnerName: winner.name, myTaps: 0, opponentTaps: 0, prize: gain, txId, reason: "opponent_disconnected" });
                    }
                    await Player.updateMany({ _id: { $in: [duel.player1Id, duel.player2Id] } }, { $set: { duelPaid: false, duelPaymentTxId: null } });
                    delete activeDuels[capturedDuelId];
                }, DUEL_FORFEIT_GRACE_MS);
            }
        }
    });
});

// ============ DUEL ============
const ALLOWED_BETS = [0.50, 1, 2, 4, 8, 16, 32, 64, 128];

async function isDuelTxUsed(txId) {
    const existingPayment = await Payment.findOne({ txId });
    if (existingPayment) return true;
    const existingDuel = await DuelEntry.findOne({ paymentTxId: txId });
    return !!existingDuel;
}

async function tryStartDuel(matchId) {
    const match = duelMatches[matchId];
    if (!match || match.started) return;
    const state1 = pendingDuelPayments[match.entry1.socketId];
    const state2 = pendingDuelPayments[match.entry2.socketId];
    if (!state1?.duelPaid || !state2?.duelPaid) return;
    match.started = true;
    clearTimeout(match.timeout);
    const { entry1, entry2, bet } = match;
    const player1 = await Player.findById(entry1.playerId);
    const player2 = await Player.findById(entry2.playerId);
    if (!player1 || !player2) { delete duelMatches[matchId]; return; }
    const winnerPrize = bet * 2 - (bet * 2 * DUEL_COMMISSION_PERCENT);
    io.to(entry1.socketId).emit("duel:started", { opponentName: player2.name, bet, prize: winnerPrize });
    io.to(entry2.socketId).emit("duel:started", { opponentName: player1.name, bet, prize: winnerPrize });
    const duelId = entry1.socketId;
    activeDuels[duelId] = { socket1: entry1.socketId, socket2: entry2.socketId, player1Id: entry1.playerId, player2Id: entry2.playerId, bet, winnerPrize, endsAt: Date.now() + 60000, taps1: 0, taps2: 0 };
    delete pendingDuelPayments[entry1.socketId];
    delete pendingDuelPayments[entry2.socketId];
    delete duelMatches[matchId];

    setTimeout(async () => {
        if (!activeDuels[duelId]) return;
        const duel = activeDuels[duelId];
        const winnerId = duel.taps1 >= duel.taps2 ? duel.player1Id : duel.player2Id;
        const loserId = winnerId === duel.player1Id ? duel.player2Id : duel.player1Id;
        const winner = await Player.findById(winnerId);
        const loser = await Player.findById(loserId);
        if (winner) {
            const txId = await sendPrizeToWinner({ wallet: winner.wallet, gain: duel.winnerPrize, token: "USDT", playerName: winner.name });
            await Payment.create({ txId, from: MILTAPE_WALLET, to: winner.wallet, amount: duel.winnerPrize, verified: true, gameId: "DUEL", token: "USDT" });
            if (loser) await DuelEntry.create({ playerId: loser._id, bet: duel.bet, token: "USDT", paid: false });
            io.to(duel.socket1).emit("duel:finished", { winnerName: winner.name, myTaps: duel.taps1, opponentTaps: duel.taps2, prize: duel.winnerPrize, txId });
            io.to(duel.socket2).emit("duel:finished", { winnerName: winner.name, myTaps: duel.taps2, opponentTaps: duel.taps1, prize: 0, txId: null });
        }
        await Player.updateMany({ _id: { $in: [duel.player1Id, duel.player2Id] } }, { $set: { duelPaid: false, duelPaymentTxId: null } });
        delete activeDuels[duelId];
    }, 60000);
}

io.on("connection", (socket) => {
    socket.on("duel:join", async (data) => {
        let parsed;
        try { parsed = DuelJoinSchema.parse({ bet: Number(data?.bet) }); } catch (err) { return socket.emit("error", { message: "Mise invalide." }); }
        const bet = parsed.bet;
        if (!ALLOWED_BETS.includes(bet)) return socket.emit("error", { message: "Mise non autorisée." });
        const playerId = socket.data.playerId;
        if (!playerId) return socket.emit("error", { message: "Rejoins d'abord le jeu principal." });
        if (!duelPools[bet]) duelPools[bet] = [];
        if (duelPools[bet].some(entry => entry.socketId === socket.id)) return;
        duelPools[bet].push({ socketId: socket.id, playerId });
        socket.emit("duel:queue", { message: "En attente d'un adversaire à " + bet + " USDT..." });
        if (duelPools[bet].length >= 2) {
            const entry1 = duelPools[bet].shift();
            const entry2 = duelPools[bet].shift();
            const player1 = await Player.findById(entry1.playerId);
            const player2 = await Player.findById(entry2.playerId);
            if (!player1 || !player2) return;
            const matchId = entry1.socketId + '_' + entry2.socketId;
            pendingDuelPayments[entry1.socketId] = { bet, playerId: entry1.playerId, matchId, duelPaid: false };
            pendingDuelPayments[entry2.socketId] = { bet, playerId: entry2.playerId, matchId, duelPaid: false };
            io.to(entry1.socketId).emit("duel:need_payment", { amount: bet, wallet: MILTAPE_WALLET });
            io.to(entry2.socketId).emit("duel:need_payment", { amount: bet, wallet: MILTAPE_WALLET });

            const paymentTimeout = setTimeout(() => {
                const match = duelMatches[matchId];
                if (!match || match.started) return;
                const state1 = pendingDuelPayments[entry1.socketId];
                const state2 = pendingDuelPayments[entry2.socketId];
                io.to(entry1.socketId).emit("duel:cancelled", { message: state1?.duelPaid ? "Adversaire n'a pas payé." : "Tu n'as pas payé à temps." });
                io.to(entry2.socketId).emit("duel:cancelled", { message: state2?.duelPaid ? "Adversaire n'a pas payé." : "Tu n'as pas payé à temps." });
                if (state1?.duelPaid && !state2?.duelPaid) { if (!duelPools[bet]) duelPools[bet] = []; duelPools[bet].push({ socketId: entry1.socketId, playerId: entry1.playerId }); }
                else if (state2?.duelPaid && !state1?.duelPaid) { if (!duelPools[bet]) duelPools[bet] = []; duelPools[bet].push({ socketId: entry2.socketId, playerId: entry2.playerId }); }
                delete pendingDuelPayments[entry1.socketId];
                delete pendingDuelPayments[entry2.socketId];
                delete duelMatches[matchId];
            }, DUEL_PAYMENT_TIMEOUT_MS);
            duelMatches[matchId] = { entry1, entry2, bet, timeout: paymentTimeout, started: false };
        }
    });

    socket.on("duel:payment_verified", async (data) => {
        const { txId } = data;
        const playerId = socket.data.playerId;
        if (!playerId) return socket.emit("duel:payment_error", { message: "Non autorisé." });
        if (!txId) return socket.emit("duel:payment_error", { message: "Transaction manquante." });
        const pending = pendingDuelPayments[socket.id];
        if (!pending) return socket.emit("duel:payment_error", { message: "Aucun duel en attente." });
        const betAmount = pending.bet;
        if (await isDuelTxUsed(txId)) return socket.emit("duel:payment_error", { message: "Transaction déjà utilisée." });
        const player = await Player.findById(playerId);
        if (!player) return socket.emit("duel:payment_error", { message: "Joueur introuvable." });
        const isValid = await verifyOnChain(txId, betAmount, "USDT", player.wallet);
        if (isValid) {
            player.duelPaid = true; player.duelPaymentTxId = txId; await player.save();
            pending.duelPaid = true; pending.duelPaymentTxId = txId;
            pendingDuelPayments[socket.id] = pending;
            await Payment.create({ txId, from: player.wallet, to: MILTAPE_WALLET, amount: betAmount, verified: true, gameId: "DUEL", token: "USDT" });
            await payReferralCommission(player, betAmount, "USDT");
            socket.emit("duel:payment_success");
            if (pending.matchId) await tryStartDuel(pending.matchId);
        } else {
            socket.emit("duel:payment_error", { message: "Transaction invalide." });
        }
    });

    socket.on("duel:tap", () => {
        const now = Date.now();
        const lastTap = lastDuelTapTimestamps.get(socket.id) || 0;
        if (now - lastTap < MIN_TAP_INTERVAL_MS) return;
        lastDuelTapTimestamps.set(socket.id, now);
        for (const duelId in activeDuels) {
            const duel = activeDuels[duelId];
            if (socket.id === duel.socket1) {
                duel.taps1++;
                io.to(duel.socket1).emit("duel:score", { myTaps: duel.taps1, opponentTaps: duel.taps2 });
                io.to(duel.socket2).emit("duel:score", { myTaps: duel.taps2, opponentTaps: duel.taps1 });
                break;
            } else if (socket.id === duel.socket2) {
                duel.taps2++;
                io.to(duel.socket1).emit("duel:score", { myTaps: duel.taps1, opponentTaps: duel.taps2 });
                io.to(duel.socket2).emit("duel:score", { myTaps: duel.taps2, opponentTaps: duel.taps1 });
                break;
            }
        }
    });
});

// ============ INTERVALS ============
setInterval(() => { checkPendingPayments().catch(err => console.error("Erreur checkPendingPayments :", err)); }, 7000);
setInterval(() => { if (game.status === "preparing" || game.status === "running") broadcastTimer(); }, 1000);
setInterval(() => { emitJackpotUpdate().catch(err => console.error(err)); }, 60 * 1000);

setInterval(async () => {
    try {
        const now = new Date();
        const expired = await Player.find({ paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null }, depositExpiresAt: { $lt: now }, depositExpiredAt: null });
        if (expired.length === 0) return;
        for (const p of expired) {
            console.warn(`⌛ [Dépôt expiré] ${p.name}`);
            p.depositExpiredAt = now; p.depositAmount = null; await p.save();
            for (const [, s] of io.sockets.sockets) {
                if (s.data.playerId === p._id.toString()) s.emit("deposit:expired", { message: "Délai de paiement dépassé." });
            }
        }
    } catch (error) { console.error("❌ cleanup expirés :", error?.message || error); }
}, 60 * 1000);

cron.schedule('*/30 * * * *', async () => {
    try {
        const stuck = await History.find({ paidOut: false, payoutFailed: true, payoutAttempts: { $lt: 6 } }).limit(20).lean();
        if (stuck.length === 0) return;
        for (const h of stuck) await retryFailedPayout(h._id, 1, 3);
    } catch (error) { console.error("❌ cron retry :", error?.message); }
});

// ============ REST API ============
app.post("/api/demo/verify", async (req, res) => {
    try {
        if (!DEMO_MODE_ENABLED_ON_SERVER) return res.status(403).json({ success: false, message: "Mode démo désactivé." });
        const { playerId } = req.body || {};
        if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." });
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
        if (player.gameId !== game.id) return res.status(409).json({ success: false, message: "Manche changée." });
        player.paid = true;
        player.paymentTxId = "DEMO_" + Date.now().toString(36).toUpperCase();
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();
        io.emit("payment:verified", { verified: true, wallet: player.wallet, amount: player.bet, playerName: player.name, token: player.token });
        await broadcastGameState();
        res.json({ success: true });
    } catch (error) { console.error("❌ demo/verify :", error?.message); res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/session/store", (req, res) => {
    try {
        const sessionToken = String(req.body?.sessionToken || "").trim();
        if (!sessionToken || sessionToken.length < 20) return res.status(400).json({ success: false, message: "Token invalide." });
        res.cookie('miltape_session', sessionToken, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/session/clear", (req, res) => {
    res.clearCookie('miltape_session', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.json({ success: true });
});

app.get("/api/wallet", (req, res) => res.json({ success: true, wallet: MILTAPE_WALLET }));
app.get("/api/game", (req, res) => res.json({ success: true, game: getGameStateObject() }));
app.get("/api/status", (req, res) => res.json({ success: true, status: "online", gameStatus: game.status, gameId: game.id, remainingSeconds: getRemainingSeconds(), online: onlineSockets.size }));
app.get("/health", (req, res) => res.json({ success: true, status: "ok" }));

// ============ ROUTES JOUEUR ============
function requirePlayer(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['miltape_session'] || req.query.token;
    if (!cookies['miltape_session'] && req.query.token && req.method !== "GET") {
        return res.status(401).json({ success: false, message: "Token en query string interdit pour les mutations." });
    }
    if (!token) return res.status(401).json({ success: false, message: "Non connecté." });
    req.sessionToken = token;
    next();
}

app.get("/api/player/history", requirePlayer, async (req, res) => {
    try {
        const player = await Player.findOne({ sessionToken: req.sessionToken }).select("_id name");
        if (!player) return res.status(401).json({ success: false, message: "Session expirée." });
        const history = await History.find({ playerId: player._id }).sort({ createdAt: -1 }).limit(10).select("gameId rank bet gain taps token paidOut payoutTxId createdAt").lean();
        res.json({ success: true, count: history.length, history });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/player/earnings", requirePlayer, async (req, res) => {
    try {
        const player = await Player.findOne({ sessionToken: req.sessionToken }).select("_id name wallet referralEarnings");
        if (!player) return res.status(401).json({ success: false, message: "Session expirée." });
        const agg = await History.aggregate([
            { $match: { playerId: player._id } },
            { $group: { _id: null, totalGain: { $sum: "$gain" }, totalBet: { $sum: "$bet" }, gamesPlayed: { $sum: 1 }, wins: { $sum: { $cond: [{ $gt: ["$rank", 0] }, 1, 0] } }, paidOut: { $sum: { $cond: ["$paidOut", "$gain", 0] } }, pending: { $sum: { $cond: ["$paidOut", 0, "$gain"] } } } }
        ]);
        const stats = agg.length > 0 ? agg[0] : { totalGain: 0, totalBet: 0, gamesPlayed: 0, wins: 0, paidOut: 0, pending: 0 };
        res.json({ success: true, name: player.name, wallet: player.wallet, referralEarnings: player.referralEarnings || 0, totalGain: Number(stats.totalGain.toFixed(6)), totalBet: Number(stats.totalBet.toFixed(6)), netProfit: Number((stats.totalGain - stats.totalBet).toFixed(6)), gamesPlayed: stats.gamesPlayed, wins: stats.wins, paidOut: Number(stats.paidOut.toFixed(6)), pending: Number(stats.pending.toFixed(6)) });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/player/rankings", requirePlayer, async (req, res) => {
    try {
        const player = await Player.findOne({ sessionToken: req.sessionToken }).select("_id name weeklyTaps taps");
        if (!player) return res.status(401).json({ success: false, message: "Session expirée." });
        const currentRank = await Player.countDocuments({ gameId: game.id, taps: { $gt: player.taps || 0 } });
        const bestRank = await History.findOne({ playerId: player._id }).sort({ rank: 1 }).select("rank gameId gain createdAt").lean();
        const wins = await History.countDocuments({ playerId: player._id, rank: { $lte: 5 } });
        res.json({ success: true, name: player.name, currentTaps: player.taps || 0, currentRank: currentRank + 1, weeklyTaps: player.weeklyTaps || 0, totalWins: wins, bestRank: bestRank ? { rank: bestRank.rank, gameId: bestRank.gameId, gain: bestRank.gain, date: bestRank.createdAt } : null });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/player/referral", requirePlayer, async (req, res) => {
    try {
        const player = await Player.findOne({ sessionToken: req.sessionToken }).select("_id name referralCode referralEarnings referralCount");
        if (!player) return res.status(401).json({ success: false, message: "Session expirée." });
        const filleuls = await Player.find({ referredByCode: player.referralCode }).select("name createdAt").sort({ createdAt: -1 }).limit(20).lean();
        res.json({ success: true, referralCode: player.referralCode, referralEarnings: player.referralEarnings || 0, referralCount: player.referralCount || 0, filleuls: filleuls.map(f => ({ name: f.name, date: f.createdAt })) });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

// ============ ROUTES ADMIN ============
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de tentatives admin." } });

async function requireAdmin(req, res, next) {
    try {
        const simpleProvided = req.headers['x-admin-password'] || req.query.adminPassword || (req.body && req.body.adminPassword);
        if (simpleProvided && ADMIN_PASSWORD && crypto.timingSafeEqual(Buffer.from(String(simpleProvided).padEnd(64, '0')), Buffer.from(String(ADMIN_PASSWORD).padEnd(64, '0')))) {
            AdminAuditLog.create({ route: req.originalUrl, method: req.method, ip: req.ip, payload: { auth: "legacy_password" } }).catch(() => {});
            return next();
        }

        const adminCount = await AdminUser.countDocuments();
        if (adminCount === 0) {
            return res.status(401).json({ success: false, message: "Non autorisé (aucun admin configuré, utilise x-admin-password)." });
        }

        let username, password, totpCode;
        if (req.headers['x-admin-auth']) {
            try {
                const parsed = JSON.parse(req.headers['x-admin-auth']);
                username = parsed.username; password = parsed.password; totpCode = parsed.totpCode;
            } catch (e) { return res.status(401).json({ success: false, message: "Header auth invalide." }); }
        } else if (req.body && req.body.adminUsername && req.body.adminPassword && req.body.adminTotp) {
            username = req.body.adminUsername; password = req.body.adminPassword; totpCode = req.body.adminTotp;
        } else if (req.query.adminUsername && req.query.adminPassword && req.query.adminTotp) {
            username = req.query.adminUsername; password = req.query.adminPassword; totpCode = req.query.adminTotp;
        } else {
            return res.status(401).json({ success: false, message: "Auth admin requise." });
        }

        const bcrypt = require("bcrypt");
        const speakeasy = require("speakeasy");

        const user = await AdminUser.findOne({ username });
        if (!user) return res.status(401).json({ success: false, message: "Non autorisé." });
        if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ success: false, message: "Compte verrouillé." });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            user.failedAttempts += 1;
            if (user.failedAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            await user.save();
            return res.status(401).json({ success: false, message: "Non autorisé." });
        }

        const totpValid = speakeasy.totp.verify({ secret: user.totpSecret, encoding: "base32", token: totpCode, window: 1 });
        if (!totpValid) {
            user.failedAttempts += 1;
            await user.save();
            return res.status(401).json({ success: false, message: "Code 2FA invalide." });
        }

        user.failedAttempts = 0; user.lastLoginAt = new Date(); await user.save();
        req.adminUser = user;

        const rawPayload = req.method === 'GET' ? req.query : req.body;
        const payload = { ...rawPayload };
        delete payload.adminPassword; delete payload.adminTotp;
        AdminAuditLog.create({ route: req.originalUrl, method: req.method, ip: req.ip, payload }).catch(err => console.error("❌ Log admin :", err?.message));
        next();
    } catch (error) {
        console.error("❌ requireAdmin :", error?.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
}

app.post("/api/admin/setup", async (req, res) => {
    try {
        const count = await AdminUser.countDocuments();
        if (count > 0) return res.status(409).json({ success: false, message: "Admin déjà configuré." });

        const bcrypt = require("bcrypt");
        const speakeasy = require("speakeasy");
        const qrcode = require("qrcode-terminal");

        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ success: false, message: "username et password requis." });
        if (username.length < 3 || password.length < 8) return res.status(400).json({ success: false, message: "username (3+) et password (8+) requis." });

        const passwordHash = await bcrypt.hash(password, 12);
        const secret = speakeasy.generateSecret({ name: `Miltape (${username})` });

        await AdminUser.create({ username, passwordHash, totpSecret: secret.base32, role: "super_admin" });

        console.log("🔐 Nouvel admin créé :", username);
        console.log("🔑 Scanne ce QR avec Google Authenticator :");
        qrcode.generate(secret.otpauth_url, { small: true });
        console.log("🔑 Secret :", secret.base32);

        res.json({ success: true, message: "Admin créé. Voir les logs Railway pour le QR code.", totpSecret: secret.base32, otpauth_url: secret.otpauth_url });
    } catch (error) {
        console.error("❌ /api/admin/setup :", error?.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/admin/status", adminLimiter, requireAdmin, (req, res) => {
    res.json({ success: true, game: getGameStateObject(), online: onlineSockets.size, bannedCount: bannedWallets.size, dailyOutflow: getTodayOutflow(), dailyOutflowCap: DAILY_OUTFLOW_CAP });
});

app.get("/api/admin/players", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const players = await Player.find({ gameId: game.id }).select("name wallet taps bet paid token depositAmount createdAt").sort({ taps: -1 }).lean();
        res.json({ success: true, players });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/pending-payments", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const pending = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null } }).select("name wallet bet token depositAmount depositExpiresAt").lean();
        res.json({ success: true, pending });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/force-finish", adminLimiter, requireAdmin, async (req, res) => {
    try {
        if (game.status !== "running") return res.status(409).json({ success: false, message: "Aucune partie en cours." });
        await finishGame();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/force-next-round", adminLimiter, requireAdmin, async (req, res) => {
    try { await startPreparationPhase(); res.json({ success: true }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/ban", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const wallet = normalizeWallet(req.body?.wallet);
        const reason = sanitizeText(req.body?.reason, 200);
        if (!wallet) return res.status(400).json({ success: false, message: "Wallet manquant." });
        await BannedWallet.findOneAndUpdate({ wallet }, { wallet, reason }, { upsert: true });
        bannedWallets.add(wallet);
        const bannedPlayer = await Player.findOne({ wallet });
        if (bannedPlayer) {
            for (const [, s] of io.sockets.sockets) {
                if (s.data.playerId === bannedPlayer._id.toString()) { s.emit("error", { message: "Tu as été banni." }); s.disconnect(true); }
            }
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/unban", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const wallet = normalizeWallet(req.body?.wallet);
        if (!wallet) return res.status(400).json({ success: false, message: "Wallet manquant." });
        await BannedWallet.deleteOne({ wallet });
        bannedWallets.delete(wallet);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/banned", adminLimiter, requireAdmin, async (req, res) => {
    try { const banned = await BannedWallet.find({}).sort({ createdAt: -1 }).lean(); res.json({ success: true, banned }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/audit-log", adminLimiter, requireAdmin, async (req, res) => {
    try { const logs = await AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(200).lean(); res.json({ success: true, logs }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/referrals/held", adminLimiter, requireAdmin, async (req, res) => {
    try { const held = await ReferralPayout.find({ held: true, txId: null }).sort({ createdAt: -1 }).lean(); res.json({ success: true, held }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/referrals/release", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const payoutId = req.body?.payoutId;
        if (!payoutId) return res.status(400).json({ success: false, message: "payoutId manquant." });
        const payout = await ReferralPayout.findById(payoutId);
        if (!payout) return res.status(404).json({ success: false, message: "Introuvable." });
        if (payout.txId) return res.status(409).json({ success: false, message: "Déjà payée." });
        const txId = await sendPrizeToWinner({ wallet: payout.referrerWallet, gain: payout.commission, token: payout.token, playerName: payout.referrerWallet });
        if (!txId) return res.status(500).json({ success: false, message: "Échec on-chain." });
        payout.txId = txId; payout.held = false; await payout.save();
        await Player.findByIdAndUpdate(payout.referrerId, { $inc: { referralEarnings: payout.commission } });
        res.json({ success: true, txId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/payouts/failed", adminLimiter, requireAdmin, async (req, res) => {
    try { const failed = await History.find({ paidOut: false }).sort({ createdAt: -1 }).limit(200).lean(); res.json({ success: true, count: failed.length, failed }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payouts/retry", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const historyId = req.body?.historyId;
        if (!historyId) return res.status(400).json({ success: false, message: "historyId manquant." });
        const history = await History.findById(historyId);
        if (!history) return res.status(404).json({ success: false, message: "Introuvable." });
        if (history.paidOut) return res.status(409).json({ success: false, message: "Déjà payé.", txId: history.payoutTxId });
        const ok = await retryFailedPayout(historyId);
        if (!ok) return res.status(500).json({ success: false, message: "Retry échoué." });
        const updated = await History.findById(historyId).lean();
        res.json({ success: true, txId: updated.payoutTxId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/payments/unmatched", adminLimiter, requireAdmin, async (req, res) => {
    try { const unmatched = await UnmatchedPayment.find({ resolved: false }).sort({ createdAt: -1 }).limit(200).lean(); res.json({ success: true, count: unmatched.length, unmatched }); }
    catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payments/unmatched/refund", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const { unmatchedId } = req.body || {};
        if (!unmatchedId) return res.status(400).json({ success: false, message: "unmatchedId manquant." });
        const payment = await UnmatchedPayment.findById(unmatchedId);
        if (!payment) return res.status(404).json({ success: false, message: "Introuvable." });
        if (payment.resolved) return res.status(409).json({ success: false, message: "Déjà traité." });
        if (!isValidTronAddress(payment.from)) return res.status(400).json({ success: false, message: "Adresse invalide." });
        const refundTxId = await sendPrizeToWinner({ wallet: payment.from, gain: payment.amount, token: payment.token, playerName: `REFUND-${String(payment.from).substring(0, 6)}` });
        if (!refundTxId) return res.status(500).json({ success: false, message: "Échec remboursement." });
        payment.resolved = true; payment.resolvedAction = 'refunded'; payment.resolvedTxId = refundTxId; payment.resolvedAt = new Date();
        await payment.save();
        res.json({ success: true, refundTxId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payments/unmatched/ignore", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const { unmatchedId } = req.body || {};
        if (!unmatchedId) return res.status(400).json({ success: false, message: "unmatchedId manquant." });
        const payment = await UnmatchedPayment.findById(unmatchedId);
        if (!payment) return res.status(404).json({ success: false, message: "Introuvable." });
        if (payment.resolved) return res.status(409).json({ success: false, message: "Déjà traité." });
        payment.resolved = true; payment.resolvedAction = 'ignored'; payment.resolvedAt = new Date();
        await payment.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/reset-outflow-cap", adminLimiter, requireAdmin, (req, res) => {
    outflowsByDay.delete(getTodayKey());
    console.log("✅ [Admin] Plafond journalier réinitialisé.");
    res.json({ success: true });
});

app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

async function loadBannedWallets() {
    try {
        const docs = await BannedWallet.find({}).select("wallet").lean();
        docs.forEach(d => bannedWallets.add(d.wallet));
        console.log(`🚫 ${bannedWallets.size} wallet(s) banni(s) chargé(s).`);
    } catch (error) { console.error("❌ loadBannedWallets :", error?.message || error); }
}

async function startServer() {
    try {
        await connectMongoDB();
        await loadOrCreateGameState();
        await loadBannedWallets();
        server.listen(PORT, async () => {
            console.log("🚀 BACKEND ONLINE (Sécurisé)");
            console.log(`🌐 Port : ${PORT}`);
            console.log(`🎮 État initial : ${game.status}`);
            console.log(`💰 Plafond quotidien : ${DAILY_OUTFLOW_CAP} USDT`);
            console.log(`⛓️ Confirmations : ${MIN_CONFIRMATIONS} blocs`);
        });
    } catch (error) { console.error("❌ Impossible de démarrer :", error); process.exit(1); }
}
startServer();

process.on("SIGTERM", async () => {
    console.log("🛑 SIGTERM reçu. Fermeture propre...");
    if (gameTimer) clearTimeout(gameTimer);
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    try { await new Promise((resolve) => server.close(() => resolve())); await mongoose.connection.close(); process.exit(0); }
    catch (error) { console.error("❌ Erreur fermeture :", error?.message || error); process.exit(1); }
});
