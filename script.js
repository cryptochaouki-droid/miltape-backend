const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

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

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

let client;
let db;
let games;
let players;
let messages;


/* =====================================================
   MONGODB
===================================================== */

async function connectMongoDB() {

    if (!MONGODB_URI) {
        throw new Error(
            "MONGODB_URI n'est pas configurée dans Railway"
        );
    }

    client = new MongoClient(MONGODB_URI);

    await client.connect();

    db = client.db("miltape");

    games = db.collection("games");
    players = db.collection("players");
    messages = db.collection("messages");

    await players.createIndex({
        gameId: 1,
        score: -1
    });

    await messages.createIndex({
        createdAt: -1
    });

    console.log("✅ MongoDB connecté");
}


/* =====================================================
   PARTIE ACTIVE
===================================================== */

async function getActiveGame() {

    let game = await games.findOne({
        status: {
            $in: ["waiting", "running"]
        },
        endsAt: {
            $gt: new Date()
        }
    });

    if (!game) {

        const now = new Date();

        const endsAt = new Date(
            now.getTime() + 10 * 60 * 1000
        );

        const result =
            await games.insertOne({
                status: "running",
                startsAt: now,
                endsAt: endsAt,
                createdAt: now
            });

        game =
            await games.findOne({
                _id: result.insertedId
            });

        console.log("🎮 Nouvelle partie créée");
    }

    return game;
}


/* =====================================================
   ACCUEIL / HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {

    res.json({
        success: true,
        project: "Miltape World Challenge",
        status: "online",
        database:
            db
                ? "connected"
                : "not connected"
    });

});


/* =====================================================
   GAME
===================================================== */

app.get("/api/game", async (req, res) => {

    try {

        const game =
            await getActiveGame();

        res.json({
            success: true,

            game: {
                id:
                    game._id.toString(),

                status:
                    game.status,

                startsAt:
                    game.startsAt,

                endsAt:
                    game.endsAt
            }
        });

    } catch (error) {

        console.error(
            "GAME ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            error: "GAME_ERROR"
        });
    }

});


/* =====================================================
   JOIN
===================================================== */

app.post("/api/join", async (req, res) => {

    try {

        const playerId =
            String(
                req.body.playerId || ""
            ).trim();

        const playerName =
            String(
                req.body.playerName || ""
            )
            .trim()
            .slice(0, 30);

        if (!playerId || !playerName) {

            return res.status(400).json({
                success: false,
                error: "PLAYER_REQUIRED"
            });
        }

        const game =
            await getActiveGame();

        await players.updateOne(

            {
                playerId: playerId,
                gameId: game._id
            },

            {
                $set: {
                    playerId:
                        playerId,

                    playerName:
                        playerName,

                    gameId:
                        game._id,

                    updatedAt:
                        new Date()
                },

                $setOnInsert: {
                    score: 0,

                    createdAt:
                        new Date()
                }
            },

            {
                upsert: true
            }
        );

        res.json({

            success: true,

            game: {
                id:
                    game._id.toString(),

                endsAt:
                    game.endsAt
            }
        });

    } catch (error) {

        console.error(
            "JOIN ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            error: "JOIN_ERROR"
        });
    }

});


/* =====================================================
   TAP
===================================================== */

app.post("/api/tap", async (req, res) => {

    try {

        const playerId =
            String(
                req.body.playerId || ""
            ).trim();

        if (!playerId) {

            return res.status(400).json({
                success: false,
                error: "PLAYER_REQUIRED"
            });
        }

        const game =
            await getActiveGame();

        if (
            new Date() >=
            new Date(game.endsAt)
        ) {

            await games.updateOne(
                {
                    _id: game._id
                },
                {
                    $set: {
                        status:
                            "finished"
                    }
                }
            );

            return res.status(400).json({
                success: false,
                error: "GAME_FINISHED"
            });
        }

        const result =
            await players.findOneAndUpdate(

                {
                    playerId:
                        playerId,

                    gameId:
                        game._id
                },

                {
                    $inc: {
                        score: 1
                    },

                    $set: {
                        updatedAt:
                            new Date()
                    }
                },

                {
                    returnDocument:
                        "after"
                }
            );

        if (!result) {

            return res.status(400).json({
                success: false,
                error:
                    "PLAYER_NOT_IN_GAME"
            });
        }

        const score =
            result.score;

        io.emit(
            "leaderboard:update"
        );

        res.json({
            success: true,
            score: score
        });

    } catch (error) {

        console.error(
            "TAP ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            error: "TAP_ERROR"
        });
    }

});


/* =====================================================
   TOP 5
===================================================== */

app.get(
    "/api/leaderboard",
    async (req, res) => {

        try {

            const game =
                await getActiveGame();

            const topPlayers =
                await players
                    .find({
                        gameId:
                            game._id
                    })
                    .sort({
                        score: -1
                    })
                    .limit(5)
                    .toArray();

            res.json({

                success: true,

                players:
                    topPlayers.map(
                        (player, index) => ({

                            position:
                                index + 1,

                            playerId:
                                player.playerId,

                            playerName:
                                player.playerName,

                            score:
                                player.score || 0
                        })
                    )
            });

        } catch (error) {

            console.error(
                "LEADERBOARD ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "LEADERBOARD_ERROR"
            });
        }

    }
);


/* =====================================================
   CHAT - LIRE
===================================================== */

app.get(
    "/api/chat",
    async (req, res) => {

        try {

            const chat =
                await messages
                    .find({})
                    .sort({
                        createdAt: -1
                    })
                    .limit(100)
                    .toArray();

            res.json({

                success: true,

                messages:
                    chat
                        .reverse()
                        .map(
                            message => ({

                                playerName:
                                    message.playerName,

                                message:
                                    message.message,

                                createdAt:
                                    message.createdAt
                            })
                        )
            });

        } catch (error) {

            console.error(
                "CHAT ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "CHAT_ERROR"
            });
        }

    }
);


/* =====================================================
   CHAT - ENVOYER
===================================================== */

app.post(
    "/api/chat",
    async (req, res) => {

        try {

            const playerId =
                String(
                    req.body.playerId || ""
                ).trim();

            const playerName =
                String(
                    req.body.playerName || ""
                )
                .trim()
                .slice(0, 30);

            const message =
                String(
                    req.body.message || ""
                )
                .trim()
                .slice(0, 250);

            if (
                !playerId ||
                !playerName ||
                !message
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "MESSAGE_REQUIRED"
                });
            }

            const newMessage = {

                playerId:
                    playerId,

                playerName:
                    playerName,

                message:
                    message,

                createdAt:
                    new Date()
            };

            await messages.insertOne(
                newMessage
            );

            io.emit(
                "chat:new",
                newMessage
            );

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "CHAT SEND ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "CHAT_SEND_ERROR"
            });
        }

    }
);


/* =====================================================
   SOCKET.IO
===================================================== */

io.on(
    "connection",
    socket => {

        console.log(
            "👤 Joueur connecté:",
            socket.id
        );

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "👋 Joueur déconnecté:",
                    socket.id
                );

            }
        );

    }
);


/* =====================================================
   START SERVER
===================================================== */

async function startServer() {

    try {

        await connectMongoDB();

        server.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `🚀 Miltape lancé sur le port ${PORT}`
                );

            }
        );

    } catch (error) {

        console.error(
            "❌ ERREUR SERVEUR:",
            error.message
        );

        process.exit(1);
    }
}


startServer();
