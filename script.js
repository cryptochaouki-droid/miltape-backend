document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       🛡️ PROTECTION ABSOLUE CONTRE LE DOUBLE CHARGEMENT
       
       Si script.js est chargé 2 fois par erreur dans le HTML,
       le deuxième exemplaire NE DOIT RIEN initialiser.
    ========================================================= */

    if (window.__MILTA​PE_INITIALIZED__) {
        console.warn("🛑 Miltape déjà initialisé — deuxième chargement ignoré.");
        return;
    }

    window.__MILTA​PE_INITIALIZED__ = true;

    console.log("🚀 MILTAPE WORLD CHALLENGE — INITIALISATION UNIQUE");


    /* =========================================================
       CONFIGURATION
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

    let socketEventsConfigured = false;


    /* =========================================================
       IDENTITÉ JOUEUR
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
       ELEMENTS HTML
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

    const displayBet =
        document.getElementById("displayBet");

    const globalTotalStakes =
        document.getElementById("globalTotalStakes");


    /* =========================================================
       MENU
    ========================================================= */

    const menuButton =
        document.getElementById("menuButton");

    const sideMenu =
        document.getElementById("sideMenu");

    const closeMenu =
        document.getElementById("closeMenu");

    const menuOverlay =
        document.getElementById("menuOverlay");


    /* =========================================================
       MODAL
    ========================================================= */

    const dynamicModal =
        document.getElementById("dynamicModal");

    const closeDynamicModal =
        document.getElementById("closeDynamicModal");

    const dynamicModalTitle =
        document.getElementById("dynamicModalTitle");

    const dynamicModalBody =
        document.getElementById("dynamicModalBody");


    /* =========================================================
       CHAT INPUT
    ========================================================= */

    const chatInput =
        document.getElementById("chatInput");

    const chatSend =
        document.getElementById("chatSend");


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

        const value =
            Math.max(
                0,
                Math.floor(
                    Number(seconds) || 0
                )
            );

        currentTimer = value;

        if (timerDisplay) {
            timerDisplay.textContent =
                formatTime(value);
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
            document.getElementById("headerScore");

        if (headerScore) {
            headerScore.textContent = score;
        }

        const statTaps =
            document.getElementById("statTaps");

        if (statTaps) {
            statTaps.textContent = score;
        }

        const statTotal =
            document.getElementById("statTotal");

        if (statTotal) {
            statTotal.textContent = score;
        }
    }


    /* =========================================================
       ⏱️ CHRONO LOCAL
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

        let lastTick = Date.now();

        timerInterval =
            setInterval(() => {

                const now = Date.now();

                const elapsed =
                    Math.floor(
                        (now - lastTick) / 1000
                    );

                if (elapsed <= 0) {
                    return;
                }

                lastTick = now;

                currentTimer =
                    Math.max(
                        0,
                        currentTimer - elapsed
                    );

                updateTimerDisplay(
                    currentTimer
                );

                if (currentTimer <= 0) {

                    stopLocalTimer();

                    if (tapButton) {
                        tapButton.disabled = true;
                    }

                    if (tapMessage) {
                        tapMessage.textContent =
                            "⏰ PARTIE TERMINÉE";
                    }
                }

            }, 250);
    }


    function stopLocalTimer() {

        if (timerInterval) {
            clearInterval(timerInterval);
        }

        timerInterval = null;
        timerRunning = false;
    }


    function resetLocalTimer(seconds = GAME_DURATION) {

        stopLocalTimer();

        updateTimerDisplay(seconds);
    }


    /* =========================================================
       ⏱️ TIMER SERVEUR
    ========================================================= */

    function handleServerTimer(data) {

        let value = data;

        if (
            typeof data === "object" &&
            data !== null
        ) {

            value =
                data.timeLeft ??
                data.time ??
                data.seconds ??
                data.remaining ??
                data.timer ??
                data.duration;
        }

        const seconds = Number(value);

        if (!Number.isFinite(seconds)) {
            return;
        }

        const cleanSeconds =
            Math.max(
                0,
                Math.floor(seconds)
            );

        updateTimerDisplay(cleanSeconds);

        if (cleanSeconds <= 0) {

            stopLocalTimer();

            if (tapButton) {
                tapButton.disabled = true;
            }

            if (tapMessage) {
                tapMessage.textContent =
                    "⏰ PARTIE TERMINÉE";
            }

            return;
        }

        startLocalTimer();
    }


    /* =========================================================
       💬 CHAT
       
       IMPORTANT :
       Cette protection fonctionne même si :
       - le message arrive en live
       - puis revient dans l'historique
       - le backend utilise un _id différent
       - le timestamp est différent
    ========================================================= */

    const receivedChatMessages =
        new Set();


    const receivedChatContent =
        new Set();


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


        const player =
            String(data.playerId || "")
                .trim();


        const sender =
            String(data.playerName || "Anonyme")
                .trim();


        const text =
            String(data.message || "")
                .trim();


        if (!text) {
            return;
        }


        /*
         * =====================================================
         * 1️⃣ PROTECTION PAR ID
         * =====================================================
         */

        if (data.id) {

            const idKey =
                "id:" +
                String(data.id);

            if (
                receivedChatMessages.has(idKey)
            ) {

                console.log(
                    "🛑 CHAT DOUBLON ID IGNORÉ :",
                    idKey
                );

                return;
            }

            receivedChatMessages.add(idKey);
        }


        /*
         * =====================================================
         * 2️⃣ PROTECTION PAR CONTENU
         *
         * C'est celle qui empêche le doublon
         * live + historique.
         * =====================================================
         */

        const normalizedText =
            normalizeChatText(text);

        const normalizedSender =
            normalizeChatText(sender);

        const contentKey =
            normalizedSender +
            "|" +
            normalizedText;


        /*
         * On garde les messages récents.
         */

        if (
            receivedChatContent.has(
                contentKey
            )
        ) {

            console.log(
                "🛑 CHAT DOUBLON CONTENU IGNORÉ :",
                contentKey
            );

            return;
        }


        receivedChatContent.add(
            contentKey
        );


        /*
         * Maximum 500 contenus.
         */

        if (
            receivedChatContent.size > 500
        ) {

            const first =
                receivedChatContent
                    .values()
                    .next()
                    .value;

            receivedChatContent.delete(
                first
            );
        }


        /*
         * =====================================================
         * 3️⃣ CRÉATION DOM SÉCURISÉE
         * =====================================================
         */

        const messageElement =
            document.createElement("div");

        messageElement.className =
            "chat-message";


        const strongTag =
            document.createElement("strong");

        strongTag.textContent =
            sender + ": ";


        const textNode =
            document.createTextNode(text);


        messageElement.appendChild(
            strongTag
        );

        messageElement.appendChild(
            textNode
        );


        chatMessages.appendChild(
            messageElement
        );


        /*
         * Maximum 100 messages affichés.
         */

        while (
            chatMessages.children.length > 100
        ) {

            chatMessages.removeChild(
                chatMessages.firstChild
            );
        }


        chatMessages.scrollTop =
            chatMessages.scrollHeight;


        console.log(
            "💬 CHAT AFFICHÉ UNE FOIS :",
            sender,
            text
        );
    }


    /* =========================================================
       💬 ENVOI CHAT
    ========================================================= */

    let lastSentMessage = "";
    let lastSentMessageTime = 0;


    function sendChatMessage() {

        if (!chatInput) {
            return;
        }


        const text =
            chatInput.value.trim();


        if (!text) {
            return;
        }


        if (text.length > 200) {

            if (tapMessage) {
                tapMessage.textContent =
                    "⚠️ Message trop long.";
            }

            return;
        }


        if (
            !socket ||
            !socket.connected
        ) {

            if (tapMessage) {
                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }

            return;
        }


        /*
         * Empêche double clic / double envoi
         * extrêmement rapide.
         */

        const now = Date.now();

        if (
            text === lastSentMessage &&
            now - lastSentMessageTime < 1200
        ) {

            console.log(
                "🛑 Double envoi chat bloqué."
            );

            return;
        }


        lastSentMessage = text;
        lastSentMessageTime = now;


        const messageData = {

            playerId:
                playerId,

            playerName:
                playerName,

            message:
                text
        };


        console.log(
            "📤 CHAT ENVOYÉ UNE FOIS :",
            messageData
        );


        socket.emit(
            "chatMessage",
            messageData
        );


        chatInput.value = "";

        chatInput.focus();
    }


    if (chatSend) {

        chatSend.addEventListener(
            "click",
            sendChatMessage,
            {
                once: true
            }
        );
    }


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
       MENU
    ========================================================= */

    function openSideMenu() {

        if (!sideMenu) {
            return;
        }

        sideMenu.classList.add("show");

        if (menuOverlay) {
            menuOverlay.classList.add("show");
        }

        document.body.style.overflow =
            "hidden";
    }


    function closeSideMenu() {

        if (sideMenu) {
            sideMenu.classList.remove("show");
        }

        if (menuOverlay) {
            menuOverlay.classList.remove("show");
        }

        document.body.style.overflow = "";
    }


    if (menuButton) {
        menuButton.addEventListener(
            "click",
            openSideMenu
        );
    }


    if (closeMenu) {
        closeMenu.addEventListener(
            "click",
            closeSideMenu
        );
    }


    if (menuOverlay) {
        menuOverlay.addEventListener(
            "click",
            closeSideMenu
        );
    }


    /* =========================================================
       MODAL
    ========================================================= */

    function openModal(title, content) {

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

        dynamicModal.classList.add("show");
    }


    function closeModal() {

        if (dynamicModal) {
            dynamicModal.classList.remove("show");
        }
    }


    if (closeDynamicModal) {
        closeDynamicModal.addEventListener(
            "click",
            closeModal
        );
    }


    if (dynamicModal) {

        dynamicModal.addEventListener(
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
    }


    /* =========================================================
       BOUTONS MENU
    ========================================================= */

    const menuGamesBtn =
        document.getElementById("menuGamesBtn");

    const menuRankingsBtn =
        document.getElementById("menuRankingsBtn");

    const menuGainsBtn =
        document.getElementById("menuGainsBtn");

    const menuWithdrawalsBtn =
        document.getElementById("menuWithdrawalsBtn");

    const menuReferralBtn =
        document.getElementById("menuReferralBtn");

    const menuChatBtn =
        document.getElementById("menuChatBtn");

    const menuRulesBtn =
        document.getElementById("menuRulesBtn");


    if (menuGamesBtn) {

        menuGamesBtn.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "🎮 Mes parties",
                    `
                    <p>
                        Tes parties seront
                        affichées ici.
                    </p>
                    `
                );
            }
        );
    }


    if (menuRankingsBtn) {

        menuRankingsBtn.addEventListener(
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
    }


    if (menuGainsBtn) {

        menuGainsBtn.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "💰 Mes gains",
                    `
                    <p>
                        Tes gains apparaîtront
                        ici lorsque le système
                        de paiement sera actif.
                    </p>
                    `
                );
            }
        );
    }


    if (menuWithdrawalsBtn) {

        menuWithdrawalsBtn.addEventListener(
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
    }


    if (menuReferralBtn) {

        menuReferralBtn.addEventListener(
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
    }


    if (menuChatBtn) {

        menuChatBtn.addEventListener(
            "click",
            () => {

                closeSideMenu();

                document
                    .querySelector(".chat-section")
                    ?.scrollIntoView({
                        behavior: "smooth"
                    });

                setTimeout(() => {

                    if (chatInput) {
                        chatInput.focus();
                    }

                }, 500);
            }
        );
    }


    if (menuRulesBtn) {

        menuRulesBtn.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "📜 Règles Miltape",
                    `
                    <p>
                        ⏱️ Une partie dure
                        10 minutes.
                    </p>

                    <p>
                        🏆 Les 5 meilleurs
                        joueurs sont classés.
                    </p>

                    <p>
                        🪙 Les mises utilisent
                        USDT TRC20.
                    </p>
                    `
                );
            }
        );
    }


    /* =========================================================
       WALLET
    ========================================================= */

    async function handleWalletAction() {

        try {

            if (
                window.tronWeb &&
                window.tronWeb.ready
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

                await navigator.clipboard
                    .writeText(
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
                "❌ Erreur wallet :",
                error
            );

            alert(
                "Adresse USDT TRC20 :\n\n" +
                USDT_TRON_ADDRESS
            );
        }
    }


    const walletButton =
        document.getElementById("walletButton");


    if (walletButton) {

        walletButton.addEventListener(
            "click",
            handleWalletAction
        );
    }


    const walletConnectBtn =
        document.querySelector(
            ".btn-wallet, #chooseWalletBtn"
        );


    if (
        walletConnectBtn &&
        walletConnectBtn !== walletButton
    ) {

        walletConnectBtn.addEventListener(
            "click",
            handleWalletAction
        );
    }


    const addressCopyBox =
        document.querySelector(
            ".address-box, #tronAddressDisplay"
        );


    if (addressCopyBox) {

        addressCopyBox.style.cursor =
            "pointer";

        addressCopyBox.addEventListener(
            "click",
            handleWalletAction
        );
    }


    /* =========================================================
       SOCKET.IO — CHARGEMENT UNIQUE
    ========================================================= */

    function loadSocketIO() {

        return new Promise(
            (resolve, reject) => {

                if (
                    typeof window.io ===
                    "function"
                ) {

                    resolve(window.io);

                    return;
                }


                const existing =
                    document.querySelector(
                        'script[data-miltape-socket]'
                    );


                if (existing) {

                    const check =
                        setInterval(() => {

                            if (
                                typeof window.io ===
                                "function"
                            ) {

                                clearInterval(check);

                                resolve(window.io);
                            }

                        }, 100);


                    setTimeout(() => {

                        clearInterval(check);

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
                    BACKEND_URL +
                    "/socket.io/socket.io.js";


                script.async = true;


                script.dataset.miltapeSocket =
                    "true";


                script.onload = () => {

                    if (
                        typeof window.io ===
                        "function"
                    ) {

                        resolve(window.io);

                    } else {

                        reject(
                            new Error(
                                "Socket.IO chargé mais io absent"
                            )
                        );
                    }
                };


                script.onerror = () => {

                    reject(
                        new Error(
                            "Impossible de charger Socket.IO"
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
       🔌 CONNEXION SOCKET UNIQUE
    ========================================================= */

    async function connectSocket() {

        /*
         * Sécurité supplémentaire :
         * impossible de créer deux sockets.
         */

        if (
            socket &&
            (
                socket.connected ||
                socket.connecting
            )
        ) {

            console.log(
                "🛑 Socket déjà actif."
            );

            return;
        }


        try {

            const io =
                await loadSocketIO();


            /*
             * Vérification encore une fois
             * après le chargement.
             */

            if (socket) {

                console.log(
                    "🛑 Socket déjà créé."
                );

                return;
            }


            console.log(
                "🔌 Création Socket.IO unique..."
            );


            socket =
                io(
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

                        timeout: 20000
                    }
                );


            setupSocketEvents();

        } catch (error) {

            console.error(
                "❌ Socket.IO :",
                error
            );

            socketReady = false;

            if (tapMessage) {
                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }

            startLocalTimer();
        }
    }


    /* =========================================================
       SOCKET EVENTS
    ========================================================= */

    function setupSocketEvents() {

        if (!socket) {
            return;
        }


        /*
         * Protection supplémentaire.
         */

        if (socketEventsConfigured) {
            return;
        }

        socketEventsConfigured = true;


        /* =====================================================
           CONNEXION
        ===================================================== */

        socket.on(
            "connect",
            () => {

                socketReady = true;

                console.log(
                    "✅ CONNECTÉ AU SERVEUR :",
                    socket.id
                );


                if (tapMessage) {

                    tapMessage.textContent =
                        "🔥 À TOI DE TAPPER !";
                }


                socket.emit(
                    "join",
                    {
                        playerId,
                        playerName
                    }
                );


                socket.emit(
                    "getGame"
                );


                socket.emit(
                    "getLeaderboard"
                );


                startLocalTimer();
            }
        );


        /* =====================================================
           DÉCONNEXION
        ===================================================== */

        socket.on(
            "disconnect",
            (reason) => {

                socketReady = false;

                console.warn(
                    "⚠️ Socket déconnecté :",
                    reason
                );

                if (tapMessage) {

                    tapMessage.textContent =
                        "🟠 Reconnexion au serveur...";
                }

                startLocalTimer();
            }
        );


        /* =====================================================
           ERREUR
        ===================================================== */

        socket.on(
            "connect_error",
            (error) => {

                socketReady = false;

                console.error(
                    "❌ Socket erreur :",
                    error
                );

                if (tapMessage) {

                    tapMessage.textContent =
                        "🟠 Connexion au serveur...";
                }

                startLocalTimer();
            }
        );


        /* =====================================================
           NOUVELLE PARTIE
        ===================================================== */

        function handleNewGame(data) {

            console.log(
                "🎮 NOUVELLE PARTIE :",
                data
            );


            localTaps = 0;

            updateScoreDisplays(0);


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


                if (
                    !Number.isFinite(duration) ||
                    duration <= 0
                ) {

                    duration =
                        GAME_DURATION;
                }
            }


            resetLocalTimer(duration);


            if (tapButton) {

                tapButton.disabled = false;
            }


            if (tapMessage) {

                tapMessage.textContent =
                    "🔥 NOUVELLE PARTIE !";
            }


            /*
             * IMPORTANT :
             * On ne vide PAS le chat.
             *
             * On vide seulement les clés
             * d'anti-doublon.
             */

            receivedChatMessages.clear();
            receivedChatContent.clear();


            startLocalTimer();
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
           TIMER
        ===================================================== */

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
           ONLINE
        ===================================================== */

        function updateOnlineCount(data) {

            let count = data;

            if (
                typeof data === "object" &&
                data !== null
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
                            box-shadow:0 0 8px #2ecc71;
                        "
                    ></span>

                    <span>
                        ${count} EN LIGNE
                    </span>
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
           CLASSEMENT
        ===================================================== */

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
                                p.id;


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
                                                ? `<strong>(toi)</strong>`
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
           💬 CHAT
           
           UN SEUL EVENT LIVE.
           
           NE PAS AJOUTER :
           chat:message
           chat
           message
           
           sinon risque de doublon.
        ===================================================== */

        socket.on(
            "chatMessage",
            receiveChatMessage
        );


        /* =====================================================
           💬 HISTORIQUE CHAT
        ===================================================== */

        socket.on(
            "chatHistory",
            (messages) => {

                if (
                    !Array.isArray(messages)
                ) {
                    return;
                }


                console.log(
                    "📚 Historique reçu :",
                    messages.length
                );


                messages.forEach(
                    receiveChatMessage
                );
            }
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
                data.totalTaps;


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
           TOTAL STAKES
        ===================================================== */

        function updateTotalStakes(data) {

            let total = data;

            if (
                typeof data === "object" &&
                data !== null
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
    }


    /* =========================================================
       ⚡ BOUTON TAP
       
       UNE SEULE ÉMISSION.
       
       Pas de +1 local.
    ========================================================= */

    let tapLocked = false;


    if (tapButton) {

        tapButton.addEventListener(
            "click",
            () => {

                if (
                    currentTimer <= 0
                ) {
                    return;
                }


                if (
                    !socket ||
                    !socket.connected
                ) {

                    console.warn(
                        "⚠️ Tap : serveur non connecté."
                    );

                    return;
                }


                /*
                 * Protection contre double clic
                 * accidentel sur le même événement.
                 */

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
       CONDITIONS
    ========================================================= */

    window.toggleConditions =
        function () {

            const content =
                document.getElementById(
                    "conditions-content"
                );


            const arrow =
                document.getElementById(
                    "arrow-icon"
                );


            if (
                !content ||
                !arrow
            ) {
                return;
            }


            content.classList.toggle(
                "open"
            );


            if (
                content.classList.contains(
                    "open"
                )
            ) {

                arrow.style.transform =
                    "rotate(180deg)";

            } else {

                arrow.style.transform =
                    "rotate(0deg)";
            }
        };


    /* =========================================================
       PWA
    ========================================================= */

    const installButton =
        document.getElementById(
            "installPwaButton"
        );


    window.addEventListener(
        "beforeinstallprompt",
        (event) => {

            event.preventDefault();

            deferredPrompt = event;


            if (installButton) {

                installButton.classList.add(
                    "show"
                );
            }
        }
    );


    if (installButton) {

        installButton.addEventListener(
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
                        "Installation PWA :",
                        error
                    );
                }


                deferredPrompt = null;

                installButton.classList.remove(
                    "show"
                );
            }
        );
    }


    /* =========================================================
       💰 MISE
    ========================================================= */

    function setBet(value) {

        const amount =
            Number(value) || 0;


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

        setBet(savedBet);
    }


    /* =========================================================
       ÉTAT INITIAL
    ========================================================= */

    updateScoreDisplays(0);

    updateTimerDisplay(
        GAME_DURATION
    );


    if (tapButton) {

        tapButton.disabled = true;
    }


    /* =========================================================
       CONNEXION BACKEND
    ========================================================= */

    connectSocket();


    /* =========================================================
       FALLBACK CHRONO
    ========================================================= */

    setTimeout(
        () => {

            if (
                currentTimer > 0 &&
                !timerRunning
            ) {

                console.log(
                    "⏱️ Fallback chrono local activé."
                );

                startLocalTimer();
            }

        },
        1500
    );


    /* =========================================================
       AUTORISATION TAP APRÈS CONNEXION
    ========================================================= */

    const connectionCheck =
        setInterval(
            () => {

                if (
                    socket &&
                    socket.connected
                ) {

                    socketReady = true;


                    if (
                        currentTimer > 0 &&
                        tapButton
                    ) {

                        tapButton.disabled =
                            false;
                    }


                    clearInterval(
                        connectionCheck
                    );
                }

            },
            500
        );


    /* =========================================================
       LOG FINAL
    ========================================================= */

    console.log(
        "✅ MILTAPE CHARGÉ UNE SEULE FOIS."
    );

    console.log(
        "🔌 Socket unique."
    );

    console.log(
        "💬 Chat anti-doublon actif."
    );

    console.log(
        "⏱️ Chrono :",
        formatTime(currentTimer)
    );

});
