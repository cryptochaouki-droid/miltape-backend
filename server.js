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
const DEMO_MODE_ENABLED_ON_SERVER = process.env.ALLOW_DEMO_MODE === "true";
const SERVER_WALLET = (process.env.SERVER_WALLET_ADDRESS || "").trim();

// ---------- JACKPOT CONFIG ----------
const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20;
const JACKPOT_HOUR = 20;

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();
const spectatorSockets = new Set();

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
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
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
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    if (SERVER_WALLET && SERVER_WALLET !== MILTAPE_WALLET) {
        console.error("❌ SERVER_WALLET_ADDRESS ne correspond pas à la PRIVATE_KEY.");
        process.exit(1);
    }
    if (!MILTAPE_WALLET) throw new Error("Wallet vide.");
} catch (error) {
    console.error("❌ MILTAPE_PRIVATE_KEY invalide :", error.message);
    process.exit(1);
}

// ============================================================
// EXPRESS & CORS
// ============================================================
const app = express();
const server = http.createServer(app);

app.use(helmet());
app.set('trust proxy', 1);

const FRONTEND_ORIGINS = [
    "https://cryptochaouki-droid.github.io",
    "https://miltape-backend.vercel.app"
];

app.use(cors({ origin: FRONTEND_ORIGINS, credentials: true }));

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
app.use(express.static(__dirname));

// ============================================================
// SOCKET.IO
// ============================================================
const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGINS,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// ============================================================
// MONGOOSE & SCHEMAS
// ============================================================
mongoose.set("strictQuery", true);

const playerSchema = new mongoose.Schema(
    {
        gameId: { type: String, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 30 },
        wallet: { type: String, trim: true, index: true },
        deviceId: { type: String, trim: true, index: true },
        taps: { type: Number, default: 0, min: 0 },
        bet: { type: Number, default: 0, min: 0 },
        paid: { type: Boolean, default: false },
        paymentTxId: { type: String, default: null, unique: true, sparse: true }, // <-- CONTRAINTE UNIQUE ANTI-DOUBLON
        token: { type: String, default: 'USDT' },
        depositAmount: { type: Number, default: null }, // Montant unique à payer
        depositExpiresAt: { type: Date, default: null }
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
        gameId: { type: String, default: null },
        token: { type: String, default: 'USDT' }
    },
    { timestamps: true }
);

const historySchema = new mongoose.Schema(
    {
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
    },
    { timestamps: true }
);

const jackpotSchema = new mongoose.Schema(
    {
        weekStart: { type: Date, required: true },
        weekEnd: { type: Date, required: true },
        prize: { type: Number, default: 0 },
        accumulatedFund: { type: Number, default: 0 },
        winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
        drawn: { type: Boolean, default: false },
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }]
    },
    { timestamps: true }
);

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté."))
    .catch((error) => { console.error("❌ MongoDB erreur :", error.message); process.exit(1); });

// ============================================================
// UTILITAIRES
// ============================================================
function normalizeWallet(address) { return String(address || "").trim(); }
function isValidTronAddress(address) { try { return tronWeb.isAddress(normalizeWallet(address)); } catch { return false; } }
function sameWallet(a, b) { return normalizeWallet(a) === normalizeWallet(b); }
function generateGameId() { return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }
function getRemainingSeconds() { if (game.status !== "running" || !game.endsAt) return 0; return Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)); }
function generateUniqueDepositAmount(baseBet) {
    // Ajoute un micro-supplément aléatoire pour éviter le vol de paiement
    return Number((baseBet + Math.random() * 0.001).toFixed(6));
}

// ============================================================
// CAGNOTTE & AUTRES FONCTIONS EXISTANTES (Abrégé pour concision)
// ============================================================
async function getCurrentJackpot() { /* ... */ }
async function addToJackpotFund(serverProfit) { /* ... */ }
function getNextSaturday() { /* ... */ }
async function emitJackpotUpdate() { /* ... */ }
async function drawJackpot() { /* ... */ }
async function sendTokenToWinner(wallet, amount, token) { /* ... */ }
async function getLeaderboard() { /* ... */ }
async function getTotalStakes() { /* ... */ }
async function broadcastGameState() { /* ... */ }

// ============================================================
// MODULE DE PAIEMENT SÉCURISÉ (POLLING TRONGRID)
// ============================================================

// Fonction de vérification On-Chain (matche par MONTANT EXACT et TOKEN, jamais par expéditeur)
async function verifyOnChain(txId, expectedAmount, token = 'USDT') {
    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error("Token non supporté");

    const tx = await tronWeb.trx.getTransaction(txId);
    if (!tx) return false;
    const contract = tx.raw_data?.contract[0];
    if (!contract) return false;

    let amount = 0;

    if (token === 'TRX') {
        if (contract.type !== 'TransferContract') return false;
        const value = contract.parameter.value;
        if (tronWeb.address.fromHex(value.to_address) !== MILTAPE_WALLET) return false;
        amount = value.amount / 1e6;
    } else {
        if (contract.type !== 'TriggerSmartContract') return false;
        const value = contract.parameter.value;
        if (tronWeb.address.fromHex(value.contract_address) !== tokenInfo.contract) return false;
        const recipient = tronWeb.address.fromHex("41" + String(value.data).substring(32, 72));
        if (recipient !== MILTAPE_WALLET) return false;
        const rawAmount = BigInt("0x" + String(value.data).substring(72, 136));
        amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
    }

    // Vérifier la confirmation du bloc
    const txInfo = await tronWeb.trx.getTransactionInfo(txId);
    if (!txInfo || txInfo.receipt.result !== 'SUCCESS' || !txInfo.blockNumber) return false;

    // Tolérance de 0 (strictement le montant unique) et limite haute stricte
    if (Math.abs(amount - expectedAmount) < 0.0000001) return true;
    return false;
}

// Polling des paiements en attente (toutes les 15s)
async function checkPendingPayments() {
    if (game.status !== "running") return;
    try {
        const unpaidPlayers = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null } });
        if (unpaidPlayers.length === 0) return;

        const transactions = await tronWeb.trx.getTransactions(MILTAPE_WALLET, { limit: 30, onlyConfirmed: true });
        if (!transactions || transactions.length === 0) return;

        for (const tx of transactions) {
            const txId = tx.txID;

            // Extraction du montant (sans passer par le client)
            const contract = tx.raw_data?.contract[0];
            if (!contract) continue;
            
            let token = null;
            let amount = 0;

            if (contract.type === "TransferContract") {
                const value = contract.parameter.value;
                if (tronWeb.address.fromHex(value.to_address) !== MILTAPE_WALLET) continue;
                token = 'TRX';
                amount = value.amount / 1e6;
            } else if (contract.type === "TriggerSmartContract") {
                const value = contract.parameter?.value;
                if (!value) continue;
                
                let foundToken = null;
                const contractAddress = tronWeb.address.fromHex(value.contract_address);
                for (const [sym, info] of Object.entries(SUPPORTED_TOKENS)) {
                    if (info.contract && sameWallet(contractAddress, info.contract)) {
                        foundToken = sym;
                        break;
                    }
                }
                if (!foundToken) continue;
                
                token = foundToken;
                const data = String(value.data || "").toLowerCase();
                if (!data.startsWith("a9059cbb") || data.length < 136) continue;
                const recipient = tronWeb.address.fromHex("41" + data.substring(32, 72));
                if (recipient !== MILTAPE_WALLET) continue;
                amount = Number(BigInt("0x" + data.substring(72, 136))) / Math.pow(10, SUPPORTED_TOKENS[foundToken].decimals);
            } else {
                continue;
            }

            // MATCHING PAR MONTANT EXACT ET TOKEN (L'adresse de l'expéditeur est ignorée)
            const matchingPlayer = unpaidPlayers.find(p => p.token === token && Math.abs(amount - p.depositAmount) < 0.0000001);
            if (!matchingPlayer) continue;

            // ANTI-TOCTOU : Tentative de sauvegarde atomique (contrainte unique sur paymentTxId)
            try {
                matchingPlayer.paid = true;
                matchingPlayer.paymentTxId = txId;
                matchingPlayer.depositAmount = null;
                matchingPlayer.depositExpiresAt = null;
                await matchingPlayer.save(); 
                // Si on arrive ici, le txID a été réservé atomiquement (sinon erreur E11000)

                await Payment.create({ txId, from: "Paiement anonyme", to: MILTAPE_WALLET, amount, verified: true, gameId: game.id, token });
                
                io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name, token });
                io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} (auto-détecté)`, createdAt: new Date() });
                sendNotification('success', `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`, { playerName: matchingPlayer.name, amount: matchingPlayer.bet, token });
                console.log(`💰 Paiement sécurisé détecté : ${matchingPlayer.name} (${matchingPlayer.bet} ${token}) - TX: ${txId}`);

            } catch (err) {
                if (err.code === 11000) {
                    console.log(`🚨 Transaction ${txId} déjà utilisée, ignorée.`);
                } else { throw err; }
            }
        }
    } catch (error) {
        console.error("❌ Erreur vérification auto paiements :", error.message);
    }
}

// Nettoyage des paiements expirés (15 min)
setInterval(async () => {
    if (game.status !== "running") return;
    const now = new Date();
    await Player.updateMany(
        { gameId: game.id, paid: false, depositExpiresAt: { $lt: now } },
        { $set: { depositExpiresAt: null, depositAmount: null, bet: 0 } }
    );
}, 60 * 1000);

// ============================================================
// SOCKET.IO
// ============================================================
io.on("connection", async (socket) => {
    onlineSockets.add(socket.id);
    await broadcastGameState();
    await emitJackpotUpdate();

    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim();

            if (!name || !isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token]) {
                return socket.emit("error", { message: "Données invalides." });
            }

            let player;
            if (deviceId) player = await Player.findOne({ gameId: game.id, deviceId });
            else player = await Player.findOne({ gameId: game.id, wallet });

            if (!player) {
                // GÉNÉRATION DU MONTANT UNIQUE
                const depositAmount = generateUniqueDepositAmount(bet);
                player = await Player.create({ 
                    gameId: game.id, name, wallet, deviceId, taps: 0, bet, paid: false, token, 
                    depositAmount, depositExpiresAt: new Date(Date.now() + (15 * 60 * 1000))
                });
            } else {
                player.name = name;
                player.bet = bet;
                player.token = token;
                player.paid = false;
                player.paymentTxId = null;
                // MISE À JOUR DU MONTANT UNIQUE
                player.depositAmount = generateUniqueDepositAmount(bet);
                player.depositExpiresAt = new Date(Date.now() + (15 * 60 * 1000));
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;

            // Renvoyer le montant EXACT au joueur
            socket.emit("player:joined", { 
                success: true, 
                player: { 
                    id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, 
                    bet: player.bet, paid: player.paid, token: player.token, depositAmount: player.depositAmount 
                } 
            });
            await broadcastGameState();
        } catch (error) {
            console.error("player:join:", error.message);
            socket.emit("error", { message: "Impossible de rejoindre la partie." });
        }
    });

    socket.on("player:restore", async (data) => {
        try {
            const playerId = data?.playerId;
            const wallet = normalizeWallet(data?.wallet);
            const deviceId = normalizeWallet(data?.deviceId);
            const query = { gameId: game.id };
            if (playerId) query._id = playerId;
            else if (deviceId) query.deviceId = deviceId;
            else query.wallet = wallet;

            const player = await Player.findOne(query);
            if (!player) return socket.emit("error", { message: "Joueur introuvable." });

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;

            socket.emit("player:restored", { 
                success: true, 
                player: { 
                    id: player._id, name: player.name, wallet: player.wallet, taps: player.taps, 
                    bet: player.bet, paid: player.paid, token: player.token, depositAmount: player.depositAmount 
                } 
            });
        } catch (error) {
            socket.emit("error", { message: "Erreur restauration." });
        }
    });

    socket.on("player:tap", async () => {
        // ... (Code anti-triche et tap existant)
    });

    socket.on("chat:send", async (data) => { /* ... */ });

    socket.on("disconnect", async () => { onlineSockets.delete(socket.id); await broadcastGameState(); });
});

// ============================================================
// ROUTES PAYEMENT (SÉPARATION STRICTE)
// ============================================================

// Route de vérification des vrais paiements (Appelée par le front si le polling est trop lent)
app.post("/api/payment/verify", async (req, res) => {
    const { txId, playerId } = req.body;
    
    // SECURITE : Refuser tout préfixe DEMO
    if (String(txId).startsWith("DEMO_")) {
        return res.status(400).json({ success: false, message: "Transaction invalide pour le paiement réel." });
    }

    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });

    // Vérification on-chain basée sur le montant unique attendu en base
    const isValid = await verifyOnChain(txId, player.depositAmount, player.token);
    if (!isValid) return res.status(400).json({ success: false, message: "Paiement non vérifié sur la blockchain (montant ou token incorrect)." });

    // Mise à jour atomique (contrainte unique sur paymentTxId)
    try {
        player.paid = true;
        player.paymentTxId = txId;
        player.depositAmount = null;
        player.depositExpiresAt = null;
        await player.save();
        res.json({ success: true, verified: true });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ success: false, message: "Transaction déjà utilisée." });
        throw err;
    }
});

// Route Démo isolée (Pour le développement et les tests)
app.post("/api/demo/verify", async (req, res) => {
    if (!DEMO_MODE_ENABLED_ON_SERVER) {
        return res.status(403).json({ success: false, message: "Mode démo désactivé sur le serveur." });
    }

    const { playerId } = req.body;
    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });

    player.paid = true;
    await player.save();

    io.emit("payment:verified", { verified: true, demo: true, wallet: player.wallet, amount: player.bet, playerName: player.name, token: player.token });
    res.json({ success: true, verified: true, demo: true });
});

// ============================================================
// AUTRES ROUTES ADMIN & API (Abbrégées, inchangées)
// ============================================================
// ... (Toutes les routes admin, jackpot, chat, game, etc. restent identiques)

server.listen(PORT, async () => {
    console.log("🚀 BACKEND ONLINE (Sécurisé)");
    try { await startGame(); } catch (e) { console.error("Erreur démarrage:", e.message); }
    setInterval(checkPendingPayments, 15000);
    // ...
});
