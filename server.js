/* =========================================================
   MILTAPE WORLD CHALLENGE
   BACKEND RAILWAY
========================================================= */

"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");


/* =========================================================
   CONFIG
========================================================= */

const PORT =
    process.env.PORT || 8080;

const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI;

const TRONGRID_API_KEY =
    process.env.TRONGRID_API_KEY ||
    process.env.TRON_GRID_API_KEY ||
    "";

const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWY3q1NffNPM";

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MINIMUM_BET = 1;

const MAXIMUM_BET = 1000000;

const GAME_DURATION = 600;


/* =========================================================
   APP
========================================================= */

const app =
    express();

const server =
    http.createServer(app);

const io =
    new Server(
        server,
        {
            cors: {
                origin: "*",
                methods: [
                    "GET",
                    "POST"
                ]
            }
        }
    );


app.use(
    cors({
        origin: "*",
        methods: [
            "GET",
            "POST"
        ]
    })
);


app.use(
    express.json({
        limit: "1mb"
    })
);


/* =========================================================
   MONGODB
========================================================= */

if (!MONGO_URI) {

    console.error(
        "❌ MONGO_URI / MONGODB_URI MANQUANT"
    );

    process.exit(1);
}


mongoose.set(
    "strictQuery",
    true
);


/* =========================================================
   PLAYER SCHEMA
========================================================= */

const playerSchema =
    new mongoose.Schema(
        {

            playerId: {
                type: String,
                required: true,
                unique: true,
                index: true
            },

            playerName: {
                type: String,
                default: "Anonyme",
                trim: true,
                maxlength: 30
            },

            cryptoAddress: {
                type: String,
                required: true,
                index: true
            },

            gameId: {
                type: Number,
                default: 1,
                index: true
            },

            amount: {
                type: Number,
                default: 0
            },

            score: {
                type: Number,
                default: 0
            },

            paid: {
                type: Boolean,
                default: false
            },

            paymentVerified: {
                type: Boolean,
                default: false
            },

            txid: {
                type: String,
                default: "",
                unique: true,
                sparse: true,
                index: true
            },

            joined: {
                type: Boolean,
                default: false
            },

            winner: {
                type: Boolean,
                default: false
            },

            reward: {
                type: Number,
                default: 0
            },

            taps: {
                type: Number,
                default: 0
            },

            lastTapAt: {
                type: Date,
                default: null
            },

            createdAt: {
                type: Date,
                default: Date.now
            },

            updatedAt: {
                type: Date,
                default: Date.now
            }

        },
        {
            collection:
                "players"
        }
    );


const Player =
    mongoose.model(
        "Player",
        playerSchema
    );


/* =========================================================
   PAYMENT SCHEMA
========================================================= */

const paymentSchema =
    new mongoose.Schema(
        {

            txid: {
                type: String,
                required: true,
                unique: true,
                index: true
            },

            playerId: {
                type: String,
                required: true,
                index: true
            },

            playerName: {
                type: String,
                default: "Anonyme"
            },

            cryptoAddress: {
                type: String,
                required: true,
                index: true
            },

            amount: {
                type: Number,
                required: true
            },

            amountUnits: {
                type: String,
                required: true
            },

            tokenContract: {
                type: String,
                required: true
            },

            destination: {
                type: String,
                required: true
            },

            verified: {
                type: Boolean,
                default: false
            },

            verifiedAt: {
                type: Date,
                default: null
            },

            createdAt: {
                type: Date,
                default: Date.now
            }

        },
        {
            collection:
                "payments"
        }
    );


const Payment =
    mongoose.model(
        "Payment",
        paymentSchema
    );


/* =========================================================
   GAME SCHEMA
========================================================= */

const gameSchema =
    new mongoose.Schema(
        {

            gameId: {
                type: Number,
                unique: true,
                index: true
            },

            startedAt: {
                type: Date
            },

            endsAt: {
                type: Date
            },

            finished: {
                type: Boolean,
                default: false
            },

            totalStakes: {
                type: Number,
                default: 0
            },

            winners: {
                type: Array,
                default: []
            }

        },
        {
            collection:
                "games"
        }
    );


const Game =
    mongoose.model(
        "Game",
        gameSchema
    );


/* =========================================================
   CHAT SCHEMA
========================================================= */

const messageSchema =
    new mongoose.Schema(
        {

            playerId: {
                type: String,
                default: ""
            },

            playerName: {
                type: String,
                default: "Anonyme"
            },

            message: {
                type: String,
                required: true,
                maxlength: 200
            },

            createdAt: {
                type: Date,
                default: Date.now
            }

        },
        {
            collection:
                "messages"
        }
    );


const Message =
    mongoose.model(
        "Message",
        messageSchema
    );


/* =========================================================
   GAME STATE
========================================================= */

let currentGameId = 1;

let gameStartedAt =
    new Date();

let gameEndsAt =
    new Date(
        Date.now() +
        GAME_DURATION * 1000
    );

let gameRunning =
    true;

let onlinePlayers =
    new Set();


/* =========================================================
   UTILS
========================================================= */

function normalizeAddress(
    address
) {

    return String(
        address || ""
    )
        .trim()
        .toLowerCase();
}


function isValidTronAddress(
    address
) {

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(
            String(address || "")
        );
}


function sanitizeName(
    name
) {

    return String(
        name || "Anonyme"
    )
        .trim()
        .replace(
            /[\u0000-\u001F\u007F]/g,
            ""
        )
        .slice(
            0,
            30
        ) ||
        "Anonyme";
}


function sanitizeMessage(
    message
) {

    return String(
        message || ""
    )
        .trim()
        .replace(
            /[\u0000-\u001F\u007F]/g,
            ""
        )
        .slice(
            0,
            200
        );
}


/* =========================================================
   USDT → UNITS
========================================================= */

function usdtToUnits(
    amount
) {

    const value =
        Number(amount);

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        throw new Error(
            "Montant invalide."
        );
    }


    const units =
        Math.round(
            value *
            Math.pow(
                10,
                USDT_DECIMALS
            )
        );


    if (
        !Number.isSafeInteger(
            units
        )
    ) {

        throw new Error(
            "Montant trop élevé."
        );
    }


    return BigInt(
        units
    );
}


/* =========================================================
   TRONGRID HEADERS
========================================================= */

function tronGridHeaders() {

    const headers = {
        "Accept":
            "application/json"
    };


    if (TRONGRID_API_KEY) {

        headers[
            "TRON-PRO-API-KEY"
        ] =
            TRONGRID_API_KEY;
    }


    return headers;
}


/* =========================================================
   FETCH TRONGRID
========================================================= */

async function tronGridFetch(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
            {
                ...options,

                headers: {
                    ...tronGridHeaders(),
                    ...(options.headers || {})
                }
            }
        );


    const text =
        await response.text();


    let data = {};


    try {

        data =
            JSON.parse(
                text
            );

    } catch {

        data = {};
    }


    if (!response.ok) {

        throw new Error(
            `TronGrid HTTP ${response.status}`
        );
    }


    return data;
}


/* =========================================================
   VERIFY TRANSACTION BLOCKCHAIN
========================================================= */

async function verifyTronUsdtTransaction(
    txid,
    expectedFrom,
    expectedAmount
) {

    const cleanTxid =
        String(
            txid || ""
        )
            .trim();


    if (
        !/^[a-fA-F0-9]{64}$/
            .test(cleanTxid)
    ) {

        throw new Error(
            "TXID invalide."
        );
    }


    const expectedFromNormalized =
        normalizeAddress(
            expectedFrom
        );


    const expectedToNormalized =
        normalizeAddress(
            MILTAPE_WALLET
        );


    const expectedUnits =
        usdtToUnits(
            expectedAmount
        );


    /* -----------------------------------------
       TRANSACTION INFO
    ----------------------------------------- */

    let transactionInfo;


    try {

        transactionInfo =
            await tronGridFetch(
                "https://api.trongrid.io/v1/transactions/" +
                cleanTxid +
                "/events?only_confirmed=true"
            );

    } catch (error) {

        console.error(
            "TronGrid events:",
            error
        );

        throw new Error(
            "Impossible de vérifier la transaction sur TRON."
        );
    }


    const events =
        Array.isArray(
            transactionInfo?.data
        )
            ? transactionInfo.data
            : [];


    /* -----------------------------------------
       RECHERCHE TRANSFER USDT
    ----------------------------------------- */

    const transfer =
        events.find(
            event => {

                const eventName =
                    String(
                        event?.event_name ||
                        event?.name ||
                        ""
                    );


                if (
                    eventName !==
                    "Transfer"
                ) {

                    return false;
                }


                const contract =
                    normalizeAddress(
                        event?.contract_address ||
                        event?.address ||
                        ""
                    );


                if (
                    contract !==
                    expectedToNormalized
                ) {

                    return false;
                }


                const result =
                    event?.result ||
                    event?.data ||
                    {};


                const from =
                    normalizeAddress(
                        result?.from ||
                        event?.from ||
                        ""
                    );


                const to =
                    normalizeAddress(
                        result?.to ||
                        event?.to ||
                        ""
                    );


                const value =
                    String(
                        result?.value ??
                        event?.value ??
                        ""
                    );


                return (
                    from ===
                    expectedFromNormalized &&

                    to ===
                    expectedToNormalized &&

                    value ===
                    expectedUnits.toString()
                );
            }
        );


    if (!transfer) {

        throw new Error(
            "Transaction introuvable ou montant/adresse incorrect."
        );
    }


    return {
        verified:
            true,

        txid:
            cleanTxid,

        from:
            expectedFrom,

        to:
            MILTAPE_WALLET,

        amount:
            Number(expectedAmount),

        amountUnits:
            expectedUnits.toString()
    };
}


/* =========================================================
   DATABASE CONNECTION
========================================================= */

async function connectDatabase() {

    try {

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS:
                    10000
            }
        );


        console.log(
            "🟢 MongoDB connecté"
        );

    } catch (error) {

        console.error(
            "❌ MongoDB connection:",
            error
        );

        process.exit(1);
    }
}


/* =========================================================
   GAME HELPERS
========================================================= */

function getTimerLeft() {

    if (!gameRunning) {
        return 0;
    }


    return Math.max(
        0,
        Math.ceil(
            (
                gameEndsAt.getTime() -
                Date.now()
            ) / 1000
        )
    );
}


async function getCurrentPlayers() {

    return Player.find({
        gameId:
            currentGameId,

        joined:
            true,

        paymentVerified:
            true
    })
        .sort({
            score:
                -1
        })
        .lean();
}


async function getTotalStakes() {

    const result =
        await Player.aggregate([
            {
                $match: {
                    gameId:
                        currentGameId,

                    joined:
                        true,

                    paymentVerified:
                        true
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


    return Number(
        result?.[0]?.total ||
        0
    );
}


async function broadcastLeaderboard() {

    const players =
        await getCurrentPlayers();


    io.emit(
        "leaderboard",
        players
            .slice(
                0,
                5
            )
    );


    io.emit(
        "leaderboard:update",
        players
            .slice(
                0,
                5
            )
    );


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
   START NEW GAME
========================================================= */

async function startNewGame() {

    currentGameId++;

    gameStartedAt =
        new Date();

    gameEndsAt =
        new Date(
            Date.now() +
            GAME_DURATION * 1000
        );

    gameRunning =
        true;


    await Game.create({
        gameId:
            currentGameId,

        startedAt:
            gameStartedAt,

        endsAt:
            gameEndsAt,

        finished:
            false
    });


    io.emit(
        "newGame",
        {
            gameId:
                currentGameId,

            timerLeft:
                GAME_DURATION
        }
    );


    io.emit(
        "game:new",
        {
            gameId:
                currentGameId
        }
    );


    io.emit(
        "gameStart",
        {
            gameId:
                currentGameId
        }
    );


    console.log(
        "🎮 Nouvelle partie:",
        currentGameId
    );
}


/* =========================================================
   FIN GAME
========================================================= */

async function finishGame() {

    if (!gameRunning) {
        return;
    }


    gameRunning =
        false;


    const players =
        await getCurrentPlayers();


    const winners =
        players
            .slice(
                0,
                5
            );


    const winnerIds =
        winners.map(
            player =>
                player.playerId
        );


    /* -----------------------------------------
       TOP 5 = 2X LA MISE
    ----------------------------------------- */

    for (
        const player of winners
    ) {

        await Player.updateOne(
            {
                _id:
                    player._id
            },
            {
                $set: {
                    winner:
                        true,

                    reward:
                        Number(
                            player.amount ||
                            0
                        ) * 2,

                    updatedAt:
                        new Date()
                }
            }
        );
    }


    await Player.updateMany(
        {
            gameId:
                currentGameId,

            joined:
                true,

            playerId: {
                $nin:
                    winnerIds
            }
        },
        {
            $set: {
                winner:
                    false,

                reward:
                    0,

                updatedAt:
                    new Date()
            }
        }
    );


    await Game.updateOne(
        {
            gameId:
                currentGameId
        },
        {
            $set: {
                finished:
                    true,

                winners:
                    winners.map(
                        player => ({
                            playerId:
                                player.playerId,

                            playerName:
                                player.playerName,

                            score:
                                player.score,

                            amount:
                                player.amount,

                            reward:
                                Number(
                                    player.amount ||
                                    0
                                ) * 2
                        })
                    )
            }
        }
    );


    const finalWinners =
        await Player.find({
            gameId:
                currentGameId,

            joined:
                true
        })
            .sort({
                score:
                    -1
            })
            .limit(5)
            .lean();


    io.emit(
        "gameOver",
        {
            gameId:
                currentGameId,

            winners:
                finalWinners
        }
    );


    console.log(
        "🏁 Partie terminée:",
        currentGameId
    );


    setTimeout(
        startNewGame,
        3000
    );
}


/* =========================================================
   GAME TIMER
========================================================= */

setInterval(
    async () => {

        const remaining =
            getTimerLeft();


        io.emit(
            "timer",
            remaining
        );


        io.emit(
            "timer:update",
            {
                gameId:
                    currentGameId,

                timeLeft:
                    remaining
            }
        );


        if (
            gameRunning &&
            remaining <= 0
        ) {

            await finishGame();
        }

    },
    1000
);


/* =========================================================
   API HEALTH
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({
            success:
                true,

            service:
                "Miltape World Challenge Backend",

            status:
                "online"
        });
    }
);


app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success:
                true,

            mongodb:
                mongoose.connection.readyState === 1
                    ? "connected"
                    : "disconnected",

            gameId:
                currentGameId,

            gameRunning
        });
    }
);


/* =========================================================
   API STATUS
========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        try {

            const totalStakes =
                await getTotalStakes();


            res.json({
                success:
                    true,

                gameId:
                    currentGameId,

                gameRunning,

                timerLeft:
                    getTimerLeft(),

                online:
                    onlinePlayers.size,

                totalStakes
            });

        } catch (error) {

            console.error(
                "/api/status:",
                error
            );


            res.status(500)
                .json({
                    success:
                        false,

                    message:
                        "Erreur serveur."
                });
        }
    }
);


/* =========================================================
   API GAME CONFIG
========================================================= */

app.get(
    "/api/game-config",
    (req, res) => {

        res.json({
            success:
                true,

            minimumBet:
                MINIMUM_BET,

            maximumBet:
                MAXIMUM_BET,

            duration:
                GAME_DURATION,

            wallet:
                MILTAPE_WALLET,

            usdtContract:
                USDT_CONTRACT,

            decimals:
                USDT_DECIMALS
        });
    }
);


/* =========================================================
   API ONLINE
========================================================= */

app.get(
    "/api/online",
    (req, res) => {

        res.json({
            success:
                true,

            online:
                onlinePlayers.size
        });
    }
);


/* =========================================================
   API TOTAL STAKES
========================================================= */

app.get(
    "/api/total-stakes",
    async (req, res) => {

        try {

            const total =
                await getTotalStakes();


            res.json({
                success:
                    true,

                total
            });

        } catch {

            res.status(500)
                .json({
                    success:
                        false,

                    total:
                        0
                });
        }
    }
);


/* =========================================================
   API VERIFY PAYMENT
========================================================= */

app.post(
    "/api/verify-payment",
    async (req, res) => {

        try {

            const {
                playerId,
                playerName,
                txid,
                amount,
                cryptoAddress
            } = req.body;


            /* -----------------------------------------
               VALIDATION DE BASE
            ----------------------------------------- */

            if (
                !playerId ||
                !txid ||
                amount === undefined ||
                !cryptoAddress
            ) {

                return res.status(400)
                    .json({
                        success:
                            false,

                        message:
                            "Informations de paiement incomplètes."
                    });
            }


            const cleanPlayerId =
                String(
                    playerId
                )
                    .trim()
                    .slice(
                        0,
                        100
                    );


            const cleanName =
                sanitizeName(
                    playerName
                );


            const cleanAddress =
                String(
                    cryptoAddress
                )
                    .trim();


            const normalizedAddress =
                normalizeAddress(
                    cleanAddress
                );


            if (
                !isValidTronAddress(
                    cleanAddress
                )
            ) {

                return res.status(400)
                    .json({
                        success:
                            false,

                        message:
                            "Adresse TRON invalide."
                    });
            }


            const numericAmount =
                Number(amount);


            if (
                !Number.isFinite(
                    numericAmount
                ) ||
                numericAmount <
                    MINIMUM_BET ||
                numericAmount >
                    MAXIMUM_BET
            ) {

                return res.status(400)
                    .json({
                        success:
                            false,

                        message:
                            `Mise entre ${MINIMUM_BET} et ${MAXIMUM_BET} USDT.`
                    });
            }


            /* -----------------------------------------
               ANTI CHANGEMENT D'ADRESSE
            ----------------------------------------- */

            const existingPlayer =
                await Player.findOne({
                    playerId:
                        cleanPlayerId
                });


            if (existingPlayer) {

                const storedAddress =
                    normalizeAddress(
                        existingPlayer.cryptoAddress
                    );


                if (
                    storedAddress &&
                    storedAddress !==
                    normalizedAddress
                ) {

                    console.warn(
                        "🚨 CHANGEMENT WALLET BLOQUÉ",
                        {
                            playerId:
                                cleanPlayerId,

                            old:
                                existingPlayer.cryptoAddress,

                            new:
                                cleanAddress
                        }
                    );


                    return res.status(409)
                        .json({
                            success:
                                false,

                            code:
                                "WALLET_ADDRESS_CHANGED",

                            message:
                                "Cette adresse wallet est différente de celle enregistrée pour ce joueur. Paiement bloqué."
                        });
                }
            }


            /* -----------------------------------------
               TRANSACTION DEJA UTILISEE ?
            ----------------------------------------- */

            const existingPayment =
                await Payment.findOne({
                    txid:
                        String(
                            txid
                        ).trim()
                });


            if (existingPayment) {

                return res.status(409)
                    .json({
                        success:
                            false,

                        code:
                            "PAYMENT_ALREADY_USED",

                        message:
                            "Cette transaction a déjà été utilisée."
                    });
            }


            /* -----------------------------------------
               VERIFICATION BLOCKCHAIN
            ----------------------------------------- */

            let blockchainPayment;


            try {

                blockchainPayment =
                    await verifyTronUsdtTransaction(
                        txid,
                        cleanAddress,
                        numericAmount
                    );

            } catch (error) {

                console.error(
                    "Blockchain verification:",
                    error
                );


                return res.status(400)
                    .json({
                        success:
                            false,

                        message:
                            error.message ||
                            "Paiement non vérifié."
                    });
            }


            /* -----------------------------------------
               DOUBLE CONTROLE ADRESSE
            ----------------------------------------- */

            if (
                normalizeAddress(
                    blockchainPayment.from
                ) !==
                normalizedAddress
            ) {

                return res.status(403)
                    .json({
                        success:
                            false,

                        code:
                            "SENDER_ADDRESS_MISMATCH",

                        message:
                            "L'adresse réelle de la transaction ne correspond pas au wallet connecté."
                    });
            }


            if (
                normalizeAddress(
                    blockchainPayment.to
                ) !==
                normalizeAddress(
                    MILTAPE_WALLET
                )
            ) {

                return res.status(400)
                    .json({
                        success:
                            false,

                        message:
                            "La transaction n'est pas destinée au wallet Miltape."
                    });
            }


            /* -----------------------------------------
               CREATION / MISE A JOUR PLAYER
            ----------------------------------------- */

            let player;


            if (existingPlayer) {

                player =
                    existingPlayer;

                player.playerName =
                    cleanName;

                player.cryptoAddress =
                    cleanAddress;

                player.amount =
                    numericAmount;

                player.gameId =
                    currentGameId;

                player.paid =
                    true;

                player.paymentVerified =
                    true;

                player.txid =
                    String(txid).trim();

                player.joined =
                    true;

                player.updatedAt =
                    new Date();

                await player.save();

            } else {

                player =
                    await Player.create({

                        playerId:
                            cleanPlayerId,

                        playerName:
                            cleanName,

                        cryptoAddress:
                            cleanAddress,

                        gameId:
                            currentGameId,

                        amount:
                            numericAmount,

                        score:
                            0,

                        paid:
                            true,

                        paymentVerified:
                            true,

                        txid:
                            String(
                                txid
                            ).trim(),

                        joined:
                            true,

                        winner:
                            false,

                        reward:
                            0,

                        taps:
                            0
                    });
            }


            /* -----------------------------------------
               ENREGISTRER PAIEMENT
            ----------------------------------------- */

            await Payment.create({

                txid:
                    String(
                        txid
                    ).trim(),

                playerId:
                    cleanPlayerId,

                playerName:
                    cleanName,

                cryptoAddress:
                    cleanAddress,

                amount:
                    numericAmount,

                amountUnits:
                    blockchainPayment.amountUnits,

                tokenContract:
                    USDT_CONTRACT,

                destination:
                    MILTAPE_WALLET,

                verified:
                    true,

                verifiedAt:
                    new Date()
            });


            /* -----------------------------------------
               BROADCAST
            ----------------------------------------- */

            await broadcastLeaderboard();


            console.log(
                "🟢 PAIEMENT VALIDÉ",
                {
                    playerId:
                        cleanPlayerId,

                    wallet:
                        cleanAddress,

                    amount:
                        numericAmount,

                    txid
                }
            );


            return res.json({
                success:
                    true,

                message:
                    "Paiement vérifié et joueur enregistré.",

                gameId:
                    currentGameId,

                playerId:
                    cleanPlayerId,

                cryptoAddress:
                    cleanAddress,

                amount:
                    numericAmount,

                txid:
                    String(txid).trim()
            });


        } catch (error) {

            console.error(
                "/api/verify-payment:",
                error
            );


            if (
                error?.code === 11000
            ) {

                return res.status(409)
                    .json({
                        success:
                            false,

                        code:
                            "PAYMENT_ALREADY_USED",

                        message:
                            "Cette transaction existe déjà."
                    });
            }


            return res.status(500)
                .json({
                    success:
                        false,

                    message:
                        "Erreur interne pendant la vérification."
                });
        }
    }
);


/* =========================================================
   API PLAYER STATS
========================================================= */

app.get(
    "/api/player-stats/:playerId",
    async (req, res) => {

        try {

            const player =
                await Player.findOne({
                    playerId:
                        req.params.playerId
                })
                    .lean();


            if (!player) {

                return res.status(404)
                    .json({
                        success:
                            false,

                        message:
                            "Joueur introuvable."
                    });
            }


            res.json({
                success:
                    true,

                player
            });

        } catch {

            res.status(500)
                .json({
                    success:
                        false,

                    message:
                        "Erreur serveur."
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
            "🔵 Socket connecté:",
            socket.id
        );


        onlinePlayers.add(
            socket.id
        );


        io.emit(
            "onlineCount",
            onlinePlayers.size
        );


        io.emit(
            "online:count",
            {
                count:
                    onlinePlayers.size
            }
        );


        /* -----------------------------------------
           INIT GAME
        ----------------------------------------- */

        socket.emit(
            "initGame",
            {
                gameId:
                    currentGameId,

                gameRunning,

                timerLeft:
                    getTimerLeft(),

                leaderboard:
                    [],

                joined:
                    false
            }
        );


        /* -----------------------------------------
           JOIN
        ----------------------------------------- */

        socket.on(
            "join",
            async data => {

                try {

                    const {
                        playerId,
                        playerName,
                        amount,
                        cryptoAddress
                    } = data || {};


                    if (!playerId) {
                        return;
                    }


                    const player =
                        await Player.findOne({
                            playerId:
                                String(
                                    playerId
                                )
                        });


                    if (!player) {

                        socket.emit(
                            "joinError",
                            {
                                message:
                                    "Paiement requis avant de rejoindre la partie."
                            }
                        );

                        return;
                    }


                    /* ---------------------------------
                       ANTI CHANGEMENT WALLET
                    --------------------------------- */

                    if (
                        normalizeAddress(
                            player.cryptoAddress
                        ) !==
                        normalizeAddress(
                            cryptoAddress
                        )
                    ) {

                        socket.emit(
                            "joinError",
                            {
                                code:
                                    "WALLET_ADDRESS_CHANGED",

                                message:
                                    "Adresse wallet différente. Accès refusé."
                            }
                        );

                        return;
                    }


                    if (
                        !player.paymentVerified
                    ) {

                        socket.emit(
                            "joinError",
                            {
                                message:
                                    "Paiement non vérifié."
                            }
                        );

                        return;
                    }


                    player.gameId =
                        currentGameId;

                    player.playerName =
                        sanitizeName(
                            playerName ||
                            player.playerName
                        );

                    player.amount =
                        Number(
                            amount ||
                            player.amount
                        );

                    player.joined =
                        true;

                    player.updatedAt =
                        new Date();


                    await player.save();


                    socket.data.playerId =
                        player.playerId;


                    socket.join(
                        "game_" +
                        currentGameId
                    );


                    socket.emit(
                        "initGame",
                        {
                            gameId:
                                currentGameId,

                            gameRunning,

                            timerLeft:
                                getTimerLeft(),

                            joined:
                                true
                        }
                    );


                    await broadcastLeaderboard();


                } catch (error) {

                    console.error(
                        "join:",
                        error
                    );
                }
            }
        );


        /* -----------------------------------------
           TAP
        ----------------------------------------- */

        socket.on(
            "tap",
            async data => {

                try {

                    if (
                        !gameRunning
                    ) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "La partie est terminée."
                            }
                        );

                        return;
                    }


                    const playerId =
                        String(
                            data?.playerId ||
                            socket.data.playerId ||
                            ""
                        );


                    if (!playerId) {
                        return;
                    }


                    const player =
                        await Player.findOne({
                            playerId,

                            gameId:
                                currentGameId,

                            joined:
                                true,

                            paymentVerified:
                                true
                        });


                    if (!player) {

                        socket.emit(
                            "tapResult",
                            {
                                success:
                                    false,

                                message:
                                    "Joueur non autorisé."
                            }
                        );

                        return;
                    }


                    /*
                       Anti-spam serveur.
                       Environ 25 taps/s maximum.
                    */

                    const now =
                        Date.now();


                    const last =
                        player.lastTapAt
                            ? player.lastTapAt.getTime()
                            : 0;


                    if (
                        now -
                        last <
                        40
                    ) {

                        return;
                    }


                    player.score += 1;

                    player.taps += 1;

                    player.lastTapAt =
                        new Date(now);

                    player.updatedAt =
                        new Date();


                    await player.save();


                    socket.emit(
                        "tapResult",
                        {
                            success:
                                true,

                            score:
                                player.score
                        }
                    );


                    socket.emit(
                        "score:update",
                        {
                            playerId:
                                player.playerId,

                            score:
                                player.score
                        }
                    );


                    await broadcastLeaderboard();


                } catch (error) {

                    console.error(
                        "tap:",
                        error
                    );
                }
            }
        );


        /* -----------------------------------------
           CHAT
        ----------------------------------------- */

        socket.on(
            "chatMessage",
            async data => {

                try {

                    const message =
                        sanitizeMessage(
                            data?.message
                        );


                    if (!message) {
                        return;
                    }


                    const playerId =
                        String(
                            data?.playerId ||
                            socket.data.playerId ||
                            ""
                        );


                    let name =
                        sanitizeName(
                            data?.playerName
                        );


                    if (playerId) {

                        const player =
                            await Player.findOne({
                                playerId
                            })
                                .lean();


                        if (player) {

                            name =
                                player.playerName;
                        }
                    }


                    const saved =
                        await Message.create({

                            playerId,

                            playerName:
                                name,

                            message
                        });


                    const payload = {

                        playerId,

                        playerName:
                            saved.playerName,

                        message:
                            saved.message,

                        createdAt:
                            saved.createdAt
                    };


                    io.emit(
                        "chatMessage",
                        payload
                    );


                    io.emit(
                        "chat:message",
                        payload
                    );


                } catch (error) {

                    console.error(
                        "chat:",
                        error
                    );
                }
            }
        );


        /* -----------------------------------------
           DISCONNECT
        ----------------------------------------- */

        socket.on(
            "disconnect",
            () => {

                onlinePlayers.delete(
                    socket.id
                );


                io.emit(
                    "onlineCount",
                    onlinePlayers.size
                );


                io.emit(
                    "online:count",
                    {
                        count:
                            onlinePlayers.size
                    }
                );


                console.log(
                    "🔴 Socket déconnecté:",
                    socket.id
                );
            }
        );
    }
);


/* =========================================================
   START
========================================================= */

async function startServer() {

    await connectDatabase();


    const existingGame =
        await Game.findOne({
            gameId:
                currentGameId
        });


    if (!existingGame) {

        await Game.create({

            gameId:
                currentGameId,

            startedAt:
                gameStartedAt,

            endsAt:
                gameEndsAt,

            finished:
                false
        });
    }


    server.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                "======================================"
            );

            console.log(
                "🔥 MILTAPE BACKEND ONLINE"
            );

            console.log(
                "PORT:",
                PORT
            );

            console.log(
                "GAME:",
                currentGameId
            );

            console.log(
                "WALLET:",
                MILTAPE_WALLET
            );

            console.log(
                "USDT:",
                USDT_CONTRACT
            );

            console.log(
                "MIN BET:",
                MINIMUM_BET
            );

            console.log(
                "MAX BET:",
                MAXIMUM_BET
            );

            console.log(
                "DURATION:",
                GAME_DURATION,
                "seconds"
            );

            console.log(
                "======================================"
            );
        }
    );
}


startServer()
    .catch(
        error => {

            console.error(
                "❌ SERVER START ERROR:",
                error
            );

            process.exit(1);
        }
    );
