/* =========================================================
   MILTAPE WORLD CHALLENGE - VERSION CHRONO PERSONNEL 10 MIN
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
    const timerDisplay = $("timer");
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

        // Si le serveur refuse (ex: pseudo déjà pris), on déclenche une erreur avec le texte du serveur
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
        // Affiche proprement le message du serveur (ex: "Ce pseudo est déjà pris...")
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

function renderLeaderboard(players) {
    const list = $("leaderboardList");
    if (!list) return;
    list.innerHTML = players.map(p => `
        <div class="ranking-row ${p.playerId === playerId ? 'me' : ''}">
            <span class="rank">${p.position}</span>
            <strong>${p.playerName}</strong>
            <span class="score">${p.score}</span>
        </div>`).join("");
}

async function loadChat() {
    try {
        const res = await fetch(API_URL + "/api/chat");
        const data = await res.json();
        if (data.success) renderChat(data.messages || []);
    } catch (e) {}
}

function renderChat(msgs) {
    const container = $("chatMessages");
    if (container) container.innerHTML = msgs.map(m => `
        <div class="chat-message"><strong>${m.playerName}:</strong> ${m.message}</div>`).join("");
}

document.addEventListener("DOMContentLoaded", initMiltape);
