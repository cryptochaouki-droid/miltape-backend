document.addEventListener("DOMContentLoaded", () => {

    "use strict";

    /* =========================================================
       🛡️ PROTECTION DOUBLE CHARGEMENT
    ========================================================= */

    if (window.__MILTAPE_INITIALIZED__) {
        console.warn("🛑 Miltape déjà initialisé.");
        return;
    }

    window.__MILTAPE_INITIALIZED__ = true;

    console.log("🚀 MILTAPE WORLD CHALLENGE");


    /* =========================================================
       CONFIGURATION
    ========================================================= */

    const BACKEND_URL =
        (
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1"
        )
            ? "http://localhost:3000"
            : "https://miltape-backend-production.up.railway.app";


    const USDT_TRON_ADDRESS =
        "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";


    const GAME_DURATION = 600;


    /* =========================================================
       VARIABLES
    ========================================================= */

    let socket = null;

    let socketReady = false;

    let localTaps = 0;

    let currentTimer = GAME_DURATION;

    let timerInterval = null;

    let timerRunning = false;

    let deferredPrompt = null;

    let tapLocked = false;

    let gameJoined = false;

    let selectedBet = 0;

    let lastSentMessage = "";

    let lastSentMessageTime = 0;

    let connectionWaitInterval = null;


    /* =========================================================
       IDENTITÉ
    ========================================================= */

    let playerId =
        localStorage.getItem("miltape_player_id");


    if (!playerId) {

        playerId =
            "player_" +
            Math.random()
                .toString(36)
                .substring(2, 11);

        localStorage.setItem(
            "miltape_player_id",
            playerId
        );
    }


    let playerName =
        localStorage.getItem(
            "miltape_player_name"
        );


    if (!playerName) {

        playerName =
            "Joueur" +
            Math.floor(
                Math.random() * 10000
            );

        localStorage.setItem(
            "miltape_player_name",
            playerName
        );
    }


    console.log(
        "👤 Joueur :",
        playerId,
        playerName
    );


    /* =========================================================
       ELEMENTS
    ========================================================= */

    const timerDisplay =
        document.getElementById("timer");

    const tapButton =
        document.getElementById("tapButton");

    const tapCountDisplay =
        document.getElementById("tapCount");

    const tapButtonCountDisplay =
        document.getElementById("tapButtonCount");

    const tapMessage =
        document.getElementById("tapMessage");

    const onlineCount =
        document.getElementById("onlineCount");

    const leaderboardList =
        document.getElementById("leaderboardList");

    const chatMessages =
        document.getElementById("chatMessages");

    const chatInput =
        document.getElementById("chatInput");

    const chatSend =
        document.getElementById("chatSend");

    const displayBet =
        document.getElementById("displayBet");

    const globalTotalStakes =
        document.getElementById("globalTotalStakes");

    const walletButton =
        document.getElementById("walletButton");

    const enterChallenge =
        document.getElementById("enterChallenge");


    /* =========================================================
       UTILITAIRES
    ========================================================= */

    function escapeHTML(value) {

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function formatTime(seconds) {

        seconds =
            Math.max(
                0,
                Math.floor(
                    Number(seconds) || 0
                )
            );


        const minutes =
            Math.floor(
                seconds / 60
            );


        const secs =
            seconds % 60;


        return (
            String(minutes).padStart(2, "0") +
            ":" +
            String(secs).padStart(2, "0")
        );
    }


    function updateTimerDisplay(seconds) {

        currentTimer =
            Math.max(
                0,
                Math.floor(
                    Number(seconds) || 0
                )
            );


        if (timerDisplay) {

            timerDisplay.textContent =
                formatTime(
                    currentTimer
                );
        }
    }


    function updateScoreDisplays(value) {

        const score =
            Math.max(
                0,
                Number(value) || 0
            );


        localTaps = score;


        if (tapCountDisplay) {

            tapCountDisplay.textContent =
                score;
        }


        if (tapButtonCountDisplay) {

            tapButtonCountDisplay.textContent =
                score;
        }


        const headerScore =
            document.getElementById(
                "headerScore"
            );


        if (headerScore) {

            headerScore.textContent =
                score;
        }


        const statTaps =
            document.getElementById(
                "statTaps"
            );


        if (statTaps) {

            statTaps.textContent =
                score;
        }


        const statTotal =
            document.getElementById(
                "statTotal"
            );


        if (statTotal) {

            statTotal.textContent =
                score;
        }
    }


    /* =========================================================
       MESSAGE
    ========================================================= */

    function setMessage(text) {

        if (tapMessage) {

            tapMessage.textContent =
                text;
        }
    }


    /* =========================================================
       TIMER
    ========================================================= */

    function startLocalTimer() {

        if (timerRunning) {
            return;
        }


        if (currentTimer <= 0) {
            return;
        }


        timerRunning = true;


        clearInterval(
            timerInterval
        );


        let lastTick =
            Date.now();


        timerInterval =
            setInterval(() => {

                const now =
                    Date.now();


                const elapsed =
                    Math.floor(
                        (
                            now -
                            lastTick
                        ) / 1000
                    );


                if (elapsed <= 0) {
                    return;
                }


                lastTick = now;


                currentTimer =
                    Math.max(
                        0,
                        currentTimer -
                        elapsed
                    );


                updateTimerDisplay(
                    currentTimer
                );


                if (
                    currentTimer <= 0
                ) {

                    stopLocalTimer();


                    gameJoined = false;


                    if (tapButton) {

                        tapButton.disabled =
                            true;
                    }


                    setMessage(
                        "⏰ PARTIE TERMINÉE"
                    );
                }

            }, 250);
    }


    function stopLocalTimer() {

        if (timerInterval) {

            clearInterval(
                timerInterval
            );
        }


        timerInterval = null;

        timerRunning = false;
    }


    function resetLocalTimer(
        seconds = GAME_DURATION
    ) {

        stopLocalTimer();

        updateTimerDisplay(
            seconds
        );
    }


    /* =========================================================
       🎮 OUVERTURE DU CHALLENGE
    ========================================================= */

    function openChallenge() {

        console.log(
            "🎮 OUVERTURE DU CHALLENGE"
        );


        /*
           IMPORTANT :
           On vérifie d'abord la mise.

           Ainsi, même si Socket.IO n'est pas
           encore connecté, le bouton JOUER
           ouvre immédiatement le choix de mise.
        */

        if (selectedBet <= 0) {

            openBetModal();

            return;
        }


        if (gameJoined) {

            setMessage(
                "🔥 TU ES DÉJÀ DANS LA PARTIE !"
            );

            return;
        }


        /*
           Serveur déjà connecté.
        */

        if (
            socket &&
            socket.connected
        ) {

            joinGame();

            return;
        }


        /*
           Serveur pas encore connecté.
        */

        setMessage(
            "🟠 Connexion au serveur..."
        );


        connectSocket();


        /*
           On attend la connexion.
        */

        clearInterval(
            connectionWaitInterval
        );


        let attempts = 0;


        connectionWaitInterval =
            setInterval(() => {

                attempts++;


                if (
                    socket &&
                    socket.connected
                ) {

                    clearInterval(
                        connectionWaitInterval
                    );


                    console.log(
                        "🟢 SOCKET PRÊT — JOIN GAME"
                    );


                    joinGame();


                    return;
                }


                if (attempts >= 50) {

                    clearInterval(
                        connectionWaitInterval
                    );


                    setMessage(
                        "🔴 Impossible de contacter le serveur"
                    );

                    console.error(
                        "❌ Timeout connexion Socket.IO"
                    );
                }

            }, 300);
    }


    /* =========================================================
       💰 CHOIX DE MISE
    ========================================================= */

    function openBetModal() {

        const options = [
            1,
            2,
            5,
            10,
            20,
            50,
            100
        ];


        const html = `

            <p>
                Choisis ta mise pour cette partie :
            </p>

            <div
                style="
                    display:grid;
                    grid-template-columns:repeat(2,1fr);
                    gap:10px;
                    margin-top:15px;
                "
            >

                ${options.map(
                    amount => `
                        <button
                            type="button"
                            class="miltape-bet-option"
                            data-bet="${amount}"
                            style="
                                padding:14px;
                                border-radius:12px;
                                border:1px solid #ffcc00;
                                background:#1a0828;
                                color:#ffcc00;
                                font-weight:900;
                                cursor:pointer;
                            "
                        >
                            $${amount}
                        </button>
                    `
                ).join("")}

            </div>
        `;


        openModal(
            "💰 CHOISIR TA MISE",
            html
        );


        document
            .querySelectorAll(
                ".miltape-bet-option"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {

                        const amount =
                            Number(
                                button.dataset.bet
                            );


                        setBet(amount);

                        closeModal();


                        setMessage(
                            `💰 Mise sélectionnée : $${amount}`
                        );


                        /*
                           Après sélection de la mise,
                           on lance automatiquement
                           la connexion puis la partie.
                        */

                        if (
                            socket &&
                            socket.connected
                        ) {

                            joinGame();

                        } else {

                            setMessage(
                                "🟠 Connexion au serveur..."
                            );


                            connectSocket();


                            clearInterval(
                                connectionWaitInterval
                            );


                            let attempts = 0;


                            connectionWaitInterval =
                                setInterval(() => {

                                    attempts++;


                                    if (
                                        socket &&
                                        socket.connected
                                    ) {

                                        clearInterval(
                                            connectionWaitInterval
                                        );


                                        joinGame();

                                        return;
                                    }


                                    if (
                                        attempts >= 50
                                    ) {

                                        clearInterval(
                                            connectionWaitInterval
                                        );


                                        setMessage(
                                            "🔴 Serveur indisponible"
                                        );
                                    }

                                }, 300);
                        }
                    }
                );
            });
    }


    function setBet(value) {

        const amount =
            Number(value) || 0;


        selectedBet =
            amount;


        if (displayBet) {

            displayBet.textContent =
                "$" + amount;
        }


        localStorage.setItem(
            "miltape_bet",
            String(amount)
        );
    }


    const savedBet =
        localStorage.getItem(
            "miltape_bet"
        );


    if (savedBet) {

        setBet(
            savedBet
        );
    }


    /* =========================================================
       🎮 JOIN GAME
    ========================================================= */

    function joinGame() {

        if (
            !socket ||
            !socket.connected
        ) {

            console.warn(
                "⚠️ JOIN demandé mais Socket.IO non connecté"
            );


            connectSocket();

            return;
        }


        if (selectedBet <= 0) {

            openBetModal();

            return;
        }


        console.log(
            "🎮 JOIN GAME",
            {
                playerId,
                playerName,
                bet: selectedBet
            }
        );


        const data = {

            playerId,

            playerName,

            bet: selectedBet,

            amount: selectedBet
        };


        /*
           Compatible avec ton backend actuel.
        */

        socket.emit(
            "join",
            data
        );


        socket.emit(
            "joinGame",
            data
        );


        gameJoined = true;


        if (tapButton) {

            tapButton.disabled =
                false;
        }


        setMessage(
            "🔥 À TOI DE TAPPER !"
        );


        startLocalTimer();
    }


    /* =========================================================
       💬 CHAT
    ========================================================= */

    const receivedChatIds =
        new Set();


    const receivedChatKeys =
        new Map();


    function normalizeChatText(text) {

        return String(text ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }


    function getChatMessageData(msg) {

        if (
            typeof msg === "string"
        ) {

            return {

                playerId: "",

                playerName: "Anonyme",

                message: msg,

                id: "",

                timestamp: ""
            };
        }


        if (
            !msg ||
            typeof msg !== "object"
        ) {

            return null;
        }


        return {

            playerId:
                msg.playerId ??
                msg.senderId ??
                msg.userId ??
                "",

            playerName:
                msg.playerName ??
                msg.name ??
                msg.username ??
                msg.senderName ??
                "Anonyme",

            message:
                msg.message ??
                msg.text ??
                msg.content ??
                msg.msg ??
                "",

            id:
                msg._id ??
                msg.id ??
                msg.messageId ??
                msg.uuid ??
                "",

            timestamp:
                msg.createdAt ??
                msg.timestamp ??
                msg.time ??
                ""
        };
    }


    function receiveChatMessage(msg) {

        if (!chatMessages) {
            return;
        }


        const data =
            getChatMessageData(msg);


        if (!data) {
            return;
        }


        const sender =
            String(
                data.playerName ||
                "Anonyme"
            ).trim();


        const text =
            String(
                data.message ||
                ""
            ).trim();


        if (!text) {
            return;
        }


        if (data.id) {

            const id =
                String(
                    data.id
                );


            if (
                receivedChatIds.has(id)
            ) {

                return;
            }


            receivedChatIds.add(id);
        }


        const contentKey =
            normalizeChatText(sender) +
            "|" +
            normalizeChatText(text);


        const now =
            Date.now();


        const previous =
            receivedChatKeys.get(
                contentKey
            );


        if (
            previous &&
            now - previous < 1500
        ) {

            return;
        }


        receivedChatKeys.set(
            contentKey,
            now
        );


        const element =
            document.createElement(
                "div"
            );


        element.className =
            "chat-message";


        const strong =
            document.createElement(
                "strong"
            );


        strong.textContent =
            sender + ": ";


        element.appendChild(
            strong
        );


        element.appendChild(
            document.createTextNode(
                text
            )
        );


        chatMessages.appendChild(
            element
        );


        while (
            chatMessages.children.length > 100
        ) {

            chatMessages.removeChild(
                chatMessages.firstChild
            );
        }


        chatMessages.scrollTop =
            chatMessages.scrollHeight;
    }


    function sendChatMessage() {

        if (!chatInput) {
            return;
        }


        const text =
            chatInput.value.trim();


        if (!text) {

            chatInput.focus();

            return;
        }


        if (
            text.length > 200
        ) {

            alert(
                "⚠️ Maximum 200 caractères."
            );

            return;
        }


        if (
            !socket ||
            !socket.connected
        ) {

            setMessage(
                "🟠 Connexion au serveur..."
            );


            connectSocket();

            return;
        }


        const now =
            Date.now();


        if (
            text === lastSentMessage &&
            now - lastSentMessageTime < 1000
        ) {

            return;
        }


        lastSentMessage =
            text;


        lastSentMessageTime =
            now;


        const data = {

            playerId,

            playerName,

            message: text
        };


        socket.emit(
            "chatMessage",
            data
        );


        socket.emit(
            "chat:message",
            data
        );


        chatInput.value = "";

        chatInput.focus();
    }


    chatSend?.addEventListener(
        "click",
        event => {

            event.preventDefault();

            sendChatMessage();
        }
    );


    chatInput?.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendChatMessage();
            }
        }
    );


    /* =========================================================
       🔌 SOCKET.IO
    ========================================================= */

    function setupSocketEvents() {

        if (!socket) {
            return;
        }


        /* =====================================================
           CONNEXION
        ===================================================== */

        socket.on(
            "connect",
            () => {

                socketReady = true;


                console.log(
                    "🟢 SOCKET CONNECTÉ :",
                    socket.id
                );


                setMessage(
                    selectedBet > 0
                        ? `💰 Mise $${selectedBet} sélectionnée`
                        : "🟢 SERVEUR CONNECTÉ"
                );


                /*
                   Demandes au backend.
                   Si un événement n'existe pas côté serveur,
                   il est simplement ignoré.
                */

                socket.emit(
                    "getGame"
                );


                socket.emit(
                    "getLeaderboard"
                );


                socket.emit(
                    "getChatHistory"
                );


                socket.emit(
                    "getOnlineCount"
                );


                socket.emit(
                    "online:request"
                );


                /*
                   Si l'utilisateur avait déjà
                   sélectionné une mise et venait
                   d'appuyer sur JOUER, le join
                   est effectué.
                */

                if (
                    selectedBet > 0 &&
                    !gameJoined &&
                    connectionWaitInterval
                ) {

                    console.log(
                        "🎮 Connexion prête"
                    );
                }
            }
        );


        /* =====================================================
           DÉCONNEXION
        ===================================================== */

        socket.on(
            "disconnect",
            reason => {

                socketReady = false;


                console.warn(
                    "🔴 SOCKET DÉCONNECTÉ :",
                    reason
                );


                if (gameJoined) {

                    setMessage(
                        "🟠 Reconnexion..."
                    );
                }
            }
        );


        /* =====================================================
           ERREUR
        ===================================================== */

        socket.on(
            "connect_error",
            error => {

                socketReady = false;


                console.error(
                    "❌ SOCKET ERROR :",
                    error
                );


                setMessage(
                    "🟠 Serveur momentanément indisponible"
                );
            }
        );


        /* =====================================================
           CHAT
        ===================================================== */

        socket.on(
            "chatMessage",
            receiveChatMessage
        );


        socket.on(
            "chat:message",
            receiveChatMessage
        );


        socket.on(
            "chatHistory",
            messages => {

                if (
                    Array.isArray(messages)
                ) {

                    messages.forEach(
                        receiveChatMessage
                    );
                }
            }
        );


        socket.on(
            "chat:history",
            messages => {

                if (
                    Array.isArray(messages)
                ) {

                    messages.forEach(
                        receiveChatMessage
                    );
                }
            }
        );


        /* =====================================================
           TIMER
        ===================================================== */

        function handleServerTimer(data) {

            let value =
                data;


            if (
                data &&
                typeof data === "object"
            ) {

                value =
                    data.timeLeft ??
                    data.time ??
                    data.seconds ??
                    data.remaining ??
                    data.timer ??
                    data.duration;
            }


            const seconds =
                Number(
                    value
                );


            if (
                !Number.isFinite(
                    seconds
                )
            ) {

                return;
            }


            updateTimerDisplay(
                seconds
            );


            if (
                seconds <= 0
            ) {

                stopLocalTimer();


                gameJoined =
                    false;


                if (tapButton) {

                    tapButton.disabled =
                        true;
                }


                setMessage(
                    "⏰ PARTIE TERMINÉE"
                );


                return;
            }


            if (gameJoined) {

                startLocalTimer();
            }
        }


        socket.on(
            "timer",
            handleServerTimer
        );


        socket.on(
            "gameTimer",
            handleServerTimer
        );


        socket.on(
            "timer:update",
            handleServerTimer
        );


        socket.on(
            "game:timer",
            handleServerTimer
        );


        socket.on(
            "countdown",
            handleServerTimer
        );


        /* =====================================================
           NOUVELLE PARTIE
        ===================================================== */

        function handleNewGame(data) {

            console.log(
                "🎮 NOUVELLE PARTIE",
                data
            );


           
