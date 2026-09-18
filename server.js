const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const TICK_RATE = 30;
const BROADCAST_RATE = 20;
const ARENA = { width: 1200, height: 720 };
const TANK_RADIUS = 22;
const BULLET_RADIUS = 6;
const TANK_SPEED = 180;
const ROTATE_SPEED = 2.8;
const BULLET_SPEED = 430;
const FIRE_COOLDOWN = 550;
const ROUND_RESTART_MS = 2600;
const MATCH_SCORE = 5;
const MAX_PLAYERS = 4;

const rooms = new Map();

const spawnPoints = [
  { x: 90, y: 90, angle: 0 },
  { x: ARENA.width - 90, y: ARENA.height - 90, angle: Math.PI },
  { x: ARENA.width - 90, y: 90, angle: Math.PI / 2 },
  { x: 90, y: ARENA.height - 90, angle: -Math.PI / 2 },
];

function makeWalls() {
  // Static maze-like arena. Keeping the same geometry for all clients avoids sync drift.
  return [
    { x: 210, y: 120, w: 36, h: 280 },
    { x: 210, y: 510, w: 36, h: 120 },

    { x: 400, y: 0, w: 36, h: 170 },
    { x: 400, y: 290, w: 36, h: 250 },

    { x: 560, y: 150, w: 36, h: 420 },

    { x: 745, y: 0, w: 36, h: 210 },
    { x: 745, y: 330, w: 36, h: 390 },

    { x: 940, y: 100, w: 36, h: 250 },
    { x: 940, y: 470, w: 36, h: 170 },

    { x: 80, y: 250, w: 260, h: 36 },
    { x: 330, y: 610, w: 300, h: 36 },
    { x: 650, y: 245, w: 300, h: 36 },
    { x: 860, y: 395, w: 260, h: 36 },
  ];
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? randomRoomCode() : code;
}

function createRoom(code, hostId) {
  const room = {
    code,
    hostId,
    players: new Map(),
    bullets: [],
    walls: makeWalls(),
    status: "waiting", // waiting | playing | round_end | match_end
    round: 0,
    roundMessage: "等待玩家加入",
    nextRoundAt: 0,
    lastBroadcast: 0,
  };
  rooms.set(code, room);
  return room;
}

function safeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name.slice(0, 16) || "Tank";
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    round: room.round,
    roundMessage: room.roundMessage,
    matchScore: MATCH_SCORE,
    arena: ARENA,
    walls: room.walls,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      alive: p.alive,
      score: p.score,
      colorIndex: p.colorIndex,
    })),
    bullets: room.bullets.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      ownerId: b.ownerId,
    })),
  };
}

function playerSnapshot(room) {
  io.to(room.code).emit("state", serializeRoom(room));
}

function circleRectCollides(cx, cy, radius, r) {
  const nearestX = Math.max(r.x, Math.min(cx, r.x + r.w));
  const nearestY = Math.max(r.y, Math.min(cy, r.y + r.h));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function isTankPositionValid(room, player, x, y) {
  if (
    x - TANK_RADIUS < 0 ||
    x + TANK_RADIUS > ARENA.width ||
    y - TANK_RADIUS < 0 ||
    y + TANK_RADIUS > ARENA.height
  ) return false;

  for (const wall of room.walls) {
    if (circleRectCollides(x, y, TANK_RADIUS, wall)) return false;
  }

  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive) continue;
    const dx = x - other.x;
    const dy = y - other.y;
    if (dx * dx + dy * dy < (TANK_RADIUS * 2) ** 2) return false;
  }

  return true;
}

function resetRound(room) {
  room.round += 1;
  room.bullets = [];
  let i = 0;
  for (const player of room.players.values()) {
    const s = spawnPoints[i % spawnPoints.length];
    player.x = s.x;
    player.y = s.y;
    player.angle = s.angle;
    player.alive = true;
    player.lastShotAt = 0;
    player.inputs = { forward: false, back: false, left: false, right: false };
    i += 1;
  }
  room.status = room.players.size >= 2 ? "playing" : "waiting";
  room.roundMessage = room.status === "playing" ? `第 ${room.round} 回合` : "等待至少 2 名玩家";
  playerSnapshot(room);
}

function startMatch(room) {
  for (const player of room.players.values()) player.score = 0;
  room.round = 0;
  room.status = "playing";
  resetRound(room);
}

function endRound(room) {
  if (room.status !== "playing") return;
  const alive = [...room.players.values()].filter((p) => p.alive);

  if (alive.length === 1) {
    const winner = alive[0];
    winner.score += 1;

    if (winner.score >= MATCH_SCORE) {
      room.status = "match_end";
      room.roundMessage = `${winner.name} 赢得整场比赛！`;
      playerSnapshot(room);
      return;
    }

    room.status = "round_end";
    room.roundMessage = `${winner.name} 赢下本回合`;
    room.nextRoundAt = Date.now() + ROUND_RESTART_MS;
    playerSnapshot(room);
    return;
  }

  if (alive.length === 0) {
    room.status = "round_end";
    room.roundMessage = "本回合平局";
    room.nextRoundAt = Date.now() + ROUND_RESTART_MS;
    playerSnapshot(room);
  }
}

function fireBullet(room, player) {
  const now = Date.now();
  if (!player.alive || room.status !== "playing") return;
  if (now - player.lastShotAt < FIRE_COOLDOWN) return;

  player.lastShotAt = now;
  const nose = TANK_RADIUS + 11;
  const x = player.x + Math.cos(player.angle) * nose;
  const y = player.y + Math.sin(player.angle) * nose;

  room.bullets.push({
    id: `${player.id}-${now}-${Math.random().toString(16).slice(2)}`,
    ownerId: player.id,
    x,
    y,
    vx: Math.cos(player.angle) * BULLET_SPEED,
    vy: Math.sin(player.angle) * BULLET_SPEED,
    bornAt: now,
    bounces: 0,
  });
}

function stepPlayer(room, player, dt) {
  if (!player.alive || room.status !== "playing") return;

  const input = player.inputs || {};
  let turn = 0;
  if (input.left) turn -= 1;
  if (input.right) turn += 1;
  player.angle += turn * ROTATE_SPEED * dt;

  let drive = 0;
  if (input.forward) drive += 1;
  if (input.back) drive -= 0.72;

  const dx = Math.cos(player.angle) * TANK_SPEED * drive * dt;
  const dy = Math.sin(player.angle) * TANK_SPEED * drive * dt;

  if (isTankPositionValid(room, player, player.x + dx, player.y)) {
    player.x += dx;
  }
  if (isTankPositionValid(room, player, player.x, player.y + dy)) {
    player.y += dy;
  }
}

function bounceBulletAgainstWall(b, wall) {
  if (!circleRectCollides(b.x, b.y, BULLET_RADIUS, wall)) return false;

  const leftDist = Math.abs((b.x + BULLET_RADIUS) - wall.x);
  const rightDist = Math.abs((wall.x + wall.w) - (b.x - BULLET_RADIUS));
  const topDist = Math.abs((b.y + BULLET_RADIUS) - wall.y);
  const bottomDist = Math.abs((wall.y + wall.h) - (b.y - BULLET_RADIUS));
  const m = Math.min(leftDist, rightDist, topDist, bottomDist);

  if (m === leftDist || m === rightDist) b.vx *= -1;
  else b.vy *= -1;

  // Push bullet slightly out to avoid repeated collision toggles.
  b.x += Math.sign(b.vx) * 2;
  b.y += Math.sign(b.vy) * 2;
  b.bounces += 1;
  return true;
}

function stepBullets(room, dt) {
  const now = Date.now();

  for (const b of room.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - BULLET_RADIUS <= 0) {
      b.x = BULLET_RADIUS + 1;
      b.vx = Math.abs(b.vx);
      b.bounces += 1;
    } else if (b.x + BULLET_RADIUS >= ARENA.width) {
      b.x = ARENA.width - BULLET_RADIUS - 1;
      b.vx = -Math.abs(b.vx);
      b.bounces += 1;
    }

    if (b.y - BULLET_RADIUS <= 0) {
      b.y = BULLET_RADIUS + 1;
      b.vy = Math.abs(b.vy);
      b.bounces += 1;
    } else if (b.y + BULLET_RADIUS >= ARENA.height) {
      b.y = ARENA.height - BULLET_RADIUS - 1;
      b.vy = -Math.abs(b.vy);
      b.bounces += 1;
    }

    for (const wall of room.walls) {
      if (bounceBulletAgainstWall(b, wall)) break;
    }

    for (const p of room.players.values()) {
      if (!p.alive) continue;
      // A short owner grace period prevents instant self-hit at the muzzle.
      if (p.id === b.ownerId && now - b.bornAt < 220) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy <= (BULLET_RADIUS + TANK_RADIUS) ** 2) {
        p.alive = false;
        b.dead = true;
        io.to(room.code).emit("explosion", { x: p.x, y: p.y, playerId: p.id });
        break;
      }
    }

    if (now - b.bornAt > 9000 || b.bounces > 18) b.dead = true;
  }

  room.bullets = room.bullets.filter((b) => !b.dead);

  if (room.status === "playing") endRound(room);
}

function gameStep(room, dt) {
  if (room.status === "playing") {
    for (const p of room.players.values()) stepPlayer(room, p, dt);
    stepBullets(room, dt);
  } else if (room.status === "round_end" && Date.now() >= room.nextRoundAt) {
    if (room.players.size >= 2) resetRound(room);
    else {
      room.status = "waiting";
      room.roundMessage = "等待至少 2 名玩家";
    }
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name } = {}, ack) => {
    const code = randomRoomCode();
    const room = createRoom(code, socket.id);
    const spawn = spawnPoints[0];

    room.players.set(socket.id, {
      id: socket.id,
      name: safeName(name),
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      alive: true,
      score: 0,
      colorIndex: 0,
      inputs: { forward: false, back: false, left: false, right: false },
      lastShotAt: 0,
    });

    socket.join(code);
    socket.data.roomCode = code;
    ack?.({ ok: true, code, playerId: socket.id });
    playerSnapshot(room);
  });

  socket.on("joinRoom", ({ code, name } = {}, ack) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: "房间不存在" });
    if (room.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: "房间已满" });
    if (room.status === "match_end") return ack?.({ ok: false, error: "本局已结束，请房主重新开始" });

    const colorIndex = room.players.size % MAX_PLAYERS;
    const spawn = spawnPoints[colorIndex];

    room.players.set(socket.id, {
      id: socket.id,
      name: safeName(name),
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      alive: true,
      score: 0,
      colorIndex,
      inputs: { forward: false, back: false, left: false, right: false },
      lastShotAt: 0,
    });

    socket.join(code);
    socket.data.roomCode = code;

    if (room.players.size >= 2 && room.status === "waiting") startMatch(room);

    ack?.({ ok: true, code, playerId: socket.id });
    playerSnapshot(room);
  });

  socket.on("input", (inputs = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;

    p.inputs = {
      forward: !!inputs.forward,
      back: !!inputs.back,
      left: !!inputs.left,
      right: !!inputs.right,
    };
  });

  socket.on("fire", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    fireBullet(room, p);
  });

  socket.on("restartMatch", (ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack?.({ ok: false, error: "房间不存在" });
    if (room.hostId !== socket.id) return ack?.({ ok: false, error: "只有房主可以重新开始" });
    if (room.players.size < 2) return ack?.({ ok: false, error: "至少需要 2 名玩家" });
    startMatch(room);
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);
    room.bullets = room.bullets.filter((b) => b.ownerId !== socket.id);

    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value;
    }

    if (room.players.size < 2) {
      room.status = "waiting";
      room.roundMessage = "对手已离开，等待玩家加入";
      room.bullets = [];
      for (const p of room.players.values()) p.alive = true;
    } else if (room.status === "playing") {
      endRound(room);
    }

    playerSnapshot(room);
  });
});

let previous = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;

  for (const room of rooms.values()) {
    gameStep(room, dt);
    if (now - room.lastBroadcast >= 1000 / BROADCAST_RATE) {
      room.lastBroadcast = now;
      playerSnapshot(room);
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tank Turbulence Online running on port ${PORT}`);
});
