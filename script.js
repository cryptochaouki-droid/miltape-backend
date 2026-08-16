document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =========================================================
       🛡️ PROTECTION DOUBLE CHARGEMENT
    ========================================================= */

    if (window.__MILTAPE_INITIALIZED__) {
        console.warn(
            "🛑 Miltape déjà initialisé — deuxième chargement ignoré."
        );
        return;
    }

    window.__MILTAPE_INITIALIZED__ = true;

    console.log(
        "🚀 MILTAPE WORLD CHALLENGE — INITIALISATION UNIQUE"
    );


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

    let tapLocked = false;

    let lastSentMessage = "";
    let lastSentMessageTime = 0;


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

    const chatInput =
        document.getElementById("chatInput");

    const chatSend =
        document.getElementById("chatSend");

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

                const now =
                    Date.now();

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


    function resetLocalTimer(
        seconds = GAME_DURATION
    ) {

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

        const seconds =
            Number(value);

        if (!Number.isFinite(seconds)) {
            return;
        }

        const cleanSeconds =
            Math.max(
                0,
                Math.floor(seconds)
            );

        updateTimerDisplay(
            cleanSeconds
        );

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
            console.warn(
                "⚠️ #chatMessages introuvable dans le HTML."
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
            ).
