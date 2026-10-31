import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createModelRouter} from './model-router.mjs';
import * as persona from './persona.mjs';
export function readUserSummary(home=process.env.CODEX_HOME||join(homedir(),'.codex')){
 const file=join(home,'memories','memory_summary.md');
 try{
  const raw=readFileSync(file,'utf8').replace(/^\uFEFF/,'');
  const blocks=raw.split(/(?=^##\s)/m);
  const personal=blocks.filter(block=>/^##\s+(?:User Profile|User preferences|Current projects|Current work|用户画像|用户偏好|当前项目|正在做的事)\s*$/im.test(block.split('\n')[0]));
  const text=personal.join('\n').trim().slice(0,4500);
  return {available:!!text,text,source:'Codex 已记录的个人信息、偏好和当前项目；不包含一般操作指南'};
 }catch{return {available:false,text:'',source:'未找到 Codex 的个人记忆摘要'};}
}
const stores=new Map();
export const conversationBusy = dir => stores.get(dir)?.isBusy() === true;
export function conversations(dir,generate){
 if(stores.has(dir))return stores.get(dir);
 // Pick the model per message so switching it in the manager window applies without a restart.
 const model=createModelRouter(dir);
 const reply=typeof generate==='function'?generate:model.chat;
 mkdirSync(dir,{recursive:true});const file=join(dir,'pet-conversations.json');
 const fresh=()=>({id:randomUUID(),title:'新的鱼塘',messages:[],createdAt:Date.now()});
 let data;
 if(existsSync(file)){
   try{data=JSON.parse(readFileSync(file,'utf8').replace(/^﻿/,''));if(!Array.isArray(data?.sessions)||!data.sessions.length)throw new Error('no sessions');}
   catch{
    // Keep the damaged file for recovery instead of leaving chat broken for good.
    renameSync(file,`${file}.corrupt-${Date.now()}.bak`);
    const first=fresh();first.title='聊天记录已重建';data={active:first.id,mode:'auto',useMemory:false,sessions:[first]};
   }
 }
 else{
   const first=fresh();try{const old=JSON.parse(readFileSync(join(dir,'dsh-pet','memory.json'),'utf8'));const messages=old.main?.main?.messages;if(Array.isArray(messages)&&messages.length){first.messages=messages;first.title='之前和本鱼的聊天';}}catch{}
   data={active:first.id,mode:'auto',useMemory:false,sessions:[first]};
 }
 // Old Sol/Luna selections must not override the local gateway's configured model.
 data.mode='auto';
 if(typeof data.useMemory!=='boolean')data.useMemory=false;
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(data,null,2));renameSync(file+'.tmp',file);};save();
 let pending=null;
 const current=()=>data.sessions.find(s=>s.id===data.active)||data.sessions[0];
 const profile=()=>{
  const automatic=data.useMemory?readUserSummary():{available:false,text:'',source:'本地记忆读取未开启'},notes=String(data.profileNotes||'').trim();
  const text=[automatic.text?`【Codex 对用户的既有了解，可能过期】\n${automatic.text}`:'',notes?`【用户亲自补充或纠正，以此为准】\n${notes}`:''].filter(Boolean).join('\n\n');
  return {...automatic,available:!!text,text,notes};
 };
 // Her persona settings (persona.json) and a preview of exactly what the model is told.
 const providerOf=()=>model.status().kind==='third-party'?'third-party':'codex';
 const personaView=()=>{const settings=persona.readPersona(dir);return {...settings,presets:persona.PRESETS,limits:persona.LIMITS,preview:persona.buildPersona(settings,{provider:providerOf()})};};
 const snapshot=()=>({ok:true,active:current().id,mode:data.mode,useMemory:data.useMemory,sessions:data.sessions.map(({id,title,createdAt})=>({id,title,createdAt})),messages:current().messages,pending:pending&&{...pending,text:persona.hideTag(pending.text)},memory:profile(),provider:model.status(),persona:personaView()});
 // extras.state: the mood panel's data at the moment you send, for her 「此刻」.
 const command=async (body,extras={})=>{
  if(pending)return {ok:false,message:'本鱼还在回上一句，等一下再操作～'};
  if(body.action==='new'){const s=fresh();data.sessions.unshift(s);data.active=s.id;save();return snapshot();}
  if(body.action==='select'){if(!data.sessions.some(s=>s.id===body.id))return {ok:false,message:'找不到这个聊天'};data.active=body.id;save();return snapshot();}
  if(body.action==='settings'){data.mode='auto';if(typeof body.useMemory==='boolean')data.useMemory=body.useMemory;save();return snapshot();}
  if(body.action==='profile'){
   if(typeof body.notes!=='string'||body.notes.length>3000)return {ok:false,message:'画像补充请控制在 3000 字以内'};
   data.profileNotes=body.notes.trim();save();return snapshot();
  }
  if(body.action==='persona'){const saved=persona.savePersona(dir,body);return saved.ok?snapshot():saved;}
  if(body.action!=='send'||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)return {ok:false,message:'请输入 1～2000 字'};
  const session=current(),text=body.text.trim(),history=session.messages.filter(m=>!m.error),settings=persona.readPersona(dir);
  const user={role:'user',content:text,ts:Date.now()};session.messages.push(user);if(session.messages.length===1)session.title=text.slice(0,22);save();
  pending={sessionId:session.id,text:'',startedAt:Date.now()};
  try{
   // A video link: with her Bilibili life on, she reads (and looks at) the video first. It goes in front of your words, never into the history.
   const material=extras.bili?await extras.bili.chatMaterial(text).catch(()=>''):'';
   const now=settings.shareState?[persona.describeState(extras.state),extras.bili?.todayLine()].filter(Boolean).join('\n'):'';
   const result=await reply(text,history,dir,{mode:data.mode,memory:data.useMemory?profile().text:'',persona:persona.buildPersona(settings,{provider:providerOf()}),state:[now,material].filter(Boolean).join('\n\n'),onDelta:delta=>{pending.text+=String(delta??'');}});
   if(!result.ok){user.error=result.message||'回复失败';save();return result;}
   // Action tags never reach the history or the bubble; the pet just does the action.
   const taken=persona.takeAction(result.text, Math.random, settings.character);
   session.messages.push({role:'assistant',content:taken.text,model:result.model,ts:Date.now(),character:settings.character||'dafeiyu',characterName:settings.name||'大肥鱼'});
   save();return {...result,text:taken.text,action:settings.actions?taken.action:null,animation:settings.actions?taken.animation:null};
  }catch(e){user.error=e.message;save();return {ok:false,message:e.message};}finally{pending=null;}
 };
 const service={snapshot,command,isBusy:()=>!!pending};stores.set(dir,service);return service;
}
