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
       ⚙️ CONFIGURATION
    ========================================================= */

    const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

    const BACKEND_URL = isLocalhost
        ? "http://localhost:3000"
        : "https://miltape-backend-production.up.railway.app";

    const USDT_TRON_ADDRESS =
        "TBZZ3nakc3w5SnJ1EZpvVWYWZ3q1NffNPM";

    const GAME_DURATION = 600;

    const MAX_CHAT_MESSAGES = 100;

    const MAX_MESSAGE_LENGTH = 200;


    /* =========================================================
       🔌 VARIABLES SOCKET
    ========================================================= */

    let socket = null;

    let socketReady = false;

    let socketConnecting = false;

    let socketEventsConfigured = false;


    /* =========================================================
       🎮 ÉTAT DU JEU
    ========================================================= */

    let localTaps = 0;

    let currentTimer = GAME_DURATION;

    let timerInterval = null;

    let timerRunning = false;

    let gameJoined = false;

    let gameStarted = false;

    let tapLocked = false;


    /* =========================================================
       💬 CHAT
    ========================================================= */

    let lastSentMessage = "";

    let lastSentMessageTime = 0;

    const receivedChatIds = new Set();

    const receivedChatKeys = new Map();


    /* =========================================================
       📲 PWA
    ========================================================= */

    let deferredPrompt = null;


    /* =========================================================
       👤 IDENTITÉ JOUEUR
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
        localStorage.getItem("miltape_player_name");

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
       🧩 ELEMENTS HTML
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
        document.getElementById(
            "globalTotalStakes"
        );

    const walletButton =
        document.getElementById(
            "walletButton"
        );

    const enterChallenge =
        document.getElementById(
            "enterChallenge"
        );


    /* =========================================================
       🔎 DEBUG
    ========================================================= */

    console.log(
        "========== MILTAPE =========="
    );

    console.log(
        "BACKEND :",
        BACKEND_URL
    );

    console.log(
        "Chat :",
        !!chatMessages,
        !!chatInput,
        !!chatSend
    );

    console.log(
        "Tap :",
        !!tapButton
    );

    console.log(
        "Jouer :",
        !!enterChallenge
    );

    console.log(
        "============================="
    );


    /* =========================================================
       🧰 UTILITAIRES
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

        seconds = Math.max(
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
                formatTime(currentTimer);
        }
    }


    /* =========================================================
       📊 SCORE
    ========================================================= */

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
       🎮 ÉTAT TAP
    ========================================================= */

    function updateTapButtonState() {

        if (!tapButton) {
            return;
        }

        const canTap =
            socketReady &&
            gameJoined &&
            gameStarted &&
            currentTimer > 0;

        tapButton.disabled =
            !canTap;
    }


    /* =========================================================
       ⏱️ TIMER
    ========================================================= */

    function startLocalTimer() {

        if (timerRunning) {
            return;
        }

        if (currentTimer <= 0) {
            return;
        }

        timerRunning = true;

        clearInterval(timerInterval);

        let lastTick =
            Date.now();


        timerInterval =
            setInterval(() => {

                const now =
                    Date.now();

                const elapsed =
                    Math.floor(
                        (now - lastTick) /
                        1000
                    );

                if (elapsed <= 0) {
                    return;
                }

                lastTick =
                    now;


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

                    gameStarted =
                        false;

                    updateTapButtonState();


                    if (tapMessage) {

                        tapMessage.textContent =
                            "⏰ PARTIE TERMINÉE";
                    }
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
       🎮 DÉMARRER PARTIE CÔTÉ CLIENT
    ========================================================= */

    function startGameClient(
        duration = GAME_DURATION
    ) {

        const seconds =
            Number(duration);


        currentTimer =
            Number.isFinite(seconds) &&
            seconds > 0
                ? seconds
                : GAME_DURATION;


        updateTimerDisplay(
            currentTimer
        );


        updateScoreDisplays(0);


        gameJoined =
            true;

        gameStarted =
            true;


        updateTapButtonState();


        if (tapMessage) {

            tapMessage.textContent =
                "🔥 À TOI DE TAPPER !";
        }


        startLocalTimer();
    }


    /* =========================================================
       🛑 TERMINER PARTIE
    ========================================================= */

    function finishGameClient() {

        stopLocalTimer();

        gameStarted =
            false;

        updateTapButtonState();


        if (tapMessage) {

            tapMessage.textContent =
                "⏰ PARTIE TERMINÉE";
        }
    }


    /* =========================================================
       💬 NORMALISATION CHAT
    ========================================================= */

    function normalizeChatText(text) {

        return String(text ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }


    function getChatMessageData(msg) {

        if (typeof msg === "string") {

            return {

                playerId: "",

                playerName:
                    "Anonyme",

                message:
                    msg,

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


    /* =========================================================
       💬 AFFICHER MESSAGE
    ========================================================= */

    function receiveChatMessage(msg) {

        if (!chatMessages) {

            console.error(
                "❌ #chatMessages introuvable."
            );

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


        /* =====================================================
           ANTI DOUBLON ID
        ===================================================== */

        if (data.id) {

            const id =
                String(data.id);


            if (
                receivedChatIds.has(id)
            ) {
                return;
            }


            receivedChatIds.add(id);


            if (
                receivedChatIds.size >
                1000
            ) {

                const first =
                    receivedChatIds
                        .values()
                        .next()
                        .value;

                receivedChatIds.delete(
                    first
                );
            }
        }


        /* =====================================================
           ANTI DOUBLON CONTENU
        ===================================================== */

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


        /* =====================================================
           MESSAGE HTML SÉCURISÉ
        ===================================================== */

        const messageElement =
            document.createElement(
                "div"
            );

        messageElement.className =
            "chat-message";


        const strong =
            document.createElement(
                "strong"
            );

        strong.textContent =
            sender + ": ";


        const textNode =
            document.createTextNode(
                text
            );


        messageElement.appendChild(
            strong
        );

        messageElement.appendChild(
            textNode
        );


        chatMessages.appendChild(
            messageElement
        );


        /* =====================================================
           MAX 100
        ===================================================== */

        while (
            chatMessages.children.length >
            MAX_CHAT_MESSAGES
        ) {

            chatMessages.removeChild(
                chatMessages.firstChild
            );
        }


        chatMessages.scrollTop =
            chatMessages.scrollHeight;


        console.log(
            "💬 MESSAGE :",
            sender,
            text
        );
    }


    /* =========================================================
       💬 ENVOYER CHAT
    ========================================================= */

    function sendChatMessage() {

        if (!chatInput) {

            console.error(
                "❌ chatInput introuvable."
            );

            return;
        }


        const text =
            chatInput.value.trim();


        if (!text) {

            chatInput.focus();

            return;
        }


        if (
            text.length >
            MAX_MESSAGE_LENGTH
        ) {

            alert(
                "⚠️ Maximum 200 caractères."
            );

            return;
        }


        /* =====================================================
           SOCKET NON CONNECTÉ
        ===================================================== */

        if (
            !socket ||
            !socket.connected
        ) {

            if (tapMessage) {

                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }


            connectSocket();

            return;
        }


        /* =====================================================
           ANTI DOUBLE ENVOI
        ===================================================== */

        const now =
            Date.now();


        if (
            text ===
                lastSentMessage &&
            now -
                lastSentMessageTime <
                1000
        ) {

            return;
        }


        lastSentMessage =
            text;

        lastSentMessageTime =
            now;


        /* =====================================================
           MESSAGE
        ===================================================== */

        const messageData = {

            playerId:
                playerId,

            playerName:
                playerName,

            message:
                text
        };


        console.log(
            "📤 CHAT :",
            messageData
        );


        socket.emit(
            "chatMessage",
            messageData
        );


        chatInput.value = "";

        chatInput.focus();
    }


    /* =========================================================
       💬 BOUTON CHAT
    ========================================================= */

    if (chatSend) {

        chatSend.onclick = null;


        chatSend.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                event.stopPropagation();

                sendChatMessage();
            },
            {
                passive: false
            }
        );


        chatSend.style.pointerEvents =
            "auto";

        chatSend.style.touchAction =
            "manipulation";

        chatSend.style.cursor =
            "pointer";
    }


    /* =========================================================
       💬 ENTER CHAT
    ========================================================= */

    if (chatInput) {

        chatInput.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    sendChatMessage();
                }
            }
        );
    }


    /* =========================================================
       🔌 CHARGER SOCKET.IO
    ========================================================= */

    function loadSocketIO() {

        return new Promise(
            (resolve, reject) => {

                if (
                    typeof window.io ===
                    "function"
                ) {

                    resolve(
                        window.io
                    );

                    return;
                }


                const existing =
                    document.querySelector(
                        "script[data-miltape-socket]"
                    );


                if (existing) {

                    const interval =
                        setInterval(() => {

                            if (
                                typeof window.io ===
                                "function"
                            ) {

                                clearInterval(
                                    interval
                                );

                                resolve(
                                    window.io
                                );
                            }

                        }, 100);


                    setTimeout(() => {

                        clearInterval(
                            interval
                        );


                        if (
                            typeof window.io !==
                            "function"
                        ) {

                            reject(
                                new Error(
                                    "Socket.IO indisponible"
                                )
                            );
                        }

                    }, 15000);

                    return;
                }


                const script =
                    document.createElement(
                        "script"
                    );


                script.src =
                    "https://cdn.socket.io/4.7.5/socket.io.min.js";

                script.async =
                    true;

                script.dataset.miltapeSocket =
                    "true";


                script.onload = () => {

                    if (
                        typeof window.io ===
                        "function"
                    ) {

                        resolve(
                            window.io
                        );

                    } else {

                        reject(
                            new Error(
                                "io absent"
                            )
                        );
                    }
                };


                script.onerror = () => {

                    reject(
                        new Error(
                            "Erreur chargement Socket.IO"
                        )
                    );
                };


                document.head.appendChild(
                    script
                );
            }
        );
    }


    /* =========================================================
       🔌 CONNEXION SOCKET
    ========================================================= */

    async function connectSocket() {

        if (
            socket &&
            socket.connected
        ) {

            socketReady = true;

            return;
        }


        if (socketConnecting) {
            return;
        }


        socketConnecting = true;


        try {

            const io =
                await loadSocketIO();


            if (
                socket &&
                !socket.connected
            ) {

                socket.connect();

                socketConnecting =
                    false;

                return;
            }


            console.log(
                "🔌 Connexion :",
                BACKEND_URL
            );


            socket =
                io(
                    BACKEND_URL,
                    {

                        transports: [
                            "websocket",
                            "polling"
                        ],

                        reconnection:
                            true,

                        reconnectionAttempts:
                            Infinity,

                        reconnectionDelay:
                            1000,

                        reconnectionDelayMax:
                            5000,

                        timeout:
                            20000
                    }
                );


            setupSocketEvents();


        } catch (error) {

            console.error(
                "❌ SOCKET ERROR :",
                error
            );


            socketReady =
                false;


            if (tapMessage) {

                tapMessage.textContent =
                    "🟠 Serveur en attente...";
            }

        } finally {

            socketConnecting =
                false;
        }
    }


    /* =========================================================
       🔌 SOCKET EVENTS
    ========================================================= */

    function setupSocketEvents() {

        if (!socket) {
            return;
        }


        if (socketEventsConfigured) {
            return;
        }


        socketEventsConfigured =
            true;


        /* =====================================================
           CONNECT
        ===================================================== */

        socket.on(
            "connect",
            () => {

                socketReady =
                    true;


                console.log(
                    "🟢 SOCKET CONNECTÉ :",
                    socket.id
                );


                if (tapMessage) {

                    tapMessage.textContent =
                        "⚡ Choisis ta mise puis joue !";
                }


                /* =================================================
                   IDENTIFICATION
                ================================================= */

                socket.emit(
                    "join",
                    {
                        playerId,
                        playerName
                    }
                );


                /* =================================================
                   DEMANDES SERVEUR
                ================================================= */

                socket.emit(
                    "getGame"
                );


                socket.emit(
                    "getLeaderboard"
                );


                socket.emit(
                    "getChatHistory"
                );


                updateTapButtonState();
            }
        );


        /* =====================================================
           DISCONNECT
        ===================================================== */

        socket.on(
            "disconnect",
            (reason) => {

                socketReady =
                    false;


                gameStarted =
                    false;


                updateTapButtonState();


                console.warn(
                    "🔴 SOCKET DÉCONNECTÉ :",
                    reason
                );


                if (tapMessage) {

                    tapMessage.textContent =
                        "🟠 Reconnexion...";
                }
            }
        );


        /* =====================================================
           CONNECT ERROR
        ===================================================== */

        socket.on(
            "connect_error",
            (error) => {

                socketReady =
                    false;


                console.error(
                    "❌ SOCKET CONNECT ERROR :",
                    error
                );


                updateTapButtonState();
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


        /* =====================================================
           HISTORIQUE CHAT
        ===================================================== */

        socket.on(
            "chatHistory",
            (messages) => {

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
            (messages) => {

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
           TIMER SERVEUR
        ===================================================== */

        function handleServerTimer(data) {

            let value =
                data;


            if (
                data &&
                typeof data ===
                "object"
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
                Number(value);


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

                finishGameClient();

                return;
            }


            if (
                gameJoined
            ) {

                gameStarted =
                    true;

                updateTapButtonState();

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
                "🎮 NOUVELLE PARTIE :",
                data
            );


            let duration =
                GAME_DURATION;


            if (
                data &&
                typeof data ===
                "object"
            ) {

                duration =
                    Number(
                        data.timeLeft ??
                        data.duration ??
                        data.seconds ??
                        GAME_DURATION
                    );
            }


            if (
                !Number.isFinite(
                    duration
                ) ||
                duration <= 0
            ) {

                duration =
                    GAME_DURATION;
            }


            updateScoreDisplays(0);

            resetLocalTimer(
                duration
            );


            /*
             * Une nouvelle partie existe,
             * mais le joueur doit rejoindre
             * avec JOUER MAINTENANT.
             */

            gameStarted =
                false;


            updateTapButtonState();


            if (tapMessage) {

                tapMessage.textContent =
                    "🔥 NOUVELLE PARTIE — JOUE MAINTENANT !";
            }
        }


        socket.on(
            "newGame",
            handleNewGame
        );


        socket.on(
            "game:new",
            handleNewGame
        );


        /* =====================================================
           ONLINE
        ===================================================== */

        function updateOnlineCount(data) {

            let count =
                data;


            if (
                data &&
                typeof data ===
                "object"
            ) {

                count =
                    data.count ??
                    data.online ??
                    data.onlineCount;
            }


            count =
                Number(count);


            if (
                onlineCount &&
                Number.isFinite(count)
            ) {

                onlineCount.innerHTML = `
                    <span
                        style="
                            display:inline-block;
                            width:8px;
                            height:8px;
                            background:#2ecc71;
                            border-radius:50%;
                            margin-right:5px;
                            box-shadow:0 0 8px #2ecc71;
                        "
                    ></span>
                    <span>${count} EN LIGNE</span>
                `;
            }
        }


        socket.on(
            "onlineCount",
            updateOnlineCount
        );


        socket.on(
            "online:count",
            updateOnlineCount
        );


        socket.on(
            "online",
            updateOnlineCount
        );


        /* =====================================================
           LEADERBOARD
        ===================================================== */

        function updateLeaderboard(players) {

            if (!leaderboardList) {
                return;
            }


            if (
                players &&
                typeof players ===
                    "object" &&
                !Array.isArray(players)
            ) {

                players =
                    players.players ??
                    players.data ??
                    players.leaderboard ??
                    [];
            }


            if (
                !Array.isArray(players) ||
                players.length === 0
            ) {

                leaderboardList.innerHTML = `
                    <div class="empty-ranking">
                        Aucun joueur pour le moment
                    </div>
                `;

                return;
            }


            const sorted =
                [...players].sort(
                    (a, b) => {

                        const scoreA =
                            Number(
                                a.score ??
                                a.taps ??
                                a.tapCount ??
                                0
                            );


                        const scoreB =
                            Number(
                                b.score ??
                                b.taps ??
                                b.tapCount ??
                                0
                            );


                        return (
                            scoreB -
                            scoreA
                        );
                    }
                );


            leaderboardList.innerHTML =
                sorted
                    .slice(0, 5)
                    .map(
                        (p, index) => {

                            const id =
                                p.playerId ??
                                p._id ??
                                p.id ??
                                "";


                            const name =
                                p.playerName ??
                                p.name ??
                                "Anonyme";


                            const score =
                                Number(
                                    p.score ??
                                    p.taps ??
                                    p.tapCount ??
                                    0
                                );


                            const isMe =
                                String(id) ===
                                String(playerId);


                            return `
                                <div class="leaderboard-item">

                                    <div class="rank">
                                        #${index + 1}
                                    </div>

                                    <div class="player-name">
                                        ${escapeHTML(name)}
                                        ${
                                            isMe
                                                ? ' <strong>(toi)</strong>'
                                                : ""
                                        }
                                    </div>

                                    <div class="player-score">
                                        ${score} ⚡
                                    </div>

                                </div>
                            `;
                        }
                    )
                    .join("");
        }


        socket.on(
            "leaderboard",
            updateLeaderboard
        );


        socket.on(
            "leaderboard:update",
            updateLeaderboard
        );


        /* =====================================================
           TAP RESULT
        ===================================================== */

        function handleTapResult(data) {

            if (!data) {
                return;
            }


            const score =
                data.score ??
                data.taps ??
                data.totalTaps ??
                data.tapCount;


            if (
                score !== undefined
            ) {

                updateScoreDisplays(
                    score
                );
            }
        }


        socket.on(
            "tapResult",
            handleTapResult
        );


        socket.on(
            "tap:result",
            handleTapResult
        );


        /* =====================================================
           SCORE UPDATE
        ===================================================== */

        socket.on(
            "score:update",
            (data) => {

                if (!data) {
                    return;
                }


                const id =
                    data.playerId ??
                    data.id;


                if (
                    id &&
                    String(id) !==
                    String(playerId)
                ) {

                    return;
                }


                const score =
                    data.score ??
                    data.taps ??
                    data.tapCount;


                if (
                    score !== undefined
                ) {

                    updateScoreDisplays(
                        score
                    );
                }
            }
        );


        /* =====================================================
           TOTAL MISES
        ===================================================== */

        function updateTotalStakes(data) {

            let total =
                data;


            if (
                data &&
                typeof data ===
                "object"
            ) {

                total =
                    data.total ??
                    data.amount ??
                    data.totalStakes;
            }


            if (
                total !== undefined &&
                globalTotalStakes
            ) {

                globalTotalStakes.textContent =
                    "$" +
                    Number(total || 0);
            }
        }


        socket.on(
            "totalStakes",
            updateTotalStakes
        );


        socket.on(
            "stakes:update",
            updateTotalStakes
        );
    }


    /* =========================================================
       ⚡ TAP
    ========================================================= */

    if (tapButton) {

        tapButton.addEventListener(
            "click",
            () => {

                if (
                    tapButton.disabled
                ) {
                    return;
                }


                if (
                    currentTimer <= 0
                ) {

                    return;
                }


                if (
                    !socket ||
                    !socket.connected
                ) {

                    connectSocket();

                    return;
                }


                if (!gameJoined) {

                    if (tapMessage) {

                        tapMessage.textContent =
                            "⚠️ Appuie d'abord sur JOUER MAINTENANT.";
                    }

                    return;
                }


                if (!gameStarted) {

                    return;
                }


                if (tapLocked) {

                    return;
                }


                tapLocked =
                    true;


                tapButton.classList.add(
                    "tap-active"
                );


                socket.emit(
                    "tap",
                    {

                        playerId:
                            playerId,

                        playerName:
                            playerName,

                        taps:
                            1
                    }
                );


                setTimeout(() => {

                    tapLocked =
                        false;


                    tapButton.classList.remove(
                        "tap-active"
                    );

                }, 70);
            }
        );
    }


    /* =========================================================
       🎮 JOUER MAINTENANT
    ========================================================= */

    if (enterChallenge) {

        enterChallenge.addEventListener(
            "click",
            () => {

                console.log(
                    "🎮 JOUER MAINTENANT"
                );


                if (
                    !socket ||
                    !socket.connected
                ) {

                    if (tapMessage) {

                        tapMessage.textContent =
                            "🟠 Connexion au serveur...";
                    }


                    connectSocket();

                    return;
                }


                const savedBet =
                    Number(
                        localStorage.getItem(
                            "miltape_bet"
                        )
                    ) || 0;


                /*
                 * Si aucune mise n'est sélectionnée,
                 * on demande à l'utilisateur de
                 * choisir une mise.
                 */

                if (
                    savedBet <= 0
                ) {

                    if (tapMessage) {

                        tapMessage.textContent =
                            "⚠️ Choisis ta mise avant de jouer.";
                    }


                    alert(
                        "⚠️ Choisis d'abord ta mise."
                    );

                    return;
                }


                /*
                 * Rejoindre la partie.
                 *
                 * On garde l'événement "join"
                 * compatible avec ton backend actuel.
                 */

                socket.emit(
                    "join",
                    {

                        playerId:
                            playerId,

                        playerName:
                            playerName,

                        bet:
                            savedBet,

                        amount:
                            savedBet
                    }
                );


                gameJoined =
                    true;


                /*
                 * Si le serveur envoie ensuite
                 * un timer, celui-ci prendra
                 * automatiquement le contrôle.
                 *
                 * En attendant, on utilise
                 * 10 minutes.
                 */

                if (
                    currentTimer <= 0 ||
                    currentTimer >
                        GAME_DURATION
                ) {

                    resetLocalTimer(
                        GAME_DURATION
                    );
                }


                gameStarted =
                    true;


                updateTapButtonState();


                if (tapMessage) {

                    tapMessage.textContent =
                        "🔥 À TOI DE TAPPER !";
                }


                enterChallenge.blur();
            }
        );
    }


    /* =========================================================
       💰 WALLET TRON
    ========================================================= */

    async function handleWalletAction() {

        try {

            if (
                window.tronWeb &&
                window.tronWeb.ready &&
                window.tronWeb.defaultAddress
            ) {

                const address =
                    window.tronWeb
                        .defaultAddress
                        .base58;


                alert(
                    "✅ Portefeuille connecté :\n\n" +
                    address
                );

                return;
            }


            if (
                navigator.clipboard &&
                window.isSecureContext
            ) {

                await navigator.clipboard.writeText(
                    USDT_TRON_ADDRESS
                );


                alert(
                    "📋 Adresse USDT TRC20 copiée !\n\n" +
                    USDT_TRON_ADDRESS
                );

            } else {

                alert(
                    "Adresse USDT TRC20 :\n\n" +
                    USDT_TRON_ADDRESS
                );
            }

        } catch (error) {

            console.error(
                "❌ Wallet :",
                error
            );


            alert(
                "Adresse USDT TRC20 :\n\n" +
                USDT_TRON_ADDRESS
            );
        }
    }


    if (walletButton) {

        walletButton.addEventListener(
            "click",
            handleWalletAction
        );
    }


    /* =========================================================
       💰 MISE
    ========================================================= */

    function setBet(value) {

        const amount =
            Math.max(
                0,
                Number(value) || 0
            );


        if (displayBet) {

            displayBet.textContent =
                "$" +
                amount;
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


    if (savedBet !== null) {

        setBet(
            savedBet
        );
    }


    /* =========================================================
       🧭 MENU
    ========================================================= */

    const menuButton =
        document.getElementById(
            "menuButton"
        );

    const sideMenu =
        document.getElementById(
            "sideMenu"
        );

    const closeMenu =
        document.getElementById(
            "closeMenu"
        );

    const menuOverlay =
        document.getElementById(
            "menuOverlay"
        );


    function openSideMenu() {

        sideMenu?.classList.add(
            "show"
        );

        menuOverlay?.classList.add(
            "show"
        );

        document.body.style.overflow =
            "hidden";
    }


    function closeSideMenu() {

        sideMenu?.classList.remove(
            "show"
        );

        menuOverlay?.classList.remove(
            "show"
        );

        document.body.style.overflow =
            "";
    }


    menuButton?.addEventListener(
        "click",
        openSideMenu
    );


    closeMenu?.addEventListener(
        "click",
        closeSideMenu
    );


    menuOverlay?.addEventListener(
        "click",
        closeSideMenu
    );


    /* =========================================================
       🪟 MODAL
    ========================================================= */

    const dynamicModal =
        document.getElementById(
            "dynamicModal"
        );

    const closeDynamicModal =
        document.getElementById(
            "closeDynamicModal"
        );

    const dynamicModalTitle =
        document.getElementById(
            "dynamicModalTitle"
        );

    const dynamicModalBody =
        document.getElementById(
            "dynamicModalBody"
        );


    function openModal(
        title,
        content
    ) {

        if (!dynamicModal) {
            return;
        }


        if (dynamicModalTitle) {

            dynamicModalTitle.textContent =
                title;
        }


        if (dynamicModalBody) {

            dynamicModalBody.innerHTML =
                content;
        }


        dynamicModal.classList.add(
            "show"
        );
    }


    function closeModal() {

        dynamicModal?.classList.remove(
            "show"
        );
    }


    closeDynamicModal?.addEventListener(
        "click",
        closeModal
    );


    dynamicModal?.addEventListener(
        "click",
        (event) => {

            if (
                event.target ===
                dynamicModal
            ) {

                closeModal();
            }
        }
    );


    /* =========================================================
       🧭 BOUTONS MENU
    ========================================================= */

    const menuGamesBtn =
        document.getElementById(
            "menuGamesBtn"
        );

    const menuRankingsBtn =
        document.getElementById(
            "menuRankingsBtn"
        );

    const menuGainsBtn =
        document.getElementById(
            "menuGainsBtn"
        );

    const menuWithdrawalsBtn =
        document.getElementById(
            "menuWithdrawalsBtn"
        );

    const menuReferralBtn =
        document.getElementById(
            "menuReferralBtn"
        );

    const menuChatBtn =
        document.getElementById(
            "menuChatBtn"
        );

    const menuRulesBtn =
        document.getElementById(
            "menuRulesBtn"
        );


    menuGamesBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            openModal(
                "🎮 Mes parties",
                `
                    <p>
                        Tes parties seront affichées ici.
                    </p>
                `
            );
        }
    );


    menuRankingsBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            document
                .querySelector(
                    ".leaderboard"
                )
                ?.scrollIntoView({
                    behavior: "smooth"
                });
        }
    );


    menuGainsBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            openModal(
                "💰 Mes gains",
                `
                    <p>
                        Tes gains apparaîtront ici
                        lorsque le système de paiement
                        sera actif.
                    </p>
                `
            );
        }
    );


    menuWithdrawalsBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            openModal(
                "💸 Mes retraits",
                `
                    <p>
                        La gestion des retraits sera
                        disponible ici.
                    </p>
                `
            );
        }
    );


    menuReferralBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            openModal(
                "👥 Parrainage",
                `
                    <p>
                        Ton code de parrainage :
                    </p>

                    <p>
                        <strong>
                            ${escapeHTML(playerId)}
                        </strong>
                    </p>
                `
            );
        }
    );


    menuChatBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();


            document
                .querySelector(
                    ".chat-section"
                )
                ?.scrollIntoView({
                    behavior: "smooth"
                });


            setTimeout(
                () => {

                    chatInput?.focus();

                },
                500
            );
        }
    );


    menuRulesBtn?.addEventListener(
        "click",
        () => {

            closeSideMenu();

            openModal(
                "📜 Règles Miltape",
                `
                    <p>
                        ⏱️ Une partie dure 10 minutes.
                    </p>

                    <p>
                        🏆 Les 5 meilleurs joueurs
                        sont classés.
                    </p>

                    <p>
                        🪙 Les mises utilisent
                        USDT TRC20.
                    </p>
                `
            );
        }
    );


    /* =========================================================
       📲 PWA
    ========================================================= */

    const installButton =
        document.getElementById(
            "installPwaButton"
        );


    window.addEventListener(
        "beforeinstallprompt",
        (event) => {

            event.preventDefault();

            deferredPrompt =
                event;


            installButton?.classList.add(
                "show"
            );
        }
    );


    installButton?.addEventListener(
        "click",
        async () => {

            if (!deferredPrompt) {
                return;
            }


            try {

                await deferredPrompt.prompt();

                await deferredPrompt.userChoice;

            } catch (error) {

                console.warn(
                    "PWA :",
                    error
                );
            }


            deferredPrompt =
                null;


            installButton.classList.remove(
                "show"
            );
        }
    );


    /* =========================================================
       🧹 VISIBILITÉ PAGE
    ========================================================= */

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState ===
                "visible"
            ) {

                updateTapButtonState();
            }
        }
    );


    /* =========================================================
       🔄 ÉTAT INITIAL
    ========================================================= */

    updateScoreDisplays(0);

    updateTimerDisplay(
        GAME_DURATION
    );


    gameJoined =
        false;

    gameStarted =
        false;


    updateTapButtonState();


    if (tapMessage) {

        tapMessage.textContent =
            "⚡ CHOISIS TA MISE ET APPUIE SUR JOUER";
    }


    /* =========================================================
       🔌 CONNEXION
    ========================================================= */

    connectSocket();


    /* =========================================================
       🔁 VÉRIFICATION SOCKET
    ========================================================= */

    const connectionCheck =
        setInterval(
            () => {

                if (
                    socket &&
                    socket.connected
                ) {

                    socketReady =
                        true;

                    updateTapButtonState();

                }

            },
            1000
        );


    /*
     * Sécurité pour éviter un intervalle
     * inutile pendant des heures.
     */

    setTimeout(
        () => {

            clearInterval(
                connectionCheck
            );

        },
        300000
    );


    /* =========================================================
       📱 EMPÊCHER LE ZOOM DOUBLE TAP
    ========================================================= */

    if (tapButton) {

        tapButton.addEventListener(
            "dblclick",
            (event) => {

                event.preventDefault();
            }
        );
    }


    /* =========================================================
       ✅ FIN
    ========================================================= */

    console.log(
        "✅ MILTAPE INITIALISÉ"
    );

    console.log(
        "💬 CHAT : OK"
    );

    console.log(
        "🎮 JEU : OK"
    );

    console.log(
        "🔌 BACKEND :",
        BACKEND_URL
    );

});
