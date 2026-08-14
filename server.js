const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

/* =========================================================
   CORS
========================================================= */

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

const GAME_DURATION = 600; // 10 minutes

// Adresse officielle de réception Miltape
const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

const NETWORK = "TRON";
const TOKEN = "USDT";
const CHAIN = "TRC20";

let mongoConnected = false;

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
    "MongoDB :",
    MONGO_URI ? "CONFIGURÉ" : "❌ MANQUANT"
);
console.log("======================================");

/* =========================================================
   MONGODB
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
            default: "Anonyme",
            trim: true,
            maxlength: 30
        },

        score: {
            type: Number,
            default: 0
        },

        /*
         * Mise choisie par le joueur.
         * Exemple : 1, 5, 10, 25, 100...
         */
        amount: {
            type: Number,
            default: 0
        },

        /*
         * Adresse USDT TRC20 du joueur
         */
        cryptoAddress: {
            type: String,
            default: "",
            trim: true
        },

        /*
         * Transaction blockchain
         */
        transactionHash: {
            type: String,
            default: "",
            index: true
        },

        /*
         * Statut du paiement
         *
         * pending  = paiement déclaré mais non vérifié
         * paid     = paiement vérifié
         * rejected = paiement refusé
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
            default: 1,
            index: true
        },

        createdAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        versionKey: false
    }
);

const Player = mongoose.model("Player", playerSchema);

/* =========================================================
   CONNEXION MONGODB
========================================================= */

async function connectMongoDB() {

    if (!MONGO_URI) {

        console.error(
            "❌ MONGO_URI manquant dans Railway."
        );

        console.error(
            "Railway > Variables > MONGO_URI"
        );

        return;
    }

    try {

        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });

        mongoConnected = true;

        console.log("✅ MongoDB connecté");

    } catch (error) {

        mongoConnected = false;

        console.error(
            "❌ Erreur MongoDB :",
            error.message
        );
    }
}

connectMongoDB();

/* =========================================================
   NUMÉRO DE PARTIE
========================================================= */

let gameId = 1;

/* =========================================================
   ROUTE PRINCIPALE
========================================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        app: "Miltape World Challenge",
        status: "online",
        mongo: mongoConnected,
        gameDuration: GAME_DURATION,
        gameId,
        network: NETWORK,
        token: TOKEN,
        chain: CHAIN,
        wallet: MILTAPE_WALLET,
        minimumBet: 0,
        maximumBet: null
    });
});

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {

    res.json({
        success: true,
        server: "online",
        mongo: mongoConnected,

        gameDuration: GAME_DURATION,

        gameId,

        payment: {
            token: TOKEN,
            network: NETWORK,
            chain: CHAIN,
            wallet: MILTAPE_WALLET,
            minimumBet: 0,
            maximumBet: null
        }
    });
});

/* =========================================================
   CONFIGURATION DU JEU
========================================================= */

app.get("/api/game-config", (req, res) => {

    res.json({
        success: true,

        game: {
            name: "Miltape World Challenge",
            duration: GAME_DURATION,
            gameId,
            topWinners: 5
        },

        payment: {
            token: "USDT",
            network: "TRON",
            chain: "TRC20",

            address: MILTAPE_WALLET,

            /*
             * Mise libre
             */
            minimumBet: 0,

            maximumBet: null
        }
    });
});

/* =========================================================
   TOTAL DES MISES VALIDÉES
========================================================= */

app.get("/api/total-stakes", async (req, res) => {

    try {

        if (!mongoConnected) {

            return res.json({
                success: true,
                totalStakes: 0
            });
        }

        const result = await Player.aggregate([
            {
                $match: {
                    paymentStatus: "paid"
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

        const totalStakes =
            result.length > 0
                ? Number(result[0].total || 0)
                : 0;

        res.json({
            success: true,
            totalStakes
        });

    } catch (error) {

        console.error(
            "❌ total-stakes :",
            error.message
        );

        res.status(500).json({
            success: false,
            totalStakes: 0,
            error: "TOTAL_STAKES_ERROR"
        });
    }
});

/* =========================================================
   STATISTIQUES JOUEUR
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
                String(req.params.playerId);

            const records =
                await Player
                    .find({ playerId })
                    .sort({ createdAt: -1 })
                    .lean();

            const totalTaps =
                records.reduce(
                    (sum, p) =>
                        sum + Number(p.score || 0),
                    0
                );

            const totalUsdt =
                records.reduce(
                    (sum, p) =>
                        sum + Number(
                            p.paymentStatus === "paid"
                                ? p.amount || 0
                                : 0
                        ),
                    0
                );

            res.json({
                success: true,

                totalTaps,

                totalUsdt,

                history:
                    records.map(p => ({
                        date: p.createdAt,
                        score: p.score || 0,
                        amount: p.amount || 0,
                        paymentStatus:
                            p.paymentStatus,
                        gameId:
                            p.gameId
                    }))
            });

        } catch (error) {

            console.error(
                "❌ player-stats :",
                error.message
            );

            res.status(500).json({
                success: false,
                error: "PLAYER_STATS_ERROR"
            });
        }
    }
);

/* =========================================================
   LEADERBOARD TOP 5
========================================================= */

async function broadcastLeaderboard() {

    if (!mongoConnected) {

        io.emit(
            "leaderboard",
            []
        );

        return;
    }

    try {

        const topPlayers =
            await Player.aggregate([

                {
                    $match: {
                        gameId: gameId,
                        paymentStatus: "paid"
                    }
                },

                {
                    $group: {

                        _id: "$playerId",

                        playerName: {
                            $last: "$playerName"
                        },

                        score: {
                            $sum: "$score"
                        }
                    }
                },

                {
                    $sort: {
                        score: -1
                    }
                },

                {
                    $limit: 5
                }
            ]);

        io.emit(
            "leaderboard",
            topPlayers
        );

    } catch (error) {

        console.error(
            "❌ leaderboard :",
            error.message
        );
    }
}

/* =========================================================
   ENREGISTRER UNE MISE
========================================================= */

/*
 * IMPORTANT :
 *
 * Cette route ne valide PAS la blockchain.
 *
 * Elle crée uniquement une demande de paiement
 * en statut "pending".
 *
 * Le paiement devra ensuite être vérifié
 * avant de passer à "paid".
 */

app.post(
    "/api/create-entry",
    async (req, res) => {

        try {

            const {
                playerId,
                playerName,
                amount,
                cryptoAddress,
                transactionHash
            } = req.body;

            if (!playerId) {

                return res.status(400).json({
                    success: false,
                    error: "PLAYER_ID_REQUIRED"
                });
            }

            const numericAmount =
                Number(amount);

            /*
             * Mise libre :
             * pas de minimum imposé par le jeu.
             */

            if (
                !Number.isFinite(
                    numericAmount
                ) ||
                numericAmount <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    error: "INVALID_AMOUNT"
                });
            }

            if (!cryptoAddress) {

                return res.status(400).json({
                    success: false,
                    error: "CRYPTO_ADDRESS_REQUIRED"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({
                    success: false,
                    error: "DATABASE_OFFLINE"
                });
            }

            const player =
                await Player.create({

                    playerId:
                        String(playerId),

                    playerName:
                        String(
                            playerName ||
                            "Anonyme"
                        ).substring(0, 30),

                    score: 0,

                    amount:
                        numericAmount,

                    cryptoAddress:
                        String(
                            cryptoAddress
                        ).trim(),

                    transactionHash:
                        transactionHash
                            ? String(
                                transactionHash
                            ).trim()
                            : "",

                    paymentStatus:
                        transactionHash
                            ? "pending"
                            : "pending",

                    gameId
                });

            res.json({

                success: true,

                entryId:
                    player._id,

                gameId,

                amount:
                    numericAmount,

                payment: {

                    token: TOKEN,

                    network: NETWORK,

                    chain: CHAIN,

                    address:
                        MILTAPE_WALLET,

                    status:
                        "pending"
                },

                message:
                    "Entrée créée. Le paiement doit être vérifié avant validation."
            });

        } catch (error) {

            console.error(
                "❌ create-entry :",
                error.message
            );

            res.status(500).json({

                success: false,

                error:
                    "CREATE_ENTRY_ERROR"
            });
        }
    }
);

/* =========================================================
   CONFIRMATION TRANSACTION
========================================================= */

/*
 * Le joueur peut envoyer le hash de transaction.
 *
 * ATTENTION :
 * On ne passe PAS automatiquement à "paid".
 *
 * Il faut une vérification blockchain.
 */

app.post(
    "/api/submit-transaction",
    async (req, res) => {

        try {

            const {
                entryId,
                transactionHash
            } = req.body;

            if (!entryId) {

                return res.status(400).json({
                    success: false,
                    error: "ENTRY_ID_REQUIRED"
                });
            }

            if (!transactionHash) {

                return res.status(400).json({
                    success: false,
                    error: "TRANSACTION_HASH_REQUIRED"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({
                    success: false,
                    error: "DATABASE_OFFLINE"
                });
            }

            const player =
                await Player.findById(
                    entryId
                );

            if (!player) {

                return res.status(404).json({
                    success: false,
                    error: "ENTRY_NOT_FOUND"
                });
            }

            player.transactionHash =
                String(
                    transactionHash
                ).trim();

            player.paymentStatus =
                "pending";

            await player.save();

            res.json({

                success: true,

                status: "pending",

                message:
                    "Transaction reçue. Vérification blockchain nécessaire."
            });

        } catch (error) {

            console.error(
                "❌ submit-transaction :",
                error.message
            );

            res.status(500).json({

                success: false,

                error:
                    "TRANSACTION_ERROR"
            });
        }
    }
);

/* =========================================================
   VALIDATION ADMIN D'UNE MISE
========================================================= */

/*
 * Cette route permet de valider une entrée
 * après vérification réelle du paiement.
 *
 * IMPORTANT :
 * En production, protège cette route avec
 * une authentification administrateur.
 */

app.post(
    "/api/admin/validate-payment",
    async (req, res) => {

        try {

            const {
                entryId
            } = req.body;

            if (!entryId) {

                return res.status(400).json({
                    success: false,
                    error: "ENTRY_ID_REQUIRED"
                });
            }

            if (!mongoConnected) {

                return res.status(503).json({
                    success: false,
                    error: "DATABASE_OFFLINE"
                });
            }

            const player =
                await Player.findById(
                    entryId
                );

            if (!player) {

                return res.status(404).json({
                    success: false,
                    error: "ENTRY_NOT_FOUND"
                });
            }

            player.paymentStatus =
                "paid";

            await player.save();

            await broadcastLeaderboard();

            res.json({

                success: true,

                status: "paid",

                entryId:

                    player._id
            });

        } catch (error) {

            console.error(
                "❌ validation paiement :",
                error.message
            );

            res.status(500).json({

                success: false,

                error:
                    "PAYMENT_VALIDATION_ERROR"
            });
        }
    }
);

/* =========================================================
   TIMER
========================================================= */

let timerLeft =
    GAME_DURATION;

setInterval(() => {

    timerLeft--;

    if (timerLeft <= 0) {

        /*
         * Nouvelle partie
         */

        timerLeft =
            GAME_DURATION;

        gameId++;

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

        broadcastLeaderboard();
    }

    io.emit(
        "timer",
        timerLeft
    );

}, 1000);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    (socket) => {

        console.log(
            "👤 Joueur connecté :",
            socket.id
        );

        /*
         * Envoyer immédiatement
         * les informations de jeu
         */

        socket.emit(
            "timer",
            timerLeft
        );

        socket.emit(
            "gameInfo",
            {
                gameId,
                duration:
                    GAME_DURATION
            }
        );

        socket.on(
            "join",
            async (data) => {

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

        /* =================================================
           CHAT
        ================================================= */

        socket.on(
            "chatMessage",
            (msg) => {

                if (!msg) return;

                const message =
                    String(
                        msg.message ||
                        msg.text ||
                        ""
                    )
                    .trim()
                    .substring(
                        0,
                        250
                    );

                if (!message) return;

                const playerName =
                    String(
                        msg.playerName ||
                        "Anonyme"
                    )
                    .substring(
                        0,
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

        /* =================================================
           TAP
        ================================================= */

        socket.on(
            "tap",
            async (data) => {

                try {

                    if (
                        !mongoConnected ||
                        !data ||
                        !data.playerId
                    ) {
                        return;
                    }

                    /*
                     * On n'accepte les taps
                     * que pour une entrée payée.
                     */

                    const player =
                        await Player.findOne({
                            playerId:
                                String(
                                    data.playerId
                                ),

                            gameId:
                                gameId,

                            paymentStatus:
                                "paid"
                        });

                    if (!player) {

                        /*
                         * Joueur non validé
                         */

                        return;
                    }

                    /*
                     * Toujours 1 tap par événement.
                     * On ne fait pas confiance à
                     * data.taps envoyé par le navigateur.
                     */

                    player.score += 1;

                    await player.save();

                    /*
                     * Classement temps réel
                     */

                    await broadcastLeaderboard();

                } catch (error) {

                    console.error(
                        "❌ Erreur tap :",
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
            "💰 Mise : LIBRE"
        );

        console.log(
            "🪙 Paiement : USDT TRC20"
        );

        console.log(
            "📍 Wallet :",
            MILTAPE_WALLET
        );
    }
);
