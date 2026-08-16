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
            Math.floor(seconds / 60);


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
            tapCountDisplay.textContent = score;
        }


        if (tapButtonCountDisplay) {
            tapButtonCountDisplay.textContent = score;
        }


        const headerScore =
            document.getElementById(
                "headerScore"
            );


        if (headerScore) {
            headerScore.textContent = score;
        }


        const statTaps =
            document.getElementById(
                "statTaps"
            );


        if (statTaps) {
            statTaps.textContent = score;
        }


        const statTotal =
            document.getElementById(
                "statTotal"
            );


        if (statTotal) {
            statTotal.textContent = score;
        }
    }


    /* =========================================================
       MESSAGE
    ========================================================= */

    function setMessage(text) {

        if (tapMessage) {
            tapMessage.textContent = text;
        }
    }


    /* =========================================================
       TIMER LOCAL
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

                    if (tapButton) {
                        tapButton.disabled = true;
                    }

                    gameJoined = false;

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
       🎮 OUVERTURE PARTIE
    ========================================================= */

    function openChallenge() {

        console.log(
            "🎮 OUVERTURE DU CHALLENGE"
        );


        if (!socket || !socket.connected) {

            setMessage(
                "🟠 Connexion au serveur..."
            );

            connectSocket();

            return;
        }


        if (gameJoined) {

            setMessage(
                "🔥 TU ES DÉJÀ DANS LA PARTIE !"
            );

            return;
        }


        if (selectedBet <= 0) {

            openBetModal();

            return;
        }


        joinGame();
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
                    grid-template-columns:
                        repeat(2,1fr);
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
                                border:
                                    1px solid
                                    #ffcc00;
                                background:
                                    #1a0828;
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


                        if (
                            socket &&
                            socket.connected
                        ) {

                            joinGame();
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
       🎮 JOIN
    ========================================================= */

    function joinGame() {

        if (
            !socket ||
            !socket.connected
        ) {

            connectSocket();

            return;
        }


        if (selectedBet <= 0) {

            openBetModal();

            return;
        }


        console.log(
            "🎮 JOIN GAME"
        );


        const data = {

            playerId,

            playerName,

            bet: selectedBet,

            amount: selectedBet
        };


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
                data.message || ""
            ).trim();


        if (!text) {
            return;
        }


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
                receivedChatIds.size > 1000
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


    if (chatSend) {

        chatSend.addEventListener(
            "click",
            event => {

                event.preventDefault();

                sendChatMessage();
            }
        );
    }


    if (chatInput) {

        chatInput.addEventListener(
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
    }


    /* =========================================================
       🔌 SOCKET.IO
    ========================================================= */

    function setupSocketEvents() {

        if (!socket) {
            return;
        }


        socket.on(
            "connect",
            () => {

                socketReady = true;

                console.log(
                    "🟢 SOCKET CONNECTÉ :",
                    socket.id
                );


                setMessage(
                    "🟢 SERVEUR CONNECTÉ"
                );


                socket.emit("getGame");
                socket.emit("getLeaderboard");
                socket.emit("getChatHistory");


                if (
                    selectedBet > 0 &&
                    !gameJoined
                ) {

                    setMessage(
                        `💰 Mise $${selectedBet} sélectionnée — appuie sur JOUER`
                    );
                }
            }
        );


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

                if (Array.isArray(messages)) {

                    messages.forEach(
                        receiveChatMessage
                    );
                }
            }
        );


        socket.on(
            "chat:history",
            messages => {

                if (Array.isArray(messages)) {

                    messages.forEach(
                        receiveChatMessage
                    );
                }
            }
        );


        function handleServerTimer(data) {

            let value = data;


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
                Number(value);


            if (
                !Number.isFinite(seconds)
            ) {
                return;
            }


            updateTimerDisplay(seconds);


            if (seconds <= 0) {

                stopLocalTimer();

                gameJoined = false;


                if (tapButton) {
                    tapButton.disabled = true;
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


        socket.on("timer", handleServerTimer);
        socket.on("gameTimer", handleServerTimer);
        socket.on("timer:update", handleServerTimer);
        socket.on("game:timer", handleServerTimer);
        socket.on("countdown", handleServerTimer);


        function handleNewGame(data) {

            console.log(
                "🎮 NOUVELLE PARTIE",
                data
            );


            updateScoreDisplays(0);

            gameJoined = false;


            let duration =
                GAME_DURATION;


            if (
                data &&
                typeof data === "object"
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
                !Number.isFinite(duration) ||
                duration <= 0
            ) {

                duration =
                    GAME_DURATION;
            }


            resetLocalTimer(duration);


            if (tapButton) {
                tapButton.disabled = true;
            }


            setMessage(
                "🔥 NOUVELLE PARTIE — CHOISIS TA MISE"
            );
        }


        socket.on("newGame", handleNewGame);
        socket.on("game:new", handleNewGame);


        function updateOnlineCount(data) {

            let count = data;


            if (
                data &&
                typeof data === "object"
            ) {

                count =
                    data.count ??
                    data.online ??
                    data.onlineCount;
            }


            count = Number(count);


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
                            box-shadow:
                                0 0 8px #2ecc71;
                        "
                    ></span>

                    <span>
                        ${count} EN LIGNE
                    </span>
                `;
            }
        }


        socket.on("onlineCount", updateOnlineCount);
        socket.on("online:count", updateOnlineCount);
        socket.on("online", updateOnlineCount);


        function updateLeaderboard(players) {

            if (!leaderboardList) {
                return;
            }


            if (
                players &&
                typeof players === "object" &&
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


                        return scoreB - scoreA;
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

                                <div
                                    class="leaderboard-item"
                                >

                                    <div class="rank">
                                        #${index + 1}
                                    </div>

                                    <div class="player-name">

                                        ${escapeHTML(name)}

                                        ${
                                            isMe
                                                ? "<strong> (toi)</strong>"
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


        function handleTapResult(data) {

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


        socket.on(
            "score:update",
            handleTapResult
        );


        function updateTotalStakes(data) {

            let total = data;


            if (
                data &&
                typeof data === "object"
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
                    "$" + total;
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


        socket.on(
            "joinSuccess",
            data => {

                gameJoined = true;


                if (data?.score !== undefined) {

                    updateScoreDisplays(
                        data.score
                    );
                }


                setMessage(
                    "🔥 À TOI DE TAPPER !"
                );


                if (tapButton) {
                    tapButton.disabled = false;
                }
            }
        );


        socket.on(
            "join:success",
            data => {

                gameJoined = true;


                if (data?.score !== undefined) {

                    updateScoreDisplays(
                        data.score
                    );
                }


                if (tapButton) {
                    tapButton.disabled = false;
                }
            }
        );


        socket.on(
            "joinError",
            data => {

                gameJoined = false;


                if (tapButton) {
                    tapButton.disabled = true;
                }


                setMessage(
                    data?.message ||
                    "❌ Impossible de rejoindre la partie"
                );
            }
        );


        socket.on(
            "join:error",
            data => {

                gameJoined = false;


                if (tapButton) {
                    tapButton.disabled = true;
                }


                setMessage(
                    data?.message ||
                    "❌ Impossible de rejoindre la partie"
                );
            }
        );
    }


    async function connectSocket() {

        if (
            socket &&
            socket.connected
        ) {
            return;
        }


        if (
            typeof window.io !==
            "function"
        ) {

            console.error(
                "❌ Socket.IO non chargé."
            );


            setMessage(
                "🟠 Chargement de la connexion..."
            );


            setTimeout(
                connectSocket,
                1000
            );


            return;
        }


        try {

            socket =
                window.io(
                    BACKEND_URL,
                    {
                        transports: [
                            "websocket",
                            "polling"
                        ],

                        reconnection: true,

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
                "❌ SOCKET ERROR",
                error
            );


            setMessage(
                "🟠 Connexion au serveur..."
            );
        }
    }


    /* =========================================================
       ⚡ TAP BUTTON
    ========================================================= */

    if (tapButton) {

        tapButton.addEventListener(
            "click",
            () => {

                if (!gameJoined) {

                    setMessage(
                        "⚡ Appuie d'abord sur JOUER"
                    );

                    return;
                }


                if (currentTimer <= 0) {
                    return;
                }


                if (
                    !socket ||
                    !socket.connected
                ) {

                    connectSocket();

                    return;
                }


                if (tapLocked) {
                    return;
                }


                tapLocked = true;


                tapButton.classList.add(
                    "tap-active"
                );


                socket.emit(
                    "tap",
                    {
                        playerId,
                        playerName,
                        taps: 1
                    }
                );


                setTimeout(
                    () => {

                        tapLocked = false;

                        tapButton.classList.remove(
                            "tap-active"
                        );

                    },
                    80
                );
            }
        );
    }


    /* =========================================================
       🎮 BOUTON JOUER
    ========================================================= */

    if (enterChallenge) {

        enterChallenge.addEventListener(
            "click",
            event => {

                event.preventDefault();

                openChallenge();
            }
        );
    }


    /* =========================================================
       💰 WALLET — CORRIGÉ
    ========================================================= */

    function isTronLinkAvailable() {

        return !!(
            window.tronWeb &&
            window.tronWeb.ready &&
            window.tronWeb.defaultAddress &&
            window.tronWeb.defaultAddress.base58
        );
    }


    function getConnectedTronAddress() {

        if (!isTronLinkAvailable()) {
            return "";
        }


        return window.tronWeb
            .defaultAddress
            .base58 || "";
    }


    async function copyTronAddress() {

        try {

            if (
                navigator.clipboard &&
                window.isSecureContext
            ) {

                await navigator.clipboard.writeText(
                    USDT_TRON_ADDRESS
                );

            } else {

                const textarea =
                    document.createElement(
                        "textarea"
                    );


                textarea.value =
                    USDT_TRON_ADDRESS;


                textarea.style.position =
                    "fixed";

                textarea.style.opacity =
                    "0";


                document.body.appendChild(
                    textarea
                );


                textarea.focus();
                textarea.select();


                document.execCommand(
                    "copy"
                );


                textarea.remove();
            }


            setMessage(
                "📋 Adresse USDT TRC20 copiée !"
            );


            alert(
                "📋 Adresse USDT TRC20 copiée !\n\n" +
                USDT_TRON_ADDRESS
            );


        } catch (error) {

            console.error(
                "❌ COPIE ADRESSE",
                error
            );


            alert(
                "Adresse USDT TRC20 :\n\n" +
                USDT_TRON_ADDRESS
            );
        }
    }


    function openWalletChoice() {

        const connectedAddress =
            getConnectedTronAddress();


        const connectedHTML =
            connectedAddress
                ? `
                    <div
                        style="
                            padding:12px;
                            margin-bottom:12px;
                            border-radius:12px;
                            background:rgba(46,204,113,.10);
                            border:1px solid rgba(46,204,113,.35);
                            color:#fff;
                            font-size:12px;
                            word-break:break-all;
                        "
                    >

                        <strong
                            style="
                                color:#2ecc71;
                            "
                        >
                            🟢 WALLET CONNECTÉ
                        </strong>

                        <br><br>

                        ${escapeHTML(
                            connectedAddress
                        )}

                    </div>
                `
                : "";


        const html = `

            ${connectedHTML}

            <p
                style="
                    color:#ddd;
                    line-height:1.5;
                "
            >
                Choisis ton moyen de paiement
                <strong>USDT TRC20</strong>.
            </p>


            <button
                type="button"
                id="miltapeTronLink"
                style="
                    width:100%;
                    padding:15px;
                    margin-top:8px;
                    border-radius:12px;
                    border:1px solid #ffcc00;
                    background:linear-gradient(
                        135deg,
                        #ffcc00,
                        #ff8a00
                    );
                    color:#16051f;
                    font-weight:900;
                    font-size:14px;
                    cursor:pointer;
                "
            >
                🔗 TRONLINK
            </button>


            <button
                type="button"
                id="miltapeTrustWallet"
                style="
                    width:100%;
                    padding:15px;
                    margin-top:10px;
                    border-radius:12px;
                    border:1px solid #6c63ff;
                    background:#1a0828;
                    color:#fff;
                    font-weight:900;
                    font-size:14px;
                    cursor:pointer;
                "
            >
                💙 TRUST WALLET
            </button>


            <button
                type="button"
                id="miltapeCopyAddress"
                style="
                    width:100%;
                    padding:15px;
                    margin-top:10px;
                    border-radius:12px;
                    border:1px solid #2ecc71;
                    background:#10251b;
                    color:#2ecc71;
                    font-weight:900;
                    font-size:14px;
                    cursor:pointer;
                "
            >
                📋 COPIER L'ADRESSE TRC20
            </button>


            <div
                style="
                    margin-top:15px;
                    padding:12px;
                    border-radius:10px;
                    background:rgba(255,255,255,.04);
                    color:#aaa;
                    font-size:11px;
                    word-break:break-all;
                "
            >

                <strong
                    style="color:#ffcc00;"
                >
                    Adresse de paiement :
                </strong>

                <br><br>

                ${USDT_TRON_ADDRESS}

            </div>

        `;


        openModal(
            "💰 WALLET & PAIEMENT",
            html
        );


        document
            .getElementById(
                "miltapeTronLink"
            )
            ?.addEventListener(
                "click",
                async () => {

                    if (
                        isTronLinkAvailable()
                    ) {

                        const address =
                            getConnectedTronAddress();


                        alert(
                            "🟢 TRONLINK EST CONNECTÉ !\n\n" +
                            address
                        );


                        return;
                    }


                    closeModal();


                    setTimeout(
                        () => {

                            alert(
                                "⚠️ TronLink n'est pas détecté.\n\n" +
                                "Ouvre Miltape depuis le navigateur intégré de ton wallet TRON ou installe/ouvre TronLink, puis reviens sur Miltape."
                            );

                        },
                        100
                    );
                }
            );


        document
            .getElementById(
                "miltapeTrustWallet"
            )
            ?.addEventListener(
                "click",
                () => {

                    closeModal();


                    const trustAppURL =
                        "https://link.trustwallet.com/open_url?coin=195&url=" +
                        encodeURIComponent(
                            window.location.href
                        );


                    window.location.href =
                        trustAppURL;
                }
            );


        document
            .getElementById(
                "miltapeCopyAddress"
            )
            ?.addEventListener(
                "click",
                () => {

                    copyTronAddress();
                }
            );
    }


    walletButton?.addEventListener(
        "click",
        event => {

            event.preventDefault();

            openWalletChoice();
        }
    );


    /* =========================================================
       MENU
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
       MODAL
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
        event => {

            if (
                event.target ===
                dynamicModal
            ) {

                closeModal();
            }
        }
    );


    /* =========================================================
       MENU BUTTONS
    ========================================================= */

    document
        .getElementById("menuGamesBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "🎮 Mes parties",
                    `
                    <p>
                        Ton historique de parties
                        apparaîtra ici.
                    </p>
                    `
                );
            }
        );


    document
        .getElementById("menuRankingsBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                document
                    .querySelector(".leaderboard")
                    ?.scrollIntoView({
                        behavior: "smooth"
                    });
            }
        );


    document
        .getElementById("menuGainsBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "💰 Mes gains",
                    `
                    <p>
                        Tes gains seront affichés
                        ici lorsque le système
                        de paiement sera actif.
                    </p>
                    `
                );
            }
        );


    document
        .getElementById("menuWithdrawalsBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "💸 Mes retraits",
                    `
                    <p>
                        La gestion des retraits
                        sera disponible ici.
                    </p>
                    `
                );
            }
        );


    document
        .getElementById("menuReferralBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "👥 Parrainage",
                    `
                    <p>
                        Ton identifiant de parrainage :
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


    document
        .getElementById("menuChatBtn")
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                document
                    .querySelector(".chat-section")
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


    document
        .getElementById("menuRulesBtn")
        ?.addEventListener(
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
       PWA
    ========================================================= */

    const installButton =
        document.getElementById(
            "installPwaButton"
        );


    window.addEventListener(
        "beforeinstallprompt",
        event => {

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
                    "PWA",
                    error
                );
            }


            deferredPrompt = null;

            installButton.classList.remove(
                "show"
            );
        }
    );


    /* =========================================================
       ETAT INITIAL
    ========================================================= */

    updateScoreDisplays(0);

    updateTimerDisplay(
        GAME_DURATION
    );


    if (tapButton) {

        tapButton.disabled = true;
    }


    /* =========================================================
       CONNEXION
    ========================================================= */

    connectSocket();


    /* =========================================================
       LOG
    ========================================================= */

    console.log(
        "✅ MILTAPE INITIALISÉ"
    );

    console.log(
        "🔌 BACKEND :",
        BACKEND_URL
    );

    console.log(
        "👤 PLAYER :",
        playerId
    );

});
