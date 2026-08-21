/* =========================================================
   SCRIPT CLIENT MILTAPE - VERSION FINALE (Chrono + Chat)
========================================================= */

const socket = io("https://miltape-backend-production.up.railway.app", {
    transports: ['websocket'], upgrade: false
});

// ==========================================
// 1. ÉLÉMENTS DU DOM (Correspond au HTML)
// ==========================================
const tapButton = document.getElementById('tapButton');
const tapButtonCount = document.getElementById('tapButtonCount');
const enterChallenge = document.getElementById('enterChallenge');
const spectatorBtn = document.getElementById('spectatorMode');
const tapMessage = document.getElementById('tapMessage');
const timerDisplay = document.getElementById('timer'); // CHRONO
const onlineCount = document.getElementById('onlineCount');
const leaderboardList = document.getElementById('leaderboardList');
const chatInput = document.getElementById('chatInput'); // CHAT
const chatSend = document.getElementById('chatSend'); // CHAT
const chatMessages = document.getElementById('chatMessages'); // CHAT
const betInput = document.getElementById('betInput');
const payButton = document.getElementById('payButton');
const demoBtn = document.getElementById('demomodebtn');
const demoStatus = document.getElementById('demoStatus');

const API_URL = "https://miltape-backend-production.up.railway.app";

let isPlaying = false;
let isPaid = false;
let isSpectator = false;
let myPlayerId = null;
let myBet = 10;
let myWallet = null;
let demoMode = localStorage.getItem("miltape_demo") === "true" || false;

// ==========================================
// 2. SYSTÈME DE TOAST & MODALES (Anti-carrés)
// ==========================================
function showToast(message, type = "success") {
    let toastBox = document.getElementById('toastBox');
    if (!toastBox) {
        toastBox = document.createElement('div');
        toastBox.id = 'toastBox';
        toastBox.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;text-align:center;";
        document.body.appendChild(toastBox);
    }
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `padding:12px 20px;border-radius:10px;font-weight:bold;color:#fff;background:${type === 'error' ? '#ff5b5b' : '#2ecc71'};margin-bottom:10px;font-family:'Orbitron',sans-serif;`;
    toastBox.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showCustomModal(title, contentHTML) {
    const modal = document.getElementById('dynamicModal');
    const titleEl = document.getElementById('dynamicModalTitle');
    const bodyEl = document.getElementById('dynamicModalBody');
    titleEl.innerText = title;
    bodyEl.innerHTML = contentHTML;
    const btn = document.createElement('button');
    btn.innerText = "VALIDER";
    btn.onclick = () => modal.classList.remove('show');
    bodyEl.appendChild(btn);
    modal.classList.add('show');
}

// ==========================================
// 3. TELEGRAM & DEMO
// ==========================================
function getTelegramUser() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const user = window.Telegram.WebApp.initDataUnsafe?.user;
            if (user && user.username) return user.username;
            if (user && user.first_name) return user.first_name;
        }
    } catch (e) { return null; }
    return null;
}

function updateDemoUI() {
    if (demoMode) {
        if (demoStatus) demoStatus.innerText = "MODE DEMO ACTIVE";
        tapMessage.innerText = "MODE DEMO ACTIF - TU PEUX JOUER SANS PAYER !";
    } else {
        if (demoStatus) demoStatus.innerText = "DESACTIVE";
        tapMessage.innerText = "CHOISIS TA MISE ET CONNECTE TON WALLET";
    }
}
updateDemoUI();

if (demoBtn) demoBtn.addEventListener('click', async () => {
    if (demoMode) { demoMode = false; localStorage.setItem("miltape_demo", "false"); updateDemoUI(); showToast("MODE DEMO DESACTIVE"); return; }
    const password = prompt("Mot de passe admin :");
    if (!password) return;
    const res = await fetch(API_URL + "/api/admin/login", { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await res.json();
    if (data.success) { demoMode = true; localStorage.setItem("miltape_demo", "true"); updateDemoUI(); showToast("MODE DEMO ACTIVE"); }
    else showToast("MOT DE PASSE INCORRECT", "error");
});

// ==========================================
// 4. REJOINDRE LA PARTIE (Sans prompt WALLET)
// ==========================================
function joinGame() {
    let name = getTelegramUser() || prompt("Entre ton pseudo :");
    if (!name) return;

    // On propose de connecter le wallet ou de le saisir manuellement
    let wallet = null;
    if (window.tronWeb && window.tronWeb.defaultAddress) {
        wallet = window.tronWeb.defaultAddress.base58;
    } else {
        wallet = prompt("Entre ton adresse TRON (ex: T...) :");
    }

    let bet = 10;
    if (betInput) {
        const rawBet = parseFloat(betInput.value);
        if (!isNaN(rawBet) && rawBet >= 0.5 && rawBet <= 1000000) bet = rawBet;
    }

    if (name && wallet) {
        isSpectator = false;
        myBet = bet;
        myWallet = wallet;
        socket.emit("player:join", { name, wallet, bet });
        localStorage.removeItem("miltape_spectator");
        tapMessage.innerText = "CONNEXION AU SERVEUR EN COURS...";
    }
}

if (enterChallenge) enterChallenge.addEventListener('click', joinGame);

// ==========================================
// 5. ⏱️ LE CHRONO (RÉPARÉ)
// ==========================================
socket.on("timer:update", (data) => {
    if (timerDisplay) {
        const m = Math.floor(data.remainingSeconds / 60);
        const s = data.remainingSeconds % 60;
        timerDisplay.innerText = m + ":" + (s < 10 ? "0" : "") + s;
    }
});

// ==========================================
// 6. 💬 LE CHAT (RÉPARÉ)
// ==========================================
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        socket.emit("chat:send", { message: text });
        chatInput.value = "";
    }
}
if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

socket.on("chat:message", (data) => {
    if (chatMessages) {
        const div = document.createElement('div');
        div.className = 'chat-message';
        div.innerHTML = `<strong>${data.name} :</strong> ${data.message}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});

// ==========================================
// 7. GESTION DU JEU (Score, Leaderboard, Paiement)
// ==========================================
socket.on('connect', async () => {
    if (!demoMode) tapMessage.innerText = "CONNECTE AU SERVEUR !";
    await restoreSession();
});

socket.on("player:joined", (data) => {
    if (data.success) {
        isPlaying = true;
        isPaid = false;
        isSpectator = false;
        myPlayerId = data.player.id;
        tapButton.disabled = true;
        tapMessage.innerText = data.player.name + ", PAIE TA MISE POUR TAPER !";
        
        if (demoMode) {
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = "MODE DEMO : TAPE !";
            fetch(API_URL + "/api/payment/verify", { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({txId: "DEMO_"+Date.now(), wallet: data.player.wallet, amount: data.player.bet, playerId: data.player.id})}).catch(()=>{});
        } else {
            if (payButton) { payButton.style.display = 'block'; payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet); }
        }
    }
});

socket.on("player:score", (data) => {
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

socket.on("online:count", (count) => {
    if (onlineCount) onlineCount.innerText = count + " EN LIGNE";
});

socket.on("leaderboard:update", (leaderboard) => {
    if (leaderboardList) {
        leaderboardList.innerHTML = "";
        if (leaderboard.length === 0) { leaderboardList.innerHTML = "<div style='color:#888;padding:10px;'>Aucun joueur</div>"; return; }
        leaderboard.forEach(p => {
            leaderboardList.innerHTML += `<div class="leaderboard-item"><span>#${p.rank}</span><span>${p.name}</span><span style="color:#ffcc00;">${p.taps} TAPS</span></div>`;
        });
    }
});

socket.on("payment:verified", (data) => {
    if (data.verified && !isSpectator) {
        isPaid = true;
        tapButton.disabled = false;
        showToast("PAIEMENT DETECTE, TAPE !");
        if (payButton) payButton.style.display = 'none';
    }
});

// ==========================================
// 8. TAP (Avec Combo)
// ==========================================
let currentCombo = 0;
let lastTapTime = 0;

if (tapButton) {
    tapButton.addEventListener('click', function() {
        if (!isPlaying || !isPaid || isSpectator) {
            if (!isPaid && !isSpectator) tapMessage.innerText = "TU DOIS PAYER TA MISE AVANT DE TAPER !";
            return;
        }
        
        const now = Date.now();
        if (now - lastTapTime < 900) { currentCombo++; } else { currentCombo = 1; }
        lastTapTime = now;
        
        if (currentCombo > 1) { tapMessage.innerText = "COMBO x" + currentCombo + " ! CONTINUE !"; }
        else { tapMessage.innerText = "TAPE !"; }

        socket.emit("player:tap");
    });
}

// ==========================================
// 9. PAIEMENT & SPECTATEUR
// ==========================================
function initiatePayment(wallet, amount) {
    fetch(API_URL + "/api/wallet").then(res => res.json()).then(data => {
        if (data.success) {
            const serverWallet = data.wallet;
            const paymentUrl = `https://t.me/wallet?start=transfer?to=${serverWallet}&amount=${amount}&token=USDT`;
            window.open(paymentUrl, '_blank');
            showToast("ENVOIE " + amount + " USDT VERS : " + serverWallet);
        } else { showToast("IMPOSSIBLE DE RECUPERER LE WALLET", "error"); }
    }).catch(() => showToast("ERREUR RESEAU", "error"));
}

function joinSpectator() {
    const name = getTelegramUser() || "Spectateur";
    isSpectator = true;
    isPlaying = true;
    isPaid = true;
    tapButton.disabled = true;
    enterChallenge.style.display = 'none';
    if (payButton) payButton.style.display = 'none';
    if (betInput) betInput.disabled = true;
    tapMessage.innerText = "MODE SPECTATEUR";
    socket.emit("spectator:join", { name });
}
if (spectatorBtn) spectatorBtn.addEventListener('click', joinSpectator);

socket.on("spectator:joined", (data) => {
    if (data.success) {
        isSpectator = true;
        isPlaying = true;
        isPaid = true;
        tapButton.disabled = true;
        tapMessage.innerText = "VOUS REGARDEZ EN DIRECT (" + data.spectators + " SPECTATEURS)";
    }
});

// ==========================================
// 10. RESTAURATION & FIN DE JEU
// ==========================================
async function restoreSession() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const spectator = localStorage.getItem("miltape_spectator") === "true";
    if (spectator) {
        isSpectator = true;
        isPlaying = true;
        tapButton.disabled = true;
        return true;
    }
    if (!playerId || !wallet) return false;
    socket.emit("player:restore", { playerId, wallet });
    return true;
}

socket.on("player:restored", (data) => {
    if (data.success) {
        isPlaying = true;
        isPaid = data.player.paid; // Si déjà payé, on peut taper direct
        myPlayerId = data.player.id;
        tapButton.disabled = !isPaid;
        tapMessage.innerText = isPaid ? "BON RETOUR " + data.player.name + " ! TAPE !" : "PAIE TA MISE POUR CONTINUER !";
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;
    } else {
        localStorage.clear();
        enterChallenge.style.display = 'block';
        tapMessage.innerText = "REJOINS LA NOUVELLE PARTIE !";
    }
});

socket.on("game:finished", (data) => {
    if (tapButtonCount) tapButtonCount.innerText = "0";
    tapButton.disabled = true;
    isPlaying = false;
    isPaid = false;
    isSpectator = false;
    localStorage.clear();
    alert("PARTIE TERMINEE ! LES 5 PREMIERS GAGNENT 2X LEUR MISE !");
    tapMessage.innerText = "PARTIE TERMINEE ! PROCHAINE PARTIE DANS 5 SEC...";
    enterChallenge.style.display = 'block';
    if (payButton) payButton.style.display = 'none';
});

// ==========================================
// 11. MENU (Simple)
// ==========================================
const menuButton = document.getElementById('menuButton');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');

function toggleMenu() {
    if (sideMenu) sideMenu.classList.toggle('show');
    if (menuOverlay) menuOverlay.classList.toggle('show');
}
if (menuButton) menuButton.addEventListener('click', toggleMenu);
if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);

// Boutons du menu
document.getElementById('menuRulesBtn')?.addEventListener('click', () => showCustomModal("REGLES", "10 MINUTES - TOP 5 - USDT TRC20"));
document.getElementById('menuGamesBtn')?.addEventListener('click', () => showCustomModal("MES PARTIES", "Aucune partie enregistree."));
