const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { TronWeb } = require("tronweb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const path = require("path");
const crypto = require("crypto");

// ===== CONFIGURATION =====
const PORT = Number(process.env.PORT) || 3000;
const GAME_DURATION_SECONDS = 10 * 60;
const PREPARATION_DURATION_SECONDS = 2 * 60;
const JACKPOT_PERCENT = 0.05;
const DUEL_COMMISSION_PERCENT = 0.10;
const DUEL_PAYMENT_TIMEOUT_MS = 120000;
const MIN_TAP_INTERVAL_MS = 20;
const REFERRAL_PERCENT = 0.03;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://cryptochaouki-droid.github.io")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

const SUPPORTED_TOKENS = {
  USDT: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6, symbol: "USDT" },
  USDC: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6, symbol: "USDC" },
  TUSD: { contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4", decimals: 6, symbol: "TUSD" },
  TRX: { contract: null, decimals: 6, symbol: "TRX" }
};

const ALLOWED_BETS = [0.50, 1, 2, 4, 8, 16, 32, 64, 128];

// ===== VALIDATION DES VARIABLES D'ENVIRONNEMENT =====
const MONGODB_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const PRIVATE_KEY = (process.env.MILTAPE_PRIVATE_KEY || "").trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_MODE_ENABLED_ON_SERVER = process.env.ALLOW_DEMO_MODE === "true";

if (!MONGODB_URI || !PRIVATE_KEY || !ADMIN_PASSWORD) {
  console.error("❌ Variables d'environnement manquantes. Requis : MONGO_URI, MILTAPE_PRIVATE_KEY, ADMIN_PASSWORD");
  process.exit(1);
}

// ===== GESTION DES ERREURS GLOBALES =====
process.on("uncaughtException", (err) => {
  console.error("❌ Erreur non capturée:", err?.message || err);
  console.error(err?.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Promesse rejetée non gérée:", reason);
});

// ===== INITIALISATION TRONWEB =====
let tronWeb = null;
let MILTAPE_WALLET = "";

try {
  tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}
  });
  tronWeb.setPrivateKey(PRIVATE_KEY);
  MILTAPE_WALLET = tronWeb.address.fromPrivateKey(PRIVATE_KEY);
  console.log("✅ Wallet Miltape :", MILTAPE_WALLET);
} catch (error) {
  console.error("❌ Erreur initialisation TronWeb :", error?.message || error);
  process.exit(1);
}

// ===== INITIALISATION EXPRESS =====
const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);
app.use(helmet({ 
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false // Désactivé pour éviter les conflits avec le frontend
}));

// Configuration CORS
app.use(cors({ 
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origine (comme les apps mobiles)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*")) {
      callback(null, true);
    } else {
      console.warn("⚠️ Origine non autorisée:", origin);
      callback(new Error("Origine non autorisée par CORS"));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Middleware anti-cache
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requêtes max par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes. Réessayez plus tard." }
});
app.use("/api/", limiter);

// ===== INITIALISATION SOCKET.IO =====
const io = new Server(server, { 
  cors: { 
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true
  }, 
  pingInterval: 25000, 
  pingTimeout: 60000 
});

// ===== MODÈLES MONGOOSE =====
const playerSchema = new mongoose.Schema({
  gameId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  wallet: { type: String, trim: true, index: true },
  deviceId: { type: String, trim: true, index: true },
  taps: { type: Number, default: 0, min: 0 },
  weeklyTaps: { type: Number, default: 0 },
  bet: { type: Number, default: 0, min: 0 },
  paid: { type: Boolean, default: false },
  paymentTxId: { type: String, unique: true, sparse: true },
  token: { type: String, default: "USDT" },
  depositAmount: { type: Number, default: null },
  depositExpiresAt: { type: Date, default: null },
  sessionToken: { type: String, unique: true, sparse: true },
  duelPaid: { type: Boolean, default: false },
  duelPaymentTxId: { type: String, sparse: true },
  referralCode: { type: String, unique: true, sparse: true },
  referredByCode: { type: String, default: null },
  referralCounted: { type: Boolean, default: false },
  referralEarnings: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 }
}, { timestamps: true });

const duelEntrySchema = new mongoose.Schema({
  playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
  bet: { type: Number, required: true },
  token: { type: String, default: "USDT" },
  paid: { type: Boolean, default: false },
  paymentTxId: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now }
});

const referralPayoutSchema = new mongoose.Schema({
  referrerId: mongoose.Schema.Types.ObjectId,
  referrerWallet: String,
  referredPlayerId: mongoose.Schema.Types.ObjectId,
  referredName: String,
  referredWallet: String,
  betAmount: Number,
  commission: Number,
  token: String,
  txId: String
}, { timestamps: true });

const messageSchema = new mongoose.Schema({ 
  name: String, 
  message: String, 
  gameId: String 
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({ 
  txId: { type: String, unique: true }, 
  from: String, 
  to: String, 
  amount: Number, 
  verified: Boolean, 
  gameId: String, 
  token: String 
}, { timestamps: true });

const historySchema = new mongoose.Schema({ 
  playerId: mongoose.Schema.Types.ObjectId, 
  playerName: String, 
  wallet: String, 
  gameId: String, 
  rank: Number, 
  bet: Number, 
  gain: Number, 
  taps: Number, 
  token: String, 
  paidOut: Boolean, 
  payoutTxId: String 
}, { timestamps: true });

const jackpotSchema = new mongoose.Schema({ 
  weekStart: Date, 
  weekEnd: Date, 
  accumulatedFund: Number, 
  winner: mongoose.Schema.Types.ObjectId, 
  drawn: Boolean 
}, { timestamps: true });

const gameStateSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['waiting', 'preparing', 'running', 'finished'], default: 'waiting' },
  startedAt: Date,
  endsAt: Date,
  preparationEndsAt: Date,
  durationSeconds: Number,
  updatedAt: { type: Date, default: Date.now }
});

const Player = mongoose.model("Player", playerSchema);
const DuelEntry = mongoose.model("DuelEntry", duelEntrySchema);
const ReferralPayout = mongoose.model("ReferralPayout", referralPayoutSchema);
const Message = mongoose.model("Message", messageSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const History = mongoose.model("History", historySchema);
const Jackpot = mongoose.model("Jackpot", jackpotSchema);
const GameState = mongoose.model("GameState", gameStateSchema);

// ===== CONNEXION MONGODB =====
async function connectMongoDB() {
  try {
    await mongoose.connect(MONGODB_URI, { 
      serverSelectionTimeoutMS: 5000, 
      socketTimeoutMS: 45000, 
      connectTimeoutMS: 10000 
    });
    console.log("✅ MongoDB connecté.");
  } catch (error) {
    console.error("❌ MongoDB erreur :", error?.message || error);
    process.exit(1);
  }
}

// ===== FONCTIONS UTILITAIRES =====
function normalizeWallet(address) { 
  return String(address || "").trim(); 
}

function isValidTronAddress(address) { 
  try { 
    return tronWeb.isAddress(normalizeWallet(address)); 
  } catch { 
    return false; 
  } 
}

function sameWallet(a, b) { 
  return normalizeWallet(a) === normalizeWallet(b); 
}

function generateGameId() { 
  return "GAME-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase(); 
}

function generateSessionToken() { 
  return crypto.randomBytes(32).toString('hex'); 
}

async function generateUniqueReferralCode() {
  for (let i = 0; i < 10; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const exists = await Player.findOne({ referralCode: code });
    if (!exists) return code;
  }
  return "R" + Date.now().toString(36).toUpperCase();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) { 
  const controller = new AbortController(); 
  const id = setTimeout(() => controller.abort(), timeoutMs); 
  try { 
    return await fetch(url, { ...options, signal: controller.signal }); 
  } finally { 
    clearTimeout(id); 
  } 
}

// ===== ÉTAT DU JEU =====
let gameTimer = null;
let nextGameTimeout = null;
const onlineSockets = new Set();

let game = { 
  id: null, 
  status: "waiting", 
  startedAt: null, 
  endsAt: null, 
  durationSeconds: GAME_DURATION_SECONDS, 
  preparationEndsAt: null 
};

// Structures pour les duels
const activeDuels = {};
const duelPools = {};
const pendingDuelPayments = {};
const duelMatches = {};
const lastTapTimestamps = new Map();
const lastDuelTapTimestamps = new Map();

// ===== GESTION DE L'ÉTAT DU JEU =====
async function loadOrCreateGameState() {
  try {
    let gameState = await GameState.findOne().sort({ updatedAt: -1 });
    
    if (!gameState) {
      gameState = new GameState({ 
        gameId: generateGameId(), 
        status: 'preparing', 
        durationSeconds: GAME_DURATION_SECONDS 
      });
      await gameState.save();
    }
    
    game.id = gameState.gameId;
    game.status = gameState.status;
    game.startedAt = gameState.startedAt;
    game.endsAt = gameState.endsAt;
    game.preparationEndsAt = gameState.preparationEndsAt;
    game.durationSeconds = gameState.durationSeconds || GAME_DURATION_SECONDS;
    
    if (game.status === 'waiting' || game.status === 'finished' || !game.id) {
      await startPreparationPhase();
    } else if (game.status === 'preparing' && game.preparationEndsAt) {
      const now = Date.now();
      if (game.preparationEndsAt.getTime() > now) {
        const remaining = game.preparationEndsAt.getTime() - now;
        gameTimer = setTimeout(() => beginActualGame().catch(err => console.error(err)), remaining);
      } else {
        await beginActualGame();
      }
    } else if (game.status === 'running' && game.endsAt) {
      const now = Date.now();
      if (game.endsAt.getTime() > now) {
        const remaining = game.endsAt.getTime() - now;
        gameTimer = setTimeout(() => finishGame().catch(err => console.error(err)), remaining);
      } else {
        await finishGame();
      }
    }
    
    return gameState;
  } catch (error) {
    console.error("❌ Erreur chargement état :", error);
    const newState = new GameState({ 
      gameId: generateGameId(), 
      status: 'preparing', 
      durationSeconds: GAME_DURATION_SECONDS 
    });
    await newState.save();
    await startPreparationPhase();
    return newState;
  }
}

async function saveGameState() {
  try {
    await GameState.findOneAndUpdate(
      { gameId: game.id },
      { 
        status: game.status, 
        startedAt: game.startedAt, 
        endsAt: game.endsAt, 
        preparationEndsAt: game.preparationEndsAt, 
        durationSeconds: game.durationSeconds, 
        updatedAt: new Date() 
      },
      { upsert: true }
    );
  } catch (error) { 
    console.error("❌ Erreur sauvegarde état :", error); 
  }
}

function getRemainingSeconds() {
  if (game.status === "preparing" && game.preparationEndsAt) {
    return Math.max(0, Math.ceil((game.preparationEndsAt.getTime() - Date.now()) / 1000));
  }
  if (game.status !== "running" || !game.endsAt) return 0;
  return Math.max(0, Math.ceil((game.endsAt.getTime() - Date.now()) / 1000));
}

function getGameStateObject() {
  return { 
    id: game.id, 
    status: game.status, 
    startsAt: game.startedAt, 
    endsAt: game.endsAt, 
    remainingSeconds: getRemainingSeconds(), 
    durationSeconds: game.status === "preparing" ? PREPARATION_DURATION_SECONDS : game.durationSeconds, 
    preparationEndsAt: game.preparationEndsAt 
  };
}

// ===== DIFFUSION =====
function broadcastTimer() {
  if (!game.id) return;
  io.emit("timer:update", { 
    gameId: game.id, 
    status: game.status, 
    remainingSeconds: getRemainingSeconds(), 
    endsAt: game.endsAt || game.preparationEndsAt 
  });
}

function broadcastOnlineCount() {
  io.emit("online:count", { count: onlineSockets.size });
}

async function emitLeaderboard() {
  try {
    if (!game.id) return;
    const players = await Player.find({ gameId: game.id })
      .select("name taps -_id")
      .sort({ taps: -1 })
      .limit(50)
      .lean();
    
    io.emit("leaderboard:update", players.map((p, i) => ({ 
      rank: i + 1, 
      name: p.name, 
      taps: p.taps 
    })));
  } catch (error) { 
    console.error("❌ Erreur emitLeaderboard :", error?.message || error); 
  }
}

async function emitTotalStakes() {
  try {
    const result = await Player.aggregate([
      { $match: { gameId: game.id } }, 
      { $group: { _id: null, total: { $sum: "$bet" } } }
    ]);
    
    io.emit("totalStakes:update", { 
      totalStakes: result.length > 0 ? result[0].total : 0 
    });
  } catch (error) { 
    console.error("❌ Erreur emitTotalStakes :", error?.message || error); 
  }
}

async function broadcastGameState() {
  try {
    if (!game.id) return;
    const players = await Player.find({ gameId: game.id })
      .select("name taps -_id")
      .sort({ taps: -1 })
      .limit(50)
      .lean();
    
    io.emit("game:state", { game: getGameStateObject(), players });
    await emitLeaderboard();
    await emitTotalStakes();
  } catch (error) { 
    console.error("❌ Erreur broadcastGameState :", error?.message || error); 
  }
}

// ===== PHASES DU JEU =====
async function startPreparationPhase() {
  console.log("⏳ Démarrage de la phase de préparation (2 minutes)...");
  
  if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
  if (nextGameTimeout) { clearTimeout(nextGameTimeout); nextGameTimeout = null; }
  
  game.id = generateGameId();
  game.status = "preparing";
  game.startedAt = new Date();
  game.endsAt = null;
  game.preparationEndsAt = new Date(Date.now() + PREPARATION_DURATION_SECONDS * 1000);
  
  await saveGameState();
  await Player.updateMany({}, { $set: { taps: 0 } });
  
  io.emit("game:preparing", { 
    gameId: game.id, 
    preparationEndsAt: game.preparationEndsAt, 
    duration: PREPARATION_DURATION_SECONDS 
  });
  broadcastTimer();
  
  gameTimer = setTimeout(() => { 
    beginActualGame().catch(err => console.error(err)); 
  }, PREPARATION_DURATION_SECONDS * 1000);
  
  try { 
    await broadcastGameState(); 
    await emitJackpotUpdate(); 
  } catch (error) { 
    console.error("❌ Erreur post-préparation :", error?.message || error); 
  }
}

async function beginActualGame() {
  if (game.status !== "preparing") return;
  
  console.log("🚀 Le jeu commence ! (10 minutes)");
  game.status = "running";
  game.startedAt = new Date();
  game.endsAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
  game.preparationEndsAt = null;
  await saveGameState();
  
  io.emit("game:started", { 
    gameId: game.id, 
    startsAt: game.startedAt, 
    endsAt: game.endsAt, 
    duration: GAME_DURATION_SECONDS, 
    remainingSeconds: GAME_DURATION_SECONDS 
  });
  broadcastTimer();
  
  gameTimer = setTimeout(() => { 
    finishGame().catch(err => console.error(err)); 
  }, GAME_DURATION_SECONDS * 1000);
  
  try { 
    await broadcastGameState(); 
    await emitJackpotUpdate(); 
  } catch (error) { 
    console.error("❌ Erreur post-démarrage :", error?.message || error); 
  }
}

async function finishGame() {
  if (game.status !== "running") return;
  
  console.log("🏁 Fin de la partie...");
  game.status = "finished";
  if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
  await saveGameState();
  broadcastTimer();
  
  if (nextGameTimeout) clearTimeout(nextGameTimeout);
  nextGameTimeout = setTimeout(() => { 
    startPreparationPhase().catch(err => console.error(err)); 
  }, 3000);
  
  try {
    const players = await Player.find({ gameId: game.id, paid: true }).sort({ taps: -1 });
    
    if (players.length === 0) {
      io.emit("game:finished", { gameId: game.id, winners: [] });
      io.emit("chat:message", { 
        name: "🏆 Système", 
        message: "🏁 La partie est terminée ! Aucun gagnant.", 
        createdAt: new Date() 
      });
      return;
    }
    
    const isDemoGame = players.some(p => p.paymentTxId && p.paymentTxId.startsWith('DEMO_'));
    const topPlayers = players.slice(0, 5);
    const winners = [];
    
    for (let i = 0; i < topPlayers.length; i++) {
      const p = topPlayers[i];
      const gain = Number((p.bet * 2).toFixed(6));
      const history = await History.create({ 
        playerId: p._id, 
        playerName: p.name, 
        wallet: p.wallet, 
        gameId: game.id, 
        rank: i + 1, 
        bet: p.bet, 
        gain, 
        taps: p.taps, 
        token: p.token, 
        paidOut: false 
      });
      winners.push({ player: p, gain, history });
    }
    
    // Envoi des gains
    if (isDemoGame) {
      for (const { history } of winners) { 
        history.paidOut = true; 
        history.payoutTxId = "DEMO_TX_" + Date.now().toString(36); 
        await history.save(); 
      }
    } else {
      for (const { player, gain, history } of winners) {
        try {
          const txId = await sendPrizeToWinner({ 
            wallet: player.wallet, 
            gain, 
            token: player.token, 
            playerName: player.name 
          });
          if (txId) { 
            history.paidOut = true; 
            history.payoutTxId = txId; 
            await history.save(); 
          }
        } catch (e) { 
          console.error("❌ Erreur envoi gain:", e); 
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    const winnersList = topPlayers.map((p, i) => ({ 
      rank: i + 1, 
      name: p.name, 
      taps: p.taps, 
      bet: p.bet, 
      token: p.token, 
      gain: Number((p.bet * 2).toFixed(6)) 
    }));
    
    io.emit("game:finished", { gameId: game.id, winners: winnersList });
    io.emit("chat:message", { 
      name: "🏆 Système", 
      message: `🏁 La partie est terminée ! ${winnersList.length} gagnants !`, 
      createdAt: new Date() 
    });
  } catch (error) { 
    console.error("❌ Erreur finishGame :", error?.message || error); 
  }
}

// ===== ENVOI DE GAINS =====
async function sendPrizeToWinner(historyEntry) {
  try {
    const { wallet, gain, token, playerName } = historyEntry;
    if (!wallet || gain <= 0) return false;
    if (!isValidTronAddress(wallet)) return false;
    
    const tokenInfo = SUPPORTED_TOKENS[token];
    if (!tokenInfo) throw new Error("Token non supporté");
    
    let txId = null;
    
    if (token === "TRX") { 
      const tx = await tronWeb.trx.sendTransaction(wallet, Math.floor(gain * 1e6)); 
      txId = tx.txid; 
    } else { 
      const contract = await tronWeb.contract().at(tokenInfo.contract); 
      const tx = await contract.transfer(wallet, Math.floor(gain * Math.pow(10, tokenInfo.decimals))).send(); 
      txId = tx.txid; 
    }
    
    console.log(`✅ Gain de ${gain} ${token} envoyé à ${playerName}`);
    return txId;
  } catch (error) { 
    console.error("❌ Erreur envoi gain :", error?.message); 
    return null; 
  }
}

// ===== COMMISSION DE PARRAINAGE =====
async function payReferralCommission(referredPlayer, betAmount, token) {
  try {
    if (!referredPlayer.referredByCode) return;
    
    const referrer = await Player.findOne({ referralCode: referredPlayer.referredByCode });
    if (!referrer) return;
    if (sameWallet(referrer.wallet, referredPlayer.wallet)) return; // Anti auto-parrainage
    
    const commission = Number((Number(betAmount) * REFERRAL_PERCENT).toFixed(6));
    if (commission <= 0) return;
    
    const txId = await sendPrizeToWinner({ 
      wallet: referrer.wallet, 
      gain: commission, 
      token, 
      playerName: referrer.name 
    });
    
    referrer.referralEarnings = Number((Number(referrer.referralEarnings || 0) + commission).toFixed(6));
    if (!referredPlayer.referralCounted) {
      referrer.referralCount = Number(referrer.referralCount || 0) + 1;
      referredPlayer.referralCounted = true;
      await referredPlayer.save();
    }
    await referrer.save();
    
    await ReferralPayout.create({
      referrerId: referrer._id,
      referrerWallet: referrer.wallet,
      referredPlayerId: referredPlayer._id,
      referredName: referredPlayer.name,
      referredWallet: referredPlayer.wallet,
      betAmount, 
      commission, 
      token,
      txId: txId || null
    });
  } catch (error) { 
    console.error("❌ Erreur payReferralCommission :", error?.message || error); 
  }
}

// ===== VÉRIFICATION ON-CHAIN =====
async function verifyOnChain(txId, expectedAmount, token = "USDT", expectedSender = null) {
  try {
    const tx = await tronWeb.trx.getTransaction(txId);
    if (!tx) return false;
    
    const contract = tx.raw_data?.contract?.[0];
    if (!contract) return false;
    
    let amount = 0;
    let sender = null;
    
    if (token === "TRX") {
      if (contract.type !== "TransferContract") return false;
      const value = contract.parameter?.value;
      const recipient = tronWeb.address.fromHex(value.to_address);
      if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
      sender = tronWeb.address.fromHex(value.owner_address);
      amount = Number(value.amount) / 1e6;
    } else {
      if (contract.type !== "TriggerSmartContract") return false;
      const value = contract.parameter?.value;
      const contractAddress = tronWeb.address.fromHex(value.contract_address);
      if (!sameWallet(contractAddress, SUPPORTED_TOKENS[token].contract)) return false;
      
      const data = String(value.data || "");
      const recipient = tronWeb.address.fromHex("41" + data.substring(32, 72));
      if (!sameWallet(recipient, MILTAPE_WALLET)) return false;
      sender = tronWeb.address.fromHex(value.owner_address);
      
      const rawAmount = BigInt("0x" + data.substring(72, 136));
      amount = Number(rawAmount) / Math.pow(10, SUPPORTED_TOKENS[token].decimals);
    }
    
    if (expectedSender && !sameWallet(sender, expectedSender)) return false;
    
    const txInfo = await tronWeb.trx.getTransactionInfo(txId);
    if (!txInfo || txInfo.receipt?.result !== "SUCCESS") return false;
    
    return Math.abs(amount - Number(expectedAmount)) < 0.0000001;
  } catch (e) { 
    return false; 
  }
}

// ===== JACKPOT =====
async function getNextSaturday() {
  const now = new Date(); 
  const day = now.getDay(); 
  const diff = (6 - day + 7) % 7; 
  const next = new Date(now);
  next.setDate(now.getDate() + diff); 
  next.setHours(0, 0, 0, 0); 
  if (day === 6 && now.getHours() >= 0) next.setDate(next.getDate() + 7); 
  return next.getTime();
}

async function emitJackpotUpdate() {
  try {
    const weekStart = new Date(); 
    weekStart.setHours(0, 0, 0, 0); 
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    let jackpot = await Jackpot.findOne({ weekStart });
    if (!jackpot) {
      jackpot = await Jackpot.create({ 
        weekStart, 
        weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), 
        accumulatedFund: 0, 
        drawn: false 
      });
    }
    
    io.emit("jackpot:update", { 
      prize: jackpot ? jackpot.accumulatedFund : 0, 
      nextDraw: await getNextSaturday() 
    });
  } catch (error) { 
    console.error("❌ Erreur jackpot :", error?.message || error); 
  }
}

async function distributeWeeklyJackpot() {
  try {
    const weekStart = new Date(); 
    weekStart.setHours(0, 0, 0, 0); 
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    const jackpot = await Jackpot.findOne({ weekStart });
    if (!jackpot || jackpot.drawn || jackpot.accumulatedFund <= 0) return;
    
    const winner = await Player.findOne({})
      .sort({ weeklyTaps: -1 })
      .limit(1)
      .select("name wallet weeklyTaps");
    
    if (!winner || winner.weeklyTaps === 0) return;
    
    jackpot.winner = winner._id; 
    jackpot.drawn = true; 
    await jackpot.save();
    
    const txId = await sendPrizeToWinner({ 
      wallet: winner.wallet, 
      gain: jackpot.accumulatedFund, 
      token: "USDT", 
      playerName: winner.name 
    });
    
    io.emit("jackpot:winner", { 
      winner: winner.name, 
      amount: jackpot.accumulatedFund, 
      taps: winner.weeklyTaps, 
      txId: txId || "pending" 
    });
    
    await Player.updateMany({}, { $set: { weeklyTaps: 0 } });
  } catch (error) { 
    console.error("❌ Erreur distribution jackpot :", error?.message || error); 
  }
}

// Planification du jackpot hebdomadaire
cron.schedule('0 0 * * 6', () => { 
  distributeWeeklyJackpot().catch(err => console.error(err)); 
});

// ===== VÉRIFICATION DES PAIEMENTS =====
async function getIncomingTrxTransactions(address) {
  try {
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=20&order_by=block_timestamp,desc`;
    const res = await fetchWithTimeout(url, { 
      headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} 
    });
    if (!res.ok) return [];
    return (await res.json()).data || [];
  } catch (error) { 
    return []; 
  }
}

async function getIncomingTrc20Transactions(address) {
  try {
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&order_by=block_timestamp,desc`;
    const res = await fetchWithTimeout(url, { 
      headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {} 
    });
    if (!res.ok) return [];
    return (await res.json()).data || [];
  } catch (error) { 
    return []; 
  }
}

async function checkPendingPayments() {
  if (game.status !== "preparing" && game.status !== "running") return;
  
  try {
    const unpaidPlayers = await Player.find({ 
      gameId: game.id, 
      paid: false, 
      bet: { $gt: 0 }, 
      depositAmount: { $ne: null } 
    });
    
    if (unpaidPlayers.length === 0) return;
    
    const allTransactions = [
      ...(await getIncomingTrxTransactions(MILTAPE_WALLET)), 
      ...(await getIncomingTrc20Transactions(MILTAPE_WALLET))
    ];
    
    for (const tx of allTransactions) {
      const txId = tx.transaction_id || tx.txID;
      if (!txId) continue;
      
      let token = null, amount = 0, senderAddress = null;
      
      if (tx.token_info) {
        token = String(tx.token_info.symbol || "").toUpperCase();
        amount = Number(tx.value) / Math.pow(10, Number(tx.token_info.decimals || 6));
        senderAddress = tx.owner_address || tx.from;
      } else if (tx.raw_data?.contract?.[0]) {
        if (tx.raw_data.contract[0].type !== "TransferContract") continue;
        const value = tx.raw_data.contract[0].parameter?.value;
        if (!value) continue;
        const recipient = tronWeb.address.fromHex(value.to_address);
        if (!sameWallet(recipient, MILTAPE_WALLET)) continue;
        token = "TRX";
        amount = Number(value.amount) / 1e6;
        senderAddress = tronWeb.address.fromHex(value.owner_address);
      }
      
      if (!SUPPORTED_TOKENS[token]) continue;
      
      const matchingPlayer = unpaidPlayers.find(p =>
        p.token === token &&
        sameWallet(senderAddress, p.wallet) &&
        Math.abs(amount - Number(p.depositAmount)) < 0.0000001 &&
        !p.paymentTxId?.startsWith('DEMO_')
      );
      
      if (!matchingPlayer) continue;
      
      const alreadyUsed = await Payment.findOne({ txId });
      if (alreadyUsed) continue;
      
      matchingPlayer.paid = true;
      matchingPlayer.paymentTxId = txId;
      matchingPlayer.depositAmount = null;
      matchingPlayer.depositExpiresAt = null;
      await matchingPlayer.save();
      
      await Payment.create({ 
        txId, 
        from: senderAddress, 
        to: MILTAPE_WALLET, 
        amount, 
        verified: true, 
        gameId: game.id, 
        token 
      });
      
      await payReferralCommission(matchingPlayer, matchingPlayer.bet, token);
      
      io.emit("payment:verified", { 
        verified: true, 
        wallet: matchingPlayer.wallet, 
        amount: matchingPlayer.bet, 
        playerName: matchingPlayer.name, 
        token 
      });
      
      io.emit("chat:message", { 
        name: "🟢 Système", 
        message: `✅ ${matchingPlayer.name} a payé ${matchingPlayer.bet} ${token}`, 
        createdAt: new Date() 
      });
      
      // Mise à jour du jackpot
      const weekStart = new Date(); 
      weekStart.setHours(0, 0, 0, 0); 
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const jackpot = await Jackpot.findOne({ weekStart });
      if (jackpot) {
        jackpot.accumulatedFund += (matchingPlayer.bet * JACKPOT_PERCENT);
        await jackpot.save();
      }
    }
  } catch (error) { 
    console.error("❌ Erreur checkPendingPayments :", error?.message || error); 
  }
}

// ===== GESTION DES DUELS =====
async function isDuelTxUsed(txId) {
  const existingPayment = await Payment.findOne({ txId });
  if (existingPayment) return true;
  const existingDuel = await DuelEntry.findOne({ paymentTxId: txId });
  return !!existingDuel;
}

async function tryStartDuel(matchId) {
  const match = duelMatches[matchId];
  if (!match || match.started) return;
  
  const state1 = pendingDuelPayments[match.entry1.socketId];
  const state2 = pendingDuelPayments[match.entry2.socketId];
  if (!state1?.duelPaid || !state2?.duelPaid) return;
  
  match.started = true;
  clearTimeout(match.timeout);
  
  const { entry1, entry2, bet } = match;
  
  const player1 = await Player.findById(entry1.playerId);
  const player2 = await Player.findById(entry2.playerId);
  if (!player1 || !player2) { 
    delete duelMatches[matchId]; 
    return; 
  }
  
  const totalPot = bet * 2;
  const yourCut = totalPot * DUEL_COMMISSION_PERCENT;
  const winnerPrize = totalPot - yourCut;
  
  io.to(entry1.socketId).emit("duel:started", { opponentName: player2.name, bet, prize: winnerPrize });
  io.to(entry2.socketId).emit("duel:started", { opponentName: player1.name, bet, prize: winnerPrize });
  
  const duelId = entry1.socketId;
  activeDuels[duelId] = {
    socket1: entry1.socketId,
    socket2: entry2.socketId,
    player1Id: entry1.playerId,
    player2Id: entry2.playerId,
    bet, 
    winnerPrize,
    endsAt: Date.now() + 60000,
    taps1: 0, 
    taps2: 0
  };
  
  delete pendingDuelPayments[entry1.socketId];
  delete pendingDuelPayments[entry2.socketId];
  delete duelMatches[matchId];
  
  setTimeout(async () => {
    if (!activeDuels[duelId]) return;
    
    const duel = activeDuels[duelId];
    const winnerId = duel.taps1 >= duel.taps2 ? duel.player1Id : duel.player2Id;
    const loserId = winnerId === duel.player1Id ? duel.player2Id : duel.player1Id;
    
    const winner = await Player.findById(winnerId);
    const loser = await Player.findById(loserId);
    
    if (winner) {
      const txId = await sendPrizeToWinner({
        wallet: winner.wallet,
        gain: duel.winnerPrize,
        token: "USDT",
        playerName: winner.name
      });
      
      await Payment.create({ 
        txId, 
        from: MILTAPE_WALLET, 
        to: winner.wallet, 
        amount: duel.winnerPrize, 
        verified: true, 
        gameId: "DUEL", 
        token: "USDT" 
      });
      
      if (loser) {
        await DuelEntry.create({ 
          playerId: loser._id, 
          bet: duel.bet, 
          token: "USDT", 
          paid: false 
        });
      }
      
      io.to(duel.socket1).emit("duel:finished", {
        winnerName: winner.name,
        myTaps: duel.taps1,
        opponentTaps: duel.taps2,
        prize: duel.winnerPrize,
        txId
      });
      
      io.to(duel.socket2).emit("duel:finished", {
        winnerName: winner.name,
        myTaps: duel.taps2,
        opponentTaps: duel.taps1,
        prize: 0,
        txId: null
      });
    }
    
    await Player.updateMany(
      { _id: { $in: [duel.player1Id, duel.player2Id] } },
      { $set: { duelPaid: false, duelPaymentTxId: null } }
    );
    
    delete activeDuels[duelId];
  }, 60000);
}

// ===== SOCKET.IO =====
io.on("connection", async (socket) => {
  onlineSockets.add(socket.id);
  console.log(`🟢 Connexion Socket : ${socket.id}`);
  broadcastOnlineCount();
  
  // Envoyer l'état actuel au nouveau client
  socket.emit("timer:update", { 
    gameId: game.id, 
    status: game.status, 
    remainingSeconds: getRemainingSeconds(), 
    endsAt: game.endsAt || game.preparationEndsAt 
  });
  
  socket.emit("jackpot:update", { 
    prize: 0, 
    nextDraw: await getNextSaturday() 
  });
  
  if (game.status === "preparing" && game.preparationEndsAt) {
    socket.emit("game:preparing", { 
      gameId: game.id, 
      preparationEndsAt: game.preparationEndsAt, 
      duration: PREPARATION_DURATION_SECONDS 
    });
  }
  
  if (game.status === "running" && game.endsAt) {
    socket.emit("game:started", { 
      gameId: game.id, 
      startsAt: game.startedAt, 
      endsAt: game.endsAt, 
      duration: GAME_DURATION_SECONDS, 
      remainingSeconds: getRemainingSeconds() 
    });
  }
  
  // ===== ÉVÉNEMENTS SOCKET =====
  socket.on("timer:request", () => {
    socket.emit("timer:update", { 
      gameId: game.id, 
      status: game.status, 
      remainingSeconds: getRemainingSeconds(), 
      endsAt: game.endsAt || game.preparationEndsAt 
    });
  });
  
  socket.on("player:restore", async (data) => {
    try {
      const token = data.sessionToken;
      if (!token) return socket.emit("player:restored", { success: false });
      
      const player = await Player.findOne({ sessionToken: token });
      if (!player) return socket.emit("player:restored", { success: false });
      
      socket.data.playerId = player._id.toString();
      socket.data.playerName = player.name;
      socket.data.sessionToken = token;
      
      if (player.gameId !== game.id) {
        return socket.emit("player:restored", { 
          success: false, 
          staleRound: true, 
          player: { name: player.name, wallet: player.wallet } 
        });
      }
      
      socket.emit("player:restored", { success: true, player });
    } catch (e) { 
      socket.emit("player:restored", { success: false }); 
    }
  });
  
  socket.on("referral:stats", async () => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) return socket.emit("referral:stats", { success: false });
      
      const player = await Player.findById(playerId)
        .select("referralCode referralEarnings referralCount");
      
      if (!player) return socket.emit("referral:stats", { success: false });
      
      socket.emit("referral:stats", { 
        success: true, 
        referralCode: player.referralCode, 
        referralEarnings: player.referralEarnings, 
        referralCount: player.referralCount 
      });
    } catch (e) { 
      socket.emit("referral:stats", { success: false }); 
    }
  });
  
  socket.on("player:join", async (data) => {
    try {
      const name = String(data?.name || "").trim().substring(0, 30);
      const wallet = normalizeWallet(data?.wallet);
      const deviceId = normalizeWallet(data?.deviceId);
      const bet = Number(data?.bet);
      const token = String(data?.token || "USDT").trim().toUpperCase();
      const referralCodeInput = String(data?.referralCode || "").trim().toUpperCase();
      
      if (!game.id || game.status === "waiting" || game.status === "finished") {
        await startPreparationPhase();
      }
      
      if (!isValidTronAddress(wallet) || !Number.isFinite(bet) || bet <= 0 || !SUPPORTED_TOKENS[token]) {
        return socket.emit("error", { message: "Données invalides." });
      }
      
      const existingPlayer = await Player.findOne({ wallet });
      
      const isSameActiveRound = existingPlayer && 
        existingPlayer.gameId === game.id &&
        (game.status === "preparing" || game.status === "running");
      
      if (isSameActiveRound && existingPlayer.sessionToken) {
        if (!data.sessionToken || data.sessionToken !== existingPlayer.sessionToken) {
          return socket.emit("error", { 
            message: "Ce wallet est déjà utilisé dans cette manche. Connecte-toi avec ton token." 
          });
        }
        
        socket.data.playerId = existingPlayer._id.toString();
        socket.data.playerName = existingPlayer.name;
        socket.data.sessionToken = existingPlayer.sessionToken;
        
        existingPlayer.name = name;
        existingPlayer.gameId = game.id;
        existingPlayer.bet = bet;
        existingPlayer.token = token;
        existingPlayer.paid = false;
        existingPlayer.paymentTxId = undefined;
        existingPlayer.depositAmount = bet;
        existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        
        if (!existingPlayer.referralCode) {
          existingPlayer.referralCode = await generateUniqueReferralCode();
        }
        
        await existingPlayer.save();
        
        socket.emit("player:joined", { 
          success: true, 
          player: existingPlayer, 
          game: getGameStateObject() 
        });
        socket.emit("timer:update", { 
          gameId: game.id, 
          status: game.status, 
          remainingSeconds: getRemainingSeconds(), 
          endsAt: game.endsAt || game.preparationEndsAt 
        });
        await broadcastGameState();
        return;
      }
      
      const sessionToken = generateSessionToken();
      
      if (existingPlayer) {
        existingPlayer.name = name;
        existingPlayer.gameId = game.id;
        existingPlayer.bet = bet;
        existingPlayer.token = token;
        existingPlayer.paid = false;
        existingPlayer.paymentTxId = undefined;
        existingPlayer.depositAmount = bet;
        existingPlayer.depositExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        existingPlayer.sessionToken = sessionToken;
        
        if (!existingPlayer.referralCode) {
          existingPlayer.referralCode = await generateUniqueReferralCode();
        }
        
        await existingPlayer.save();
        
        socket.data.playerId = existingPlayer._id.toString();
        socket.data.playerName = existingPlayer.name;
        socket.data.sessionToken = sessionToken;
        
        socket.emit("player:joined", { 
          success: true, 
          player: existingPlayer, 
          game: getGameStateObject() 
        });
      } else {
        const ownReferralCode = await generateUniqueReferralCode();
        let referredByCode = null;
        
        if (referralCodeInput) {
          const referrer = await Player.findOne({ referralCode: referralCodeInput });
          if (referrer) referredByCode = referralCodeInput;
        }
        
        const player = await Player.create({
          gameId: game.id,
          name,
          wallet,
          deviceId,
          taps: 0,
          weeklyTaps: 0,
          bet,
          paid: false,
          token,
          depositAmount: bet,
          depositExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          sessionToken: sessionToken,
          referralCode: ownReferralCode,
          referredByCode
        });
        
        socket.data.playerId = player._id.toString();
        socket.data.playerName = player.name;
        socket.data.sessionToken = sessionToken;
        
        socket.emit("player:joined", {
          success: true,
          player: {
            id: player._id,
            name: player.name,
            wallet: player.wallet,
            taps: player.taps,
            bet: player.bet,
            paid: player.paid,
            token: player.token,
            depositAmount: player.depositAmount,
            sessionToken: sessionToken,
            referralCode: player.referralCode,
            referralEarnings: player.referralEarnings,
            referralCount: player.referralCount
          },
          game: getGameStateObject()
        });
      }
      
      socket.emit("timer:update", { 
        gameId: game.id, 
        status: game.status, 
        remainingSeconds: getRemainingSeconds(), 
        endsAt: game.endsAt || game.preparationEndsAt 
      });
      await broadcastGameState();
    } catch (error) { 
      console.error("❌ player:join :", error?.message || error); 
      socket.emit("error", { message: "Impossible de rejoindre la partie." }); 
    }
  });
  
  socket.on("player:tap", async () => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId || game.status !== "running") return;
      
      const now = Date.now();
      const lastTap = lastTapTimestamps.get(playerId) || 0;
      if (now - lastTap < MIN_TAP_INTERVAL_MS) return;
      lastTapTimestamps.set(playerId, now);
      
      const result = await Player.findOneAndUpdate(
        { _id: playerId, gameId: game.id, paid: true },
        { $inc: { taps: 1, weeklyTaps: 1 } },
        { new: true }
      ).select("name taps");
      
      if (!result) return;
      
      socket.emit("player:score", { taps: result.taps });
      await emitLeaderboard();
    } catch (error) { 
      console.error("❌ player:tap :", error?.message || error); 
    }
  });
  
  socket.on("chat:send", async (data) => {
    try {
      const name = socket.data.playerName || "Anonyme";
      const message = String(data?.message || "").trim().substring(0, 300);
      if (!message) return;
      
      const msg = await Message.create({ name, message, gameId: game.id });
      io.emit("chat:message", { 
        id: msg._id, 
        name, 
        message, 
        createdAt: msg.createdAt 
      });
    } catch (error) { 
      console.error("❌ chat:send :", error?.message || error); 
    }
  });
  
  // ===== ÉVÉNEMENTS DUEL =====
  socket.on("duel:join", async (data) => {
    const bet = parseFloat(data.bet);
    
    if (!ALLOWED_BETS.includes(bet)) {
      return socket.emit("error", { message: "Mise non autorisée." });
    }
    
    const playerId = socket.data.playerId;
    if (!playerId) return socket.emit("error", { message: "Rejoins d'abord le jeu principal." });
    
    if (!duelPools[bet]) {
      duelPools[bet] = [];
    }
    
    if (duelPools[bet].some(entry => entry.socketId === socket.id)) return;
    
    duelPools[bet].push({ socketId: socket.id, playerId });
    socket.emit("duel:queue", { message: "En attente d'un adversaire à " + bet + " USDT..." });
    
    if (duelPools[bet].length >= 2) {
      const entry1 = duelPools[bet].shift();
      const entry2 = duelPools[bet].shift();
      
      const player1 = await Player.findById(entry1.playerId);
      const player2 = await Player.findById(entry2.playerId);
      
      if (!player1 || !player2) return;
      
      const matchId = entry1.socketId + '_' + entry2.socketId;
      
      pendingDuelPayments[entry1.socketId] = { bet, playerId: entry1.playerId, matchId, duelPaid: false };
      pendingDuelPayments[entry2.socketId] = { bet, playerId: entry2.playerId, matchId, duelPaid: false };
      
      io.to(entry1.socketId).emit("duel:need_payment", { amount: bet, wallet: MILTAPE_WALLET });
      io.to(entry2.socketId).emit("duel:need_payment", { amount: bet, wallet: MILTAPE_WALLET });
      
      const paymentTimeout = setTimeout(() => {
        const match = duelMatches[matchId];
        if (!match || match.started) return;
        
        const state1 = pendingDuelPayments[entry1.socketId];
        const state2 = pendingDuelPayments[entry2.socketId];
        
        io.to(entry1.socketId).emit("duel:cancelled", { 
          message: state1?.duelPaid ? 
            "Ton adversaire n'a pas payé à temps. Tu es remis en file d'attente." : 
            "Tu n'as pas payé à temps. Le duel est annulé." 
        });
        
        io.to(entry2.socketId).emit("duel:cancelled", { 
          message: state2?.duelPaid ? 
            "Ton adversaire n'a pas payé à temps. Tu es remis en file d'attente." : 
            "Tu n'as pas payé à temps. Le duel est annulé." 
        });
        
        if (state1?.duelPaid && !state2?.duelPaid) {
          if (!duelPools[bet]) duelPools[bet] = [];
          duelPools[bet].push({ socketId: entry1.socketId, playerId: entry1.playerId });
        } else if (state2?.duelPaid && !state1?.duelPaid) {
          if (!duelPools[bet]) duelPools[bet] = [];
          duelPools[bet].push({ socketId: entry2.socketId, playerId: entry2.playerId });
        }
        
        delete pendingDuelPayments[entry1.socketId];
        delete pendingDuelPayments[entry2.socketId];
        delete duelMatches[matchId];
      }, DUEL_PAYMENT_TIMEOUT_MS);
      
      duelMatches[matchId] = { entry1, entry2, bet, timeout: paymentTimeout, started: false };
    }
  });
  
  socket.on("duel:payment_verified", async (data) => {
    const { txId } = data;
    const playerId = socket.data.playerId;
    
    if (!playerId) return socket.emit("duel:payment_error", { message: "Non autorisé." });
    if (!txId) return socket.emit("duel:payment_error", { message: "Transaction manquante." });
    
    const pending = pendingDuelPayments[socket.id];
    if (!pending) return socket.emit("duel:payment_error", { message: "Aucun duel en attente de paiement." });
    
    const betAmount = pending.bet;
    
    if (await isDuelTxUsed(txId)) {
      return socket.emit("duel:payment_error", { message: "Transaction déjà utilisée." });
    }
    
    const player = await Player.findById(playerId);
    if (!player) return socket.emit("duel:payment_error", { message: "Joueur introuvable." });
    
    const isValid = await verifyOnChain(txId, betAmount, "USDT", player.wallet);
    
    if (isValid) {
      player.duelPaid = true;
      player.duelPaymentTxId = txId;
      await player.save();
      
      pending.duelPaid = true;
      pending.duelPaymentTxId = txId;
      pendingDuelPayments[socket.id] = pending;
      
      await Payment.create({ 
        txId, 
        from: player.wallet, 
        to: MILTAPE_WALLET, 
        amount: betAmount, 
        verified: true, 
        gameId: "DUEL", 
        token: "USDT" 
      });
      
      await payReferralCommission(player, betAmount, "USDT");
      
      socket.emit("duel:payment_success");
      
      if (pending.matchId) await tryStartDuel(pending.matchId);
    } else {
      socket.emit("duel:payment_error", { message: "Transaction invalide." });
    }
  });
  
  socket.on("duel:tap", () => {
    const now = Date.now();
    const lastTap = lastDuelTapTimestamps.get(socket.id) || 0;
    if (now - lastTap < MIN_TAP_INTERVAL_MS) return;
    lastDuelTapTimestamps.set(socket.id, now);
    
    for (const duelId in activeDuels) {
      const duel = activeDuels[duelId];
      
      if (socket.id === duel.socket1) {
        duel.taps1++;
        io.to(duel.socket1).emit("duel:score", { myTaps: duel.taps1, opponentTaps: duel.taps2 });
        io.to(duel.socket2).emit("duel:score", { myTaps: duel.taps2, opponentTaps: duel.taps1 });
        break;
      } else if (socket.id === duel.socket2) {
        duel.taps2++;
        io.to(duel.socket1).emit("duel:score", { myTaps: duel.taps1, opponentTaps: duel.taps2 });
        io.to(duel.socket2).emit("duel:score", { myTaps: duel.taps2, opponentTaps: duel.taps1 });
        break;
      }
    }
  });
  
  // ===== DÉCONNEXION =====
  socket.on("disconnect", async () => {
    onlineSockets.delete(socket.id);
    console.log(`🔴 Déconnexion Socket : ${socket.id}`);
    broadcastOnlineCount();
    lastDuelTapTimestamps.delete(socket.id);
    
    // Nettoyage des pools de duel
    for (const bet in duelPools) {
      duelPools[bet] = duelPools[bet].filter(entry => entry.socketId !== socket.id);
      if (duelPools[bet].length === 0) delete duelPools[bet];
    }
    
    // Nettoyage des matchs en attente
    for (const matchId in duelMatches) {
      const match = duelMatches[matchId];
      if (!match || match.started) continue;
      
      if (match.entry1.socketId === socket.id || match.entry2.socketId === socket.id) {
        clearTimeout(match.timeout);
        const otherSocketId = match.entry1.socketId === socket.id ? 
          match.entry2.socketId : match.entry1.socketId;
        
        io.to(otherSocketId).emit("duel:cancelled", { 
          message: "Ton adversaire s'est déconnecté. Le duel est annulé." 
        });
        
        delete pendingDuelPayments[match.entry1.socketId];
        delete pendingDuelPayments[match.entry2.socketId];
        delete duelMatches[matchId];
      }
    }
    
    delete pendingDuelPayments[socket.id];
    
    // Gérer un duel actif si le joueur se déconnecte
    for (const duelId in activeDuels) {
      const duel = activeDuels[duelId];
      
      if (duel.socket1 === socket.id || duel.socket2 === socket.id) {
        const opponentSocketId = duel.socket1 === socket.id ? duel.socket2 : duel.socket1;
        const winnerId = duel.socket1 === socket.id ? duel.player2Id : duel.player1Id;
        const winner = await Player.findById(winnerId);
        
        if (winner) {
          const gain = duel.bet * 2 - (duel.bet * 2 * DUEL_COMMISSION_PERCENT);
          const txId = await sendPrizeToWinner({ 
            wallet: winner.wallet, 
            gain, 
            token: "USDT", 
            playerName: winner.name 
          });
          
          io.to(opponentSocketId).emit("duel:finished", { 
            winnerName: winner.name, 
            myTaps: 0, 
            opponentTaps: 0, 
            prize: gain, 
            txId 
          });
        }
        
        await Player.updateMany(
          { _id: { $in: [duel.player1Id, duel.player2Id] } },
          { $set: { duelPaid: false, duelPaymentTxId: null } }
        );
        
        delete activeDuels[duelId];
      }
    }
  });
});

// ===== ROUTES API =====
app.post("/api/demo/verify", async (req, res) => {
  try {
    if (!DEMO_MODE_ENABLED_ON_SERVER) {
      return res.status(403).json({ 
        success: false, 
        message: "Mode démo désactivé sur le serveur (variable ALLOW_DEMO_MODE)." 
      });
    }
    
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ success: false, message: "playerId manquant." });
    
    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: "Joueur introuvable." });
    if (player.gameId !== game.id) {
      return res.status(409).json({ 
        success: false, 
        message: "La manche a changé, rejoins à nouveau." 
      });
    }
    
    player.paid = true;
    player.paymentTxId = "DEMO_" + Date.now().toString(36).toUpperCase() + "_" + 
      Math.random().toString(36).substring(2, 8).toUpperCase();
    player.depositAmount = null;
    player.depositExpiresAt = null;
    await player.save();
    
    io.emit("payment:verified", { 
      verified: true, 
      wallet: player.wallet, 
      amount: player.bet, 
      playerName: player.name, 
      token: player.token 
    });
    
    await broadcastGameState();
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur /api/demo/verify :", error?.message || error);
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});

app.get("/api/wallet", (req, res) => {
  res.json({ success: true, wallet: MILTAPE_WALLET });
});

app.get("/api/game", (req, res) => {
  res.json({ success: true, game: getGameStateObject() });
});

app.get("/api/status", (req, res) => {
  res.json({ 
    success: true, 
    status: "online", 
    gameStatus: game.status, 
    gameId: game.id, 
    remainingSeconds: getRemainingSeconds(), 
    online: onlineSockets.size 
  });
});

app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// ===== TÂCHES PLANIFIÉES =====
setInterval(() => {
  checkPendingPayments().catch(err => console.error("Erreur checkPendingPayments :", err));
}, 7000);

setInterval(() => {
  if (game.status === "preparing" || game.status === "running") broadcastTimer();
}, 1000);

setInterval(() => { 
  emitJackpotUpdate().catch(err => console.error(err)); 
}, 60 * 1000);

// ===== DÉMARRAGE DU SERVEUR =====
async function startServer() {
  try {
    await connectMongoDB();
    await loadOrCreateGameState();
    
    server.listen(PORT, () => {
      console.log("🚀 BACKEND ONLINE (Sécurisé)");
      console.log(`🌐 Port : ${PORT}`);
      console.log(`🎮 État initial du jeu : ${game.status}`);
    });
  } catch (error) { 
    console.error("❌ Impossible de démarrer :", error); 
    process.exit(1); 
  }
}

startServer();

// ===== ARRÊT PROPRE =====
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM reçu. Fermeture propre...");
  
  if (gameTimer) clearTimeout(gameTimer);
  if (nextGameTimeout) clearTimeout(nextGameTimeout);
  
  try { 
    await new Promise((resolve) => server.close(() => resolve())); 
    await mongoose.connection.close(); 
    process.exit(0); 
  } catch (error) { 
    console.error("❌ Erreur fermeture :", error?.message || error); 
    process.exit(1); 
  }
});
