'use strict';
(() => {
const card=document.createElement('section');
card.id='llm-card';card.className='quota-card llm-card';
card.innerHTML=`<div class="section-title"><h2>聊天用的大模型</h2><button id="llm-toggle" class="text-button" type="button" aria-expanded="false" disabled>设置</button></div>
<label class="memory-toggle"><input type="checkbox" id="llm-enabled" disabled>用第三方 API 聊天（关闭时用 Codex 账号）</label>
<p id="llm-summary" class="muted">正在读取模型设置…</p>
<div id="llm-form" hidden>
<div class="llm-field"><span>使用的配置</span><div class="llm-row"><select id="llm-profile" aria-label="使用的配置"></select><button id="llm-add" type="button">＋ 新增</button><button id="llm-remove" type="button">删除</button></div></div>
<label>服务商<select id="llm-preset"></select></label>
<p id="llm-hint" class="muted"></p>
<label>配置名称<input id="llm-name" maxlength="40"></label>
<label>API 地址<input id="llm-base" maxlength="300" spellcheck="false" placeholder="https://api.deepseek.com"></label>
<div class="llm-field"><span>API Key</span><div class="llm-row"><input id="llm-key" type="password" maxlength="500" autocomplete="off" spellcheck="false" aria-label="API Key"><button id="llm-key-clear" type="button" hidden>清除</button></div></div>
<div class="llm-field"><span>模型</span><div class="llm-row"><input id="llm-model" maxlength="160" spellcheck="false" aria-label="模型" placeholder="例如 deepseek-flash"><button id="llm-fetch" type="button">获取列表</button></div><select id="llm-model-list" aria-label="从列表选择模型" hidden></select></div>
<label>思考模式<select id="llm-thinking"><option value="off">关闭（推荐：回复快、省 token）</option><option value="on">开启（更慢、更费 token）</option><option value="default">服务商默认（不发送该参数）</option></select></label>
<label>网络代理<select id="llm-proxy-mode"><option value="system">跟随系统代理</option><option value="direct">不用代理（直连）</option><option value="custom">指定代理端口</option></select></label>
<label id="llm-proxy-row">代理端口或地址<input id="llm-proxy" maxlength="200" spellcheck="false" placeholder="7890 或 127.0.0.1:7890"></label>
<details><summary>高级设置</summary><div class="llm-grid"><label>温度（0–2）<input id="llm-temperature" type="number" min="0" max="2" step="0.1"></label><label>最大输出 token<input id="llm-max-tokens" type="number" min="32" max="32768" step="1"></label><label>超时（秒，10–110）<input id="llm-timeout" type="number" min="10" max="110" step="1"></label><label>携带历史轮数<input id="llm-history" type="number" min="0" max="20" step="1"></label></div></details>
<details id="llm-vision-box"><summary>识图（看画面用）</summary><p class="muted">「她的 B 站」看画面时，把截下来的九宫格交给这里选的模型。不能看图的模型会在测试时露馅。</p>
<label>用哪套配置<select id="llm-vision-profile"></select></label>
<label>识图模型名<input id="llm-vision-model" maxlength="160" spellcheck="false" placeholder="留空就用那套配置的模型，例如 glm-4.6v-flash"></label>
<div class="llm-row"><button id="llm-vision-test" type="button">测试识图</button></div><p id="llm-vision-status" class="muted" role="status"></p></details>
<div class="actions"><button id="llm-test" type="button">测试连接</button><button id="llm-save" type="button" class="primary">保存</button></div>
<p id="llm-status" role="status"></p>
<p class="muted">Key 用系统加密只存在本机，聊天时才发给你填的服务商。测试连接会发一条很短的消息，可能产生极少费用。</p>
</div>`;
document.querySelector('.chat-card').before(card);
const $=id=>document.getElementById(id);
const fields={name:'llm-name',baseUrl:'llm-base',model:'llm-model',thinking:'llm-thinking',proxyMode:'llm-proxy-mode',proxy:'llm-proxy',temperature:'llm-temperature',maxTokens:'llm-max-tokens',timeoutSec:'llm-timeout',historyRounds:'llm-history'};
const buttons=['llm-test','llm-save','llm-fetch','llm-enabled','llm-add','llm-remove','llm-vision-test'];
let state=null,draft=null,selected='',typedKeys={},clearKeys=new Set(),busy=false;
const current=()=>draft.profiles.find(p=>p.id===selected);
const keyless=p=>!!state.presets.find(item=>item.id===p.preset)?.keyless;
const proxyLabel=p=>p.proxyMode==='custom'?'代理 '+p.proxy:p.proxyMode==='direct'?'直连':'跟随系统代理';
const status=text=>{$('llm-status').textContent=text;};
function blankProfile(presetId){
 const preset=state.presets.find(item=>item.id===presetId)||state.presets[0];
 return {id:'p-'+Math.random().toString(36).slice(2,10),name:preset.name,preset:preset.id,baseUrl:preset.baseUrl,model:preset.model,thinking:preset.thinking,proxyMode:'system',proxy:'',temperature:1,maxTokens:2048,timeoutSec:90,historyRounds:6};
}
function readForm(){
 const p=current();
 for(const [key,id] of Object.entries(fields))p[key]=$(id).value.trim();
 const typed=$('llm-key').value.trim();
 if(typed){typedKeys[p.id]=typed;clearKeys.delete(p.id);}else delete typedKeys[p.id];
 draft.vision={profile:$('llm-vision-profile').value,model:$('llm-vision-model').value.trim()};
}
function fillVision(){
 const v=draft.vision;
 if(!draft.profiles.some(p=>p.id===v.profile))v.profile='';
 $('llm-vision-profile').replaceChildren(new Option('跟聊天相同（使用中的配置）',''),...draft.profiles.map(item=>new Option(item.name,item.id)));
 $('llm-vision-profile').value=v.profile;$('llm-vision-model').value=v.model;
}
function fillForm(){
 const p=current();
 $('llm-profile').replaceChildren(...draft.profiles.map(item=>new Option(item.name+(state.enabled&&item.id===state.active?'（使用中）':''),item.id)));
 $('llm-profile').value=p.id;$('llm-preset').value=p.preset;
 for(const [key,id] of Object.entries(fields))$(id).value=p[key]??'';
 const saved=!!state.profiles.find(item=>item.id===p.id)?.hasKey&&!clearKeys.has(p.id);
 $('llm-key').value=typedKeys[p.id]||'';
 $('llm-key').placeholder=saved?'已保存（留空则不修改）':clearKeys.has(p.id)?'保存后清除已存的 Key':keyless(p)?'不需要，留空即可':'sk-…';
 $('llm-key-clear').hidden=!saved;
 $('llm-proxy-row').hidden=p.proxyMode!=='custom';
 $('llm-hint').textContent=state.presets.find(item=>item.id===p.preset)?.hint||'';
 $('llm-remove').disabled=busy||draft.profiles.length<=1;
 fillVision();
}
function apply(next){
 state=next;
 draft={enabled:next.enabled,active:next.active,profiles:next.profiles.map(({hasKey,...p})=>({...p})),vision:{profile:next.vision?.profile||'',model:next.vision?.model||''}};
 if(!draft.profiles.length)draft.profiles.push(blankProfile('deepseek'));
 selected=draft.profiles.some(p=>p.id===next.active)?next.active:draft.profiles[0].id;
 typedKeys={};clearKeys=new Set();$('llm-model-list').hidden=true;
 const p=next.profiles.find(item=>item.id===next.active);
 $('llm-enabled').checked=next.enabled;
 $('llm-summary').textContent=next.enabled&&p?`当前：${p.name} · ${p.model} · ${proxyLabel(p)}${p.hasKey||keyless(p)?'':' · 还没保存 Key'}`:'当前用 Codex 账号聊天；勾选上方开关并保存配置后改用第三方 API。';
 fillForm();
}
function expand(value){$('llm-form').hidden=!value;$('llm-toggle').textContent=value?'收起':'设置';$('llm-toggle').setAttribute('aria-expanded',String(value));}
async function run(body,pending){
 if(busy)return null;
 busy=true;status(pending);for(const id of buttons)$(id).disabled=true;
 try{const result=await window.pet.action('llm-command',body);if(result?.ok===false)throw new Error(result.message||'操作未成功');return result;}
 catch(error){status(error.message||'操作未成功，请稍后重试');return null;}
 finally{busy=false;for(const id of buttons)$(id).disabled=false;$('llm-remove').disabled=draft.profiles.length<=1;}
}
function target(){readForm();const p=current();return {profile:p,apiKey:typedKeys[p.id]||''};}
async function save(enabled,done){
 readForm();
 const result=await run({action:'save',config:{...draft,enabled,active:selected},keys:typedKeys,clearKeys:[...clearKeys]},'正在保存…');
 if(!result){$('llm-enabled').checked=state.enabled;return;}
 apply(result);status(done(result.profiles.find(p=>p.id===result.active)?.name,result.enabled));
}
$('llm-toggle').onclick=()=>expand($('llm-form').hidden);
$('llm-profile').onchange=()=>{readForm();selected=$('llm-profile').value;$('llm-model-list').hidden=true;fillForm();status('切换后点「保存」才会改用这个配置。');};
$('llm-add').onclick=()=>{readForm();const p=blankProfile('custom');p.name='新配置 '+(draft.profiles.length+1);draft.profiles.push(p);selected=p.id;$('llm-model-list').hidden=true;fillForm();status('已新增：选好服务商、填 Key 和模型后点「保存」。');};
$('llm-remove').onclick=()=>{
 const p=current();
 if(draft.profiles.length<=1||!confirm(`删除配置「${p.name}」？保存后生效，它的 Key 也会一并删除。`))return;
 draft.profiles=draft.profiles.filter(item=>item.id!==p.id);delete typedKeys[p.id];selected=draft.profiles[0].id;fillForm();status('已删除，点「保存」后生效。');
};
$('llm-preset').onchange=()=>{
 readForm();
 const p=current(),old=state.presets.find(item=>item.id===p.preset),preset=state.presets.find(item=>item.id===$('llm-preset').value);
 if(!p.name||p.name===old?.name||/^新配置/.test(p.name))p.name=preset.name;
 Object.assign(p,{preset:preset.id,baseUrl:preset.baseUrl,model:preset.model,thinking:preset.thinking});
 $('llm-model-list').hidden=true;fillForm();
};
$('llm-proxy-mode').onchange=()=>{$('llm-proxy-row').hidden=$('llm-proxy-mode').value!=='custom';if(!$('llm-proxy-row').hidden)$('llm-proxy').focus();};
$('llm-key-clear').onclick=()=>{readForm();clearKeys.add(selected);delete typedKeys[selected];fillForm();status('点「保存」后清除这个配置已存的 Key。');};
$('llm-fetch').onclick=async()=>{
 const result=await run({action:'models',...target()},'正在获取模型列表…');if(!result)return;
 const list=$('llm-model-list'),model=$('llm-model').value;
 list.replaceChildren(new Option(`从 ${result.models.length} 个模型中选择…`,''),...result.models.map(id=>new Option(id,id)));
 list.value=result.models.includes(model)?model:'';list.hidden=false;
 status(`找到 ${result.models.length} 个模型，在下拉框里选一个，再测试连接。`);
};
$('llm-model-list').onchange=()=>{if($('llm-model-list').value)$('llm-model').value=$('llm-model-list').value;};
$('llm-test').onclick=async()=>{
 const result=await run({action:'test',...target()},'正在测试连接…');if(!result)return;
 status(result.reply?`✅ 连接成功（${result.seconds} 秒），${result.model} 回复：${result.reply}`:`✅ 连接成功（${result.seconds} 秒），但模型没给出正文：开着思考模式时可能把输出都用来思考了，聊天一般不受影响。`);
};
$('llm-save').onclick=()=>save($('llm-enabled').checked,(name,enabled)=>enabled?`已保存，聊天现在使用「${name}」。`:'已保存。当前仍用 Codex 聊天，勾选上方开关即可切换。');
$('llm-vision-test').onclick=async()=>{
 readForm();
 const v=draft.vision,p=draft.profiles.find(item=>item.id===v.profile)||current();
 $('llm-vision-status').textContent=`正在把她的头像发给「${p.name}」看…`;
 const result=await run({action:'vision-test',profile:p,model:v.model,apiKey:typedKeys[p.id]||''},'正在测试识图…');
 $('llm-vision-status').textContent=result?`✅ 能看图（${result.seconds} 秒），${result.model} 说：${result.reply}`:`✗ ${$('llm-status').textContent}`;
 if(result)status('识图测试通过，记得点「保存」。');
};
$('llm-enabled').onchange=()=>{
 const on=$('llm-enabled').checked;if(on)expand(true);
 save(on,(name,enabled)=>enabled?`已启用：聊天改用「${name}」。`:'已切回 Codex 账号聊天，第三方配置仍保留。');
};
async function load(){
 try{
  const result=await window.pet.action('llm-state');
  if(result?.ok===false)throw new Error(result.message);
  $('llm-preset').replaceChildren(...result.presets.map(item=>new Option(item.name,item.id)));
  apply(result);$('llm-toggle').disabled=false;$('llm-enabled').disabled=false;
  if(!result.profiles.length)expand(true);
 }catch(error){$('llm-summary').textContent='模型设置暂时读不到：'+(error.message||'请稍后重试');setTimeout(load,3000);}
}
load();
})();
