<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>DRONE.IO v7.4</title>

<style>
html,body{
  margin:0;
  width:100%;
  height:100%;
  overflow:hidden;
  background:#d8dadd;
  font-family:Arial,sans-serif;
}

canvas{
  display:block;
  width:100%;
  height:100%;
}

#hud{
  position:fixed;
  left:18px;
  top:18px;
  background:rgba(20,24,30,.78);
  color:white;
  padding:12px 14px;
  border-radius:10px;
  font-size:14px;
  min-width:220px;
  pointer-events:none;
}

.bar{
  height:10px;
  background:#333;
  border-radius:6px;
  overflow:hidden;
  margin-top:4px;
  margin-bottom:8px;
}

.fill{
  height:100%;
}

#hpFill{background:#ef5350;}
#energyFill{background:#29b6f6;}
#xpFill{background:#ffd54f;}

#inventory{
  position:fixed;
  bottom:20px;
  left:50%;
  transform:translateX(-50%);
  display:flex;
  gap:10px;
}

.slot{
  width:82px;
  height:58px;
  border:2px solid rgba(255,255,255,.8);
  border-radius:10px;
  background:rgba(20,24,30,.82);
  color:white;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  font-size:13px;
}

.slot .icon{
  font-size:22px;
}

#minimap{
  position:fixed;
  right:18px;
  bottom:18px;
  width:200px;
  height:130px;
  border:2px solid rgba(255,255,255,.85);
  background:rgba(20,24,30,.72);
  border-radius:8px;
}

#info{
  position:fixed;
  right:18px;
  top:18px;
  background:rgba(20,24,30,.75);
  color:#fff;
  padding:10px 12px;
  border-radius:8px;
  font-size:13px;
}

#message{
  position:fixed;
  top:18px;
  left:50%;
  transform:translateX(-50%);
  background:rgba(0,0,0,.65);
  color:white;
  padding:8px 14px;
  border-radius:8px;
  opacity:0;
  transition:opacity .2s;
}
</style>
</head>

<body>

<canvas id="game"></canvas>
<canvas id="minimap" width="200" height="130"></canvas>

<div id="hud">
  <b>DRONE.IO</b>
  <div id="levelText">LEVEL 1</div>

  <div>HP</div>
  <div class="bar"><div id="hpFill" class="fill"></div></div>

  <div>BOOST</div>
  <div class="bar"><div id="energyFill" class="fill"></div></div>

  <div id="xpText">XP 0 / 100</div>
  <div class="bar"><div id="xpFill" class="fill"></div></div>

  <div>💰 <span id="coinText">0</span></div>
</div>

<div id="info">
  WASD : 이동<br>
  Mouse : 조준<br>
  Click : 발사<br>
  SPACE : 부스트<br>
  Q : 폭탄<br>
  E : 포션<br>
  R : 레이저 조준기
</div>

<div id="inventory">

  <div class="slot">
    <div class="icon">💣</div>
    Q 폭탄
    <span id="bombText">0</span>
  </div>

  <div class="slot">
    <div class="icon">🧪</div>
    E 포션
    <span id="potionText">0</span>
  </div>

  <div class="slot">
    <div class="icon">🔴</div>
    R 레이저
    <span id="laserText">0</span>
  </div>

</div>

<div id="message"></div>

<script>

const canvas =
  document.getElementById("game");

const ctx =
  canvas.getContext("2d");

const minimap =
  document.getElementById("minimap");

const mctx =
  minimap.getContext("2d");

function resize(){
  canvas.width =
    window.innerWidth;

  canvas.height =
    window.innerHeight;
}

window.addEventListener(
  "resize",
  resize
);

resize();

/* =====================
   NETWORK
===================== */

const protocol =
  location.protocol ===
  "https:"
  ? "wss:"
  : "ws:";

const ws =
  new WebSocket(
    protocol +
    "//" +
    location.host
  );

let myId = null;

let world = {
  w:2800,
  h:1800
};

let state = {
  players:[],
  bots:[],
  wilds:[],
  bullets:[],
  grenades:[],
  pickups:[]
};

ws.onmessage = e => {

  const msg =
    JSON.parse(e.data);

  if(
    msg.t ===
    "welcome"
  ){
    myId =
      msg.id;

    if(msg.world){
      world =
        msg.world;
    }
  }

  if(
    msg.t ===
    "state"
  ){
    state =
      msg;

    if(msg.world){
      world =
        msg.world;
    }
  }

  if(
    msg.t ===
    "message"
  ){
    showMessage(
      msg.text
    );
  }
};

/* =====================
   INPUT
===================== */

const keys = {};

let mouse = {
  x:0,
  y:0
};

let shooting =
  false;

window.addEventListener(
  "keydown",
  e => {

    const key =
      e.key.toLowerCase();

    keys[key] =
      true;

    if(
      e.code ===
      "Space"
    ){
      keys.space =
        true;

      e.preventDefault();
    }

    if(
      key === "q"
    ){
      send({
        t:"bomb"
      });
    }

    if(
      key === "e"
    ){
      send({
        t:"potion"
      });
    }

    if(
      key === "r"
    ){
      send({
        t:"laser"
      });
    }
  }
);

window.addEventListener(
  "keyup",
  e => {

    const key =
      e.key.toLowerCase();

    keys[key] =
      false;

    if(
      e.code ===
      "Space"
    ){
      keys.space =
        false;
    }
  }
);

canvas.addEventListener(
  "mousemove",
  e => {

    mouse.x =
      e.clientX;

    mouse.y =
      e.clientY;
  }
);

canvas.addEventListener(
  "mousedown",
  () => {
    shooting =
      true;
  }
);

window.addEventListener(
  "mouseup",
  () => {
    shooting =
      false;
  }
);

function send(obj){

  if(
    ws.readyState ===
    WebSocket.OPEN
  ){
    ws.send(
      JSON.stringify(obj)
    );
  }
}

/* =====================
   SEND INPUT
===================== */

setInterval(
  () => {

    const me =
      getMe();

    if(!me){
      return;
    }

    const angle =
      Math.atan2(
        mouse.y -
        canvas.height/2,

        mouse.x -
        canvas.width/2
      );

    send({
      t:"input",

      keys:{
        w:!!keys.w,
        a:!!keys.a,
        s:!!keys.s,
        d:!!keys.d
      },

      angle,

      boost:
        !!keys.space
    });

    if(shooting){
      send({
        t:"shoot"
      });
    }

  },
  50
);

/* =====================
   HELPERS
===================== */

function getMe(){

  return state.players
    .find(
      p =>
      p.id === myId
    );
}

function showMessage(text){

  const box =
    document.getElementById(
      "message"
    );

  box.textContent =
    text;

  box.style.opacity =
    1;

  clearTimeout(
    showMessage.timer
  );

  showMessage.timer =
    setTimeout(
      () => {
        box.style.opacity =
          0;
      },
      1400
    );
}

/* =====================
   CAMERA
===================== */

function camera(){

  const me =
    getMe();

  if(!me){
    return {
      x:0,
      y:0
    };
  }

  return {
    x:
      me.x -
      canvas.width/2,

    y:
      me.y -
      canvas.height/2
  };
}

function screenPos(
  x,
  y,
  cam
){
  return {
    x:
      x -
      cam.x,

    y:
      y -
      cam.y
  };
}

/* =====================
   BACKGROUND
===================== */

function drawGrid(cam){

  ctx.fillStyle =
    "#d8dadd";

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const size =
    50;

  ctx.strokeStyle =
    "rgba(70,75,80,.12)";

  ctx.lineWidth =
    1;

  const startX =
    -(
      cam.x %
      size
    );

  const startY =
    -(
      cam.y %
      size
    );

  for(
    let x =
      startX;
    x <
      canvas.width;
    x += size
  ){
    ctx.beginPath();

    ctx.moveTo(
      x,
      0
    );

    ctx.lineTo(
      x,
      canvas.height
    );

    ctx.stroke();
  }

  for(
    let y =
      startY;
    y <
      canvas.height;
    y += size
  ){
    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      canvas.width,
      y
    );

    ctx.stroke();
  }

  const topLeft =
    screenPos(
      0,
      0,
      cam
    );

  ctx.strokeStyle =
    "#666";

  ctx.lineWidth =
    5;

  ctx.strokeRect(
    topLeft.x,
    topLeft.y,
    world.w,
    world.h
  );
}

/* =====================
   DRONE
===================== */

function drawDrone(
  entity,
  cam,
  color,
  isMe=false
){

  const p =
    screenPos(
      entity.x,
      entity.y,
      cam
    );

  const angle =
    entity.angle || 0;

  ctx.save();

  ctx.translate(
    p.x,
    p.y
  );

  ctx.rotate(
    angle
  );

  /*
  레벨별 외형 변화
  크기는 그대로.
  */

  const level =
    entity.level || 1;

  ctx.lineWidth =
    4;

  ctx.strokeStyle =
    "#333";

  ctx.fillStyle =
    color;

  if(level < 5){

    /* 기본 원형 코어 */

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      22,
      0,
      Math.PI*2
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#555";

    ctx.fillRect(
      10,
      -7,
      32,
      14
    );
  }

  else if(level < 10){

    /*
    Lv5
    쌍포
    */

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      22,
      0,
      Math.PI*2
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#555";

    ctx.fillRect(
      10,
      -12,
      32,
      8
    );

    ctx.fillRect(
      10,
      4,
      32,
      8
    );
  }

  else if(level < 15){

    /*
    Lv10
    육각형 코어
    */

    polygon(
      ctx,
      0,
      0,
      24,
      6
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#555";

    ctx.fillRect(
      8,
      -14,
      34,
      8
    );

    ctx.fillRect(
      12,
      -4,
      34,
      8
    );

    ctx.fillRect(
      8,
      6,
      34,
      8
    );
  }

  else{

    /*
    Lv15+
    다이아 코어
    */

    ctx.beginPath();

    ctx.moveTo(
      27,
      0
    );

    ctx.lineTo(
      0,
      24
    );

    ctx.lineTo(
      -27,
      0
    );

    ctx.lineTo(
      0,
      -24
    );

    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#444";

    ctx.fillRect(
      6,
      -16,
      40,
      7
    );

    ctx.fillRect(
      10,
      -5,
      40,
      7
    );

    ctx.fillRect(
      10,
      5,
      40,
      7
    );

    ctx.fillRect(
      6,
      12,
      40,
      7
    );
  }

  /*
  가운데 코어
  */

  ctx.beginPath();

  ctx.arc(
    0,
    0,
    6,
    0,
    Math.PI*2
  );

  ctx.fillStyle =
    isMe
    ? "#ffffff"
    : "#ddd";

  ctx.fill();

  ctx.restore();

  /* HP */

  const hpRatio =
    Math.max(
      0,
      entity.hp /
      entity.maxHp
    );

  ctx.fillStyle =
    "#333";

  ctx.fillRect(
    p.x-24,
    p.y-36,
    48,
    6
  );

  ctx.fillStyle =
    isMe
    ? "#4caf50"
    : "#ef5350";

  ctx.fillRect(
    p.x-24,
    p.y-36,
    48*hpRatio,
    6
  );

  /*
  이름/레벨
  */

  ctx.fillStyle =
    "#222";

  ctx.font =
    "12px Arial";

  ctx.textAlign =
    "center";

  ctx.fillText(
    (
      entity.name ||
      "DRONE"
    ) +
    " Lv." +
    (
      entity.level ||
      1
    ),

    p.x,
    p.y-44
  );

  /*
  레이저 조준기
  */

  if(
    entity.laserActive
  ){

    ctx.save();

    ctx.strokeStyle =
      "rgba(255,30,30,.75)";

    ctx.lineWidth =
      2;

    ctx.setLineDash([
      8,
      6
    ]);

    ctx.beginPath();

    ctx.moveTo(
      p.x +
      Math.cos(angle)*30,

      p.y +
      Math.sin(angle)*30
    );

    ctx.lineTo(
      p.x +
      Math.cos(angle)*650,

      p.y +
      Math.sin(angle)*650
    );

    ctx.stroke();

    ctx.restore();
  }
}

function polygon(
  context,
  x,
  y,
  radius,
  sides
){

  context.beginPath();

  for(
    let i=0;
    i<sides;
    i++
  ){

    const a =
      Math.PI*2 *
      i/sides;

    const px =
      x +
      Math.cos(a) *
      radius;

    const py =
      y +
      Math.sin(a) *
      radius;

    if(i===0){
      context.moveTo(
        px,
        py
      );
    }else{
      context.lineTo(
        px,
        py
      );
    }
  }

  context.closePath();
}

/* =====================
   WILD
===================== */

function drawWild(
  w,
  cam
){

  const p =
    screenPos(
      w.x,
      w.y,
      cam
    );

  ctx.save();

  ctx.translate(
    p.x,
    p.y
  );

  /*
  야생은 플레이어와
  완전히 다른 모양
  */

  if(
    w.type ===
    "crawler"
  ){

    ctx.fillStyle =
      "#795548";

    ctx.strokeStyle =
      "#4e342e";

    ctx.lineWidth =
      3;

    polygon(
      ctx,
      0,
      0,
      20,
      6
    );

    ctx.fill();
    ctx.stroke();

    /*
    작은 다리
    */

    ctx.strokeStyle =
      "#4e342e";

    for(
      let i=0;
      i<6;
      i++
    ){

      const a =
        Math.PI*2 *
        i/6;

      ctx.beginPath();

      ctx.moveTo(
        Math.cos(a)*15,
        Math.sin(a)*15
      );

      ctx.lineTo(
        Math.cos(a)*27,
        Math.sin(a)*27
      );

      ctx.stroke();
    }
  }

  else{

    /*
    에너지 오브
    */

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      16,
      0,
      Math.PI*2
    );

    ctx.fillStyle =
      "#ab47bc";

    ctx.fill();

    ctx.strokeStyle =
      "#6a1b9a";

    ctx.lineWidth =
      3;

    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      7,
      0,
      Math.PI*2
    );

    ctx.fillStyle =
      "#e1bee7
