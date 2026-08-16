document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       MILTAPE WORLD CHALLENGE
       SCRIPT FRONTEND COMPLET
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

    console.log(
        "🌐 Backend :",
        BACKEND_URL
    );


    /* =========================================================
       VARIABLES DU JEU
    ========================================================= */

    let socket = null;

    let localTaps = 0;

    let currentTimer = GAME_DURATION;

    let timerInterval = null;

    let timerRunning = false;

    let socketReady = false;

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
        document.getElementById(
            "leaderboardList"
        );

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );

    const displayBet =
        document.getElementById(
            "displayBet"
        );

    const globalTotalStakes =
        document.getElementById(
            "globalTotalStakes"
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
                formatTime(currentTimer);
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
       CHRONO LOCAL
    ========================================================= */

    function startLocalTimer() {

        if (timerRunning) {
            return;
        }

        timerRunning = true;

        clearInterval(timerInterval);

        timerInterval =
            setInterval(() => {

                if (currentTimer > 0) {

                    currentTimer--;

                    updateTimerDisplay(
                        currentTimer
                    );

                } else {

                    clearInterval(
                        timerInterval
                    );

                    timerRunning = false;

                    if (tapButton) {

                        tapButton.disabled =
                            true;
                    }

                    if (tapMessage) {

                        tapMessage.textContent =
                            "⏰ PARTIE TERMINÉE";
                    }
                }

            }, 1000);
    }


    function stopLocalTimer() {

        clearInterval(
            timerInterval
        );

        timerInterval = null;

        timerRunning = false;
    }


    function resetLocalTimer() {

        stopLocalTimer();

        updateTimerDisplay(
            GAME_DURATION
        );
    }


    /* =========================================================
       INITIALISATION CHRONO
    ========================================================= */

    updateTimerDisplay(
        GAME_DURATION
    );


    /* =========================================================
       MENU LATERAL
    ========================================================= */

    function openSideMenu() {

        if (!sideMenu) {
            return;
        }

        sideMenu.classList.add("show");

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
       MODAL DYNAMIQUE
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
       BOUTONS DU MENU
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
                            ${escapeHTML(
                                playerId
                            )}
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
                        behavior: "smooth"
                    });
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
       CHARGEMENT AUTOMATIQUE SOCKET.IO
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

                script.async = true;

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
       CONNEXION SOCKET
    ========================================================= */

    async function connectSocket() {

        try {

            const io =
                await loadSocketIO();


            console.log(
                "🔌 Socket.IO disponible"
            );


            socket = io(
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
                "❌ Socket.IO :",
                error
            );

            socketReady = false;

            if (tapMessage) {

                tapMessage.textContent =
                    "🟠 Connexion au serveur...";
            }

            /*
             * On démarre quand même
             * le chrono local.
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


        socket.on(
            "connect",
            () => {

                socketReady = true;

                console.log(
                    "✅ Connecté à Miltape !",
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
                 * Demande éventuelle
                 * des données au serveur.
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
                 * Le chrono local continue
                 * entre les événements serveur.
                 */

                startLocalTimer();
            }
        );


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

                /*
                 * Le jeu continue visuellement
                 * pendant la reconnexion.
                 */

                startLocalTimer();
            }
        );


        socket.on(
            "connect_error",
            (error) => {

                socketReady = false;

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

        socket.on(
            "newGame",
            handleNewGame
        );

        socket.on(
            "game:new",
            handleNewGame
        );


        function handleNewGame(data) {

            console.log(
                "🎮 Nouvelle partie",
                data
            );

            localTaps = 0;

            updateScoreDisplays(
                0
            );

            updateTimerDisplay(
                GAME_DURATION
            );

            startLocalTimer();

            if (tapButton) {

                tapButton.disabled =
                    false;
            }

            if (tapMessage) {

                tapMessage.textContent =
                    "🔥 NOUVELLE PARTIE !";
            }
        }


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


        function handleServerTimer(timeLeft) {

            let value =
                timeLeft;


            /*
             * Certains backends envoient :
             * { timeLeft: 500 }
             */

            if (
                typeof timeLeft ===
                "object"
            ) {

                value =
                    timeLeft.timeLeft ??
                    timeLeft.seconds ??
                    timeLeft.remaining ??
                    timeLeft.timer;
            }


            const seconds =
                Number(value);


            if (
                Number.isFinite(seconds)
            ) {

                updateTimerDisplay(
                    seconds
                );

                /*
                 * Si serveur dit 0,
                 * on arrête.
                 */

                if (seconds <= 0) {

                    stopLocalTimer();

                    if (tapButton) {

                        tapButton.disabled =
                            true;
                    }

                    if (tapMessage) {

                        tapMessage.textContent =
                            "⏰ PARTIE TERMINÉE";
                    }

                } else {

                    /*
                     * Le serveur nous donne
                     * la vraie valeur.
                     * Le compteur local continue.
                     */

                    startLocalTimer();
                }
            }
        }


        /* =====================================================
           JOUEURS EN LIGNE
        ===================================================== */

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


        function updateOnlineCount(data) {

            let count =
                data;


            if (
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


        /* =====================================================
           CLASSEMENT
        ===================================================== */

        socket.on(
            "leaderboard",
            updateLeaderboard
        );

        socket.on(
            "leaderboard:update",
            updateLeaderboard
        );


        function updateLeaderboard(
            players
        ) {

            if (!leaderboardList) {
                return;
            }


            /*
             * Certains serveurs envoient :
             * { players: [...] }
             */

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


            /*
             * Trie du plus grand score
             * vers le plus petit.
             */

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
            "message",
            receiveChatMessage
        );


        function receiveChatMessage(
            msg
        ) {

            if (!chatMessages) {
                return;
            }


            if (
                typeof msg ===
                "string"
            ) {

                msg = {
                    message: msg
                };
            }


            const senderName =
                msg.playerName ??
                msg.name ??
                msg.username ??
                "Anonyme";


            const messageText =
                msg.message ??
                msg.text ??
                msg.content ??
                "";


            if (!messageText) {
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
                senderName +
                ": ";


            const textNode =
                document.createTextNode(
                    messageText
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
             * Limite le chat à 100 messages
             * pour éviter de ralentir le téléphone.
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
        }


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

                messages.forEach(
                    receiveChatMessage
                );
            }
        );


        /* =====================================================
           TAP CONFIRMATION
        ===================================================== */

        socket.on(
            "tapResult",
            handleTapResult
        );

        socket.on(
            "tap:result",
            handleTapResult
        );


        function handleTapResult(
            data
        ) {

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

        socket.on(
            "totalStakes",
            updateTotalStakes
        );

        socket.on(
            "stakes:update",
            updateTotalStakes
        );


        function updateTotalStakes(
            data
        ) {

            let total =
                data;


            if (
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
                    total;
            }
        }
    }


    /* =========================================================
       BOUTON TAP
    ========================================================= */

    if (tapButton) {

        tapButton.addEventListener(
            "click",
            () => {

                /*
                 * Ne pas permettre de taper
                 * après la fin.
                 */

                if (
                    currentTimer <= 0
                ) {

                    return;
                }


                localTaps++;

                updateScoreDisplays(
                    localTaps
                );


                /*
                 * Animation.
                 */

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


                /*
                 * Envoi serveur.
                 */

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

                            taps: 1
                        }
                    );

                } else {

                    console.warn(
                        "⚠️ Tap local : serveur non connecté"
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
       INSTALLATION PWA
    ========================================================= */

    const installButton =
        document.getElementById(
            "installPwaButton"
        );

    let deferredPrompt = null;


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


                deferredPrompt = null;

                installButton.classList.remove(
                    "show"
                );
            }
        );
    }


    /* =========================================================
       CHANGEMENT DE MISE
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


    /*
     * Le bouton TAP reste désactivé
     * jusqu'à connexion du serveur.
     */

    if (tapButton) {

        tapButton.disabled =
            true;
    }


    /* =========================================================
       CONNEXION AU BACKEND
    ========================================================= */

    connectSocket();


    /* =========================================================
       AUTORISER LE TAP APRÈS CONNEXION
    ========================================================= */

    const originalConnectHandler =
        setInterval(
            () => {

                if (
                    socket &&
                    socket.connected
                ) {

                    if (
                        currentTimer > 0 &&
                        tapButton
                    ) {

                        tapButton.disabled =
                            false;
                    }

                    clearInterval(
                        originalConnectHandler
                    );
                }

            },
            500
        );


    /* =========================================================
       FALLBACK : CHRONO LOCAL
    ========================================================= */

    /*
     * Si Socket.IO ne répond pas après quelques
     * secondes, le chrono visuel démarre quand même.
     */

    setTimeout(
        () => {

            if (!timerRunning) {

                startLocalTimer();
            }

        },
        3000
    );


    console.log(
        "✅ Script Miltape chargé correctement"
    );

});
