<!DOCTYPE html>
<html lang="fr">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0d47a1" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="description" content="Miltape World Challenge — Tape, classe-toi, gagne." />
  <title>Miltape World Challenge</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap" rel="stylesheet" />
  
  <!-- Script Telegram sécurisé -->
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script>
    (function initTelegramWebApp() {
      try {
        if (window.Telegram && window.Telegram.WebApp) {
          const w = window.Telegram.WebApp;
          w.ready();
          w.expand();
          window.triggerHaptic = function(style = 'medium') {
            try {
              if (w.isVersionAtLeast && w.isVersionAtLeast('6.1') && w.HapticFeedback) {
                w.HapticFeedback.impactOccurred(style);
              }
            } catch (err) {}
          };
        }
      } catch (e) {}
    })();
  </script>

  <!-- Désactivation du cache -->
  <script>
    if ('caches' in window) {
        caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
  </script>
  
  <!-- CDN Socket.IO & TON Connect -->
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>
  
  <style>
    body {
      font-family: 'Poppins', sans-serif;
      background: radial-gradient(ellipse at 40% 30%, #1a6fb5 0%, #0d47a1 35%, #0a2a5c 65%, #051230 100%);
      min-height: 100vh;
      margin: 0;
      padding: 0;
      color: white;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
    }
    .app { width: 100%; max-width: 480px; min-height: 100vh; margin: 0 auto; padding: 20px; box-sizing: border-box; padding-bottom: 80px; }
    .glass-card { background: rgba(255, 255, 255, .10); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, .12); box-shadow: 0 8px 32px rgba(0, 0, 0, .3); border-radius: 24px; padding: 20px; margin-bottom: 20px; text-align: center; }
    .btn { background: linear-gradient(135deg, #00c6ff, #0072ff); color: white; border: none; padding: 12px 24px; font-weight: bold; border-radius: 12px; cursor: pointer; font-size: 16px; width: 100%; margin-top: 10px; box-shadow: 0 4px 15px rgba(0,114,255,0.4); }
    .btn-demo { background: linear-gradient(135deg, #f39c12, #d35400); box-shadow: 0 4px 15px rgba(243,156,18,0.4); }
    .tap-button { width: 180px; height: 180px; border-radius: 50%; background: radial-gradient(circle, #00c6ff 0%, #0072ff 100%); border: 6px solid rgba(255,255,255,0.3); font-size: 32px; font-weight: 900; color: white; cursor: pointer; box-shadow: 0 0 30px rgba(0,198,255,0.6); margin: 20px auto; display: flex; align-items: center; justify-content: center; transition: transform 0.05s ease; }
    .tap-button:active { transform: scale(0.92); }
    input, select { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; box-sizing: border-box; }
    .hidden { display: none !important; }
  </style>
</head>

<body>
  <div class="app">
    <!-- En-tête Statut -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <span style="font-size: 14px;" id="connectionStatus">● Connexion...</span>
      <div id="ton-connect"></div>
    </div>

    <!-- ÉCRAN 1 : INSCRIPTION / MODE DÉMO -->
    <div id="screen-join" class="glass-card">
      <h2>Miltape World Challenge</h2>
      <p>Entrez dans l'arène, tapez et gagnez !</p>
      
      <input type="text" id="playerName" placeholder="Votre Pseudo" maxlength="30" />
      <input type="text" id="playerWallet" placeholder="Votre Adresse Wallet TRON" />
      
      <select id="gameToken">
        <option value="USDT">USDT</option>
        <option value="USDC">USDC</option>
        <option value="TUSD">TUSD</option>
        <option value="TRX">TRX</option>
      </select>

      <input type="number" id="gameBet" placeholder="Montant de la mise (ex: 5)" min="1" value="5" />

      <button class="btn" id="btnJoinReal">Rejoindre la Partie (Réel)</button>
      <button class="btn btn-demo" id="btnJoinDemo">🎮 Jouer en Mode Démo (Gratuit)</button>
    </div>

    <!-- ÉCRAN 2 : LE JEU & LE TAP -->
    <div id="screen-game" class="glass-card hidden">
      <h3>Partie en cours ⚡</h3>
      <p>Temps restant : <span id="timerDisplay" style="font-family: 'Orbitron'; font-weight: bold; color: #00c6ff;">--:--</span></p>
      
      <div style="margin: 15px 0;">
        <span style="font-size: 14px; opacity: 0.8;">Vos Taps :</span>
        <h1 id="myTapsCount" style="font-family: 'Orbitron'; font-size: 48px; margin: 5px 0;">0</h1>
      </div>

      <button class="tap-button" id="tapBtn">TAPE !</button>

      <div style="margin-top: 20px; text-align: left;">
        <h4>🏆 Classement en direct</h4>
        <div id="leaderboardList" style="max-height: 150px; overflow-y: auto; font-size: 14px;"></div>
      </div>
    </div>
  </div>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const BACKEND_URL = 'https://miltape-backend-production.up.railway.app';
      const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

      let currentSessionToken = localStorage.getItem('miltape_session') || '';

      // Gestion Statut Connexion
      socket.on('connect', () => {
        console.log("✅ Connecté au WebSocket du serveur");
        document.getElementById('connectionStatus').textContent = "● Connecté";
        document.getElementById('connectionStatus').style.color = "#2ecc71";
        
        if (currentSessionToken) {
          socket.emit('player:restore', { sessionToken: currentSessionToken });
        }
      });

      socket.on('connect_error', (err) => {
        console.error("❌ Erreur connexion WebSocket :", err);
        document.getElementById('connectionStatus').textContent = "● Hors ligne";
        document.getElementById('connectionStatus').style.color = "#ff4b2b";
      });

      // Bouton Mode Réel
      document.getElementById('btnJoinReal').addEventListener('click', () => {
        registerPlayer(false);
      });

      // Bouton Mode Démo
      document.getElementById('btnJoinDemo').addEventListener('click', () => {
        console.log("🎮 Clic sur Mode Démo détecté");
        registerPlayer(true);
      });

      function registerPlayer(demoMode) {
        const name = document.getElementById('playerName').value.trim();
        const wallet = document.getElementById('playerWallet').value.trim() || "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
        const token = demoMode ? "USDT" : document.getElementById('gameToken').value;
        const bet = demoMode ? 0 : (parseFloat(document.getElementById('gameBet').value) || 5);

        if (!name) {
          alert("Veuillez entrer un pseudo.");
          return;
        }

        const deviceId = "DEV-" + Math.random().toString(36).substring(2);

        console.log("📤 Envoi de player:join au serveur :", { name, wallet, bet, token, demoMode });
        socket.emit('player:join', {
          name,
          wallet,
          deviceId,
          bet,
          token
        });
      }

      socket.on('player:joined', (data) => {
        console.log("📥 Réponse player:joined reçue du serveur :", data);
        if (data.success) {
          if (data.player.sessionToken) {
            currentSessionToken = data.player.sessionToken;
            localStorage.setItem('miltape_session', currentSessionToken);
          }
          document.getElementById('screen-join').classList.add('hidden');
          document.getElementById('screen-game').classList.remove('hidden');
        } else {
          alert("Erreur lors de l'inscription au jeu.");
        }
      });

      socket.on('error', (err) => {
        console.error("⚠️ Erreur serveur reçue :", err);
        alert("Erreur : " + (err.message || "Inconnue"));
      });

      // Action de Tap
      const tapBtn = document.getElementById('tapBtn');
      tapBtn.addEventListener('click', () => {
        if (window.triggerHaptic) window.triggerHaptic('medium');
        
        const tapsEl = document.getElementById('myTapsCount');
        tapsEl.textContent = parseInt(tapsEl.textContent) + 1;

        socket.emit('player:tap');
      });

      // Mise à jour du Timer
      socket.on('timer:update', (data) => {
        const minutes = Math.floor(data.remainingSeconds / 60);
        const seconds = data.remainingSeconds % 60;
        document.getElementById('timerDisplay').textContent = 
          `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      });

      // Mise à jour du Classement
      socket.on('leaderboard:update', (leaderboard) => {
        const listEl = document.getElementById('leaderboardList');
        listEl.innerHTML = leaderboard.map(p => 
          `<div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <span>#${p.rank} ${p.name}</span>
            <span><strong>${p.taps}</strong> taps</span>
          </div>`
        ).join('');
      });
    });
  </script>
</body>
</html>
