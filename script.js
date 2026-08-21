const socket = io("https://miltape-backend-production.up.railway.app", {
    transports: ['websocket'], upgrade: false
});

// DOM
const tapButton = document.getElementById('tapButton');
const tapCount = document.getElementById('tapCount');
const tapButtonCount = document.getElementById('tapButtonCount');
const enterChallenge = document.getElementById('enterChallenge');
const spectatorBtn = document.getElementById('spectatorMode');
const tapMessage = document.getElementById('tapMessage');
const timerDisplay = document.getElementById('timer');
const onlineCount = document.getElementById('onlineCount');
const leaderboardList = document.getElementById('leaderboardList');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatMessages = document.getElementById('chatMessages');
const betInput = document.getElementById('betInput');
const payButton = document.getElementById('payButton');
const demoBtn = document.getElementById('demomodebtn');
const demoStatus = document.getElementById('demoStatus');

const API_URL = "https://miltape-backend-production.up.railway.app";

let isPlaying = false, isPaid = false, isSpectator = false, myPlayerId = null, myBet = 10, myWallet = null;
let demoMode = localStorage.getItem("miltape_demo") === "true" || false;
let currentCombo = 0, lastTapTime = 0;

// Systeme de Toast (Notifications propres)
function showToast(message, type = "success") {
    let toastBox = document.getElementById('toastBox');
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `padding:12px 20px;border-radius:10px;font-weight:bold;color:#fff;font-family:'Orbitron',sans-serif;box-shadow:0 4px 15px rgba(0,0,0,0.5);background:${type === 'error' ? '#ff5b5b' : '#2ecc71'};margin-bottom:10px;`;
    toastBox.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// Systeme de Modale (Remplace le prompt)
function showCustomModal(title, contentHTML, buttonText = "VALIDER") {
    const modal = document.getElementById('dynamicModal');
    document.getElementById('dynamicModalTitle').innerText = title;
    const body = document.getElementById('dynamicModalBody');
    body.innerHTML = contentHTML;
    
    const btn = document.createElement('button');
    btn.innerText = buttonText;
    btn.onclick = () => modal.classList.remove('show');
    body.appendChild(btn);

    modal.classList.add('show');
}

// Telegram
function getTelegramUser() { /*... (Gardez votre fonction, sans emojis)*/ 
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const user = window.Telegram.WebApp.initDataUnsafe?.user;
            if (user && user.username) return user.username;
            if (user && user.first_name) return user.first_name;
        }
        return null;
    } catch (e) { return null; }
}

// Mode Demo
function updateDemoUI() {
    if (demoMode) {
        if (demoStatus) demoStatus.innerText = "MODE DEMO ACTIVE";
        tapMessage.innerText = "MODE DEMO ACTIF - TU PEUX JOUER SANS PAYER !";
    } else {
        if (demoStatus) demoStatus.innerText = "MODE DEMO DESACTIVE";
        tapMessage.innerText = "CHOISIS TA MISE ET CONNECTE TON WALLET";
    }
}
updateDemoUI();
if (demoBtn) demoBtn.addEventListener('click', async () => { /*... Logique sans emojis */ });

// Connexion TronLink (Auto)
async function connectTronWallet() {
    if (!window.tronWeb || !window.tronWeb.defaultAddress) {
        showCustomModal("WALLET", `<input type="text" id="modalWallet" placeholder="Entre ton adresse T..." style="...">`, "CONNECTER");
        setTimeout(() => {
            const btn = document.getElementById('dynamicModalBody').lastElementChild;
            btn.onclick = () => {
                const w = document.getElementById('modalWallet').value;
                document.getElementById('dynamicModal').classList.remove('show');
                finalizeJoin(w);
            };
        }, 100);
        return null;
    }
    try {
        await window.tronWeb.request({ method: 'tron_requestAccounts' });
        const address = window.tronWeb.defaultAddress.base58;
        showToast("WALLET CONNECTE !", "success");
        return address;
    } catch { showToast("CONNEXION REFUSEE", "error"); return null; }
}

async function joinGame() {
    let name = getTelegramUser();
    if (!name) {
        showCustomModal("PSEUDO", `<input type="text" id="modalName" placeholder="Pseudo" style="...">`, "VALIDER");
        setTimeout(() => {
            const btn = document.getElementById('dynamicModalBody').lastElementChild;
            btn.onclick = () => {
                name = document.getElementById('modalName').value;
                document.getElementById('dynamicModal').classList.remove('show');
                proceedWallet(name);
            };
        }, 100);
    } else { proceedWallet(name); }
}

async function proceedWallet(name) {
    let wallet = await connectTronWallet();
    if (wallet) finalizeJoin(wallet, name);
}

function finalizeJoin(wallet, name) {
    let bet = 10;
    if (betInput) {
        const rawBet = parseFloat(betInput.value);
        if (!isNaN(rawBet) && rawBet >= 0.5 && rawBet <= 1000000) bet = rawBet;
    }
    isSpectator = false;
    myBet = bet; myWallet = wallet;
    socket.emit("player:join", { name, wallet, bet });
    localStorage.removeItem("miltape_spectator");
}

if (enterChallenge) enterChallenge.addEventListener('click', joinGame);

// SOCKET EVENTS
socket.on('connect', async () => {
    if (!demoMode) tapMessage.innerText = "CONNECTE AU SERVEUR !";
    await restoreSession();
});

socket.on("player:joined", (data) => {
    if (data.success) {
        isPlaying = true; isPaid = false; isSpectator = false;
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
    if (tapCount) tapCount.innerText = data.taps;
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

socket.on("timer:update", (data) => {
    if (timerDisplay) {
        const m = Math.floor(data.remainingSeconds / 60);
        const s = data.remainingSeconds % 60;
        timerDisplay.innerText = m + ":" + (s < 10 ? "0" : "") + s;
    }
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
        showToast("PAIEMENT DETECTE, TAPE !", "success");
        if (payButton) payButton.style.display = 'none';
    }
});

// TAP (Avec Combo)
if (tapButton) {
    tapButton.addEventListener('click', function(event) {
        if (!isPlaying || !isPaid || isSpectator) {
            if (!isPaid && !isSpectator) tapMessage.innerText = "TU DOIS PAYER TA MISE AVANT DE TAPER !";
            return;
        }

        // Logique de Combo
        const now = Date.now();
        if (now - lastTapTime < 900) { currentCombo++; } else { currentCombo = 1; }
        lastTapTime = now;
        
        if (currentCombo > 1) {
            tapMessage.innerText = "COMBO x" + currentCombo + " ! CONTINUE !";
            setTimeout(() => { if (isPaid) tapMessage.innerText = "TAPE !"; }, 800);
        }

        socket.emit("player:tap");
    });
}

// Chat (Sans emojis)
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) socket.emit("chat:send", { message: text });
    chatInput.value = "";
}
if (chatSend) chatSend.addEventListener('click', sendMessage);
socket.on("chat:message", (data) => {
    if (chatMessages) {
        const div = document.createElement('div');
        div.innerHTML = `<strong>${data.name} :</strong> ${data.message}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});

// ... (Gardez vos fonctions de restauration de session, fin de partie, etc., en supprimant les emojis)
function restoreSession() { /* ... */ }
socket.on("game:finished", (data) => { /* ... */ });
function initiatePayment(wallet, amount) { /* ... */ }
