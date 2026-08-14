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

    // Éléments d'inscription / paiement / crypto (correspondant à la modale HTML)
    const confirmButton = document.getElementById("confirmButton") || document.getElementById("confirmBetButton");
    const playerNameInput = document.getElementById("playerNameInput") || document.getElementById("customPlayerName");
    const cryptoAddressInput = document.getElementById("cryptoAddressInput") || document.getElementById("customCryptoAddress");
    const customBetInput = document.getElementById("customBetInput");

    // Élément affichant le total des mises en haut à droite (ex: icône de la bourse / label de mise)
    const miseUsdtDisplay = document.querySelector(".mise-usdt-display") || document.getElementById("totalStakesDisplay");

    let localTaps = 0;
    let playerId = localStorage.getItem("miltape_player_id");
    let playerName = localStorage.getItem("miltape_player_name");

    // Activer le bouton tape si le joueur a un profil enregistré
    if (playerId && playerName) {
        if (tapButton) tapButton.disabled = false;
        if (tapMessage) tapMessage.textContent = "🔥 CHALLENGE PRÊT - TAPE !";
    }

    // Charger et afficher le total réel de toutes les mises des joueurs
    async function loadTotalStakes() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/total-stakes`);
            const data = await res.json();
            if (data.success) {
                // Si l'élément existe dans l'interface, on met à jour le montant global réel
                const targetElement = miseUsdtDisplay || document.querySelector("span:contains('$')") || document.querySelector(".fa-sack-dollar + span, [class*='mise']");
                
                // Recherche alternative si la classe exacte varie dans le HTML
                const headerMiseText = document.querySelector(".fa-sack-dollar")?.nextSibling || document.getElementById("headerMiseAmount");
                
                if (headerMiseText && headerMiseText.nodeType === Node.TEXT_NODE) {
                    headerMiseText.nodeValue = ` $${data.totalStakes}`;
                } else if (miseUsdtDisplay) {
                    miseUsdtDisplay.textContent = `$${data.totalStakes}`;
                } else {
                    // Sélection générique basée sur l'apparence de la capture (le bloc à côté du sac d'argent)
                    const bagIconContainer = document.querySelector(".fa-sack-dollar, .bi-wallet, .ri-wallet-line")?.parentElement || document.querySelector("div > span:contains('$')");
                    // On cherche l'élément textuel ou numérique du haut
                    const allSpans = document.querySelectorAll("header span, nav span, .top-bar span");
                    allSpans.forEach(span => {
                        if (span.textContent.startsWith("$")) {
                            span.textContent = `$${data.totalStakes}`;
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Erreur lors du chargement du total des mises:", e);
        }
    }

    // Charger le total au démarrage puis l'actualiser régulièrement ou via socket
    loadTotalStakes();
    setInterval(loadTotalStakes, 15000); // Actualisation toutes les 15 secondes

    // Fonction pour lancer le paiement NOWPayments et enregistrer le profil
    async function payAndJoin(currentId, name, cryptoAddress, amount) {
        try {
            // 1. Enregistrer d'abord le profil et l'adresse crypto sur le serveur
            const resJoin = await fetch(`${BACKEND_URL}/api/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerId: currentId,
                    playerName: name,
                    cryptoAddress: cryptoAddress
                })
            });

            const dataJoin = await resJoin.json();
            if (!dataJoin.success) {
                alert(dataJoin.error || "Erreur lors de l'enregistrement du profil.");
                resetConfirmButton();
                return;
            }

            // 2. Créer la facture de paiement sur NOWPayments
            const resPayment = await fetch(`${BACKEND_URL}/api/create-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerId: currentId,
                    playerName: name,
                    amount: amount
                })
            });

            const dataPayment = await resPayment.json();
            if (dataPayment.success && dataPayment.invoice_url) {
                // Rediriger vers la page de paiement sécurisée NOWPayments
                window.location.href = dataPayment.invoice_url;
            } else {
                alert(dataPayment.error || "Erreur lors de la création de la facture de paiement.");
                resetConfirmButton();
            }
        } catch (err) {
            console.error("Erreur réseau /payAndJoin:", err);
            alert("Erreur de connexion au serveur.");
            resetConfirmButton();
        }
    }

    // Utilitaire pour réinitialiser l'état du bouton de confirmation en cas d'erreur
    function resetConfirmButton() {
        if (confirmButton) {
            confirmButton.textContent = "PAYER ET ENTRER 🔥";
            confirmButton.disabled = false;
        }
    }

    // Gestion du bouton pour rejoindre / payer depuis la modale
    if (confirmButton) {
        confirmButton.addEventListener("click", async () => {
            const acceptTermsCheckbox = document.getElementById("acceptTermsCheckbox");
            if (acceptTermsCheckbox && !acceptTermsCheckbox.checked) {
                alert("Veuillez accepter les conditions d'utilisation pour continuer.");
                return;
            }

            const name = playerNameInput ? playerNameInput.value.trim() : "";
            const cryptoAddress = cryptoAddressInput ? cryptoAddressInput.value.trim() : "";
            const amount = customBetInput ? parseFloat(customBetInput.value) || 1 : 1;

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
                playerId = currentId;
            }
            localStorage.setItem("miltape_player_name", name);
            localStorage.setItem("miltape_crypto_address", cryptoAddress);
            playerName = name;

            confirmButton.textContent = "CHARGEMENT...";
            confirmButton.disabled = true;

            // Lancer le processus d'enregistrement et de redirection vers le paiement
            await payAndJoin(currentId, name, cryptoAddress, amount);
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
