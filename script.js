/* =========================================================
   SCRIPT CLIENT MILTAPE – Version Railway (avec paiement)
========================================================= */

// 1. Connexion Socket.IO – URL RAILWAY
const socket = io("https://miltape-backend-production.up.railway.app", {
    transports: ['websocket'], // Force WebSocket
    upgrade: false
});

// 2. Éléments DOM
const tapButton = document.getElementById('tapButton');
const tapCount = document.getElementById('tapCount');
const tapButtonCount = document.getElementById('tapButtonCount');
const enterChallenge = document.getElementById('enterChallenge');
const enterChallengeTop = document.getElementById('enterChallengeTop');
const tapMessage = document.getElementById('tapMessage');
const timerDisplay = document.getElementById('timer');
const onlineCount = document.getElementById('onlineCount');
const leaderboardList = document.getElementById('leaderboardList');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatMessages = document.getElementById('chatMessages');

// Éléments pour la mise et le paiement
const betInput = document.getElementById('betInput');
const payButton = document.getElementById('payButton');
const verifyPaymentBtn = document.getElementById('verifyPaymentBtn');

let isPlaying = false;
let myPlayerId = null;
let myBet = 10;
let myWallet = null;

const API_URL = "https://miltape-backend-production.up.railway.app";

// ==========================================
// 3. LOGS DE CONNEXION
// ==========================================
socket.on('connect', () => {
    console.log('✅ Socket connecté avec ID :', socket.id);
    tapMessage.innerText = "✅ Connecté au serveur !";
});

socket.on('connect_error', (err) => {
    console.error('❌ Erreur de connexion Socket :', err.message);
    tapMessage.innerText = "⚠️ Erreur de connexion au serveur.";
});

socket.on('disconnect', (reason) => {
    console.log('🔴 Socket déconnecté :', reason);
    tapMessage.innerText = "🔴 Déconnecté du serveur.";
});

// ==========================================
// 4. REJOINDRE LA PARTIE (avec mise flexible)
// ==========================================
function joinGame() {
    const name = prompt("Entre ton pseudo pour le classement :");
    const wallet = prompt("Entre ton adresse TRON (ex: T...) :");
    
    // Lire la mise depuis le champ (0.50 à 1 000 000)
    let bet = 10; // valeur par défaut
    if (betInput) {
        const rawBet = parseFloat(betInput.value);
        if (!isNaN(rawBet) && rawBet >= 0.5 && rawBet <= 1000000) {
            bet = rawBet;
        } else {
            alert("⚠️ Mise invalide. Utilisation de 10 USDT par défaut.");
        }
    }
    
    if (name && wallet) {
        myBet = bet;
        myWallet = wallet;
        tapMessage.innerText = "Connexion au serveur en cours...";
        socket.emit("player:join", { name, wallet, bet });
    }
}

if (enterChallenge) enterChallenge.addEventListener('click', joinGame);
if (enterChallengeTop) enterChallengeTop.addEventListener('click', joinGame);

// ==========================================
// 5. CONFIRMATION D'ENTRÉE – AFFICHAGE DES BOUTONS DE PAIEMENT
// ==========================================
socket.on("player:joined", (data) => {
    if (data.success) {
        isPlaying = true;
        myPlayerId = data.player.id;
        tapButton.disabled = false;
        tapMessage.innerText = `🔥 C'est parti ${data.player.name} ! Clique au maximum !`;
        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        // Afficher les boutons de paiement
        if (payButton) {
            payButton.style.display = 'block';
            payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet);
        }
        if (verifyPaymentBtn) {
            verifyPaymentBtn.style.display = 'block';
            verifyPaymentBtn.onclick = () => verifyPayment(data.player.id, data.player.wallet, data.player.bet);
        }
    }
});

// ==========================================
// 6. GESTION DES CLICS (TAPS)
// ==========================================
if (tapButton) {
    tapButton.addEventListener('click', () => {
        if (!isPlaying || tapButton.disabled) return;
        tapButton.classList.add('tap-active');
        setTimeout(() => tapButton.classList.remove('tap-active'), 100);
        socket.emit("player:tap");
    });
}

socket.on("player:score", (data) => {
    if (tapCount) tapCount.innerText = data.taps;
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

// ==========================================
// 7. CHRONOMÈTRE EN DIRECT
// ==========================================
socket.on("timer:update", (data) => {
    console.log("⏱️ Timer update reçu :", data.remainingSeconds);
    if (timerDisplay) {
        const minutes = Math.floor(data.remainingSeconds / 60);
        const seconds = data.remainingSeconds % 60;
        timerDisplay.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
});

// ==========================================
// 8. AUTRES ÉVÉNEMENTS (online, leaderboard, chat)
// ==========================================
socket.on("online:count", (count) => {
    if (onlineCount) {
        onlineCount.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:5px;"></span><span>${count} EN LIGNE</span>`;
    }
});

socket.on("leaderboard:update", (leaderboard) => {
    if (leaderboardList) {
        leaderboardList.innerHTML = "";
        if (leaderboard.length === 0) {
            leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
            return;
        }
        leaderboard.forEach(player => {
            const div = document.createElement('div');
            div.style.padding = "10px";
            div.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            div.style.color = "#ffcc00";
            div.style.fontWeight = "bold";
            div.innerText = `#${player.rank} - ${player.name} (${player.taps} clics)`;
            leaderboardList.appendChild(div);
        });
    }
});

// ==========================================
// 9. CHAT GLOBAL
// ==========================================
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        socket.emit("chat:send", { message: text });
        chatInput.value = "";
    }
}

if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

socket.on("chat:message", (data) => {
    if (chatMessages) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message';
        msgDiv.innerHTML = `<strong>${data.name} :</strong> ${data.message}`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});

// ==========================================
// 10. PAYEMENT – INITIATION (via Telegram Wallet)
// ==========================================
function initiatePayment(wallet, amount) {
    // Récupérer l'adresse du wallet serveur
    fetch(API_URL + "/api/wallet")
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const serverWallet = data.wallet;
                // Construire le lien Telegram Wallet
                // Format officiel : https://t.me/wallet?start=transfer?to=ADRESSE&amount=MONTANT&token=USDT
                const paymentUrl = `https://t.me/wallet?start=transfer?to=${serverWallet}&amount=${amount}&token=USDT`;
                
                // Ouvrir le wallet Telegram
                window.open(paymentUrl, '_blank');
                
                // Message d'information
                alert(`💰 Envoie ${amount} USDT (TRC20) vers :\n${serverWallet}\n\nAprès paiement, clique sur "Vérifier" ci-dessous.`);
            } else {
                alert("❌ Impossible de récupérer le wallet du serveur.");
            }
        })
        .catch(err => {
            alert("❌ Erreur lors de la récupération du wallet.");
            console.error(err);
        });
}

// ==========================================
// 11. PAYEMENT – VÉRIFICATION
// ==========================================
function verifyPayment(playerId, wallet, amount) {
    const txId = prompt("✏️ Entre l'ID de ta transaction USDT (TRC20) :");
    if (!txId) return;

    fetch(API_URL + "/api/payment/verify", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId, wallet, amount, playerId })
    })
    .then(res => res.json())
    .then(data => {
        if (data.verified) {
            alert("✅ Paiement vérifié ! Tu peux maintenant taper !");
            // Cacher les boutons de paiement
            if (payButton) payButton.style.display = 'none';
            if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
            // Activer le tap si ce n'est pas déjà fait
            tapButton.disabled = false;
        } else {
            alert("❌ Paiement non vérifié : " + (data.message || "Transaction introuvable."));
        }
    })
    .catch(err => {
        alert("❌ Erreur lors de la vérification.");
        console.error(err);
    });
}

// ==========================================
// 12. GESTION DES ERREURS SOCKET
// ==========================================
socket.on("error", (err) => {
    alert("⚠️ Erreur : " + err.message);
});

// ==========================================
// 13. MENU LATÉRAL
// ==========================================
const menuButton = document.getElementById('menuButton');
const sideMenu = document.getElementById('sideMenu');
const closeMenu = document.getElementById('closeMenu');
const menuOverlay = document.getElementById('menuOverlay');

function toggleMenu() {
    if (sideMenu && menuOverlay) {
        sideMenu.classList.toggle('show');
        menuOverlay.classList.toggle('show');
    }
}

if (menuButton) menuButton.addEventListener('click', toggleMenu);
if (closeMenu) closeMenu.addEventListener('click', toggleMenu);
if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);
