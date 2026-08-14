document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    const socket = io(BACKEND_URL);

    // Éléments du DOM
    const timerDisplay = document.getElementById("timer");
    const tapButton = document.getElementById("tapButton");
    const tapCountDisplay = document.getElementById("tapCount");
    const tapButtonCountDisplay = document.getElementById("tapButtonCount");
    const tapMessage = document.getElementById("tapMessage");
    const onlineCount = document.getElementById("onlineCount");
    const leaderboardList = document.getElementById("leaderboardList");
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const chatSend = document.getElementById("chatSend");

    // Éléments d'inscription / paiement
    const confirmButton = document.getElementById("confirmButton") || document.getElementById("confirmBetButton");
    const playerNameInput = document.getElementById("playerNameInput") || document.getElementById("customPlayerName");
    const cryptoAddressInput = document.getElementById("cryptoAddressInput") || document.getElementById("customCryptoAddress");
    const customBetInput = document.getElementById("customBetInput");

    // Bouton "Mes parties" (Assure-toi que ton HTML a bien cet ID sur le bouton)
    const myGamesButton = document.getElementById("myGamesButton"); 
    const modalContent = document.getElementById("modalContent"); // L'élément où afficher les résultats

    let localTaps = 0;
    let playerId = localStorage.getItem("miltape_player_id");
    let playerName = localStorage.getItem("miltape_player_name");

    if (playerId && playerName) {
        if (tapButton) tapButton.disabled = false;
        if (tapMessage) tapMessage.textContent = "🔥 CHALLENGE PRÊT - TAPE !";
    }

    // --- Fonctions existantes ---
    async function loadTotalStakes() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/total-stakes`);
            const data = await res.json();
            if (data.success) {
                const headerMiseText = document.querySelector(".fa-sack-dollar")?.nextSibling || document.getElementById("headerMiseAmount");
                if (headerMiseText && headerMiseText.nodeType === Node.TEXT_NODE) {
                    headerMiseText.nodeValue = ` $${data.totalStakes}`;
                }
            }
        } catch (e) { console.error("Erreur total stakes:", e); }
    }
    loadTotalStakes();
    setInterval(loadTotalStakes, 15000);

    // --- 6. Nouvelle fonction : Charger les stats du joueur ---
    async function loadPlayerStats() {
        if (!playerId) {
            alert("Tu dois d'abord participer à un challenge !");
            return;
        }

        try {
            // Afficher un état de chargement dans la modale
            if (modalContent) modalContent.innerHTML = "Chargement de tes données...";

            const res = await fetch(`${BACKEND_URL}/api/player-stats/${playerId}`);
            const data = await res.json();

            if (data.success && modalContent) {
                modalContent.innerHTML = `
                    <h3>Mes Statistiques</h3>
                    <p>Total Taps : <strong>${data.totalTaps}</strong></p>
                    <p>Mises validées : <strong>${data.totalUsdt} USDT</strong></p>
                    <hr>
                    <h4>Historique récent</h4>
                    <ul>
                        ${data.history.map(h => `<li>Partie du ${new Date(h.date).toLocaleDateString()} : ${h.score} taps</li>`).join('')}
                    </ul>
                `;
            } else {
                if (modalContent) modalContent.innerHTML = "Aucune donnée trouvée pour ce joueur.";
            }
        } catch (e) {
            console.error("Erreur chargement stats:", e);
            if (modalContent) modalContent.innerHTML = "Erreur de connexion au serveur.";
        }
    }

    // Écouteur pour le bouton "Mes parties"
    if (myGamesButton) {
        myGamesButton.addEventListener("click", loadPlayerStats);
    }

    // ... (Le reste de ton code original : payAndJoin, socket events, tap, leaderboard, chat) ...
    // Note : Veille à conserver tes fonctions socket.on et autres listeners intacts ici.
});
