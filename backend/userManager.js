/**
 * userManager.js
 * Tracks connected users in memory.
 *
 * User model:
 * {
 *   userId:        string,
 *   username:      string,
 *   teamId:        string,
 *   level:         number,   // player level – used for room join validation
 *   socketId:      string,
 *   currentPoster: string,
 *   xp:            number,   // accumulated XP (in-memory; also persisted to Firestore at game end)
 *   wins:          number,
 *   gamesPlayed:   number,
 * }
 */

const users = {};

/**
 * Register or update a user entry.
 * @param {string} socketId
 * @param {object} data - { userId, username, teamId, level? }
 * @returns {object} The stored user object.
 */
function registerUser(socketId, { userId, username, teamId, level = 1 }) {
  // Preserve existing stats if the user reconnects.
  const existing = users[userId] || {};
  users[userId] = {
    userId,
    username,
    teamId,
    level: typeof level === 'number' ? level : parseInt(level, 10) || 1,
    socketId,
    currentPoster: existing.currentPoster || null,
    xp: existing.xp || 0,
    wins: existing.wins || 0,
    gamesPlayed: existing.gamesPlayed || 0,
  };
  return users[userId];
}

/**
 * Look up a user by their userId.
 * @param {string} userId
 * @returns {object|undefined}
 */
function getUser(userId) {
  return users[userId];
}

/**
 * Look up a user by their socket connection id.
 * @param {string} socketId
 * @returns {object|undefined}
 */
function getUserBySocketId(socketId) {
  return Object.values(users).find((u) => u.socketId === socketId);
}

/**
 * Update the poster a user is currently in.
 * @param {string} userId
 * @param {string|null} posterId
 */
function setCurrentPoster(userId, posterId) {
  if (users[userId]) {
    users[userId].currentPoster = posterId;
  }
}

/**
 * Increment in-memory stats for a user (xp, wins, gamesPlayed).
 * @param {string} userId
 * @param {object} delta - { xp?: number, wins?: number, gamesPlayed?: number }
 */
function updateUserStats(userId, { xp = 0, wins = 0, gamesPlayed = 0 } = {}) {
  if (!users[userId]) return;
  users[userId].xp += xp;
  users[userId].wins += wins;
  users[userId].gamesPlayed += gamesPlayed;
}

/**
 * Remove a user from the store.
 * @param {string} userId
 */
function removeUser(userId) {
  delete users[userId];
}

/**
 * Return a shallow copy of all users (for debug endpoint).
 * @returns {object}
 */
function getAllUsers() {
  return { ...users };
}

module.exports = {
  registerUser,
  getUser,
  getUserBySocketId,
  setCurrentPoster,
  updateUserStats,
  removeUser,
  getAllUsers,
};
