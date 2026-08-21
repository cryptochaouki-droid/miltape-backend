/* =========================================================
   SCRIPT CLIENT MILTAPE - VERSION FINALE 100% FONCTIONNELLE
========================================================= */

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

// ==========================================
// 1. SYSTEME DE TOASTS (Notifications)
// ==========================================
function showToast(message, type = "success") {
    let toastBox = document.getElementById('toastBox');
    if (!toastBox) {
        toastBox = document.createElement('div');
        toastBox.id = 'toastBox';
        toastBox.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:10px;align-items:center;";
        document.body.appendChild(toastBox);
    }
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `padding:12px 20px;border-radius:10px;font-weight:bold;color:#fff;font-family:'Orbitron',sans-serif;box-shadow:0 4px 15px rgba(0,0,0,0.5);background:${type === 'error' ? '#ff5b5b' : '#2ecc71'};margin-bottom:10px;`;
    toastBox.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ==========================================
// 2. SYSTEME DE MODALE (Remplace les prompt/alert)
// ==========================================
function showCustomModal(title, contentHTML, buttonText = "VALIDER") {
    const modal = document.getElementById('dynamicModal');
    document.getElementById('dynamicModalTitle').innerText = title;
    const body = document.getElementById('dynamicModalBody');
    body.innerHTML = contentHTML;
    
    const btn = document.createElement('button');
    btn.innerText = buttonText;
    btn.style.cssText = "margin-top:10px;width:100%;padding:12px;background:#ffcc00;color:#16051f;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-family:'Orbitron',sans-serif;";
    btn.onclick = () => modal.classList.remove('show');
    body.appendChild(btn);

    modal.classList.add('show');
}

// ==========================================
// 3. TELEGRAM
// ==========================================
function getTelegramUser() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const user = window.Telegram.WebApp.initDataUnsafe?.user;
            if (user && user.username) return user.username;
            if (user && user.first_name) return user.first_name;
        }
        return null;
    } catch (e) { return null; }
}

// ==========================================
// 4. MODE DEMO
// ==========================================
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

if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
        if (demoMode) {
            demoMode = false;
            localStorage.setItem("miltape_demo", "false");
            updateDemoUI();
            showToast("MODE DEMO DESACTIVE");
            return;
        }

        const password = prompt("Entrez le mot de passe administrateur :");
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
                showToast("MODE DEMO ACTIVE");
            } else {
                showToast("MOT DE PASSE INCORRECT", "error");
            }
        } catch (error) {
            showToast("ERREUR SERVEUR", "error");
        }
    });
}

// ==========================================
// 5. CONNEXION WALLET (TronLink ou Manuel)
// ==========================================
async function connectTronWallet() {
    if (!window.tronWeb || !window.tronWeb.defaultAddress) {
        showCustomModal("WALLET", `<input type="text" id="modalWallet" placeholder="Entre ton adresse T..." style="width:100%;padding:12px;background:#1a1a2e;color:#fff;border:1px solid #ffcc00;border-radius:8px;box-sizing:border-box;font-family:'Orbitron',sans-serif;">`, "CONNECTER");
        setTimeout(() => {
            const btn = document.getElementById('dynamicModalBody').lastElementChild;
            btn.onclick = () => {
                const w = document.getElementById('modalWallet').value;
                document.getElementById('dynamicModal').classList.remove('show');
                return w; // Retourne l'adresse manuelle
            };
        }, 100);
        return null; // Retourne null pour continuer via la modale
    }
    try {
        await window.tronWeb.request({ method: 'tron_requestAccounts' });
        const address = window.tronWeb.defaultAddress.base58;
        showToast("WALLET CONNECTE", "success");
        return address;
    } catch { 
        showToast("CONNEXION REFUSEE", "error"); 
        return null; 
    }
}

// ==========================================
// 6. REJOINDRE LA PARTIE
// ==========================================
async function joinGame() {
    let name = getTelegramUser();
    if (!name) {
        showCustomModal("PSEUDO", `<input type="text" id="modalName" placeholder="Pseudo" style="width:100%;padding:12px;background:#1a1a2e;color:#fff;border:1px solid #ffcc00;border-radius:8px;box-sizing:border-box;font-family:'Orbitron',sans-serif;">`, "VALIDER");
        setTimeout(() => {
            const btn = document.getElementById('dynamicModalBody').lastElementChild;
            btn.onclick = async () => {
                name = document.getElementById('modalName').value;
                document.getElementById('dynamicModal').classList.remove('show');
                if (!name) return showToast("PSEUDO REQUIS", "error");
                await proceedWallet(name);
            };
        }, 100);
    } else {
        await proceedWallet(name);
    }
}

async function proceedWallet(name) {
    let wallet = await connectTronWallet();
    
    // Si TronLink n'est pas là, on attend la valeur de la modale
    if (!wallet) {
        const modalBtn = document.getElementById('dynamicModalBody').lastElementChild;
        if (modalBtn) {
            modalBtn.onclick = () => {
                const w = document.getElementById('modalWallet').value;
                document.getElementById('dynamicModal').classList.remove('show');
                if (w) finalizeJoin(w, name);
            };
        }
    } else {
        finalizeJoin(wallet, name);
    }
}

function finalizeJoin(wallet, name) {
    let bet = 10;
    if (betInput) {
        const rawBet = parseFloat(betInput.value);
        if (!isNaN(rawBet) && rawBet >= 0.5 && rawBet <= 1000000) bet = rawBet;
    }
    isSpectator = false;
    myBet = bet; 
    myWallet = wallet;
    tapMessage.innerText = "CONNEXION AU SERVEUR EN COURS...";
    socket.emit("player:join", { name, wallet, bet });
    localStorage.removeItem("miltape_spectator");
}

if (enterChallenge) enterChallenge.addEventListener('click', joinGame);

// ==========================================
// 7. MODE SPECTATEUR
// ==========================================
function joinSpectator() {
    const name = getTelegramUser() || "Spectateur";
    
    isSpectator = true;
    isPlaying = true;
    isPaid = true;
    tapButton.disabled = true;
    tapMessage.innerText = "MODE SPECTATEUR : " + name.toUpperCase();
    enterChallenge.style.display = 'none';
    if (spectatorBtn) {
        spectatorBtn.classList.add('active');
        spectatorBtn.textContent = 'SPECTATEUR ACTIF';
    }
    if (payButton) payButton.style.display = 'none';
    if (betInput) betInput.disabled = true;

    socket.emit("spectator:join", { name });
}

if (spectatorBtn) spectatorBtn.addEventListener('click', joinSpectator);

// ==========================================
// 8. RESTAURATION DE SESSION
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
        tapMessage.innerText = "SPECTATEUR : " + name;
        enterChallenge.style.display = 'none';
        if (spectatorBtn) {
            spectatorBtn.classList.add('active');
            spectatorBtn.textContent = 'SPECTATEUR ACTIF';
        }
        if (payButton) payButton.style.display = 'none';
        if (betInput) betInput.disabled = true;
        return true;
    }

    if (!playerId || !wallet || !name) return false;

    try {
        const res = await fetch(`${API_URL}/api/status`);
        const data = await res.json();
        if (data.status !== "running") {
            localStorage.clear();
            return false;
        }
    } catch (error) { return false; }

    socket.emit("player:restore", { playerId, wallet });
    return true;
}

// ==========================================
// 9. SOCKET EVENTS
// ==========================================
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
        
        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());
        localStorage.removeItem("miltape_spectator");

        if (demoMode) {
            isPaid = true;
            tapButton.disabled = false;
            tapMessage.innerText = "MODE DEMO : TAPE !";
            fetch(API_URL + "/api/payment/verify", { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({txId: "DEMO_"+Date.now(), wallet: data.player.wallet, amount: data.player.bet, playerId: data.player.id})
            }).catch(()=>{});
        } else {
            if (payButton) { 
                payButton.style.display = 'block'; 
                payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet); 
            }
        }
    }
});

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
            tapMessage.innerText = "MODE DEMO : BON RETOUR " + data.player.name;
        } else {
            isPaid = false;
            tapButton.disabled = true;
            tapMessage.innerText = data.player.name + ", PAIE TA MISE POUR CONTINUER !";
            if (payButton) {
                payButton.style.display = 'block';
                payButton.onclick = () => initiatePayment(data.player.wallet, data.player.bet);
            }
        }

        enterChallenge.style.display = "none";
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;

        localStorage.setItem("miltape_player_id", data.player.id);
        localStorage.setItem("miltape_player_wallet", data.player.wallet);
        localStorage.setItem("miltape_player_name", data.player.name);
        localStorage.setItem("miltape_player_bet", data.player.bet.toString());
    } else {
        localStorage.clear();
        enterChallenge.style.display = 'block';
        tapMessage.innerText = "REJOINS LA NOUVELLE PARTIE !";
    }
});

socket.on("spectator:joined", (data) => {
    if (data.success) {
        isSpectator = true;
        isPlaying = true;
        isPaid = true;
        tapButton.disabled = true;
        tapMessage.innerText = "VOUS REGARDEZ EN DIRECT (" + data.spectators + " SPECTATEURS)";
        if (payButton) payButton.style.display = 'none';
        if (betInput) betInput.disabled = true;
        localStorage.setItem("miltape_spectator", "true");
        localStorage.setItem("miltape_player_name", data.name);
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

// ==========================================
// 10. FIN DE PARTIE
// ==========================================
socket.on("game:finished", (data) => {
    if (tapCount) tapCount.innerText = "0";
    if (tapButtonCount) tapButtonCount.innerText = "0";
    isPlaying = false;
    isPaid = false;
    tapButton.disabled = true;

    if (!isSpectator) {
        let message = "RESULTATS DE LA PARTIE\n";
        message += "==============================\n\n";
        if (data.winners && data.winners.length > 0) {
            message += "LES 5 GAGNANTS (2X LEUR MISE) :\n\n";
            data.winners.forEach((w, index) => {
                const pos = index === 0 ? "1ER" : index === 1 ? "2EME" : index === 2 ? "3EME" : "GAGNANT";
                message += pos + " #" + w.rank + " " + w.name + "\n";
                message += "   MISE : " + w.bet + " USDT -> GAIN : " + w.gain + " USDT\n\n";
            });
        } else {
            message += "AUCUN GAGNANT CETTE FOIS-CI.\n\n";
        }
        message += "==============================\n";
        message += "TOTAL DES MISES : " + data.totalStakes + " USDT\n";
        message += "TOTAL REDISTRIBUE : " + data.totalPayout + " USDT\n";
        message += "==============================\n";
        message += "PROCHAINE PARTIE DANS 5 SECONDES...";

        tapMessage.innerText = "PARTIE TERMINEE ! " + (data.winners ? data.winners.length : 0) + " GAGNANT(S) !";
        alert(message);
    } else {
        tapMessage.innerText = "PARTIE TERMINEE ! PROCHAINE PARTIE DANS 5 SECONDES...";
    }

    enterChallenge.style.display = 'block';
    if (payButton) payButton.style.display = 'none';
    if (betInput) betInput.disabled = false;
    if (spectatorBtn) {
        spectatorBtn.classList.remove('active');
        spectatorBtn.textContent = 'REGARDER EN DIRECT (Spectateur)';
    }
    isSpectator = false;
    localStorage.clear();
});

// ==========================================
// 11. TAP AVEC COMBO
// ==========================================
if (tapButton) {
    tapButton.addEventListener('click', function() {
        if (!isPlaying || !isPaid || isSpectator) {
            if (!isPaid && !isSpectator) tapMessage.innerText = "TU DOIS PAYER TA MISE AVANT DE TAPER !";
            return;
        }

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

// ==========================================
// 12. CHAT
// ==========================================
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) socket.emit("chat:send", { message: text });
    chatInput.value = "";
}
if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

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
// 13. PAIEMENT
// ==========================================
function initiatePayment(wallet, amount) {
    fetch(API_URL + "/api/wallet")
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const serverWallet = data.wallet;
                const paymentUrl = `https://t.me/wallet?start=transfer?to=${serverWallet}&amount=${amount}&token=USDT`;
                window.open(paymentUrl, '_blank');
                showToast("ENVOIE " + amount + " USDT VERS : " + serverWallet);
            } else {
                showToast("IMPOSSIBLE DE RECUPERER LE WALLET", "error");
            }
        })
        .catch(() => showToast("ERREUR RESEAU", "error"));
}

// ==========================================
// 14. MENU ET MODALES
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

const closeModalBtn = document.getElementById('closeDynamicModal');
if (closeModalBtn) closeModalBtn.addEventListener('click', () => document.getElementById('dynamicModal').classList.remove('show'));

// Boutons du menu
const menuGamesBtn = document.getElementById('menuGamesBtn');
if (menuGamesBtn) menuGamesBtn.addEventListener('click', () => showCustomModal("MES PARTIES", "<p>Aucune partie enregistree.</p>", "FERMER"));
const menuRankingsBtn = document.getElementById('menuRankingsBtn');
if (menuRankingsBtn) menuRankingsBtn.addEventListener('click', () => showCustomModal("MES CLASSEMENTS", "<p>Ton meilleur score: " + (tapCount ? tapCount.textContent : '0') + " taps</p>", "FERMER"));
const menuGainsBtn = document.getElementById('menuGainsBtn');
if (menuGainsBtn) menuGainsBtn.addEventListener('click', () => showCustomModal("MES GAINS", "<p>Total gagne: 0 USDT</p>", "FERMER"));
const menuWithdrawalsBtn = document.getElementById('menuWithdrawalsBtn');
if (menuWithdrawalsBtn) menuWithdrawalsBtn.addEventListener('click', () => showCustomModal("MES RETRAITS", "<p>Aucun retrait effectue.</p>", "FERMER"));
const menuReferralBtn = document.getElementById('menuReferralBtn');
if (menuReferralBtn) menuReferralBtn.addEventListener('click', () => showCustomModal("PARRAINAGE", "<p>Parraine tes amis et gagne des bonus !</p><p style='font-size:11px;'>https://cryptochaouki-droid.github.io/miltape-backend/</p>", "FERMER"));
const menuChatBtn = document.getElementById('menuChatBtn');
if (menuChatBtn) menuChatBtn.addEventListener('click', () => { document.getElementById('globalChat').scrollIntoView({behavior:'smooth'}); toggleMenu(); });
const menuRulesBtn = document.getElementById('menuRulesBtn');
if (menuRulesBtn) menuRulesBtn.addEventListener('click', () => showCustomModal("REGLES DU JEU", "<p><strong>10 minutes</strong> pour taper le plus possible.</p><p><strong>Top 5</strong> seulement.</p><p><strong>USDT (TRC20)</strong> - mise de 0.50 a 1 000 000 USDT.</p><p><strong>Gains:</strong> les 5 premiers gagnent 2x leur mise.</p>", "FERMER"));
