document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    
    console.log("🚀 Initialisation du script frontend Miltape (Solde interne)...");

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
        tapMessage.textContent = "🔥 CLIQUE POUR JOUER !";
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

    async function loadPlayerStats() {
        if (!playerId) {
            alert("Identifiant joueur introuvable !");
            return;
        }

        openDynamicModal("🎮 Mon Profil & Solde", "Chargement de tes données...");

        try {
            const res = await fetch(`${BACKEND_URL}/api/player-stats/${playerId}`);
            const data = await res.json();

            if (data.success && modalContent) {
                modalContent.innerHTML = `
                    <div style="text-align: center; padding: 10px;">
                        <h3>Mon Compte Miltape</h3>
                        <p>Solde actuel : <strong style="color: #2ecc71; font-size: 1.2em;">${data.balance || 0} USDT</strong></p>
                        <p>Total Taps : <strong>${data.totalTaps || localTaps}</strong></p>
                        
                        <div style="margin-top: 20px;">
                            <button id="rechargeBtn" style="background: #e67e22; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-right: 5px;">Recharger (13 USDT)</button>
                            <button id="playBtn" style="background: #27ae60; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: bold;">Jouer 1 Partie (1 Click)</button>
                        </div>
                    </div>
                `;

                document.getElementById("rechargeBtn").addEventListener("click", async () => {
                    modalContent.innerHTML = "<p>Génération de la facture en cours...</p>";
                    try {
                        const payRes = await fetch(`${BACKEND_URL}/api/create-payment`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ playerId, playerName, amount: 13 })
                        });
                        const payData = await payRes.json();
                        if (payData.success && payData.invoice_url) {
                            window.location.href = payData.invoice_url;
                        } else {
                            alert("Erreur lors de la création du paiement.");
                        }
                    } catch (err) {
                        alert("Erreur réseau.");
                    }
                });

                document.getElementById("playBtn").addEventListener("click", async () => {
                    try {
                        const playRes = await fetch(`${BACKEND_URL}/api/play-game`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ playerId, playerName })
                        });
                        const playData = await playRes.json();
                        if (playData.success) {
                            alert("✅ Partie lancée ! Amuse-toi bien.");
                            dynamicModal.classList.remove("show");
                        } else {
                            alert("❌ " + (playData.message || "Solde insuffisant, recharge ton compte !"));
                        }
                    } catch (err) {
                        alert("Erreur lors du lancement de la partie.");
                    }
                });
            }
        } catch (e) {
            if (modalContent) {
                modalContent.innerHTML = `<p>Erreur de chargement du profil.</p>`;
            }
        }
    }

    if (myGamesButton) {
        myGamesButton.addEventListener("click", loadPlayerStats);
    }
});
