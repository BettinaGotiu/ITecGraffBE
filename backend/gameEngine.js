/**
 * gameEngine.js
 * Handles drawing-batch processing and territory-coverage calculations.
 *
 * Territory estimation:
 *   For each stroke: area = strokeLength * brushSize
 *   where strokeLength = number of points in the stroke.
 */

const roomManager = require('./roomManager');

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
 * Process a batch of strokes for a team and update room state.
 *
 * @param {string} posterId
 * @param {string} teamId   - expected to be "teamA" or "teamB"
 * @param {object[]} strokes
 * @returns {object} Updated teamCoverage object.
 */
function processDrawBatch(posterId, teamId, strokes) {
  const room = roomManager.getRoom(posterId);
  if (!room) return null;

  // Accumulate area for each stroke
  let addedArea = 0;
  strokes.forEach((stroke) => {
    addedArea += calcStrokeArea(stroke);
  });

  // Persist strokes
  roomManager.appendStrokes(posterId, strokes);

  // Update coverage for the team.
  // We accept any teamId key so the system is extensible, but default to teamA/teamB.
  const coverage = { ...room.teamCoverage };
  if (typeof coverage[teamId] === 'number') {
    coverage[teamId] += addedArea;
  } else {
    // Unknown team key – initialise it
    coverage[teamId] = addedArea;
  }

  roomManager.updateTeamCoverage(posterId, coverage);
  return coverage;
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

module.exports = { processDrawBatch, getTeamCoverage };
