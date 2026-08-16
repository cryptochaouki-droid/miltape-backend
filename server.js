/* =========================================================
   MILTAPE WORLD CHALLENGE
   BACKEND RAILWAY
   PAYMENTS USDT TRC20 AUTOMATIQUES
   VERSION CORRIGEE + SECURISEE

   IMPORTANT :
   Le wallet réel est automatiquement dérivé
   de MILTAPE_PRIVATE_KEY.

   MILTAPE_WALLET / RECEIVER_WALLET sont seulement
   des variables de contrôle facultatives.
========================================================= */

"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");


/* =========================================================
   CONFIGURATION
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


/*
   ========================================================
   CLE PRIVEE
   ========================================================

   NE JAMAIS mettre cette valeur directement dans le code.

   Elle doit être dans Railway :
   MILTAPE_PRIVATE_KEY
*/

const MILTAPE_PRIVATE_KEY =
    String(
        process.env.MILTAPE_PRIVATE_KEY || ""
    ).trim();


/*
   ========================================================
   WALLET CONFIGURE
   ========================================================

   Ces variables sont facultatives.

   Le wallet réel sera dérivé automatiquement
   de MILTAPE_PRIVATE_KEY.

   On accepte :
   MILTAPE_WALLET
   ou
   RECEIVER_WALLET
*/

const CONFIGURED_MILTAPE_WALLET =
    String(
        process.env.MILTAPE_WALLET ||
        process.env.RECEIVER_WALLET ||
        ""
    ).trim();


/*
   USDT TRC20 officiel
*/

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";


const USDT_DECIMALS =
    6;


const MINIMUM_BET =
    1;


const MAXIMUM_BET =
    1000000;


const GAME_DURATION =
    600;


/*
   Limite énergie/frais TRON.
*/

const PAYOUT_FEE_LIMIT =
    100000000;


/*
   Attente maximale confirmation.
*/

const PAYOUT_CONFIRM_TIMEOUT =
    60000;


const PAYOUT_CONFIRM_INTERVAL =
    3000;


/*
   Délai avant nouvelle partie.
*/

const NEW_GAME_DELAY =
    3000;


/* =========================================================
   VERIFICATION ENVIRONNEMENT
========================================================= */

if (!MONGO_URI) {

    console.error(
        "❌ MONGO_URI / MONGODB_URI MANQUANT."
    );

    process.exit(1);
}


if (!MILTAPE_PRIVATE_KEY) {

    console.error(
        "❌ MILTAPE_PRIVATE_KEY MANQUANT."
    );

    console.error(
        "Ajoute MILTAPE_PRIVATE_KEY dans Railway Variables."
    );

    process.exit(1);
}


/* =========================================================
   TRONWEB
========================================================= */

let tronWeb;

let MILTAPE_WALLET = "";


try {

    tronWeb =
        new TronWeb({
            fullHost:
                "https://api.trongrid.io",

            headers:
                TRONGRID_API_KEY
                    ? {
                        "TRON-PRO-API-KEY":
                            TRONGRID_API_KEY
                    }
                    : {},

            privateKey:
                MILTAPE_PRIVATE_KEY
        });


    /*
       =====================================================
       IMPORTANT
       =====================================================

       Le wallet est maintenant dérivé automatiquement
       de la clé privée.

       C'est cette adresse qui devient la source
       de vérité du serveur.
    */

    const derivedAddress =
        tronWeb.address.fromPrivateKey(
            MILTAPE_PRIVATE_KEY
        );


    if (
        !derivedAddress
    ) {

        throw new Error(
            "Impossible de dériver l'adresse TRON depuis MILTAPE_PRIVATE_KEY."
        );
    }


    MILTAPE_WALLET =
        String(
            derivedAddress
        ).trim();


    /*
       Si Railway contient une ancienne adresse,
       on ne bloque plus le serveur.

       On affiche simplement un avertissement.
    */

    if (
        CONFIGURED_MILTAPE_WALLET &&
        CONFIGURED_MILTAPE_WALLET.toLowerCase() !==
        MILTAPE_WALLET.toLowerCase()
    ) {

        console.warn(
            "⚠️ ATTENTION : MILTAPE_WALLET / RECEIVER_WALLET ne correspond pas à la clé privée."
        );

        console.warn(
            "Wallet configuré :",
            CONFIGURED_MILTAPE_WALLET
        );

        console.warn(
            "Wallet dérivé :",
            MILTAPE_WALLET
        );

        console.warn(
            "➡️ Le serveur utilisera automatiquement le wallet dérivé."
        );
    }


    console.log(
        "🟢 Wallet Miltape dérivé depuis la clé privée :",
        MILTAPE_WALLET
    );


} catch (error) {

    console.error(
        "❌ Erreur configuration TronWeb :",
        error.message
    );

    process.exit(1);
}


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
   MONGOOSE
========================================================= */

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

            payoutStatus: {
                type: String,
                enum: [
                    "none",
                    "pending",
                    "processing",
                    "paid",
                    "failed"
                ],
                default: "none",
                index: true
            },

            payoutTxid: {
                type: String,
                default: "",
                index: true
            },

            payoutAmount: {
                type: Number,
                default: 0
            },

            payoutAddress: {
                type: String,
                default: ""
            },

            payoutAt: {
                type: Date,
                default: null
            },

            payoutError: {
                type: String,
                default: ""
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
   PAYOUT SCHEMA
========================================================= */

const payoutSchema =
    new mongoose.Schema(
        {

            payoutKey: {
                type: String,
                required: true,
                unique: true,
                index: true
            },

            gameId: {
                type: Number,
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
                default: "Anonyme"
            },

            destination: {
                type: String,
                required: true
            },

            amount: {
                type: Number,
                required: true
            },

            amountUnits: {
                type: String,
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
                default: "pending",
                index: true
            },

            txid: {
                type: String,
                default: "",
                index: true
            },

            error: {
                type: String,
                default: ""
            },

            createdAt: {
                type: Date,
                default: Date.now
            },

            processingAt: {
                type: Date,
                default: null
            },

            paidAt: {
                type: Date,
                default: null
            }

        },
        {
            collection:
                "payouts"
        }
    );


payoutSchema.index(
    {
        txid: 1
    },
    {
        unique: true,
        sparse: true
    }
);


const Payout =
    mongoose.model(
        "Payout",
        payoutSchema
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

let currentGameId =
    1;


let gameStartedAt =
    new Date();


let gameEndsAt =
    new Date(
        Date.now() +
        GAME_DURATION * 1000
    );


let gameRunning =
    true;


let finishingGame =
    false;


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

    try {

        const clean =
            String(
                address || ""
            ).trim();


        if (
            !clean
        ) {

            return false;
        }


        return Boolean(
            tronWeb.address.toHex(
                clean
            )
        );

    } catch {

        return false;
    }
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


    if (
        !response.ok
    ) {

        throw new Error(
            `TronGrid HTTP ${response.status}`
        );
    }


    return data;
}


/* =========================================================
   VERIFY TRON USDT TRANSACTION
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
            .trim()
            .toLowerCase();


    if (
        !/^[a-f0-9]{64}$/
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


    /*
       Vérifie également que la transaction
       existe réellement sur TRON.
    */

    const transaction =
        await tronGridFetch(
            "https://api.trongrid.io/v1/transactions/" +
            cleanTxid +
            "?only_confirmed=true"
        );


    if (
        !transaction ||
        !Array.isArray(
            transaction.data
        ) ||
        !transaction.data.length
    ) {

        throw new Error(
            "Transaction TRON introuvable ou non confirmée."
        );
    }


    const transactionData =
        transaction.data[0];


    if (
        transactionData.ret &&
        Array.isArray(
            transactionData.ret
        ) &&
        transactionData.ret.length
    ) {

        const contractRet =
            String(
                transactionData.ret[0]?.contractRet ||
                ""
            ).toUpperCase();


        if (
            contractRet &&
            contractRet !==
            "SUCCESS"
        ) {

            throw new Error(
                "La transaction TRON a échoué."
            );
        }
    }


    /*
       Recherche l'événement USDT Transfer.
    */

    const transactionInfo =
        await tronGridFetch(
            "https://api.trongrid.io/v1/transactions/" +
            cleanTxid +
            "/events?only_confirmed=true"
        );


    const events =
        Array.isArray(
            transactionInfo?.data
        )
            ? transactionInfo.data
            : [];


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


    if (
        !transfer
    ) {

        throw new Error(
            "Transaction trouvée mais montant, expéditeur ou destinataire incorrect."
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
            Number(
                expectedAmount
            ),

        amountUnits:
            expectedUnits.toString()
    };
}


/* =========================================================
   DATABASE
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
            error.message
        );

        process.exit(1);
    }
}


/* =========================================================
   GAME HELPERS
========================================================= */

function getTimerLeft() {

    if (
        !gameRunning
    ) {

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
        players.slice(
            0,
            5
        )
    );


    io.emit(
        "leaderboard:update",
        players.slice(
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
   TRON BALANCE
========================================================= */

async function getMiltapeUsdtBalance() {

    const contract =
        await tronWeb
            .contract()
            .at(
                USDT_CONTRACT
            );


    const balance =
        await contract
            .balanceOf(
                MILTAPE_WALLET
            )
            .call();


    return Number(
        balance
    ) /
    Math.pow(
        10,
        USDT_DECIMALS
    );
}


/* =========================================================
   BUILD + SIGN PAYOUT
========================================================= */

async function buildSignedUsdtTransaction(
    destination,
    amount
) {

    const cleanDestination =
        String(
            destination || ""
        ).trim();


    if (
        !isValidTronAddress(
            cleanDestination
        )
    ) {

        throw new Error(
            "Adresse destinataire TRON invalide."
        );
    }


    if (
        normalizeAddress(
            cleanDestination
        ) ===
        normalizeAddress(
            MILTAPE_WALLET
        )
    ) {

        throw new Error(
            "Paiement vers le wallet Miltape interdit."
        );
    }


    const numericAmount =
        Number(amount);


    if (
        !Number.isFinite(
            numericAmount
        ) ||
        numericAmount <= 0
    ) {

        throw new Error(
            "Montant payout invalide."
        );
    }


    const amountUnits =
        usdtToUnits(
            numericAmount
        );


    const balance =
        await getMiltapeUsdtBalance();


    if (
        balance <
        numericAmount
    ) {

        throw new Error(
            `Solde USDT insuffisant. Solde: ${balance} USDT. Requis: ${numericAmount} USDT.`
        );
    }


    const ownerAddress =
        tronWeb.address.toHex(
            MILTAPE_WALLET
        );


    const transactionWrapper =
        await tronWeb
            .transactionBuilder
            .triggerSmartContract(

                USDT_CONTRACT,

                "transfer(address,uint256)",

                {
                    feeLimit:
                        PAYOUT_FEE_LIMIT,

                    callValue:
                        0,

                    funcABIV2: {

                        name:
                            "transfer",

                        type:
                            "function",

                        inputs: [

                            {
                                name:
                                    "_to",

                                type:
                                    "address"
                            },

                            {
                                name:
                                    "_value",

                                type:
                                    "uint256"
                            }

                        ],

                        outputs: [

                            {
                                name:
                                    "",

                                type:
                                    "bool"
                            }

                        ],

                        stateMutability:
                            "nonpayable"
                    },

                    parametersV2: [

                        cleanDestination,

                        amountUnits.toString()

                    ]
                },

                [],

                ownerAddress
            );


    if (
        !transactionWrapper?.transaction
    ) {

        throw new Error(
            "Impossible de construire la transaction TRON."
        );
    }


    const signedTransaction =
        await tronWeb
            .trx
            .sign(
                transactionWrapper.transaction,
                MILTAPE_PRIVATE_KEY
            );


    const txid =
        String(
            signedTransaction?.txID ||
            transactionWrapper?.transaction?.txID ||
            ""
        ).toLowerCase();


    if (
        !/^[a-f0-9]{64}$/.test(
            txid
        )
    ) {

        throw new Error(
            "Impossible de déterminer le TXID avant diffusion."
        );
    }


    return {

        txid,

        signedTransaction,

        amount:
            numericAmount,

        amountUnits:
            amountUnits.toString(),

        destination:
            cleanDestination
    };
}


/* =========================================================
   BROADCAST PAYOUT
========================================================= */

async function broadcastSignedTransaction(
    signedTransaction,
    expectedTxid
) {

    const result =
        await tronWeb
            .trx
            .sendRawTransaction(
                signedTransaction
            );


    const returnedTxid =
        String(
            result?.txid ||
            result?.transaction?.txID ||
            expectedTxid ||
            ""
        ).toLowerCase();


    if (
        !returnedTxid
    ) {

        throw new Error(
            "TRON n'a retourné aucun TXID."
        );
    }


    if (
        returnedTxid !==
        expectedTxid.toLowerCase()
    ) {

        throw new Error(
            "Le TXID retourné par TRON ne correspond pas au TXID préparé."
        );
    }


    if (
        result?.result === false
    ) {

        throw new Error(
            "TRON a refusé la diffusion de la transaction."
        );
    }


    return returnedTxid;
}


/* =========================================================
   WAIT CONFIRMATION
========================================================= */

async function waitForTransactionConfirmation(
    txid
) {

    const started =
        Date.now();


    while (
        Date.now() -
        started <
        PAYOUT_CONFIRM_TIMEOUT
    ) {

        try {

            const info =
                await tronWeb
                    .trx
                    .getTransactionInfo(
                        txid
                    );


            if (
                info &&
                info.receipt &&
                info.receipt.result
            ) {

                const result =
                    String(
                        info.receipt.result
                    )
                        .toUpperCase();


                if (
                    result ===
                    "SUCCESS"
                ) {

                    return {

                        confirmed:
                            true,

                        info
                    };
                }


                if (
                    result ===
                    "FAILED"
                ) {

                    throw new Error(
                        "La transaction TRON a échoué."
                    );
                }
            }

        } catch (error) {

            if (
                error.message ===
                "La transaction TRON a échoué."
            ) {

                throw error;
            }
        }


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    PAYOUT_CONFIRM_INTERVAL
                )
        );
    }


    throw new Error(
        "Confirmation TRON non obtenue dans le délai. Le TXID est conservé."
    );
}


/* =========================================================
   CHECK EXISTING TX
========================================================= */

async function checkExistingPayoutTransaction(
    payout
) {

    if (
        !payout?.txid
    ) {

        return null;
    }


    try {

        const info =
            await tronWeb
                .trx
                .getTransactionInfo(
                    payout.txid
                );


        if (
            info &&
            info.receipt &&
            info.receipt.result
        ) {

            const result =
                String(
                    info.receipt.result
                )
                    .toUpperCase();


            if (
                result ===
                "SUCCESS"
            ) {

                return {

                    status:
                        "paid",

                    info
                };
            }


            if (
                result ===
                "FAILED"
            ) {

                return {

                    status:
                        "failed",

                    info
                };
            }
        }

    } catch (error) {

        console.warn(
            "Vérification TX existante:",
            error.message
        );
    }


    return {

        status:
            "processing"
    };
}


/* =========================================================
   CREATE / GET PAYOUT
========================================================= */

async function createPayoutRecord(
    player
) {

    const payoutKey =
        `${currentGameId}:${player.playerId}`;


    const amount =
        Number(
            player.amount || 0
        ) * 2;


    if (
        amount <= 0
    ) {

        throw new Error(
            "Montant payout invalide."
        );
    }


    const amountUnits =
        usdtToUnits(
            amount
        );


    try {

        const payout =
            await Payout.create({

                payoutKey,

                gameId:
                    currentGameId,

                playerId:
                    player.playerId,

                playerName:
                    player.playerName,

                destination:
                    player.cryptoAddress,

                amount,

                amountUnits:
                    amountUnits.toString(),

                status:
                    "pending"
            });


        return payout;

    } catch (error) {

        if (
            error?.code === 11000
        ) {

            return Payout.findOne({
                payoutKey
            });
        }


        throw error;
    }
}


/* =========================================================
   PAY ONE WINNER
========================================================= */

async function payWinner(
    player
) {

    const payout =
        await createPayoutRecord(
            player
        );


    if (!payout) {

        throw new Error(
            "Impossible de créer le payout."
        );
    }


    /*
       Déjà payé.
    */

    if (
        payout.status ===
        "paid"
    ) {

        console.log(
            "🟢 Payout déjà payé:",
            payout.payoutKey,
            payout.txid
        );

        return payout;
    }


    /*
       TXID déjà enregistré.
    */

    if (
        payout.txid
    ) {

        console.log(
            "🔐 TXID existant détecté:",
            payout.payoutKey,
            payout.txid
        );


        const existing =
            await checkExistingPayoutTransaction(
                payout
            );


        if (
            existing?.status ===
            "paid"
        ) {

            await Payout.updateOne(
                {
                    _id:
                        payout._id
                },
                {
                    $set: {

                        status:
                            "paid",

                        paidAt:
                            new Date(),

                        error:
                            ""
                    }
                }
            );


            await Player.updateOne(
                {
                    playerId:
                        player.playerId,

                    gameId:
                        payout.gameId
                },
                {
                    $set: {

                        paid:
                            true,

                        payoutStatus:
                            "paid",

                        payoutTxid:
                            payout.txid,

                        payoutAmount:
                            payout.amount,

                        payoutAddress:
                            payout.destination,

                        payoutAt:
                            new Date(),

                        payoutError:
                            "",

                        updatedAt:
                            new Date()
                    }
                }
            );


            return await Payout.findById(
                payout._id
            );
        }


        if (
            existing?.status ===
            "processing"
        ) {

            console.log(
                "🟡 Transaction existante toujours en attente:",
                payout.txid
            );

            return payout;
        }


        if (
            existing?.status ===
            "failed"
        ) {

            await Payout.updateOne(
                {
                    _id:
                        payout._id
                },
                {
                    $set: {

                        status:
                            "failed",

                        error:
                            "Transaction existante échouée. Nouveau paiement automatique bloqué."
                    }
                }
            );


            return await Payout.findById(
                payout._id
            );
        }
    }


    /*
       Verrou MongoDB.
    */

    const locked =
        await Payout.findOneAndUpdate(

            {
                _id:
                    payout._id,

                status: {
                    $in: [
                        "pending",
                        "failed"
                    ]
                },

                txid:
                    ""
            },

            {
                $set: {

                    status:
                        "processing",

                    processingAt:
                        new Date(),

                    error:
                        ""
                }
            },

            {
                new:
                    true
            }
        );


    if (!locked) {

        return await Payout.findById(
            payout._id
        );
    }


    await Player.updateOne(
        {
            playerId:
                player.playerId,

            gameId:
                locked.gameId
        },
        {
            $set: {

                payoutStatus:
                    "processing",

                payoutAmount:
                    locked.amount,

                payoutAddress:
                    locked.destination,

                payoutError:
                    "",

                updatedAt:
                    new Date()
            }
        }
    );


    try {

        /*
           Construire + signer.
        */

        const prepared =
            await buildSignedUsdtTransaction(
                locked.destination,
                locked.amount
            );


        /*
           ==================================================
           ENREGISTRER TXID AVANT BROADCAST
           ==================================================
        */

        const txidLock =
            await Payout.findOneAndUpdate(

                {
                    _id:
                        locked._id,

                    status:
                        "processing",

                    txid:
                        ""
                },

                {
                    $set: {

                        txid:
                            prepared.txid,

                        error:
                            ""
                    }
                },

                {
                    new:
                        true
                }
            );


        if (!txidLock) {

            console.warn(
                "⚠️ Impossible de verrouiller le TXID. Aucun broadcast."
            );

            return await Payout.findById(
                locked._id
            );
        }


        await Player.updateOne(
            {
                playerId:
                    player.playerId,

                gameId:
                    locked.gameId
            },
            {
                $set: {

                    payoutTxid:
                        prepared.txid,

                    updatedAt:
                        new Date()
                }
            }
        );


        /*
           ==================================================
           BROADCAST
           ==================================================
        */

        try {

            await broadcastSignedTransaction(
                prepared.signedTransaction,
                prepared.txid
            );

        } catch (broadcastError) {

            await Payout.updateOne(
                {
                    _id:
                        locked._id
                },
                {
                    $set: {

                        status:
                            "processing",

                        error:
                            broadcastError.message
                    }
                }
            );


            await Player.updateOne(
                {
                    playerId:
                        player.playerId,

                    gameId:
                        locked.gameId
                },
                {
                    $set: {

                        payoutStatus:
                            "processing",

                        payoutTxid:
                            prepared.txid,

                        payoutError:
                            broadcastError.message,

                        updatedAt:
                            new Date()
                    }
                }
            );


            console.error(
                "⚠️ Broadcast incertain. TXID conservé:",
                prepared.txid
            );


            return await Payout.findById(
                locked._id
            );
        }


        console.log(
            "🟡 Payout diffusé:",
            prepared.txid
        );


        /*
           ==================================================
           CONFIRMATION
           ==================================================
        */

        try {

            await waitForTransactionConfirmation(
                prepared.txid
            );

        } catch (confirmationError) {

            await Payout.updateOne(
                {
                    _id:
                        locked._id
                },
                {
                    $set: {

                        status:
                            "processing",

                        error:
                            confirmationError.message
                    }
                }
            );


            await Player.updateOne(
                {
                    playerId:
                        player.playerId,

                    gameId:
                        locked.gameId
                },
                {
                    $set: {

                        payoutStatus:
                            "processing",

                        payoutTxid:
                            prepared.txid,

                        payoutError:
                            confirmationError.message,

                        updatedAt:
                            new Date()
                    }
                }
            );


            console.warn(
                "⚠️ Confirmation non obtenue:",
                prepared.txid
            );


            return await Payout.findById(
                locked._id
            );
        }


        /*
           ==================================================
           PAYE
           ==================================================
        */

        await Payout.updateOne(
            {
                _id:
                    locked._id,

                txid:
                    prepared.txid
            },
            {
                $set: {

                    status:
                        "paid",

                    paidAt:
                        new Date(),

                    error:
                        ""
                }
            }
        );


        await Player.updateOne(
            {
                playerId:
                    player.playerId,

                gameId:
                    locked.gameId
            },
            {
                $set: {

                    paid:
                        true,

                    payoutStatus:
                        "paid",

                    payoutTxid:
                        prepared.txid,

                    payoutAmount:
                        locked.amount,

                    payoutAddress:
                        locked.destination,

                    payoutAt:
                        new Date(),

                    payoutError:
                        "",

                    updatedAt:
                        new Date()
                }
            }
        );


        console.log(
            "🟢 PAYOUT CONFIRME",
            {

                gameId:
                    locked.gameId,

                playerId:
                    locked.playerId,

                amount:
                    locked.amount,

                wallet:
                    locked.destination,

                txid:
                    prepared.txid
            }
        );


        return await Payout.findById(
            locked._id
        );


    } catch (error) {

        console.error(
            "❌ PAYOUT ERROR:",
            {
                gameId:
                    locked.gameId,

                playerId:
                    locked.playerId,

                error:
                    error.message
            }
        );


        const current =
            await Payout.findById(
                locked._id
            );


        /*
           TXID présent :
           surtout ne jamais créer un nouveau paiement.
        */

        if (
            current?.txid
        ) {

            await Payout.updateOne(
                {
                    _id:
                        locked._id
                },
                {
                    $set: {

                        status:
                            "processing",

                        error:
                            error.message
                    }
                }
            );


            await Player.updateOne(
                {
                    playerId:
                        player.playerId,

                    gameId:
                        locked.gameId
                },
                {
                    $set: {

                        payoutStatus:
                            "processing",

                        payoutTxid:
                            current.txid,

                        payoutError:
                            error.message,

                        updatedAt:
                            new Date()
                    }
                }
            );

        } else {

            /*
               Aucun TXID enregistré :
               aucune transaction connue comme diffusée.
            */

            await Payout.updateOne(
                {
                    _id:
                        locked._id
                },
                {
                    $set: {

                        status:
                            "failed",

                        error:
                            error.message
                    }
                }
            );


            await Player.updateOne(
                {
                    playerId:
                        player.playerId,

                    gameId:
                        locked.gameId
                },
                {
                    $set: {

                        payoutStatus:
                            "failed",

                        payoutError:
                            error.message,

                        updatedAt:
                            new Date()
                    }
                }
            );
        }


        return await Payout.findById(
            locked._id
        );
    }
}


/* =========================================================
   PAY TOP 5
========================================================= */

async function payTopFive(
    winners
) {

    console.log(
        "======================================"
    );

    console.log(
        "💰 DEBUT PAYOUT TOP 5"
    );

    console.log(
        "GAME:",
        currentGameId
    );

    console.log(
        "======================================"
    );


    for (
        const winner of winners
    ) {

        try {

            const result =
                await payWinner(
                    winner
                );


            console.log(
                "Payout résultat:",
                {

                    playerId:
                        winner.playerId,

                    wallet:
                        winner.cryptoAddress,

                    amount:
                        result?.amount,

                    status:
                        result?.status,

                    txid:
                        result?.txid || ""
                }
            );

        } catch (error) {

            console.error(
                "❌ Erreur payout joueur:",
                winner.playerId,
                error.message
            );
        }
    }


    console.log(
        "======================================"
    );

    console.log(
        "💰 FIN PAYOUT TOP 5"
    );

    console.log(
        "======================================"
    );
}


/* =========================================================
   START NEW GAME
========================================================= */

async function startNewGame() {

    const nextGameId =
        currentGameId + 1;


    currentGameId =
        nextGameId;


    gameStartedAt =
        new Date();


    gameEndsAt =
        new Date(
            Date.now() +
            GAME_DURATION * 1000
        );


    gameRunning =
        true;


    finishingGame =
        false;


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

    if (
        !gameRunning ||
        finishingGame
    ) {

        return;
    }


    finishingGame =
        true;


    gameRunning =
        false;


    try {

        const players =
            await getCurrentPlayers();


        const winners =
            players.slice(
                0,
                5
            );


        const winnerIds =
            winners.map(
                player =>
                    player.playerId
            );


        /*
           TOP 5 = 2X LA MISE
        */

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

                        payoutStatus:
                            "pending",

                        payoutAmount:
                            Number(
                                player.amount ||
                                0
                            ) * 2,

                        payoutAddress:
                            player.cryptoAddress,

                        payoutError:
                            "",

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

                    payoutStatus:
                        "none",

                    payoutAmount:
                        0,

                    updatedAt:
                        new Date()
                }
            }
        );


        const totalStakes =
            players.reduce(
                (
                    total,
                    player
                ) =>
                    total +
                    Number(
                        player.amount ||
                        0
                    ),
                0
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

                    totalStakes,

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
                                    ) * 2,

                                cryptoAddress:
                                    player.cryptoAddress
                            })
                        )
                }
            }
        );


        io.emit(
            "gameOver",
            {

                gameId:
                    currentGameId,

                winners
            }
        );


        console.log(
            "🏁 Partie terminée:",
            currentGameId
        );


        /*
           PAYOUT AUTOMATIQUE TOP 5
        */

        await payTopFive(
            winners
        );


    } catch (error) {

        console.error(
            "❌ FIN GAME ERROR:",
            error
        );

    } finally {

        setTimeout(
            async () => {

                try {

                    await startNewGame();

                } catch (error) {

                    console.error(
                        "❌ NEW GAME ERROR:",
                        error
                    );

                    finishingGame =
                        false;
                }

            },
            NEW_GAME_DELAY
        );
    }
}


/* =========================================================
   GAME TIMER
========================================================= */

setInterval(
    async () => {

        try {

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

        } catch (error) {

            console.error(
                "GAME TIMER ERROR:",
                error
            );
        }

    },
    1000
);


/* =========================================================
   API ROOT
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
                "online",

            wallet:
                MILTAPE_WALLET
        });
    }
);


/* =========================================================
   API HEALTH
========================================================= */

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

            gameRunning,

            payoutWallet:
                MILTAPE_WALLET
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
            } =
                req.body;


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
                Number(
                    amount
                );


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


            /*
               Joueur existant.
            */

            const existingPlayer =
                await Player.findOne({
                    playerId:
                        cleanPlayerId
                });


            if (
                existingPlayer
            ) {

                const storedAddress =
                    normalizeAddress(
                        existingPlayer.cryptoAddress
                    );


                if (
                    storedAddress &&
                    storedAddress !==
                    normalizedAddress
                ) {

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


            /*
               TXID déjà utilisé.
            */

            const cleanTxid =
                String(
                    txid
                )
                    .trim()
                    .toLowerCase();


            if (
                !/^[a-f0-9]{64}$/
                    .test(cleanTxid)
            ) {

                return res.status(400)
                    .json({

                        success:
                            false,

                        message:
                            "TXID TRON invalide."
                    });
            }


            const existingPayment =
                await Payment.findOne({
                    txid:
                        cleanTxid
                });


            if (
                existingPayment
            ) {

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


            /*
               Vérification blockchain.
            */

            let blockchainPayment;


            try {

                blockchainPayment =
                    await verifyTronUsdtTransaction(
                        cleanTxid,
                        cleanAddress,
                        numericAmount
                    );

            } catch (error) {

                console.error(
                    "Blockchain verification:",
                    error.message
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


            /*
               Expéditeur réel.
            */

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
                            "L'adresse réelle de la transaction ne correspond pas au wallet du joueur."
                    });
            }


            /*
               Destinataire réel.
            */

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


            /*
               Création paiement.
            */

            try {

                await Payment.create({

                    txid:
                        cleanTxid,

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

            } catch (paymentError) {

                if (
                    paymentError?.code === 11000
                ) {

                    return res.status(409)
                        .json({

                            success:
                                false,

                            code:
                                "PAYMENT_ALREADY_USED",

                            message:
                                "Cette transaction vient d'être utilisée par une autre requête."
                        });
                }


                throw paymentError;
            }


            /*
               Joueur.
            */

            let player;


            if (
                existingPlayer
            ) {

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
                    cleanTxid;


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
                            cleanTxid,

                        joined:
                            true,

                        winner:
                            false,

                        reward:
                            0,

                        payoutStatus:
                            "none",

                        payoutAmount:
                            0,

                        payoutAddress:
                            "",

                        payoutTxid:
                            "",

                        payoutError:
                            "",

                        taps:
                            0
                    });
            }


            await broadcastLeaderboard();


            console.log(
                "🟢 PAIEMENT ENTRANT VALIDÉ",
                {

                    playerId:
                        cleanPlayerId,

                    wallet:
                        cleanAddress,

                    amount:
                        numericAmount,

                    txid:
                        cleanTxid
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
                    cleanTxid
            });


        } catch (error) {

            console.error(
                "/api/verify-payment:",
                error
            );


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


            if (
                !player
            ) {

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
   API PAYOUT STATUS
========================================================= */

app.get(
    "/api/payout/:gameId/:playerId",
    async (req, res) => {

        try {

            const payout =
                await Payout.findOne({

                    gameId:
                        Number(
                            req.params.gameId
                        ),

                    playerId:
                        String(
                            req.params.playerId
                        )

                })
                    .lean();


            if (
                !payout
            ) {

                return res.status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Payout introuvable."
                    });
            }


            res.json({

                success:
                    true,

                payout
            });

        } catch (error) {

            console.error(
                "/api/payout:",
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
   API PAYOUTS
========================================================= */

app.get(
    "/api/payouts/:gameId",
    async (req, res) => {

        try {

            const gameId =
                Number(
                    req.params.gameId
                );


            if (
                !Number.isInteger(
                    gameId
                )
            ) {

                return res.status(400)
                    .json({

                        success:
                            false,

                        message:
                            "gameId invalide."
                    });
            }


            const payouts =
                await Payout.find({
                    gameId
                })
                    .sort({
                        createdAt:
                            1
                    })
                    .lean();


            res.json({

                success:
                    true,

                gameId,

                payouts
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


        /* =============================================
           JOIN
        ============================================= */

        socket.on(
            "join",
            async data => {

                try {

                    const {
                        playerId,
                        playerName,
                        cryptoAddress
                    } =
                        data || {};


                    if (
                        !playerId
                    ) {

                        return;
                    }


                    const player =
                        await Player.findOne({

                            playerId:
                                String(
                                    playerId
                                )
                        });


                    if (
                        !player
                    ) {

                        socket.emit(
                            "joinError",
                            {

                                message:
                                    "Paiement requis avant de rejoindre la partie."
                            }
                        );

                        return;
                    }


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


        /* =============================================
           TAP
        ============================================= */

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


                    if (
                        !playerId
                    ) {

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


                    if (
                        !player
                    ) {

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


                    const now =
                        Date.now();


                    const last =
                        player.lastTapAt
                            ? player.lastTapAt.getTime()
                            : 0;


                    /*
                       Anti-spam 40 ms.
                    */

                    if (
                        now -
                        last <
                        40
                    ) {

                        return;
                    }


                    player.score +=
                        1;


                    player.taps +=
                        1;


                    player.lastTapAt =
                        new Date(
                            now
                        );


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


        /* =============================================
           CHAT
        ============================================= */

        socket.on(
            "chatMessage",
            async data => {

                try {

                    const message =
                        sanitizeMessage(
                            data?.message
                        );


                    if (
                        !message
                    ) {

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


                    if (
                        playerId
                    ) {

                        const player =
                            await Player.findOne({
                                playerId
                            })
                                .lean();


                        if (
                            player
                        ) {

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


        /* =============================================
           DISCONNECT
        ============================================= */

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
   RESTORE LAST GAME
========================================================= */

async function restoreGame() {

    const latestGame =
        await Game.findOne({})
            .sort({
                gameId:
                    -1
            })
            .lean();


    /*
       Aucune partie.
    */

    if (
        !latestGame
    ) {

        currentGameId =
            1;


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


        return;
    }


    /*
       Dernière partie terminée.
    */

    if (
        latestGame.finished
    ) {

        currentGameId =
            latestGame.gameId + 1;


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


        return;
    }


    /*
       Dernière partie active.
    */

    currentGameId =
        latestGame.gameId;


    gameStartedAt =
        new Date(
            latestGame.startedAt
        );


    gameEndsAt =
        new Date(
            latestGame.endsAt
        );


    /*
       Si la partie a expiré pendant que Railway
       était arrêté, on ne la considère pas
       comme une nouvelle partie.

       On laisse le timer la terminer.
    */

    gameRunning =
        true;


    console.log(
        "🔄 Partie restaurée:",
        currentGameId
    );


    console.log(
        "⏱️ Temps restant:",
        getTimerLeft(),
        "secondes"
    );
}


/* =========================================================
   START SERVER
========================================================= */

async function startServer() {

    await connectDatabase();


    await restoreGame();


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
                "💰 AUTOMATIC PAYOUT: ENABLED"
            );


            console.log(
                "🔐 DOUBLE PAYMENT PROTECTION: ENABLED"
            );


            console.log(
                "🧾 TXID PRE-REGISTER: ENABLED"
            );


            console.log(
                "🔑 WALLET DERIVED FROM PRIVATE KEY: ENABLED"
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
