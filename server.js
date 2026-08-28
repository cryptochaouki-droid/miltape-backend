const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

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
app.use(express.static(__dirname));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Trop de requêtes." } });
app.use("/api/", limiter);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ Mongoose connecté."));
mongoose.connection.on("error", (err) => console.error("❌ Mongoose erreur :", err?.message || err));

// ✅ CORRECTION 1 : On retire `default: null` pour éviter que MongoDB bloque les insertions multiples
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

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, connectTimeoutMS: 10000 });
        console.log("✅ MongoDB connecté.");
    } catch (error) { console.error("❌ MongoDB erreur :", error?.message || error); process.exit(1); }
}

function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) { try { return tronWeb.isAddress(normalizeWallet(address)); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) { const controller = new AbortController(); const id = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(id); } }

let gameTimer = null, nextGameTimeout = null;
const onlineSockets = new Set();
let game = { 
    id: null, 
    status: "waiting", 
    startedAt: null, 
    endsAt: null, 
    durationSeconds: GAME_DURATION_SECONDS,
    preparationEndsAt: null 
};

function getRemainingSeconds() {
    if (game.status === "preparing" && game.preparationEndsAt) {
        return Math.max(0, Math.ceil((game.preparationEndsAt.getTime() - Date.now()) / 1000));
    }
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
        durationSeconds: game.status === "preparing" ? PREPARATION_DURATION_SECONDS : game.durationSeconds,
        preparationEndsAt: game.preparationEndsAt
    }; 
}

function broadcastTimer() {
    if (!game.id) return;
    io.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
}

function broadcastOnlineCount() {
    const count = onlineSockets.size;
    console.log(`👥 Joueurs en ligne : ${count}`);
    io.emit("online:count", { count });
}

async function emitLeaderboard() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps").sort({ taps: -1 }).limit(50).lean();
        io.emit("leaderboard:update", players.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps })));
    } catch (error) { console.error("❌ Erreur emitLeaderboard :", error?.message || error); }
}

async function emitTotalStakes() {
    try {
        const result = await Player.aggregate([{ $match: { gameId: game.id } }, { $group: { _id: null, total: { $sum: "$bet" } } }]);
        const totalStakes = result.length > 0 ? result[0].total : 0;
        io.emit("totalStakes:update", { totalStakes });
    } catch (error) { console.error("❌ Erreur emitTotalStakes :", error?.message || error); }
}

async function broadcastGameState() {
    try {
        if (!game.id) return;
        const players = await Player.find({ gameId: game.id }).select("name taps wallet bet paid token depositAmount").sort({ taps: -1 }).limit(50).lean();
        io.emit("game:state", { game: getGameStateObject(), players });
        await emitLeaderboard();
        await emitTotalStakes(); 
    } catch (error) { console.error("❌ Erreur broadcastGameState :", error?.message || error); }
}

function getNextSaturday() { const now = new Date(); const day = now.getDay(); const diff = (6 - day + 7) % 7; const next = new Date(now); next.setDate(now.getDate() + diff); next.setHours(0, 0, 0, 0); if (day === 6 && now.getHours() >= 0) next.setDate(next.getDate() + 7); return next.getTime(); }

async function emitJackpotUpdate() {
    try {
        const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        let jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot) jackpot = await Jackpot.create({ weekStart, weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), accumulatedFund: 0, drawn: false });
        io.emit("jackpot:update", { prize: jackpot ? jackpot.accumulatedFund : 0, nextDraw: getNextSaturday() });
    } catch (error) { console.error("❌ Erreur jackpot :", error?.message || error); }
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

async function sendPrizeToWinner(historyEntry) {
    try {
        const { wallet, gain, token, playerName } = historyEntry;
        if (!wallet || gain <= 0) return false;
        if (!isValidTronAddress(wallet)) return false;
        const tokenInfo = SUPPORTED_TOKENS[token];
        if (!tokenInfo) throw new Error("Token non supporté");
        let txId = null;
        if (token === "TRX") { const tx = await tronWeb.trx.sendTransaction(wallet, Math.floor(gain * 1e6)); txId = tx.txid; }
        else { const contract = await tronWeb.contract().at(tokenInfo.contract); const tx = await contract.transfer(wallet, Math.floor(gain * Math.pow(10, tokenInfo.decimals))).send(); txId = tx.txid; }
        console.log(`✅ Gain de ${gain} ${token} envoyé à ${playerName}`);
        return txId;
    } catch (error) { console.error("❌ Erreur envoi gain :", error?.message); return null; }
}

async function startPreparationPhase() {
    console.log("⏳ Démarrage de la phase de préparation (2 minutes)...");
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    game.id = generateGameId();
    game.status = "preparing";
    game.startedAt = new Date();
    game.endsAt = null;
    game.preparationEndsAt = new Date(Date.now() + PREPARATION_DURATION_SECONDS * 1000);

    io.emit("game:preparing", { gameId: game.id, preparationEndsAt: game.preparationEndsAt, duration: PREPARATION_DURATION_SECONDS });
    broadcastTimer();

    gameTimer = setTimeout(() => {
        beginActualGame().catch((error) => console.error("❌ Erreur démarrage jeu :", error?.message || error));
    }, PREPARATION_DURATION_SECONDS * 1000);

    try { await broadcastGameState(); await emitJackpotUpdate(); } catch (error) { console.error("❌ Erreur post-préparation :", error?.message || error); }
}

async function beginActualGame() {
    if (game.status !== "preparing") return;
    console.log("🚀 Le jeu commence ! (10 minutes)");
    game.status = "running";
    game.startedAt = new Date();
    game.endsAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
    game.preparationEndsAt = null;

    io.emit("game:started", { gameId: game.id, startsAt: game.startedAt, endsAt: game.endsAt, duration: GAME_DURATION_SECONDS, remainingSeconds: GAME_DURATION_SECONDS });
    broadcastTimer();

    gameTimer = setTimeout(() => { finishGame().catch((error) => console.error("❌ finishGame :", error?.message || error)); }, GAME_DURATION_SECONDS * 1000);

    try { await broadcastGameState(); await emitJackpotUpdate(); } catch (error) { console.error("❌ Erreur post-démarrage :", error?.message || error); }
}

async function finishGame() {
    if (game.status !== "running") return;
    console.log("🏁 Fin de la partie...");
    game.status = "finished";
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    broadcastTimer();

    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    nextGameTimeout = setTimeout(() => { startPreparationPhase().catch((error) => console.error("❌ Erreur nouvelle partie :", error?.message || error)); }, 10000);

    try {
        const players = await Player.find({ gameId: game.id, paid: true }).sort({ taps: -1 });
        if (players.length === 0) {
            io.emit("game:finished", { gameId: game.id, winners: [] });
            io.emit("chat:message", { name: "🏆 Système", message: "🏁 La partie est terminée ! Aucun gagnant.", createdAt: new Date() });
            game.status = "waiting"; game.startedAt = null; game.endsAt = null; broadcastTimer(); return;
        }
        const isDemoGame = players.some(p => p.paymentTxId && p.paymentTxId.startsWith('DEMO_'));
        const totalPot = players.reduce((sum, p) => sum + Number(p.bet || 0), 0);
        const topPlayers = players.slice(0, 5);
        const winners = [];
        let totalGains = 0;
        for (let i = 0; i < topPlayers.length; i++) {
            const p = topPlayers[i]; const gain = Number((p.bet * 2).toFixed(6)); totalGains += gain;
            const history = await History.create({ playerId: p._id, playerName: p.name, wallet: p.wallet, gameId: game.id, rank: i + 1, bet: p.bet, gain, taps: p.taps, token: p.token, paidOut: false });
            winners.push({ player: p, gain, history });
        }
        let serverProfit = totalPot - totalGains; let jackpotDeduction = 0;
        if (!isDemoGame) { jackpotDeduction = totalPot * JACKPOT_PERCENT; serverProfit = totalPot - totalGains - jackpotDeduction; }

        if (isDemoGame) {
            console.log("🎉 MODE DÉMO : Aucun paiement réel effectué.");
            for (const { player, gain, history } of winners) { history.paidOut = true; history.payoutTxId = "DEMO_TX_" + Date.now().toString(36); await history.save(); }
        } else {
            for (const { player, gain, history } of winners) {
                try { const txId = await sendPrizeToWinner({ wallet: player.wallet, gain, token: player.token, playerName: player.name }); if (txId) { history.paidOut = true; history.payoutTxId = txId; await history.save(); } } catch (e) { console.error(e); }
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        const winnersList = topPlayers.map((p, i) => ({ rank: i + 1, name: p.name, taps: p.taps, bet: p.bet, token: p.token, gain: Number((p.bet * 2).toFixed(6)) }));
        io.emit("game:finished", { gameId: game.id, winners: winnersList });
        io.emit("chat:message", { name: "🏆 Système", message: `🏁 La partie est terminée ! ${winnersList.length} gagnants !`, createdAt: new Date() });
        game.status = "waiting"; game.startedAt = null; game.endsAt = null; broadcastTimer();
    } catch (error) { console.error("❌ Erreur finishGame :", error?.message || error); game.status = "waiting"; game.startedAt = null; game.endsAt = null; broadcastTimer(); }
}

async function getIncomingTrxTransactions(address) {
    try { const url = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=20&order_by=block_timestamp,desc`; const res = await fetchWithTimeout(url, { headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} }); if (!res.ok) return []; const data = await res.json(); return data.data || []; } catch (error) { return []; }
}
async function getIncomingTrc20Transactions(address) {
    try { const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&order_by=block_timestamp,desc`; const res = await fetchWithTimeout(url, { headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} }); if (!res.ok) return []; const data = await res.json(); return data.data || []; } catch (error) { return []; }
}

async function checkPendingPayments() {
    if (game.status !== "preparing" && game.status !== "running") return;
    try {
        const unpaidPlayers = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null } });
        if (unpaidPlayers.length === 0) return;
        const allTransactions = [...(await getIncomingTrxTransactions(MILTAPE_WALLET)), ...(await getIncomingTrc20Transactions(MILTAPE_WALLET))];
        for (const tx of allTransactions) {
            const txId = tx.transaction_id || tx.txID; if (!txId) continue;
            let token = null, amount = 0;
            if (tx.token_info) { token = String(tx.token_info.symbol || "").toUpperCase(); amount = Number(tx.value) / Math.pow(10, Number(tx.token_info.decimals || 6)); }
            else if (tx.raw_data?.contract?.[0]) { if (tx.raw_data.contract[0].type !== "TransferContract") continue; const value = tx.raw_data.contract[0].parameter?.value; if (!value) continue; const recipient = tronWeb.address.fromHex(value.to_address); if (!sameWallet(recipient, MILTAPE_WALLET)) continue; token = "TRX"; amount = Number(value.amount) / 1e6; }
            if (!SUPPORTED_TOKENS[token]) continue;
            const matchingPlayer = unpaidPlayers.find(p => p.token === token && Math.abs(amount - Number(p.depositAmount)) < 0.0000001 && !p.paymentTxId?.startsWith('DEMO_'));
            if (!matchingPlayer) continue;
            const alreadyUsed = await Payment.findOne({ txId }); if (alreadyUsed) continue;
            matchingPlayer.paid = true; matchingPlayer.paymentTxId = txId; matchingPlayer.depositAmount = null; matchingPlayer.depositExpiresAt = null; await matchingPlayer.save();
            await Payment.create({ txId, from: "Détecté", to: MILTAPE_WALLET, amount, verified: true, gameId: game.id, token });
            io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name, token });
            io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`, createdAt: new Date() });
        }
    } catch (error) { console.error("❌ Erreur checkPendingPayments :", error?.message || error); }
}

async function verifyOnChain(txId, expectedAmount, token = "USDT") {
    try {
        const tx = await tronWeb.trx.getTransaction(txId); if (!tx) return false;
        const contract = tx.raw_data?.contract?.[0]; if (!contract) return false;
        let amount = 0;
        if (token === "TRX") {
            if (contract.type !== "TransferContract") return false;
            const value = contract.parameter?.value; if (!value) return false;
            const recipient = tronWeb.address.fromHex(value.to_address); if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            amount = Number(value.amount) / 1e6;
        } else {
            if (contract.type !== "TriggerSmartContract") return false;
            const value = contract.parameter?.value; if (!value) return false;
            const contractAddress = tronWeb.address.fromHex(value.contract_address); if (!sameWallet(contractAddress, SUPPORTED_TOKENS[token].contract)) return false;
            const data = String(value.data || ""); if (data.length < 136) return false;
            const recipient = tronWeb.address.fromHex("41" + data.substring(32, 72)); if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
            const rawAmount = BigInt("0x" + data.substring(72, 136)); amount = Number(rawAmount) / Math.pow(10, SUPPORTED_TOKENS[token].decimals);
        }
        const txInfo = await tronWeb.trx.getTransactionInfo(txId); if (!txInfo || txInfo.receipt?.result !== "SUCCESS") return false;
        return Math.abs(amount - Number(expectedAmount)) < 0.0000001;
    } catch (e) { return false; }
}

io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log(`🟢 Connexion Socket : ${socket.id}`);

    socket.on("online:count", () => socket.emit("online:count", { count: onlineSockets.size }));
    
    socket.on("player:restore", async (data) => {
        try {
            const player = await Player.findById(data.playerId);
            if (player && (player.gameId === game.id)) { 
                socket.data.playerId = player._id.toString();
                socket.data.gameId = player.gameId;
                socket.data.playerName = player.name;
                socket.emit("player:restored", { success: true, player });
            } else { socket.emit("player:restored", { success: false }); }
        } catch (e) { socket.emit("player:restored", { success: false }); }
    });

    broadcastOnlineCount();
    socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt });
    try { await broadcastGameState(); await emitJackpotUpdate(); } catch (e) { console.error(e); }

    socket.on("jackpot:get", () => { emitJackpotUpdate().catch(err => console.error(err)); });
    socket.on("timer:request", () => { socket.emit("timer:update", { gameId: game.id, status: game.status, remainingSeconds: getRemainingSeconds(), endsAt: game.endsAt || game.preparationEndsAt }); });

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim().toUpperCase();

            if (!game.id) return socket.emit("error", { message: "La partie n'est pas encore disponible." });
            if (!name || !isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token]) return socket.emit("error", { message: "Données invalides." });

            let player = null;
            if (deviceId) player = await Player.findOne({ gameId: game.id, deviceId });
            else player = await Player.findOne({ gameId: game.id, wallet });

            if (!player) {
                player = await Player.create({ gameId: game.id, name, wallet, deviceId, taps: 0, weeklyTaps: 0, bet, paid: false, token, depositAmount: bet, depositExpiresAt: new Date(Date.now() + 10 * 60 * 1000) });
            } else {
                player.name = name; player.wallet = wallet; player.bet = bet; player.token = token;
                player.paid = false; 
                // ✅ CORRECTION 2 : On retire le champ paymentTxId du document en mettant undefined au lieu de null
                player.paymentTxId = undefined;
                player.depositAmount = bet; player.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.playerName = player.name;

            socket.emit("player:joined", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token, depositAmount: player.depositAmount }, game: getGameStateObject() });
            await broadcastGameState();
        } catch (error) { console.error("❌ player:join :", error?.message || error); socket.emit("error", { message: "Impossible de rejoindre la partie." }); }
    });

    socket.on("player:tap", async () => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId || game.status !== "running") return;
            const result = await Player.findOneAndUpdate({ _id: playerId, gameId: game.id, paid: true }, { $inc: { taps: 1, weeklyTaps: 1 } }, { new: true }).select("name taps");
            if (!result) return;
            io.emit("player:score", { taps: result.taps });
            await emitLeaderboard();
        } catch (error) { console.error("❌ player:tap :", error?.message || error); }
    });

    socket.on("chat:send", async (data) => {
        try {
            const name = socket.data.playerName || "Anonyme";
            const message = String(data?.message || "").trim().substring(0, 300);
            if (!message) return;
            const msg = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: msg._id, name, message, createdAt: msg.createdAt });
        } catch (error) { console.error("❌ chat:send :", error?.message || error); }
    });

    socket.on("disconnect", async () => { onlineSockets.delete(socket.id); console.log(`🔴 Déconnexion Socket : ${socket.id}`); broadcastOnlineCount(); try { await broadcastGameState(); } catch (e) { console.error(e); } });
});

setInterval(() => {
    if (game.status !== "preparing" && game.status !== "running") return;
    const now = new Date();
    Player.updateMany({ gameId: game.id, paid: false, depositExpiresAt: { $lt: now } }, { $set: { depositExpiresAt: null, depositAmount: null, bet: 0 } }).catch((error) => console.error("❌ Erreur timeout paiement :", error?.message || error));
}, 60 * 1000);

setInterval(() => {
    if (game.status === "preparing" || game.status === "running") broadcastTimer();
}, 1000);

let paymentCheckRunning = false;
setInterval(async () => {
    if (paymentCheckRunning) return;
    paymentCheckRunning = true;
    try { await checkPendingPayments(); } catch (error) { console.error("❌ Erreur check paiements :", error?.message || error); } finally { paymentCheckRunning = false; }
}, 15000);

setInterval(() => { emitJackpotUpdate().catch(err => console.error("Erreur maj jackpot :", err)); }, 60 * 1000);

app.get("/api/wallet", (req, res) => res.json({ success: true, wallet: MILTAPE_WALLET }));

app.post("/api/payment/verify", async (req, res) => {
    try {
        const { txId, playerId, expectedAmount, token } = req.body;
        if (!txId || !playerId || !expectedAmount) return res.status(400).json({ success: false, error: "Données manquantes." });
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, error: "Joueur introuvable." });
        const alreadyUsed = await Payment.findOne({ txId });
        if (alreadyUsed) return res.status(400).json({ success: false, error: "Cette transaction a déjà été utilisée." });
        
        const tokenName = token || player.token || "USDT";
        const isValid = await verifyOnChain(txId, expectedAmount, tokenName);
        if (!isValid) return res.status(400).json({ success: false, error: "Transaction invalide ou montant incorrect." });

        player.paid = true;
        player.paymentTxId = txId;
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();

        await Payment.create({ txId, from: player.wallet, to: MILTAPE_WALLET, amount: expectedAmount, verified: true, gameId: game.id, token: tokenName });
        io.emit("payment:verified", { verified: true, wallet: player.wallet, amount: expectedAmount, playerName: player.name, token: tokenName });
        io.emit("chat:message", { name: "🟢 Système", message: `✅ ${player.name} a validé son paiement de ${expectedAmount} ${tokenName}`, createdAt: new Date() });
        await broadcastGameState();
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.post("/api/demo/verify", async (req, res) => {
    if (!DEMO_MODE_ENABLED_ON_SERVER) return res.status(403).json({ success: false, error: "Mode démo désactivé." });
    try {
        const { playerId } = req.body;
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, error: "Joueur introuvable." });
        
        player.paid = true;
        player.paymentTxId = "DEMO_" + Date.now();
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();

        io.emit("payment:verified", { verified: true, wallet: player.wallet, amount: player.bet, playerName: player.name, token: player.token });
        io.emit("chat:message", { name: "🎮 Démo", message: `🚀 ${player.name} a rejoint la partie en mode DÉMO !`, createdAt: new Date() });
        await
