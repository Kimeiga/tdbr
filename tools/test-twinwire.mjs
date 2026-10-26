import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {EventClient} from 'twinwire/client';
import {NAMESPACE,LATEST} from '../shared/network.js';
const rtc=process.env.TEST_RTC==='1';if(rtc)globalThis.RTCPeerConnection=(await import('node-datachannel/polyfill')).RTCPeerConnection;
process.env.PORT='0';process.env.RTC=rtc?'1':'0';process.env.GAME_MODE='normal';
const {game,io}=await import('../server/index.js');game.stop();
// Exercise real game ticks deterministically without running a 100-bot local soak.
const snapshots=setInterval(()=>game._broadcast(),50),port=io.game.httpServer.address().port,base='http://127.0.0.1:'+port;
const clients=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,ms=12000){const end=performance.now()+ms;while(!await fn()){if(performance.now()>end)throw Error('Timed out');await sleep(10);}}
function make(){
 const c=new EventClient({url:base.replace('http','ws')+'/connect',room:NAMESPACE,latest:LATEST,stateMaxAgeMs:250,rtc:rtc?undefined:false,websocket:url=>new WebSocket(url,{origin:'http://localhost'})});
 const init=[],state=[],events=[];c.on('init',d=>init.push(d));c.on('state',d=>state.push(d));c.on('game-events',d=>events.push(...d.events));clients.push(c);c.connect();return {c,init,state,events};
}
try{
 const a=make(),b=make();await wait(()=>a.init.length&&b.init.length&&a.c.ready('state')&&b.c.ready('state')&&a.c.net.clock.synced);
 if(rtc)await wait(()=>a.c.transport==='rtc'&&b.c.transport==='rtc');
 const id=a.c.id,p=game.players.get(id),initial=a.init[0],world=await fetch(base+initial.worldURL).then(r=>r.json());
 const initBytes=Buffer.byteLength(JSON.stringify(initial)),worldBytes=Buffer.byteLength(JSON.stringify(world));
 assert.ok(initBytes<2048,'large map cannot enter the reliable SDK event queue');assert.equal(world.map.length,10000);assert.equal(world.bots.length,100);assert.equal(world.worldRevision,initial.worldRevision);
 const pos=game.walkable.find(t=>game.isWalkableFn(t.x+1,t.y));assert.ok(pos);p.x=pos.x*48+24;p.y=pos.y*48+24;
 const before=p.x;a.c.emit('input',{seq:1,keys:{d:true},angle:0});await wait(()=>p.intent?.seq===1);game._processPlayerInputs(1/60);assert.ok(p.x>before,'fixed tick applies current intent');
 const first=p.x;game._processPlayerInputs(1/60);assert.ok(p.x>first,'fixed simulation does not depend on how many packets coalesce');
 p.lastInputAt=performance.now()-250;const stopped=p.x;game._processPlayerInputs(1/60);assert.equal(p.x,stopped,'stale held intent stops');
 const mag=p.inventory.magAmmo.primary;a.c.emit('fire',{slot:'primary',angle:0,latency:0});await wait(()=>p.inventory.magAmmo.primary===mag-1);
 a.c.net.pause();await wait(()=>!io.channels.get(id).connected);assert.equal(p.intent,null);assert.equal(game.players.get(id),p);
 const preserved={x:p.x,y:p.y,hp:p.hp,ammo:p.inventory.magAmmo.primary};a.c.connect();await wait(()=>a.c.net.status==='online'&&a.init.length===2&&a.c.ready('state'));
 assert.equal(a.c.id,id);assert.equal(game.players.get(id),p);assert.deepEqual({x:p.x,y:p.y,hp:p.hp,ammo:p.inventory.magAmmo.primary},preserved);
 assert.equal(a.init[1].worldRevision,initial.worldRevision);assert.equal(a.init[1].playerState.inventory.magAmmo.primary,mag-1);
 const stateBytes=Buffer.byteLength(JSON.stringify(a.state.at(-1)));assert.ok(stateBytes<64*1024);
 a.c.close();await wait(()=>!game.players.has(id));assert.ok(game.players.has(b.c.id));
 console.log(JSON.stringify({ok:true,transport:rtc?'rtc':'ws',initBytes,worldBytes,stateBytes,largeBootstrap:'HTTP',fixedTickIntent:true,fire:'once',samePlayerWorldInventory:true}));
}finally{clearInterval(snapshots);game.stop();clients.forEach(c=>c.close());await io.close();}
