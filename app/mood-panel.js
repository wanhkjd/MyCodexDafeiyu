'use strict';
// 「大肥鱼现在」卡片：心情、原因、三项数值、今天说了多少话，以及心情系统和安静时段的开关（只读本地计算结果，不调用模型）。
(() => {
  const NAMES = { 睡着: '睡着了', 傲娇: '有点傲娇', 担心: '在担心你', 开心: '很开心', 饿: '饿了', 困: '困了', 寂寞: '有点寂寞', 元气: '元气满满', 平常: '心情平常' };
  const card = document.createElement('section');
  card.id = 'mood-card';
  card.className = 'quota-card';
  card.innerHTML = `<div class="section-title"><h2>大肥鱼现在</h2><label class="mood-toggle"><input type="checkbox" id="mood-enabled">启用心情</label></div>
<p class="mood-head"><span id="mood-emoji" class="mood-emoji" aria-hidden="true"></span><strong id="mood-name">正在感受中…</strong></p>
<p id="mood-reason" class="muted"></p><div id="mood-bars"></div><p id="mood-meals" class="muted"></p><p id="mood-talk" class="muted"></p>
<p class="mood-feeding muted" id="mood-feeding">喂白饭：右击桌宠选择“喂白饭”，屏幕上会随机出现一碗白饭。拖到桌宠身上松手喂食；松在别处可以继续拖，右击饭碗可取消。<br><small>饱腹 +15 · 亲密按日常规则增加</small></p>
<div class="mood-quiet" id="mood-quiet"><label class="mood-toggle"><input type="checkbox" id="quiet-enabled">安静时段</label>
<input type="time" id="quiet-start" aria-label="安静时段开始" value="23:00"><span>至</span><input type="time" id="quiet-end" aria-label="安静时段结束" value="08:00"></div>
<p id="mood-message" class="muted" role="status"></p>
<small id="mood-days" class="muted"></small>`;
  document.querySelector('.character-card').after(card);
  const get = id => document.getElementById(id);

  function bar(label, value) {
    const row = document.createElement('div'); row.className = 'quota-row';
    const line = document.createElement('div'); line.className = 'quota-label';
    const name = document.createElement('span'); name.textContent = label;
    const number = document.createElement('strong'); number.textContent = String(value);
    line.append(name, number);
    const track = document.createElement('div'); track.className = 'bar';
    const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = Math.max(0, Math.min(100, value)) + '%';
    track.append(fill); row.append(line, track);
    return row;
  }

  function talkLine(view) {
    const parts = [`今天主动说了 ${view.talk.today} / ${view.talk.limit} 句`];
    if (view.quiet.active) parts.push('安静时段中，她不主动说话');
    else if (view.presence === 'away' || view.presence === 'locked') parts.push('你暂时离开了，她安静等你回来');
    else if (view.talk.ignored) parts.push('你最近没理她，她在慢慢少说');
    return parts.join(' · ');
  }

  function render(view) {
    if (!view?.ok) { get('mood-name').textContent = view?.message || '心情暂时读不到'; get('mood-feeding').hidden = true; return; }
    get('mood-enabled').checked = view.enabled;
    get('mood-feeding').hidden = !view.enabled;
    get('mood-days').textContent = `陪伴第 ${view.days} 天${view.festival ? ' · 今天是' + view.festival : ''} · 心情只在本机计算，不调用模型`;
    get('mood-quiet').hidden = !view.enabled;
    if (!['quiet-start', 'quiet-end'].includes(document.activeElement?.id)) {
      get('quiet-enabled').checked = view.quiet.enabled;
      get('quiet-start').value = view.quiet.start;
      get('quiet-end').value = view.quiet.end;
    }
    if (!view.enabled) {
      get('mood-emoji').textContent = '';
      get('mood-name').textContent = '心情系统已关闭';
      get('mood-reason').textContent = '桌宠保持原来的随机动作和语录。';
      get('mood-bars').replaceChildren(); get('mood-meals').textContent = ''; get('mood-talk').textContent = '';
      return;
    }
    get('mood-emoji').textContent = view.emoji;
    get('mood-name').textContent = NAMES[view.label] || view.label;
    get('mood-reason').textContent = '原因：' + view.reason;
    get('mood-bars').replaceChildren(bar('精力', view.energy), bar('饱腹', view.satiety), bar(view.tier ? `亲密 · ${view.tier}` : '亲密', view.affection));
    get('mood-meals').textContent = '今天：' + view.meals.map(m => `${m.name}${m.eaten ? ' ✓' : m.missed ? ' 没吃上' : m.passed ? ' —' : ' …'}`).join(' · ');
    get('mood-talk').textContent = talkLine(view);
  }

  async function refresh() {
    try { render(await window.pet.action('mood-state')); } catch { /* The status card already explains connection problems. */ }
  }
  async function send(settings, control) {
    control.disabled = true; get('mood-message').textContent = '';
    try {
      const view = await window.pet.action('mood-command', { action: 'settings', ...settings });
      if (view?.ok === false) get('mood-message').textContent = view.message || '设置未保存';
      else render(view);
    } catch (error) { get('mood-message').textContent = error.message || '暂时无法连接桌宠'; }
    finally { control.disabled = false; }
  }
  get('mood-enabled').onchange = () => send({ enabled: get('mood-enabled').checked }, get('mood-enabled'));
  for (const id of ['quiet-enabled', 'quiet-start', 'quiet-end']) {
    get(id).onchange = () => send({ quiet: { enabled: get('quiet-enabled').checked, start: get('quiet-start').value, end: get('quiet-end').value } }, get(id));
  }
  let stopped = false;
  window.addEventListener('beforeunload', () => { stopped = true; });
  (async function loop() { await refresh(); if (!stopped) setTimeout(loop, 5000); })();
})();
