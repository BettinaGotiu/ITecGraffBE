/**
 * firestoreService.js
 * Optional Firestore integration for persisting user stats and poster strokes.
 *
 * To enable, set ONE of these environment variables before starting the server:
 *   FIREBASE_SERVICE_ACCOUNT      – absolute path to a service-account JSON file
 *   FIREBASE_SERVICE_ACCOUNT_JSON – the service-account JSON as a plain string
 *
 * If neither variable is present, all operations become no-ops and a warning is
 * printed at startup.  The rest of the backend continues to function normally
 * using only in-memory storage.
 */

let db = null;

function initFirestore() {
  try {
    // firebase-admin is an optional peer dependency – skip silently if absent
    let admin;
    try {
      admin = require('firebase-admin');
    } catch (_) {
      console.warn('[Firestore] firebase-admin not installed. Running without Firestore persistence.');
      return;
    }

    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      console.warn('[Firestore] No credentials configured. Running without Firestore persistence.');
      return;
    }

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    db = admin.firestore();
    console.log('[Firestore] Connected successfully.');
  } catch (err) {
    console.warn('[Firestore] Initialisation failed:', err.message);
  }
}

/**
 * Increment XP, wins, and gamesPlayed for a user in Firestore.
 * Uses FieldValue.increment so concurrent updates are safe.
 *
 * @param {string} userId
 * @param {object} stats
 * @param {number} [stats.xp=0]
 * @param {number} [stats.wins=0]
 * @param {number} [stats.gamesPlayed=0]
 */
async function saveUserStats(userId, { xp = 0, wins = 0, gamesPlayed = 0 } = {}) {
  if (!db) return;
  try {
    const admin = require('firebase-admin');
    await db.collection('users').doc(String(userId)).set(
      {
        xp: admin.firestore.FieldValue.increment(xp),
        wins: admin.firestore.FieldValue.increment(wins),
        gamesPlayed: admin.firestore.FieldValue.increment(gamesPlayed),
      },
      { merge: true },
    );
  } catch (err) {
    console.error(`[Firestore] saveUserStats(${userId}) failed:`, err.message);
  }
}

/**
 * Persist all strokes for a poster room so late-joining users (or a future
 * replay feature) can restore the full canvas.
 *
 * Each stroke is written as a separate document under:
 *   posterStrokes/{posterId}/strokes/{auto-id}
 *
 * @param {string} posterId
 * @param {object[]} strokes
 */
async function saveStrokes(posterId, strokes) {
  if (!db || !Array.isArray(strokes) || strokes.length === 0) return;
  try {
    // Firestore batches are capped at 500 operations; chunk if necessary.
    const BATCH_SIZE = 400;
    const colRef = db.collection('posterStrokes').doc(String(posterId)).collection('strokes');
    for (let i = 0; i < strokes.length; i += BATCH_SIZE) {
      const batch = db.batch();
      strokes.slice(i, i + BATCH_SIZE).forEach((stroke) => {
        batch.set(colRef.doc(), { ...stroke, savedAt: Date.now() });
      });
      await batch.commit();
    }
  } catch (err) {
    console.error(`[Firestore] saveStrokes(${posterId}) failed:`, err.message);
  }
}

initFirestore();

module.exports = { saveUserStats, saveStrokes };
