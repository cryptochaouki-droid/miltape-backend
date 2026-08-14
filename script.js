document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    
    console.log("🚀 Initialisation du script frontend Miltape...");

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
    const headerScore = document.getElementById("headerScore");
    const statTaps = document.getElementById("statTaps");
    const statTotal = document.getElementById("statTotal");
    const tapMessage = document.getElementById("tapMessage");
    const onlineCount = document.getElementById("onlineCount");
    const leaderboardList = document.getElementById("leaderboardList");
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const chatSend = document.getElementById("chatSend");

    // Éléments du Menu / Modale 3 traits (☰)
    const menuBtn = document.getElementById("menuBtn");
    const menuModal = document.getElementById("menuModal");
    const closeModal = document.getElementById("closeModal");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalPlayerId = document.getElementById("modalPlayerId");

    let localTaps = 0;
    let playerId = localStorage.getItem("miltape_player_id");
    if (!playerId) {
        playerId = 'player_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem("miltape_player_id", playerId);
    }
    
    let playerName = localStorage.getItem("miltape_player_name");
    if (!playerName) {
        playerName = "JoueurTest" + Math.floor(Math.random() * 1000);
        localStorage.setItem("miltape_player_name", playerName);
    }

    // Gestion de l'ouverture/fermeture du menu (3 traits)
    if (menuBtn && menuModal) {
        menuBtn.addEventListener("click", () => {
            if (modalPlayerId) modalPlayerId.textContent = playerId;
            menuModal.classList.add("show");
        });
    }

    const closeMenuModal = () => {
        if (menuModal) menuModal.classList.remove("show");
    };

    if (closeModal) closeModal.addEventListener("click", closeMenuModal);
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeMenuModal);

    // Connexion WebSocket
    socket.on("connect", () => {
        console.log("✅ Connecté au serveur WebSocket ! ID:", socket.id);
        if (tapMessage) {
            tapMessage.textContent = "🔥 À TOI DE TAPPER !";
        }
        socket.emit("join", { playerId, playerName });
    });

    socket.on("connect_error", (err) => {
        console.error("❌ Erreur de connexion WebSocket :", err);
        if (tapMessage) {
            tapMessage.textContent = "🔴 Connexion au serveur perdue...";
        }
    });

    // Timer
    socket.on("timer", (timeLeft) => {
        if (timerDisplay) {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    });

    // Nombre de joueurs en ligne
    socket.on("onlineCount", (count) => {
        if (onlineCount) {
            onlineCount.textContent = count;
        }
    });

    // Classement Live
    socket.on("leaderboard", (players) => {
        if (leaderboardList) {
            if (!players || players.length === 0) {
                leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
                return;
            }
            leaderboardList.innerHTML = players.map((p, index) => {
                const isMe = p._id === playerId;
                return `
                    <div class="leaderboard-item">
                        <div class="rank">#${index + 1}</div>
                        <div class="player-name">${p.playerName || 'Anonyme'} ${isMe ? '(toi)' : ''}</div>
                        <div class="player-score">${p.score || 0} ⚡</div>
                    </div>
                `;
            }).join('');
        }
    });

    // Chat en direct
    socket.on("chatMessage", (msg) => {
        if (chatMessages) {
            const messageElement = document.createElement("div");
            messageElement.classList.add("chat-message");
            const senderName = msg.playerName || msg.name || 'Anonyme';
            const messageText = msg.message || msg.text || '';
            messageElement.innerHTML = `<strong>${senderName}:</strong> ${messageText}`;
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

    if (chatSend && chatInput) {
        const sendMsg = () => {
            const text = chatInput.value.trim();
            if (text) {
                socket.emit("chatMessage", { playerId: playerId, playerName: playerName, message: text });
                chatInput.value = "";
            }
        };

        chatSend.addEventListener("click", sendMsg);
        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                sendMsg();
            }
        });
    }

    // Bouton de Tap principal
    if (tapButton) {
        tapButton.addEventListener("click", () => {
            localTaps++;
            if (tapCountDisplay) tapCountDisplay.textContent = localTaps;
            if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = localTaps;
            if (headerScore) headerScore.textContent = localTaps;
            if (statTaps) statTaps.textContent = localTaps;
            if (statTotal) statTotal.textContent = localTaps;

            // Effet visuel du clic
            tapButton.classList.add("tap-active");
            setTimeout(() => tapButton.classList.remove("tap-active"), 80);
            
            socket.emit("tap", { playerId, playerName, taps: 1 });
        });
    }
});
