/**
 * roomManager.js
 * Creates and manages poster rooms in memory.
 *
 * Room model:
 * {
 *   posterId:     string,
 *   users:        string[],      // all userIds currently in the room
 *   teamMembers:  object,        // { teamId: string[] } – per-team member lists
 *   strokes:      object[],      // accumulated drawing strokes
 *   teamCoverage: object,        // { teamId: number } – dynamic, supports any team
 *   userCoverage: object,        // { userId: number } – per-user area contribution
 *   gameEndTime:  number,        // absolute ms timestamp when the game ends
 *   gameDuration: number,        // game length in seconds
 *   gameActive:   boolean,
 * }
 */

const MAX_STROKES_PER_ROOM = 5000;

// Game configuration – override via environment variables if desired.
const GAME_DURATION_SECONDS = 35;

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
      teamMembers: {},
      strokes: [],
      teamCoverage: {},
      userCoverage: {},
      gameEndTime: Date.now() + GAME_DURATION_SECONDS * 1000,
      gameDuration: GAME_DURATION_SECONDS,
      gameActive: false,
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
 * Add a userId (with their teamId) to a room.  No-ops on duplicates.
 * Initialises team coverage to 0 the first time a team appears.
 * @param {string} posterId
 * @param {string} userId
 * @param {string} teamId
 */
function addUserToRoom(posterId, userId, teamId) {
  const room = getOrCreateRoom(posterId);

  if (!room.users.includes(userId)) {
    room.users.push(userId);
  }

  if (teamId) {
    if (!room.teamMembers[teamId]) {
      room.teamMembers[teamId] = [];
      room.teamCoverage[teamId] = 0;
    }
    if (!room.teamMembers[teamId].includes(userId)) {
      room.teamMembers[teamId].push(userId);
    }
  }

  if (!(userId in room.userCoverage)) {
    room.userCoverage[userId] = 0;
  }
}

/**
 * Remove a userId from a room (all team member lists included).
 * @param {string} posterId
 * @param {string} userId
 */
function removeUserFromRoom(posterId, userId) {
  const room = rooms[posterId];
  if (!room) return;

  room.users = room.users.filter((id) => id !== userId);

  Object.keys(room.teamMembers).forEach((teamId) => {
    room.teamMembers[teamId] = room.teamMembers[teamId].filter((id) => id !== userId);
  });
  // Note: userCoverage is intentionally kept so disconnected users still
  // contribute to the final score.
}

/**
 * Return the number of members currently assigned to a team in a room.
 * @param {string} posterId
 * @param {string} teamId
 * @returns {number}
 */
function getTeamMemberCount(posterId, teamId) {
  const room = rooms[posterId];
  if (!room || !room.teamMembers[teamId]) return 0;
  return room.teamMembers[teamId].length;
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
 * Update the team coverage map for a room (full replacement).
 * @param {string} posterId
 * @param {object} teamCoverage
 */
function updateTeamCoverage(posterId, teamCoverage) {
  const room = rooms[posterId];
  if (!room) return;
  room.teamCoverage = { ...teamCoverage };
}

/**
 * Add an area value to a user's personal coverage total.
 * @param {string} posterId
 * @param {string} userId
 * @param {number} area
 */
function addUserCoverage(posterId, userId, area) {
  const room = rooms[posterId];
  if (!room) return;
  if (typeof room.userCoverage[userId] !== 'number') {
    room.userCoverage[userId] = 0;
  }
  room.userCoverage[userId] += area;
}

/**
 * Activate the game for a room and (re)set its end timestamp.
 * @param {string} posterId
 */
function activateGame(posterId) {
  const room = rooms[posterId];
  if (!room) return;
  room.gameActive = true;
  room.gameEndTime = Date.now() + room.gameDuration * 1000;
}

/**
 * Mark a room's game as inactive.
 * @param {string} posterId
 */
function deactivateGame(posterId) {
  const room = rooms[posterId];
  if (!room) return;
  room.gameActive = false;
}

/**
 * Delete a room entirely (e.g. after the game has ended and been finalised).
 * @param {string} posterId
 */
function deleteRoom(posterId) {
  delete rooms[posterId];
}

/**
 * Return a shallow copy of all rooms (for debug endpoint).
 * The timerInterval handle is excluded to keep the JSON clean.
 * @returns {object}
 */
function getAllRooms() {
  const result = {};
  Object.values(rooms).forEach((room) => {
    result[room.posterId] = { ...room };
  });
  return result;
}

module.exports = {
  getOrCreateRoom,
  getRoom,
  addUserToRoom,
  removeUserFromRoom,
  getTeamMemberCount,
  appendStrokes,
  updateTeamCoverage,
  addUserCoverage,
  activateGame,
  deactivateGame,
  deleteRoom,
  getAllRooms,
  GAME_DURATION_SECONDS,
};
