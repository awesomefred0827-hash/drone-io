const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, 'public')));

const WORLD = { w: 2800, h: 1800 };
const players = new Map();
const bots = new Map();
const bullets = [];
const grenades = [];
const pickups = [];
const wilds = new Map();
let botSeq=1, wildSeq=1, pickupSeq=1;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function mkInv(){ return {coins:Math.floor(rnd(8,36)), bombs:Math.floor(rnd(0,4)), potions:Math.floor(rnd(0,4))}; }
function spawnBot(){
 const id='bot'+botSeq++;
 bots.set(id,{id,name:'BOT-'+id.slice(3),x:rnd(100,WORLD.w-100),y:rnd(100,WORLD.h-100),angle:0,r:22,hp:62,maxHp:62,speed:rnd(115,145),damage:8,reload:rnd(.72,.9),lastShot:0,inv:mkInv(),strafe:Math.random()<.5?-1:1,score:0});
}
function spawnWild(){
 const id='wild'+wildSeq++, type=Math.random()<.6?'crawler':'orb', hp=type==='crawler'?70:45;
 wilds.set(id,{id,type,x:rnd(100,WORLD.w-100),y:rnd(100,WORLD.h-100),angle:rnd(0,Math.PI*2),r:type==='crawler'?22:16,hp,maxHp:hp,speed:type==='crawler'?rnd(35,60):rnd(70,110),turn:rnd(.6,1.6),inv:{coins:Math.floor(rnd(3,16)),bombs:Math.random()<.35?1:0,potions:Math.random()<.45?1:0}});
}
function spawnPickup(kind=null,x=null,y=null){
 if(!kind){const r=Math.random();kind=r<.55?'coin':r<.78?'potion':'bomb'}
 const p={id:'p'+pickupSeq++,kind,x:x??rnd(80,WORLD.w-80),y:y??rnd(80,WORLD.h-80),life:9999}; pickups.push(p); return p;
}
for(let i=0;i<10;i++) spawnBot();
for(let i=0;i<12;i++) spawnWild();
for(let i=0;i<28;i++) spawnPickup();

function serialize(){
 return JSON.stringify({t:'state',world:WORLD,players:[...players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,energy:p.energy,level:p.level,score:p.score,bombs:p.bombs,potions:p.potions,coins:p.coins})),bots:[...bots.values()],wilds:[...wilds.values()],bullets,pickups,grenades});
}
function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function drop20(x,y,inv){
 const arr=[]; for(let i=0;i<Math.floor((inv.coins||0)*.2);i++)arr.push('coin'); for(let i=0;i<Math.floor((inv.bombs||0)*.2);i++)arr.push('bomb'); for(let i=0;i<Math.floor((inv.potions||0)*.2);i++)arr.push('potion');
 arr.sort(()=>Math.random()-.5).slice(0,18).forEach(k=>spawnPickup(k,x+rnd(-35,35),y+rnd(-35,35)));
}
function dropWild(x,y,inv){
 for(let i=0;i<Math.max(1,Math.ceil((inv.coins||0)/5));i++)spawnPickup('coin',x+rnd(-28,28),y+rnd(-28,28)); if(inv.bombs)spawnPickup('bomb',x+rnd(-28,28),y+rnd(-28,28)); if(inv.potions)spawnPickup('potion',x+rnd(-28,28),y+rnd(-28,28));
}
function respawnPlayer(p){ p.x=WORLD.w/2+rnd(-250,250);p.y=WORLD.h/2+rnd(-200,200);p.hp=100;p.maxHp=100;p.energy=100;p.level=1;p.score=0;p.damage=24;p.reload=.34;p.speed=230; }

wss.on('connection', ws=>{
 const id=crypto.randomBytes(5).toString('hex');
 const p={id,name:'Player-'+id.slice(0,4),x:WORLD.w/2+rnd(-250,250),y:WORLD.h/2+rnd(-200,200),angle:0,r:24,hp:100,maxHp:100,energy:100,level:1,score:0,damage:24,reload:.34,speed:230,lastShot:0,bombs:2,potions:2,coins:0,keys:{},boost:false};
 players.set(id,p); ws.pid=id; send(ws,{t:'welcome',id,world:WORLD});
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  const me=players.get(id); if(!me)return;
  if(m.t==='input'){me.keys=m.keys||{};me.angle=Number.isFinite(m.angle)?m.angle:me.angle;me.boost=!!m.boost;}
  if(m.t==='name'){me.name=String(m.name||'Player').slice(0,16);}
  if(m.t==='shoot'){ const now=Date.now()/1000; if(now-me.lastShot>=me.reload){me.lastShot=now; bullets.push({id:'b'+Math.random(),owner:id,x:me.x+Math.cos(me.angle)*44,y:me.y+Math.sin(me.angle)*44,vx:Math.cos(me.angle)*650,vy:Math.sin(me.angle)*650,r:6,life:1.8,damage:me.damage,enemy:false});} }
  if(m.t==='bomb'&&me.bombs>0){me.bombs--;grenades.push({id:'g'+Math.random(),owner:id,x:me.x+Math.cos(me.angle)*30,y:me.y+Math.sin(me.angle)*30,vx:Math.cos(me.angle)*520,vy:Math.sin(me.angle)*520,life:.72});}
  if(m.t==='potion'&&me.potions>0&&(me.hp<me.maxHp||me.energy<100)){me.potions--;me.hp=Math.min(me.maxHp,me.hp+55);me.energy=Math.min(100,me.energy+65);}
 });
 ws.on('close',()=>players.delete(id));
});

function nearestHuman(e){let best=null,bd=Infinity;for(const p of players.values()){const d=dist(e,p);if(d<bd){bd=d;best=p}}return [best,bd];}
function tick(){
 const dt=.05, now=Date.now()/1000;
 for(const p of players.values()){
  let dx=(p.keys.d?1:0)-(p.keys.a?1:0),dy=(p.keys.s?1:0)-(p.keys.w?1:0);let l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
  let boosting=p.boost&&p.energy>0;if(boosting)p.energy=Math.max(0,p.energy-(100/3)*dt);else p.energy=Math.min(100,p.energy+10*dt);
  const sp=p.speed*(boosting?1.65:1);p.x=clamp(p.x+dx*sp*dt,p.r,WORLD.w-p.r);p.y=clamp(p.y+dy*sp*dt,p.r,WORLD.h-p.r);
  for(let i=pickups.length-1;i>=0;i--){const q=pickups[i];if(Math.hypot(p.x-q.x,p.y-q.y)<p.r+18){if(q.kind==='coin')p.coins++;if(q.kind==='bomb')p.bombs++;if(q.kind==='potion')p.potions++;pickups.splice(i,1);}}
 }
 // bots: lower stats, much more aggressive
 for(const e of bots.values()){
  const [target,d]=nearestHuman(e); if(!target)continue; e.angle=Math.atan2(target.y-e.y,target.x-e.x);
  if(d>140){e.x+=Math.cos(e.angle)*e.speed*dt;e.y+=Math.sin(e.angle)*e.speed*dt}else{e.x+=Math.cos(e.angle+Math.PI/2*e.strafe)*e.speed*.8*dt;e.y+=Math.sin(e.angle+Math.PI/2*e.strafe)*e.speed*.8*dt}
  e.x=clamp(e.x,e.r,WORLD.w-e.r);e.y=clamp(e.y,e.r,WORLD.h-e.r);
  if(d<760&&now-e.lastShot>=e.reload){e.lastShot=now;bullets.push({id:'bb'+Math.random(),owner:e.id,x:e.x+Math.cos(e.angle)*38,y:e.y+Math.sin(e.angle)*38,vx:Math.cos(e.angle)*430,vy:Math.sin(e.angle)*430,r:6,life:1.8,damage:e.damage,enemy:true});}
 }
 for(const w of wilds.values()){
  const [target,d]=nearestHuman(w); if(target&&w.type==='crawler'&&d<260){w.angle=Math.atan2(target.y-w.y,target.x-w.x);w.x+=Math.cos(w.angle)*w.speed*1.15*dt;w.y+=Math.sin(w.angle)*w.speed*1.15*dt}else if(target&&w.type==='orb'&&d<220){w.angle=Math.atan2(target.y-w.y,target.x-w.x)+Math.PI;w.x+=Math.cos(w.angle)*w.speed*dt;w.y+=Math.sin(w.angle)*w.speed*dt}else{w.turn-=dt;if(w.turn<=0){w.turn=rnd(.6,1.6);w.angle+=rnd(-1.6,1.6)}w.x+=Math.cos(w.angle)*w.speed*.5*dt;w.y+=Math.sin(w.angle)*w.speed*.5*dt}
  w.x=clamp(w.x,w.r,WORLD.w-w.r);w.y=clamp(w.y,w.r,WORLD.h-w.r);
 }
 for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;let rm=b.life<=0||b.x<0||b.x>WORLD.w||b.y<0||b.y>WORLD.h;
  if(!rm){
   // hit players except owner
   for(const p of players.values()){if(p.id===b.owner)continue;if(Math.hypot(p.x-b.x,p.y-b.y)<p.r+b.r){p.hp-=b.damage;rm=true;if(p.hp<=0){drop20(p.x,p.y,p);const killer=players.get(b.owner);if(killer)killer.score+=100;respawnPlayer(p);}break}}
  }
  if(!rm&&!b.enemy){
   for(const [id,e] of bots){if(Math.hypot(e.x-b.x,e.y-b.y)<e.r+b.r){e.hp-=b.damage;rm=true;if(e.hp<=0){drop20(e.x,e.y,e.inv);bots.delete(id);const k=players.get(b.owner);if(k)k.score+=70;setTimeout(spawnBot,700);}break}}
   if(!rm)for(const [id,w] of wilds){if(Math.hypot(w.x-b.x,w.y-b.y)<w.r+b.r){w.hp-=b.damage;rm=true;if(w.hp<=0){dropWild(w.x,w.y,w.inv);wilds.delete(id);const k=players.get(b.owner);if(k)k.score+=30;setTimeout(spawnWild,900);}break}}
  }
  if(rm)bullets.splice(i,1);
 }
 for(let i=grenades.length-1;i>=0;i--){const g=grenades[i];g.x+=g.vx*dt;g.y+=g.vy*dt;g.vx*=.985;g.vy*=.985;g.life-=dt;if(g.life<=0){
   const hit=(obj)=>Math.hypot(obj.x-g.x,obj.y-g.y)<150;
   for(const p of players.values()){if(p.id!==g.owner&&hit(p)){p.hp-=30;if(p.hp<=0){drop20(p.x,p.y,p);const k=players.get(g.owner);if(k)k.score+=100;respawnPlayer(p)}}}
   for(const [id,e] of bots){if(hit(e)){e.hp-=30;if(e.hp<=0){drop20(e.x,e.y,e.inv);bots.delete(id);setTimeout(spawnBot,700)}}}
   for(const [id,w] of wilds){if(hit(w)){w.hp-=30;if(w.hp<=0){dropWild(w.x,w.y,w.inv);wilds.delete(id);setTimeout(spawnWild,900)}}}
   grenades.splice(i,1);
  }}
 while(pickups.length<28)spawnPickup();
 const state=serialize();for(const ws of wss.clients){if(ws.readyState===1)ws.send(state)}
}
setInterval(tick,50);

const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log(`DRONE.IO v7 running: http://localhost:${PORT}`));
