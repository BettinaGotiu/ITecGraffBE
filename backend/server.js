/**
 * server.js
 * Entry point for the ITec Graff collaborative drawing backend.
 *
 * Start the server with:
 *   node server.js
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { registerSocketHandlers } = require('./socketHandlers');
const roomManager = require('./roomManager');
const userManager = require('./userManager');

const PORT = 3000;

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Debug REST endpoints
// ---------------------------------------------------------------------------

/** List all active rooms */
app.get('/rooms', (req, res) => {
  res.json(roomManager.getAllRooms());
});

/** Get a specific room by posterId */
app.get('/rooms/:posterId', (req, res) => {
  const room = roomManager.getRoom(req.params.posterId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(room);
});

/** List all connected users */
app.get('/users', (req, res) => {
  res.json(userManager.getAllUsers());
});

// ---------------------------------------------------------------------------
// HTTP server + Socket.IO
// ---------------------------------------------------------------------------
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Register all Socket.IO event handlers
registerSocketHandlers(io);

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`ITec Graff backend running on http://localhost:${PORT}`);
});

module.exports = { app, httpServer };
