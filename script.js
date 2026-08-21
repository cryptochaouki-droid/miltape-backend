/* =========================================================
   SCRIPT CLIENT MILTAPE – Version Railway (avec paiement + mode démo + effets tap + reprise session)
========================================================= */

// 1. Connexion Socket.IO – URL RAILWAY
const socket = io("https://miltape-backend-production.up.railway.app", {
    transports: ['websocket'],
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

// Éléments du mode démo
const demoBtn = document.getElementById('demomodebtn');
const demoStatus = document.getElementById('demoStatus');

let isPlaying = false;
let myPlayerId = null;
let myBet = 10;
let myWallet = null;

const API_URL = "https://miltape-backend-production.up.railway.app";

// ==========================================
// 3. MODE DÉMO – GESTION
// ==========================================

let demoMode = localStorage.getItem("miltape_demo") === "true" || false;

function updateDemoUI() {
    if (demoMode) {
        if (demoStatus) {
            demoStatus.textContent = "🔬 Mode démo ACTIVÉ (paiements simulés)";
            demoStatus.style.color = "#ffcc00";
        }
        if (demoBtn) {
            demoBtn.textContent = "🔬 DÉSACTIVER MODE DÉMO";
            demoBtn.style.background = "rgba(255,50,50,0.2)";
            demoBtn.style.borderColor = "rgba(255,50,50,0.5)";
        }
        tapMessage.innerText = "🔬 MODE DÉMO ACTIF – Tu peux jouer sans payer !";
    } else {
        if (demoStatus) {
            demoStatus.textContent = "🔒 Mode démo désactivé";
            demoStatus.style.color = "#888";
        }
        if (demoBtn) {
            demoBtn.textContent = "🎮 ACTIVER MODE DÉMO";
            demoBtn.style.background = "rgba(255,204,0,0.2)";
            demoBtn.style.borderColor = "rgba(255,204,0,0.35)";
        }
        tapMessage.innerText = "⚡ CHOISIS TA MISE ET CONNECTE TON WALLET";
    }
}
updateDemoUI();

if (demoBtn) {
    demoBtn.addEventListener('click', async function() {
        if (demoMode) {
            demoMode = false;
            localStorage.setItem("miltape_demo", "false");
            updateDemoUI();
            alert("🔒 Mode démo désactivé.");
            return;
        }

        const password = prompt("🔐 Entrez le mot de passe administrateur pour activer le mode démo :");
        if (!password) return;

        try {
            const res = await fetch(API_URL + "/api/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (data.success) {
                demoMode = true;
                localStorage.setItem("miltape_demo", "true");
                updateDemoUI();
                alert("🔬 Mode démo activé ! Tu peux jouer sans payer.");
            } else {
                alert("❌ Mot de passe incorrect.");
            }
        } catch (error) {
            console.error("Erreur vérification mot de passe :", error);
            alert("❌ Erreur de connexion au serveur. Vérifie que le backend est en ligne.");
        }
    });
}

// ==========================================
// 4. RESTAURER LA SESSION (via événement socket)
// ==========================================
async function restoreSession() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const name = localStorage.getItem("miltape_player_name");

    if (!playerId || !wallet || !name) {
        console.log("🔍 Aucune session trouvée.");
        return false;
    }

    // Vérifier que la partie est encore en cours
    try {
        const res = await fetch(`${API_URL}/api/status`);
        const data = await res.json();
        if (data.status !== "running") {
            console.log("⏰ La partie est terminée, pas de restauration.");
            localStorage.removeItem("miltape_player_id");
            localStorage.removeItem("miltape_player_wallet");
            localStorage.removeItem("miltape_player_name");
            localStorage.removeItem("miltape_player_bet");
            return false;
        }
    } catch (error) {
        console.error("❌ Erreur vérification statut :", error);
        return false;
    }

    // Envoyer l'événement de restauration
    socket.emit("player:restore", { playerId, wallet });
    console.log("🔄 Demande de restauration envoyée...");
    return true;
}

// ==========================================
// 5. LOGS DE CONNEXION + RESTAURATION AUTO
// ==========================================
socket.on('connect', async () => {
    console.log('✅ Socket connecté avec ID :', socket.id);
    if (!demoMode) tapMessage.innerText = "✅ Connecté au serveur !";

    // Restaurer la session
    await restoreSession();
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
// 6. REJOINDRE LA PARTIE (avec mise flexible)
// ==========================================
function joinGame() {
    const name = prompt("Entre ton pseudo pour le classement :");
    const wallet = prompt("Entre ton adresse TRON (ex: T...) :");

    let bet = 10;
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
// 7. CONFIRMATION D'ENTRÉE
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

        // Stocker pour reprise de session
        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());

        if (demoMode) {
            if (payButton) payButton.style.display = 'none';
            if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
            tapMessage.innerText = `🔬 Mode démo : ${data.player.name}, tape !`;

            fetch(API_URL + "/api/payment/verify", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txId: "DEMO_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
                    wallet: data.player.wallet,
                    amount: data.player.bet,
                    playerId: data.player.id
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.verified) {
                    console.log("✅ Mode démo : paiement simulé avec succès");
                } else {
                    console.warn("⚠️ Mode démo : la simulation a échoué, mais le jeu continue.");
                }
            })
            .catch(err => console.error("Erreur mode démo :", err));

        } else {
            if (payButton) {
                payButton.style.display = 'block';
                payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet);
            }
            if (verifyPaymentBtn) {
                verifyPaymentBtn.style.display = 'block';
                verifyPaymentBtn.onclick = () => verifyPayment(data.player.id, data.player.wallet, data.player.bet);
            }
        }
    }
});

// ==========================================
// 8. SESSION RESTAURÉE
// ==========================================
socket.on("player:restored", (data) => {
    if (data.success) {
        isPlaying = true;
        myPlayerId = data.player.id;
        myWallet = data.player.wallet;
        myBet = data.player.bet || 10;
        tapButton.disabled = false;
        tapMessage.innerText = `👋 Bon retour ${data.player.name} ! Continue à taper !`;
        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        // Stocker pour la prochaine fois
        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());

        console.log("✅ Session restaurée avec succès !");
    } else {
        console.warn("⚠️ Restauration échouée :", data.message);
        // Nettoyer localStorage
        localStorage.removeItem("miltape_player_id");
        localStorage.removeItem("miltape_player_wallet");
        localStorage.removeItem("miltape_player_name");
        localStorage.removeItem("miltape_player_bet");
        // Réafficher le bouton jouer
        enterChallenge.style.display = 'block';
        tapMessage.innerText = "⏳ Rejoins la nouvelle partie !";
    }
});

// ==========================================
// 9. FIN DE PARTIE – RÉINITIALISATION
// ==========================================
socket.on("game:finished", (data) => {
    console.log("🏁 Partie terminée !", data);

    // Réinitialiser les compteurs
    if (tapCount) tapCount.innerText = "0";
    if (tapButtonCount) tapButtonCount.innerText = "0";

    // Désactiver le tap
    isPlaying = false;
    tapButton.disabled = true;

    // Message pour le joueur
    tapMessage.innerText = "⏰ Partie terminée ! Nouvelle partie dans 5 secondes...";

    // Réafficher le bouton "JOUER MAINTENANT"
    enterChallenge.style.display = 'block';

    // Cacher les boutons de paiement
    if (payButton) payButton.style.display = 'none';
    if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';

    // Supprimer la session (pour éviter de rejouer avec la même partie)
    localStorage.removeItem("miltape_player_id");
    localStorage.removeItem("miltape_player_wallet");
    localStorage.removeItem("miltape_player_name");
    localStorage.removeItem("miltape_player_bet");
});

// ==========================================
// 10. GESTION DES CLICS (TAPS) – AVEC EFFETS VISUELS
// ==========================================

// Fonction d'effets visuels
function tapEffects(event) {
    const btn = tapButton;
    const rect = btn.getBoundingClientRect();

    let x, y;
    if (event.touches) {
        x = event.touches[0].clientX - rect.left;
        y = event.touches[0].clientY - rect.top;
    } else {
        x = event.clientX - rect.left;
        y = event.clientY - rect.top;
    }

    // Compteur flottant +1
    const floatText = document.createElement('div');
    floatText.className = 'tap-float-text';
    floatText.textContent = '+1';
    floatText.style.left = (x - 10) + 'px';
    floatText.style.top = (y - 10) + 'px';
    btn.parentElement.appendChild(floatText);
    setTimeout(() => floatText.remove(), 1000);

    // Particules (étincelles)
    const colors = ['#ffd84d', '#ff9f1a', '#ff5b20', '#ff2fd2', '#8b2cff', '#3dff9a'];
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'tap-particle';
        const size = 3 + Math.random() * 8;
        const angle = Math.random() * Math.PI * 2;
        const distance = 25 + Math.random() * 65;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.left = (x - size/2) + 'px';
        particle.style.top = (y - size/2) + 'px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
        particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
        btn.parentElement.appendChild(particle);
        setTimeout(() => particle.remove(), 900);
    }

    // Onde (ripple)
    const ripple = document.createElement('div');
    ripple.className = 'tap-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    btn.parentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 800);

    // Vibration haptique (mobile)
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

// Écouteur du tap
if (tapButton) {
    tapButton.addEventListener('click', function(event) {
        if (!isPlaying || tapButton.disabled) return;

        tapEffects(event);

        tapButton.classList.add('tap-active');
        setTimeout(() => tapButton.classList.remove('tap-active'), 100);

        socket.emit("player:tap");
    });

    // Pour mobile (touch)
    tapButton.addEventListener('touchstart', function(event) {
        if (!isPlaying || tapButton.disabled) return;
        // On laisse le click gérer, mais on empêche le double déclenchement
    }, { passive: true });
}

socket.on("player:score", (data) => {
    if (tapCount) tapCount.innerText = data.taps;
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

// ==========================================
// 11. CHRONOMÈTRE EN DIRECT
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
// 12. AUTRES ÉVÉNEMENTS (online, leaderboard, chat)
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
            div.className = 'leaderboard-item';
            div.innerHTML = `
                <span style="color:#ffd84d;font-weight:900;">#${player.rank}</span>
                <span style="color:white;font-size:13px;">${player.name}</span>
                <span style="color:#ffd84d;font-weight:900;font-size:13px;">${player.taps}</span>
            `;
            leaderboardList.appendChild(div);
        });
    }
});

// ==========================================
// 13. CHAT GLOBAL
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
// 14. PAYEMENT – INITIATION (via Telegram Wallet)
// ==========================================
function initiatePayment(wallet, amount) {
    fetch(API_URL + "/api/wallet")
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const serverWallet = data.wallet;
                const paymentUrl = `https://t.me/wallet?start=transfer?to=${serverWallet}&amount=${amount}&token=USDT`;
                window.open(paymentUrl, '_blank');
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
// 15. PAYEMENT – VÉRIFICATION
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
            if (payButton) payButton.style.display = 'none';
            if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
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
// 16. GESTION DES ERREURS SOCKET
// ==========================================
socket.on("error", (err) => {
    alert("⚠️ Erreur : " + err.message);
});

// ==========================================
// 17. MENU LATÉRAL
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
