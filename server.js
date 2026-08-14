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

const PORT = Number(process.env.PORT) || 8080;

const MONGO_URI =
    process.env.MONGO_URI || "";

const TRONGRID_API_KEY =
    process.env.TRONGRID_API_KEY || "";

/*
 * Durée d'une partie :
 * 10 minutes = 600 secondes
 */
const GAME_DURATION = 600;

/*
 * Wallet officiel Miltape
 */
const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

/*
 * Contrat officiel USDT TRC20
 */
const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/*
 * USDT possède 6 décimales
 */
const USDT_DECIMALS = 6;

const NETWORK = "TRON";
const TOKEN = "USDT";
const CHAIN = "TRC20";

/*
 * Mise minimale :
 * strictement supérieure à 0.
 */
const MINIMUM_BET = 0;

/*
 * Pas de maximum.
 */
const MAXIMUM_BET = null;

/*
 * Nombre de gagnants :
 * TOP 5
 */
const TOP_WINNERS = 5;

/*
 * Anti-spam :
 * maximum 25 taps/seconde.
 */
const MAX_TAPS_PER_SECOND = 25;

/* =========================================================
   ETAT DU SERVEUR
   ========================================================= */

let mongoConnected = false;

/*
 * Numéro de la partie actuelle.
 */
let gameId = 1;

/*
 * Temps restant.
 */
let timerLeft = GAME_DURATION;

/*
 * Joueurs actuellement autorisés.
 *
 * playerId -> socketId
 */
const activePlayers = new Map();

/*
 * Anti-spam :
 *
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
console.log("Durée :", GAME_DURATION, "secondes");
console.log("Réseau :", NETWORK);
console.log("Token :", TOKEN);
console.log("Standard :", CHAIN);
console.log("Wallet :", MILTAPE_WALLET);

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

const playerSchema = new mongoose.Schema(
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
            min: 0
        },

        cryptoAddress: {
            type: String,
            default: "",
            trim: true,
            maxlength: 64
        },

        /*
         * IMPORTANT :
         * Pas d'index ici.
         * L'index unique sparse est créé plus bas.
         */
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

/*
 * Une transaction blockchain
 * ne peut être utilisée qu'une seule fois.
 *
 * sparse = les documents sans transactionHash
 * ne sont pas considérés.
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
 * Index classement.
 */
playerSchema.index(
    {
        gameId: 1,
        paymentStatus: 1,
        score: -1
    },
    {
        name: "game_payment_score"
    }
);

const Player = mongoose.model(
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
        .substring(0, maxLength);
}

/* =========================================================
   VALIDATION ADRESSE TRON
   ========================================================= */

function isValidTronAddress(address) {

    const value =
        cleanString(address, 64);

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
        value
    );
}

/* =========================================================
   VALIDATION TXID
   ========================================================= */

function isValidTxid(txid) {

    const value =
        cleanString(txid, 100);

    return /^[a-fA-F0-9]{64}$/.test(
        value
    );
}

/* =========================================================
   USDT -> UNITÉS
   ========================================================= */

function usdtToUnits(amount) {

    return Math.round(
        Number(amount) *
        Math.pow(10, USDT_DECIMALS)
    );
}

/* =========================================================
   UNITÉS -> USDT
   ========================================================= */

function unitsToUsdt(units) {

    return (
        Number(units) /
        Math.pow(10, USDT_DECIMALS)
    );
}

/* =========================================================
   VALIDATION MISE
   ========================================================= */

function isValidBet(amount) {

    const numeric =
        Number(amount);

    if (
        !Number.isFinite(numeric)
    ) {
        return false;
    }

    if (
        numeric <= MINIMUM_BET
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
        usdtToUnits(numeric);

    if (
        !Number.isSafeInteger(units)
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
        Accept: "application/json"
    };

    if (TRONGRID_API_KEY) {

        headers[
            "TRON-PRO-API-KEY"
        ] = TRONGRID_API_KEY;
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
   PAGE PRINCIPALE
   ========================================================= */

app.get(
    "/",
    (req, res) => {

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
    }
);

/* =========================================================
   STATUS
   ========================================================= */

app.get(
    "/api/status",
    (req, res) => {

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
    }
);

/* =========================================================
   GAME CONFIG
   ========================================================= */

app.get(
    "/api/game-config",
    (req, res) => {

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
                            _id: null,

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
   LEADERBOARD
   ========================================================= */

async function getLeaderboard() {

    if (!mongoConnected) {
        return [];
    }

    const players =
        await Player.aggregate([

            {
                $match: {

                    gameId,

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
                        $sum:
                            "$score"
                    },

                    amount: {
                        $sum:
                            "$amount"
                    }
                }
            },

            {
                $sort: {

                    score:
                        -1,

                    _id:
                        1
                }
            },

            {
                $limit:
                    TOP_WINNERS
            }
        ]);

    return players;
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
                        "La mise doit être supérieure à 0 USDT."
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
                    String(player._id),

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

            /* -------------------------------------------------
               VALIDATION
            ------------------------------------------------- */

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
                        "INVALID_AMOUNT"
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

            /* -------------------------------------------------
               TXID DÉJÀ UTILISÉ
            ------------------------------------------------- */

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

            /* -------------------------------------------------
               TRONGRID
            ------------------------------------------------- */

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

            /* -------------------------------------------------
               RECHERCHE TRANSFERT USDT
            ------------------------------------------------- */

            const expectedUnits =
                usdtToUnits(amount);

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
                            String(expectedUnits)
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

            /* -------------------------------------------------
               PAIEMENT NON TROUVÉ
            ------------------------------------------------- */

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

            /* -------------------------------------------------
               VÉRIFICATION TXID
            ------------------------------------------------- */

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

            /* -------------------------------------------------
               CRÉATION ENTRÉE PAYÉE
            ------------------------------------------------- */

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

                /*
                 * Protection contre deux validations
                 * simultanées du même TXID.
                 */
                if (
                    createError?.code === 11000
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

            /* -------------------------------------------------
               MISE À JOUR CLASSEMENT
            ------------------------------------------------- */

            await broadcastLeaderboard();

            io.emit(
                "stakesUpdated"
            );

            /* -------------------------------------------------
               RÉPONSE
            ------------------------------------------------- */

            return res.json({

                success:
                    true,

                status:
                    "paid",

                entryId:
                    String(player._id),

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

        /*
         * Envoyer immédiatement le timer.
         */
        socket.emit(
            "timer",
            timerLeft
        );

        /*
         * Informations partie.
         */
        socket.emit(
            "gameInfo",
            {
                gameId,
                duration:
                    GAME_DURATION
            }
        );

        /*
         * Classement.
         */
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

        /* =====================================================
           JOIN SIMPLE
           ===================================================== */

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

        /* =====================================================
           JOIN PAID GAME
           ===================================================== */

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

                    /*
                     * Un seul appareil/socket
                     * par joueur.
                     */
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
                        String(player._id);

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

        /* =====================================================
           CHAT
           ===================================================== */

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

        /* =====================================================
           TAP
           ===================================================== */

        socket.on(
            "tap",
            async () => {

                try {

                    if (!mongoConnected) {
                        return;
                    }

                    /*
                     * Le joueur doit être payé.
                     */
                    if (
                        !socket.data.playerId ||
                        !socket.data.paid
                    ) {
                        return;
                    }

                    /*
                     * Le joueur doit être
                     * dans la partie actuelle.
                     */
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

                    /* -----------------------------------------
                       ANTI-SPAM
                       ----------------------------------------- */

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

                    /* -----------------------------------------
                       VÉRIFICATION JOUEUR
                       ----------------------------------------- */

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
                       INCRÉMENTATION ATOMIQUE
                       ----------------------------------------- */

                    /*
                     * IMPORTANT :
                     *
                     * On utilise $inc au lieu de :
                     *
                     * player.score += 1
                     *
                     * puis save().
                     *
                     * Cela évite que plusieurs taps
                     * simultanés écrasent le score.
                     */

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
                                    score: 1
                                }
                            },

                            {
                                new: true
                            }
                        );

                    if (!updatedPlayer) {
                        return;
                    }

                    socket.data.score =
                        updatedPlayer.score;

                    /* -----------------------------------------
                       SCORE DU JOUEUR
                       ----------------------------------------- */

                    socket.emit(
                        "scoreUpdate",
                        {

                            score:
                                updatedPlayer.score
                        }
                    );

                    /* -----------------------------------------
                       CLASSEMENT
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

        /* =====================================================
           DISCONNECT
           ===================================================== */

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

            /* -----------------------------------------------
               FIN DE PARTIE
               ----------------------------------------------- */

            if (
                timerLeft <= 0
            ) {

                console.log(
                    "🏁 FIN PARTIE :",
                    gameId
                );

                /*
                 * Dernier classement.
                 */
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

                /*
                 * Bloquer les joueurs
                 * de l'ancienne partie.
                 */
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

                /*
                 * Nouvelle partie.
                 */
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
            }

            /*
             * Envoyer le timer.
             */
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
    (req, res) => {

        res.json({

            success:
                true,

            server:
                "online",

            mongo:
                mongoConnected,

            gameId,

            timerLeft,

            timestamp:
                new Date().toISOString()
        });
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
   START
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
            "💰 Mise : libre (> 0 USDT)"
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
