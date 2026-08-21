/* =========================================================
   NOUVEAU PROJET - SCRIPT CÔTÉ CLIENT (NAVIGATEUR)
========================================================= */

// 1. Initialisation de la connexion Socket.IO avec le serveur (URL corrigée)
const socket = io("https://miltape-backend.onrender.com");


// 2. Récupération des éléments HTML (DOM)
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

// Variables de l'état du joueur
let isPlaying = false;
let myPlayerId = null;

// ==========================================
// 3. REJOINDRE LA PARTIE
// ==========================================
function joinGame() {
    // Pour l'instant, on utilise des pop-ups simples pour récupérer les infos
    const name = prompt("Entre ton pseudo pour le classement :");
    const wallet = prompt("Entre ton adresse TRON (ex: T...) :");
    const bet = 10; // Mise de base par défaut
    
    if (name && wallet) {
        tapMessage.innerText = "Connexion au serveur en cours...";
        socket.emit("player:join", { name, wallet, bet });
    }
}

// Assigner le clic aux boutons "Jouer"
if (enterChallenge) enterChallenge.addEventListener('click', joinGame);
if (enterChallengeTop) enterChallengeTop.addEventListener('click', joinGame);

// Le serveur confirme que tu es bien entré dans la partie
socket.on("player:joined", (data) => {
    if (data.success) {
        isPlaying = true;
        myPlayerId = data.player.id;
        
        // Débloquer le bouton et mettre à jour le texte
        tapButton.disabled = false;
        tapMessage.innerText = `🔥 C'est parti ${data.player.name} ! Clique au maximum !`;
        enterChallenge.style.display = "none"; 
        
        // Afficher les scores (0 au début)
        if (tapCount) tapCount.innerText = data.player.taps;
        if (tapButtonCount) tapButtonCount.innerText = data.player.taps;
    }
});

// ==========================================
// 4. GESTION DES CLICS (TAPS)
// ==========================================
if (tapButton) {
    tapButton.addEventListener('click', () => {
        // On empêche de cliquer si la partie n'a pas commencé pour ce joueur
        if (!isPlaying || tapButton.disabled) return;
        
        // Petit effet visuel pour le clic
        tapButton.classList.add('tap-active');
        setTimeout(() => tapButton.classList.remove('tap-active'), 100);
        
        // On envoie le clic au serveur
        socket.emit("player:tap");
    });
}

// Le serveur valide le clic et renvoie le nouveau score
socket.on("player:score", (data) => {
    if (tapCount) tapCount.innerText = data.taps;
    if (tapButtonCount) tapButtonCount.innerText = data.taps;
});

// ==========================================
// 5. MISES À JOUR GLOBALES DU JEU
// ==========================================

// Chronomètre en direct
socket.on("timer:update", (data) => {
    if (timerDisplay) {
        const minutes = Math.floor(data.remainingSeconds / 60);
        const seconds = data.remainingSeconds % 60;
        timerDisplay.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
});

// Joueurs en ligne
socket.on("online:count", (count) => {
    if (onlineCount) {
        onlineCount.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:5px;"></span><span>${count} EN LIGNE</span>`;
    }
});

// Mise à jour du Top 5
socket.on("leaderboard:update", (leaderboard) => {
    if (leaderboardList) {
        leaderboardList.innerHTML = ""; // On vide la liste actuelle
        
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
// 6. CHAT GLOBAL
// ==========================================
function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        socket.emit("chat:send", { message: text });
        chatInput.value = ""; // Vider l'input
    }
}

// Envoyer au clic sur le bouton ou avec la touche "Entrée"
if (chatSend) chatSend.addEventListener('click', sendMessage);
if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

// Réception d'un message
socket.on("chat:message", (data) => {
    if (chatMessages) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message';
        msgDiv.innerHTML = `<strong>${data.name} :</strong> ${data.message}`;
        chatMessages.appendChild(msgDiv);
        
        // Auto-scroll pour voir toujours le dernier message
        chatMessages.scrollTop = chatMessages.scrollHeight; 
    }
});

// Gestion des erreurs
socket.on("error", (err) => {
    alert("⚠️ Erreur : " + err.message);
});

// ==========================================
// 7. GESTION DE L'INTERFACE (MENU LATÉRAL)
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
