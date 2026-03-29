// Server entry point — HTTP + Socket.IO + static file serving

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { GameServer } from './GameServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

const clientDir = path.join(__dirname, '..', 'client', 'public');

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(clientDir, url === '/' ? 'index.html' : url);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7, // 10MB for map data
});

const GAME_MODE = process.env.GAME_MODE || 'arena'; // 'normal' or 'arena'
let game = new GameServer(io, GAME_MODE);

io.on('connection', socket => {
  console.log(`Player connected: ${socket.id}`);
  game.addPlayer(socket);

  socket.on('input', data => {
    game.handleInput(socket.id, data);
  });

  socket.on('fire', data => {
    game.handleFire(socket.id, data);
  });

  socket.on('pickup', data => {
    game.handlePickup(socket.id, data);
  });

  socket.on('use_item', data => {
    game.handleUseItem(socket.id, data);
  });

  socket.on('reload', () => {
    game.handleReload(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    game.removePlayer(socket.id);
  });

  socket.on('restart_server', () => {
    console.log('Server restart requested — regenerating map...');
    game.stop();
    game = new GameServer(io, GAME_MODE);
    game.start();
    // Reconnect all existing sockets
    for (const [, s] of io.sockets.sockets) {
      game.addPlayer(s);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  game.start();
});
