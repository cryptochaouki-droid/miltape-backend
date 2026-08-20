/* =========================================================
   NOUVEAU PROJET - SCRIPT CÔTÉ CLIENT (NAVIGATEUR)
========================================================= */

// Connexion au serveur WebSocket
const socket = io();

// 1. Récupération de tes boutons et éléments HTML 
// (Vérifie que les ID correspondent bien à ceux dans ton index.html)
const joinButton = document.getElementById("join-btn");
const tapButton = document.getElementById("tap-btn");
const scoreDisplay = document.getElementById("score-display");
const timerDisplay = document.getElementById("timer-display");
const leaderboardList = document.getElementById("leaderboard");

let myPlayerId = null;

// ==========================================
// ACTIONS DU JOUEUR (ENVOI AU SERVEUR)
// ==========================================

// Quand le joueur veut rejoindre la partie
if (joinButton) {
    joinButton.addEventListener("click", () => {
        // Tu pourras remplacer ces "prompt" par des vrais champs HTML plus tard
        const name = prompt("Entre ton pseudo :");
        const wallet = prompt("Entre ton adresse TRON :");
        const bet = 10; // Montant de la mise par défaut
        
        if (name && wallet) {
            socket.emit("player:join", { name, wallet, bet });
        }
    });
}

// Quand le joueur clique pour taper
if (tapButton) {
    tapButton.addEventListener("click", () => {
        socket.emit("player:tap");
    });
}

// ==========================================
// RÉPONSES DU SERVEUR (RÉCEPTION SUR LE NAVIGATEUR)
// ==========================================

// Le serveur confirme que tu as rejoint la partie
socket.on("player:joined", (data) => {
    if (data.success) {
        alert("Bienvenue dans la partie " + data.player.name + " !");
        myPlayerId = data.player.id;
        if (scoreDisplay) scoreDisplay.innerText = data.player.taps;
    }
});

// Le serveur met à jour ton score personnel
socket.on("player:score", (data) => {
    if (scoreDisplay) {
        scoreDisplay.innerText = data.taps;
    }
});

// Le serveur met à jour le chronomètre pour tout le monde
socket.on("timer:update", (data) => {
    if (timerDisplay) {
        timerDisplay.innerText = data.remainingSeconds + " sec";
    }
});

// Le serveur met à jour le classement général (Top 5)
socket.on("leaderboard:update", (leaderboard) => {
    if (leaderboardList) {
        leaderboardList.innerHTML = ""; // On vide la liste
        leaderboard.forEach(player => {
            const li = document.createElement("li");
            li.innerText = `#${player.rank} - ${player.name} : ${player.taps} clics`;
            leaderboardList.appendChild(li);
        });
    }
});

// Gérer les erreurs renvoyées par le serveur
socket.on("error", (err) => {
    alert("Erreur : " + err.message);
});
