const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Servir les fichiers statiques
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Un utilisateur est connecté');
    
    socket.on('setPseudo', (pseudo) => {
        console.log('Pseudo reçu :', pseudo);
        socket.emit('pseudoAccepted');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
