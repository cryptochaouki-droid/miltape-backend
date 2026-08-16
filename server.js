const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

/*
=========================================================
 MILTAPE WORLD CHALLENGE
 BACKEND V2
=========================================================
*/

const app = express();
const server = http.createServer(app);

/*
=========================================================
 CORS
=========================================================
*/

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);

/*
=========================================================
 SOCKET.IO
=========================================================
*/

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: [
        "websocket",
        "polling"
    ]
});

/*
=========================================================
 CONFIGURATION
=========================================================
*/

const PORT =
    Number(process.env.PORT) || 8080;

const MONGO_URI =
    String(process.env.MONGO_URI || "").trim();

const TRONGRID_API_KEY =
    String(
        process.env.TRONGRID_API_KEY || ""
    ).trim();

const ADMIN_PASSWORD =
    String(
        process.env.ADMIN_PASSWORD || ""
    ).trim();

const SATURDAY_JACKPOT_PERCENT =
    Number(
        process.env.SATURDAY_JACKPOT_PERCENT
    ) || 5;

/*
=========================================================
 JEU
=========================================================
*/

const GAME_DURATION = 600;

const TOP_WINNERS = 5;

const MAX_TAPS_PER_SECOND = 25;

/*
=========================================================
 WALLET MILTAPE
=========================================================
*/

const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWY3q1NffNPM";

/*
=========================================================
 USDT TRC20
=========================================================
*/

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const NETWORK = "TRON";

const TOKEN = "USDT";

const CHAIN = "TRC20";

/*
=========================================================
 MISE
=========================================================
*/

const MINIMUM_BET = 1;

const MAXIMUM_BET = null;

/*
=========================================================
 JACKPOT
=========================================================
*/

const JACKPOT_PERCENT =
    Math.min(
        100,
        Math.max(
            0,
            SATURDAY_JACKPOT_PERCENT
        )
    );

/*
=========================================================
 ETAT DU SERVEUR
=========================================================
*/

let mongoConnected = false;

let gameId = 1;

let timerLeft = GAME_DURATION;

let gameRunning = true;

let changingGame = false;

/*
=========================================================
 JOUEURS EN LIGNE
=========================================================
*/

const activePlayers = new Map();

/*
=========================================================
 ANTI-SPAM TAPS
=========================================================
*/

const tapRate = new Map();

/*
=========================================================
 LOG
=========================================================
*/

console.log("");
console.log("==========================================");
console.log("🔥 MILTAPE WORLD CHALLENGE V2");
console.log("==========================================");

console.log("Port :", PORT);

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

console.log(
    "Admin password :",
    ADMIN_PASSWORD
        ? "CONFIGURÉ"
        : "❌ MANQUANT"
);

console.log(
    "Wallet :",
    MILTAPE_WALLET
);

console.log(
    "USDT contract :",
    USDT_CONTRACT
);

console.log(
    "Minimum bet :",
    MINIMUM_BET
);

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
    "Jackpot samedi :",
    JACKPOT_PERCENT + "%"
);

console.log("==========================================");
console.log("");

/*
=========================================================
 PLAYER SCHEMA
=========================================================
*/

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
                default: undefined,
                trim: true,
                maxlength: 100
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

/*
=========================================================
 INDEX TRANSACTION UNIQUE
=========================================================
*/

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

/*
=========================================================
 INDEX GAME
=========================================================
*/

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

/*
=========================================================
 CHAT SCHEMA
=========================================================
*/

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

/*
=========================================================
 MONGODB
=========================================================
*/

async function connectMongoDB() {

    if (!MONGO_URI) {

        mongoConnected = false;

        console.error(
            "❌ MONGO_URI manquant dans Railway."
        );

        return false;
    }

    try {

        if (
            mongoose.connection.readyState === 1
        ) {

            mongoConnected = true;

            return true;
        }

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 20000,
                maxPoolSize: 20,
                minPoolSize: 2,
                retryWrites: true
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

/*
=========================================================
 RECONNEXION MONGODB
=========================================================
*/

setInterval(
    async () => {

        if (
            !mongoConnected &&
            MONGO_URI
        ) {

            console.log(
                "🔄 Tentative reconnexion MongoDB..."
            );

            await connectMongoDB();
        }

    },
    15000
);

/*
=========================================================
 MONGOOSE EVENTS
=========================================================
*/

mongoose.connection.on(
    "connected",
    () => {

        mongoConnected = true;

        console.log(
            "🟢 MongoDB connecté"
        );
    }
);

mongoose.connection.on(
    "error",
    error => {

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

/*
=========================================================
 UTILITAIRES
=========================================================
*/

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

function normalizeAddress(
    value
) {

    return cleanString(
        value,
        64
    );
}

/*
=========================================================
 TRON ADDRESS
=========================================================
*/

function isValidTronAddress(
    address
) {

    const value =
        normalizeAddress(
            address
        );

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(value);
}

/*
=========================================================
 TXID
=========================================================
*/

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

/*
=========================================================
 USDT
=========================================================
*/

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

/*
=========================================================
 VALIDATION MISE
=========================================================
*/

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

/*
=========================================================
 TRONGRID HEADERS
=========================================================
*/

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

/*
=========================================================
 FETCH JSON
=========================================================
*/

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

/*
=========================================================
 SATURDAY
=========================================================
*/

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

/*
=========================================================
 JACKPOT SAMEDI
=========================================================
*/

async function getSaturdayJackpot() {

    const periodStart =
        getSaturdayStart();

    const nextSaturday =
        getNextSaturday();

    if (!mongoConnected) {

        return {
            totalStakes: 0,
            jackpot: 0,
            percent:
                JACKPOT_PERCENT,
            periodStart:
                periodStart.toISOString(),
            nextSaturday:
                nextSaturday.toISOString()
        };
    }

    try {

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
                        .totalStakes || 0
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
                    totalStakes.toFixed(6)
                ),

            jackpot:
                Number(
                    jackpot.toFixed(6)
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
                JACKPOT_PERCENT,

            periodStart:
                periodStart.toISOString(),

            nextSaturday:
                nextSaturday.toISOString()
        };
    }
}

/*
=========================================================
 TOTAL STAKES
=========================================================
*/

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

    } catch (error) {

        console.error(
            "Total stakes error:",
            error.message
        );

        return 0;
    }
}

/*
=========================================================
 LEADERBOARD
=========================================================
*/

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
                                Number(gameId),

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

                            score: -1,

                            playerName: 1
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

/*
=========================================================
 BROADCASTS
=========================================================
*/

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

    io.emit(
        "leaderboardUpdate",
        leaderboard
    );
}

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

async function broadcastSaturdayJackpot() {

    const jackpot =
        await getSaturdayJackpot();

    io.emit(
        "saturdayJackpot",
        jackpot
    );
}

/*
=========================================================
 ROOT
=========================================================
*/

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

                version:
                    "2.0",

                status:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                gameDuration:
                    GAME_DURATION,

                timerLeft,

                gameRunning,

                online:
                    activePlayers.size,

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

/*
=========================================================
 HEALTH
=========================================================
*/

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

                    timerLeft,

                    gameRunning,

                    online:
                        activePlayers.size
                }
            );
    }
);

/*
=========================================================
 STATUS
=========================================================
*/

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

                online:
                    activePlayers.size,

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

/*
=========================================================
 GAME CONFIG
=========================================================
*/

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
                        TOP_WINNERS,

                    running:
                        gameRunning,

                    timerLeft
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

/*
=========================================================
 JACKPOT
=========================================================
*/

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

/*
=========================================================
 TOTAL STAKES
=========================================================
*/

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
                        total.toFixed(6)
                    )
            }
        );
    }
);

/*
=========================================================
 ONLINE
=========================================================
*/

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

/*
=========================================================
 LEADERBOARD
=========================================================
*/

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

/*
=========================================================
 PLAYER STATS
=========================================================
*/

app.get(
    "/api/player-stats/:playerId",
    async (req, res) => {

        try {

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

            let totalTaps = 0;
            let totalUsdt = 0;

            for (
                const player
                of records
            ) {

                totalTaps +=
                    Number(
                        player.score || 0
                    );

                if (
                    player.paymentStatus ===
                    "paid"
                ) {

                    totalUsdt +=
                        Number(
                            player.amount || 0
                        );
                }
            }

            res.json(
                {

                    success: true,

                    totalTaps,

                    totalUsdt:
                        Number(
                            totalUsdt.toFixed(6)
                        ),

                    history:
                        records.map(
                            player => ({

                                date:
                                    player.createdAt,

                                score:
                                    player.score || 0,

                                amount:
                                    player.amount || 0,

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

            res.status(500)
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

/*
=========================================================
 ADMIN LOGIN
=========================================================
*/

app.post(
    "/api/admin/login",
    (req, res) => {

        const password =
            cleanString(
                req.body.password,
                200
            );

        if (!ADMIN_PASSWORD) {

            return res.status(503)
                .json(
                    {

                        success: false,

                        message:
                            "ADMIN_PASSWORD non configuré sur le serveur."
                    }
                );
        }

        if (
            password !==
            ADMIN_PASSWORD
        ) {

            return res.status(401)
                .json(
                    {

                        success: false,

                        message:
                            "Mot de passe incorrect."
                    }
                );
        }

        res.json(
            {

                success: true,

                message:
                    "Connexion réussie."
            }
        );
    }
);

/*
=========================================================
 VERIFY PAYMENT
=========================================================
*/

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

            /*
            ---------------------------------------------
            DONNÉES CLIENT
            ---------------------------------------------
            */

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

            const cryptoAddress =
                normalizeAddress(
                    req.body.cryptoAddress ||
                    ""
                );

            /*
            ---------------------------------------------
            VALIDATIONS
            ---------------------------------------------
            */

            if (!playerId) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Player ID requis."
                        }
                    );
            }

            if (!isValidTxid(txid)) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "TXID TRON invalide."
                        }
                    );
            }

            if (!isValidBet(amount)) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Montant de mise invalide."
                        }
                    );
            }

            if (
                cryptoAddress &&
                !isValidTronAddress(
                    cryptoAddress
                )
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Adresse TRON invalide."
                        }
                    );
            }

            /*
            ---------------------------------------------
            TRANSACTION DÉJÀ UTILISÉE
            ---------------------------------------------
            */

            const existingTx =
                await Player.findOne(
                    {
                        transactionHash:
                            txid
                    }
                )
                    .lean();

            if (existingTx) {

                return res.status(409)
                    .json(
                        {

                            success: false,

                            message:
                                "Cette transaction a déjà été utilisée."
                        }
                    );
            }

            /*
            ---------------------------------------------
            JOUEUR DÉJÀ DANS LA PARTIE
            ---------------------------------------------
            */

            const existingPlayer =
                await Player.findOne(
                    {

                        playerId,

                        gameId,

                        paymentStatus:
                            "paid"
                    }
                )
                    .lean();

            if (existingPlayer) {

                return res.status(409)
                    .json(
                        {

                            success: false,

                            message:
                                "Ce joueur participe déjà à cette partie."
                        }
                    );
            }

            /*
            ---------------------------------------------
            RÉCUPÉRATION TRANSACTION TRON
            ---------------------------------------------
            */

            const txUrl =
                `https://api.trongrid.io/v1/transactions/${txid}`;

            const {
                response:
                    txResponse,

                data:
                    txData
            } =
                await fetchJson(
                    txUrl
                );

            if (
                !txResponse ||
                !txResponse.ok ||
                !txData
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Transaction TRON introuvable."
                        }
                    );
            }

            /*
            ---------------------------------------------
            TRANSACTION SUCCESS
            ---------------------------------------------
            */

            const contractRet =
                txData?.ret?.[0]?.contractRet;

            if (
                contractRet &&
                contractRet !== "SUCCESS"
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "La transaction TRON n'est pas valide.",

                            status:
                                contractRet
                        }
                    );
            }

            /*
            ---------------------------------------------
            RÉCUPÉRATION DES ÉVÉNEMENTS TRC20
            ---------------------------------------------
            */

            const eventsUrl =
                `https://api.trongrid.io/v1/transactions/${txid}/events?limit=200`;

            const {
                response:
                    eventsResponse,

                data:
                    eventsData
            } =
                await fetchJson(
                    eventsUrl
                );

            if (
                !eventsResponse ||
                !eventsResponse.ok
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Impossible de vérifier les événements TRON."
                        }
                    );
            }

            if (
                !eventsData ||
                !Array.isArray(
                    eventsData.data
                )
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Aucun événement TRC20 trouvé."
                        }
                    );
            }

            /*
            ---------------------------------------------
            TROUVER LE BON TRANSFER USDT
            ---------------------------------------------
            */

            const transferEvent =
                eventsData.data.find(
                    event => {

                        const contractAddress =
                            String(
                                event.contract_address ||
                                event.address ||
                                ""
                            ).trim();

                        return (
                            String(
                                event.event_name ||
                                ""
                            ) === "Transfer"
                            &&
                            contractAddress
                                .toLowerCase() ===
                            USDT_CONTRACT
                                .toLowerCase()
                        );
                    }
                );

            if (!transferEvent) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Transfert USDT TRC20 valide introuvable."
                        }
                    );
            }

            /*
            ---------------------------------------------
            RÉSULTAT TRANSFERT
            ---------------------------------------------
            */

            const result =
                transferEvent.result ||
                {};

            const toAddress =
                normalizeAddress(
                    result.to ||
                    result._to ||
                    result["1"] ||
                    ""
                );

            const fromAddress =
                normalizeAddress(
                    result.from ||
                    result._from ||
                    result["0"] ||
                    ""
                );

            const rawValue =
                result.value ??
                result._value ??
                result["2"] ??
                0;

            /*
            ---------------------------------------------
            DESTINATION
            ---------------------------------------------
            */

            if (!toAddress) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Adresse destinataire introuvable."
                        }
                    );
            }

            if (
                toAddress.toLowerCase() !==
                MILTAPE_WALLET.toLowerCase()
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
            ---------------------------------------------
            EXPÉDITEUR
            ---------------------------------------------
            */

            if (
                !fromAddress ||
                !isValidTronAddress(
                    fromAddress
                )
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Adresse expéditeur invalide."
                        }
                    );
            }

            /*
            ---------------------------------------------
            SI LE CLIENT FOURNIT UNE ADRESSE,
            ELLE DOIT CORRESPONDRE À L'EXPÉDITEUR
            ---------------------------------------------
            */

            if (
                cryptoAddress &&
                cryptoAddress.toLowerCase() !==
                fromAddress.toLowerCase()
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "L'adresse de paiement ne correspond pas à l'expéditeur de la transaction."
                        }
                    );
            }

            /*
            ---------------------------------------------
            MONTANT
            ---------------------------------------------
            */

            const rawValueNumber =
                Number(
                    rawValue
                );

            if (
                !Number.isFinite(
                    rawValueNumber
                ) ||
                rawValueNumber <= 0
            ) {

                return res.status(400)
                    .json(
                        {

                            success: false,

                            message:
                                "Montant USDT invalide."
                        }
                    );
            }

            const valueUsdt =
                unitsToUsdt(
                    rawValueNumber
                );

            /*
            ---------------------------------------------
            LE PAIEMENT DOIT ÊTRE AU MOINS ÉGAL
            À LA MISE DEMANDÉE
            ---------------------------------------------
            */

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
            ---------------------------------------------
            NOUVEAU JOUEUR
            ---------------------------------------------
            */

            const newPlayer =
                new Player(
                    {

                        playerId,

                        playerName,

                        amount,

                        score: 0,

                        cryptoAddress:
                            fromAddress,

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
            ---------------------------------------------
            BROADCAST
            ---------------------------------------------
            */

            await broadcastSaturdayJackpot();

            await broadcastLeaderboard();

            await broadcastTotalStakes();

            /*
            ---------------------------------------------
            RÉPONSE
            ---------------------------------------------
            */

            return res.json(
                {

                    success: true,

                    message:
                        "Paiement validé avec succès !",

                    gameId,

                    paidAmount:
                        valueUsdt,

                    player: {

                        playerId,

                        playerName,

                        amount,

                        score: 0,

                        gameId
                    }
                }
            );

        } catch (error) {

            console.error(
                "❌ VERIFY PAYMENT ERROR:",
                error.message
            );

            if (
                error?.code === 11000
            ) {

                return res.status(409)
                    .json(
                        {

                            success: false,

                            message:
                                "Cette transaction existe déjà."
                        }
                    );
            }

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

/*
=========================================================
 CHAT HTTP
=========================================================
*/

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

            res.json(
                {

                    success: true,

                    messages
                }
            );

        } catch (error) {

            console.error(
                "Chat GET:",
                error.message
            );

            res.status(500)
                .json(
                    {

                        success: false,

                        messages: []
                    }
                );
        }
    }
);

/*
=========================================================
 TIMER / NOUVELLES PARTIES
=========================================================
*/

setInterval(
    async () => {

        try {

            if (!gameRunning) {
                return;
            }

            if (timerLeft <= 0) {
                return;
            }

            timerLeft--;

            /*
            ---------------------------------------------
            TIMER
            ---------------------------------------------
            */

            io.emit(
                "timer",
                timerLeft
            );

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
            ---------------------------------------------
            FIN DE PARTIE
            ---------------------------------------------
            */

            if (
                timerLeft === 0 &&
                !changingGame
            ) {

                changingGame = true;

                gameRunning = false;

                const winners =
                    await getLeaderboard();

                io.emit(
                    "gameOver",
                    {

                        gameId,

                        winners
                    }
                );

                console.log(
                    "🏁 Partie terminée :",
                    gameId
                );

                /*
                -----------------------------------------
                NOUVELLE PARTIE APRÈS 3 SECONDES
                -----------------------------------------
                */

                setTimeout(
                    async () => {

                        try {

                            gameId++;

                            timerLeft =
                                GAME_DURATION;

                            gameRunning =
                                true;

                            changingGame =
                                false;

                            tapRate.clear();

                            console.log(
                                "🎮 Nouvelle partie :",
                                gameId
                            );

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
                                        GAME_DURATION,

                                    timerLeft:
                                        GAME_DURATION
                                }
                            );

                            io.emit(
                                "timer",
                                GAME_DURATION
                            );

                            io.emit(
                                "timer:update",
                                {

                                    timeLeft:
                                        GAME_DURATION,

                                    gameId
                                }
                            );

                            io.emit(
                                "timerUpdate",
                                {

                                    timerLeft:
                                        GAME_DURATION,

                                    gameId
                                }
                            );

                            await broadcastLeaderboard();

                        } catch (error) {

                            changingGame =
                                false;

                            console.error(
                                "New game error:",
                                error.message
                            );
                        }

                    },
                    3000
                );
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

/*
=========================================================
 SOCKET.IO
=========================================================
*/

io.on(
    "connection",
    async socket => {

        console.log(
            "🔌 Client connecté :",
            socket.id
        );

        /*
        =====================================================
        JOIN
        =====================================================
        */

        async function handleJoin(data) {

            try {

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

                    socket.emit(
                        "joinError",
                        {

                            success: false,

                            message:
                                "Player ID requis."
                        }
                    );

                    return;
                }

                /*
                ---------------------------------------------
                RECHERCHE PARTICIPATION PAYÉE
                ---------------------------------------------
                */

                let paidPlayer = null;

                if (mongoConnected) {

                    paidPlayer =
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
                            })
                            .lean();
                }

                /*
                ---------------------------------------------
                ÉVITER DE GARDER DEUX SOCKETS
                ---------------------------------------------
                */

                const oldSocketId =
                    activePlayers.get(
                        playerId
                    );

                if (
                    oldSocketId &&
                    oldSocketId !==
                        socket.id
                ) {

                    const oldSocket =
                        io.sockets.sockets.get(
                            oldSocketId
                        );

                    if (oldSocket) {

                        oldSocket.disconnect(
                            true
                        );
                    }
                }

                activePlayers.set(
                    playerId,
                    socket.id
                );

                socket.data.playerId =
                    playerId;

                socket.data.playerName =
                    playerName;

                socket.data.hasPaid =
                    Boolean(
                        paidPlayer
                    );

                /*
                ---------------------------------------------
                GAME
                ---------------------------------------------
                */

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

                        leaderboard,

                        joined:
                            Boolean(
                                paidPlayer
                            )
                    }
                );

                /*
                TIMER
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
                    "timerUpdate",
                    {

                        timerLeft,

                        gameId
                    }
                );

                /*
                LEADERBOARD
                */

                socket.emit(
                    "leaderboard",
                    leaderboard
                );

                socket.emit(
                    "leaderboard:update",
                    leaderboard
                );

                /*
                JACKPOT
                */

                const jackpot =
                    await getSaturdayJackpot();

                socket.emit(
                    "saturdayJackpot",
                    jackpot
                );

                /*
                TOTAL
                */

                const total =
                    await getTotalStakes();

                socket.emit(
                    "totalStakes",
                    total
                );

                /*
                CHAT
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

                    } catch (error) {

                        console.error(
                            "Chat history:",
                            error.message
                        );
                    }
                }

                /*
                ONLINE
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

            } catch (error) {

                console.error(
                    "Join error:",
                    error.message
                );
            }
        }

        socket.on(
            "join",
            handleJoin
        );

        socket.on(
            "joinGame",
            handleJoin
        );

        /*
        =====================================================
        GET GAME
        =====================================================
        */

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
                "timerUpdate",
                {

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
        }

        socket.on(
            "getGame",
            sendGameData
        );

        socket.on(
            "game:get",
            sendGameData
        );

        /*
        =====================================================
        GET LEADERBOARD
        =====================================================
        */

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

        /*
        =====================================================
        TAP
        =====================================================
        */

        socket.on(
            "tap",
            async data => {

                try {

                    /*
                    -----------------------------------------
                    SESSION SERVEUR
                    -----------------------------------------
                    */

                    const sessionPlayerId =
                        cleanString(
                            socket.data.playerId,
                            100
                        );

                    if (!sessionPlayerId) {

                        socket.emit(
                            "tapResult",
                            {

                                success: false,

                                message:
                                    "Tu dois rejoindre la partie."
                            }
                        );

                        return;
                    }

                    /*
                    IMPORTANT :
                    On utilise l'identité enregistrée
                    dans la socket et PAS une identité
                    librement envoyée par le navigateur.
                    */

                    const playerId =
                        sessionPlayerId;

                    /*
                    -----------------------------------------
                    PARTIE
                    -----------------------------------------
                    */

                    if (
                        !gameRunning ||
                        timerLeft <= 0
                    ) {

                        socket.emit(
                            "tapResult",
                            {

                                success: false,

                                message:
                                    "La partie est terminée."
                            }
                        );

                        return;
                    }

                    /*
                    -----------------------------------------
                    MONGO
                    -----------------------------------------
                    */

                    if (!mongoConnected) {

                        socket.emit(
                            "tapResult",
                            {

                                success: false,

                                message:
                                    "Serveur temporairement indisponible."
                            }
                        );

                        return;
                    }

                    /*
                    -----------------------------------------
                    RATE LIMIT
                    -----------------------------------------
                    */

                    const now =
                        Date.now();

                    let info =
                        tapRate.get(
                            playerId
                        );

                    if (
                        !info ||
                        now -
                            info.startedAt >=
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

                                success: false,

                                message:
                                    "Trop de taps.",

                                blocked: true
                            }
                        );

                        return;
                    }

                    /*
                    -----------------------------------------
                    PARTICIPATION PAYÉE
                    -----------------------------------------
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

                    if (!playerDoc) {

                        socket.emit(
                            "tapResult",
                            {

                                success: false,

                                message:
                                    "Tu dois rejoindre la partie avec une mise validée."
                            }
                        );

                        return;
                    }

                    /*
                    -----------------------------------------
                    SCORE ATOMIQUE
                    -----------------------------------------
                    */

                    const updatedPlayer =
                        await Player.findOneAndUpdate(
                            {

                                _id:
                                    playerDoc._id,

                                playerId,

                                gameId,

                                paymentStatus:
                                    "paid"
                            },

                            {
                                $inc: {
                                    score: 1
                                }
                            },

                            {
                                new: true
                            }
                        ).lean();

                    if (!updatedPlayer) {
                        return;
                    }

                    /*
                    -----------------------------------------
                    TAP RESULT
                    -----------------------------------------
                    */

                    socket.emit(
                        "tapResult",
                        {

                            success: true,

                            playerId,

                            score:
                                updatedPlayer.score,

                            taps:
                                updatedPlayer.score
                        }
                    );

                    socket.emit(
                        "tap:result",
                        {

                            success: true,

                            playerId,

                            score:
                                updatedPlayer.score
                        }
                    );

                    /*
                    -----------------------------------------
                    SCORE UPDATE
                    -----------------------------------------
                    */

                    io.emit(
                        "score:update",
                        {

                            playerId,

                            playerName:
                                updatedPlayer.playerName,

                            score:
                                updatedPlayer.score
                        }
                    );

                    /*
                    -----------------------------------------
                    LEADERBOARD
                    -----------------------------------------
                    */

                    await broadcastLeaderboard();

                } catch (error) {

                    console.error(
                        "❌ TAP ERROR:",
                        error.message
                    );

                    socket.emit(
                        "tapResult",
                        {

                            success: false,

                            message:
                                "Erreur pendant le tap."
                        }
                    );
                }
            }
        );

        /*
        =====================================================
        CHAT
        =====================================================
        */

        async function handleChat(data) {

            try {

                const playerId =
                    cleanString(
                        socket.data.playerId ||
                        data?.playerId ||
                        "",
                        100
                    );

                const playerName =
                    cleanString(
                        socket.data.playerName ||
                        data?.playerName ||
                        "Anonyme",
                        30
                    );

                const message =
                    cleanString(
                        data?.message ||
                        data?.text ||
                        data?.content ||
                        "",
                        300
                    );

                if (!message) {
                    return;
                }

                /*
                ---------------------------------------------
                ANTI-SPAM
                ---------------------------------------------
                */

                const now =
                    Date.now();

                if (
                    socket.data.lastChat &&
                    now -
                        socket.data.lastChat <
                        1000
                ) {

                    return;
                }

                socket.data.lastChat =
                    now;

                /*
                ---------------------------------------------
                SAVE MONGODB
                ---------------------------------------------
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

                    } catch (error) {

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
                ---------------------------------------------
                BROADCAST
                ---------------------------------------------
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

        /*
        =====================================================
        DISCONNECT
        =====================================================
        */

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

/*
=========================================================
 404
=========================================================
*/

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

/*
=========================================================
 SERVER
=========================================================
*/

server.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "🚀 MILTAPE BACKEND V2 DÉMARRÉ"
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

        console.log(
            `💰 Wallet : ${MILTAPE_WALLET}`
        );

        console.log("");

    }
);

/*
=========================================================
 ERREURS PROCESS
=========================================================
*/

process.on(
    "unhandledRejection",
    reason => {

        console.error(
            "❌ Unhandled Rejection:",
            reason
        );
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);
