// ==========================================
// RESTAURER LA CONNEXION SOCKET (associer le socket au joueur)
// ==========================================
async function restorePlayer() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const name = localStorage.getItem("miltape_player_name");
    const bet = parseFloat(localStorage.getItem("miltape_player_bet")) || 10;

    if (!playerId || !wallet || !name) {
        console.log("🔍 Aucune donnée de joueur pour restauration.");
        return false;
    }

    // Vérifier que la partie est encore en cours
    try {
        const res = await fetch(`${API_URL}/api/status`);
        const data = await res.json();
        if (data.status !== "running") {
            console.log("⏰ La partie est terminée, pas de restauration.");
            localStorage.removeItem("miltape_player_id");
            localStorage.removeItem("miltape_player_wallet");
            localStorage.removeItem("miltape_player_name");
            localStorage.removeItem("miltape_player_bet");
            return false;
        }
    } catch (error) {
        console.error("❌ Erreur vérification statut :", error);
        return false;
    }

    // Ré-émettre l'événement player:join pour associer le socket
    socket.emit("player:join", { name, wallet, bet });
    console.log("🔄 Restauration du joueur en cours...");
    return true;
}
