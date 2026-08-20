const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const PORT = Number(process.env.PORT) || 3000;

const GAME_DURATION_SECONDS = 10 * 60;

const USDT_CONTRACT = (
    process.env.USDT_CONTRACT ||
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
).trim();

const USDT_DECIMALS = 6;

const MONGODB_URI = (
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    ""
).trim();

const PRIVATE_KEY = (
    process.env.MILTAPE_PRIVATE_KEY ||
    ""
).trim();

const TRONGRID_API_KEY = (
    process.env.TRONGRID_API_KEY ||
    ""
).trim();

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();

let game = {
    id: null,
    status: "waiting",
    startedAt: null,
    endsAt: null,
    durationSeconds: GAME_DURATION_SECONDS
};


// ============================================================
// VÉRIFICATIONS
// ============================================================

if (!MONGODB_URI) {
    console.error("❌ MONGO_URI ou MONGODB_URI manque dans Railway.");
    process.exit(1);
}

if (!PRIVATE_KEY) {
    console.error("❌ MILTAPE_PRIVATE_KEY manque dans Railway.");
    process.exit(1);
}


// ============================================================
// TRONWEB
// ============================================================

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

    console.log("✅ TronWeb initialisé.");

} catch (error) {
    console.error(
        "❌ Erreur TronWeb :",
        error.message
    );

    process.exit(1);
}


// ============================================================
// WALLET
// ============================================================

try {
    MILTAPE_WALLET =
        TronWeb.address.fromPrivateKey(
            PRIVATE_KEY
        );

    if (!MILTAPE_WALLET) {
        throw new Error("Wallet vide.");
    }

} catch (error) {
    console.error(
        "❌ MILTAPE_PRIVATE_KEY invalide :",
        error.message
    );

    process.exit(1);
}


console.log("");
console.log("==============================================");
console.log("        MILTAPE TRON CONFIGURATION");
console.log("==============================================");
console.log(
    "💰 Wallet :",
    MILTAPE_WALLET
);
console.log(
    "💵 USDT :",
    USDT_CONTRACT
);
console.log("==============================================");
console.log("");


// ============================================================
// EXPRESS
// ============================================================

const app = express();

const server = http.createServer(app);

// 1. Sécurité des en-têtes HTTP avec Helmet
app.use(helmet());

// 2. Restriction CORS (Met ton URL Vercel)
app.use(
    cors({
        origin: "https://miltape.vercel.app",
        credentials: true
    })
);

// 3. Rate Limiting global pour éviter les attaques DDoS / Force Brute
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." }
});
app.use('/api/', limiter);

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

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// ============================================================
// MONGOOSE
// ============================================================

mongoose.set(
    "strictQuery",
    true
);


// ============================================================
// PLAYER
// ============================================================

const playerSchema = new mongoose.Schema(
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
            trim: true,
            index: true
        },

        taps: {
            type: Number,
            default: 0,
            min: 0
        },

        bet: {
            type: Number,
            default: 0,
            min: 0
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
// MESSAGE
// ============================================================

const messageSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 30
        },

        message: {
            type: String,
            required: true,
            trim: true,
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
// PAYMENT
// ============================================================

const paymentSchema = new mongoose.Schema(
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
        }
    },
    {
        timestamps: true
    }
);


const Player = mongoose.model(
    "Player",
    playerSchema
);

const Message = mongoose.model(
    "Message",
    messageSchema
);

const Payment = mongoose.model(
    "Payment",
    paymentSchema
);


// ============================================================
// MONGODB
// ============================================================

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("✅ MongoDB connecté.");
    })
    .catch((error) => {
        console.error(
            "❌ MongoDB erreur :",
            error.message
        );

        process.exit(1);
    });


// ============================================================
// UTILITAIRES
// ============================================================

function normalizeWallet(address) {
    return String(address || "").trim();
}


function isValidTronAddress(address) {

    const wallet = normalizeWallet(address);

    if (!wallet) {
        return false;
    }

    try {
        return tronWeb.isAddress(wallet);
    } catch {
        return false;
    }
}


function sameWallet(a, b) {
    return (
        normalizeWallet(a) ===
        normalizeWallet(b)
    );
}


function generateGameId() {

    return (
        "GAME-" +
        Date.now().toString(36).toUpperCase() +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()
    );
}


function getRemainingSeconds() {

    if (
        game.status !== "running" ||
        !game.endsAt
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (
                game.endsAt -
                Date.now()
            ) / 1000
        )
    );
}


// ============================================================
// LEADERBOARD
// ============================================================

async function getLeaderboard() {

    if (!game.id) {
        return [];
    }

    const players = await Player
        .find({
            gameId: game.id
        })
        .sort({
            taps: -1,
            createdAt: 1
        })
        .limit(5)
        .lean();

    return players.map((player, index) => ({
        rank: index + 1,
        name: player.name,
        wallet: player.wallet,
        taps: player.taps,
        bet: player.bet,
        paid: player.paid
    }));
}


// ============================================================
// BROADCAST
// ============================================================

async function broadcastGameState() {

    try {

        const leaderboard =
            await getLeaderboard();

        const state = {
            gameId: game.id,
            status: game.status,
            startedAt: game.startedAt,
            endsAt: game.endsAt,
            durationSeconds:
                game.durationSeconds,
            remainingSeconds:
                getRemainingSeconds(),
            onlinePlayers:
                onlineSockets.size,
            leaderboard
        };

        io.emit(
            "game:state",
            state
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
                remainingSeconds:
                    getRemainingSeconds(),

                status:
                    game.status
            }
        );

    } catch (error) {

        console.error(
            "broadcastGameState:",
            error.message
        );
    }
}


// ============================================================
// START GAME
// ============================================================

async function startGame() {

    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    game = {
        id: generateGameId(),

        status: "running",

        startedAt: Date.now(),

        endsAt:
            Date.now() +
            GAME_DURATION_SECONDS * 1000,

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

    await broadcastGameState();

    gameTimer = setInterval(
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

                if (remaining <= 0) {
                    await finishGame();
                }

            } catch (error) {

                console.error(
                    "gameTimer:",
                    error.message
                );
            }

        },
        1000
    );
}


// ============================================================
// FIN GAME
// ============================================================

async function finishGame() {

    if (game.status !== "running") {
        return;
    }

    game.status = "finished";

    if (gameTimer) {
        clearInterval(gameTimer);
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
        "🏆 Classement :",
        leaderboard
    );

    io.emit(
        "game:finished",
        {
            gameId: game.id,
            leaderboard,
            onlinePlayers:
                onlineSockets.size
        }
    );

    await broadcastGameState();

    if (nextGameTimeout) {
        clearTimeout(nextGameTimeout);
    }

    nextGameTimeout = setTimeout(
        async () => {

            nextGameTimeout = null;

            await startGame();

        },
        5000
    );
}


// ============================================================
// SOCKET
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

        await broadcastGameState();


        // ====================================================
        // JOIN
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
                        return socket.emit(
                            "error",
                            {
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
                        return socket.emit(
                            "error",
                            {
                                message:
                                    "Adresse TRON invalide."
                            }
                        );
                    }

                    if (
                        !Number.isFinite(bet) ||
                        bet <= 0
                    ) {
                        return socket.emit(
                            "error",
                            {
                                message:
                                    "Montant invalide."
                            }
                        );
                    }

                    if (
                        game.status !==
                        "running"
                    ) {
                        return socket.emit(
                            "error",
                            {
                                message:
                                    "La partie n'est pas ouverte."
                            }
                        );
                    }

                    let player =
                        await Player.findOne({
                            gameId:
                                game.id,

                            wallet
                        });

                    if (!player) {

                        player =
                            await Player.create({
                                gameId:
                                    game.id,

                                name,

                                wallet,

                                taps: 0,

                                bet,

                                paid: false
                            });

                    } else {

                        player.name = name;
                        player.bet = bet;

                        await player.save();
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
                        "player:join:",
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
                        getRemainingSeconds() <= 0
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
                        "player:tap:",
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
                        await Message.create({
                            name,
                            message,
                            gameId:
                                game.id
                        });

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
                        "chat:send:",
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

                await broadcastGameState();
            }
        );
    }
);


// ============================================================
// API ROOT
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({
            success: true,
            service:
                "Miltape World Challenge",
            status: "online",
            wallet:
                MILTAPE_WALLET,
            gameStatus:
                game.status,
            remainingSeconds:
                getRemainingSeconds(),
            onlinePlayers:
                onlineSockets.size
        });
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

            res.json({
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
            });

        } catch (error) {

            console.error(
                "/api/game:",
                error.message
            );

            res.status(500).json({
                success: false,
                message:
                    "Erreur serveur."
            });
        }
    }
);


// ============================================================
// API WALLET
// ============================================================

app.get(
    "/api/wallet",
    (req, res) => {

        res.json({
            success: true,
            wallet:
                MILTAPE_WALLET,
            usdtContract:
                USDT_CONTRACT
        });
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
                return res.status(400).json({
                    success: false,
                    message:
                        "Nom invalide."
                });
            }

            if (
                !isValidTronAddress(
                    wallet
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Adresse TRON invalide."
                });
            }

            if (
                !Number.isFinite(bet) ||
                bet <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Montant invalide."
                });
            }

            if (
                game.status !==
                "running"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "La partie n'est pas ouverte."
                });
            }

            let player =
                await Player.findOne({
                    gameId:
                        game.id,
                    wallet
                });

            if (!player) {

                player =
                    await Player.create({
                        gameId:
                            game.id,
                        name,
                        wallet,
                        taps: 0,
                        bet,
                        paid: false
                    });

            } else {

                player.name = name;
                player.bet = bet;

                await player.save();
            }

            res.json({
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
            });

        } catch (error) {

            console.error(
                "/api/join:",
                error.message
            );

            res.status(500).json({
                success: false,
                message:
                    "Erreur serveur."
            });
        }
    }
);


// ============================================================
// API PLAYER STATUS (Restauration de session)
// ============================================================

app.get(
    "/api/player/status",
    async (req, res) => {

        try {
            const playerId = String(req.query?.playerId || "").trim();
            const wallet = normalizeWallet(req.query?.wallet);

            if (!playerId && !wallet) {
                return res.status(400).json({
                    success: false,
                    message: "playerId ou wallet requis."
                });
            }

            // Recherche par ID ou par Wallet sur la partie en cours
            const query = { gameId: game.id };
            if (playerId) {
                query._id = playerId;
            } else {
                query.wallet = wallet;
            }

            const player = await Player.findOne(query);

            if (!player) {
                return res.status(404).json({
                    success: false,
                    message: "Aucun joueur trouvé pour cette partie."
                });
            }

            res.json({
                success: true,
                player: {
                    id: player._id,
                    name: player.name,
                    wallet: player.wallet,
                    taps: player.taps,
                    bet: player.bet,
                    paid: player.paid
                }
            });

        } catch (error) {
            console.error("/api/player/status:", error.message);
            res.status(500).json({
                success: false,
                message: "Erreur serveur."
            });
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
                return res.status(400).json({
                    success: false,
                    message:
                        "La partie est terminée."
                });
            }

            const playerId =
                String(
                    req.body?.playerId ||
                    ""
                ).trim();

            if (!playerId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "playerId manquant."
                });
            }

            const player =
                await Player.findById(
                    playerId
                );

            if (!player) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Joueur introuvable."
                });
            }

            if (
                player.gameId !==
                game.id
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Cette partie est terminée."
                });
            }

            if (
                getRemainingSeconds() <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Le chrono est terminé."
                });
            }

            player.taps += 1;

            await player.save();

            const leaderboard =
                await getLeaderboard();

            io.emit(
                "leaderboard:update",
                leaderboard
            );

            res.json({
                success: true,
                taps:
                    player.taps,
                leaderboard
            });

        } catch (error) {

            console.error(
                "/api/tap:",
                error.message
            );

            res.status(500).json({
                success: false,
                message:
                    "Erreur serveur."
            });
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

            res.json({
                success: true,
                leaderboard
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    "Erreur serveur."
            });
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
                    .find({
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
                    })
                    .sort({
                        createdAt: -1
                    })
                    .limit(50)
                    .lean();

            messages.reverse();

            res.json({
                success: true,
                messages
            });

        } catch (error) {

            console.error(
                "/api/chat:",
                error.message
            );

            res.status(500).json({
                success: false,
                message:
                    "Erreur serveur."
            });
        }
    }
);


// ============================================================
// VÉRIFICATION USDT
// ============================================================

async function verifyUsdtTransaction(
    txId,
    expectedFrom,
    expectedAmount
) {

    const cleanTxId =
        String(
            txId || ""
        ).trim();

    const cleanFrom =
        normalizeWallet(
            expectedFrom
        );

    const requiredAmount =
        Number(
            expectedAmount
        );

    if (!cleanTxId) {
        throw new Error(
            "Transaction ID manquant."
        );
    }

    if (
        !isValidTronAddress(
            cleanFrom
        )
    ) {
        throw new Error(
            "Adresse TRON invalide."
        );
    }

    if (
        !Number.isFinite(
            requiredAmount
        ) ||
        requiredAmount <= 0
    ) {
        throw new Error(
            "Montant invalide."
        );
    }

    const transaction =
        await tronWeb.trx.getTransaction(
            cleanTxId
        );

    if (
        !transaction ||
        !transaction.txID
    ) {
        throw new Error(
            "Transaction introuvable."
        );
    }

    const contracts =
        transaction.raw_data?.contract;

    if (
        !Array.isArray(contracts) ||
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
            "Ce n'est pas une transaction USDT TRC20."
        );
    }

    const value =
        contract.parameter?.value;

    if (!value) {
        throw new Error(
            "Données de transaction manquantes."
        );
    }

    const contractAddress =
        tronWeb.address.fromHex(
            value.contract_address
        );

    if (
        !sameWallet(
            contractAddress,
            USDT_CONTRACT
        )
    ) {
        throw new Error(
            "Ce n'est pas le contrat USDT TRON."
        );
    }

    const ownerAddress =
        tronWeb.address.fromHex(
            value.owner_address
        );

    if (
        !sameWallet(
            ownerAddress,
            cleanFrom
        )
    ) {
        throw new Error(
            "Le portefeuille ne correspond pas."
        );
    }

    const data =
        String(
            value.data || ""
        ).toLowerCase();

    if (
        !data.startsWith("a9059cbb")
    ) {
        throw new Error(
            "Ce n'est pas un transfer USDT."
        );
    }

    if (data.length < 136) {
        throw new Error(
            "Données USDT invalides."
        );
    }

    const recipientHex =
        "41" +
        data.substring(
            32,
            72
        );

    const recipient =
        tronWeb.address.fromHex(
            recipientHex
        );

    if (
        !sameWallet(
            recipient,
            MILTAPE_WALLET
        )
    ) {
        throw new Error(
            "Le paiement n'est pas destiné au wallet Miltape."
        );
    }

    const amountHex =
        data.substring(
            72,
            136
        );

    const rawAmount =
        BigInt(
            "0x" +
            amountHex
        );

    const amount =
        Number(rawAmount) /
        Math.pow(
            10,
            USDT_DECIMALS
        );

    if (
        amount <
        requiredAmount
    ) {
        throw new Error(
            `Montant insuffisant : ${amount} USDT reçu, ${requiredAmount} USDT requis.`
        );
    }

    const info =
        await tronWeb.trx.getTransactionInfo(
            cleanTxId
        );

    if (
        !info ||
        !info.receipt ||
        info.receipt.result !==
        "SUCCESS"
    ) {
        throw new Error(
            "La transaction USDT n'est pas confirmée."
        );
    }

    return {
        txId:
            cleanTxId,

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

            const txId =
                String(
                    req.body?.txId ||
                    ""
                ).trim();

            const wallet =
                normalizeWallet(
                    req.body?.wallet
                );

            const amount =
                Number(
                    req.body?.amount
                );

            const playerId =
                String(
                    req.body?.playerId ||
                    ""
                ).trim();

            if (!txId) {
                return res.status(400).json({
                    success: false,
                    verified: false,
                    message:
                        "txId manquant."
                });
            }

            const existing =
                await Payment.findOne({
                    txId
                });

            if (existing) {

                return res.json({
                    success: true,
                    verified:
                        existing.verified,
                    alreadyVerified:
                        true,
                    payment:
                        existing
                });
            }

            const result =
                await verifyUsdtTransaction(
                    txId,
                    wallet,
                    amount
                );

            const payment =
                await Payment.create({
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
                        game.id
                });

            if (playerId) {

                const player =
                    await Player.findById(
                        playerId
                    );

                if (
                    player &&
                    player.gameId ===
                    game.id
                ) {

                    player.paid = true;

                    player.paymentTxId =
                        txId;

                    await player.save();
                }
            }

            io.emit(
                "payment:verified",
                {
                    txId,
                    wallet:
                        result.from,
                    amount:
                        result.amount
                }
            );

            res.json({
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
            });

        } catch (error) {

            console.error(
                "❌ Payment verification:",
                error.message
            );

            res.status(400).json({
                success: false,
                verified: false,
                message:
                    error.message
            });
        }
    }
);


// ============================================================
// API ONLINE
// ============================================================

app.get(
    "/api/online",
    (req, res) => {

        res.json({
            success: true,
            onlinePlayers:
                onlineSockets.size
        });
    }
);


// ============================================================
// API STATUS
// ============================================================

app.get(
    "/api/status",
    (req, res) => {

        res.json({
            success: true,

            service:
                "Miltape World Challenge",

            server:
                "online",

            mongodb:
                mongoose.connection.readyState === 1
                    ? "connected"
                    : "disconnected",

            tron:
                tronWeb
                    ? "connected"
                    : "disconnected",

            wallet:
                MILTAPE_WALLET,

            game: {
                id:
                    game.id,

                status:
                    game.status,

                remainingSeconds:
                    getRemainingSeconds()
            },

            onlinePlayers:
                onlineSockets.size
        });
    }
);


// ============================================================
// 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({
            success: false,
            message:
                "Route introuvable."
        });
    }
);


// ============================================================
// ERREUR
// ============================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Express error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Erreur interne du serveur."
        });
    }
);


// ============================================================
// START
// ============================================================

server.listen(
    PORT,
    async () => {

        console.log("");
        console.log(
            "=============================================="
        );
        console.log(
            "       🚀 MILTAPE BACKEND ONLINE"
        );
        console.log(
            "=============================================="
        );

        console.log(
            "🌐 Port :",
            PORT
        );

        console.log(
            "💰 Wallet :",
            MILTAPE_WALLET
        );

        console.log(
            "💵 USDT :",
            USDT_CONTRACT
        );

        console.log(
            "🎮 Jeu : 10 minutes"
        );

        console.log(
            "🏆 Top 5"
        );

        console.log(
            "💬 Chat actif"
        );

        console.log(
            "⏱️ Chrono actif"
        );

        console.log(
            "=============================================="
        );

        try {
            await startGame();
        } catch (error) {
            console.error(
                "❌ Impossible de démarrer le jeu :",
                error.message
            );
        }
    }
);


// ============================================================
// ARRÊT PROPRE
// ============================================================

async function gracefulShutdown(signal) {

    console.log(
        `${signal} reçu...`
    );

    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }

    if (nextGameTimeout) {
        clearTimeout(nextGameTimeout);
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

    server.close(() => {

        console.log(
            "✅ Serveur arrêté."
        );

        process.exit(0);
    });

    setTimeout(() => {
        process.exit(0);
    }, 10000);
}


process.on(
    "SIGTERM",
    () => {
        gracefulShutdown("SIGTERM");
    }
);

process.on(
    "SIGINT",
    () => {
        gracefulShutdown("SIGINT");
    }
);
