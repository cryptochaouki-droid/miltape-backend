require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 3000;

const GAME_DURATION_SECONDS = 10 * 60;

const USDT_CONTRACT =
    process.env.USDT_CONTRACT ||
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MONGODB_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI;

const PRIVATE_KEY =
    (process.env.MILTAPE_PRIVATE_KEY || "").trim();

const CONFIGURED_WALLET =
    (process.env.MILTAPE_WALLET || "").trim();

const CONFIGURED_RECEIVER =
    (process.env.RECEIVER_WALLET || "").trim();

const TRONGRID_API_KEY =
    (process.env.TRONGRID_API_KEY || "").trim();


// ============================================================
// VÉRIFICATIONS ENVIRONNEMENT
// ============================================================

if (!MONGODB_URI) {
    console.error("❌ MONGO_URI / MONGODB_URI manque.");
    process.exit(1);
}

if (!PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY manque.");
    process.exit(1);
}


// ============================================================
// TRONWEB
// ============================================================

let tronWeb;

try {
    tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",

        headers: TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY": TRONGRID_API_KEY
            }
            : {},

        privateKey: PRIVATE_KEY
    });

} catch (error) {

    console.error(
        "❌ Impossible de démarrer TronWeb :",
        error.message
    );

    process.exit(1);
}


// ============================================================
// WALLET DÉRIVÉ DE LA CLÉ PRIVÉE
// ============================================================

let DERIVED_WALLET;

try {

    DERIVED_WALLET =
        TronWeb.address.fromPrivateKey(
            PRIVATE_KEY
        );

} catch (error) {

    console.error(
        "❌ Clé privée TRON invalide."
    );

    console.error(
        error.message
    );

    process.exit(1);
}


// ============================================================
// WALLET MILTAPE
// ============================================================
//
// IMPORTANT :
// Le wallet officiel est TOUJOURS celui dérivé de
// MILTAPE_PRIVATE_KEY.
//
// MILTAPE_WALLET n'est plus utilisé pour déterminer
// le wallet principal.
//
// Cela évite le problème :
// "LA CLE PRIVEE NE CORRESPOND PAS AU WALLET MILTAPE."
// ============================================================

const MILTAPE_WALLET =
    DERIVED_WALLET;


// ============================================================
// WALLET RECEVEUR DES PAIEMENTS
// ============================================================
//
// Si RECEIVER_WALLET existe, il est utilisé.
// Sinon le paiement va vers MILTAPE_WALLET.
//
// Pour ton installation actuelle, tu peux mettre
// le même wallet dans RECEIVER_WALLET.
// ============================================================

let PAYMENT_RECEIVER_WALLET;

if (CONFIGURED_RECEIVER) {

    if (
        !TronWeb.isAddress(
            CONFIGURED_RECEIVER
        )
    ) {

        console.error(
            "❌ RECEIVER_WALLET est une adresse TRON invalide."
        );

        process.exit(1);
    }

    PAYMENT_RECEIVER_WALLET =
        CONFIGURED_RECEIVER;

} else {

    PAYMENT_RECEIVER_WALLET =
        MILTAPE_WALLET;
}


// ============================================================
// INFORMATION WALLET
// ============================================================

console.log("");
console.log("==========================================");
console.log("       MILTAPE TRON CONFIGURATION");
console.log("==========================================");

console.log(
    "Wallet dérivé de MILTAPE_PRIVATE_KEY :",
    MILTAPE_WALLET
);

console.log(
    "Wallet receveur paiements :",
    PAYMENT_RECEIVER_WALLET
);

console.log(
    "Contrat USDT :",
    USDT_CONTRACT
);

console.log(
    "Durée partie :",
    GAME_DURATION_SECONDS,
    "secondes"
);

if (
    CONFIGURED_WALLET &&
    CONFIGURED_WALLET !== MILTAPE_WALLET
) {

    console.warn("");
    console.warn(
        "⚠️ MILTAPE_WALLET Railway ne correspond pas à la clé privée."
    );

    console.warn(
        "⚠️ Cette variable sera ignorée."
    );

    console.warn(
        "Wallet correct :",
        MILTAPE_WALLET
    );
}

console.log("");
console.log(
    "✅ Wallet TRON configuré correctement."
);
console.log("");


// ============================================================
// EXPRESS
// ============================================================

const app = express();

const server =
    http.createServer(app);


// ============================================================
// CORS
// ============================================================

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);


// ============================================================
// SOCKET.IO
// ============================================================

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


// ============================================================
// JEU
// ============================================================

let gameTimer = null;

let nextGameTimeout = null;

let game = {
    id: null,

    status: "waiting",

    startedAt: null,

    endsAt: null,

    durationSeconds:
        GAME_DURATION_SECONDS
};


// ============================================================
// JOUEURS EN LIGNE
// ============================================================

const onlineSockets =
    new Set();


// ============================================================
// MONGOOSE
// ============================================================

mongoose.set(
    "strictQuery",
    true
);


// ============================================================
// SCHEMA PLAYER
// ============================================================

const playerSchema =
    new mongoose.Schema(
        {
            gameId: {
                type: String,
                required: true,
                index: true
            },

            name: {
                type: String,
                required: true,
                trim: true,
                maxlength: 30
            },

            wallet: {
                type: String,
                required: true,
                trim: true
            },

            taps: {
                type: Number,
                default: 0
            },

            bet: {
                type: Number,
                default: 0
            },

            paid: {
                type: Boolean,
                default: false
            },

            paymentTxId: {
                type: String,
                default: null
            }
        },

        {
            timestamps: true
        }
    );


// ============================================================
// SCHEMA MESSAGE
// ============================================================

const messageSchema =
    new mongoose.Schema(
        {
            name: {
                type: String,
                required: true,
                maxlength: 30
            },

            message: {
                type: String,
                required: true,
                maxlength: 300
            },

            gameId: {
                type: String,
                default: null
            }
        },

        {
            timestamps: true
        }
    );


// ============================================================
// SCHEMA PAYMENT
// ============================================================

const paymentSchema =
    new mongoose.Schema(
        {
            txId: {
                type: String,
                required: true,
                unique: true,
                index: true
            },

            from: {
                type: String,
                required: true
            },

            to: {
                type: String,
                required: true
            },

            amount: {
                type: Number,
                required: true
            },

            verified: {
                type: Boolean,
                default: false
            },

            gameId: {
                type: String,
                default: null
            },

            playerName: {
                type: String,
                default: null
            }
        },

        {
            timestamps: true
        }
    );


// ============================================================
// MODELS
// ============================================================

const Player =
    mongoose.model(
        "Player",
        playerSchema
    );

const Message =
    mongoose.model(
        "Message",
        messageSchema
    );

const Payment =
    mongoose.model(
        "Payment",
        paymentSchema
    );


// ============================================================
// UTILITAIRES TRON
// ============================================================

function normalizeWallet(address) {

    return String(
        address || ""
    ).trim();
}


function isValidTronAddress(address) {

    const wallet =
        normalizeWallet(address);

    if (!wallet) {
        return false;
    }

    try {

        return TronWeb.isAddress(
            wallet
        );

    } catch {

        return false;
    }
}


function walletsEqual(
    wallet1,
    wallet2
) {

    return (
        normalizeWallet(wallet1) ===
        normalizeWallet(wallet2)
    );
}


function generateGameId() {

    return (
        Date.now().toString(36) +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 10)
    );
}


function getRemainingSeconds() {

    if (
        game.status !== "running" ||
        !game.endsAt
    ) {

        return 0;
    }

    const remaining =
        Math.ceil(
            (
                game.endsAt -
                Date.now()
            ) / 1000
        );

    return Math.max(
        0,
        remaining
    );
}


// ============================================================
// LEADERBOARD
// ============================================================

async function getLeaderboard() {

    if (!game.id) {
        return [];
    }

    const players =
        await Player
            .find({
                gameId:
                    game.id
            })
            .sort({
                taps: -1,
                createdAt: 1
            })
            .limit(5)
            .lean();

    return players.map(
        (
            player,
            index
        ) => {

            return {
                rank:
                    index + 1,

                name:
                    player.name,

                wallet:
                    player.wallet,

                taps:
                    player.taps,

                bet:
                    player.bet,

                paid:
                    player.paid
            };
        }
    );
}


// ============================================================
// BROADCAST ÉTAT
// ============================================================

async function broadcastGameState() {

    try {

        const leaderboard =
            await getLeaderboard();

        const remainingSeconds =
            getRemainingSeconds();

        io.emit(
            "game:state",
            {
                gameId:
                    game.id,

                status:
                    game.status,

                startedAt:
                    game.startedAt,

                endsAt:
                    game.endsAt,

                durationSeconds:
                    game.durationSeconds,

                remainingSeconds,

                onlinePlayers:
                    onlineSockets.size,

                leaderboard
            }
        );

        io.emit(
            "online:count",
            onlineSockets.size
        );

        io.emit(
            "leaderboard:update",
            leaderboard
        );

        io.emit(
            "timer:update",
            {
                remainingSeconds,

                status:
                    game.status
            }
        );

    } catch (error) {

        console.error(
            "❌ broadcastGameState:",
            error.message
        );
    }
}


// ============================================================
// DÉMARRER UNE PARTIE
// ============================================================

async function startGame() {

    if (gameTimer) {

        clearInterval(
            gameTimer
        );

        gameTimer = null;
    }

    if (nextGameTimeout) {

        clearTimeout(
            nextGameTimeout
        );

        nextGameTimeout = null;
    }


    const now =
        Date.now();

    game = {

        id:
            generateGameId(),

        status:
            "running",

        startedAt:
            now,

        endsAt:
            now +
            GAME_DURATION_SECONDS *
            1000,

        durationSeconds:
            GAME_DURATION_SECONDS
    };


    console.log("");
    console.log(
        "🎮 NOUVELLE PARTIE :",
        game.id
    );

    console.log(
        "⏱️ Durée : 10 minutes"
    );

    console.log(
        "👥 En ligne :",
        onlineSockets.size
    );

    console.log("");


    await broadcastGameState();


    gameTimer =
        setInterval(
            async () => {

                try {

                    const remaining =
                        getRemainingSeconds();

                    io.emit(
                        "timer:update",
                        {
                            remainingSeconds:
                                remaining,

                            status:
                                game.status
                        }
                    );

                    if (
                        remaining <= 0
                    ) {

                        await finishGame();
                    }

                } catch (error) {

                    console.error(
                        "❌ Game timer:",
                        error.message
                    );
                }

            },
            1000
        );
}


// ============================================================
// FIN PARTIE
// ============================================================

async function finishGame() {

    if (
        game.status !==
        "running"
    ) {

        return;
    }


    game.status =
        "finished";


    if (gameTimer) {

        clearInterval(
            gameTimer
        );

        gameTimer = null;
    }


    const leaderboard =
        await getLeaderboard();


    console.log("");
    console.log(
        "🏁 PARTIE TERMINÉE :",
        game.id
    );

    console.log(
        "🏆 TOP 5 :",
        leaderboard
    );

    console.log("");


    io.emit(
        "game:finished",
        {
            gameId:
                game.id,

            leaderboard,

            onlinePlayers:
                onlineSockets.size
        }
    );


    await broadcastGameState();


    nextGameTimeout =
        setTimeout(
            async () => {

                await startGame();

            },
            5000
        );
}


// ============================================================
// SOCKET.IO
// ============================================================

io.on(
    "connection",
    async (socket) => {

        onlineSockets.add(
            socket.id
        );


        console.log(
            "🟢 Socket connecté :",
            socket.id
        );

        console.log(
            "👥 Joueurs en ligne :",
            onlineSockets.size
        );


        await broadcastGameState();


        // ====================================================
        // PLAYER JOIN
        // ====================================================

        socket.on(
            "player:join",
            async (data) => {

                try {

                    const name =
                        String(
                            data?.name || ""
                        )
                            .trim()
                            .substring(
                                0,
                                30
                            );

                    const wallet =
                        normalizeWallet(
                            data?.wallet
                        );

                    const bet =
                        Number(
                            data?.bet
                        );


                    if (!name) {

                        socket.emit(
                            "error",
                            {
                                message:
                                    "Nom invalide."
                            }
                        );

                        return;
                    }


                    if (
                        !isValidTronAddress(
                            wallet
                        )
                    ) {

                        socket.emit(
                            "error",
                            {
                                message:
                                    "Adresse TRON invalide."
                            }
                        );

                        return;
                    }


                    if (
                        !Number.isFinite(
                            bet
                        ) ||
                        bet <= 0
                    ) {

                        socket.emit(
                            "error",
                            {
                                message:
                                    "Montant invalide."
                            }
                        );

                        return;
                    }


                    if (
                        game.status !==
                        "running"
                    ) {

                        socket.emit(
                            "error",
                            {
                                message:
                                    "La partie n'est pas encore ouverte."
                            }
                        );

                        return;
                    }


                    let player =
                        await Player.findOne(
                            {
                                gameId:
                                    game.id,

                                wallet
                            }
                        );


                    if (player) {

                        player.name =
                            name;

                        player.bet =
                            bet;

                        await player.save();

                    } else {

                        player =
                            await Player.create(
                                {
                                    gameId:
                                        game.id,

                                    name,

                                    wallet,

                                    bet,

                                    taps: 0,

                                    paid: false
                                }
                            );
                    }


                    socket.data.playerId =
                        player._id.toString();

                    socket.data.gameId =
                        game.id;

                    socket.data.wallet =
                        wallet;

                    socket.data.name =
                        name;


                    socket.emit(
                        "player:joined",
                        {
                            success: true,

                            player: {
                                id:
                                    player._id,

                                name:
                                    player.name,

                                wallet:
                                    player.wallet,

                                taps:
                                    player.taps,

                                bet:
                                    player.bet,

                                paid:
                                    player.paid
                            }
                        }
                    );


                    await broadcastGameState();

                } catch (error) {

                    console.error(
                        "❌ player:join:",
                        error.message
                    );

                    socket.emit(
                        "error",
                        {
                            message:
                                "Impossible de rejoindre la partie."
                        }
                    );
                }
            }
        );


        // ====================================================
        // TAP
        // ====================================================

        socket.on(
            "player:tap",
            async () => {

                try {

                    if (
                        game.status !==
                        "running"
                    ) {

                        return;
                    }


                    if (
                        getRemainingSeconds() <=
                        0
                    ) {

                        return;
                    }


                    if (
                        !socket.data.playerId
                    ) {

                        return;
                    }


                    const player =
                        await Player.findById(
                            socket.data.playerId
                        );


                    if (!player) {
                        return;
                    }


                    if (
                        player.gameId !==
                        game.id
                    ) {

                        return;
                    }


                    player.taps += 1;

                    await player.save();


                    socket.emit(
                        "player:score",
                        {
                            taps:
                                player.taps
                        }
                    );


                    const leaderboard =
                        await getLeaderboard();


                    io.emit(
                        "leaderboard:update",
                        leaderboard
                    );

                } catch (error) {

                    console.error(
                        "❌ player:tap:",
                        error.message
                    );
                }
            }
        );


        // ====================================================
        // CHAT
        // ====================================================

        socket.on(
            "chat:send",
            async (data) => {

                try {

                    const name =
                        String(
                            data?.name ||
                            socket.data.name ||
                            "Joueur"
                        )
                            .trim()
                            .substring(
                                0,
                                30
                            );

                    const message =
                        String(
                            data?.message ||
                            ""
                        )
                            .trim()
                            .substring(
                                0,
                                300
                            );


                    if (!message) {
                        return;
                    }


                    const saved =
                        await Message.create(
                            {
                                name,

                                message,

                                gameId:
                                    game.id
                            }
                        );


                    io.emit(
                        "chat:message",
                        {
                            id:
                                saved._id,

                            name,

                            message,

                            createdAt:
                                saved.createdAt
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ chat:send:",
                        error.message
                    );
                }
            }
        );


        // ====================================================
        // DISCONNECT
        // ====================================================

        socket.on(
            "disconnect",
            async () => {

                onlineSockets.delete(
                    socket.id
                );


                console.log(
                    "🔴 Socket déconnecté :",
                    socket.id
                );

                console.log(
                    "👥 Joueurs en ligne :",
                    onlineSockets.size
                );


                io.emit(
                    "online:count",
                    onlineSockets.size
                );


                await broadcastGameState();
            }
        );
    }
);


// ============================================================
// API HEALTH
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json(
            {
                success: true,

                service:
                    "Miltape World Challenge",

                status:
                    "online",

                wallet:
                    MILTAPE_WALLET,

                paymentReceiver:
                    PAYMENT_RECEIVER_WALLET,

                gameStatus:
                    game.status,

                remainingSeconds:
                    getRemainingSeconds(),

                onlinePlayers:
                    onlineSockets.size
            }
        );
    }
);


// ============================================================
// API GAME
// ============================================================

app.get(
    "/api/game",
    async (req, res) => {

        try {

            const leaderboard =
                await getLeaderboard();


            res.json(
                {
                    success: true,

                    gameId:
                        game.id,

                    status:
                        game.status,

                    startedAt:
                        game.startedAt,

                    endsAt:
                        game.endsAt,

                    durationSeconds:
                        game.durationSeconds,

                    remainingSeconds:
                        getRemainingSeconds(),

                    onlinePlayers:
                        onlineSockets.size,

                    leaderboard
                }
            );

        } catch (error) {

            res.status(500).json(
                {
                    success: false,

                    message:
                        "Erreur serveur."
                }
            );
        }
    }
);


// ============================================================
// API WALLET
// ============================================================

app.get(
    "/api/wallet",
    (req, res) => {

        res.json(
            {
                success: true,

                wallet:
                    MILTAPE_WALLET,

                receiverWallet:
                    PAYMENT_RECEIVER_WALLET,

                usdtContract:
                    USDT_CONTRACT
            }
        );
    }
);


// ============================================================
// API JOIN
// ============================================================

app.post(
    "/api/join",
    async (req, res) => {

        try {

            const name =
                String(
                    req.body?.name || ""
                )
                    .trim()
                    .substring(
                        0,
                        30
                    );

            const wallet =
                normalizeWallet(
                    req.body?.wallet
                );

            const bet =
                Number(
                    req.body?.bet
                );


            if (!name) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "Nom invalide."
                    }
                );
            }


            if (
                !isValidTronAddress(
                    wallet
                )
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "Adresse TRON invalide."
                    }
                );
            }


            if (
                !Number.isFinite(bet) ||
                bet <= 0
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "Montant invalide."
                    }
                );
            }


            if (
                game.status !==
                "running"
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "La partie n'est pas ouverte."
                    }
                );
            }


            let player =
                await Player.findOne(
                    {
                        gameId:
                            game.id,

                        wallet
                    }
                );


            if (!player) {

                player =
                    await Player.create(
                        {
                            gameId:
                                game.id,

                            name,

                            wallet,

                            bet,

                            taps: 0,

                            paid: false
                        }
                    );

            } else {

                player.name =
                    name;

                player.bet =
                    bet;

                await player.save();
            }


            res.json(
                {
                    success: true,

                    player: {
                        id:
                            player._id,

                        name:
                            player.name,

                        wallet:
                            player.wallet,

                        taps:
                            player.taps,

                        bet:
                            player.bet,

                        paid:
                            player.paid
                    }
                }
            );

        } catch (error) {

            console.error(
                "❌ /api/join:",
                error.message
            );

            res.status(500).json(
                {
                    success: false,

                    message:
                        "Erreur serveur."
                }
            );
        }
    }
);


// ============================================================
// API TAP
// ============================================================

app.post(
    "/api/tap",
    async (req, res) => {

        try {

            if (
                game.status !==
                "running"
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "La partie est terminée."
                    }
                );
            }


            if (
                getRemainingSeconds() <=
                0
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "Le chrono est terminé."
                    }
                );
            }


            const playerId =
                req.body?.playerId;


            if (!playerId) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "playerId manquant."
                    }
                );
            }


            const player =
                await Player.findById(
                    playerId
                );


            if (!player) {

                return res.status(404).json(
                    {
                        success: false,

                        message:
                            "Joueur introuvable."
                    }
                );
            }


            if (
                player.gameId !==
                game.id
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        message:
                            "Cette partie est terminée."
                    }
                );
            }


            player.taps += 1;

            await player.save();


            const leaderboard =
                await getLeaderboard();


            io.emit(
                "leaderboard:update",
                leaderboard
            );


            res.json(
                {
                    success: true,

                    taps:
                        player.taps,

                    leaderboard
                }
            );

        } catch (error) {

            console.error(
                "❌ /api/tap:",
                error.message
            );

            res.status(500).json(
                {
                    success: false,

                    message:
                        "Erreur serveur."
                }
            );
        }
    }
);


// ============================================================
// API LEADERBOARD
// ============================================================

app.get(
    "/api/leaderboard",
    async (req, res) => {

        try {

            const leaderboard =
                await getLeaderboard();


            res.json(
                {
                    success: true,

                    leaderboard
                }
            );

        } catch (error) {

            res.status(500).json(
                {
                    success: false,

                    message:
                        "Erreur serveur."
                }
            );
        }
    }
);


// ============================================================
// API CHAT
// ============================================================

app.get(
    "/api/chat",
    async (req, res) => {

        try {

            const messages =
                await Message
                    .find(
                        {
                            $or: [
                                {
                                    gameId:
                                        game.id
                                },
                                {
                                    gameId:
                                        null
                                }
                            ]
                        }
                    )
                    .sort(
                        {
                            createdAt:
                                -1
                        }
                    )
                    .limit(50)
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
                "❌ /api/chat:",
                error.message
            );

            res.status(500).json(
                {
                    success: false,

                    message:
                        "Erreur serveur."
                }
            );
        }
    }
);


// ============================================================
// VÉRIFICATION PAIEMENT USDT TRC20
// ============================================================

async function verifyUsdtTransaction(
    txId,
    expectedFrom,
    expectedAmount
) {

    const wallet =
        normalizeWallet(
            expectedFrom
        );


    if (!txId) {

        throw new Error(
            "Transaction ID manquant."
        );
    }


    if (
        !isValidTronAddress(
            wallet
        )
    ) {

        throw new Error(
            "Adresse TRON du joueur invalide."
        );
    }


    const requiredAmount =
        Number(
            expectedAmount
        );


    if (
        !Number.isFinite(
            requiredAmount
        ) ||
        requiredAmount <= 0
    ) {

        throw new Error(
            "Montant du paiement invalide."
        );
    }


    // --------------------------------------------------------
    // TRANSACTION
    // --------------------------------------------------------

    const transaction =
        await tronWeb.trx.getTransaction(
            txId
        );


    if (
        !transaction ||
        !transaction.txID
    ) {

        throw new Error(
            "Transaction introuvable."
        );
    }


    if (
        transaction.txID !==
        txId
    ) {

        throw new Error(
            "Transaction invalide."
        );
    }


    // --------------------------------------------------------
    // CONTRAT
    // --------------------------------------------------------

    const contracts =
        transaction.raw_data?.contract;


    if (
        !Array.isArray(
            contracts
        ) ||
        contracts.length !== 1
    ) {

        throw new Error(
            "Transaction TRON invalide."
        );
    }


    const contract =
        contracts[0];


    if (
        contract.type !==
        "TriggerSmartContract"
    ) {

        throw new Error(
            "La transaction n'est pas un transfert USDT TRC20."
        );
    }


    const value =
        contract.parameter?.value;


    if (!value) {

        throw new Error(
            "Données de transaction manquantes."
        );
    }


    // --------------------------------------------------------
    // CONTRAT USDT
    // --------------------------------------------------------

    let contractAddress;

    try {

        contractAddress =
            tronWeb.address.fromHex(
                value.contract_address
            );

    } catch {

        throw new Error(
            "Adresse du contrat USDT invalide."
        );
    }


    if (
        !walletsEqual(
            contractAddress,
            USDT_CONTRACT
        )
    ) {

        throw new Error(
            "Ce n'est pas le contrat USDT TRON."
        );
    }


    // --------------------------------------------------------
    // EXPÉDITEUR
    // --------------------------------------------------------

    let ownerAddress;

    try {

        ownerAddress =
            tronWeb.address.fromHex(
                value.owner_address
            );

    } catch {

        throw new Error(
            "Adresse du portefeuille expéditeur invalide."
        );
    }


    if (
        !walletsEqual(
            ownerAddress,
            wallet
        )
    ) {

        throw new Error(
            "Le portefeuille de paiement ne correspond pas au joueur."
        );
    }


    // --------------------------------------------------------
    // DATA TRANSFER
    // --------------------------------------------------------

    const data =
        String(
            value.data || ""
        ).toLowerCase();


    if (
        !data.startsWith(
            "a9059cbb"
        )
    ) {

        throw new Error(
            "Ce n'est pas une opération transfer USDT."
        );
    }


    if (
        data.length <
        136
    ) {

        throw new Error(
            "Données USDT incomplètes."
        );
    }


    // --------------------------------------------------------
    // DESTINATAIRE
    // --------------------------------------------------------

    const recipientHex =
        "41" +
        data.substring(
            32,
            72
        );


    let recipient;

    try {

        recipient =
            tronWeb.address.fromHex(
                recipientHex
            );

    } catch {

        throw new Error(
            "Adresse du destinataire invalide."
        );
    }


    if (
        !walletsEqual(
            recipient,
            PAYMENT_RECEIVER_WALLET
        )
    ) {

        throw new Error(
            "Le paiement n'est pas destiné au wallet Miltape."
        );
    }


    // --------------------------------------------------------
    // MONTANT
    // --------------------------------------------------------

    const amountHex =
        data.substring(
            72,
            136
        );


    let rawAmount;

    try {

        rawAmount =
            BigInt(
                "0x" +
                amountHex
            );

    } catch {

        throw new Error(
            "Montant USDT invalide."
        );
    }


    const amount =
        Number(rawAmount) /
        Math.pow(
            10,
            USDT_DECIMALS
        );


    if (
        !Number.isFinite(
            amount
        )
    ) {

        throw new Error(
            "Montant USDT invalide."
        );
    }


    if (
        amount <
        requiredAmount
    ) {

        throw new Error(
            `Montant insuffisant : ${amount} USDT reçu, ${requiredAmount} USDT requis.`
        );
    }


    // --------------------------------------------------------
    // CONFIRMATION BLOCKCHAIN
    // --------------------------------------------------------

    const info =
        await tronWeb.trx.getTransactionInfo(
            txId
        );


    if (!info) {

        throw new Error(
            "Informations de transaction introuvables."
        );
    }


    if (
        info.receipt?.result !==
        "SUCCESS"
    ) {

        throw new Error(
            "La transaction USDT n'est pas confirmée avec succès."
        );
    }


    return {

        txId,

        from:
            ownerAddress,

        to:
            recipient,

        amount,

        confirmed:
            true
    };
}


// ============================================================
// API PAYMENT VERIFY
// ============================================================

app.post(
    "/api/payment/verify",
    async (req, res) => {

        try {

            const {
                txId,
                wallet,
                amount,
                playerId
            } = req.body;


            if (!txId) {

                return res.status(400).json(
                    {
                        success: false,

                        verified: false,

                        message:
                            "txId manquant."
                    }
                );
            }


            const expectedWallet =
                normalizeWallet(
                    wallet
                );


            if (
                !isValidTronAddress(
                    expectedWallet
                )
            ) {

                return res.status(400).json(
                    {
                        success: false,

                        verified: false,

                        message:
                            "Invalid address provided"
                    }
                );
            }


            // ------------------------------------------------
            // VÉRIFIER LE JOUEUR
            // ------------------------------------------------

            let player = null;

            if (playerId) {

                player =
                    await Player.findById(
                        playerId
                    );


                if (!player) {

                    return res.status(404).json(
                        {
                            success: false,

                            verified: false,

                            message:
                                "Joueur introuvable."
                        }
                    );
                }


                if (
                    player.gameId !==
                    game.id
                ) {

                    return res.status(400).json(
                        {
                            success: false,

                            verified: false,

                            message:
                                "La partie du joueur est terminée."
                        }
                    );
                }


                if (
                    !walletsEqual(
                        player.wallet,
                        expectedWallet
                    )
                ) {

                    return res.status(400).json(
                        {
                            success: false,

                            verified: false,

                            message:
                                "Le wallet ne correspond pas au joueur."
                        }
                    );
                }


                if (player.paid) {

                    return res.json(
                        {
                            success: true,

                            verified: true,

                            alreadyVerified: true,

                            paymentTxId:
                                player.paymentTxId
                        }
                    );
                }
            }


            // ------------------------------------------------
            // ANTI DOUBLE PAIEMENT
            // ------------------------------------------------

            const existing =
                await Payment.findOne(
                    {
                        txId
                    }
                );


            if (existing) {

                if (
                    existing.verified &&
                    walletsEqual(
                        existing.from,
                        expectedWallet
                    )
                ) {

                    if (player) {

                        player.paid =
                            true;

                        player.paymentTxId =
                            existing.txId;

                        await player.save();
                    }


                    return res.json(
                        {
                            success: true,

                            verified: true,

                            alreadyVerified: true,

                            payment: {
                                txId:
                                    existing.txId,

                                from:
                                    existing.from,

                                to:
                                    existing.to,

                                amount:
                                    existing.amount
                            }
                        }
                    );
                }


                return res.status(400).json(
                    {
                        success: false,

                        verified: false,

                        message:
                            "Cette transaction a déjà été utilisée."
                    }
                );
            }


            // ------------------------------------------------
            // VÉRIFICATION BLOCKCHAIN
            // ------------------------------------------------

            const result =
                await verifyUsdtTransaction(
                    txId,
                    expectedWallet,
                    amount
                );


            // ------------------------------------------------
            // ENREGISTRER LE PAIEMENT
            // ------------------------------------------------

            const payment =
                await Payment.create(
                    {
                        txId:
                            result.txId,

                        from:
                            result.from,

                        to:
                            result.to,

                        amount:
                            result.amount,

                        verified:
                            true,

                        gameId:
                            game.id,

                        playerName:
                            player
                                ? player.name
                                : null
                    }
                );


            // ------------------------------------------------
            // MARQUER JOUEUR PAYÉ
            // ------------------------------------------------

            if (player) {

                player.paid =
                    true;

                player.paymentTxId =
                    txId;

                await player.save();
            }


            // ------------------------------------------------
            // SOCKET PAYMENT
            // ------------------------------------------------

            io.emit(
                "payment:verified",
                {
                    txId,

                    wallet:
                        result.from,

                    amount:
                        result.amount,

                    playerId:
                        player
                            ? player._id
                            : null
                }
            );


            // ------------------------------------------------
            // RÉPONSE
            // ------------------------------------------------

            return res.json(
                {
                    success: true,

                    verified: true,

                    payment: {
                        txId:
                            result.txId,

                        from:
                            result.from,

                        to:
                            result.to,

                        amount:
                            result.amount
                    }
                }
            );

        } catch (error) {

            console.error(
                "❌ PAYMENT VERIFICATION :",
                error.message
            );


            return res.status(400).json(
                {
                    success: false,

                    verified: false,

                    message:
                        error.message ||
                        "Impossible de vérifier le paiement."
                }
            );
        }
    }
);


// ============================================================
// API ONLINE
// ============================================================

app.get(
    "/api/online",
    (req, res) => {

        res.json(
            {
                success: true,

                onlinePlayers:
                    onlineSockets.size
            }
        );
    }
);


// ============================================================
// 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json(
            {
                success: false,

                message:
                    "Route introuvable."
            }
        );
    }
);


// ============================================================
// ERREUR EXPRESS
// ============================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "❌ Express error:",
            error
        );


        res.status(500).json(
            {
                success: false,

                message:
                    "Erreur interne du serveur."
            }
        );
    }
);


// ============================================================
// DÉMARRAGE
// ============================================================

async function startServer() {

    try {

        console.log(
            "⏳ Connexion MongoDB..."
        );


        await mongoose.connect(
            MONGODB_URI
        );


        console.log(
            "✅ MongoDB connecté."
        );


        server.listen(
            PORT,
            async () => {

                console.log("");
                console.log(
                    "=========================================="
                );

                console.log(
                    "🚀 MILTAPE BACKEND DÉMARRÉ"
                );

                console.log(
                    "=========================================="
                );

                console.log(
                    "🌐 Port :",
                    PORT
                );

                console.log(
                    "💰 Wallet Miltape :",
                    MILTAPE_WALLET
                );

                console.log(
                    "💰 Wallet paiement :",
                    PAYMENT_RECEIVER_WALLET
                );

                console.log(
                    "🟢 Socket.IO actif."
                );

                console.log(
                    "💬 Chat actif."
                );

                console.log(
                    "⏱️ Chrono serveur actif."
                );

                console.log(
                    "👥 Compteur en ligne actif."
                );

                console.log("");

                await startGame();
            }
        );

    } catch (error) {

        console.error(
            "❌ ERREUR DÉMARRAGE :",
            error.message
        );

        process.exit(1);
    }
}


startServer();


// ============================================================
// ARRÊT PROPRE
// ============================================================

async function shutdown() {

    console.log(
        "🛑 Arrêt du serveur..."
    );


    if (gameTimer) {

        clearInterval(
            gameTimer
        );

        gameTimer = null;
    }


    if (nextGameTimeout) {

        clearTimeout(
            nextGameTimeout
        );

        nextGameTimeout = null;
    }


    try {

        await mongoose.connection.close();

    } catch (error) {

        console.error(
            "MongoDB fermeture :",
            error.message
        );
    }


    server.close(
        () => {

            console.log(
                "✅ Serveur arrêté."
            );

            process.exit(0);
        }
    );
}


process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);
