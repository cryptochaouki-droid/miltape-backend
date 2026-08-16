document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       CONFIGURATION ET CONSTANTES
    ========================================================= */
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const BACKEND_URL = isLocalhost 
        ? "http://localhost:3000" 
        : "https://miltape-backend-production.up.railway.app";

    const USDT_TRON_ADDRESS = "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";
    const USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

    console.log("🚀 Initialisation du script frontend Miltape sur :", BACKEND_URL);

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
       FONCTIONS UTILITAIRES
    ========================================================= */
    function updateScoreDisplays(value) {
        if (tapCountDisplay) tapCountDisplay.textContent = value;
        if (tapButtonCountDisplay) tapButtonCountDisplay.textContent = value;
        if (headerScore) headerScore.textContent = value;
        if (statTaps) statTaps.textContent = value;
        if (statTotal) statTotal.textContent = value;
    }

    function formatTime(seconds) {
        const totalSecs = Math.max(0, Number(seconds) || 0);
        const minutes = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderLeaderboard(players) {
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
    }

    /* =========================================================
       1. GESTION DU WALLET & PAIEMENT (MOBILE / DESKTOP)
    ========================================================= */
    const handleWalletAction = async () => {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        // 1. Si TronLink extension PC / In-App Wallet est disponible
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const userAddress = window.tronWeb.defaultAddress.base58;
                const contract = await window.tronWeb.contract().at(USDT_CONTRACT_ADDRESS);
                const amountUnits = 1 * 1000000; // 1 USDT (6 décimales)

                const txid = await contract.transfer(USDT_TRON_ADDRESS, amountUnits).send();
                alert("Paiement envoyé ! TXID: " + txid);

                // Envoi de la transaction au backend pour validation
                await fetch(`${BACKEND_URL}/api/verify-payment`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        playerId: playerId,
                        playerName: playerName,
                        txid: txid,
                        amount: 1
                    })
                });

            } catch (err) {
                console.error("Erreur de paiement TronWeb:", err);
                alert("Erreur lors de la transaction : " + (err.message || err));
            }
        } 
        // 2. Si l'utilisateur est sur téléphone portable sans extension
        else if (isMobile) {
            const tronlinkParams = {
                url: window.location.href,
                action: "open",
                protocol: "TronLink",
                version: "1.0"
            };
            const deepLink = `tronlinkprotocol://pull.activity?param=${encodeURIComponent(JSON.stringify(tronlinkParams))}`;
            
            // Tente d'ouvrir TronLink App
            window.location.href = deepLink;

            // Secours : si TronLink n'est pas installé, copier l'adresse au bout de 1,5s
            setTimeout(async () => {
                try {
                    await navigator.clipboard.writeText(USDT_TRON_ADDRESS);
                    alert("Ouverture de TronLink... Si l'application ne s'ouvre pas, l'adresse USDT a été copiée dans votre presse-papier :\n\n" + USDT_TRON_ADDRESS);
                } catch (e) {
                    alert("Adresse USDT TRC20 :\n" + USDT_TRON_ADDRESS);
                }
            }, 1500);
        } 
        // 3. Navigateur PC classique sans Wallet
        else {
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

    if (walletConnectBtn) walletConnectBtn.addEventListener("click", handleWalletAction);
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
       3. ÉVÉNEMENTS WEBSOCKET (CORRIGÉS)
    ========================================================= */
    socket.on("connect", () => {
        console.log("✅ Connecté au serveur WebSocket ! ID:", socket.id);
        if (tapMessage) tapMessage.textContent = "🔥 À TOI DE TAPPER !";
        
        // Connexion à la salle de jeu
        socket.emit("joinGame", { playerId, playerName });
    });

    socket.on("connect_error", (err) => {
        console.error("❌ Erreur de connexion WebSocket :", err);
        if (tapMessage) tapMessage.textContent = "🔴 Connexion au serveur perdue...";
    });

    // Initialisation au chargement de la page
    socket.on("initGame", (data) => {
        if (data) {
            if (timerDisplay && data.timerLeft !== undefined) {
                timerDisplay.textContent = formatTime(data.timerLeft);
            }
            if (data.leaderboard) {
                renderLeaderboard(data.leaderboard);
            }
        }
    });

    // Mise à jour du Minuteur (Chrono)
    socket.on("timerUpdate", (data) => {
        if (timerDisplay && data && data.timerLeft !== undefined) {
            timerDisplay.textContent = formatTime(data.timerLeft);
        }
    });

    // Fin de partie et début d'une nouvelle
    socket.on("gameOver", (data) => {
        if (tapMessage) tapMessage.textContent = "🏁 FIN DE LA PARTIE !";
        localTaps = 0;
        updateScoreDisplays(0);
    });

    socket.on("gameStart", () => {
        localTaps = 0;
        updateScoreDisplays(0);
        if (tapMessage) tapMessage.textContent = "🔥 NOUVELLE PARTIE COMMENCÉE !";
    });

    // Compteur de joueurs en ligne
    socket.on("onlineCount", (count) => {
        if (onlineCount) onlineCount.textContent = count;
    });

    // Classement / Leaderboard
    socket.on("leaderboardUpdate", (players) => {
        renderLeaderboard(players);
    });

    // Reception des messages Chat
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

    // Envoi d'un message Chat
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
       4. ACTION DE TAP
    ========================================================= */
    if (tapButton) {
        tapButton.addEventListener("click", () => {
            localTaps++;
            updateScoreDisplays(localTaps);

            tapButton.classList.add("tap-active");
            setTimeout(() => tapButton.classList.remove("tap-active"), 80);

            socket.emit("tap", { playerId, playerName });
        });
    }

    /* =========================================================
       5. CONDITIONS D'UTILISATION
    ========================================================= */
    window.toggleConditions = function() {
        const content = document.getElementById("conditions-content");
        const arrow = document.getElementById("arrow-icon");
        
        if (!content || !arrow) return;
        
        content.classList.toggle("open");
        arrow.style.transform = content.classList.contains("open") ? "rotate(180deg)" : "rotate(0deg)";
    };
});
