/* =========================================================
   SCRIPT CLIENT MILTAPE – Version finale (sécurisée + spectateur + menu)
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
const verifyPaymentBtn = document.getElementById('verifyPaymentBtn');

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

// Appliquer le thème au chargement
applyTelegramTheme();

// Détecter les changements de thème dans Telegram
if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.onEvent('themeChanged', applyTelegramTheme);
}

// ==========================================
// 4. MODE DÉMO – GESTION
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
        if (!isSpectator) tapMessage.innerText = "🔬 MODE DÉMO ACTIF – Tu peux jouer sans payer !";
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
    if (spectatorBtn) {
        spectatorBtn.classList.add('active');
        spectatorBtn.textContent = '👁️ SPECTATEUR ACTIF';
    }

    if (payButton) payButton.style.display = 'none';
    if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
    if (betInput) betInput.disabled = true;

    socket.emit("spectator:join", { name });
}

if (spectatorBtn) {
    spectatorBtn.addEventListener('click', joinSpectator);
}

// ==========================================
// 6. RESTAURER LA SESSION (via événement socket)
// ==========================================
async function restoreSession() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const name = localStorage.getItem("miltape_player_name");
    const spectator = localStorage.getItem("miltape_spectator") === "true";

    if (spectator && name) {
        isSpectator = true;
        isPlaying = true;
        isPaid = true;
        tapButton.disabled = true;
        tapMessage.innerText = `👁️ Spectateur : ${name}`;
        enterChallenge.style.display = 'none';
        if (spectatorBtn) {
            spectatorBtn.classList.add('active');
            spectatorBtn.textContent = '👁️ SPECTATEUR ACTIF';
        }
        if (payButton) payButton.style.display = 'none';
        if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
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
            localStorage.removeItem("miltape_player_id");
            localStorage.removeItem("miltape_player_wallet");
            localStorage.removeItem("miltape_player_name");
            localStorage.removeItem("miltape_player_bet");
            localStorage.removeItem("miltape_spectator");
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
    tapMessage.innerText = "⚠️ Erreur de connexion au serveur.";
});

socket.on('disconnect', (reason) => {
    console.log('🔴 Socket déconnecté :', reason);
    tapMessage.innerText = "🔴 Déconnecté du serveur.";
});

// ==========================================
// 8. REJOINDRE LA PARTIE (joueur)
// ==========================================
function joinGame() {
    const telegramName = getTelegramUser();
    let name = telegramName || prompt("Entre ton pseudo pour le classement :");
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
        isSpectator = false;
        myBet = bet;
        myWallet = wallet;
        tapMessage.innerText = "Connexion au serveur en cours...";
        socket.emit("player:join", { name, wallet, bet });
        localStorage.removeItem("miltape_spectator");
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
        tapButton.disabled = true;
        tapMessage.innerText = `💰 ${data.player.name}, paie ta mise pour taper !`;
        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());
        localStorage.removeItem("miltape_spectator");

        if (demoMode) {
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = `🔬 Mode démo : ${data.player.name}, tape !`;
            if (payButton) payButton.style.display = 'none';
            if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';

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
// 10. CONFIRMATION SPECTATEUR
// ==========================================
socket.on("spectator:joined", (data) => {
    if (data.success) {
        isSpectator = true;
        isPlaying = true;
        isPaid = true;
        tapButton.disabled = true;
        tapMessage.innerText = `👁️ Vous regardez en direct (${data.spectators} spectateurs)`;
        if (payButton) payButton.style.display = 'none';
        if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
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
        isPlaying = true;
        isSpectator = false;
        myPlayerId = data.player.id;
        myWallet = data.player.wallet;
        myBet = data.player.bet || 10;
        localStorage.removeItem("miltape_spectator");

        if (demoMode) {
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = `🔬 Mode démo : bon retour ${data.player.name} !`;
        } else {
            isPaid = false;
            tapButton.disabled = true;
            tapMessage.innerText = `💰 ${data.player.name}, paie ta mise pour continuer à taper !`;
            if (payButton) {
                payButton.style.display = 'block';
                payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet);
            }
            if (verifyPaymentBtn) {
                verifyPaymentBtn.style.display = 'block';
                verifyPaymentBtn.onclick = () => verifyPayment(data.player.id, data.player.wallet, data.player.bet);
            }
        }

        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());

        console.log("✅ Session restaurée avec succès !");
    } else {
        console.warn("⚠️ Restauration échouée :", data.message);
        localStorage.removeItem("miltape_player_id");
        localStorage.removeItem("miltape_player_wallet");
        localStorage.removeItem("miltape_player_name");
        localStorage.removeItem("miltape_player_bet");
        localStorage.removeItem("miltape_spectator");
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
        tapMessage.innerText = "✅ Paiement vérifié ! Tape maintenant !";
        if (payButton) payButton.style.display = 'none';
        if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
    }
});

// ==========================================
// 13. FIN DE PARTIE – RÉINITIALISATION
// ==========================================
socket.on("game:finished", (data) => {
    console.log("🏁 Partie terminée !", data);

    if (tapCount) tapCount.innerText = "0";
    if (tapButtonCount) tapButtonCount.innerText = "0";
    isPlaying = false;
    isPaid = false;
    tapButton.disabled = true;

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
    if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
    if (betInput) betInput.disabled = false;
    if (spectatorBtn) {
        spectatorBtn.classList.remove('active');
        spectatorBtn.textContent = '👁️ REGARDER EN DIRECT (Spectateur)';
    }
    isSpectator = false;

    localStorage.removeItem("miltape_player_id");
    localStorage.removeItem("miltape_player_wallet");
    localStorage.removeItem("miltape_player_name");
    localStorage.removeItem("miltape_player_bet");
    localStorage.removeItem("miltape_spectator");
});

// ==========================================
// 14. GESTION DES CLICS (TAPS)
// ==========================================

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

    const ripple = document.createElement('div');
    ripple.className = 'tap-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    btn.parentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 800);

    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

if (tapButton) {
    tapButton.addEventListener('click', function(event) {
        if (!isPlaying || tapButton.disabled || !isPaid || isSpectator) {
            if (!isPaid && !isSpectator) {
                tapMessage.innerText = "⏳ Tu dois payer ta mise avant de taper !";
                setTimeout(() => {
                    tapMessage.innerText = `💰 Paie ta mise pour taper !`;
                }, 3000);
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
    if (tapCount) tapCount.innerText = data.taps;
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

// ==========================================
// 15. CHRONOMÈTRE EN DIRECT
// ==========================================
socket.on("timer:update", (data) => {
    if (timerDisplay) {
        const minutes = Math.floor(data.remainingSeconds / 60);
        const seconds = data.remainingSeconds % 60;
        timerDisplay.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
});

// ==========================================
// 16. AUTRES ÉVÉNEMENTS (online, leaderboard, chat)
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
// 17. CHAT GLOBAL
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
// 18. PAYEMENT – INITIATION (via Telegram Wallet)
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
// 19. PAYEMENT – VÉRIFICATION
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
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = "🔥 Tape maintenant !";
            if (payButton) payButton.style.display = 'none';
            if (verifyPaymentBtn) verifyPaymentBtn.style.display = 'none';
        } else {
            alert("❌ Paiement non vérifié : " + (data.message || "Transaction introuvable."));
            tapMessage.innerText = "❌ Paiement invalide. Réessaie.";
        }
    })
    .catch(err => {
        alert("❌ Erreur lors de la vérification.");
        console.error(err);
    });
}

// ==========================================
// 20. GESTION DES ERREURS SOCKET
// ==========================================
socket.on("error", (err) => {
    alert("⚠️ Erreur : " + err.message);
});

// ==========================================
// 21. MENU LATÉRAL + FONCTIONS DE MODALE
// ==========================================

// ---- Fonction pour afficher une modale ----
function showMenuMessage(title, content) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    if (modal && modalTitle && modalBody) {
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modal.classList.add('show');
    }
}

// ---- Fermeture de la modale ----
const closeModalBtn = document.getElementById('closeDynamicModal');
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', function() {
        document.getElementById('dynamicModal').classList.remove('show');
    });
}
// Fermer en cliquant à l'extérieur
const modalOverlay = document.getElementById('dynamicModal');
if (modalOverlay) {
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('show');
        }
    });
}

// ---- Boutons du menu ----
const menuGamesBtn = document.getElementById('menuGamesBtn');
if (menuGamesBtn) {
    menuGamesBtn.addEventListener('click', function() {
        showMenuMessage('🎮 Mes parties',
            `<p>Tu n'as pas encore de parties enregistrées.</p>
             <p style="color:#888;font-size:12px;">Rejoins une partie pour commencer !</p>`
        );
    });
}

const menuRankingsBtn = document.getElementById('menuRankingsBtn');
if (menuRankingsBtn) {
    menuRankingsBtn.addEventListener('click', function() {
        const score = tapCount ? tapCount.textContent : '0';
        showMenuMessage('🏆 Mes classements',
            `<p>Ton meilleur score : <strong style="color:#ffcc00;">${score}</strong> taps</p>
             <p style="color:#888;font-size:12px;">Continue à taper pour grimper dans le classement !</p>`
        );
    });
}

const menuGainsBtn = document.getElementById('menuGainsBtn');
if (menuGainsBtn) {
    menuGainsBtn.addEventListener('click', function() {
        showMenuMessage('💰 Mes gains',
            `<p>Total gagné : <strong style="color:#ffcc00;">0 USDT</strong></p>
             <p style="color:#888;font-size:12px;">Les gains sont versés en fin de partie.</p>`
        );
    });
}

const menuWithdrawalsBtn = document.getElementById('menuWithdrawalsBtn');
if (menuWithdrawalsBtn) {
    menuWithdrawalsBtn.addEventListener('click', function() {
        showMenuMessage('💸 Mes retraits',
            `<p>Tu n'as pas encore effectué de retrait.</p>
             <p style="color:#888;font-size:12px;">Les retraits sont disponibles après chaque partie.</p>`
        );
    });
}

const menuReferralBtn = document.getElementById('menuReferralBtn');
if (menuReferralBtn) {
    menuReferralBtn.addEventListener('click', function() {
        showMenuMessage('👥 Parrainage',
            `<p>Parraine tes amis et gagne des bonus !</p>
             <p style="color:#888;font-size:12px;">Lien de parrainage :<br>
             <span style="color:#ffcc00;word-break:break-all;font-size:11px;">https://cryptochaouki-droid.github.io/miltape-backend/</span></p>`
        );
    });
}

const menuChatBtn = document.getElementById('menuChatBtn');
if (menuChatBtn) {
    menuChatBtn.addEventListener('click', function() {
        const chatSection = document.getElementById('globalChat');
        if (chatSection) {
            chatSection.scrollIntoView({ behavior: 'smooth' });
            // Fermer le menu
            if (sideMenu) sideMenu.classList.remove('show');
            if (menuOverlay) menuOverlay.classList.remove('show');
        }
    });
}

const menuRulesBtn = document.getElementById('menuRulesBtn');
if (menuRulesBtn) {
    menuRulesBtn.addEventListener('click', function() {
        showMenuMessage('📜 Règles du jeu',
            `<p><strong>⏱️ 10 minutes</strong> pour taper le plus possible.</p>
             <p><strong>🏆 Top 5</strong> seulement.</p>
             <p><strong>🪙 USDT (TRC20)</strong> – mise de 0.50 à 1 000 000 USDT.</p>
             <p><strong>💰 Gains :</strong> les 5 premiers gagnent 2x leur mise.</p>
             <p style="color:#888;font-size:12px;">Bonne chance ! 🔥</p>`
        );
    });
}

// ==========================================
// 22. MENU LATÉRAL (ouverture/fermeture)
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
