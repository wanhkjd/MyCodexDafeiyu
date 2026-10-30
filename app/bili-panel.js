'use strict';
// 「她的 B 站」卡片：总开关、今天的状态、现在叫醒她、她的分享（打开 / 👍 / 👎）、两本日记，以及账号、作息、口味、看画面和分享的设置。
// 第一期只读：她不会在 B 站上发任何东西。登录凭据只在主进程里，这里只看得到账号名。
(() => {
  const card = document.createElement('section');
  card.id = 'bili-card';
  card.className = 'quota-card llm-card bili-card';
  card.innerHTML = `<div class="section-title"><h2>她的 B 站</h2><label class="mood-toggle"><input type="checkbox" id="bili-enabled" disabled>开启 B 站生活</label></div>
<p id="bili-summary" class="muted">正在读取…</p>
<p id="bili-progress" class="bili-progress" role="status" hidden></p>
<div class="bili-row"><button id="bili-wake" type="button" hidden>现在叫醒她</button><button id="bili-toggle" class="text-button" type="button" aria-expanded="false">设置</button></div>
<div id="bili-shares-box" hidden><h3>她的分享</h3><div id="bili-shares"></div></div>
<details id="bili-diary-box" hidden><summary>她的日记</summary>
<div class="bili-tabs"><button type="button" id="bili-tab-letter" aria-pressed="true">给你的信</button><button type="button" id="bili-tab-private" aria-pressed="false">她自己的日记</button></div>
<p id="bili-private-note" class="muted" hidden>这本是她写给自己的，她知道你能看到。</p><div id="bili-diary"></div></details>
<div id="bili-form" hidden>
<h3>账号</h3><p id="bili-account" class="muted"></p>
<div class="bili-row"><button id="bili-login" type="button">扫码登录</button><button id="bili-logout" type="button" hidden>退出登录</button></div>
<div id="bili-qr" hidden><img id="bili-qr-img" alt="B 站登录二维码" width="200" height="200"><p id="bili-qr-status" class="muted" role="status"></p><button id="bili-qr-cancel" type="button">取消</button></div>
<p class="muted">请扫「给她用的那个号」，别扫成你自己的号。登录凭据用系统加密只存在本机，界面上看不到。</p>
<div class="llm-grid"><label>你的 B 站 mid<input id="bili-owner-mid" inputmode="numeric" maxlength="20" placeholder="你个人空间网址里的数字"></label><label>你的 B 站昵称<input id="bili-owner-name" maxlength="30"></label></div>
<p class="muted">现在只用来在素材里给你打码；第二期起用于 @ 你和私信你。</p>
<h3>作息</h3><div id="bili-windows"></div><button id="bili-window-add" type="button">＋ 加一个时段</button>
<div class="llm-grid"><label>不想看的概率（%）<input id="bili-skip" type="number" min="0" max="95" step="5"></label><label>每次挑几条<input id="bili-videos" type="number" min="1" max="8" step="1"></label></div>
<h3>口味</h3><label>爱看（用逗号分开）<input id="bili-likes" maxlength="300"></label><label>不看（用逗号分开）<input id="bili-dislikes" maxlength="300"></label>
<h3>看画面</h3><label class="memory-toggle"><input type="checkbox" id="bili-frames">细看时也看画面（截 9 帧拼成九宫格，交给识图模型）</label><p id="bili-vision" class="muted"></p>
<h3>分享</h3><label class="memory-toggle"><input type="checkbox" id="bili-share">把值得看的分享给你（在桌面上冒泡）</label>
<label>每天最多分享<select id="bili-daily"><option value="1">1 条</option><option value="2">2 条</option><option value="3">3 条</option></select></label>
<p class="muted">13 分以上（满分 20）才分享，同一条 7 天内不重复；你很久不理她的分享，她会自己变安静。</p>
<div class="actions"><button id="bili-save" type="button" class="primary">保存</button></div><p id="bili-status" role="status"></p>
</div>`;
  (document.querySelector('.chat-card') || document.querySelector('.settings')).after(card);
  const $ = id => document.getElementById(id);
  let state = null, windows = [], diaryTab = 'letter', qr = null, qrTimer = 0, pollTimer = 0, dirty = false;
  const act = (action, body) => window.pet.action(action, body);
  const status = text => { $('bili-status').textContent = text; };
  const pad = n => String(n).padStart(2, '0');
  const timeOf = at => { const d = new Date(at); return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const words = value => value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);

  function summary(s) {
    if (!s.enabled) return '关着：她不会去 B 站。打开后，她会在你设定的时段里随机醒来刷 B 站、写日记，把值得看的分享给你。';
    const warn = !s.llm.ready ? '⚠ 先在「聊天用的大模型」里启用第三方 API，她才能看懂视频。'
      : s.api.banned ? `⚠ B 站限流中，约 ${s.api.bannedMinutes} 分钟后恢复。` : '';
    const next = s.plan.find(w => w.state === 'planned');
    const today = `今天：醒了 ${s.today.wakes} 次，看了 ${s.today.watched} 条，分享 ${s.today.shared.length} 条`;
    const plan = next ? `下次醒来约 ${next.time}` : '今天的作息已经结束';
    const who = s.account ? `登录：${s.account.name}` : '未登录（读不到大部分字幕，建议扫码登录她的号）';
    const quiet = s.silence.band === 'quiet' ? `；你已经 ${s.silence.days} 天没回应她的分享了，她安静了一些` : s.silence.band === 'faint' ? `；你已经 ${s.silence.days} 天没回应她的分享了，她暂时不分享了` : '';
    const last = s.lastWake && !s.lastWake.ok && s.lastWake.message ? `\n上次醒来（${timeOf(s.lastWake.at)}）没看成：${s.lastWake.message}` : '';
    return [warn, `${today} · ${plan} · ${who}${quiet}`].filter(Boolean).join('\n') + last;
  }

  function renderShares(items) {
    $('bili-shares-box').hidden = !items.length;
    $('bili-shares').replaceChildren(...items.map(item => {
      const row = document.createElement('article');
      row.className = 'bili-share';
      if (item.cover) { const img = document.createElement('img'); img.src = item.cover; img.alt = ''; row.append(img); }
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `《${item.title}》`;
      const meta = document.createElement('small'); meta.textContent = `${item.up} · ${item.score} 分 · ${timeOf(item.at)}${item.opened ? ' · 你看过了' : ''}`;
      const line = document.createElement('p'); line.textContent = item.line.replace(/\[\s*动作\s*[:：][^\]]*\]/g, '').trim() || item.highlight;
      const reason = document.createElement('p'); reason.className = 'muted'; reason.textContent = '为什么想给你看：' + item.reason;
      const actions = document.createElement('div'); actions.className = 'bili-row';
      const button = (label, kind, pressed) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
        b.onclick = async () => {
          b.disabled = true;
          try {
            if (kind === 'open') { const r = await act('bili-open', item.bvid); if (r?.ok === false) throw new Error(r.message); }
            apply(await command({ action: 'react', id: item.id, kind }));
          } catch (error) { status(error.message); } finally { b.disabled = false; }
        };
        return b;
      };
      actions.append(button('打开看看', 'open'), button('👍 喜欢', 'like', item.reaction === 'like'), button('👎 不喜欢', 'dislike', item.reaction === 'dislike'));
      body.append(title, meta, line, reason, actions);
      row.append(body);
      return row;
    }));
  }

  /** Diary text with its markdown table (the list of videos at the end of a letter) shown as a real table. */
  function diaryBody(text) {
    const box = document.createElement('div');
    const blocks = [];
    for (const line of text.split('\n')) {
      const row = /^\s*\|.*\|\s*$/.test(line);
      const last = blocks.at(-1);
      if (last && last.table === row) last.lines.push(line); else blocks.push({ table: row, lines: [line] });
    }
    for (const block of blocks) {
      if (!block.table) { const p = document.createElement('p'); p.textContent = block.lines.join('\n').trim(); if (p.textContent) box.append(p); continue; }
      const table = document.createElement('table');
      for (const line of block.lines.filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l))) {
        const tr = document.createElement('tr');
        for (const cell of line.trim().slice(1, -1).split('|')) tr.append(Object.assign(document.createElement(table.rows.length ? 'td' : 'th'), { textContent: cell.trim() }));
        table.append(tr);
      }
      box.append(table);
    }
    return box;
  }

  function renderDiary() {
    const entries = state ? state[diaryTab] : [];
    $('bili-tab-letter').setAttribute('aria-pressed', String(diaryTab === 'letter'));
    $('bili-tab-private').setAttribute('aria-pressed', String(diaryTab === 'private'));
    $('bili-private-note').hidden = diaryTab !== 'private';
    $('bili-diary').replaceChildren(...(entries.length ? entries.map(entry => {
      const box = document.createElement('article'); box.className = 'bili-entry';
      const h = document.createElement('h4'); h.textContent = entry.title;
      box.append(h, diaryBody(entry.body));
      return box;
    }) : [Object.assign(document.createElement('p'), { className: 'muted', textContent: '还没写过。她醒来一次就会写。' })]));
  }

  function renderWindows() {
    $('bili-windows').replaceChildren(...windows.map((w, i) => {
      const row = document.createElement('div'); row.className = 'bili-window';
      const field = (key, label, attrs) => {
        const input = Object.assign(document.createElement('input'), { value: String(w[key]), ...attrs });
        input.setAttribute('aria-label', label);
        input.oninput = () => { windows[i][key] = key === 'wakes' ? Number(input.value) : input.value.trim(); dirty = true; };
        return input;
      };
      const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '删除', disabled: windows.length <= 1 });
      remove.onclick = () => { windows.splice(i, 1); dirty = true; renderWindows(); };
      const to = document.createElement('span'); to.textContent = '到';
      const times = document.createElement('span'); times.textContent = '醒';
      const unit = document.createElement('span'); unit.textContent = '次';
      row.append(field('start', '开始时间', { maxLength: 5, placeholder: '20:00' }), to, field('end', '结束时间', { maxLength: 5, placeholder: '24:00' }),
        times, field('wakes', '醒几次', { type: 'number', min: 0, max: 4, step: 1 }), unit, remove);
      return row;
    }));
    $('bili-window-add').disabled = windows.length >= 3;
  }

  function fillForm(s) {
    const c = s.settings;
    windows = c.night.windows.map(w => ({ ...w }));
    renderWindows();
    $('bili-owner-mid').value = c.owner.mid;
    $('bili-owner-name').value = c.owner.name;
    $('bili-skip').value = Math.round(c.night.skipChance * 100);
    $('bili-videos').value = c.night.videos;
    $('bili-likes').value = c.likes.join('，');
    $('bili-dislikes').value = c.dislikes.join('，');
    $('bili-frames').checked = c.frames;
    $('bili-share').checked = c.share.enabled;
    $('bili-daily').value = String(Math.max(1, c.share.daily));
    dirty = false;
  }

  function apply(s) {
    if (!s || s.ok === false) throw new Error(s?.message || 'B 站生活暂时读不到');
    const first = !state;
    state = s;
    $('bili-enabled').checked = s.enabled;
    $('bili-enabled').disabled = false;
    $('bili-summary').textContent = summary(s);
    $('bili-progress').hidden = !s.running;
    $('bili-progress').textContent = s.running ? '🐟 ' + (s.progress || '她在 B 站上…') : '';
    $('bili-wake').hidden = !s.enabled;
    $('bili-wake').disabled = s.running;
    renderShares(s.shares);
    $('bili-diary-box').hidden = !s.letter.length && !s.private.length;
    renderDiary();
    $('bili-account').textContent = s.account ? `已登录：${s.account.name}（mid ${s.account.mid}）` : '还没登录。不登录也能用，但只能刷搜索、热门和排行榜，很多视频读不到字幕。';
    $('bili-logout').hidden = !s.account;
    $('bili-login').textContent = s.account ? '换个号扫码' : '扫码登录';
    $('bili-vision').textContent = s.vision.ok
      ? `识图：用「${s.vision.name}」的 ${s.vision.model}${s.vision.sameAsChat ? '（和聊天相同，不能看图的模型会在「测试识图」时露馅）' : ''}`
      : '⚠ 还没有识图配置：在「聊天用的大模型」→「识图」里选好并点「测试识图」。';
    if (first || !dirty) fillForm(s);
    schedule(s.running ? 2500 : 20000);
  }

  async function command(body) {
    const result = await act('bili-command', body);
    if (result?.ok === false) throw new Error(result.message || '操作没有成功');
    return result;
  }
  async function refresh() {
    try { apply(await act('bili-state')); } catch (error) { $('bili-summary').textContent = 'B 站生活暂时读不到：' + error.message; schedule(5000); }
  }
  function schedule(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, ms); }
  function expand(open) {
    $('bili-form').hidden = !open;
    $('bili-toggle').textContent = open ? '收起设置' : '设置';
    $('bili-toggle').setAttribute('aria-expanded', String(open));
  }

  $('bili-toggle').onclick = () => expand($('bili-form').hidden);
  $('bili-tab-letter').onclick = () => { diaryTab = 'letter'; renderDiary(); };
  $('bili-tab-private').onclick = () => { diaryTab = 'private'; renderDiary(); };
  $('bili-window-add').onclick = () => { windows.push({ start: '12:30', end: '13:30', wakes: 1 }); dirty = true; renderWindows(); };
  for (const id of ['bili-owner-mid', 'bili-owner-name', 'bili-skip', 'bili-videos', 'bili-likes', 'bili-dislikes', 'bili-frames', 'bili-share', 'bili-daily']) {
    $(id).addEventListener('input', () => { dirty = true; });
    $(id).addEventListener('change', () => { dirty = true; });
  }
  $('bili-enabled').onchange = async () => {
    const on = $('bili-enabled').checked;
    $('bili-enabled').disabled = true;
    try {
      apply(await command({ action: 'enable', enabled: on }));
      if (on && !state.account) { expand(true); status('第一步：扫码登录她的 B 站号。不登录也能用，但读不到大部分字幕。'); }
      else status(on ? '打开了：她会在你设定的时段里自己醒来。想马上看看，就点「现在叫醒她」。' : '关掉了：她不会再去 B 站，日记和分享都还在。');
    } catch (error) { $('bili-enabled').checked = !on; status(error.message); } finally { $('bili-enabled').disabled = false; }
  };
  $('bili-wake').onclick = async () => {
    $('bili-wake').disabled = true;
    try { apply(await command({ action: 'wake' })); } catch (error) { status(error.message); $('bili-wake').disabled = false; }
  };
  $('bili-save').onclick = async () => {
    $('bili-save').disabled = true;
    try {
      const settings = {
        owner: { mid: $('bili-owner-mid').value.trim(), name: $('bili-owner-name').value.trim() },
        night: { windows, skipChance: Number($('bili-skip').value) / 100, videos: Number($('bili-videos').value) },
        likes: words($('bili-likes').value), dislikes: words($('bili-dislikes').value),
        frames: $('bili-frames').checked, share: { enabled: $('bili-share').checked, daily: Number($('bili-daily').value) },
      };
      if (settings.owner.mid && !/^\d{1,20}$/.test(settings.owner.mid)) throw new Error('mid 只能是数字，在你的 B 站个人空间网址里能看到');
      dirty = false;
      apply(await command({ action: 'settings', settings }));
      fillForm(state);
      status(settings.frames && !state.vision.ok ? '已保存。不过还没有识图配置，看画面要等配好识图模型才生效。' : '已保存，作息从现在起按新的来。');
    } catch (error) { dirty = true; status(error.message); } finally { $('bili-save').disabled = false; }
  };

  // QR login: the manager talks to Bilibili; this card only shows the code and the status.
  const QR_TEXT = { waiting: '用 B 站 App 扫一扫（约 3 分钟内有效）', scanned: '扫好了，请在手机上点「确认登录」', expired: '二维码过期了，请重新生成', cancelled: '已取消' };
  function stopQr() { clearTimeout(qrTimer); qr = null; $('bili-qr').hidden = true; }
  async function pollQr() {
    if (!qr) return;
    try {
      const r = await act('bili-login', { op: 'poll', id: qr.id });
      if (r.status === 'success') { stopQr(); status(`已登录：${r.account?.name ?? ''}。她以后用这个号刷 B 站。`); setTimeout(refresh, 600); return; }
      $('bili-qr-status').textContent = r.message || QR_TEXT[r.status] || '…';
      if (['expired', 'cancelled', 'error'].includes(r.status)) { $('bili-qr-img').hidden = true; qr = null; return; }
      qrTimer = setTimeout(pollQr, 2000);
    } catch (error) { $('bili-qr-status').textContent = error.message; qr = null; }
  }
  $('bili-login').onclick = async () => {
    $('bili-login').disabled = true;
    try {
      const r = await act('bili-login', { op: 'start' });
      if (!r?.image) throw new Error(r?.message || '二维码生成失败，请重试');
      qr = r;
      $('bili-qr').hidden = false;
      $('bili-qr-img').hidden = false;
      $('bili-qr-img').src = r.image;
      $('bili-qr-status').textContent = QR_TEXT.waiting;
      clearTimeout(qrTimer);
      qrTimer = setTimeout(pollQr, 2000);
    } catch (error) { status(error.message); } finally { $('bili-login').disabled = false; }
  };
  $('bili-qr-cancel').onclick = async () => { if (qr) await act('bili-login', { op: 'cancel', id: qr.id }).catch(() => {}); stopQr(); };
  $('bili-logout').onclick = async () => {
    if (!confirm('退出她的 B 站登录？之后她只能刷搜索、热门和排行榜。')) return;
    try { await act('bili-login', { op: 'logout' }); status('已退出登录。'); setTimeout(refresh, 600); } catch (error) { status(error.message); }
  };

  window.addEventListener('beforeunload', () => { clearTimeout(pollTimer); clearTimeout(qrTimer); });
  refresh();
})();
