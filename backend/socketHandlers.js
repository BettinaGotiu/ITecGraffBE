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

// Canvas area considered "full" for early-end check (95% threshold).
const CANVAS_MAX_AREA = 50000;
const COVERAGE_FULL_THRESHOLD = 0.95;

// ─── Game timer helpers ───────────────────────────────────────────────────────

function startRoomTimer(io, posterId) {
  if (roomTimers[posterId]) return; // already running
  roomManager.activateGame(posterId);
  console.log(`[ROOM ${posterId}] Game started`);

  roomTimers[posterId] = setInterval(() => {
    const room = roomManager.getRoom(posterId);
    if (!room || !room.gameActive) {
      clearInterval(roomTimers[posterId]);
      delete roomTimers[posterId];
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((room.gameEndTime - Date.now()) / 1000));
    const currentCoverage = gameEngine.getTeamCoverage(posterId) || {};

    console.log(`[ROOM ${posterId}] Timer tick: ${secondsLeft}s`);

    io.to(posterId).emit('timerUpdate', {
      posterId,
      timeLeft: secondsLeft,
      coverage: currentCoverage,
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
  // Guard against double-finalization or missing room.
  if (!room || !room.gameActive) return;

  roomManager.deactivateGame(posterId);

  const result = gameEngine.calculateGameResult(posterId);
  if (!result) {
    roomManager.deleteRoom(posterId);
    return;
  }

  io.to(posterId).emit('gameResult', result);
  console.log(
    `[ROOM ${posterId}] Game finished. Winner: ${result.winnerTeam}. Coverage: ${JSON.stringify(result.teamScores)}`,
  );

  // Persist strokes and user stats to Firestore (no-op when unconfigured).
  await firestoreService.saveStrokes(posterId, room.strokes);

  const winningTeam = result.winnerTeam;
  for (const [uid, xp] of Object.entries(result.xp)) {
    const user = userManager.getUser(uid);
    const isWinner = winningTeam && user && user.teamId === winningTeam;
    userManager.updateUserStats(uid, { xp, wins: isWinner ? 1 : 0, gamesPlayed: 1 });
    await firestoreService.saveUserStats(uid, { xp, wins: isWinner ? 1 : 0, gamesPlayed: 1 });
  }

  // Clean up room after a short delay to allow clients to process the result.
  setTimeout(() => {
    roomManager.deleteRoom(posterId);
    console.log(`[ROOM ${posterId}] Room deleted after game end`);
  }, 5000);
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

  console.log(`[ROOM ${posterId}] Player joined: ${userId} (team ${teamId})`);

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

  // Notify others that a new player joined.
  io.to(posterId).emit('playerJoined', {
    userId,
    teamId,
    rivalPresent,
  });
}

// ─── Socket.IO Handler Registration ───────────────────────────────────────────

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

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

      if (!room.gameActive) {
        console.warn(`[ROOM ${posterId}] drawBatch received but game is not active`);
        return;
      }

      console.log(`[ROOM ${posterId}] drawBatch received from ${userId} | strokes: ${strokes.length}`);

      // Process strokes – updates team + user coverage.
      gameEngine.processDrawBatch(posterId, userId, teamId, strokes);

      // Broadcast drawUpdate to all users in the room (including sender).
      io.to(posterId).emit('drawUpdate', { posterId, strokes, teamId, userId });

      // Check for early game end if canvas coverage reaches the threshold.
      const totalCoverage = Object.values(room.teamCoverage).reduce((sum, v) => sum + v, 0);
      if (totalCoverage >= CANVAS_MAX_AREA * COVERAGE_FULL_THRESHOLD) {
        const coveragePct = Math.round((totalCoverage / CANVAS_MAX_AREA) * 100);
        console.log(`[ROOM ${posterId}] Canvas coverage reached ${coveragePct}%, ending game early`);
        if (roomTimers[posterId]) {
          clearInterval(roomTimers[posterId]);
          delete roomTimers[posterId];
        }
        finalizeGame(io, posterId);
      }
    });

    // ── 4. Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);

      const user = userManager.getUserBySocketId(socket.id);
      if (!user) return;

      const { userId, currentPoster } = user;

      if (currentPoster) {
        roomManager.removeUserFromRoom(currentPoster, userId);
        io.to(currentPoster).emit('userLeft', { userId });
        console.log(`[ROOM ${currentPoster}] Player left: ${userId}`);

        const room = roomManager.getRoom(currentPoster);
        if (room && room.users.length === 0) {
          console.log(`[ROOM ${currentPoster}] Room terminated (no users left)`);
          // Do NOT cancel the timer – let the game finish naturally so that
          // any reconnecting client (or a future spectator) still receives
          // the final gameResult event when the timer fires.
          // If the game was never started, clean up immediately.
          if (!room.gameActive && !roomTimers[currentPoster]) {
            roomManager.deleteRoom(currentPoster);
          }
        }
      }

      userManager.removeUser(userId);
    });
  });
}

module.exports = { registerSocketHandlers };