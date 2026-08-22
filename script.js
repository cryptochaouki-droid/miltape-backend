/* =========================================================
   SCRIPT CLIENT MILTAPE – Version finale
   Multi-crypto + notifications + tableau de bord
   + Telegram + ticker + cagnotte
========================================================= */

// 1. Connexion Socket.IO – URL RAILWAY
const socket = io("https://miltape-backend-production.up.railway.app");

// 2. Éléments DOM
const tapButton = document.getElementById('tapButton');
const tapCount = document.getElementById('tapCount');
const tapButtonCount = document.getElementById('tapButtonCount');
const enterChallenge = document.getElementById('enterChallenge');
const enterChallengeTop = document.getElementById('enterChallengeTop');
const spectatorBtn = document.getElementById('spectatorMode');
const tapMessage = document.getElementById('tapMessage');
const timerDisplay = document.getElementById('timer');
const onlineCount = document.getElementById('onlineCount');
const leaderboardList = document.getElementById('leaderboardList');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatMessages = document.getElementById('chatMessages');

// Éléments pour la mise et le paiement
const betInput = document.getElementById('betInput');
const payButton = document.getElementById('payButton');
const tokenSelect = document.getElementById('tokenSelect');

// Éléments du mode démo
const demoBtn = document.getElementById('demomodebtn');
const demoStatus = document.getElementById('demoStatus');

// Variables d'état
let isPlaying = false;
let isPaid = false;
let isSpectator = false;
let myPlayerId = null;
let myBet = 10;
let myWallet = null;
let myToken = 'USDT';

const API_URL = "https://miltape-backend-production.up.railway.app";

// ==========================================
// 3. INTÉGRATION TELEGRAM
// ==========================================

function getTelegramUser() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const user = window.Telegram.WebApp.initDataUnsafe?.user;

            if (user && user.username) {
                return user.username;
            }

            if (user && user.first_name) {
                return user.first_name;
            }
        }

        return null;

    } catch (e) {
        console.warn(
            "⚠️ Impossible de récupérer l'utilisateur Telegram:",
            e
        );

        return null;
    }
}

function applyTelegramTheme() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {

            const colorScheme =
                window.Telegram.WebApp.colorScheme;

            const themeParams =
                window.Telegram.WebApp.themeParams;

            document.body.setAttribute(
                'data-telegram-theme',
                colorScheme
            );

            if (colorScheme === "dark") {

                document.documentElement.style.setProperty(
                    '--bg',
                    '#0a0a0a'
                );

                document.documentElement.style.setProperty(
                    '--text',
                    '#ffffff'
                );

                document.documentElement.style.setProperty(
                    '--muted',
                    '#888888'
                );

                document.body.style.background = '#0a0a0a';

            } else {

                document.documentElement.style.setProperty(
                    '--bg',
                    '#f5f5f5'
                );

                document.documentElement.style.setProperty(
                    '--text',
                    '#1a1a1a'
                );

                document.documentElement.style.setProperty(
                    '--muted',
                    '#666666'
                );

                document.body.style.background = '#f5f5f5';
            }

            if (
                themeParams &&
                themeParams.button_color
            ) {
                document.documentElement.style.setProperty(
                    '--gold',
                    themeParams.button_color
                );
            }

            console.log(
                "🎨 Thème Telegram appliqué :",
                colorScheme
            );
        }

    } catch (e) {
        console.warn(
            "⚠️ Impossible d'appliquer le thème Telegram:",
            e
        );
    }
}

// ==========================================
// HAPTIC TELEGRAM
// ==========================================

function hapticLight() {
    try {
        if (
            window.Telegram &&
            window.Telegram.WebApp
        ) {
            window.Telegram.WebApp.HapticFeedback
                .impactOccurred('light');
        }
    } catch (e) {}
}

function hapticMedium() {
    try {
        if (
            window.Telegram &&
            window.Telegram.WebApp
        ) {
            window.Telegram.WebApp.HapticFeedback
                .impactOccurred('medium');
        }
    } catch (e) {}
}

function hapticHeavy() {
    try {
        if (
            window.Telegram &&
            window.Telegram.WebApp
        ) {
            window.Telegram.WebApp.HapticFeedback
                .impactOccurred('heavy');
        }
    } catch (e) {}
}

function hapticSuccess() {
    try {
        if (
            window.Telegram &&
            window.Telegram.WebApp
        ) {
            window.Telegram.WebApp.HapticFeedback
                .notificationOccurred('success');
        }
    } catch (e) {}
}

function hapticError() {
    try {
        if (
            window.Telegram &&
            window.Telegram.WebApp
        ) {
            window.Telegram.WebApp.HapticFeedback
                .notificationOccurred('error');
        }
    } catch (e) {}
}

// Appliquer le thème au chargement
applyTelegramTheme();

// Détecter les changements de thème
if (
    window.Telegram &&
    window.Telegram.WebApp
) {
    window.Telegram.WebApp.onEvent(
        'themeChanged',
        applyTelegramTheme
    );
}

// ==========================================
// 4. MODE DÉMO
// ==========================================

let demoMode =
    localStorage.getItem("miltape_demo") === "true" ||
    false;

function updateDemoUI() {

    if (demoMode) {

        if (demoStatus) {
            demoStatus.textContent =
                "🔬 Mode démo ACTIVÉ (paiements simulés)";

            demoStatus.style.color = "#ffcc00";
        }

        if (demoBtn) {

            demoBtn.textContent =
                "🔬 DÉSACTIVER MODE DÉMO";

            demoBtn.style.background =
                "rgba(255,50,50,0.2)";

            demoBtn.style.borderColor =
                "rgba(255,50,50,0.5)";
        }

        if (!isSpectator) {
            tapMessage.innerText =
                "🔬 MODE DÉMO ACTIF – Tu peux jouer sans payer !";
        }

    } else {

        if (demoStatus) {

            demoStatus.textContent =
                "🔒 Mode démo désactivé";

            demoStatus.style.color = "#888";
        }

        if (demoBtn) {

            demoBtn.textContent =
                "🎮 ACTIVER MODE DÉMO";

            demoBtn.style.background =
                "rgba(255,204,0,0.2)";

            demoBtn.style.borderColor =
                "rgba(255,204,0,0.35)";
        }

        if (!isSpectator) {

            tapMessage.innerText =
                "⚡ CHOISIS TA MISE ET CONNECTE TON WALLET";
        }
    }
}

updateDemoUI();

if (demoBtn) {

    demoBtn.addEventListener(
        'click',
        async function() {

            if (demoMode) {

                demoMode = false;

                localStorage.setItem(
                    "miltape_demo",
                    "false"
                );

                updateDemoUI();

                hapticMedium();

                alert("🔒 Mode démo désactivé.");

                return;
            }

            const password = prompt(
                "🔐 Entrez le mot de passe administrateur pour activer le mode démo :"
            );

            if (!password) return;

            try {

                const res = await fetch(
                    API_URL + "/api/admin/login",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            password
                        })
                    }
                );

                const data = await res.json();

                if (data.success) {

                    demoMode = true;

                    localStorage.setItem(
                        "miltape_demo",
                        "true"
                    );

                    updateDemoUI();

                    hapticSuccess();

                    alert(
                        "🔬 Mode démo activé ! Tu peux jouer sans payer."
                    );

                } else {

                    hapticError();

                    alert(
                        "❌ Mot de passe incorrect."
                    );
                }

            } catch (error) {

                console.error(
                    "Erreur vérification mot de passe :",
                    error
                );

                hapticError();

                alert(
                    "❌ Erreur de connexion au serveur. Vérifie que le backend est en ligne."
                );
            }
        }
    );
}

// ==========================================
// 5. MODE SPECTATEUR
// ==========================================

function joinSpectator() {

    const name =
        getTelegramUser() ||
        prompt("Entre ton pseudo (spectateur) :");

    if (!name) return;

    isSpectator = true;
    isPlaying = true;
    isPaid = true;

    tapButton.disabled = true;

    tapMessage.innerText =
        `👁️ Mode spectateur : ${name} regarde la partie !`;

    enterChallenge.style.display = 'none';

    if (spectatorBtn) {

        spectatorBtn.classList.add('active');

        spectatorBtn.textContent =
            '👁️ SPECTATEUR ACTIF';
    }

    if (payButton) {
        payButton.style.display = 'none';
    }

    if (betInput) {
        betInput.disabled = true;
    }

    socket.emit(
        "spectator:join",
        { name }
    );

    hapticMedium();
}

if (spectatorBtn) {
    spectatorBtn.addEventListener(
        'click',
        joinSpectator
    );
}

// ==========================================
// 6. RESTAURER LA SESSION
// ==========================================

async function restoreSession() {

    const playerId =
        localStorage.getItem(
            "miltape_player_id"
        );

    const wallet =
        localStorage.getItem(
            "miltape_player_wallet"
        );

    const name =
        localStorage.getItem(
            "miltape_player_name"
        );

    const spectator =
        localStorage.getItem(
            "miltape_spectator"
        ) === "true";

    if (spectator && name) {

        isSpectator = true;
        isPlaying = true;
        isPaid = true;

        tapButton.disabled = true;

        tapMessage.innerText =
            `👁️ Spectateur : ${name}`;

        enterChallenge.style.display =
            'none';

        if (spectatorBtn) {

            spectatorBtn.classList.add(
                'active'
            );

            spectatorBtn.textContent =
                '👁️ SPECTATEUR ACTIF';
        }

        if (payButton) {
            payButton.style.display =
                'none';
        }

        if (betInput) {
            betInput.disabled = true;
        }

        return true;
    }

    if (!playerId || !wallet || !name) {

        console.log(
            "🔍 Aucune session trouvée."
        );

        return false;
    }

    try {

        const res = await fetch(
            `${API_URL}/api/status`
        );

        const data = await res.json();

        if (data.status !== "running") {

            console.log(
                "⏰ La partie est terminée, pas de restauration."
            );

            localStorage.removeItem(
                "miltape_player_id"
            );

            localStorage.removeItem(
                "miltape_player_wallet"
            );

            localStorage.removeItem(
                "miltape_player_name"
            );

            localStorage.removeItem(
                "miltape_player_bet"
            );

            localStorage.removeItem(
                "miltape_spectator"
            );

            return false;
        }

    } catch (error) {

        console.error(
            "❌ Erreur vérification statut :",
            error
        );

        return false;
    }

    socket.emit(
        "player:restore",
        {
            playerId,
            wallet
        }
    );

    console.log(
        "🔄 Demande de restauration envoyée..."
    );

    return true;
}

// ==========================================
// 7. CONNEXION SOCKET
// ==========================================

socket.on(
    'connect',
    async () => {

        console.log(
            '✅ Socket connecté avec ID :',
            socket.id
        );

        if (!demoMode) {
            tapMessage.innerText =
                "✅ Connecté au serveur !";
        }

        await restoreSession();
    }
);

socket.on(
    'connect_error',
    (err) => {

        console.error(
            '❌ Erreur de connexion Socket :',
            err.message
        );

        hapticError();

        tapMessage.innerText =
            "⚠️ Erreur de connexion au serveur.";
    }
);

socket.on(
    'disconnect',
    (reason) => {

        console.log(
            '🔴 Socket déconnecté :',
            reason
        );

        tapMessage.innerText =
            "🔴 Déconnecté du serveur.";
    }
);

// ==========================================
// 8. REJOINDRE LA PARTIE
// ==========================================

function joinGame() {

    const telegramName =
        getTelegramUser();

    let name =
        telegramName ||
        prompt(
            "Entre ton pseudo pour le classement :"
        );

    const wallet =
        prompt(
            "Entre ton adresse TRON (ex: T...) :"
        );

    const token =
        tokenSelect
            ? tokenSelect.value
            : 'USDT';

    let bet = 10;

    if (betInput) {

        const rawBet =
            parseFloat(
                betInput.value
            );

        if (
            !isNaN(rawBet) &&
            rawBet >= 0.5 &&
            rawBet <= 1000000
        ) {

            bet = rawBet;

        } else {

            hapticError();

            alert(
                "⚠️ Mise invalide. Utilisation de 10 USDT par défaut."
            );
        }
    }

    if (name && wallet) {

        isSpectator = false;

        myBet = bet;
        myWallet = wallet;
        myToken = token;

        tapMessage.innerText =
            "Connexion au serveur en cours...";

        socket.emit(
            "player:join",
            {
                name,
                wallet,
                bet,
                token
            }
        );

        localStorage.removeItem(
            "miltape_spectator"
        );

        hapticMedium();
    }
}

if (enterChallenge) {
    enterChallenge.addEventListener(
        'click',
        joinGame
    );
}

if (enterChallengeTop) {
    enterChallengeTop.addEventListener(
        'click',
        joinGame
    );
}

// ==========================================
// 9. CONFIRMATION D'ENTRÉE
// ==========================================

socket.on(
    "player:joined",
    (data) => {

        if (data.success) {

            isPlaying = true;
            isPaid = false;
            isSpectator = false;

            myPlayerId =
                data.player.id;

            myToken =
                data.player.token ||
                'USDT';

            tapButton.disabled = true;

            tapMessage.innerText =
                `💰 ${data.player.name}, paie ta mise pour taper !`;

            enterChallenge.style.display =
                "none";

            if (tapCount) {
                tapCount.innerText =
                    data.player.taps;
            }

            if (tapButtonCount) {
                tapButtonCount.innerText =
                    data.player.taps;
            }

            localStorage.setItem(
                "miltape_player_id",
                data.player.id
            );

            localStorage.setItem(
                "miltape_player_wallet",
                data.player.wallet
            );

            localStorage.setItem(
                "miltape_player_name",
                data.player.name
            );

            localStorage.setItem(
                "miltape_player_bet",
                data.player.bet.toString()
            );

            localStorage.setItem(
                "miltape_player_token",
                myToken
            );

            localStorage.removeItem(
                "miltape_spectator"
            );

            if (demoMode) {

                isPaid = true;

                tapButton.disabled = false;

                tapMessage.innerText =
                    `🔬 Mode démo : ${data.player.name}, tape !`;

                if (payButton) {
                    payButton.style.display =
                        'none';
                }

                fetch(
                    API_URL +
                    "/api/payment/verify",
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type':
                                'application/json'
                        },
                        body: JSON.stringify({
                            txId:
                                "DEMO_" +
                                Date.now() +
                                "_" +
                                Math.random()
                                    .toString(36)
                                    .substring(2, 8),

                            wallet:
                                data.player.wallet,

                            amount:
                                data.player.bet,

                            playerId:
                                data.player.id,

                            token:
                                myToken
                        })
                    }
                )
                .then(
                    res => res.json()
                )
                .then(
                    data => {

                        if (data.verified) {

                            console.log(
                                "✅ Mode démo : paiement simulé avec succès"
                            );

                        } else {

                            console.warn(
                                "⚠️ Mode démo : la simulation a échoué, mais le jeu continue."
                            );
                        }
                    }
                )
                .catch(
                    err =>
                        console.error(
                            "Erreur mode démo :",
                            err
                        )
                );

            } else {

                if (payButton) {

                    payButton.style.display =
                        'block';

                    payButton.onclick =
                        () =>
                            initiatePayment(
                                data.player.wallet,
                                data.player.bet
                            );
                }
            }

            hapticMedium();
        }
    }
);

// ==========================================
// 10. CONFIRMATION SPECTATEUR
// ==========================================

socket.on(
    "spectator:joined",
    (data) => {

        if (data.success) {

            isSpectator = true;
            isPlaying = true;
            isPaid = true;

            tapButton.disabled = true;

            tapMessage.innerText =
                `👁️ Vous regardez en direct (${data.spectators} spectateurs)`;

            if (payButton) {
                payButton.style.display =
                    'none';
            }

            if (betInput) {
                betInput.disabled = true;
            }

            localStorage.setItem(
                "miltape_spectator",
                "true"
            );

            localStorage.setItem(
                "miltape_player_name",
                data.name
            );
        }
    }
);

// ==========================================
// 11. SESSION RESTAURÉE
// ==========================================

socket.on(
    "player:restored",
    (data) => {

        if (data.success) {

            isPlaying = true;
            isSpectator = false;

            myPlayerId =
                data.player.id;

            myWallet =
                data.player.wallet;

            myBet =
                data.player.bet || 10;

            myToken =
                data.player.token ||
                'USDT';

            localStorage.removeItem(
                "miltape_spectator"
            );

            if (demoMode) {

                isPaid = true;

                tapButton.disabled = false;

                tapMessage.innerText =
                    `🔬 Mode démo : bon retour ${data.player.name} !`;

            } else {

                isPaid = false;

                tapButton.disabled = true;

                tapMessage.innerText =
                    `💰 ${data.player.name}, paie ta mise pour continuer à taper !`;

                if (payButton) {

                    payButton.style.display =
                        'block';

                    payButton.onclick =
                        () =>
                            initiatePayment(
                                data.player.wallet,
                                data.player.bet
                            );
                }
            }

            enterChallenge.style.display =
                "none";

            if (tapCount) {
                tapCount.innerText =
                    data.player.taps;
            }

            if (tapButtonCount) {
                tapButtonCount.innerText =
                    data.player.taps;
            }

            localStorage.setItem(
                "miltape_player_id",
                data.player.id
            );

            localStorage.setItem(
                "miltape_player_wallet",
                data.player.wallet
            );

            localStorage.setItem(
                "miltape_player_name",
                data.player.name
            );

            localStorage.setItem(
                "miltape_player_bet",
                data.player.bet.toString()
            );

            localStorage.setItem(
                "miltape_player_token",
                myToken
            );

            console.log(
                "✅ Session restaurée avec succès !"
            );

            hapticMedium();

        } else {

            console.warn(
                "⚠️ Restauration échouée :",
                data.message
            );

            localStorage.removeItem(
                "miltape_player_id"
            );

            localStorage.removeItem(
                "miltape_player_wallet"
            );

            localStorage.removeItem(
                "miltape_player_name"
            );

            localStorage.removeItem(
                "miltape_player_bet"
            );

            localStorage.removeItem(
                "miltape_player_token"
            );

            localStorage.removeItem(
                "miltape_spectator"
            );

            enterChallenge.style.display =
                'block';

            tapMessage.innerText =
                "⏳ Rejoins la nouvelle partie !";
        }
    }
);

// ==========================================
// 12. CONFIRMATION PAIEMENT
// ==========================================

socket.on(
    "payment:verified",
    (data) => {

        if (
            data.verified &&
            !isSpectator
        ) {

            isPaid = true;

            tapButton.disabled = false;

            hapticSuccess();

            if (data.automatic) {

                tapMessage.innerText =
                    "✅ Paiement automatique détecté ! Tape maintenant !";

            } else {

                tapMessage.innerText =
                    "✅ Paiement vérifié ! Tape maintenant !";
            }

            if (payButton) {
                payButton.style.display =
                    'none';
            }
        }
    }
);

// ==========================================
// 13. FIN DE PARTIE
// ==========================================

socket.on(
    "game:finished",
    (data) => {

        console.log(
            "🏁 Partie terminée !",
            data
        );

        if (tapCount) {
            tapCount.innerText = "0";
        }

        if (tapButtonCount) {
            tapButtonCount.innerText = "0";
        }

        isPlaying = false;
        isPaid = false;

        tapButton.disabled = true;

        if (!isSpectator) {

            let message =
                "🏆 RÉSULTATS DE LA PARTIE 🏆\n";

            message +=
                "═".repeat(30) +
                "\n\n";

            if (
                data.winners &&
                data.winners.length > 0
            ) {

                message +=
                    "🥇 Les 5 gagnants (2x leur mise) :\n\n";

                data.winners.forEach(
                    (w, index) => {

                        const emoji =
                            index === 0
                                ? "🥇"
                                : index === 1
                                ? "🥈"
                                : index === 2
                                ? "🥉"
                                : "🏅";

                        message +=
                            `${emoji} #${w.rank} ${w.name}\n`;

                        message +=
                            `   Mise : ${w.bet} USDT → Gain : ${w.gain} USDT\n\n`;
                    }
                );

                launchConfetti();

                hapticHeavy();

                data.winners.forEach(
                    (winner, index) => {

                        setTimeout(
                            () => {

                                addWinnerToTicker(
                                    winner.name,
                                    winner.gain,
                                    winner.rank
                                );

                            },
                            index * 200
                        );
                    }
                );

            } else {

                message +=
                    "❌ Aucun gagnant cette fois-ci.\n\n";
            }

            message +=
                "═".repeat(30) +
                "\n";

            message +=
                `💰 Total des mises : ${data.totalStakes} USDT\n`;

            message +=
                `💸 Total redistribué : ${data.totalPayout} USDT\n`;

            if (data.deficit > 0) {

                message +=
                    `📉 Déficit (serveur) : ${data.deficit} USDT\n`;

                message +=
                    `ℹ️ Le wallet du serveur a comblé la différence.\n`;

            } else {

                message +=
                    `✅ Bénéfice serveur : ${Math.abs(data.deficit)} USDT\n`;
            }

            message +=
                "═".repeat(30) +
                "\n";

            message +=
                "🔥 Prochaine partie dans 5 secondes...";

            tapMessage.innerText =
                `🏆 Partie terminée ! ${
                    data.winners
                        ? data.winners.length
                        : 0
                } gagnant(s) !`;

            alert(message);

            console.log(message);

        } else {

            tapMessage.innerText =
                "👁️ Partie terminée ! Prochaine partie dans 5 secondes...";
        }

        enterChallenge.style.display =
            'block';

        if (payButton) {
            payButton.style.display =
                'none';
        }

        if (betInput) {
            betInput.disabled = false;
        }

        if (spectatorBtn) {

            spectatorBtn.classList.remove(
                'active'
            );

            spectatorBtn.textContent =
                '👁️ REGARDER EN DIRECT (Spectateur)';
        }

        isSpectator = false;

        localStorage.removeItem(
            "miltape_player_id"
        );

        localStorage.removeItem(
            "miltape_player_wallet"
        );

        localStorage.removeItem(
            "miltape_player_name"
        );

        localStorage.removeItem(
            "miltape_player_bet"
        );

        localStorage.removeItem(
            "miltape_player_token"
        );

        localStorage.removeItem(
            "miltape_spectator"
        );
    }
);

// ==========================================
// 14. CONFETTIS
// ==========================================

function launchConfetti() {

    const colors = [
        '#ffd84d',
        '#ff5b20',
        '#ff2fd2',
        '#3dff9a',
        '#8b2cff',
        '#ff6b6b',
        '#4ecdc4',
        '#45b7d1'
    ];

    const container =
        document.querySelector('.app');

    for (let i = 0; i < 60; i++) {

        const confetti =
            document.createElement('div');

        const size =
            6 + Math.random() * 10;

        const isCircle =
            Math.random() > 0.5;

        confetti.style.cssText = `
            position: fixed;
            width: ${size}px;
            height: ${isCircle ? size : size * 0.4}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: ${isCircle ? '50%' : '2px'};
            top: -10px;
            left: ${Math.random() * 100}%;
            z-index: 9999;
            pointer-events: none;
            animation: confettiFall ${2 + Math.random() * 2}s linear forwards;
            animation-delay: ${Math.random() * 0.8}s;
            transform: rotate(${Math.random() * 360}deg);
            box-shadow: 0 0 6px rgba(255,255,255,0.1);
        `;

        document.body.appendChild(
            confetti
        );

        setTimeout(
            () => confetti.remove(),
            4000
        );
    }
}

// ==========================================
// 15. GESTION DES CLICS / TAPS
// ==========================================

function animateTapCount() {

    if (tapCount) {

        tapCount.classList.remove(
            'tap-count-pop'
        );

        void tapCount.offsetWidth;

        tapCount.classList.add(
            'tap-count-pop'
        );
    }
}

function tapEffects(event) {

    const btn = tapButton;

    const rect =
        btn.getBoundingClientRect();

    let x;
    let y;

    if (event.touches) {

        x =
            event.touches[0].clientX -
            rect.left;

        y =
            event.touches[0].clientY -
            rect.top;

    } else {

        x =
            event.clientX -
            rect.left;

        y =
            event.clientY -
            rect.top;
    }

    /*
       ==========================================
       +1 FLOTTANT SUPPRIMÉ
       ==========================================

       Le texte "+1" qui apparaissait autour
       du bouton a été complètement retiré.

       Aucun texte flottant n'est maintenant créé.
    */

    // Particules
    const colors = [
        '#ffd84d',
        '#ff9f1a',
        '#ff5b20',
        '#ff2fd2',
        '#8b2cff',
        '#3dff9a'
    ];

    for (let i = 0; i < 8; i++) {

        const particle =
            document.createElement('div');

        particle.className =
            'tap-particle';

        const size =
            3 + Math.random() * 8;

        const angle =
            Math.random() * Math.PI * 2;

        const distance =
            25 + Math.random() * 65;

        particle.style.width =
            size + 'px';

        particle.style.height =
            size + 'px';

        particle.style.left =
            (x - size / 2) + 'px';

        particle.style.top =
            (y - size / 2) + 'px';

        particle.style.background =
            colors[
                Math.floor(
                    Math.random() *
                    colors.length
                )
            ];

        particle.style.setProperty(
            '--tx',
            Math.cos(angle) *
                distance +
                'px'
        );

        particle.style.setProperty(
            '--ty',
            Math.sin(angle) *
                distance +
                'px'
        );

        btn.parentElement.appendChild(
            particle
        );

        setTimeout(
            () => particle.remove(),
            900
        );
    }

    // Ripple
    const ripple =
        document.createElement('div');

    ripple.className =
        'tap-ripple';

    ripple.style.left =
        x + 'px';

    ripple.style.top =
        y + 'px';

    btn.parentElement.appendChild(
        ripple
    );

    setTimeout(
        () => ripple.remove(),
        800
    );

    // Haptic Telegram
    hapticLight();
}

if (tapButton) {

    tapButton.addEventListener(
        'click',
        function(event) {

            if (
                !isPlaying ||
                tapButton.disabled ||
                !isPaid ||
                isSpectator
            ) {

                if (
                    !isPaid &&
                    !isSpectator
                ) {

                    tapMessage.innerText =
                        "⏳ Tu dois payer ta mise avant de taper !";

                    hapticError();

                    setTimeout(
                        () => {

                            tapMessage.innerText =
                                "💰 Paie ta mise pour taper !";

                        },
                        3000
                    );
                }

                return;
            }

            tapEffects(event);

            tapButton.classList.add(
                'tap-active'
            );

            setTimeout(
                () =>
                    tapButton.classList.remove(
                        'tap-active'
                    ),
                100
            );

            socket.emit(
                "player:tap"
            );
        }
    );
}

// ==========================================
// SCORE
// ==========================================

socket.on(
    "player:score",
    (data) => {

        if (tapCount) {

            tapCount.innerText =
                data.taps;

            animateTapCount();
        }

        if (tapButtonCount) {

            tapButtonCount.innerText =
                data.taps;
        }
    }
);

// ==========================================
// 16. CHRONOMÈTRE
// ==========================================

socket.on(
    "timer:update",
    (data) => {

        if (timerDisplay) {

            const minutes =
                Math.floor(
                    data.remainingSeconds /
                    60
                );

            const seconds =
                data.remainingSeconds %
                60;

            timerDisplay.innerText =
                `${minutes}:${seconds
                    .toString()
                    .padStart(2, '0')}`;
        }
    }
);

// ==========================================
// 17. TOTAL DES MISES
// ==========================================

socket.on(
    "totalStakes:update",
    (data) => {

        const displayBet =
            document.getElementById(
                'displayBet'
            );

        const displayBetTop =
            document.getElementById(
                'displayBetTop'
            );

        if (displayBet) {

            displayBet.textContent =
                `$${data.totalStakes}`;
        }

        if (displayBetTop) {

            displayBetTop.textContent =
                `$${data.totalStakes}`;
        }
    }
);

// ==========================================
// 18. ONLINE + LEADERBOARD
// ==========================================

socket.on(
    "online:count",
    (count) => {

        if (onlineCount) {

            onlineCount.innerHTML =
                `<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:5px;"></span><span>${count} EN LIGNE</span>`;
        }
    }
);

socket.on(
    "leaderboard:update",
    (leaderboard
