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

const WORLD = {
  w: 2800,
  h: 1800
};

const players = new Map();
const bots = new Map();
const wilds = new Map();

const bullets = [];
const grenades = [];
const pickups = [];

let botSeq = 1;
let wildSeq = 1;
let pickupSeq = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* =========================
   BOT
========================= */

function makeBotInventory() {
  return {
    coins: Math.floor(rnd(5, 25)),
    bombs: Math.floor(rnd(0, 3)),
    potions: Math.floor(rnd(0, 3))
  };
}

function findSafeBotSpawn() {
  let x;
  let y;

  for (let tries = 0; tries < 50; tries++) {
    x = rnd(120, WORLD.w - 120);
    y = rnd(120, WORLD.h - 120);

    const awayFromBots = [...bots.values()].every(
      b => Math.hypot(b.x - x, b.y - y) > 550
    );

    /* 플레이어 시작 지역 근처에는 봇을 최대한 안 둠 */
    const awayFromCenter =
      Math.hypot(x - WORLD.w / 2, y - WORLD.h / 2) > 500;

    if (awayFromBots && awayFromCenter) {
      return { x, y };
    }
  }

  return {
    x: rnd(120, WORLD.w - 120),
    y: rnd(120, WORLD.h - 120)
  };
}

function spawnBot() {
  const id = 'bot' + botSeq++;
  const pos = findSafeBotSpawn();

  bots.set(id, {
    id,
    name: 'BOT-' + id.slice(3),

    x: pos.x,
    y: pos.y,

    angle: rnd(0, Math.PI * 2),
    r: 22,

    /* 플레이어 HP 100 → 봇 HP 50 */
    hp: 50,
    maxHp: 50,

    /* 플레이어보다 느림 */
    speed: rnd(135, 155),

    /* 플레이어 총알 24 → 봇 총알 6 */
    damage: 6,

    /* 약 1.4~1.7초마다 한 발 */
    reload: rnd(1.4, 1.7),

    lastShot: 0,

    inv: makeBotInventory(),

    score: 0,

    strafe: Math.random() < 0.5 ? -1 : 1,

    wanderAngle: rnd(0, Math.PI * 2),
    wanderTimer: rnd(1.2, 3.0)
  });
}

/* =========================
   WILD CREATURE
========================= */

function spawnWild() {
  const id = 'wild' + wildSeq++;

  const type =
    Math.random() < 0.6
      ? 'crawler'
      : 'orb';

  const hp =
    type === 'crawler'
      ? 70
      : 45;

  wilds.set(id, {
    id,
    type,

    x: rnd(100, WORLD.w - 100),
    y: rnd(100, WORLD.h - 100),

    angle: rnd(0, Math.PI * 2),

    r:
      type === 'crawler'
        ? 22
        : 16,

    hp,
    maxHp: hp,

    speed:
      type === 'crawler'
        ? rnd(35, 60)
        : rnd(70, 110),

    turn: rnd(0.6, 1.6),

    inv: {
      coins: Math.floor(rnd(3, 16)),
      bombs: Math.random() < 0.35 ? 1 : 0,
      potions: Math.random() < 0.45 ? 1 : 0
    }
  });
}

/* =========================
   PICKUPS
========================= */

function spawnPickup(kind = null, x = null, y = null) {
  if (!kind) {
    const r = Math.random();

    if (r < 0.55) {
      kind = 'coin';
    } else if (r < 0.78) {
      kind = 'potion';
    } else {
      kind = 'bomb';
    }
  }

  const pickup = {
    id: 'p' + pickupSeq++,
    kind,

    x:
      x !== null
        ? x
        : rnd(80, WORLD.w - 80),

    y:
      y !== null
        ? y
        : rnd(80, WORLD.h - 80),

    life: 9999
  };

  pickups.push(pickup);

  return pickup;
}

/* =========================
   INITIAL WORLD
========================= */

/*
봇 숫자도 10 → 6으로 감소
*/
for (let i = 0; i < 6; i++) {
  spawnBot();
}

for (let i = 0; i < 12; i++) {
  spawnWild();
}

for (let i = 0; i < 28; i++) {
  spawnPickup();
}

/* =========================
   NETWORK
========================= */

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

/* =========================
   DROPS
========================= */

function drop20(x, y, inv) {
  const drops = [];

  for (
    let i = 0;
    i < Math.floor((inv.coins || 0) * 0.2);
    i++
  ) {
    drops.push('coin');
  }

  for (
    let i = 0;
    i < Math.floor((inv.bombs || 0) * 0.2);
    i++
  ) {
    drops.push('bomb');
  }

  for (
    let i = 0;
    i < Math.floor((inv.potions || 0) * 0.2);
    i++
  ) {
    drops.push('potion');
  }

  drops
    .sort(() => Math.random() - 0.5)
    .slice(0, 18)
    .forEach(kind => {
      spawnPickup(
        kind,
        x + rnd(-35, 35),
        y + rnd(-35, 35)
      );
    });
}

function dropWild(x, y, inv) {
  for (
    let i = 0;
    i < Math.max(
      1,
      Math.ceil((inv.coins || 0) / 5)
    );
    i++
  ) {
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

/* =========================
   PLAYER
========================= */

function respawnPlayer(p) {
  p.x = WORLD.w / 2 + rnd(-180, 180);
  p.y = WORLD.h / 2 + rnd(-180, 180);

  p.hp = 100;
  p.maxHp = 100;

  p.energy = 100;

  p.level = 1;
  p.score = 0;

  p.damage = 24;
  p.reload = 0.34;

  p.speed = 230;
}

/* =========================
   CONNECTION
========================= */

wss.on('connection', ws => {
  const id =
    crypto
      .randomBytes(5)
      .toString('hex');

  const p = {
    id,

    name:
      'Player-' +
      id.slice(0, 4),

    x:
      WORLD.w / 2 +
      rnd(-180, 180),

    y:
      WORLD.h / 2 +
      rnd(-180, 180),

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

    const me =
      players.get(id);

    if (!me) {
      return;
    }

    if (m.t === 'input') {
      me.keys =
        m.keys || {};

      me.angle =
        Number.isFinite(m.angle)
          ? m.angle
          : me.angle;

      me.boost =
        !!m.boost;
    }

    if (m.t === 'name') {
      me.name =
        String(
          m.name ||
          'Player'
        ).slice(0, 16);
    }

    if (m.t === 'shoot') {
      const now =
        Date.now() / 1000;

      if (
        now -
          me.lastShot >=
        me.reload
      ) {
        me.lastShot = now;

        bullets.push({
          id:
            'b' +
            Math.random(),

          owner: id,

          x:
            me.x +
            Math.cos(me.angle) *
              44,

          y:
            me.y +
            Math.sin(me.angle) *
              44,

          vx:
            Math.cos(me.angle) *
            650,

          vy:
            Math.sin(me.angle) *
            650,

          r: 6,
          life: 1.8,

          damage:
            me.damage,

          enemy: false,

          effect: false
        });
      }
    }

    /*
    Q = 수류탄
    */
    if (
      m.t === 'bomb' &&
      me.bombs > 0
    ) {
      me.bombs--;

      grenades.push({
        id:
          'g' +
          Math.random(),

        owner: id,

        x:
          me.x +
          Math.cos(me.angle) *
            34,

        y:
          me.y +
          Math.sin(me.angle) *
            34,

        vx:
          Math.cos(me.angle) *
          520,

        vy:
          Math.sin(me.angle) *
          520,

        /*
        약 0.7초 뒤 폭발
        */
        life: 0.72
      });
    }

    if (
      m.t === 'potion' &&
      me.potions > 0 &&
      (
        me.hp <
          me.maxHp ||
        me.energy < 100
      )
    ) {
      me.potions--;

      me.hp =
        Math.min(
          me.maxHp,
          me.hp + 55
        );

      me.energy =
        Math.min(
          100,
          me.energy + 65
        );
    }
  });

  ws.on('close', () => {
    players.delete(id);
  });
});

/* =========================
   NEAREST PLAYER
========================= */

function nearestHuman(entity) {
  let best = null;
  let bestDistance =
    Infinity;

  for (
    const p of players.values()
  ) {
    const d =
      dist(entity, p);

    if (
      d <
      bestDistance
    ) {
      bestDistance = d;
      best = p;
    }
  }

  return [
    best,
    bestDistance
  ];
}

/* =========================
   GRENADE EXPLOSION
========================= */

function grenadeExplosionVisual(x, y, owner) {
  /*
  index.html 수정 없이도
  폭발 느낌이 보이도록
  데미지 0짜리 작은 파편을 퍼뜨림
  */

  const pieces = 18;

  for (
    let i = 0;
    i < pieces;
    i++
  ) {
    const angle =
      (
        Math.PI *
        2 *
        i
      ) /
      pieces;

    bullets.push({
      id:
        'fx' +
        Math.random(),

      owner,

      x,
      y,

      vx:
        Math.cos(angle) *
        330,

      vy:
        Math.sin(angle) *
        330,

      r: 5,

      life: 0.22,

      damage: 0,

      enemy: false,

      effect: true
    });
  }
}

/* =========================
   MAIN GAME LOOP
========================= */

function tick() {
  const dt = 0.05;

  const now =
    Date.now() / 1000;

  /* -------------------------
     PLAYERS
  ------------------------- */

  for (
    const p of players.values()
  ) {
    let dx =
      (p.keys.d ? 1 : 0) -
      (p.keys.a ? 1 : 0);

    let dy =
      (p.keys.s ? 1 : 0) -
      (p.keys.w ? 1 : 0);

    const len =
      Math.hypot(dx, dy) || 1;

    dx /= len;
    dy /= len;

    const boosting =
      p.boost &&
      p.energy > 0;

    if (boosting) {
      /*
      약 3초 사용하면
      에너지 100 → 0
      */
      p.energy =
        Math.max(
          0,
          p.energy -
            (100 / 3) * dt
        );
    } else {
      p.energy =
        Math.min(
          100,
          p.energy +
            10 * dt
        );
    }

    const speed =
      p.speed *
      (
        boosting
          ? 1.65
          : 1
      );

    p.x =
      clamp(
        p.x +
          dx *
            speed *
            dt,

        p.r,
        WORLD.w - p.r
      );

    p.y =
      clamp(
        p.y +
          dy *
            speed *
            dt,

        p.r,
        WORLD.h - p.r
      );

    /* 아이템 줍기 */

    for (
      let i =
        pickups.length - 1;
      i >= 0;
      i--
    ) {
      const q =
        pickups[i];

      if (
        Math.hypot(
          p.x - q.x,
          p.y - q.y
        ) <
        p.r + 18
      ) {
        if (
          q.kind === 'coin'
        ) {
          p.coins++;
        }

        if (
          q.kind === 'bomb'
        ) {
          p.bombs++;
        }

        if (
          q.kind ===
          'potion'
        ) {
          p.potions++;
        }

        pickups.splice(
          i,
          1
        );
      }
    }
  }

  /* -------------------------
     BOTS
  ------------------------- */

  /*
  핵심:
  한 플레이어한테 동시에
  달려들 수 있는 봇은 1마리만.
  */
  const claimedPlayers =
    new Set();

  for (
    const bot of bots.values()
  ) {
    let chosenPlayer = null;
    let chosenDistance =
      Infinity;

    /*
    아직 다른 봇이 추격하지 않는
    플레이어만 찾는다.
    */
    for (
      const p of players.values()
    ) {
      if (
        claimedPlayers.has(
          p.id
        )
      ) {
        continue;
      }

      const d =
        dist(bot, p);

      if (
        d <
        chosenDistance
      ) {
        chosenDistance = d;
        chosenPlayer = p;
      }
    }

    /*
    가까이 330 이내로
    우연히 만났을 때만 공격
    */
    const AGGRO_RANGE = 330;

    if (
      chosenPlayer &&
      chosenDistance <
        AGGRO_RANGE
    ) {
      claimedPlayers.add(
        chosenPlayer.id
      );

      bot.angle =
        Math.atan2(
          chosenPlayer.y -
            bot.y,

          chosenPlayer.x -
            bot.x
        );

      /*
      너무 가까워지지 않고
      어느 정도 거리를 유지
      */
      if (
        chosenDistance >
        180
      ) {
        bot.x +=
          Math.cos(
            bot.angle
          ) *
          bot.speed *
          dt;

        bot.y +=
          Math.sin(
            bot.angle
          ) *
          bot.speed *
          dt;
      } else {
        /*
        가까우면 옆으로 천천히 움직임
        */
        bot.x +=
          Math.cos(
            bot.angle +
            Math.PI /
              2 *
              bot.strafe
          ) *
          bot.speed *
          0.35 *
          dt;

        bot.y +=
          Math.sin(
            bot.angle +
            Math.PI /
              2 *
              bot.strafe
          ) *
          bot.speed *
          0.35 *
          dt;
      }

      /*
      봇 연사 매우 느리게
      1.4~1.7초에 한 발
      */
      if (
        chosenDistance < 420 &&
        now -
          bot.lastShot >=
          bot.reload
      ) {
        bot.lastShot = now;

        bullets.push({
          id:
            'bb' +
            Math.random(),

          owner:
            bot.id,

          x:
            bot.x +
            Math.cos(
              bot.angle
            ) *
              38,

          y:
            bot.y +
            Math.sin(
              bot.angle
            ) *
              38,

          vx:
            Math.cos(
              bot.angle
            ) *
            390,

          vy:
            Math.sin(
              bot.angle
            ) *
            390,

          r: 6,

          life: 1.45,

          damage:
            bot.damage,

          enemy: true,

          effect: false
        });
      }
    } else {
      /*
      플레이어를 못 만나면
      그냥 천천히 맵을 돌아다님
      */

      bot.wanderTimer -=
        dt;

      if (
        bot.wanderTimer <=
        0
      ) {
        bot.wanderTimer =
          rnd(
            1.2,
            3.0
          );

        bot.wanderAngle +=
          rnd(
            -1.0,
            1.0
          );
      }

      bot.angle =
        bot.wanderAngle;

      bot.x +=
        Math.cos(
          bot.wanderAngle
        ) *
        bot.speed *
        0.28 *
        dt;

      bot.y +=
        Math.sin(
          bot.wanderAngle
        ) *
        bot.speed *
        0.28 *
        dt;

      if (
        bot.x < 80 ||
        bot.x >
          WORLD.w - 80
      ) {
        bot.wanderAngle =
          Math.PI -
          bot.wanderAngle;

        bot.x =
          clamp(
            bot.x,
            80,
            WORLD.w - 80
          );
      }

      if (
        bot.y < 80 ||
        bot.y >
          WORLD.h - 80
      ) {
        bot.wanderAngle =
          -bot.wanderAngle;

        bot.y =
          clamp(
            bot.y,
            80,
            WORLD.h - 80
          );
      }
    }

    bot.x =
      clamp(
        bot.x,
        bot.r,
        WORLD.w -
          bot.r
      );

    bot.y =
      clamp(
        bot.y,
        bot.r,
        WORLD.h -
          bot.r
      );
  }

  /* -------------------------
     WILDS
  ------------------------- */

  for (
    const wild of wilds.values()
  ) {
    const [
      target,
      d
    ] =
      nearestHuman(wild);

    if (
      target &&
      wild.type ===
        'crawler' &&
      d < 260
    ) {
      wild.angle =
        Math.atan2(
          target.y -
            wild.y,

          target.x -
            wild.x
        );

      wild.x +=
        Math.cos(
          wild.angle
        ) *
        wild.speed *
        1.15 *
        dt;

      wild.y +=
        Math.sin(
          wild.angle
        ) *
        wild.speed *
        1.15 *
        dt;
    } else if (
      target &&
      wild.type ===
        'orb' &&
      d < 220
    ) {
      wild.angle =
        Math.atan2(
          target.y -
            wild.y,

          target.x -
            wild.x
        ) +
        Math.PI;

      wild.x +=
        Math.cos(
          wild.angle
        ) *
        wild.speed *
        dt;

      wild.y +=
        Math.sin(
          wild.angle
        ) *
        wild.speed *
        dt;
    } else {
      wild.turn -=
        dt;

      if (
        wild.turn <=
        0
      ) {
        wild.turn =
          rnd(
            0.6,
            1.6
          );

        wild.angle +=
          rnd(
            -1.6,
            1.6
          );
      }

      wild.x +=
        Math.cos(
          wild.angle
        ) *
        wild.speed *
        0.5 *
        dt;

      wild.y +=
        Math.sin(
          wild.angle
        ) *
        wild.speed *
        0.5 *
        dt;
    }

    wild.x =
      clamp(
        wild.x,
        wild.r,
        WORLD.w -
          wild.r
      );

    wild.y =
      clamp(
        wild.y,
        wild.r,
        WORLD.h -
          wild.r
      );
  }

  /* -------------------------
     BULLETS
  ------------------------- */

  for (
    let i =
      bullets.length - 1;
    i >= 0;
    i--
  ) {
    const b =
      bullets[i];

    b.x +=
      b.vx * dt;

    b.y +=
      b.vy * dt;

    b.life -=
      dt;

    /*
    폭발 이펙트용 파편은
    실제 충돌 판정 안 함
    */
    if (b.effect) {
      if (
        b.life <= 0
      ) {
        bullets.splice(
          i,
          1
        );
      }

      continue;
    }

    let remove =
      b.life <= 0 ||
      b.x < 0 ||
      b.x > WORLD.w ||
      b.y < 0 ||
      b.y > WORLD.h;

    if (!remove) {
      /*
      다른 실제 플레이어 공격
      */
      for (
        const p of players.values()
      ) {
        if (
          p.id === b.owner
        ) {
          continue;
        }

        if (
          Math.hypot(
            p.x - b.x,
            p.y - b.y
          ) <
          p.r + b.r
        ) {
          p.hp -=
            b.damage;

          remove = true;

          if (
            p.hp <= 0
          ) {
            drop20(
              p.x,
              p.y,
              p
            );

            const killer =
              players.get(
                b.owner
              );

            if (killer) {
              killer.score +=
                100;
            }

            respawnPlayer(
              p
            );
          }

          break;
        }
      }
    }

    /*
    플레이어 총알만
    봇/야생 공격 가능
    */
    if (
      !remove &&
      !b.enemy
    ) {
      for (
        const [
          id,
          bot
        ] of bots
      ) {
        if (
          Math.hypot(
            bot.x -
              b.x,

            bot.y -
              b.y
          ) <
          bot.r +
            b.r
        ) {
          bot.hp -=
            b.damage;

          remove = true;

          if (
            bot.hp <= 0
          ) {
            drop20(
              bot.x,
              bot.y,
              bot.inv
            );

            bots.delete(
              id
            );

            const killer =
              players.get(
                b.owner
              );

            if (killer) {
              killer.score +=
                70;
            }

            setTimeout(
              spawnBot,
              1200
            );
          }

          break;
        }
      }

      if (!remove) {
        for (
          const [
            id,
            wild
          ] of wilds
        ) {
          if (
            Math.hypot(
              wild.x -
                b.x,

              wild.y -
                b.y
            ) <
            wild.r +
              b.r
          ) {
            wild.hp -=
              b.damage;

            remove = true;

            if (
              wild.hp <=
              0
            ) {
              dropWild(
                wild.x,
                wild.y,
                wild.inv
              );

              wilds.delete(
                id
              );

              const killer =
                players.get(
                  b.owner
                );

              if (killer) {
                killer.score +=
                  30;
              }

              setTimeout(
                spawnWild,
                900
              );
            }

            break;
          }
        }
      }
    }

    if (remove) {
      bullets.splice(
        i,
        1
      );
    }
  }

  /* -------------------------
     GRENADES
  ------------------------- */

  for (
    let i =
      grenades.length - 1;
    i >= 0;
    i--
  ) {
    const g =
      grenades[i];

    /*
    앞으로 날아감
    */
    g.x +=
      g.vx * dt;

    g.y +=
      g.vy * dt;

    /*
    수류탄 느낌으로
    점점 속도가 줄어듦
    */
    g.vx *= 0.95;
    g.vy *= 0.95;

    g.life -=
      dt;

    if (
      g.life <= 0
    ) {
      /*
      폭발 이펙트
      */
      grenadeExplosionVisual(
        g.x,
        g.y,
        g.owner
      );

      const EXPLOSION_RADIUS =
        150;

      const GRENADE_DAMAGE =
        30;

      /* 실제 플레이어 */

      for (
        const p of players.values()
      ) {
        if (
          p.id === g.owner
        ) {
          continue;
        }

        const d =
          Math.hypot(
            p.x - g.x,
            p.y - g.y
          );

        if (
          d <
          EXPLOSION_RADIUS
        ) {
          p.hp -=
            GRENADE_DAMAGE;

          if (
            p.hp <= 0
          ) {
            drop20(
              p.x,
              p.y,
              p
            );

            const killer =
              players.get(
                g.owner
              );

            if (killer) {
              killer.score +=
                100;
            }

            respawnPlayer(
              p
            );
          }
        }
      }

      /* 봇 */

      for (
        const [
          id,
          bot
        ] of bots
      ) {
        const d =
          Math.hypot(
            bot.x - g.x,
            bot.y - g.y
          );

        if (
          d <
          EXPLOSION_RADIUS
        ) {
          bot.hp -=
            GRENADE_DAMAGE;

          if (
            bot.hp <= 0
          ) {
            drop20(
              bot.x,
              bot.y,
              bot.inv
            );

            bots.delete(
              id
            );

            const killer =
              players.get(
                g.owner
              );

            if (killer) {
              killer.score +=
                70;
            }

            setTimeout(
              spawnBot,
              1200
            );
          }
        }
      }

      /* 야생 개체 */

      for (
        const [
          id,
          wild
        ] of wilds
      ) {
        const d =
          Math.hypot(
            wild.x - g.x,
            wild.y - g.y
          );

        if (
          d <
          EXPLOSION_RADIUS
        ) {
          wild.hp -=
            GRENADE_DAMAGE;

          if (
            wild.hp <= 0
          ) {
            dropWild(
              wild.x,
              wild.y,
              wild.inv
            );

            wilds.delete(
              id
            );

            const killer =
              players.get(
                g.owner
              );

            if (killer) {
              killer.score +=
                30;
            }

            setTimeout(
              spawnWild,
              900
            );
          }
        }
      }

      /*
      폭탄 제거
      */
      grenades.splice(
        i,
        1
      );
    }
  }

  /*
  필드 아이템 수 유지
  */
  while (
    pickups.length < 28
  ) {
    spawnPickup();
  }

  /*
  모든 접속자에게
  현재 게임 상태 전송
  */
  const state =
    serialize();

  for (
    const ws of wss.clients
  ) {
    if (
      ws.readyState === 1
    ) {
      ws.send(state);
    }
  }
}

/*
20 tick/sec
*/
setInterval(
  tick,
  50
);

/* =========================
   START SERVER
========================= */

const PORT =
  process.env.PORT ||
  3000;

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `DRONE.IO v7.3 running: http://localhost:${PORT}`
    );
  }
);
