const express=require('express');
const http=require('http');
const {WebSocketServer}=require('ws');
const path=require('path');
const crypto=require('crypto');

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
app.use(express.static(__dirname));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

const WORLD={w:2800,h:1800};
const players=new Map(),bots=new Map(),wilds=new Map();
const bullets=[],grenades=[],pickups=[];
let botSeq=1,wildSeq=1,pickupSeq=1;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const d2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

const DROP={coinWeight:0.03,potionWeight:0.48075,bombWeight:0.48075,laserWeight:0.0085};
const MAX_ITEMS=5, MAX_LEVEL=30, MAX_STAT=10;

function levelNeed(level){return Math.max(35,Math.round((80+level*45)/3));}
function applyLevelStats(p){
  p.damage=24+(p.stats.attack-1)*3;
  p.reload=Math.max(.16,.34-(p.stats.fireRate-1)*.018);
  p.speed=230+(p.stats.speed-1)*10;
  p.maxHp=100+(p.stats.hp-1)*15;
  p.hp=Math.min(p.hp,p.maxHp);
  p.form=Math.min(7,1+Math.floor(p.level/5));
}
function gainXP(p,amount){
  if(!p||p.level>=MAX_LEVEL)return;
  p.xp+=Math.max(1,Math.round(amount));
  while(p.level<MAX_LEVEL&&p.xp>=p.nextXp){
    p.xp-=p.nextXp;p.level++;p.statPoints+=3;p.nextXp=levelNeed(p.level);applyLevelStats(p);
  }
  if(p.level>=MAX_LEVEL){p.level=MAX_LEVEL;p.xp=0;p.nextXp=0;}
}
function killXP(victim,kind){
  if(kind==='player') return 120+(victim.level||1)*28+Math.floor((victim.xp||0)*.35);
  if(kind==='bot') return 55+(victim.level||1)*10;
  return victim.type==='crawler'?26:18;
}

function botInv(){return {coins:Math.floor(rnd(0,10)),bombs:Math.floor(rnd(1,5)),potions:Math.floor(rnd(1,5)),lasers:Math.random()<.6?1:0};}
function safeBotSpawn(){
  for(let n=0;n<60;n++){
    const x=rnd(100,WORLD.w-100),y=rnd(100,WORLD.h-100);
    if([...bots.values()].every(b=>Math.hypot(b.x-x,b.y-y)>430)&&Math.hypot(x-WORLD.w/2,y-WORLD.h/2)>520)return{x,y};
  }
  return{x:rnd(100,WORLD.w-100),y:rnd(100,WORLD.h-100)};
}
function spawnBot(){
  const id='bot'+botSeq++,pos=safeBotSpawn();
  bots.set(id,{id,name:'BOT-'+id.slice(3),x:pos.x,y:pos.y,angle:rnd(0,Math.PI*2),r:22,hp:75,maxHp:75,speed:rnd(195,225),damage:9,reload:rnd(.97,1.20),lastShot:0,inv:botInv(),score:0,level:Math.ceil(rnd(1,4)),xp:0,strafe:Math.random()<.5?-1:1,wanderAngle:rnd(0,Math.PI*2),wanderTimer:rnd(1.2,3)});
}
function spawnWild(){
  const id='wild'+wildSeq++,type=Math.random()<.65?'crawler':'orb',hp=type==='crawler'?64:40;
  wilds.set(id,{id,type,x:rnd(70,WORLD.w-70),y:rnd(70,WORLD.h-70),angle:rnd(0,Math.PI*2),r:type==='crawler'?20:15,hp,maxHp:hp,speed:type==='crawler'?rnd(30,50):rnd(55,85),turn:rnd(.6,1.7),inv:{coins:Math.floor(rnd(0,4)),bombs:Math.random()<.70?1:0,potions:Math.random()<.80?1:0,lasers:Math.random()<.011?1:0}});
}
function randomPickupKind(){
  const r=Math.random();
  if(r<DROP.coinWeight)return'coin';
  if(r<DROP.coinWeight+DROP.potionWeight)return'potion';
  if(r<DROP.coinWeight+DROP.potionWeight+DROP.bombWeight)return'bomb';
  return'laser';
}
function spawnPickup(kind=null,x=null,y=null){
  const p={id:'p'+pickupSeq++,kind:kind||randomPickupKind(),x:x??rnd(70,WORLD.w-70),y:y??rnd(70,WORLD.h-70),life:10};pickups.push(p);return p;
}

for(let i=0;i<6;i++)spawnBot();
for(let i=0;i<150;i++)spawnWild();
for(let i=0;i<34;i++)spawnPickup();

function dropFraction(x,y,inv,f=.2){
  const out=[];
  const add=(kind,n)=>{for(let i=0;i<n;i++)out.push(kind)};
  add('coin',Math.floor((inv.coins||0)*f*.1)); // 돈은 기존 대비 1/10
  add('bomb',Math.max(0,Math.floor((inv.bombs||0)*f*5)));
  add('potion',Math.max(0,Math.floor((inv.potions||0)*f*5)));
  if(inv.laserOwned&&Math.random()<.01)out.push('laser');
  out.slice(0,22).forEach(k=>spawnPickup(k,x+rnd(-36,36),y+rnd(-36,36)));
}
function dropWild(x,y,inv){
  // 야생은 아이템 드랍을 높임. 돈은 적고 폭탄/포션 중심.
  if(Math.random()<.18)spawnPickup('coin',x+rnd(-24,24),y+rnd(-24,24));
  const bombs=1+(Math.random()<.55?1:0)+(inv.bombs||0);
  const pots=1+(Math.random()<.65?1:0)+(inv.potions||0);
  for(let i=0;i<bombs;i++)spawnPickup('bomb',x+rnd(-30,30),y+rnd(-30,30));
  for(let i=0;i<pots;i++)spawnPickup('potion',x+rnd(-30,30),y+rnd(-30,30));
  if(Math.random()<.009)spawnPickup('laser',x+rnd(-30,30),y+rnd(-30,30));
}

function respawn(p){
  p.x=WORLD.w/2+rnd(-260,260);p.y=WORLD.h/2+rnd(-210,210);p.stats={attack:1,fireRate:1,speed:1,hp:1};p.statPoints=0;p.hp=100;p.maxHp=100;p.energy=100;p.level=1;p.xp=0;p.nextXp=levelNeed(1);p.score=0;p.alive=true;p.keys={};p.boost=false;applyLevelStats(p);
}
function playerSocket(id){for(const ws of wss.clients)if(ws.pid===id)return ws;return null;}
function diePlayer(p,killerId){
  if(!p.alive)return;
  const killer=players.get(killerId);if(killer&&killer.alive){gainXP(killer,killXP(p,'player'));killer.score+=100;}
  dropFraction(p.x,p.y,p,.2);p.alive=false;p.hp=0;p.keys={};p.boost=false;
  send(playerSocket(p.id),{t:'dead',stats:{level:p.level,score:p.score,coins:p.coins,bombs:p.bombs,potions:p.potions,laserOwned:p.laserOwned}});
}

function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj));}
function serialize(){
  return JSON.stringify({t:'state',world:WORLD,players:[...players.values()].filter(p=>p.alive).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,energy:p.energy,level:p.level,xp:p.xp,nextXp:p.nextXp,form:p.form,score:p.score,bombs:p.bombs,potions:p.potions,coins:p.coins,laserOwned:p.laserOwned,laserActive:p.laserOwned,statPoints:p.statPoints,stats:p.stats})),bots:[...bots.values()],wilds:[...wilds.values()],bullets,pickups,grenades});
}

wss.on('connection',ws=>{
  const id=crypto.randomBytes(5).toString('hex');
  const p={id,name:'Player-'+id.slice(0,4),x:WORLD.w/2+rnd(-250,250),y:WORLD.h/2+rnd(-200,200),angle:0,r:24,hp:100,maxHp:100,energy:100,level:1,xp:0,nextXp:levelNeed(1),form:1,score:0,damage:24,reload:.34,speed:230,lastShot:0,bombs:0,potions:0,coins:0,laserOwned:false,statPoints:0,stats:{attack:1,fireRate:1,speed:1,hp:1},keys:{},boost:false,alive:true};
  players.set(id,p);ws.pid=id;send(ws,{t:'welcome',id,world:WORLD});
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    const me=players.get(id);if(!me)return;
    if(m.t==='name'){me.name=String(m.name||'Player').slice(0,16);return;}
    if(m.t==='respawn'){if(!me.alive){respawn(me);send(ws,{t:'respawned'});}return;}
    if(!me.alive)return;
    if(m.t==='input'){me.keys=m.keys||{};me.angle=Number.isFinite(m.angle)?m.angle:me.angle;me.boost=!!m.boost;}
    if(m.t==='shoot'){
      const now=Date.now()/1000;if(now-me.lastShot<me.reload)return;me.lastShot=now;
      const spreadMap={1:[0],2:[-.055,.055],3:[-.09,0,.09],4:[-.12,-.04,.04,.12],5:[-.15,-.075,0,.075,.15],6:[-.18,-.108,-.036,.036,.108,.18],7:[-.21,-.14,-.07,0,.07,.14,.21]};const spreads=spreadMap[me.form]||spreadMap[7];
      for(const s of spreads){const a=me.angle+s;bullets.push({id:'b'+Math.random(),owner:id,x:me.x+Math.cos(a)*44,y:me.y+Math.sin(a)*44,vx:Math.cos(a)*650,vy:Math.sin(a)*650,r:6,life:1.8,damage:me.damage,enemy:false,effect:false});}
    }
    if(m.t==='bomb'&&me.bombs>0){me.bombs--;grenades.push({id:'g'+Math.random(),owner:id,x:me.x+Math.cos(me.angle)*32,y:me.y+Math.sin(me.angle)*32,vx:Math.cos(me.angle)*520,vy:Math.sin(me.angle)*520,life:.72});}
    if(m.t==='potion'&&me.potions>0&&(me.hp<me.maxHp||me.energy<100)){me.potions--;me.hp=Math.min(me.maxHp,me.hp+55);me.energy=Math.min(100,me.energy+65);}
    if(m.t==='laser'){/* laser is permanent once picked up; no consumable action needed */}
    if(m.t==='stat'&&me.statPoints>0&&['attack','fireRate','speed','hp'].includes(m.stat)&&me.stats[m.stat]<MAX_STAT){
      const oldMax=me.maxHp;me.stats[m.stat]++;me.statPoints--;applyLevelStats(me);if(m.stat==='hp')me.hp=Math.min(me.maxHp,me.hp+(me.maxHp-oldMax));
    }
  });
  ws.on('close',()=>players.delete(id));
});

function nearestHuman(e,skipClaimed=null){let best=null,bd=Infinity;for(const p of players.values()){if(!p.alive)continue;if(skipClaimed&&skipClaimed.has(p.id))continue;const d=d2(e,p);if(d<bd){best=p;bd=d}}return[best,bd];}
function grenadeFx(x,y,owner){for(let i=0;i<16;i++){const a=i*Math.PI*2/16;bullets.push({id:'fx'+Math.random(),owner,x,y,vx:Math.cos(a)*300,vy:Math.sin(a)*300,r:4,life:.22,damage:0,enemy:false,effect:true});}}

function tick(){
  const dt=.05,now=Date.now()/1000;

  // 필드 아이템은 생성 후 10초가 지나면 자동 삭제
  for(let i=pickups.length-1;i>=0;i--){
    pickups[i].life-=dt;
    if(pickups[i].life<=0)pickups.splice(i,1);
  }
  for(const p of players.values()){
    if(!p.alive)continue;
    let dx=(p.keys.d?1:0)-(p.keys.a?1:0),dy=(p.keys.s?1:0)-(p.keys.w?1:0),l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
    const boost=p.boost&&p.energy>0;if(boost)p.energy=Math.max(0,p.energy-(100/3)*dt);else p.energy=Math.min(100,p.energy+10*dt);
    const sp=p.speed*(boost?1.65:1);p.x=clamp(p.x+dx*sp*dt,p.r,WORLD.w-p.r);p.y=clamp(p.y+dy*sp*dt,p.r,WORLD.h-p.r);
    for(let i=pickups.length-1;i>=0;i--){const q=pickups[i];if(Math.hypot(p.x-q.x,p.y-q.y)<p.r+18){let taken=false;if(q.kind==='coin'){p.coins++;taken=true}else if(q.kind==='bomb'&&p.bombs<MAX_ITEMS){p.bombs++;taken=true}else if(q.kind==='potion'&&p.potions<MAX_ITEMS){p.potions++;taken=true}else if(q.kind==='laser'&&!p.laserOwned){p.laserOwned=true;taken=true}if(taken)pickups.splice(i,1);}}
  }

  // 봇: 약하지만 가까이 만나면 적극적. 한 플레이어에 최대 1마리만 붙음.
  const claimed=new Set();
  for(const b of bots.values()){
    const[target,d]=nearestHuman(b,claimed),aggro=300;
    if(target&&d<aggro){claimed.add(target.id);b.angle=Math.atan2(target.y-b.y,target.x-b.x);if(d>185){b.x+=Math.cos(b.angle)*b.speed*dt;b.y+=Math.sin(b.angle)*b.speed*dt}else{b.x+=Math.cos(b.angle+Math.PI/2*b.strafe)*b.speed*.3*dt;b.y+=Math.sin(b.angle+Math.PI/2*b.strafe)*b.speed*.3*dt}
      if(d<380&&now-b.lastShot>=b.reload){b.lastShot=now;bullets.push({id:'bb'+Math.random(),owner:b.id,x:b.x+Math.cos(b.angle)*38,y:b.y+Math.sin(b.angle)*38,vx:Math.cos(b.angle)*360,vy:Math.sin(b.angle)*360,r:6,life:1.35,damage:b.damage,enemy:true,effect:false});}
    }else{b.wanderTimer-=dt;if(b.wanderTimer<=0){b.wanderTimer=rnd(1.2,3);b.wanderAngle+=rnd(-1,1)}b.angle=b.wanderAngle;b.x+=Math.cos(b.angle)*b.speed*.25*dt;b.y+=Math.sin(b.angle)*b.speed*.25*dt;}
    b.x=clamp(b.x,b.r,WORLD.w-b.r);b.y=clamp(b.y,b.r,WORLD.h-b.r);
  }

  for(const w of wilds.values()){
    const[target,d]=nearestHuman(w);if(target&&w.type==='crawler'&&d<220){w.angle=Math.atan2(target.y-w.y,target.x-w.x);w.x+=Math.cos(w.angle)*w.speed*dt;w.y+=Math.sin(w.angle)*w.speed*dt}else if(target&&w.type==='orb'&&d<170){w.angle=Math.atan2(target.y-w.y,target.x-w.x)+Math.PI;w.x+=Math.cos(w.angle)*w.speed*dt;w.y+=Math.sin(w.angle)*w.speed*dt}else{w.turn-=dt;if(w.turn<=0){w.turn=rnd(.6,1.7);w.angle+=rnd(-1.4,1.4)}w.x+=Math.cos(w.angle)*w.speed*.5*dt;w.y+=Math.sin(w.angle)*w.speed*.5*dt}w.x=clamp(w.x,w.r,WORLD.w-w.r);w.y=clamp(w.y,w.r,WORLD.h-w.r);
  }

  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.effect){if(b.life<=0)bullets.splice(i,1);continue;}let rm=b.life<=0||b.x<0||b.x>WORLD.w||b.y<0||b.y>WORLD.h;
    if(!rm)for(const p of players.values()){if(p.id===b.owner)continue;if(Math.hypot(p.x-b.x,p.y-b.y)<p.r+b.r){p.hp-=b.damage;rm=true;if(p.hp<=0){diePlayer(p,b.owner);}break}}
    if(!rm&&!b.enemy){
      for(const[id,e]of bots){if(Math.hypot(e.x-b.x,e.y-b.y)<e.r+b.r){e.hp-=b.damage;rm=true;if(e.hp<=0){const k=players.get(b.owner);if(k){gainXP(k,killXP(e,'bot'));k.score+=70;}dropFraction(e.x,e.y,e.inv,.2);bots.delete(id);setTimeout(spawnBot,1200);}break}}
      if(!rm)for(const[id,w]of wilds){if(Math.hypot(w.x-b.x,w.y-b.y)<w.r+b.r){w.hp-=b.damage;rm=true;if(w.hp<=0){const k=players.get(b.owner);if(k){gainXP(k,killXP(w,'wild'));k.score+=30;}dropWild(w.x,w.y,w.inv);wilds.delete(id);setTimeout(spawnWild,500);}break}}
    }
    if(rm)bullets.splice(i,1);
  }

  for(let i=grenades.length-1;i>=0;i--){const g=grenades[i];g.x+=g.vx*dt;g.y+=g.vy*dt;g.vx*=.95;g.vy*=.95;g.life-=dt;if(g.life>0)continue;grenadeFx(g.x,g.y,g.owner);const R=150,D=30;
    for(const p of players.values()){if(p.id===g.owner||d2(p,g)>=R)continue;p.hp-=D;if(p.hp<=0){diePlayer(p,g.owner)}}
    for(const[id,e]of [...bots]){if(d2(e,g)>=R)continue;e.hp-=D;if(e.hp<=0){const k=players.get(g.owner);if(k){gainXP(k,killXP(e,'bot'));k.score+=70;}dropFraction(e.x,e.y,e.inv,.2);bots.delete(id);setTimeout(spawnBot,1200)}}
    for(const[id,w]of [...wilds]){if(d2(w,g)>=R)continue;w.hp-=D;if(w.hp<=0){const k=players.get(g.owner);if(k){gainXP(k,killXP(w,'wild'));k.score+=30;}dropWild(w.x,w.y,w.inv);wilds.delete(id);setTimeout(spawnWild,500)}}
    grenades.splice(i,1);
  }
  while(wilds.size<150)spawnWild();
  while(pickups.length<34)spawnPickup();
  const s=serialize();for(const ws of wss.clients)if(ws.readyState===1)ws.send(s);
}
setInterval(tick,50);

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`DRONE.IO v7.4 running: http://localhost:${PORT}`));
