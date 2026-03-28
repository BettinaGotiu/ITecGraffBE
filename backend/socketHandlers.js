/**
 * socketHandlers.js
 * Registers all Socket.IO event handlers and routes them to the appropriate managers.
 */

const userManager = require('./userManager');
const roomManager = require('./roomManager');
const gameEngine = require('./gameEngine');

// Interval (ms) between territory-update broadcasts per room.
const TERRITORY_UPDATE_INTERVAL_MS = 3000;

/**
 * Attach Socket.IO event handlers to the given `io` instance.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
  // Periodically broadcast territory updates to every active room.
  setInterval(() => {
    const rooms = roomManager.getAllRooms();
    Object.values(rooms).forEach((room) => {
      if (room.users.length > 0) {
        io.to(room.posterId).emit('territoryUpdate', {
          posterId: room.posterId,
          teamCoverage: room.teamCoverage,
        });
      }
    });
  }, TERRITORY_UPDATE_INTERVAL_MS);

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ------------------------------------------------------------------
    // 1. Register User
    // ------------------------------------------------------------------
    socket.on('registerUser', ({ userId, username, teamId } = {}) => {
      if (!userId || !username || !teamId) {
        console.warn(`[registerUser] missing fields from ${socket.id}`);
        return;
      }
      userManager.registerUser(socket.id, { userId, username, teamId });
      console.log(`[registerUser] userId=${userId} username=${username} teamId=${teamId}`);
    });

    // ------------------------------------------------------------------
    // 2. Join Poster Room
    // ------------------------------------------------------------------
    socket.on('joinPosterRoom', ({ posterId, userId } = {}) => {
      if (!posterId || !userId) {
        console.warn(`[joinPosterRoom] missing fields from ${socket.id}`);
        return;
      }

      // Ensure the user is registered (auto-register with unknown data if needed)
      let user = userManager.getUser(userId);
      if (!user) {
        userManager.registerUser(socket.id, { userId, username: userId, teamId: 'teamA' });
        user = userManager.getUser(userId);
      }

      // Create or fetch room
      const room = roomManager.getOrCreateRoom(posterId);

      // Add user to room
      roomManager.addUserToRoom(posterId, userId);
      userManager.setCurrentPoster(userId, posterId);

      // Join the Socket.IO room
      socket.join(posterId);

      console.log(`[joinPosterRoom] userId=${userId} joined posterId=${posterId}`);

      // Send full room state to the new user
      socket.emit('roomState', {
        posterId: room.posterId,
        strokes: room.strokes,
        teamCoverage: room.teamCoverage,
      });
    });

    // ------------------------------------------------------------------
    // 3. Drawing Updates – Stroke Batching
    // ------------------------------------------------------------------
    socket.on('drawBatch', (data = {}) => {
      const { posterId, userId, teamId, strokes } = data;

      if (!posterId || !userId || !teamId || !Array.isArray(strokes)) {
        console.warn(`[drawBatch] invalid payload from ${socket.id}`);
        return;
      }

      const room = roomManager.getRoom(posterId);
      if (!room) {
        console.warn(`[drawBatch] room not found: ${posterId}`);
        return;
      }

      // Process strokes and update territory
      gameEngine.processDrawBatch(posterId, teamId, strokes);

      // Broadcast to all users in the room (including the sender)
      io.to(posterId).emit('drawBatch', data);
    });

    // ------------------------------------------------------------------
    // 4. Disconnect Handling
    // ------------------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);

      const user = userManager.getUserBySocketId(socket.id);
      if (!user) return;

      const { userId, currentPoster } = user;

      // Remove from room
      if (currentPoster) {
        roomManager.removeUserFromRoom(currentPoster, userId);
        io.to(currentPoster).emit('userLeft', { userId });
        console.log(`[disconnect] userId=${userId} left posterId=${currentPoster}`);
      }

      // Remove from user store
      userManager.removeUser(userId);
    });
  });
}

module.exports = { registerSocketHandlers };
