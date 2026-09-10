const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;

const WORLD = { w: 3000, h: 2000 };

const players = new Map();
const bots = new Map();
const wilds = new Map();

const bullets = [];
const grenades = [];
const pickups = [];
const explosions = [];

let botSeq = 1;
let wildSeq = 1;
let pickupSeq = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* =========================================================
   설정값
========================================================= */

const BOT_COUNT = 6;
const WILD_COUNT = 50;

/* 봇은 플레이어보다 매우 약하게 */
const BOT_HP = 50;
const BOT_DAMAGE = 6;
const BOT_RELOAD_MIN = 1.4;
const BOT_RELOAD_MAX = 1.8;
const BOT_AGGRO_RANGE = 330;

/* 폭탄 */
const GRENADE_DAMAGE = 30;
const GRENADE_RADIUS = 150;

/* =========================================================
   레벨
========================================================= */

function xpNeeded(level) {
  return Math.round(100 * Math.pow(1.25, level - 1));
}

function getWeaponTier(level) {
  if (level >= 15) return 4;
  if (level >= 10) return 3;
  if (level >= 5) return 2;
  return 1;
}

function applyLevelStats(p) {
  const tier = getWeaponTier(p.level);

  /* 몸집은 커지지 않음 */
  p.r = 24;

  if (tier === 1) {
    p.damage = 24;
    p.reload = 0.34;
    p.speed = 230;
  }

  if (tier === 2) {
    p.damage = 22;
    p.reload = 0.30;
    p.speed = 235;
  }

  if (tier === 3) {
    p.damage = 21;
    p.reload = 0.27;
    p.speed = 240;
  }

  if (tier === 4) {
    p.damage = 20;
    p.reload = 0.24;
    p.speed = 245;
  }
}

function giveXP(p, amount) {
  p.xp += Math.max(1, Math.round(amount));

  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++;
    applyLevelStats(p);
  }
}

/*
상대가 강할수록 XP 많이 줌.
*/
function killXP(target) {
  const level = target.level || 1;
  const storedXP = target.xp || 0;

  return 40 + level * 18 + Math.floor(storedXP * 0.15);
}

/* =========================================================
   드랍
========================================================= */

function spawnPickup(kind, x, y) {
  pickups.push({
    id: "pickup-" + pickupSeq++,
    kind,
    x: x ?? rnd(80, WORLD.w - 80),
    y: y ?? rnd(80, WORLD.h - 80),
  });
}

/*
필드 랜덤 드랍.

돈은 희귀.
폭탄/포션은 이전보다 훨씬 자주.
레이저도 랜덤 드랍.
*/
function randomFieldPickup() {
  const r = Math.random();

  if (r < 0.04) {
    spawnPickup("coin");
  } else if (r < 0.40) {
    spawnPickup("bomb");
  } else if (r < 0.76) {
    spawnPickup("potion");
  } else {
    spawnPickup("laser");
  }
}

/*
플레이어나 봇 사망.

돈 드랍은 매우 낮춤.
보유 폭탄/포션/레이저 중 일부 드랍.
*/
function dropPlayerLoot(target) {
  const x = target.x;
  const y = target.y;

  /* COIN: 기존보다 약 1/10 느낌 */
  const coinDrops = Math.floor((target.coins || 0) * 0.02);

  for (let i = 0; i < coinDrops; i++) {
    spawnPickup("coin", x + rnd(-45, 45), y + rnd(-45, 45));
  }

  /* 보유 아이템 약 20% */
  const bombDrops = Math.floor((target.bombs || 0) * 0.2);
  const potionDrops = Math.floor((target.potions || 0) * 0.2);
  const laserDrops = Math.floor((target.lasers || 0) * 0.2);

  for (let i = 0; i < bombDrops; i++) {
    spawnPickup("bomb", x + rnd(-45, 45), y + rnd(-45, 45));
  }

  for (let i = 0; i < potionDrops; i++) {
    spawnPickup("potion", x + rnd(-45, 45), y + rnd(-45, 45));
  }

  for (let i = 0; i < laserDrops; i++) {
    spawnPickup("laser", x + rnd(-45, 45), y + rnd(-45, 45));
  }
}

/*
야생 처치 보상.

폭탄/포션 드랍 높음.
돈은 낮음.
*/
function dropWildLoot(wild) {
  const x = wild.x;
  const y = wild.y;

  if (Math.random() < 0.06) {
    spawnPickup("coin", x + rnd(-25, 25), y + rnd(-25, 25));
  }

  if (Math.random() < 0.60) {
    spawnPickup("bomb", x + rnd(-30, 30), y + rnd(-30, 30));
  }

  if (Math.random() < 0.70) {
    spawnPickup("potion", x + rnd(-30, 30), y + rnd(-30, 30));
  }

  if (Math.random() < 0.20) {
    spawnPickup("laser", x + rnd(-30, 30), y + rnd(-30, 30));
  }
}

/* =========================================================
   봇
========================================================= */

function findBotSpawn() {
  for (let i = 0; i < 60; i++) {
    const x = rnd(120, WORLD.w - 120);
    const y = rnd(120, WORLD.h - 120);

    const farFromBots = [...bots.values()].every(
      b => Math.hypot(b.x - x, b.y - y) > 500
    );

    const farFromCenter =
      Math.hypot(x - WORLD.w / 2, y - WORLD.h / 2) > 550;

    if (farFromBots && farFromCenter) return { x, y };
  }

  return {
    x: rnd(120, WORLD.w - 120),
    y: rnd(120, WORLD.h - 120),
  };
}

function spawnBot() {
  const id = "bot-" + botSeq++;
  const pos = findBotSpawn();

  bots.set(id, {
    id,
    name: "BOT",
    x: pos.x,
    y: pos.y,
    angle: rnd(0, Math.PI * 2),
    r: 24,

    hp: BOT_HP,
    maxHp: BOT_HP,

    level: Math.floor(rnd(1, 6)),
    xp: Math.floor(rnd(0, 80)),

    damage: BOT_DAMAGE,
    reload: rnd(BOT_RELOAD_MIN, BOT_RELOAD_MAX),
    speed: rnd(125, 150),
    lastShot: 0,

    coins: Math.floor(rnd(0, 10)),
    bombs: Math.floor(rnd(0, 4)),
    potions: Math.floor(rnd(0, 5)),
    lasers: Math.floor(rnd(0, 2)),

    wanderAngle: rnd(0, Math.PI * 2),
    wanderTimer: rnd(1, 3),
    strafe: Math.random() < 0.5 ? -1 : 1,
  });
}

/* =========================================================
   야생
========================================================= */

function spawnWild() {
  const id = "wild-" + wildSeq++;

  const type = Math.random() < 0.65 ? "crawler" : "wisp";

  const maxHp = type === "crawler" ? 65 : 45;

  wilds.set(id, {
    id,
    type,

    x: rnd(80, WORLD.w - 80),
    y: rnd(80, WORLD.h - 80),

    angle: rnd(0, Math.PI * 2),

    r: type === "crawler" ? 20 : 15,

    hp: maxHp,
    maxHp,

    level: Math.floor(rnd(1, 5)),
    xp: Math.floor(rnd(0, 50)),

    speed:
      type === "crawler"
        ? rnd(35, 55)
        : rnd(65, 95),

    wanderTimer: rnd(0.8, 2),
  });
}

/* =========================================================
   초기 월드
========================================================= */

for (let i = 0; i < BOT_COUNT; i++) spawnBot();
for (let i = 0; i < WILD_COUNT; i++) spawnWild();

/* 처음부터 필드 아이템 */
for (let i = 0; i < 70; i++) randomFieldPickup();

/* =========================================================
   플레이어
========================================================= */

function respawnPlayer(p) {
  p.x = WORLD.w / 2 + rnd(-180, 180);
  p.y = WORLD.h / 2 + rnd(-180, 180);

  p.hp = 100;
  p.maxHp = 100;

  p.energy = 100;

  /*
  현재는 사망해도 레벨 유지.
  이건 나중에 사용자 확인 없이 변경하지 말 것.
  */
  applyLevelStats(p);
}

function createPlayer(id) {
  const p = {
    id,
    name: "Player",

    x: WORLD.w / 2 + rnd(-180, 180),
    y: WORLD.h / 2 + rnd(-180, 180),

    angle: 0,
    r: 24,

    hp: 100,
    maxHp: 100,

    energy: 100,

    level: 1,
    xp: 0,

    damage: 24,
    reload: 0.34,
    speed: 230,

    lastShot: 0,

    coins: 0,
    bombs: 2,
    potions: 2,
    lasers: 0,

    laserActive: false,

    keys: {},
    boost: false,

    score: 0,
  };

  applyLevelStats(p);

  return p;
}

/* =========================================================
   발사
========================================================= */

function firePlayer(p) {
  const tier = getWeaponTier(p.level);

  let angles = [0];

  if (tier === 2) {
    angles = [-0.055, 0.055];
  }

  if (tier === 3) {
    angles = [-0.11, 0, 0.11];
  }

  if (tier === 4) {
    angles = [-0.16, -0.05, 0.05, 0.16];
  }

  for (const offset of angles) {
    const a = p.angle + offset;

    bullets.push({
      id: crypto.randomBytes(4).toString("hex"),
      owner: p.id,

      x: p.x + Math.cos(a) * 40,
      y: p.y + Math.sin(a) * 40,

      vx: Math.cos(a) * 650,
      vy: Math.sin(a) * 650,

      r: 5,
      life: 1.7,

      damage: p.damage,
      enemy: false,
    });
  }
}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on("connection", ws => {
  const id = crypto.randomBytes(5).toString("hex");

  const player = createPlayer(id);

  players.set(id, player);

  ws.playerId = id;

  ws.send(
    JSON.stringify({
      t: "welcome",
      id,
      world: WORLD,
    })
  );

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const p = players.get(id);
    if (!p) return;

    if (msg.t === "name") {
      p.name = String(msg.name || "Player").slice(0, 16);
    }

    if (msg.t === "input") {
      p.keys = msg.keys || {};

      if (Number.isFinite(msg.angle)) {
        p.angle = msg.angle;
      }

      p.boost = !!msg.boost;
    }

    if (msg.t === "shoot") {
      const now = Date.now() / 1000;

      if (now - p.lastShot >= p.reload) {
        p.lastShot = now;
        firePlayer(p);
      }
    }

    if (msg.t === "bomb" && p.bombs > 0) {
      p.bombs--;

      grenades.push({
        id: crypto.randomBytes(4).toString("hex"),
        owner: p.id,

        x: p.x + Math.cos(p.angle) * 36,
        y: p.y + Math.sin(p.angle) * 36,

        vx: Math.cos(p.angle) * 520,
        vy: Math.sin(p.angle) * 520,

        life: 0.72,
      });
    }

    if (msg.t === "potion" && p.potions > 0) {
      if (p.hp < p.maxHp || p.energy < 100) {
        p.potions--;

        p.hp = Math.min(p.maxHp, p.hp + 55);
        p.energy = Math.min(100, p.energy + 65);
      }
    }

    /*
    레드닷/레이저 조준기.
    하나 사용하면 ON/OFF가 아니라
    획득 후 영구 장착 상태.
    */
    if (msg.t === "laser" && p.lasers > 0) {
      p.lasers--;
      p.laserActive = true;
    }
  });

  ws.on("close", () => {
    players.delete(id);
  });
});

/* =========================================================
   폭탄 폭발
========================================================= */

function explodeGrenade(g) {
  explosions.push({
    x: g.x,
    y: g.y,
    radius: GRENADE_RADIUS,
    life: 0.35,
  });

  for (const p of players.values()) {
    if (p.id === g.owner) continue;

    if (Math.hypot(p.x - g.x, p.y - g.y) <= GRENADE_RADIUS) {
      p.hp -= GRENADE_DAMAGE;

      if (p.hp <= 0) {
        const killer = players.get(g.owner);

        if (killer) {
          giveXP(killer, killXP(p));
          killer.score += 100;
        }

        dropPlayerLoot(p);
        respawnPlayer(p);
      }
    }
  }

  for (const [id, bot] of bots) {
    if (Math.hypot(bot.x - g.x, bot.y - g.y) <= GRENADE_RADIUS) {
      bot.hp -= GRENADE_DAMAGE;

      if (bot.hp <= 0) {
        const killer = players.get(g.owner);

        if (killer) {
          giveXP(killer, killXP(bot));
          killer.score += 60;
        }

        dropPlayerLoot(bot);

        bots.delete(id);
        setTimeout(spawnBot, 1200);
      }
    }
  }

  for (const [id, wild] of wilds) {
    if (Math.hypot(wild.x - g.x, wild.y - g.y) <= GRENADE_RADIUS) {
      wild.hp -= GRENADE_DAMAGE;

      if (wild.hp <= 0) {
        const killer = players.get(g.owner);

        if (killer) {
          giveXP(killer, 20 + wild.level * 8);
          killer.score += 25;
        }

        dropWildLoot(wild);

        wilds.delete(id);
        setTimeout(spawnWild, 500);
      }
    }
  }
}

/* =========================================================
   GAME LOOP
========================================================= */

function tick() {
  const dt = 0.05;
  const now = Date.now() / 1000;

  /* 플레이어 이동 */

  for (const p of players.values()) {
    let dx = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
    let dy = (p.keys.s ? 1 : 0) - (p.keys.w ? 1 : 0);

    const len = Math.hypot(dx, dy) || 1;

    dx /= len;
    dy /= len;

    const boosting = p.boost && p.energy > 0;

    if (boosting) {
      p.energy = Math.max(0, p.energy
