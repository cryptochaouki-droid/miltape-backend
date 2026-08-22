const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
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
const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20;
const JACKPOT_HOUR = 20;

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

// ============================================================
// VÉRIFICATIONS
// ============================================================
if (!MONGODB_URI) { console.error("❌ MONGO_URI manque."); process.exit(1); }
if (!PRIVATE_KEY) { console.error("❌ MILTAPE_PRIVATE_KEY manque."); process.exit(1); }

// ============================================================
// TRONWEB & WALLET
// ============================================================
try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    console.log("✅ TronWeb initialisé.");
} catch (error) {
    console.error("❌ Erreur TronWeb :", error.message);
    process.exit(1);
}

// ============================================================
// EXPRESS & SOCKET.IO
// ============================================================
const app = express();
const server = http.createServer(app);

app.use(helmet());

// ATTENTION : Ici il faut mettre l'URL avec le /miltape-backend
const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io/miltape-backend";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"], credentials: true } });

mongoose.set("strictQuery", true);

// ============================================================
// SCHEMAS
// ============================================================
const playerSchema = new mongoose.Schema({
    gameId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    wallet: { type: String, required: true, trim: true, index: true },
    taps: { type: Number, default: 0, min: 0 },
    bet: { type: Number, default: 0, min: 0 },
    paid: { type: Boolean, default: false },
    paymentTxId: { type: String, default: null },
    token: { type: String, default: 'USDT' }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 30 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    gameId: { type: String, default: null }
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true, index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    amount: { type: Number, required: true },
    verified: { type: Boolean, default: false },
    gameId: { type: String, default: null },
    token: { type: String, default: 'USDT' }
}, { timestamps: true });

const historySchema = new mongoose.Schema({
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
}, { timestamps: true });

const jackpotSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    prize: { type: Number, default: 0 },
    accumulatedFund: { type: Number, default: 0 },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    drawn: { type: Boolean, default: false },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }]
}, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

// ============================================================
// CONNEXION MONGO
// ============================================================
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB connecté.")).catch((error) => { console.error("❌ MongoDB erreur :", error.message); process.exit(1); });

// ============================================================
// UTILITAIRES
// ============================================================
function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) { const wallet = normalizeWallet(address); if (!wallet) return false; try { return tronWeb.isAddress(wallet); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
function getRemainingSeconds() { if (game.status !== "running" || !game.endsAt) return 0; return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)); }

// ============================================================
// NOTIFICATIONS & CLASSEMENT
// ============================================================
function sendNotification(type, message, data = {}) { io.emit("notification:new", { type, message, data, timestamp: Date.now() }); }

async function getLeaderboard() {
    if (!game.id) return [];
    const players = await Player.find({ gameId: game.id }).sort({ taps: -1, createdAt: 1 }).limit(5).lean();
    return players.map((p, i) => ({ rank: i + 1, name: p.name, wallet: p.wallet, taps: p.taps, bet: p.bet, paid: p.paid, id: p._id, token: p.token || 'USDT' }));
}

async function getTotalStakes() {
    if (!game.id) return 0;
    const result = await Player.aggregate([{ $match: { gameId: game.id } }, { $group: { _id: null, total: { $sum: "$bet" } } }]);
    return result.length > 0 ? result[0].total : 0;
}

async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        const totalStakes = await getTotalStakes();
        io.emit("game:state", { gameId: game.id, status: game.status, startedAt: game.startedAt, endsAt: game.endsAt, durationSeconds: game.durationSeconds, remainingSeconds: getRemainingSeconds(), onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, leaderboard });
        io.emit("online:count", onlineSockets.size + spectatorSockets.size);
        io.emit("timer:update", { remainingSeconds: getRemainingSeconds(), status: game.status });
        io.emit("totalStakes:update", { totalStakes });
    } catch (error) { console.error("broadcastGameState:", error.message); }
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
    } catch (error) { console.error(`❌ Erreur transfert ${token} :`, error.message); throw error; }
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

    let jackpot = await Jackpot.findOne({ weekStart: { $gte: start, $lte: now }, weekEnd: { $gte: now, $lte: end } });
    if (!jackpot) { jackpot = await Jackpot.create({ weekStart: start, weekEnd: end, prize: 0, accumulatedFund: 0, drawn: false, participants: [] }); }
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
    io.emit("chat:message", { name: "💰 Cagnotte", message: `🎯 ${contribution} USDT ajoutés !`, createdAt: new Date() });
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
    let winnerName = null;
    if (jackpot.winner) { const winner = await Player.findById(jackpot.winner).select('name'); if (winner) winnerName = winner.name; }
    io.emit("jackpot:update", { prize: jackpot.prize, participants: jackpot.participants.length, nextDraw: getNextSaturday(), drawn: jackpot.drawn, winner: winnerName });
}

async function drawJackpot() { /* ... (Code inchangé) ... */ }

// ============================================================
// PAIEMENTS AUTOMATIQUES
// ============================================================
async function checkPendingPayments() { /* ... (Code inchangé) ... */ }

setInterval(() => { if (processedTxIds.size > 1000) processedTxIds.clear(); }, 60 * 60 * 1000);

// ============================================================
// JEU (START / FINISH)
// ============================================================
async function startGame() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    game = { id: generateGameId(), status: "running", startedAt: Date.now(), endsAt: Date.now() + GAME_DURATION_SECONDS * 1000, durationSeconds: GAME_DURATION_SECONDS };
    console.log("🎮 NOUVELLE PARTIE :", game.id);

    await broadcastGameState();
    gameTimer = setInterval(async () => {
        try {
            const remaining = getRemainingSeconds();
            io.emit("timer:update", { remainingSeconds: remaining, status: game.status });
            if (remaining === 60) sendNotification('warning', `⏱️ DERNIÈRE MINUTE !`);
            if (remaining <= 0) await finishGame();
        } catch (error) { console.error("gameTimer:", error.message); }
    }, 1000);
}

async function finishGame() { /* ... (Code inchangé) ... */ }

// ============================================================
// SOCKET.IO - CONNEXION
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    await broadcastGameState();
    await emitJackpotUpdate();
    const totalStakes = await getTotalStakes();
    socket.emit("totalStakes:update", { totalStakes });

    socket.on("jackpot:get", async () => { await emitJackpotUpdate(); });

    socket.on("player:join", async (data) => { /* ... (Code inchangé) ... */ });
    socket.on("spectator:join", async (data) => { /* ... (Code inchangé) ... */ });
    socket.on("player:restore", async (data) => { /* ... (Code inchangé) ... */ });

    // ============================================================
    // *** OPTIMISATION MAJEURE : TAP AVEC BATCHING ($inc) ***
    // ============================================================
    socket.on("player:tap", async (data) => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;
            if (socket.data.isSpectator) return;

            // Récupère le nombre total de taps envoyé par le client (ex: 5 taps en 1 seule requête)
            const tapsToAdd = (data && typeof data.count === 'number' && data.count > 0) ? data.count : 1;

            // Mise à jour ATOMIQUE et ultra-rapide (on n'utilise plus findById + save)
            await Player.updateOne(
                { _id: socket.data.playerId, gameId: game.id },
                { $inc: { taps: tapsToAdd } }
            );

            // On renvoie juste le nouveau total à ce joueur
            const updatedPlayer = await Player.findById(socket.data.playerId);
            if (updatedPlayer) socket.emit("player:score", { taps: updatedPlayer.taps });

            // NOTE IMPORTANTE : On a ENLEVÉ le leaderboard ici pour éviter de surcharger le serveur !
            // Le classement est maintenant géré par le setInterval global en bas.

        } catch (error) {
            console.error("player:tap:", error.message);
        }
    });

    socket.on("chat:send", async (data) => { /* ... (Code inchangé) ... */ });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        spectatorSockets.delete(socket.id);
        await broadcastGameState();
    });
});

// ============================================================
// *** OPTIMISATION MAJEURE : CLASSEMENT GLOBAL TOUTES LES 2 SECONDES ***
// (Au lieu d'envoyer le classement à chaque clic, ce qui surcharge le serveur)
// ============================================================
setInterval(async () => {
    try {
        if (game.status === "running") {
            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);
        }
    } catch (error) {
        console.error("Erreur classement global :", error.message);
    }
}, 2000);

// ============================================================
// ROUTES ADMIN & API
// ============================================================
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true, message: "Connecté." });
    else res.status(401).json({ success: false, message: "Mot de passe incorrect." });
});

app.get("/api/admin/stats", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/admin/payouts", async (req, res) => { /* ... (Code inchangé) ... */ });

app.get("/api/game", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/wallet", (req, res) => res.json({ success: true, wallet: MILTAPE_WALLET, usdtContract: SUPPORTED_TOKENS.USDT.contract, supportedTokens: Object.keys(SUPPORTED_TOKENS) }));
app.get("/api/total-stakes", async (req, res) => { /* ... (Code inchangé) ... */ });
app.post("/api/join", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/player/status", async (req, res) => { /* ... (Code inchangé) ... */ });

app.post("/api/tap", async (req, res) => { /* ... (Code inchangé) ... */ });

app.get("/api/leaderboard", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/chat", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/online", (req, res) => res.json({ success: true, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size }));

app.get("/api/status", (req, res) => res.json({ success: true, service: "Miltape Backend", server: "online", mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected", tron: tronWeb ? "connected" : "disconnected", wallet: MILTAPE_WALLET, gameId: game.id || null, status: game.status, timerLeft: getRemainingSeconds(), onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, supportedTokens: Object.keys(SUPPORTED_TOKENS) }));

app.get("/api/jackpot", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/jackpot/history", async (req, res) => { /* ... (Code inchangé) ... */ });
app.post("/api/payment/verify", async (req, res) => { /* ... (Code inchangé) ... */ });
app.get("/api/player/history", async (req, res) => { /* ... (Code inchangé) ... */ });

app.use((req, res) => res.status(404).json({ success: false, message: "Route introuvable." }));
app.use((error, req, res, next) => { console.error("Express error:", error); res.status(500).json({ success: false, message: "Erreur interne du serveur." }); });

// ============================================================
// START & ARRÊT PROPRE
// ============================================================
server.listen(PORT, async () => {
    console.log("🚀 BACKEND ONLINE");
    try { await startGame(); } catch (error) { console.error("❌ Impossible de démarrer le jeu :", error.message); }
    setInterval(checkPendingPayments, 15000);
    setInterval(async () => { const now = new Date(); if (now.getDay() === 6 && now.getHours() === JACKPOT_HOUR && now.getMinutes() === 0) await drawJackpot(); }, 60000);
});

async function gracefulShutdown(signal) {
    console.log(`${signal} reçu...`);
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    if (nextGameTimeout) { clearTimeout(nextGameTimeout); nextGameTimeout = null; }
    try { await mongoose.connection.close(); } catch (e) {}
    server.close(() => { console.log("✅ Serveur arrêté."); process.exit(0); });
    setTimeout(() => process.exit(0), 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
