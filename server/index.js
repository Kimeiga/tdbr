// Paired Twinwire client/server host; immutable world/bootstrap data travels over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEventServer,createNativeRtcFactory} from 'twinwire/server';
import {GameServer} from './GameServer.js';
import {NAMESPACE,LATEST} from '../shared/network.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client/public');
let game,lastRestart=0,hostId=null;
const io=await createEventServer({namespace:NAMESPACE,latest:LATEST,port:Number(process.env.PORT??3000),host:'0.0.0.0',
  origins:origin=>/^https?:\/\//.test(origin),maxSessions:32,resumeGraceMs:30_000,
  endpoint:{bytesPerSecond:768*1024,burstBytes:192*1024},
  rtc:process.env.RTC==='0'?undefined:await createNativeRtcFactory({port:Number(process.env.RTC_PORT??3001)}),
  http(req,res){
    let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400);res.end();return;}
    if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,twinwire:'2.2.0',wire:4,players:game?.players.size,sessions:io.game.sessions.size,worldRevision:game?.worldRevision}));return;}
    if(url.pathname==='/api/world/'+game?.worldRevision){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(game.publicWorld()));return;}
    let relative;try{relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);}catch{res.writeHead(400);res.end();return;}
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}
      const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.wav':'audio/wav'};
      res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','cache-control':path.extname(file)==='.html'?'no-cache':'public,max-age=60'});res.end(data);
    });
  },
});
const mode=process.env.GAME_MODE||'arena';game=new GameServer(io,mode);
io.onConnection(channel=>{
  hostId??=channel.id;game.addPlayer(channel);
  channel.on('input',data=>game.handleInput(channel.id,data));
  for(const [event,method]of [['fire','handleFire'],['pickup','handlePickup'],['use_item','handleUseItem']])channel.on(event,data=>{if(data&&typeof data==='object')game[method](channel.id,data);});
  channel.on('reload',()=>game.handleReload(channel.id));
  channel.onPause=()=>{const p=game.players.get(channel.id);if(p){p.inputs=[];p.intent=null;p.sprinting=false;p.crouching=false;}};
  channel.onResume=()=>game.addPlayer(channel);
  channel.onDisconnect(()=>{game.removePlayer(channel.id);if(hostId===channel.id)hostId=io.channels.keys().next().value??null;});
  channel.on('restart_server',()=>{
    if(channel.id!==hostId||performance.now()-lastRestart<30_000)return;lastRestart=performance.now();
    game.stop();game=new GameServer(io,mode);for(const peer of io.channels.values())game.addPlayer(peer);game.start();
  });
});
const port=await io.listen();game.start();console.log('TDBR Twinwire on http://127.0.0.1:'+port);
export {io,game};
