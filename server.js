const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const PORT = Number(process.env.PORT) || 3000;

// ============================================================
// ✅ AJOUT ANTI-CRASH (Empêche le serveur de mourir)
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('ERREUR NON GÉRÉE (le serveur continue) :', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('PROMESSE REJETÉE NON GÉRÉE :', reason);
});
// ============================================================

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

// ✅ PLUS DE process.exit(1) ! Si une variable manque, on log juste l'erreur
if (!MONGODB_URI) console.error("❌ MONGO_URI manque dans Railway (mais le serveur démarre) !");
if (!PRIVATE_KEY) console.error("❌ MILTAPE_PRIVATE_KEY manque dans Railway (mais le serveur démarre) !");

try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    MILTAPE_WALLET = TronWeb.address.fromPrivateKey(PRIVATE_KEY);
    console.log("✅ TronWeb initialisé.");
} catch (error) {
    console.error("❌ Erreur TronWeb (le serveur continue) :", error.message);
}

// EXPRESS
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
    message: { error: "Trop de requêtes" }
});
app.use('/api/', limiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const io = new Server(server, {
    cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"], credentials: true }
});

mongoose.set("strictQuery", true);

// SCHEMAS
const playerSchema = new mongoose.Schema({
    gameId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    wallet: { type: String, required: true, trim: true, index: true },
    taps: { type: Number, default: 0, min: 0 },
    bet: { type: Number, default: 0, min: 0 },
    paid: { type: Boolean, default: false },
    paymentTxId: { type: String, default: null }
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
    gameId: { type: String, default: null }
}, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);

// ✅ PLUS DE process.exit(1) ICI NON PLUS !
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté."))
    .catch((error) => console.error("❌ MongoDB erreur (le serveur continue) :", error.message));

// UTILITAIRES
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
    const players = await Player.find({ gameId: game.id }).sort({ taps: -1 }).limit(5).lean();
    return players.map((p, i) => ({ rank: i + 1, name: p.name, wallet: p.wallet, taps: p.taps, bet: p.bet }));
}

async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        io.emit("online:count", onlineSockets.size + spectatorSockets.size);
        io.emit("leaderboard:update", leaderboard);
        io.emit("timer:update", { remainingSeconds: getRemainingSeconds(), status: game.status });
    } catch (error) { console.error("broadcastGameState:", error.message); }
}

async function sendUsdtToWinners(winners) {
    if (!tronWeb) return;
    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        for (const winner of winners) {
            if (winner.gain <= 0) continue;
            try {
                const amountInSun = tronWeb.toBigNumber(winner.gain * Math.pow(10, USDT_DECIMALS));
                await contract.transfer(winner.wallet, amountInSun);
            } catch (error) { console.error("Transfert erreur:", error.message); }
        }
    } catch (error) { console.error("Contrat erreur:", error.message); }
}

// DÉMARRAGE DU JEU (LE CHRONO)
async function startGame() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    game = { id: generateGameId(), status: "running", startedAt: Date.now(), endsAt: Date.now() + GAME_DURATION_SECONDS * 1000, durationSeconds: GAME_DURATION_SECONDS };
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

// FIN DE JEU
async function finishGame() {
    if (game.status !== "running") return;
    game.status = "finished";
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    try {
        const allPlayers = await Player.find({ gameId: game.id }).lean();
        const top5 = await Player.find({ gameId: game.id }).sort({ taps: -1 }).limit(5).lean();
        const totalStakes = allPlayers.reduce((sum, p) => sum + p.bet, 0);
        const winners = top5.map((player, index) => {
            const gain = player.bet * 2;
            return { rank: index + 1, name: player.name, wallet: player.wallet, bet: player.bet, gain: gain, taps: player.taps };
        });
        const totalPayout = winners.reduce((sum, w) => sum + w.gain, 0);
        const deficit = totalPayout - totalStakes;

        console.log("🏁 PARTIE TERMINÉE :", game.id);

        for (const winner of winners) { await Player.findByIdAndUpdate(winner._id, { paid: true }); }
        io.emit("game:finished", { winners, totalStakes, totalPayout, deficit });

        const realPayments = await Payment.find({ gameId: game.id, verified: true });
        if (realPayments.length > 0) { await sendUsdtToWinners(winners); }

        await broadcastGameState();
        if (nextGameTimeout) clearTimeout(nextGameTimeout);
        nextGameTimeout = setTimeout(async () => { nextGameTimeout = null; await startGame(); }, 5000);
    } catch (error) { console.error("finishGame:", error.message); await startGame(); }
}

// VÉRIF PAIEMENTS
async function checkPendingPayments() {
    if (game.status !== "running" || !tronWeb) return;
    try {
        const unpaidPlayers = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 } });
        if (unpaidPlayers.length === 0) return;
        const transactions = await tronWeb.trx.getAccountTransactions(MILTAPE_WALLET, { limit: 30, onlyConfirmed: true });
        if (!transactions || transactions.length === 0) return;

        for (const tx of transactions) {
            const txId = tx.txID;
            if (processedTxIds.has(txId)) continue;
            const txInfo = await tronWeb.trx.getTransactionInfo(txId);
            if (!txInfo || txInfo.receipt.result !== 'SUCCESS') continue;
            const transaction = await tronWeb.trx.getTransaction(txId);
            if (!transaction) continue;
            const contracts = transaction.raw_data?.contract;
            if (!Array.isArray(contracts) || contracts.length !== 1) continue;
            const contract = contracts[0];
            if (contract.type !== "TriggerSmartContract") continue;
            const value = contract.parameter?.value;
            if (!value) continue;
            const contractAddress = tronWeb.address.fromHex(value.contract_address);
            if (!sameWallet(contractAddress, USDT_CONTRACT)) continue;
            const ownerAddress = tronWeb.address.fromHex(value.owner_address);
            if (!ownerAddress) continue;
            const matchingPlayer = unpaidPlayers.find(p => sameWallet(p.wallet, ownerAddress) && p.bet > 0);
            if (!matchingPlayer) continue;
            const data = String(value.data || "").toLowerCase();
            if (!data.startsWith("a9059cbb") || data.length < 136) continue;
            const amountHex = data.substring(72, 136);
            const rawAmount = BigInt("0x" + amountHex);
            const amount = Number(rawAmount) / Math.pow(10, USDT_DECIMALS);
            if (amount < matchingPlayer.bet) continue;
            const recipientHex = "41" + data.substring(32, 72);
            const recipient = tronWeb.address.fromHex(recipientHex);
            if (!sameWallet(recipient, MILTAPE_WALLET)) continue;

            matchingPlayer.paid = true;
            matchingPlayer.paymentTxId = txId;
            await matchingPlayer.save();
            processedTxIds.add(txId);
            await Payment.create({ txId, from: ownerAddress, to: MILTAPE_WALLET, amount, verified: true, gameId: game.id });

            io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name });
            io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} USDT`, createdAt: new Date() });
        }
    } catch (error) { console.error("❌ Erreur vérification auto paiements :", error.message); }
}
setInterval(() => { if (processedTxIds.size > 1000) processedTxIds.clear(); }, 3600000);

// SOCKET EVENTS
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
        } catch (error) { console.error("player:join:", error.message); }
    });

    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;
            if (socket.data.isSpectator) return;
            const player = await Player.findById(socket.data.playerId);
            if (!player || player.gameId !== game.id) return;
            player.taps += 1;
            await player.save();
            socket.emit("player:score", { taps: player.taps });
            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);
        } catch (error) { console.error("player:tap:", error.message); }
    });

    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || socket.data.name || "Joueur").trim().substring(0, 30);
            const message = String(data?.message || "").trim().substring(0, 300);
            if (!message) return;
            const saved = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: saved._id, name, message, createdAt: saved.createdAt });
        } catch (error) { console.error("chat:send:", error.message); }
    });

    socket.on("spectator:join", async (data) => {
        try {
            const name = String(data?.name || "Spectateur").trim().substring(0, 30);
            socket.data.isSpectator = true;
            socket.data.name = name;
            spectatorSockets.add(socket.id);
            socket.emit("spectator:joined", { success: true, name: name, spectators: spectatorSockets.size });
            io.emit("chat:message", { name: "👁️ Système", message: `${name} regarde la partie !`, createdAt: new Date() });
            await broadcastGameState();
        } catch (error) { console.error("spectator:join:", error.message); }
    });

    socket.on("player:restore", async (data) => {
        try {
            const playerId = data?.playerId;
            const wallet = normalizeWallet(data?.wallet);
            const query = { gameId: game.id };
            if (playerId) query._id = playerId;
            else query.wallet = wallet;
            const player = await Player.findOne(query);
            if (!player) return socket.emit("error", { message: "Joueur introuvable." });
            socket.data.playerId = player._id.toString();
            socket.data.wallet = player.wallet;
            socket.data.name = player.name;
            socket.emit("player:restored", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid } });
            await broadcastGameState();
        } catch (error) { console.error("player:restore:", error.message); }
    });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        spectatorSockets.delete(socket.id);
        console.log("🔴 Socket déconnecté :", socket.id);
        await broadcastGameState();
    });
});

// ROUTES API
app.post("/api/admin/login", (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false, message: "Mot de passe incorrect." });
});

app.get("/api/wallet", (req, res) => res.json({ success: true, wallet: MILTAPE_WALLET, usdtContract: USDT_CONTRACT }));
app.get("/api/total-stakes", async (req, res) => {
    try {
        const result = await Player.aggregate([{ $match: { gameId: game.id } }, { $group: { _id: null, total: { $sum: "$bet" } } }]);
        res.json({ success: true, totalStakes: result.length > 0 ? result[0].total : 0 });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});
app.get("/api/online", (req, res) => res.json({ success: true, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size }));
app.get("/api/status", (req, res) => res.json({ success: true, server: "online", mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected", tron: tronWeb ? "connected" : "disconnected", wallet: MILTAPE_WALLET, gameId: game.id, status: game.status, timerLeft: getRemainingSeconds() }));
app.post("/api/join", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().substring(0, 30);
        const wallet = normalizeWallet(req.body?.wallet);
        const bet = Number(req.body?.bet);
        if (!name || !isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0) return res.status(400).json({ success: false, message: "Données invalides." });
        let player = await Player.findOne({ gameId: game.id, wallet });
        if (!player) { player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false }); }
        else { player.name = name; player.bet = bet; await player.save(); }
        res.json({ success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid } });
    } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); }
});

// 404
app.use((req, res) => res.status(404).json({ success: false, message: "Route introuvable." }));
app.use((error, req, res, next) => res.status(500).json({ success: false, message: "Erreur interne du serveur." }));

// START
server.listen(PORT, async () => {
    console.log("");
    console.log("==============================================");
    console.log("       🚀 BACKEND ONLINE");
    console.log("==============================================");
    console.log("🌐 Port :", PORT);
    console.log("💰 Wallet :", MILTAPE_WALLET);
    console.log("💬 Chat actif");
    console.log("⏱️ Chrono actif");
    console.log("==============================================");

    try { await startGame(); } catch (error) { console.error("❌ Impossible de démarrer le jeu :", error.message); }
    setInterval(checkPendingPayments, 15000); 
});

// ARRÊT PROPRE
async function gracefulShutdown(signal) {
    console.log(`${signal} reçu...`);
    if (gameTimer) clearInterval(gameTimer);
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    try { await mongoose.connection.close(); } catch (error) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
