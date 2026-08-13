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

    // Éléments d'inscription / paiement / crypto (si présents dans votre HTML)
    const joinButton = document.getElementById("joinButton");
    const playerNameInput = document.getElementById("playerNameInput");
    const cryptoAddressInput = document.getElementById("cryptoAddressInput");

    let localTaps = 0;
    const playerId = localStorage.getItem("miltape_player_id");
    const playerName = localStorage.getItem("miltape_player_name");

    // Activer le bouton tape si le joueur a un profil enregistré
    if (playerId && playerName) {
        if (tapButton) tapButton.disabled = false;
        if (tapMessage) tapMessage.textContent = "🔥 CHALLENGE PRÊT - TAPE !";
    }

    // Gestion du bouton pour rejoindre / enregistrer le profil avec l'adresse crypto
    if (joinButton) {
        joinButton.addEventListener("click", async () => {
            const name = playerNameInput ? playerNameInput.value.trim() : "";
            const cryptoAddress = cryptoAddressInput ? cryptoAddressInput.value.trim() : "";

            if (!name) {
                alert("Veuillez entrer un pseudo !");
                return;
            }

            if (!cryptoAddress) {
                alert("Veuillez entrer votre adresse crypto (USDT TRC20) pour recevoir vos gains automatiques !");
                return;
            }

            // Générer un ID unique si le joueur n'en a pas
            let currentId = playerId;
            if (!currentId) {
                currentId = 'player_' + Math.random().toString(36).substring(2, 15);
                localStorage.setItem("miltape_player_id", currentId);
            }
            localStorage.setItem("miltape_player_name", name);
            localStorage.setItem("miltape_crypto_address", cryptoAddress);

            try {
                const res = await fetch(`${BACKEND_URL}/api/join`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        playerId: currentId,
                        playerName: name,
                        cryptoAddress: cryptoAddress
                    })
                });

                const data = await res.json();
                if (data.success) {
                    alert("Inscription validée avec succès !");
                    location.reload();
                } else {
                    alert(data.error || "Erreur lors de l'inscription");
                }
            } catch (err) {
                console.error("Erreur réseau /join:", err);
                alert("Erreur de connexion au serveur.");
            }
        });
    }

    // 1. Gestion du Chrono global en temps réel via Socket.io
    socket.on("global:timer", (data) => {
        if (!timerDisplay) return;
        const minutes = Math.floor(data.timeLeft / 60);
        const seconds = data.timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (data.status === "break") {
            if (tapButton) tapButton.disabled = true;
            if (tapMessage) tapMessage.textContent = "⏸️ PAUSE - Nouvelle partie imminente...";
        } else if (data.status === "running" && playerId && playerName) {
            if (tapButton) tapButton.disabled = false;
            if (tapMessage) tapMessage.textContent = "⚡ EN JEU - TAPE !";
        }
    });

    // 2. Compteur en ligne
    socket.on("online:count", (count) => {
        if (onlineCount) {
            onlineCount.innerHTML = `<span style="display:inline-block; width:8px; height:8px; background-color:#2ecc71; border-radius:50%; margin-right:5px;"></span> ${count} EN LIGNE`;
        }
    });

    // 3. Gestion du Bouton de Tape
    if (tapButton) {
        tapButton.addEventListener("click", async () => {
            if (!playerId) {
                alert("Entre d'abord dans le challenge (Payer & Entrer) !");
                return;
            }

            localTaps++;
            if (tapCountDisplay) tapCountDisplay.textContent = localTaps;
            if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = localTaps;

            try {
                await fetch(`${BACKEND_URL}/api/tap`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId, count: 1 })
                });
            } catch (err) {
                console.error("Erreur lors de l'envoi du tap:", err);
            }
        });
    }

    // 4. Charger et mettre à jour le Classement (Leaderboard)
    async function loadLeaderboard() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/leaderboard`);
            const data = await res.json();
            if (data.success && leaderboardList) {
                if (data.players.length === 0) {
                    leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
                    return;
                }
                leaderboardList.innerHTML = data.players.map(p => `
                    <div class="leaderboard-item" style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.05); margin-bottom: 5px; border-radius: 8px;">
                        <span>#${p.position} <strong>${p.playerName}</strong></span>
                        <span style="color: #ffcc00; font-weight: bold;">${p.score} taps</span>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error("Erreur leaderboard:", e);
        }
    }

    socket.on("leaderboard:update", () => {
        loadLeaderboard();
    });
    loadLeaderboard();

    // 5. Gestion du Chat Global
    async function loadChat() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/chat`);
            const data = await res.json();
            if (data.success && chatMessages) {
                chatMessages.innerHTML = data.messages.map(m => `
                    <div class="chat-message" style="margin-bottom: 5px;">
                        <strong>${m.playerName}:</strong> ${m.message}
                    </div>
                `).join('');
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        } catch (e) {
            console.error("Erreur chat:", e);
        }
    }

    socket.on("chat:new", (msg) => {
        if (chatMessages) {
            const div = document.createElement("div");
            div.className = "chat-message";
            div.style.marginBottom = "5px";
            div.innerHTML = `<strong>${msg.playerName}:</strong> ${msg.message}`;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });
    loadChat();

    if (chatSend && chatInput) {
        chatSend.addEventListener("click", async () => {
            const message = chatInput.value.trim();
            if (!message || !playerId || !playerName) {
                alert("Entre ton pseudo ou écris un message valide !");
                return;
            }

            try {
                await fetch(`${BACKEND_URL}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId, playerName, message })
                });
                chatInput.value = "";
            } catch (e) {
                console.error("Erreur envoi message:", e);
            }
        });

        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") chatSend.click();
        });
    }
});
