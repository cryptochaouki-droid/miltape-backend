const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

/* =========================================================
   MILTAPE WORLD CHALLENGE
   BACKEND COMPLET
   ========================================================= */

const app = express();
const server = http.createServer(app);

/* =========================================================
   CORS
   ========================================================= */

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);

/* =========================================================
   SOCKET.IO
   ========================================================= */

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
});

/* =========================================================
   CONFIGURATION
   ========================================================= */

const PORT =
    Number(process.env.PORT) || 8080;

const MONGO_URI =
    process.env.MONGO_URI || "";

const TRONGRID_API_KEY =
    process.env.TRONGRID_API_KEY || "";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "admin123";

/* =========================================================
   CONFIGURATION JEU
   ========================================================= */

const GAME_DURATION = 600;

const TOP_WINNERS = 5;

const MAX_TAPS_PER_SECOND = 25;

/* =========================================================
   WALLET MILTAPE
   ========================================================= */

const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

/* =========================================================
   USDT TRC20
   ========================================================= */

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const NETWORK = "TRON";

const TOKEN = "USDT";

const CHAIN = "TRC20";

/* =========================================================
   MISES
   ========================================================= */

const MINIMUM_BET = 1;

const MAXIMUM_BET = null;

/* =========================================================
   JACKPOT SAMEDI
   ========================================================= */

const SATURDAY_JACKPOT_PERCENT =
    Number(
        process.env.SATURDAY_JACKPOT_PERCENT
    ) || 5;

const JACKPOT_PERCENT =
    Math.min(
        100,
        Math.max(
            0,
            SATURDAY_JACKPOT_PERCENT
        )
    );

/* =========================================================
   ETAT DU SERVEUR
   ========================================================= */

let mongoConnected = false;

let gameId = 1;

let timerLeft = GAME_DURATION;

let gameRunning = true;

/*
 * playerId -> socketId
 */

const activePlayers =
    new Map();

/*
 * playerId -> rate information
 */

const tapRate =
    new Map();

/* =========================================================
   LOG INITIALISATION
   ========================================================= */

console.log("");
console.log("======================================");
console.log("🔥 MILTAPE WORLD CHALLENGE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log(
    "Durée partie :",
    GAME_DURATION,
    "secondes"
);
console.log(
    "Top gagnants :",
    TOP_WINNERS
);
console.log(
    "Réseau :",
    NETWORK
);
console.log(
    "Token :",
    TOKEN
);
console.log(
    "Standard :",
    CHAIN
);
console.log(
    "Wallet :",
    MILTAPE_WALLET
);
console.log(
    "Mise minimum :",
    MINIMUM_BET,
    "USDT"
);
console.log(
    "Jackpot samedi :",
    JACKPOT_PERCENT,
    "%"
);
console.log(
    "MongoDB :",
    MONGO_URI
        ? "CONFIGURÉ"
        : "❌ MANQUANT"
);
console.log(
    "TronGrid API :",
    TRONGRID_API_KEY
        ? "CONFIGURÉE"
        : "NON CONFIGURÉE"
);
console.log("======================================");
console.log("");

/* =========================================================
   SCHEMA PLAYER
   ========================================================= */

const playerSchema =
    new mongoose.Schema(
        {
            playerId: {
                type: String,
                required: true,
                trim: true,
                maxlength: 100,
                index: true
            },

            playerName: {
                type: String,
                default: "Anonyme",
                trim: true,
                maxlength: 30
            },

            score: {
                type: Number,
                default: 0,
                min: 0
            },

            amount: {
                type: Number,
                required: true,
                min: MINIMUM_BET
            },

            cryptoAddress: {
                type: String,
                default: "",
                trim: true,
                maxlength: 64
            },

            transactionHash: {
                type: String,
                trim: true,
                maxlength: 100,
                default: undefined
            },

            paymentStatus: {
                type: String,
                enum: [
                    "pending",
                    "paid",
                    "rejected"
                ],
                default: "pending",
                index: true
            },

            gameId: {
                type: Number,
                required: true,
                index: true
            },

            createdAt: {
                type: Date,
                default: Date.now
            },

            paidAt: {
                type: Date,
                default: null
            }
        },
        {
            versionKey: false
        }
    );

/* =========================================================
   INDEX
   ========================================================= */

playerSchema.index(
    {
        transactionHash: 1
    },
    {
        unique: true,
        sparse: true,
        name: "unique_transaction_hash"
    }
);

playerSchema.index(
    {
        gameId: 1,
        paymentStatus: 1,
        playerId: 1,
        score: -1
    },
    {
        name:
            "game_payment_player_score"
    }
);

const Player =
    mongoose.model(
        "Player",
        playerSchema
    );

/* =========================================================
   SCHEMA CHAT
   ========================================================= */

const chatSchema =
    new mongoose.Schema(
        {
            playerId: {
                type: String,
                default: "",
                maxlength: 100
            },

            playerName: {
                type: String,
                default: "Anonyme",
                maxlength: 30
            },

            message: {
                type: String,
                required: true,
                maxlength: 300
            },

            createdAt: {
                type: Date,
                default: Date.now
            }
        },
        {
            versionKey: false
        }
    );

const Chat =
    mongoose.model(
        "Chat",
        chatSchema
    );

/* =========================================================
   MONGODB
   ========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI manquant dans Railway."
        );

        mongoConnected = false;

        return false;
    }

    try {

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000
            }
        );

        mongoConnected = true;

        console.log(
            "✅ MongoDB connecté"
        );

        return true;

    } catch (error) {

        mongoConnected = false;

        console.error(
            "❌ MongoDB erreur :",
            error.message
        );

        return false;
    }
}

connectMongoDB();

/* =========================================================
   UTILITAIRES
   ========================================================= */

function cleanString(
    value,
    maxLength = 100
) {

    return String(
        value ?? ""
    )
        .trim()
        .substring(
            0,
            maxLength
        );
}

/* =========================================================
   ADRESSE TRON
   ========================================================= */

function isValidTronAddress(
    address
) {

    const value =
        cleanString(
            address,
            64
        );

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(value);
}

/* =========================================================
   TXID
   ========================================================= */

function isValidTxid(
    txid
) {

    const value =
        cleanString(
            txid,
            100
        );

    return /^[a-fA-F0-9]{64}$/
        .test(value);
}

/* =========================================================
   USDT
   ========================================================= */

function usdtToUnits(
    amount
) {

    return Math.round(
        Number(amount) *
        Math.pow(
            10,
            USDT_DECIMALS
        )
    );
}

function unitsToUsdt(
    units
) {

    return (
        Number(units) /
        Math.pow(
            10,
            USDT_DECIMALS
        )
    );
}

/* =========================================================
   VALIDATION MISE
   ========================================================= */

function isValidBet(
    amount
) {

    const numeric =
        Number(amount);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return false;
    }

    if (
        numeric <
        MINIMUM_BET
    ) {
        return false;
    }

    if (
        MAXIMUM_BET !== null &&
        numeric >
        MAXIMUM_BET
    ) {
        return false;
    }

    const units =
        usdtToUnits(
            numeric
        );

    return Number.isSafeInteger(
        units
    );
}

/* =========================================================
   TRONGRID
   ========================================================= */

function tronHeaders() {

    const headers = {
        Accept:
            "application/json"
    };

    if (
        TRONGRID_API_KEY
    ) {

        headers[
            "TRON-PRO-API-KEY"
        ] =
            TRONGRID_API_KEY;
    }

    return headers;
}

/* =========================================================
   FETCH JSON
   ========================================================= */

async function fetchJson(
    url,
    options = {}
) {

    try {

        const response =
            await fetch(
                url,
                {
                    ...options,

                    headers: {
                        ...tronHeaders(),
                        ...(options.headers || {})
                    }
                }
            );

        const data =
            await response
                .json()
                .catch(
                    () => null
                );

        return {
            response,
            data
        };

    } catch (error) {

        console.error(
            "Fetch error:",
            error.message
        );

        return {
            response: null,
            data: null
        };
    }
}

/* =========================================================
   JACKPOT SAMEDI
   ========================================================= */

function getSaturdayStart() {

    const now =
        new Date();

    const day =
        now.getUTCDay();

    const daysSinceSaturday =
        (day + 1) % 7;

    const saturday =
        new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                0,
                0,
                0,
                0
            )
        );

    saturday.setUTCDate(
        saturday.getUTCDate() -
        daysSinceSaturday
    );

    return saturday;
}

function getNextSaturday() {

    const next =
        new Date(
            getSaturdayStart()
        );

    next.setUTCDate(
        next.getUTCDate() + 7
    );

    return next;
}

async function getSaturdayJackpot() {

    if (!mongoConnected) {

        return {
            totalStakes: 0,
            jackpot: 0,
            percent:
                JACKPOT_PERCENT,
            periodStart:
                getSaturdayStart()
                    .toISOString(),
            nextSaturday:
                getNextSaturday()
                    .toISOString()
        };
    }

    try {

        const periodStart =
            getSaturdayStart();

        const nextSaturday =
            getNextSaturday();

        const result =
            await Player.aggregate(
                [
                    {
                        $match: {
                            paymentStatus:
                                "paid",

                            paidAt: {
                                $gte:
                                    periodStart,

                                $lt:
                                    nextSaturday
                            }
                        }
                    },

                    {
                        $group: {
                            _id: null,

                            totalStakes: {
                                $sum:
                                    "$amount"
                            }
                        }
                    }
                ]
            );

        const totalStakes =
            result.length
                ? Number(
                    result[0]
                        .totalStakes ||
                    0
                )
                : 0;

        const jackpot =
            totalStakes *
            (
                JACKPOT_PERCENT /
                100
            );

        return {
            totalStakes:
                Number(
                    totalStakes.toFixed(
                        6
                    )
                ),

            jackpot:
                Number(
                    jackpot.toFixed(
                        6
                    )
                ),

            percent:
                JACKPOT_PERCENT,

            periodStart:
                periodStart.toISOString(),

            nextSaturday:
                nextSaturday.toISOString()
        };

    } catch (error) {

        console.error(
            "Jackpot error:",
            error.message
        );

        return {
            totalStakes: 0,
            jackpot: 0,
            percent:
                JACKPOT_PERCENT
        };
    }
}

/* =========================================================
   BROADCAST JACKPOT
   ========================================================= */

async function broadcastSaturdayJackpot() {

    try {

        const jackpot =
            await getSaturdayJackpot();

        io.emit(
            "saturdayJackpot",
            jackpot
        );

    } catch (error) {

        console.error(
            "Jackpot broadcast:",
            error.message
        );
    }
}

/* =========================================================
   TOTAL STAKES
   ========================================================= */

async function getTotalStakes() {

    if (!mongoConnected) {
        return 0;
    }

    try {

        const result =
            await Player.aggregate(
                [
                    {
                        $match: {
                            paymentStatus:
                                "paid"
                        }
                    },

                    {
                        $group: {
                            _id: null,

                            total: {
                                $sum:
                                    "$amount"
                            }
                        }
                    }
                ]
            );

        return result.length
            ? Number(
                result[0].total || 0
            )
            : 0;

    } catch {

        return 0;
    }
}

/* =========================================================
   LEADERBOARD
   ========================================================= */

async function getLeaderboard() {

    if (!mongoConnected) {
        return [];
    }

    try {

        const players =
            await Player.aggregate(
                [
                    {
                        $match: {
                            gameId:
                                Number(
                                    gameId
                                ),

                            paymentStatus:
                                "paid"
                        }
                    },

                    {
                        $group: {

                            _id:
                                "$playerId",

                            playerName: {
                                $first:
                                    "$playerName"
                            },

                            score: {
                                $sum: {
                                    $ifNull: [
                                        "$score",
                                        0
                                    ]
                                }
                            },

                            amount: {
                                $sum: {
                                    $ifNull: [
                                        "$amount",
                                        0
                                    ]
                                }
                            }
                        }
                    },

                    {
                        $sort: {
                            score: -1
                        }
                    },

                    {
                        $limit:
                            TOP_WINNERS
                    },

                    {
                        $project: {

                            _id: 0,

                            playerId:
                                "$_id",

                            playerName: 1,

                            score: 1,

                            amount: 1
                        }
                    }
                ]
            );

        return players;

    } catch (error) {

        console.error(
            "Leaderboard error:",
            error.message
        );

        return [];
    }
}

/* =========================================================
   BROADCAST LEADERBOARD
   ========================================================= */

async function broadcastLeaderboard() {

    const leaderboard =
        await getLeaderboard();

    io.emit(
        "leaderboard",
        leaderboard
    );

    io.emit(
        "leaderboard:update",
        leaderboard
    );

    /*
     * Compatibilité avec ancienne version
     */

    io.emit(
        "leaderboardUpdate",
        leaderboard
    );
}

/* =========================================================
   BROADCAST TOTAL STAKES
   ========================================================= */

async function broadcastTotalStakes() {

    const total =
        await getTotalStakes();

    io.emit(
        "totalStakes",
        total
    );

    io.emit(
        "stakes:update",
        {
            total
        }
    );
}

/* =========================================================
   HTTP ROOT
   ========================================================= */

app.get(
    "/",
    async (req, res) => {

        const jackpot =
            await getSaturdayJackpot();

        res.json(
            {
                success: true,

                app:
                    "Miltape World Challenge",

                status:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                gameDuration:
                    GAME_DURATION,

                timerLeft,

                gameRunning,

                saturdayJackpot:
                    jackpot,

                payment: {

                    token:
                        TOKEN,

                    network:
                        NETWORK,

                    chain:
                        CHAIN,

                    address:
                        MILTAPE_WALLET,

                    contract:
                        USDT_CONTRACT,

                    decimals:
                        USDT_DECIMALS,

                    minimumBet:
                        MINIMUM_BET,

                    maximumBet:
                        MAXIMUM_BET
                }
            }
        );
    }
);

/* =========================================================
   STATUS
   ========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        const jackpot =
            await getSaturdayJackpot();

        res.json(
            {
                success: true,

                server:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                timerLeft,

                gameDuration:
                    GAME_DURATION,

                gameRunning,

                saturdayJackpot:
                    jackpot,

                payment: {

                    token:
                        TOKEN,

                    network:
                        NETWORK,

                    chain:
                        CHAIN,

                    wallet:
                        MILTAPE_WALLET,

                    contract:
                        USDT_CONTRACT,

                    decimals:
                        USDT_DECIMALS,

                    minimumBet:
                        MINIMUM_BET,

                    maximumBet:
                        MAXIMUM_BET
                }
            }
        );
    }
);

/* =========================================================
   GAME CONFIG
   ========================================================= */

app.get(
    "/api/game-config",
    async (req, res) => {

        const jackpot =
            await getSaturdayJackpot();

        res.json(
            {
                success: true,

                game: {

                    name:
                        "Miltape World Challenge",

                    duration:
                        GAME_DURATION,

                    gameId,

                    topWinners:
                        TOP_WINNERS
                },

                saturdayJackpot:
                    jackpot,

                jackpotConfig: {

                    percent:
                        JACKPOT_PERCENT,

                    minimumBet:
                        MINIMUM_BET
                },

                payment: {

                    token:
                        TOKEN,

                    network:
                        NETWORK,

                    chain:
                        CHAIN,

                    address:
                        MILTAPE_WALLET,

                    contract:
                        USDT_CONTRACT,

                    decimals:
                        USDT_DECIMALS,

                    minimumBet:
                        MINIMUM_BET,

                    maximumBet:
                        MAXIMUM_BET
                }
            }
        );
    }
);

/* =========================================================
   SATURDAY JACKPOT
   ========================================================= */

app.get(
    "/api/saturday-jackpot",
    async (req, res) => {

        const jackpot =
            await getSaturdayJackpot();

        res.json(
            {
                success: true,
                ...jackpot
            }
        );
    }
);

/* =========================================================
   TOTAL STAKES
   ========================================================= */

app.get(
    "/api/total-stakes",
    async (req, res) => {

        const total =
            await getTotalStakes();

        res.json(
            {
                success: true,

                totalStakes:
                    Number(
                        total.toFixed(
                            6
                        )
                    )
            }
        );
    }
);

/* =========================================================
   ONLINE
   ========================================================= */

app.get(
    "/api/online",
    (req, res) => {

        res.json(
            {
                success: true,

                online:
                    activePlayers.size
            }
        );
    }
);

/* =========================================================
   PLAYER STATS
   ========================================================= */

app.get(
    "/api/player-stats/:playerId",
    async (req, res) => {

        try {

            if (!mongoConnected) {

                return res.json(
                    {
                        success: true,
                        totalTaps: 0,
                        totalUsdt: 0,
                        history: []
                    }
                );
            }

            const playerId =
                cleanString(
                    req.params.playerId,
                    100
                );

            if (!playerId) {

                return res.status(400)
                    .json(
                        {
                            success: false,
                            error:
                                "PLAYER_ID_REQUIRED"
                        }
                    );
            }

            const records =
                await Player.find(
                    {
                        playerId
                    }
                )
                    .sort({
                        createdAt: -1
                    })
                    .lean();

            const totalTaps =
                records.reduce(
                    (
                        sum,
                        player
                    ) =>
                        sum +
                        Number(
                            player.score ||
                            0
                        ),
                    0
                );

            const totalUsdt =
                records.reduce(
                    (
                        sum,
                        player
                    ) =>
                        sum +
                        (
                            player.paymentStatus ===
                            "paid"

                                ? Number(
                                    player.amount ||
                                    0
                                )

                                : 0
                        ),
                    0
                );

            return res.json(
                {
                    success: true,

                    totalTaps,

                    totalUsdt:
                        Number(
                            totalUsdt.toFixed(
                                6
                            )
                        ),

                    history:
                        records.map(
                            player => ({
                                date:
                                    player.createdAt,

                                score:
                                    player.score ||
                                    0,

                                amount:
                                    player.amount ||
                                    0,

                                paymentStatus:
                                    player.paymentStatus,

                                gameId:
                                    player.gameId,

                                transactionHash:
                                    player.transactionHash ||
                                    ""
                            })
                        )
                }
            );

        } catch (error) {

            console.error(
                "Player stats:",
                error.message
            );

            return res.status(500)
                .json(
                    {
                        success: false,
                        error:
                            "PLAYER_STATS_ERROR"
                    }
                );
        }
    }
);

/* =========================================================
   LEADERBOARD HTTP
   ========================================================= */

app.get(
    "/api/leaderboard",
    async (req, res) => {

        const leaderboard =
            await getLeaderboard();

        res.json(
            {
                success: true,

                gameId,

                leaderboard
            }
        );
    }
);

/* =========================================================
   ADMIN LOGIN
   ========================================================= */

app.post(
    "/api/admin/login",
    (req, res) => {

        const password =
            cleanString(
                req.body.password,
                100
            );

        if (!password) {

            return res.status(400)
                .json(
                    {
                        success: false,
                        message:
                            "Mot de passe requis."
                    }
                );
        }

        if (
            password ===
            ADMIN_PASSWORD
        ) {

            return res.json(
                {
                    success: true,
                    message:
                        "Connexion réussie."
                }
            );
        }

        return res.status(401)
            .json(
                {
                    success: false,
                    message:
                        "Mot de passe incorrect !"
                }
            );
    }
);

/* =========================================================
   VERIFY PAYMENT
   ========================================================= */

app.post(
    "/api/verify-payment",
    async (req, res) => {

        try {

            if (!mongoConnected) {

                return res.status(503)
                    .json(
                        {
                            success: false,

                            message:
                                "Base de données indisponible."
                        }
                    );
            }

            const playerId =
                cleanString(
                    req.body.playerId,
                    100
                );

            const playerName =
                cleanString(
                    req.body.playerName ||
                    "Anonyme",
                    30
                );

            const txid =
                cleanString(
                    req.body.txid,
                    100
                );

            const amount =
                Number(
                    req.body.amount
                );

            /*
             * Validation
             */

            if (
                !playerId ||
                !isValidTxid(txid) ||
                !isValidBet(amount)
            ) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Paramètres de paiement invalides."
                        }
                    );
            }

            /*
             * Vérifie transaction déjà utilisée
             */

            const existingTx =
                await Player.findOne(
                    {
                        transactionHash:
                            txid
                    }
                );

            if (existingTx) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Cette transaction a déjà été utilisée."
                        }
                    );
            }

            /*
             * Récupération événement Transfer
             */

            const url =
                `https://api.trongrid.io/v1/transactions/${txid}/events`;

            const {
                response,
                data
            } =
                await fetchJson(
                    url
                );

            if (
                !response ||
                !response.ok
            ) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Impossible de vérifier la transaction TRON."
                        }
                    );
            }

            if (
                !data ||
                !Array.isArray(
                    data.data
                ) ||
                data.data.length === 0
            ) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Transaction introuvable."
                        }
                    );
            }

            /*
             * Recherche transfert USDT
             */

            const transferEvent =
                data.data.find(
                    event => {

                        const contractAddress =
                            event
                                .contract_address ||
                            event
                                .address ||
                            "";

                        return (
                            event.event_name ===
                            "Transfer" &&

                            (
                                !contractAddress ||

                                contractAddress.toLowerCase() ===
                                USDT_CONTRACT.toLowerCase()
                            )
                        );
                    }
                );

            if (!transferEvent) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Transfert USDT TRC20 introuvable."
                        }
                    );
            }

            const result =
                transferEvent.result ||
                {};

            /*
             * Adresse destinataire
             */

            const toAddress =
                result.to ||
                result._to ||
                result[1] ||
                "";

            /*
             * Valeur transférée
             */

            const rawValue =
                result.value ||
                result._value ||
                result[2] ||
                0;

            /*
             * Vérifie destination
             */

            if (
                toAddress &&
                toAddress !==
                    MILTAPE_WALLET
            ) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Le paiement n'a pas été envoyé vers le wallet Miltape."
                        }
                    );
            }

            /*
             * Montant
             */

            const valueUsdt =
                unitsToUsdt(
                    rawValue
                );

            if (
                valueUsdt <
                amount
            ) {

                return res.status(400)
                    .json(
                        {
                            success: false,

                            message:
                                "Montant payé insuffisant.",

                            paid:
                                valueUsdt,

                            required:
                                amount
                        }
                    );
            }

            /*
             * Création joueur
             */

            const newPlayer =
                new Player(
                    {
                        playerId,

                        playerName,

                        amount,

                        score: 0,

                        transactionHash:
                            txid,

                        paymentStatus:
                            "paid",

                        gameId,

                        paidAt:
                            new Date()
                    }
                );

            await newPlayer.save();

            /*
             * Mise à jour jackpot
             */

            await broadcastSaturdayJackpot();

            /*
             * Classement
             */

            await broadcastLeaderboard();

            /*
             * Total mises
             */

            await broadcastTotalStakes();

            return res.json(
                {
                    success: true,

                    message:
                        "Paiement validé avec succès !",

                    player:
                        newPlayer
                }
            );

        } catch (error) {

            console.error(
                "❌ Verify payment:",
                error.message
            );

            return res.status(500)
                .json(
                    {
                        success: false,

                        message:
                            "Erreur serveur lors de la vérification."
                    }
                );
        }
    }
);

/* =========================================================
   CHAT HTTP
   ========================================================= */

app.get(
    "/api/chat",
    async (req, res) => {

        if (!mongoConnected) {

            return res.json(
                {
                    success: true,
                    messages: []
                }
            );
        }

        try {

            const messages =
                await Chat.find()
                    .sort({
                        createdAt: -1
                    })
                    .limit(100)
                    .lean();

            messages.reverse();

            return res.json(
                {
                    success: true,

                    messages
                }
            );

        } catch (error) {

            return res.status(500)
                .json(
                    {
                        success: false,
                        messages: []
                    }
                );
        }
    }
);

/* =========================================================
   TIMER / GAME LOOP
   ========================================================= */

setInterval(
    async () => {

        try {

            if (
                timerLeft > 0
            ) {

                timerLeft--;

                /*
                 * Frontend principal
                 */

                io.emit(
                    "timer",
                    timerLeft
                );

                /*
                 * Frontend alternatif
                 */

                io.emit(
                    "timer:update",
                    {
                        timeLeft:
                            timerLeft,

                        gameId
                    }
                );

                io.emit(
                    "timerUpdate",
                    {
                        timerLeft,

                        gameId
                    }
                );

                /*
                 * Fin de partie
                 */

                if (
                    timerLeft === 0
                ) {

                    gameRunning =
                        false;

                    const winners =
                        await getLeaderboard();

                    /*
                     * Résultats
                     */

                    io.emit(
                        "gameOver",
                        {
                            gameId,

                            winners
                        }
                    );

                    /*
                     * Bloquer taps
                     */

                    io.emit(
                        "timer",
                        0
                    );

                    /*
                     * Nouvelle partie après
                     * quelques secondes.
                     */

                    setTimeout(
                        async () => {

                            gameId++;

                            timerLeft =
                                GAME_DURATION;

                            gameRunning =
                                true;

                            /*
                             * Nouvelle partie
                             */

                            io.emit(
                                "newGame",
                                {
                                    gameId,

                                    duration:
                                        GAME_DURATION,

                                    timerLeft:
                                        GAME_DURATION
                                }
                            );

                            io.emit(
                                "game:new",
                                {
                                    gameId,

                                    duration:
                                        GAME_DURATION,

                                    timerLeft:
                                        GAME_DURATION
                                }
                            );

                            io.emit(
                                "gameStart",
                                {
                                    gameId,

                                    duration:
                                        GAME_DURATION
                                }
                            );

                            /*
                             * Nettoyage rate limit
                             */

                            tapRate.clear();

                            /*
                             * Actualiser classement
                             */

                            await broadcastLeaderboard();

                        },
                        3000
                    );
                }
            }

        } catch (error) {

            console.error(
                "Game loop error:",
                error.message
            );
        }

    },
    1000
);

/* =========================================================
   SOCKET.IO
   ========================================================= */

io.on(
    "connection",
    async (socket) => {

        console.log(
            "🔌 Client connecté :",
            socket.id
        );

        /*
         * Envoyer nombre online
         */

        io.emit(
            "onlineCount",
            activePlayers.size
        );

        io.emit(
            "online:count",
            {
                count:
                    activePlayers.size
            }
        );

        /* =====================================================
           FONCTION JOIN
           ===================================================== */

        async function handleJoin(
            data
        ) {

            const playerId =
                cleanString(
                    data?.playerId,
                    100
                );

            const playerName =
                cleanString(
                    data?.playerName ||
                    "Anonyme",
                    30
                );

            if (!playerId) {
                return;
            }

            /*
             * Enregistrer joueur
             */

            activePlayers.set(
                playerId,
                socket.id
            );

            /*
             * Sauvegarder nom localement
             * dans la session socket
             */

            socket.data.playerId =
                playerId;

            socket.data.playerName =
                playerName;

            /*
             * Données initiales
             */

            const leaderboard =
                await getLeaderboard();

            /*
             * Réponse principale
             */

            socket.emit(
                "initGame",
                {
                    gameId,

                    timerLeft,

                    gameRunning,

                    duration:
                        GAME_DURATION,

                    leaderboard
                }
            );

            /*
             * Compatible frontend
             */

            socket.emit(
                "timer",
                timerLeft
            );

            socket.emit(
                "timer:update",
                {
                    timeLeft:
                        timerLeft,

                    gameId
                }
            );

            socket.emit(
                "leaderboard",
                leaderboard
            );

            socket.emit(
                "leaderboard:update",
                leaderboard
            );

            /*
             * Jackpot
             */

            const jackpot =
                await getSaturdayJackpot();

            socket.emit(
                "saturdayJackpot",
                jackpot
            );

            /*
             * Total mises
             */

            const total =
                await getTotalStakes();

            socket.emit(
                "totalStakes",
                total
            );

            /*
             * Historique chat
             */

            if (mongoConnected) {

                try {

                    const messages =
                        await Chat.find()
                            .sort({
                                createdAt: -1
                            })
                            .limit(100)
                            .lean();

                    messages.reverse();

                    socket.emit(
                        "chatHistory",
                        messages
                    );

                } catch {}
            }

            /*
             * Nombre online
             */

            io.emit(
                "onlineCount",
                activePlayers.size
            );

            io.emit(
                "online:count",
                {
                    count:
                        activePlayers.size
                }
            );

            console.log(
                "👤 Joueur connecté :",
                playerName,
                playerId
            );
        }

        /* =====================================================
           JOIN COMPATIBLE FRONTEND
           ===================================================== */

        socket.on(
            "join",
            handleJoin
        );

        socket.on(
            "joinGame",
            handleJoin
        );

        /* =====================================================
           GET GAME
           ===================================================== */

        async function sendGameData() {

            const leaderboard =
                await getLeaderboard();

            socket.emit(
                "initGame",
                {
                    gameId,

                    timerLeft,

                    gameRunning,

                    duration:
                        GAME_DURATION,

                    leaderboard
                }
            );

            socket.emit(
                "timer",
                timerLeft
            );

            socket.emit(
                "timer:update",
                {
                    timeLeft:
                        timerLeft,

                    gameId
                }
            );

            socket.emit(
                "leaderboard",
                leaderboard
            );
        }

        socket.on(
            "getGame",
            sendGameData
        );

        socket.on(
            "game:get",
            sendGameData
        );

        /* =====================================================
           GET LEADERBOARD
           ===================================================== */

        socket.on(
            "getLeaderboard",
            async () => {

                const leaderboard =
                    await getLeaderboard();

                socket.emit(
                    "leaderboard",
                    leaderboard
                );

                socket.emit(
                    "leaderboard:update",
                    leaderboard
                );
            }
        );

        /* =====================================================
           TAP
           ===================================================== */

        socket.on(
            "tap",
            async (data) => {

                try {

                    const playerId =
                        cleanString(
                            data?.playerId ||
                            socket.data.playerId,
                            100
                        );

                    if (!playerId) {
                        return;
                    }

                    /*
                     * Partie terminée
                     */

                    if (
                        !gameRunning ||
                        timerLeft <= 0
                    ) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "La partie est terminée.",

                                score:
                                    0
                            }
                        );

                        return;
                    }

                    /*
                     * MongoDB obligatoire
                     */

                    if (!mongoConnected) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "Serveur temporairement indisponible."
                            }
                        );

                        return;
                    }

                    /*
                     * Anti-autoclick
                     */

                    const now =
                        Date.now();

                    let info =
                        tapRate.get(
                            playerId
                        );

                    if (!info) {

                        info = {
                            startedAt:
                                now,

                            count: 0
                        };
                    }

                    if (
                        now -
                        info.startedAt >
                        1000
                    ) {

                        info = {
                            startedAt:
                                now,

                            count: 0
                        };
                    }

                    info.count++;

                    tapRate.set(
                        playerId,
                        info
                    );

                    if (
                        info.count >
                        MAX_TAPS_PER_SECOND
                    ) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "Trop de taps.",

                                blocked:
                                    true
                            }
                        );

                        return;
                    }

                    /*
                     * Chercher participation
                     * payée dans la partie actuelle
                     */

                    const playerDoc =
                        await Player.findOne(
                            {
                                playerId,

                                gameId,

                                paymentStatus:
                                    "paid"
                            }
                        )
                            .sort({
                                createdAt:
                                    -1
                            });

                    /*
                     * Pas de paiement
                     */

                    if (!playerDoc) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "Tu dois rejoindre la partie avec une mise validée."
                            }
                        );

                        return;
                    }

                    /*
                     * Ajouter 1 tap
                     */

                    playerDoc.score += 1;

                    await playerDoc.save();

                    /*
                     * Retour joueur
                     */

                    socket.emit(
                        "tapResult",
                        {
                            success:
                                true,

                            playerId,

                            score:
                                playerDoc.score,

                            taps:
                                playerDoc.score
                        }
                    );

                    socket.emit(
                        "tap:result",
                        {
                            success:
                                true,

                            playerId,

                            score:
                                playerDoc.score
                        }
                    );

                    /*
                     * Score update
                     */

                    io.emit(
                        "score:update",
                        {
                            playerId,

                            playerName:
                                playerDoc.playerName,

                            score:
                                playerDoc.score
                        }
                    );

                    /*
                     * Classement
                     */

                    await broadcastLeaderboard();

                } catch (error) {

                    console.error(
                        "❌ TAP ERROR:",
                        error.message
                    );
                }
            }
        );

        /* =====================================================
           CHAT
           ===================================================== */

        async function handleChat(
            data
        ) {

            try {

                const playerId =
                    cleanString(
                        data?.playerId ||
                        socket.data.playerId,
                        100
                    );

                const playerName =
                    cleanString(
                        data?.playerName ||
                        socket.data.playerName ||
                        "Anonyme",
                        30
                    );

                const message =
                    cleanString(
                        data?.message ||
                        data?.text ||
                        data?.content,
                        300
                    );

                if (!message) {
                    return;
                }

                /*
                 * Sauvegarder MongoDB
                 */

                if (mongoConnected) {

                    try {

                        await Chat.create(
                            {
                                playerId,

                                playerName,

                                message
                            }
                        );

                    } catch (
                        error
                    ) {

                        console.error(
                            "Chat MongoDB:",
                            error.message
                        );
                    }
                }

                const chatData =
                    {
                        playerId,

                        playerName,

                        message,

                        createdAt:
                            new Date()
                    };

                /*
                 * Envoyer à tous
                 */

                io.emit(
                    "chatMessage",
                    chatData
                );

                io.emit(
                    "chat:message",
                    chatData
                );

            } catch (error) {

                console.error(
                    "Chat error:",
                    error.message
                );
            }
        }

        socket.on(
            "chatMessage",
            handleChat
        );

        socket.on(
            "chat:send",
            handleChat
        );

        socket.on(
            "sendMessage",
            handleChat
        );

        /* =====================================================
           DISCONNECT
           ===================================================== */

        socket.on(
            "disconnect",
            () => {

                const playerId =
                    socket.data.playerId;

                if (playerId) {

                    const currentSocket =
                        activePlayers.get(
                            playerId
                        );

                    if (
                        currentSocket ===
                        socket.id
                    ) {

                        activePlayers.delete(
                            playerId
                        );
                    }

                    tapRate.delete(
                        playerId
                    );
                }

                /*
                 * Nombre en ligne
                 */

                io.emit(
                    "onlineCount",
                    activePlayers.size
                );

                io.emit(
                    "online:count",
                    {
                        count:
                            activePlayers.size
                    }
                );

                console.log(
                    "🔌 Client déconnecté :",
                    socket.id
                );
            }
        );
    }
);

/* =========================================================
   ERREUR MONGODB
   ========================================================= */

mongoose.connection.on(
    "error",
    (error) => {

        mongoConnected = false;

        console.error(
            "❌ MongoDB connection error:",
            error.message
        );
    }
);

mongoose.connection.on(
    "disconnected",
    () => {

        mongoConnected = false;

        console.warn(
            "⚠️ MongoDB déconnecté"
        );
    }
);

mongoose.connection.on(
    "connected",
    () => {

        mongoConnected = true;

        console.log(
            "🟢 MongoDB connecté"
        );
    }
);

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.status(200)
            .json(
                {
                    success: true,

                    status:
                        "healthy",

                    mongo:
                        mongoConnected,

                    gameId,

                    timerLeft
                }
            );
    }
);

/* =========================================================
   404
   ========================================================= */

app.use(
    (req, res) => {

        res.status(404)
            .json(
                {
                    success: false,

                    error:
                        "ROUTE_NOT_FOUND"
                }
            );
    }
);

/* =========================================================
   SERVER
   ========================================================= */

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "🚀 MILTAPE BACKEND DÉMARRÉ"
        );

        console.log(
            `🌐 Port : ${PORT}`
        );

        console.log(
            `🎮 Partie : ${gameId}`
        );

        console.log(
            `⏱️ Timer : ${GAME_DURATION}s`
        );

        console.log(
            `🏆 Top ${TOP_WINNERS}`
        );

        console.log("");
    }
);
