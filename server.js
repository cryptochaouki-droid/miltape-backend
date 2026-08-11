const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Stockage temporaire (en attendant une vraie DB)
let scores = {}; // { pseudo: score }
let chat = [];

io.on('connection', (socket) => {
    io.emit('playerCountUpdate', io.engine.clientsCount);

    // Chat mondial
    socket.on('sendMessage', (data) => {
        const msg = { pseudo: data.pseudo, text: data.text };
        chat.push(msg);
        io.emit('newMessage', msg);
    });

    // Score mondial
    socket.on('playerTap', (pseudo) => {
        scores[pseudo] = (scores[pseudo] || 0) + 1;
        io.emit('scoreUpdated', { pseudo: pseudo, score: scores[pseudo] });
    });

    socket.on('disconnect', () => io.emit('playerCountUpdate', io.engine.clientsCount));
});

server.listen(process.env.PORT || 3000);
