const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const WORLD = { w: 2800, h: 1800 };

const players = new Map();
const bots = new Map();
const bullets = [];
const grenades = [];
const pickups = [];
const wilds = new Map();

let botSeq = 1;
let wildSeq = 1;
let pickupSeq = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mkInv() {
  return {
    coins: Math.floor(rnd(8, 36)),
    bombs: Math.floor(rnd(0, 4)),
    potions: Math.floor(rnd(0, 4))
  };
}

function spawnBot() {
  const id = 'bot' + botSeq++;

  let x = rnd(150, WORLD.w - 150);
  let y = rnd(150, WORLD.h - 150);

  // 봇끼리 최대한 멀리 떨어져서 생성
  for (let tries = 0; tries < 50; tries++) {
    const tooCloseToBot = [...bots.values()].some(
      b => Math.hypot(b.x - x, b.y - y) < 600
    );

    const tooCloseToPlayer = [...players.values()].some(
      p => Math.hypot(p.x - x, p.y - y) < 700
    );

    if (!tooCloseToBot && !tooCloseToPlayer) break;

    x = rnd(150, WORLD.w - 150);
    y = rnd(150, WORLD.h - 150);
  }

  bots.set(id, {
    id,
    name: 'BOT-' + id.slice(3),
    x,
    y,
    angle: rnd(0, Math.PI * 2),
    r: 22,

    // 플레이어보다 훨씬 약함
    hp: 55,
    maxHp: 55,

    // 이동속도도 조금 느림
    speed: rnd(150, 170),

    // 플레이어 공격력 24 대비 매우 약함
    damage: 9,

    // 연사 크게 감소
    reload: rnd(1.15, 1.45),

    lastShot: 0,
    inv: mkInv(),
    strafe: Math.random() < 0.5 ? -1 : 1,
    score: 0,
    wanderAngle: rnd(0, Math.PI * 2),
    wanderTimer: rnd(1.0, 2.8)
  });
}

function spawnWild() {
  const id = 'wild' + wildSeq++;
  const type = Math.random() < 0.6 ? 'crawler' : 'orb';
  const hp = type === 'crawler' ? 70 : 45;

  wilds.set(id, {
    id,
    type,
    x: rnd(100, WORLD.w - 100),
    y: rnd(100, WORLD.h - 100),
    angle: rnd(0, Math.PI * 2),
    r: type === 'crawler' ? 22 : 16,
    hp,
    maxHp: hp,
    speed: type === 'crawler' ? rnd(35, 60) : rnd(70, 110),
    turn: rnd(0.6, 1.6),
    inv: {
      coins: Math.floor(rnd(3, 16)),
      bombs: Math.random() < 0.35 ? 1 : 0,
      potions: Math.random() < 0.45 ? 1 : 0
    }
  });
}

function spawnPickup(kind = null, x = null, y = null) {
  if (!kind) {
    const r = Math.random();
    kind = r < 0.55 ? 'coin' : r < 0.78 ? 'potion' : 'bomb';
  }

  const p = {
    id: 'p' + pickupSeq++,
    kind,
    x: x ?? rnd(80, WORLD.w - 80),
    y: y ?? rnd(80, WORLD.h - 80),
    life: 9999
  };

  pickups.push(p);
  return p;
}

// 봇 수 자체도 조금 감소
for (let i = 0; i < 7; i++) spawnBot();
for (let i = 0; i < 12; i++) spawnWild();
for (let i = 0; i < 28; i++) spawnPickup();

function serialize() {
  return JSON.stringify({
    t: 'state',
    world: WORLD,
    players: [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      maxHp: p.maxHp,
      energy: p.energy,
      level: p.level,
      score: p.score,
      bombs: p.bombs,
      potions: p.potions,
      coins: p.coins
    })),
    bots: [...bots.values()],
    wilds: [...wilds.values()],
    bullets,
    pickups,
    grenades
  });
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function drop20(x, y, inv) {
  const arr = [];

  for (let i = 0; i < Math.floor((inv.coins || 0) * 0.2); i++) {
    arr.push('coin');
  }

  for (let i = 0; i < Math.floor((inv.bombs || 0) * 0.2); i++) {
    arr.push('bomb');
  }

  for (let i = 0; i < Math.floor((inv.potions || 0) * 0.2); i++) {
    arr.push('potion');
  }

  arr
    .sort(() => Math.random() - 0.5)
    .slice(0, 18)
    .forEach(k =>
      spawnPickup(
        k,
        x + rnd(-35, 35),
        y + rnd(-35, 35)
      )
    );
}

function dropWild(x, y, inv) {
  for (let i = 0; i < Math.max(1, Math.ceil((inv.coins || 0) / 5)); i++) {
    spawnPickup(
      'coin',
      x + rnd(-28, 28),
      y + rnd(-28, 28)
    );
  }

  if (inv.bombs) {
    spawnPickup(
      'bomb',
      x + rnd(-28, 28),
      y + rnd(-28, 28)
    );
  }

  if (inv.potions) {
    spawnPickup(
      'potion',
      x + rnd(-28, 28),
      y + rnd(-28, 28)
    );
  }
}

function respawnPlayer(p) {
  p.x = WORLD.w / 2 + rnd(-250, 250);
  p.y = WORLD.h / 2 + rnd(-200, 200);

  p.hp = 100;
  p.maxHp = 100;
  p.energy = 100;
  p.level = 1;
  p.score = 0;

  p.damage = 24;
  p.reload = 0.34;
  p.speed = 230;
}

wss.on('connection', ws => {
  const id = crypto.randomBytes(5).toString('hex');

  const p = {
    id,
    name: 'Player-' + id.slice(0, 4),
    x: WORLD.w / 2 + rnd(-250, 250),
    y: WORLD.h / 2 + rnd(-200, 200),
    angle: 0,
    r: 24,
    hp: 100,
    maxHp: 100,
    energy: 100,
    level: 1,
    score: 0,
    damage: 24,
    reload: 0.34,
    speed: 230,
    lastShot: 0,
    bombs: 2,
    potions: 2,
    coins: 0,
    keys: {},
    boost: false
  };

  players.set(id, p);

  ws.pid = id;

  send(ws, {
    t: 'welcome',
    id,
    world: WORLD
  });

  ws.on('message', raw => {
    let m;

    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    const me = players.get(id);

    if (!me) return;

    if (m.t === 'input') {
      me.keys = m.keys || {};
      me.angle = Number.isFinite(m.angle)
        ? m.angle
        : me.angle;
      me.boost = !!m.boost;
    }

    if (m.t === 'name') {
      me.name = String(m.name || 'Player').slice(0, 16);
    }

    if (m.t === 'shoot') {
      const now = Date.now() / 1000;

      if (now - me.lastShot >= me.reload) {
        me.lastShot = now;

        bullets.push({
          id: 'b' + Math.random(),
          owner: id,
          x: me.x + Math.cos(me.angle) * 44,
          y: me.y + Math.sin(me.angle) * 44,
          vx: Math.cos(me.angle) * 650,
          vy: Math.sin(me.angle) * 650,
          r: 6,
          life: 1.8,
          damage: me.damage,
          enemy: false
        });
      }
    }

    if (m.t === 'bomb' && me.bombs > 0) {
      me.bombs--;

      grenades.push({
        id: 'g' + Math.random(),
        owner: id,
        x: me.x + Math.cos(me.angle) * 30,
        y: me.y + Math.sin(me.angle) * 30,
        vx: Math.cos(me.angle) * 520,
        vy: Math.sin(me.angle) * 520,
        life: 0.72
      });
    }

    if (
      m.t === 'potion' &&
      me.potions > 0 &&
      (me.hp < me.maxHp || me.energy < 100)
    ) {
      me.potions--;

      me.hp = Math.min(
        me.maxHp,
        me.hp + 55
      );

      me.energy = Math.min(
        100,
        me.energy + 65
      );
    }
  });

  ws.on('close', () => {
    players.delete(id);
  });
});

function nearestHuman(e) {
  let best = null;
  let bd = Infinity;

  for (const p of players.values()) {
    const d = dist(e, p);

    if (d < bd) {
      bd = d;
      best = p;
    }
  }

  return [best, bd];
}

// 한 플레이어에게 동시에 공격 중인 봇 숫자 계산
function attackersOnPlayer(playerId, assignments) {
  let count = 0;

  for (const targetId of assignments.values()) {
    if (targetId === playerId) {
      count++;
    }
  }

  return count;
}

function tick() {
  const dt = 0.05;
  const now = Date.now() / 1000;

  // 플레이어 이동
  for (const p of players.values()) {
    let dx =
      (p.keys.d ? 1 : 0) -
      (p.keys.a ? 1 : 0);

    let dy =
      (p.keys.s ? 1 : 0) -
      (p.keys.w ? 1 : 0);

    const l = Math.hypot(dx, dy) || 1;

    dx /= l;
    dy /= l;

    const boosting =
      p.boost &&
      p.energy > 0;

    if (boosting) {
      p.energy = Math.max(
        0,
        p.energy - (100 / 3) * dt
      );
    } else {
      p.energy = Math.min(
        100,
        p.energy + 10 * dt
      );
    }

    const sp =
      p.speed *
      (boosting ? 1.65 : 1);

    p.x = clamp(
      p.x + dx * sp * dt,
      p.r,
      WORLD.w - p.r
    );

    p.y = clamp(
      p.y + dy * sp * dt,
      p.r,
      WORLD.h - p.r
    );

    for (let i = pickups.length - 1; i >= 0; i--) {
      const q = pickups[i];

      if (
        Math.hypot(
          p.x - q.x,
          p.y - q.y
        ) < p.r + 18
      ) {
        if (q.kind === 'coin') {
          p.coins++;
        }

        if (q.kind === 'bomb') {
          p.bombs++;
        }

        if (q.kind === 'potion') {
          p.potions++;
        }

        pickups.splice(i, 1);
      }
    }
  }

  // 봇이 누구를 공격 중인지 기록
  const botAssignments = new Map();

  for (const e of bots.values()) {
    const [target, d] = nearestHuman(e);

    const AGGRO_RANGE = 330;

    let allowedToAggro = false;

    if (target && d < AGGRO_RANGE) {
      // 한 플레이어당 동시에 1마리만 공격
      const alreadyAttacking =
        attackersOnPlayer(
          target.id,
          botAssignments
        );

      if (alreadyAttacking < 1) {
        allowedToAggro = true;
        botAssignments.set(
          e.id,
          target.id
        );
      }
    }

    if (allowedToAggro && target) {
      e.angle = Math.atan2(
        target.y - e.y,
        target.x - e.x
      );

      // 너무 멀면 접근
      if (d > 180) {
        e.x +=
          Math.cos(e.angle) *
          e.speed *
          dt;

        e.y +=
          Math.sin(e.angle) *
          e.speed *
          dt;
      } else {
        // 가까우면 너무 달라붙지 않고 천천히 옆으로 움직임
        e.x +=
          Math.cos(
            e.angle +
            Math.PI / 2 * e.strafe
          ) *
          e.speed *
          0.35 *
          dt;

        e.y +=
          Math.sin(
            e.angle +
            Math.PI / 2 * e.strafe
          ) *
          e.speed *
          0.35 *
          dt;
      }

      // 공격 거리도 짧게
      if (
        d < 360 &&
        now - e.lastShot >= e.reload
      ) {
        e.lastShot = now;

        bullets.push({
          id: 'bb' + Math.random(),
          owner: e.id,
          x:
            e.x +
            Math.cos(e.angle) * 38,
          y:
            e.y +
            Math.sin(e.angle) * 38,

          // 총알도 플레이어보다 느림
          vx:
            Math.cos(e.angle) * 390,

          vy:
            Math.sin(e.angle) * 390,

          r: 6,
          life: 1.35,
          damage: e.damage,
          enemy: true
        });
      }
    } else {
      // 공격 대상이 없으면 그냥 맵 돌아다니기
      e.wanderTimer -= dt;

      if (e.wanderTimer <= 0) {
        e.wanderTimer = rnd(1.0, 2.8);
        e.wanderAngle += rnd(
          -1.15,
          1.15
        );
      }

      e.angle = e.wanderAngle;

      e.x +=
        Math.cos(e.wanderAngle) *
        e.speed *
        0.28 *
        dt;

      e.y +=
        Math.sin(e.wanderAngle) *
        e.speed *
        0.28 *
        dt;

      if (
        e.x < 80 ||
        e.x > WORLD.w - 80
      ) {
        e.wanderAngle =
          Math.PI -
          e.wanderAngle;

        e.x = clamp(
          e.x,
          80,
          WORLD.w - 80
        );
      }

      if (
        e.y < 80 ||
        e.y > WORLD.h - 80
      ) {
        e.wanderAngle =
          -e.wanderAngle;

        e.y = clamp(
          e.y,
          80,
          WORLD.h - 80
        );
      }
    }

    e.x = clamp(
      e.x,
      e.r,
      WORLD.w - e.r
    );

    e.y = clamp(
      e.y,
      e.r,
      WORLD.h - e.r
    );
  }

  // 야생 개체
  for (const w of wilds.values()) {
    const [target, d] =
      nearestHuman(w);

    if (
      target &&
      w.type === 'crawler' &&
      d < 260
    ) {
      w.angle = Math.atan2(
        target.y - w.y,
        target.x - w.x
      );

      w.x +=
        Math.cos(w.angle) *
        w.speed *
        1.15 *
        dt;

      w.y +=
        Math.sin(w.angle) *
        w.speed *
        1.15 *
        dt;
    } else if (
      target &&
      w.type === 'orb' &&
      d < 220
    ) {
      w.angle =
        Math.atan2(
          target.y - w.y,
          target.x - w.x
        ) + Math.PI;

      w.x +=
        Math.cos(w.angle) *
        w.speed *
        dt;

      w.y +=
        Math.sin(w.angle) *
        w.speed *
        dt;
    } else {
      w.turn -= dt;

      if (w.turn <= 0) {
        w.turn = rnd(0.6, 1.6);
        w.angle += rnd(-1.6, 1.6);
      }

      w.x +=
        Math.cos(w.angle) *
        w.speed *
        0.5 *
        dt;

      w.y +=
        Math.sin(w.angle) *
        w.speed *
        0.5 *
        dt;
    }

    w.x = clamp(
      w.x,
      w.r,
      WORLD.w - w.r
    );

    w.y = clamp(
      w.y,
