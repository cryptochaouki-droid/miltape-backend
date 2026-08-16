/* =========================================================
   MILTAPE WORLD CHALLENGE
   SCRIPT FRONTEND COMPLET
========================================================= */

"use strict";

/* =========================================================
   CONFIG
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

const MINIMUM_BET = 1;

const GAME_DURATION = 600;

/* =========================================================
   ETAT
========================================================= */

let socket = null;

let playerId =
    localStorage.getItem("miltape_player_id");

if (!playerId) {

    playerId =
        "player_" +
        Date.now() +
        "_" +
        Math.random()
            .toString(36)
            .substring(2, 10);

    localStorage.setItem(
        "miltape_player_id",
        playerId
    );
}

let playerName =
    localStorage.getItem(
        "miltape_player_name"
    ) || "";

let playerAddress =
    localStorage.getItem(
        "miltape_player_address"
    ) || "";

let selectedBet = 0;

let tapCount = 0;

let gameId = 1;

let gameRunning = false;

let joinedGame = false;

let paymentInProgress = false;

let connectedWallet = "";

/* =========================================================
   DOM
========================================================= */

const $ = id =>
    document.getElementById(id);

const enterChallenge =
    $("enterChallenge");

const tapButton =
    $("tapButton");

const tapCountElement =
    $("tapCount");

const tapButtonCount =
    $("tapButtonCount");

const displayBet =
    $("displayBet");

const timerElement =
    $("timer");

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

const dynamicModal =
    $("dynamicModal");

const dynamicModalTitle =
    $("dynamicModalTitle");

const dynamicModalBody =
    $("dynamicModalBody");

const closeDynamicModal =
    $("closeDynamicModal");

const globalTotalStakes =
    $("globalTotalStakes");

const tapMessage =
    $("tapMessage");

/* =========================================================
   UTILITAIRES
========================================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showMessage(message) {

    if (tapMessage) {
        tapMessage.textContent = message;
    }
}

function formatNumber(value) {

    return Number(value || 0)
        .toLocaleString("fr-FR");
}

function formatUsdt(value) {

    return Number(value || 0)
        .toLocaleString(
            "fr-FR",
            {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6
            }
        );
}

function shortAddress(address) {

    if (!address) {
        return "";
    }

    return (
        address.substring(0, 6) +
        "..." +
        address.substring(
            address.length - 6
        )
    );
}

/* =========================================================
   MODAL
========================================================= */

function openModal() {

    dynamicModal.classList.add("show");

    document.body.style.overflow =
        "hidden";
}

function closeModal() {

    dynamicModal.classList.remove("show");

    document.body.style.overflow =
        "";
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
        event => {

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
   FORMULAIRE JOUER
========================================================= */

function openChallengeForm() {

    dynamicModalTitle.textContent =
        "🎮 Rejoindre la partie";

    dynamicModalBody.innerHTML = `

        <div style="
            display:flex;
            flex-direction:column;
            gap:14px;
        ">

            <div style="
                padding:12px;
                border-radius:12px;
                background:rgba(255,204,0,.08);
                border:1px solid rgba(255,204,0,.25);
                color:#ddd;
                font-size:13px;
                line-height:1.5;
            ">
                🏆 <strong style="color:#ffcc00;">
                    Miltape World Challenge
                </strong>
                <br>
                Choisis librement ta mise en USDT.
                <br>
                Minimum :
                <strong style="color:#ffcc00;">
                    ${MINIMUM_BET} USDT
                </strong>
            </div>

            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:800;
            ">
                🪙 TA MISE USDT
            </label>

            <input
                id="betInput"
                type="number"
                min="${MINIMUM_BET}"
                step="0.000001"
                inputmode="decimal"
                placeholder="Exemple : 1, 2.50, 10..."
                value=""
                style="
                    width:100%;
                    box-sizing:border-box;
                    height:50px;
                    padding:0 14px;
                    border-radius:12px;
                    border:1px solid rgba(255,204,0,.35);
                    background:#090014;
                    color:#fff;
                    font-size:16px;
                    outline:none;
                "
            >

            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:800;
            ">
                👤 TON NOM
            </label>

            <input
                id="playerNameInput"
                type="text"
                maxlength="30"
                autocomplete="name"
                placeholder="Entre ton nom"
                value="${escapeHtml(playerName)}"
                style="
                    width:100%;
                    box-sizing:border-box;
                    height:50px;
                    padding:0 14px;
                    border-radius:12px;
                    border:1px solid rgba(193,60,255,.35);
                    background:#090014;
                    color:#fff;
                    font-size:15px;
                    outline:none;
                "
            >

            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:800;
            ">
                🔗 ADRESSE TRON
            </label>

            <input
                id="cryptoAddressInput"
                type="text"
                maxlength="34"
                autocomplete="off"
                placeholder="Ton adresse TRON (T...)"
                value="${escapeHtml(playerAddress)}"
                style="
                    width:100%;
                    box-sizing:border-box;
                    height:50px;
                    padding:0 14px;
                    border-radius:12px;
                    border:1px solid rgba(193,60,255,.35);
                    background:#090014;
                    color:#fff;
                    font-size:13px;
                    outline:none;
                "
            >

            <button
                id="connectWalletBtn"
                type="button"
                style="
                    width:100%;
                    min-height:48px;
                    border:none;
                    border-radius:12px;
                    background:linear-gradient(
                        135deg,
                        #7b2cff,
                        #c13cff
                    );
                    color:#fff;
                    font-weight:900;
                    font-size:14px;
                    cursor:pointer;
                "
            >
                🔗 CONNECTER TRONLINK
            </button>

            <div
                id="walletStatus"
                style="
                    font-size:12px;
                    color:#aaa;
                    text-align:center;
                    min-height:18px;
                "
            >
                Wallet non connecté
            </div>

            <label style="
                display:flex;
                align-items:flex-start;
                gap:10px;
                font-size:12px;
                color:#bbb;
                line-height:1.4;
                cursor:pointer;
            ">

                <input
                    id="termsCheckbox"
                    type="checkbox"
                    style="
                        width:18px;
                        height:18px;
                        flex:none;
                    "
                >

                <span>
                    J'accepte les
                    <a
                        href="./conditions.html"
                        target="_blank"
                        style="
                            color:#ffcc00;
                            text-decoration:none;
                        "
                    >
                        conditions d'utilisation
                    </a>
                    de Miltape World Challenge.
                </span>

            </label>

            <button
                id="payButton"
                type="button"
                disabled
                style="
                    width:100%;
                    min-height:55px;
                    border:none;
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
                    opacity:.45;
                    box-shadow:0 5px 0 #a84c00;
                "
            >
                🪙 PAYER ET JOUER
            </button>

            <div
                id="paymentStatus"
                style="
                    min-height:20px;
                    text-align:center;
                    font-size:12px;
                    color:#bbb;
                    line-height:1.5;
                "
            ></div>

        </div>
    `;

    openModal();

    const betInput =
        $("betInput");

    const nameInput =
        $("playerNameInput");

    const addressInput =
        $("cryptoAddressInput");

    const terms =
        $("termsCheckbox");

    const payButton =
        $("payButton");

    const connectButton =
        $("connectWalletBtn");

    const walletStatus =
        $("walletStatus");

    const paymentStatus =
        $("paymentStatus");

    function updateButton() {

        const amount =
            Number(
                betInput.value
            );

        const name =
            nameInput.value.trim();

        const address =
            addressInput.value.trim();

        const validAmount =
            Number.isFinite(amount) &&
            amount >= MINIMUM_BET;

        const validName =
            name.length >= 2;

        const validAddress =
            /^T[1-9A-HJ-NP-Za-km-z]{33}$/
                .test(address);

        const validTerms =
            terms.checked;

        const validWallet =
            Boolean(
                connectedWallet
            );

        const enabled =
            validAmount &&
            validName &&
            validAddress &&
            validTerms &&
            validWallet &&
            !paymentInProgress;

        payButton.disabled =
            !enabled;

        payButton.style.opacity =
            enabled
                ? "1"
                : ".45";

        payButton.style.cursor =
            enabled
                ? "pointer"
                : "not-allowed";

        if (validAmount) {

            payButton.textContent =
                `🪙 PAYER ${formatUsdt(amount)} USDT ET JOUER`;

        } else {

            payButton.textContent =
                "🪙 PAYER ET JOUER";
        }
    }

    [
        betInput,
        nameInput,
        addressInput,
        terms
    ].forEach(element => {

        element.addEventListener(
            "input",
            updateButton
        );

        element.addEventListener(
            "change",
            updateButton
        );
    });

    connectButton.addEventListener(
        "click",
        async () => {

            const address =
                await connectTronLink();

            if (address) {

                addressInput.value =
                    address;

                playerAddress =
                    address;

                localStorage.setItem(
                    "miltape_player_address",
                    address
                );

                walletStatus.innerHTML =
                    `🟢 Wallet connecté : <strong style="color:#2ecc71">${escapeHtml(shortAddress(address))}</strong>`;

                updateButton();

            } else {

                walletStatus.innerHTML =
                    `<span style="color:#ff6b6b">
                        ❌ TronLink non détecté.
                        Ouvre Miltape dans le navigateur DApp de TronLink.
                    </span>`;
            }
        }
    );

    addressInput.addEventListener(
        "input",
        () => {

            playerAddress =
                addressInput.value.trim();

            updateButton();
        }
    );

    payButton.addEventListener(
        "click",
        async () => {

            const amount =
                Number(
                    betInput.value
                );

            const name =
                nameInput.value.trim();

            const address =
                addressInput.value.trim();

            if (
                !Number.isFinite(amount) ||
                amount < MINIMUM_BET
            ) {

                paymentStatus.textContent =
                    `❌ Mise minimum : ${MINIMUM_BET} USDT`;

                return;
            }

            if (
                name.length < 2
            ) {

                paymentStatus.textContent =
                    "❌ Entre ton nom.";

                return;
            }

            if (
                !/^T[1-9A-HJ-NP-Za-km-z]{33}$/
                    .test(address)
            ) {

                paymentStatus.textContent =
                    "❌ Adresse TRON invalide.";

                return;
            }

            if (!terms.checked) {

                paymentStatus.textContent =
                    "❌ Tu dois accepter les conditions.";

                return;
            }

            playerName =
                name;

            playerAddress =
                address;

            localStorage.setItem(
                "miltape_player_name",
                playerName
            );

            localStorage.setItem(
                "miltape_player_address",
                playerAddress
            );

            paymentInProgress =
                true;

            payButton.disabled =
                true;

            payButton.style.opacity =
                ".5";

            paymentStatus.innerHTML =
                "⏳ Connexion à TronLink...";

            try {

                const wallet =
                    await connectTronLink();

                if (!wallet) {

                    throw new Error(
                        "TRONLINK_NOT_DETECTED"
                    );
                }

                if (
                    wallet.toLowerCase() !==
                    address.toLowerCase()
                ) {

                    throw new Error(
                        "WALLET_ADDRESS_MISMATCH"
                    );
                }

                connectedWallet =
                    wallet;

                paymentStatus.innerHTML =
                    "⏳ Ouverture de la transaction USDT...";

                const txid =
                    await sendUsdtPayment(
                        amount
                    );

                if (!txid) {

                    throw new Error(
                        "TXID_NOT_FOUND"
                    );
                }

                paymentStatus.innerHTML =
                    `
                    <span style="color:#ffcc00">
                        ⏳ Paiement envoyé.<br>
                        Vérification de la transaction...
                    </span>
                    `;

                const result =
                    await verifyPayment(
                        amount,
                        txid,
                        address,
                        name
                    );

                if (
                    !result.success
                ) {

                    throw new Error(
                        result.message ||
                        "PAYMENT_VERIFICATION_FAILED"
                    );
                }

                selectedBet =
                    amount;

                joinedGame =
                    true;

                displayBet.textContent =
                    "$" +
                    formatUsdt(amount);

                tapButton.disabled =
                    false;

                showMessage(
                    "🟢 PAIEMENT VALIDÉ — TU PEUX JOUER !"
                );

                paymentStatus.innerHTML =
                    `
                    <span style="
                        color:#2ecc71;
                        font-weight:900;
                    ">
                        ✅ Paiement validé !<br>
                        🎮 Tu peux maintenant jouer.
                    </span>
                    `;

                joinSocketGame();

                setTimeout(
                    closeModal,
                    1200
                );

            } catch (error) {

                console.error(
                    "Payment error:",
                    error
                );

                if (
                    error.message ===
                    "TRONLINK_NOT_DETECTED"
                ) {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ TronLink n'est pas détecté.<br><br>

                            Ouvre <strong>Miltape</strong>
                            directement dans le
                            <strong>navigateur DApp de TronLink</strong>.
                        </span>
                        `;

                } else if (
                    error.message ===
                    "WALLET_ADDRESS_MISMATCH"
                ) {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ L'adresse saisie ne correspond
                            pas au wallet TronLink connecté.
                        </span>
                        `;

                } else {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ ${escapeHtml(
                                error.message ||
                                "Paiement annulé."
                            )}
                        </span>
                        `;
                }

            } finally {

                paymentInProgress =
                    false;

                updateButton();
            }
        }
    );

    updateButton();

    /*
    Tentative automatique de détection
    */

    setTimeout(
        async () => {

            const wallet =
                await getTronLinkAddress();

            if (wallet) {

                connectedWallet =
                    wallet;

                addressInput.value =
                    wallet;

                playerAddress =
                    wallet;

                localStorage.setItem(
                    "miltape_player_address",
                    wallet
                );

                walletStatus.innerHTML =
                    `
                    🟢 TronLink détecté :
                    <strong style="color:#2ecc71">
                        ${escapeHtml(
                            shortAddress(wallet)
                        )}
                    </strong>
                    `;

                updateButton();
            }

        },
        500
    );
}

/* =========================================================
   TRONLINK
========================================================= */

async function getTronLinkAddress() {

    try {

        /*
        TronLink injecte généralement
        tronWeb / tronLink.
        */

        if (
            window.tronWeb &&
            window.tronWeb.defaultAddress &&
            window.tronWeb.defaultAddress.base58
        ) {

            return window.tronWeb
                .defaultAddress
                .base58;
        }

        if (
            window.tronLink &&
            window.tronLink.tronWeb &&
            window.tronLink.tronWeb.defaultAddress &&
            window.tronLink.tronWeb.defaultAddress.base58
        ) {

            return window.tronLink
                .tronWeb
                .defaultAddress
                .base58;
        }

        return "";

    } catch (error) {

        console.error(
            "TronLink detection:",
            error
        );

        return "";
    }
}

async function connectTronLink() {

    /*
    Vérification immédiate
    */

    let address =
        await getTronLinkAddress();

    if (address) {

        connectedWallet =
            address;

        return address;
    }

    /*
    Demande de connexion TronLink
    */

    if (
        window.tronLink &&
        typeof window.tronLink.request ===
            "function"
    ) {

        try {

            await window.tronLink.request(
                {
                    method:
                        "tron_requestAccounts"
                }
            );

        } catch (error) {

            console.error(
                "TronLink request:",
                error
            );

            return "";
        }
    }

    /*
    Attendre injection
    */

    for (
        let i = 0;
        i < 15;
        i++
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    300
                )
        );

        address =
            await getTronLinkAddress();

        if (address) {

            connectedWallet =
                address;

            return address;
        }
    }

    return "";
}

/* =========================================================
   PAIEMENT USDT TRC20
========================================================= */

async function sendUsdtPayment(
    amount
) {

    const tron =
        window.tronWeb ||
        window.tronLink?.tronWeb;

    if (!tron) {

        throw new Error(
            "TRONLINK_NOT_DETECTED"
        );
    }

    const from =
        tron.defaultAddress?.base58;

    if (!from) {

        throw new Error(
            "WALLET_NOT_CONNECTED"
        );
    }

    /*
    Vérifier réseau
    */

    try {

        const network =
            await tron.trx.getChainParameters();

        console.log(
            "TRON network:",
            network
        );

    } catch (error) {

        console.warn(
            "Impossible de lire le réseau TRON.",
            error
        );
    }

    /*
    Montant en unités USDT
    */

    const units =
        Math.round(
            Number(amount) *
            Math.pow(
                10,
                USDT_DECIMALS
            )
        );

    if (
        !Number.isSafeInteger(units) ||
        units <= 0
    ) {

        throw new Error(
            "MONTANT_INVALIDE"
        );
    }

    /*
    Récupérer contrat USDT
    */

    const contract =
        await tron.contract().at(
            USDT_CONTRACT
        );

    /*
    Effectuer Transfer
    */

    const txid =
        await contract
            .transfer(
                MILTAPE_WALLET,
                units
            )
            .send(
                {
                    feeLimit:
                        100000000
                }
            );

    if (!txid) {

        throw new Error(
            "TRANSACTION_NON_CONFIRMEE"
        );
    }

    console.log(
        "USDT TXID:",
        txid
    );

    return txid;
}

/* =========================================================
   VÉRIFICATION BACKEND
========================================================= */

async function verifyPayment(
    amount,
    txid,
    address,
    name
) {

    const response =
        await fetch(
            API_URL +
            "/api/verify-payment",
            {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        {

                            playerId,

                            playerName:
                                name,

                            txid,

                            amount,

                            cryptoAddress:
                                address
                        }
                    )
            }
        );

    const data =
        await response
            .json()
            .catch(
                () => ({})
            );

    if (!response.ok) {

        throw new Error(
            data.message ||
            "Vérification du paiement impossible."
        );
    }

    return data;
}

/* =========================================================
   SOCKET
========================================================= */

function connectSocket() {

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

            if (joinedGame) {

                joinSocketGame();
            }
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

    socket.on(
        "initGame",
        data => {

            if (!data) {
                return;
            }

            gameId =
                Number(
                    data.gameId ||
                    gameId
                );

            gameRunning =
                Boolean(
                    data.gameRunning
                );

            updateTimer(
                data.timerLeft
            );

            renderLeaderboard(
                data.leaderboard ||
                []
            );

            if (
                data.joined
            ) {

                joinedGame =
                    true;

                tapButton.disabled =
                    false;
            }
        }
    );

    socket.on(
        "timer",
        time => {

            updateTimer(time);
        }
    );

    socket.on(
        "timer:update",
        data => {

            if (data) {

                if (
                    data.gameId !==
                    undefined
                ) {

                    gameId =
                        Number(
                            data.gameId
                        );
                }

                updateTimer(
                    data.timeLeft
                );
            }
        }
    );

    socket.on(
        "timerUpdate",
        data => {

            updateTimer(
                data?.timerLeft
            );
        }
    );

    socket.on(
        "leaderboard",
        leaderboard => {

            renderLeaderboard(
                leaderboard || []
            );
        }
    );

    socket.on(
        "leaderboard:update",
        leaderboard => {

            renderLeaderboard(
                leaderboard || []
            );
        }
    );

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

    socket.on(
        "score:update",
        data => {

            if (
                data?.playerId ===
                playerId
            ) {

                tapCount =
                    Number(
                        data.score || 0
                    );

                updateTapDisplay();
            }
        }
    );

    socket.on(
        "tapResult",
        data => {

            if (
                data?.success
            ) {

                tapCount =
                    Number(
                        data.score || 0
                    );

                updateTapDisplay();

            } else if (
                data?.message
            ) {

                showMessage(
                    "⚠️ " +
                    data.message
                );
            }
        }
    );

    socket.on(
        "gameOver",
        data => {

            gameRunning =
                false;

            tapButton.disabled =
                true;

            showMessage(
                "🏁 PARTIE TERMINÉE — ATTENDS LA PROCHAINE !"
            );

            if (
                data?.winners
            ) {

                renderLeaderboard(
                    data.winners
                );
            }
        }
    );

    socket.on(
        "newGame",
        data => {

            gameId =
                Number(
                    data?.gameId ||
                    gameId + 1
                );

            tapCount =
                0;

            updateTapDisplay();

            gameRunning =
                true;

            if (joinedGame) {

                tapButton.disabled =
                    false;
            }

            showMessage(
                "🎮 NOUVELLE PARTIE !"
            );
        }
    );

    socket.on(
        "game:new",
        data => {

            gameId =
                Number(
                    data?.gameId ||
                    gameId
                );
        }
    );

    socket.on(
        "gameStart",
        data => {

            gameId =
                Number(
                    data?.gameId ||
                    gameId
                );

            gameRunning =
                true;

            if (joinedGame) {

                tapButton.disabled =
                    false;
            }
        }
    );

    socket.on(
        "chatHistory",
        messages => {

            renderChatHistory(
                messages || []
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
}

/* =========================================================
   JOIN SOCKET
========================================================= */

function joinSocketGame() {

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

            playerName:
                playerName
        }
    );
}

/* =========================================================
   TAP
========================================================= */

if (tapButton) {

    tapButton.addEventListener(
        "pointerdown",
        event => {

            event.preventDefault();

            if (
                tapButton.disabled ||
                !joinedGame ||
                !socket ||
                !socket.connected
            ) {

                return;
            }

            socket.emit(
                "tap",
                {

                    playerId
                }
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
        }
    );
}

/* =========================================================
   AFFICHAGE TAPS
========================================================= */

function updateTapDisplay() {

    if (tapCountElement) {

        tapCountElement.textContent =
            formatNumber(
                tapCount
            );
    }

    if (tapButtonCount) {

        tapButtonCount.textContent =
            formatNumber(
                tapCount
            );
    }
}

/* =========================================================
   TIMER
========================================================= */

function updateTimer(
    seconds
) {

    const value =
        Math.max(
            0,
            Number(seconds || 0)
        );

    const minutes =
        Math.floor(
            value / 60
        );

    const secs =
        value % 60;

    if (timerElement) {

        timerElement.textContent =
            String(minutes)
                .padStart(2, "0") +
            ":" +
            String(secs)
                .padStart(2, "0");
    }
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

        <span
            style="
                display:inline-block;
                width:8px;
                height:8px;
                background:#2ecc71;
                border-radius:50%;
                margin-right:5px;
            "
        ></span>

        <span>
            ${formatNumber(count)}
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

    globalTotalStakes.textContent =
        "$" +
        formatUsdt(total);
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

        leaderboardList.innerHTML =
            `
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

                    const medals = [
                        "🥇",
                        "🥈",
                        "🥉",
                        "🏅",
                        "🏅"
                    ];

                    return `
                        <div
                            class="ranking-row"
                            style="
                                display:flex;
                                align-items:center;
                                gap:10px;
                                padding:10px;
                                margin-bottom:6px;
                                border-radius:10px;
                                background:rgba(255,255,255,.035);
                            "
                        >

                            <strong
                                style="
                                    width:30px;
                                    font-size:20px;
                                "
                            >
                                ${medals[index]}
                            </strong>

                            <div
                                style="
                                    flex:1;
                                    min-width:0;
                                "
                            >
                                <strong
                                    style="
                                        display:block;
                                        color:#fff;
                                        overflow:hidden;
                                        text-overflow:ellipsis;
                                        white-space:nowrap;
                                    "
                                >
                                    ${escapeHtml(
                                        player.playerName ||
                                        "Anonyme"
                                    )}
                                </strong>

                                <small
                                    style="
                                        color:#999;
                                    "
                                >
                                    Mise :
                                    ${formatUsdt(
                                        player.amount
                                    )}
                                    USDT
                                </small>
                            </div>

                            <strong
                                style="
                                    color:#ffcc00;
                                    font-size:18px;
                                "
                            >
                                ${formatNumber(
                                    player.score
                                )}
                            </strong>

                        </div>
                    `;
                }
            )
            .join("");
}

/* =========================================================
   CHAT
========================================================= */

function renderChatHistory(
    messages
) {

    if (!chatMessages) {
        return;
    }

    chatMessages.innerHTML = "";

    messages.forEach(
        addChatMessage
    );
}

function addChatMessage(
    data
) {

    if (
        !chatMessages ||
        !data
    ) {

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

function sendChat() {

    const message =
        chatInput?.value.trim();

    if (
        !message ||
        !socket ||
        !socket.connected
    ) {

        return;
    }

    socket.emit(
        "chatMessage",
        {

            playerId,

            playerName:
                playerName ||
                "Anonyme",

            message
        }
    );

    chatInput.value = "";
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
   BOUTON JOUER
========================================================= */

if (enterChallenge) {

    enterChallenge.addEventListener(
        "click",
        () => {

            openChallengeForm();
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

function openSideMenu() {

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
   MENU ACTIONS
========================================================= */

$("menuChatBtn")?.addEventListener(
    "click",
    () => {

        closeSideMenu();

        $("globalChat")?.scrollIntoView(
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

        closeSideMenu();

        dynamicModalTitle.textContent =
            "📜 Règles Miltape";

        dynamicModalBody.innerHTML = `

            <p>
                ⏱️ Chaque partie dure
                <strong>10 minutes</strong>.
            </p>

            <p>
                🏆 Les <strong>5 meilleurs joueurs</strong>
                sont classés.
            </p>

            <p>
                🪙 Les participations sont en
                <strong>USDT TRC20</strong>.
            </p>

            <p>
                ⚡ Chaque tap augmente ton score.
            </p>

        `;

        openModal();
    }
);

$("menuGamesBtn")?.addEventListener(
    "click",
    () => {

        closeSideMenu();

        showMessage(
            "🎮 Ta partie actuelle : #" +
            gameId
        );
    }
);

$("menuRankingsBtn")?.addEventListener(
    "click",
    () => {

        closeSideMenu();

        document
            .querySelector(
                ".leaderboard"
            )
            ?.scrollIntoView(
                {
                    behavior:
                        "smooth"
                }
            );
    }
);

/* =========================================================
   STATUS BACKEND
========================================================= */

async function loadInitialStatus() {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/status"
            );

        const data =
            await response.json();

        if (!data.success) {
            return;
        }

        gameId =
            Number(
                data.gameId ||
                gameId
            );

        gameRunning =
            Boolean(
                data.gameRunning
            );

        updateTimer(
            data.timerLeft
        );

        updateOnline(
            data.online || 0
        );

        updateTotalStakes(
            data.totalStakes || 0
        );

        if (
            data.saturdayJackpot
        ) {

            console.log(
                "Saturday Jackpot:",
                data.saturdayJackpot
            );
        }

    } catch (error) {

        console.error(
            "Backend status:",
            error
        );
    }
}

/* =========================================================
   INIT
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        updateTapDisplay();

        updateTimer(
            GAME_DURATION
        );

        loadInitialStatus();

        connectSocket();

        /*
        Si joueur déjà payé dans cette session,
        on laisse le socket vérifier.
        */

        if (
            localStorage.getItem(
                "miltape_joined"
            ) === "true"
        ) {

            /*
            On ne déverrouille PAS directement le bouton.
            Le backend doit confirmer la participation.
            */
        }

        console.log(
            "🔥 Miltape frontend chargé"
        );
    }
);
