const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

/* =========================================================
   APP
========================================================= */

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json({
    limit: "1mb"
}));

const server = http.createServer(app);

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
    process.env.PORT || 8080;

const MONGO_URI =
    process.env.MONGO_URI;

/*
 * Miltape :
 * 10 minutes par partie
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
 * USDT TRC20 = 6 décimales
 */
const USDT_DECIMALS = 6;

const NETWORK = "TRON";
const TOKEN = "USDT";
const CHAIN = "TRC20";

/*
 * Mise libre.
 *
 * IMPORTANT :
 * 0 signifie :
 * aucun minimum fixe de 13 USDT.
 *
 * Le joueur doit néanmoins entrer
 * une valeur strictement supérieure à 0.
 */
const MINIMUM_BET = 0;

/*
 * Pas de maximum imposé par le jeu.
 */
const MAXIMUM_BET = null;

/*
 * Nombre de gagnants
 */
const TOP_WINNERS = 5;

let mongoConnected = false;

/*
 * Numéro de partie
 */
let gameId = 1;

/*
 * Temps restant
 */
let timerLeft = GAME_DURATION;

/* =========================================================
   LOGS
========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE WORLD CHALLENGE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log(
    "Partie :",
    GAME_DURATION / 60,
    "minutes"
);
console.log("Réseau :", NETWORK);
console.log("Token :", TOKEN);
console.log("Standard :", CHAIN);
console.log(
    "Wallet :",
    MILTAPE_WALLET
);
console.log(
    "Minimum mise :",
    MINIMUM_BET,
    "USDT"
);
console.log(
    "Maximum mise :",
    MAXIMUM_BET === null
        ? "AUCUN"
        : MAXIMUM_BET + " USDT"
);
console.log(
    "MongoDB :",
    MONGO_URI
        ? "CONFIGURÉ"
        : "❌ MANQUANT"
);
console.log("======================================");

/* =========================================================
   MONGODB SCHEMA
========================================================= */

const playerSchema =
    new mongoose.Schema(
        {
            playerId: {
                type: String,
                required: true,
                index: true,
                trim: true,
                maxlength: 100
            },

            playerName: {
                type: String,
                default: "Anonyme",
                trim: true,
                maxlength: 30
            },

            /*
             * Score de la partie
             */
            score: {
                type: Number,
                default: 0,
                min: 0
            },

            /*
             * Mise USDT
             */
            amount: {
                type: Number,
                required: true,
                min: 0
            },

            /*
             * Wallet du joueur
             */
            cryptoAddress: {
                type: String,
                default: "",
                trim: true
            },

            /*
             * TX blockchain
             */
            transactionHash: {
                type: String,
                default: "",
                trim: true,
                index: true
            },

            /*
             * pending
             * paid
             * rejected
             */
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

            /*
             * Numéro de partie
             */
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
 * Index utile pour éviter
 * plusieurs utilisations de la même transaction.
 */
playerSchema.index(
    {
        transactionHash: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            transactionHash: {
                $type: "string"
            }
        }
    }
);

const Player =
    mongoose.model(
        "Player",
        playerSchema
    );

/* =========================================================
   MONGODB CONNECTION
========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI manquant."
        );

        console.error(
            "Railway > Variables > MONGO_URI"
        );

        return;
    }

    try {

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS:
                    10000
            }
        );

        mongoConnected = true;

        console.log(
            "✅ MongoDB connecté"
        );

    } catch (error) {

        mongoConnected = false;

        console.error(
            "❌ MongoDB :",
            error.message
        );
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
        value || ""
    )
        .trim()
        .substring(
            0,
            maxLength
        );
}

/*
 * Vérifie une adresse TRON
 */
function isValidTronAddress(
    address
) {

    const value =
        cleanString(
            address,
            64
        );

    /*
     * Une adresse TRON Base58
     * commence normalement par T.
     */
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(value);
}

/*
 * Conversion USDT -> unités blockchain
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

/*
 * Conversion unités blockchain -> USDT
 */
function unitsToUsdt(
    units
) {

    return Number(
        units
    ) / Math.pow(
        10,
        USDT_DECIMALS
    );
}

/*
 * Vérification montant
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
        numeric <=
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

    return true;
}

/* =========================================================
   ROUTE PRINCIPALE
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

            gameDuration:
                GAME_DURATION,

            gameId,

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

            gameDuration:
                GAME_DURATION,

            gameId,

            timerLeft,

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
                    success: true,
                    totalStakes: 0
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

            const totalStakes =
                result.length
                    ? Number(
                        result[0]
                            .total || 0
                    )
                    : 0;

            res.json({

                success:
                    true,

                totalStakes:
                    Number(
                        totalStakes.toFixed(6)
                    )
            });

        } catch (error) {

            console.error(
                "❌ total-stakes:",
                error.message
            );

            res.status(500).json({

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

            res.json({

                success:
                    true,

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
            });

        } catch (error) {

            console.error(
                "❌ player-stats:",
                error.message
            );

            res.status(500).json({

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

    /*
     * On trie d'abord les entrées
     * pour que $first/$last soient déterministes.
     */
    const players =
        await Player.aggregate([

            {
                $match: {

                    gameId:
                        gameId,

                    paymentStatus:
                        "paid"
                }
            },

            {
                $sort: {
                    createdAt:
                        1
                }
            },

            {
                $group: {

                    _id:
                        "$playerId",

                    playerName:
                        {
                            $last:
                                "$playerName"
                        },

                    score:
                        {
                            $sum:
                                "$score"
                        }
                }
            },

            {
                $sort: {
                    score:
                        -1
                }
            },

            {
                $limit:
                    TOP_WINNERS
            }
        ]);

    return players;
}

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

            if (!mongoConnected) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            /*
             * Si un TXID est déjà utilisé,
             * on refuse l'entrée.
             */
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

            const player =
                await Player.create({

                    playerId,

                    playerName,

                    score:
                        0,

                    amount:
                        Number(
                            amount.toFixed(6)
                        ),

                    cryptoAddress,

                    transactionHash,

                    paymentStatus:
                        "pending",

                    gameId
                });

            res.json({

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
                    "Entrée créée. Paiement en attente de vérification."
            });

        } catch (error) {

            console.error(
                "❌ create-entry:",
                error.message
            );

            res.status(500).json({

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

            if (!transactionHash) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRANSACTION_HASH_REQUIRED"
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

            if (
                existing &&
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

            res.json({

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

            res.status(500).json({

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

/*
 * C'est cette route que ton HTML appelle :
 *
 * POST /api/verify-payment
 *
 * Elle vérifie la transaction directement
 * auprès de la blockchain TRON.
 *
 * Le serveur vérifie :
 *
 * 1. TXID réel
 * 2. token = USDT
 * 3. contrat = USDT TRC20 officiel
 * 4. destination = wallet Miltape
 * 5. expéditeur = wallet du joueur
 * 6. montant = montant demandé
 * 7. transaction confirmée
 * 8. transaction pas déjà utilisée
 */

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

            if (!txid) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TXID_REQUIRED"
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

            /*
             * Vérifier si cette transaction
             * a déjà été utilisée.
             */

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

            /*
             * API TRON
             *
             * On demande la transaction par TXID.
             */

            const tronResponse =
                await fetch(
                    `https://api.trongrid.io/v1/transactions/${encodeURIComponent(txid)}`
                );

            if (
                !tronResponse.ok
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRON_TRANSACTION_NOT_FOUND"
                });
            }

            const tronData =
                await tronResponse.json();

            const transaction =
                tronData &&
                tronData.data &&
                tronData.data[0];

            if (!transaction) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRANSACTION_NOT_FOUND"
                });
            }

            /*
             * Vérifier que la transaction
             * est confirmée.
             */

            if (
                !transaction.ret ||
                !transaction.ret.length ||
                transaction.ret[0].contractRet !==
                    "SUCCESS"
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRANSACTION_NOT_SUCCESSFUL"
                });
            }

            /*
             * Récupérer les événements TRC20
             * de cette transaction.
             */

            const eventResponse =
                await fetch(
                    `https://api.trongrid.io/v1/transactions/${encodeURIComponent(txid)}/events?limit=50`
                );

            if (
                !eventResponse.ok
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "TRC20_EVENTS_UNAVAILABLE"
                });
            }

            const eventData =
                await eventResponse.json();

            const events =
                eventData &&
                Array.isArray(
                    eventData.data
                )
                    ? eventData.data
                    : [];

            /*
             * Chercher le transfert USDT exact.
             */

            const expectedUnits =
                usdtToUnits(
                    amount
                );

            const paymentEvent =
                events.find(
                    event => {

                        if (
                            event.type !==
                            "Transfer"
                        ) {
                            return false;
                        }

                        /*
                         * Adresse du contrat USDT
                         */
                        if (
                            String(
                                event.token_info?.address ||
                                ""
                            ) !==
                            USDT_CONTRACT
                        ) {
                            return false;
                        }

                        /*
                         * Expéditeur
                         */
                        if (
                            String(
                                event.result?.from ||
                                ""
                            ) !==
                            walletAddress
                        ) {
                            return false;
                        }

                        /*
                         * Destinataire
                         */
                        if (
                            String(
                                event.result?.to ||
                                ""
                            ) !==
                            MILTAPE_WALLET
                        ) {
                            return false;
                        }

                        /*
                         * Montant
                         */
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

            /*
             * Aucun transfert correspondant.
             */

            if (!paymentEvent) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PAYMENT_NOT_MATCHED",

                    message:
                        "Le paiement USDT TRC20 correspondant n'a pas été trouvé."
                });
            }

            /*
             * Tout est vérifié.
             *
             * Créer directement l'entrée
             * comme PAID.
             */

            const player =
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

            /*
             * Mettre à jour le classement.
             */

            await broadcastLeaderboard();

            /*
             * Informer les clients
             * que le total des mises a changé.
             */

            io.emit(
                "stakesUpdated"
            );

            res.json({

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

                message:
                    "Paiement USDT TRC20 vérifié. Entrée validée."
            });

        } catch (error) {

            console.error(
                "❌ verify-payment:",
                error.message
            );

            res.status(500).json({

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
         * Timer immédiat
         */
        socket.emit(
            "timer",
            timerLeft
        );

        /*
         * Infos partie
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
         * Classement immédiat
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

        /*
         * JOINTURE
         */
        socket.on(
            "join",
            async data => {

                socket.data =
                    data || {};

                io.emit(
                    "onlineCount",
                    io.engine
                        .clientsCount
                );

                await broadcastLeaderboard();
            }
        );

        /*
         * JOIN PAID GAME
         *
         * Le HTML peut envoyer cet événement
         * après /api/verify-payment.
         *
         * La vraie autorisation vient de MongoDB.
         */

        socket.on(
            "joinPaidGame",
            async data => {

                try {

                    if (
                        !data ||
                        !data.playerId
                    ) {
                        return;
                    }

                    const player =
                        await Player.findOne({

                            playerId:
                                String(
                                    data.playerId
                                ),

                            gameId,

                            paymentStatus:
                                "paid",

                            transactionHash:
                                String(
                                    data.txid ||
                                    ""
                                )
                        });

                    if (!player) {

                        socket.emit(
                            "paidGameRejected",
                            {
                                success:
                                    false,

                                message:
                                    "Paiement non validé."
                            }
                        );

                        return;
                    }

                    socket.data.playerId =
                        player.playerId;

                    socket.data.playerName =
                        player.playerName;

                    socket.data.gameId =
                        gameId;

                    socket.emit(
                        "paidGameJoined",
                        {

                            success:
                                true,

                            gameId,

                            playerId:
                                player.playerId
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ joinPaidGame:",
                        error.message
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
                        msg.playerName ||
                        "Anonyme",
                        30
                    );

                io.emit(
                    "chatMessage",
                    {
                        playerName,
                        message
                    }
                );
            }
        );

        /* =====================================================
           TAP
        ===================================================== */

        socket.on(
            "tap",
            async data => {

                try {

                    if (
                        !mongoConnected ||
                        !data ||
                        !data.playerId
                    ) {
                        return;
                    }

                    const playerId =
                        cleanString(
                            data.playerId,
                            100
                        );

                    /*
                     * Chercher une entrée PAID
                     * dans la partie actuelle.
                     */

                    const player =
                        await Player.findOne({

                            playerId,

                            gameId,

                            paymentStatus:
                                "paid"
                        });

                    if (!player) {

                        /*
                         * Aucun paiement validé.
                         */
                        return;
                    }

                    /*
                     * IMPORTANT :
                     *
                     * Le navigateur peut envoyer
                     * n'importe quelle valeur dans
                     * data.taps.
                     *
                     * On ignore cette valeur.
                     *
                     * 1 événement = 1 tap.
                     */

                    player.score += 1;

                    await player.save();

                    /*
                     * Mise à jour classement
                     */
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

                console.log(
                    "🔌 Joueur déconnecté :",
                    socket.id
                );

                io.emit(
                    "onlineCount",
                    io.engine
                        .clientsCount
                );
            }
        );
    }
);

/* =========================================================
   TIMER
========================================================= */

setInterval(
    async () => {

        timerLeft--;

        /*
         * Fin de partie
         */
        if (
            timerLeft <= 0
        ) {

            console.log(
                "🏁 FIN PARTIE :",
                gameId
            );

            /*
             * Afficher le classement final
             * avant de passer à la suivante.
             */

            await broadcastLeaderboard();

            /*
             * Nouvelle partie
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
                    gameId
                }
            );

            io.emit(
                "gameInfo",
                {
                    gameId,
                    duration:
                        GAME_DURATION
                }
            );
        }

        io.emit(
            "timer",
            timerLeft
        );

    },
    1000
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
            "💰 Mise : LIBRE"
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
    }
);
