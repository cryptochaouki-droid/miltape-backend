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
        methods: ["GET", "POST", "OPTIONS"]
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

/*
 * 10 minutes
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
 * USDT = 6 décimales
 */
const USDT_DECIMALS = 6;

const NETWORK = "TRON";
const TOKEN = "USDT";
const CHAIN = "TRC20";

/*
 * Mise libre.
 *
 * Minimum réel :
 * 0.000001 USDT
 *
 * car USDT possède 6 décimales.
 */
const MINIMUM_BET = 0;

/*
 * Aucun maximum.
 */
const MAXIMUM_BET = null;

/*
 * Top 5
 */
const TOP_WINNERS = 5;

/*
 * Protection contre les bots.
 *
 * Maximum 25 taps/seconde/joueur.
 */
const MAX_TAPS_PER_SECOND = 25;

/*
 * Sauvegarde Mongo toutes les 2 secondes.
 */
const SCORE_SAVE_INTERVAL = 2000;

/*
 * Rafraîchissement leaderboard.
 */
const LEADERBOARD_INTERVAL = 500;

/* =========================================================
   ETAT SERVEUR
========================================================= */

let mongoConnected = false;

let currentGame = {
    gameId: 1,
    startedAt: null,
    duration: GAME_DURATION
};

let gameInitialized = false;

/*
 * Scores en mémoire.
 *
 * playerId => {
 *     playerId,
 *     playerName,
 *     score,
 *     amount
 * }
 */
const scoreCache = new Map();

/*
 * Joueurs dont le score doit être sauvegardé.
 */
const dirtyPlayers = new Set();

/*
 * Anti-spam taps.
 *
 * playerId => {
 *     startedAt,
 *     count
 * }
 */
const tapRateMap = new Map();

/*
 * Evite plusieurs vérifications
 * simultanées du même TXID.
 */
const verifyingTransactions = new Set();

/*
 * Evite de lancer plusieurs broadcasts
 * simultanément.
 */
let leaderboardBroadcastScheduled = false;

/* =========================================================
   LOGS
========================================================= */

console.log("======================================");
console.log("🔥 MILTAPE WORLD CHALLENGE BACKEND");
console.log("======================================");
console.log("Port :", PORT);
console.log("Partie :", GAME_DURATION / 60, "minutes");
console.log("Réseau :", NETWORK);
console.log("Token :", TOKEN);
console.log("Standard :", CHAIN);
console.log("Wallet :", MILTAPE_WALLET);
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
console.log(
    "TronGrid API :",
    TRONGRID_API_KEY
        ? "CONFIGURÉE"
        : "⚠️ MANQUANTE"
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
                min: 0
            },

            cryptoAddress: {
                type: String,
                default: "",
                trim: true
            },

            /*
             * undefined au lieu de ""
             * pour que l'index sparse fonctionne correctement.
             */
            transactionHash: {
                type: String,
                default: undefined,
                trim: true,
                index: true
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
 * Un TXID ne peut être utilisé qu'une fois.
 */
playerSchema.index(
    {
        transactionHash: 1
    },
    {
        unique: true,
        sparse: true
    }
);

/*
 * Un joueur = une entrée par partie.
 */
playerSchema.index(
    {
        playerId: 1,
        gameId: 1
    },
    {
        unique: true
    }
);

const Player =
    mongoose.model(
        "Player",
        playerSchema
    );

/* =========================================================
   SCHEMA GAME
========================================================= */

const gameSchema =
    new mongoose.Schema(
        {
            gameId: {
                type: Number,
                required: true,
                unique: true,
                index: true
            },

            startedAt: {
                type: Date,
                required: true
            },

            endedAt: {
                type: Date,
                default: null
            },

            duration: {
                type: Number,
                default: GAME_DURATION
            },

            status: {
                type: String,
                enum: [
                    "running",
                    "completed"
                ],
                default: "running",
                index: true
            }
        },
        {
            versionKey: false
        }
    );

const Game =
    mongoose.model(
        "Game",
        gameSchema
    );

/* =========================================================
   MONGODB
========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI manquant."
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
   TRON ADDRESS
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

    return /^[a-fA-F0-9]{64}$/
        .test(
            cleanString(
                txid,
                100
            )
        );
}

/* =========================================================
   USDT
========================================================= */

/*
 * Convertit un montant USDT en unités blockchain.
 *
 * Exemple :
 *
 * 1       => 1000000
 * 10.5    => 10500000
 * 0.000001 => 1
 */
function usdtToUnits(
    amount
) {

    const value =
        String(
            amount ?? ""
        ).trim();

    if (
        !/^\d+(?:\.\d{1,6})?$/
            .test(value)
    ) {
        return null;
    }

    const parts =
        value.split(".");

    const integerPart =
        parts[0] || "0";

    const decimalPart =
        (parts[1] || "")
            .padEnd(
                6,
                "0"
            );

    try {

        const units =
            BigInt(
                integerPart
            ) *
            1000000n +
            BigInt(
                decimalPart
            );

        return units;

    } catch {

        return null;
    }
}

function unitsToUsdt(
    units
) {

    try {

        return Number(
            BigInt(
                units
            )
        ) / 1000000;

    } catch {

        return 0;
    }
}

/* =========================================================
   VALIDATION MISE
========================================================= */

function isValidBet(
    amount
) {

    const units =
        usdtToUnits(
            amount
        );

    if (
        units === null ||
        units <= 0n
    ) {
        return false;
    }

    const numeric =
        Number(
            amount
        );

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
   TIMER
========================================================= */

function getTimerLeft() {

    if (
        !currentGame.startedAt
    ) {
        return GAME_DURATION;
    }

    const elapsed =
        Math.floor(
            (
                Date.now() -
                new Date(
                    currentGame.startedAt
                ).getTime()
            ) / 1000
        );

    return Math.max(
        0,
        GAME_DURATION -
        elapsed
    );
}

/* =========================================================
   LOAD GAME
========================================================= */

async function initializeGame() {

    if (!mongoConnected) {
        return;
    }

    try {

        let game =
            await Game.findOne({
                status: "running"
            })
                .sort({
                    gameId: -1
                });

        /*
         * S'il existe une partie en cours,
         * on la reprend.
         */
        if (game) {

            const elapsed =
                Math.floor(
                    (
                        Date.now() -
                        game.startedAt.getTime()
                    ) / 1000
                );

            /*
             * Partie encore active.
             */
            if (
                elapsed <
                GAME_DURATION
            ) {

                currentGame = {
                    gameId:
                        game.gameId,

                    startedAt:
                        game.startedAt,

                    duration:
                        GAME_DURATION
                };

                await loadScoreCache();

                gameInitialized = true;

                console.log(
                    "▶️ Partie reprise :",
                    game.gameId
                );

                console.log(
                    "⏱️ Temps restant :",
                    getTimerLeft()
                );

                return;
            }

            /*
             * Partie expirée.
             */
            game.status =
                "completed";

            game.endedAt =
                new Date();

            await game.save();
        }

        /*
         * Trouver le prochain numéro.
         */
        const lastGame =
            await Game.findOne()
                .sort({
                    gameId: -1
                });

        const lastPlayer =
            await Player.findOne()
                .sort({
                    gameId: -1
                });

        const lastGameId =
            Math.max(
                lastGame
                    ? lastGame.gameId
                    : 0,

                lastPlayer
                    ? lastPlayer.gameId
                    : 0
            );

        const nextGameId =
            lastGameId + 1;

        const newGame =
            await Game.create({

                gameId:
                    nextGameId,

                startedAt:
                    new Date(),

                duration:
                    GAME_DURATION,

                status:
                    "running"
            });

        currentGame = {

            gameId:
                newGame.gameId,

            startedAt:
                newGame.startedAt,

            duration:
                GAME_DURATION
        };

        scoreCache.clear();
        dirtyPlayers.clear();

        gameInitialized = true;

        console.log(
            "🔥 NOUVELLE PARTIE :",
            nextGameId
        );

    } catch (error) {

        console.error(
            "❌ initializeGame:",
            error.message
        );
    }
}

/* =========================================================
   LOAD SCORES
========================================================= */

async function loadScoreCache() {

    scoreCache.clear();

    if (!mongoConnected) {
        return;
    }

    const players =
        await Player.find({

            gameId:
                currentGame.gameId,

            paymentStatus:
                "paid"

        })
            .lean();

    for (
        const player of players
    ) {

        scoreCache.set(
            player.playerId,
            {
                playerId:
                    player.playerId,

                playerName:
                    player.playerName,

                score:
                    Number(
                        player.score || 0
                    ),

                amount:
                    Number(
                        player.amount || 0
                    )
            }
        );
    }

    console.log(
        "📊 Scores chargés :",
        scoreCache.size
    );
}

/* =========================================================
   LEADERBOARD
========================================================= */

function getLeaderboardFromCache() {

    return Array.from(
        scoreCache.values()
    )
        .sort(
            (a, b) => {

                if (
                    b.score !==
                    a.score
                ) {
                    return (
                        b.score -
                        a.score
                    );
                }

                return String(
                    a.playerName
                ).localeCompare(
                    String(
                        b.playerName
                    )
                );
            }
        )
        .slice(
            0,
            TOP_WINNERS
        )
        .map(
            (
                player,
                index
            ) => ({

                rank:
                    index + 1,

                playerId:
                    player.playerId,

                playerName:
                    player.playerName,

                score:
                    player.score
            })
        );
}

function scheduleLeaderboardBroadcast() {

    if (
        leaderboardBroadcastScheduled
    ) {
        return;
    }

    leaderboardBroadcastScheduled =
        true;

    setTimeout(
        () => {

            leaderboardBroadcastScheduled =
                false;

            io.emit(
                "leaderboard",
                getLeaderboardFromCache()
            );

        },
        LEADERBOARD_INTERVAL
    );
}

/* =========================================================
   SAVE SCORES
========================================================= */

async function saveDirtyScores() {

    if (
        !mongoConnected ||
        dirtyPlayers.size === 0
    ) {
        return;
    }

    const playersToSave =
        Array.from(
            dirtyPlayers
        );

    dirtyPlayers.clear();

    const operations =
        [];

    for (
        const playerId of playersToSave
    ) {

        const player =
            scoreCache.get(
                playerId
            );

        if (!player) {
            continue;
        }

        operations.push({

            updateOne: {

                filter: {

                    playerId:
                        player.playerId,

                    gameId:
                        currentGame.gameId,

                    paymentStatus:
                        "paid"
                },

                update: {

                    $set: {

                        score:
                            player.score,

                        playerName:
                            player.playerName
                    }
                }
            }

        });
    }

    if (
        operations.length === 0
    ) {
        return;
    }

    try {

        await Player.bulkWrite(
            operations,
            {
                ordered: false
            }
        );

    } catch (error) {

        console.error(
            "❌ save scores:",
            error.message
        );

        /*
         * On remet les joueurs
         * en attente de sauvegarde.
         */
        for (
            const playerId of playersToSave
        ) {
            dirtyPlayers.add(
                playerId
            );
        }
    }
}

/* =========================================================
   FINALIZE GAME
========================================================= */

async function finalizeCurrentGame() {

    try {

        await saveDirtyScores();

        const leaderboard =
            getLeaderboardFromCache();

        console.log(
            "🏁 FIN PARTIE :",
            currentGame.gameId
        );

        console.log(
            "🏆 TOP 5 :",
            leaderboard
        );

        if (mongoConnected) {

            await Game.updateOne(

                {
                    gameId:
                        currentGame.gameId
                },

                {
                    $set: {

                        status:
                            "completed",

                        endedAt:
                            new Date()
                    }
                }
            );
        }

        io.emit(
            "gameFinished",
            {
                gameId:
                    currentGame.gameId,

                winners:
                    leaderboard
            }
        );

        return leaderboard;

    } catch (error) {

        console.error(
            "❌ finalizeGame:",
            error.message
        );

        return [];
    }
}

/* =========================================================
   START NEW GAME
========================================================= */

async function startNewGame() {

    try {

        const previousGameId =
            currentGame.gameId;

        const nextGameId =
            previousGameId + 1;

        const newGame =
            await Game.create({

                gameId:
                    nextGameId,

                startedAt:
                    new Date(),

                duration:
                    GAME_DURATION,

                status:
                    "running"
            });

        currentGame = {

            gameId:
                newGame.gameId,

            startedAt:
                newGame.startedAt,

            duration:
                GAME_DURATION
        };

        scoreCache.clear();

        dirtyPlayers.clear();

        tapRateMap.clear();

        io.emit(
            "newGame",
            {
                gameId:
                    nextGameId,

                duration:
                    GAME_DURATION
            }
        );

        io.emit(
            "gameInfo",
            {
                gameId:
                    nextGameId,

                duration:
                    GAME_DURATION
            }
        );

        io.emit(
            "leaderboard",
            []
        );

        console.log(
            "🔥 NOUVELLE PARTIE :",
            nextGameId
        );

    } catch (error) {

        console.error(
            "❌ startNewGame:",
            error.message
        );
    }
}

/* =========================================================
   TRONGRID HEADERS
========================================================= */

function tronHeaders() {

    const headers = {
        "Accept":
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
   VERIFY BLOCKCHAIN PAYMENT
========================================================= */

async function verifyBlockchainPayment({

    txid,
    walletAddress,
    amount

}) {

    if (
        !TRONGRID_API_KEY
    ) {

        throw new Error(
            "TRONGRID_API_KEY_MISSING"
        );
    }

    /*
     * TXID valid
     */
    if (
        !isValidTxid(
            txid
        )
    ) {

        return {
            valid:
                false,

            error:
                "INVALID_TXID"
        };
    }

    /*
     * Wallet valid
     */
    if (
        !isValidTronAddress(
            walletAddress
        )
    ) {

        return {
            valid:
                false,

            error:
                "INVALID_WALLET"
        };
    }

    /*
     * Montant
     */
    const expectedUnits =
        usdtToUnits(
            amount
        );

    if (
        expectedUnits === null ||
        expectedUnits <= 0n
    ) {

        return {
            valid:
                false,

            error:
                "INVALID_AMOUNT"
        };
    }

    /*
     * Vérification de la transaction
     * et de ses événements TRC20.
     *
     * only_confirmed=true
     */
    const url =
        "https://api.trongrid.io" +
        "/v1/transactions/" +
        encodeURIComponent(txid) +
        "/events" +
        "?only_confirmed=true" +
        "&limit=200";

    const response =
        await fetch(
            url,
            {
                method:
                    "GET",

                headers:
                    tronHeaders()
            }
        );

    if (
        !response.ok
    ) {

        const text =
            await response.text();

        console.error(
            "TronGrid HTTP:",
            response.status,
            text
        );

        return {
            valid:
                false,

            error:
                "TRONGRID_ERROR"
        };
    }

    const data =
        await response.json();

    const events =
        Array.isArray(
            data?.data
        )
            ? data.data
            : [];

    /*
     * Chercher le transfert exact.
     */
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
                 * Contrat USDT officiel
                 */
                const contract =
                    String(
                        event
                            .token_info
                            ?.address ||
                        ""
                    );

                if (
                    contract
                        .toLowerCase() !==
                    USDT_CONTRACT
                        .toLowerCase()
                ) {
                    return false;
                }

                /*
                 * Expéditeur
                 */
                const from =
                    String(
                        event
                            .result
                            ?.from ||
                        ""
                    );

                if (
                    from !==
                    walletAddress
                ) {
                    return false;
                }

                /*
                 * Destinataire
                 */
                const to =
                    String(
                        event
                            .result
                            ?.to ||
                        ""
                    );

                if (
                    to !==
                    MILTAPE_WALLET
                ) {
                    return false;
                }

                /*
                 * Montant exact
                 */
                const value =
                    String(
                        event
                            .result
                            ?.value ||
                        ""
                    );

                if (
                    value !==
                    expectedUnits.toString()
                ) {
                    return false;
                }

                return true;
            }
        );

    if (
        !paymentEvent
    ) {

        return {
            valid:
                false,

            error:
                "PAYMENT_NOT_MATCHED"
        };
    }

    return {

        valid:
            true,

        amount:
            unitsToUsdt(
                expectedUnits
            ),

        from:
            walletAddress,

        to:
            MILTAPE_WALLET,

        contract:
            USDT_CONTRACT
    };
}

/* =========================================================
   ROUTE PRINCIPALE
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            app:
                "Miltape World Challenge",

            status:
                "online",

            mongo:
                mongoConnected,

            gameInitialized:
                gameInitialized,

            gameDuration:
                GAME_DURATION,

            gameId:
                currentGame.gameId,

            timerLeft:
                getTimerLeft(),

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

            gameInitialized:
                gameInitialized,

            gameId:
                currentGame.gameId,

            timerLeft:
                getTimerLeft(),

            onlinePlayers:
                io.engine
                    .clientsCount,

            leaderboard:
                getLeaderboardFromCache(),

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

                gameId:
                    currentGame.gameId,

                timerLeft:
                    getTimerLeft(),

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

            if (
                !mongoConnected
            ) {

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
                        result[0]
                            .total || 0
                    )
                    : 0;

            res.json({

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

            if (
                !mongoConnected
            ) {

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
                    ) => {

                        if (
                            player.paymentStatus !==
                            "paid"
                        ) {
                            return sum;
                        }

                        return (
                            sum +
                            Number(
                                player.amount ||
                                0
                            )
                        );
                    },
                    0
                );

            res.json({

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
   LEADERBOARD API
========================================================= */

app.get(
    "/api/leaderboard",
    (req, res) => {

        res.json({

            success:
                true,

            gameId:
                currentGame.gameId,

            leaderboard:
                getLeaderboardFromCache()
        });
    }
);

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
                req.body.amount;

            const cryptoAddress =
                cleanString(
                    req.body.cryptoAddress,
                    64
                );

            if (
                !playerId
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            if (
                !isValidBet(
                    amount
                )
            ) {

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

            if (
                !mongoConnected
            ) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            /*
             * Vérifier si le joueur a déjà
             * une entrée dans cette partie.
             */
            const existingPlayer =
                await Player.findOne({

                    playerId,

                    gameId:
                        currentGame.gameId
                });

            if (
                existingPlayer
            ) {

                return res.status(409).json({

                    success:
                        false,

                    error:
                        "PLAYER_ALREADY_ENTERED",

                    entryId:
                        String(
                            existingPlayer._id
                        ),

                    paymentStatus:
                        existingPlayer.paymentStatus
                });
            }

            const numericAmount =
                Number(
                    amount
                );

            const player =
                await Player.create({

                    playerId,

                    playerName,

                    score:
                        0,

                    amount:
                        numericAmount,

                    cryptoAddress,

                    paymentStatus:
                        "pending",

                    gameId:
                        currentGame.gameId
                });

            res.json({

                success:
                    true,

                entryId:
                    String(
                        player._id
                    ),

                gameId:
                    currentGame.gameId,

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
                    "Entrée créée. Effectue le paiement puis envoie le TXID."
            });

        } catch (error) {

            console.error(
                "❌ create-entry:",
                error.message
            );

            /*
             * Collision unique playerId/gameId
             */
            if (
                error.code === 11000
            ) {

                return res.status(409).json({

                    success:
                        false,

                    error:
                        "ENTRY_ALREADY_EXISTS"
                });
            }

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

            if (
                !entryId
            ) {

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
                        "INVALID_TXID"
                });
            }

            if (
                !mongoConnected
            ) {

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

            if (
                !player
            ) {

                return res.status(404).json({

                    success:
                        false,

                    error:
                        "ENTRY_NOT_FOUND"
                });
            }

            if (
                player.paymentStatus ===
                "paid"
            ) {

                return res.json({

                    success:
                        true,

                    status:
                        "paid",

                    message:
                        "Cette entrée est déjà validée."
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
                    "TXID enregistré."
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

app.post(
    "/api/verify-payment",
    async (req, res) => {

        let txid = "";

        try {

            const entryId =
                cleanString(
                    req.body.entryId,
                    100
                );

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
                req.body.amount;

            txid =
                cleanString(
                    req.body.txid,
                    100
                );

            if (
                !playerId
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "PLAYER_ID_REQUIRED"
                });
            }

            if (
                !isValidTxid(
                    txid
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_TXID"
                });
            }

            if (
                !mongoConnected
            ) {

                return res.status(503).json({

                    success:
                        false,

                    error:
                        "DATABASE_OFFLINE"
                });
            }

            /*
             * Empêche deux requêtes simultanées
             * avec le même TXID.
             */
            if (
                verifyingTransactions.has(
                    txid
                )
            ) {

                return res.status(409).json({

                    success:
                        false,

                    error:
                        "VERIFICATION_ALREADY_RUNNING"
                });
            }

            verifyingTransactions.add(
                txid
            );

            /* -----------------------------------------
               TROUVER / CRÉER L'ENTRÉE
            ----------------------------------------- */

            let player = null;

            /*
             * Si entryId fourni :
             * utiliser l'entrée existante.
             */
            if (
                entryId
            ) {

                player =
                    await Player.findById(
                        entryId
                    );

                if (
                    !player
                ) {

                    verifyingTransactions.delete(
                        txid
                    );

                    return res.status(404).json({

                        success:
                            false,

                        error:
                            "ENTRY_NOT_FOUND"
                    });
                }

                /*
                 * Vérifications supplémentaires.
                 */
                if (
                    player.playerId !==
                    playerId
                ) {

                    verifyingTransactions.delete(
                        txid
                    );

                    return res.status(403).json({

                        success:
                            false,

                        error:
                            "PLAYER_MISMATCH"
                    });
                }

                /*
                 * IMPORTANT :
                 *
                 * On utilise le montant stocké
                 * dans MongoDB et pas un montant
                 * fourni au moment de la vérification.
                 */
                amount =
                    player.amount;

            } else {

                /*
                 * Ancien fonctionnement :
                 * vérification directe sans create-entry.
                 */
                if (
                    !isValidBet(
                        amount
                    )
                ) {

                    verifyingTransactions.delete(
                        txid
                    );

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

                    verifyingTransactions.delete(
                        txid
                    );

                    return res.status(400).json({

                        success:
                            false,

                        error:
                            "INVALID_WALLET_ADDRESS"
                    });
                }

                /*
                 * Vérifier si le joueur existe déjà.
                 */
                player =
                    await Player.findOne({

                        playerId,

                        gameId:
                            currentGame.gameId
                    });
            }

            /*
             * Si l'entrée existe déjà payée.
             */
            if (
                player &&
                player.paymentStatus ===
                "paid"
            ) {

                verifyingTransactions.delete(
                    txid
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

                    gameId:
                        player.gameId,

                    amount:
                        player.amount,

                    transactionHash:
                        player.transactionHash,

                    message:
                        "Paiement déjà validé."
                });
            }

            /*
             * Si on a une entrée existante,
             * utiliser son wallet.
             */
            const walletToVerify =
                player &&
                player.cryptoAddress
                    ? player.cryptoAddress
                    : walletAddress;

            if (
                !isValidTronAddress(
                    walletToVerify
                )
            ) {

                verifyingTransactions.delete(
                    txid
                );

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "INVALID_WALLET_ADDRESS"
                });
            }

            /*
             * Vérification blockchain.
             */
            const verification =
                await verifyBlockchainPayment({

                    txid,

                    walletAddress:
                        walletToVerify,

                    amount
                });

            if (
                !verification.valid
            ) {

                verifyingTransactions.delete(
                    txid
                );

                return res.status(400).json({

                    success:
                        false,

                    error:
                        verification.error,

                    message:
                        "Le paiement USDT TRC20 correspondant n'a pas été trouvé ou n'est pas confirmé."
                });
            }

            /*
             * Vérifier une dernière fois
             * que le TXID n'est pas utilisé.
             */
            const alreadyUsed =
                await Player.findOne({

                    transactionHash:
                        txid
                });

            if (
                alreadyUsed &&
                (
                    !player ||
                    String(
                        alreadyUsed._id
                    ) !==
                    String(
                        player._id
                    )
                )
            ) {

                verifyingTransactions.delete(
                    txid
                );

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
               CRÉER OU METTRE À JOUR
            ----------------------------------------- */

            if (
                player
            ) {

                /*
                 * Une entrée pending existe.
                 */
                player.playerName =
                    playerName ||
                    player.playerName;

                player.cryptoAddress =
                    walletToVerify;

                player.transactionHash =
                    txid;

                player.paymentStatus =
                    "paid";

                player.paidAt =
                    new Date();

                await player.save();

            } else {

                /*
                 * Entrée directe.
                 */
                try {

                    player =
                        await Player.create({

                            playerId,

                            playerName,

                            score:
                                0,

                            amount:
                                Number(
                                    Number(
                                        amount
                                    ).toFixed(6)
                                ),

                            cryptoAddress:
                                walletToVerify,

                            transactionHash:
                                txid,

                            paymentStatus:
                                "paid",

                            gameId:
                                currentGame.gameId,

                            paidAt:
                                new Date()
                        });

                } catch (error) {

                    if (
                        error.code ===
                        11000
                    ) {

                        verifyingTransactions.delete(
                            txid
                        );

                        return res.status(409).json({

                            success:
                                false,

                            error:
                                "ENTRY_ALREADY_EXISTS_OR_TX_USED"
                        });
                    }

                    throw error;
                }
            }

            /*
             * Ajouter immédiatement au cache.
             */
            scoreCache.set(
                player.playerId,
                {

                    playerId:
                        player.playerId,

                    playerName:
                        player.playerName,

                    score:
                        Number(
                            player.score || 0
                        ),

                    amount:
                        Number(
                            player.amount || 0
                        )
                }
            );

            verifyingTransactions.delete(
                txid
            );

            /*
             * Mise à jour classement.
             */
            io.emit(
                "leaderboard",
                getLeaderboardFromCache()
            );

            /*
             * Total des mises changé.
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

                gameId:
                    player.gameId,

                amount:
                    player.amount,

                transactionHash:
                    txid,

                wallet:
                    walletToVerify,

                message:
                    "Paiement USDT TRC20 confirmé. Entrée validée."
            });

        } catch (error) {

            if (
                txid
            ) {
                verifyingTransactions.delete(
                    txid
                );
            }

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
         * Timer immédiat.
         */
        socket.emit(
            "timer",
            getTimerLeft()
        );

        /*
         * Infos partie.
         */
        socket.emit(
            "gameInfo",
            {

                gameId:
                    currentGame.gameId,

                duration:
                    GAME_DURATION
            }
        );

        /*
         * Leaderboard immédiat.
         */
        socket.emit(
            "leaderboard",
            getLeaderboardFromCache()
        );

        /*
         * Nombre connecté.
         */
        socket.emit(
            "onlineCount",
            io.engine
                .clientsCount
        );

        /* =====================================================
           JOIN
        ===================================================== */

        socket.on(
            "join",
            data => {

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

                socket.data.playerId =
                    playerId;

                socket.data.playerName =
                    playerName;

                io.emit(
                    "onlineCount",
                    io.engine
                        .clientsCount
                );
            }
        );

        /* =====================================================
           JOIN PAID GAME
        ===================================================== */

        socket.on(
            "joinPaidGame",
            async data => {

                try {

                    const playerId =
                        cleanString(
                            data?.playerId,
                            100
                        );

                    const txid =
                        cleanString(
                            data?.txid,
                            100
                        );

                    if (
                        !playerId ||
                        !txid
                    ) {

                        socket.emit(
                            "paidGameRejected",
                            {

                                success:
                                    false,

                                message:
                                    "Informations de paiement manquantes."
                            }
                        );

                        return;
                    }

                    if (
                        !mongoConnected
                    ) {

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

                    /*
                     * Autorisation réelle :
                     * MongoDB + paiement paid.
                     */
                    const player =
                        await Player.findOne({

                            playerId,

                            gameId:
                                currentGame.gameId,

                            paymentStatus:
                                "paid",

                            transactionHash:
                                txid
                        });

                    if (
                        !player
                    ) {

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
                     * Autorisation socket.
                     */
                    socket.data.playerId =
                        player.playerId;

                    socket.data.playerName =
                        player.playerName;

                    socket.data.gameId =
                        currentGame.gameId;

                    socket.data.paid =
                        true;

                    socket.emit(
                        "paidGameJoined",
                        {

                            success:
                                true,

                            gameId:
                                currentGame.gameId,

                            playerId:
                                player.playerId,

                            playerName:
                                player.playerName,

                            score:
                                scoreCache.get(
                                    player.playerId
                                )?.score || 0
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

                if (
                    !msg
                ) {
                    return;
                }

                const message =
                    cleanString(
                        msg.message ||
                        msg.text ||
                        "",
                        250
                    );

                if (
                    !message
                ) {
                    return;
                }

                const playerName =
                    cleanString(
                        socket.data
                            ?.playerName ||
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
            () => {

                try {

                    /*
                     * PAS DE playerId envoyé
                     * par le navigateur.
                     *
                     * On utilise celui autorisé
                     * sur le socket.
                     */
                    const playerId =
                        socket.data
                            ?.playerId;

                    if (
                        !playerId
                    ) {
                        return;
                    }

                    /*
                     * Le joueur doit avoir
                     * payé et rejoint.
                     */
                    if (
                        socket.data
                            ?.paid !== true
                    ) {
                        return;
                    }

                    /*
                     * Vérifier la partie.
                     */
                    if (
                        socket.data.gameId !==
                        currentGame.gameId
                    ) {
                        return;
                    }

                    /*
                     * Anti-spam global par joueur.
                     */
                    const now =
                        Date.now();

                    let rate =
                        tapRateMap.get(
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

                        tapRateMap.set(
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

                    /*
                     * Trouver le joueur.
                     */
                    let player =
                        scoreCache.get(
                            playerId
                        );

                    if (
                        !player
                    ) {
                        return;
                    }

                    /*
                     * +1 TAP
                     *
                     * Le serveur ignore complètement
                     * toute valeur envoyée par le client.
                     */
                    player.score += 1;

                    dirtyPlayers.add(
                        playerId
                    );

                    /*
                     * Leaderboard throttlé.
                     */
                    scheduleLeaderboardBroadcast();

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
   TIMER PRINCIPAL
========================================================= */

setInterval(
    async () => {

        if (
            !gameInitialized
        ) {
            return;
        }

        const timer =
            getTimerLeft();

        io.emit(
            "timer",
            timer
        );

        /*
         * Partie terminée.
         */
        if (
            timer <= 0
        ) {

            const winners =
                await finalizeCurrentGame();

            /*
             * Envoyer explicitement
             * le résultat final.
             */
            io.emit(
                "finalLeaderboard",
                winners
            );

            await startNewGame();

            io.emit(
                "timer",
                GAME_DURATION
            );
        }

    },
    1000
);

/* =========================================================
   SAVE SCORES
========================================================= */

setInterval(
    async () => {

        if (
            !gameInitialized
        ) {
            return;
        }

        await saveDirtyScores();

    },
    SCORE_SAVE_INTERVAL
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

async function startServer() {

    await connectMongoDB();

    if (
        mongoConnected
    ) {

        await initializeGame();
    }

    server.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                "======================================"
            );

            console.log(
                `🚀 MILTAPE lancé sur le port ${PORT}`
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

            console.log(
                "🏆 Top gagnants :",
                TOP_WINNERS
            );

            console.log(
                "⚡ Anti-spam taps :",
                MAX_TAPS_PER_SECOND,
                "/ seconde"
            );

            console.log(
                "======================================"
            );
        }
    );
}

startServer();
