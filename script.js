/* =========================================================
   MILTAPE WORLD CHALLENGE - CHRONO MONDIAL SYNCHRONISÉ
========================================================= */

const API_URL = "https://miltape-backend-production.up.railway.app";

let playerId = localStorage.getItem("miltape_player_id");
let playerName = localStorage.getItem("miltape_player_name");

if (!playerId) {
    playerId = "player_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    localStorage.setItem("miltape_player_id", playerId);
}

if (!playerName) {
    playerName = "Joueur_" + Math.floor(Math.random() * 9000 + 1000);
    localStorage.setItem("miltape_player_name", playerName);
}

// Connexion Socket.io pour le temps réel
const socket = io(API_URL);

socket.on("online:count", (count) => {
    const onlineEl = $("onlineCount");
    if (onlineEl) {
        onlineEl.innerHTML = `<span style="display:inline-block; width:8px; height:8px; background-color:#2ecc71; border-radius:50%; margin-right:5px;"></span> ${count} EN LIGNE`;
    }
});

/* =========================================================
   ÉTAT DU JEU
========================================================= */
let selectedBet = 2; // Minimum 2$ pour NOWPayments
let joined = false;
let score = 0;
let leaderboardInterval = null;
let timeLeft = 600; 
let currentStatus = "running"; 
let localTaps = 0;
let tapTimeout = null;

function $(id) { return document.getElementById(id); }

function showMessage(text) {
    const message = $("tapMessage");
    if (!message) return;
    message.textContent = text;
    message.classList.add("show");
    setTimeout(() => { message.classList.remove("show"); }, 2500);
}

/* =========================================================
   GESTION DU CHRONO MONDIAL ET DES PAUSES
========================================================= */
socket.on("global:timer", (data) => {
    timeLeft = data.timeLeft;
    currentStatus = data.status;
    
    updateTimerDisplay();

    const tapButton = $("tapButton");
    const tapMessage = $("tapMessage");
    const timerCardTitle = document.querySelector(".timer-card small");

    if (currentStatus === "break") {
        if (timerCardTitle) timerCardTitle.textContent = "🏆 RÉSULTATS DU TOP";
        if (tapButton) tapButton.disabled = true;
        if (tapMessage && joined) {
            if (timeLeft > 0) {
                tapMessage.textContent = "🏆 PARTIE TERMINÉE ! RÉSULTATS DES GAGNANTS - PROCHAINE DANS " + timeLeft + "s";
                tapMessage.classList.add("show");
            } else {
                tapMessage.textContent = "🚀 LANCEMENT IMMÉDIAT DE LA PARTIE...";
            }
        }
    } else {
        if (timerCardTitle) timerCardTitle.textContent = "CHALLENGE EN COURS";
        if (timeLeft > 0) {
            if (tapButton && joined) tapButton.disabled = false;
        } else {
            if (tapButton) tapButton.disabled = true;
            if (tapMessage && joined) {
                tapMessage.textContent = "⏰ TEMPS ÉCOULÉ ! VOICI LES GAGNANTS DU TOP !";
                tapMessage.classList.add("show");
            }
        }
    }
});

socket.on("game:restart", () => {
    score = 0;
    updateScore();
    showMessage("🚀 UNE NOUVELLE PARTIE COMMENCE !");
    loadLeaderboard();
});

function updateTimerDisplay() {
    const timerDisplay = $("timer");
    if (!timerDisplay) return;
    
    let timeVal = parseInt(timeLeft, 10);
    if (isNaN(timeVal) || timeVal < 0) {
        timeVal = 0;
    }
    
    const minutes = Math.floor(timeVal / 60);
    const seconds = timeVal % 60;
    
    timerDisplay.textContent = (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
}

/* =========================================================
   REJOINDRE LE JEU (MODE GRATUIT / TEST)
========================================================= */
async function joinChallenge() {
    const nameInput = $("customPlayerName");
    if (nameInput && nameInput.value.trim() !== "") {
        playerName = nameInput.value.trim();
        localStorage.setItem("miltape_player_name", playerName);
    }

    try {
        const response = await fetch(API_URL + "/api/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId, playerName })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "JOIN_ERROR");
        }

        joined = true;
        score = 0;
        updateScore();
        
        const modal = $("entryModal");
        if (modal) modal.classList.remove("show");
        
        const tapButton = $("tapButton");
        if (tapButton && timeLeft > 0 && currentStatus === "running") {
            tapButton.disabled = false;
            tapButton.focus();
        }

        showMessage("🔥 TU ES DANS LE CHALLENGE GLOBAL !");
        loadLeaderboard();
    } catch (error) {
        console.error("JOIN ERROR:", error);
        showMessage("❌ " + error.message);
    }
}

/* =========================================================
   PAIEMENT NOWPAYMENTS DIRECT (SANS ERREUR 400)
========================================================= */
async function startNowPayments() {
    const nameInput = $("customPlayerName");
    if (nameInput && nameInput.value.trim() !== "") {
        playerName = nameInput.value.trim();
        localStorage.setItem("miltape_player_name", playerName);
    }

    // Sécurité : Montant minimum 2$
    const amount = Math.max(2, parseFloat(selectedBet) || 2);

    try {
        showMessage("⏳ Connexion au serveur...");

        // 1. Inscription du joueur
        const joinResponse = await fetch(API_URL + "/api/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId, playerName })
        });

        const joinData = await joinResponse.json();
        if (!joinResponse.ok || !joinData.success) {
            throw new Error(joinData.error || "JOIN_ERROR");
        }

        joined = true;
        showMessage("⏳ Génération du paiement USDT TRC-20...");

        // 2. Appel direct à l'API Payment
        const response = await fetch(API_URL + "/api/create-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId, playerName, amount })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Erreur lors de la création du paiement");
        }

        // Si le serveur nous renvoie une adresse directe de dépôt USDT
        if (data.pay_address) {
            const modal = $("entryModal");
            if (modal) modal.classList.remove("show");

            alert(
                `⚡ PAIEMENT CRÉÉ AVEC SUCCÈS !\n\n` +
                `Envoyez exactement: ${data.pay_amount} USDT (TRC-20)\n` +
                `À l'adresse suivante:\n${data.pay_address}\n\n` +
                `Dès réception du transfert par le réseau, votre participation sera validée !`
            );
            
            showMessage("✅ Adresse de paiement générée !");
        } else if (data.invoice_url) {
            // Sinon redirection standard
            window.location.href = data.invoice_url;
        } else {
            throw new Error("Lien ou adresse de paiement introuvable");
        }

    } catch (error) {
        console.error("PAYMENT ERROR:", error);
        alert("ERREUR : " + error.message);
        showMessage("❌ " + error.message);
    }
}

/* =========================================================
   TAP & SCORE
========================================================= */
function sendTap() {
    if (!joined) return showMessage("⚡ ENTRE D'ABORD DANS LE CHALLENGE");
    if (currentStatus === "break") return showMessage("⌛ PATIENCE, TEMPS DE MISE EN COURS");
    if (timeLeft <= 0) return showMessage("⏰ TEMPS ÉCOULÉ POUR CE CHALLENGE");

    localTaps++;
    score++;
    updateScore();

    if (tapTimeout) clearTimeout(tapTimeout);
    tapTimeout = setTimeout(async () => {
        const tapsToSend = localTaps;
        localTaps = 0;
        if (tapsToSend <= 0) return;

        try {
            await fetch(API_URL + "/api/tap", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId, count: tapsToSend })
            });
        } catch (e) { 
            console.error("Tap error", e); 
        }
    }, 400);
}

function updateScore() {
    requestAnimationFrame(() => {
        const tapCount = $("tapCount");
        const tapButtonCount = $("tapButtonCount");
        if (tapCount) tapCount.textContent = score;
        if (tapButtonCount) tapButtonCount.textContent = score;
    });
}

/* =========================================================
   CLASSEMENT
========================================================= */
async function loadLeaderboard() {
    try {
        const res = await fetch(API_URL + "/api/leaderboard");
        const data = await res.json();
        if (data.success) renderLeaderboard(data.players || []);
    } catch (e) {}
}

function renderLeaderboard(players) {
    const list = $("leaderboardList");
    if (!list) return;

    if (!players.length) {
        list.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
        return;
    }

    const topPlayers = players.slice(0, 5);

    list.innerHTML = topPlayers.map(p => {
        const isMe = p.playerId === playerId;
        
        let nameColor = "#ffffff";
        let crown = "";
        if (p.position === 1) { nameColor = "#FFD700"; crown = "👑 "; }
        else if (p.position === 2) nameColor = "#C0C0C0";
        else if (p.position === 3) nameColor = "#CD7F32";

        return `
            <div class="leaderboard-item ${isMe ? 'me' : ''}">
                <div class="rank">#${p.position}</div>
                <div class="player-name" style="color: ${nameColor};">${crown}${escapeHTML(p.playerName)}</div>
                <div class="player-score">${p.score} taps</div>
            </div>
        `;
    }).join("");
}

function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

/* =========================================================
   CHAT
========================================================= */
async function loadChat() {
    try {
        const res = await fetch(API_URL + "/api/chat");
        const data = await res.json();
        if (data.success) {
            renderChat(data.messages || []);
        }
    } catch (e) {
        console.error("Erreur chargement chat:", e);
    }
}

function renderChat(msgs) {
    const container = $("chatMessages");
    if (!container) return;
    
    container.innerHTML = msgs.map(m => `
        <div class="chat-message"><strong>${escapeHTML(m.playerName || "Anonyme")}:</strong> ${escapeHTML(m.message || "")}</div>
    `).join("");

    container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
    const chatInput = $("chatInput");
    if (!chatInput) return;
    
    const message = chatInput.value.trim();
    if (!message) return;

    if (!joined) {
        showMessage("⚡ ENTRE D'ABORD DANS LE CHALLENGE");
        return;
    }

    try {
        const response = await fetch(API_URL + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId, playerName, message })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            chatInput.value = ""; 
            loadChat(); 
        } else {
            showMessage("❌ " + (data.error || "Erreur d'envoi du message"));
        }
    } catch (e) {
        console.error("Chat send error:", e);
        showMessage("❌ Erreur de connexion au serveur");
    }
}

/* =========================================================
   INITIALISATION GLOBALE
========================================================= */
function initMiltape() {
    const customBetInput = $("customBetInput");
    if (customBetInput) {
        customBetInput.addEventListener("input", () => {
            selectedBet = parseFloat(customBetInput.value) || 2;
            if ($("selectedBet")) $("selectedBet").textContent = "€" + selectedBet;
        });
    }

    const enterButton = $("enterChallenge");
    if (enterButton) {
        enterButton.addEventListener("click", () => {
            const modal = $("entryModal");
            if (modal) modal.classList.add("show");
        });
    }
    
    const confirmButton = $("confirmEntry");
    if (confirmButton) confirmButton.addEventListener("click", joinChallenge);

    const payButton = $("confirmBetButton");
    if (payButton) {
        payButton.addEventListener("click", startNowPayments);
    }

    const tapButton = $("tapButton");
    if (tapButton) tapButton.addEventListener("click", sendTap);

    const chatSendButton = $("chatSend");
    if (chatSendButton) chatSendButton.addEventListener("click", sendChatMessage);

    const chatInput = $("chatInput");
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") sendChatMessage();
        });
    }

    loadLeaderboard();
    loadChat();

    if (leaderboardInterval) clearInterval(leaderboardInterval);
    leaderboardInterval = setInterval(loadLeaderboard, 1000);
    setInterval(loadChat, 5000);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMiltape);
} else {
    initMiltape();
}
