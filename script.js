document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    
    console.log("🚀 Initialisation du script frontend Miltape...");

    // Connexion Socket.io avec reconnexion automatique
    const socket = io(BACKEND_URL, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 20000
    });

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

    // Éléments du menu latéral et modale dynamique
    const myGamesButton = document.getElementById("menuGamesBtn") || document.getElementById("myGamesButton"); 
    const modalContent = document.getElementById("dynamicModalBody") || document.getElementById("modalContent");
    const dynamicModal = document.getElementById("dynamicModal");
    const closeDynamicModal = document.getElementById("closeDynamicModal");

    let localTaps = 0;
    let playerId = localStorage.getItem("miltape_player_id");
    if (!playerId) {
        playerId = 'player_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem("miltape_player_id", playerId);
    }
    
    let playerName = localStorage.getItem("miltape_player_name");
    if (!playerName) {
        playerName = "JoueurTest";
        localStorage.setItem("miltape_player_name", playerName);
    }

    if (tapButton) {
        tapButton.disabled = false;
    }
    if (tapMessage) {
        tapMessage.textContent = "🔥 MODE TEST ACTIF - TAPE !";
    }

    // --- 1. GESTION DES WEBSOCKETS (Chrono, Chat, En ligne, Classement) ---
    
    socket.on("connect", () => {
        console.log("✅ Connecté au serveur WebSocket ! ID:", socket.id);
        socket.emit("join", { playerId, playerName });
    });

    socket.on("connect_error", (err) => {
        console.error("❌ Erreur de connexion WebSocket :", err);
        if (tapMessage) {
            tapMessage.textContent = "🔴 Connexion au serveur perdue...";
        }
    });

    // Réception du Chrono en direct
    socket.on("timer", (timeLeft) => {
        console.log("⏱️ Chrono reçu du serveur :", timeLeft);
        if (timerDisplay) {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
            console.warn("⚠️ Élément DOM 'timer' introuvable !");
        }
    });

    // Nombre de joueurs en ligne
    socket.on("onlineCount", (count) => {
        if (onlineCount) {
            const onlineTextLabel = "EN LIGNE";
            onlineCount.innerHTML = `<span style="display:inline-block; width:8px; height:8px; background-color:#2ecc71; border-radius:50%; margin-right:5px;"></span> ${count} ${onlineTextLabel}`;
        }
    });

    // Classement Top 5 en direct
    socket.on("leaderboard", (players) => {
        if (leaderboardList) {
            if (!players || players.length === 0) {
                leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
                return;
            }
            leaderboardList.innerHTML = players.map((p, index) => `
                <div class="leaderboard-item" style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span>#${index + 1} <strong>${p.playerName || 'Anonyme'}</strong></span>
                    <span style="color: #ffcc00;">${p.score || 0} taps</span>
                </div>
            `).join('');
        }
    });

    // Réception des messages du Chat en direct
    socket.on("chatMessage", (msg) => {
        console.log("💬 Message de chat reçu :", msg);
        if (chatMessages) {
            const messageElement = document.createElement("div");
            messageElement.classList.add("chat-message");
            messageElement.style.marginBottom = "5px";
            const senderName = msg.playerName || msg.name || 'Anonyme';
            const messageText = msg.message || msg.text || '';
            messageElement.innerHTML = `<strong>${senderName}</strong>: ${messageText}`;
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            console.warn("⚠️ Élément DOM 'chatMessages' introuvable !");
        }
    });

    // Envoi de messages dans le chat
    if (chatSend && chatInput) {
        chatSend.addEventListener("click", () => {
            const text = chatInput.value.trim();
            if (text) {
                socket.emit("chatMessage", { playerId: playerId, playerName: playerName, message: text });
                chatInput.value = "";
            }
        });

        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                chatSend.click();
            }
        });
    }

    // Gestion des Taps
    if (tapButton) {
        tapButton.addEventListener("click", () => {
            localTaps++;
            if (tapCountDisplay) tapCountDisplay.textContent = localTaps;
            if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = localTaps;
            
            socket.emit("tap", { playerId, playerName, taps: 1 });
        });
    }

    // --- 2. FONCTION MODALE ---
    function openDynamicModal(title, htmlContent) {
        if (dynamicModal && modalContent) {
            const titleElem = document.getElementById("dynamicModalTitle");
            if (titleElem) titleElem.textContent = title;
            modalContent.innerHTML = htmlContent;
            dynamicModal.classList.add("show");
        }
    }

    if (closeDynamicModal && dynamicModal) {
        closeDynamicModal.addEventListener("click", () => dynamicModal.classList.remove("show"));
    }

    // --- 3. CHARGER LE TOTAL DES MISES ---
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

    // --- 4. CHARGER LES STATS DU JOUEUR ("Mes parties") ---
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
                    <p>Total Taps : <strong>${data.totalTaps || localTaps}</strong></p>
                    <p>Mises validées : <strong>${data.totalUsdt || 0} USDT</strong></p>
                    <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
                    <h4>Historique récent</h4>
                    <ul>
                        ${data.history && data.history.length > 0 ? data.history.map(h => `<li>Partie du ${new Date(h.date).toLocaleDateString()} : ${h.score} taps</li>`).join('') : '<li>Aucune partie payée enregistrée.</li>'}
                    </ul>
                `;
            } else {
                if (modalContent) {
                    modalContent.innerHTML = `
                        <p style="color: #ffcc00; margin-bottom: 10px;">Total Taps actuels : <strong>${localTaps}</strong></p>
                        <p style="font-size: 11px; color: #888;">ID Joueur : ${playerId}</p>
                    `;
                }
            }
        } catch (e) {
            console.error("Erreur chargement stats:", e);
            if (modalContent) {
                modalContent.innerHTML = `
                    <p>Total Taps locaux : <strong>${localTaps}</strong></p>
                    <p style="font-size: 11px; color: #aaa; margin-top: 8px;">Impossible de récupérer l'historique distant pour le moment.</p>
                `;
            }
        }
    }

    if (myGamesButton) {
        myGamesButton.addEventListener("click", loadPlayerStats);
    }
});
