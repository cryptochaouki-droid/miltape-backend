const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json());

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

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "https://uki-droid.github.io";

const MIN_BET = 13;

const GAME_DURATION = 600; // 10 minutes

/* =========================================================
   VERIFICATION ENVIRONNEMENT
========================================================= */

if (!MONGO_URI) {
    console.error("❌ MONGO_URI manquant dans Railway");
}

if (!NOWPAYMENTS_API_KEY) {
    console.error("❌ NOWPAYMENTS_API_KEY manquant dans Railway");
}

/* =========================================================
   MONGODB
========================================================= */

mongoose.set("strictQuery", true);

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 20000,
    maxPoolSize: 10,
    minPoolSize: 1
})
.then(() => {
    console.log("✅ MongoDB connecté");
})
.catch((err) => {
    console.error("❌ Erreur MongoDB :", err.message);
});

/* =========================================================
   SCHEMA JOUEUR
========================================================= */

const playerSchema = new mongoose.Schema({

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

    paymentId: {
        type: String,
        default: ""
    },

    paymentStatus: {
        type: String,
        default: "pending"
    },

    paid: {
        type: Boolean,
        default: false
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }

});

/*
   Un seul enregistrement par joueur et par partie.
   Cela évite de créer un document MongoDB à chaque TAP.
*/

playerSchema.index(
    { playerId: 1, roundId: 1 },
    { unique: true }
);

const Player = mongoose.model("Player", playerSchema);

/* =========================================================
   ROUND / TIMER
========================================================= */

let timerLeft = GAME_DURATION;

let roundId = Math.floor(Date.now() / 1000);

function getCurrentRoundId() {
    return roundId;
}

/* =========================================================
   OUTILS
========================================================= */

function isValidTRC20Address(address) {

    if (!address) return false;

    const value = String(address).trim();

    /*
       Adresse USDT TRC20 classique :
       commence généralement par T
       longueur 34 caractères.
    */

    return /^T[a-zA-Z0-9]{33}$/.test(value);
}

function cleanName(name) {

    if (!name) return "Anonyme";

    return String(name)
        .trim()
        .replace(/[<>]/g, "")
        .substring(0, 20);
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        project: "Miltape World Challenge",
        status: "online",
        minimumBet: MIN_BET,
        currency: "USDT TRC20",
        roundId: getCurrentRoundId()
    });

});

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {

    res.json({
        success: true,
        server: "online",
        mongodb:
            mongoose.connection.readyState === 1
                ? "connected"
                : "disconnected",
        minimumBet: MIN_BET,
        currency: "USDTTRC20",
        roundId: getCurrentRoundId(),
        timerLeft
    });

});

/* =========================================================
   CREATE NOWPAYMENTS PAYMENT
========================================================= */

app.post("/api/create-payment", async (req, res) => {

    try {

        const {
            playerId,
            playerName,
            amount,
            cryptoAddress
        } = req.body;

        if (!playerId) {

            return res.status(400).json({
                success: false,
                error: "PLAYER_ID_REQUIRED"
            });

        }

        const numericAmount = Number(amount);

        /* ===============================
           MINIMUM 13 USDT
        =============================== */

        if (
            !Number.isFinite(numericAmount) ||
            numericAmount < MIN_BET
        ) {

            return res.status(400).json({
                success: false,
                error: "MINIMUM_BET_13_USDT",
                minimum: MIN_BET
            });

        }

        /* ===============================
           ARRONDI
        =============================== */

        const finalAmount =
            Math.round(numericAmount * 100) / 100;

        /* ===============================
           VALIDATION ADRESSE GAIN
        =============================== */

        if (!isValidTRC20Address(cryptoAddress)) {

            return res.status(400).json({
                success: false,
                error: "INVALID_TRC20_ADDRESS"
            });

        }

        const safeName = cleanName(playerName);

        const currentRound = getCurrentRoundId();

        const orderId =
            `MILTAPE_${playerId}_${currentRound}_${Date.now()}`;

        /*
           IMPORTANT :

           cryptoAddress est uniquement l'adresse de retrait
           du joueur.

           Elle n'est PAS envoyée comme payout_address
           au endpoint /v1/payment.

           NOWPayments crée l'adresse de dépôt du paiement.
        */

        const paymentData = JSON.stringify({

            price_amount: finalAmount,

            price_currency: "usd",

            pay_currency: "usdttrc20",

            ipn_callback_url:
                `${BACKEND_URL_PLACEHOLDER}/api/ipn`,

            order_id: orderId,

            order_description:
                `Miltape World Challenge - ${safeName} - Mise ${finalAmount} USDT`

        });

        const options = {

            hostname: "api.nowpayments.io",

            path: "/v1/payment",

            method: "POST",

            headers: {

                "Content-Type": "application/json",

                "x-api-key": NOWPAYMENTS_API_KEY,

                "Content-Length":
                    Buffer.byteLength(paymentData)

            }

        };

        const paymentReq =
            https.request(options, (apiRes) => {

                let data = "";

                apiRes.on("data", (chunk) => {

                    data += chunk;

                });

                apiRes.on("end", async () => {

                    console.log(
                        "NOWPayments status:",
                        apiRes.statusCode
                    );

                    console.log(
                        "NOWPayments réponse:",
                        data
                    );

                    let responseJson;

                    try {

                        responseJson =
                            JSON.parse(data);

                    } catch (error) {

                        return res.status(502).json({

                            success: false,

                            error:
                                "NOWPAYMENTS_INVALID_RESPONSE"

                        });

                    }

                    if (
                        apiRes.statusCode < 200 ||
                        apiRes.statusCode >= 300
                    ) {

                        return res.status(400).json({

                            success: false,

                            error:
                                responseJson.message ||
                                responseJson.error ||
                                "NOWPAYMENTS_PAYMENT_ERROR",

                            details: responseJson

                        });

                    }

                    /*
                       NOWPayments doit normalement fournir :
                       payment_id
                       pay_address
                       pay_amount
                       pay_currency
                    */

                    if (
                        !responseJson.payment_id ||
                        !responseJson.pay_address
                    ) {

                        return res.status(500).json({

                            success: false,

                            error:
                                "NOWPAYMENTS_MISSING_PAYMENT_DATA",

                            details: responseJson

                        });

                    }

                    try {

                        await Player.findOneAndUpdate(

                            {
                                playerId,
                                roundId: currentRound
                            },

                            {

                                playerId,

                                playerName: safeName,

                                roundId: currentRound,

                                amount: finalAmount,

                                cryptoAddress,

                                paymentId:
                                    String(responseJson.payment_id),

                                paymentStatus: "waiting",

                                paid: false,

                                updatedAt: new Date()

                            },

                            {
                                upsert: true,
                                new: true,
                                setDefaultsOnInsert: true
                            }

                        );

                    } catch (dbError) {

                        console.error(
                            "Erreur sauvegarde paiement :",
                            dbError
                        );

                    }

                    return res.json({

                        success: true,

                        payment_id:
                            responseJson.payment_id,

                        pay_address:
                            responseJson.pay_address,

                        pay_amount:
                            responseJson.pay_amount,

                        pay_currency:
                            responseJson.pay_currency ||
                            "usdttrc20",

                        order_id:
                            responseJson.order_id ||
                            orderId

                    });

                });

            });

        paymentReq.on("error", (error) => {

            console.error(
                "❌ Erreur NOWPayments :",
                error
            );

            if (!res.headersSent) {

                res.status(500).json({

                    success: false,

                    error:
                        "NOWPAYMENTS_CONNECTION_ERROR"

                });

            }

        });

        paymentReq.write(paymentData);

        paymentReq.end();

    } catch (error) {

        console.error(
            "❌ /api/create-payment :",
            error
        );

        res.status(500).json({

            success: false,

            error: "SERVER_ERROR"

        });

    }

});

/* =========================================================
   PAYMENT STATUS
========================================================= */

app.get(
    "/api/payment-status/:paymentId",
    async (req, res) => {

        try {

            const paymentId =
                req.params.paymentId;

            if (!paymentId) {

                return res.status(400).json({

                    success: false,

                    error: "PAYMENT_ID_REQUIRED"

                });

            }

            const options = {

                hostname: "api.nowpayments.io",

                path:
                    `/v1/payment/${encodeURIComponent(paymentId)}`,

                method: "GET",

                headers: {

                    "x-api-key":
                        NOWPAYMENTS_API_KEY

                }

            };

            const paymentReq =
                https.request(options, (apiRes) => {

                    let data = "";

                    apiRes.on("data", (chunk) => {

                        data += chunk;

                    });

                    apiRes.on("end", async () => {

                        let result;

                        try {

                            result = JSON.parse(data);

                        } catch (error) {

                            return res.status(502).json({

                                success: false,

                                error:
                                    "INVALID_NOWPAYMENTS_RESPONSE"

                            });

                        }

                        if (
                            apiRes.statusCode < 200 ||
                            apiRes.statusCode >= 300
                        ) {

                            return res.status(400).json({

                                success: false,

                                error:
                                    result.message ||
                                    result.error ||
                                    "PAYMENT_STATUS_ERROR"

                            });

                        }

                        const status =
                            result.payment_status ||
                            "waiting";

                        /*
                           Statuts considérés comme payés.
                        */

                        const isPaid =
                            [
                                "finished",
                                "confirmed"
                            ].includes(status);

                        try {

                            await Player.updateOne(

                                {
                                    paymentId:
                                        String(paymentId)
                                },

                                {

                                    $set: {

                                        paymentStatus: status,

                                        paid: isPaid,

                                        updatedAt: new Date()

                                    }

                                }

                            );

                        } catch (dbError) {

                            console.error(
                                "Erreur update paiement :",
                                dbError
                            );

                        }

                        res.json({

                            success: true,

                            paymentId,

                            status,

                            paid: isPaid

                        });

                    });

                });

            paymentReq.on("error", (error) => {

                console.error(
                    "Erreur status NOWPayments:",
                    error
                );

                res.status(500).json({

                    success: false,

                    error:
                        "PAYMENT_STATUS_CONNECTION_ERROR"

                });

            });

            paymentReq.end();

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                error: "PAYMENT_STATUS_SERVER_ERROR"

            });

        }

    }
);

/* =========================================================
   IPN NOWPAYMENTS
========================================================= */

app.post("/api/ipn", async (req, res) => {

    try {

        console.log(
            "📩 NOWPayments IPN :",
            req.body
        );

        const data = req.body || {};

        const paymentId =
            data.payment_id
                ? String(data.payment_id)
                : null;

        const status =
            data.payment_status || "waiting";

        if (paymentId) {

            const isPaid =
                [
                    "finished",
                    "confirmed"
                ].includes(status);

            await Player.updateOne(

                {
                    paymentId
                },

                {

                    $set: {

                        paymentStatus: status,

                        paid: isPaid,

                        updatedAt: new Date()

                    }

                }

            );

        }

        res.status(200).json({
            success: true
        });

    } catch (error) {

        console.error(
            "Erreur IPN:",
            error
        );

        res.status(200).json({
            success: false
        });

    }

});

/* =========================================================
   TOTAL DES MISES
========================================================= */

app.get(
    "/api/total-stakes",
    async (req, res) => {

        try {

            const result =
                await Player.aggregate([

                    {
                        $match: {

                            roundId:
                                getCurrentRoundId(),

                            paid: true

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

            const total =
                result.length > 0
                    ? result[0].total
                    : 0;

            res.json({

                success: true,

                totalStakes:
                    Number(total.toFixed(2))

            });

        } catch (error) {

            console.error(
                "Erreur total-stakes:",
                error
            );

            res.status(500).json({

                success: false,

                error: "TOTAL_STAKES_ERROR",

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

            const playerId =
                req.params.playerId;

            const records =
                await Player.find({
                    playerId
                })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();

            const totalTaps =
                records.reduce(
                    (sum, player) =>
                        sum + (player.score || 0),
                    0
                );

            const totalUsdt =
                records.reduce(
                    (sum, player) =>
                        sum + (player.amount || 0),
                    0
                );

            res.json({

                success: true,

                totalTaps,

                totalUsdt,

                history:
                    records.map((player) => ({

                        date:
                            player.createdAt,

                        score:
                            player.score || 0,

                        amount:
                            player.amount || 0,

                        paymentStatus:
                            player.paymentStatus

                    }))

            });

        } catch (error) {

            console.error(
                "Erreur player stats:",
                error
            );

            res.status(500).json({

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

        const topPlayers =
            await Player.find({

                roundId:
                    getCurrentRoundId(),

                paid: true

            })
            .sort({ score: -1 })
            .limit(5)
            .select(
                "playerId playerName score"
            )
            .lean();

        io.emit(
            "leaderboard",
            topPlayers
        );

    } catch (error) {

        console.error(
            "Erreur leaderboard:",
            error
        );

    }

}

/* =========================================================
   TIMER
========================================================= */

setInterval(async () => {

    timerLeft--;

    if (timerLeft <= 0) {

        /*
           Nouvelle partie
        */

        timerLeft = GAME_DURATION;

        roundId =
            Math.floor(Date.now() / 1000);

        console.log(
            "🔥 NOUVELLE PARTIE :",
            roundId
        );

        io.emit(
            "newRound",
            {
                roundId,
                timerLeft
            }
        );

    }

    io.emit(
        "timer",
        timerLeft
    );

    /*
       Actualisation leaderboard toutes les secondes
       mais seulement si nécessaire.
    */

    if (timerLeft % 5 === 0) {

        await broadcastLeaderboard();

    }

}, 1000);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {

    console.log(
        "👤 Joueur connecté :",
        socket.id
    );

    socket.emit(
        "timer",
        timerLeft
    );

    socket.emit(
        "onlineCount",
        io.engine.clientsCount
    );

    socket.on("join", async (data) => {

        socket.data = data || {};

        io.emit(
            "onlineCount",
            io.engine.clientsCount
        );

        await broadcastLeaderboard();

    });

    /* ===============================
       CHAT
    =============================== */

    socket.on(
        "chatMessage",
        (msg) => {

            const name =
                cleanName(
                    msg?.playerName
                );

            const message =
                String(
                    msg?.message ||
                    msg?.text ||
                    ""
                )
                .trim()
                .substring(0, 250);

            if (!message) return;

            io.emit(
                "chatMessage",
                {

                    playerName: name,

                    message

                }
            );

        }
    );

    /* ===============================
       TAP
    =============================== */

    socket.on(
        "tap",
        async (data) => {

            try {

                if (!data?.playerId) {
                    return;
                }

                const playerId =
                    String(data.playerId);

                /*
                   On récupère le joueur payé
                   de la partie actuelle.
                */

                const player =
                    await Player.findOne({

                        playerId,

                        roundId:
                            getCurrentRoundId(),

                        paid: true

                    });

                /*
                   PAS DE PAIEMENT =
                   PAS DE TAP.
                */

                if (!player) {

                    socket.emit(
                        "tapRejected",
                        {
                            reason:
                                "PAYMENT_REQUIRED"
                        }
                    );

                    return;

                }

                /*
                   Un tap = +1.
                   On ne fait plus Player.create()
                   à chaque clic.
                */

                await Player.updateOne(

                    {
                        _id:
                            player._id
                    },

                    {

                        $inc: {
                            score: 1
                        },

                        $set: {
                            updatedAt:
                                new Date()
                        }

                    }

                );

                socket.emit(
                    "tapAccepted"
                );

            } catch (error) {

                console.error(
                    "Erreur tap:",
                    error
                );

            }

        }
    );

    /* ===============================
       DISCONNECT
    =============================== */

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
   START
========================================================= */

/*
   IMPORTANT :
   Le callback NOWPayments doit connaître l'URL Railway.
*/

const BACKEND_URL =
    process.env.BACKEND_URL ||
    "https://miltape-backend-production.up.railway.app";

/*
   Cette variable est utilisée dans create-payment.
*/

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Miltape lancé sur le port ${PORT}`
        );

        console.log(
            `💰 Mise minimum : ${MIN_BET} USDT`
        );

        console.log(
            `🪙 Paiement : USDT TRC20`
        );

        console.log(
            `🌐 Backend : ${BACKEND_URL}`
        );

    }
);
