/**
 * socketHandlers.js
 * Registers all Socket.IO event handlers and routes them to the appropriate managers.
 */

const userManager = require('./userManager');
const roomManager = require('./roomManager');
const gameEngine = require('./gameEngine');
const firestoreService = require('./firestoreService');

// Validation constants – override via env vars.
const MAX_TEAM_MEMBERS = parseInt(process.env.MAX_TEAM_MEMBERS, 10) || 4;
const MIN_LEVEL = parseInt(process.env.MIN_LEVEL, 10) || 1;

// Per-room countdown timer handles: { posterId: intervalId }
const roomTimers = {};

// ─── Game timer helpers ───────────────────────────────────────────────────────

function startRoomTimer(io, posterId) {
  if (roomTimers[posterId]) return; // already running
  roomManager.activateGame(posterId);

  roomTimers[posterId] = setInterval(() => {
    const room = roomManager.getRoom(posterId);
    if (!room || !room.gameActive) {
      clearInterval(roomTimers[posterId]);
      delete roomTimers[posterId];
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((room.gameEndTime - Date.now()) / 1000));
    const currentCoverage = gameEngine.getTeamCoverage(posterId) || {};

    // Aliniat cu Frontend-ul: timeLeft și coverage trimise la fiecare secundă
    io.to(posterId).emit('timerUpdate', { 
      posterId, 
      timeLeft: secondsLeft, 
      coverage: currentCoverage 
    });

    if (secondsLeft <= 0) {
      clearInterval(roomTimers[posterId]);
      delete roomTimers[posterId];
      finalizeGame(io, posterId);
    }
  }, 1000);
}

async function finalizeGame(io, posterId) {
  const room = roomManager.getRoom(posterId);
  if (!room) return;

  roomManager.deactivateGame(posterId);

  const result = gameEngine.calculateGameResult(posterId);
  if (!result) return;

  io.to(posterId).emit('gameResult', result);
  console.log(`[gameResult] posterId=${posterId} winner=${result.winnerTeam}`);

  // Persist strokes and user stats to Firestore (no-op when unconfigured).
  await firestoreService.saveStrokes(posterId, room.strokes);

  const winningTeam = result.winnerTeam;
  for (const [uid, xp] of Object.entries(result.xp)) {
    const user = userManager.getUser(uid);
    const isWinner = winningTeam && user && user.teamId === winningTeam;
    userManager.updateUserStats(uid, { xp, wins: isWinner ? 1 : 0, gamesPlayed: 1 });
    await firestoreService.saveUserStats(uid, { xp, wins: isWinner ? 1 : 0, gamesPlayed: 1 });
  }
}

// ─── Join logic (shared by joinRoom and joinPosterRoom) ───────────────────────

function handleJoinRoom(socket, io, { posterId, userId, teamId }) {
  if (!posterId || !userId || !teamId) {
    socket.emit('joinError', { code: 'INVALID_PAYLOAD', message: 'posterId, userId and teamId are required.' });
    return;
  }

  // Ensure user is registered.
  let user = userManager.getUser(userId);
  if (!user) {
    userManager.registerUser(socket.id, { userId, username: userId, teamId, level: 1 });
    user = userManager.getUser(userId);
  } else {
    // Update socket id in case of reconnect.
    user.socketId = socket.id;
    user.teamId = teamId;
  }

  // Validate minimum level.
  if (user.level < MIN_LEVEL) {
    socket.emit('joinError', {
      code: 'LEVEL_TOO_LOW',
      message: `Minimum level required to join is ${MIN_LEVEL}.`,
    });
    return;
  }

  // Validate team size.
  const room = roomManager.getOrCreateRoom(posterId);
  const currentCount = roomManager.getTeamMemberCount(posterId, teamId);
  if (currentCount >= MAX_TEAM_MEMBERS) {
    socket.emit('joinError', {
      code: 'TEAM_FULL',
      message: `Team ${teamId} is full (max ${MAX_TEAM_MEMBERS} members).`,
    });
    return;
  }

  // Detect rival teams already present (before adding this user).
  const existingTeams = Object.keys(room.teamMembers).filter(
    (t) => room.teamMembers[t].length > 0 && t !== teamId,
  );
  const rivalPresent = existingTeams.length > 0;

  // Add user to room and join the Socket.IO room.
  roomManager.addUserToRoom(posterId, userId, teamId);
  userManager.setCurrentPoster(userId, posterId);
  socket.join(posterId);

  console.log(`[joinRoom] userId=${userId} teamId=${teamId} joined posterId=${posterId}`);

  // Start the game timer when the first user enters.
  if (!roomTimers[posterId]) {
    startRoomTimer(io, posterId);
  }

  // Send full room state to the joining user.
  socket.emit('roomState', {
    posterId,
    strokes: room.strokes,
    teamMembers: room.teamMembers,
    teamCoverage: room.teamCoverage,
    gameActive: room.gameActive,
    gameEndTime: room.gameEndTime,
  });

  // Notify others that a new user joined.
  socket.to(posterId).emit('userJoined', {
    userId,
    teamId,
    rivalPresent, // Tells the client if an opposing team is also here
  });
}

// ─── Socket.IO Handler Registration ───────────────────────────────────────────

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── 1. Register User ────────────────────────────────────────────────────
    socket.on('registerUser', ({ userId, username, teamId, level } = {}) => {
      if (!userId || !username || !teamId) {
        console.warn(`[registerUser] missing fields from ${socket.id}`);
        return;
      }
      userManager.registerUser(socket.id, { userId, username, teamId, level });
      console.log(`[registerUser] userId=${userId} username=${username} teamId=${teamId} level=${level || 1}`);
    });

    // ── 2a. joinRoom (new DTO: { userId, teamId, posterId }) ────────────────
    socket.on('joinRoom', (data = {}) => {
      handleJoinRoom(socket, io, data);
    });

    // ── 2b. joinPosterRoom (backward-compatible alias) ──────────────────────
    socket.on('joinPosterRoom', ({ posterId, userId } = {}) => {
      const user = userManager.getUser(userId);
      const teamId = (user && user.teamId) || 'teamA';
      handleJoinRoom(socket, io, { posterId, userId, teamId });
    });

    // ── 3. drawBatch ────────────────────────────────────────────────────────
    // Client sends: { posterId, userId, teamId, strokes[] }
    // Server broadcasts drawUpdate: { posterId, strokes, teamId, userId }
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

      // Process strokes – updates team + user coverage.
      gameEngine.processDrawBatch(posterId, userId, teamId, strokes);

      // Broadcast drawUpdate to all users in the room (including sender).
      io.to(posterId).emit('drawUpdate', { posterId, strokes, teamId, userId });
    });

    // ── 4. Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);

      const user = userManager.getUserBySocketId(socket.id);
      if (!user) return;

      const { userId, currentPoster } = user;

      if (currentPoster) {
        roomManager.removeUserFromRoom(currentPoster, userId);
        io.to(currentPoster).emit('userLeft', { userId });
        console.log(`[disconnect] userId=${userId} left posterId=${currentPoster}`);

        // If the room is now empty and game is still active, finalise early.
        const room = roomManager.getRoom(currentPoster);
        if (room && room.gameActive && room.users.length === 0) {
          if (roomTimers[currentPoster]) {
            clearInterval(roomTimers[currentPoster]);
            delete roomTimers[currentPoster];
          }
          finalizeGame(io, currentPoster);
        }
      }

      userManager.removeUser(userId);
    });
  });
}

module.exports = { registerSocketHandlers };