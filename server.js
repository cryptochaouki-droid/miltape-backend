const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let scores = {}; 

io.on('connection', (socket) => {
    io.emit('playerCountUpdate', io.engine.clientsCount);

    socket.on('setPseudo', (p) => socket.pseudo = p);

    socket.on('playerTap', () => {
        if(socket.pseudo) {
            scores[socket.pseudo] = (scores[socket.pseudo] || 0) + 1;
            io.emit('scoreUpdated', { pseudo: socket.pseudo, score: scores[socket.pseudo] });
        }
    });

    socket.on('sendMessage', (data) => {
        io.emit('newMessage', { pseudo: data.pseudo, text: data.text });
    });

    socket.on('disconnect', () => io.emit('playerCountUpdate', io.engine.clientsCount));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Serveur actif sur port ${PORT}`));
