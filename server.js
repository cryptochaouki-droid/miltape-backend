/* =========================================================
   MILTAPE WORLD CHALLENGE
   BACKEND COMPLET
   Express + Socket.IO + MongoDB + TronWeb
   ========================================================= */

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");

/* =========================================================
   CONFIGURATION
   ========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "";

const MILTAPE_PRIVATE_KEY =
    process.env.MILTAPE_PRIVATE_KEY || "";

const TRONGRID_API_KEY =
    process.env.TRONGRID_API_KEY ||
    process.env.TRON_GRID_API_KEY ||
    "";

const SATURDAY_JACKPOT_PERCENT =
    Number(process.env.SATURDAY_JACKPOT_PERCENT || 5);

const GAME_DURATION = 600; // 10 minutes

const MIN_BET = 1;
const MAX_BET = 1000000;

const MAX_TAPS_PER_SECOND = 25;

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const TRON_FULL_HOST =
    "https://api.trongrid.io";


/* =========================================================
   TRONWEB
   ========================================================= */

let tronWeb = null;

let MILTAPE_WALLET = "";
let RECEIVER_WALLET = "";


/*
   IMPORTANT :

   On ne fait PLUS confiance aveuglément à
   MILTAPE_WALLET ou RECEIVER_WALLET.

   Le wallet officiel est dérivé directement
   de MILTAPE_PRIVATE_KEY.

   Cela évite :

   "LA CLE PRIVEE NE CORRESPOND PAS AU WALLET MILTAPE"
*/

function initializeTron() {

    if (!MILTAPE_PRIVATE_KEY) {
        throw new Error(
            "MILTAPE_PRIVATE_KEY manquante dans Railway."
        );
    }

    const cleanPrivateKey =
        MILTAPE_PRIVATE_KEY
            .trim()
            .replace(/^0x/i, "");

    if (!/^[a-fA-F0-9]{64}$/.test(cleanPrivateKey)) {
        throw new Error(
            "MILTAPE_PRIVATE_KEY invalide : elle doit contenir 64 caractères hexadécimaux."
        );
    }

    tronWeb = new TronWeb({
        fullHost: TRON_FULL_HOST,
        privateKey: cleanPrivateKey
    });

    const derivedWallet =
        tronWeb.address.fromPrivateKey(cleanPrivateKey);

    if (!derivedWallet) {
        throw new Error(
            "Impossible de dériver le wallet depuis MILTAPE_PRIVATE_KEY."
        );
    }

    /*
       LA SOURCE DE VERITE EST LA CLE PRIVEE.
    */

    MILTAPE_WALLET = derivedWallet;
    RECEIVER_WALLET = derivedWallet;

    /*
       On regarde seulement les anciennes variables
       pour information.

       Elles ne remplacent JAMAIS le wallet dérivé.
    */

    const configuredWallet =
        process.env.MILTAPE_WALLET || "";

    const configuredReceiver =
        process.env.RECEIVER_WALLET || "";

    console.log("");
    console.log("==============================================");
    console.log("          MILTAPE TRON CONFIGURATION");
    console.log("==============================================");

    console.log(
        "Wallet dérivé de MILTAPE_PRIVATE_KEY :",
        MILTAPE_WALLET
    );

    if (configuredWallet) {

        if (
            configuredWallet.trim() !==
            MILTAPE_WALLET
        ) {

            console.warn(
                "⚠️ MILTAPE_WALLET Railway ne correspond pas à la clé privée."
            );

            console.warn(
                "⚠️ La variable MILTAPE_WALLET sera ignorée."
            );

        } else {

            console.log(
                "✅ MILTAPE_WALLET correspond à la clé privée."
            );
        }
    }

    if (configuredReceiver) {

        if (
            configuredReceiver.trim() !==
            MILTAPE_WALLET
        ) {

            console.warn(
                "⚠️ RECEIVER_WALLET Railway ne correspond pas à la clé privée."
            );

            console.warn(
                "⚠️ La variable RECEIVER_WALLET sera ignorée."
            );

        } else {

            console.log(
                "✅ RECEIVER_WALLET correspond à la clé privée."
            );
        }
    }

    console.log(
        "Wallet utilisé par Miltape :",
        MILTAPE_WALLET
    );

    console.log(
        "Contrat USDT TRC20 :",
        USDT_CONTRACT
    );

    console.log("==============================================");
    console.log("");
}


/* =========================================================
   MONGOOSE
   ========================================================= */

mongoose.set("strictQuery", true);


/* =========================================================
   SCHEMAS
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
            required: true,
            maxlength: 30
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

        transactionHash: {
            type: String,
            default: ""
        },

        paymentStatus: {
            type: String,
            enum: [
                "pending",
                "paid",
                "rejected"
            ],
            default: "pending"
        },

        gameId: {
            type: String,
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
    }
);

const chatSchema = new mongoose.Schema(
    {
        playerId: {
            type: String,
            default: ""
        },

        playerName: {
            type: String,
            default: "Joueur"
        },

        message: {
            type: String,
            required: true,
            maxlength: 250
        },

        createdAt: {
            type: Date,
            default: Date.now,
            index: true
        }
    }
);

const gameSchema = new mongoose.Schema(
    {
        gameId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        status: {
            type: String,
            enum: [
                "waiting",
                "running",
                "finished"
            ],
            default: "running"
        },

        startsAt: {
            type: Date,
            required: true
        },

        endsAt: {
            type: Date,
            required: true
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        finishedAt: {
            type: Date,
            default: null
        },

        jackpotAmount: {
            type: Number,
            default: 0
        },

        payoutProcessed: {
            type: Boolean,
            default: false
        }
    }
);

const paymentSchema = new mongoose.Schema(
    {
        transactionHash: {
            type: String,
            unique: true,
            index: true
        },

        playerId: {
            type: String,
            index: true
        },

        gameId: {
            type: String,
            index: true
        },

        fromAddress: {
            type: String,
            default: ""
        },

        toAddress: {
            type: String,
            default: ""
        },

        amount: {
            type: Number,
            default: 0
        },

        status: {
            type: String,
            enum: [
                "pending",
                "confirmed",
                "rejected"
            ],
            default: "pending"
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        confirmedAt: {
            type: Date,
            default: null
        }
    }
);

const payoutSchema = new mongoose.Schema(
    {
        gameId: {
            type: String,
            required: true,
            index: true
        },

        playerId: {
            type: String,
            required: true,
            index: true
        },

        playerName: {
            type: String,
            default: ""
        },

        wallet: {
            type: String,
            required: true
        },

        amount: {
            type: Number,
            required: true
        },

        rank: {
            type: Number,
            required: true
        },

        status: {
            type: String,
            enum: [
                "pending",
                "processing",
                "paid",
                "failed"
            ],
            default: "pending"
        },

        txid: {
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
        },

        error: {
            type: String,
            default: ""
        }
    }
);


/* =========================================================
   MODELS
   ========================================================= */

const Player =
    mongoose.model("Player", playerSchema);

const Chat =
    mongoose.model("Chat", chatSchema);

const Game =
    mongoose.model("Game", gameSchema);

const Payment =
    mongoose.model("Payment", paymentSchema);

const Payout =
    mongoose.model("Payout", payoutSchema);


/* =========================================================
   VARIABLES SERVEUR
   ========================================================= */

let currentGame = null;

const connectedPlayers = new Map();

const tapLimiter = new Map();


/* =========================================================
   UTILITAIRES
   ========================================================= */

function generateGameId() {

    return (
        "GAME-" +
        Date.now() +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()
    );
}


function generatePlayerId() {

    return (
        "P-" +
        Date.now() +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 8)
    );
}


function isValidTronAddress(address) {

    if (!address || typeof address !== "string") {
        return false;
    }

    try {
        return tronWeb.address.isAddress(
            address.trim()
        );
    } catch (error) {
        return false;
    }
}


function normalizeAmount(value) {

    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        return null;
    }

    return amount;
}


function isSaturday() {

    return new Date().getDay() === 6;
}


/* =========================================================
   GAME
   ========================================================= */

async function getOrCreateGame() {

    const now = new Date();

    let game =
        await Game.findOne({
            status: "running",
            endsAt: {
                $gt: now
            }
        }).sort({
            createdAt: -1
        });

    if (game) {

        currentGame = game;

        return game;
    }

    /*
       Si un ancien jeu est terminé,
       on le marque terminé.
    */

    await Game.updateMany(
        {
            status: "running",
            endsAt: {
                $lte: now
            }
        },
        {
            $set: {
                status: "finished",
                finishedAt: now
            }
        }
    );

    const startsAt = now;

    const endsAt =
        new Date(
            now.getTime() +
            GAME_DURATION * 1000
        );

    game =
        await Game.create({
            gameId: generateGameId(),

            status: "running",

            startsAt,

            endsAt,

            createdAt: now
        });

    currentGame = game;

    console.log(
        "🎮 Nouveau jeu :",
        game.gameId
    );

    console.log(
        "⏱️ Début :",
        startsAt.toISOString()
    );

    console.log(
        "⏱️ Fin :",
        endsAt.toISOString()
    );

    io.emit(
        "newGame",
        {
            gameId: game.gameId,
            startsAt: game.startsAt,
            endsAt: game.endsAt
        }
    );

    io.emit(
        "game:restart",
        {
            gameId: game.gameId,
            startsAt: game.startsAt,
            endsAt: game.endsAt
        }
    );

    return game;
}


async function finishExpiredGame() {

    if (!currentGame) {
        return;
    }

    const now = new Date();

    if (
        currentGame.status === "running" &&
        now >= currentGame.endsAt
    ) {

        await Game.updateOne(
            {
                _id: currentGame._id,
                status: "running"
            },
            {
                $set: {
                    status: "finished",
                    finishedAt: now
                }
            }
        );

        currentGame.status = "finished";
        currentGame.finishedAt = now;

        io.emit(
            "gameFinished",
            {
                gameId: currentGame.gameId
            }
        );

        /*
           Le paiement automatique peut être déclenché ici.
        */

        await processTop5Payouts(
            currentGame.gameId
        );

        currentGame = null;

        await getOrCreateGame();
    }
}


/* =========================================================
   LEADERBOARD
   ========================================================= */

async function getLeaderboard(gameId) {

    return Player.find({
        gameId,
        paymentStatus: "paid"
    })
        .sort({
            score: -1,
            createdAt: 1
        })
        .limit(5)
        .lean();
}


async function broadcastLeaderboard(gameId) {

    const leaderboard =
        await getLeaderboard(gameId);

    const formatted =
        leaderboard.map(
            (player, index) => ({
                rank: index + 1,
                playerId: player.playerId,
                playerName: player.playerName,
                score: player.score,
                amount: player.amount
            })
        );

    io.emit(
        "leaderboard",
        formatted
    );

    io.emit(
        "leaderboard:update",
        formatted
    );
}


/* =========================================================
   VALIDATION PAIEMENT TRON TRC20
   ========================================================= */

async function getTransaction(txid) {

    if (!txid) {
        return null;
    }

    try {

        const transaction =
            await tronWeb.trx.getTransaction(
                txid
            );

        if (
            !transaction ||
            !transaction.txID
        ) {
            return null;
        }

        return transaction;

    } catch (error) {

        console.error(
            "Erreur récupération transaction :",
            error.message
        );

        return null;
    }
}


async function getTransactionInfo(txid) {

    try {

        return await tronWeb.trx.getTransactionInfo(
            txid
        );

    } catch (error) {

        console.error(
            "Erreur transaction info :",
            error.message
        );

        return null;
    }
}


function decodeTransferTransaction(transaction) {

    try {

        if (
            !transaction ||
            !transaction.raw_data ||
            !transaction.raw_data.contract
        ) {
            return null;
        }

        const contract =
            transaction.raw_data.contract[0];

        if (
            !contract ||
            contract.type !== "TriggerSmartContract"
        ) {
            return null;
        }

        const value =
            contract.parameter.value;

        if (!value) {
            return null;
        }

        const contractAddressHex =
            value.contract_address;

        if (!contractAddressHex) {
            return null;
        }

        let contractAddress =
            contractAddressHex;

        if (
            !contractAddress.startsWith("41")
        ) {
            contractAddress =
                "41" + contractAddress;
        }

        const contractBase58 =
            tronWeb.address.fromHex(
                contractAddress
            );

        if (
            contractBase58 !== USDT_CONTRACT
        ) {
            return null;
        }

        const data =
            value.data || "";

        /*
           transfer(address,uint256)

           4 bytes selector:
           a9059cbb

           32 bytes address
           32 bytes amount
        */

        if (
            !data.startsWith("a9059cbb")
        ) {
            return null;
        }

        const params =
            data.substring(8);

        if (params.length < 128) {
            return null;
        }

        const toHex =
            params.substring(24, 64);

        const amountHex =
            params.substring(64, 128);

        const recipientHex =
            "41" + toHex;

        const recipient =
            tronWeb.address.fromHex(
                recipientHex
            );

        const amountRaw =
            BigInt(
                "0x" + amountHex
            );

        const amount =
            Number(amountRaw) /
            Math.pow(
                10,
                USDT_DECIMALS
            );

        const ownerAddress =
            tronWeb.address.fromHex(
                value.owner_address
            );

        return {
            from: ownerAddress,
            to: recipient,
            amount,
            amountRaw: amountRaw.toString()
        };

    } catch (error) {

        console.error(
            "Erreur décodage transaction :",
            error.message
        );

        return null;
    }
}


async function verifyUsdtPayment(
    txid,
    expectedAmount
) {

    if (!txid) {

        return {
            valid: false,
            reason: "TXID manquant"
        };
    }

    const transaction =
        await getTransaction(txid);

    if (!transaction) {

        return {
            valid: false,
            reason: "Transaction introuvable"
        };
    }

    const info =
        await getTransactionInfo(txid);

    if (!info) {

        return {
            valid: false,
            reason: "Transaction non confirmée"
        };
    }

    if (
        info.receipt &&
        info.receipt.result &&
        info.receipt.result !== "SUCCESS"
    ) {

        return {
            valid: false,
            reason: "Transaction échouée"
        };
    }

    const decoded =
        decodeTransferTransaction(
            transaction
        );

    if (!decoded) {

        return {
            valid: false,
            reason:
                "Ce TXID n'est pas un transfert USDT TRC20 valide"
        };
    }

    if (
        decoded.to !== RECEIVER_WALLET
    ) {

        return {
            valid: false,
            reason:
                "Les USDT ne sont pas envoyés vers le wallet Miltape"
        };
    }

    const expected =
        Number(expectedAmount);

    if (
        decoded.amount + 0.000001 <
        expected
    ) {

        return {
            valid: false,
            reason:
                "Montant USDT insuffisant",
            received:
                decoded.amount,
            expected
        };
    }

    return {
        valid: true,

        from: decoded.from,

        to: decoded.to,

        amount: decoded.amount,

        txid
    };
}


/* =========================================================
   PAIEMENT / JOIN
   ========================================================= */

async function createPlayerEntry({
    playerId,
    playerName,
    amount,
    cryptoAddress,
    gameId
}) {

    return Player.create({
        playerId,
        playerName,
        amount,
        cryptoAddress,
        gameId,
        score: 0,
        paymentStatus: "pending"
    });
}


/* =========================================================
   TOP 5 / PAYOUT
   ========================================================= */

async function processTop5Payouts(gameId) {

    try {

        const game =
            await Game.findOne({
                gameId
            });

        if (!game) {
            return;
        }

        if (game.payoutProcessed) {
            return;
        }

        /*
           Verrouillage anti-double paiement.
        */

        const locked =
            await Game.findOneAndUpdate(
                {
                    gameId,
                    payoutProcessed: false
                },
                {
                    $set: {
                        payoutProcessed: true
                    }
                },
                {
                    new: true
                }
            );

        if (!locked) {
            return;
        }

        const players =
            await Player.find({
                gameId,
                paymentStatus: "paid"
            })
                .sort({
                    score: -1,
                    createdAt: 1
                })
                .limit(5)
                .lean();

        if (!players.length) {

            console.log(
                "Aucun joueur payé pour",
                gameId
            );

            return;
        }

        console.log(
            "🏆 TOP 5 :",
            players.map(
                (p, index) =>
                    `${index + 1}. ${p.playerName} - ${p.score} taps`
            )
        );

        for (
            let index = 0;
            index < players.length;
            index++
        ) {

            const player =
                players[index];

            const payoutAmount =
                Number(player.amount) * 2;

            if (
                !isValidTronAddress(
                    player.cryptoAddress
                )
            ) {

                console.error(
                    "❌ Wallet joueur invalide :",
                    player.playerId
                );

                await Payout.create({
                    gameId,
                    playerId: player.playerId,
                    playerName: player.playerName,
                    wallet: player.cryptoAddress,
                    amount: payoutAmount,
                    rank: index + 1,
                    status: "failed",
                    error: "Wallet TRON invalide"
                });

                continue;
            }

            const existing =
                await Payout.findOne({
                    gameId,
                    playerId: player.playerId
                });

            if (existing) {
                continue;
            }

            const payout =
                await Payout.create({
                    gameId,
                    playerId: player.playerId,
                    playerName: player.playerName,
                    wallet: player.cryptoAddress,
                    amount: payoutAmount,
                    rank: index + 1,
                    status: "pending"
                });

            /*
               Exécution du transfert TRC20.
            */

            try {

                payout.status =
                    "processing";

                await payout.save();

                const contract =
                    await tronWeb
                        .contract()
                        .at(USDT_CONTRACT);

                const rawAmount =
                    BigInt(
                        Math.round(
                            payoutAmount *
                            Math.pow(
                                10,
                                USDT_DECIMALS
                            )
                        )
                    ).toString();

                const txid =
                    await contract
                        .transfer(
                            player.cryptoAddress,
                            rawAmount
                        )
                        .send({
                            feeLimit: 100000000
                        });

                payout.status =
                    "paid";

                payout.txid =
                    typeof txid === "string"
                        ? txid
                        : txid.txid || "";

                payout.paidAt =
                    new Date();

                await payout.save();

                console.log(
                    `✅ Paiement TOP ${index + 1} : ${payoutAmount} USDT`
                );

                console.log(
                    "Wallet :",
                    player.cryptoAddress
                );

                console.log(
                    "TXID :",
                    payout.txid
                );

            } catch (error) {

                console.error(
                    "❌ Erreur payout :",
                    error.message
                );

                payout.status =
                    "failed";

                payout.error =
                    error.message;

                await payout.save();
            }
        }

    } catch (error) {

        console.error(
            "Erreur processTop5Payouts :",
            error
        );
    }
}


/* =========================================================
   ROUTE PRINCIPALE
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({
            success: true,
            name: "Miltape World Challenge Backend",
            status: "online",
            wallet: MILTAPE_WALLET,
            network: "TRON",
            token: "USDT TRC20"
        });
    }
);


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
    "/health",
    async (req, res) => {

        const dbConnected =
            mongoose.connection.readyState === 1;

        res.json({
            success: true,
            server: "online",
            database:
                dbConnected
                    ? "connected"
                    : "disconnected",
            wallet:
                MILTAPE_WALLET
                    ? "configured"
                    : "missing"
        });
    }
);


app.get(
    "/api/health",
    async (req, res) => {

        const dbConnected =
            mongoose.connection.readyState === 1;

        res.json({
            success: true,
            database: dbConnected,
            tron: !!tronWeb,
            wallet: MILTAPE_WALLET
        });
    }
);


/* =========================================================
   STATUS
   ========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        const game =
            await getOrCreateGame();

        res.json({
            success: true,

            online:
                connectedPlayers.size,

            game: {
                gameId: game.gameId,
                status: game.status,
                startsAt: game.startsAt,
                endsAt: game.endsAt
            },

            wallet: MILTAPE_WALLET,

            network: "TRON",

            token: "USDT TRC20"
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
            success: true,

            gameDuration:
                GAME_DURATION,

            minBet:
                MIN_BET,

            maxBet:
                MAX_BET,

            topPlayers:
                5,

            payoutMultiplier:
                2,

            network:
                "TRON",

            token:
                "USDT TRC20",

            receiverWallet:
                MILTAPE_WALLET,

            antiSpam:
                MAX_TAPS_PER_SECOND
        });
    }
);


/* =========================================================
   GAME
   ========================================================= */

app.get(
    "/api/game",
    async (req, res) => {

        try {

            const game =
                await getOrCreateGame();

            res.json({
                success: true,
                game
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Impossible de récupérer le jeu"
            });
        }
    }
);


/* =========================================================
   SATURDAY JACKPOT
   ========================================================= */

app.get(
    "/api/saturday-jackpot",
    async (req, res) => {

        try {

            const result =
                await Player.aggregate([
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

            const total =
                result.length
                    ? Number(result[0].total)
                    : 0;

            const jackpot =
                isSaturday()
                    ? total *
                      (SATURDAY_JACKPOT_PERCENT / 100)
                    : 0;

            res.json({
                success: true,
                isSaturday: isSaturday(),
                percent:
                    SATURDAY_JACKPOT_PERCENT,
                totalStakes: total,
                jackpot
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Erreur jackpot"
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

            const result =
                await Player.aggregate([
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

            const total =
                result.length
                    ? Number(result[0].total)
                    : 0;

            res.json({
                success: true,
                total
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error: "Erreur total stakes"
            });
        }
    }
);


/* =========================================================
   ONLINE
   ========================================================= */

app.get(
    "/api/online",
    (req, res) => {

        res.json({
            success: true,
            online:
                connectedPlayers.size
        });
    }
);


/* =========================================================
   LEADERBOARD
   ========================================================= */

app.get(
    "/api/leaderboard",
    async (req, res) => {

        try {

            const game =
                await getOrCreateGame();

            const leaderboard =
                await getLeaderboard(
                    game.gameId
                );

            res.json({
                success: true,
                gameId: game.gameId,
                leaderboard
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Erreur leaderboard"
            });
        }
    }
);


/* =========================================================
   CREATE ENTRY
   ========================================================= */

app.post(
    "/api/create-entry",
    async (req, res) => {

        try {

            const {
                playerId,
                playerName,
                amount,
                cryptoAddress
            } = req.body;

            if (
                !playerId ||
                !playerName
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "playerId et playerName sont obligatoires"
                });
            }

            const cleanName =
                String(playerName)
                    .trim()
                    .substring(0, 30);

            const bet =
                normalizeAmount(amount);

            if (
                bet === null ||
                bet < MIN_BET ||
                bet > MAX_BET
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        `La mise doit être comprise entre ${MIN_BET} et ${MAX_BET} USDT`
                });
            }

            if (
                !isValidTronAddress(
                    cryptoAddress
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid address provided"
                });
            }

            const game =
                await getOrCreateGame();

            const player =
                await createPlayerEntry({
                    playerId,
                    playerName: cleanName,
                    amount: bet,
                    cryptoAddress:
                        cryptoAddress.trim(),
                    gameId: game.gameId
                });

            res.json({
                success: true,

                playerId:
                    player.playerId,

                gameId:
                    player.gameId,

                amount:
                    player.amount,

                receiverWallet:
                    MILTAPE_WALLET,

                paymentStatus:
                    "pending"
            });

        } catch (error) {

            console.error(
                "create-entry:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Impossible de créer l'entrée"
            });
        }
    }
);


/* =========================================================
   JOIN
   ========================================================= */

app.post(
    "/api/join",
    async (req, res) => {

        try {

            const {
                playerId,
                playerName,
                amount,
                cryptoAddress
            } = req.body;

            if (
                !playerId ||
                !playerName
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Informations joueur manquantes"
                });
            }

            const bet =
                normalizeAmount(amount);

            if (
                bet === null ||
                bet < MIN_BET ||
                bet > MAX_BET
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Mise invalide"
                });
            }

            if (
                !isValidTronAddress(
                    cryptoAddress
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid address provided"
                });
            }

            const game =
                await getOrCreateGame();

            let player =
                await Player.findOne({
                    playerId,
                    gameId: game.gameId
                });

            if (!player) {

                player =
                    await Player.create({
                        playerId,
                        playerName:
                            String(playerName)
                                .trim()
                                .substring(0, 30),

                        amount: bet,

                        cryptoAddress:
                            cryptoAddress.trim(),

                        gameId:
                            game.gameId,

                        paymentStatus:
                            "pending"
                    });

            }

            res.json({
                success: true,

                playerId:
                    player.playerId,

                gameId:
                    game.gameId,

                paymentStatus:
                    player.paymentStatus,

                receiverWallet:
                    MILTAPE_WALLET
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Erreur join"
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

            const {
                playerId,
                gameId,
                txid,
                transactionHash
            } = req.body;

            const hash =
                txid ||
                transactionHash;

            if (
                !playerId ||
                !gameId ||
                !hash
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "playerId, gameId et TXID sont obligatoires"
                });
            }

            const player =
                await Player.findOne({
                    playerId,
                    gameId
                });

            if (!player) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Joueur introuvable"
                });
            }

            /*
               Protection anti double paiement.
            */

            const existingPayment =
                await Payment.findOne({
                    transactionHash: hash
                });

            if (existingPayment) {

                return res.json({
                    success:
                        existingPayment.status ===
                        "confirmed",

                    paymentStatus:
                        existingPayment.status,

                    message:
                        "Transaction déjà enregistrée"
                });
            }

            player.transactionHash =
                hash;

            player.paymentStatus =
                "pending";

            await player.save();

            await Payment.create({
                transactionHash:
                    hash,

                playerId:
                    player.playerId,

                gameId:
                    player.gameId,

                amount:
                    player.amount,

                status:
                    "pending"
            });

            res.json({
                success: true,
                paymentStatus:
                    "pending",
                txid: hash
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Erreur enregistrement transaction"
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

            const {
                playerId,
                gameId,
                txid,
                transactionHash
            } = req.body;

            const hash =
                txid ||
                transactionHash;

            if (
                !playerId ||
                !gameId ||
                !hash
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Informations paiement manquantes"
                });
            }

            const player =
                await Player.findOne({
                    playerId,
                    gameId
                });

            if (!player) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Joueur introuvable"
                });
            }

            /*
               Si déjà payé, ne jamais refaire
               la vérification comme un nouveau paiement.
            */

            if (
                player.paymentStatus ===
                "paid"
            ) {

                return res.json({
                    success: true,
                    paid: true,
                    paymentStatus: "paid",
                    gameId,
                    playerId
                });
            }

            const verification =
                await verifyUsdtPayment(
                    hash,
                    player.amount
                );

            if (!verification.valid) {

                player.paymentStatus =
                    "rejected";

                await player.save();

                await Payment.updateOne(
                    {
                        transactionHash:
                            hash
                    },
                    {
                        $set: {
                            status:
                                "rejected"
                        }
                    }
                );

                return res.status(400).json({
                    success: false,
                    paid: false,
                    error:
                        verification.reason
                });
            }

            /*
               Vérification du wallet joueur.
            */

            if (
                player.cryptoAddress &&
                verification.from !==
                    player.cryptoAddress
            ) {

                return res.status(400).json({
                    success: false,
                    paid: false,
                    error:
                        "Le wallet qui a envoyé les USDT ne correspond pas au wallet du joueur"
                });
            }

            player.paymentStatus =
                "paid";

            player.transactionHash =
                hash;

            player.paidAt =
                new Date();

            await player.save();

            await Payment.updateOne(
                {
                    transactionHash:
                        hash
                },
                {
                    $set: {
                        status:
                            "confirmed",

                        fromAddress:
                            verification.from,

                        toAddress:
                            verification.to,

                        amount:
                            verification.amount,

                        confirmedAt:
                            new Date()
                    }
                },
                {
                    upsert: true
                }
            );

            await broadcastLeaderboard(
                gameId
            );

            io.emit(
                "paidGameJoined",
                {
                    playerId,
                    gameId
                }
            );

            res.json({
                success: true,
                paid: true,
                paymentStatus: "paid",
                amount:
                    verification.amount,
                txid: hash,
                gameId,
                playerId
            });

        } catch (error) {

            console.error(
                "verify-payment:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Erreur vérification paiement"
            });
        }
    }
);


/* =========================================================
   TAP
   ========================================================= */

app.post(
    "/api/tap",
    async (req, res) => {

        try {

            const {
                playerId,
                gameId
            } = req.body;

            if (
                !playerId ||
                !gameId
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "playerId et gameId requis"
                });
            }

            const now =
                Date.now();

            const limiter =
                tapLimiter.get(
                    playerId
                ) || {
                    second: now,
                    count: 0
                };

            if (
                now - limiter.second >=
                1000
            ) {

                limiter.second =
                    now;

                limiter.count =
                    0;
            }

            limiter.count++;

            tapLimiter.set(
                playerId,
                limiter
            );

            if (
                limiter.count >
                MAX_TAPS_PER_SECOND
            ) {

                return res.status(429).json({
                    success: false,
                    error:
                        "Trop de taps"
                });
            }

            const game =
                await Game.findOne({
                    gameId
                });

            if (!game) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Jeu introuvable"
                });
            }

            const currentTime =
                new Date();

            if (
                game.status !==
                "running" ||
                currentTime >=
                    game.endsAt
            ) {

                await Game.updateOne(
                    {
                        gameId
                    },
                    {
                        $set: {
                            status:
                                "finished",

                            finishedAt:
                                currentTime
                        }
                    }
                );

                return res.status(400).json({
                    success: false,
                    error:
                        "GAME_FINISHED"
                });
            }

            const player =
                await Player.findOne({
                    playerId,
                    gameId,
                    paymentStatus: "paid"
                });

            if (!player) {

                return res.status(403).json({
                    success: false,
                    error:
                        "Joueur non payé"
                });
            }

            player.score += 1;

            await player.save();

            res.json({
                success: true,
                score:
                    player.score
            });

            /*
               Broadcast après le tap.
            */

            io.emit(
                "scoreUpdate",
                {
                    playerId,
                    score:
                        player.score
                }
            );

            await broadcastLeaderboard(
                gameId
            );

        } catch (error) {

            console.error(
                "tap:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Erreur tap"
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

            const player =
                await Player.findOne({
                    playerId:
                        req.params.playerId
                })
                    .sort({
                        createdAt: -1
                    })
                    .lean();

            if (!player) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Joueur introuvable"
                });
            }

            const players =
                await Player.find({
                    gameId:
                        player.gameId,

                    paymentStatus:
                        "paid"
                })
                    .sort({
                        score: -1,
                        createdAt: 1
                    })
                    .lean();

            const position =
                players.findIndex(
                    p =>
                        p.playerId ===
                        player.playerId
                ) + 1;

            res.json({
                success: true,

                player,

                rank:
                    position || null,

                top5:
                    position >= 1 &&
                    position <= 5
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Erreur statistiques joueur"
            });
        }
    }
);


/* =========================================================
   CHAT GET
   ========================================================= */

app.get(
    "/api/chat",
    async (req, res) => {

        try {

            const messages =
                await Chat.find({})
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

            res.status(500).json({
                success: false,
                error:
                    "Erreur chat"
            });
        }
    }
);


/* =========================================================
   CHAT POST
   ========================================================= */

app.post(
    "/api/chat",
    async (req, res) => {

        try {

            const {
                playerId,
                playerName,
                message
            } = req.body;

            const cleanMessage =
                String(
                    message || ""
                )
                    .trim()
                    .substring(0, 250);

            if (!cleanMessage) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Message vide"
                });
            }

            const chat =
                await Chat.create({
                    playerId:
                        playerId || "",

                    playerName:
                        String(
                            playerName ||
                            "Joueur"
                        )
                            .trim()
                            .substring(0, 30),

                    message:
                        cleanMessage
                });

            io.emit(
                "chat:new",
                chat
            );

            res.json({
                success: true,
                message: chat
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Erreur chat"
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

        const {
            password
        } = req.body;

        if (
            !ADMIN_PASSWORD ||
            password !==
                ADMIN_PASSWORD
        ) {

            return res.status(401).json({
                success: false,
                error:
                    "Mot de passe incorrect"
            });
        }

        res.json({
            success: true,
            authenticated: true
        });
    }
);


/* =========================================================
   ADMIN STATS
   ========================================================= */

app.get(
    "/api/admin/stats",
    async (req, res) => {

        try {

            const players =
                await Player.countDocuments();

            const paidPlayers =
                await Player.countDocuments({
                    paymentStatus: "paid"
                });

            const payments =
                await Payment.countDocuments();

            const payouts =
                await Payout.countDocuments();

            const result =
                await Player.aggregate([
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
                result.length
                    ? result[0].total
                    : 0;

            res.json({
                success: true,

                players,

                paidPlayers,

                payments,

                payouts,

                totalStakes
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Erreur statistiques admin"
            });
        }
    }
);


/* =========================================================
   SOCKET.IO
   ========================================================= */

io.on(
    "connection",
    async socket => {

        console.log(
            "🟢 Socket connecté :",
            socket.id
        );

        connectedPlayers.set(
            socket.id,
            {
                connectedAt:
                    Date.now()
            }
        );

        io.emit(
            "onlineCount",
            connectedPlayers.size
        );

        io.emit(
            "online:count",
            connectedPlayers.size
        );

        /*
           JOIN
        */

        socket.on(
            "join",
            async data => {

                try {

                    const {
                        playerId,
                        playerName,
                        gameId
                    } = data || {};

                    if (playerId) {

                        connectedPlayers.set(
                            socket.id,
                            {
                                playerId,
                                playerName:
                                    playerName ||
                                    "Joueur",

                                connectedAt:
                                    Date.now()
                            }
                        );
                    }

                    if (gameId) {

                        socket.join(
                            gameId
                        );
                    }

                    const game =
                        await getOrCreateGame();

                    socket.emit(
                        "gameInfo",
                        {
                            gameId:
                                game.gameId,

                            status:
                                game.status,

                            startsAt:
                                game.startsAt,

                            endsAt:
                                game.endsAt
                        }
                    );

                    const leaderboard =
                        await getLeaderboard(
                            game.gameId
                        );

                    socket.emit(
                        "leaderboard",
                        leaderboard
                    );

                } catch (error) {

                    console.error(
                        "socket join:",
                        error
                    );
                }
            }
        );


        /*
           Alias frontend
        */

        socket.on(
            "joinGame",
            data => {

                socket.emit(
                    "join",
                    data
                );
            }
        );


        /*
           GAME GET
        */

        socket.on(
            "getGame",
            async () => {

                const game =
                    await getOrCreateGame();

                socket.emit(
                    "gameInfo",
                    {
                        gameId:
                            game.gameId,

                        status:
                            game.status,

                        startsAt:
                            game.startsAt,

                        endsAt:
                            game.endsAt
                    }
                );
            }
        );


        socket.on(
            "game:get",
            async () => {

                const game =
                    await getOrCreateGame();

                socket.emit(
                    "gameInfo",
                    {
                        gameId:
                            game.gameId,

                        status:
                            game.status,

                        startsAt:
                            game.startsAt,

                        endsAt:
                            game.endsAt
                    }
                );
            }
        );


        /*
           LEADERBOARD
        */

        socket.on(
            "getLeaderboard",
            async () => {

                const game =
                    await getOrCreateGame();

                const leaderboard =
                    await getLeaderboard(
                        game.gameId
                    );

                socket.emit(
                    "leaderboard",
                    leaderboard
                );
            }
        );


        /*
           TAP SOCKET
        */

        socket.on(
            "tap",
            async data => {

                try {

                    const {
                        playerId,
                        gameId
                    } = data || {};

                    if (
                        !playerId ||
                        !gameId
                    ) {
                        return;
                    }

                    const now =
                        Date.now();

                    const limiter =
                        tapLimiter.get(
                            playerId
                        ) || {
                            second: now,
                            count: 0
                        };

                    if (
                        now -
                            limiter.second >=
                        1000
                    ) {

                        limiter.second =
                            now;

                        limiter.count =
                            0;
                    }

                    limiter.count++;

                    tapLimiter.set(
                        playerId,
                        limiter
                    );

                    if (
                        limiter.count >
                        MAX_TAPS_PER_SECOND
                    ) {
                        return;
                    }

                    const game =
                        await Game.findOne({
                            gameId
                        });

                    if (!game) {
                        return;
                    }

                    if (
                        game.status !==
                            "running" ||
                        new Date() >=
                            game.endsAt
                    ) {

                        socket.emit(
                            "gameFinished",
                            {
                                gameId
                            }
                        );

                        return;
                    }

                    const player =
                        await Player.findOne({
                            playerId,
                            gameId,
                            paymentStatus:
                                "paid"
                        });

                    if (!player) {
                        return;
                    }

                    player.score += 1;

                    await player.save();

                    socket.emit(
                        "scoreUpdate",
                        {
                            playerId,
                            score:
                                player.score
                        }
                    );

                    io.emit(
                        "scoreUpdate",
                        {
                            playerId,
                            score:
                                player.score
                        }
                    );

                    await broadcastLeaderboard(
                        gameId
                    );

                } catch (error) {

                    console.error(
                        "socket tap:",
                        error
                    );
                }
            }
        );


        /*
           CHAT
        */

        async function handleChat(
            data
        ) {

            try {

                const {
                    playerId,
                    playerName,
                    message
                } = data || {};

                const cleanMessage =
                    String(
                        message || ""
                    )
                        .trim()
                        .substring(0, 250);

                if (!cleanMessage) {
                    return;
                }

                const chat =
                    await Chat.create({
                        playerId:
                            playerId || "",

                        playerName:
                            String(
                                playerName ||
                                "Joueur"
                            )
                                .trim()
                                .substring(0, 30),

                        message:
                            cleanMessage
                    });

                io.emit(
                    "chat:new",
                    chat
                );

            } catch (error) {

                console.error(
                    "socket chat:",
                    error
                );
            }
        }


        socket.on(
            "chatMessage",
            handleChat
        );

        socket.on(
            "chat:send",
            handleChat
        );

        socket.on(
            "sendMessage",
            handleChat
        );


        /*
           DISCONNECT
        */

        socket.on(
            "disconnect",
            () => {

                connectedPlayers.delete(
                    socket.id
                );

                console.log(
                    "🔴 Socket déconnecté :",
                    socket.id
                );

                io.emit(
                    "onlineCount",
                    connectedPlayers.size
                );

                io.emit(
                    "online:count",
                    connectedPlayers.size
                );
            }
        );
    }
);


/* =========================================================
   TIMER GLOBAL
   ========================================================= */

setInterval(
    async () => {

        try {

            const game =
                await getOrCreateGame();

            const now =
                Date.now();

            const end =
                new Date(
                    game.endsAt
                ).getTime();

            const remaining =
                Math.max(
                    0,
                    Math.floor(
                        (end - now) / 1000
                    )
                );

            io.emit(
                "timer",
                {
                    gameId:
                        game.gameId,

                    remaining,

                    endsAt:
                        game.endsAt
                }
            );

            io.emit(
                "global:timer",
                {
                    gameId:
                        game.gameId,

                    remaining,

                    endsAt:
                        game.endsAt
                }
            );

            if (remaining <= 0) {

                await finishExpiredGame();
            }

        } catch (error) {

            console.error(
                "Timer error:",
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
                limiter
            ] of tapLimiter.entries()
        ) {

            if (
                now -
                    limiter.second >
                10000
            ) {

                tapLimiter.delete(
                    playerId
                );
            }
        }

    },
    10000
);


/* =========================================================
   DÉMARRAGE SERVEUR
   ========================================================= */

async function startServer() {

    try {

        if (!MONGO_URI) {

            throw new Error(
                "MONGO_URI / MONGODB_URI manquante dans Railway."
            );
        }

        /*
           Initialisation TRON
        */

        initializeTron();

        /*
           MongoDB
        */

        await mongoose.connect(
            MONGO_URI,
            {
                serverSelectionTimeoutMS:
                    10000
            }
        );

        console.log(
            "✅ MongoDB connecté"
        );

        console.log(
            "📦 Base :",
            mongoose.connection.name
        );

        /*
           Jeu
        */

        await getOrCreateGame();

        /*
           Serveur HTTP
        */

        server.listen(
            PORT,
            () => {

                console.log("");
                console.log(
                    "=============================================="
                );

                console.log(
                    "🚀 MILTAPE BACKEND ONLINE"
                );

                console.log(
                    "Port :",
                    PORT
                );

                console.log(
                    "Wallet Miltape :",
                    MILTAPE_WALLET
                );

                console.log(
                    "USDT TRC20 :",
                    USDT_CONTRACT
                );

                console.log(
                    "Game : 10 minutes"
                );

                console.log(
                    "Top 5 : x2"
                );

                console.log(
                    "Anti-spam : 25 taps/sec"
                );

                console.log(
                    "=============================================="
                );

                console.log("");
            }
        );

    } catch (error) {

        console.error("");
        console.error(
            "❌ ERREUR DEMARRAGE MILTAPE"
        );

        console.error(
            error.message
        );

        console.error("");

        process.exit(1);
    }
}


/* =========================================================
   ERREURS
   ========================================================= */

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "Uncaught Exception:",
            error
        );
    }
);


/* =========================================================
   START
   ========================================================= */

startServer().catch(
    error => {

        console.error(
            "Erreur fatale :",
            error
        );

        process.exit(1);
    }
);
