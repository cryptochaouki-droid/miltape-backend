/* =========================================================
   MILTAPE WORLD CHALLENGE
   CLIENT JAVASCRIPT (OPTIMISÉ & FLUIDE)
   MODE DEMO — SANS ARGENT RÉEL
========================================================= */

const API_URL = "https://miltape-backend-production.up.railway.app";

let playerId = localStorage.getItem("miltape_player_id");
let playerName = localStorage.getItem("miltape_player_name");

if (!playerId) {
    playerId =
        "player_" +
        Date.now() +
        "_" +
        Math.random().toString(36).substring(2, 9);

    localStorage.setItem(
        "miltape_player_id",
        playerId
    );
}

if (!playerName) {
    playerName =
        "Joueur_" +
        Math.floor(
            Math.random() * 9000 + 1000
        );

    localStorage.setItem(
        "miltape_player_name",
        playerName
    );
}


/* =========================================================
   ÉTAT DU JEU
========================================================= */

let selectedBet = 1;
let joined = false;
let score = 0;
let gameEndsAt = null;
let timerInterval = null;
let leaderboardInterval = null;

// Variables pour l'optimisation des taps (anti-lourdeur / buffering)
let localTaps = 0;
let tapTimeout = null;

// Variables pour l'automatisation du cycle du chrono
let challengeInterval = null;
let timeLeft = 10; // 10 secondes pour le cycle


/* =========================================================
   OUTILS
========================================================= */

function $(id) {
    return document.getElementById(id);
}


function showMessage(text) {

    const message = $("tapMessage");

    if (!message) return;

    message.textContent = text;

    message.classList.add("show");

    setTimeout(() => {
        message.classList.remove("show");
    }, 1800);
}


/* =========================================================
   TEST SERVEUR
========================================================= */

async function checkServer() {

    try {

        const response =
            await fetch(
                API_URL + "/",
                {
                    method: "GET"
                }
            );

        if (!response.ok) {
            throw new Error("SERVER_ERROR");
        }

        const data =
            await response.json();

        console.log(
            "✅ Miltape serveur:",
            data
        );

        return true;

    } catch (error) {

        console.error(
            "❌ Serveur inaccessible:",
            error
        );

        showMessage(
            "❌ SERVEUR INACCESSIBLE"
        );

        return false;
    }
}


/* =========================================================
   RÉCUPÉRER LA PARTIE
========================================================= */

async function loadGame() {

    try {

        const response =
            await fetch(
                API_URL + "/api/game"
            );

        const data =
            await response.json();

        if (
            !data.success ||
            !data.game
        ) {
            throw new Error(
                "GAME_ERROR"
            );
        }

        gameEndsAt =
            new Date(
                data.game.endsAt
            );

        updateTimer();

        if (timerInterval) {
            clearInterval(
                timerInterval
            );
        }

        timerInterval =
            setInterval(
                updateTimer,
                1000
            );

    } catch (error) {

        console.error(
            "Erreur game:",
            error
        );

        showMessage(
            "❌ Impossible de charger la partie"
        );
    }
}


/* =========================================================
   TIMER & AUTOMATISATION DU REDÉMARRAGE
========================================================= */

function updateTimer() {

    const timer = $("timer");

    if (!timer) {
        return;
    }

    // Si gameEndsAt est défini via le backend, on calcule le temps restant réel
    if (gameEndsAt) {
        const remaining = gameEndsAt.getTime() - Date.now();

        if (remaining <= 0) {
            timer.textContent = "00:00";
            joined = false;

            const tapButton = $("tapButton");
            if (tapButton) {
                tapButton.disabled = true;
            }

            showMessage("🏁 CHALLENGE TERMINÉ");
            return;
        }

        const totalSeconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        timer.textContent =
            String(minutes).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0");
    }
}

// Fonction dédiée à l'automatisation du redémarrage du chrono en boucle (toutes les 10 secondes)
function startAutoChallengeTimer() {
    const timerDisplay = $("timer");
    const tapButton = $("tapButton");
    const tapMessage = $("tapMessage");

    timeLeft = 10;
    if (timerDisplay) timerDisplay.textContent = "00:10";

    if (tapButton && joined) tapButton.disabled = false;
    if (tapMessage) tapMessage.textContent = "🔥 CHALLENGE EN COURS - TAPEZ !";

    if (challengeInterval) clearInterval(challengeInterval);

    challengeInterval = setInterval(() => {
        timeLeft--;

        let minutes = Math.floor(timeLeft / 60);
        let seconds = timeLeft % 60;
        let formattedTime = 
            (minutes < 10 ? "0" : "") + minutes + ":" + 
            (seconds < 10 ? "0" : "") + seconds;

        if (timerDisplay) {
            timerDisplay.textContent = formattedTime;
        }

        if (timeLeft <= 0) {
            clearInterval(challengeInterval);
            
            if (tapMessage) {
                tapMessage.textContent = "⚡ FIN DU ROUND ! Redémarrage...";
            }

            // Pause de 1 seconde avant de relancer automatiquement un nouveau cycle
            setTimeout(() => {
                startAutoChallengeTimer();
            }, 1000);
        }
    }, 1000);
}


/* =========================================================
   CHOIX DE MISE LIBRE
========================================================= */

function setupBetInput() {

    const customBetInput =
        $("customBetInput");

    if (customBetInput) {

        customBetInput.addEventListener(
            "input",
            () => {

                let val =
                    parseFloat(
                        customBetInput.value
                    );

                if (isNaN(val) || val < 0) {
                    val = 0;
                }

                selectedBet = val;

                const selected =
                    $("selectedBet");

                if (selected) {
                    selected.textContent =
                        "€" +
                        selectedBet;
                }

                const entryBet =
                    $("entryBet");

                if (entryBet) {
                    entryBet.textContent =
                        "€" +
                        selectedBet;
                }

            }
        );

    }
}


/* =========================================================
   OUVRIR MODAL
========================================================= */

function setupEntry() {

    const enterButton =
        $("enterChallenge");

    const modal =
        $("entryModal");

    const confirmButton =
        $("confirmEntry");

    const cancelButton =
        $("cancelEntry");

    const cancelBottom =
        $("cancelEntryBottom");


    if (
        enterButton &&
        modal
    ) {

        enterButton.addEventListener(
            "click",
            () => {

                modal.classList.add(
                    "show"
                );

            }
        );

    }


    function closeModal() {

        if (modal) {
            modal.classList.remove(
                "show"
            );
        }

    }


    if (cancelButton) {

        cancelButton.addEventListener(
            "click",
            closeModal
        );

    }


    if (cancelBottom) {

        cancelBottom.addEventListener(
            "click",
            closeModal
        );

    }


    if (confirmButton) {

        confirmButton.addEventListener(
            "click",
            joinChallenge
        );

    }

}


/* =========================================================
   REJOINDRE LE CHALLENGE (AVEC PSEUDO PERSONNALISÉ)
========================================================= */

async function joinChallenge() {

    const nameInput = $("customPlayerName");

    if (nameInput) {
        const typedName = nameInput.value.trim();
        if (typedName !== "") {
            playerName = typedName;
            localStorage.setItem("miltape_player_name", playerName);
        }
    }

    try {

        const response =
            await fetch(
                API_URL + "/api/join",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            playerId:
                                playerId,

                            playerName:
                                playerName
                        })
                }
            );

        const data =
            await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                "JOIN_ERROR"
            );
        }

        joined = true;

        score = 0;

        updateScore();

        if (data.game && data.game.endsAt) {
            gameEndsAt = new Date(data.game.endsAt);
        }

        const modal =
            $("entryModal");

        if (modal) {

            modal.classList.remove(
                "show"
            );
        }

        const tapButton =
            $("tapButton");

        if (tapButton) {

            tapButton.disabled =
                false;

            tapButton.focus();
        }

        showMessage(
            "🔥 TU ES DANS LE CHALLENGE !"
        );

        // Lancer l'automatisation du chrono des 10 secondes dès l'entrée dans le jeu
        startAutoChallengeTimer();

        loadLeaderboard();

    } catch (error) {

        console.error(
            "JOIN ERROR:",
            error
        );

        showMessage(
            "❌ " + (error.message || "ERREUR POUR ENTRER")
        );
    }
}


/* =========================================================
   TAP OPTIMISÉ (FLUIDE / BATCH + ANIMATION CLIC)
========================================================= */

function sendTap() {

    if (!joined) {
        showMessage(
            "⚡ ENTRE D'ABORD DANS LE CHALLENGE"
        );
        return;
    }

    const tapButton = $("tapButton");
    if (!tapButton) return;

    // 1. GESTION VISUELLE : Ajout immédiat de la classe d'animation
    tapButton.classList.add("tap-active");
    setTimeout(() => {
        tapButton.classList.remove("tap-active");
    }, 100);

    // 2. Incrémentation locale instantanée pour zéro latence visuelle
    localTaps++;
    score++;
    updateScore();

    // 3. Envoi groupé (debounce) pour ne pas saturer le serveur à chaque clic
    if (tapTimeout) {
        clearTimeout(tapTimeout);
    }

    tapTimeout = setTimeout(async () => {
        const tapsToSend = localTaps;
        localTaps = 0;

        if (tapsToSend <= 0) return;

        try {
            const response = await fetch(
                API_URL + "/api/tap",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        playerId: playerId,
                        count: tapsToSend
                    })
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                if (data.error === "GAME_FINISHED") {
                    joined = false;
                    tapButton.disabled = true;
                    showMessage("🏁 PARTIE TERMINÉE");
                    return;
                }
                throw new Error(data.error || "TAP_ERROR");
            }

            // Synchronisation optionnelle avec le score exact du serveur si renvoyé
            if (typeof data.score === "number") {
                score = data.score;
                updateScore();
            }

        } catch (error) {
            console.error("TAP ERROR:", error);
        }
    }, 400); 
}


/* =========================================================
   SCORE
========================================================= */

function updateScore() {

    requestAnimationFrame(() => {
        const tapCount =
            $("tapCount");

        const tapButtonCount =
            $("tapButtonCount");

        if (tapCount) {

            tapCount.textContent =
                score;
        }

        if (tapButtonCount) {

            tapButtonCount.textContent =
                score;
        }


        const combo =
            $("combo");

        if (combo) {

            combo.textContent =
                "x" +
                Math.max(
                    1,
                    Math.floor(
                        score / 10
                    ) + 1
                );
        }


        const level =
            $("level");

        if (level) {

            level.textContent =
                Math.max(
                    1,
                    Math.floor(
                        score / 100
                    ) + 1
                );
        }


        const progress =
            $("levelProgress");

        if (progress) {

            const percentage =
                score % 100;

            progress.style.width =
                percentage + "%";
        }


        const power =
            $("power");

        if (power) {

            power.textContent =
                Math.max(
                    0,
                    100 -
                    Math.floor(
                        score / 50
                    )
                ) + "%";
        }
    });

}


/* =========================================================
   CLASSEMENT
========================================================= */

async function loadLeaderboard() {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/leaderboard"
            );

        const data =
            await response.json();

        if (
            !data.success
        ) {
            return;
        }

        renderLeaderboard(
            data.players || []
        );

    } catch (error) {

        console.error(
            "LEADERBOARD ERROR:",
            error
        );

    }

}


function renderLeaderboard(players) {

    const list =
        $("leaderboardList");

    if (!list) {
        return;
    }

    const onlineCount = $("onlineCount");
    if (onlineCount) {
        onlineCount.textContent = players.length > 0 ? players.length : (joined ? 1 : 1);
    }


    if (!players.length) {

        list.innerHTML =
            `
            <div class="empty-ranking">
                Aucun joueur pour le moment
            </div>
            `;

        return;
    }


    list.innerHTML =
        players.map(
            player => {

                const isMe =
                    player.playerId ===
                    playerId;

                return `
                    <div class="ranking-row ${
                        isMe ? "me" : ""
                    }">

                        <span class="rank">
                            ${player.position}
                        </span>

                        <strong>
                            ${escapeHTML(
                                player.playerName
                            )}
                        </strong>

                        <span class="score">
                            ${player.score}
                        </span>

                    </div>
                `;

            }
        ).join("");
}


/* =========================================================
   CHAT
========================================================= */

async function loadChat() {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/chat"
            );

        const data =
            await response.json();

        if (
            !data.success
        ) {
            return;
        }

        renderChat(
            data.messages || []
        );

    } catch (error) {

        console.error(
            "CHAT ERROR:",
            error
        );

    }

}


function renderChat(messages) {

    const container =
        $("chatMessages");

    if (!container) {
        return;
    }


    if (!messages.length) {

        container.innerHTML =
            `
            <div class="chat-message">
                <strong>Miltape:</strong>
                Bienvenue dans le World Challenge 🔥
            </div>
            `;

        return;
    }


    container.innerHTML =
        messages.map(
            message => {

                return `
                    <div class="chat-message">

                        <strong>
                            ${escapeHTML(
                                message.playerName
                            )}:
                        </strong>

                        ${escapeHTML(
                            message.message
                        )}

                    </div>
                `;

            }
        ).join("");

    container.scrollTop =
        container.scrollHeight;
}


/* =========================================================
   ENVOYER MESSAGE
========================================================= */

async function sendChat() {

    const input =
        $("chatInput");

    if (!input) {
        return;
    }

    const message =
        input.value.trim();

    if (!message) {
        return;
    }


    try {

        const response =
            await fetch(
                API_URL +
                "/api/chat",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            playerId:
                                playerId,

                            playerName:
                                playerName,

                            message:
                                message
                        })
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                "CHAT_ERROR"
            );
        }


        input.value = "";

        loadChat();

    } catch (error) {

        console.error(
            "CHAT SEND ERROR:",
            error
        );

        showMessage(
            "❌ MESSAGE NON ENVOYÉ"
        );
    }

}


/* =========================================================
   ÉCHAPPEMENT HTML
========================================================= */

function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* =========================================================
   BOUTONS
========================================================= */

function setupButtons() {

    const tapButton =
        $("tapButton");

    if (tapButton) {

        tapButton.addEventListener(
            "click",
            sendTap
        );

    }


    const chatSend =
        $("chatSend");

    if (chatSend) {

        chatSend.addEventListener(
            "click",
            sendChat
        );

    }


    const chatInput =
        $("chatInput");

    if (chatInput) {

        chatInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {

                    sendChat();

                }

            }
        );

    }


    const menuButton =
        $("menuButton");

    if (menuButton) {

        menuButton.addEventListener(
            "click",
            () => {

                showMessage(
                    "☰ Menu Miltape"
                );

            }
        );

    }

}


/* =========================================================
   INITIALISATION
========================================================= */

async function initMiltape() {

    console.log(
        "🚀 Miltape World Challenge"
    );

    console.log(
        "👤 Joueur:",
        playerName
    );


    setupBetInput();

    setupEntry();

    setupButtons();


    const serverOK =
        await checkServer();


    if (!serverOK) {
        return;
    }


    await loadGame();

    await loadLeaderboard();

    await loadChat();


    if (leaderboardInterval) {

        clearInterval(
            leaderboardInterval
        );

    }


    leaderboardInterval =
        setInterval(
            loadLeaderboard,
            3000
        );


    setInterval(
        loadChat,
        5000
    );

}


/* =========================================================
   START
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    initMiltape
);
