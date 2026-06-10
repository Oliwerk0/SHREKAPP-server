const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function broadcastToRoom(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

function sendToPlayer(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  console.log('New connection');
  ws.playerId = Math.random().toString(36).substr(2, 9);
  ws.roomCode = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    switch (msg.type) {

      // Create a new room
      case 'CREATE_ROOM': {
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();

        const room = {
          code,
          players: [{ ws, id: ws.playerId, ready: false }],
          gameState: null,
          started: false
        };
        rooms.set(code, room);
        ws.roomCode = code;

        sendToPlayer(ws, {
          type: 'ROOM_CREATED',
          roomCode: code,
          playerId: ws.playerId,
          playerIndex: 0
        });
        console.log(`Room created: ${code}`);
        break;
      }

      // Join existing room
      case 'JOIN_ROOM': {
        const code = msg.roomCode?.toUpperCase();
        const room = rooms.get(code);

        if (!room) {
          sendToPlayer(ws, { type: 'ERROR', message: 'Room not found' });
          break;
        }
        if (room.players.length >= 2) {
          sendToPlayer(ws, { type: 'ERROR', message: 'Room is full' });
          break;
        }
        if (room.started) {
          sendToPlayer(ws, { type: 'ERROR', message: 'Game already started' });
          break;
        }

        room.players.push({ ws, id: ws.playerId, ready: false });
        ws.roomCode = code;

        sendToPlayer(ws, {
          type: 'ROOM_JOINED',
          roomCode: code,
          playerId: ws.playerId,
          playerIndex: 1
        });

        // Notify both players that room is full
        broadcastToRoom(room, {
          type: 'PLAYER_JOINED',
          playerCount: room.players.length
        });

        console.log(`Player joined room: ${code}`);
        break;
      }

      // Player ready
      case 'PLAYER_READY': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;

        const player = room.players.find(p => p.id === ws.playerId);
        if (player) player.ready = true;

        const allReady = room.players.length === 2 && room.players.every(p => p.ready);
        if (allReady) {
          room.started = true;
          broadcastToRoom(room, { type: 'GAME_START' });
          console.log(`Game started in room: ${ws.roomCode}`);
        }
        break;
      }

      // Paddle move
      case 'PADDLE_MOVE': {
        const room = rooms.get(ws.roomCode);
        if (!room || !room.started) break;

        broadcastToRoom(room, {
          type: 'PADDLE_MOVE',
          playerId: ws.playerId,
          x: msg.x
        }, ws);
        break;
      }

      // Ball state (sent by host/player 0)
      case 'BALL_STATE': {
        const room = rooms.get(ws.roomCode);
        if (!room || !room.started) break;

        broadcastToRoom(room, {
          type: 'BALL_STATE',
          x: msg.x,
          y: msg.y,
          vx: msg.vx,
          vy: msg.vy
        }, ws);
        break;
      }

      // Brick destroyed
      case 'BRICK_HIT': {
        const room = rooms.get(ws.roomCode);
        if (!room || !room.started) break;

        broadcastToRoom(room, {
          type: 'BRICK_HIT',
          brickId: msg.brickId
        }, ws);
        break;
      }

      // Game over
      case 'GAME_OVER': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;

        broadcastToRoom(room, {
          type: 'GAME_OVER',
          winner: msg.winner,
          score: msg.score
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (room) {
      broadcastToRoom(room, { type: 'PLAYER_DISCONNECTED' });
      rooms.delete(ws.roomCode);
      console.log(`Room ${ws.roomCode} deleted (player disconnected)`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

console.log(`SHREKAPP server running on port ${PORT}`);