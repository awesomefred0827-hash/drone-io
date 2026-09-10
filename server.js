const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const WORLD = { w: 2800, h: 1800 };

const players = new Map();
const bots = new Map();
const wilds = new Map();

const bullets = [];
const grenades = [];
const pickups = [];

let botSeq = 1;
let wildSeq = 1;
let pickupSeq = 1;

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function randomPosition() {
  return {
    x: rnd(120, WORLD.w - 120),
    y: rnd(120, WORLD.h - 120)
  };
}

/* =========================
   PLAYER
========================= */

function createPlayer(id, name = "Player") {
  const pos = {
    x: WORLD.w / 2 + rnd(-220, 220),
    y: WORLD.h / 2 + rnd(-220, 220)
  };

  return {
    id,
    name: String(name).slice(0, 16),

    x: pos.x,
    y: pos.y,

    angle: 0,
    r: 24,

    hp: 100,
    maxHp: 100,

    energy: 100,

    level: 1,
    xp: 0,
    nextXp: 100,

    score: 0,

    damage: 24,
    reload: 0.34,
    speed: 230,

    lastShot: 0,

    bombs: 2,
    potions: 2,
    lasers: 0,

    laserActive: false,
    laserUntil: 0,

    coins: 0,

    keys: {},
    boost: false,

    alive: true
  };
}

function xpReward(target) {
  const level = target.level || 1;
  const xp = target.xp || 0;

  return Math.max(
    10,
    Math.round(20 + level * 12 + xp * 0.12)
  );
}

function addXp(player, amount) {
  if (!player) return;

  player.xp += amount;

  while (player.xp >= player.nextXp) {
    player.xp -= player.nextXp;
    player.level++;

    player.nextXp = Math.round(player.nextXp * 1.28);

    /* 레벨이 오르면 조금씩 강해짐 */
    player.damage += 2;

    player.maxHp += 5;
    player.hp = Math.min(player.maxHp, player.hp + 15);

    /*
      Lv5 / 10 / 15에서
      실제 발사 방식은 shoot 함수에서 변화
    */
  }
}

/* =========================
   BOT
========================= */

function safeBotPosition() {
  for (let tries = 0; tries < 60; tries++) {
    const p = randomPosition();

    let safe = true;

    for (const b of bots.values()) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < 430) {
        safe = false;
        break;
      }
    }

    if (safe) return p;
  }

  return randomPosition();
}

function spawnBot() {
  const id = "bot" + botSeq++;
  const pos = safeBotPosition();

  bots.set(id, {
    id,
    name: "BOT-" + id.slice(3),

    x: pos.x,
    y: pos.y,

    angle: rnd(0, Math.PI * 2),
    r: 22,

    /* 아주 약한 연습용 봇 */
    hp: 50,
    maxHp: 50,

    damage: 6,
    reload: rnd(1.4, 1.8),
    speed: rnd(130, 150),

    lastShot: 0,

    level: Math.floor(rnd(1, 5)),
    xp: Math.floor(rnd(0, 80)),

    score: 0,

    coins: Math.floor(rnd(0, 5)),
    bombs: Math.floor(rnd(0, 3)),
    potions: Math.floor(rnd(0, 3)),
    lasers: Math.random() < 0.15 ? 1 : 0,

    wanderAngle: rnd(0, Math.PI * 2),
    wanderTimer: rnd(1, 3),

    strafe: Math.random() < 0.5 ? -1 : 1
  });
}

/* =========================
   WILD
========================= */

function spawnWild() {
  const id = "wild" + wildSeq++;
  const pos = randomPosition();

  const type = Math.random() < 0.65 ? "crawler" : "orb";

  const hp = type === "crawler" ? 55 : 40;

  wilds.set(id, {
    id,
    type,

    x: pos.x,
    y: pos.y,

    angle: rnd(0, Math.PI * 2),

    r: type === "crawler" ? 20 : 15,

    hp,
    maxHp: hp,

    level: Math.floor(rnd(1, 4)),
    xp: Math.floor(rnd(0, 50)),

    speed: type === "crawler" ? rnd(30, 50) : rnd(60, 90),

    turnTimer: rnd(0.5, 1.5)
  });
}

/* =========================
   PICKUPS
========================= */

function spawnPickup(kind = null, x = null, y = null) {
  if (!kind) {
    const r = Math.random();

    /*
      돈 드랍 대폭 감소.
      폭탄/포션 비중 증가.
    */
    if (r < 0.05) {
      kind = "coin";
    } else if (r < 0.43) {
      kind = "bomb";
    } else if (r < 0.81) {
      kind = "potion";
    } else {
      kind = "laser";
    }
  }

  pickups.push({
    id: "pickup" + pickupSeq++,

    kind,

    x: x ?? rnd(80, WORLD.w - 80),
    y: y ?? rnd(80, WORLD.h - 80)
  });
}

function scatterPickup(kind, x, y) {
  spawnPickup(
    kind,
    x + rnd(-35, 35),
    y + rnd(-35, 35)
  );
}

/* =========================
   DROPS
========================= */

function dropFromPlayer(p) {
  /*
    상대가 가진 아이템의 약 20%.
    코인은 기존보다 훨씬 적게.
  */

  const bombCount = Math.floor((p.bombs || 0) * 0.2);
  const potionCount = Math.floor((p.potions || 0) * 0.2);
  const laserCount = Math.floor((p.lasers || 0) * 0.2);

  const coinCount = Math.floor((p.coins || 0) * 0.02);

  for (let i = 0; i < bombCount; i++) {
    scatterPickup("bomb", p.x, p.y);
  }

  for (let i = 0; i < potionCount; i++) {
    scatterPickup("potion", p.x, p.y);
  }

  for (let i = 0; i < laserCount; i++) {
    scatterPickup("laser", p.x, p.y);
  }

  for (let i = 0; i < coinCount; i++) {
    scatterPickup("coin", p.x, p.y);
  }
}

function dropFromWild(w) {
  /*
    야생 처치 보상은 높게.
    돈은 드물고 폭탄/포션 위주.
  */

  if (Math.random() < 0.65) {
    scatterPickup("potion", w.x, w.y);
  }

  if (Math.random() < 0.55) {
    scatterPickup("bomb", w.x, w.y);
  }

  if (Math.random() < 0.16) {
    scatterPickup("laser", w.x, w.y);
  }

  if (Math.random() < 0.06) {
    scatterPickup("coin", w.x, w.y);
  }

  if (Math.random() < 0.20) {
    scatterPickup(
      Math.random() < 0.5 ? "bomb" : "potion",
      w.x,
      w.y
    );
  }
}

/* =========================
   INITIAL WORLD
========================= */

for (let i = 0; i < 6; i++) {
  spawnBot();
}

/* 확정한 야생 50마리 */
for (let i = 0; i < 50; i++) {
  spawnWild();
}

for (let i = 0; i < 45; i++) {
  spawnPickup();
}

/* =========================
   NETWORK
========================= */

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastState() {
  const data = JSON.stringify({
    t: "state",

    world: WORLD,

    players: [...players.values()],

    bots: [...bots.values()],

    wilds: [...wilds.values()],

    bullets,

    grenades,

    pickups
  });

  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

wss.on("connection", ws => {
  const id = crypto.randomBytes(6).toString("hex");

  ws.pid = id;
  ws.playerName = "Player-" + id.slice(0, 4);

  players.set(
    id,
    createPlayer(id, ws.playerName)
  );

  send(ws, {
    t: "welcome",
    id,
    world: WORLD
  });

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    let p = players.get(id);

    /*
      죽은 뒤 PLAY AGAIN
    */
    if (msg.t === "respawn") {
      if (!p) {
        p = createPlayer(id, ws.playerName);
        players.set(id, p);

        send(ws, {
          t: "respawned"
        });
      }

      return;
    }

    if (!p) return;

    if (msg.t === "name") {
      ws.playerName = String(msg.name || "Player").slice(0, 16);
      p.name = ws.playerName;
    }

    if (msg.t === "input") {
      p.keys = msg.keys || {};

      if (Number.isFinite(msg.angle)) {
        p.angle = msg.angle;
      }

      p.boost = !!msg.boost;
    }

    if (msg.t === "shoot") {
      shootPlayer(p);
    }

    if (msg.t === "bomb") {
      throwGrenade(p);
    }

    if (msg.t === "potion") {
      usePotion(p);
    }

    if (msg.t === "laser") {
      useLaser(p);
    }
  });

  /*
    브라우저 닫음 / 인터넷 끊김
    → 즉시 맵에서 제거
  */
  ws.on("close", () => {
    players.delete(id);
  });
});

/* =========================
   SHOOT
========================= */

function makeBullet(owner, x, y, angle, damage, enemy = false) {
  bullets.push({
    id: "bullet" + Math.random(),

    owner,

    x,
    y,

    vx: Math.cos(angle) * (enemy ? 390 : 650),
    vy: Math.sin(angle) * (enemy ? 390 : 650),

    r: 6,

    life: enemy ? 1.5 : 1.8,

    damage,

    enemy
  });
}

function shootPlayer(p) {
  const now = Date.now() / 1000;

  if (now - p.lastShot < p.reload) return;

  p.lastShot = now;

  /*
    레벨에 따라 모양뿐 아니라
    발사 방식도 변화.
  */

  let angles;

  if (p.level < 5) {
    angles = [p.angle];
  }

  else if (p.level < 10) {
    angles = [
      p.angle - 0.035,
      p.angle + 0.035
    ];
  }

  else if (p.level < 15) {
    angles = [
      p.angle - 0.09,
      p.angle,
      p.angle + 0.09
    ];
  }

  else {
    angles = [
      p.angle - 0.13,
      p.angle - 0.04,
      p.angle + 0.04,
      p.angle + 0.13
    ];
  }

  /*
    다발 공격이 너무 세지는 걸 방지.
  */
  const damagePerBullet =
    p.damage / Math.max(1, angles.length * 0.72);

  for (const angle of angles) {
    makeBullet(
      p.id,

      p.x + Math.cos(angle) * 40,
      p.y + Math.sin(angle) * 40,

      angle,

      damagePerBullet,

      false
    );
  }
}

/* =========================
   ITEMS
========================= */

function throwGrenade(p) {
  if (p.bombs <= 0) return;

  p.bombs--;

  grenades.push({
    id: "grenade" + Math.random(),

    owner: p.id,

    x: p.x + Math.cos(p.angle) * 35,
    y: p.y + Math.sin(p.angle) * 35,

    vx: Math.cos(p.angle) * 520,
    vy: Math.sin(p.angle) * 520,

    life: 0.72
  });
}

function usePotion(p) {
  if (p.potions <= 0) return;

  if (
    p.hp >= p.maxHp &&
    p.energy >= 100
  ) {
    return;
  }

  p.potions--;

  p.hp = Math.min(
    p.maxHp,
    p.hp + 55
  );

  p.energy = Math.min(
    100,
    p.energy + 65
  );
}

function useLaser(p) {
  if (p.lasers <= 0) return;

  p.lasers--;

  p.laserActive = true;
  p.laserUntil = Date.now() + 10000;
}

/* =========================
   DEATH
========================= */

function killPlayer(victim, killerId) {
  if (!victim) return;

  dropFromPlayer(victim);

  const killer = players.get(killerId);

  if (killer) {
    const reward = xpReward(victim);

    addXp(killer, reward);

    killer.score += 100;
  }

  /*
    중요:
    자동 부활 없음.
    맵에서 완전히 삭제.
  */
  players.delete(victim.id);

  /*
    해당 플레이어 WebSocket에
    죽었다고 알려줌.
  */
  for (const ws of wss.clients) {
    if (
      ws.readyState === 1 &&
      ws.pid === victim.id
    ) {
      send(ws, {
        t: "dead",

        level: victim.level,
        xp: victim.xp,
        score: victim.score,
        coins: victim.coins
      });

      break;
    }
  }
}

/* =========================
   BOT TARGETING
========================= */

function findUnclaimedTarget(bot, claimed) {
  let target = null;
  let bestDistance = Infinity;

  for (const p of players.values()) {
    if (claimed.has(p.id)) continue;

    const d = distance(bot, p);

    if (d < bestDistance) {
      bestDistance = d;
      target = p;
    }
  }

  return {
    target,
    distance: bestDistance
  };
}

/* =========================
   MAIN LOOP
========================= */

function tick() {
  const dt = 0.05;
  const now = Date.now() / 1000;

  /* PLAYER */

  for (const p of players.values()) {
    if (p.laserActive && Date.now() >= p.laserUntil) {
      p.laserActive = false;
    }

    let dx = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
    let dy = (p.keys.s ? 1 : 0) - (p.keys.w ? 1 : 0);

    const len = Math.hypot(dx, dy) || 1;

    dx /= len;
   
