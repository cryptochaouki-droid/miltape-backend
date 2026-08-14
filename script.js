document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    
    console.log("🚀 Initialisation du script frontend Miltape...");

    const socket = io(BACKEND_URL, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 20000
    });

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

    // Éléments de la modale de démarrage
    const enterChallengeBtn = document.getElementById("enterChallenge");
    const entryModal = document.getElementById("entryModal");
    const cancelEntryBtn = document.getElementById("cancelEntry");
    const cancelEntryBottom = document.getElementById("cancelEntryBottom");
    const confirmBetButton = document.getElementById("confirmBetButton");
    const customPlayerName = document.getElementById("customPlayerName");

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

    if (customPlayerName) {
        customPlayerName.value = playerName;
    }

    // Gestion de l'ouverture/fermeture de la modale d'entrée
    if (enterChallengeBtn && entryModal) {
        enterChallengeBtn.addEventListener("click", () => {
            entryModal.classList.add("show");
        });
    }

    const closeEntryModal = () => {
        if (entryModal) entryModal.classList.remove("show");
    };

    if (cancelEntryBtn) cancelEntryBtn.addEventListener("click", closeEntryModal);
    if (cancelEntryBottom) cancelEntryBottom.addEventListener("click", closeEntryModal);

    // Validation du pseudo et activation du jeu
    if (confirmBetButton) {
        confirmBetButton.addEventListener("click", () => {
            const enteredName = customPlayerName ? customPlayerName.value.trim() : "";
            if (enteredName) {
                playerName = enteredName;
                localStorage.setItem("miltape_player_name", playerName);
            }

            closeEntryModal();

            // Activer le bouton de tap et le jeu
            if (tapButton) {
                tapButton.disabled = false;
            }
            if (tapMessage) {
                tapMessage.textContent = "🔥 À TOI DE TAPPER !";
            }

            // Rejoindre la room / notifier le serveur
            socket.emit("join", { playerId, playerName });
        });
    }

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

    socket.on("timer", (timeLeft) => {
        if (timerDisplay) {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    });

    socket.on("onlineCount", (count) => {
        if (onlineCount) {
            onlineCount.innerHTML = `<span style="display:inline-block; width:8px; height:8px; background-color:#2ecc71; border-radius:50%; margin-right:5px;"></span> ${count} EN LIGNE`;
        }
    });

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

    socket.on("chatMessage", (msg) => {
        if (chatMessages) {
            const messageElement = document.createElement("div");
            messageElement.classList.add("chat-message");
            messageElement.style.marginBottom = "5px";
            const senderName = msg.playerName || msg.name || 'Anonyme';
            const messageText = msg.message || msg.text || '';
            messageElement.innerHTML = `<strong>${senderName}</strong>: ${messageText}`;
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

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

    if (tapButton) {
        tapButton.addEventListener("click", () => {
            localTaps++;
            if (tapCountDisplay) tapCountDisplay.textContent = localTaps;
            if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = localTaps;
            
            socket.emit("tap", { playerId, playerName, taps: 1 });
        });
    }
});
