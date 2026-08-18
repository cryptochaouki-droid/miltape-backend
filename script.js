/* =========================================================
   MILTAPE WORLD CHALLENGE
   SCRIPT FRONTEND COMPLET - INTÉGRATION TELEGRAM & TRON
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
   INTEGRATION TELEGRAM WEBAPP
========================================================= */

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

const tgUser = tg?.initDataUnsafe?.user;
const telegramId = tgUser ? tgUser.id : null;


/* =========================================================
   ETAT
========================================================= */

let socket = null;

let playerId =
    localStorage.getItem("miltape_player_id");

if (!playerId) {

    playerId =
        (telegramId ? "tg_" + telegramId : "player_" + Date.now()) +
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
    ) || (tgUser ? (tgUser.first_name || tgUser.username) : "");

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

let selectedPaymentMethod = "tron"; // "tron" ou "stars"


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
   VALIDATION TRON (INDÉPENDANTE DE TRONWEB)
========================================================= */

function isValidTronAddress(address) {
    if (!address || typeof address !== "string") {
        return false;
    }
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}


/* =========================================================
   FORMULAIRE JOUER
========================================================= */

function openChallengeForm() {

    connectedWallet = "";
    selectedPaymentMethod = "tron";

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
                    ${MINIMUM_BET} USDT / Stars
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
                🪙 MODE DE PAIEMENT
            </label>

            <div style="display:flex; gap:10px;">
                <button
                    type="button"
                    id="payMethodTron"
                    style="
                        flex:1;
                        min-height:44px;
                        border-radius:10px;
                        border:2px solid #ffcc00;
                        background:#ffcc00;
                        color:#16051f;
                        font-weight:900;
                        cursor:pointer;
                        font-size:13px;
                    "
                >
                    🔗 TronLink (USDT)
                </button>
                <button
                    type="button"
                    id="payMethodStars"
                    style="
                        flex:1;
                        min-height:44px;
                        border-radius:10px;
                        border:2px solid rgba(255,204,0,.4);
                        background:#090014;
                        color:#fff;
                        font-weight:900;
                        cursor:pointer;
                        font-size:13px;
                    "
                >
                    ⭐ Telegram Stars
                </button>
            </div>


            <label style="
                color:#ffcc00;
                font-size:13px;
                font-weight:900;
            ">
                🪙 TA MISE
            </label>

            <input
                id="betInput"
                type="number"
                min="${MINIMUM_BET}"
                max="${MAXIMUM_BET}"
                step="1"
                inputmode="decimal"
                placeholder="Exemple : 1, 10, 50..."
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


            <div id="tronSection">
                <label style="
                    color:#ffcc00;
                    font-size:13px;
                    font-weight:900;
                ">
                    🔗 TON WALLET TRON (Pour recevoir les gains)
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
                        margin-bottom: 10px;
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

    const btnTron = $("payMethodTron");
    const btnStars = $("payMethodStars");
    const tronSection = $("tronSection");


    btnTron.addEventListener("click", () => {
        selectedPaymentMethod = "tron";
        btnTron.style.background = "#ffcc00";
        btnTron.style.color = "#16051f";
        btnTron.style.borderColor = "#ffcc00";
        btnStars.style.background = "#090014";
        btnStars.style.color = "#fff";
        btnStars.style.borderColor = "rgba(255,204,0,.4)";
        tronSection.style.display = "block";
        updateButton();
    });

    btnStars.addEventListener("click", () => {
        selectedPaymentMethod = "stars";
        btnStars.style.background = "#ffcc00";
        btnStars.style.color = "#16051f";
        btnStars.style.borderColor = "#ffcc00";
        btnTron.style.background = "#090014";
        btnTron.style.color = "#fff";
        btnTron.style.borderColor = "rgba(255,204,0,.4)";
        tronSection.style.display = "block"; // On garde le champ wallet visible pour y verser les gains éventuels
        updateButton();
    });


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
            const unitLabel = selectedPaymentMethod === "stars" ? "STARS" : "USDT";
            payButton.textContent =
                `🪙 PAYER ${formatUsdt(amount)} ${unitLabel} ET JOUER`;
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
                        ${formatNumber(MAXIMUM_BET)}.
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
                        ❌ Connecte d'abord ton Wallet Tron pour les gains.
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

                if (selectedPaymentMethod === "tron") {
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

                    connectedWallet = wallet;


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
                } else {
                    // PAIEMENT TELEGRAM STARS
                    if (!tg || !telegramId) {
                        throw new Error("Ouvre le jeu dans Telegram pour utiliser les Stars.");
                    }

                    paymentStatus.innerHTML =
                        `<span style="color:#ffcc00">⏳ Création de la facture Telegram Stars...</span>`;

                    const invoiceRes = await fetch(API_URL + "/api/telegram/create-invoice", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ telegramId, amount, name, wallet: connectedWallet })
                    });
                    const invoiceData = await invoiceRes.json();

                    if (!invoiceData.success || !invoiceData.invoiceLink) {
                        throw new Error(invoiceData.message || "Erreur création facture Stars");
                    }

                    paymentStatus.innerHTML =
                        `<span style="color:#ffcc00">⏳ Validation du paiement Telegram...</span>`;

                    await new Promise((resolve, reject) => {
                        tg.openInvoice(invoiceData.invoiceLink, (status) => {
                            if (status === "paid") {
                                resolve(true);
                            } else {
                                reject(new Error("USER_REJECTED"));
                            }
                        });
                    });
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
   TRONLINK DETECTION (CORRIGÉ ET SANS TRONWEB.ISADDRESS)
========================================================= */

async function getTronLinkAddress() {

    try {
        let address = "";

        if (window.tronWeb) {
            if (typeof window.tronWeb.defaultAddress?.base58 === "string") {
                address = window.tronWeb.defaultAddress.base58;
            } else if (typeof window.tronWeb.defaultAddress?.hex === "string") {
                try {
                    address = window.tronWeb.address.fromHex(window.tronWeb.defaultAddress.hex);
                } catch (e) {}
            }
        }

        if (!address && window.tronLink && window.tronLink.tronWeb) {
            if (typeof window.tronLink.tronWeb.defaultAddress?.base58 === "string") {
                address = window.tronLink.tronWeb.defaultAddress.base58;
            } else if (typeof window.tronLink.tronWeb.defaultAddress?.hex === "string") {
                try {
                    address = window.tronLink.tronWeb.address.fromHex(window.tronLink.tronWeb.defaultAddress.hex);
                } catch (e) {}
            }
        }

        if (address && isValidTronAddress(address)) {
            return address;
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
   PAIEMENT USDT TRC20 (VERSION ULTRA-SIMPLE & UNIVERSELLE)
========================================================= */

async function sendUsdtPayment(
    amount,
    expectedWallet
) {

    const tron =
        window.tronWeb ||
        window.tronLink?.tronWeb;


    if (!tron) {
        throw new Error("TRONLINK_NOT_DETECTED");
    }


    const from = await getTronLinkAddress();


    if (!from) {
        throw new Error("WALLET_NOT_CONNECTED");
    }


    if (
        expectedWallet &&
        from.toLowerCase() !==
        expectedWallet.toLowerCase()
    ) {
        throw new Error("WALLET_ADDRESS_CHANGED");
    }


    const units =
        Math.round(
            Number(amount) *
            Math.pow(10, USDT_DECIMALS)
        );


    if (
        !Number.isSafeInteger(units) ||
        units <= 0
    ) {
        throw new Error("MONTANT_INVALIDE");
    }


    let txid;


    try {
        const contract = await tron.contract().at(USDT_CONTRACT);

        txid = await contract.transfer(
            MILTAPE_WALLET,
            units
        ).send({
            feeLimit: 100000000,
            shouldPollResponse: true
        });

    } catch (error) {

        console.error("USDT transfer error:", error);

        if (
            error?.code === 4001 ||
            error?.message?.toLowerCase()?.includes("reject")
        ) {
            throw new Error("USER_REJECTED");
        }

        throw new Error(error?.message || "Erreur lors du transfert USDT");
    }


    if (typeof txid === "object" && txid?.txid) {
        txid = txid.txid;
    }


    if (!txid) {
        throw new Error("TRANSACTION_NON_CONFIRMEE");
    }


    console.log("USDT TXID:", txid);
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
            "/api/payment/verify",
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
                        telegramId,
                        name:
                            name,

                        txId:
                            txid,

                        amount,

                        wallet:
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
   RESTAURATION DE SESSION JOUEUR
========================================================= */

async function restorePlayerSession() {
    try {
        const savedPlayerId = localStorage.getItem("miltape_player_id");
        const savedWallet = localStorage.getItem("miltape_player_address");

        if (!savedPlayerId && !savedWallet) return;

        const response = await fetch(
            `${API_URL}/api/player/status?playerId=${encodeURIComponent(savedPlayerId || "")}&wallet=${encodeURIComponent(savedWallet || "")}&telegramId=${encodeURIComponent(telegramId || "")}`
        );

        const data = await response.json();

        if (data.success && data.player) {
            console.log("✅ Session restaurée :", data.player);

            playerName = data.player.name || playerName;
            playerAddress = data.player.wallet || playerAddress;
            tapCount = Number(data.player.taps || 0);
            selectedBet = Number(data.player.bet || 0);

            updateTapDisplay();

            if (data.player.paid) {
                joinedGame = true;
                localStorage.setItem("miltape_joined", "true");
                
                if (displayBet) {
                    displayBet.textContent = "$" + formatUsdt(selectedBet);
                }

                if (tapButton) {
                    tapButton.disabled = false;
                }

                showMessage("🟢 SESSION RESTAURÉE — BON JEU !");
            }

            if (socket && socket.connected) {
                joinSocketGame();
            }
        }
    } catch (error) {
        console.error("Erreur lors de la restauration de session :", error);
    }
}


/* =========================================================
   SOCKET.IO (CORRIGÉ ET SYNCHRONISÉ AVEC LE BACKEND)
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
        "game:state",
        state => {
            if (!state) return;

            gameId = state.gameId || gameId;
            gameRunning = (state.status === "running");
            
            updateTimer(state.remainingSeconds);

            if (state.onlinePlayers !== undefined) {
                updateOnline(state.onlinePlayers);
            }

            if (Array.isArray(state.leaderboard)) {
                renderLeaderboard(state.leaderboard);
            }
        }
    );


    socket.on(
        "timer:update",
        data => {
            if (!data) return;

            const seconds = Number(data.remainingSeconds || 0);
            updateTimer(seconds);

            if (data.status) {
                gameRunning = (data.status === "running");
            }
        }
    );


    socket.on(
        "online:count",
        count => {
            updateOnline(count);
        }
    );


    socket.on(
        "leaderboard:update",
        leaderboard => {
            renderLeaderboard(leaderboard || []);
        }
    );


    socket.on(
        "player:score",
        data => {
            if (data && data.taps !== undefined) {
                tapCount = Number(data.taps);
                updateTapDisplay();
            }
        }
    );


    socket.on(
        "game:finished",
        data => {
            gameRunning = false;
            tapButton.disabled = true;

            showMessage(
                "🏁 PARTIE TERMINÉE — ATTENDS LA PROCHAINE !"
            );

            if (data && Array.isArray(data.leaderboard)) {
                renderLeaderboard(data.leaderboard);
            }
        }
    );


    socket.on(
        "chat:message",
        messageData => {
            addChatMessage({
                playerName: messageData.name,
                message: messageData.message
            });
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
        "player:join",
        {
            playerId,
            telegramId,
            name: playerName,
            wallet: playerAddress,
            bet: selectedBet
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
            "player:tap"
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
                                        player.name ||
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
                                        player.bet
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
                                    player.taps
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
        "chat:send",
        {
            name: playerName || "Joueur",
            message: message
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
   CHARGEMENT DE L'HISTORIQUE DU CHAT VIA REST
========================================================= */

async function loadChatHistoryRest() {
    try {
        const response = await fetch(API_URL + "/api/chat");
        const data = await response.json();
        if (data.success && Array.isArray(data.messages)) {
            const formatted = data.messages.map(m => ({
                playerName: m.name,
                message: m.message
            }));
            renderChatHistory(formatted);
        }
    } catch (err) {
        console.error("Erreur chargement chat:", err);
    }
}


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
                    USDT TRC20 / Telegram Stars
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
                "/api/game"
            );


        const data =
            await response.json();


        if (!data.success) {
            return;
        }


        gameId =
            data.gameId ||
            gameId;


        gameRunning =
            (data.status === "running");


        updateTimer(
            data.remainingSeconds
        );


        updateOnline(
            data.onlinePlayers || 0
        );


        if (Array.isArray(data.leaderboard)) {
            renderLeaderboard(data.leaderboard);
        }

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

        await loadChatHistoryRest();

        await restorePlayerSession();

        connectSocket();

        console.log(
            "🔥 MILTAPE FRONTEND CHARGÉ ET CORRIGÉ"
        );
    }
);
