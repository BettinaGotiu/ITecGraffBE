const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

// Initialize Firebase Admin (Uses GOOGLE_APPLICATION_CREDENTIALS or standard ENV paths)
let db = null;
try {
  admin.initializeApp();
  db = admin.firestore();
  console.log("Firebase initialized successfully");
} catch (e) {
  console.warn("Could not automatically initialize Firebase! To enable saving to Firestore, ensure you have set GOOGLE_APPLICATION_CREDENTIALS environment variable or provide valid initialization config.", e.message);
}

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const CANVAS_MAX_AREA = 50000;
const GAME_DURATION_MS = 30000;

// State objects stored in memory
// rooms = { [posterId]: { users: [], strokes: [], teamCoverage: {}, gameStartTime, gameRunning, timer } }
const rooms = {};

// users = { [socketId]: { userId, teamId, posterId } }
const users = {};

function endGame(posterId) {
  const room = rooms[posterId];
  if (!room || !room.gameRunning) return;

  room.gameRunning = false;
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  // Calculate winner
  let maxArea = -1;
  let winnerTeam = null;
  let isTie = false;

  const teamIdsWithCoverage = Object.keys(room.teamCoverage);

  for (const teamId of teamIdsWithCoverage) {
    if (room.teamCoverage[teamId] > maxArea) {
      maxArea = room.teamCoverage[teamId];
      winnerTeam = teamId;
      isTie = false;
    } else if (room.teamCoverage[teamId] === maxArea) {
      isTie = true;
    }
  }

  if (isTie || maxArea === 0) {
    winnerTeam = "tie";
  }

  // Calculate XP values
  // Winning team players: +100 XP
  // Losing team players: +40 XP
  const teamXP = {};

  // Assign for teams that have drawn
  for (const teamId of teamIdsWithCoverage) {
    teamXP[teamId] = (teamId === winnerTeam) ? 100 : 40;
  }

  // Ensure we assign for players in the room whose team may not have drawn
  for (const socketId of room.users) {
    const u = users[socketId];
    if (u && !teamXP[u.teamId]) {
      teamXP[u.teamId] = (u.teamId === winnerTeam) ? 100 : 40;
    }
  }

  // --- SAVE SCORE TO FIREBASE ---
  if (db) {
    try {
      const batch = db.batch();
      const handledUserIds = new Set();
      
      for (const socketId of room.users) {
        const u = users[socketId];
        if (u && !handledUserIds.has(u.userId)) {
          handledUserIds.add(u.userId);
          const xp = teamXP[u.teamId] || 40;
          const userRef = db.collection("users").doc(u.userId);
          batch.set(userRef, {
            xp: admin.firestore.FieldValue.increment(xp),
            lastPlayed: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      
      batch.commit()
        .then(() => console.log(`Scores aggressively saved to Firebase for room ${posterId}`))
        .catch(err => console.error("Firebase commit failed:", err));
    } catch(err) {
      console.error("Firebase batch error:", err);
    }
  }
  // ------------------------------

  io.to(posterId).emit("gameResult", {
    posterId,
    winnerTeam,
    coverage: room.teamCoverage,
    teamXP
  });

  console.log(`Game ended for room ${posterId}. Winner: ${winnerTeam}`);
}

app.get("/", (req, res) => {
  res.send({ status: "Backend running" });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinRoom", (payload) => {
    const { userId, teamId, posterId } = payload;
    if (!userId || !teamId || !posterId) return;

    users[socket.id] = { userId, teamId, posterId };
    socket.join(posterId);

    if (!rooms[posterId]) {
      rooms[posterId] = {
        users: [],
        strokes: [],
        teamCoverage: {},
        gameStartTime: null,
        gameRunning: false,
        timer: null
      };
    }

    const room = rooms[posterId];
    if (!room.users.includes(socket.id)) {
      room.users.push(socket.id);
    }

    // Start game timer if this is the first player and game hasn't started
    if (!room.gameRunning && !room.gameStartTime) {
      room.gameRunning = true;
      room.gameStartTime = Date.now();
      room.timer = setTimeout(() => {
        endGame(posterId);
      }, GAME_DURATION_MS);
      console.log(`Game started for room ${posterId}`);
    }

    // Broadcast that a player joined
    socket.to(posterId).emit("playerJoined", {
      userId,
      teamId,
      posterId
    });
  });

  socket.on("drawBatch", (payload) => {
    const { posterId, userId, teamId, strokes } = payload;
    const room = rooms[posterId];

    // Validate room exists and game is running
    if (!room || !room.gameRunning) return;

    if (Array.isArray(strokes) && strokes.length > 0) {
      // Add strokes to room history
      room.strokes.push(...strokes);

      // Estimate territory area
      // area += brushSize * strokes.length
      // Using first stroke's brushSize for simplicity, defaulting to 10
      const brushSize = strokes[0].brushSize || 10;
      const addedArea = brushSize * strokes.length;

      // Update team coverage
      if (!room.teamCoverage[teamId]) {
        room.teamCoverage[teamId] = 0;
      }
      room.teamCoverage[teamId] += addedArea;

      // Broadcast update to all other players in the room
      socket.to(posterId).emit("drawUpdate", {
        posterId,
        strokes,
        teamId
      });

      // Optional early finish if coverage >= 95%
      let totalArea = 0;
      for (const t in room.teamCoverage) {
        totalArea += room.teamCoverage[t];
      }

      if (totalArea >= CANVAS_MAX_AREA * 0.95) {
        console.log(`Room ${posterId} reached 95% coverage, ending early.`);
        endGame(posterId);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    const user = users[socket.id];

    if (user) {
      const { posterId } = user;
      const room = rooms[posterId];

      if (room) {
        // Remove user from room users list
        room.users = room.users.filter((id) => id !== socket.id);

        // If the room becomes empty, delete the room
        if (room.users.length === 0) {
          if (room.timer) {
            clearTimeout(room.timer);
          }
          delete rooms[posterId];
          console.log(`Room ${posterId} deleted because it is empty`);
        }
      }
      delete users[socket.id];
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});