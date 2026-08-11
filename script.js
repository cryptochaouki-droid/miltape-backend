/* =========================================================
   MILTAPE WORLD CHALLENGE - VERSION FINALE CORRIGÉE
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

/* =========================================================
   ÉTAT DU JEU
========================================================= */
let selectedBet = 1;
let joined = false;
let score = 0;
let leaderboardInterval = null;
let challengeInterval = null;
let timeLeft = 600; // 10 minutes (10 * 60 secondes)
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
   GESTION DU CHRONO PERSONNEL (10 MINUTES)
========================================================= */
function startPersonalTimer() {
    const tapButton = $("tapButton");
    const tapMessage = $("tapMessage");

    timeLeft = 600; // 10 minutes
    updateTimerDisplay();

    if (tapButton && joined) tapButton.disabled = false;
    if (tapMessage) tapMessage.textContent = "🔥 PARTIE LANCÉE - 10 MINUTES POUR TAPET !";

    if (challengeInterval) clearInterval(challengeInterval);

    challengeInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();

        if (timeLeft <= 0) {
            clearInterval(challengeInterval);
            if (tapButton) tapButton.disabled = true;
            
            showMessage("⏰ TEMPS ÉCOULÉ ! Score final enregistré.");
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerDisplay = $("timer");
    if (!timerDisplay) return;
    
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    
    timerDisplay.textContent = (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
}

/* =========================================================
   REJOINDRE LE JEU (AVEC GESTION DU PSEUDO DÉJÀ PRIS)
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
        if (tapButton) {
            tapButton.disabled = false;
            tapButton.focus();
        }

        showMessage("🔥 TU ES DANS LE CHALLENGE !");
        startPersonalTimer();
        loadLeaderboard();
    } catch (error) {
        console.error("JOIN ERROR:", error);
        showMessage("❌ " + error.message);
    }
}

/* =========================================================
   TAP & SCORE
========================================================= */
function sendTap() {
    if (!joined) return showMessage("⚡ ENTRE D'ABORD DANS LE CHALLENGE");
    if (timeLeft <= 0) return showMessage("⏰ TEMPS ÉCOULÉ POUR CETTE PARTIE");

    localTaps++;
    score++;
    updateScore();

    if (tapTimeout) clearTimeout(tapTimeout);
    tapTimeout = setTimeout(async () => {
        const tapsToSend = localTaps;
        localTaps = 0;
        try {
            await fetch(API_URL + "/api/tap", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId, count: tapsToSend })
            });
        } catch (e) { console.error("Tap error"); }
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
    leaderboardInterval = setInterval(loadLeaderboard, 3000);
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
   CLASSEMENT (POSITION & PSEUDO CÔTE À CÔTE + COULEURS)
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
        if (data.success) renderChat(data.messages || []);
    } catch (e) {}
}

function renderChat(msgs) {
    const container = $("chatMessages");
    if (!container) return;
    container.innerHTML = msgs.map(m => `
        <div class="chat-message"><strong>${escapeHTML(m.playerName)}:</strong> ${escapeHTML(m.message)}</div>`).join("");
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
        if (data.success) {
            chatInput.value = ""; 
            loadChat(); 
        } else {
            showMessage("❌ Erreur d'envoi du message");
        }
    } catch (e) {
        console.error("Chat send error", e);
    }
}

document.addEventListener("DOMContentLoaded", initMiltape);
