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

// ============================================================
// TOKENS SUPPORTÉS (Adresses corrigées et vérifiées)
// ============================================================
const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

// Variables d'environnement
const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_MODE_ENABLED_ON_SERVER = process.env.ALLOW_DEMO_MODE === "true";

if (!ADMIN_PASSWORD) {
    console.error("❌ ADMIN_PASSWORD manque dans Railway.");
    process.exit(1);
}

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
// INITIALISATION TRONWEB & WALLET
// ============================================================
try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
        privateKey: PRIVATE_KEY
    });
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
    console.log("✅ Wallet :", MILTAPE_WALLET);
} catch (error) {
    console.error("❌ Erreur TronWeb :", error.message);
    process.exit(1);
}

// ============================================================
// EXPRESS & MIDDLEWARES
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
app.use('/api/', limiter);

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
        paymentTxId: { type: String, default: null, unique: true, sparse: true },
        token: { type: String, default: 'USDT' },
        depositAmount: { type: Number, default: null },
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

async function assignUniqueDepositAmount(baseBet, gameId) {
    let uniqueAmount;
    for (let i = 0; i < 5; i++) {
        const candidate = Number((baseBet + Math.random() * 0.001).toFixed(6));
        const existing = await Player.findOne({ gameId, depositAmount: candidate, paid: false });
        if (!existing) {
            uniqueAmount = candidate;
            break;
        }
    }
    if (!uniqueAmount) {
        uniqueAmount = Number((baseBet + 0.000999).toFixed(6));
    }
    return uniqueAmount;
}

// ============================================================
// FONCTIONS EXISTANTES (CAGNOTTE, LEADERBOARD, ETC.)
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
// VÉRIFICATION DE PAIEMENTS SÉCURISÉE (ON-CHAIN)
// ============================================================
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

    const txInfo = await tronWeb.trx.getTransactionInfo(txId);
    if (!txInfo || txInfo.receipt.result !== 'SUCCESS' || !txInfo.blockNumber) return false;

    if (Math.abs(amount - expectedAmount) < 0.0000001) return true;
    return false;
}

async function getIncomingTrc20Transactions(address) {
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=30&only_confirmed=true`;
    const headers = TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {};
    const res = await fetch(url, { headers });
    const data = await res.json();
    return data.data || [];
}

// ============================================================
// POLLING DES PAIEMENTS (TOUTES LES 15 SECONDES)
// ============================================================
async function checkPendingPayments() {
    if (game.status !== "running") return;

    try {
        const unpaidPlayers = await Player.find({ gameId: game.id, paid: false, bet: { $gt: 0 }, depositAmount: { $ne: null } });
        if (unpaidPlayers.length === 0) return;

        // ==========================================
        // CORRECTION CRITIQUE : Utilisation de getTransactionsToAddress
        // ==========================================
        // Cette méthode retourne les transactions vers l'adresse (TRX natif)
        // Signature réelle : getTransactionsToAddress(address, limit, offset)
        const trxTransactions = await tronWeb.trx.getTransactionsToAddress(MILTAPE_WALLET, 30, 0);
        
        // Récupérer transactions TRC20 via l'API dédiée de TronGrid
        const trc20Transactions = await getIncomingTrc20Transactions(MILTAPE_WALLET);
        
        const allTransactions = [...(trxTransactions || []), ...(trc20Transactions || [])];

        for (const tx of allTransactions) {
            const txId = tx.transaction_id || tx.txID;
            let token = null;
            let amount = 0;

            // Détection du type de transaction
            if (tx.token_info) {
                // C'est un TRC20 de l'API TronGrid
                token = tx.token_info.symbol;
                amount = tx.value / Math.pow(10, tx.token_info.decimals);
            } else if (tx.raw_data && tx.raw_data.contract) {
                // C'est un TRX classique
                const contract = tx.raw_data.contract[0];
                if (!contract || contract.type !== 'TransferContract') continue;
                const value = contract.parameter.value;
                if (tronWeb.address.fromHex(value.to_address) !== MILTAPE_WALLET) continue;
                token = 'TRX';
                amount = value.amount / 1e6;
            } else {
                continue;
            }

            // MATCHING PAR MONTANT UNIQUE ET TOKEN
            const matchingPlayer = unpaidPlayers.find(p => p.token === token && Math.abs(amount - p.depositAmount) < 0.0000001);
            if (!matchingPlayer) continue;

            // ANTI-TOCTOU : sauvegarde atomique (contrainte unique paymentTxId)
            try {
                matchingPlayer.paid = true;
                matchingPlayer.paymentTxId = txId;
                matchingPlayer.depositAmount = null;
                matchingPlayer.depositExpiresAt = null;
                await matchingPlayer.save();

                await Payment.create({ txId, from: "Paiement anonyme", to: MILTAPE_WALLET, amount, verified: true, gameId: game.id, token });

                io.emit("payment:verified", { verified: true, wallet: matchingPlayer.wallet, amount: matchingPlayer.bet, playerName: matchingPlayer.name, token });
                io.emit("chat:message", { name: "🟢 Système", message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} (auto-détecté)`, createdAt: new Date() });
                sendNotification('success', `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`, { playerName: matchingPlayer.name, amount: matchingPlayer.bet, token });
                console.log(`💰 Paiement sécurisé détecté : ${matchingPlayer.name} (${matchingPlayer.bet} ${token}) - TX: ${txId}`);

            } catch (err) {
                if (err.code === 11000) {
                    console.log(`🚨 Transaction ${txId} déjà utilisée, ignorée.`);
                } else {
                    throw err;
                }
            }
        }
    } catch (error) {
        console.error("❌ Erreur vérification auto paiements :", error.message);
    }
}

// ============================================================
// DÉMARRAGE, JOUEURS, SOCKETS, ROUTES, ETC.
// ============================================================

// ... (Le reste du code de gestion du jeu, startGame, finishGame, io.on("connection"...), routes admin, etc., reste identique) ...

setInterval(() => {
    if (game.status !== "running") return;
    const now = new Date();
    Player.updateMany(
        { gameId: game.id, paid: false, depositExpiresAt: { $lt: now } },
        { $set: { depositExpiresAt: null, depositAmount: null, bet: 0 } }
    ).catch(err => console.error("Erreur timeout:", err));
}, 60 * 1000);

// ============================================================
// ROUTES DE PAIEMENT
// ============================================================
app.post("/api/payment/verify", async (req, res) => {
    const { txId, playerId } = req.body;

    if (String(txId).startsWith("DEMO_")) {
        return res.status(400).json({ success: false, message: "Transaction invalide pour le paiement réel." });
    }

    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
    if (player.paid) return res.json({ success: true, verified: true });

    const isValid = await verifyOnChain(txId, player.depositAmount, player.token);
    if (!isValid) return res.status(400).json({ success: false, message: "Paiement non vérifié sur la blockchain (montant ou token incorrect)." });

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
// DÉMARRAGE DU SERVEUR
// ============================================================
server.listen(PORT, async () => {
    console.log("🚀 BACKEND ONLINE (Sécurisé)");
    try { await startGame(); } catch (e) { console.error("Erreur démarrage:", e.message); }
    setInterval(checkPendingPayments, 15000);
    // ...
});
