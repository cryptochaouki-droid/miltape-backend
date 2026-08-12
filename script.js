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

// Connexion Socket.io pour le temps réel (joueurs en ligne, chrono mondial, etc.)
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
let selectedBet = 1;
let joined = false;
let score = 0;
let leaderboardInterval = null;
let timeLeft = 600; // Temps initial par défaut
let currentStatus = "running"; // "running" ou "break"
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
   GESTION DU CHRONO MONDIAL ET DES PAUSES DE MISE (10 SEC)
========================================================= */
socket.on("global:timer", (data) => {
    timeLeft = data.timeLeft;
    currentStatus = data.status;
    
    updateTimerDisplay();

    const tapButton = $("tapButton");
    const tapMessage = $("tapMessage");
    const timerCardTitle = document.querySelector(".timer-card small");

    if (currentStatus === "break") {
        if (timerCardTitle) timerCardTitle.textContent = "⌛ TEMPS DE MISE (PAUSE)";
        if (tapButton) tapButton.disabled = true;
        if (tapMessage && joined) {
            if (timeLeft > 0) {
                tapMessage.textContent = "💰 PLACE TES MISES ! PROCHAINE PARTIE DANS " + timeLeft + "s";
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
                tapMessage.textContent = "⏰ TEMPS ÉCOULÉ POUR CE CHALLENGE !";
            }
        }
    }
});

// Réinitialisation lors du redémarrage d'une nouvelle partie
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
   REJOINDRE LE JEU
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
   TAP & SCORE (OPTIMISÉ ENVOI GROUPÉ)
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
   INITIALISATION
========================================================= */
async function initMiltape() {
    const customBetInput = $("customBetInput");
    if (customBetInput) customBetInput.addEventListener("input", () => {
        selectedBet = parseFloat(customBetInput.value) || 0;
        if ($("selectedBet")) $("selectedBet").textContent = "€" + selectedBet;
    });

    const enterButton = $("enterChallenge");
    if (enterButton) enterButton.addEventListener("click", () => $("entryModal").classList.add("show"));
    
    const confirmButton = $("confirmEntry");
    if (confirmButton) confirmButton.addEventListener("click", joinChallenge);

    const tapButton = $("tapButton");
    if (tapButton) tapButton.addEventListener("click", sendTap);

    // Écouteurs pour le Chat
    const chatSendButton = $("chatSend");
    if (chatSendButton) {
        chatSendButton.addEventListener("click", sendChatMessage);
    }

    const chatInput = $("chatInput");
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                sendChatMessage();
            }
        });
    }

    loadLeaderboard();
    loadChat();
    // Actualisation rapide du classement toutes les 1 seconde
    leaderboardInterval = setInterval(loadLeaderboard, 1000);
    setInterval(loadChat, 5000);
}

async function loadLeaderboard() {
    try {
        const res = await fetch(API_URL + "/api/leaderboard");
        const data = await res.json();
        if (data.success) renderLeaderboard(data.players || []);
    } catch (e) {}
}

/* =========================================================
   CLASSEMENT (AVEC POSITION # ET COULEURS)
========================================================= */
function renderLeaderboard(players) {
    const list = $("leaderboardList");
    if (!list) return;

    if (!players.length) {
        list.innerHTML = `<div class="empty-ranking">Aucun joueur</div>`;
        return;
    }

    list.innerHTML = players.map(p => {
        const isMe = p.playerId === playerId;
        
        let nameColor = "#ffffff";
        if (p.position === 1) nameColor = "#FFD700";
        else if (p.position === 2) nameColor = "#C0C0C0";
        else if (p.position === 3) nameColor = "#CD7F32";

        return `
            <div class="leaderboard-item ${isMe ? 'me' : ''}">
                <div class="rank">#${p.position}</div>
                <div class="player-name" style="color: ${nameColor};">${escapeHTML(p.playerName)}</div>
                <div class="player-score">${p.score}</div>
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
   CHAT — CHARGER ET ENVOYER LES MESSAGES
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

    // Fait descendre le chat automatiquement tout en bas pour voir les nouveaux messages
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

document.addEventListener("DOMContentLoaded", initMiltape);
