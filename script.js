/* =========================================================
   MILTAPE WORLD CHALLENGE
   SCRIPT FRONTEND COMPLET
   Version sécurité wallet
========================================================= */

"use strict";

/* =========================================================
   CONFIG
========================================================= */

const API_URL =
    "https://miltape-backend-production.up.railway.app";

const SOCKET_URL = API_URL;

const MILTAPE_WALLET =
    "TBZZ3nakc3w5SnJ1EZpvVWYWY3q1NffNPM";

const USDT_CONTRACT =
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MINIMUM_BET = 1;

const MAXIMUM_BET = 1000000;

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

    dynamicModal?.classList.add("show");

    document.body.style.overflow =
        "hidden";
}


function closeModal() {

    dynamicModal?.classList.remove("show");

    document.body.style.overflow =
        "";
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
   VALIDATION TRON
========================================================= */

function isValidTronAddress(address) {

    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
        .test(address);
}


/* =========================================================
   FORMULAIRE JOUER
========================================================= */

function openChallengeForm() {

    connectedWallet = "";

    dynamicModalTitle.textContent =
        "🎮 Rejoindre la partie";

    dynamicModalBody.innerHTML = `

        <div style="
            display:flex;
            flex-direction:column;
            gap:14px;
        ">

            <div style="
                padding:13px;
                border-radius:12px;
                background:rgba(255,204,0,.08);
                border:1px solid rgba(255,204,0,.25);
                color:#ddd;
                font-size:13px;
                line-height:1.5;
            ">

                🏆
                <strong style="color:#ffcc00;">
                    MILTAPE WORLD CHALLENGE
                </strong>

                <br><br>

                Choisis librement le montant
                de ta participation.

                <br>

                Minimum :
                <strong style="color:#ffcc00;">
                    ${MINIMUM_BET} USDT
                </strong>

                <br>

                Maximum :
                <strong style="color:#ffcc00;">
                    ${formatNumber(MAXIMUM_BET)} USDT
                </strong>

            </div>


            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:900;
            ">
                🪙 TA MISE USDT
            </label>

            <input
                id="betInput"
                type="number"
                min="${MINIMUM_BET}"
                max="${MAXIMUM_BET}"
                step="0.000001"
                inputmode="decimal"
                placeholder="Exemple : 1, 2.50, 10..."
                value=""
                style="
                    width:100%;
                    box-sizing:border-box;
                    height:52px;
                    padding:0 14px;
                    border-radius:12px;
                    border:1px solid rgba(255,204,0,.40);
                    background:#090014;
                    color:#fff;
                    font-size:17px;
                    outline:none;
                "
            >


            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:900;
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
                    height:52px;
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
                font-weight:900;
            ">
                🔗 TON WALLET TRON
            </label>

            <div
                id="walletBox"
                style="
                    width:100%;
                    box-sizing:border-box;
                    min-height:54px;
                    padding:12px;
                    border-radius:12px;
                    border:1px solid rgba(193,60,255,.35);
                    background:#090014;
                    color:#aaa;
                    font-size:12px;
                    line-height:1.4;
                    word-break:break-all;
                "
            >
                Wallet non connecté
            </div>


            <button
                id="connectWalletBtn"
                type="button"
                style="
                    width:100%;
                    min-height:50px;
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
                    box-shadow:0 4px 0 #43137d;
                "
            >
                🔗 CONNECTER TRONLINK
            </button>


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
                        accent-color:#ffcc00;
                    "
                >

                <span>

                    J'accepte les

                    <a
                        href="./conditions.html"
                        target="_blank"
                        rel="noopener noreferrer"
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
                    min-height:56px;
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
                    cursor:not-allowed;
                    opacity:.45;
                    box-shadow:0 5px 0 #a84c00;
                "
            >
                🪙 PAYER ET JOUER
            </button>


            <div
                id="paymentStatus"
                style="
                    min-height:22px;
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

    const terms =
        $("termsCheckbox");

    const payButton =
        $("payButton");

    const connectButton =
        $("connectWalletBtn");

    const walletBox =
        $("walletBox");

    const paymentStatus =
        $("paymentStatus");


    /* =====================================================
       BOUTON
    ===================================================== */

    function updateButton() {

        const amount =
            Number(
                betInput.value
            );

        const name =
            nameInput.value.trim();

        const validAmount =
            Number.isFinite(amount) &&
            amount >= MINIMUM_BET &&
            amount <= MAXIMUM_BET;

        const validName =
            name.length >= 2;

        const validWallet =
            isValidTronAddress(
                connectedWallet
            );

        const validTerms =
            terms.checked;

        const enabled =
            validAmount &&
            validName &&
            validWallet &&
            validTerms &&
            !paymentInProgress;

        payButton.disabled =
            !enabled;

        payButton.style.opacity =
            enabled ? "1" : ".45";

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


    betInput.addEventListener(
        "input",
        updateButton
    );


    nameInput.addEventListener(
        "input",
        () => {

            playerName =
                nameInput.value.trim();

            updateButton();
        }
    );


    terms.addEventListener(
        "change",
        updateButton
    );


    /* =====================================================
       CONNECT TRONLINK
    ===================================================== */

    connectButton.addEventListener(
        "click",
        async () => {

            connectButton.disabled =
                true;

            connectButton.textContent =
                "⏳ CONNEXION...";

            walletBox.innerHTML =
                `
                <span style="color:#ffcc00">
                    Recherche de TronLink...
                </span>
                `;

            try {

                const wallet =
                    await connectTronLink();

                if (!wallet) {

                    walletBox.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ TronLink n'est pas détecté.
                            <br><br>
                            Ouvre Miltape directement
                            dans le navigateur DApp
                            de TronLink.
                        </span>
                        `;

                    return;
                }


                if (
                    playerAddress &&
                    playerAddress.toLowerCase() !==
                    wallet.toLowerCase()
                ) {

                    connectedWallet = "";

                    walletBox.innerHTML =
                        `
                        <span style="
                            color:#ff6b6b;
                            font-weight:900;
                        ">

                            ⚠️ ADRESSE WALLET MODIFIÉE

                        </span>

                        <br><br>

                        <span style="color:#aaa;">

                            Cette adresse est différente
                            de ton adresse enregistrée.

                        </span>

                        <br><br>

                        <span style="color:#ffcc00;">

                            🔒 Paiement bloqué.

                        </span>
                        `;

                    updateButton();

                    return;
                }


                connectedWallet =
                    wallet;

                playerAddress =
                    wallet;

                localStorage.setItem(
                    "miltape_player_address",
                    wallet
                );


                walletBox.innerHTML =
                    `
                    <span style="
                        color:#2ecc71;
                        font-weight:900;
                    ">
                        🟢 WALLET CONNECTÉ
                    </span>

                    <br>

                    <span style="color:#aaa;">
                        ${escapeHtml(wallet)}
                    </span>
                    `;


                connectButton.textContent =
                    "🟢 TRONLINK CONNECTÉ";

                connectButton.style.background =
                    "linear-gradient(135deg,#159957,#2ecc71)";


                updateButton();

            } catch (error) {

                console.error(
                    "Connexion TronLink:",
                    error
                );

                walletBox.innerHTML =
                    `
                    <span style="color:#ff6b6b">
                        ❌ Connexion annulée.
                    </span>
                    `;

            } finally {

                connectButton.disabled =
                    false;

                if (connectedWallet) {

                    connectButton.textContent =
                        "🟢 TRONLINK CONNECTÉ";

                } else {

                    connectButton.textContent =
                        "🔗 CONNECTER TRONLINK";
                }

                updateButton();
            }
        }
    );


    /* =====================================================
       PAIEMENT
    ===================================================== */

    payButton.addEventListener(
        "click",
        async () => {

            const amount =
                Number(
                    betInput.value
                );

            const name =
                nameInput.value.trim();


            if (
                !Number.isFinite(amount) ||
                amount < MINIMUM_BET ||
                amount > MAXIMUM_BET
            ) {

                paymentStatus.innerHTML =
                    `
                    <span style="color:#ff6b6b">
                        ❌ Mise entre
                        ${MINIMUM_BET}
                        et
                        ${formatNumber(MAXIMUM_BET)}
                        USDT.
                    </span>
                    `;

                return;
            }


            if (name.length < 2) {

                paymentStatus.innerHTML =
                    `
                    <span style="color:#ff6b6b">
                        ❌ Entre ton nom.
                    </span>
                    `;

                return;
            }


            if (
                !isValidTronAddress(
                    connectedWallet
                )
            ) {

                paymentStatus.innerHTML =
                    `
                    <span style="color:#ff6b6b">
                        ❌ Connecte d'abord TronLink.
                    </span>
                    `;

                return;
            }


            if (!terms.checked) {

                paymentStatus.innerHTML =
                    `
                    <span style="color:#ff6b6b">
                        ❌ Tu dois accepter les conditions.
                    </span>
                    `;

                return;
            }


            const walletBeforePayment =
                connectedWallet;


            playerName =
                name;

            playerAddress =
                walletBeforePayment;


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
                `
                <span style="color:#ffcc00">
                    ⏳ Préparation du paiement...
                </span>
                `;


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
                    walletBeforePayment.toLowerCase()
                ) {

                    throw new Error(
                        "WALLET_ADDRESS_CHANGED"
                    );
                }


                if (
                    playerAddress.toLowerCase() !==
                    wallet.toLowerCase()
                ) {

                    throw new Error(
                        "WALLET_ADDRESS_CHANGED"
                    );
                }


                connectedWallet =
                    wallet;


                paymentStatus.innerHTML =
                    `
                    <span style="color:#ffcc00">
                        ⏳ Ouverture de TronLink...
                        <br>
                        Confirme ${formatUsdt(amount)} USDT
                    </span>
                    `;


                const txid =
                    await sendUsdtPayment(
                        amount,
                        wallet
                    );


                if (!txid) {

                    throw new Error(
                        "TXID_NOT_FOUND"
                    );
                }


                paymentStatus.innerHTML =
                    `
                    <span style="color:#ffcc00">
                        ⏳ Paiement envoyé.
                        <br>
                        Vérification blockchain...
                    </span>
                    `;


                const result =
                    await verifyPayment(
                        amount,
                        txid,
                        wallet,
                        name
                    );


                if (
                    !result ||
                    !result.success
                ) {

                    throw new Error(
                        result?.message ||
                        "PAYMENT_VERIFICATION_FAILED"
                    );
                }


                selectedBet =
                    amount;

                joinedGame =
                    true;


                localStorage.setItem(
                    "miltape_joined",
                    "true"
                );


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
                        ✅ PAIEMENT VALIDÉ !
                        <br><br>
                        🎮 TU PEUX JOUER !
                    </span>
                    `;


                joinSocketGame();


                setTimeout(
                    closeModal,
                    1300
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
                            ❌ TronLink n'est pas détecté.
                        </span>
                        `;

                } else if (
                    error.message ===
                    "USER_REJECTED"
                ) {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ Transaction annulée.
                        </span>
                        `;

                } else if (
                    error.message ===
                    "WALLET_ADDRESS_CHANGED"
                ) {

                    paymentStatus.innerHTML =
                        `
                        <span style="
                            color:#ff6b6b;
                            font-weight:900;
                        ">
                            ⚠️ ADRESSE WALLET MODIFIÉE
                            <br><br>
                            🔒 Paiement bloqué par sécurité.
                            <br><br>
                            L'adresse utilisée doit rester
                            identique pendant toute la procédure.
                        </span>
                        `;

                } else if (
                    error.message ===
                    "PAYMENT_ALREADY_USED"
                ) {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌ Cette transaction a déjà été utilisée.
                        </span>
                        `;

                } else {

                    paymentStatus.innerHTML =
                        `
                        <span style="color:#ff6b6b">
                            ❌
                            ${escapeHtml(
                                error.message ||
                                "Paiement refusé."
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


    /* =====================================================
       DETECTION AUTOMATIQUE
    ===================================================== */

    setTimeout(
        async () => {

            try {

                const wallet =
                    await getTronLinkAddress();

                if (!wallet) {
                    return;
                }


                if (
                    playerAddress &&
                    playerAddress.toLowerCase() !==
                    wallet.toLowerCase()
                ) {

                    walletBox.innerHTML =
                        `
                        <span style="
                            color:#ff6b6b;
                            font-weight:900;
                        ">
                            ⚠️ ADRESSE DIFFÉRENTE
                        </span>

                        <br><br>

                        <span style="color:#aaa;">
                            L'adresse TronLink actuelle
                            ne correspond pas à ton wallet
                            enregistré.
                        </span>
                        `;

                    return;
                }


                connectedWallet =
                    wallet;

                playerAddress =
                    wallet;


                localStorage.setItem(
                    "miltape_player_address",
                    wallet
                );


                walletBox.innerHTML =
                    `
                    <span style="
                        color:#2ecc71;
                        font-weight:900;
                    ">
                        🟢 TRONLINK DÉTECTÉ
                    </span>

                    <br>

                    <span style="color:#aaa;">
                        ${escapeHtml(
                            shortAddress(wallet)
                        )}
                    </span>
                    `;


                connectButton.textContent =
                    "🟢 TRONLINK CONNECTÉ";


                connectButton.style.background =
                    "linear-gradient(135deg,#159957,#2ecc71)";


                updateButton();

            } catch (error) {

                console.log(
                    "TronLink automatique:",
                    error
                );
            }

        },
        700
    );


    updateButton();
}


/* =========================================================
   TRONLINK DETECTION
========================================================= */

async function getTronLinkAddress() {

    try {

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


/* =========================================================
   TRONLINK CONNEXION
========================================================= */

async function connectTronLink() {

    let address =
        await getTronLinkAddress();


    if (address) {

        if (
            !isValidTronAddress(address)
        ) {

            throw new Error(
                "INVALID_TRON_ADDRESS"
            );
        }

        return address;
    }


    if (
        window.tronLink &&
        typeof window.tronLink.request ===
        "function"
    ) {

        try {

            await window.tronLink.request({
                method:
                    "tron_requestAccounts"
            });

        } catch (error) {

            console.error(
                "TronLink request:",
                error
            );

            if (
                error?.code === 4001 ||
                error?.message
                    ?.toLowerCase()
                    ?.includes("reject")
            ) {

                throw new Error(
                    "USER_REJECTED"
                );
            }

            return "";
        }
    }


    for (
        let i = 0;
        i < 20;
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

            if (
                !isValidTronAddress(address)
            ) {

                throw new Error(
                    "INVALID_TRON_ADDRESS"
                );
            }

            return address;
        }
    }


    return "";
}


/* =========================================================
   PAIEMENT USDT TRC20
========================================================= */

async function sendUsdtPayment(
    amount,
    expectedWallet
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


    if (
        expectedWallet &&
        from.toLowerCase() !==
        expectedWallet.toLowerCase()
    ) {

        throw new Error(
            "WALLET_ADDRESS_CHANGED"
        );
    }


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


    const contract =
        await tron
            .contract()
            .at(
                USDT_CONTRACT
            );


    let txid;


    try {

        txid =
            await contract
                .transfer(
                    MILTAPE_WALLET,
                    units
                )
                .send({
                    feeLimit:
                        100000000,
                    shouldPollResponse:
                        true
                });

    } catch (error) {

        console.error(
            "USDT transfer:",
            error
        );


        if (
            error?.code === 4001 ||
            error?.message
                ?.toLowerCase()
                ?.includes("reject")
        ) {

            throw new Error(
                "USER_REJECTED"
            );
        }


        throw error;
    }


    if (
        typeof txid === "object" &&
        txid?.txid
    ) {

        txid =
            txid.txid;
    }


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
   VERIFICATION BACKEND
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

                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        playerId,

                        playerName:
                            name,

                        txid,

                        amount,

                        cryptoAddress:
                            address
                    })
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
   SOCKET.IO
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


            if (data.joined) {

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

            if (!data) {
                return;
            }


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

            updateOnline(count);
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

            updateTotalStakes(total);
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


            if (data?.winners) {

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


    /* =====================================================
       CHAT
       UNE SEULE ÉCOUTE POUR ÉVITER LE DOUBLE AFFICHAGE
    ===================================================== */

    socket.on(
        "chatMessage",
        message => {

            addChatMessage(
                message
            );
        }
    );

}


/* =========================================================
   JOIN GAME
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
                playerName,

            amount:
                selectedBet,

            cryptoAddress:
                playerAddress
        }
    );
}


/* =========================================================
   TAP
========================================================= */

tapButton?.addEventListener(
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


/* =========================================================
   TAP DISPLAY
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


chatSend?.addEventListener(
    "click",
    sendChat
);


chatInput?.addEventListener(
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


/* =========================================================
   BOUTON JOUER
========================================================= */

enterChallenge?.addEventListener(
    "click",
    openChallengeForm
);


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
   MENU CHAT
========================================================= */

$("menuChatBtn")?.addEventListener(
    "click",
    () => {

        closeSideMenu();

        $("globalChat")?.scrollIntoView({
            behavior:
                "smooth"
        });
    }
);


/* =========================================================
   MENU RULES
========================================================= */

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
                🏆 Les
                <strong>
                    5 meilleurs joueurs
                </strong>
                sont classés.
            </p>

            <p>
                🪙 Les participations sont en
                <strong>
                    USDT TRC20
                </strong>.
            </p>

            <p>
                ⚡ Chaque tap augmente ton score.
            </p>

        `;


        openModal();
    }
);


/* =========================================================
   MENU PARTIES
========================================================= */

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


/* =========================================================
   MENU CLASSEMENT
========================================================= */

$("menuRankingsBtn")?.addEventListener(
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


        console.log(
            "Miltape status:",
            data
        );

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

        await loadInitialStatus();

        connectSocket();

        console.log(
            "🔥 MILTAPE FRONTEND CHARGÉ"
        );
    }
);
