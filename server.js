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
// TOKENS SUPPORTÉS (TRC20 + TRX natif)
// ============================================================
const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN441q1LZ", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhRZL4Ciao6eb6yA3xHPPzLtNQvXsHq", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

// Variables d'environnement
const USDT_CONTRACT = SUPPORTED_TOKENS.USDT.contract;
const USDT_DECIMALS = SUPPORTED_TOKENS.USDT.decimals;

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

// ---------- ADMIN PASSWORD ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";

// ---------- JACKPOT CONFIG ----------
const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20; // 20% du bénéfice
const JACKPOT_HOUR = 20; // 20h (heure du tirage le samedi)

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();
const spectatorSockets = new Set();

// ============================================================
// PAIEMENT AUTOMATIQUE – ÉVITER LES DOUBLONS
// ============================================================
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

app.use(helmet());

const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io";
app.use(
    cors({
        origin: FRONTEND_ORIGIN,
        credentials: true
    })
);

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
        origin: FRONTEND_ORIGIN,
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
        paymentTxId: { type: String, default: null },
        token: { type: String, default: 'USDT' }
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

// ============================================================
// JACKPOT SCHEMA (NOUVEAU)
// ============================================================
const jackpotSchema = new mongoose.Schema(
    {
        weekStart: { type: Date, required: true },
        weekEnd: { type: Date, required: true },
        prize: { type: Number, default: 0 }, // Montant affiché (accumulé)
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
// NOTIFICATIONS
// ============================================================

function sendNotification(type, message, data = {}) {
    io.emit("notification:new", {
        type: type,
        message: message,
        data: data,
        timestamp: Date.now()
    });
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
        paid: player.paid,
        id: player._id,
        token: player.token || 'USDT'
    }));
}

// ============================================================
// TOTAL DES MISES
// ============================================================

async function getTotalStakes() {
    if (!game.id) return 0;
    const result = await Player.aggregate([
        { $match: { gameId: game.id } },
        { $group: { _id: null, total: { $sum: "$bet" } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
}

// ============================================================
// BROADCAST
// ============================================================

async function broadcastGameState() {
    try {
        const leaderboard = await getLeaderboard();
        const totalStakes = await getTotalStakes();
        const state = {
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds: game.durationSeconds,
            remainingSeconds: getRemainingSeconds(),
            onlinePlayers: onlineSockets.size,
            spectators: spectatorSockets.size,
            leaderboard
        };

        io.emit("game:state", state);
        io.emit("online:count", onlineSockets.size + spectatorSockets.size);
        io.emit("leaderboard:update", leaderboard);
        io.emit("timer:update", {
            remainingSeconds: getRemainingSeconds(),
            status: game.status
        });
        io.emit("totalStakes:update", { totalStakes });
    } catch (error) {
        console.error("broadcastGameState:", error.message);
    }
}

// ============================================================
// TRANSFERT USDT VERS LES GAGNANTS
// ============================================================

async function sendUsdtToWinners(winners) {
    if (!tronWeb) {
        console.error("❌ TronWeb non initialisé, transferts impossibles.");
        return;
    }

    const contract = await tronWeb.contract().at(USDT_CONTRACT);

    for (const winner of winners) {
        if (winner.gain <= 0) continue;

        try {
            const amountInSun = tronWeb.toBigNumber(winner.gain * Math.pow(10, USDT_DECIMALS));
            const tx = await contract.transfer(winner.wallet, amountInSun);

            console.log(`✅ ${winner.gain} USDT envoyé à ${winner.name} (${winner.wallet})`);
            console.log(`   TXID : ${tx}`);
        } catch (error) {
            console.error(`❌ Erreur transfert vers ${winner.wallet} :`, error.message);
        }
    }
}

// ============================================================
// TRANSFERT USDT VERS LE GAGNANT DE LA CAGNOTTE
// ============================================================

async function sendUsdtToWinner(wallet, amount) {
    if (!tronWeb || amount <= 0) return;

    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const amountInSun = tronWeb.toBigNumber(amount * Math.pow(10, USDT_DECIMALS));
        const tx = await contract.transfer(wallet, amountInSun);
        console.log(`✅ ${amount} USDT envoyé au gagnant du jackpot (${wallet})`);
        console.log(`   TXID : ${tx}`);
    } catch (error) {
        console.error(`❌ Erreur transfert jackpot vers ${wallet} :`, error.message);
    }
}

// ============================================================
// CAGNOTTE DU SAMEDI
// ============================================================

/**
 * Retourne la cagnotte de la semaine en cours (ou en crée une nouvelle)
 */
async function getCurrentJackpot() {
    const now = new Date();
    // Début de semaine : dimanche 00:00
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);

    // Fin de semaine : samedi 23:59:59
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    let jackpot = await Jackpot.findOne({
        weekStart: { $gte: start, $lte: now },
        weekEnd: { $gte: now, $lte: end }
    });

    if (!jackpot) {
        // Créer une nouvelle cagnotte pour la semaine en cours
        const prize = Number(process.env.JACKPOT_AMOUNT) || 0; // départ à 0, s'alimente via bénéfices
        jackpot = await Jackpot.create({
            weekStart: start,
            weekEnd: end,
            prize: 0,
            accumulatedFund: 0,
            drawn: false,
            participants: []
        });
        console.log("🎁 Nouvelle cagnotte créée pour la semaine.");
    }

    return jackpot;
}

/**
 * Ajoute un prélèvement à la cagnotte (20% du bénéfice serveur)
 */
async function addToJackpotFund(serverProfit) {
    if (serverProfit <= 0) return;

    const jackpot = await getCurrentJackpot();
    if (!jackpot || jackpot.drawn) return;

    const contribution = Math.round(serverProfit * (JACKPOT_PERCENT / 100) * 100) / 100;
    if (contribution <= 0) return;

    jackpot.accumulatedFund += contribution;
    jackpot.prize = jackpot.accumulatedFund;
    await jackpot.save();

    // Notifications
    io.emit("chat:message", {
        name: "💰 Cagnotte",
        message: `🎯 ${contribution} USDT ajoutés à la cagnotte du samedi ! (Total : ${jackpot.accumulatedFund} USDT)`,
        createdAt: new Date()
    });

    // Mettre à jour les clients
    await emitJackpotUpdate();

    console.log(`💰 Cagnotte : +${contribution} USDT (total : ${jackpot.accumulatedFund} USDT)`);
}

/**
 * Calcule le timestamp du prochain samedi à 20h
 */
function getNextSaturday() {
    const now = new Date();
    const nextSat = new Date(now);
    nextSat.setDate(now.getDate() + (6 - now.getDay())); // samedi
    nextSat.setHours(JACKPOT_HOUR, 0, 0, 0);
    if (nextSat < now) nextSat.setDate(nextSat.getDate() + 7);
    return nextSat.getTime();
}

/**
 * Émet l'état de la cagnotte à tous les clients
 */
async function emitJackpotUpdate() {
    const jackpot = await getCurrentJackpot();
    if (!jackpot) return;

    const nextDraw = getNextSaturday();

    io.emit("jackpot:update", {
        prize: jackpot.prize,
        participants: jackpot.participants.length,
        nextDraw: nextDraw,
        drawn: jackpot.drawn,
        winner: jackpot.winner ? await Player.findById(jackpot.winner).select('name') : null
    });
}

/**
 * Tirage de la cagnotte (le samedi à 20h)
 */
async function drawJackpot() {
    const jackpot = await getCurrentJackpot();
    if (!jackpot || jackpot.drawn) return;

    if (jackpot.participants.length === 0) {
        console.log("🎁 Pas de participants pour la cagnotte cette semaine.");
        jackpot.drawn = true;
        jackpot.prize = 0;
        jackpot.accumulatedFund = 0;
        await jackpot.save();
        await emitJackpotUpdate();
        return;
    }

    // Tirer un gagnant aléatoire
    const randomIndex = Math.floor(Math.random() * jackpot.participants.length);
    const winnerId = jackpot.participants[randomIndex];
    const winner = await Player.findById(winnerId);

    const prizeAmount = jackpot.accumulatedFund;

    jackpot.winner = winnerId;
    jackpot.drawn = true;
    jackpot.prize = 0;
    jackpot.accumulatedFund = 0;
    await jackpot.save();

    // Notifications
    io.emit("notification:new", {
        type: 'jackpot',
        message: `🎁 CAGNOTTE DU SAMEDI ! ${winner.name} remporte ${prizeAmount} USDT !`,
        data: { winner: winner.name, prize: prizeAmount }
    });

    io.emit("chat:message", {
        name: "🎁 Cagnotte",
        message: `🏆 ${winner.name} gagne la cagnotte du samedi : ${prizeAmount} USDT ! Félicitations ! 🎉`,
        createdAt: new Date()
    });

    // Transfert des USDT
    if (winner && prizeAmount > 0) {
        await sendUsdtToWinner(winner.wallet, prizeAmount);
    }

    console.log(`🎁 Cagnotte du samedi : ${winner.name} remporte ${prizeAmount} USDT !`);

    await emitJackpotUpdate();
}

// ============================================================
// VÉRIFICATION DE TRANSACTION (MULTI-TOKENS)
// ============================================================

async function verifyTokenTransaction(txId, expectedFrom, expectedAmount, token = 'USDT') {
    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error(`Token non supporté : ${token}`);

    const cleanTxId = String(txId || "").trim();
    const cleanFrom = normalizeWallet(expectedFrom);
    const requiredAmount = Number(expectedAmount);

    if (!cleanTxId) throw new Error("Transaction ID manquant.");
    if (!isValidTronAddress(cleanFrom)) throw new Error("Adresse TRON invalide.");
    if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) throw new Error("Montant invalide.");

    // --- CAS DU TRX ---
    if (token === 'TRX') {
        const transaction = await tronWeb.trx.getTransaction(cleanTxId);
        if (!transaction || !transaction.txID) throw new Error("Transaction introuvable.");
        const contract = transaction.raw_data?.contract[0];
        if (!contract || contract.type !== 'TransferContract') {
            throw new Error("Ce n'est pas un transfert TRX.");
        }
        const owner = tronWeb.address.fromHex(contract.parameter.value.owner_address);
        if (!sameWallet(owner, cleanFrom)) throw new Error("L'expéditeur ne correspond pas.");
        const recipient = tronWeb.address.fromHex(contract.parameter.value.to_address);
        if (!sameWallet(recipient, MILTAPE_WALLET)) throw new Error("Le destinataire n'est pas le wallet serveur.");
        const amount = contract.parameter.value.amount / 1e6;
        if (amount < requiredAmount) throw new Error(`Montant TRX insuffisant : ${amount} reçu, ${requiredAmount} requis.`);
        const info = await tronWeb.trx.getTransactionInfo(cleanTxId);
        if (!info || !info.receipt || info.receipt.result !== 'SUCCESS') {
            throw new Error("La transaction TRX n'est pas confirmée.");
        }
        return { txId: cleanTxId, from: owner, to: recipient, amount, confirmed: true };
    }

    // --- CAS DES TOKENS TRC20 ---
    const contractAddress = tokenInfo.contract;
    const decimals = tokenInfo.decimals;

    const transaction = await tronWeb.trx.getTransaction(cleanTxId);
    if (!transaction || !transaction.txID) throw new Error("Transaction introuvable.");
    const contracts = transaction.raw_data?.contract;
    if (!Array.isArray(contracts) || contracts.length !== 1) throw new Error("Transaction TRON invalide.");
    const contract = contracts[0];
    if (contract.type !== "TriggerSmartContract") throw new Error("Ce n'est pas une transaction TRC20.");

    const value = contract.parameter?.value;
    if (!value) throw new Error("Données de transaction manquantes.");

    const calledContract = tronWeb.address.fromHex(value.contract_address);
    if (!sameWallet(calledContract, contractAddress)) {
        throw new Error(`Ce n'est pas le contrat ${token}.`);
    }
    const ownerAddress = tronWeb.address.fromHex(value.owner_address);
    if (!sameWallet(ownerAddress, cleanFrom)) throw new Error("L'expéditeur ne correspond pas.");

    const data = String(value.data || "").toLowerCase();
    if (!data.startsWith("a9059cbb")) throw new Error("Ce n'est pas un transfer TRC20.");
    if (data.length < 136) throw new Error("Données invalides.");
    const recipientHex = "41" + data.substring(32, 72);
    const recipient = tronWeb.address.fromHex(recipientHex);
    if (!sameWallet(recipient, MILTAPE_WALLET)) throw new Error("Le destinataire n'est pas le wallet serveur.");

    const amountHex = data.substring(72, 136);
    const rawAmount = BigInt("0x" + amountHex);
    const amount = Number(rawAmount) / Math.pow(10, decimals);
    if (amount < requiredAmount) throw new Error(`Montant insuffisant : ${amount} ${token} reçu, ${requiredAmount} requis.`);

    const info = await tronWeb.trx.getTransactionInfo(cleanTxId);
    if (!info || !info.receipt || info.receipt.result !== "SUCCESS") {
        throw new Error(`La transaction ${token} n'est pas confirmée.`);
    }
    return { txId: cleanTxId, from: ownerAddress, to: recipient, amount, confirmed: true };
}

// ============================================================
// VÉRIFICATION AUTOMATIQUE DES PAIEMENTS (POLLING)
// ============================================================

async function checkPendingPayments() {
    if (game.status !== "running") return;

    try {
        const unpaidPlayers = await Player.find({
            gameId: game.id,
            paid: false,
            bet: { $gt: 0 }
        });

        if (unpaidPlayers.length === 0) return;

        const transactions = await tronWeb.trx.getAccountTransactions(
            MILTAPE_WALLET,
            { limit: 30, onlyConfirmed: true }
        );

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
            let token = null;
            let ownerAddress = null;
            let amount = 0;
            let decimals = 6;

            if (contract.type === "TransferContract") {
                // TRX
                token = 'TRX';
                const value = contract.parameter.value;
                ownerAddress = tronWeb.address.fromHex(value.owner_address);
                amount = value.amount / 1e6;
                const recipient = tronWeb.address.fromHex(value.to_address);
                if (!sameWallet(recipient, MILTAPE_WALLET)) continue;
            } else if (contract.type === "TriggerSmartContract") {
                const value = contract.parameter?.value;
                if (!value) continue;
                const contractAddress = tronWeb.address.fromHex(value.contract_address);
                let foundToken = null;
                for (const [sym, info] of Object.entries(SUPPORTED_TOKENS)) {
                    if (info.contract && sameWallet(contractAddress, info.contract)) {
                        foundToken = sym;
                        decimals = info.decimals;
                        break;
                    }
                }
                if (!foundToken) continue;
                token = foundToken;
                ownerAddress = tronWeb.address.fromHex(value.owner_address);
                const data = String(value.data || "").toLowerCase();
                if (!data.startsWith("a9059cbb")) continue;
                if (data.length < 136) continue;
                const recipientHex = "41" + data.substring(32, 72);
                const recipient = tronWeb.address.fromHex(recipientHex);
                if (!sameWallet(recipient, MILTAPE_WALLET)) continue;
                const amountHex = data.substring(72, 136);
                const rawAmount = BigInt("0x" + amountHex);
                amount = Number(rawAmount) / Math.pow(10, decimals);
            } else {
                continue;
            }

            const matchingPlayer = unpaidPlayers.find(p =>
                sameWallet(p.wallet, ownerAddress) &&
                p.bet > 0 &&
                p.token === token &&
                amount >= p.bet
            );

            if (!matchingPlayer) continue;

            matchingPlayer.paid = true;
            matchingPlayer.paymentTxId = txId;
            await matchingPlayer.save();

            processedTxIds.add(txId);

            await Payment.create({
                txId: txId,
                from: ownerAddress,
                to: MILTAPE_WALLET,
                amount: amount,
                verified: true,
                gameId: game.id,
                token: token
            });

            io.emit("payment:verified", {
                verified: true,
                wallet: matchingPlayer.wallet,
                amount: matchingPlayer.bet,
                playerName: matchingPlayer.name,
                automatic: true,
                token: token
            });

            io.emit("chat:message", {
                name: "🟢 Système",
                message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} (auto-détecté)`,
                createdAt: new Date()
            });

            sendNotification('success', `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`, {
                playerName: matchingPlayer.name,
                amount: matchingPlayer.bet,
                token: token
            });

            console.log(`💰 Paiement automatique détecté : ${matchingPlayer.name} (${matchingPlayer.bet} ${token}) - TX: ${txId}`);
        }
    } catch (error) {
        console.error("❌ Erreur vérification auto paiements :", error.message);
    }
}

// Nettoyer les TXID traités toutes les heures
setInterval(() => {
    if (processedTxIds.size > 1000) {
        processedTxIds.clear();
        console.log("🧹 Nettoyage des TXID traités");
    }
}, 60 * 60 * 1000);

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

            if (remaining === 60) {
                sendNotification('warning', `⏱️ DERNIÈRE MINUTE ! Tapez plus vite !`);
            }

            if (remaining <= 0) {
                await finishGame();
            }
        } catch (error) {
            console.error("gameTimer:", error.message);
        }
    }, 1000);
}

// ============================================================
// FIN GAME – AVEC REDISTRIBUTION DOUBLE MISE, HISTORIQUE ET CAGNOTTE
// ============================================================

async function finishGame() {
    if (game.status !== "running") return;

    game.status = "finished";

    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    const allPlayers = await Player.find({ gameId: game.id }).lean();
    const top5 = await Player
        .find({ gameId: game.id })
        .sort({ taps: -1 })
        .limit(5)
        .lean();

    const totalStakes = allPlayers.reduce((sum, p) => sum + p.bet, 0);

    const winners = top5.map((player, index) => {
        const gain = player.bet * 2;
        return {
            rank: index + 1,
            name: player.name,
            wallet: player.wallet,
            bet: player.bet,
            gain: gain,
            taps: player.taps,
            _id: player._id,
            token: player.token || 'USDT'
        };
    });

    const totalPayout = winners.reduce((sum, w) => sum + w.gain, 0);
    const deficit = totalPayout - totalStakes; // >0 = perte, <0 = bénéfice

    console.log("");
    console.log("🏁 PARTIE TERMINÉE :", game.id);
    console.log("💰 Total des mises :", totalStakes, "USDT");
    console.log("💸 Gains à redistribuer :", totalPayout, "USDT");

    const serverProfit = deficit > 0 ? 0 : Math.abs(deficit); // bénéfice réel

    if (deficit > 0) {
        console.log(`📉 DÉFICIT : ${deficit} USDT (pris depuis le wallet serveur)`);
    } else {
        console.log(`✅ BÉNÉFICE SERVEUR : ${serverProfit} USDT`);
    }

    // ---- Prélèvement pour la cagnotte (20% du bénéfice) ----
    if (serverProfit > 0) {
        await addToJackpotFund(serverProfit);
    }

    // ---- Enregistrement des gagnants et historique ----
    for (const winner of winners) {
        await Player.findByIdAndUpdate(winner._id, { paid: true });

        await History.create({
            playerId: winner._id,
            playerName: winner.name,
            wallet: winner.wallet,
            gameId: game.id,
            rank: winner.rank,
            bet: winner.bet,
            gain: winner.gain,
            taps: winner.taps,
            token: winner.token
        });
    }

    // ---- Émettre les résultats ----
    io.emit("game:finished", {
        gameId: game.id,
        winners: winners,
        totalStakes: totalStakes,
        totalPayout: totalPayout,
        deficit: deficit,
        onlinePlayers: onlineSockets.size,
        spectators: spectatorSockets.size
    });

    winners.forEach((w, index) => {
        const emoji = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
        sendNotification('champion', `${emoji} #${w.rank} ${w.name} → ${w.gain} USDT !`, { winner: w });
    });
    sendNotification('alert', `⏰ Partie terminée ! Prochaine partie dans 5 secondes...`);

    // ---- Transfert réel des gains ----
    const realPayments = await Payment.find({ gameId: game.id, verified: true });
    if (realPayments.length > 0) {
        console.log("💸 Envoi des USDT aux gagnants...");
        await sendUsdtToWinners(winners);
    } else {
        console.log("🔬 Mode démo ou aucun paiement réel : transferts simulés.");
    }

    await broadcastGameState();
    await emitJackpotUpdate();

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
    await emitJackpotUpdate();

    const totalStakes = await getTotalStakes();
    socket.emit("totalStakes:update", { totalStakes });

    // ---- Demande de la cagnotte ----
    socket.on("jackpot:get", async () => {
        await emitJackpotUpdate();
    });

    // --- JOIN (joueur) ---
    socket.on("player:join", async (data) => {
        try {
            const name = String(data?.name || "").trim().substring(0, 30);
            const wallet = normalizeWallet(data?.wallet);
            const bet = Number(data?.bet);
            const token = String(data?.token || "USDT").trim();

            if (!name) return socket.emit("error", { message: "Nom invalide." });
            if (!isValidTronAddress(wallet)) return socket.emit("error", { message: "Adresse TRON invalide." });
            if (!Number.isFinite(bet) || bet <= 0) return socket.emit("error", { message: "Montant invalide." });
            if (!SUPPORTED_TOKENS[token]) return socket.emit("error", { message: "Token non supporté." });
            if (game.status !== "running") return socket.emit("error", { message: "La partie n'est pas ouverte." });

            let player = await Player.findOne({ gameId: game.id, wallet });

            if (!player) {
                player = await Player.create({
                    gameId: game.id,
                    name,
                    wallet,
                    taps: 0,
                    bet,
                    paid: false,
                    token
                });
            } else {
                player.name = name;
                player.bet = bet;
                player.token = token;
                await player.save();
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.wallet = wallet;
            socket.data.name = name;
            socket.data.isSpectator = false;

            // ---- Ajouter le joueur à la cagnotte ----
            const jackpot = await getCurrentJackpot();
            if (jackpot && !jackpot.drawn) {
                if (!jackpot.participants.includes(player._id)) {
                    jackpot.participants.push(player._id);
                    await jackpot.save();
                    await emitJackpotUpdate();
                }
            }

            socket.emit("player:joined", {
                success: true,
                player: {
                    id: player._id,
                    name: player.name,
                    wallet: player.wallet,
                    taps: player.taps,
                    bet: player.bet,
                    paid: player.paid,
                    token: player.token
                }
            });

            sendNotification('info', `🎮 ${player.name} a rejoint la partie !`, { playerName: player.name });

            await broadcastGameState();

            const newTotalStakes = await getTotalStakes();
            io.emit("totalStakes:update", { totalStakes: newTotalStakes });
        } catch (error) {
            console.error("player:join:", error.message);
            socket.emit("error", { message: "Impossible de rejoindre la partie." });
        }
    });

    // --- SPECTATEUR ---
    socket.on("spectator:join", async (data) => {
        try {
            const name = String(data?.name || "Spectateur").trim().substring(0, 30);

            socket.data.isSpectator = true;
            socket.data.name = name;
            socket.data.gameId = game.id;

            spectatorSockets.add(socket.id);
            const spectatorCount = spectatorSockets.size;

            socket.emit("spectator:joined", {
                success: true,
                name: name,
                spectators: spectatorCount
            });

            io.emit("chat:message", {
                name: "👁️ Système",
                message: `${name} regarde la partie en direct ! (${spectatorCount} spectateur${spectatorCount > 1 ? 's' : ''})`,
                createdAt: new Date()
            });

            await broadcastGameState();
            console.log("👁️ Spectateur rejoint :", name);
        } catch (error) {
            console.error("spectator:join:", error.message);
            socket.emit("error", { message: "Impossible de rejoindre en spectateur." });
        }
    });

    // --- RESTAURATION DE SESSION ---
    socket.on("player:restore", async (data) => {
        try {
            const playerId = data?.playerId;
            const wallet = normalizeWallet(data?.wallet);

            if (!playerId && !wallet) {
                return socket.emit("error", { message: "playerId ou wallet requis." });
            }

            const query = { gameId: game.id };
            if (playerId) query._id = playerId;
            else query.wallet = wallet;

            const player = await Player.findOne(query);
            if (!player) {
                return socket.emit("error", { message: "Joueur introuvable." });
            }

            socket.data.playerId = player._id.toString();
            socket.data.gameId = game.id;
            socket.data.wallet = player.wallet;
            socket.data.name = player.name;
            socket.data.isSpectator = false;

            socket.emit("player:restored", {
                success: true,
                player: {
                    id: player._id,
                    name: player.name,
                    wallet: player.wallet,
                    taps: player.taps,
                    bet: player.bet,
                    paid: player.paid,
                    token: player.token || 'USDT'
                }
            });

            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);

            const totalStakesRestore = await getTotalStakes();
            io.emit("totalStakes:update", { totalStakes: totalStakesRestore });

            console.log("🔄 Session restaurée :", player.name, player.taps, "taps");
        } catch (error) {
            console.error("player:restore:", error.message);
            socket.emit("error", { message: "Erreur restauration." });
        }
    });

    // --- TAP ---
    socket.on("player:tap", async () => {
        try {
            if (game.status !== "running" || getRemainingSeconds() <= 0 || !socket.data.playerId) return;
            if (socket.data.isSpectator) return;

            const player = await Player.findById(socket.data.playerId);
            if (!player || player.gameId !== game.id) return;

            const oldTaps = player.taps;
            player.taps += 1;
            await player.save();

            socket.emit("player:score", { taps: player.taps });

            const leaderboard = await getLeaderboard();
            io.emit("leaderboard:update", leaderboard);

            const playerRank = leaderboard.findIndex(p => p.id === player._id);
            if (playerRank !== -1 && playerRank < 5 && oldTaps < 5) {
                sendNotification('info', `🔥 ${player.name} est dans le Top 5 ! (${player.taps} taps)`, {
                    playerName: player.name,
                    rank: playerRank + 1,
                    taps: player.taps
                });
            }
        } catch (error) {
            console.error("player:tap:", error.message);
        }
    });

    // --- CHAT ---
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

    // --- DISCONNECT ---
    socket.on("disconnect", async () => {
        onlineSockets.delete(socket.id);
        spectatorSockets.delete(socket.id);
        console.log("🔴 Socket déconnecté :", socket.id);
        await broadcastGameState();
    });
});

// ============================================================
// ROUTES ADMIN
// ============================================================

app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, message: "Connecté." });
    } else {
        res.status(401).json({ success: false, message: "Mot de passe incorrect." });
    }
});

app.get("/api/admin/stats", async (req, res) => {
    try {
        const recentPlayers = await Player
            .find({ gameId: game.id })
            .sort({ updatedAt: -1 })
            .limit(20)
            .select('name wallet taps token');
        res.json({
            success: true,
            recentPlayers: recentPlayers.map(p => ({
                playerName: p.name,
                playerId: p._id,
                score: p.taps,
                wallet: p.wallet,
                token: p.token || 'USDT'
            }))
        });
    } catch (error) {
        console.error("/api/admin/stats:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/api/admin/payouts", async (req, res) => {
    try {
        const winners = await Player
            .find({ gameId: game.id })
            .sort({ taps: -1 })
            .limit(5)
            .select('name wallet taps bet token');
        res.json({
            success: true,
            winners: winners.map((p, index) => ({
                rank: index + 1,
                playerName: p.name,
                wallet: p.wallet,
                score: p.taps,
                amount: p.bet || 0,
                token: p.token || 'USDT'
            }))
        });
    } catch (error) {
        console.error("/api/admin/payouts:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

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
// API JACKPOT (NOUVEAU)
// ============================================================

app.get("/api/jackpot", async (req, res) => {
    try {
        const jackpot = await getCurrentJackpot();
        const nextDraw = getNextSaturday();
        let winner = null;
        if (jackpot.winner) {
            winner = await Player.findById(jackpot.winner).select('name');
        }
        res.json({
            success: true,
            jackpot: {
                prize: jackpot.prize,
                participants: jackpot.participants.length,
                nextDraw: nextDraw,
                drawn: jackpot.drawn,
                winner: winner ? winner.name : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// API HISTORIQUE DES GAINS
// ============================================================

app.get("/api/player/history", async (req, res) => {
    try {
        const { wallet, playerId } = req.query;
        if (!wallet && !playerId) {
            return res.status(400).json({ success: false, message: "wallet ou playerId requis" });
        }

        let player = null;
        if (playerId) {
            player = await Player.findById(playerId);
        } else {
            player = await Player.findOne({ wallet: normalizeWallet(wallet) });
        }
        if (!player) {
            return res.status(404).json({ success: false, message: "Joueur introuvable" });
        }

        const history = await History.find({ playerId: player._id })
            .sort({ createdAt: -1 })
            .limit(100);

        const totalGain = history.reduce((sum, h) => sum + h.gain, 0);
        const totalBets = history.reduce((sum, h) => sum + h.bet, 0);
        const gamesPlayed = history.length;
        const bestScore = history.length > 0 ? Math.max(...history.map(h => h.taps)) : 0;

        res.json({
            success: true,
            player: {
                name: player.name,
                wallet: player.wallet,
                totalGain,
                totalBets,
                gamesPlayed,
                bestScore,
                token: player.token || 'USDT'
            },
            history: history.map(h => ({
                ...h.toObject(),
                token: h.token || 'USDT'
            }))
        });
    } catch (error) {
        console.error("/api/player/history:", error.message);
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
            spectators: spectatorSockets.size,
            leaderboard
        });
    } catch (error) {
        console.error("/api/game:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/wallet", (req, res) => {
    res.json({
        success: true,
        wallet: MILTAPE_WALLET,
        usdtContract: USDT_CONTRACT,
        supportedTokens: Object.keys(SUPPORTED_TOKENS)
    });
});

app.post("/api/join", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().substring(0, 30);
        const wallet = normalizeWallet(req.body?.wallet);
        const bet = Number(req.body?.bet);
        const token = String(req.body?.token || "USDT").trim();

        if (!name) return res.status(400).json({ success: false, message: "Nom invalide." });
        if (!isValidTronAddress(wallet)) return res.status(400).json({ success: false, message: "Adresse TRON invalide." });
        if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ success: false, message: "Montant invalide." });
        if (!SUPPORTED_TOKENS[token]) return res.status(400).json({ success: false, message: "Token non supporté." });
        if (game.status !== "running") return res.status(400).json({ success: false, message: "La partie n'est pas ouverte." });

        let player = await Player.findOne({ gameId: game.id, wallet });

        if (!player) {
            player = await Player.create({ gameId: game.id, name, wallet, taps: 0, bet, paid: false, token });
        } else {
            player.name = name;
            player.bet = bet;
            player.token = token;
            await player.save();
        }

        // Ajouter à la cagnotte
        const jackpot = await getCurrentJackpot();
        if (jackpot && !jackpot.drawn) {
            if (!jackpot.participants.includes(player._id)) {
                jackpot.participants.push(player._id);
                await jackpot.save();
            }
        }

        res.json({
            success: true,
            player: {
                id: player._id,
                name: player.name,
                wallet: player.wallet,
                taps: player.taps,
                bet: player.bet,
                paid: player.paid,
                token: player.token
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
                paid: player.paid,
                token: player.token || 'USDT'
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

// ============================================================
// API PAYMENT VERIFY
// ============================================================

app.post("/api/payment/verify", async (req, res) => {
    try {
        const txId = String(req.body?.txId || "").trim();
        const wallet = normalizeWallet(req.body?.wallet);
        const amount = Number(req.body?.amount);
        const playerId = String(req.body?.playerId || "").trim();
        const token = String(req.body?.token || "USDT").trim();

        if (!txId) return res.status(400).json({ success: false, verified: false, message: "txId manquant." });

        const existing = await Payment.findOne({ txId });
        if (existing) {
            return res.json({ success: true, verified: existing.verified, alreadyVerified: true, payment: existing });
        }

        const result = await verifyTokenTransaction(txId, wallet, amount, token);
        const payment = await Payment.create({
            txId: result.txId,
            from: result.from,
            to: result.to,
            amount: result.amount,
            verified: true,
            gameId: game.id,
            token: token
        });

        if (playerId) {
            const player = await Player.findById(playerId);
            if (player && player.gameId === game.id) {
                player.paid = true;
                player.paymentTxId = txId;
                player.token = token;
                await player.save();
            }
        }

        io.emit("payment:verified", {
            txId,
            wallet: result.from,
            amount: result.amount,
            verified: true,
            token: token
        });
        res.json({
            success: true,
            verified: true,
            payment: {
                txId: result.txId,
                from: result.from,
                to: result.to,
                amount: result.amount,
                token: token
            }
        });
    } catch (error) {
        console.error("❌ Payment verification:", error.message);
        res.status(400).json({ success: false, verified: false, message: error.message });
    }
});

app.get("/api/online", (req, res) => {
    res.json({ success: true, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size });
});

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
        onlinePlayers: onlineSockets.size,
        spectators: spectatorSockets.size,
        supportedTokens: Object.keys(SUPPORTED_TOKENS)
    });
});

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
    console.log("💵 Tokens supportés :", Object.keys(SUPPORTED_TOKENS).join(", "));
    console.log("🎮 Jeu : 10 minutes");
    console.log("🏆 Top 5");
    console.log("💬 Chat actif");
    console.log("⏱️ Chrono actif");
    console.log("👁️ Mode spectateur activé");
    console.log("💸 Surveillance automatique des paiements activée (15s)");
    console.log("📊 Total des mises dynamique");
    console.log("📈 Historique des gains activé");
    console.log("🔔 Notifications en temps réel activées");
    console.log(`🎁 Cagnotte du samedi (${JACKPOT_PERCENT}% du bénéfice) – Tirage à ${JACKPOT_HOUR}h`);
    console.log("==============================================");

    try {
        await startGame();
    } catch (error) {
        console.error("❌ Impossible de démarrer le jeu :", error.message);
    }

    setInterval(checkPendingPayments, 15000);

    // ---- Vérification du tirage de la cagnotte toutes les minutes ----
    setInterval(async () => {
        const now = new Date();
        const day = now.getDay(); // 6 = samedi
        const hours = now.getHours();
        const minutes = now.getMinutes();

        if (day === 6 && hours === JACKPOT_HOUR && minutes === 0) {
            await drawJackpot();
        }
    }, 60000);
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
