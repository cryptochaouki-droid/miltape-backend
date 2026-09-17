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
    // ✅ NOUVEAU (fix #3) : trace les dépôts expirés pour audit
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

// ✅ NOUVEAU (fix #2) : collection pour les paiements reçus non rattachables à un joueur.
// Sans cette collection, ces fonds seraient perdus silencieusement.
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

// ✅ FIX #1 : ajout des champs de suivi des échecs pour permettre le retry auto + admin
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
// ✅ FIX #2 : index pour accélérer la recherche des N dernières manches
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
        // ✅ FIX #3 : totalPot était calculé mais jamais utilisé — on le log pour l'audit
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
            // ✅ FIX #1 : retry automatique asynchrone (fire-and-forget) pour ne pas bloquer la manche.
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

// ✅ FIX #1 : retry automatique avec backoff exponentiel (3 tentatives : 2s, 4s, 8s).
// Idempotent : vérifie paidOut avant chaque tentative pour éviter tout double paiement.
async function retryFailedPayout(historyId, attempt = 1, maxAttempts = 3) {
    try {
        const history = await History.findById(historyId);
        if (!history) {
            console.warn(`⚠️ [Retry] History #${historyId} introuvable, abandon.`);
            return false;
        }
        if (history.paidOut) {
            console.log(`ℹ️ [Retry] History #${historyId} déjà payé (txId: ${history.payoutTxId}), skip.`);
            return true;
        }
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
            const data = String(value.data || "");
            const recipient = tronWeb.address.fromHex("41" + data.substring(32, 72));
            if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            sender = tronWeb.address.fromHex(value.owner_address);
            const rawAmount = BigInt("0x" + data.substring(72, 136));
            amount = Number(rawAmount) / Math.pow(10, SUPPORTED_TOKENS[token].decimals);
        }
        if (expectedSender && !sameWallet(sender, expectedSender)) return false;
        const txInfo = await tronWeb.trx.getTransactionInfo(txId);
        if (!txInfo || txInfo.receipt?.result !== "SUCCESS") return false;
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
    } catch (error) { console.error("❌ Erreur jackpot :", error?.message || error); }
}

// ✅ FIX #4 : limit=100 + minTimestamp pour ne pas rater de tx en pic de charge,
// tout en évitant de re-scanner tout l'historique.
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

// ✅ FIX #2 : recherche sur 3 manches + capture des orphelins dans UnmatchedPayment.
// ✅ FIX #4 : minTimestamp calculé dynamiquement pour économiser le quota API.
async function checkPendingPayments() {
    try {
        const recentGames = await GameState.find()
            .sort({ updatedAt: -1 })
            .limit(3)
            .select("gameId status updatedAt")
            .lean();
        const recentGameIds = recentGames.map(g => g.gameId);

        const unpaidPlayers = await Player.find({
            gameId: { $in: recentGameIds },
            paid: false,
            bet: { $gt: 0 },
            depositAmount: { $ne: null },
            // ✅ FIX #3 : ignore les dépôts expirés (le job de cleanup s'en charge)
            depositExpiresAt: { $gt: new Date() }
        });

        if (unpaidPlayers.length === 0) return;

        // ✅ FIX #4 : min_timestamp = plus vieux depositExpiresAt - 5 min de marge
        const oldestExpiry = unpaidPlayers.reduce((min, p) => {
            const t = p.depositExpiresAt ? p.depositExpiresAt.getTime() : Date.now();
            return t < min ? t : min;
        }, Date.now());
        const minTimestamp = oldestExpiry - (5 * 60 * 1000);

        const allTransactions = [
            ...(await getIncomingTrxTransactions(MILTAPE_WALLET, minTimestamp)),
            ...(await getIncomingTrc20Transactions(MILTAPE_WALLET, minTimestamp))
        ];

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
                const recipient = tronWeb.address.fromHex(value.to_address);
                if (!sameWallet(recipient, MILTAPE_WALLET)) continue;
                token = "TRX";
                amount = Number(value.amount) / 1e6;
                senderAddress = tronWeb.address.fromHex(value.owner_address);
            }
            if (!SUPPORTED_TOKENS[token]) continue;

            // Anti-rejeu global
            const alreadyUsed = await Payment.findOne({ txId });
            if (alreadyUsed) continue;
            const alreadyUnmatched = await UnmatchedPayment.findOne({ txId });
            if (alreadyUnmatched) continue;

            const matchingPlayer = unpaidPlayers.find(p =>
                p.token === token &&
                sameWallet(senderAddress, p.wallet) &&
                Math.abs(amount - Number(p.depositAmount)) < 0.0000001 &&
                !p.paymentTxId?.startsWith('DEMO_')
            );

            // ✅ FIX #2 : si aucun joueur ne matche, on stocke au lieu de perdre
            if (!matchingPlayer) {
                await UnmatchedPayment.create({
                    txId, from: senderAddress, to: MILTAPE_WALLET, amount, token,
                    reason: 'no_player_found'
                });
                console.warn(`⚠️ [Paiement orphelin] ${amount} ${token} de ${senderAddress} (txId: ${txId}) — aucun joueur correspondant. Logué pour audit admin.`);
                continue;
            }

            const isLate = matchingPlayer.gameId !== game.id;
            if (isLate) {
                console.warn(`⚠️ [Dépôt tardif] Joueur ${matchingPlayer.name} (manche ${matchingPlayer.gameId}) payé pendant la manche ${game.id}.`);
            }

            matchingPlayer.paid = true;
            matchingPlayer.paymentTxId = txId;
            matchingPlayer.depositAmount = null;
            matchingPlayer.depositExpiresAt = null;
            await matchingPlayer.save();

            await Payment.create({
                txId, from: senderAddress, to: MILTAPE_WALLET, amount,
                verified: true, gameId: matchingPlayer.gameId, token
            });

            if (!isLate) {
                await payReferralCommission(matchingPlayer, matchingPlayer.bet, token);
            } else {
                console.warn(`ℹ️ [Dépôt tardif] Commission de parrainage non versée pour ${matchingPlayer.name} (manche terminée).`);
            }

            io.emit("payment:verified", {
                verified: true, wallet: matchingPlayer.wallet,
                amount: matchingPlayer.bet, playerName: matchingPlayer.name, token, late: isLate
            });
            io.emit("chat:message", {
                name: "🟢 Système",
                message: isLate
                    ? `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} (rattaché à la manche précédente)`
                    : `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`,
                createdAt: new Date()
            });

            if (!isLate) {
                const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                const jackpot = await Jackpot.findOne({ weekStart });
                if (jackpot) {
                    jackpot.accumulatedFund += (matchingPlayer.bet * JACKPOT_PERCENT);
                    await jackpot.save();
                }
            }
        }
    } catch (error) { console.error("❌ Erreur checkPendingPayments :", error?.message || error); }
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
    } catch (error) { console.error("❌ Erreur distribution jackpot :", error?.message || error); }
}

cron.schedule('0 0 * * 6', () => { distributeWeeklyJackpot().catch(err => console.error(err)); });

// ===== SOCKET.IO =====
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log(`🟢 Connexion Socket : ${socket.id}`);
    broadcastOnlineCount();

    const clientIp = socket.data.clientIp;
    if (clientIp) {
        if (!socketsByIp.has(clientIp)) socketsByIp.set(clientIp, new Set());
        socketsByIp.get(clientIp).add(socket.id);
    }
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

            if (player.gameId !== game.id) {
                return socket.emit("player:restored", { success: false, staleRound: true, player: { name: player.name, wallet: player.wallet } });
            }

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
            const name = sanitizeText(data?.name, 30);
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim().toUpperCase();
            const referralCodeRaw = sanitizeText(data?.referralCode, 20).toUpperCase();
            const referralCodeInput = /^[A-Z0-9]+$/.test(referralCodeRaw) ? referralCodeRaw : "";

            if (!name || !NAME_REGEX.test(name)) return socket.emit("error", { message: "Pseudo invalide (lettres, chiffres, espaces, - _ ' uniquement, 30 caractères max)." });

            const powNonce = String(data?.powNonce || "");
            if (!socket.data.powChallenge || socket.data.powUsed) {
                return socket.emit("error", { message: "Vérification anti-bot manquante, réessaie." });
            }
            const powHash = crypto.createHash('sha256').update(socket.data.powChallenge + powNonce).digest('hex');
            if (!powHash.startsWith('0'.repeat(POW_DIFFICULTY))) {
                return socket.emit("error", { message: "Vérification anti-bot invalide." });
            }
            socket.data.powUsed = true;
            issuePowChallenge(socket);

            if (bannedWallets.has(wallet)) {
                return socket.emit("error", { message: "Ce wallet est banni." });
            }

            if (!game.id || game.status === "waiting" || game.status === "finished") await startPreparationPhase();

            if (!isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0 || bet > MAX_BET || !SUPPORTED_TOKENS[token]) return socket.emit("error", { message: "Données invalides." });

            const existingPlayer = await Player.findOne({ wallet });

            const isSameActiveRound = existingPlayer && existingPlayer.gameId === game.id &&
                                     (game.status === "preparing" || game.status === "running");

            if (isSameActiveRound && existingPlayer.sessionToken) {
                if (!socket.data.cookieSessionToken || socket.data.cookieSessionToken !== existingPlayer.sessionToken) {
                    return socket.emit("error", { message: "Ce wallet est déjà utilisé dans cette manche depuis un autre appareil/navigateur." });
                }

                socket.data.playerId = existingPlayer._id.toString();
                socket.data.playerName = existingPlayer.name;
                socket.data.sessionToken = existingPlayer.sessionToken;

                existingPlayer.name = name;
                existingPlayer.gameId = game.id;
                existingPlayer.bet = bet;
                existingPlayer.token = token;
                existingPlayer.paid = false;
                existingPlayer.paymentTxId = undefined;
                existingPlayer.depositAmount = bet;
                existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                existingPlayer.depositExpiredAt = null;
                if (!existingPlayer.referralCode) existingPlayer.referralCode = await generateUniqueReferralCode();
                await existingPlayer.save();

                socket.emit("player:joined", { success: true, player: existingPlayer, game: getGameStateObject() });
                socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
                await broadcastGameState();
                return;
            }

            const sessionToken = generateSessionToken();

            if (existingPlayer) {
                existingPlayer.name = name;
                existingPlayer.gameId = game.id;
                existingPlayer.bet = bet;
                existingPlayer.token = token;
                existingPlayer.paid = false;
                existingPlayer.paymentTxId = undefined;
                existingPlayer.depositAmount = bet;
                existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                existingPlayer.depositExpiredAt = null;
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
                if (referralCodeInput) {
                    const referrer = await Player.findOne({ referralCode: referralCodeInput });
                    if (referrer) referredByCode = referralCodeInput;
                }

                const player = await Player.create({
                    gameId: game.id,
                    name,
                    wallet,
                    deviceId,
                    taps: 0,
                    weeklyTaps: 0,
                    bet,
                    paid: false,
                    token,
                    depositAmount: bet,
                    depositExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
                    sessionToken: sessionToken,
                    referralCode: ownReferralCode,
                    referredByCode
                });

                socket.data.playerId = player._id.toString();
                socket.data.playerName = player.name;
                socket.data.sessionToken = sessionToken;

                socket.emit("player:joined", {
                    success: true,
                    player: {
                        id: player._id,
                        name: player.name,
                        wallet: player.wallet,
                        taps: player.taps,
                        bet: player.bet,
                        paid: player.paid,
                        token: player.token,
                        depositAmount: player.depositAmount,
                        sessionToken: sessionToken,
                        referralCode: player.referralCode,
                        referralEarnings: player.referralEarnings,
                        referralCount: player.referralCount
                    },
                    game: getGameStateObject()
                });
            }

            socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
            await broadcastGameState();
        } catch (error) { console.error("❌ player:join :", error?.message || error); socket.emit("error", { message: "Impossible de rejoindre la partie." }); }
    });

    socket.on("player:tap", async () => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId || game.status !== "running") return;

            const now = Date.now();
            const lastTap = lastTapTimestamps.get(playerId) || 0;
            if (now - lastTap < MIN_TAP_INTERVAL_MS) return;
            lastTapTimestamps.set(playerId, now);

            const result = await Player.findOneAndUpdate(
                { _id: playerId, gameId: game.id, paid: true },
                { $inc: { taps: 1, weeklyTaps: 1 } },
                { new: true }
            ).select("name taps");
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

            const name = socket.data.playerName || "Anonyme";
            const message = sanitizeText(data?.message, 300).replace(/[<>]/g, "");
            if (!message) return;
            const msg = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: msg._id, name, message, createdAt: msg.createdAt });
        } catch (error) { console.error("❌ chat:send :", error?.message || error); }
    });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        console.log(`🔴 Déconnexion Socket : ${socket.id}`);
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
                io.to(otherSocketId).emit("duel:cancelled", { message: "Ton adversaire s'est déconnecté. Le duel est annulé." });
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
                const winnerId = duel.socket1 === socket.id ? duel.player2Id : duel.player1Id;
                const winner = await Player.findById(winnerId);
                if (winner) {
                    const gain = duel.bet * 2 - (duel.bet * 2 * DUEL_COMMISSION_PERCENT);
                    const txId = await sendPrizeToWinner({ wallet: winner.wallet, gain, token: "USDT", playerName: winner.name });
                    io.to(opponentSocketId).emit("duel:finished", { winnerName: winner.name, myTaps: 0, opponentTaps: 0, prize: gain, txId });
                }
                await Player.updateMany(
                    { _id: { $in: [duel.player1Id, duel.player2Id] } },
                    { $set: { duelPaid: false, duelPaymentTxId: null } }
                );
                delete activeDuels[duelId];
            }
        }
    });
});

// ===== MODE DUEL =====
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

    const totalPot = bet * 2;
    const yourCut = totalPot * DUEL_COMMISSION_PERCENT;
    const winnerPrize = totalPot - yourCut;

    io.to(entry1.socketId).emit("duel:started", { opponentName: player2.name, bet, prize: winnerPrize });
    io.to(entry2.socketId).emit("duel:started", { opponentName: player1.name, bet, prize: winnerPrize });

    const duelId = entry1.socketId;
    activeDuels[duelId] = {
        socket1: entry1.socketId,
        socket2: entry2.socketId,
        player1Id: entry1.playerId,
        player2Id: entry2.playerId,
        bet, winnerPrize,
        endsAt: Date.now() + 60000,
        taps1: 0, taps2: 0
    };

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
            const txId = await sendPrizeToWinner({
                wallet: winner.wallet,
                gain: duel.winnerPrize,
                token: "USDT",
                playerName: winner.name
            });

            await Payment.create({ txId, from: MILTAPE_WALLET, to: winner.wallet, amount: duel.winnerPrize, verified: true, gameId: "DUEL", token: "USDT" });
            if (loser) await DuelEntry.create({ playerId: loser._id, bet: duel.bet, token: "USDT", paid: false });

            io.to(duel.socket1).emit("duel:finished", {
                winnerName: winner.name,
                myTaps: duel.taps1,
                opponentTaps: duel.taps2,
                prize: duel.winnerPrize,
                txId
            });
            io.to(duel.socket2).emit("duel:finished", {
                winnerName: winner.name,
                myTaps: duel.taps2,
                opponentTaps: duel.taps1,
                prize: 0,
                txId: null
            });
        }

        await Player.updateMany(
            { _id: { $in: [duel.player1Id, duel.player2Id] } },
            { $set: { duelPaid: false, duelPaymentTxId: null } }
        );

        delete activeDuels[duelId];
    }, 60000);
}

io.on("connection", (socket) => {

    socket.on("duel:join", async (data) => {
        const bet = parseFloat(data.bet);

        if (!ALLOWED_BETS.includes(bet)) {
            return socket.emit("error", { message: "Mise non autorisée." });
        }

        const playerId = socket.data.playerId;
        if (!playerId) return socket.emit("error", { message: "Rejoins d'abord le jeu principal." });

        if (!duelPools[bet]) {
            duelPools[bet] = [];
        }

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

                io.to(entry1.socketId).emit("duel:cancelled", { message: state1?.duelPaid ? "Ton adversaire n'a pas payé à temps. Tu es remis en file d'attente." : "Tu n'as pas payé à temps. Le duel est annulé." });
                io.to(entry2.socketId).emit("duel:cancelled", { message: state2?.duelPaid ? "Ton adversaire n'a pas payé à temps. Tu es remis en file d'attente." : "Tu n'as pas payé à temps. Le duel est annulé." });

                if (state1?.duelPaid && !state2?.duelPaid) {
                    if (!duelPools[bet]) duelPools[bet] = [];
                    duelPools[bet].push({ socketId: entry1.socketId, playerId: entry1.playerId });
                } else if (state2?.duelPaid && !state1?.duelPaid) {
                    if (!duelPools[bet]) duelPools[bet] = [];
                    duelPools[bet].push({ socketId: entry2.socketId, playerId: entry2.playerId });
                }

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
        if (!pending) return socket.emit("duel:payment_error", { message: "Aucun duel en attente de paiement." });
        const betAmount = pending.bet;

        if (await isDuelTxUsed(txId)) {
            return socket.emit("duel:payment_error", { message: "Transaction déjà utilisée." });
        }

        const player = await Player.findById(playerId);
        if (!player) return socket.emit("duel:payment_error", { message: "Joueur introuvable." });

        const isValid = await verifyOnChain(txId, betAmount, "USDT", player.wallet);
        if (isValid) {
            player.duelPaid = true;
            player.duelPaymentTxId = txId;
            await player.save();

            pending.duelPaid = true;
            pending.duelPaymentTxId = txId;
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

setInterval(() => {
    checkPendingPayments().catch(err => console.error("Erreur checkPendingPayments :", err));
}, 7000);

setInterval(() => {
    if (game.status === "preparing" || game.status === "running") broadcastTimer();
}, 1000);

setInterval(() => { emitJackpotUpdate().catch(err => console.error(err)); }, 60 * 1000);

// ✅ FIX #3 : job périodique qui repère les dépôts expirés et les marque pour éviter
// qu'ils soient matchés par checkPendingPayments. Si un paiement arrive quand même, il
// tombera dans UnmatchedPayment et sera remboursable/rattaché manuellement.
setInterval(async () => {
    try {
        const now = new Date();
        const expired = await Player.find({
            paid: false,
            bet: { $gt: 0 },
            depositAmount: { $ne: null },
            depositExpiresAt: { $lt: now },
            depositExpiredAt: null
        });

        if (expired.length === 0) return;

        for (const p of expired) {
            console.warn(`⌛ [Dépôt expiré] Joueur ${p.name} (${String(p.wallet).substring(0, 8)}...) — mise de ${p.bet} ${p.token} non payée à temps.`);
            p.depositExpiredAt = now;
            p.depositAmount = null;
            await p.save();

            for (const [, s] of io.sockets.sockets) {
                if (s.data.playerId === p._id.toString()) {
                    s.emit("deposit:expired", {
                        message: "Ton délai de paiement de 10 minutes est dépassé. Si tu as payé juste avant l'expiration, ton paiement sera traité manuellement sous peu."
                    });
                }
            }
        }

        console.log(`⌛ [Cleanup] ${expired.length} dépôt(s) expiré(s) traité(s).`);
    } catch (error) { console.error("❌ Erreur cleanup expirés :", error?.message || error); }
}, 60 * 1000);

// ✅ FIX #1 : cron de secours qui retente les paiements marqués payoutFailed=true
// toutes les 30 min (max 3 retries supplémentaires par paiement).
cron.schedule('*/30 * * * *', async () => {
    try {
        const stuck = await History.find({
            paidOut: false,
            payoutFailed: true,
            payoutAttempts: { $lt: 6 }
        }).limit(20).lean();

        if (stuck.length === 0) return;
        console.log(`🔄 [Cron retry] ${stuck.length} paiement(s) à retenter...`);
        for (const h of stuck) {
            await retryFailedPayout(h._id, 1, 3);
        }
    } catch (error) { console.error("❌ Erreur cron retry payouts :", error?.message); }
});

app.post("/api/demo/verify", async (req, res) => {
    try {
        if (!DEMO_MODE_ENABLED_ON_SERVER) {
            return res.status(403).json({ success: false, message: "Mode démo désactivé sur le serveur (variable ALLOW_DEMO_MODE)." });
        }
        const { playerId } = req.body || {};
        if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." });

        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
        if (player.gameId !== game.id) return res.status(409).json({ success: false, message: "La manche a changé, rejoins à nouveau." });

        player.paid = true;
        player.paymentTxId = "DEMO_" + Date.now().toString(36).toUpperCase() + "_" + Math.random().toString(36).substring(2, 8).toUpperCase();
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();

        io.emit("payment:verified", { verified: true, wallet: player.wallet, amount: player.bet, playerName: player.name, token: player.token });
        await broadcastGameState();

        res.json({ success: true });
    } catch (error) {
        console.error("❌ Erreur /api/demo/verify :", error?.message || error);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post("/api/session/store", (req, res) => {
    try {
        const sessionToken = String(req.body?.sessionToken || "").trim();
        if (!sessionToken || sessionToken.length < 20) {
            return res.status(400).json({ success: false, message: "Token invalide." });
        }
        res.cookie('miltape_session', sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 30 * 24 * 60 * 60 * 1000,
            path: '/'
        });
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

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de tentatives admin." } });

function safeCompare(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
    const provided = req.headers['x-admin-password'] || req.query.adminPassword || (req.body && req.body.adminPassword);
    if (!provided || !safeCompare(provided, ADMIN_PASSWORD)) {
        return res.status(401).json({ success: false, message: "Non autorisé." });
    }
    const rawPayload = req.method === 'GET' ? req.query : req.body;
    const payload = { ...rawPayload };
    delete payload.adminPassword;
    AdminAuditLog.create({
        route: req.originalUrl,
        method: req.method,
        ip: req.ip,
        payload
    }).catch(err => console.error("❌ Erreur log admin :", err?.message || err));
    next();
}

app.get("/api/admin/status", adminLimiter, requireAdmin, (req, res) => {
    res.json({
        success: true,
        game: getGameStateObject(),
        online: onlineSockets.size,
        bannedCount: bannedWallets.size
    });
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
    try {
        await startPreparationPhase();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
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
                if (s.data.playerId === bannedPlayer._id.toString()) {
                    s.emit("error", { message: "Tu as été banni par un administrateur." });
                    s.disconnect(true);
                }
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
    try {
        const banned = await BannedWallet.find({}).sort({ createdAt: -1 }).lean();
        res.json({ success: true, banned });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/audit-log", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const logs = await AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(200).lean();
        res.json({ success: true, logs });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get("/api/admin/referrals/held", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const held = await ReferralPayout.find({ held: true, txId: null }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, held });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/referrals/release", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const payoutId = req.body?.payoutId;
        if (!payoutId) return res.status(400).json({ success: false, message: "payoutId manquant." });

        const payout = await ReferralPayout.findById(payoutId);
        if (!payout) return res.status(404).json({ success: false, message: "Commission introuvable." });
        if (payout.txId) return res.status(409).json({ success: false, message: "Déjà payée." });

        const txId = await sendPrizeToWinner({ wallet: payout.referrerWallet, gain: payout.commission, token: payout.token, playerName: payout.referrerWallet });
        if (!txId) return res.status(500).json({ success: false, message: "Échec de l'envoi on-chain." });

        payout.txId = txId;
        payout.held = false;
        await payout.save();

        await Player.findByIdAndUpdate(payout.referrerId, {
            $inc: { referralEarnings: payout.commission }
        });

        res.json({ success: true, txId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

// ✅ FIX #1 : nouvelles routes admin pour les paiements de gains
app.get("/api/admin/payouts/failed", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const failed = await History.find({ paidOut: false })
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json({ success: true, count: failed.length, failed });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payouts/retry", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const historyId = req.body?.historyId;
        if (!historyId) return res.status(400).json({ success: false, message: "historyId manquant." });

        const history = await History.findById(historyId);
        if (!history) return res.status(404).json({ success: false, message: "Paiement introuvable." });
        if (history.paidOut) return res.status(409).json({ success: false, message: "Déjà payé.", txId: history.payoutTxId });

        const ok = await retryFailedPayout(historyId);
        if (!ok) return res.status(500).json({ success: false, message: "Retry échoué, voir logs." });

        const updated = await History.findById(historyId).lean();
        res.json({ success: true, txId: updated.payoutTxId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

// ✅ FIX #2 : routes admin pour les paiements orphelins
app.get("/api/admin/payments/unmatched", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const unmatched = await UnmatchedPayment.find({ resolved: false })
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json({ success: true, count: unmatched.length, unmatched });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payments/unmatched/refund", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const { unmatchedId } = req.body || {};
        if (!unmatchedId) return res.status(400).json({ success: false, message: "unmatchedId manquant." });

        const payment = await UnmatchedPayment.findById(unmatchedId);
        if (!payment) return res.status(404).json({ success: false, message: "Paiement introuvable." });
        if (payment.resolved) return res.status(409).json({ success: false, message: "Déjà traité." });
        if (!isValidTronAddress(payment.from)) return res.status(400).json({ success: false, message: "Adresse expéditeur invalide." });

        const refundTxId = await sendPrizeToWinner({
            wallet: payment.from,
            gain: payment.amount,
            token: payment.token,
            playerName: `REFUND-${String(payment.from).substring(0, 6)}`
        });
        if (!refundTxId) return res.status(500).json({ success: false, message: "Échec du remboursement on-chain." });

        payment.resolved = true;
        payment.resolvedAction = 'refunded';
        payment.resolvedTxId = refundTxId;
        payment.resolvedAt = new Date();
        await payment.save();

        res.json({ success: true, refundTxId });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.post("/api/admin/payments/unmatched/ignore", adminLimiter, requireAdmin, async (req, res) => {
    try {
        const { unmatchedId } = req.body || {};
        if (!unmatchedId) return res.status(400).json({ success: false, message: "unmatchedId manquant." });

        const payment = await UnmatchedPayment.findById(unmatchedId);
        if (!payment) return res.status(404).json({ success: false, message: "Paiement introuvable." });
        if (payment.resolved) return res.status(409).json({ success: false, message: "Déjà traité." });

        payment.resolved = true;
        payment.resolvedAction = 'ignored';
        payment.resolvedAt = new Date();
        await payment.save();

        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

async function loadBannedWallets() {
    try {
        const docs = await BannedWallet.find({}).select("wallet").lean();
        docs.forEach(d => bannedWallets.add(d.wallet));
        console.log(`🚫 ${bannedWallets.size} wallet(s) banni(s) chargé(s).`);
    } catch (error) { console.error("❌ Erreur chargement wallets bannis :", error?.message || error); }
}

async function startServer() {
    try {
        await connectMongoDB();
        await loadOrCreateGameState();
        await loadBannedWallets();
        server.listen(PORT, async () => {
            console.log("🚀 BACKEND ONLINE (Sécurisé)");
            console.log(`🌐 Port : ${PORT}`);
            console.log(`🎮 État initial du jeu : ${game.status}`);
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
