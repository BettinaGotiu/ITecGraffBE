/**
 * gameEngine.js
 * Handles drawing-batch processing and territory-coverage calculations.
 *
 * Territory estimation:
 *   For each stroke: area = numberOfPoints × brushSize
 *
 * XP formula:
 *   baseXP   = floor(userCoverage)
 *   winBonus = WIN_BONUS_XP  (awarded to every member of the winning team)
 *   userXP   = baseXP + winBonus (if winner) OR baseXP (if not)
 */

const roomManager = require('./roomManager');

// XP constants.
const XP_PER_AREA_UNIT = 1; // 1 XP per area-unit contributed
const WIN_BONUS_XP = 100;   // flat bonus for being on the winning team

/**
 * Calculate the territory contribution of a single stroke.
 * area ≈ number_of_points × brush_size
 * @param {object} stroke - { points: Array, size: number }
 * @returns {number}
 */
function calcStrokeArea(stroke) {
  const pointCount = Array.isArray(stroke.points) ? stroke.points.length : 0;
  const brushSize = typeof stroke.size === 'number' ? stroke.size : 1;
  return pointCount * brushSize;
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
 *   coverage:    { teamId: number },
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
    coverage: { ...room.teamCoverage },
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
  WIN_BONUS_XP,
  XP_PER_AREA_UNIT,
};
