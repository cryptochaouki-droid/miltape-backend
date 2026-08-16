document.addEventListener("DOMContentLoaded", () => {

    "use strict";

    /* =========================================================
       PROTECTION
    ========================================================= */

    if (window.__MILTAPE_INITIALIZED__) {
        console.warn("Miltape déjà initialisé.");
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

    let localTaps = 0;

    let currentTimer = GAME_DURATION;

    let timerInterval = null;

    let timerRunning = false;

    let gameJoined = false;

    let tapLocked = false;

    let selectedBet =
        Number(
            localStorage.getItem("miltape_bet") || 0
        );

    let deferredPrompt = null;

    let lastSentMessage = "";

    let lastSentMessageTime = 0;


    /* =========================================================
       IDENTITÉ
    ========================================================= */

    let playerId =
        localStorage.getItem(
            "miltape_player_id"
        );


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

    const displayBet =
        document.getElementById(
            "displayBet"
        );

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


    function setMessage(text) {

        if (tapMessage) {

            tapMessage.textContent =
                text;
        }
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

        localTaps =
            Math.max(
                0,
                Number(value) || 0
            );


        if (tapCountDisplay) {

            tapCountDisplay.textContent =
                localTaps;
        }


        if (tapButtonCountDisplay) {

            tapButtonCountDisplay.textContent =
                localTaps;
        }


        const headerScore =
            document.getElementById(
                "headerScore"
            );


        if (headerScore) {

            headerScore.textContent =
                localTaps;
        }


        const statTaps =
            document.getElementById(
                "statTaps"
            );


        if (statTaps) {

            statTaps.textContent =
                localTaps;
        }


        const statTotal =
            document.getElementById(
                "statTotal"
            );


        if (statTotal) {

            statTotal.textContent =
                localTaps;
        }
    }


    /* =========================================================
       MODAL
    ========================================================= */

    const dynamicModal =
        document.getElementById(
            "dynamicModal"
        );

    const dynamicModalTitle =
        document.getElementById(
            "dynamicModalTitle"
        );

    const dynamicModalBody =
        document.getElementById(
            "dynamicModalBody"
        );

    const closeDynamicModal =
        document.getElementById(
            "closeDynamicModal"
        );


    function openModal(
        title,
        content
    ) {

        console.log(
            "📂 OUVERTURE MODAL :",
            title
        );


        if (!dynamicModal) {

            console.error(
                "❌ dynamicModal introuvable dans index.html"
            );

            alert(
                title +
                "\n\n" +
                "Impossible d'afficher la fenêtre."
            );

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


        dynamicModal.style.display =
            "flex";
    }


    function closeModal() {

        if (!dynamicModal) {
            return;
        }


        dynamicModal.classList.remove(
            "show"
        );


        dynamicModal.style.display =
            "none";
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
       💰 MISE
    ========================================================= */

    function setBet(value) {

        selectedBet =
            Number(value) || 0;


        localStorage.setItem(
            "miltape_bet",
            String(selectedBet)
        );


        if (displayBet) {

            displayBet.textContent =
                "$" + selectedBet;
        }
    }


    if (selectedBet > 0) {

        setBet(
            selectedBet
        );

    } else {

        if (displayBet) {

            displayBet.textContent =
                "$0";
        }
    }


    /* =========================================================
       💰 WALLET
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

        if (
            !isTronLinkAvailable()
        ) {

            return "";
        }


        return (
            window.tronWeb
                .defaultAddress
                .base58 ||
            ""
        );
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

            alert(
                "Adresse USDT TRC20 :\n\n" +
                USDT_TRON_ADDRESS
            );
        }
    }


    /* =========================================================
       💰 OUVRIR WALLET
    ========================================================= */

    function openWalletChoice() {

        console.log(
            "💰 OUVERTURE WALLET"
        );


        const connectedAddress =
            getConnectedTronAddress();


        const connectedHTML =
            connectedAddress
                ? `
                    <div style="
                        padding:12px;
                        margin-bottom:12px;
                        border-radius:12px;
                        background:rgba(46,204,113,.10);
                        border:1px solid rgba(46,204,113,.35);
                        color:#fff;
                        font-size:12px;
                        word-break:break-all;
                    ">

                        <strong style="
                            color:#2ecc71;
                        ">
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


            <p style="
                color:#ddd;
                line-height:1.5;
            ">
                Choisis ta mise pour entrer
                dans le challenge.
            </p>


            <div style="
                display:grid;
                grid-template-columns:repeat(2,1fr);
                gap:10px;
                margin-top:15px;
            ">

                ${[
                    1,
                    2,
                    5,
                    10,
                    20,
                    50,
                    100
                ].map(
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
                                font-size:15px;
                                cursor:pointer;
                            "
                        >
                            $${amount}
                        </button>
                    `
                ).join("")}

            </div>


            ${
                selectedBet > 0
                    ? `
                        <div style="
                            margin-top:15px;
                            padding:12px;
                            text-align:center;
                            border-radius:12px;
                            border:1px solid #2ecc71;
                            background:rgba(46,204,113,.08);
                            color:#2ecc71;
                            font-weight:900;
                        ">
                            💰 MISE : $${selectedBet}
                        </div>
                    `
                    : ""
            }


            <button
                type="button"
                id="miltapeTronLink"
                style="
                    width:100%;
                    padding:15px;
                    margin-top:15px;
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


            <div style="
                margin-top:15px;
                padding:12px;
                border-radius:10px;
                background:rgba(255,255,255,.04);
                color:#aaa;
                font-size:11px;
                word-break:break-all;
            ">

                <strong style="
                    color:#ffcc00;
                ">
                    Adresse USDT TRC20 :
                </strong>

                <br><br>

                ${USDT_TRON_ADDRESS}

            </div>


            <button
                type="button"
                id="miltapeContinue"
                style="
                    width:100%;
                    padding:16px;
                    margin-top:15px;
                    border:0;
                    border-radius:13px;
                    background:linear-gradient(
                        135deg,
                        #2ecc71,
                        #16a085
                    );
                    color:#07150e;
                    font-weight:900;
                    font-size:15px;
                    cursor:pointer;
                "
            >
                ✅ CONTINUER
            </button>

        `;


        openModal(
            "💰 WALLET & PAIEMENT",
            html
        );


        /* CHOIX MISE */

        document
            .querySelectorAll(
                ".miltape-bet-option"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        () => {

                            const amount =
                                Number(
                                    button.dataset.bet
                                );


                            setBet(
                                amount
                            );


                            /*
                               On garde la fenêtre
                               ouverte et on la
                               reconstruit.
                            */

                            openWalletChoice();
                        }
                    );
                }
            );


        /* TRONLINK */

        document
            .getElementById(
                "miltapeTronLink"
            )
            ?.addEventListener(
                "click",
                () => {

                    if (
                        isTronLinkAvailable()
                    ) {

                        alert(
                            "🟢 TRONLINK CONNECTÉ !\n\n" +
                            getConnectedTronAddress()
                        );

                    } else {

                        alert(
                            "⚠️ TronLink n'est pas détecté.\n\n" +
                            "Ouvre Miltape depuis le navigateur intégré de TronLink."
                        );
                    }
                }
            );


        /* TRUST WALLET */

        document
            .getElementById(
                "miltapeTrustWallet"
            )
            ?.addEventListener(
                "click",
                () => {

                    const trustURL =
                        "https://link.trustwallet.com/open_url?coin=195&url=" +
                        encodeURIComponent(
                            window.location.href
                        );


                    window.location.href =
                        trustURL;
                }
            );


        /* COPIER */

        document
            .getElementById(
                "miltapeCopyAddress"
            )
            ?.addEventListener(
                "click",
                copyTronAddress
            );


        /* CONTINUER */

        document
            .getElementById(
                "miltapeContinue"
            )
            ?.addEventListener(
                "click",
                () => {

                    if (
                        selectedBet <= 0
                    ) {

                        alert(
                            "⚠️ Choisis d'abord une mise."
                        );

                        return;
                    }


                    closeModal();


                    setMessage(
                        "💰 Mise sélectionnée : $" +
                        selectedBet
                    );


                    if (
                        socket &&
                        socket.connected
                    ) {

                        joinGame();

                    } else {

                        connectSocket();

                        waitForSocketThenJoin();
                    }
                }
            );
    }


    /* =========================================================
       ⭐ BOUTON JOUER
       ========================================================= */

    function openChallenge() {

        console.log(
            "🎮 JOUER MAINTENANT → WALLET"
        );


        /*
           IMPORTANT :
           On ouvre TOUJOURS le wallet.
        */

        openWalletChoice();
    }


    if (enterChallenge) {

        enterChallenge.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                openChallenge();
            }
        );

    } else {

        console.error(
            "❌ Bouton enterChallenge introuvable"
        );
    }


    /* =========================================================
       💰 BOUTON WALLET HEADER
    ========================================================= */

    walletButton?.addEventListener(
        "click",
        event => {

            event.preventDefault();

            openWalletChoice();
        }
    );


    /* =========================================================
       ⏱️ TIMER
    ========================================================= */

    function startLocalTimer() {

        if (
            timerRunning ||
            currentTimer <= 0
        ) {

            return;
        }


        timerRunning = true;


        clearInterval(
            timerInterval
        );


        let lastTick =
            Date.now();


        timerInterval =
            setInterval(
                () => {

                    const now =
                        Date.now();


                    const elapsed =
                        Math.floor(
                            (
                                now -
                                lastTick
                            ) / 1000
                        );


                    if (
                        elapsed <= 0
                    ) {

                        return;
                    }


                    lastTick +=
                        elapsed *
                        1000;


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

                        clearInterval(
                            timerInterval
                        );


                        timerInterval =
                            null;


                        timerRunning =
                            false;


                        gameJoined =
                            false;


                        if (tapButton) {

                            tapButton.disabled =
                                true;
                        }


                        setMessage(
                            "⏰ PARTIE TERMINÉE"
                        );
                    }

                },
                250
            );
    }


    function stopLocalTimer() {

        clearInterval(
            timerInterval
        );


        timerInterval =
            null;


        timerRunning =
            false;
    }


    function updateServerTimer(data) {

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

        } else if (
            gameJoined
        ) {

            startLocalTimer();
        }
    }


    /* =========================================================
       🔌 SOCKET
    ========================================================= */

    function connectSocket() {

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
                "❌ Socket.IO non chargé"
            );


            setMessage(
                "🟠 Chargement du serveur..."
            );


            setTimeout(
                connectSocket,
                1000
            );


            return;
        }


        try {

            if (
                socket
            ) {

                socket.connect();

                return;
            }


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
                "❌ SOCKET",
                error
            );


            setMessage(
                "🔴 Erreur serveur"
            );
        }
    }


    function waitForSocketThenJoin() {

        let attempts =
            0;


        const interval =
            setInterval(
                () => {

                    attempts++;


                    if (
                        socket &&
                        socket.connected
                    ) {

                        clearInterval(
                            interval
                        );


                        joinGame();


                        return;
                    }


                    if (
                        attempts >= 50
                    ) {

                        clearInterval(
                            interval
                        );


                        setMessage(
                            "🔴 Serveur indisponible"
                        );
                    }

                },
                300
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


        if (
            selectedBet <= 0
        ) {

            openWalletChoice();

            return;
        }


        const data = {

            playerId,

            playerName,

            bet:
                selectedBet,

            amount:
                selectedBet
        };


        console.log(
            "🎮 JOIN",
            data
        );


        socket.emit(
            "join",
            data
        );


        socket.emit(
            "joinGame",
            data
        );


        gameJoined =
            true;


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
       SOCKET EVENTS
    ========================================================= */

    function setupSocketEvents() {

        socket.on(
            "connect",
            () => {

                console.log(
                    "🟢 SOCKET CONNECTÉ",
                    socket.id
                );


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
            }
        );


        socket.on(
            "disconnect",
            () => {

                if (
                    gameJoined
                ) {

                    setMessage(
                        "🟠 Reconnexion..."
                    );
                }
            }
        );


        socket.on(
            "connect_error",
            error => {

                console.error(
                    "Socket error",
                    error
                );


                setMessage(
                    "🟠 Serveur momentanément indisponible"
                );
            }
        );


        /* TIMER */

        [
            "timer",
            "gameTimer",
            "timer:update",
            "game:timer",
            "countdown"
        ].forEach(
            event => {

                socket.on(
                    event,
                    updateServerTimer
                );
            }
        );


        /* JOIN SUCCESS */

        [
            "joinSuccess",
            "join:success"
        ].forEach(
            event => {

                socket.on(
                    event,
                    data => {

                        gameJoined =
                            true;


                        if (
                            data &&
                            data.score !==
                            undefined
                        ) {

                            updateScoreDisplays(
                                data.score
                            );
                        }


                        if (tapButton) {

                            tapButton.disabled =
                                false;
                        }


                        setMessage(
                            "🔥 À TOI DE TAPPER !"
                        );


                        startLocalTimer();
                    }
                );
            }
        );


        /* JOIN ERROR */

        [
            "joinError",
            "join:error"
        ].forEach(
            event => {

                socket.on(
                    event,
                    data => {

                        gameJoined =
                            false;


                        if (tapButton) {

                            tapButton.disabled =
                                true;
                        }


                        setMessage(
                            data?.message ||
                            "❌ Impossible de rejoindre"
                        );
                    }
                );
            }
        );


        /* TAP */

        [
            "tapResult",
            "tap:result",
            "score:update"
        ].forEach(
            event => {

                socket.on(
                    event,
                    data => {

                        if (
                            !data
                        ) {

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
                            score !==
                            undefined
                        ) {

                            updateScoreDisplays(
                                score
                            );
                        }
                    }
                );
            }
        );


        /* LEADERBOARD */

        [
            "leaderboard",
            "leaderboard:update"
        ].forEach(
            event => {

                socket.on(
                    event,
                    updateLeaderboard
                );
            }
        );


        /* ONLINE */

        [
            "onlineCount",
            "online:count",
            "online",
            "userCount",
            "users:online",
            "onlineUsers",
            "usersOnline"
        ].forEach(
            event => {

                socket.on(
                    event,
                    updateOnlineCount
                );
            }
        );


        /* TOTAL STAKES */

        [
            "totalStakes",
            "stakes:update"
        ].forEach(
            event => {

                socket.on(
                    event,
                    updateTotalStakes
                );
            }
        );


        /* CHAT */

        [
            "chatMessage",
            "chat:message"
        ].forEach(
            event => {

                socket.on(
                    event,
                    receiveChatMessage
                );
            }
        );


        [
            "chatHistory",
            "chat:history"
        ].forEach(
            event => {

                socket.on(
                    event,
                    messages => {

                        if (
                            Array.isArray(
                                messages
                            )
                        ) {

                            messages.forEach(
                                receiveChatMessage
                            );
                        }
                    }
                );
            }
        );
    }


    /* =========================================================
       LEADERBOARD
    ========================================================= */

    function updateLeaderboard(players) {

        if (
            !leaderboardList
        ) {

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


        leaderboardList.innerHTML =
            [...players]
                .sort(
                    (a, b) => {

                        return (
                            Number(
                                b.score ??
                                b.taps ??
                                b.tapCount ??
                                0
                            ) -
                            Number(
                                a.score ??
                                a.taps ??
                                a.tapCount ??
                                0
                            )
                        );
                    }
                )
                .slice(
                    0,
                    5
                )
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

                                    ${escapeHTML(
                                        name
                                    )}

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


    /* =========================================================
       ONLINE
    ========================================================= */

    function updateOnlineCount(data) {

        let count =
            data;


        if (
            data &&
            typeof data === "object"
        ) {

            count =
                data.count ??
                data.online ??
                data.onlineCount ??
                data.users ??
                data.total ??
                data.connected ??
                data.playersOnline;
        }


        count =
            Number(count);


        if (
            !Number.isFinite(
                count
            ) ||
            !onlineCount
        ) {

            return;
        }


        count =
            Math.max(
                0,
                Math.floor(count)
            );


        onlineCount.innerHTML = `

            <span style="
                display:inline-block;
                width:8px;
                height:8px;
                background:#2ecc71;
                border-radius:50%;
                margin-right:5px;
                box-shadow:0 0 8px #2ecc71;
            "></span>

            <span>
                ${count} EN LIGNE
            </span>
        `;
    }


    /* =========================================================
       TOTAL STAKES
    ========================================================= */

    function updateTotalStakes(data) {

        let total =
            data;


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


    /* =========================================================
       💬 CHAT
    ========================================================= */

    const receivedChatIds =
        new Set();


    const receivedChatKeys =
        new Map();


    function normalizeChatText(text) {

        return String(
            text ?? ""
        )
            .trim()
            .replace(
                /\s+/g,
                " "
            )
            .toLowerCase();
    }


    function receiveChatMessage(msg) {

        if (
            !chatMessages
        ) {

            return;
        }


        let data;


        if (
            typeof msg === "string"
        ) {

            data = {

                playerName:
                    "Anonyme",

                message:
                    msg,

                id:
                    ""
            };

        } else if (
            msg &&
            typeof msg === "object"
        ) {

            data = {

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
                    ""
            };

        } else {

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


        if (
            !text
        ) {

            return;
        }


        if (
            data.id
        ) {

            const id =
                String(
                    data.id
                );


            if (
                receivedChatIds.has(
                    id
                )
            ) {

                return;
            }


            receivedChatIds.add(
                id
            );
        }


        const key =
            normalizeChatText(
                sender
            ) +
            "|" +
            normalizeChatText(
                text
            );


        const now =
            Date.now();


        const previous =
            receivedChatKeys.get(
                key
            );


        if (
            previous &&
            now - previous < 1500
        ) {

            return;
        }


        receivedChatKeys.set(
            key,
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


    function sendChatMessage() {

        if (
            !chatInput
        ) {

            return;
        }


        const text =
            chatInput.value.trim();


        if (
            !text
        ) {

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


        const data = {

            playerId,

            playerName,

            message:
                text
        };


        socket.emit(
            "chatMessage",
            data
        );


        socket.emit(
            "chat:message",
            data
        );


        chatInput.value =
            "";


        chatInput.focus();
    }


    chatSend?.addEventListener(
        "click",
        event => {

            event.preventDefault();

            event.stopPropagation();

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
       ⚡ TAP
    ========================================================= */

    tapButton?.addEventListener(
        "click",
        () => {

            if (
                !gameJoined
            ) {

                setMessage(
                    "⚡ Appuie d'abord sur JOUER"
                );

                return;
            }


            if (
                currentTimer <= 0 ||
                tapLocked
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


            tapLocked =
                true;


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

                    tapLocked =
                        false;


                    tapButton.classList.remove(
                        "tap-active"
                    );

                },
                80
            );
        }
    );


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
       MENU NAVIGATION
    ========================================================= */

    document
        .getElementById(
            "menuGamesBtn"
        )
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
        .getElementById(
            "menuRankingsBtn"
        )
        ?.addEventListener(
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


    document
        .getElementById(
            "menuGainsBtn"
        )
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "💰 Mes gains",
                    `
                        <p>
                            Tes gains apparaîtront
                            ici.
                        </p>
                    `
                );
            }
        );


    document
        .getElementById(
            "menuWithdrawalsBtn"
        )
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
        .getElementById(
            "menuReferralBtn"
        )
        ?.addEventListener(
            "click",
            () => {

                closeSideMenu();

                openModal(
                    "👥 Parrainage",
                    `
                        <p>
                            Ton identifiant :
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


    document
        .getElementById(
            "menuChatBtn"
        )
        ?.addEventListener(
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

                        chatInput?.focus();

                    },
                    500
                );
            }
        );


    document
        .getElementById(
            "menuRulesBtn"
        )
        ?.addEventListener(
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


    /* =========================================================
       📲 PWA
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

            if (
                !deferredPrompt
            ) {

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


            deferredPrompt =
                null;


            installButton.classList.remove(
                "show"
            );
        }
    );


    /* =========================================================
       INITIALISATION
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


    connectSocket();


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


    console.log(
        "💰 USDT TRC20 :",
        USDT_TRON_ADDRESS
    );

});
