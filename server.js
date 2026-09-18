// ✅ NOUVEAU : bandeau des gagnants (dernière manche terminée)
app.get("/winners/recent", async (req, res) => {
    try {
        const lastFinishedGame = await GameState.findOne({ status: "finished" })
            .sort({ updatedAt: -1 })
            .select("gameId")
            .lean();
        
        if (!lastFinishedGame) {
            return res.json({ success: true, winners: [] });
        }

        const winners = await History.find({ gameId: lastFinishedGame.gameId })
            .sort({ rank: 1 })
            .limit(5)
            .select("playerName gain token -_id")
            .lean();

        res.json({
            success: true,
            winners: winners.map(w => ({
                pseudo: w.playerName,
                montant: w.gain,
                token: w.token
            }))
        });
    } catch (error) {
        console.error("❌ /winners/recent :", error?.message);
        res.status(500).json({ success: false, winners: [] });
    }
});
