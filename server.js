const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = Number(process.env.PORT) || 3000;
const GAME_DURATION_SECONDS = 10 * 60; // 10 minutes

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

// ============================================================
// GARDE-FOUS
// ============================================================
process.on("uncaughtException", (err) => console.error("❌", err?.message || err));
process.on("unhandledRejection", (reason) => console.error("❌", reason));

if (!MONGODB_URI || !PRIVATE_KEY || !ADMIN_PASSWORD) {
    console.error("❌ Variables d'environnement manquantes.");
    process.exit(1);
}

// ============================================================
// TRONWEB
// ============================================================
let tronWeb = null;
let MILTAPE_WALLET = "";
try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    console.log("✅ Wallet Miltape :", MILTAPE_WALLET);
} catch (error) {
    console.error("❌ Erreur initialisation TronWeb :", error?.message || error);
    process.exit(1);
}

// ============================================================
// SERVEUR EXPRESS & SOCKET.IO
// ============================================================
const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." }
});
app.use("/api/", limiter);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ============================================================
// MONGOOSE
// ============================================================
mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ Mongoose connecté."));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongoose déconnecté."));
mongoose.connection.on("error", (err) => console.error("❌ Mongoose erreur :", err?.message || err));

// ============================================================
// SCHEMAS MONGODB
// ============================================================
const playerSchema = new mongoose.Schema({
    gameId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    wallet: { type: String, trim: true, index: true },
    deviceId: { type: String, trim: true, index: true },
    taps: { type: Number, default: 0, min: 0 },
    weeklyTaps: { type: Number, default: 0 },
    bet: { type: Number, default: 0, min: 0 },
    paid: { type: Boolean, default: false },
    paymentTxId: { type: String, default: null, unique: true, sparse: true },
    token: { type: String, default: "USDT" },
    depositAmount: { type: Number, default: null },
    depositExpiresAt: { type: Date, default: null }
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
    token: { type: String, default: "USDT" }
}, { timestamps: true });

const historySchema = new mongoose.Schema({
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
    playerName: { type: String, required: true },
    wallet: { type: String, required: true },
    gameId: { type: String, required: true },
    rank: { type: Number, required: true },
    bet: { type: Number, required: true },
    gain: { type: Number, required: true },
    taps: { type: Number, required: true },
    token: { type: String, default: "USDT" },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const jackpotSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    prize: { type: Number, default: 0 },
    accumulatedFund: { type: Number, default: 0 },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "Player", default: null },
    drawn: { type: Boolean, default: false },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
}, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

// ============================================================
// CONNEXION MONGODB
// ============================================================
async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000
        });
        console.log("✅ MongoDB connecté.");
    } catch (error) {
        console.error("❌ MongoDB erreur :", error?.message || error);
        process.exit(1);
    }
}

// ============================================================
// UTILITAIRES
// ============================================================
function normalizeWallet(address) {
    return String(address || "").trim();
}
function isValidTronAddress(address) {
    try { return tronWeb.isAddress(normalizeWallet(address)); } catch { return false; }
}
function sameWallet(a, b) {
    return normalizeWallet(a) === normalizeWallet(b);
}
function generateGameId() {
    return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(id); }
}

// ============================================================
// CHRONO & JEU
// ============================================================
let gameTimer = null, nextGameTimeout = null;
const onlineSockets = new Set();
let game = {
    id: null,
    status: "waiting",
    startedAt: null,
    endsAt: null,
    durationSeconds: GAME_DURATION_SECONDS
};

function getRemainingSeconds() {
    if (game.status !== "running" || !game.endsAt) return 0;
    return Math.max(0, Math.ceil((game.endsAt.getTime() - Date.now()) / 1000));
}
function getGameStateObject() {
    return {
        id: game.id,
        status: game.status,
        startsAt: game.startedAt,
        endsAt: game.endsAt,
        remainingSeconds: getRemainingSeconds(),
        durationSeconds: game.durationSeconds
    };
}

// ============================================================
// MONTANT UNIQUE POUR PAIEMENT
// ============================================================
async function assignUniqueDepositAmount(baseBet, gameId) {
    for (let i = 0; i < 10; i++) {
        const candidate = Number((Number(baseBet) + Math.random() * 0.001).toFixed(6));
        const existing = await Player.findOne({ gameId, depositAmount: candidate, paid: false });
        if (!existing) return candidate;
    }
    return Number((Number(baseBet) + 0.000999).toFixed(6));
}

// ============================================================
// VÉRIFICATION ON-CHAIN
// ============================================================
async function verifyOnChain(txId, expectedAmount, token = "USDT") {
    if (!txId || !expectedAmount) return false;
    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error("Token non supporté.");
    try {
        const tx = await tronWeb.trx.getTransaction(txId);
        if (!tx) return false;
        const contracts = tx.raw_data?.contract;
        if (!Array.isArray(contracts) || !contracts.length) return false;
        const contract = contracts[0];
        let amount = 0;
        if (token === "TRX") {
            if (contract.type !== "TransferContract") return false;
            const value = contract.parameter?.value;
            if (!value) return false;
            const recipient = tronWeb.address.fromHex(value.to_address);
            if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            amount = Number(value.amount) / 1e6;
        } else {
            if (contract.type !== "TriggerSmartContract") return false;
            const value = contract.parameter?.value;
            if (!value) return false;
            const contractAddress = tronWeb.address.fromHex(value.contract_address);
            if (!sameWallet(contractAddress, tokenInfo.contract)) return false;
            const data = String(value.data || "");
            if (data.length < 136) return false;
            const recipientHex = "41" + data.substring(32, 72);
            const recipient = tronWeb.address.fromHex(recipientHex);
            if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            const rawAmount = BigInt("0x" + data.substring(72, 136));
            amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
        }
        const txInfo = await tronWeb.trx.getTransactionInfo(txId);
        if (!txInfo || txInfo.receipt?.result !== "SUCCESS" || !txInfo.blockNumber) return false;
        return Math.abs(amount - Number(expectedAmount)) < 0.0000001;
    } catch (error) {
        console.error("❌ Erreur vérification blockchain :", error?.message || error);
        return false;
    }
}

async function getIncomingTrxTransactions(address) {
    try {
        const url = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=30&only_confirmed=true`;
        const headers = TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {};
        const res = await fetchWithTimeout(url, { headers });
        if (!res.ok) return [];
        const data = await res.json();
        return data.data || [];
    } catch (error) {
        console.log("⚠️ Erreur API TRX ignorée :", error?.message || error);
        return [];
    }
}
async function getIncomingTrc20Transactions(address) {
    try {
        const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=30&only_confirmed=true`;
        const headers = TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {};
        const res = await fetchWithTimeout(url, { headers });
        if (!res.ok) return [];
        const data = await res.json();
        return data.data || [];
    } catch (error) {
        console.log("⚠️ Erreur API TRC20 ignorée :", error?.message || error);
        return [];
    }
}

// ============================================================
// NOTIFICATIONS ET BROADCASTS
// ============================================================
function sendNotification(type, message, data = {}) {
    io.emit("notification", { type, message, data });
}
function broadcastOnlineCount() {
    io.emit("online:count", { count: onlineSockets.size });
}
async function broadcastGameState() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id })
            .select("name taps wallet bet paid token depositAmount")
            .sort({ taps: -1 })
            .limit(50)
            .lean();
        io.emit("game:state", { game: getGameStateObject(), players });
    } catch (error) {
        console.error("❌ Erreur broadcastGameState :", error?.message || error);
    }
}
function broadcastTimer() {
    if (!game.id) return;
    io.emit("timer:update", {
        gameId: game.id,
        status: game.status,
        remainingSeconds: getRemainingSeconds(),
        endsAt: game.endsAt
    });
}

// ============================================================
// JACKPOT – GESTION DU MEILLEUR TAPEUR DE LA SEMAINE
// ============================================================
function getNextSaturday() {
    const now = new Date();
    const day = now.getDay();
    const diff = (6 - day + 7) % 7;
    const next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setHours(0, 0, 0, 0);
    if (day === 6 && now.getHours() >= 0) {
        next.setDate(next.getDate() + 7);
    }
    return next.getTime();
}

async function emitJackpotUpdate() {
    try {
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        let jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot) {
            // Création par sécurité (normalement déjà fait au démarrage)
            jackpot = await Jackpot.create({
                weekStart,
                weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
                accumulatedFund: 0,
                drawn: false
            });
            console.log("✅ Jackpot créé à la volée.");
        }
        const prize = jackpot ? jackpot.accumulatedFund : 0;
        const nextDraw = getNextSaturday();
        io.emit("jackpot:update", { prize, nextDraw });
    } catch (error) {
        console.error("❌ Erreur jackpot :", error?.message || error);
    }
}

// Distribution au meilleur tapeur de la semaine
async function distributeWeeklyJackpot() {
    try {
        console.log("🏆 Distribution du jackpot hebdomadaire...");
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        const jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot || jackpot.drawn || jackpot.accumulatedFund <= 0) {
            console.log("Aucun jackpot à distribuer cette semaine.");
            return;
        }

        const winner = await Player.findOne({})
            .sort({ weeklyTaps: -1 })
            .limit(1)
            .select("name wallet weeklyTaps");

        if (!winner || winner.weeklyTaps === 0) {
            console.log("Aucun gagnant (aucun tap effectué).");
            return;
        }

        jackpot.winner = winner._id;
        jackpot.drawn = true;
        await jackpot.save();

        io.emit("jackpot:winner", {
            winner: winner.name,
            amount: jackpot.accumulatedFund,
            taps: winner.weeklyTaps
        });
        io.emit("chat:message", {
            name: "🏆 Système",
            message: `🎉 ${winner.name} remporte le jackpot de ${jackpot.accumulatedFund} USDT avec ${winner.weeklyTaps} taps cette semaine !`,
            createdAt: new Date()
        });
        sendNotification("champion", `🏆 ${winner.name} remporte le jackpot de ${jackpot.accumulatedFund} USDT !`);

        // Réinitialiser les compteurs
        await Player.updateMany({}, { $set: { weeklyTaps: 0 } });
        console.log(`✅ Jackpot de ${jackpot.accumulatedFund} USDT attribué à ${winner.name} (${winner.weeklyTaps} taps)`);
    } catch (error) {
        console.error("❌ Erreur distribution jackpot :", error?.message || error);
    }
}

// Planification : chaque samedi à minuit (UTC)
cron.schedule('0 0 * * 6', () => {
    console.log("⏰ Planification : distribution du jackpot...");
    distributeWeeklyJackpot().catch(err => console.error(err));
});

// ============================================================
// DÉMARRAGE ET FIN DE PARTIE
// ============================================================
async function startGame() {
    console.log("🎮 Démarrage de la partie...");
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    game.id = generateGameId();
    game.status = "running";
    game.startedAt = new Date();
    game.endsAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
    game.durationSeconds = GAME_DURATION_SECONDS;

    io.emit("game:started", {
        gameId: game.id,
        startsAt: game.startedAt,
        endsAt: game.endsAt,
        duration: GAME_DURATION_SECONDS,
        remainingSeconds: GAME_DURATION_SECONDS
    });
    broadcastTimer();

    gameTimer = setTimeout(() => {
        finishGame().catch((error) => console.error("❌ finishGame :", error?.message || error));
    }, GAME_DURATION_SECONDS * 1000);

    try {
        await broadcastGameState();
        await emitJackpotUpdate();
    } catch (error) {
        console.error("❌ Erreur post-démarrage :", error?.message || error);
    }
}

async function finishGame() {
    if (game.status !== "running") return;
    console.log("🏁 Fin de la partie...");
    game.status = "finished";
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    broadcastTimer();

    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    nextGameTimeout = setTimeout(() => {
        startGame().catch((error) => console.error("❌ Erreur nouvelle partie :", error?.message || error));
    }, 10000);

    game.status = "waiting";
    game.startedAt = null;
    game.endsAt = null;
    broadcastTimer();

    try {
        const players = await Player.find({ gameId: game.id, paid: true }).sort({ taps: -1 });
        if (players.length > 0) {
            const totalPot = players.reduce((sum, player) => sum + Number(player.bet || 0), 0);
            const prizes = [{ share: 0.80 }, { share: 0.15 }, { share: 0.05 }];
            for (let i = 0; i < players.length && i < prizes.length; i++) {
                const player = players[i];
                const gain = Number((totalPot * prizes[i].share).toFixed(6));
                await History.create({
                    playerId: player._id,
                    playerName: player.name,
                    wallet: player.wallet,
                    gameId: game.id,
                    rank: i + 1,
                    bet: player.bet,
                    gain,
                    taps: player.taps,
                    token: player.token
                });
            }
            // Ajout au jackpot
            const weekStart = new Date();
            weekStart.setHours(0, 0, 0, 0);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            let jackpot = await Jackpot.findOne({ weekStart });
            if (!jackpot) {
                jackpot = await Jackpot.create({
                    weekStart,
                    weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
                    accumulatedFund: 0
                });
            }
            jackpot.accumulatedFund = Number(jackpot.accumulatedFund || 0) + totalPot;
            await jackpot.save();
        }

        const winners = players.slice(0, 3).map((player) => ({
            name: player.name,
            taps: player.taps,
            bet: player.bet,
            token: player.token
        }));
        io.emit("game:finished", { gameId: game.id, winners });
        io.emit("chat:message", { name: "🏆 Système", message: "🏁 La partie est terminée !", createdAt: new Date() });
    } catch (error) {
        console.error("❌ Erreur finishGame :", error?.message || error);
    }
}

// ============================================================
// PAIEMENTS AUTOMATIQUES
// ============================================================
async function checkPendingPayments() {
    if (game.status !== "running") return;
    try {
        const unpaidPlayers = await Player.find({
            gameId: game.id,
            paid: false,
            bet: { $gt: 0 },
            depositAmount: { $ne: null }
        });
        if (unpaidPlayers.length === 0) return;

        const trxTransactions = await getIncomingTrxTransactions(MILTAPE_WALLET);
        const trc20Transactions = await getIncomingTrc20Transactions(MILTAPE_WALLET);
        const allTransactions = [...(trxTransactions || []), ...(trc20Transactions || [])];

        for (const tx of allTransactions) {
            try {
                const txId = tx.transaction_id || tx.txID;
                if (!txId) continue;
                let token = null, amount = 0;
                if (tx.token_info) {
                    token = String(tx.token_info.symbol || "").toUpperCase();
                    amount = Number(tx.value) / Math.pow(10, Number(tx.token_info.decimals || 6));
                } else if (tx.raw_data && tx.raw_data.contract && tx.raw_data.contract[0]) {
                    const contract = tx.raw_data.contract[0];
                    if (contract.type !== "TransferContract") continue;
                    const value = contract.parameter?.value;
                    if (!value) continue;
                    const recipient = tronWeb.address.fromHex(value.to_address);
                    if (!sameWallet(recipient, MILTAPE_WALLET)) continue;
                    token = "TRX";
                    amount = Number(value.amount) / 1e6;
                } else continue;

                if (!SUPPORTED_TOKENS[token]) continue;
                const matchingPlayer = unpaidPlayers.find(
                    (player) => player.token === token && Math.abs(amount - Number(player.depositAmount)) < 0.0000001
                );
                if (!matchingPlayer) continue;
                const alreadyUsed = await Payment.findOne({ txId });
                if (alreadyUsed) continue;

                matchingPlayer.paid = true;
                matchingPlayer.paymentTxId = txId;
                matchingPlayer.depositAmount = null;
                matchingPlayer.depositExpiresAt = null;
                await matchingPlayer.save();

                await Payment.create({
                    txId,
                    from: "Paiement détecté",
                    to: MILTAPE_WALLET,
                    amount,
                    verified: true,
                    gameId: game.id,
                    token
                });

                io.emit("payment:verified", {
                    verified: true,
                    wallet: matchingPlayer.wallet,
                    amount: matchingPlayer.bet,
                    playerName: matchingPlayer.name,
                    token
                });
                io.emit("chat:message", {
                    name: "🟢 Système",
                    message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`,
                    createdAt: new Date()
                });
                sendNotification("success", `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`, { playerName: matchingPlayer.name, amount: matchingPlayer.bet, token });
            } catch (error) {
                if (error?.code !== 11000) console.log("⚠️ Transaction ignorée :", error?.message || error);
            }
        }
    } catch (error) {
        console.error("❌ Erreur checkPendingPayments :", error?.message || error);
    }
}

// ============================================================
// SOCKET.IO ÉVÉNEMENTS
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log(`🟢 Connexion Socket : ${socket.id}`);
    broadcastOnlineCount();

    socket.emit("timer:update", {
        gameId: game.id,
        status: game.status,
        remainingSeconds: getRemainingSeconds(),
        endsAt: game.endsAt
    });

    try {
        await broadcastGameState();
        await emitJackpotUpdate();
    } catch (error) {
        console.error("Erreur état initial :", error?.message || error);
    }

    // Demande manuelle du jackpot
    socket.on("jackpot:get", () => {
        emitJackpotUpdate().catch(err => console.error(err));
    });

    socket.on("timer:request", () => {
        socket.emit("timer:update", {
            gameId: game.id,
            status: game.status,
            remainingSeconds: getRemainingSeconds(),
            endsAt: game.endsAt
        });
    });

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim().toUpperCase();

            if (!game.id || game.status !== "running") {
                return socket.emit("error", { message: "La partie n'est pas encore disponible." });
            }
            if (!name || !isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token]) {
                return socket.emit("error", { message: "Données invalides." });
            }

            let player = null;
            if (deviceId) {
                player = await Player.findOne({ gameId: game.id, deviceId });
            } else {
                player = await Player.findOne({ gameId: game.id, wallet });
            }

            if (!player) {
                const depositAmount = await assignUniqueDepositAmount(bet, game.id);
                player = await Player.create({
                    gameId: game.id,
                    name,
                    wallet,
                    deviceId,
                    taps: 0,
                    weeklyTaps: 0,
                    bet,
                    paid: false,
                    token,
                    depositAmount,
                    depositExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
                });
            } else {
                player.name = name;
                player.wallet = wallet;
                player.bet = bet;
                player.token = token;
                player.paid = false;
                player.paymentTxId = null;
                player.depositAmount = await assignUniqueDepositAmount(bet, game.id);
                player.depositExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;

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
                    depositAmount: player.depositAmount
                },
                game: getGameStateObject()
            });

            await broadcastGameState();
        } catch (error) {
            console.error("❌ player:join :", error?.message || error);
            socket.emit("error", { message: "Impossible de rejoindre la partie." });
        }
    });

    socket.on("player:tap", async (data) => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId || game.status !== "running") return;
            const taps = Math.max(0, Math.min(10, Number(data?.taps) || 1));
            if (taps <= 0) return;

            const result = await Player.findOneAndUpdate(
                { _id: playerId, gameId: game.id, paid: true },
                { $inc: { taps: taps, weeklyTaps: taps } },
                { new: true }
            ).select("name taps");

            if (!result) return;

            io.emit("player:update", {
                id: playerId,
                name: result.name,
                taps: result.taps
            });
        } catch (error) {
            console.error("❌ player:tap :", error?.message || error);
        }
    });

    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || "Anonyme").trim().substring(0, 30);
            const message = String(data?.message || "").trim().substring(0, 300);
            if (!message) return;
            const msg = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", {
                id: msg._id,
                name,
                message,
                createdAt: msg.createdAt
            });
        } catch (error) {
            console.error("❌ chat:send :", error?.message || error);
        }
    });

    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        console.log(`🔴 Déconnexion Socket : ${socket.id}`);
        broadcastOnlineCount();
        try { await broadcastGameState(); } catch (error) { console.error("Erreur déconnexion :", error?.message || error); }
    });
});

// ============================================================
// INTERVALLES DE MAINTENANCE
// ============================================================
setInterval(() => {
    if (game.status !== "running") return;
    const now = new Date();
    Player.updateMany(
        { gameId: game.id, paid: false, depositExpiresAt: { $lt: now } },
        { $set: { depositExpiresAt: null, depositAmount: null, bet: 0 } }
    ).catch((error) => console.error("❌ Erreur timeout paiement :", error?.message || error));
}, 60 * 1000);

setInterval(() => {
    if (game.status !== "running") return;
    broadcastTimer();
}, 1000);

let paymentCheckRunning = false;
setInterval(async () => {
    if (paymentCheckRunning) return;
    paymentCheckRunning = true;
    try { await checkPendingPayments(); } catch (error) { console.error("❌ Erreur check paiements :", error?.message || error); } finally { paymentCheckRunning = false; }
}, 15000);

setInterval(() => {
    emitJackpotUpdate().catch(err => console.error("Erreur maj jackpot :", err));
}, 60 * 1000);

// ============================================================
// ROUTES API EXPRESS
// ============================================================
app.post("/api/payment/verify", async (req, res) => {
    try {
        const { txId, playerId } = req.body;
        if (!txId || !playerId) return res.status(400).json({ success: false, message: "txId et playerId sont requis." });
        if (String(txId).startsWith("DEMO_")) return res.status(400).json({ success: false, message: "Transaction invalide pour le paiement réel." });
        const existingPayment = await Payment.findOne({ txId });
        if (existingPayment) return res.status(400).json({ success: false, message: "Transaction déjà utilisée." });
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
        if (player.paid) return res.json({ success: true, verified: true });
        if (!player.depositAmount || player.depositAmount <= 0) return res.status(400).json({ success: false, message: "Montant de dépôt invalide." });
        const isValid = await verifyOnChain(txId, player.depositAmount, player.token);
        if (!isValid) return res.status(400).json({ success: false, message: "Paiement non vérifié." });
        player.paid = true;
        player.paymentTxId = txId;
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();
        await Payment.create({
            txId,
            from: "Paiement vérifié",
            to: MILTAPE_WALLET,
            amount: player.bet,
            verified: true,
            gameId: player.gameId,
            token: player.token
        });
        io.emit("payment:verified", {
            verified: true,
            wallet: player.wallet,
            amount: player.bet,
            playerName: player.name,
            token: player.token
        });
        res.json({ success: true, verified: true });
    } catch (error) {
        console.error("❌ /api/payment/verify :", error?.message || error);
        if (error?.code === 11000) return res.status(400).json({ success: false, message: "Transaction déjà utilisée." });
        return res.status(500).json({ success: false, message: "Erreur lors de la vérification du paiement." });
    }
});

app.post("/api/demo/verify", async (req, res) => {
    try {
        if (!DEMO_MODE_ENABLED_ON_SERVER) return res.status(403).json({ success: false, message: "Mode démo désactivé." });
        const { playerId } = req.body;
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
        player.paid = true;
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();
        io.emit("payment:verified", {
            verified: true,
            demo: true,
            wallet: player.wallet,
            amount: player.bet,
            playerName: player.name,
            token: player.token
        });
        res.json({ success: true, verified: true, demo: true });
    } catch (error) {
        console.error("❌ /api/demo/verify :", error?.message || error);
        res.status(500).json({ success: false, message: "Erreur mode démo." });
    }
});

app.get("/api/game", async (req, res) => {
    try {
        const players = game.id
            ? await Player.find({ gameId: game.id })
                .select("name taps wallet bet paid token")
                .sort({ taps: -1 })
                .limit(50)
                .lean()
            : [];
        res.json({ success: true, game: getGameStateObject(), players });
    } catch (error) {
        console.error("❌ /api/game :", error?.message || error);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        gameStatus: game.status,
        gameId: game.id,
        remainingSeconds: getRemainingSeconds(),
        online: onlineSockets.size,
        mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
    });
});

// ============================================================
// DÉMARRAGE DU SERVEUR (avec création initiale du jackpot)
// ============================================================
async function startServer() {
    try {
        await connectMongoDB();

        // === CRÉATION DU JACKPOT DE LA SEMAINE S'IL N'EXISTE PAS ===
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        const existingJackpot = await Jackpot.findOne({ weekStart });
        if (!existingJackpot) {
            await Jackpot.create({
                weekStart,
                weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
                accumulatedFund: 0,
                drawn: false
            });
            console.log("✅ Jackpot initialisé (0 USDT)");
        } else {
            console.log("✅ Jackpot existant trouvé.");
        }

        server.listen(PORT, async () => {
            console.log("🚀 BACKEND ONLINE");
            console.log(`🌐 Port : ${PORT}`);
            console.log(`🎮 Durée partie : ${GAME_DURATION_SECONDS}s`);
            console.log(`💬 Chat Socket.IO : ACTIF`);
            console.log(`⏱️ Chrono Socket.IO : ACTIF`);
            console.log(`💰 Paiements auto : ACTIFS`);
            console.log(`🏆 Jackpot hebdomadaire (meilleur tapeur) : ACTIF`);

            try { await startGame(); } catch (error) { console.error("❌ Erreur démarrage partie :", error?.message || error); }
        });
    } catch (error) {
        console.error("❌ Impossible de démarrer :", error?.message || error);
        process.exit(1);
    }
}

startServer();

// ============================================================
// SIGTERM — RAILWAY
// ============================================================
process.on("SIGTERM", async () => {
    console.log("🛑 SIGTERM reçu. Fermeture propre...");
    if (gameTimer) clearTimeout(gameTimer);
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    try {
        await new Promise((resolve) => server.close(() => { console.log("🔌 Serveur fermé."); resolve(); }));
        await mongoose.connection.close();
        console.log("✅ Fermeture propre terminée.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Erreur lors de la fermeture :", error?.message || error);
        process.exit(1);
    }
});
