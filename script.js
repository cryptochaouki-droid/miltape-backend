/* =========================================================
SCRIPT CLIENT MILTAPE – Version finale (corrigée + multi-crypto + notifications + tableau de bord + Telegram + ticker)
========================================================= */

// 1. Connexion Socket.IO – URL RAILWAY (CORRIGÉ : Connexion automatique robuste)
const socket = io("https://miltape-backend-production.up.railway.app");

// 2. Éléments DOM
const tapButton = document.getElementById('tapButton');
const tapCount = document.getElementById('tapCount');
const tapButtonCount = document.getElementById('tapButtonCount');
const enterChallenge = document.getElementById('enterChallenge');
const enterChallengeTop = document.getElementById('enterChallengeTop');
const spectatorBtn = document.getElementById('spectatorMode');
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
const tokenSelect = document.getElementById('tokenSelect');

// Éléments du mode démo
const demoBtn = document.getElementById('demomodebtn');
const demoStatus = document.getElementById('demoStatus');

// Variables d'état
let isPlaying = false;
let isPaid = false;
let isSpectator = false;
let myPlayerId = null;
let myBet = 10;
let myWallet = null;
let myToken = 'USDT';

const API_URL = "https://miltape-backend-production.up.railway.app";

// ==========================================
// 3. INTÉGRATION TELEGRAM
// ==========================================

// 3.1 Récupérer le pseudo Telegram automatiquement
function getTelegramUser() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const user = window.Telegram.WebApp.initDataUnsafe?.user;
            if (user && user.username) {
                return user.username;
            }
            if (user && user.first_name) {
                return user.first_name;
            }
        }
        return null;
    } catch (e) {
        console.warn("⚠️ Impossible de récupérer l'utilisateur Telegram:", e);
        return null;
    }
}

// 3.2 Adapter le thème Telegram (clair / sombre)
function applyTelegramTheme() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const colorScheme = window.Telegram.WebApp.colorScheme;
            const themeParams = window.Telegram.WebApp.themeParams;
            document.body.setAttribute('data-telegram-theme', colorScheme);

            if (colorScheme === "dark") {
                document.documentElement.style.setProperty('--bg', '#0a0a0a');
                document.documentElement.style.setProperty('--text', '#ffffff');
                document.documentElement.style.setProperty('--muted', '#888888');
                document.body.style.background = '#0a0a0a';
            } else {
                document.documentElement.style.setProperty('--bg', '#f5f5f5');
                document.documentElement.style.setProperty('--text', '#1a1a1a');
                document.documentElement.style.setProperty('--muted', '#666666');
                document.body.style.background = '#f5f5f5';
            }

            if (themeParams && themeParams.button_color) {
                document.documentElement.style.setProperty('--gold', themeParams.button_color);
            }

            console.log("🎨 Thème Telegram appliqué :", colorScheme);
        }
    } catch (e) {
        console.warn("⚠️ Impossible d'appliquer le thème Telegram:", e);
    }
}

// 3.3 Haptic Feedback (vibrations Telegram)
function hapticLight() {
    try { if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.HapticFeedback.impactOccurred('light'); } } catch (e) { }
}
function hapticMedium() {
    try { if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.HapticFeedback.impactOccurred('medium'); } } catch (e) { }
}
function hapticHeavy() {
    try { if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.HapticFeedback.impactOccurred('heavy'); } } catch (e) { }
}
function hapticSuccess() {
    try { if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } } catch (e) { }
}
function hapticError() {
    try { if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.HapticFeedback.notificationOccurred('error'); } } catch (e) { }
}

applyTelegramTheme();
if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.onEvent('themeChanged', applyTelegramTheme);
}

// ==========================================
// 4. MODE DÉMO – GESTION
// ==========================================
let demoMode = localStorage.getItem("miltape_demo") === "true" || false;

function updateDemoUI() {
    if (demoMode) {
        if (demoStatus) { demoStatus.textContent = "🔬 Mode démo ACTIVÉ (paiements simulés)"; demoStatus.style.color = "#ffcc00"; }
        if (demoBtn) { demoBtn.textContent = "🔬 DÉSACTIVER MODE DÉMO"; demoBtn.style.background = "rgba(255,50,50,0.2)"; demoBtn.style.borderColor = "rgba(255,50,50,0.5)"; }
        if (!isSpectator) tapMessage.innerText = "🔬 MODE DÉMO ACTIF – Tu peux jouer sans payer !";
    } else {
        if (demoStatus) { demoStatus.textContent = "🔒 Mode démo désactivé"; demoStatus.style.color = "#888"; }
        if (demoBtn) { demoBtn.textContent = "🎮 ACTIVER MODE DÉMO"; demoBtn.style.background = "rgba(255,204,0,0.2)"; demoBtn.style.borderColor = "rgba(255,204,0,0.35)"; }
        if (!isSpectator) tapMessage.innerText = "⚡ CHOISIS TA MISE ET CONNECTE TON WALLET";
    }
}
updateDemoUI();

if (demoBtn) {
    demoBtn.addEventListener('click', async function() {
        if (demoMode) {
            demoMode = false;
            localStorage.setItem("miltape_demo", "false");
            updateDemoUI();
            hapticMedium();
            alert("🔒 Mode démo désactivé.");
            return;
        }
        const password = prompt("🔐 Entrez le mot de passe administrateur pour activer le mode démo :");
        if (!password) return;
        try {
            const res = await fetch(API_URL + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
            const data = await res.json();
            if (data.success) {
                demoMode = true;
                localStorage.setItem("miltape_demo", "true");
                updateDemoUI();
                hapticSuccess();
                alert("🔬 Mode démo activé ! Tu peux jouer sans payer.");
            } else {
                hapticError();
                alert("❌ Mot de passe incorrect.");
            }
        } catch (error) {
            console.error("Erreur vérification mot de passe :", error);
            hapticError();
            alert("❌ Erreur de connexion au serveur. Vérifie que le backend est en ligne.");
        }
    });
}

// ==========================================
// 5. MODE SPECTATEUR
// ==========================================
function joinSpectator() {
    const name = getTelegramUser() || prompt("Entre ton pseudo (spectateur) :");
    if (!name) return;
    isSpectator = true;
    isPlaying = true;
    isPaid = true;
    tapButton.disabled = true;
    tapMessage.innerText = `👁️ Mode spectateur : ${name} regarde la partie !`;
    enterChallenge.style.display = 'none';
    if (spectatorBtn) { spectatorBtn.classList.add('active'); spectatorBtn.textContent = '👁️ SPECTATEUR ACTIF'; }
    if (payButton) payButton.style.display = 'none';
    if (betInput) betInput.disabled = true;
    socket.emit("spectator:join", { name });
    hapticMedium();
}
if (spectatorBtn) spectatorBtn.addEventListener('click', joinSpectator);

// ==========================================
// 6. RESTAURER LA SESSION (via événement socket)
// ==========================================
async function restoreSession() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const name = localStorage.getItem("miltape_player_name");
    const spectator = localStorage.getItem("miltape_spectator") === "true";

    if (spectator && name) {
        isSpectator = true; isPlaying = true; isPaid = true; tapButton.disabled = true;
        tapMessage.innerText = `👁️ Spectateur : ${name}`;
        enterChallenge.style.display = 'none';
        if (spectatorBtn) { spectatorBtn.classList.add('active'); spectatorBtn.textContent = '👁️ SPECTATEUR ACTIF'; }
        if (payButton) payButton.style.display = 'none';
        if (betInput) betInput.disabled = true;
        return true;
    }

    if (!playerId || !wallet || !name) {
        console.log("🔍 Aucune session trouvée.");
        return false;
    }

    try {
        const res = await fetch(`${API_URL}/api/status`);
        const data = await res.json();
        if (data.status !== "running") {
            console.log("⏰ La partie est terminée, pas de restauration.");
            localStorage.removeItem("miltape_player_id"); localStorage.removeItem("miltape_player_wallet"); localStorage.removeItem("miltape_player_name"); localStorage.removeItem("miltape_player_bet"); localStorage.removeItem("miltape_spectator");
            return false;
        }
    } catch (error) {
        console.error("❌ Erreur vérification statut :", error);
        return false;
    }

    socket.emit("player:restore", { playerId, wallet });
    console.log("🔄 Demande de restauration envoyée...");
    return true;
}

// ==========================================
// 7. LOGS DE CONNEXION + RESTAURATION AUTO
// ==========================================
socket.on('connect', async () => {
    console.log('✅ Socket connecté avec ID :', socket.id);
    if (!demoMode) tapMessage.innerText = "✅ Connecté au serveur !";
    await restoreSession();
});
socket.on('connect_error', (err) => {
    console.error('❌ Erreur de connexion Socket :', err.message);
    hapticError();
    tapMessage.innerText = "⚠️ Erreur de connexion au serveur.";
});
socket.on('disconnect', (reason) => {
    console.log('🔴 Socket déconnecté :', reason);
    tapMessage.innerText = "🔴 Déconnecté du serveur.";
});

// ==========================================
// 8. REJOINDRE LA PARTIE (joueur) – AVEC CRYPTO
// ==========================================
function joinGame() {
    const telegramName = getTelegramUser();
    let name = telegramName || prompt("Entre ton pseudo pour le classement :");
    const wallet = prompt("Entre ton adresse TRON (ex: T...) :");
    const token = tokenSelect ? tokenSelect.value : 'USDT';
    let bet = 10;
    if (betInput) {
        const rawBet = parseFloat(betInput.value);
        if (!isNaN(rawBet) && rawBet >= 0.5 && rawBet <= 1000000) { bet = rawBet; }
        else { hapticError(); alert("⚠️ Mise invalide. Utilisation de 10 USDT par défaut."); }
    }
    if (name && wallet) {
        isSpectator = false;
        myBet = bet;
        myWallet = wallet;
        myToken = token;
        tapMessage.innerText = "Connexion au serveur en cours...";
        socket.emit("player:join", { name, wallet, bet, token });
        localStorage.removeItem("miltape_spectator");
        hapticMedium();
    }
}
if (enterChallenge) enterChallenge.addEventListener('click', joinGame);
if (enterChallengeTop) enterChallengeTop.addEventListener('click', joinGame);

// ==========================================
// 9. CONFIRMATION D'ENTRÉE (joueur)
// ==========================================
socket.on("player:joined", (data) => {
    if (data.success) {
        isPlaying = true;
        isPaid = false;
        isSpectator = false;
        myPlayerId = data.player.id;
        myToken = data.player.token || 'USDT';
        tapButton.disabled = true;
        tapMessage.innerText = `💰 ${data.player.name}, paie ta mise pour taper !`;
        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());
        localStorage.setItem("miltape_player_token", myToken);
        localStorage.removeItem("miltape_spectator");

        if (demoMode) {
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = `🔬 Mode démo : ${data.player.name}, tape !`;
            if (payButton) payButton.style.display = 'none';

            fetch(API_URL + "/api/payment/verify", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txId: "DEMO_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
                    wallet: data.player.wallet,
                    amount: data.player.bet,
                    playerId: data.player.id,
                    token: myToken
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.verified) console.log("✅ Mode démo : paiement simulé avec succès");
                else console.warn("⚠️ Mode démo : la simulation a échoué, mais le jeu continue.");
            })
            .catch(err => console.error("Erreur mode démo :", err));
        } else {
            if (payButton) {
                payButton.style.display = 'block';
                payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet);
            }
        }
        hapticMedium();
    }
});

// ==========================================
// 10. CONFIRMATION SPECTATEUR
// ==========================================
socket.on("spectator:joined", (data) => {
    if (data.success) {
        isSpectator = true; isPlaying = true; isPaid = true; tapButton.disabled = true;
        tapMessage.innerText = `👁️ Vous regardez en direct (${data.spectators} spectateurs)`;
        if (payButton) payButton.style.display = 'none';
        if (betInput) betInput.disabled = true;
        localStorage.setItem("miltape_spectator", "true");
        localStorage.setItem("miltape_player_name", data.name);
    }
});

// ==========================================
// 11. SESSION RESTAURÉE (joueur)
// ==========================================
socket.on("player:restored", (data) => {
    if (data.success) {
        isPlaying = true; isSpectator = false;
        myPlayerId = data.player.id;
        myWallet = data.player.wallet;
        myBet = data.player.bet || 10;
        myToken = data.player.token || 'USDT';
        localStorage.removeItem("miltape_spectator");

        if (demoMode) {
            isPaid = true; tapButton.disabled = false;
            tapMessage.innerText = `🔬 Mode démo : bon retour ${data.player.name} !`;
        } else {
            isPaid = false; tapButton.disabled = true;
            tapMessage.innerText = `💰 ${data.player.name}, paie ta mise pour continuer à taper !`;
            if (payButton) { payButton.style.display = 'block'; payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet); }
        }
        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;
        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());
        localStorage.setItem("miltape_player_token", myToken);
        console.log("✅ Session restaurée avec succès !");
        hapticMedium();
    } else {
        console.warn("⚠️ Restauration échouée :", data.message);
        localStorage.removeItem("miltape_player_id"); localStorage.removeItem("miltape_player_wallet"); localStorage.removeItem("miltape_player_name"); localStorage.removeItem("miltape_player_bet"); localStorage.removeItem("miltape_player_token"); localStorage.removeItem("miltape_spectator");
        enterChallenge.style.display = 'block';
        tapMessage.innerText = "⏳ Rejoins la nouvelle partie !";
    }
});

// ==========================================
// 12. CONFIRMATION DE PAIEMENT (débloque le tap)
// ==========================================
socket.on("payment:verified", (data) => {
    if (data.verified && !isSpectator) {
        isPaid = true;
        tapButton.disabled = false;
        hapticSuccess();
        if (data.automatic) {
            tapMessage.innerText = "✅ Paiement automatique détecté ! Tape maintenant !";
        } else {
            tapMessage.innerText = "✅ Paiement vérifié ! Tape maintenant !";
        }
        if (payButton) payButton.style.display = 'none';
    }
});

// ==========================================
// 13. FIN DE PARTIE – RÉINITIALISATION + CONFETTIS
// ==========================================
socket.on("game:finished", (data) => {
    console.log("🏁 Partie terminée !", data);
    if (tapCount) tapCount.innerText = "0";
    if (tapButtonCount) tapButtonCount.innerText = "0";
    isPlaying = false; isPaid = false; tapButton.disabled = true;

    if (!isSpectator) {
        let message = "🏆 RÉSULTATS DE LA PARTIE 🏆\n";
        message += "═".repeat(30) + "\n\n";

        if (data.winners && data.winners.length > 0) {
            message += "🥇 Les 5 gagnants (2x leur mise) :\n\n";
            data.winners.forEach((w, index) => {
                const emoji = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🏅";
                message += `${emoji} #${w.rank} ${w.name}\n`;
                message += `   Mise : ${w.bet} USDT → Gain : ${w.gain} USDT\n\n`;
            });
            launchConfetti();
            hapticHeavy();
            data.winners.forEach((winner, index) => {
                setTimeout(() => { addWinnerToTicker(winner.name, winner.gain, winner.rank); }, index * 200);
            });
        } else {
            message += "❌ Aucun gagnant cette fois-ci.\n\n";
        }

        message += "═".repeat(30) + "\n";
        message += `💰 Total des mises : ${data.totalStakes} USDT\n`;
        message += `💸 Total redistribué : ${data.totalPayout} USDT\n`;

        if (data.deficit > 0) {
            message += `📉 Déficit (serveur) : ${data.deficit} USDT\n`;
            message += `ℹ️ Le wallet du serveur a comblé la différence.\n`;
        } else {
            message += `✅ Bénéfice serveur : ${Math.abs(data.deficit)} USDT\n`;
        }

        message += "═".repeat(30) + "\n";
        message += "🔥 Prochaine partie dans 5 secondes...";
        tapMessage.innerText = `🏆 Partie terminée ! ${data.winners ? data.winners.length : 0} gagnant(s) !`;
        alert(message);
        console.log(message);
    } else {
        tapMessage.innerText = `👁️ Partie terminée ! Prochaine partie dans 5 secondes...`;
    }

    enterChallenge.style.display = 'block';
    if (payButton) payButton.style.display = 'none';
    if (betInput) betInput.disabled = false;
    if (spectatorBtn) { spectatorBtn.classList.remove('active'); spectatorBtn.textContent = '👁️ REGARDER EN DIRECT (Spectateur)'; }
    isSpectator = false;
    localStorage.removeItem("miltape_player_id"); localStorage.removeItem("miltape_player_wallet"); localStorage.removeItem("miltape_player_name"); localStorage.removeItem("miltape_player_bet"); localStorage.removeItem("miltape_player_token"); localStorage.removeItem("miltape_spectator");
});

// ==========================================
// 14. CONFETTIS
// ==========================================
function launchConfetti() {
    const colors = ['#ffd84d', '#ff5b20', '#ff2fd2', '#3dff9a', '#8b2cff', '#ff6b6b', '#4ecdc4', '#45b7d1'];
    const container = document.querySelector('.app');
    for (let i = 0; i < 60; i++) {
        const confetti = document.createElement('div');
        const size = 6 + Math.random() * 10;
        const isCircle = Math.random() > 0.5;
        confetti.style.cssText = `
            position: fixed; width: ${size}px; height: ${isCircle ? size : size * 0.4}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: ${isCircle ? '50%' : '2px'};
            top: -10px; left: ${Math.random() * 100}%; z-index: 9999;
            pointer-events: none; animation: confettiFall ${2 + Math.random() * 2}s linear forwards;
            animation-delay: ${Math.random() * 0.8}s; transform: rotate(${Math.random() * 360}deg);
            box-shadow: 0 0 6px rgba(255,255,255,0.1);
        `;
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 4000);
    }
}

// ==========================================
// 15. GESTION DES CLICS (TAPS) + ANIMATION COMPTEUR + HAPTIC
// ==========================================
function animateTapCount() {
    if (tapCount) { tapCount.classList.remove('tap-count-pop'); void tapCount.offsetWidth; tapCount.classList.add('tap-count-pop'); }
}

function tapEffects(event) {
    const btn = tapButton;
    const rect = btn.getBoundingClientRect();
    let x, y;
    if (event.touches) { x = event.touches[0].clientX - rect.left; y = event.touches[0].clientY - rect.top; }
    else { x = event.clientX - rect.left; y = event.clientY - rect.top; }

    const floatText = document.createElement('div');
    floatText.className = 'tap-float-text';
    floatText.textContent = '+1';
    floatText.style.left = (x - 10) + 'px';
    floatText.style.top = (y - 10) + 'px';
    btn.parentElement.appendChild(floatText);
    setTimeout(() => floatText.remove(), 1000);

    const colors = ['#ffd84d', '#ff9f1a', '#ff5b20', '#ff2fd2', '#8b2cff', '#3dff9a'];
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'tap-particle';
        const size = 3 + Math.random() * 8;
        const angle = Math.random() * Math.PI * 2;
        const distance = 25 + Math.random() * 65;
        particle.style.width = size + 'px'; particle.style.height = size + 'px';
        particle.style.left = (x - size/2) + 'px'; particle.style.top = (y - size/2) + 'px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
        particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
        btn.parentElement.appendChild(particle);
        setTimeout(() => particle.remove(), 900);
    }

    const ripple = document.createElement('div');
    ripple.className = 'tap-ripple';
    ripple.style.left = x + 'px'; ripple.style.top = y + 'px';
    btn.parentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 800);
    hapticLight();
}

if (tapButton) {
    tapButton.addEventListener('click', function(event) {
        if (!isPlaying || tapButton.disabled || !isPaid || isSpectator) {
            if (!isPaid && !isSpectator) {
                tapMessage.innerText = "⏳ Tu dois payer ta mise avant de taper !";
                hapticError();
                setTimeout(() => { tapMessage.innerText = `💰 Paie ta mise pour taper !`; }, 3000);
            }
            return;
        }
        tapEffects(event);
        tapButton.classList.add('tap-active');
        setTimeout(() => tapButton.classList.remove('tap-active'), 100);
        socket.emit("player:tap");
    });
}

socket.on("player:score", (data) => {
    if (tapCount) { tapCount.innerText = data.taps; animateTapCount(); }
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

// ==========================================
// 16. CHRONOMÈTRE EN DIRECT
// ==========================================
socket.on("timer:update", (data) => {
    if (timerDisplay) {
        const minutes = Math.floor(data.remainingSeconds / 60);
        const seconds = data.remainingSeconds % 60;
        timerDisplay.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
});

// ==========================================
// 17. TOTAL DES MISES – MISE À JOUR DYNAMIQUE
// ==========================================
socket.on("totalStakes:update", (data) => {
    const displayBet = document.getElementById('displayBet');
    const displayBetTop = document.getElementById('displayBetTop');
    if (displayBet) displayBet.textContent = `$${data.totalStakes}`;
    if (displayBetTop) displayBetTop.textContent = `$${data.totalStakes}`;
});

// ==========================================
// 18. AUTRES ÉVÉNEMENTS (online, leaderboard, chat)
// ==========================================
socket.on("online:count", (count) => {
    if (onlineCount) onlineCount.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:5px;"></span><span>${count} EN LIGNE</span>`;
});

socket.on("leaderboard:update", (leaderboard) => {
    if (leaderboardList) {
        leaderboardList.innerHTML = "";
        if (leaderboard.length === 0) { leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`; return; }
        leaderboard.forEach(player => {
            const div = document.createElement('div');
            div.className = 'leaderboard-item';
            div.innerHTML = `<span style="color:#ffd84d;font-weight:900;">#${player.rank}</span> <span style="color:white;font-size:13px;">${player.name}</span> <span style="color:#ffd84d;font-weight:900;font-size:13px;">${player.taps}</span>`;
            leaderboardList.appendChild(div);
        });
    }
});

// ==========================================
// 19. CHAT GLOBAL
// ==========================================
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) { socket.emit("chat:send", { message: text }); chatInput.value = ""; }
}
if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

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
// 20. PAYEMENT – INITIATION (via Telegram Wallet) – AVEC CRYPTO
// ==========================================
function initiatePayment(wallet, amount) {
    const token = tokenSelect ? tokenSelect.value : (localStorage.getItem("miltape_player_token") || 'USDT');
    fetch(API_URL + "/api/wallet")
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const serverWallet = data.wallet;
                const paymentUrl = `https://t.me/wallet?start=transfer?to=${serverWallet}&amount=${amount}&token=${token}`;
                window.open(paymentUrl, '_blank');
                hapticMedium();
                alert(`💰 Envoie ${amount} ${token} (TRC20) vers :\n${serverWallet}\n\n✅ Le paiement sera détecté automatiquement !`);
            } else {
                hapticError();
                alert("❌ Impossible de récupérer le wallet du serveur.");
            }
        })
        .catch(err => { hapticError(); alert("❌ Erreur lors de la récupération du wallet."); console.error(err); });
}

// ==========================================
// 21. GESTION DES ERREURS SOCKET (CORRIGÉE)
// ==========================================
socket.on("error", (err) => {
    if (err.message === "Joueur introuvable.") {
        console.log("🔍 Session expirée, nettoyage automatique...");
        localStorage.removeItem("miltape_player_id"); localStorage.removeItem("miltape_player_wallet"); localStorage.removeItem("miltape_player_name"); localStorage.removeItem("miltape_player_bet"); localStorage.removeItem("miltape_player_token"); localStorage.removeItem("miltape_spectator");
        if (enterChallenge) enterChallenge.style.display = 'block';
        if (tapMessage) tapMessage.innerText = "⏳ Rejoins la nouvelle partie !";
        return;
    }
    hapticError();
    alert("⚠️ Erreur : " + err.message);
});

// ==========================================
// 22. NOTIFICATIONS EN TEMPS RÉEL
// ==========================================
let notificationsEnabled = localStorage.getItem("miltape_notifications") !== "false";
const notifToggle = document.getElementById('notifToggle');
if (notifToggle) {
    notifToggle.checked = notificationsEnabled;
    notifToggle.addEventListener('change', function() {
        notificationsEnabled = this.checked;
        localStorage.setItem("miltape_notifications", this.checked.toString());
    });
}

function getNotifIcon(type) {
    const icons = { 'info': '📢', 'success': '✅', 'warning': '⏱️', 'alert': '🔔', 'champion': '🏆' };
    return icons[type] || '📢';
}

function showNotification(type, message, data = {}) {
    if (!notificationsEnabled) return;
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.innerHTML = `<span style="display:flex; align-items:center; gap:8px;"><span class="notif-icon">${getNotifIcon(type)}</span><span class="notif-text">${message}</span></span>`;
    container.appendChild(notif);

    if (type === 'champion') hapticHeavy();
    else if (type === 'success') hapticMedium();
    else hapticLight();

    setTimeout(() => {
        if (notif.parentNode) { notif.classList.add('hiding'); setTimeout(() => { if (notif.parentNode) notif.remove(); }, 300); }
    }, 4000);
}

socket.on("notification:new", (data) => {
    showNotification(data.type, data.message, data.data);
    if (data.type === 'champion') {
        const match = data.message.match(/#\d+\s+(\S+)\s+→\s+(\d+\.?\d*)/);
        if (match) {
            const name = match[1];
            const amount = match[2];
            const rank = data.data?.winner?.rank || 1;
            addWinnerToTicker(name, amount, rank);
        }
    }
});

// ==========================================
// 23. BANDEAU DES GAGNANTS (TICKER)
// ==========================================
const winnerTicker = document.getElementById('winnerTicker');
const tickerTrack = document.getElementById('tickerTrack');
let tickerItems = [];
const MAX_TICKER_ITEMS = 20;

function addWinnerToTicker(name, amount, rank) {
    if (!name) return;
    const existing = tickerItems.find(item => item.name === name);
    if (existing) { existing.amount = amount; updateTickerDisplay(); return; }
    const emoji = rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
    tickerItems.push({ name, amount, rank, emoji });
    if (tickerItems.length > MAX_TICKER_ITEMS) tickerItems.shift();
    updateTickerDisplay();
    showTicker();
}

function updateTickerDisplay() {
    if (!tickerTrack) return;
    let html = '';
    const doubledItems = [...tickerItems, ...tickerItems];
    for (const item of doubledItems) {
        const displayAmount = typeof item.amount === 'number' ? `${item.amount} USDT` : item.amount;
        html += `<span class="ticker-item"><span class="trophy">${item.emoji}</span><span class="name">${item.name}</span><span>→</span><span class="amount">${displayAmount}</span></span>`;
    }
    tickerTrack.innerHTML = html;
    tickerTrack.style.animation = 'none';
    void tickerTrack.offsetWidth;
    tickerTrack.style.animation = 'tickerScroll 20s linear infinite';
}

function showTicker() {
    if (winnerTicker) winnerTicker.classList.add('show');
}

// ==========================================
// 24. MENU LATÉRAL + FONCTIONS DE MODALE (avec tableau de bord des gains)
// ==========================================
function showMenuMessage(title, content) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    if (modal && modalTitle && modalBody) {
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modal.classList.add('show');
        hapticLight();
    }
}

const closeModalBtn = document.getElementById('closeDynamicModal');
if (closeModalBtn) closeModalBtn.addEventListener('click', function() { document.getElementById('dynamicModal').classList.remove('show'); });
const modalOverlay = document.getElementById('dynamicModal');
if (modalOverlay) modalOverlay.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });

const menuGamesBtn = document.getElementById('menuGamesBtn');
if (menuGamesBtn) menuGamesBtn.addEventListener('click', function() {
    showMenuMessage('🎮 Mes parties', `<p>Tu n'as pas encore de parties enregistrées.</p><p style="color:#888;font-size:12px;">Rejoins une partie pour commencer !</p>`);
});

const menuRankingsBtn = document.getElementById('menuRankingsBtn');
if (menuRankingsBtn) menuRankingsBtn.addEventListener('click', function() {
    const score = tapCount ? tapCount.textContent : '0';
    showMenuMessage('🏆 Mes classements', `<p>Ton meilleur score : <strong style="color:#ffcc00;">${score}</strong> taps</p><p style="color:#888;font-size:12px;">Continue à taper pour grimper dans le classement !</p>`);
});

const menuGainsBtn = document.getElementById('menuGainsBtn');
if (menuGainsBtn) menuGainsBtn.addEventListener('click', function() {
    const wallet = localStorage.getItem("miltape_player_wallet");
    const playerId = localStorage.getItem("miltape_player_id");
    if (!wallet && !playerId) {
        showMenuMessage('💰 Mes gains', `<p style="color:#888;">Tu n'as pas encore de parties enregistrées.</p><p style="color:#888;font-size:12px;">Rejoins une partie pour commencer !</p>`);
        return;
    }
    let url = `${API_URL}/api/player/history?`;
    if (playerId) url += `playerId=${playerId}`;
    else url += `wallet=${wallet}`;
    showMenuMessage('💰 Mes gains', `<div class="loader" style="margin:20px auto;"></div>`);

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.success) { showMenuMessage('💰 Mes gains', `<p>Erreur: ${data.message}</p>`); return; }
            const p = data.player;
            const history = data.history;
            let html = `
                <div class="dashboard-stats" style="display:flex; flex-wrap:wrap; gap:10px; justify-content:space-around; margin-bottom:15px;">
                    <div class="stat-item" style="text-align:center; flex:1 1 80px;">
                        <span class="stat-label" style="display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Total gagné</span>
                        <span class="stat-value" style="display:block; font-size:20px; font-weight:900; color:var(--gold);">${p.totalGain} USDT</span>
                    </div>
                    <div class="stat-item" style="text-align:center; flex:1 1 80px;">
                        <span class="stat-label" style="display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Parties jouées</span>
                        <span class="stat-value" style="display:block; font-size:20px; font-weight:900; color:var(--gold);">${p.gamesPlayed}</span>
                    </div>
                    <div class="stat-item" style="text-align:center; flex:1 1 80px;">
                        <span class="stat-label" style="display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Meilleur score</span>
                        <span class="stat-value" style="display:block; font-size:20px; font-weight:900; color:var(--gold);">${p.bestScore} taps</span>
                    </div>
                </div>
            `;
            if (history.length === 0) {
                html += `<p class="no-data-message" style="color:var(--muted); text-align:center; font-size:13px; padding:20px 0;">Aucune partie gagnée pour le moment.</p>`;
            } else {
                html += `
                    <div class="history-table-wrapper" style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
                        <table class="history-table" style="width:100%; border-collapse:collapse; font-size:11px; margin-top:5px;">
                            <thead>
                                <tr style="color:var(--gold); border-bottom:1px solid rgba(255,255,255,0.08);">
                                    <th style="text-align:left;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">#</th>
                                    <th style="text-align:left;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Rang</th>
                                    <th style="text-align:right;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Mise</th>
                                    <th style="text-align:right;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Gain</th>
                                    <th style="text-align:right;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Taps</th>
                                    <th style="text-align:right;padding:6px 4px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Date</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                history.forEach((h, idx) => {
                    const date = new Date(h.createdAt).toLocaleDateString('fr-FR');
                    html += `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                            <td style="padding:6px 4px;">${idx+1}</td>
                            <td style="padding:6px 4px; font-weight:700; color:var(--gold);">#${h.rank}</td>
                            <td style="padding:6px 4px; text-align:right;">${h.bet} USDT</td>
                            <td style="padding:6px 4px; text-align:right; color:#3dff9a;">+${h.gain} USDT</td>
                            <td style="padding:6px 4px; text-align:right;">${h.taps}</td>
                            <td style="padding:6px 4px; text-align:right; color:var(--muted);">${date}</td>
                        </tr>
                    `;
                });
                html += `</tbody></table></div>`;
            }
            showMenuMessage('💰 Mes gains', html);
        })
        .catch(err => {
            console.error(err);
            showMenuMessage('💰 Mes gains', `<p style="color:#ff5b5b;">Erreur de chargement des gains.</p>`);
        });
});

const menuWithdrawalsBtn = document.getElementById('menuWithdrawalsBtn');
if (menuWithdrawalsBtn) menuWithdrawalsBtn.addEventListener('click', function() {
    showMenuMessage('💸 Mes retraits', `<p>Tu n'as pas encore effectué de retrait.</p><p style="color:#888;font-size:12px;">Les retraits sont disponibles après chaque partie.</p>`);
});

const menuReferralBtn = document.getElementById('menuReferralBtn');
if (menuReferralBtn) menuReferralBtn.addEventListener('click', function() {
    showMenuMessage('👥 Parrainage', `<p>Parraine tes amis et gagne des bonus !</p><p style="color:#888;font-size:12px;">Lien de parrainage :<br><span style="color:#ffcc00;word-break:break-all;font-size:11px;">https://cryptochaouki-droid.github.io/miltape-backend/</span></p>`);
});

const menuChatBtn = document.getElementById('menuChatBtn');
if (menuChatBtn) menuChatBtn.addEventListener('click', function() {
    const chatSection = document.getElementById('globalChat');
    if (chatSection) { chatSection.scrollIntoView({ behavior: 'smooth' }); if (sideMenu) sideMenu.classList.remove('show'); if (menuOverlay) menuOverlay.classList.remove('show'); }
});

const menuRulesBtn = document.getElementById('menuRulesBtn');
if (menuRulesBtn) menuRulesBtn.addEventListener('click', function() {
    showMenuMessage('📜 Règles du jeu', `<p><strong>⏱️ 10 minutes</strong> pour taper le plus possible.</p><p><strong>🏆 Top 5</strong> seulement.</p><p><strong>🪙 USDT (TRC20)</strong> – mise de 0.50 à 1 000 000 USDT.</p><p><strong>💰 Gains :</strong> les 5 premiers gagnent 2x leur mise.</p><p style="color:#888;font-size:12px;">Bonne chance ! 🔥</p>`);
});

// ==========================================
// 25. MENU LATÉRAL (ouverture/fermeture)
// ==========================================
const menuButton = document.getElementById('menuButton');
const sideMenu = document.getElementById('sideMenu');
const closeMenu = document.getElementById('closeMenu');
const menuOverlay = document.getElementById('menuOverlay');

function toggleMenu() {
    if (sideMenu && menuOverlay) { sideMenu.classList.toggle('show'); menuOverlay.classList.toggle('show'); }
}
if (menuButton) menuButton.addEventListener('click', toggleMenu);
if (closeMenu) closeMenu.addEventListener('click', toggleMenu);
if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);

// ==========================================
// 26. INITIALISATION DU BOUTON RETOUR TELEGRAM
// ==========================================
(function initTelegramBackButton() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const webapp = window.Telegram.WebApp;
            webapp.expand();
            webapp.BackButton.show();
            webapp.BackButton.onClick(function() { webapp.close(); });
            console.log("✅ Telegram WebApp bouton retour initialisé");
        }
    } catch (e) { console.log("ℹ️ Pas de Telegram WebApp détecté"); }
})();

// ==========================================
// 27. COMPTE À REBOURS CAGNOTTE (NOUVEAU)
// ==========================================
let jackpotCountdownInterval = null;

function updateJackpotCountdown(nextDrawTime) {
    const countdownElement = document.getElementById('jackpotCountdown');
    if (!countdownElement) return;
    if (!nextDrawTime) { countdownElement.textContent = "--"; return; }
    if (jackpotCountdownInterval) clearInterval(jackpotCountdownInterval);

    jackpotCountdownInterval = setInterval(() => {
        const now = Date.now();
        let diff = nextDrawTime - now;
        if (diff <= 0) {
            countdownElement.textContent = "Tirage en cours...";
            clearInterval(jackpotCountdownInterval);
            socket.emit("jackpot:get");
            return;
        }
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        let display = "";
        if (days > 0) display += days + "j ";
        if (hours > 0 || days > 0) display += hours + "h ";
        if (minutes > 0 || hours > 0 || days > 0) display += minutes + "m ";
        display += seconds + "s";
        countdownElement.textContent = display;
    }, 1000);
}

socket.on("jackpot:update", (data) => {
    const prizeElement = document.getElementById('jackpotPrize');
    if (prizeElement) prizeElement.textContent = data.prize + " USDT";
    if (data.nextDraw) { updateJackpotCountdown(data.nextDraw); }
    else { const countdownElement = document.getElementById('jackpotCountdown'); if (countdownElement) countdownElement.textContent = "--"; }
});

socket.emit("jackpot:get");
