document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       MILTAPE WORLD CHALLENGE
       SCRIPT FRONTEND COMPLET
       CORRECTION : CHRONO + CHAT + SOCKET.IO
    ========================================================= */

    console.log("🚀 Miltape : initialisation...");


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


    console.log("🌐 Backend :", BACKEND_URL);


    /* =========================================================
       VARIABLES
    ========================================================= */

    let socket = null;

    let socketReady = false;

    let localTaps = 0;

    let currentTimer = GAME_DURATION;

    let timerInterval = null;

    let timerRunning = false;

    let lastServerTimer = null;

    let lastServerTimerAt = 0;

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
       CHRONO LOCAL DE SECOURS
       
       IMPORTANT :
       Le chrono utilise Date.now() au lieu de dépendre
       uniquement de setInterval().
       
       Ainsi, si le téléphone ralentit ou si le navigateur
       espace les intervalles, le calcul reste correct.
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
                        (now - lastTick) / 1000
                    );


                if (elapsed <= 0) {
                    return;
                }


                lastTick =
                    now;


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

                        tapButton.disabled =
                            true;
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

            clearInterval(
                timerInterval
            );
        }

        timerInterval = null;

        timerRunning = false;
    }


    function resetLocalTimer(seconds = GAME_DURATION) {

        stopLocalTimer();

        updateTimerDisplay(
            seconds
        );
    }


    /* =========================================================
       CHRONO SERVEUR
       
       Le serveur reste prioritaire.
       Le chrono local reprend entre deux messages serveur.
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


        const seconds =
            Number(value);


        if (
            !Number.isFinite(seconds)
        ) {

            console.warn(
                "⚠️ Timer reçu mais valeur invalide :",
                data
            );

            return;
        }


        const cleanSeconds =
            Math.max(
                0,
                Math.floor(seconds)
            );


        lastServerTimer =
            cleanSeconds;

        lastServerTimerAt =
            Date.now();


        updateTimerDisplay(
            cleanSeconds
        );


        console.log(
            "⏱️ Timer serveur :",
            cleanSeconds
        );


        if (cleanSeconds <= 0) {

            stopLocalTimer();


            if (tapButton) {

                tapButton.disabled =
                    true;
            }


            if (tapMessage) {

                tapMessage.textContent =
                    "⏰ PARTIE TERMINÉE";
            }


            return;
        }


        /*
         * Le serveur vient de nous donner
         * la vraie valeur.
         *
         * Le chrono local continue ensuite.
         */

        startLocalTimer();
    }


    /* =========================================================
       CHAT
       
       Ton HTML actuel contient seulement :
       #chatMessages
       
       Il n'a pas de champ de saisie.
       
       On crée donc automatiquement :
       - input
       - bouton ENVOYER
    ========================================================= */

    let chatInput =
        document.getElementById("chatInput");

    let chatSend =
        document.getElementById("chatSend");


    function createChatControls() {

        if (!chatMessages) {

            console.warn(
                "⚠️ #chatMessages introuvable."
            );

            return;
        }


        const chatSection =
            chatMessages.closest(
                ".chat-section"
            );


        if (!chatSection) {
            return;
        }


        /*
         * Si les contrôles existent déjà,
         * on ne crée rien.
         */

        if (
            chatInput &&
            chatSend
        ) {

            return;
        }


        const controls =
            document.createElement("div");


        controls.id =
            "miltapeChatControls";


        controls.style.cssText = `
            display:flex;
            gap:8px;
            margin-top:10px;
            width:100%;
            box-sizing:border-box;
        `;


        chatInput =
            document.createElement("input");


        chatInput.id =
            "chatInput";


        chatInput.type =
            "text";


        chatInput.placeholder =
            "Écris ton message...";


        chatInput.maxLength =
            300;


        chatInput.autocomplete =
            "off";


        chatInput.style.cssText = `
            flex:1;
            min-width:0;
            box-sizing:border-box;
            padding:12px;
            border-radius:10px;
            border:1px solid rgba(255,204,0,.35);
            background:#120624;
            color:#fff;
            outline:none;
            font-size:14px;
        `;


        chatSend =
            document.createElement("button");


        chatSend.id =
            "chatSend";


        chatSend.type =
            "button";


        chatSend.textContent =
            "ENVOYER";


        chatSend.style.cssText = `
            flex-shrink:0;
            padding:12px 14px;
            border:none;
            border-radius:10px;
            background:#ffcc00;
            color:#120624;
            font-weight:900;
            cursor:pointer;
        `;


        controls.appendChild(
            chatInput
        );


        controls.appendChild(
            chatSend
        );


        chatSection.appendChild(
            controls
        );


        console.log(
            "💬 Zone de saisie du chat créée."
        );
    }


    createChatControls();


    /* =========================================================
       ENVOI CHAT
    ========================================================= */

    function sendChatMessage() {

        if (!chatInput) {
            return;
        }


        const text =
            chatInput.value.trim();


        if (!text) {
            return;
        }


        if (
            !socket ||
            !socket.connected
        ) {

            console.warn(
                "⚠️ Chat : serveur non connecté."
            );


            if (tapMessage) {

                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }


            return;
        }


        const messageData = {

            playerId:
                playerId,

            playerName:
                playerName,

            message:
                text
        };


        console.log(
            "💬 Envoi message :",
            messageData
        );


        /*
         * Événement principal.
         */

        socket.emit(
            "chatMessage",
            messageData
        );


        /*
         * On vide immédiatement
         * la zone de saisie.
         */

        chatInput.value =
            "";


        chatInput.focus();
    }


    if (chatSend) {

        chatSend.addEventListener(
            "click",
            sendChatMessage
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
       AFFICHAGE MESSAGE CHAT
    ========================================================= */

    function receiveChatMessage(msg) {

        if (!chatMessages) {
            return;
        }


        if (
            typeof msg === "string"
        ) {

            msg = {
                message: msg
            };
        }


        if (
            !msg ||
            typeof msg !== "object"
        ) {

            return;
        }


        const senderName =
            msg.playerName ??
            msg.name ??
            msg.username ??
            msg.senderName ??
            "Anonyme";


        const messageText =
            msg.message ??
            msg.text ??
            msg.content ??
            msg.msg ??
            "";


        if (
            String(messageText).trim() === ""
        ) {

            return;
        }


        const messageElement =
            document.createElement(
                "div"
            );


        messageElement.className =
            "chat-message";


        const strongTag =
            document.createElement(
                "strong"
            );


        strongTag.textContent =
            String(senderName) +
            ": ";


        const textNode =
            document.createTextNode(
                String(messageText)
            );


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
         * Maximum 100 messages.
         */

        while (
            chatMessages.children.length >
            100
        ) {

            chatMessages.removeChild(
                chatMessages.firstChild
            );
        }


        chatMessages.scrollTop =
            chatMessages.scrollHeight;


        console.log(
            "💬 Message reçu :",
            senderName,
            messageText
        );
    }


    /* =========================================================
       MENU
    ========================================================= */

    function openSideMenu() {

        if (!sideMenu) {
            return;
        }


        sideMenu.classList.add(
            "show"
        );


        if (menuOverlay) {

            menuOverlay.classList.add(
                "show"
            );
        }


        document.body.style.overflow =
            "hidden";
    }


    function closeSideMenu() {

        if (sideMenu) {

            sideMenu.classList.remove(
                "show"
            );
        }


        if (menuOverlay) {

            menuOverlay.classList.remove(
                "show"
            );
        }


        document.body.style.overflow =
            "";
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

        if (dynamicModal) {

            dynamicModal.classList.remove(
                "show"
            );
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
                    .querySelector(
                        ".leaderboard"
                    )
                    ?.scrollIntoView({
                        behavior:
                            "smooth"
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
                    .querySelector(
                        ".chat-section"
                    )
                    ?.scrollIntoView({
                        behavior:
                            "smooth"
                    });


                setTimeout(
                    () => {

                        if (chatInput) {

                            chatInput.focus();
                        }

                    },
                    500
                );
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
                "Erreur wallet :",
                error
            );


            alert(
                "Adresse USDT TRC20 :\n\n" +
                USDT_TRON_ADDRESS
            );
        }
    }


    const walletButton =
        document.getElementById(
            "walletButton"
        );


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


    if (walletConnectBtn) {

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
       SOCKET.IO
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
                        'script[data-miltape-socket]'
                    );


                if (existing) {

                    existing.addEventListener(
                        "load",
                        () => {

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
                                        "Socket.IO indisponible"
                                    )
                                );
                            }
                        }
                    );


                    existing.addEventListener(
                        "error",
                        reject
                    );


                    return;
                }


                const script =
                    document.createElement(
                        "script"
                    );


                script.src =
                    BACKEND_URL +
                    "/socket.io/socket.io.js";


                script.async =
                    true;


                script.dataset.miltapeSocket =
                    "true";


                script.onload =
                    () => {

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
                                    "Socket.IO chargé mais io absent"
                                )
                            );
                        }
                    };


                script.onerror =
                    () => {

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
       CONNEXION SOCKET
    ========================================================= */

    async function connectSocket() {

        try {

            const io =
                await loadSocketIO();


            console.log(
                "🔌 Socket.IO disponible"
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
                "❌ Socket.IO :",
                error
            );


            socketReady =
                false;


            if (tapMessage) {

                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }


            /*
             * Le chrono visuel fonctionne
             * même si Socket.IO échoue.
             */

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


        /* =====================================================
           CONNEXION
        ===================================================== */

        socket.on(
            "connect",
            () => {

                socketReady =
                    true;


                console.log(
                    "✅ CONNECTÉ AU SERVEUR !",
                    socket.id
                );


                if (tapMessage) {

                    tapMessage.textContent =
                        "🔥 À TOI DE TAPPER !";
                }


                socket.emit(
                    "join",
                    {
                        playerId:
                            playerId,

                        playerName:
                            playerName
                    }
                );


                /*
                 * Demandes compatibles
                 * avec plusieurs versions
                 * du backend.
                 */

                socket.emit(
                    "getGame"
                );


                socket.emit(
                    "game:get"
                );


                socket.emit(
                    "getLeaderboard"
                );


                /*
                 * IMPORTANT :
                 * le chrono local démarre
                 * pour ne pas rester bloqué
                 * si le backend n'envoie pas
                 * de timer.
                 */

                startLocalTimer();
            }
        );


        /* =====================================================
           DÉCONNEXION
        ===================================================== */

        socket.on(
            "disconnect",
            (reason) => {

                socketReady =
                    false;


                console.warn(
                    "⚠️ Socket déconnecté :",
                    reason
                );


                if (tapMessage) {

                    tapMessage.textContent =
                        "🟠 Reconnexion au serveur...";
                }


                /*
                 * Le chrono continue
                 * pendant la reconnexion.
                 */

                startLocalTimer();
            }
        );


        /* =====================================================
           ERREUR CONNEXION
        ===================================================== */

        socket.on(
            "connect_error",
            (error) => {

                socketReady =
                    false;


                console.error(
                    "❌ Erreur Socket.IO :",
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


            localTaps =
                0;


            updateScoreDisplays(
                0
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


                if (
                    !Number.isFinite(
                        duration
                    ) ||
                    duration <= 0
                ) {

                    duration =
                        GAME_DURATION;
                }
            }


            resetLocalTimer(
                duration
            );


            if (tapButton) {

                tapButton.disabled =
                    false;
            }


            if (tapMessage) {

                tapMessage.textContent =
                    "🔥 NOUVELLE PARTIE !";
            }


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
           TIMER SERVEUR
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

            let count =
                data;


            if (
                typeof data ===
                "object" &&
                data !== null
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

                onlineCount.innerHTML =
                    `
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

                leaderboardList.innerHTML =
                    `
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
            "chat",
            receiveChatMessage
        );


        socket.on(
            "message",
            receiveChatMessage
        );


        /* =====================================================
           HISTORIQUE CHAT
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
                    "💬 Historique chat :",
                    messages.length,
                    "messages"
                );


                messages.forEach(
                    receiveChatMessage
                );
            }
        );


        socket.on(
            "chat:history",
            (messages) => {

                if (
                    !Array.isArray(messages)
                ) {

                    return;
                }


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

            let total =
                data;


            if (
                typeof data ===
                "object" &&
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
                    "$" +
                    total;
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
       BOUTON TAP
    ========================================================= */

    if (tapButton) {

        tapButton.addEventListener(
            "click",
            () => {

                if (
                    currentTimer <= 0
                ) {

                    return;
                }


                localTaps++;


                updateScoreDisplays(
                    localTaps
                );


                tapButton.classList.add(
                    "tap-active"
                );


                setTimeout(
                    () => {

                        tapButton.classList.remove(
                            "tap-active"
                        );

                    },
                    80
                );


                if (
                    socket &&
                    socket.connected
                ) {

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

                } else {

                    console.warn(
                        "⚠️ Tap : serveur non connecté."
                    );
                }
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


    let deferredPrompt =
        null;


    window.addEventListener(
        "beforeinstallprompt",
        (event) => {

            event.preventDefault();

            deferredPrompt =
                event;


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


                deferredPrompt.prompt();


                try {

                    await deferredPrompt.userChoice;

                } catch (error) {

                    console.warn(
                        "Installation PWA :",
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
    }


    /* =========================================================
       MISE
    ========================================================= */

    function setBet(value) {

        const amount =
            Number(value) || 0;


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


    if (savedBet) {

        setBet(savedBet);
    }


    /* =========================================================
       ETAT INITIAL
    ========================================================= */

    updateScoreDisplays(
        0
    );


    updateTimerDisplay(
        GAME_DURATION
    );


    if (tapButton) {

        tapButton.disabled =
            true;
    }


    /* =========================================================
       CONNEXION BACKEND
    ========================================================= */

    connectSocket();


    /* =========================================================
       FALLBACK CHRONO
       
       Si aucun timer serveur n'arrive,
       le chrono local fonctionne quand même.
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

                    socketReady =
                        true;


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
        "✅ Script Miltape chargé."
    );

    console.log(
        "⏱️ Chrono initial :",
        formatTime(currentTimer)
    );

    console.log(
        "💬 Chat prêt."
    );

});
