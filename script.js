/* =========================================================
MILTAPE WORLD CHALLENGE
SCRIPT FRONTEND COMPLET - INTÉGRATION TELEGRAM & TON
========================================================= */

"use strict";

/* =========================================================
CONFIG
========================================================= */

const API_URL =
"https://miltape-backend-production.up.railway.app";

const SOCKET_URL = API_URL;

const MILTAPE_WALLET =
"UQC_VPcOqTi87b6jpbkaymIiXQon8Jue4J6z4cKd85AxIJz5";

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

let selectedPaymentMethod = "ton";

let tonConnectUI = null;

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

function formatTon(value) {

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
VALIDATION TON
========================================================= */

function isValidTonAddress(address) {

if (!address || typeof address !== "string") {
return false;
}

return address.length >= 40 && (address.startsWith("UQ") || address.startsWith("EQ") || address.startsWith("0:")) || /^[0-9a-fA-F]{64}$/.test(address);

}

/* =========================================================
FORMULAIRE JOUER
========================================================= */

function openChallengeForm() {

connectedWallet = playerAddress || "";
selectedPaymentMethod = "ton";

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
${MINIMUM_BET} TON / Stars
</strong>

<br>

Maximum :
<strong style="color:#ffcc00;">
${formatNumber(MAXIMUM_BET)} TON
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
id="payMethodTon"
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
🔗 TON Connect (Wallet)
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


<div id="tonSection">

<label style="
color:#ffcc00;
font-size:13px;
font-weight:900;
">
🔗 TON WALLET (Pour recevoir les gains)
</label>

<input
id="walletInputManual"
type="text"
placeholder="Colle ton adresse TON (commençant par UQ...)"
value="${escapeHtml(playerAddress)}"
style="
width:100%;
box-sizing:border-box;
height:52px;
padding:0 14px;
border-radius:12px;
border:1px solid rgba(193,60,255,.35);
background:#090014;
color:#fff;
font-size:14px;
outline:none;
margin-bottom:10px;
"
>

<div
id="walletBox"
style="
width:100%;
box-sizing:border-box;
min-height:40px;
padding:8px 12px;
border-radius:10px;
background:rgba(255,255,255,0.03);
color:#aaa;
font-size:12px;
line-height:1.4;
word-break:break-all;
margin-bottom:10px;
"
>
${
playerAddress
? "Adresse actuelle : " +
escapeHtml(playerAddress)
: "Ou connecte ton wallet automatiquement ci-dessous"
}
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
🔗 CONNECTER TON WALLET
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

const walletInputManual =
$("walletInputManual");

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

const btnTon =
$("payMethodTon");

const btnStars =
$("payMethodStars");

const tonSection =
$("tonSection");


btnTon.addEventListener(
"click",
() => {

selectedPaymentMethod = "ton";

btnTon.style.background =
"#ffcc00";

btnTon.style.color =
"#16051f";

btnTon.style.borderColor =
"#ffcc00";

btnStars.style.background =
"#090014";

btnStars.style.color =
"#fff";

btnStars.style.borderColor =
"rgba(255,204,0,.4)";

tonSection.style.display =
"block";

updateButton();
}
);


btnStars.addEventListener(
"click",
() => {

selectedPaymentMethod = "stars";

btnStars.style.background =
"#ffcc00";

btnStars.style.color =
"#16051f";

btnStars.style.borderColor =
"#ffcc00";

btnTon.style.background =
"#090014";

btnTon.style.color =
"#fff";

btnTon.style.borderColor =
"rgba(255,204,0,.4)";

tonSection.style.display =
"block";

updateButton();
}
);


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

const currentManualWallet =
walletInputManual.value.trim();

if (
isValidTonAddress(
currentManualWallet
)
) {
connectedWallet =
currentManualWallet;
}

const validAmount =
Number.isFinite(amount) &&
amount >= MINIMUM_BET &&
amount <= MAXIMUM_BET;

const validName =
name.length >= 2;

const validWallet =
isValidTonAddress(
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

const unitLabel =
selectedPaymentMethod === "stars"
? "STARS"
: "TON";

payButton.textContent =
`🪙 PAYER ${formatTon(amount)} ${unitLabel} ET JOUER`;

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


walletInputManual.addEventListener(
"input",
() => {

const val =
walletInputManual.value.trim();

if (
isValidTonAddress(val)
) {

connectedWallet =
val;

walletBox.innerHTML =
`
<span style="color:#2ecc71">
Adresse valide saisie
</span>
`;

} else {

walletBox.innerHTML =
`
<span style="color:#ff6b6b">
Adresse TON invalide
(doit commencer par UQ ou EQ)
</span>
`;
}

updateButton();
}
);


terms.addEventListener(
"change",
updateButton
);


/* =====================================================
CONNECT TON CONNECT
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
Ouverture de TonConnect...
</span>
`;

try {

const wallet =
await connectTonWallet();

if (!wallet) {

walletBox.innerHTML =
`
<span style="color:#ff6b6b">
❌ Wallet non connecté.
<br>
Tu peux coller ton adresse directement
dans le champ ci-dessus.
</span>
`;

connectButton.disabled =
false;

connectButton.textContent =
"🔗 CONNECTER TON WALLET";

return;
}


connectedWallet =
wallet;

playerAddress =
wallet;

walletInputManual.value =
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
"🟢 WALLET CONNECTÉ";

connectButton.style.background =
"linear-gradient(135deg,#159957,#2ecc71)";


updateButton();

} catch (error) {

console.error(
"Connexion Wallet:",
error
);

walletBox.innerHTML =
`
<span style="color:#ff6b6b">
❌ Connexion annulée ou impossible.
Colle ton adresse manuellement si besoin.
</span>
`;

} finally {

connectButton.disabled =
false;

if (connectedWallet) {

connectButton.textContent =
"🟢 WALLET CONNECTÉ";

} else {

connectButton.textContent =
"🔗 CONNECTER TON WALLET";
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

const manualVal =
walletInputManual.value.trim();

if (
isValidTonAddress(
manualVal
)
) {
connectedWallet =
manualVal;
}


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
!isValidTonAddress(
connectedWallet
)
) {

paymentStatus.innerHTML =
`
<span style="color:#ff6b6b">
❌ Entre ou connecte une adresse
Wallet TON valide pour les gains.
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

if (
selectedPaymentMethod ===
"ton"
) {

paymentStatus.innerHTML =
`
<span style="color:#ffcc00">
⏳ Ouverture du Wallet TON...
<br>
Confirme ${formatTon(amount)} TON
</span>
`;


const txresult =
await sendTonPayment(
amount,
walletBeforePayment
);


if (!txresult) {

throw new Error(
"TRANSACTION_FAILED"
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
txresult,
walletBeforePayment,
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

if (
!tg ||
!telegramId
) {

throw new Error(
"Ouvre le jeu dans Telegram pour utiliser les Stars."
);
}


paymentStatus.innerHTML =
`
<span style="color:#ffcc00">
⏳ Création de la facture Telegram Stars...
</span>
`;


const invoiceRes =
await fetch(
API_URL +
"/api/telegram/create-invoice",
{
method: "POST",

headers: {
"Content-Type":
"application/json"
},

body:
JSON.stringify({
telegramId,
amount,
name,
wallet:
connectedWallet
})
}
);


const invoiceData =
await invoiceRes.json();


if (
!invoiceData.success ||
!invoiceData.invoiceLink
) {

throw new Error(
invoiceData.message ||
"Erreur création facture Stars"
);
}


paymentStatus.innerHTML =
`
<span style="color:#ffcc00">
⏳ Validation du paiement Telegram...
</span>
`;


await new Promise(
(resolve, reject) => {

tg.openInvoice(
invoiceData.invoiceLink,
status => {

if (
status ===
"paid"
) {

resolve(true);

} else {

reject(
new Error(
"USER_REJECTED"
)
);
}
}
);
}
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
formatTon(amount);


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
"WALLET_NOT_CONNECTED"
) {

paymentStatus.innerHTML =
`
<span style="color:#ff6b6b">
❌ Wallet non connecté.
Utilise le remplissage manuel.
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
await getTonWalletAddress();

if (!wallet) {
return;
}

connectedWallet =
wallet;

if (!playerAddress) {
playerAddress =
wallet;
}

walletInputManual.value =
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
🟢 WALLET DÉTECTÉ
</span>

<br>

<span style="color:#aaa;">
${escapeHtml(
shortAddress(wallet)
)}
</span>
`;


connectButton.textContent =
"🟢 WALLET CONNECTÉ";


connectButton.style.background =
"linear-gradient(135deg,#159957,#2ecc71)";


updateButton();

} catch (error) {

console.log(
"Wallet automatique:",
error
);
}

},
700
);


updateButton();

}

/* =========================================================
TON CONNECT INITIALISATION & HELPERS
========================================================= */

function initTonConnect() {
if (!tonConnectUI && window.TON_CONNECT_UI) {
try {
tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({
manifestUrl: 'https://cryptochaouki-droid.github.io/miltape-backend/tonconnect-manifest.json'
});
} catch (e) {
console.error("Init TonConnect error:", e);
}
}
return tonConnectUI;
}

async function getTonWalletAddress() {
const tc = initTonConnect();
if (!tc) return "";

if (tc.wallet && tc.wallet.account && tc.wallet.account.address) {
const rawAddress = tc.wallet.account.address;
if (window.TON_CONNECT_UI && typeof window.TON_CONNECT_UI.toUserFriendlyAddress === "function") {
return window.TON_CONNECT_UI.toUserFriendlyAddress(rawAddress);
}
return rawAddress;
}
return "";

}

async function connectTonWallet() {
const tc = initTonConnect();
if (!tc) {
throw new Error("TON_CONNECT_NOT_LOADED");
}

if (tc.connected && tc.wallet) {
return await getTonWalletAddress();
}

await tc.openModal();

return new Promise((resolve) => {
const unsubscribe = tc.onStatusChange(walletInfo => {
if (walletInfo) {
unsubscribe();
const rawAddress = walletInfo.account.address;
let address = rawAddress;
if (window.TON_CONNECT_UI && typeof window.TON_CONNECT_UI.toUserFriendlyAddress === "function") {
address = window.TON_CONNECT_UI.toUserFriendlyAddress(rawAddress);
}
resolve(address);
}
});

setTimeout(() => {
if (!tc.connected) {
resolve("");
}
}, 60000);
});

}

/* =========================================================
PAIEMENT TON
========================================================= */

async function sendTonPayment(
amount,
expectedWallet
) {
const tc = initTonConnect();
if (!tc || !tc.connected) {
throw new Error("WALLET_NOT_CONNECTED");
}

const nanotons = Math.round(Number(amount) * Math.pow(10, TON_DECIMALS));

if (!Number.isSafeInteger(nanotons) || nanotons <= 0) {
throw new Error("MONTANT_INVALIDE");
}

const transaction = {
validUntil: Math.floor(Date.now() / 1000) + 600,
messages: [
{
address: MILTAPE_WALLET,
amount: nanotons.toString()
}
]
};

try {
const result = await tc.sendTransaction(transaction);
return result?.boc || result || "SUCCESS";
} catch (error) {
console.error("TON transfer error:", error);
if (error?.message?.toLowerCase()?.includes("reject") || error?.code === 300) {
throw new Error("USER_REJECTED");
}
throw new Error(error?.message || "Erreur lors du transfert TON");
}

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

const savedPlayerId =
localStorage.getItem(
"miltape_player_id"
);

const savedWallet =
localStorage.getItem(
"miltape_player_address"
);


if (
!savedPlayerId &&
!savedWallet
) {

return;
}


const response =
await fetch(
`${API_URL}/api/player/status?playerId=${encodeURIComponent(savedPlayerId || "")}&wallet=${encodeURIComponent(savedWallet || "")}&telegramId=${encodeURIComponent(telegramId || "")}`
);


const data =
await response.json();


if (
data.success &&
data.player
) {

console.log(
"✅ Session restaurée :",
data.player
);


playerName =
data.player.name ||
playerName;

playerAddress =
data.player.wallet ||
playerAddress;

tapCount =
Number(
data.player.taps || 0
);

selectedBet =
Number(
data.player.bet || 0
);


updateTapDisplay();


if (data.player.paid) {

joinedGame =
true;

localStorage.setItem(
"miltape_joined",
"true"
);


if (displayBet) {

displayBet.textContent =
"$" +
formatTon(
selectedBet
);
}


if (tapButton) {

tapButton.disabled =
false;
}


showMessage(
"🟢 SESSION RESTAURÉE — BON JEU !"
);
}


if (
socket &&
socket.connected
) {

joinSocketGame();
}
}

} catch (error) {

console.error(
"Erreur lors de la restauration de session :",
error
);
}

}

/* =========================================================
SOCKET.IO (CORRIGÉ POUR MOBILE)
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
transports: ["polling", "websocket"],
secure: true,
rejectUnauthorized: false,
reconnection: true,
reconnectionAttempts: Infinity,
reconnectionDelay: 1000
}
);


socket.on(
"connect",
() => {

console.log(
"🟢 Socket connecté. ID:",
socket.id
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
"❌ Erreur de connexion Socket.io :",
error.message
);
}
);


socket.on(
"game:state",
state => {

if (!state) {
return;
}


gameId =
state.gameId ||
gameId;

gameRunning =
state.status ===
"running";


updateTimer(
state.remainingSeconds
);


if (
state.onlinePlayers !==
undefined
) {

updateOnline(
state.onlinePlayers
);
}


if (
Array.isArray(
state.leaderboard
)
) {

renderLeaderboard(
state.leaderboard
);
}
}
);


socket.on(
"timer:update",
data => {

if (!data) {
return;
}


const seconds =
Number(
data.remainingSeconds ||
0
);


updateTimer(
seconds
);


if (data.status) {

gameRunning =
data.status ===
"running";
}
}
);


socket.on(
"online:count",
count => {

updateOnline(
count
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
"player:score",
data => {

if (
data &&
data.taps !==
undefined
) {

tapCount =
Number(
data.taps
);

updateTapDisplay();
}
}
);


socket.on(
"game:finished",
data => {

gameRunning =
false;

tapButton.disabled =
true;


showMessage(
"🏁 PARTIE TERMINÉE — ATTENDS LA PROCHAINE !"
);


if (
data &&
Array.isArray(
data.leaderboard
)
) {

renderLeaderboard(
data.leaderboard
);
}
}
);


socket.on(
"chat:message",
messageData => {

addChatMessage({
playerName:
messageData.name,

message:
messageData.message
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
formatTon(total);

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
${formatTon(
player.bet
)}
TON
</small>

</div>

<strong
style="
color:#ffcc00;
font-size:18px;
"
>
${formatNumber(player.taps || 0)} Taps
</strong>

</div>

`;

}
)
.join("");

}
