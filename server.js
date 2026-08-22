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

const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN441q1LZ", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhRZL4Ciao6eb6yA3xHPPzLtNQvXsHq", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";
const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20;
const JACKPOT_HOUR = 20;

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;
const onlineSockets = new Set();
const spectatorSockets = new Set();
let processedTxIds = new Set();

let game = { id: null, status: "waiting", startedAt: null, endsAt: null, durationSeconds: GAME_DURATION_SECONDS };

if (!MONGODB_URI) { console.error("❌ MONGO_URI manque."); process.exit(1); }
if (!PRIVATE_KEY) { console.error("❌ MILTAPE_PRIVATE_KEY manque."); process.exit(1); }

try {
    tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io", headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}, privateKey: PRIVATE_KEY });
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
} catch (error) { console.error("❌ Erreur TronWeb :", error.message); process.exit(1); }

const app = express();
const server = http.createServer(app);
app.use(helmet());

const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io/miltape-backend";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

app.get("/api/status", (req, res) => res.json({ success: true, service: "Miltape Backend", server: "online", mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected", tron: tronWeb ? "connected" : "disconnected", wallet: MILTAPE_WALLET, gameId: game.id || null, status: game.status, timerLeft: 0, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, supportedTokens: Object.keys(SUPPORTED_TOKENS) }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === '/api/status' });
app.use('/api/', limiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"], credentials: true } });
mongoose.set("strictQuery", true);

const playerSchema = new mongoose.Schema({ gameId: { type: String, required: true, index: true }, name: { type: String, required: true, trim: true, maxlength: 30 }, wallet: { type: String, required: true, trim: true, index: true }, taps: { type: Number, default: 0, min: 0 }, bet: { type: Number, default: 0, min: 0 }, paid: { type: Boolean, default: false }, paymentTxId: { type: String, default: null }, token: { type: String, default: 'USDT' } }, { timestamps: true });
const messageSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 30 }, message: { type: String, required: true, trim: true, maxlength: 300 }, gameId: { type: String, default: null } }, { timestamps: true });
const paymentSchema = new mongoose.Schema({ txId: { type: String, required: true, unique: true, index: true }, from: { type: String, required: true }, to: { type: String, required: true }, amount: { type: Number, required: true }, verified: { type: Boolean, default: false }, gameId: { type: String, default: null }, token: { type: String, default: 'USDT' } }, { timestamps: true });
const historySchema = new mongoose.Schema({ playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true }, playerName: { type: String, required: true }, wallet: { type: String, required: true }, gameId: { type: String, required: true }, rank: { type: Number, required: true }, bet: { type: Number, required: true }, gain: { type: Number, required: true }, taps: { type: Number, required: true }, token: { type: String, default: 'USDT' }, createdAt: { type: Date, default: Date.now } }, { timestamps: true });
const jackpotSchema = new mongoose.Schema({ weekStart: { type: Date, required: true }, weekEnd: { type: Date, required: true }, prize: { type: Number, default: 0 }, accumulatedFund: { type: Number, default: 0 }, winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null }, drawn: { type: Boolean, default: false }, participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }] }, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB connecté.")).catch((error) => { console.error("❌ MongoDB erreur :", error.message); process.exit(1); });

function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) { const wallet = normalizeWallet(address); if (!wallet) return false; try { return tronWeb.isAddress(wallet); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
function getRemainingSeconds() { if (game.status !== "running" || !game.endsAt) return 0; return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)); }

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

async function sendTokenToWinner(wallet, amount, token = 'USDT') {
    if (!tronWeb || amount <= 0) return;
    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error(`Token non supporté : ${token}`);
    try {
        if (token === 'TRX') { const result = await tronWeb.trx.sendTransaction(wallet, amount * 1e6); console.log(`✅ ${amount} TRX envoyé à ${wallet} – TX: ${result}`); return result; }
        else { const contract = await tronWeb.contract().at(tokenInfo.contract); const amountInSun = tronWeb.toBigNumber(amount * Math.pow(10, tokenInfo.decimals)); const tx = await contract.transfer(wallet, amountInSun); console.log(`✅ ${amount} ${token} envoyé à ${wallet} – TX: ${tx}`); return tx; }
    } catch (error) { console.error(`❌ Erreur transfert ${token} :`, error.message); throw error; }
}

async function getCurrentJackpot() {
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    let jackpot = await Jackpot.findOne({ weekStart: { $gte: start, $lte: now }, weekEnd: { $gte: now, $lte: end } });
    if (!jackpot) { jackpot = await Jackpot.create({ weekStart: start, weekEnd: end, prize: 0, accumulatedFund: 0, drawn: false, participants: [] }); }
    return jackpot;
}

async function addToJackpotFund(serverProfit) {
    if (serverProfit <= 0) return;
    const jackpot = await getCurrentJackpot(); if (!jackpot || jackpot.drawn) return;
    const contribution = Math.round(serverProfit * (JACKPOT_PERCENT / 100) * 100) / 100; if (contribution <= 0) return;
    jackpot.accumulatedFund += contribution; jackpot.prize = jackpot.accumulatedFund; await jackpot.save();
    io.emit("chat:message", { name: "💰 Cagnotte", message: `🎯 ${contribution} USDT ajoutés !`, createdAt: new Date() });
    await emitJackpotUpdate();
}

function getNextSaturday() {
    const now = new Date(); const nextSat = new Date(now); nextSat.setDate(now.getDate() + (6 - now.getDay())); nextSat.setHours(JACKPOT_HOUR, 0, 0, 0);
    if (nextSat < now) nextSat.setDate(nextSat.getDate() + 7); return nextSat.getTime();
}

async function emitJackpotUpdate() {
    const jackpot = await getCurrentJackpot(); if (!jackpot) return;
    let winnerName = null; if (jackpot.winner) { const winner = await Player.findById(jackpot.winner).select('name'); if (winner) winnerName = winner.name; }
    io.emit("jackpot:update", { prize: jackpot.prize, participants: jackpot.participants.length, nextDraw: getNextSaturday(), drawn: jackpot.drawn, winner: winnerName });
}

async function drawJackpot() {
    const jackpot = await getCurrentJackpot(); if (!jackpot || jackpot.drawn) return;
    if (jackpot.participants.length === 0) { jackpot.drawn = true; jackpot.prize = 0; jackpot.accumulatedFund = 0; await jackpot.save(); await emitJackpotUpdate(); return; }
    const randomIndex = Math.floor(Math.random() * jackpot.participants.length); const winnerId = jackpot.participants[randomIndex]; const winner = await Player.findById(winnerId); const prizeAmount = jackpot.accumulatedFund;
    jackpot.winner = winnerId; jackpot.drawn = true; jackpot.prize = 0; jackpot.accumulatedFund = 0; await jackpot.save();
    io.emit("notification:new", { type: 'jackpot', message: `🎁 CAGNOTTE ! ${winner.name} remporte ${prizeAmount} USDT !`, data: { winner: winner.name, prize: prizeAmount } });
    io.emit("chat:message", { name: "🎁 Cagnotte", message: `🏆 ${winner.name} gagne ${prizeAmount} USDT !`, createdAt: new Date() });
    if (winner && prizeAmount > 0) await sendTokenToWinner(winner.wallet, prizeAmount, 'USDT'); await emitJackpotUpdate();
}

async function checkPendingPayments() {
    if (game.status !== "running") return;
    try {
        const unpaidPlayers = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 } }); if (unpaidPlayers.length === 0) return;
        const transactions = await tronWeb.trx.getAccountTransactions(MILTAPE_WALLET, { limit: 30, onlyConfirmed: true }); if (!transactions || transactions.length === 0) return;
        for (const tx of transactions) {
            const txId = tx.txID; if (processedTxIds.has(txId)) continue;
            const txInfo = await tronWeb.trx.getTransactionInfo(txId); if (!txInfo || txInfo.receipt.result !== 'SUCCESS') continue;
            const transaction = await tronWeb.trx.getTransaction(txId); if (!transaction) continue;
            const contracts = transaction.raw_data?.contract; if (!Array.isArray(contracts) || contracts.length !== 1) continue; const contract = contracts[0];
            let token = null, ownerAddress = null, amount = 0, decimals = 6;
            if (contract.type === "TransferContract") { token = 'TRX'; const value = contract.parameter.value; ownerAddress = tronWeb.address.fromHex(value.owner_address); amount = value.amount / 1e6; const recipient = tronWeb.address.fromHex(value.to_address); if (!sameWallet(recipient, MILTAPE_WALLET)) continue; }
            else if (contract.type === "TriggerSmartContract") { const value = contract.parameter?.value; if (!value) continue; const contractAddress = tronWeb.address.fromHex(value.contract_address); let foundToken = null; for (const [sym, info] of Object.entries(SUPPORTED_TOKENS)) { if (info.contract && sameWallet(contractAddress, info.contract)) { foundToken = sym; decimals = info.decimals; break; } } if (!foundToken) continue; token = foundToken; ownerAddress = tronWeb.address.fromHex(value.owner_address); const data = String(value.data || "").toLowerCase(); if (!data.startsWith("a9059cbb")) continue; if (data.length < 136) continue; const recipientHex = "41" + data.substring(32, 72); const recipient = tronWeb.address.fromHex(recipientHex); if (!sameWallet(recipient, MILTAPE_WALLET)) continue; const amountHex = data.substring(72, 136); const rawAmount = BigInt("0x" + amountHex); amount = Number(rawAmount) / Math.pow(10, decimals); } else continue;
            const matchingPlayer = unpaidPlayers.find(p => sameWallet(p.wallet, ownerAddress) && p.bet > 0 && p.token === token && amount >= p.bet); if (!matchingPlayer) continue;
            matchingPlayer.paid = true; matchingPlayer.paymentTxId = txId; await matchingPlayer.save(); processedTxIds.add(txId); await Payment.create({ txId, from: ownerAddress, to: MILTAPE_WALLET, amount, verified: true, gameId: game.id, token });
            io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name, automatic: true, token });
            io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`, createdAt: new Date() });
            sendNotification('success', `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`, { playerName: matchingPlayer.name, amount: matchingPlayer.bet, token });
            console.log(`💰 Paiement auto : ${matchingPlayer.name}`);
        }
    } catch (error) { console.error("❌ Erreur vérification auto paiements :", error.message); }
}
setInterval(() => { if (processedTxIds.size > 1000) processedTxIds.clear(); }, 60 * 60 * 1000);

async function startGame() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    game = { id: generateGameId(), status: "running", startedAt: Date.now(), endsAt: Date.now() + GAME_DURATION_SECONDS * 1000, durationSeconds: GAME_DURATION_SECONDS };
    console.log("🎮 NOUVELLE PARTIE :", game.id); await broadcastGameState();
    gameTimer = setInterval(async () => { try { const remaining = getRemainingSeconds(); io.emit("timer:update", { remainingSeconds: remaining, status: game.status }); if (remaining === 60) sendNotification('warning', `⏱️ DERNIÈRE MINUTE !`); if (remaining <= 0) await finishGame(); } catch (error) { console.error("gameTimer:", error.message); } }, 1000);
}

async function finishGame() {
    if (game.status !== "running") return; game.status = "finished"; if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    const allPlayers = await Player.find({ gameId: game.id }).lean(); const top5 = await Player.find({ gameId: game.id }).sort({ taps: -1 }).limit(5).lean(); const totalStakes = allPlayers.reduce((sum, p) => sum + p.bet, 0);
    const winners = top5.map((p, index) => ({ rank: index + 1, name: p.name, wallet: p.wallet, bet: p.bet, gain: p.bet * 2, taps: p.taps, _id: p._id, token: p.token || 'USDT' }));
    const totalPayout = winners.reduce((sum, w) => sum + w.gain, 0); const deficit = totalPayout - totalStakes; const serverProfit = deficit > 0 ? 0 : Math.abs(deficit);
    console.log("🏁 PARTIE TERMINÉE :", game.id, "| Bénéfice:", serverProfit);
    if (serverProfit > 0) await addToJackpotFund(serverProfit);
    for (const w of winners) { await Player.findByIdAndUpdate(w._id, { paid: true }); await History.create({ playerId: w._id, playerName: w.name, wallet: w.wallet, gameId: game.id, rank: w.rank, bet: w.bet, gain: w.gain, taps: w.taps, token: w.token }); }
    io.emit("game:finished", { gameId: game.id, winners, totalStakes, totalPayout, deficit, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size });
    winners.forEach((w, i) => { const emoji = i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅'; sendNotification('champion', `${emoji} #${w.rank} ${w.name} → ${w.gain} USDT !`, { winner: w }); });
    sendNotification('alert', `⏰ Partie terminée ! Prochaine partie dans 5 secondes...`);
    const realPayments = await Payment.find({ gameId: game.id, verified: true }); if (realPayments.length > 0) { console.log("💸 Envoi des gains..."); for (const w of winners) { if (w.gain > 0) await sendTokenToWinner(w.wallet, w.gain, w.token); } } else { console.log("🔬 Mode démo : transferts simulés."); }
    await broadcastGameState(); await emitJackpotUpdate();
    if (nextGameTimeout) clearTimeout(nextGameTimeout); nextGameTimeout = setTimeout(async () => { nextGameTimeout = null; await startGame(); }, 5000);
}

io.on("connection", async (socket) => {
    onlineSockets.add(socket.id); await broadcastGameState(); await emitJackpotUpdate(); const totalStakes = await getTotalStakes(); socket.emit("totalStakes:update", { totalStakes });
    socket.on("jackpot:get", async () => { await emitJackpotUpdate(); });
    socket.on("player:join", async (data) => { try { const name = String(data?.name || "").trim().substring(0, 30); const wallet = normalizeWallet(data?.wallet); const bet = Number(data?.bet); const token = String(data?.token || "USDT").trim(); if (!name) return socket.emit("error", { message: "Nom invalide." }); if (!isValidTronAddress(wallet)) return socket.emit("error", { message: "Adresse TRON invalide." }); if (!Number.isFinite(bet) || bet <= 0) return socket.emit("error", { message: "Montant invalide." }); if (!SUPPORTED_TOKENS[token]) return socket.emit("error", { message: "Token non supporté." }); if (game.status !== "running") return socket.emit("error", { message: "La partie n'est pas ouverte." }); let player = await Player.findOne({ gameId: game.id, wallet }); if (!player) player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false, token }); else { player.name = name; player.bet = bet; player.token = token; await player.save(); } socket.data.playerId = player._id.toString(); socket.data.gameId = game.id; socket.data.wallet = wallet; socket.data.name = name; socket.data.isSpectator = false; const jackpot = await getCurrentJackpot(); if (jackpot && !jackpot.drawn && !jackpot.participants.includes(player._id)) { jackpot.participants.push(player._id); await jackpot.save(); await emitJackpotUpdate(); } socket.emit("player:joined", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token } }); sendNotification('info', `🎮 ${player.name} a rejoint la partie !`, { playerName: player.name }); await broadcastGameState(); const newTotalStakes = await getTotalStakes(); io.emit("totalStakes:update", { totalStakes: newTotalStakes }); } catch (error) { console.error("player:join:", error.message); socket.emit("error", { message: "Impossible de rejoindre la partie." }); } });
    socket.on("spectator:join", async (data) => { try { const name = String(data?.name || "Spectateur").trim().substring(0, 30); socket.data.isSpectator = true; socket.data.name = name; socket.data.gameId = game.id; spectatorSockets.add(socket.id); socket.emit("spectator:joined", { success: true, name, spectators: spectatorSockets.size }); io.emit("chat:message", { name: "👁️ Système", message: `${name} regarde la partie !`, createdAt: new Date() }); await broadcastGameState(); } catch (error) { console.error("spectator:join:", error.message); socket.emit("error", { message: "Impossible de rejoindre en spectateur." }); } });
    socket.on("player:restore", async (data) => { try { const playerId = data?.playerId; const wallet = normalizeWallet(data?.wallet); if (!playerId && !wallet) return socket.emit("error", { message: "playerId ou wallet requis." }); const query = { gameId: game.id }; if (playerId) query._id = playerId; else query.wallet = wallet; const player = await Player.findOne(query); if (!player) return socket.emit("error", { message: "Joueur introuvable." }); socket.data.playerId = player._id.toString(); socket.data.gameId = game.id; socket.data.wallet = player.wallet; socket.data.name = player.name; socket.data.isSpectator = false; socket.emit("player:restored", { success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token || 'USDT' } }); const leaderboard = await getLeaderboard(); io.emit("leaderboard:update", leaderboard); const totalStakesRestore = await getTotalStakes(); io.emit("totalStakes:update", { totalStakes: totalStakesRestore }); console.log("🔄 Session restaurée :", player.name); } catch (error) { console.error("player:restore:", error.message); socket.emit("error", { message: "Erreur restauration." }); } });

    socket.on("player:tap", async (data) => {
        try { if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return; if (socket.data.isSpectator) return; const tapsToAdd = (data && typeof data.count === 'number' && data.count > 0) ? data.count : 1; await Player.updateOne({ _id: socket.data.playerId, gameId: game.id }, { $inc: { taps: tapsToAdd } }); const updatedPlayer = await Player.findById(socket.data.playerId); if (updatedPlayer) socket.emit("player:score", { taps: updatedPlayer.taps }); } catch (error) { console.error("player:tap:", error.message); }
    });

    socket.on("chat:send", async (data) => { try { const name = String(data?.name || socket.data.name || "Joueur").trim().substring(0, 30); const message = String(data?.message || "").trim().substring(0, 300); if (!message) return; const saved = await Message.create({ name, message, gameId: game.id }); io.emit("chat:message", { id: saved._id, name, message, createdAt: saved.createdAt }); } catch (error) { console.error("chat:send:", error.message); } });
    socket.on("disconnect", async () => { onlineSockets.delete(socket.id); spectatorSockets.delete(socket.id); await broadcastGameState(); });
});

setInterval(async () => { try { if (game.status === "running") { const leaderboard = await getLeaderboard(); io.emit("leaderboard:update", leaderboard); } } catch (error) { console.error("Erreur classement global :", error.message); } }, 2000);

app.post("/api/admin/login", (req, res) => { const { password } = req.body; if (password === ADMIN_PASSWORD) res.json({ success: true, message: "Connecté." }); else res.status(401).json({ success: false, message: "Mot de passe incorrect." }); });
app.get("/api/admin/stats", async (req, res) => { try { const recentPlayers = await Player.find({ gameId: game.id }).sort({ updatedAt: -1 }).limit(20).select('name wallet taps token'); res.json({ success: true, recentPlayers: recentPlayers.map(p => ({ playerName: p.name, playerId: p._id, score: p.taps, wallet: p.wallet, token: p.token || 'USDT' })) }); } catch (error) { console.error("/api/admin/stats:", error.message); res.status(500).json({ success: false, message: error.message }); } });
app.get("/api/admin/payouts", async (req, res) => { try { const winners = await Player.find({ gameId: game.id }).sort({ taps: -1 }).limit(5).select('name wallet taps bet token'); res.json({ success: true, winners: winners.map((p, i) => ({ rank: i + 1, playerName: p.name, wallet: p.wallet, score: p.taps, amount: p.bet || 0, token: p.token || 'USDT' })) }); } catch (error) { console.error("/api/admin/payouts:", error.message); res.status(500).json({ success: false, message: error.message }); } });
app.get("/api/game", async (req, res) => { try { const leaderboard = await getLeaderboard(); res.json({ success: true, gameId: game.id, status: game.status, startedAt: game.startedAt, endsAt: game.endsAt, durationSeconds: game.durationSeconds, remainingSeconds: getRemainingSeconds(), onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, leaderboard }); } catch (error) { console.error("/api/game:", error.message); res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.get("/api/wallet", (req, res) => res.json({ success: true, wallet: MILTAPE_WALLET, usdtContract: SUPPORTED_TOKENS.USDT.contract, supportedTokens: Object.keys(SUPPORTED_TOKENS) }));
app.get("/api/total-stakes", async (req, res) => { try { const totalStakes = await getTotalStakes(); res.json({ success: true, totalStakes }); } catch (error) { console.error("/api/total-stakes:", error.message); res.status(500).json({ success: false, message: error.message }); } });
app.post("/api/join", async (req, res) => { try { const name = String(req.body?.name || "").trim().substring(0, 30); const wallet = normalizeWallet(req.body?.wallet); const bet = Number(req.body?.bet); const token = String(req.body?.token || "USDT").trim(); if (!name) return res.status(400).json({ success: false, message: "Nom invalide." }); if (!isValidTronAddress(wallet)) return res.status(400).json({ success: false, message: "Adresse TRON invalide." }); if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ success: false, message: "Montant invalide." }); if (!SUPPORTED_TOKENS[token]) return res.status(400).json({ success: false, message: "Token non supporté." }); if (game.status !== "running") return res.status(400).json({ success: false, message: "La partie n'est pas ouverte." }); let player = await Player.findOne({ gameId: game.id, wallet }); if (!player) player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false, token }); else { player.name = name; player.bet = bet; player.token = token; await player.save(); } const jackpot = await getCurrentJackpot(); if (jackpot && !jackpot.drawn && !jackpot.participants.includes(player._id)) { jackpot.participants.push(player._id); await jackpot.save(); } res.json({ success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token } }); } catch (error) { console.error("/api/join:", error.message); res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.get("/api/player/status", async (req, res) => { try { const playerId = String(req.query?.playerId || "").trim(); const wallet = normalizeWallet(req.query?.wallet); if (!playerId && !wallet) return res.status(400).json({ success: false, message: "playerId ou wallet requis." }); const query = { gameId: game.id }; if (playerId) query._id = playerId; else query.wallet = wallet; const player = await Player.findOne(query); if (!player) return res.status(404).json({ success: false, message: "Aucun joueur trouvé." }); res.json({ success: true, player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token || 'USDT' } }); } catch (error) { console.error("/api/player/status:", error.message); res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.post("/api/tap", async (req, res) => { try { if (game.status !== "running") return res.status(400).json({ success: false, message: "La partie est terminée." }); const playerId = String(req.body?.playerId || "").trim(); if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." }); const player = await Player.findById(playerId); if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." }); if (player.gameId !== game.id) return res.status(400).json({ success: false, message: "Cette partie est terminée." }); if (getRemainingSeconds() <= 0) return res.status(400).json({ success: false, message: "Le chrono est terminé." }); player.taps += 1; await player.save(); const leaderboard = await getLeaderboard(); io.emit("leaderboard:update", leaderboard); res.json({ success: true, taps: player.taps, leaderboard }); } catch (error) { console.error("/api/tap:", error.message); res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.get("/api/leaderboard", async (req, res) => { try { const leaderboard = await getLeaderboard(); res.json({ success: true, leaderboard }); } catch (error) { res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.get("/api/chat", async (req, res) => { try { const messages = await Message.find({ $or: [{ gameId: game.id }, { gameId: null }] }).sort({ createdAt: -1 }).limit(50).lean(); messages.reverse(); res.json({ success: true, messages }); } catch (error) { console.error("/api/chat:", error.message); res.status(500).json({ success: false, message: "Erreur serveur." }); } });
app.get("/api/online", (req, res) => res.json({ success: true, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size }));
app.get("/api/jackpot", async (req, res) => { try { const jackpot = await getCurrentJackpot(); const nextDraw = getNextSaturday(); let winner = null; if (jackpot.winner) { const w = await Player.findById(jackpot.winner).select('name'); if (w) winner = w.name; } res.json({ success: true, jackpot: { prize: jackpot.prize, participants: jackpot.participants.length, nextDraw: nextDraw, drawn: jackpot.drawn, winner } }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } });
app.get("/api/jackpot/history", async (req, res) => { try { const history = await Jackpot.find({ drawn: true }).sort({ weekEnd: -1 }).limit(20).populate('winner', 'name'); res.json({ success: true, history: history.map(j => ({ week: j.weekStart.toDateString() + ' - ' + j.weekEnd.toDateString(), prize: j.prize, winner: j.winner ? j.winner.name : null })) }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } });
app.post("/api/payment/verify", async (req, res) => { try { const { playerId, amount } = req.body; if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." }); const player = await Player.findByIdAndUpdate(playerId, { paid: true, paymentTxId: "DEMO_" + Date.now() }, { new: true }); if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." }); io.emit("payment:verified", { verified: true, wallet: player.wallet, amount: amount || player.bet, playerName: player.name, automatic: true, token: player.token || 'USDT' }); res.json({ success: true, verified: true, message: "Paiement démo validé." }); } catch (error) { console.error("Erreur /api/payment/verify:", error.message); res.status(500).json({ success: false, message: error.message }); } });
app.get("/api/player/history", async (req, res) => { try { const playerId = String(req.query?.playerId || "").trim(); const wallet = normalizeWallet(req.query?.wallet); if (!playerId && !wallet) return res.status(400).json({ success: false, message: "playerId ou wallet requis." }); const query = {}; if (playerId) query._id = playerId; else query.wallet = wallet; const history = await History.find(query).sort({ createdAt: -1 }).limit(50).lean(); const totalGain = history.reduce((sum, h) => sum + h.gain, 0); const gamesPlayed = history.length; const bestScore = history.length > 0 ? Math.max(...history.map(h => h.taps)) : 0; res.json({ success: true, player: { wallet: wallet || "inconnu", totalGain, gamesPlayed, bestScore }, history: history.map(h => ({ gameId: h.gameId, rank: h.rank, bet: h.bet, gain: h.gain, taps: h.taps, token: h.token || 'USDT', createdAt: h.createdAt })) }); } catch (error) { console.error("Erreur /api/player/history:", error.message); res.status(500).json({ success: false, message: error.message }); } });

app.use((req, res) => res.status(404).json({ success: false, message: "Route introuvable." }));
app.use((error, req, res, next) => { console.error("Express error:", error); res.status(500).json({ success: false, message: "Erreur interne du serveur." }); });

server.listen(PORT, async () => {
    console.log("🚀 BACKEND ONLINE");
    try { await startGame(); } catch (error) { console.error("❌ Impossible de démarrer le jeu :", error.message); }
    setInterval(checkPendingPayments, 15000);
    setInterval(async () => { const now = new Date(); if (now.getDay() === 6 && now.getHours() === JACKPOT_HOUR && now.getMinutes() === 0) await drawJackpot(); }, 60000);
});

async function gracefulShutdown(signal) {
    console.log(`${signal} reçu...`); if (gameTimer) { clearInterval(gameTimer); gameTimer = null; } if (nextGameTimeout) { clearTimeout(nextGameTimeout); nextGameTimeout = null; }
    try { await mongoose.connection.close(); } catch (e) {}
    server.close(() => { console.log("✅ Serveur arrêté."); process.exit(0); });
    setTimeout(() => process.exit(0), 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
