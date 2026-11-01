import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { DEFAULT_BEHAVIOR, characterState, characterFile, saveCharacter, applyCharacterConfig } from '../app/backend/runtime/characters.mjs';
const root = new URL('../app/backend/runtime/electron-helper/', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const animations = { idle: ['待机呼吸休闲'], clicks: ['点击'], drag: ['拖拽'], turn: [], categories: [], moves: { actions: [] } };
const raw = () => ({ main: { pets: [{ id: 'main', size: 400 }], animations } });
function homeTest(run) {
  const parent=resolve(tmpdir()), home=mkdtempSync(join(parent,'dafeiyu-run-test-'));
  try { return run(home); } finally {
    assert.equal(dirname(resolve(home)),parent); assert.ok(home.startsWith(join(parent,'dafeiyu-run-test-')));
    rmSync(home,{recursive:true,force:true});
  }
}
function harness() {
  let now=25000, next=0; const frames=new Map(), plays=[];
  const context=vm.createContext({ console, performance:{now:()=>now}, window:{}, VIEW:{w:1920,h:1080}, PANELS:[{x:0,y:0,width:1920,height:1040}], AREAS:[], requestAnimationFrame:cb=>{frames.set(++next,cb);return next;}, cancelAnimationFrame:id=>frames.delete(id) });
  vm.runInContext(read('shared-core.js')+'\nconst S=PetShared;\n'+read('flight-motion.js')+'\n'+read('run-motion.js')+'\n'+read('drag-motion.js')+'\n'+read('edge-peek.js')+'\n'+read('sprite.js')+'\nglobalThis.Sprite=PetSprite;globalThis.Motion=RunMotion;',context);
  const sprite=Object.assign(Object.create(context.Sprite.prototype), {
    edgePeek:{dock:null}, pet:{fixedEnabled:false}, dragSettings:context.DragMotion.normalize(), character:null, assetRoot:'main', behavior:{largeActions:true,run:true,flight:true}, suspended:false,
    pos:{x:800,y:740},size:410,winH:250,halfW:205,halfH:115, facing:'left',
    runRef:null,runToken:0,pendingRun:null,runPlan:null,nextRunAt:0,
    flightRef:null,flightToken:0,pendingFlight:null,flightPlan:null,
    moveRef:null,moveToken:0,pendingMove:null,throwRef:null,riceActive:false,
    dragState:{active:false},menuOpen:false,chatOpen:false,stickyOn:false,workState:null,animations,
    videoA:{dataset:{},loop:false},videoB:{dataset:{},loop:false},
    sendBounds(x,y){this.pos={x,y};}, switchTo(name,once){this.anim=name;plays.push({name,once});},
  });
  return { sprite, Motion:context.Motion, frames, plays, advance(ms){now+=ms;}, frame(){const [id,cb]=frames.entries().next().value;frames.delete(id);cb();}, context };
}
const opts={x:800,y:740,width:410,height:250,areas:[{x:0,y:0,width:1920,height:1040}]};

test('run defaults on and migrates old independent flight preference',()=>homeTest(home=>{
  assert.equal(DEFAULT_BEHAVIOR.run,true);
  mkdirSync(dirname(characterFile(home)),{recursive:true});
  writeFileSync(characterFile(home),JSON.stringify({selected:'dafeiyu',behavior:{flight:false,largeActions:true}}));
  assert.deepEqual(characterState(home).behavior,{largeActions:true,run:true,flight:false});
}));
test('run switch persists independently across both character selections',()=>homeTest(home=>{
  assert.equal(saveCharacter(home,{action:'behavior',behavior:{run:false,flight:true}}).ok,true);
  assert.equal(applyCharacterConfig(raw(),home).main.pets[0].behavior.run,false);
  assert.equal(saveCharacter(home,{action:'select',id:'bailong',source:'bundled'}).behavior.run,false);
  assert.equal(saveCharacter(home,{action:'select',id:'dafeiyu'}).behavior.flight,true);
  assert.equal(saveCharacter(home,{action:'behavior',behavior:{flight:false}}).behavior.run,false);
  assert.equal(saveCharacter(home,{action:'behavior',behavior:{run:true}}).behavior.flight,false);
  assert.equal(JSON.parse(readFileSync(characterFile(home),'utf8')).behavior.run,true);
  for(const bad of [{run:'false'},{run:0},{running:true},{}]) assert.equal(saveCharacter(home,{action:'behavior',behavior:bad}).ok,false);
}));
for(const direction of ['left','right']) test('horizontal route faces '+direction+' and never drifts vertically',()=>{
  const {Motion}=harness(), p=Motion.plan({...opts,random:()=>direction==='left'?0:1});
  assert.equal(p.direction,direction);
  assert.ok(direction==='left'?p.target.x<p.start.x:p.target.x>p.start.x);
  for(let t=-100;t<=11000;t+=100){const q=Motion.sample(p,t);assert.ok(q.x>=p.bounds.minX&&q.x<=p.bounds.maxX);assert.equal(q.y,p.start.y);}
  assert.equal(Motion.sample(p,20000).x,p.target.x);
});
test('screen edges reverse direction instead of running off-screen',()=>{
  const {Motion}=harness();
  assert.equal(Motion.plan({...opts,x:0,random:()=>0}).direction,'right');
  assert.equal(Motion.plan({...opts,x:1910,random:()=>1}).direction,'left');
  assert.equal(Motion.plan({...opts,areas:[{x:0,y:0,width:430,height:270}]}),null);
  assert.equal(Motion.plan({...opts,areas:[]}),null);
});
test('negative-coordinate monitors and mixed-size displays never traverse desktop gaps',()=>{
  const {Motion}=harness(), areas=[{x:-1800,y:-500,width:1600,height:1000},{x:0,y:0,width:1920,height:1080}];
  for(let i=0;i<500;i++) {
    const p=Motion.plan({...opts,x:-1700+Math.random()*1300,y:-450+Math.random()*700,areas});
    if(!p)continue;
    assert.equal(p.bounds.area.x,-1800);
    for(let t=0;t<=p.durationMs;t+=300){const q=Motion.sample(p,t);assert.ok(q.x>=-1792&&q.x+410<=-208);assert.ok(q.y>=-492&&q.y+250<=492);}
  }
});
test('media clock accumulates clip loops but not stalls or invalid durations',()=>{
  const {Motion}=harness();
  assert.equal(Motion.mediaDelta(0.4,0.4,1.75),0);
  assert.ok(Math.abs(Motion.mediaDelta(1.7,0.05,1.75)-0.1)<1e-9);
  assert.equal(Motion.mediaDelta(0,1,NaN),0);
  assert.equal(Motion.mediaDelta(0,1,Infinity),0);
});
for(const [name,patch] of [
  ['dragon',{character:{id:'bailong'}}], ['extra pet',{assetRoot:'extra'}], ['run disabled',{behavior:{largeActions:true,run:false}}],
  ['large actions disabled',{behavior:{largeActions:false,run:true}}], ['fixed position',{pet:{fixedEnabled:true}}],
  ['feeding',{riceActive:true}], ['dragging',{dragState:{active:true}}], ['menu',{menuOpen:true}], ['chat',{chatOpen:true}],
  ['reminder',{stickyOn:true}], ['suspended',{suspended:true}], ['throwing',{throwRef:4}], ['working',{workState:'running'}]
]) test('free run is suppressed while '+name,()=>{const {sprite,plays}=harness();Object.assign(sprite,patch);assert.equal(sprite.tryRun(),false);assert.equal(plays.length,0);});
test('scheduling honors cooldown then starts a finite run with correct facing and loop clip',()=>{
  const {sprite,plays,context}=harness();
  sprite.nextRunAt=50000;assert.equal(sprite.maybeRun(),false);
  sprite.nextRunAt=0;vm.runInContext('Math.random=()=>0.1',context);
  assert.equal(sprite.maybeRun(),true);assert.equal(sprite.facing,'left');
  assert.equal(plays[0].name,'控制-奔跑');assert.equal(plays[0].once,false);
  assert.ok(sprite.nextRunAt>=70000);assert.ok(sprite.pendingRun.durationMs>=6000);
});
test('frame drive follows looping media, stops at its destination and returns idle',()=>{
  const h=harness(),{sprite,Motion}=h;assert.equal(sprite.tryRun(),true);
  const target=sprite.pendingRun.target.x;
  const el=sprite.videoA;Object.assign(el,{dataset:{animation:Motion.ANIMATION},currentTime:0,duration:1.75,paused:false,seeking:false,loop:true});
  sprite.startRunDrive(el);
  h.frame();assert.equal(sprite.pos.x,800); // no decoded progress = no sliding
  for(let i=0;i<50&&sprite.runPlan;i++){el.currentTime=(el.currentTime+0.3)%1.75;h.advance(300);h.frame();}
  assert.equal(sprite.runPlan,null);assert.equal(sprite.runRef,null);assert.equal(sprite.pos.x,target);
  assert.equal(el.loop,false);assert.equal(sprite.anim,animations.idle[0]);
});
test('stopMove cancels pending and active runs, remembers the current position, releases loops',()=>{
  const h=harness(),{sprite,Motion}=h;sprite.tryRun();const el=sprite.videoA;
  Object.assign(el,{dataset:{animation:Motion.ANIMATION},currentTime:0,duration:1.75,paused:false,seeking:false,loop:true});
  sprite.startRunDrive(el);el.currentTime=0.8;h.frame();const x=sprite.pos.x;
  sprite.stopMove();assert.equal(h.frames.size,0);assert.equal(sprite.runPlan,null);assert.equal(el.loop,false);
  assert.equal(sprite.customPos.rx,(x+sprite.halfW)/1920);
  sprite.tryRun();sprite.stopMove();assert.equal(sprite.pendingRun,null);
});
test('live run toggle stops running or walking; flight toggle does not interrupt fish',()=>{
  const {sprite}=harness();sprite.tryRun();const active=sprite.pendingRun;
  sprite.setBehavior({run:true,flight:false});assert.equal(sprite.pendingRun,active);
  sprite.setBehavior({run:false,flight:false});assert.equal(sprite.pendingRun,null);assert.equal(sprite.anim,animations.idle[0]);
  sprite.moveRef=3;sprite.setBehavior({run:false});assert.equal(sprite.moveRef,null);
  sprite.behavior.run=false;assert.equal(sprite.tryMove(),false);
});
test('stalled run media recovers to idle rather than leaving an endless animation',()=>{
  const h=harness(),{sprite}=h;sprite.tryRun();const el={currentTime:0,duration:1.75,paused:true,seeking:false};
  sprite.startRunDrive(el);h.advance(10001);h.frame();assert.equal(sprite.runPlan,null);assert.equal(sprite.anim,animations.idle[0]);
});
test('manual control entry points are removed while rice feeding and flight remain wired',()=>{
  for(const file of ['sprite.js','features.js','preload.js','main.js'])assert.doesNotMatch(read(file),/startPetControl|startControl\(|pet:start-control|action: 'control'/);
  assert.doesNotMatch(readFileSync(new URL('../app/reminders-panel.js',import.meta.url),'utf8'),/pet-control|controlCard|WASD/);
  assert.match(read('drag-motion.js')+'\n'+read('sprite.js'),/喂白饭/);assert.match(read('drag-motion.js')+'\n'+read('sprite.js'),/tryFlight\(name\)/);
  assert.ok(read('index.html').indexOf('run-motion.js')<read('index.html').indexOf('sprite.js'));
  const panel=readFileSync(new URL('../app/panel.html',import.meta.url),'utf8');assert.match(panel,/id="skin-run"/);assert.match(panel,/id="skin-flight"/);
  assert.match(read('renderer.js'),/s\.runRef !== null \|\| s\.pendingRun \|\| s\.runPlan/);
});

test('a newly opened reminder or feeding session also interrupts an already active run',()=>{
  for(const patch of [{stickyOn:true},{riceActive:true},{pet:{fixedEnabled:true}}]) {
    const h=harness(),{sprite}=h;sprite.tryRun();sprite.startRunDrive({currentTime:0,duration:1.75,paused:false,seeking:false});
    Object.assign(sprite,patch);h.frame();assert.equal(sprite.runPlan,null);assert.equal(sprite.anim,animations.idle[0]);
  }
});
test('cancellation during video loading cannot resurrect a run or an endless loop',()=>{
  const h=harness(),{sprite,context}=h;
  Object.assign(context.window,{setTimeout:()=>1,clearTimeout(){}});
  const video=()=>({dataset:{},style:{},classList:{add(){},remove(){}},readyState:0,currentTime:0,duration:1.75,paused:false,seeking:false,load(){},pause(){},play:()=>Promise.resolve()});
  Object.assign(sprite,{front:0,gen:0,pending:null,videoA:video(),videoB:video()});
  sprite.switchTo=context.Sprite.prototype.switchTo;
  assert.equal(sprite.tryRun(),true);const el=sprite.videoB;assert.equal(el.loop,true);
  sprite.stopMove();el.onloadeddata();
  assert.equal(sprite.pendingRun,null);assert.equal(sprite.runPlan,null);assert.equal(el.loop,false);assert.equal(h.frames.size,0);
  el.onended();assert.equal(sprite.anim,animations.idle[0]);
});
test('switching to an event animation cancels the frame drive and the running loop',()=>{
  const h=harness(),{sprite,context}=h;
  Object.assign(context.window,{setTimeout:()=>1,clearTimeout(){}});
  const video=()=>({dataset:{},style:{},classList:{add(){},remove(){}},readyState:0,currentTime:0,duration:1.75,paused:false,seeking:false,load(){},pause(){},play:()=>Promise.resolve()});
  Object.assign(sprite,{front:0,gen:0,pending:null,videoA:video(),videoB:video()});sprite.switchTo=context.Sprite.prototype.switchTo;
  sprite.tryRun();sprite.videoB.onloadeddata();assert.ok(sprite.runPlan);assert.ok(h.frames.size);
  sprite.playOnce('点击');assert.equal(sprite.runPlan,null);assert.equal(h.frames.size,0);assert.equal(sprite.videoB.loop,false);
});
