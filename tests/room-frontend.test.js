'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function page(clock = Date.now) {
 let definition;const writes=[];
 const storage={write:(...a)=>writes.push(a),owner:()=> 'test'};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/room/index.js'),'utf8'),{Page:d=>{definition=d},require:name=>name.endsWith('/storage')?storage:name.endsWith('/presentation')?require('../miniprogram/utils/presentation'):function(){},Date:{now:clock},wx:{},getApp:()=>({globalData:{}})});
 const p=Object.assign({},definition,{data:structuredClone(definition.data),_alive:true,_roomId:'123456',_host:{sync(){}},setData(v){Object.assign(this.data,v)}});
 return {p,writes};
}
const room=(revision,id='123456')=>({id,revision,state:'playing',messages:[],hints:[],members:[],maxQuestions:30,questionCount:0,hintCount:0,turnDeadlineAt:Date.now()+45000,active:null});
test('out-of-order room polls never roll back a newer turn or revive a room after leaving',()=>{
 const {p}=page();p.apply(room(5));p.apply({...room(4),state:'waiting'});assert.equal(p.data.room.revision,5);assert.equal(p.data.room.state,'playing');
 p._roomId='654321';p.data.room=null;p.apply(room(6));assert.equal(p.data.room,null);
});
test('recovery discovers only the current player active request and never invents a draft to resubmit',()=>{
 const {p}=page();p.apply({...room(1),active:{mine:false,requestId:'peer'}});assert.equal(p._pending,undefined);
 p.apply({...room(2),active:{mine:true,requestId:'mine'}});assert.equal(p._pending.requestId,'mine');assert.equal(p._pending.revision,-1);assert.equal(p.data.draft,'');
});
test('local countdown displays the server deadline, stops offscreen and never decides the next turn',()=>{
 let time=1000;const {p}=page(()=>time);p._visible=true;p.apply({...room(1),turnDeadlineAt:46000,turnSerial:3});
 assert.equal(p.data.seconds,45);time+=1000;p.tickClock();assert.equal(p.data.seconds,44);
 p._visible=false;time+=10000;p.tickClock();assert.equal(p.data.seconds,44);
 p._visible=true;time=50000;p.tickClock();assert.equal(p.data.seconds,0);assert.equal(p.data.room.turnSerial,3);
});
