/**
 * gameEngine.js
 * Contains game logic: stroke area calculation, game state updates, and result calculation.
 */

const roomManager = require('./roomManager');

// Tuning parameters
const XP_PER_AREA_UNIT = 0.5;
const WIN_BONUS_XP = 50;

/**
 * Calculate the rough "area" of a stroke.
 * Currently uses bounding box area or total segment length.
 * @param {object} stroke
 * @returns {number}
 */
function calcStrokeArea(stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) {
    return 1;
  }
  let area = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const p1 = stroke.points[i - 1];
    const p2 = stroke.points[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    area += Math.sqrt(dx * dx + dy * dy);
  }
  return area * (stroke.brushSize || 5);
}

/**
 * Process a batch of strokes for a user/team and update room state.
 * Updates both team coverage and per-user coverage.
 *
 * @param {string} posterId
 * @param {string} userId
 * @param {string} teamId
 * @param {object[]} strokes
 * @returns {{ teamCoverage: object, userCoverage: object } | null}
 */
function processDrawBatch(posterId, userId, teamId, strokes) {
  const room = roomManager.getRoom(posterId);
  if (!room) return null;

  let addedArea = 0;
  strokes.forEach((stroke) => {
    addedArea += calcStrokeArea(stroke);
  });

  // Persist strokes
  roomManager.appendStrokes(posterId, strokes);

  // Update team coverage (supports any number of teams)
  const teamCoverage = { ...room.teamCoverage };
  if (typeof teamCoverage[teamId] === 'number') {
    teamCoverage[teamId] += addedArea;
  } else {
    teamCoverage[teamId] = addedArea;
  }
  roomManager.updateTeamCoverage(posterId, teamCoverage);

  // Update per-user coverage
  roomManager.addUserCoverage(posterId, userId, addedArea);

  return {
    teamCoverage: { ...room.teamCoverage },
    userCoverage: { ...room.userCoverage },
  };
}

/**
 * Determine the winning team (highest coverage).
 * Returns null if coverage is empty or all zero.
 * @param {object} teamCoverage - { teamId: number }
 * @returns {string|null}
 */
function determineWinner(teamCoverage) {
  const entries = Object.entries(teamCoverage);
  if (entries.length === 0) return null;
  let winner = null;
  let maxCoverage = -1;
  entries.forEach(([teamId, coverage]) => {
    if (coverage > maxCoverage) {
      maxCoverage = coverage;
      winner = teamId;
    }
  });
  return maxCoverage > 0 ? winner : null;
}

/**
 * Calculate the final game result for a room.
 *
 * Returns:
 * {
 *   posterId:    string,
 *   winnerTeam:  string | null,
 *   teamScores:  { teamId: number },
 *   xp:          { userId: number },
 * }
 *
 * @param {string} posterId
 * @param {object} [teamMembersOverride]  – optional snapshot (used internally)
 * @returns {object|null}
 */
function calculateGameResult(posterId) {
  const room = roomManager.getRoom(posterId);
  if (!room) return null;

  const winnerTeam = determineWinner(room.teamCoverage);

  // Build per-user XP map
  const xp = {};
  const winningMembers = winnerTeam && room.teamMembers[winnerTeam]
    ? new Set(room.teamMembers[winnerTeam])
    : new Set();

  // Include every user who contributed coverage (even if disconnected)
  const allUserIds = new Set([
    ...room.users,
    ...Object.keys(room.userCoverage),
  ]);

  allUserIds.forEach((uid) => {
    const baseXP = Math.floor((room.userCoverage[uid] || 0) * XP_PER_AREA_UNIT);
    const bonus = winningMembers.has(uid) ? WIN_BONUS_XP : 0;
    xp[uid] = baseXP + bonus;
  });

  return {
    posterId,
    winnerTeam,
    teamScores: { ...room.teamCoverage }, // Aliniat cu așteptările Frontend-ului (înainte era "coverage")
    xp,
  };
}

/**
 * Return the current team coverage for a room.
 * @param {string} posterId
 * @returns {object|null}
 */
function getTeamCoverage(posterId) {
  const room = roomManager.getRoom(posterId);
  return room ? { ...room.teamCoverage } : null;
}

module.exports = {
  processDrawBatch,
  calculateGameResult,
  getTeamCoverage,
};