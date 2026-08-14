const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json({ limit: "1mb" }));

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

const PORT = process.env.PORT || 8080;

const MONGO_URI = process.env.MONGO_URI;

const NOWPAYMENTS_API_KEY =
    process.env.NOWPAYMENTS_API_KEY;

const NOWPAYMENTS_IPN_SECRET =
    process.env.NOWPAYMENTS_IPN_SECRET || "";

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "https://uki-droid.github.io";

const MIN_BET_USD = 13;

const GAME_DURATION = 600; // 10 minutes

const NOWPAYMENTS_URL =
    "https://api.nowpayments.io/v1";

/* =========================================================
   MONGODB
========================================================= */

let mongoReady = false;

if (!MONGO_URI) {
    console.error("❌ MONGO_URI manquant dans Railway.");
} else {

    mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        maxPoolSize: 10
    })
    .then(() => {
        mongoReady = true;
        console.log("✅ MongoDB connecté");
    })
    .catch((err) => {
        mongoReady = false;
        console.error("❌ Erreur MongoDB :", err.message);
    });
}

mongoose.connection.on("connected", () => {
    mongoReady = true;
    console.log("🟢 MongoDB ONLINE");
});

mongoose.connection.on("disconnected", () => {
    mongoReady = false;
    console.error("🔴 MongoDB déconnecté");
});

mongoose.connection.on("error", (err) => {
    mongoReady = false;
    console.error("❌ MongoDB erreur :", err.message);
});

/* =========================================================
   ROUND / PARTIE
========================================================= */

function getCurrentRoundId() {
    return Math.floor(Date.now() / (GAME_DURATION * 1000));
}

function getTimerLeft() {
    const elapsed =
        Math.floor(Date.now() / 1000) %
        GAME_DURATION;

    return GAME_DURATION - elapsed;
}

/* =========================================================
   PLAYER MODEL
========================================================= */

const playerSchema = new mongoose.Schema(
    {
        playerId: {
            type: String,
            required: true,
            index: true
        },

        playerName: {
            type: String,
            default: "Anonyme"
        },

        roundId: {
            type: Number,
            required: true,
            index: true
        },

        score: {
            type: Number,
            default: 0
        },

        amount: {
            type: Number,
            default: 0
        },

        cryptoAddress: {
            type: String,
            default: ""
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        }
    }
);

playerSchema.index(
    {
        roundId: 1,
        playerId: 1
    },
    {
        unique: true
    }
);

const Player =
    mongoose.models.Player ||
    mongoose.model("Player", playerSchema);

/* =========================================================
   PAYMENT MODEL
========================================================= */

const paymentSchema = new mongoose.Schema(
    {
        orderId: {
            type: String,
            unique: true,
            index: true
        },

        playerId: {
            type: String,
            index: true
        },

        playerName: {
            type: String,
            default: "Anonyme"
        },

        cryptoAddress: {
            type: String,
            default: ""
        },

        amountUsd: {
            type: Number,
            required: true
        },

        status: {
            type: String,
            default: "waiting"
        },

        invoiceId: {
            type: String,
            default: ""
        },

        invoiceUrl: {
            type: String,
            default: ""
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        paidAt: {
            type: Date,
            default: null
        }
    }
);

const Payment =
    mongoose.models.Payment ||
    mongoose.model("Payment", paymentSchema);

/* =========================================================
   API STATUS
========================================================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "Miltape World Challenge Backend",
        status: "online",
        minimumBet: MIN_BET_USD,
        currency: "USDTTRC20"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        server: "online",
        mongo: mongoReady,
        minimumBet: MIN_BET_USD
    });
});

/* =========================================================
   CREATE PAYMENT
========================================================= */

app.post("/api/create-payment", async (req, res) => {

    try {

        if (!NOWPAYMENTS_API_KEY) {
            return res.status(500).json({
                success: false,
                error: "NOWPAYMENTS_API_KEY_MISSING"
            });
        }

        const {
            playerId,
            playerName,
            cryptoAddress
        } = req.body;

        let amount = Number(req.body.amount);

        if (!Number.isFinite(amount)) {
            amount = MIN_BET_USD;
        }

        amount = Math.round(amount * 100) / 100;

        /* -----------------------------------------
           MINIMUM MILTAPE = 13 USD
        ----------------------------------------- */

        if (amount < MIN_BET_USD) {

            return res.status(400).json({
                success: false,
                error: "MINIMUM_BET",
                message:
                    `La mise minimum est de ${MIN_BET_USD} USDT.`,
                minimum: MIN_BET_USD
            });
        }

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_ID_REQUIRED"
            });
        }

        if (!playerName) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_NAME_REQUIRED"
            });
        }

        if (!cryptoAddress) {
            return res.status(400).json({
                success: false,
                error: "CRYPTO_ADDRESS_REQUIRED"
            });
        }

        const orderId =
            `MILTAPE_${playerId}_${Date.now()}`;

        /* -----------------------------------------
           SAVE PAYMENT BEFORE API CALL
        ----------------------------------------- */

        if (mongoReady) {

            await Payment.create({
                orderId,
                playerId,
                playerName,
                cryptoAddress,
                amountUsd: amount,
                status: "creating"
            });

        }

        /* -----------------------------------------
           NOWPAYMENTS INVOICE
           
           IMPORTANT :
           /v1/invoice => invoice_url
        ----------------------------------------- */

        const invoicePayload = {
            price_amount: amount,
            price_currency: "usd",

            pay_currency: "usdttrc20",

            order_id: orderId,

            order_description:
                `Miltape World Challenge - ${playerName}`,

            ipn_callback_url:
                `${process.env.BACKEND_URL || "https://miltape-backend-production.up.railway.app"}/api/ipn`,

            success_url:
                `${FRONTEND_URL}/?payment=success&order_id=${encodeURIComponent(orderId)}`,

            cancel_url:
                `${FRONTEND_URL}/?payment=cancelled&order_id=${encodeURIComponent(orderId)}`,

            partially_paid_url:
                `${FRONTEND_URL}/?payment=partial&order_id=${encodeURIComponent(orderId)}`,

            is_fixed_rate: false,

            is_fee_paid_by_user: false
        };

        console.log(
            "💳 Création paiement :",
            {
                orderId,
                amount,
                currency: "USDTTRC20"
            }
        );

        const apiResponse =
            await fetch(
                `${NOWPAYMENTS_URL}/invoice`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key":
                            NOWPAYMENTS_API_KEY
                    },

                    body:
                        JSON.stringify(invoicePayload)
                }
            );

        const rawText =
            await apiResponse.text();

        let responseData = {};

        try {
            responseData =
                JSON.parse(rawText);
        } catch {
            responseData = {
                raw: rawText
            };
        }

        console.log(
            "NOWPayments HTTP:",
            apiResponse.status
        );

        console.log(
            "NOWPayments réponse:",
            responseData
        );

        /* -----------------------------------------
           ERROR
        ----------------------------------------- */

        if (
            !apiResponse.ok ||
            !responseData.invoice_url
        ) {

            if (mongoReady) {
                await Payment.updateOne(
                    { orderId },
                    {
                        $set: {
                            status: "failed"
                        }
                    }
                );
            }

            return res.status(400).json({
                success: false,

                error:
                    responseData.message ||
                    responseData.error ||
                    "NOWPAYMENTS_ERROR",

                details:
                    responseData,

                httpStatus:
                    apiResponse.status
            });
        }

        /* -----------------------------------------
           UPDATE PAYMENT
        ----------------------------------------- */

        if (mongoReady) {

            await Payment.updateOne(
                { orderId },

                {
                    $set: {
                        status: "waiting",

                        invoiceId:
                            String(
                                responseData.id ||
                                responseData.invoice_id ||
                                ""
                            ),

                        invoiceUrl:
                            responseData.invoice_url
                    }
                }
            );
        }

        /* -----------------------------------------
           SEND TO FRONTEND
        ----------------------------------------- */

        return res.json({
            success: true,

            orderId,

            invoice_url:
                responseData.invoice_url,

            amount,

            minimum: MIN_BET_USD,

            currency: "USDTTRC20"
        });

    } catch (error) {

        console.error(
            "❌ /api/create-payment :",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "SERVER_PAYMENT_ERROR"
        });
    }
});

/* =========================================================
   PAYMENT STATUS
========================================================= */

app.get(
    "/api/payment-status/:orderId",
    async (req, res) => {

        try {

            if (!mongoReady) {

                return res.json({
                    success: false,
                    paid: false,
                    error: "MONGO_OFFLINE"
                });
            }

            const payment =
                await Payment.findOne({
                    orderId:
                        req.params.orderId
                }).lean();

            if (!payment) {

                return res.status(404).json({
                    success: false,
                    paid: false,
                    error: "PAYMENT_NOT_FOUND"
                });
            }

            const paid =
                payment.status === "finished";

            return res.json({
                success: true,
                paid,
                status: payment.status,
                amount: payment.amountUsd,
                orderId: payment.orderId
            });

        } catch (error) {

            console.error(
                "Erreur payment-status:",
                error.message
            );

            return res.status(500).json({
                success: false,
                paid: false,
                error: "PAYMENT_STATUS_ERROR"
            });
        }
    }
);

/* =========================================================
   NOWPAYMENTS IPN
========================================================= */

function sortObject(obj) {

    if (Array.isArray(obj)) {
        return obj.map(sortObject);
    }

    if (
        obj !== null &&
        typeof obj === "object"
    ) {

        return Object.keys(obj)
            .sort()
            .reduce((result, key) => {

                result[key] =
                    sortObject(obj[key]);

                return result;

            }, {});
    }

    return obj;
}

function verifyIPNSignature(
    body,
    signature
) {

    if (!NOWPAYMENTS_IPN_SECRET) {

        console.warn(
            "⚠️ NOWPAYMENTS_IPN_SECRET absent."
        );

        return true;
    }

    if (!signature) {
        return false;
    }

    const sorted =
        sortObject(body);

    const payload =
        JSON.stringify(sorted);

    const expected =
        crypto
            .createHmac(
                "sha512",
                NOWPAYMENTS_IPN_SECRET
            )
            .update(payload)
            .digest("hex");

    try {

        return crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signature)
        );

    } catch {

        return false;
    }
}

app.post("/api/ipn", async (req, res) => {

    try {

        const signature =
            req.headers["x-nowpayments-sig"];

        if (
            !verifyIPNSignature(
                req.body,
                signature
            )
        ) {

            console.error(
                "❌ IPN signature invalide"
            );

            return res.status(401).json({
                success: false
            });
        }

        console.log(
            "📩 NOWPayments IPN :",
            req.body
        );

        const orderId =
            req.body.order_id;

        const status =
            req.body.payment_status;

        if (!orderId) {
            return res.json({
                success: true
            });
        }

        if (!mongoReady) {

            console.error(
                "MongoDB offline pendant IPN"
            );

            return res.status(503).json({
                success: false
            });
        }

        const payment =
            await Payment.findOne({
                orderId
            });

        if (!payment) {

            console.error(
                "Paiement introuvable :",
                orderId
            );

            return res.json({
                success: true
            });
        }

        payment.status =
            status || payment.status;

        /* -----------------------------------------
           PAYMENT FINISHED
        ----------------------------------------- */

        if (
            status === "finished" &&
            !payment.paidAt
        ) {

            payment.paidAt =
                new Date();

            await payment.save();

            const roundId =
                getCurrentRoundId();

            await Player.updateOne(

                {
                    playerId:
                        payment.playerId,

                    roundId
                },

                {
                    $setOnInsert: {
                        playerId:
                            payment.playerId,

                        playerName:
                            payment.playerName,

                        roundId,

                        score: 0,

                        amount:
                            payment.amountUsd,

                        cryptoAddress:
                            payment.cryptoAddress,

                        createdAt:
                            new Date()
                    },

                    $set: {
                        playerName:
                            payment.playerName,

                        cryptoAddress:
                            payment.cryptoAddress,

                        updatedAt:
                            new Date()
                    }
                },

                {
                    upsert: true
                }
            );

            console.log(
                "✅ JOUEUR VALIDÉ :",
                payment.playerName,
                payment.amountUsd,
                "USDT"
            );

            io.emit(
                "paymentConfirmed",
                {
                    playerId:
                        payment.playerId,

                    orderId,

                    amount:
                        payment.amountUsd
                }
            );

            await broadcastLeaderboard();
            await broadcastTotalStakes();
        }

        await payment.save();

        return res.json({
            success: true
        });

    } catch (error) {

        console.error(
            "❌ IPN ERROR:",
            error
        );

        return res.status(500).json({
            success: false
        });
    }
});

/* =========================================================
   TOTAL STAKES
========================================================= */

async function getTotalStakes() {

    if (!mongoReady) {
        return 0;
    }

    const roundId =
        getCurrentRoundId();

    const result =
        await Player.aggregate([
            {
                $match: {
                    roundId
                }
            },

            {
                $group: {
                    _id: null,

                    total: {
                        $sum: "$amount"
                    }
                }
            }
        ]);

    return result.length
        ? Number(result[0].total || 0)
        : 0;
}

async function broadcastTotalStakes() {

    try {

        const total =
            await getTotalStakes();

        io.emit(
            "totalStakes",
            Number(total.toFixed(2))
        );

    } catch (error) {

        console.error(
            "Erreur total stakes:",
            error.message
        );
    }
}

app.get(
    "/api/total-stakes",
    async (req, res) => {

        try {

            const total =
                await getTotalStakes();

            return res.json({
                success: true,
                totalStakes:
                    Number(
                        total.toFixed(2)
                    )
            });

        } catch (error) {

            console.error(
                "Erreur total-stakes:",
                error.message
            );

            return res.json({
                success: false,
                totalStakes: 0
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

            if (!mongoReady) {

                return res.json({
                    success: false,
                    error: "MONGO_OFFLINE",
                    totalTaps: 0,
                    totalUsdt: 0
                });
            }

            const records =
                await Player
                    .find({
                        playerId:
                            req.params.playerId
                    })
                    .sort({
                        createdAt: -1
                    })
                    .lean();

            const totalTaps =
                records.reduce(
                    (sum, p) =>
                        sum +
                        Number(p.score || 0),
                    0
                );

            const totalUsdt =
                records.reduce(
                    (sum, p) =>
                        sum +
                        Number(p.amount || 0),
                    0
                );

            return res.json({
                success: true,

                totalTaps,

                totalUsdt:
                    Number(
                        totalUsdt.toFixed(2)
                    ),

                history:
                    records.map(p => ({
                        date:
                            p.createdAt,

                        score:
                            p.score || 0,

                        amount:
                            p.amount || 0
                    }))
            });

        } catch (error) {

            console.error(
                "Erreur player stats:",
                error.message
            );

            return res.status(500).json({
                success: false,
                error: "PLAYER_STATS_ERROR"
            });
        }
    }
);

/* =========================================================
   LEADERBOARD
========================================================= */

async function broadcastLeaderboard() {

    try {

        if (!mongoReady) {
            return;
        }

        const roundId =
            getCurrentRoundId();

        const topPlayers =
            await Player
                .find({
                    roundId
                })
                .sort({
                    score: -1,
                    updatedAt: 1
                })
                .limit(5)
                .lean();

        const result =
            topPlayers.map(p => ({
                playerId:
                    p.playerId,

                playerName:
                    p.playerName,

                score:
                    p.score || 0
            }));

        io.emit(
            "leaderboard",
            result
        );

    } catch (error) {

        console.error(
            "Erreur leaderboard:",
            error.message
        );
    }
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {

    console.log(
        "👤 Joueur connecté :",
        socket.id
    );

    io.emit(
        "onlineCount",
        io.engine.clientsCount
    );

    socket.emit(
        "timer",
        getTimerLeft()
    );

    socket.on("join", async (data) => {

        socket.data.playerId =
            data?.playerId || "";

        socket.data.playerName =
            data?.playerName ||
            "Anonyme";

        socket.emit(
            "timer",
            getTimerLeft()
        );

        await broadcastLeaderboard();

        await broadcastTotalStakes();
    });

    /* -----------------------------------------
       CHAT
    ----------------------------------------- */

    socket.on(
        "chatMessage",
        (msg) => {

            const playerName =
                String(
                    msg?.playerName ||
                    "Anonyme"
                ).substring(0, 30);

            const message =
                String(
                    msg?.message ||
                    msg?.text ||
                    ""
                ).substring(0, 250);

            if (!message.trim()) {
                return;
            }

            io.emit(
                "chatMessage",
                {
                    playerName,
                    message
                }
            );
        }
    );

    /* -----------------------------------------
       TAP
    ----------------------------------------- */

    socket.on(
        "tap",
        async (data) => {

            try {

                if (!mongoReady) {
                    return;
                }

                const playerId =
                    data?.playerId;

                if (!playerId) {
                    return;
                }

                const playerName =
                    String(
                        data?.playerName ||
                        "Anonyme"
                    ).substring(0, 15);

                const orderId =
                    data?.orderId;

                /* --------------------------------
                   SECURITY:
                   PAYMENT MUST BE FINISHED
                -------------------------------- */

                if (!orderId) {
                    return;
                }

                const payment =
                    await Payment.findOne({
                        orderId,
                        playerId,
                        status: "finished"
                    }).lean();

                if (!payment) {

                    console.warn(
                        "🚫 Tap refusé : paiement non validé",
                        playerId
                    );

                    return;
                }

                const roundId =
                    getCurrentRoundId();

                /* --------------------------------
                   ONE DOCUMENT PER PLAYER/ROUND
                   +1 TAP ATOMIC
                -------------------------------- */

                await Player.updateOne(

                    {
                        playerId,
                        roundId
                    },

                    {
                        $setOnInsert: {
                            playerId,
                            playerName,
                            roundId,

                            amount:
                                payment.amountUsd,

                            cryptoAddress:
                                payment.cryptoAddress,

                            createdAt:
                                new Date()
                        },

                        $set: {
                            playerName,
                            updatedAt:
                                new Date()
                        },

                        $inc: {
                            score: 1
                        }
                    },

                    {
                        upsert: true
                    }
                );

                /* --------------------------------
                   SEND PERSONAL COUNT
                -------------------------------- */

                const player =
                    await Player.findOne({
                        playerId,
                        roundId
                    }).lean();

                socket.emit(
                    "tapConfirmed",
                    {
                        score:
                            player?.score || 0
                    }
                );

                /* --------------------------------
                   LEADERBOARD
                -------------------------------- */

                await broadcastLeaderboard();

            } catch (error) {

                console.error(
                    "❌ Erreur tap:",
                    error.message
                );
            }
        }
    );

    /* -----------------------------------------
       DISCONNECT
    -------------------------------- */

    socket.on(
        "disconnect",
        () => {

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
});

/* =========================================================
   TIMER
========================================================= */

setInterval(async () => {

    const timeLeft =
        getTimerLeft();

    io.emit(
        "timer",
        timeLeft
    );

    /*
       Quand une nouvelle partie commence,
       on actualise le classement et la cagnotte.
    */

    if (timeLeft === GAME_DURATION) {

        console.log(
            "🔥 NOUVELLE PARTIE"
        );

        await broadcastLeaderboard();
        await broadcastTotalStakes();
    }

}, 1000);

/* =========================================================
   SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Miltape lancé sur le port ${PORT}`
        );

        console.log(
            `💰 Mise minimum : ${MIN_BET_USD} USD`
        );

        console.log(
            `🪙 Paiement : USDT TRC20`
        );

        console.log(
            `⏱️ Partie : ${GAME_DURATION / 60} minutes`
        );
    }
);
