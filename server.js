const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Connexion à MongoDB Atlas
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    }).then(() => console.log("📦 Connecté à MongoDB"))
      .catch(err => console.error("Erreur MongoDB :", err));
}

io.on('connection', (socket) => {
    console.log(`⚡ Nouveau joueur connecté : ${socket.id}`);

    socket.on('setPseudo', (pseudo) => {
        if(pseudo && pseudo.trim() !== "") {
            console.log(`Pseudo reçu du client : ${pseudo}`);
            socket.emit('pseudoAccepted');
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Déconnecté : ${socket.id}`);
    });
});

// UTILISATION OBLIGATOIRE DU PORT DYNAMIQUE RAILWAY
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur MILTAPE en ligne sur le port ${PORT}`);
});
