/* =========================================================
   MILTAPE WORLD CHALLENGE
   SCRIPT.JS COMPLET
   Paiement USDT TRC20 + TronLink + Socket.IO
========================================================= */

"use strict";

/* =========================================================
   CONFIGURATION
========================================================= */

const API_URL =
    "https://miltape-backend-production.up.railway.app";

const SOCKET_URL =
    API_URL;

const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWY3q1NffNPM";

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const GAME_DURATION = 600;

/* =========================================================
   VARIABLES
========================================================= */

let socket = null;

let playerId = "";

let playerName = "";

let walletAddress = "";

let selectedBet = 1;

let hasPaid = false;

let currentGameId = null;

let timerLeft = GAME_DURATION;

let isPaying = false;

let deferredInstallPrompt = null;

/* =========================================================
   DOM
========================================================= */

const $ = id =>
    document.getElementById(id);

const enterChallenge =
    $("enterChallenge");

const tapButton =
    $("tapButton");

const tapCount =
    $("tapCount");

const tapButtonCount =
    $("tapButtonCount");

const timerElement =
    $("timer");

const tapMessage =
    $("tapMessage");

const displayBet =
    $("displayBet");

const globalTotalStakes =
    $("globalTotalStakes");

const onlineCount =
    $("onlineCount");

const leaderboardList =
    $("leaderboardList");

const chatMessages =
    $("chatMessages");

const chatInput =
    $("chatInput");

const chatSend =
    $("chatSend");

/* =========================================================
   PLAYER ID
========================================================= */

function getPlayerId() {

    let id =
        localStorage.getItem(
            "miltape_player_id"
        );

    if (!id) {

        id =
            "player_" +
            Date.now() +
            "_" +
            Math.random()
                .toString(36)
                .substring(2, 10);

        localStorage.setItem(
            "miltape_player_id",
            id
        );
    }

    return id;
}

playerId =
    getPlayerId();

/* =========================================================
   PLAYER NAME
========================================================= */

function getPlayerName() {

    let name =
        localStorage.getItem(
            "miltape_player_name"
        );

    if (!name) {

        name =
            prompt(
                "Choisis ton pseudo Miltape :"
            ) ||
            "Joueur";

        name =
            String(name)
                .trim()
                .substring(0, 30);

        if (!name) {
            name = "Joueur";
        }

        localStorage.setItem(
            "miltape_player_name",
            name
        );
    }

    return name;
}

playerName =
    getPlayerName();

/* =========================================================
   MESSAGE
========================================================= */

function showMessage(
    message,
    type = "normal"
) {

    if (!tapMessage) {
        return;
    }

    tapMessage.textContent =
        message;

    if (type === "success") {

        tapMessage.style.color =
            "#2ecc71";

    } else if (type === "error") {

        tapMessage.style.color =
            "#ff4d6d";

    } else {

        tapMessage.style.color =
            "#ffcc00";
    }
}

/* =========================================================
   API JSON
========================================================= */

async function api(
    path,
    options = {}
) {

    const response =
        await fetch(
            API_URL + path,
            {
                ...options,

                headers: {
                    "Content-Type":
                        "application/json",

                    ...(options.headers || {})
                }
            }
        );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {

        throw new Error(
            data.message ||
            data.error ||
            "Erreur serveur"
        );
    }

    return data;
}

/* =========================================================
   TRONLINK
========================================================= */

function getTronWeb() {

    /*
    TronLink injecte généralement
    window.tronWeb.
    */

    if (
        window.tronWeb &&
        typeof window.tronWeb.trx !==
            "undefined"
    ) {

        return window.tronWeb;
    }

    return null;
}

/* =========================================================
   DÉTECTER TRONLINK
========================================================= */

async function waitForTronLink(
    timeout = 5000
) {

    const start =
        Date.now();

    while (
        Date.now() - start <
        timeout
    ) {

        if (
            window.tronWeb &&
            window.tronWeb.ready
        ) {

            return window.tronWeb;
        }

        if (
            window.tronLink &&
            window.tronLink.ready
        ) {

            if (
                window.tronLink.tronWeb
            ) {

                return window.tronLink.tronWeb;
            }
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    250
                )
        );
    }

    return null;
}

/* =========================================================
   CONNECTER TRONLINK
========================================================= */

async function connectTronLink() {

    /*
    Déjà connecté
    */

    let tronWeb =
        getTronWeb();

    if (
        tronWeb &&
        tronWeb.defaultAddress &&
        tronWeb.defaultAddress.base58
    ) {

        walletAddress =
            tronWeb
                .defaultAddress
                .base58;

        return tronWeb;
    }

    /*
    Demande de connexion à TronLink
    */

    try {

        if (
            window.tronLink &&
            typeof window.tronLink.request ===
                "function"
        ) {

            await window.tronLink.request(
                {
                    method:
                        "tron_requestAccounts"
                }
            );
        }

    } catch (error) {

        console.error(
            "TronLink request:",
            error
        );

        throw new Error(
            "Connexion TronLink refusée."
        );
    }

    /*
    Attendre injection
    */

    tronWeb =
        await waitForTronLink(7000);

    if (!tronWeb) {

        throw new Error(
            "TronLink n'est pas détecté. Ouvre Miltape dans TronLink."
        );
    }

    /*
    Récupérer adresse
    */

    if (
        !tronWeb.defaultAddress ||
        !tronWeb.defaultAddress.base58
    ) {

        throw new Error(
            "Aucun wallet TRON connecté."
        );
    }

    walletAddress =
        tronWeb
            .defaultAddress
            .base58;

    /*
    Vérifier réseau
    */

    try {

        const network =
            await tronWeb.trx.getChainParameters();

        console.log(
            "TRON network:",
            network
        );

    } catch (error) {

        console.warn(
            "Impossible de lire le réseau:",
            error
        );
    }

    return tronWeb;
}

/* =========================================================
   VALIDATION ADRESSE TRON
========================================================= */

function isValidTronAddress(
    address
) {

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(
            String(address || "")
        );
}

/* =========================================================
   MONTANT USDT
========================================================= */

function usdtUnits(
    amount
) {

    return Math.round(
        Number(amount) *
        1000000
    );
}

/* =========================================================
   OUVRIR LA FENÊTRE DE MISE
========================================================= */

function openBetModal() {

    /*
    Si un ancien modal existe
    */

    const old =
        document.getElementById(
            "miltapeBetModal"
        );

    if (old) {
        old.remove();
    }

    const modal =
        document.createElement(
            "div"
        );

    modal.id =
        "miltapeBetModal";

    modal.style.cssText = `
        position:fixed;
        inset:0;
        background:rgba(0,0,0,.88);
        z-index:99999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
        box-sizing:border-box;
    `;

    modal.innerHTML = `

        <div style="
            width:100%;
            max-width:380px;
            background:#120624;
            border:1px solid #ffcc00;
            border-radius:20px;
            padding:24px;
            box-sizing:border-box;
            color:white;
            text-align:center;
            box-shadow:0 0 40px rgba(255,204,0,.18);
        ">

            <button
                id="closeBetModal"
                type="button"
                style="
                    float:right;
                    background:none;
                    border:0;
                    color:white;
                    font-size:28px;
                    cursor:pointer;
                "
            >
                ×
            </button>

            <h2 style="
                color:#ffcc00;
                margin:5px 0 8px;
            ">
                💰 CHOISIS TA MISE
            </h2>

            <p style="
                color:#aaa;
                font-size:13px;
                margin-bottom:20px;
            ">
                Paiement sécurisé en USDT TRC20
            </p>

            <div
                id="betChoices"
                style="
                    display:grid;
                    grid-template-columns:1fr 1fr;
                    gap:10px;
                    margin-bottom:20px;
                "
            >

                ${[1, 2, 5, 10].map(
                    amount => `
                        <button
                            type="button"
                            class="bet-choice"
                            data-bet="${amount}"
                            style="
                                padding:16px 10px;
                                border-radius:12px;
                                border:1px solid rgba(255,204,0,.35);
                                background:#1a092b;
                                color:white;
                                font-size:17px;
                                font-weight:900;
                                cursor:pointer;
                            "
                        >
                            ${amount} USDT
                        </button>
                    `
                ).join("")}

            </div>

            <button
                id="payNowButton"
                type="button"
                style="
                    width:100%;
                    padding:16px;
                    border:0;
                    border-radius:14px;
                    background:linear-gradient(
                        135deg,
                        #ffcc00,
                        #ff8a00
                    );
                    color:#16051f;
                    font-size:16px;
                    font-weight:900;
                    cursor:pointer;
                "
            >
                💳 PAYER ${selectedBet} USDT
            </button>

            <p
                id="paymentStatus"
                style="
                    color:#aaa;
                    font-size:12px;
                    line-height:1.5;
                    margin-top:15px;
                "
            >
                Ton wallet TronLink sera demandé
                au moment du paiement.
            </p>

        </div>
    `;

    document.body.appendChild(
        modal
    );

    const choices =
        modal.querySelectorAll(
            ".bet-choice"
        );

    function refreshChoices() {

        choices.forEach(
            button => {

                const value =
                    Number(
                        button.dataset.bet
                    );

                if (
                    value ===
                    selectedBet
                ) {

                    button.style.background =
                        "linear-gradient(135deg,#ffcc00,#ff8a00)";

                    button.style.color =
                        "#16051f";

                    button.style.border =
                        "1px solid #ffcc00";

                } else {

                    button.style.background =
                        "#1a092b";

                    button.style.color =
                        "#fff";
                }
            }
        );

        const pay =
            document.getElementById(
                "payNowButton"
            );

        if (pay) {

            pay.textContent =
                `💳 PAYER ${selectedBet} USDT`;
        }
    }

    choices.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    selectedBet =
                        Number(
                            button.dataset.bet
                        );

                    displayBet.textContent =
                        "$" +
                        selectedBet;

                    refreshChoices();
                }
            );
        }
    );

    document
        .getElementById(
            "closeBetModal"
        )
        .addEventListener(
            "click",
            () => modal.remove()
        );

    document
        .getElementById(
            "payNowButton"
        )
        .addEventListener(
            "click",
            payUSDT
        );

    refreshChoices();
}

/* =========================================================
   PAIEMENT USDT
========================================================= */

async function payUSDT() {

    if (isPaying) {
        return;
    }

    isPaying = true;

    const payButton =
        document.getElementById(
            "payNowButton"
        );

    const status =
        document.getElementById(
            "paymentStatus"
        );

    try {

        if (payButton) {

            payButton.disabled =
                true;

            payButton.textContent =
                "🔌 CONNEXION WALLET...";
        }

        if (status) {

            status.textContent =
                "Connexion à TronLink...";
        }

        /*
        ==============================================
        CONNEXION
        ==============================================
        */

        const tronWeb =
            await connectTronLink();

        if (!tronWeb) {

            throw new Error(
                "TronLink introuvable."
            );
        }

        /*
        ==============================================
        ADRESSE
        ==============================================
        */

        const from =
            tronWeb
                .defaultAddress
                .base58;

        if (
            !isValidTronAddress(
                from
            )
        ) {

            throw new Error(
                "Adresse TRON du wallet invalide."
            );
        }

        walletAddress =
            from;

        if (status) {

            status.textContent =
                `Wallet connecté : ${from.substring(
                    0,
                    6
                )}...${from.substring(
                    from.length - 6
                )}`;
        }

        /*
        ==============================================
        RÉSEAU MAINNET
        ==============================================
        */

        try {

            const network =
                await tronWeb.trx.getChainParameters();

            console.log(
                "Chain parameters:",
                network
            );

        } catch (error) {

            console.warn(
                "Network check failed:",
                error
            );
        }

        /*
        ==============================================
        SOLDE TRX
        ==============================================
        */

        try {

            const trxBalance =
                await tronWeb.trx.getBalance(
                    from
                );

            console.log(
                "TRX balance:",
                trxBalance / 1000000
            );

        } catch (error) {

            console.warn(
                "TRX balance:",
                error
            );
        }

        /*
        ==============================================
        SOLDE USDT
        ==============================================
        */

        try {

            const contract =
                await tronWeb
                    .contract()
                    .at(
                        USDT_CONTRACT
                    );

            const rawBalance =
                await contract
                    .balanceOf(from)
                    .call();

            const balance =
                Number(
                    rawBalance
                ) /
                1000000;

            console.log(
                "USDT balance:",
                balance
            );

            if (
                balance <
                selectedBet
            ) {

                throw new Error(
                    `Solde USDT insuffisant. Tu as ${balance} USDT.`
                );
            }

        } catch (error) {

            if (
                String(
                    error.message || ""
                ).includes(
                    "Solde USDT insuffisant"
                )
            ) {

                throw error;
            }

            console.warn(
                "Impossible de lire le solde USDT:",
                error
            );
        }

        /*
        ==============================================
        PRÉPARATION
        ==============================================
        */

        if (payButton) {

            payButton.textContent =
                `🔐 CONFIRME ${selectedBet} USDT`;
        }

        if (status) {

            status.textContent =
                "Une fenêtre TronLink va s'ouvrir. Confirme le paiement.";
        }

        /*
        ==============================================
        CONTRAT USDT
        ==============================================
        */

        const contract =
            await tronWeb
                .contract()
                .at(
                    USDT_CONTRACT
                );

        /*
        ==============================================
        TRANSFERT
        ==============================================
        */

        const amount =
            usdtUnits(
                selectedBet
            );

        console.log(
            "Paiement:",
            {
                from,
                to: MILTAPE_WALLET,
                amount,
                selectedBet
            }
        );

        /*
        TronWeb crée la transaction
        puis TronLink demande
        la signature de l'utilisateur.
        */

        const txid =
            await contract
                .transfer(
                    MILTAPE_WALLET,
                    amount
                )
                .send(
                    {
                        feeLimit:
                            100000000,

                        callValue:
                            0,

                        shouldPollResponse:
                            false
                    }
                );

        console.log(
            "TXID:",
            txid
        );

        if (!txid) {

            throw new Error(
                "Le wallet n'a pas retourné de TXID."
            );
        }

        if (status) {

            status.textContent =
                "✅ Transaction envoyée. Vérification du paiement...";
        }

        if (payButton) {

            payButton.textContent =
                "⏳ VÉRIFICATION...";
        }

        /*
        ==============================================
        ATTENDRE UN PEU
        ==============================================
        */

        await wait(
            4000
        );

        /*
        ==============================================
        BACKEND
        ==============================================
        */

        const result =
            await verifyPayment(
                txid,
                selectedBet,
                walletAddress
            );

        /*
        ==============================================
        SUCCÈS
        ==============================================
        */

        if (
            result &&
            result.success
        ) {

            hasPaid =
                true;

            localStorage.setItem(
                "miltape_has_paid",
                "true"
            );

            localStorage.setItem(
                "miltape_wallet",
                walletAddress
            );

            localStorage.setItem(
                "miltape_game_id",
                String(
                    result.gameId ||
                    currentGameId ||
                    ""
                )
            );

            displayBet.textContent =
                "$" +
                selectedBet;

            showMessage(
                "✅ PAIEMENT VALIDÉ — TU PEUX JOUER !",
                "success"
            );

            tapButton.disabled =
                false;

            tapButton.style.opacity =
                "1";

            tapButton.style.cursor =
                "pointer";

            /*
            Fermer modal
            */

            const modal =
                document.getElementById(
                    "miltapeBetModal"
                );

            if (modal) {
                modal.remove();
            }

            /*
            Rejoindre Socket
            */

            connectSocket();

            return;
        }

        throw new Error(
            result?.message ||
            "Paiement non validé."
        );

    } catch (error) {

        console.error(
            "❌ PAYMENT ERROR:",
            error
        );

        const message =
            String(
                error?.message ||
                error ||
                "Paiement annulé."
            );

        if (status) {

            status.textContent =
                "❌ " + message;
        }

        if (payButton) {

            payButton.disabled =
                false;

            payButton.textContent =
                `💳 PAYER ${selectedBet} USDT`;
        }

        showMessage(
            "⚠️ " + message,
            "error"
        );

    } finally {

        isPaying =
            false;
    }
}

/* =========================================================
   ATTENTE
========================================================= */

function wait(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

/* =========================================================
   VÉRIFICATION BACKEND
========================================================= */

async function verifyPayment(
    txid,
    amount,
    address
) {

    /*
    Le backend que tu as envoyé
    attend exactement ces champs.
    */

    const result =
        await api(
            "/api/verify-payment",
            {
                method: "POST",

                body:
                    JSON.stringify(
                        {

                            playerId,

                            playerName,

                            txid,

                            amount,

                            cryptoAddress:
                                address
                        }
                    )
            }
        );

    return result;
}

/* =========================================================
   SOCKET.IO
========================================================= */

function connectSocket() {

    if (
        socket &&
        socket.connected
    ) {

        joinGame();

        return;
    }

    if (
        typeof io !==
        "function"
    ) {

        console.error(
            "Socket.IO non chargé."
        );

        return;
    }

    socket =
        io(
            SOCKET_URL,
            {
                transports: [
                    "websocket",
                    "polling"
                ]
            }
        );

    socket.on(
        "connect",
        () => {

            console.log(
                "🟢 Socket connecté"
            );

            joinGame();
        }
    );

    socket.on(
        "connect_error",
        error => {

            console.error(
                "Socket error:",
                error.message
            );
        }
    );

    /*
    INIT
    */

    socket.on(
        "initGame",
        data => {

            if (!data) {
                return;
            }

            currentGameId =
                data.gameId;

            timerLeft =
                Number(
                    data.timerLeft ??
                    GAME_DURATION
                );

            updateTimer(
                timerLeft
            );

            if (
                Array.isArray(
                    data.leaderboard
                )
            ) {

                renderLeaderboard(
                    data.leaderboard
                );
            }

            if (
                data.joined
            ) {

                hasPaid =
                    true;

                tapButton.disabled =
                    false;
            }
        }
    );

    /*
    TIMER
    */

    socket.on(
        "timer",
        value => {

            timerLeft =
                Number(value);

            updateTimer(
                timerLeft
            );
        }
    );

    socket.on(
        "timer:update",
        data => {

            if (!data) {
                return;
            }

            timerLeft =
                Number(
                    data.timeLeft ??
                    timerLeft
                );

            currentGameId =
                data.gameId ??
                currentGameId;

            updateTimer(
                timerLeft
            );
        }
    );

    socket.on(
        "timerUpdate",
        data => {

            if (!data) {
                return;
            }

            timerLeft =
                Number(
                    data.timerLeft ??
                    timerLeft
                );

            updateTimer(
                timerLeft
            );
        }
    );

    /*
    LEADERBOARD
    */

    socket.on(
        "leaderboard",
        renderLeaderboard
    );

    socket.on(
        "leaderboard:update",
        renderLeaderboard
    );

    /*
    SCORE
    */

    socket.on(
        "score:update",
        data => {

            if (
                data &&
                data.playerId ===
                    playerId
            ) {

                const score =
                    Number(
                        data.score || 0
                    );

                updateLocalScore(
                    score
                );
            }
        }
    );

    /*
    TAP RESULT
    */

    socket.on(
        "tapResult",
        data => {

            if (
                !data ||
                !data.success
            ) {

                return;
            }

            updateLocalScore(
                Number(
                    data.score || 0
                )
            );
        }
    );

    /*
    ONLINE
    */

    socket.on(
        "onlineCount",
        count => {

            updateOnline(
                count
            );
        }
    );

    socket.on(
        "online:count",
        data => {

            updateOnline(
                data?.count || 0
            );
        }
    );

    /*
    TOTAL STAKES
    */

    socket.on(
        "totalStakes",
        total => {

            updateTotalStakes(
                total
            );
        }
    );

    socket.on(
        "stakes:update",
        data => {

            updateTotalStakes(
                data?.total || 0
            );
        }
    );

    /*
    CHAT
    */

    socket.on(
        "chatHistory",
        messages => {

            renderChatHistory(
                messages
            );
        }
    );

    socket.on(
        "chatMessage",
        message => {

            addChatMessage(
                message
            );
        }
    );

    socket.on(
        "chat:message",
        message => {

            addChatMessage(
                message
            );
        }
    );

    /*
    NOUVELLE PARTIE
    */

    socket.on(
        "newGame",
        data => {

            newGame(
                data
            );
        }
    );

    socket.on(
        "game:new",
        data => {

            newGame(
                data
            );
        }
    );

    socket.on(
        "gameStart",
        data => {

            newGame(
                data
            );
        }
    );

    /*
    GAME OVER
    */

    socket.on(
        "gameOver",
        data => {

            showMessage(
                "🏁 Partie terminée !",
                "normal"
            );

            tapButton.disabled =
                true;
        }
    );
}

/* =========================================================
   JOIN GAME
========================================================= */

function joinGame() {

    if (
        !socket ||
        !socket.connected
    ) {

        return;
    }

    socket.emit(
        "join",
        {

            playerId,

            playerName
        }
    );
}

/* =========================================================
   TIMER
========================================================= */

function updateTimer(
    seconds
) {

    seconds =
        Math.max(
            0,
            Number(seconds) || 0
        );

    const minutes =
        Math.floor(
            seconds / 60
        );

    const secs =
        seconds % 60;

    if (timerElement) {

        timerElement.textContent =
            String(minutes)
                .padStart(2, "0") +
            ":" +
            String(secs)
                .padStart(2, "0");
    }

    if (
        seconds <= 0
    ) {

        tapButton.disabled =
            true;

    } else if (
        hasPaid
    ) {

        tapButton.disabled =
            false;
    }
}

/* =========================================================
   NOUVELLE PARTIE
========================================================= */

function newGame(
    data
) {

    currentGameId =
        data?.gameId ??
        currentGameId;

    timerLeft =
        Number(
            data?.timerLeft ??
            GAME_DURATION
        );

    updateTimer(
        timerLeft
    );

    updateLocalScore(
        0
    );

    /*
    Le paiement de la partie
    précédente ne doit pas
    automatiquement payer la
    nouvelle partie.
    */

    hasPaid =
        false;

    tapButton.disabled =
        true;

    showMessage(
        "⚡ NOUVELLE PARTIE — CHOISIS TA MISE",
        "normal"
    );

    if (displayBet) {

        displayBet.textContent =
            "$0";
    }
}

/* =========================================================
   TAP
========================================================= */

if (tapButton) {

    tapButton.addEventListener(
        "click",
        () => {

            if (
                !hasPaid ||
                !socket ||
                !socket.connected
            ) {

                showMessage(
                    "🔒 Tu dois d'abord payer ta mise.",
                    "error"
                );

                return;
            }

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

            socket.emit(
                "tap",
                {
                    playerId
                }
            );
        }
    );
}

/* =========================================================
   PLAY BUTTON
========================================================= */

if (enterChallenge) {

    enterChallenge.addEventListener(
        "click",
        () => {

            openBetModal();
        }
    );
}

/* =========================================================
   SCORE LOCAL
========================================================= */

function updateLocalScore(
    score
) {

    const value =
        Math.max(
            0,
            Number(score) || 0
        );

    if (tapCount) {

        tapCount.textContent =
            value;
    }

    if (tapButtonCount) {

        tapButtonCount.textContent =
            value;
    }
}

/* =========================================================
   LEADERBOARD
========================================================= */

function renderLeaderboard(
    players
) {

    if (!leaderboardList) {
        return;
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
        players
            .slice(0, 5)
            .map(
                (player, index) => {

                    const medal =
                        [
                            "🥇",
                            "🥈",
                            "🥉",
                            "🏅",
                            "🏅"
                        ][index] ||
                        "🏅";

                    return `
                        <div style="
                            display:flex;
                            align-items:center;
                            justify-content:space-between;
                            padding:10px;
                            margin-bottom:6px;
                            border-radius:10px;
                            background:rgba(255,255,255,.035);
                        ">

                            <div>
                                <strong style="color:#ffcc00;">
                                    ${medal}
                                    ${escapeHtml(
                                        player.playerName ||
                                        "Joueur"
                                    )}
                                </strong>
                            </div>

                            <strong style="color:white;">
                                ${Number(
                                    player.score || 0
                                ).toLocaleString(
                                    "fr-FR"
                                )}
                                TAP
                            </strong>

                        </div>
                    `;
                }
            )
            .join("");
}

/* =========================================================
   ONLINE
========================================================= */

function updateOnline(
    count
) {

    if (!onlineCount) {
        return;
    }

    onlineCount.innerHTML = `
        <span style="
            display:inline-block;
            width:8px;
            height:8px;
            background:#2ecc71;
            border-radius:50%;
            margin-right:5px;
        "></span>

        <span>
            ${Number(count || 0)}
            EN LIGNE
        </span>
    `;
}

/* =========================================================
   TOTAL STAKES
========================================================= */

function updateTotalStakes(
    total
) {

    if (!globalTotalStakes) {
        return;
    }

    const value =
        Number(total || 0);

    globalTotalStakes.textContent =
        "$" +
        value.toLocaleString(
            "fr-FR",
            {
                maximumFractionDigits: 2
            }
        );
}

/* =========================================================
   CHAT
========================================================= */

function sendChat() {

    if (!socket) {

        showMessage(
            "Chat non connecté.",
            "error"
        );

        return;
    }

    const message =
        String(
            chatInput?.value || ""
        ).trim();

    if (!message) {
        return;
    }

    if (
        !socket.connected
    ) {

        showMessage(
            "Connexion au chat en cours...",
            "error"
        );

        return;
    }

    socket.emit(
        "chatMessage",
        {

            playerId,

            playerName,

            message
        }
    );

    chatInput.value =
        "";
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

                event.preventDefault();

                sendChat();
            }
        }
    );
}

/* =========================================================
   CHAT HISTORY
========================================================= */

function renderChatHistory(
    messages
) {

    if (!chatMessages) {
        return;
    }

    chatMessages.innerHTML =
        "";

    if (
        !Array.isArray(messages) ||
        messages.length === 0
    ) {

        addChatMessage(
            {
                playerName:
                    "Système",

                message:
                    "Bienvenue sur Miltape !"
            }
        );

        return;
    }

    messages.forEach(
        addChatMessage
    );
}

/* =========================================================
   CHAT MESSAGE
========================================================= */

function addChatMessage(
    data
) {

    if (!chatMessages) {
        return;
    }

    if (!data) {
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
            ${escapeHtml(
                data.playerName ||
                "Anonyme"
            )} :
        </strong>

        ${escapeHtml(
            data.message ||
            ""
        )}
    `;

    chatMessages.appendChild(
        div
    );

    chatMessages.scrollTop =
        chatMessages.scrollHeight;
}

/* =========================================================
   SÉCURITÉ HTML
========================================================= */

function escapeHtml(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}

/* =========================================================
   WALLET BUTTON
========================================================= */

const walletButton =
    $("walletButton");

if (walletButton) {

    walletButton.addEventListener(
        "click",
        async () => {

            try {

                const tronWeb =
                    await connectTronLink();

                walletAddress =
                    tronWeb
                        .defaultAddress
                        .base58;

                showMessage(
                    `💰 Wallet connecté : ${walletAddress.substring(
                        0,
                        6
                    )}...${walletAddress.substring(
                        walletAddress.length - 6
                    )}`,
                    "success"
                );

            } catch (error) {

                showMessage(
                    "❌ " +
                    error.message,
                    "error"
                );
            }
        }
    );
}

/* =========================================================
   MENU
========================================================= */

const menuButton =
    $("menuButton");

const sideMenu =
    $("sideMenu");

const menuOverlay =
    $("menuOverlay");

const closeMenu =
    $("closeMenu");

function openMenu() {

    sideMenu?.classList.add(
        "show"
    );

    menuOverlay?.classList.add(
        "show"
    );
}

function closeSideMenu() {

    sideMenu?.classList.remove(
        "show"
    );

    menuOverlay?.classList.remove(
        "show"
    );
}

menuButton?.addEventListener(
    "click",
    openMenu
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
   PWA
========================================================= */

const installButton =
    $("installPwaButton");

window.addEventListener(
    "beforeinstallprompt",
    event => {

        event.preventDefault();

        deferredInstallPrompt =
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
            !deferredInstallPrompt
        ) {
            return;
        }

        deferredInstallPrompt.prompt();

        await deferredInstallPrompt
            .userChoice;

        deferredInstallPrompt =
            null;

        installButton.classList.remove(
            "show"
        );
    }
);

/* =========================================================
   DYNAMIC MODAL
========================================================= */

const dynamicModal =
    $("dynamicModal");

const closeDynamicModal =
    $("closeDynamicModal");

closeDynamicModal?.addEventListener(
    "click",
    () => {

        dynamicModal?.classList.remove(
            "show"
        );
    }
);

/* =========================================================
   MENU ACTIONS
========================================================= */

function showDynamicModal(
    title,
    html
) {

    const titleElement =
        $("dynamicModalTitle");

    const bodyElement =
        $("dynamicModalBody");

    if (titleElement) {
        titleElement.textContent =
            title;
    }

    if (bodyElement) {
        bodyElement.innerHTML =
            html;
    }

    dynamicModal?.classList.add(
        "show"
    );

    closeSideMenu();
}

$("menuGamesBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
            "🎮 Mes parties",
            `
                <p>
                    Ton historique de parties
                    sera affiché ici.
                </p>
            `
        );
    }
);

$("menuRankingsBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
            "🏆 Mes classements",
            `
                <p>
                    Consulte tes classements
                    Miltape ici.
                </p>
            `
        );
    }
);

$("menuGainsBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
            "💰 Mes gains",
            `
                <p>
                    Tes gains seront affichés
                    ici.
                </p>
            `
        );
    }
);

$("menuWithdrawalsBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
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

$("menuReferralBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
            "👥 Parrainage",
            `
                <p>
                    Invite tes amis sur Miltape.
                </p>
            `
        );
    }
);

$("menuChatBtn")?.addEventListener(
    "click",
    () => {

        closeSideMenu();

        document
            .getElementById(
                "globalChat"
            )
            ?.scrollIntoView(
                {
                    behavior:
                        "smooth"
                }
            );
    }
);

$("menuRulesBtn")?.addEventListener(
    "click",
    () => {

        showDynamicModal(
            "📜 Règles",
            `
                <ul>
                    <li>Une partie dure 10 minutes.</li>
                    <li>Les 5 meilleurs joueurs sont classés.</li>
                    <li>La mise est payée en USDT TRC20.</li>
                    <li>Le paiement doit être validé avant de jouer.</li>
                </ul>
            `
        );
    }
);

/* =========================================================
   LANGUE
========================================================= */

$("languageSelect")?.addEventListener(
    "change",
    event => {

        localStorage.setItem(
            "miltape_language",
            event.target.value
        );
    }
);

/* =========================================================
   CHARGER CONFIG SERVEUR
========================================================= */

async function loadServerConfig() {

    try {

        const data =
            await api(
                "/api/game-config"
            );

        if (
            data?.game?.gameId
        ) {

            currentGameId =
                data.game.gameId;
        }

        if (
            data?.game?.timerLeft !==
            undefined
        ) {

            timerLeft =
                Number(
                    data.game.timerLeft
                );

            updateTimer(
                timerLeft
            );
        }

        if (
            data?.payment?.minimumBet
        ) {

            selectedBet =
                Number(
                    data.payment.minimumBet
                );
        }

        if (
            data?.payment?.address
        ) {

            console.log(
                "Miltape wallet:",
                data.payment.address
            );
        }

        if (
            data?.payment?.contract
        ) {

            console.log(
                "USDT contract:",
                data.payment.contract
            );
        }

    } catch (error) {

        console.warn(
            "Config serveur:",
            error.message
        );
    }
}

/* =========================================================
   INITIALISATION
========================================================= */

async function init() {

    console.log(
        "🔥 Miltape initialisation..."
    );

    console.log(
        "Player:",
        playerId
    );

    console.log(
        "Name:",
        playerName
    );

    /*
    Charger serveur
    */

    await loadServerConfig();

    /*
    Socket
    */

    connectSocket();

    /*
    État initial
    */

    tapButton.disabled =
        true;

    showMessage(
        "⚡ CHOISIS TA MISE POUR COMMENCER",
        "normal"
    );

    /*
    Vérifier si TronLink
    existe déjà
    */

    setTimeout(
        async () => {

            const tronWeb =
                getTronWeb();

            if (
                tronWeb &&
                tronWeb.defaultAddress &&
                tronWeb.defaultAddress.base58
            ) {

                walletAddress =
                    tronWeb
                        .defaultAddress
                        .base58;

                console.log(
                    "Wallet détecté:",
                    walletAddress
                );
            }

        },
        1000
    );
}

init();

/* =========================================================
   FIN
========================================================= */
