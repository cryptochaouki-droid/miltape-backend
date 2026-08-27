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
    console.error("❌ Erreur TronWeb :", error?.message);
    process.exit(1);
}

// ============================================================
// SERVEUR EXPRESS
// ============================================================
const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use("/api/", limiter);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// ============================================================
// MONGOOSE
// ============================================================
mongoose.set("strictQuery", true);
mongoose.set("bufferTimeoutMS", 10000);
mongoose.connection.on("connected", () => console.log("✅ MongoDB connecté."));
mongoose.connection.on("disconnected", () => console.warn("⚠️ MongoDB déconnecté."));
mongoose.connection.on("error", (err) => console.error("❌ MongoDB erreur :", err?.message));

// ============================================================
// SCHEMAS
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
    token: { type: String, default: "USDT" }
}, { timestamps: true });

const jackpotSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    accumulatedFund: { type: Number, default: 0 },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "Player", default: null },
    drawn: { type: Boolean, default: false }
}, { timestamps: true });

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

// ============================================================
// FONCTIONS UTILES
// ============================================================
function normalizeWallet(a) { return String(a || "").trim(); }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() {
    return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2,8).toUpperCase();
}
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
async function fetchWithTimeout(url, opts={}, timeout=8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// ============================================================
// VARIABLES DE JEU
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

// ============================================================
// BROADCASTS
// ============================================================
function broadcastOnlineCount() {
    io.emit("online:count", { count: onlineSockets.size });
}
async function broadcastGameState() {
    if (!game.id) return;
    try {
        const players = await Player.find({ gameId: game.id })
            .select("name taps wallet bet paid token")
            .sort({ taps: -1 })
            .limit(50)
            .lean();
        io.emit("game:state", { game: getGameStateObject(), players });
    } catch (e) { console.error("broadcastGameState error:", e.message); }
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
// JACKPOT
// ============================================================
function getNextSaturday() {
    const now = new Date();
    const day = now.getDay();
    const diff = (6 - day + 7) % 7;
    const next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setHours(0,0,0,0);
    if (day === 6 && now.getHours() >= 0) next.setDate(next.getDate() + 7);
    return next.getTime();
}
async function emitJackpotUpdate() {
    try {
        const weekStart = new Date();
        weekStart.setHours(0,0,0,0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        let jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot) {
            jackpot = await Jackpot.create({
                weekStart,
                weekEnd: new Date(weekStart.getTime() + 7*24*3600*1000),
                accumulatedFund: 0,
                drawn: false
            });
        }
        const prize = jackpot ? jackpot.accumulatedFund : 0;
        const nextDraw = getNextSaturday();
        io.emit("jackpot:update", { prize, nextDraw });
    } catch (e) { console.error("emitJackpotUpdate error:", e.message); }
}

// ============================================================
// DISTRIBUTION HEBDOMADAIRE (CRON)
// ============================================================
async function distributeWeeklyJackpot() {
    try {
        console.log("🏆 Distribution du jackpot...");
        const weekStart = new Date();
        weekStart.setHours(0,0,0,0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const jackpot = await Jackpot.findOne({ weekStart });
        if (!jackpot || jackpot.drawn || jackpot.accumulatedFund <= 0) {
            console.log("Aucun jackpot à distribuer.");
            return;
        }
        const winner = await Player.findOne({}).sort({ weeklyTaps: -1 }).limit(1).select("name wallet weeklyTaps");
        if (!winner || winner.weeklyTaps === 0) {
            console.log("Aucun gagnant (0 tap).");
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
            message: `🎉 ${winner.name} remporte le jackpot de ${jackpot.accumulatedFund} USDT avec ${winner.weeklyTaps} taps !`,
            createdAt: new Date()
        });
        await Player.updateMany({}, { $set: { weeklyTaps: 0 } });
        console.log(`✅ Jackpot attribué à ${winner.name} (${jackpot.accumulatedFund} USDT)`);
    } catch (e) { console.error("distributeWeeklyJackpot error:", e.message); }
}
cron.schedule('0 0 * * 6', () => {
    console.log("⏰ Planification : distribution du jackpot.");
    distributeWeeklyJackpot().catch(console.error);
});

// ============================================================
// DÉMARRAGE / FIN DE PARTIE
// ============================================================
async function startGame() {
    if (gameTimer) clearTimeout(gameTimer);
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

    gameTimer = setTimeout(() => finishGame().catch(console.error), GAME_DURATION_SECONDS * 1000);
    await broadcastGameState();
    await emitJackpotUpdate();
}
async function finishGame() {
    if (game.status !== "running") return;
    game.status = "finished";
    if (gameTimer) clearTimeout(gameTimer);
    broadcastTimer();

    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    nextGameTimeout = setTimeout(() => startGame().catch(console.error), 10000);

    game.status = "waiting";
    game.startedAt = null;
    game.endsAt = null;
    broadcastTimer();

    try {
        const players = await Player.find({ gameId: game.id, paid: true }).sort({ taps: -1 });
        if (players.length > 0) {
            const totalPot = players.reduce((s, p) => s + Number(p.bet || 0), 0);
            const prizes = [{ share: 0.80 }, { share: 0.15 }, { share: 0.05 }];
            for (let i=0; i<players.length && i<prizes.length; i++) {
                const p = players[i];
                const gain = Number((totalPot * prizes[i].share).toFixed(6));
                await History.create({
                    playerId: p._id,
                    playerName: p.name,
                    wallet: p.wallet,
                    gameId: game.id,
                    rank: i+1,
                    bet: p.bet,
                    gain,
                    taps: p.taps,
                    token: p.token
                });
            }
            const weekStart = new Date();
            weekStart.setHours(0,0,0,0);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            let jackpot = await Jackpot.findOne({ weekStart });
            if (!jackpot) {
                jackpot = await Jackpot.create({
                    weekStart,
                    weekEnd: new Date(weekStart.getTime() + 7*24*3600*1000),
                    accumulatedFund: 0
                });
            }
            jackpot.accumulatedFund = Number(jackpot.accumulatedFund || 0) + totalPot;
            await jackpot.save();
        }
        const winners = players.slice(0,3).map(p => ({ name: p.name, taps: p.taps, bet: p.bet, token: p.token }));
        io.emit("game:finished", { gameId: game.id, winners });
        io.emit("chat:message", { name: "🏆 Système", message: "🏁 La partie est terminée !", createdAt: new Date() });
    } catch (e) { console.error("finishGame error:", e.message); }
}

// ============================================================
// SOCKET.IO
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    broadcastOnlineCount();

    socket.emit("timer:update", {
        gameId: game.id,
        status: game.status,
        remainingSeconds: getRemainingSeconds(),
        endsAt: game.endsAt
    });
    await broadcastGameState();
    await emitJackpotUpdate();

    socket.on("timer:request", () => {
        socket.emit("timer:update", {
            gameId: game.id,
            status: game.status,
            remainingSeconds: getRemainingSeconds(),
            endsAt: game.endsAt
        });
    });
    socket.on("jackpot:get", () => emitJackpotUpdate());

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().slice(0,30);
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").toUpperCase().trim();
            if (!game.id || game.status !== "running") return socket.emit("error", { message: "Partie non disponible." });
            if (!name || !wallet || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token])
                return socket.emit("error", { message: "Données invalides." });

            let player = await Player.findOne({ gameId: game.id, deviceId }) || await Player.findOne({ gameId: game.id, wallet });
            if (!player) {
                player = new Player({
                    gameId: game.id,
                    name,
                    wallet,
                    deviceId,
                    bet,
                    token,
                    taps: 0,
                    weeklyTaps: 0,
                    paid: false,
                    depositAmount: bet + Math.random() * 0.001,
                    depositExpiresAt: new Date(Date.now() + 15*60*1000)
                });
                await player.save();
            } else {
                player.name = name;
                player.wallet = wallet;
                player.bet = bet;
                player.token = token;
                player.paid = false;
                player.depositAmount = bet + Math.random() * 0.001;
                player.depositExpiresAt = new Date(Date.now() + 15*60*1000);
                await player.save();
            }
            socket.data.playerId = player._id.toString();
            socket.emit("player:joined", {
                success: true,
                player: { id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, bet: player.bet, paid: player.paid, token: player.token },
                game: getGameStateObject()
            });
            await broadcastGameState();
        } catch (e) { console.error("player:join error:", e.message); socket.emit("error", { message: "Erreur serveur." }); }
    });

    socket.on("player:tap", async () => {
        try {
            const playerId = socket.data.playerId;
            if (!playerId || game.status !== "running") return;
            const result = await Player.findOneAndUpdate(
                { _id: playerId, gameId: game.id, paid: true },
                { $inc: { taps: 1, weeklyTaps: 1 } },
                { new: true }
            ).select("name taps");
            if (!result) return;
            io.emit("player:update", { id: playerId, name: result.name, taps: result.taps });
        } catch (e) { console.error("player:tap error:", e.message); }
    });

    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || "Anonyme").trim().slice(0,30);
            const message = String(data?.message || "").trim().slice(0,300);
            if (!message) return;
            const msg = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", { id: msg._id, name, message, createdAt: msg.createdAt });
        } catch (e) { console.error("chat:send error:", e.message); }
    });

    socket.on("disconnect", () => {
        onlineSockets.delete(socket.id);
        broadcastOnlineCount();
        broadcastGameState().catch(console.error);
    });
});

// ============================================================
// INTERVALLES
// ============================================================
setInterval(() => broadcastTimer(), 1000);
setInterval(() => emitJackpotUpdate().catch(console.error), 60 * 1000);

// ============================================================
// ROUTES API
// ============================================================
app.post("/api/demo/verify", async (req, res) => {
    if (!DEMO_MODE_ENABLED_ON_SERVER) return res.status(403).json({ success: false });
    try {
        const { playerId } = req.body;
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false });
        player.paid = true;
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();
        io.emit("payment:verified", { verified: true, demo: true, wallet: player.wallet, amount: player.bet, playerName: player.name, token: player.token });
        res.json({ success: true, verified: true, demo: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get("/api/game", async (req, res) => {
    try {
        const players = game.id ? await Player.find({ gameId: game.id }).select("name taps wallet bet paid token").sort({ taps: -1 }).limit(50).lean() : [];
        res.json({ success: true, game: getGameStateObject(), players });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", gameStatus: game.status, online: onlineSockets.size });
});

// ============================================================
// DÉMARRAGE
// ============================================================
async function startServer() {
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });
        // Création du jackpot initial
        const weekStart = new Date();
        weekStart.setHours(0,0,0,0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const existing = await Jackpot.findOne({ weekStart });
        if (!existing) {
            await Jackpot.create({
                weekStart,
                weekEnd: new Date(weekStart.getTime() + 7*24*3600*1000),
                accumulatedFund: 0,
                drawn: false
            });
            console.log("✅ Jackpot initialisé (0 USDT)");
        }
        server.listen(PORT, () => {
            console.log(`🚀 Serveur démarré sur le port ${PORT}`);
            startGame().catch(console.error);
        });
    } catch (e) {
        console.error("❌ Erreur démarrage :", e.message);
        process.exit(1);
    }
}
startServer();

process.on("SIGTERM", async () => {
    console.log("🛑 Arrêt propre...");
    if (gameTimer) clearTimeout(gameTimer);
    if (nextGameTimeout) clearTimeout(nextGameTimeout);
    server.close(() => mongoose.connection.close(() => process.exit(0)));
});
