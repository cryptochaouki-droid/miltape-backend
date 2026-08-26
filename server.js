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
// GARDE-FOUS & GESTION PROPRE DU SIGTERM
// ============================================================

process.on("uncaughtException", (err) => {
    console.error(
        "❌ Erreur non gérée interceptée (le serveur continue) :",
        err.message
    );
});

process.on("unhandledRejection", (reason) => {
    console.error(
        "❌ Rejet non géré intercepté (le serveur continue) :",
        reason
    );
});

const GAME_DURATION_SECONDS = 10 * 60;

// ============================================================
// TOKENS SUPPORTÉS
// ============================================================

const SUPPORTED_TOKENS = {
    USDT: {
        contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        decimals: 6,
        symbol: "USDT"
    },

    USDC: {
        contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
        decimals: 6,
        symbol: "USDC"
    },

    TUSD: {
        contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
        decimals: 6,
        symbol: "TUSD"
    },

    TRX: {
        contract: null,
        decimals: 6,
        symbol: "TRX"
    }
};

// ============================================================
// VARIABLES D'ENVIRONNEMENT
// ============================================================

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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const DEMO_MODE_ENABLED_ON_SERVER =
    process.env.ALLOW_DEMO_MODE === "true";

if (!ADMIN_PASSWORD) {
    console.error("❌ ADMIN_PASSWORD manque.");
    process.exit(1);
}

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI / MONGO_URI manque.");
    process.exit(1);
}

if (!PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY manque.");
    process.exit(1);
}

// ============================================================
// VARIABLES GLOBALES
// ============================================================

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
// TRONWEB
// ============================================================

try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        headers: TRONGRID_API_KEY
            ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY }
            : {},
        privateKey: PRIVATE_KEY
    });

    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);

    console.log("✅ Wallet :", MILTAPE_WALLET);

} catch (error) {
    console.error("❌ Erreur TronWeb :", error.message);
    process.exit(1);
}

// ============================================================
// EXPRESS
// ============================================================

const app = express();
const server = http.createServer(app);

app.use(helmet());

app.set("trust proxy", 1);

const FRONTEND_ORIGINS = "*";

app.use(cors({
    origin: FRONTEND_ORIGINS
}));

app.use(express.json({
    limit: "1mb"
}));

app.use(express.urlencoded({
    extended: true
}));

app.use(express.static(__dirname));

// ============================================================
// HEALTH CHECK RAILWAY
// ============================================================

app.get("/api/status", (req, res) => {
    res.status(200).json({
        success: true,
        status: "online",
        service: "miltape-backend",
        gameStatus: game.status,
        gameId: game.id,
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// RATE LIMIT
// ============================================================

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,

    message: {
        error: "Trop de requêtes, veuillez réessayer plus tard."
    }
});

app.use("/api/", limiter);

// ============================================================
// SOCKET.IO
// ============================================================

const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGINS,
        methods: ["GET", "POST"]
    }
});

// ============================================================
// MONGOOSE
// ============================================================

mongoose.set("strictQuery", true);

// ============================================================
// PLAYER SCHEMA
// ============================================================

const playerSchema = new mongoose.Schema(
    {
        gameId: {
            type: String,
            required: true,
            index: true
        },

        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 30
        },

        wallet: {
            type: String,
            trim: true,
            index: true
        },

        deviceId: {
            type: String,
            trim: true,
            index: true
        },

        taps: {
            type: Number,
            default: 0,
            min: 0
        },

        bet: {
            type: Number,
            default: 0,
            min: 0
        },

        paid: {
            type: Boolean,
            default: false
        },

        paymentTxId: {
            type: String,
            default: null,
            unique: true,
            sparse: true
        },

        token: {
            type: String,
            default: "USDT"
        },

        depositAmount: {
            type: Number,
            default: null
        },

        depositExpiresAt: {
            type: Date,
            default: null
        }
    },

    {
        timestamps: true
    }
);

// ============================================================
// MESSAGE SCHEMA
// ============================================================

const messageSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 30
        },

        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300
        },

        gameId: {
            type: String,
            default: null
        }
    },

    {
        timestamps: true
    }
);

// ============================================================
// PAYMENT SCHEMA
// ============================================================

const paymentSchema = new mongoose.Schema(
    {
        txId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        from: {
            type: String,
            required: true
        },

        to: {
            type: String,
            required: true
        },

        amount: {
            type: Number,
            required: true
        },

        verified: {
            type: Boolean,
            default: false
        },

        gameId: {
            type: String,
            default: null
        },

        token: {
            type: String,
            default: "USDT"
        }
    },

    {
        timestamps: true
    }
);

// ============================================================
// HISTORY SCHEMA
// ============================================================

const historySchema = new mongoose.Schema(
    {
        playerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Player",
            required: true
        },

        playerName: {
            type: String,
            required: true
        },

        wallet: {
            type: String,
            required: true
        },

        gameId: {
            type: String,
            required: true
        },

        rank: {
            type: Number,
            required: true
        },

        bet: {
            type: Number,
            required: true
        },

        gain: {
            type: Number,
            required: true
        },

        taps: {
            type: Number,
            required: true
        },

        token: {
            type: String,
            default: "USDT"
        },

        createdAt: {
            type: Date,
            default: Date.now
        }
    },

    {
        timestamps: true
    }
);

// ============================================================
// JACKPOT SCHEMA
// ============================================================

const jackpotSchema = new mongoose.Schema(
    {
        weekStart: {
            type: Date,
            required: true
        },

        weekEnd: {
            type: Date,
            required: true
        },

        prize: {
            type: Number,
            default: 0
        },

        accumulatedFund: {
            type: Number,
            default: 0
        },

        winner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Player",
            default: null
        },

        drawn: {
            type: Boolean,
            default: false
        },

        participants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Player"
            }
        ]
    },

    {
        timestamps: true
    }
);

// ============================================================
// MODELS
// ============================================================

const Player = mongoose.model("Player", playerSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);

// ============================================================
// MONGODB CONNECTION
// ============================================================

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log("✅ MongoDB connecté.");
    })
    .catch((error) => {
        console.error(
            "❌ MongoDB erreur :",
            error.message
        );

        process.exit(1);
    });

// ============================================================
// UTILITAIRES
// ============================================================

function normalizeWallet(address) {
    return String(address || "").trim();
}

function isValidTronAddress(address) {
    try {
        return tronWeb.isAddress(
            normalizeWallet(address)
        );
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
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()
    );
}

function getRemainingSeconds() {

    if (
        game.status !== "running" ||
        !game.endsAt
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (game.endsAt - Date.now()) / 1000
        )
    );
}

// ============================================================
// MONTANT UNIQUE
// ============================================================

async function assignUniqueDepositAmount(
    baseBet,
    gameId
) {

    let uniqueAmount;

    for (let i = 0; i < 5; i++) {

        const candidate = Number(
            (
                baseBet +
                Math.random() * 0.001
            ).toFixed(6)
        );

        const existing =
            await Player.findOne({
                gameId,
                depositAmount: candidate,
                paid: false
            });

        if (!existing) {
            uniqueAmount = candidate;
            break;
        }
    }

    if (!uniqueAmount) {
        uniqueAmount = Number(
            (
                baseBet +
                0.000999
            ).toFixed(6)
        );
    }

    return uniqueAmount;
}

// ============================================================
// VÉRIFICATION ON-CHAIN
// ============================================================

async function verifyOnChain(
    txId,
    expectedAmount,
    token = "USDT"
) {

    const tokenInfo =
        SUPPORTED_TOKENS[token];

    if (!tokenInfo) {
        throw new Error(
            "Token non supporté"
        );
    }

    const tx =
        await tronWeb.trx.getTransaction(
            txId
        );

    if (!tx) return false;

    const contract =
        tx.raw_data?.contract?.[0];

    if (!contract) return false;

    let amount = 0;

    if (token === "TRX") {

        if (
            contract.type !==
            "TransferContract"
        ) {
            return false;
        }

        const value =
            contract.parameter.value;

        if (
            tronWeb.address.fromHex(
                value.to_address
            ) !== MILTAPE_WALLET
        ) {
            return false;
        }

        amount =
            value.amount / 1e6;

    } else {

        if (
            contract.type !==
            "TriggerSmartContract"
        ) {
            return false;
        }

        const value =
            contract.parameter.value;

        if (
            tronWeb.address.fromHex(
                value.contract_address
            ) !== tokenInfo.contract
        ) {
            return false;
        }

        const recipient =
            tronWeb.address.fromHex(
                "41" +
                String(value.data)
                    .substring(32, 72)
            );

        if (
            recipient !==
            MILTAPE_WALLET
        ) {
            return false;
        }

        const rawAmount =
            BigInt(
                "0x" +
                String(value.data)
                    .substring(72, 136)
            );

        amount =
            Number(rawAmount) /
            Math.pow(
                10,
                tokenInfo.decimals
            );
    }

    const txInfo =
        await tronWeb.trx.getTransactionInfo(
            txId
        );

    if (
        !txInfo ||
        txInfo.receipt?.result !== "SUCCESS" ||
        !txInfo.blockNumber
    ) {
        return false;
    }

    return (
        Math.abs(
            amount - expectedAmount
        ) < 0.0000001
    );
}

// ============================================================
// TRANSACTIONS TRX
// ============================================================

async function getIncomingTrxTransactions(
    address
) {

    try {

        const url =
            `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=30&only_confirmed=true`;

        const headers =
            TRONGRID_API_KEY
                ? {
                    "TRON-PRO-API-KEY":
                        TRONGRID_API_KEY
                }
                : {};

        const res =
            await fetch(
                url,
                { headers }
            );

        const data =
            await res.json();

        return data.data || [];

    } catch (e) {

        console.log(
            "Erreur API TRX (ignorée) :",
            e.message
        );

        return [];
    }
}

// ============================================================
// TRANSACTIONS TRC20
// ============================================================

async function getIncomingTrc20Transactions(
    address
) {

    try {

        const url =
            `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=30&only_confirmed=true`;

        const headers =
            TRONGRID_API_KEY
                ? {
                    "TRON-PRO-API-KEY":
                        TRONGRID_API_KEY
                }
                : {};

        const res =
            await fetch(
                url,
                { headers }
            );

        const data =
            await res.json();

        return data.data || [];

    } catch (e) {

        console.log(
            "Erreur API TRC20 (ignorée) :",
            e.message
        );

        return [];
    }
}

// ============================================================
// VÉRIFICATION AUTOMATIQUE DES PAIEMENTS
// ============================================================

async function checkPendingPayments() {

    if (
        game.status !== "running"
    ) {
        return;
    }

    try {

        const unpaidPlayers =
            await Player.find({
                gameId: game.id,
                paid: false,
                bet: { $gt: 0 },
                depositAmount: {
                    $ne: null
                }
            });

        if (
            unpaidPlayers.length === 0
        ) {
            return;
        }

        const trxTransactions =
            await getIncomingTrxTransactions(
                MILTAPE_WALLET
            );

        const trc20Transactions =
            await getIncomingTrc20Transactions(
                MILTAPE_WALLET
            );

        const allTransactions = [
            ...(trxTransactions || []),
            ...(trc20Transactions || [])
        ];

        for (
            const tx of allTransactions
        ) {

            try {

                const txId =
                    tx.transaction_id ||
                    tx.txID;

                let token = null;
                let amount = 0;

                if (tx.token_info) {

                    token =
                        tx.token_info.symbol;

                    amount =
                        tx.value /
                        Math.pow(
                            10,
                            tx.token_info.decimals
                        );

                } else if (
                    tx.raw_data &&
                    tx.raw_data.contract &&
                    tx.raw_data.contract[0]
                ) {

                    const contract =
                        tx.raw_data.contract[0];

                    if (
                        !contract ||
                        contract.type !==
                        "TransferContract"
                    ) {
                        continue;
                    }

                    const value =
                        contract.parameter.value;

                    if (
                        tronWeb.address.fromHex(
                            value.to_address
                        ) !== MILTAPE_WALLET
                    ) {
                        continue;
                    }

                    token = "TRX";

                    amount =
                        value.amount / 1e6;

                } else {
                    continue;
                }

                const matchingPlayer =
                    unpaidPlayers.find(
                        (p) =>
                            p.token === token &&
                            Math.abs(
                                amount -
                                p.depositAmount
                            ) < 0.0000001
                    );

                if (
                    !matchingPlayer
                ) {
                    continue;
                }

                matchingPlayer.paid = true;
                matchingPlayer.paymentTxId =
                    txId;
                matchingPlayer.depositAmount =
                    null;
                matchingPlayer.depositExpiresAt =
                    null;

                await matchingPlayer.save();

                await Payment.create({
                    txId,
                    from: "Paiement anonyme",
                    to: MILTAPE_WALLET,
                    amount,
                    verified: true,
                    gameId: game.id,
                    token
                });

                io.emit(
                    "payment:verified",
                    {
                        verified: true,
                        wallet:
                            matchingPlayer.wallet,
                        amount:
                            matchingPlayer.bet,
                        playerName:
                            matchingPlayer.name,
                        token
                    }
                );

                io.emit(
                    "chat:message",
                    {
                        name: "🟢 Système",
                        message:
                            `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} (auto-détecté)`,
                        createdAt:
                            new Date()
                    }
                );

                sendNotification(
                    "success",
                    `💰 ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token} !`,
                    {
                        playerName:
                            matchingPlayer.name,
                        amount:
                            matchingPlayer.bet,
                        token
                    }
                );

                console.log(
                    `💰 Paiement sécurisé détecté : ${matchingPlayer.name} (${matchingPlayer.bet} ${token}) - TX: ${txId}`
                );

            } catch (err) {

                if (
                    err.code === 11000
                ) {

                    console.log(
                        `🚨 Transaction ${txId} déjà utilisée, ignorée.`
                    );

                } else {

                    console.log(
                        "Transaction ignorée (format inattendu) :",
                        err.message
                    );
                }
            }
        }

    } catch (error) {

        console.error(
            "❌ Erreur vérification auto paiements :",
            error.message
        );
    }
}

// ============================================================
// NOTIFICATION
// ============================================================

function sendNotification(
    type,
    message,
    data = {}
) {

    io.emit(
        "notification",
        {
            type,
            message,
            data
        }
    );
}

// ============================================================
// BROADCAST GAME STATE
// ============================================================

async function broadcastGameState() {

    try {

        const players =
            await Player.find({
                gameId: game.id
            })
                .select(
                    "name taps wallet bet paid token depositAmount"
                )
                .sort({
                    taps: -1
                })
                .limit(50);

        const remainingSeconds =
            getRemainingSeconds();

        io.emit(
            "game:state",
            {
                game: {
                    id: game.id,
                    status: game.status,
                    startsAt:
                        game.startedAt,
                    endsAt:
                        game.endsAt,
                    remainingSeconds
                },

                players
            }
        );

    } catch (error) {

        console.error(
            "Erreur broadcastGameState:",
            error.message
        );
    }
}

// ============================================================
// JACKPOT UPDATE
// ============================================================

async function emitJackpotUpdate() {

    try {

        const weekStart =
            new Date();

        weekStart.setHours(
            0,
            0,
            0,
            0
        );

        weekStart.setDate(
            weekStart.getDate() -
            weekStart.getDay()
        );

        const jackpot =
            await Jackpot.findOne({
                weekStart
            });

        const prize =
            jackpot
                ? jackpot.accumulatedFund
                : 0;

        io.emit(
            "jackpot:update",
            {
                prize
            }
        );

    } catch (error) {

        console.error(
            "Erreur emitJackpotUpdate:",
            error.message
        );
    }
}

// ============================================================
// START GAME
// ============================================================

async function startGame() {

    console.log(
        "🎮 Démarrage de la partie..."
    );

    game.id =
        generateGameId();

    game.status =
        "running";

    game.startedAt =
        new Date();

    game.endsAt =
        new Date(
            Date.now() +
            GAME_DURATION_SECONDS *
            1000
        );

    game.durationSeconds =
        GAME_DURATION_SECONDS;

    io.emit(
        "game:started",
        {
            gameId:
                game.id,
            endsAt:
                game.endsAt,
            duration:
                GAME_DURATION_SECONDS
        }
    );

    if (gameTimer) {
        clearTimeout(gameTimer);
    }

    gameTimer =
        setTimeout(
            () => finishGame(),
            GAME_DURATION_SECONDS *
            1000
        );

    console.log(
        `✅ Partie ${game.id} lancée. Fin dans ${GAME_DURATION_SECONDS} secondes.`
    );
}

// ============================================================
// FIN DE PARTIE
// ============================================================

async function finishGame() {

    console.log(
        "🏁 Fin de la partie en cours..."
    );

    game.status =
        "finished";

    try {

        const players =
            await Player.find({
                gameId: game.id,
                paid: true
            })
                .sort({
                    taps: -1
                });

        if (
            players.length > 0
        ) {

            const totalPot =
                players.reduce(
                    (sum, p) =>
                        sum + p.bet,
                    0
                );

            const prizes = [
                { share: 0.80 },
                { share: 0.15 },
                { share: 0.05 }
            ];

            for (
                let i = 0;
                i < players.length &&
                i < prizes.length;
                i++
            ) {

                const player =
                    players[i];

                const gain =
                    Number(
                        (
                            totalPot *
                            prizes[i].share
                        ).toFixed(6)
                    );

                await History.create({
                    playerId:
                        player._id,

                    playerName:
                        player.name,

                    wallet:
                        player.wallet,

                    gameId:
                        game.id,

                    rank:
                        i + 1,

                    bet:
                        player.bet,

                    gain,

                    taps:
                        player.taps,

                    token:
                        player.token
                });
            }

            const weekStart =
                new Date();

            weekStart.setHours(
                0,
                0,
                0,
                0
            );

            weekStart.setDate(
                weekStart.getDate() -
                weekStart.getDay()
            );

            let jackpot =
                await Jackpot.findOne({
                    weekStart
                });

            if (!jackpot) {

                jackpot =
                    await Jackpot.create({
                        weekStart,

                        weekEnd:
                            new Date(
                                weekStart.getTime() +
                                7 *
                                24 *
                                60 *
                                60 *
                                1000
                            )
                    });
            }

            jackpot.accumulatedFund +=
                totalPot;

            await jackpot.save();
        }

        io.emit(
            "game:finished",
            {
                gameId:
                    game.id,

                winners:
                    players
                        .slice(0, 3)
                        .map(
                            (p) => ({
                                name:
                                    p.name,
                                taps:
                                    p.taps,
                                bet:
                                    p.bet
                            })
                        )
            }
        );

    } catch (error) {

        console.error(
            "❌ Erreur dans finishGame :",
            error.message
        );

    } finally {

        game.status =
            "waiting";

        if (nextGameTimeout) {
            clearTimeout(
                nextGameTimeout
            );
        }

        nextGameTimeout =
            setTimeout(
                () => startGame(),
                10000
            );
    }
}

// ============================================================
// SOCKET.IO
// ============================================================

io.on(
    "connection",
    async (socket) => {

        onlineSockets.add(
            socket.id
        );

        await broadcastGameState();

        await emitJackpotUpdate();

        // ====================================================
        // PLAYER JOIN
        // ====================================================

        socket.on(
            "player:join",
            async (data) => {

                try {

                    const name =
                        String(
                            data?.name || ""
                        )
                            .trim()
                            .substring(
                                0,
                                30
                            );

                    const wallet =
                        normalizeWallet(
                            data?.wallet
                        );

                    const deviceId =
                        normalizeWallet(
                            data?.deviceId
                        );

                    const bet =
                        Number(
                            data?.bet
                        );

                    const token =
                        String(
                            data?.token ||
                            "USDT"
                        )
                            .trim();

                    if (
                        !name ||
                        !isValidTronAddress(
                            wallet
                        ) ||
                        !Number.isFinite(
                            bet
                        ) ||
                        bet <= 0 ||
                        !SUPPORTED_TOKENS[
                            token
                        ]
                    ) {

                        return socket.emit(
                            "error",
                            {
                                message:
                                    "Données invalides."
                            }
                        );
                    }

                    let player;

                    if (deviceId) {

                        player =
                            await Player.findOne(
                                {
                                    gameId:
                                        game.id,
                                    deviceId
                                }
                            );

                    } else {

                        player =
                            await Player.findOne(
                                {
                                    gameId:
                                        game.id,
                                    wallet
                                }
                            );
                    }

                    if (!player) {

                        const depositAmount =
                            await assignUniqueDepositAmount(
                                bet,
                                game.id
                            );

                        player =
                            await Player.create({
                                gameId:
                                    game.id,

                                name,
                                wallet,
                                deviceId,

                                taps: 0,
                                bet,

                                paid: false,

                                token,

                                depositAmount,

                                depositExpiresAt:
                                    new Date(
                                        Date.now() +
                                        15 *
                                        60 *
                                        1000
                                    )
                            });

                    } else {

                        player.name =
                            name;

                        player.bet =
                            bet;

                        player.token =
                            token;

                        player.paid =
                            false;

                        player.paymentTxId =
                            null;

                        player.depositAmount =
                            await assignUniqueDepositAmount(
                                bet,
                                game.id
                            );

                        player.depositExpiresAt =
                            new Date(
                                Date.now() +
                                15 *
                                60 *
                                1000
                            );

                        await player.save();
                    }

                    socket.data.playerId =
                        player._id.toString();

                    socket.data.gameId =
                        game.id;

                    socket.emit(
                        "player:joined",
                        {
                            success:
                                true,

                            player: {
                                id:
                                    player._id,

                                name:
                                    player.name,

                                wallet:
                                    player.wallet,

                                taps:
                                    player.taps,

                                bet:
                                    player.bet,

                                paid:
                                    player.paid,

                                token:
                                    player.token,

                                depositAmount:
                                    player.depositAmount
                            }
                        }
                    );

                    await broadcastGameState();

                } catch (error) {

                    console.error(
                        "player:join:",
                        error.message
                    );

                    socket.emit(
                        "error",
                        {
                            message:
                                "Impossible de rejoindre la partie."
                        }
                    );
                }
            }
        );

        // ====================================================
        // PLAYER TAP
        // ====================================================

        socket.on(
            "player:tap",
            async (data) => {

                try {

                    const playerId =
                        socket.data.playerId;

                    if (
                        !playerId ||
                        game.status !==
                        "running"
                    ) {
                        return;
                    }

                    const taps =
                        Math.max(
                            0,
                            Math.min(
                                10,
                                Number(
                                    data?.taps
                                ) || 1
                            )
                        );

                    await Player.updateOne(
                        {
                            _id:
                                playerId
                        },
                        {
                            $inc: {
                                taps:
                                    taps
                            }
                        }
                    );

                    const player =
                        await Player.findById(
                            playerId
                        )
                            .select(
                                "name taps"
                            );

                    if (!player) {
                        return;
                    }

                    io.emit(
                        "player:update",
                        {
                            id:
                                playerId,

                            name:
                                player.name,

                            taps:
                                player.taps
                        }
                    );

                } catch (error) {

                    console.error(
                        "player:tap:",
                        error.message
                    );
                }
            }
        );

        // ====================================================
        // CHAT
        // ====================================================

        socket.on(
            "chat:send",
            async (data) => {

                try {

                    const name =
                        String(
                            data?.name ||
                            "Anonyme"
                        )
                            .trim()
                            .substring(
                                0,
                                30
                            );

                    const message =
                        String(
                            data?.message ||
                            ""
                        )
                            .trim()
                            .substring(
                                0,
                                300
                            );

                    if (!message) {
                        return;
                    }

                    const msg =
                        await Message.create({
                            name,
                            message,
                            gameId:
                                game.id
                        });

                    io.emit(
                        "chat:message",
                        {
                            id:
                                msg._id,

                            name,

                            message,

                            createdAt:
                                msg.createdAt
                        }
                    );

                } catch (error) {

                    console.error(
                        "chat:send:",
                        error.message
                    );
                }
            }
        );

        // ====================================================
        // DISCONNECT
        // ====================================================

        socket.on(
            "disconnect",
            async () => {

                onlineSockets.delete(
                    socket.id
                );

                await broadcastGameState();
            }
        );
    }
);

// ============================================================
// NETTOYAGE DES PAIEMENTS EXPIRÉS
// ============================================================

setInterval(
    () => {

        if (
            game.status !==
            "running"
        ) {
            return;
        }

        const now =
            new Date();

        Player.updateMany(
            {
                gameId:
                    game.id,

                paid:
                    false,

                depositExpiresAt:
                    {
                        $lt: now
                    }
            },

            {
                $set: {
                    depositExpiresAt:
                        null,

                    depositAmount:
                        null,

                    bet:
                        0
                }
            }
        )
            .catch(
                (err) =>
                    console.error(
                        "Erreur timeout:",
                        err
                    )
            );

    },
    60 * 1000
);

// ============================================================
// API PAYMENT VERIFY
// ============================================================

app.post(
    "/api/payment/verify",
    async (req, res) => {

        try {

            const {
                txId,
                playerId
            } = req.body;

            if (
                String(txId)
                    .startsWith("DEMO_")
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Transaction invalide pour le paiement réel."
                });
            }

            const player =
                await Player.findById(
                    playerId
                );

            if (!player) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Joueur introuvable."
                });
            }

            if (player.paid) {

                return res.json({
                    success: true,
                    verified: true
                });
            }

            const isValid =
                await verifyOnChain(
                    txId,
                    player.depositAmount,
                    player.token
                );

            if (!isValid) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Paiement non vérifié."
                });
            }

            try {

                player.paid =
                    true;

                player.paymentTxId =
                    txId;

                player.depositAmount =
                    null;

                player.depositExpiresAt =
                    null;

                await player.save();

                io.emit(
                    "payment:verified",
                    {
                        verified: true,
                        wallet:
                            player.wallet,
                        amount:
                            player.bet,
                        playerName:
                            player.name,
                        token:
                            player.token
                    }
                );

                return res.json({
                    success: true,
                    verified: true
                });

            } catch (err) {

                if (
                    err.code === 11000
                ) {

                    return res.status(400).json({
                        success: false,
                        message:
                            "Transaction déjà utilisée."
                    });
                }

                throw err;
            }

        } catch (error) {

            console.error(
                "payment/verify:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la vérification du paiement."
            });
        }
    }
);

// ============================================================
// API DEMO VERIFY
// ============================================================

app.post(
    "/api/demo/verify",
    async (req, res) => {

        if (
            !DEMO_MODE_ENABLED_ON_SERVER
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Mode démo désactivé."
            });
        }

        try {

            const {
                playerId
            } = req.body;

            const player =
                await Player.findById(
                    playerId
                );

            if (!player) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Joueur introuvable."
                });
            }

            player.paid =
                true;

            await player.save();

            io.emit(
                "payment:verified",
                {
                    verified: true,
                    demo: true,
                    wallet:
                        player.wallet,
                    amount:
                        player.bet,
                    playerName:
                        player.name,
                    token:
                        player.token
                }
            );

            return res.json({
                success: true,
                verified: true,
                demo: true
            });

        } catch (error) {

            console.error(
                "demo/verify:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur mode démo."
            });
        }
    }
);

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================

server.listen(
    PORT,
    async () => {

        console.log(
            "🚀 BACKEND ONLINE (Sécurisé)"
        );

        console.log(
            `🌐 Port : ${PORT}`
        );

        console.log(
            "❤️ Health check : /api/status"
        );

        try {

            await startGame();

        } catch (e) {

            console.error(
                "Erreur démarrage:",
                e.message
            );
        }

        setInterval(
            checkPendingPayments,
            15000
        );
    }
);

// ============================================================
// GESTION PROPRE DU SIGTERM
// ============================================================

process.on(
    "SIGTERM",
    async () => {

        console.log(
            "🛑 Signal SIGTERM reçu. Fermeture propre du serveur..."
        );

        if (gameTimer) {
            clearTimeout(
                gameTimer
            );
        }

        if (nextGameTimeout) {
            clearTimeout(
                nextGameTimeout
            );
        }

        server.close(
            async () => {

                console.log(
                    "🔌 Serveur HTTP fermé."
                );

                try {

                    await mongoose.connection.close(
                        false
                    );

                    console.log(
                        "📦 Connexion MongoDB fermée."
                    );

                } catch (err) {

                    console.error(
                        "Erreur lors de la fermeture de MongoDB :",
                        err
                    );
                }

                process.exit(0);
            }
        );
    }
);
