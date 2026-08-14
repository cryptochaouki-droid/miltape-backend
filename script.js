document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       CONFIGURATION ET CONSTANTES
    ========================================================= */
    const BACKEND_URL = "https://miltape-backend-production.up.railway.app";
    const USDT_TRON_ADDRESS = "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

    console.log("🚀 Initialisation du script frontend Miltape...");

    /* =========================================================
       CONNEXION WEBSOCKET
    ========================================================= */
    const socket = io(BACKEND_URL, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 20000
    });

    /* =========================================================
       ÉLÉMENTS DU DOM
    ========================================================= */
    // Jeu & Score
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

    // Chat
    const chatMessages = document.getElementById("chatMessages");
    const chatInput = document.getElementById("chatInput");
    const chatSend = document.getElementById("chatSend");

    // Menu / Modale (☰)
    const menuBtn = document.getElementById("menuBtn");
    const menuModal = document.getElementById("menuModal");
    const closeModal = document.getElementById("closeModal");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalPlayerId = document.getElementById("modalPlayerId");

    // Paiement & Wallet
    const walletConnectBtn = document.querySelector(".btn-wallet, #chooseWalletBtn");
    const addressCopyBox = document.querySelector(".address-box, #tronAddressDisplay");

    /* =========================================================
       GESTION DES DONNÉES JOUEUR (LOCALSTORAGE)
    ========================================================= */
    let localTaps = 0;

    let playerId = localStorage.getItem("miltape_player_id");
    if (!playerId) {
        playerId = "player_" + Math.random().toString(36).substring(2, 11);
        localStorage.setItem("miltape_player_id", playerId);
    }

    let playerName = localStorage.getItem("miltape_player_name");
    if (!playerName) {
        playerName = "JoueurTest" + Math.floor(Math.random() * 1000);
        localStorage.setItem("miltape_player_name", playerName);
    }

    /* =========================================================
       1. GESTION DES BOUTONS WALLET & PAIEMENT
    ========================================================= */
    const handleWalletAction = async () => {
        // Vérification présence de TronWeb (navigateurs DApp comme TronLink / Trust)
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const userAddress = window.tronWeb.defaultAddress.base58;
                alert("Portefeuille connecté : " + userAddress);
            } catch (err) {
                console.error("Erreur de connexion wallet:", err);
            }
        } else {
            // Fallback pour navigateurs classiques (Copie presse-papier)
            try {
                await navigator.clipboard.writeText(USDT_TRON_ADDRESS);
                alert(
                    "📋 Adresse USDT TRC20 copiée dans le presse-papier !\n\n" +
                    "Adresse : " + USDT_TRON_ADDRESS + "\n\n" +
                    "Ouvre ton application crypto (Binance, Trust Wallet...) pour effectuer le virement."
                );
            } catch (err) {
                alert("Adresse de paiement USDT TRC20 :\n" + USDT_TRON_ADDRESS);
            }
        }
    };

    if (walletConnectBtn) {
        walletConnectBtn.addEventListener("click", handleWalletAction);
    }

    if (addressCopyBox) {
        addressCopyBox.style.cursor = "pointer";
        addressCopyBox.addEventListener("click", handleWalletAction);
    }

    /* =========================================================
       2. GESTION DU MENU MODAL
    ========================================================= */
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

    /* =========================================================
       3. WEBSOCKET EVENTS
    ========================================================= */
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

    // Minuteur
    socket.on("timer", (timeLeft) => {
        if (timerDisplay) {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerDisplay.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }
    });

    // Compteur de joueurs en ligne
    socket.on("onlineCount", (count) => {
        if (onlineCount) {
            onlineCount.textContent = count;
        }
    });

    // Classement
    socket.on("leaderboard", (players) => {
        if (!leaderboardList) return;

        if (!players || players.length === 0) {
            leaderboardList.innerHTML = `<div class="empty-ranking">Aucun joueur pour le moment</div>`;
            return;
        }

        leaderboardList.innerHTML = players.map((p, index) => {
            const isMe = p._id === playerId || p.playerId === playerId;
            const displayName = escapeHTML(p.playerName || "Anonyme");
            const score = p.score || 0;

            return `
                <div class="leaderboard-item">
                    <div class="rank">#${index + 1}</div>
                    <div class="player-name">${displayName} ${isMe ? "<strong>(toi)</strong>" : ""}</div>
                    <div class="player-score">${score} ⚡</div>
                </div>
            `;
        }).join("");
    });

    // Chat en direct
    socket.on("chatMessage", (msg) => {
        if (!chatMessages) return;

        const messageElement = document.createElement("div");
        messageElement.classList.add("chat-message");

        const senderName = msg.playerName || msg.name || "Anonyme";
        const messageText = msg.message || msg.text || "";

        const strongTag = document.createElement("strong");
        strongTag.textContent = senderName + ": ";

        const textNode = document.createTextNode(messageText);

        messageElement.appendChild(strongTag);
        messageElement.appendChild(textNode);

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // Envoi de message
    if (chatSend && chatInput) {
        const sendMsg = () => {
            const text = chatInput.value.trim();
            if (text) {
                socket.emit("chatMessage", {
                    playerId: playerId,
                    playerName: playerName,
                    message: text
                });
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

    /* =========================================================
       4. BOUTON DE TAP PRINCIPAL
    ========================================================= */
    if (tapButton) {
        tapButton.addEventListener("click", () => {
            localTaps++;

            // Mise à jour de tous les affichages du score
            if (tapCountDisplay) tapCountDisplay.textContent = localTaps;
            if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = localTaps;
            if (headerScore) headerScore.textContent = localTaps;
            if (statTaps) statTaps.textContent = localTaps;
            if (statTotal) statTotal.textContent = localTaps;

            // Animation visuelle
            tapButton.classList.add("tap-active");
            setTimeout(() => tapButton.classList.remove("tap-active"), 80);

            // Envoi au serveur
            socket.emit("tap", { playerId, playerName, taps: 1 });
        });
    }

    /* =========================================================
       FONCTION UTILITAIRE (SÉCURITÉ)
    ========================================================= */
    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
