'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPreviewServer}=require('../scripts/preview-server');
const {createFileStore}=require('../scripts/preview-store');
test('separate preview players cannot impersonate each other through request payloads or arbitrary tokens',async t=>{
 const {server}=createPreviewServer({env:{PREVIEW_MODE:'fixture'},configPath:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(route,data,token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Preview-Player':token}:{})},body:JSON.stringify(data)});
 const a=(await(await post('/api',{action:'status'})).json()).data;
 const token=(await(await post('/preview-player',{})).json()).token;
 const b=(await(await post('/api',{action:'status',userId:'local-preview-user'},token)).json()).data;assert.notEqual(a.ownerKey,b.ownerKey);
 assert.equal((await post('/api',{action:'status'},'arbitrary-player')).status,401);
 const room=(await(await post('/api',{action:'createRoom',puzzleId:'parking-ticket'})).json()).data.room;
 const forbidden=await(await post('/api',{action:'getRoom',roomId:room.id},token)).json();assert.equal(forbidden.error.code,'ROOM_FORBIDDEN');
 const joined=await(await post('/api',{action:'joinRoom',roomId:room.id},token)).json();assert.equal(joined.data.room.members.length,2);assert.equal(joined.data.room.isHost,false);
});
test('preview saves atomic private state and restores first-attempt claims after restart',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hgt-store-')),file=path.join(directory,'state.json');
 try{const store=createFileStore(file);await store.transaction(tx=>tx.set('rankClaims','one',{gameId:'first'}));
 await assert.rejects(store.transaction(async tx=>{await tx.set('rankClaims','one',{gameId:'other'});throw Error('rollback')}));
 const fresh=createFileStore(file);assert.equal((await fresh.transaction(tx=>tx.get('rankClaims','one'))).gameId,'first');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
