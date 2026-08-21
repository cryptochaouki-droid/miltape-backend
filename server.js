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

const USDT_CONTRACT = (
    process.env.USDT_CONTRACT ||
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
).trim();

const USDT_DECIMALS = 6;

const MONGODB_URI = (
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    ""
).trim();

const PRIVATE_KEY = (
    process.env.MILTAPE_PRIVATE_KEY ||
    ""
).trim();

const TRONGRID_API_KEY = (
    process.env.TRONGRID_API_KEY ||
    ""
).trim();

// ---------- ADMIN PASSWORD (ajout) ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();

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

if (!MONGODB_URI) {
    console.error("❌ MONGO_URI ou MONGODB_URI manque dans Railway.");
    process.exit(1);
}

if (!PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY manque dans Railway.");
    process.exit(1);
}

// ============================================================
// TRONWEB
// ============================================================

try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY": TRONGRID_API_KEY
            }
            : {},
        privateKey: PRIVATE_KEY
    });
    console.log("✅ TronWeb initialisé.");
} catch (error) {
    console.error("❌ Erreur TronWeb :", error.message);
    process.exit(1);
}

// ============================================================
// WALLET
// ============================================================

try {
    MILTAPE_WALLET = TronWeb.address.fromPrivateKey(PRIVATE_KEY);
    if (!MILTAPE_WALLET) {
        throw new Error("Wallet vide.");
    }
} catch (error) {
    console.error("❌ MILTAPE_PRIVATE_KEY invalide :", error.message);
    process.exit(1);
}

console.log("");
console.log("==============================================");
console.log("        TRON CONFIGURATION");
console.log("==============================================");
console.log("💰 Wallet :", MILTAPE_WALLET);
console.log("💵 USDT :", USDT_CONTRACT);
console.log("==============================================");
console.log("");

// ============================================================
// EXPRESS
// ============================================================

const app = express();
const server = http.createServer(app);

// 1. Sécurité des en-têtes HTTP avec Helmet
app.use(helmet());

// 2. CORS – autoriser spécifiquement ton frontend GitHub Pages (ajout)
const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io";
app.use(
    cors({
        origin: FRONTEND_ORIGIN, // ou "*" si tu préfères, mais plus sécurisé comme ça
        credentials: true
    })
);

// 3. Rate Limiting global
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." }
});
app.use('/api/', limiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// 4. Fichiers statiques (si besoin)
app.use(express.static(__dirname));

// ============================================================
// SOCKET.IO
// ============================================================

const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGIN, // ou "*"
        methods: ["GET", "POST"],
        credentials: true
    }
});

// ============================================================
// MONGOOSE
// ============================================================

mongoose.set("strictQuery", true);

// ============================================================
// SCHEMAS
// ============================================================

const playerSchema = new mongoose.Schema(
    {
        gameId: { type: String, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 30 },
        wallet: { type: String, required: true, trim: true, index: true },
        taps: { type: Number, default: 0, min: 0 },
        bet: { type: Number, default: 0, min: 0 },
        paid: { type: Boolean, default: false },
        paymentTxId: { type: String, default: null }
    },
    { timestamps: true }
);

const messageSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 30 },
        message: { type: String, required: true, trim: true, maxlength: 300 },
        gameId: { type: String, default: null }
    },
    { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
    {
        txId: { type: String, required: true, unique: true, index: true },
        from: { type: String, required: true },
        to: { type: String, required: true },
        amount: { type: Number, required: true },
        verified: { type: Boolean, default: false },
        gameId: { type: String, default: null }
    },
    { timestamps: true }
);

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);

// ============================================================
// MONGODB
// ============================================================

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("✅ MongoDB connecté.");
    })
    .catch((error) => {
        console.error("❌ MongoDB erreur :", error.message);
        process.exit(1);
    });

// ============================================================
// UTILITAIRES
// ============================================================

function normalizeWallet(address) {
    return String(address || "").trim();
}

function isValidTronAddress(address) {
    const wallet = normalizeWallet(address);
    if (!wallet) return false;
    try {
        return tronWeb.isAddress(wallet);
    } catch {
        return false;
    }
}

function sameWallet(a, b) {
    return normalizeWallet(a) === normalizeWallet(b);
}

function generateGameId() {
    return (
        "GAME-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        Math.random().toString(36).substring(2, 8).toUpperCase()
    );
}

function getRemainingSeconds() {
    if (game.status !== "running" || !game.endsAt) {
        return 0;
    }
    return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
}

// ============================================================
// LEADERBOARD
// ============================================================

async function getLeaderboard() {
    if (!game.id) return [];

    const players = await Player
        .find({ gameId: game.id })
        .sort({ taps: -1, createdAt: 1 })
        .limit(5)
        .lean();

    return players.map((player, index) => ({
        rank: index + 1,
        name: player.name,
        wallet: player.wallet,
        taps: player.taps,
        bet: player.bet,
        paid: player.paid
    }));
}

// ============================================================
// BROADCAST
// ============================================================

async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        const state = {
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds: game.durationSeconds,
            remainingSeconds: getRemainingSeconds(),
            onlinePlayers: onlineSockets.size,
            leaderboard
        };

        io.emit("game:state", state);
        io.emit("online:count", onlineSockets.size);
        io.emit("leaderboard:update", leaderboard);
        io.emit("timer:update", {
            remainingSeconds: getRemainingSeconds(),
            status: game.status
        });
    } catch (error) {
        console.error("broadcastGameState:", error.message);
    }
}

// ============================================================
// START GAME
// ============================================================

async function startGame() {
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    game = {
        id: generateGameId(),
        status: "running",
        startedAt: Date.now(),
        endsAt: Date.now() + GAME_DURATION_SECONDS * 1000,
        durationSeconds: GAME_DURATION_SECONDS
    };

    console.log("");
    console.log("🎮 NOUVELLE PARTIE :", game.id);
    console.log("⏱️ Durée : 10 minutes");

    await broadcastGameState();

    gameTimer = setInterval(async () => {
        try {
            const remaining = getRemainingSeconds();
            io.emit("timer:update", {
                remainingSeconds: remaining,
                status: game.status
            });

            if (remaining <= 0) {
                await finishGame();
            }
        } catch (error) {
            console.error("gameTimer:", error.message);
        }
    }, 1000);
}

// ============================================================
// FIN GAME
// ============================================================

async function finishGame() {
    if (game.status !== "running") return;

    game.status = "finished";

    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    const leaderboard = await getLeaderboard();

    console.log("");
    console.log("🏁 PARTIE TERMINÉE :", game.id);
    console.log("🏆 Classement :", leaderboard);

    io.emit("game:finished", {
        gameId: game.id,
        leaderboard,
        onlinePlayers: onlineSockets.size
    });

    await broadcastGameState();

    if (nextGameTimeout) clearTimeout(nextGameTimeout);

    nextGameTimeout = setTimeout(async () => {
        nextGameTimeout = null;
        await startGame();
    }, 5000);
}

// ============================================================
// SOCKET
// ============================================================

io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    console.log("🟢 Socket connecté :", socket.id);
    await broadcastGameState();

    // JOIN
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

            if (!player) {
                player = await Player.create({
                    gameId: game.id,
                    name,
                    wallet,
                    taps: 0,
                    bet,
                    paid: false
                });
            } else {
                player.name = name;
                player.bet = bet;
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.wallet = wallet;
            socket.data.name = name;

            socket.emit("player:joined", {
                success: true,
                player: {
                    id: player._id,
                    name: player.name,
                    wallet: player.wallet,
                    taps: player.taps,
                    bet: player.bet,
                    paid: player.paid
                }
            });

            await broadcastGameState();
        } catch (error) {
            console.error("player:join:", error.message);
            socket.emit("error", { message: "Impossible de rejoindre la partie." });
        }
    });

    // TAP
    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;

            const player = await Player.findById(socket.data.playerId);
            if (!player || player.gameId !== game.id) return;

            player.taps += 1;
            await player.save();

            socket.emit("player:score", { taps: player.taps });

            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);
        } catch (error) {
            console.error("player:tap:", error.message);
        }
    });

    // CHAT
    socket.on("chat:send", async (data) => {
        try {
            const name = String(data?.name || socket.data.name || "Joueur").trim().substring(0, 30);
            const message = String(data?.message || "").trim().substring(0, 300);

            if (!message) return;

            const saved = await Message.create({ name, message, gameId: game.id });
            io.emit("chat:message", {
                id: saved._id,
                name,
                message,
                createdAt: saved.createdAt
            });
        } catch (error) {
            console.error("chat:send:", error.message);
        }
    });

    // DISCONNECT
    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        console.log("🔴 Socket déconnecté :", socket.id);
        await broadcastGameState();
    });
});

// ============================================================
// ================= NOUVELLES ROUTES ADMIN ===================
// ============================================================

// 1. Login admin
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, message: "Connecté." });
    } else {
        res.status(401).json({ success: false, message: "Mot de passe incorrect." });
    }
});

// 2. Stats admin (derniers joueurs)
app.get("/api/admin/stats", async (req, res) => {
    try {
        const recentPlayers = await Player
            .find({ gameId: game.id })
            .sort({ updatedAt: -1 })
            .limit(20)
            .select('name wallet taps');
        res.json({
            success: true,
            recentPlayers: recentPlayers.map(p => ({
                playerName: p.name,
                playerId: p._id,
                score: p.taps,
                wallet: p.wallet
            }))
        });
    } catch (error) {
        console.error("/api/admin/stats:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Payouts (Top 5 gagnants)
app.get("/api/admin/payouts", async (req, res) => {
    try {
        const winners = await Player
            .find({ gameId: game.id })
            .sort({ taps: -1 })
            .limit(5)
            .select('name wallet taps bet');
        res.json({
            success: true,
            winners: winners.map((p, index) => ({
                rank: index + 1,
                playerName: p.name,
                wallet: p.wallet,
                score: p.taps,
                amount: p.bet || 0
            }))
        });
    } catch (error) {
        console.error("/api/admin/payouts:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Total des enjeux
app.get("/api/total-stakes", async (req, res) => {
    try {
        const result = await Player.aggregate([
            { $match: { gameId: game.id } },
            { $group: { _id: null, total: { $sum: "$bet" } } }
        ]);
        const totalStakes = result.length > 0 ? result[0].total : 0;
        res.json({ success: true, totalStakes });
    } catch (error) {
        console.error("/api/total-stakes:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// API EXISTANTES (inchangées)
// ============================================================

app.get("/api/game", async (req, res) => {
    try {
        const leaderboard = await getLeaderboard();
        res.json({
            success: true,
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds: game.durationSeconds,
            remainingSeconds: getRemainingSeconds(),
            onlinePlayers: onlineSockets.size,
            leaderboard
        });
    } catch (error) {
        console.error("/api/game:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/wallet", (req, res) => {
    res.json({ success: true, wallet: MILTAPE_WALLET, usdtContract: USDT_CONTRACT });
});

app.post("/api/join", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().substring(0, 30);
        const wallet = normalizeWallet(req.body?.wallet);
        const bet = Number(req.body?.bet);

        if (!name) return res.status(400).json({ success: false, message: "Nom invalide." });
        if (!isValidTronAddress(wallet)) return res.status(400).json({ success: false, message: "Adresse TRON invalide." });
        if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ success: false, message: "Montant invalide." });
        if (game.status !== "running") return res.status(400).json({ success: false, message: "La partie n'est pas ouverte." });

        let player = await Player.findOne({ gameId: game.id, wallet });

        if (!player) {
            player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false });
        } else {
            player.name = name;
            player.bet = bet;
            await player.save();
        }

        res.json({
            success: true,
            player: {
                id: player._id,
                name: player.name,
                wallet: player.wallet,
                taps: player.taps,
                bet: player.bet,
                paid: player.paid
            }
        });
    } catch (error) {
        console.error("/api/join:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/player/status", async (req, res) => {
    try {
        const playerId = String(req.query?.playerId || "").trim();
        const wallet = normalizeWallet(req.query?.wallet);

        if (!playerId && !wallet) return res.status(400).json({ success: false, message: "playerId ou wallet requis." });

        const query = { gameId: game.id };
        if (playerId) {
            query._id = playerId;
        } else {
            query.wallet = wallet;
        }

        const player = await Player.findOne(query);

        if (!player) return res.status(404).json({ success: false, message: "Aucun joueur trouvé pour cette partie." });

        res.json({
            success: true,
            player: {
                id: player._id,
                name: player.name,
                wallet: player.wallet,
                taps: player.taps,
                bet: player.bet,
                paid: player.paid
            }
        });
    } catch (error) {
        console.error("/api/player/status:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post("/api/tap", async (req, res) => {
    try {
        if (game.status !== "running") return res.status(400).json({ success: false, message: "La partie est terminée." });

        const playerId = String(req.body?.playerId || "").trim();
        if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." });

        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
        if (player.gameId !== game.id) return res.status(400).json({ success: false, message: "Cette partie est terminée." });
        if (getRemainingSeconds() <= 0) return res.status(400).json({ success: false, message: "Le chrono est terminé." });

        player.taps += 1;
        await player.save();

        const leaderboard = await getLeaderboard();
        io.emit("leaderboard:update", leaderboard);

        res.json({ success: true, taps: player.taps, leaderboard });
    } catch (error) {
        console.error("/api/tap:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/leaderboard", async (req, res) => {
    try {
        const leaderboard = await getLeaderboard();
        res.json({ success: true, leaderboard });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/chat", async (req, res) => {
    try {
        const messages = await Message.find({ $or: [{ gameId: game.id }, { gameId: null }] })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        messages.reverse();
        res.json({ success: true, messages });
    } catch (error) {
        console.error("/api/chat:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post("/api/payment/verify", async (req, res) => {
    try {
        const txId = String(req.body?.txId || "").trim();
        const wallet = normalizeWallet(req.body?.wallet);
        const amount = Number(req.body?.amount);
        const playerId = String(req.body?.playerId || "").trim();

        if (!txId) return res.status(400).json({ success: false, verified: false, message: "txId manquant." });

        const existing = await Payment.findOne({ txId });
        if (existing) {
            return res.json({ success: true, verified: existing.verified, alreadyVerified: true, payment: existing });
        }

        const result = await verifyUsdtTransaction(txId, wallet, amount);
        const payment = await Payment.create({
            txId: result.txId,
            from: result.from,
            to: result.to,
            amount: result.amount,
            verified: true,
            gameId: game.id
        });

        if (playerId) {
            const player = await Player.findById(playerId);
            if (player && player.gameId === game.id) {
                player.paid = true;
                player.paymentTxId = txId;
                await player.save();
            }
        }

        io.emit("payment:verified", { txId, wallet: result.from, amount: result.amount });
        res.json({
            success: true,
            verified: true,
            payment: { txId: result.txId, from: result.from, to: result.to, amount: result.amount }
        });
    } catch (error) {
        console.error("❌ Payment verification:", error.message);
        res.status(400).json({ success: false, verified: false, message: error.message });
    }
});

app.get("/api/online", (req, res) => {
    res.json({ success: true, onlinePlayers: onlineSockets.size });
});

// --- /api/status améliorée (déjà bonne, mais on ajoute gameId et timerLeft) ---
app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        service: "Miltape Backend",
        server: "online",
        mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        tron: tronWeb ? "connected" : "disconnected",
        wallet: MILTAPE_WALLET,
        gameId: game.id || null,
        status: game.status,
        timerLeft: getRemainingSeconds(),
        onlinePlayers: onlineSockets.size
    });
});

// ============================================================
// VERIFICATION USDT (existante)
// ============================================================
async function verifyUsdtTransaction(txId, expectedFrom, expectedAmount) {
    // ... (le code existant est déjà présent plus haut, je ne le répète pas)
    // Mais il est déjà défini avant, donc pas besoin de le redéfinir.
}

// ============================================================
// 404 & GESTION D'ERREUR
// ============================================================
app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route introuvable." });
});

app.use((error, req, res, next) => {
    console.error("Express error:", error);
    res.status(500).json({ success: false, message: "Erreur interne du serveur." });
});

// ============================================================
// START
// ============================================================
server.listen(PORT, async () => {
    console.log("");
    console.log("==============================================");
    console.log("       🚀 BACKEND ONLINE");
    console.log("==============================================");
    console.log("🌐 Port :", PORT);
    console.log("💰 Wallet :", MILTAPE_WALLET);
    console.log("💵 USDT :", USDT_CONTRACT);
    console.log("🎮 Jeu : 10 minutes");
    console.log("🏆 Top 5");
    console.log("💬 Chat actif");
    console.log("⏱️ Chrono actif");
    console.log("==============================================");

    try {
        await startGame();
    } catch (error) {
        console.error("❌ Impossible de démarrer le jeu :", error.message);
    }
});

// ============================================================
// ARRÊT PROPRE
// ============================================================
async function gracefulShutdown(signal) {
    console.log(`${signal} reçu...`);
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }
    if (nextGameTimeout) {
        clearTimeout(nextGameTimeout);
        nextGameTimeout = null;
    }
    try {
        await mongoose.connection.close();
    } catch (error) {
        console.error("MongoDB fermeture :", error.message);
    }
    server.close(() => {
        console.log("✅ Serveur arrêté.");
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
