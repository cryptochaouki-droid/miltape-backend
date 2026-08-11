/* =========================================================
   MILTAPE WORLD CHALLENGE
   VRAI CLASSEMENT + VRAI CHAT TEMPS RÉEL
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIGURATION SUPABASE
   --------------------------------------------------------- */

const SUPABASE_URL = "TON_URL_SUPABASE";
const SUPABASE_ANON_KEY = "TA_CLE_ANON_SUPABASE";

const { createClient } = window.supabase;

const db = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);


/* ---------------------------------------------------------
   2. ÉTAT DU JOUEUR
   --------------------------------------------------------- */

let playerId = localStorage.getItem("miltape_player_id");
let playerName = localStorage.getItem("miltape_player_name");

if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem("miltape_player_id", playerId);
}

if (!playerName) {
    playerName = "Joueur-" + Math.floor(Math.random() * 9999);
    localStorage.setItem("miltape_player_name", playerName);
}

let currentGameId = null;
let tapCount = 0;
let gameStarted = false;
let gameFinished = false;


/* ---------------------------------------------------------
   3. CRÉER / RÉCUPÉRER LA PARTIE ACTIVE
   --------------------------------------------------------- */

async function getActiveGame() {

    const { data, error } = await db
        .from("games")
        .select("*")
        .eq("status", "waiting")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Erreur partie :", error);
        return null;
    }

    if (data) {
        currentGameId = data.id;
        return data;
    }

    return await createGame();
}


/* ---------------------------------------------------------
   4. CRÉER UNE PARTIE
   --------------------------------------------------------- */

async function createGame() {

    const now = new Date();
    const end = new Date(now.getTime() + 10 * 60 * 1000);

    const { data, error } = await db
        .from("games")
        .insert({
            status: "waiting",
            starts_at: now.toISOString(),
            ends_at: end.toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error("Création partie impossible :", error);
        return null;
    }

    currentGameId = data.id;

    return data;
}


/* ---------------------------------------------------------
   5. REJOINDRE UNE PARTIE
   --------------------------------------------------------- */

async function joinGame() {

    const game = await getActiveGame();

    if (!game) {
        alert("Impossible de rejoindre la partie.");
        return;
    }

    currentGameId = game.id;

    const { error } = await db
        .from("players")
        .upsert({
            id: playerId,
            name: playerName,
            game_id: currentGameId,
            score: 0,
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error("Erreur inscription :", error);
        alert("Impossible de rejoindre la partie.");
        return;
    }

    tapCount = 0;
    gameStarted = true;
    gameFinished = false;

    console.log("Joueur connecté :", playerName);

    startGameTimer(game);
    loadLeaderboard();
}


/* ---------------------------------------------------------
   6. TAPER
   --------------------------------------------------------- */

async function registerTap() {

    if (!gameStarted || gameFinished || !currentGameId) {
        return;
    }

    tapCount++;

    /*
       Mise à jour du score côté serveur.
       On envoie le nouveau score.
    */

    const { error } = await db
        .from("players")
        .update({
            score: tapCount,
            updated_at: new Date().toISOString()
        })
        .eq("id", playerId)
        .eq("game_id", currentGameId);

    if (error) {
        console.error("Erreur score :", error);
        return;
    }

    updateLocalScore();
}


/* ---------------------------------------------------------
   7. AFFICHER LE SCORE
   --------------------------------------------------------- */

function updateLocalScore() {

    const elements = document.querySelectorAll(
        "#score, .score, [data-score]"
    );

    elements.forEach(element => {
        element.textContent = tapCount.toLocaleString("fr-FR");
    });
}


/* ---------------------------------------------------------
   8. CHARGER LE CLASSEMENT
   --------------------------------------------------------- */

async function loadLeaderboard() {

    if (!currentGameId) return;

    const { data, error } = await db
        .from("players")
        .select("id,name,score")
        .eq("game_id", currentGameId)
        .order("score", { ascending: false })
        .limit(5);

    if (error) {
        console.error("Erreur classement :", error);
        return;
    }

    displayLeaderboard(data);
}


/* ---------------------------------------------------------
   9. AFFICHER LE TOP 5
   --------------------------------------------------------- */

function displayLeaderboard(players) {

    let container =
        document.querySelector("#leaderboard") ||
        document.querySelector(".leaderboard") ||
        document.querySelector("[data-leaderboard]");

    if (!container) {
        console.warn("Zone classement introuvable.");
        return;
    }

    container.innerHTML = "";

    players.forEach((player, index) => {

        const row = document.createElement("div");

        row.className = "leaderboard-row";

        let medal = "";

        if (index === 0) medal = "🥇";
        else if (index === 1) medal = "🥈";
        else if (index === 2) medal = "🥉";
        else medal = `${index + 1}`;

        row.innerHTML = `
            <div class="rank">${medal}</div>
            <div class="player-name">
                ${escapeHTML(player.name)}
            </div>
            <div class="player-score">
                ${Number(player.score).toLocaleString("fr-FR")}
            </div>
        `;

        container.appendChild(row);
    });
}


/* ---------------------------------------------------------
   10. TEMPS RÉEL DU CLASSEMENT
   --------------------------------------------------------- */

function subscribeLeaderboard() {

    if (!currentGameId) return;

    db
        .channel("miltape-leaderboard-" + currentGameId)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "players",
                filter: `game_id=eq.${currentGameId}`
            },
            () => {
                loadLeaderboard();
            }
        )
        .subscribe();
}


/* ---------------------------------------------------------
   11. CHAT
   --------------------------------------------------------- */

async function sendChatMessage() {

    const input =
        document.querySelector("#chatInput") ||
        document.querySelector("[data-chat-input]");

    if (!input) return;

    const message = input.value.trim();

    if (!message) return;

    if (message.length > 250) {
        alert("Message trop long.");
        return;
    }

    const { error } = await db
        .from("chat_messages")
        .insert({
            player_id: playerId,
            player_name: playerName,
            message: message
        });

    if (error) {
        console.error("Erreur chat :", error);
        alert("Impossible d'envoyer le message.");
        return;
    }

    input.value = "";
}


/* ---------------------------------------------------------
   12. CHARGER LE CHAT
   --------------------------------------------------------- */

async function loadChat() {

    const { data, error } = await db
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(100);

    if (error) {
        console.error("Erreur chargement chat :", error);
        return;
    }

    data.forEach(message => {
        displayChatMessage(message);
    });
}


/* ---------------------------------------------------------
   13. AFFICHER MESSAGE
   --------------------------------------------------------- */

function displayChatMessage(message) {

    const container =
        document.querySelector("#chatMessages") ||
        document.querySelector(".chat-messages") ||
        document.querySelector("[data-chat-messages]");

    if (!container) return;

    const div = document.createElement("div");

    div.className = "chat-message";

    div.innerHTML = `
        <strong>${escapeHTML(message.player_name)}</strong>
        <span>${escapeHTML(message.message)}</span>
    `;

    container.appendChild(div);

    container.scrollTop = container.scrollHeight;
}


/* ---------------------------------------------------------
   14. CHAT TEMPS RÉEL
   --------------------------------------------------------- */

function subscribeChat() {

    db
        .channel("miltape-global-chat")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "chat_messages"
            },
            payload => {
                displayChatMessage(payload.new);
            }
        )
        .subscribe();
}


/* ---------------------------------------------------------
   15. TIMER
   --------------------------------------------------------- */

function startGameTimer(game) {

    const timer =
        document.querySelector("#timer") ||
        document.querySelector(".timer") ||
        document.querySelector("[data-timer]");

    function updateTimer() {

        const end = new Date(game.ends_at).getTime();
        const now = Date.now();

        const remaining = Math.max(0, end - now);

        const minutes =
            Math.floor(remaining / 60000)
                .toString()
                .padStart(2, "0");

        const seconds =
            Math.floor((remaining % 60000) / 1000)
                .toString()
                .padStart(2, "0");

        if (timer) {
            timer.textContent = `${minutes}:${seconds}`;
        }

        if (remaining <= 0) {

            clearInterval(interval);

            gameFinished = true;
            gameStarted = false;

            finishGame();
        }
    }

    updateTimer();

    const interval = setInterval(updateTimer, 1000);
}


/* ---------------------------------------------------------
   16. FIN DE PARTIE
   --------------------------------------------------------- */

async function finishGame() {

    await loadLeaderboard();

    alert(
        "🏆 PARTIE TERMINÉE !\n\n" +
        "Le classement final est en cours de calcul."
    );
}


/* ---------------------------------------------------------
   17. UTILITAIRE ANTI HTML
   --------------------------------------------------------- */

function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ---------------------------------------------------------
   18. BOUTON TAP
   --------------------------------------------------------- */

function setupTapButton() {

    const button =
        document.querySelector("#tapButton") ||
        document.querySelector(".tap-button") ||
        document.querySelector("[data-tap]");

    if (!button) {
        console.warn("Bouton TAP introuvable.");
        return;
    }

    button.addEventListener("click", registerTap);

    button.addEventListener(
        "touchstart",
        event => {
            event.preventDefault();
            registerTap();
        },
        { passive: false }
    );
}


/* ---------------------------------------------------------
   19. BOUTON JOUER
   --------------------------------------------------------- */

function setupPlayButton() {

    const buttons = document.querySelectorAll(
        "#playButton, .play-button, [data-play]"
    );

    buttons.forEach(button => {

        button.addEventListener("click", async () => {

            await joinGame();

            subscribeLeaderboard();
        });
    });
}


/* ---------------------------------------------------------
   20. CHAT INPUT
   --------------------------------------------------------- */

function setupChat() {

    const button =
        document.querySelector("#sendChat") ||
        document.querySelector("[data-send-chat]");

    if (button) {
        button.addEventListener("click", sendChatMessage);
    }

    const input =
        document.querySelector("#chatInput") ||
        document.querySelector("[data-chat-input]");

    if (input) {

        input.addEventListener("keydown", event => {

            if (event.key === "Enter") {
                event.preventDefault();
                sendChatMessage();
            }

        });
    }
}


/* ---------------------------------------------------------
   21. DÉMARRAGE
   --------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", async () => {

    console.log("🔥 MILTAPE WORLD CHALLENGE");

    setupTapButton();
    setupPlayButton();
    setupChat();

    await loadChat();

    subscribeChat();
});
