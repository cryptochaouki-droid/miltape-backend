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

let db;
let games;
let players;
let messages;

async function connectMongoDB() {

    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI n'est pas configurée dans Railway");
    }

    const client = new MongoClient(MONGODB_URI);

    await client.connect();

    db = client.db("miltape");

    games = db.collection("games");
    players = db.collection("players");
    messages = db.collection("messages");

    console.log("✅ MongoDB connecté");
}


/* =====================================================
   PARTIE ACTIVE (GÉRÉE EN BOUCLE TOUTES LES 10 MINUTES)
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
        // S'il n'y a plus de jeu actif ou que les 10 min sont passées, on clôture les anciens et on en crée un nouveau
        await games.updateMany(
            { status: { $in: ["waiting", "running"] } },
            { $set: { status: "finished" } }
        );

        const now = new Date();

        const endsAt = new Date(
            now.getTime() + 10 * 60 * 1000
        );

        const result = await games.insertOne({
            status: "running",
            startsAt: now,
            endsAt,
            createdAt: now
        });

        game = await games.findOne({
            _id: result.insertedId
        });

        console.log("🎮 Nouvelle partie globale de 10 minutes créée");
        
        // Informer tous les clients connectés qu'une nouvelle partie commence
        io.emit("game:restart");
    }

    return game;
}


/* =====================================================
   TEST
===================================================== */

app.get("/", (req, res) => {

    res.json({
        success: true,
        project: "Miltape World Challenge",
        status: "online",
        database: db ? "connected" : "not connected"
    });

});


/* =====================================================
   GAME (RÉCUPÉRER LE TEMPS RESTANT GLOBAL)
===================================================== */

app.get("/api/game", async (req, res) => {

    try {

        const game = await getActiveGame();

        res.json({
            success: true,
            game: {
                id: game._id.toString(),
                status: game.status,
                startsAt: game.startsAt,
                endsAt: game.endsAt
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "GAME_ERROR"
        });

    }

});


/* =====================================================
   JOIN (AVEC VÉRIFICATION DU PSEUDO UNIQUE)
===================================================== */

app.post("/api/join", async (req, res) => {

    try {

        const playerId =
            String(req.body.playerId || "");

        const playerName =
            String(req.body.playerName || "")
                .trim()
                .slice(0, 30);

        if (!playerId || !playerName) {

            return res.status(400).json({
                success: false,
                error: "PLAYER_REQUIRED"
            });

        }

        const game = await getActiveGame();

        // Vérifier si un autre joueur dans cette partie utilise déjà ce pseudo (insensible à la casse)
        const existingPlayer = await players.findOne({
            gameId: game._id,
            playerId: { $ne: playerId },
            playerName: { $regex: new RegExp("^" + playerName + "$", "i") }
        });

        if (existingPlayer) {
            return res.status(400).json({
                success: false,
                error: "Ce pseudo est déjà pris, choisis-en un autre !"
            });
        }

        await players.updateOne(

            {
                playerId,
                gameId: game._id
            },

            {
                $set: {
                    playerId,
                    playerName,
                    gameId: game._id,
                    updatedAt: new Date()
                },

                $setOnInsert: {
                    score: 0,
                    createdAt: new Date()
                }
            },

            {
                upsert: true
            }
        );

        res.json({

            success: true,

            game: {
                id: game._id.toString(),
                endsAt: game.endsAt
            }

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "JOIN_ERROR"
        });

    }

});


/* =====================================================
   TAP (OPTIMISÉ AVEC SUPPORT DU BATCH DE CLICS)
===================================================== */

app.post("/api/tap", async (req, res) => {

    try {

        const playerId = String(req.body.playerId || "");
        const tapCount = parseInt(req.body.count || 1, 10);

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: "PLAYER_REQUIRED"
            });
        }

        const game = await getActiveGame();

        if (new Date() >= new Date(game.endsAt)) {

            await games.updateOne(
                {
                    _id: game._id
                },
                {
                    $set: {
                        status: "finished"
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
                    playerId,
                    gameId: game._id
                },

                {
                    $inc: {
                        score: tapCount
                    },

                    $set: {
                        updatedAt: new Date()
                    }
                },

                {
                    returnDocument: "after"
                }
            );

        if (!result) {

            return res.status(400).json({
                success: false,
                error: "PLAYER_NOT_IN_GAME"
            });

        }

        io.emit("leaderboard:update");

        res.json({
            success: true,
            score: result.score
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "TAP_ERROR"
        });

    }

});


/* =====================================================
   LEADERBOARD TOP 5
===================================================== */

app.get("/api/leaderboard", async (req, res) => {

    try {

        const game = await getActiveGame();

        const topPlayers =
            await players
                .find({
                    gameId: game._id
                })
                .sort({
                    score: -1
                })
                .limit(5)
                .toArray();

        res.json({

            success: true,

            players: topPlayers.map(
                (player, index) => ({
                    position: index + 1,
                    playerId: player.playerId,
                    playerName: player.playerName,
                    score: player.score
                })
            )

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "LEADERBOARD_ERROR"
        });

    }

});


/* =====================================================
   CHAT — LIRE
===================================================== */

app.get("/api/chat", async (req, res) => {

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

            messages: chat.reverse().map(
                message => ({
                    playerName: message.playerName,
                    message: message.message,
                    createdAt: message.createdAt
                })
            )

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "CHAT_ERROR"
        });

    }

});


/* =====================================================
   CHAT — ENVOYER
===================================================== */

app.post("/api/chat", async (req, res) => {

    try {

        const playerId =
            String(req.body.playerId || "");

        const playerName =
            String(req.body.playerName || "")
                .trim()
                .slice(0, 30);

        const message =
            String(req.body.message || "")
                .trim()
                .slice(0, 250);

        if (!playerId || !playerName || !message) {

            return res.status(400).json({
                success: false,
                error: "MESSAGE_REQUIRED"
            });

        }

        const newMessage = {

            playerId,

            playerName,

            message,

            createdAt: new Date()

        };

        await messages.insertOne(newMessage);

        io.emit(
            "chat:new",
            newMessage
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "CHAT_SEND_ERROR"
        });

    }

});


/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {

    console.log("👤 Joueur connecté :", socket.id);

    // Diffuser le nombre exact de clients connectés à tout le monde
    io.emit("online:count", io.engine.clientsCount);

    socket.on("disconnect", () => {
        console.log("👋 Joueur déconnecté :", socket.id);

        // Mettre à jour le compteur lorsqu'un joueur quitte
        io.emit("online:count", io.engine.clientsCount);
    });

});


/* =====================================================
   START
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
            "❌ ERREUR SERVEUR :",
            error.message
        );

        process.exit(1);
    }
}

startServer();
