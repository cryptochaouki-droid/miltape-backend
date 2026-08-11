document.addEventListener("DOMContentLoaded", () => {

    // =====================================================
    // MILTAPE WORLD CHALLENGE
    // Connexion au serveur Railway + MongoDB
    // =====================================================

    // ⚠️ REMPLACE CETTE URL PAR TON DOMAINE PUBLIC RAILWAY
    const API_URL = "https://TON-DOMAINE-RAILWAY.up.railway.app";

    // =====================================================
    // JOUEUR
    // =====================================================

    let playerId = localStorage.getItem("miltapePlayerId");

    if (!playerId) {
        playerId =
            "player_" +
            Date.now() +
            "_" +
            Math.random().toString(36).substring(2, 8);

        localStorage.setItem(
            "miltapePlayerId",
            playerId
        );
    }

    let playerName =
        localStorage.getItem("miltapePlayerName");

    if (!playerName) {

        playerName =
            "Player" +
            Math.floor(
                Math.random() * 9999
            );

        localStorage.setItem(
            "miltapePlayerName",
            playerName
        );
    }

    // =====================================================
    // VARIABLES
    // =====================================================

    let taps = 0;
    let combo = 1;
    let power = 100;
    let level = 1;

    let selectedBet = 1;

    let gameStarted = false;

    let timeLeft = 600;

    let timerInterval = null;

    let serverGameId = null;

    // =====================================================
    // ELEMENTS
    // =====================================================

    const timer =
        document.getElementById("timer");

    const tapButton =
        document.getElementById("tapButton");

    const tapCount =
        document.getElementById("tapCount");

    const tapButtonCount =
        document.getElementById("tapButtonCount");

    const comboElement =
        document.getElementById("combo");

    const powerElement =
        document.getElementById("power");

    const levelElement =
        document.getElementById("level");

    const levelProgress =
        document.getElementById("levelProgress");

    const selectedBetElement =
        document.getElementById("selectedBet");

    const tapMessage =
        document.getElementById("tapMessage");

    const leaderboardList =
        document.getElementById(
            "leaderboardList"
        );

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );

    const chatInput =
        document.getElementById(
            "chatInput"
        );

    const chatSend =
        document.getElementById(
            "chatSend"
        );

    // =====================================================
    // API
    // =====================================================

    async function api(
        endpoint,
        options = {}
    ) {

        const response =
            await fetch(
                API_URL + endpoint,
                {
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    ...options
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "SERVER_ERROR"
            );
        }

        return data;
    }

    // =====================================================
    // BET
    // =====================================================

    document
        .querySelectorAll(".bet-button")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    selectedBet =
                        Number(
                            button.dataset.bet
                        );

                    if (
                        selectedBetElement
                    ) {

                        selectedBetElement.textContent =
                            "€" +
                            selectedBet;

                    }

                    document
                        .querySelectorAll(
                            ".bet-button"
                        )
                        .forEach(
                            b =>
                                b.classList.remove(
                                    "selected"
                                )
                        );

                    button.classList.add(
                        "selected"
                    );

                    if (tapMessage) {

                        tapMessage.textContent =
                            "BET €" +
                            selectedBet +
                            " SELECTED";

                    }

                }
            );

        });

    // =====================================================
    // CHARGER LA PARTIE
    // =====================================================

    async function loadGame() {

        try {

            const data =
                await api(
                    "/api/game"
                );

            if (
                data.success &&
                data.game
            ) {

                serverGameId =
                    data.game.id;

                const endTime =
                    new Date(
                        data.game.endsAt
                    ).getTime();

                timeLeft =
                    Math.max(
                        0,
                        Math.floor(
                            (
                                endTime -
                                Date.now()
                            ) / 1000
                        )
                    );

                updateTimer();

            }

        } catch (error) {

            console.error(
                "GAME LOAD ERROR:",
                error
            );

            if (tapMessage) {

                tapMessage.textContent =
                    "⚠️ SERVER CONNECTION ERROR";

            }

        }

    }

    // =====================================================
    // ENTRER DANS LA PARTIE
    // =====================================================

    async function enterChallenge() {

        try {

            if (tapMessage) {

                tapMessage.textContent =
                    "⏳ CONNECTING...";

            }

            const data =
                await api(
                    "/api/join",
                    {
                        method: "POST",

                        body: JSON.stringify({
                            playerId,
                            playerName
                        })
                    }
                );

            if (!data.success) {
                throw new Error(
                    "JOIN_FAILED"
                );
            }

            serverGameId =
                data.game.id;

            const endTime =
                new Date(
                    data.game.endsAt
                ).getTime();

            timeLeft =
                Math.max(
                    0,
                    Math.floor(
                        (
                            endTime -
                            Date.now()
                        ) / 1000
                    )
                );

            startLocalGame();

            await loadLeaderboard();

            if (tapMessage) {

                tapMessage.textContent =
                    "🔥 TAP TO PLAY";

            }

        } catch (error) {

            console.error(
                "JOIN ERROR:",
                error
            );

            if (tapMessage) {

                tapMessage.textContent =
                    "❌ CANNOT ENTER";

            }

        }

    }

    // =====================================================
    // DÉTECTER LE BOUTON ENTER CHALLENGE
    // =====================================================

    const enterChallengeButton =
        document.getElementById(
            "enterChallenge"
        );

    const confirmEntry =
        document.getElementById(
            "confirmEntry"
        );

    const cancelEntry =
        document.getElementById(
            "cancelEntry"
        );

    const entryModal =
        document.getElementById(
            "entryModal"
        );

    const entryBet =
        document.getElementById(
            "entryBet"
        );

    if (enterChallengeButton) {

        enterChallengeButton.addEventListener(
            "click",
            () => {

                if (entryBet) {

                    entryBet.textContent =
                        "€" +
                        selectedBet;

                }

                if (entryModal) {

                    entryModal.classList.add(
                        "show"
                    );

                } else {

                    enterChallenge();

                }

            }
        );

    }

    // =====================================================
    // ANNULER
    // =====================================================

    if (cancelEntry) {

        cancelEntry.addEventListener(
            "click",
            () => {

                if (entryModal) {

                    entryModal.classList.remove(
                        "show"
                    );

                }

            }
        );

    }

    // =====================================================
    // CONFIRMER
    // =====================================================

    if (confirmEntry) {

        confirmEntry.addEventListener(
            "click",
            async () => {

                if (entryModal) {

                    entryModal.classList.remove(
                        "show"
                    );

                }

                await enterChallenge();

            }
        );

    }

    // =====================================================
    // START LOCAL GAME
    // =====================================================

    function startLocalGame() {

        gameStarted = true;

        taps = 0;
        combo = 1;
        power = 100;
        level = 1;

        if (tapButton) {

            tapButton.disabled =
                false;

        }

        updateDisplay();
        updateTimer();

        clearInterval(
            timerInterval
        );

        timerInterval =
            setInterval(
                updateGameTimer,
                1000
            );

    }

    // =====================================================
    // TIMER
    // =====================================================

    function updateGameTimer() {

        if (!gameStarted) {
            return;
        }

        timeLeft--;

        if (timeLeft <= 0) {

            timeLeft = 0;

            gameStarted = false;

            if (tapButton) {

                tapButton.disabled =
                    true;

            }

            clearInterval(
                timerInterval
            );

            if (tapMessage) {

                tapMessage.textContent =
                    "🏆 CHALLENGE FINISHED";

            }

        }

        updateTimer();

    }

    function updateTimer() {

        if (!timer) {
            return;
        }

        const minutes =
            Math.floor(
                timeLeft / 60
            );

        const seconds =
            timeLeft % 60;

        timer.textContent =
            String(minutes)
                .padStart(2, "0") +
            ":" +
            String(seconds)
                .padStart(2, "0");
    }

    // =====================================================
    // TAP
    // =====================================================

    if (tapButton) {

        tapButton.disabled = true;

        tapButton.addEventListener(
            "click",
            async () => {

                if (!gameStarted) {

                    if (tapMessage) {

                        tapMessage.textContent =
                            "⚡ ENTER CHALLENGE FIRST";

                    }

                    return;
                }

                if (timeLeft <= 0) {
                    return;
                }

                // Affichage immédiat
                taps++;

                combo++;

                if (combo > 99) {
                    combo = 99;
                }

                power--;

                if (power < 0) {
                    power = 0;
                }

                level =
                    Math.floor(
                        taps / 100
                    ) + 1;

                updateDisplay();

                // Animation
                tapButton.classList.remove(
                    "tap-animation"
                );

                void tapButton.offsetWidth;

                tapButton.classList.add(
                    "tap-animation"
                );

                // Envoi au serveur
                try {

                    const data =
                        await api(
                            "/api/tap",
                            {
                                method: "POST",

                                body:
                                    JSON.stringify({
                                        playerId
                                    })
                            }
                        );

                    if (
                        data.success &&
                        typeof data.score ===
                        "number"
                    ) {

                        taps =
                            data.score;

                        updateDisplay();

                    }

                } catch (error) {

                    console.error(
                        "TAP SERVER ERROR:",
                        error
                    );

                }

            }
        );

    }

    // =====================================================
    // AFFICHAGE
    // =====================================================

    function updateDisplay() {

        if (tapCount) {

            tapCount.textContent =
                taps;

        }

        if (tapButtonCount) {

            tapButtonCount.textContent =
                taps;

        }

        if (comboElement) {

            comboElement.textContent =
                "x" + combo;

        }

        if (powerElement) {

            powerElement.textContent =
                power + "%";

        }

        if (levelElement) {

            levelElement.textContent =
                level;

        }

        if (levelProgress) {

            levelProgress.style.width =
                (taps % 100) + "%";

        }

    }

    // =====================================================
    // CLASSEMENT TOP 5
    // =====================================================

    async function loadLeaderboard() {

        try {

            const data =
                await api(
                    "/api/leaderboard"
                );

            if (
                !data.success ||
                !leaderboardList
            ) {
                return;
            }

            leaderboardList.innerHTML =
                "";

            data.players.forEach(
                player => {

                    const row =
                        document.createElement(
                            "div"
                        );

                    row.className =
                        "player-row";

                    row.innerHTML = `
                        <span class="rank">
                            ${player.position}
                        </span>

                        <span class="player-name">
                            ${escapeHTML(
                                player.playerName
                            )}
                        </span>

                        <strong class="player-taps">
                            ${player.score}
                        </strong>
                    `;

                    leaderboardList.appendChild(
                        row
                    );

                }
            );

        } catch (error) {

            console.error(
                "LEADERBOARD ERROR:",
                error
            );

        }

    }

    // Actualiser le classement
    setInterval(
        loadLeaderboard,
        3000
    );

    // =====================================================
    // CHAT
    // =====================================================

    async function loadChat() {

        try {

            const data =
                await api(
                    "/api/chat"
                );

            if (
                !data.success ||
                !chatMessages
            ) {
                return;
            }

            chatMessages.innerHTML =
                "";

            data.messages.forEach(
                message => {

                    addChatMessage(
                        message.playerName,
                        message.message
                    );

                }
            );

            chatMessages.scrollTop =
                chatMessages.scrollHeight;

        } catch (error) {

            console.error(
                "CHAT LOAD ERROR:",
                error
            );

        }

    }

    function addChatMessage(
        name,
        message
    ) {

        if (!chatMessages) {
            return;
        }

        const div =
            document.createElement(
                "div"
            );

        div.className =
            "chat-message";

        div.innerHTML = `
            <strong>
                ${escapeHTML(name)}:
            </strong>
            ${escapeHTML(message)}
        `;

        chatMessages.appendChild(
            div
        );

    }

    async function sendChat() {

        if (!chatInput) {
            return;
        }

        const message =
            chatInput.value.trim();

        if (!message) {
            return;
        }

        try {

            await api(
                "/api/chat",
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            playerId,
                            playerName,
                            message
                        })
                }
            );

            chatInput.value = "";

            await loadChat();

        } catch (error) {

            console.error(
                "CHAT SEND ERROR:",
                error
            );

        }

    }

    if (chatSend) {

        chatSend.addEventListener(
            "click",
            sendChat
        );

    }

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

    // =====================================================
    // SÉCURITÉ HTML
    // =====================================================

    function escapeHTML(value) {

        return String(value)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );

    }

    // =====================================================
    // INITIALISATION
    // =====================================================

    updateDisplay();

    updateTimer();

    loadGame();

    loadLeaderboard();

    loadChat();

    console.log(
        "🔥 MILTAPE WORLD CHALLENGE CONNECTÉ"
    );

});
