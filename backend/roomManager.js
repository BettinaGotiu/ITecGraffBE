/**
 * roomManager.js
 * Creates and manages poster rooms in memory.
 *
 * Room model:
 * {
 *   posterId:     string,
 *   users:        string[],   // list of userIds currently in the room
 *   strokes:      object[],   // accumulated drawing strokes
 *   teamCoverage: { teamA: number, teamB: number }
 * }
 */

const MAX_STROKES_PER_ROOM = 5000;

const rooms = {};

/**
 * Return an existing room or create a new one for the given posterId.
 * @param {string} posterId
 * @returns {object} The room object.
 */
function getOrCreateRoom(posterId) {
  if (!rooms[posterId]) {
    rooms[posterId] = {
      posterId,
      users: [],
      strokes: [],
      teamCoverage: { teamA: 0, teamB: 0 },
    };
  }
  return rooms[posterId];
}

/**
 * Retrieve a room by posterId, or undefined if it does not exist.
 * @param {string} posterId
 * @returns {object|undefined}
 */
function getRoom(posterId) {
  return rooms[posterId];
}

/**
 * Add a userId to a room's user list (no duplicates).
 * @param {string} posterId
 * @param {string} userId
 */
function addUserToRoom(posterId, userId) {
  const room = getOrCreateRoom(posterId);
  if (!room.users.includes(userId)) {
    room.users.push(userId);
  }
}

/**
 * Remove a userId from a room's user list.
 * @param {string} posterId
 * @param {string} userId
 */
function removeUserFromRoom(posterId, userId) {
  const room = rooms[posterId];
  if (!room) return;
  room.users = room.users.filter((id) => id !== userId);
}

/**
 * Append strokes to a room, enforcing the maximum stroke limit.
 * Older strokes are dropped when the limit is exceeded.
 * @param {string} posterId
 * @param {object[]} newStrokes
 */
function appendStrokes(posterId, newStrokes) {
  const room = rooms[posterId];
  if (!room) return;
  room.strokes.push(...newStrokes);
  if (room.strokes.length > MAX_STROKES_PER_ROOM) {
    room.strokes = room.strokes.slice(room.strokes.length - MAX_STROKES_PER_ROOM);
  }
}

/**
 * Update the team coverage numbers for a room.
 * @param {string} posterId
 * @param {object} teamCoverage - { teamA: number, teamB: number }
 */
function updateTeamCoverage(posterId, teamCoverage) {
  const room = rooms[posterId];
  if (!room) return;
  room.teamCoverage = { ...teamCoverage };
}

/**
 * Return a shallow copy of all rooms (for debug endpoint).
 * @returns {object}
 */
function getAllRooms() {
  return { ...rooms };
}

module.exports = {
  getOrCreateRoom,
  getRoom,
  addUserToRoom,
  removeUserFromRoom,
  appendStrokes,
  updateTeamCoverage,
  getAllRooms,
};
