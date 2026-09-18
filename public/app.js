const socket = io();

const lobby = document.getElementById("lobby");
const game = document.getElementById("game");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const lobbyError = document.getElementById("lobbyError");
const roomCodeBtn = document.getElementById("roomCodeBtn");
const statusText = document.getElementById("statusText");
const scoreboard = document.getElementById("scoreboard");
const restartBtn = document.getElementById("restartBtn");
const centerMessage = document.getElementById("centerMessage");
const connectionState = document.getElementById("connectionState");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const COLORS = ["#67c1ff", "#ff7f87", "#f6d365", "#8ce99a"];
const keys = { forward:false, back:false, left:false, right:false };
let state = null;
let playerId = null;
let roomCode = "";
let lastInputSent = "";
let explosions = [];

function showLobbyError(msg) {
  lobbyError.textContent = msg || "";
}

function enterGame(code, id) {
  playerId = id;
  roomCode = code;
  roomCodeBtn.textContent = code;
  lobby.classList.add("hidden");
  game.classList.remove("hidden");
  canvas.focus?.();
}

createBtn.addEventListener("click", () => {
  showLobbyError("");
  socket.emit("createRoom", { name: nameInput.value }, (res) => {
    if (!res?.ok) return showLobbyError(res?.error || "创建失败");
    enterGame(res.code, res.playerId);
  });
});

joinBtn.addEventListener("click", joinRoom);
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

function joinRoom() {
  showLobbyError("");
  const code = roomInput.value.trim().toUpperCase();
  if (code.length !== 6) return showLobbyError("请输入 6 位房间号");
  socket.emit("joinRoom", { code, name: nameInput.value }, (res) => {
    if (!res?.ok) return showLobbyError(res?.error || "加入失败");
    enterGame(res.code, res.playerId);
  });
}

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
});

roomCodeBtn.addEventListener("click", () => {
  const range = document.createRange();
  range.selectNodeContents(roomCodeBtn);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

restartBtn.addEventListener("click", () => {
  socket.emit("restartMatch", (res) => {
    if (!res?.ok) statusText.textContent = res?.error || "无法重新开始";
  });
});

socket.on("connect", () => {
  connectionState.textContent = "● 已连接";
});

socket.on("disconnect", () => {
  connectionState.textContent = "● 连接已断开";
});

socket.on("state", (s) => {
  state = s;
  updateHud();
});

socket.on("explosion", ({x, y}) => {
  explosions.push({ x, y, born: performance.now() });
});

function updateHud() {
  if (!state) return;

  statusText.textContent =
    state.status === "waiting" ? "等待玩家加入…" :
    state.status === "playing" ? `第 ${state.round} 回合进行中` :
    state.status === "round_end" ? "回合结束" :
    "整场比赛结束";

  centerMessage.textContent =
    state.status === "waiting" ? state.roundMessage :
    state.status === "round_end" ? state.roundMessage :
    state.status === "match_end" ? state.roundMessage : "";

  scoreboard.innerHTML = "";
  [...state.players]
    .sort((a,b) => b.score - a.score)
    .forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "score-chip";
      const dot = document.createElement("span");
      dot.className = "score-dot";
      dot.style.background = COLORS[p.colorIndex % COLORS.length];
      const text = document.createElement("span");
      text.textContent = `${p.name}${p.id===playerId?"（你）":""} ${p.score}/${state.matchScore}${p.alive?"":" ☠"}`;
      chip.append(dot, text);
      scoreboard.appendChild(chip);
    });

  restartBtn.classList.toggle("hidden", !(state.status === "match_end" && state.hostId === playerId));
}

function activeElementIsEditable() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

window.addEventListener("keydown", (e) => {
  if (activeElementIsEditable()) return;

  let changed = false;
  if (e.code === "KeyW" || e.code === "ArrowUp") { keys.forward = true; changed = true; }
  if (e.code === "KeyS" || e.code === "ArrowDown") { keys.back = true; changed = true; }
  if (e.code === "KeyA" || e.code === "ArrowLeft") { keys.left = true; changed = true; }
  if (e.code === "KeyD" || e.code === "ArrowRight") { keys.right = true; changed = true; }
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    socket.emit("fire");
  }
  if (changed) {
    e.preventDefault();
    sendInput();
  }
});

window.addEventListener("keyup", (e) => {
  let changed = false;
  if (e.code === "KeyW" || e.code === "ArrowUp") { keys.forward = false; changed = true; }
  if (e.code === "KeyS" || e.code === "ArrowDown") { keys.back = false; changed = true; }
  if (e.code === "KeyA" || e.code === "ArrowLeft") { keys.left = false; changed = true; }
  if (e.code === "KeyD" || e.code === "ArrowRight") { keys.right = false; changed = true; }
  if (changed) sendInput();
});

function sendInput() {
  const s = JSON.stringify(keys);
  if (s !== lastInputSent) {
    lastInputSent = s;
    socket.emit("input", keys);
  }
}

setInterval(sendInput, 80);

function drawTank(p, scaleX, scaleY) {
  const x = p.x * scaleX;
  const y = p.y * scaleY;
  const r = 22 * ((scaleX + scaleY) / 2);
  const color = COLORS[p.colorIndex % COLORS.length];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.angle);
  ctx.globalAlpha = p.alive ? 1 : 0.22;

  ctx.fillStyle = color;
  ctx.fillRect(-r * 0.95, -r * 0.7, r * 1.9, r * 1.4);

  ctx.fillStyle = "#0d151e";
  ctx.fillRect(-r * 0.78, -r * 0.92, r * 1.45, r * 0.2);
  ctx.fillRect(-r * 0.78, r * 0.72, r * 1.45, r * 0.2);

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = "#d9e2ec";
  ctx.fill();

  ctx.fillStyle = color;
  ctx.fillRect(0, -r * 0.16, r * 1.45, r * 0.32);

  if (p.id === playerId) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.strokeRect(-r * 1.12, -r * 0.88, r * 2.24, r * 1.76);
  }

  ctx.restore();

  ctx.fillStyle = "#eef4fb";
  ctx.font = `${Math.max(11, 15 * scaleX)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(p.name, x, y - r - 12);
}

function draw() {
  requestAnimationFrame(draw);

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#0c1219";
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = "#16202b";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (!state) return;

  const sx = w / state.arena.width;
  const sy = h / state.arena.height;

  ctx.fillStyle = "#3a4657";
  for (const wall of state.walls) {
    ctx.fillRect(wall.x * sx, wall.y * sy, wall.w * sx, wall.h * sy);
  }

  for (const b of state.bullets) {
    ctx.beginPath();
    ctx.arc(b.x * sx, b.y * sy, 6 * ((sx + sy) / 2), 0, Math.PI * 2);
    ctx.fillStyle = "#fff8ba";
    ctx.fill();
  }

  for (const p of state.players) drawTank(p, sx, sy);

  const now = performance.now();
  explosions = explosions.filter((e) => now - e.born < 520);
  for (const e of explosions) {
    const t = (now - e.born) / 520;
    const radius = 12 + t * 55;
    ctx.beginPath();
    ctx.arc(e.x * sx, e.y * sy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,190,90,${1-t})`;
    ctx.lineWidth = 7 * (1-t) + 1;
    ctx.stroke();
  }
}
draw();
