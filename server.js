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

const PORT = Number(process.env.PORT) || 3000;
const GAME_DURATION_SECONDS = 10 * 60;
const PREPARATION_DURATION_SECONDS = 2 * 60;
const JACKPOT_PERCENT = 0.05;
const DUEL_COMMISSION_PERCENT = 0.10;
const DUEL_PAYMENT_TIMEOUT_MS = 60000;
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

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://cryptochaouki-droid.github.io").split(",").map(o => o.trim());

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

const MASTER_KEY = (process.env.MASTER_KEY || "").trim();
const ENCRYPTED_PRIVATE_KEY = (process.env.ENCRYPTED_PRIVATE_KEY || "").trim();
const USE_ENCRYPTED_KEY = !!(MASTER_KEY && ENCRYPTED_PRIVATE_KEY);

function decryptPrivateKey() {
    if (!USE_ENCRYPTED_KEY) return PRIVATE_KEY;
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

if (!MONGODB_URI || (!PRIVATE_KEY && !USE_ENCRYPTED_KEY) || !ADMIN_PASSWORD) {
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
    console.log("✅ Wallet Miltape :", MILTAPE_WALLET, USE_ENCRYPTED_KEY ? "(clé chiffrée)" : "(clé en clair — migration recommandée)");
} catch (error) {
    console.error("❌ Erreur initialisation TronWeb :", error?.message || error);
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

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
    if (activeForIp && activeForIp.size >= MAX_SOCKETS_PER_IP) {
        return next(new Error("Trop de connexions simultanées depuis cette adresse."));
    }

    const now = Date.now();
    const attempt = connectionAttemptsByIp.get(ip) || { count: 0, windowStart: now };
    if (now - attempt.windowStart > 60000) {
        attempt.count = 0;
        attempt.windowStart = now;
    }
    attempt.count += 1;
    connectionAttemptsByIp.set(ip, attempt);
    if (attempt.count > MAX_NEW_CONNECTIONS_PER_IP_PER_MIN) {
        return next(new Error("Trop de tentatives de connexion, réessaie plus tard."));
    }

    next();
});

mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ Mongoose connecté."));
mongoose.connection.on("error", (err) => console.error("❌ Mongoose erreur :", err?.message || err));

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
    route: String,
    method: String,
    ip: String,
    payload: mongoose.Schema.Types.Mixed
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
    reason: { type: String, enum: ['no_player_found', 'deposit_expired', 'round_too_old', 'amount_mismatch'], default: 'no_player_found' },
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
    payoutFailed: { type: Boolean, default: false }
}, { timestamps: true });

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
gameStateSchema.index({ updatedAt: -1 });

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
    } catch (error) { console.error("❌ MongoDB erreur :", error?.message || error); process.exit(1); }
}

function normalizeWallet(address) { return String(address || "").trim(); }
function sanitizeText(str, maxLength) {
    if (typeof str !== "string") return "";
    return str
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
        .substring(0, maxLength);
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
                const remaining = game.preparationEndsAt.getTime() - now;
                gameTimer = setTimeout(() => beginActualGame().catch(err => console.error(err)), remaining);
            } else {
                await beginActualGame();
            }
        } else if (game.status === 'running' && game.endsAt) {
            const now = Date.now();
            if (game.endsAt.getTime() > now) {
                const remaining = game.endsAt.getTime() - now;
                gameTimer = setTimeout(() => finishGame().catch(err => console.error(err)), remaining);
            } else {
                await finishGame();
            }
        }
        return gameState;
    } catch (error) {
        console.error("❌ Erreur chargement état :", error);
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
    } catch (error) { console.error("❌ Erreur sauvegarde état :", error); }
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

function broadcastOnlineCount() {
    io.emit("online:count", { count: onlineSockets.size });
}

async function emitLeaderboard() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps -_id").sort({ taps: -1 }).limit(50).lean();
        io.emit("leaderboard:update", players.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps })));
    } catch (error) { console.error("❌ Erreur emitLeaderboard :", error?.message || error); }
}

async function emitTotalStakes() {
    try {
        const result = await Player.aggregate([{ $match: { gameId: game.id } }, { $group: { _id: null, total: { $sum: "$bet" } } }]);
        io.emit("totalStakes:update", { totalStakes: result.length > 0 ? result[0].total : 0 });
    } catch (error) { console.error("❌ Erreur emitTotalStakes :", error?.message || error); }
}

async function broadcastGameState() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps -_id").sort({ taps: -1 }).limit(50).lean();
        io.emit("game:state", { game: getGameStateObject(), players });
        await emitLeaderboard();
        await emitTotalStakes();
    } catch (error) { console.error("❌ Erreur broadcastGameState :", error?.message || error); }
}

async function startPreparationPhase() {
    console.log("⏳ Démarrage de la phase de préparation (2 minutes)...");
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
    catch (error) { console.error("❌ Erreur post-préparation :", error?.message || error); }
}

async function beginActualGame() {
    if (game.status !== "preparing") return;
    console.log("🚀 Le jeu commence ! (10 minutes)");
    game.status = "running";
    game.startedAt = new Date();
    game.endsAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
    game.preparationEndsAt = null;
    await saveGameState();

    io.emit("game:started", { gameId: game.id, startsAt: game.startedAt, endsAt: game.endsAt, duration: GAME_DURATION_SECONDS, remainingSeconds: GAME_DURATION_SECONDS });
    broadcastTimer();

    gameTimer = setTimeout(() => { finishGame().catch(err => console.error(err)); }, GAME_DURATION_SECONDS * 1000);
    try { await broadcastGameState(); await emitJackpotUpdate(); }
    catch (error) { console.error("❌ Erreur post-démarrage :", error?.message || error); }
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
            io.emit("chat:message", { name: "🏆 Système", message: "🏁 La partie est terminée ! Aucun gagnant.", createdAt: new Date() });
            return;
        }

        const isDemoGame = players.some(p => p.paymentTxId && p.paymentTxId.startsWith('DEMO_'));
        const totalPot = players.reduce((sum, p) => sum + Number(p.bet || 0), 0);
        const topPlayers = players.slice(0, 5);
        const winners = [];

        for (let i = 0; i < topPlayers.length; i++) {
            const p = topPlayers[i];
            const gain = Number((p.bet * 2).toFixed(6));
            const history = await History.create({ playerId: p._id, playerName: p.name, wallet: p.wallet, gameId: game.id, rank: i + 1, bet: p.bet, gain, taps: p.taps, token: p.token, paidOut: false });
            winners.push({ player: p, gain, history });
        }

        console.log(`📊 Manche ${game.id} : ${players.length} joueur(s) payant(s), pot total = ${totalPot.toFixed(2)} (réparti en ${topPlayers.length} gagnant(s))`);

        if (isDemoGame) {
            for (const { history } of winners) { history.paidOut = true; history.payoutTxId = "DEMO_TX_" + Date.now().toString(36); await history.save(); }
        } else {
            console.log(`💰 Paiement de ${winners.length} gagnant(s) en cours...`);
            for (const { player, gain, history } of winners) {
                retryFailedPayout(history._id).catch(e => console.error("❌ Erreur retry initial :", e?.message));
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        const winnersList = topPlayers.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps, bet: p.bet, token: p.token, gain: Number((p.bet * 2).toFixed(6)) }));
        io.emit("game:finished", { gameId: game.id, winners: winnersList });
        io.emit("chat:message", { name: "🏆 Système", message: `🏁 La partie est terminée ! ${winnersList.length} gagnants !`, createdAt: new Date() });
    } catch (error) { console.error("❌ Erreur finishGame :", error?.message || error); }
}

async function sendPrizeToWinner(historyEntry) {
    try {
        const { wallet, gain, token, playerName } = historyEntry;
        if (!wallet || gain <= 0) return false;
        if (!isValidTronAddress(wallet)) return false;
        const tokenInfo = SUPPORTED_TOKENS[token];
        if (!tokenInfo) throw new Error("Token non supporté");

        const signingTronWeb = new TronWeb({
            fullHost: "https://api.trongrid.io",
            headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}
        });
        signingTronWeb.setPrivateKey(decryptPrivateKey());

        let txId = null;
        if (token === "TRX") { const tx = await signingTronWeb.trx.sendTransaction(wallet, Math.floor(gain * 1e6)); txId = tx.txid; }
        else { const contract = await signingTronWeb.contract().at(tokenInfo.contract); const tx = await contract.transfer(wallet, Math.floor(gain * Math.pow(10, tokenInfo.decimals))).send(); txId = tx.txid; }
        console.log(`✅ Gain de ${gain} ${token} envoyé à ${playerName}`);
        return txId;
    } catch (error) { console.error("❌ Erreur envoi gain :", error?.message); return null; }
}

async function retryFailedPayout(historyId, attempt = 1, maxAttempts = 3) {
    try {
        const history = await History.findById(historyId);
        if (!history) { console.warn(`⚠️ [Retry] History #${historyId} introuvable, abandon.`); return false; }
        if (history.paidOut) { console.log(`ℹ️ [Retry] History #${historyId} déjà payé (txId: ${history.payoutTxId}), skip.`); return true; }
        if (!history.gain || history.gain <= 0) {
            console.warn(`⚠️ [Retry] History #${historyId} gain invalide (${history.gain}), abandon.`);
            await History.findByIdAndUpdate(historyId, { payoutFailed: true, payoutLastError: "Gain invalide" });
            return false;
        }

        await History.findByIdAndUpdate(historyId, { $inc: { payoutAttempts: 1 } });
        console.log(`🔄 [Retry ${attempt}/${maxAttempts}] Paiement de ${history.gain} ${history.token} à ${history.playerName}...`);

        const txId = await sendPrizeToWinner({
            wallet: history.wallet,
            gain: history.gain,
            token: history.token,
            playerName: history.playerName
        });

        if (txId) {
            await History.findByIdAndUpdate(historyId, {
                paidOut: true,
                payoutTxId: txId,
                payoutFailed: false,
                payoutLastError: null
            });
            console.log(`✅ [Retry ${attempt}] Paiement réussi pour ${history.playerName} : ${history.gain} ${history.token} (txId: ${txId})`);
            io.emit("payout:success", { playerName: history.playerName, gain: history.gain, token: history.token, txId });
            return true;
        }

        throw new Error("sendPrizeToWinner a renvoyé null (RPC TRON indisponible ou solde insuffisant ?)");
    } catch (error) {
        const errMsg = error?.message || String(error);
        console.error(`❌ [Retry ${attempt}/${maxAttempts}] Échec paiement #${historyId} : ${errMsg}`);
        await History.findByIdAndUpdate(historyId, { payoutLastError: errMsg }).catch(() => {});

        if (attempt < maxAttempts) {
            const backoffMs = 2000 * Math.pow(2, attempt - 1);
            setTimeout(() => {
                retryFailedPayout(historyId, attempt + 1, maxAttempts).catch(e => console.error("❌ Erreur retryFailedPayout :", e?.message));
            }, backoffMs);
        } else {
            console.error(`🚨 [Retry FINAL] Paiement #${historyId} ABANDONNÉ après ${maxAttempts} tentatives. Intervention admin requise via /api/admin/payouts/retry.`);
            await History.findByIdAndUpdate(historyId, { payoutFailed: true });
            io.emit("payout:failed", { playerName: history?.playerName, historyId });
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
        } else {
            console.warn(`⚠️ Commission de parrainage mise en attente (plafond 24h dépassé) pour ${referrer.wallet}`);
        }

        referredPlayer.referralCounted = true;
        await referredPlayer.save();

        await ReferralPayout.create({
            referrerId: referrer._id,
            referrerWallet: referrer.wallet,
            referredPlayerId: referredPlayer._id,
            referredName: referredPlayer.name,
            referredWallet: referredPlayer.wallet,
            betAmount, commission, token,
            txId: txId || null,
            held
        });
    } catch (error) { console.error("❌ Erreur payReferralCommission :", error?.message || error); }
}

async function verifyOnChain(txId, expectedAmount, token = "USDT", expectedSender = null) {
    try {
        const tx = await tronWeb.trx.getTransaction(txId);
        if (!tx) return false;
        const contract = tx.raw_data?.contract?.[0];
        if (!contract) return false;
        let amount = 0;
        let sender = null;
        if (token === "TRX") {
            if (contract.type !== "TransferContract") return false;
            const value = contract.parameter?.value;
            const recipient = tronWeb.address.fromHex(value.to_address);
            if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            sender = tronWeb.address.fromHex(value.owner_address);
            amount = Number(value.amount) / 1e6;
        } else {
            if (contract.type !== "TriggerSmartContract") return false;
            const value = contract.parameter?.value;
            const contractAddress = tronWeb.address.fromHex(value.contract_address);
            if (!sameWallet(contractAddress, SUPPORTED_TOKENS[token].contract)) return false;
            const data = String
