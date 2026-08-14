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

    // Éléments de la modale dynamique "Mes parties"
    const myGamesButton = document.getElementById("myGamesButton"); 
    const modalContent = document.getElementById("modalContent");
    const dynamicModal = document.getElementById("dynamicModal");

    let localTaps = 0;
    let playerId = localStorage.getItem("miltape_player_id");
    let playerName = localStorage.getItem("miltape_player_name");

    if (playerId && playerName) {
        if (tapButton) tapButton.disabled = false;
        if (tapMessage) tapMessage.textContent = "🔥 CHALLENGE PRÊT - TAPE !";
    }

    // --- Fonction d'aide pour ouvrir la modale ---
    function openDynamicModal(title, htmlContent) {
        if (dynamicModal && modalContent) {
            const titleElem = document.getElementById("dynamicModalTitle");
            if (titleElem) titleElem.textContent = title;
            modalContent.innerHTML = htmlContent;
            dynamicModal.classList.add("show");
        }
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

    // --- Nouvelle fonction : Charger les stats du joueur avec gestion d'erreur ---
    async function loadPlayerStats() {
        if (!playerId) {
            alert("Tu dois d'abord participer à un challenge !");
            return;
        }

        openDynamicModal("🎮 Mes parties", "Chargement de tes données...");

        try {
            const res = await fetch(`${BACKEND_URL}/api/player-stats/${playerId}`);
            
            if (!res.ok) {
                throw new Error(`Erreur serveur (${res.status})`);
            }

            const data = await res.json();

            if (data.success && modalContent) {
                modalContent.innerHTML = `
                    <h3>Mes Statistiques</h3>
                    <p>Total Taps : <strong>${data.totalTaps || 0}</strong></p>
                    <p>Mises validées : <strong>${data.totalUsdt || 0} USDT</strong></p>
                    <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
                    <h4>Historique récent</h4>
                    <ul>
                        ${data.history && data.history.length > 0 ? data.history.map(h => `<li>Partie du ${new Date(h.date).toLocaleDateString()} : ${h.score} taps</li>`).join('') : '<li>Aucune partie enregistrée.</li>'}
                    </ul>
                `;
            } else {
                if (modalContent) {
                    modalContent.innerHTML = `
                        <p style="color: #ffcc00; margin-bottom: 10px;">Aucune donnée enregistrée pour le moment.</p>
                        <p style="font-size: 11px; color: #888;">ID Joueur : ${playerId}</p>
                    `;
                }
            }
        } catch (e) {
            console.error("Erreur chargement stats:", e);
            if (modalContent) {
                modalContent.innerHTML = `
                    <p style="color: #ff4444;">Impossible de récupérer l'historique des parties (erreur serveur).</p>
                    <p style="font-size: 11px; color: #aaa; margin-top: 8px;">Vérifie que la route <code>/api/player-stats/:playerId</code> est bien configurée et déployée sur ton serveur Railway.</p>
                `;
            }
        }
    }

    // Écouteur pour le bouton "Mes parties"
    if (myGamesButton) {
        myGamesButton.addEventListener("click", loadPlayerStats);
    }
});
