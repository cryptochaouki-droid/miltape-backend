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

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    transports: ["websocket", "polling"]
});

/* =========================================================
   CONFIGURATION
========================================================= */

const PORT =
    Number(process.env.PORT) || 8080;

/*
 * Compatible avec MONGO_URI ET MONGODB_URI
 */
const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "";

const TRONGRID_API_KEY =
    process.env.TRONGRID_API_KEY || "";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "admin123";

/* =========================================================
   JEU
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
   MISE
========================================================= */

const MINIMUM_BET = 1;
const MAXIMUM_BET = null;

/* =========================================================
   JACKPOT
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

let timerLeft =
    GAME_DURATION;

/*
 * Joueurs connectés
 */
const activePlayers =
    new Map();

/*
 * Toutes les connexions Socket.IO
 */
const activeSockets =
    new Set();

/*
 * Anti-autoclick
 */
const tapRate =
    new Map();

/*
 * Chat mémoire de secours.
 * Même si MongoDB tombe,
 * le chat continue de fonctionner.
 */
const chatMessagesMemory = [];

/* =========================================================
   LOGS
========================================================= */

console.log(
    "======================================"
);

console.log(
    "🔥 MILTAPE WORLD CHALLENGE BACKEND"
);

console.log(
    "======================================"
);

console.log(
    "Port :",
    PORT
);

console.log(
    "Durée :",
    GAME_DURATION,
    "secondes"
);

console.log(
    "Gagnants : TOP",
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
    "Mise minimale :",
    MINIMUM_BET,
    "USDT"
);

console.log(
    "MongoDB :",
    MONGO_URI
        ? "CONFIGURÉ"
        : "❌ MANQUANT"
);

console.log(
    "======================================"
);

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
                index: true
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
                default: Date.now,
                index: true
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
   CONNEXION MONGODB
========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI / MONGODB_URI manquant."
        );

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
            "❌ MongoDB :",
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

function isValidBet(
    amount
) {

    const numeric =
        Number(amount);

    if (
        !Number.isFinite(
            numeric
        ) ||
        numeric < MINIMUM_BET
    ) {

        return false;
    }

    if (
        MAXIMUM_BET !== null &&
        numeric > MAXIMUM_BET
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

                        ...(options.headers ||
                            {})
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

    } catch {

        return {
            response: null,
            data: null
        };
    }
}

/* =========================================================
   JACKPOT
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

    const start =
        getSaturdayStart();

    const next =
        new Date(start);

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
            "❌ Jackpot :",
            error.message
        );

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
}

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
            "❌ Jackpot broadcast:",
            error.message
        );
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
            "❌ Leaderboard :",
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

    /*
     * Plusieurs noms d'événements
     * pour être compatible avec
     * ton frontend actuel.
     */

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

/* =========================================================
   TIMER
========================================================= */

function broadcastTimer() {

    /*
     * Ton frontend écoute :
     * timer
     * gameTimer
     * timer:update
     *
     * On envoie les trois.
     */

    io.emit(
        "timer",
        timerLeft
    );

    io.emit(
        "gameTimer",
        {
            timeLeft:
                timerLeft,

            gameId
        }
    );

    io.emit(
        "timer:update",
        {
            timeLeft:
                timerLeft,

            gameId
        }
    );
}

/* =========================================================
   ONLINE COUNT
========================================================= */

function broadcastOnlineCount() {

    const count =
        activeSockets.size;

    io.emit(
        "onlineCount",
        count
    );

    io.emit(
        "online:count",
        {
            count
        }
    );

    io.emit(
        "online",
        {
            count
        }
    );
}

/* =========================================================
   CHAT
========================================================= */

async function getChatHistory() {

    /*
     * Si MongoDB fonctionne,
     * on récupère les derniers messages.
     */

    if (mongoConnected) {

        try {

            const messages =
                await Chat.find({})
                    .sort({
                        createdAt: -1
                    })
                    .limit(100)
                    .lean();

            return messages
                .reverse()
                .map(
                    (msg) => ({
                        playerId:
                            msg.playerId,

                        playerName:
                            msg.playerName,

                        message:
                            msg.message,

                        createdAt:
                            msg.createdAt
                    })
                );

        } catch (error) {

            console.error(
                "❌ Historique chat :",
                error.message
            );
        }
    }

    return [
        ...chatMessagesMemory
    ];
}

async function saveChatMessage(
    message
) {

    /*
     * Sauvegarde mémoire
     */
    chatMessagesMemory.push(
        message
    );

    while (
        chatMessagesMemory.length >
        100
    ) {

        chatMessagesMemory.shift();
    }

    /*
     * Sauvegarde MongoDB
     */
    if (mongoConnected) {

        try {

            await Chat.create({
                playerId:
                    message.playerId,

                playerName:
                    message.playerName,

                message:
                    message.message,

                createdAt:
                    message.createdAt
            });

        } catch (error) {

            console.error(
                "❌ Sauvegarde chat :",
                error.message
            );
        }
    }
}

/* =========================================================
   API ROOT
========================================================= */

app.get(
    "/",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            res.json({
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

                online:
                    activeSockets.size,

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
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error:
                    "ROOT_ERROR"
            });
        }
    }
);

/* =========================================================
   STATUS
========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            res.json({
                success: true,

                server:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                timerLeft,

                gameDuration:
                    GAME_DURATION,

                online:
                    activeSockets.size,

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
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error:
                    "STATUS_ERROR"
            });
        }
    }
);

/* =========================================================
   GAME CONFIG
========================================================= */

app.get(
    "/api/game-config",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            res.json({
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
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error:
                    "GAME_CONFIG_ERROR"
            });
        }
    }
);

/* =========================================================
   JACKPOT API
========================================================= */

app.get(
    "/api/saturday-jackpot",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            return res.json({
                success: true,
                ...jackpot
            });

        } catch (error) {

            return res.status(500).json({
                success: false,
                jackpot: 0,

                error:
                    "SATURDAY_JACKPOT_ERROR"
            });
        }
    }
);

/* =========================================================
   TOTAL STAKES
========================================================= */

app.get(
    "/api/total-stakes",
    async (req, res) => {

        try {

            if (!mongoConnected) {

                return res.json({
                    success: true,
                    totalStakes: 0
                });
            }

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

            const total =
                result.length
                    ? Number(
                        result[0].total ||
                        0
                    )
                    : 0;

            return res.json({
                success: true,

                totalStakes:
                    Number(
                        total.toFixed(6)
                    )
            });

        } catch (error) {

            return res.status(500).json({
                success: false,

                totalStakes: 0,

                error:
                    "TOTAL_STAKES_ERROR"
            });
        }
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

                return res.json({
                    success: true,
                    totalTaps: 0,
                    totalUsdt: 0,
                    history: []
                });
            }

            const playerId =
                cleanString(
                    req.params.playerId,
                    100
                );

            if (!playerId) {

                return res.status(400).json({
                    success: false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            const records =
                await Player.find({
                    playerId
                })
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

            return res.json({
                success: true,

                totalTaps,

                totalUsdt:
                    Number(
                        totalUsdt.toFixed(6)
                    ),

                history:
                    records.map(
                        (p) => ({
                            date:
                                p.createdAt,

                            score:
                                p.score ||
                                0,

                            amount:
                                p.amount ||
                                0,

                            paymentStatus:
                                p.paymentStatus,

                            gameId:
                                p.gameId,

                            transactionHash:
                                p.transactionHash ||
                                ""
                        })
                    )
            });

        } catch (error) {

            return res.status(500).json({
                success: false,

                error:
                    "PLAYER_STATS_ERROR"
            });
        }
    }
);

/* =========================================================
   LEADERBOARD API
========================================================= */

app.get(
    "/api/leaderboard",
    async (req, res) => {

        try {

            const leaderboard =
                await getLeaderboard();

            res.json({
                success: true,

                gameId,

                leaderboard
            });

        } catch (error) {

            res.status(500).json({
                success: false,

                leaderboard: []
            });
        }
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

            return res.status(400).json({
                success: false,

                message:
                    "Mot de passe requis."
            });
        }

        if (
            password ===
            ADMIN_PASSWORD
        ) {

            return res.json({
                success: true,

                message:
                    "Connexion réussie."
            });
        }

        return res.status(401).json({
            success: false,

            message:
                "Mot de passe incorrect !"
        });
    }
);

/* =========================================================
   VERIFICATION PAIEMENT
========================================================= */

app.post(
    "/api/verify-payment",
    async (req, res) => {

        try {

            if (!mongoConnected) {

                return res.status(503).json({
                    success: false,

                    message:
                        "Base de données indisponible."
                });
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

            if (
                !playerId ||
                !isValidTxid(txid) ||
                !isValidBet(amount)
            ) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Paramètres invalides."
                });
            }

            const existingTx =
                await Player.findOne({
                    transactionHash:
                        txid
                });

            if (existingTx) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Transaction déjà utilisée."
                });
            }

            const url =
                `https://api.trongrid.io/v1/transactions/${txid}/events`;

            const {
                data
            } =
                await fetchJson(url);

            if (
                !data ||
                !data.data ||
                data.data.length === 0
            ) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Transaction introuvable sur le réseau TRON."
                });
            }

            const transferEvent =
                data.data.find(
                    (event) =>
                        event.event_name ===
                        "Transfer"
                );

            if (!transferEvent) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Événement de transfert USDT introuvable."
                });
            }

            const result =
                transferEvent.result;

            const toAddress =
                result.to ||
                result[1];

            const rawValue =
                result.value ||
                result[2];

            const valueUsdt =
                unitsToUsdt(
                    rawValue
                );

            /*
             * Vérification wallet destination
             */
            if (
                toAddress &&
                toAddress !==
                    MILTAPE_WALLET
            ) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Le paiement n'a pas été envoyé à l'adresse Miltape."
                });
            }

            if (
                valueUsdt < amount
            ) {

                return res.status(400).json({
                    success: false,

                    message:
                        "Montant payé insuffisant."
                });
            }

            const newPlayer =
                new Player({
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
                });

            await newPlayer.save();

            await broadcastSaturdayJackpot();

            await broadcastLeaderboard();

            return res.json({
                success: true,

                message:
                    "Paiement validé avec succès !",

                player:
                    newPlayer
            });

        } catch (error) {

            console.error(
                "❌ Validation paiement :",
                error.message
            );

            return res.status(500).json({
                success: false,

                message:
                    "Erreur serveur lors de la vérification."
            });
        }
    }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    (socket) => {

        console.log(
            "🟢 Socket connecté :",
            socket.id
        );

        /*
         * Ajoute immédiatement
         * la connexion.
         */
        activeSockets.add(
            socket.id
        );

        /*
         * Informe tous les joueurs.
         */
        broadcastOnlineCount();


        /* =====================================================
           JOIN
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

            if (playerId) {

                activePlayers.set(
                    playerId,
                    socket.id
                );
            }

            /*
             * Envoi état immédiat
             */
            socket.emit(
                "initGame",
                {
                    gameId,

                    timerLeft,

                    duration:
                        GAME_DURATION,

                    leaderboard:
                        await getLeaderboard()
                }
            );

            /*
             * Chrono immédiat.
             */
            socket.emit(
                "timer",
                timerLeft
            );

            socket.emit(
                "gameTimer",
                {
                    timeLeft:
                        timerLeft,

                    gameId
                }
            );

            /*
             * Classement immédiat.
             */
            const leaderboard =
                await getLeaderboard();

            socket.emit(
                "leaderboard",
                leaderboard
            );

            /*
             * Historique chat.
             */
            const history =
                await getChatHistory();

            socket.emit(
                "chatHistory",
                history
            );

            /*
             * Jackpot.
             */
            try {

                const jackpot =
                    await getSaturdayJackpot();

                socket.emit(
                    "saturdayJackpot",
                    jackpot
                );

            } catch {}

            /*
             * Nombre de joueurs.
             */
            socket.emit(
                "onlineCount",
                activeSockets.size
            );

            console.log(
                "👤 Joueur connecté :",
                playerName,
                playerId
            );
        }


        /*
         * IMPORTANT :
         * Ton frontend utilise "join"
         */
        socket.on(
            "join",
            handleJoin
        );

        /*
         * Ancien nom conservé
         */
        socket.on(
            "joinGame",
            handleJoin
        );


        /* =====================================================
           DEMANDE GAME
        ===================================================== */

        socket.on(
            "getGame",
            async () => {

                socket.emit(
                    "initGame",
                    {
                        gameId,

                        timerLeft,

                        duration:
                            GAME_DURATION,

                        leaderboard:
                            await getLeaderboard()
                    }
                );

                socket.emit(
                    "timer",
                    timerLeft
                );
            }
        );

        socket.on(
            "game:get",
            async () => {

                socket.emit(
                    "initGame",
                    {
                        gameId,

                        timerLeft,

                        duration:
                            GAME_DURATION,

                        leaderboard:
                            await getLeaderboard()
                    }
                );

                socket.emit(
                    "timer",
                    timerLeft
                );
            }
        );


        /* =====================================================
          
