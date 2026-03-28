/**
 * userManager.js
 * Tracks connected users in memory.
 *
 * User model:
 * {
 *   userId:        string,
 *   username:      string,
 *   teamId:        string,
 *   socketId:      string,
 *   currentPoster: string
 * }
 */

const users = {};

/**
 * Register or update a user entry.
 * @param {string} socketId
 * @param {object} data - { userId, username, teamId }
 * @returns {object} The stored user object.
 */
function registerUser(socketId, { userId, username, teamId }) {
  users[userId] = { userId, username, teamId, socketId, currentPoster: null };
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
 * @param {string} posterId
 */
function setCurrentPoster(userId, posterId) {
  if (users[userId]) {
    users[userId].currentPoster = posterId;
  }
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
  removeUser,
  getAllUsers,
};
