const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

/* =========================================================
   MILTAPE WORLD CHALLENGE - BACKEND
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
    }
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
   CAGNOTTE SAMEDI
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
   ETAT SERVEUR
   ========================================================= */

let mongoConnected = false;

let gameId = 1;

let timerLeft = GAME_DURATION;

/*
 * playerId -> socketId
 */
const activePlayers = new Map();

/*
 * playerId -> {
 *     startedAt,
 *     count
 * }
 */
const tapRate = new Map();

/* =========================================================
   LOGS
   ========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE WORLD CHALLENGE BACKEND");
console.log("======================================");

console.log("Port :", PORT);

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
    "Cagnotte samedi :",
    JACKPOT_PERCENT,
    "%"
);

console.log(
    "TronGrid API Key :",
    TRONGRID_API_KEY
        ? "CONFIGURÉE"
        : "NON CONFIGURÉE"
);

console.log(
    "MongoDB :",
    MONGO_URI
        ? "CONFIGURÉ"
        : "❌ MANQUANT"
);

console.log("======================================");

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
   INDEX TRANSACTION
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

/* =========================================================
   INDEX LEADERBOARD
   ========================================================= */

playerSchema.index(
    {
        gameId: 1,
        paymentStatus: 1,
        playerId: 1,
        score: -1
    },
    {
        name: "game_payment_player_score"
    }
);

const Player =
    mongoose.model(
        "Player",
        playerSchema
    );

/* =========================================================
   CONNEXION MONGODB
   ========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI manquant."
        );

        console.error(
            "Railway > Variables > MONGO_URI"
        );

        return false;
    }

    try {

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS: 10000
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
   UTILITAIRE STRING
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
   VALIDATION ADRESSE TRON
   ========================================================= */

function isValidTronAddress(
    address
) {

    const value =
        cleanString(
            address,
            64
        );

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
        value
    );
}

/* =========================================================
   VALIDATION TXID
   ========================================================= */

function isValidTxid(
    txid
) {

    const value =
        cleanString(
            txid,
            100
        );

    return /^[a-fA-F0-9]{64}$/.test(
        value
    );
}

/* =========================================================
   USDT -> UNITÉS
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

/* =========================================================
   UNITÉS -> USDT
   ========================================================= */

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

    if (
        !Number.isSafeInteger(
            units
        )
    ) {
        return false;
    }

    return true;
}

/* =========================================================
   HEADERS TRONGRID
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

    let data = null;

    try {

        data =
            await response.json();

    } catch {

        data = null;
    }

    return {
        response,
        data
    };
}

/* =========================================================
   DÉBUT PÉRIODE SAMEDI
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

/* =========================================================
   PROCHAIN SAMEDI
   ========================================================= */

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

/* =========================================================
   CAGNOTTE SAMEDI
   ========================================================= */

async function getSaturdayJackpot() {

    if (!mongoConnected) {

        return {

            totalStakes: 0,

            jackpot: 0,

            percent:
                JACKPOT_PERCENT,

            periodStart:
                getSaturdayStart().toISOString(),

            nextSaturday:
                getNextSaturday().toISOString()
        };
    }

    const periodStart =
        getSaturdayStart();

    const nextSaturday =
        getNextSaturday();

    const result =
        await Player.aggregate([

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

                    _id:
                        null,

                    totalStakes: {

                        $sum:
                            "$amount"
                    }
                }
            }
        ]);

    const totalStakes =
        result.length
            ? Number(
                result[0].totalStakes || 0
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
}

/* =========================================================
   BROADCAST CAGNOTTE
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
            "❌ Jackpot broadcast:",
            error.message
        );
    }
}

/* =========================================================
   PAGE PRINCIPALE
   ========================================================= */

app.get(
    "/",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            res.json({

                success:
                    true,

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

            console.error(
                "❌ Root:",
                error.message
            );

            res.status(500).json({

                success:
                    false,

                error:
                    "ROOT_ERROR"
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

                success:
                    false,

                message:
                    "Mot de passe requis."
            });
        }

        if (
            password ===
            ADMIN_PASSWORD
        ) {

            return res.json({

                success:
                    true,

                message:
                    "Connexion réussie."
            });

        }

        return res.status(401).json({

            success:
                false,

            message:
                "Mot de passe incorrect !"
        });
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

                success:
                    true,

                server:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                timerLeft,

                gameDuration:
                    GAME_DURATION,

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

            console.error(
                "❌ status:",
                error.message
            );

            res.status(500).json({

                success:
                    false,

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

                success:
                    true,

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

            console.error(
                "❌ game-config:",
                error.message
            );

            res.status(500).json({

                success:
                    false,

                error:
                    "GAME_CONFIG_ERROR"
            });
        }
    }
);

/* =========================================================
   API CAGNOTTE SAMEDI
   ========================================================= */

app.get(
    "/api/saturday-jackpot",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            return res.json({

                success:
                    true,

                ...jackpot
            });

        } catch (error) {

            console.error(
                "❌ saturday-jackpot:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                jackpot:
                    0,

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

                    success:
                        true,

                    totalStakes:
                        0
                });
            }

            const result =
                await Player.aggregate([

                    {
                        $match: {

                            paymentStatus:
                                "paid"
                        }
                    },

                    {
                        $group: {

                            _id:
                                null,

                            total: {

                                $sum:
                                    "$amount"
                            }
                        }
                    }
                ]);

            const total =
                result.length
                    ? Number(
                        result[0].total || 0
                    )
                    : 0;

            return res.json({

                success:
                    true,

                totalStakes:
                    Number(
                        total.toFixed(6)
                    )
            });

        } catch (error) {

            console.error(
                "❌ total-stakes:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                totalStakes:
                    0,

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

                    success:
                        true,

                    totalTaps:
                        0,

                    totalUsdt:
                        0,

                    history:
                        []
                });
            }

            const playerId =
                cleanString(
                    req.params.playerId,
                    100
                );

            if (!playerId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            const records =
                await Player
                    .find({
                        playerId
                    })
                    .sort({
                        createdAt:
                            -1
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
                            player.score || 0
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
                                    player.amount || 0
                                )
                                : 0
                        ),
                    0
                );

            return res.json({

                success:
                    true,

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
            });

        } catch (error) {

            console.error(
                "❌ player-stats:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "PLAYER_STATS_ERROR"
            });
        }
    }
);

/* =========================================================
   LEADERBOARD CORRIGÉ
   =========================================================
 *
 * IMPORTANT :
 *
 * Chaque paiement crée un document Player.
 *
 * Si le même playerId possède plusieurs documents
 * dans la même partie, on regroupe les documents
 * avec le même playerId et on additionne les scores.
 *
 * Exemple :
 *
 * playerId = milina
 * score = 10
 *
 * playerId = milina
 * score = 20
 *
 * Résultat :
 *
 * milina = 30
 *
 * TOP 5 uniquement.
 */

async function getLeaderboard() {

    if (!mongoConnected) {
        return [];
    }

    try {

        const players =
            await Player.aggregate([

                /* -----------------------------------------
                   1. FILTRER LA PARTIE ACTUELLE
                   ----------------------------------------- */

                {
                    $match: {

                        gameId:
                            Number(gameId),

                        paymentStatus:
                            "paid"
                    }
                },

                /* -----------------------------------------
                   2. REGROUPER PAR PLAYER ID
                   ----------------------------------------- */

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

                /* -----------------------------------------
                   3. CLASSER DU PLUS GRAND AU PLUS PETIT
                   ----------------------------------------- */

                {
                    $sort: {

                        score:
                            -1,

                        _id:
                            1
                    }
                },

                /* -----------------------------------------
                   4. TOP 5
                   ----------------------------------------- */

                {
                    $limit:
                        TOP_WINNERS
                },

                /* -----------------------------------------
                   5. FORMAT FINAL
                   ----------------------------------------- */

                {
                    $project: {

                        _id:
                            0,

                        playerId:
                            "$_id",

                        playerName: {

                            $ifNull: [

                                "$playerName",

                                "Anonyme"
                            ]
                        },

                        score:
                            1,

                        amount: {

                            $round: [

                                "$amount",

                                6
                            ]
                        }
                    }
                }

            ]);

        return players;

    } catch (error) {

        console.error(
            "❌ ERREUR LEADERBOARD :",
            error
        );

        return [];
    }
}

/* =========================================================
   BROADCAST LEADERBOARD
   ========================================================= */

async function broadcastLeaderboard() {

    try {

        const players =
            await getLeaderboard();

        io.emit(
            "leaderboard",
            players
        );

    } catch (error) {

        console.error(
            "❌ leaderboard:",
            error.message
        );

        io.emit(
            "leaderboard",
            []
        );
    }
}

/* =========================================================
   CREATE ENTRY
   ========================================================= */

app.post(
    "/api/create-entry",
    async (req, res) => {

        try {

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

            const amount =
                Number(
                    req.body.amount
                );

            const cryptoAddress =
                cleanString(
                    req.body.cryptoAddress,
                    64
                );

            const transactionHash =
                cleanString(
                    req.body.transactionHash,
                    100
                );

            if (!playerId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            if (!isValidBet(amount)) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_AMOUNT",

                    message:
                        "La mise minimale est de 1 USDT."
                });
            }

            if (
                cryptoAddress &&
                !isValidTronAddress(
                    cryptoAddress
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_TRON_ADDRESS"
                });
            }

            if (
                transactionHash &&
                !isValidTxid(
                    transactionHash
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_TRANSACTION_HASH"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            if (transactionHash) {

                const existing =
                    await Player.findOne({
                        transactionHash
                    });

                if (existing) {

                    return res.status(409).json({

                        success:
                            false,

                        error:
                            "TRANSACTION_ALREADY_USED"
                    });
                }
            }

            const document = {

                playerId,

                playerName,

                score:
                    0,

                amount:
                    Number(
                        amount.toFixed(6)
                    ),

                cryptoAddress,

                paymentStatus:
                    "pending",

                gameId
            };

            if (transactionHash) {

                document.transactionHash =
                    transactionHash;
            }

            const player =
                await Player.create(
                    document
                );

            return res.json({

                success:
                    true,

                entryId:
                    String(
                        player._id
                    ),

                gameId,

                amount:
                    player.amount,

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

                    status:
                        "pending"
                },

                message:
                    "Entrée créée. Paiement en attente."
            });

        } catch (error) {

            console.error(
                "❌ create-entry:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "CREATE_ENTRY_ERROR"
            });
        }
    }
);

/* =========================================================
   SUBMIT TRANSACTION
   ========================================================= */

app.post(
    "/api/submit-transaction",
    async (req, res) => {

        try {

            const entryId =
                cleanString(
                    req.body.entryId,
                    100
                );

            const transactionHash =
                cleanString(
                    req.body.transactionHash,
                    100
                );

            if (!entryId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "ENTRY_ID_REQUIRED"
                });
            }

            if (
                !isValidTxid(
                    transactionHash
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_TRANSACTION_HASH"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            const existing =
                await Player.findOne({
                    transactionHash
                });

            if (existing) {

                if (
                    String(
                        existing._id
                    ) !== entryId
                ) {

                    return res.status(409).json({

                        success:
                            false,

                        error:
                            "TRANSACTION_ALREADY_USED"
                    });
                }

                return res.json({

                    success:
                        true,

                    status:
                        existing.paymentStatus,

                    message:
                        "Transaction déjà enregistrée."
                });
            }

            const player =
                await Player.findById(
                    entryId
                );

            if (!player) {

                return res.status(404).json({

                    success:
                        false,

                    error:
                        "ENTRY_NOT_FOUND"
                });
            }

            player.transactionHash =
                transactionHash;

            player.paymentStatus =
                "pending";

            await player.save();

            return res.json({

                success:
                    true,

                status:
                    "pending",

                message:
                    "Transaction reçue."
            });

        } catch (error) {

            console.error(
                "❌ submit-transaction:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "TRANSACTION_ERROR"
            });
        }
    }
);

/* =========================================================
   VERIFY PAYMENT
   ========================================================= */

app.post(
    "/api/verify-payment",
    async (req, res) => {

        try {

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

            const walletAddress =
                cleanString(
                    req.body.walletAddress,
                    64
                );

            const amount =
                Number(
                    req.body.amount
                );

            const txid =
                cleanString(
                    req.body.txid,
                    100
                );

            if (!playerId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            if (!isValidBet(amount)) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_AMOUNT",

                    message:
                        "La mise minimale est de 1 USDT."
                });
            }

            if (
                !isValidTronAddress(
                    walletAddress
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_WALLET_ADDRESS"
                });
            }

            if (
                !isValidTxid(txid)
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_TXID"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            const alreadyUsed =
                await Player.findOne({
                    transactionHash:
                        txid
                });

            if (alreadyUsed) {

                return res.status(409).json({

                    success:
                        false,

                    error:
                        "TRANSACTION_ALREADY_USED",

                    message:
                        "Cette transaction a déjà été utilisée."
                });
            }

            /* -----------------------------------------
               TRONGRID
               ----------------------------------------- */

            const eventsUrl =
                "https://api.trongrid.io/v1/transactions/" +
                encodeURIComponent(txid) +
                "/events" +
                "?only_confirmed=true" +
                "&limit=50";

            const {
                response:
                    eventResponse,

                data:
                    eventData

            } =
                await fetchJson(
                    eventsUrl
                );

            if (!eventResponse.ok) {

                console.error(
                    "TronGrid HTTP:",
                    eventResponse.status
                );

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRON_TRANSACTION_NOT_FOUND",

                    message:
                        "Transaction introuvable ou pas encore confirmée."
                });
            }

            const events =
                eventData &&
                Array.isArray(
                    eventData.data
                )
                    ? eventData.data
                    : [];

            const expectedUnits =
                usdtToUnits(
                    amount
                );

            /* -----------------------------------------
               RECHERCHE DU TRANSFERT USDT
               ----------------------------------------- */

            const paymentEvent =
                events.find(
                    event => {

                        if (
                            String(
                                event.type || ""
                            ) !== "Transfer"
                        ) {
                            return false;
                        }

                        if (
                            String(
                                event.token_info?.address ||
                                ""
                            ) !==
                            USDT_CONTRACT
                        ) {
                            return false;
                        }

                        if (
                            String(
                                event.result?.from ||
                                ""
                            ) !==
                            walletAddress
                        ) {
                            return false;
                        }

                        if (
                            String(
                                event.result?.to ||
                                ""
                            ) !==
                            MILTAPE_WALLET
                        ) {
                            return false;
                        }

                        const eventAmount =
                            String(
                                event.result?.value ||
                                ""
                            );

                        if (
                            eventAmount !==
                            String(
                                expectedUnits
                            )
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

            if (!paymentEvent) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PAYMENT_NOT_MATCHED",

                    message:
                        "Aucun transfert USDT TRC20 correspondant exactement à la mise n'a été trouvé."
                });
            }

            if (
                paymentEvent.transaction_id &&
                String(
                    paymentEvent.transaction_id
                ) !== txid
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRANSACTION_ID_MISMATCH"
                });
            }

            /* -----------------------------------------
               CRÉER LE JOUEUR PAYÉ
               ----------------------------------------- */

            let player;

            try {

                player =
                    await Player.create({

                        playerId,

                        playerName,

                        score:
                            0,

                        amount:
                            Number(
                                amount.toFixed(6)
                            ),

                        cryptoAddress:
                            walletAddress,

                        transactionHash:
                            txid,

                        paymentStatus:
                            "paid",

                        gameId,

                        paidAt:
                            new Date()
                    });

            } catch (createError) {

                if (
                    createError?.code ===
                    11000
                ) {

                    return res.status(409).json({

                        success:
                            false,

                        error:
                            "TRANSACTION_ALREADY_USED"
                    });
                }

                throw createError;
            }

            /* -----------------------------------------
               PAIEMENT VALIDÉ
               ----------------------------------------- */

            await broadcastLeaderboard();

            await broadcastSaturdayJackpot();

            io.emit(
                "stakesUpdated"
            );

            return res.json({

                success:
                    true,

                status:
                    "paid",

                entryId:
                    String(
                        player._id
                    ),

                gameId,

                amount:
                    player.amount,

                transactionHash:
                    txid,

                wallet:
                    walletAddress,

                payment: {

                    token:
                        TOKEN,

                    network:
                        NETWORK,

                    chain:
                        CHAIN,

                    contract:
                        USDT_CONTRACT,

                    destination:
                        MILTAPE_WALLET
                },

                message:
                    "Paiement USDT TRC20 vérifié. Entrée validée."
            });

        } catch (error) {

            console.error(
                "❌ verify-payment:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                error:
                    "VERIFY_PAYMENT_ERROR",

                message:
                    "Erreur lors de la vérification du paiement."
            });
        }
    }
);

/* =========================================================
   SOCKET.IO
   ========================================================= */

io.on(
    "connection",
    socket => {

        console.log(
            "👤 Joueur connecté :",
            socket.id
        );

        /* -----------------------------------------
           TIMER INITIAL
           ----------------------------------------- */

        socket.emit(
            "timer",
            timerLeft
        );

        /* -----------------------------------------
           GAME INFO
           ----------------------------------------- */

        socket.emit(
            "gameInfo",
            {

                gameId,

                duration:
                    GAME_DURATION
            }
        );

        /* -----------------------------------------
           JACKPOT INITIAL
           ----------------------------------------- */

        getSaturdayJackpot()
            .then(
                jackpot => {

                    socket.emit(
                        "saturdayJackpot",
                        jackpot
                    );
                }
            )
            .catch(
                () => {}
            );

        /* -----------------------------------------
           LEADERBOARD INITIAL
           ----------------------------------------- */

        getLeaderboard()
            .then(
                players => {

                    socket.emit(
                        "leaderboard",
                        players
                    );
                }
            )
            .catch(
                () => {

                    socket.emit(
                        "leaderboard",
                        []
                    );
                }
            );

        /* =================================================
           JOIN SIMPLE
           ================================================= */

        socket.on(
            "join",
            async data => {

                try {

                    if (!data) {
                        return;
                    }

                    const playerId =
                        cleanString(
                            data.playerId,
                            100
                        );

                    const playerName =
                        cleanString(
                            data.playerName ||
                            "Anonyme",
                            30
                        );

                    if (!playerId) {
                        return;
                    }

                    socket.data.playerId =
                        playerId;

                    socket.data.playerName =
                        playerName;

                    io.emit(
                        "onlineCount",
                        io.engine.clientsCount
                    );

                    await broadcastLeaderboard();

                } catch (error) {

                    console.error(
                        "❌ join:",
                        error.message
                    );
                }
            }
        );

        /* =================================================
           JOIN PAID GAME
           ================================================= */

        socket.on(
            "joinPaidGame",
            async data => {

                try {

                    if (
                        !data ||
                        !data.playerId
                    ) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "Identifiant joueur manquant."
                            }
                        );

                        return;
                    }

                    const playerId =
                        cleanString(
                            data.playerId,
                            100
                        );

                    const txid =
                        cleanString(
                            data.txid,
                            100
                        );

                    if (
                        !isValidTxid(txid)
                    ) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "TXID invalide."
                            }
                        );

                        return;
                    }

                    if (!mongoConnected) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "Base de données indisponible."
                            }
                        );

                        return;
                    }

                    const player =
                        await Player.findOne({

                            playerId,

                            gameId,

                            paymentStatus:
                                "paid",

                            transactionHash:
                                txid
                        });

                    if (!player) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "Paiement non validé pour cette partie."
                            }
                        );

                        return;
                    }

                    if (
                        Number(
                            player.amount
                        ) <
                        MINIMUM_BET
                    ) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "La mise minimale est de 1 USDT."
                            }
                        );

                        return;
                    }

                    const existingSocket =
                        activePlayers.get(
                            playerId
                        );

                    if (
                        existingSocket &&
                        existingSocket !==
                            socket.id
                    ) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "Ce joueur est déjà connecté."
                            }
                        );

                        return;
                    }

                    activePlayers.set(
                        playerId,
                        socket.id
                    );

                    socket.data.playerId =
                        player.playerId;

                    socket.data.playerName =
                        player.playerName;

                    socket.data.gameId =
                        gameId;

                    socket.data.paid =
                        true;

                    socket.data.txid =
                        player.transactionHash;

                    socket.data.entryId =
                        String(
                            player._id
                        );

                    socket.data.score =
                        Number(
                            player.score || 0
                        );

                    socket.emit(
                        "paidGameJoined",
                        {

                            success:
                                true,

                            gameId,

                            playerId:
                                player.playerId,

                            playerName:
                                player.playerName,

                            amount:
                                player.amount,

                            score:
                                player.score || 0
                        }
                    );

                    console.log(
                        "✅ Joueur rejoint partie :",
                        playerId,
                        "| Game:",
                        gameId
                    );

                } catch (error) {

                    console.error(
                        "❌ joinPaidGame:",
                        error.message
                    );

                    socket.emit(
                        "paidGameRejected",
                        {

                            success:
                                false,

                            message:
                                "Erreur de connexion à la partie."
                        }
                    );
                }
            }
        );

        /* =================================================
           CHAT
           ================================================= */

        socket.on(
            "chatMessage",
            msg => {

                try {

                    if (!msg) {
                        return;
                    }

                    const message =
                        cleanString(
                            msg.message ||
                            msg.text ||
                            "",
                            250
                        );

                    if (!message) {
                        return;
                    }

                    const playerName =
                        cleanString(
                            socket.data.playerName ||
                            msg.playerName ||
                            "Anonyme",
                            30
                        );

                    io.emit(
                        "chatMessage",
                        {

                            playerName,

                            message,

                            time:
                                Date.now()
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ chat:",
                        error.message
                    );
                }
            }
        );

        /* =================================================
           TAP
           ================================================= */

        socket.on(
            "tap",
            async () => {

                try {

                    if (!mongoConnected) {
                        return;
                    }

                    if (
                        !socket.data.playerId ||
                        !socket.data.paid
                    ) {
                        return;
                    }

                    if (
                        socket.data.gameId !==
                        gameId
                    ) {
                        return;
                    }

                    const playerId =
                        cleanString(
                            socket.data.playerId,
                            100
                        );

                    const now =
                        Date.now();

                    let rate =
                        tapRate.get(
                            playerId
                        );

                    if (
                        !rate ||
                        now -
                            rate.startedAt >=
                        1000
                    ) {

                        rate = {

                            startedAt:
                                now,

                            count:
                                0
                        };

                        tapRate.set(
                            playerId,
                            rate
                        );
                    }

                    if (
                        rate.count >=
                        MAX_TAPS_PER_SECOND
                    ) {

                        return;
                    }

                    rate.count++;

                    const player =
                        await Player.findOne({

                            playerId,

                            gameId,

                            paymentStatus:
                                "paid",

                            transactionHash:
                                socket.data.txid
                        });

                    if (!player) {

                        socket.data.paid =
                            false;

                        return;
                    }

                    /* -----------------------------------------
                       +1 TAP
                       ----------------------------------------- */

                    const updatedPlayer =
                        await Player.findOneAndUpdate(

                            {

                                _id:
                                    player._id,

                                gameId,

                                paymentStatus:
                                    "paid"
                            },

                            {

                                $inc: {

                                    score:
                                        1
                                }

                            },

                            {

                                new:
                                    true
                            }
                        );

                    if (!updatedPlayer) {
                        return;
                    }

                    socket.data.score =
                        updatedPlayer.score;

                    /* -----------------------------------------
                       SCORE JOUEUR
                       ----------------------------------------- */

                    socket.emit(
                        "scoreUpdate",
                        {

                            score:
                                updatedPlayer.score
                        }
                    );

                    /* -----------------------------------------
                       LEADERBOARD
                       ----------------------------------------- */

                    await broadcastLeaderboard();

                } catch (error) {

                    console.error(
                        "❌ tap:",
                        error.message
                    );
                }
            }
        );

        /* =================================================
           DISCONNECT
           ================================================= */

        socket.on(
            "disconnect",
            () => {

                const playerId =
                    socket.data.playerId;

                if (
                    playerId &&
                    activePlayers.get(
                        playerId
                    ) ===
                        socket.id
                ) {

                    activePlayers.delete(
                        playerId
                    );

                    tapRate.delete(
                        playerId
                    );
                }

                console.log(
                    "🔌 Joueur déconnecté :",
                    socket.id
                );

                io.emit(
                    "onlineCount",
                    io.engine.clientsCount
                );
            }
        );
    }
);

/* =========================================================
   TIMER PARTIE
   ========================================================= */

setInterval(
    async () => {

        try {

            timerLeft--;

            if (
                timerLeft <= 0
            ) {

                console.log(
                    "🏁 FIN PARTIE :",
                    gameId
                );

                /* -----------------------------------------
                   CLASSEMENT FINAL
                   ----------------------------------------- */

                const finalLeaderboard =
                    await getLeaderboard();

                io.emit(
                    "gameFinished",
                    {

                        gameId,

                        leaderboard:
                            finalLeaderboard
                    }
                );

                io.emit(
                    "leaderboard",
                    finalLeaderboard
                );

                /* -----------------------------------------
                   BLOQUER LES JOUEURS
                   ----------------------------------------- */

                for (
                    const socket of
                    io.sockets.sockets.values()
                ) {

                    socket.data.paid =
                        false;

                    socket.data.gameId =
                        null;

                    socket.data.txid =
                        null;
                }

                activePlayers.clear();

                tapRate.clear();

                /* -----------------------------------------
                   NOUVELLE PARTIE
                   ----------------------------------------- */

                gameId++;

                timerLeft =
                    GAME_DURATION;

                console.log(
                    "🔥 NOUVELLE PARTIE :",
                    gameId
                );

                io.emit(
                    "newGame",
                    {

                        gameId,

                        duration:
                            GAME_DURATION
                    }
                );

                await broadcastSaturdayJackpot();
            }

            io.emit(
                "timer",
                timerLeft
            );

        } catch (error) {

            console.error(
                "❌ TIMER ERROR:",
                error.message
            );
        }

    },
    1000
);

/* =========================================================
   NETTOYAGE ANTI-SPAM
   ========================================================= */

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                playerId,
                rate
            ] of tapRate.entries()
        ) {

            if (
                now -
                    rate.startedAt >
                5000
            ) {

                tapRate.delete(
                    playerId
                );
            }
        }

    },
    5000
);

/* =========================================================
   MISE À JOUR CAGNOTTE
   ========================================================= */

setInterval(
    async () => {

        try {

            await broadcastSaturdayJackpot();

        } catch (error) {

            console.error(
                "❌ Jackpot update:",
                error.message
            );
        }

    },
    30000
);

/* =========================================================
   ONLINE COUNT
   ========================================================= */

app.get(
    "/api/online",
    (req, res) => {

        res.json({

            success:
                true,

            online:
                io.engine.clientsCount
        });
    }
);

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
    "/api/health",
    async (req, res) => {

        try {

            const jackpot =
                await getSaturdayJackpot();

            res.json({

                success:
                    true,

                server:
                    "online",

                mongo:
                    mongoConnected,

                gameId,

                timerLeft,

                saturdayJackpot:
                    jackpot,

                timestamp:
                    new Date().toISOString()
            });

        } catch (error) {

            res.status(500).json({

                success:
                    false,

                server:
                    "online",

                mongo:
                    mongoConnected,

                error:
                    "HEALTH_ERROR"
            });
        }
    }
);

/* =========================================================
   404
   ========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success:
                false,

            error:
                "ROUTE_NOT_FOUND",

            path:
                req.originalUrl
        });
    }
);

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
    (
        err,
        req,
        res,
        next
    ) => {

        console.error(
            "❌ SERVER ERROR:",
            err
        );

        res.status(500).json({

            success:
                false,

            error:
                "SERVER_ERROR"
        });
    }
);

/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Miltape lancé sur le port ${PORT}`
        );

        console.log(
            "⏱️ Partie : 10 minutes"
        );

        console.log(
            "🏆 Gagnants : TOP 5"
        );

        console.log(
            "💰 Mise minimale :",
            MINIMUM_BET,
            "USDT"
        );

        console.log(
            "🎰 Cagnotte samedi :",
            JACKPOT_PERCENT,
            "%"
        );

        console.log(
            "🪙 Paiement : USDT TRC20"
        );

        console.log(
            "📍 Wallet :",
            MILTAPE_WALLET
        );

        console.log(
            "🔐 Vérification blockchain : ACTIVE"
        );

        console.log(
            "🛡️ Anti-spam :",
            MAX_TAPS_PER_SECOND,
            "taps/seconde"
        );
    }
);
