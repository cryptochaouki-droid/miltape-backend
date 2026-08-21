// ==========================================
// RESTAURER LA SESSION (via événement socket)
// ==========================================
async function restoreSession() {
    const playerId = localStorage.getItem("miltape_player_id");
    const wallet = localStorage.getItem("miltape_player_wallet");
    const name = localStorage.getItem("miltape_player_name");

    if (!playerId || !wallet || !name) {
        console.log("🔍 Aucune session trouvée.");
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

    // Envoyer l'événement de restauration
    socket.emit("player:restore", { playerId, wallet });
    console.log("🔄 Demande de restauration envoyée...");
    return true;
}
