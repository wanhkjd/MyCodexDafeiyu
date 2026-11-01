(() => {
 const get=id=>document.getElementById(id);let expanded=false,sending=false,last='',serverBusy=false,pollError='',pollTimer,polling=false,name='',lastPersona=null;
 const api=(action,body)=>window.pet.action(action,body);
 const personaFields=()=>({name:get('persona-name').value,call:get('persona-call').value,preset:get('persona-preset').value,notes:get('persona-notes').value,shareState:get('persona-state').checked,actions:get('persona-actions').checked});
 function render(s){
  if(!s.ok)throw new Error(s.message||'聊天记录暂不可用');
  serverBusy=!!s.pending;
  for(const id of ['chat-new','chat-sessions','chat-memory','chat-send','chat-input'])get(id).disabled=sending||serverBusy;
  get('chat-memory').checked=s.useMemory;
  const third=s.provider?.kind==='third-party';
  get('chat-model-source').textContent=third?`模型：第三方 API「${s.provider.name || '未配置'}」 · ${s.provider.model || '请补全配置'}`:'模型：本机 Codex';
  get('chat-memory-note').hidden=!third;get('chat-memory-note').textContent=third?`开启时，画像会随消息一起发给「${s.provider.name}」。`:'';
  get('memory-preview').textContent=s.memory?.available?s.memory.text:'暂无画像';
  if(!get('profile-notes').dataset.dirty&&document.activeElement!==get('profile-notes'))get('profile-notes').value=s.memory?.notes||'';
  get('profile-save').disabled=sending||serverBusy;
  renderPersona(s);
  const options=JSON.stringify(s.sessions);
  if(get('chat-sessions').dataset.options!==options){get('chat-sessions').replaceChildren(...s.sessions.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.title;return o;}));get('chat-sessions').dataset.options=options;}
  get('chat-sessions').value=s.active;
  const key=JSON.stringify([s.active,s.messages,s.pending,name]);if(key===last)return;last=key;
  const box=get('chat-history'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  box.replaceChildren();
  function bubble(role,text,meta,speaker){const row=document.createElement('article');row.className='chat-message '+role;const label=document.createElement('small');label.textContent=role==='user'?'你':(speaker||name||'大肥鱼');const p=document.createElement('p');p.textContent=text;row.append(label,p);if(meta){const note=document.createElement('small');note.textContent=meta;row.append(note);}box.append(row);}
  for(const m of s.messages)bubble(m.role,m.content,m.error?'未完成：'+m.error:m.model,m.characterName);
  if(s.pending?.sessionId===s.active){bubble('assistant',s.pending.text||'收到，正在想怎么回你…','正在回复');get('chat-result').textContent=s.pending.text||'收到，正在想怎么回你…';}
  if(!s.messages.length&&!s.pending){const p=document.createElement('p');p.className='muted';p.textContent='我在这里，说点什么吧～';box.append(p);}
  if(nearBottom||sending)box.scrollTop=box.scrollHeight;
 }
 // Her persona: the fields follow the saved settings unless you are editing them; her name also titles the cards.
 function renderPersona(s){
  const p=s.persona;if(!p)return;
  const box=get('persona-box'),select=get('persona-preset');
  // Skin changes never replace the shared persona or an unsaved draft.
  lastPersona=p;name=p.name||({bailong:'白龙'}[p.character])||'';
  if(select.options.length!==p.presets.length)select.replaceChildren(...p.presets.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.name;return o;}));
  if(!box.dataset.dirty&&!box.contains(document.activeElement)){const values=p;get('persona-name').value=values.name;get('persona-call').value=values.call;select.value=values.preset;get('persona-notes').value=values.notes;get('persona-state').checked=values.shareState;get('persona-actions').checked=values.actions;box.dataset.character='shared';}
  get('persona-name').placeholder='不填就叫'+({bailong:'白龙'}[p.character]||'大肥鱼');
  get('chat-history').setAttribute('aria-label',`和${name||'大肥鱼'}的聊天记录`);
  get('chat-input').placeholder='今天想聊点什么？';
  personaNotes();
  get('persona-preview').textContent=p.preview;
  const third=s.provider?.kind==='third-party';get('persona-share-note').hidden=!third;get('persona-share-note').textContent=third?`开启时，人设和此刻状态会随消息一起发给「${s.provider.name}」。`:'';
  get('persona-save').disabled=sending||serverBusy;
  get('chat-title').textContent=`和${name||'本鱼'}聊天`;
  const moodTitle=document.querySelector('#mood-card h2');if(moodTitle)moodTitle.textContent=`${name||'大肥鱼'}现在`;
 }
 window.addEventListener('pet-character-changed',()=>refresh().catch(e=>get('chat-result').textContent=e.message));
 function personaNotes(){const preset=lastPersona?.presets.find(item=>item.id===get('persona-preset').value);get('persona-preset-note').textContent=preset?preset.text:'';get('persona-count').textContent=`${get('persona-notes').value.length}/${lastPersona?.limits.notes??800}`;}
 async function refresh(){const s=await api('chat-state');render(s);if(pollError&&get('chat-result').textContent===pollError)get('chat-result').textContent='';pollError='';return s;}
 async function command(body){const r=await api('chat-command',body);if(!r.ok)throw new Error(r.message||'操作未成功');return r;}
 function expand(value){expanded=value;get('chat-expanded').hidden=!value;get('chat-expand').textContent=value?'收起对话':'展开对话';get('chat-expand').setAttribute('aria-expanded',String(value));if(value)get('chat-history').scrollTop=get('chat-history').scrollHeight;}
 get('chat-expand').onclick=()=>{expand(!expanded);refresh().catch(e=>get('chat-result').textContent=e.message);};
 get('chat-new').onclick=async()=>{try{render(await command({action:'new'}));get('chat-input').value='';get('chat-result').textContent='新的聊天开始啦，之前的记录仍在。';expand(true);}catch(e){get('chat-result').textContent=e.message;}};
 get('chat-sessions').onchange=async()=>{try{render(await command({action:'select',id:get('chat-sessions').value}));get('chat-result').textContent='';}catch(e){get('chat-result').textContent=e.message;}};
 get('chat-memory').onchange=async()=>{try{render(await command({action:'settings',useMemory:get('chat-memory').checked}));}catch(e){get('chat-result').textContent=e.message;}};
 get('profile-notes').oninput=()=>{get('profile-notes').dataset.dirty='1';};
 get('profile-save').onclick=async()=>{try{const s=await command({action:'profile',notes:get('profile-notes').value});delete get('profile-notes').dataset.dirty;render(s);get('profile-status').textContent='画像已保存';}catch(e){get('profile-status').textContent=e.message;}};
 for(const id of ['persona-name','persona-call','persona-preset','persona-notes','persona-state','persona-actions'])get(id).addEventListener('input',()=>{get('persona-box').dataset.dirty='1';personaNotes();});
 get('persona-save').onclick=async()=>{const box=get('persona-box'),character=box.dataset.character||lastPersona?.character||'dafeiyu';try{const s=await command({action:'persona',character,...personaFields()});if(box.dataset.character===character)delete box.dataset.dirty;render(s);get('persona-status').textContent='已保存';}catch(e){get('persona-status').textContent=e.message;}};
 get('chat-form').onsubmit=async event=>{
  event.preventDefault();const text=get('chat-input').value.trim();if(!text||sending||serverBusy)return;
  sending=true;get('chat-send').disabled=true;get('chat-result').textContent='收到！本鱼来啦…';expand(true);
  try{const response=command({action:'send',text});schedulePoll(100);const r=await response;get('chat-input').value='';get('chat-result').textContent=(r.provider?`${r.provider} · ${r.model||'模型'}`:`本机配置 · ${r.model||'当前模型'}`)+(r.action?` · 动作：${r.action}`:'');}catch(e){get('chat-result').textContent=e.message;}finally{sending=false;await refresh().catch(()=>{});}
 };
 function schedulePoll(ms){clearTimeout(pollTimer);pollTimer=setTimeout(poll,ms);}
 async function poll(){if(polling){schedulePoll(100);return;}polling=true;try{await refresh();}catch(e){if(!sending){pollError=e.message;get('chat-result').textContent=pollError;}}finally{polling=false;schedulePoll(sending||serverBusy?150:2000);}}poll();
})();
