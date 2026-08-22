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

const SUPPORTED_TOKENS = {
    USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
    USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN441q1LZ", decimals: 6, symbol: "USDC" },
    TUSD: { contract: "TUpMhRZL4Ciao6eb6yA3xHPPzLtNQvXsHq", decimals: 6, symbol: "TUSD" },
    TRX:  { contract: null, decimals: 6, symbol: "TRX" }
};

const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MiltapeAdmin2026!";

const JACKPOT_PERCENT = Number(process.env.JACKPOT_PERCENT) || 20;
const JACKPOT_HOUR = 20;

let tronWeb = null;
let MILTAPE_WALLET = "";
let gameTimer = null;
let nextGameTimeout = null;

const onlineSockets = new Set();
const spectatorSockets = new Set();
let processedTxIds = new Set();

let game = { id: null, status: "waiting", startedAt: null, endsAt: null, durationSeconds: GAME_DURATION_SECONDS };

if (!MONGODB_URI) { console.error("❌ MONGO_URI manque."); process.exit(1); }
if (!PRIVATE_KEY) { console.error("❌ MILTAPE_PRIVATE_KEY manque."); process.exit(1); }

try {
    tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io", headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}, privateKey: PRIVATE_KEY });
    MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
} catch (error) { console.error("❌ Erreur TronWeb :", error.message); process.exit(1); }

const app = express();
const server = http.createServer(app);

app.use(helmet());

// ✅ CORS CORRIGÉ
const FRONTEND_ORIGIN = "https://cryptochaouki-droid.github.io/miltape-backend";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

// ✅ ROUTE HEALTHCHECK PLACÉE AVANT LE RATE LIMITER (POUR NE JAMAIS ÊTRE BLOQUÉE)
app.get("/api/status", (req, res) => res.json({ success: true, service: "Miltape Backend", server: "online", mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected", tron: tronWeb ? "connected" : "disconnected", wallet: MILTAPE_WALLET, gameId: game.id || null, status: game.status, timerLeft: 0, onlinePlayers: onlineSockets.size, spectators: spectatorSockets.size, supportedTokens: Object.keys(SUPPORTED_TOKENS) }));

// ✅ RATE LIMITER (sans le skip, car la route est déjà au-dessus)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST"], credentials: true } });
mongoose.set("strictQuery", true);

// (Tous vos schémas, fonctions de jeu, socket.io et routes API sont gardés exactement identiques à votre version précédente)
// ... [Collez ici le reste du code que vous aviez, en enlevant la route /api/status du bas] ...

// ============================================================
// START & ARRÊT PROPRE
// ============================================================
server.listen(PORT, async () => {
    console.log("🚀 BACKEND ONLINE");
    try { await startGame(); } catch (error) { console.error("❌ Impossible de démarrer le jeu :", error.message); }
    setInterval(checkPendingPayments, 15000);
    setInterval(async () => { const now = new Date(); if (now.getDay() === 6 && now.getHours() === JACKPOT_HOUR && now.getMinutes() === 0) await drawJackpot(); }, 60000);
});

async function gracefulShutdown(signal) {
    console.log(`${signal} reçu...`);
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    if (nextGameTimeout) { clearTimeout(nextGameTimeout); nextGameTimeout = null; }
    try { await mongoose.connection.close(); } catch (e) {}
    server.close(() => { console.log("✅ Serveur arrêté."); process.exit(0); });
    setTimeout(() => process.exit(0), 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
