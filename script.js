/* =========================================================
MILTAPE WORLD CHALLENGE
SCRIPT FRONTEND COMPLET - INTÉGRATION TELEGRAM & TON
========================================================= */

"use strict";

/* =========================================================
CONFIG
========================================================= */
const API_URL = "https://miltape-backend-production.up.railway.app";
const SOCKET_URL = API_URL;
const MILTAPE_WALLET = "UQC_VPcOqTi87b6jpbkaymIiXQon8Jue4J6z4cKd85AxIJz5";
const TON_DECIMALS = 9;
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
let playerId = localStorage.getItem("miltape_player_id");

if (!playerId) {
    playerId = (telegramId ? "tg_" + telegramId : "player_" + Date.now()) + "_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("miltape_player_id", playerId);
}

let playerName = localStorage.getItem("miltape_player_name") || (tgUser ? (tgUser.first_name || tgUser.username) : "");
let playerAddress = localStorage.getItem("miltape_player_address") || "";
let selectedBet = 0;
let tapCount = 0;
let gameId = 1;
let gameRunning = false;
let joinedGame = false;
let paymentInProgress = false;
let connectedWallet = "";
let selectedPaymentMethod = "ton";
let tonConnectUI = null;

/* =========================================================
DOM
========================================================= */
const $ = id => document.getElementById(id);
const enterChallenge = $("enterChallenge");
const tapButton = $("tapButton");
const tapCountElement = $("tapCount");
const tapButtonCount = $("tapButtonCount");
const displayBet = $("displayBet");
const timerElement = $("timer");
const onlineCount = $("onlineCount");
const leaderboardList = $("leaderboardList");
const chatMessages = $("chatMessages");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
const dynamicModal = $("dynamicModal");
const dynamicModalTitle = $("dynamicModalTitle");
const dynamicModalBody = $("dynamicModalBody");
const closeDynamicModal = $("closeDynamicModal");
const globalTotalStakes = $("globalTotalStakes");
const tapMessage = $("tapMessage");

/* =========================================================
UTILITAIRES
========================================================= */
function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showMessage(message) {
    if (tapMessage) tapMessage.textContent = message;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString("fr-FR");
}

function formatTon(value) {
    return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function shortAddress(address) {
    if (!address) return "";
    return address.substring(0, 6) + "..." + address.substring(address.length - 6);
}

/* =========================================================
MODAL
========================================================= */
function openModal() {
    dynamicModal?.classList.add("show");
    document.body.style.overflow = "hidden";
}

function closeModal() {
    dynamicModal?.classList.remove("show");
    document.body.style.overflow = "";
}

closeDynamicModal?.addEventListener("click", closeModal);
dynamicModal?.addEventListener("click", event => {
    if (event.target === dynamicModal) closeModal();
});

/* =========================================================
VALIDATION TON
========================================================= */
function isValidTonAddress(address) {
    if (!address || typeof address !== "string") return false;
    return address.length >= 40 && (address.startsWith("UQ") || address.startsWith("EQ") || address.startsWith("0:")) || /^[0-9a-fA-F]{64}$/.test(address);
}

/* =========================================================
FORMULAIRE JOUER
========================================================= */
function openChallengeForm() {
    connectedWallet = playerAddress || "";
    selectedPaymentMethod = "ton";
    dynamicModalTitle.textContent = "🎮 Rejoindre la partie";
    dynamicModalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="padding:13px; border-radius:12px; background:rgba(255,204,0,.08); border:1px solid rgba(255,204,0,.25); color:#ddd; font-size:13px; line-height:1.5;">
                🏆 <strong style="color:#ffcc00;">MILTAPE WORLD CHALLENGE</strong><br><br>
                Choisis librement le montant de ta participation.<br>
                Minimum : <strong style="color:#ffcc00;">${MINIMUM_BET} TON / Stars</strong><br>
                Maximum : <strong style="color:#ffcc00;">${formatNumber(MAXIMUM_BET)} TON</strong>
            </div>
            <label style="color:#ffcc00; font-size:13px; font-weight:900;">🪙 MODE DE PAIEMENT</label>
            <div style="display:flex; gap:10px;">
                <button type="button" id="payMethodTon" style="flex:1; min-height:44px; border-radius:10px; border:2px solid #ffcc00; background:#ffcc00; color:#16051f; font-weight:900; cursor:pointer; font-size:13px;">🔗 TON Connect (Wallet)</button>
                <button type="button" id="payMethodStars" style="flex:1; min-height:44px; border-radius:10px; border:2px solid rgba(255,204,0,.4); background:#090014; color:#fff; font-weight:900; cursor:pointer; font-size:13px;">⭐ Telegram Stars</button>
            </div>
            <label style="color:#ffcc00; font-size:13px; font-weight:900;">🪙 TA MISE</label>
            <input id="betInput" type="number" min="${MINIMUM_BET}" max="${MAXIMUM_BET}" step="1" inputmode="decimal" placeholder="Exemple : 1, 10, 50..." value="" style="width:100%; box-sizing:border-box; height:52px; padding:0 14px; border-radius:12px; border:1px solid rgba(255,204,0,.40); background:#090014; color:#fff; font-size:17px; outline:none;">
            <label style="color:#ffcc00; font-size:13px; font-weight:900;">👤 TON NOM</label>
            <input id="playerNameInput" type="text" maxlength="30" autocomplete="name" placeholder="Entre ton nom" value="${escapeHtml(playerName)}" style="width:100%; box-sizing:border-box; height:52px; padding:0 14px; border-radius:12px; border:1px solid rgba(193,60,255,.35); background:#090014; color:#fff; font-size:15px; outline:none;">
            <div id="tonSection">
                <label style="color:#ffcc00; font-size:13px; font-weight:900;">🔗 TON WALLET (Pour recevoir les gains)</label>
                <input id="walletInputManual" type="text" placeholder="Colle ton adresse TON (commençant par UQ...)" value="${escapeHtml(playerAddress)}" style="width:100%; box-sizing:border-box; height:52px; padding:0 14px; border-radius:12px; border:1px solid rgba(193,60,255,.35); background:#090014; color:#fff; font-size:14px; outline:none; margin-bottom:10px;">
                <div id="walletBox" style="width:100%; box-sizing:border-box; min-height:40px; padding:8px 12px; border-radius:10px; background:rgba(255,255,255,0.03); color:#aaa; font-size:12px; line-height:1.4; word-break:break-all; margin-bottom:10px;">
                    ${playerAddress ? "Adresse actuelle : " + escapeHtml(playerAddress) : "Ou connecte ton wallet automatiquement ci-dessous"}
                </div>
                <button id="connectWalletBtn" type="button" style="width:100%; min-height:50px; border:none; border-radius:12px; background:linear-gradient(135deg, #7b2cff, #c13cff); color:#fff; font-weight:900; font-size:14px; cursor:pointer; box-shadow:0 4px 0 #43137d;">🔗 CONNECTER TON WALLET</button>
            </div>
            <label style="display:flex; align-items:flex-start; gap:10px; font-size:12px; color:#bbb; line-height:1.4; cursor:pointer;">
                <input id="termsCheckbox" type="checkbox" style="width:18px; height:18px; flex:none; accent-color:#ffcc00;">
                <span>J'accepte les <a href="./conditions.html" target="_blank" rel="noopener noreferrer" style="color:#ffcc00; text-decoration:none;">conditions d'utilisation</a> de Miltape World Challenge.</span>
            </label>
            <button id="payButton" type="button" disabled style="width:100%; min-height:56px; border:none; border-radius:14px; background:linear-gradient(135deg, #ffcc00, #ff8a00); color:#16051f; font-size:16px; font-weight:900; cursor:not-allowed; opacity:.45; box-shadow:0 5px 0 #a84c00;">🪙 PAYER ET JOUER</button>
            <div id="paymentStatus" style="min-height:22px; text-align:center; font-size:12px; color:#bbb; line-height:1.5;"></div>
        </div>
    `;
    openModal();

    const betInput = $("betInput");
    const nameInput = $("playerNameInput");
    const walletInputManual = $("walletInputManual");
    const terms = $("termsCheckbox");
    const payButton = $("payButton");
    const connectButton = $("connectWalletBtn");
    const walletBox = $("walletBox");
    const paymentStatus = $("paymentStatus");
    const btnTon = $("payMethodTon");
    const btnStars = $("payMethodStars");
    const tonSection = $("tonSection");

    btnTon.addEventListener("click", () => {
        selectedPaymentMethod = "ton";
        btnTon.style.background = "#ffcc00"; btnTon.style.color = "#16051f"; btnTon.style.borderColor = "#ffcc00";
        btnStars.style.background = "#090014"; btnStars.style.color = "#fff"; btnStars.style.borderColor = "rgba(255,204,0,.4)";
        tonSection.style.display = "block";
        updateButton();
    });

    btnStars.addEventListener("click", () => {
        selectedPaymentMethod = "stars";
        btnStars.style.background = "#ffcc00"; btnStars.style.color = "#16051f"; btnStars.style.borderColor = "#ffcc00";
        btnTon.style.background = "#090014"; btnTon.style.color = "#fff"; btnTon.style.borderColor = "rgba(255,204,0,.4)";
        tonSection.style.display = "block";
        updateButton();
    });

    function updateButton() {
        const amount = Number(betInput.value);
        const name = nameInput.value.trim();
        const currentManualWallet = walletInputManual.value.trim();
        if (isValidTonAddress(currentManualWallet)) connectedWallet = currentManualWallet;
        const validAmount = Number.isFinite(amount) && amount >= MINIMUM_BET && amount <= MAXIMUM_BET;
        const validName = name.length >= 2;
        const validWallet = isValidTonAddress(connectedWallet);
        const validTerms = terms.checked;
        const enabled = validAmount && validName && validWallet && validTerms && !paymentInProgress;
        payButton.disabled = !enabled;
        payButton.style.opacity = enabled ? "1" : ".45";
        payButton.style.cursor = enabled ? "pointer" : "not-allowed";
        payButton.textContent = validAmount ? `🪙 PAYER ${formatTon(amount)} ${selectedPaymentMethod === "stars" ? "STARS" : "TON"} ET JOUER` : "🪙 PAYER ET JOUER";
    }

    betInput.addEventListener("input", updateButton);
    nameInput.addEventListener("input", () => { playerName = nameInput.value.trim(); updateButton(); });
    walletInputManual.addEventListener("input", () => {
        const val = walletInputManual.value.trim();
        if (isValidTonAddress(val)) {
            connectedWallet = val;
            walletBox.innerHTML = `<span style="color:#2ecc71">Adresse valide saisie</span>`;
        } else {
            walletBox.innerHTML = `<span style="color:#ff6b6b">Adresse TON invalide</span>`;
        }
        updateButton();
    });
    terms.addEventListener("change", updateButton);

    connectButton.addEventListener("click", async () => {
        connectButton.disabled = true;
        connectButton.textContent = "⏳ CONNEXION...";
        try {
            const wallet = await connectTonWallet();
            if (!wallet) throw new Error("Connection failed");
            connectedWallet = wallet;
            playerAddress = wallet;
            walletInputManual.value = wallet;
            localStorage.setItem("miltape_player_address", wallet);
            walletBox.innerHTML = `<span style="color:#2ecc71; font-weight:900;">🟢 WALLET CONNECTÉ</span><br><span style="color:#aaa;">${escapeHtml(wallet)}</span>`;
            connectButton.textContent = "🟢 WALLET CONNECTÉ";
            connectButton.style.background = "linear-gradient(135deg,#159957,#2ecc71)";
            updateButton();
        } catch (error) {
            walletBox.innerHTML = `<span style="color:#ff6b6b">❌ Connexion annulée.</span>`;
        } finally {
            connectButton.disabled = false;
        }
    });

    payButton.addEventListener("click", async () => {
        const amount = Number(betInput.value);
        const name = nameInput.value.trim();
        if (!Number.isFinite(amount) || amount < MINIMUM_BET || amount > MAXIMUM_BET || name.length < 2 || !isValidTonAddress(connectedWallet) || !terms.checked) return;
        
        paymentInProgress = true;
        payButton.disabled = true;
        paymentStatus.innerHTML = `<span style="color:#ffcc00">⏳ Préparation du paiement...</span>`;

        try {
            if (selectedPaymentMethod === "ton") {
                const txresult = await sendTonPayment(amount, connectedWallet);
                if (!txresult) throw new Error("TRANSACTION_FAILED");
                const result = await verifyPayment(amount, txresult, connectedWallet, name);
                if (!result || !result.success) throw new Error("PAYMENT_VERIFICATION_FAILED");
            } else {
                if (!tg || !telegramId) throw new Error("Ouvre le jeu dans Telegram.");
                const invoiceRes = await fetch(API_URL + "/api/telegram/create-invoice", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ telegramId, amount, name, wallet: connectedWallet }) });
                const invoiceData = await invoiceRes.json();
                await new Promise((resolve, reject) => tg.openInvoice(invoiceData.invoiceLink, status => status === "paid" ? resolve() : reject()));
            }
            selectedBet = amount;
            joinedGame = true;
            localStorage.setItem("miltape_joined", "true");
            displayBet.textContent = "$" + formatTon(amount);
            tapButton.disabled = false;
            showMessage("🟢 PAIEMENT VALIDÉ — TU PEUX JOUER !");
            paymentStatus.innerHTML = `<span style="color:#2ecc71; font-weight:900;">✅ PAIEMENT VALIDÉ !</span>`;
            joinSocketGame();
            setTimeout(closeModal, 1300);
        } catch (error) {
            paymentStatus.innerHTML = `<span style="color:#ff6b6b">❌ ${escapeHtml(error.message || "Paiement refusé.")}</span>`;
        } finally {
            paymentInProgress = false;
            updateButton();
        }
    });
}

function initTonConnect() {
    if (!tonConnectUI && window.TON_CONNECT_UI) {
        try {
            tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: 'https://cryptochaouki-droid.github.io/miltape-backend/tonconnect-manifest.json' });
        } catch (e) { console.error(e); }
    }
    return tonConnectUI;
}

async function connectTonWallet() {
    const tc = initTonConnect();
    if (!tc) throw new Error("TON_CONNECT_NOT_LOADED");
    if (tc.connected && tc.wallet) return tc.wallet.account.address;
    await tc.openModal();
    return new Promise((resolve) => {
        const unsubscribe = tc.onStatusChange(walletInfo => {
            if (walletInfo) { unsubscribe(); resolve(walletInfo.account.address); }
        });
        setTimeout(() => resolve(""), 60000);
    });
}

async function sendTonPayment(amount, expectedWallet) {
    const tc = initTonConnect();
    if (!tc || !tc.connected) throw new Error("WALLET_NOT_CONNECTED");
    const nanotons = Math.round(Number(amount) * Math.pow(10, TON_DECIMALS));
    const transaction = { validUntil: Math.floor(Date.now() / 1000) + 600, messages: [{ address: MILTAPE_WALLET, amount: nanotons.toString() }] };
    const result = await tc.sendTransaction(transaction);
    return result?.boc || result || "SUCCESS";
}

async function verifyPayment(amount, txid, address, name) {
    const response = await fetch(API_URL + "/api/payment/verify", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ playerId, telegramId, name, txId: txid, amount, wallet: address }) });
    return await response.json();
}

async function restorePlayerSession() {
    try {
        const savedPlayerId = localStorage.getItem("miltape_player_id");
        const savedWallet = localStorage.getItem("miltape_player_address");
        if (!savedPlayerId && !savedWallet) return;
        const response = await fetch(`${API_URL}/api/player/status?playerId=${encodeURIComponent(savedPlayerId || "")}&wallet=${encodeURIComponent(savedWallet || "")}&telegramId=${encodeURIComponent(telegramId || "")}`);
        const data = await response.json();
        if (data.success && data.player) {
            playerName = data.player.name;
            playerAddress = data.player.wallet;
            tapCount = Number(data.player.taps || 0);
            selectedBet = Number(data.player.bet || 0);
            if (data.player.paid) { joinedGame = true; tapButton.disabled = false; showMessage("🟢 SESSION RESTAURÉE"); }
        }
    } catch (e) { console.error(e); }
}

function connectSocket() {
    if (typeof io !== "function") return;
    socket = io(SOCKET_URL, { transports: ["polling", "websocket"], secure: true, rejectUnauthorized: false });
    socket.on("connect", () => { if (joinedGame) joinSocketGame(); });
    socket.on("game:state", state => { /* handle updates */ });
    socket.on("player:score", data => { if(data) { tapCount = Number(data.taps); updateTapDisplay(); } });
}

function joinSocketGame() {
    if (socket?.connected) socket.emit("player:join", { playerId, telegramId, name: playerName, wallet: playerAddress, bet: selectedBet });
}

function updateTapDisplay() {
    if (tapCountElement) tapCountElement.textContent = formatNumber(tapCount);
}

document.addEventListener("DOMContentLoaded", async () => {
    enterChallenge?.addEventListener("click", openChallengeForm);
    connectSocket();
    await restorePlayerSession();
    initTonConnect();
});
