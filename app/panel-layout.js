'use strict';
// Layout only: move the existing controls, never recreate their IDs or replace their IPC handlers.
(() => {
  const $ = id => document.getElementById(id);
  const pages = {
    pet: { title: '桌宠', icon: 'paw', tabs: [['display', '形象与显示', '桌宠 大小 显示 隐藏 白龙 大肥鱼 第二只 双宠 组合'], ['position', '初始位置', '初始 位置 固定 坐标 启动 保存 X Y 第二只'], ['visibility', '隐藏设置', '隐藏 全屏 游戏 视频 窗口 置顶 光标 鼠标 穿透 边缘 探头 吸边 左右'], ['motion', '动作与移动', '动作 奔跑 飞行 大幅'], ['drag', '拖拽设置', '拖动 拖拽 物理 下落 甩出 力度 锁定 Shift 碰撞 弹力 摩擦 体重 撞击']] },
    mood: { title: '心情与养成', icon: 'heart', tabs: [['status', '她的心情', '心情 精力 饱腹 亲密 喂白饭'], ['quiet', '陪伴与安静时段', '安静 时间 陪伴 作息']] },
    chat: { title: '聊天与人设', icon: 'chat', tabs: [['conversation', '和她聊天', '聊天 会话 记录 Codex'], ['persona', '她的人设', '人设 名字 性格 称呼 动作 状态'], ['memory', '我的画像', '画像 记忆 补充 纠正 隐私']] },
    reminders: { title: '提醒事项', icon: 'calendar', tabs: [['list', 'DDL 小便签', '提醒 DDL 任务 完成 延后'], ['new', '新建提醒', '新建 截止 日期 重复 每周 提前量']] },
    work: { title: '工作联动', icon: 'workflow', tabs: [['connections', '状态感知', '工作 Codex Harness 状态 开关'], ['bridge', 'Harness 桥接', 'Harness 桥接 安装 EXE Profile 启动 协议']] },
    model: { title: '模型与 API', icon: 'sparkles', tabs: [['source', '模型配置', '模型 API Key 服务商 地址 第三方 代理 思考'], ['advanced', '高级设置', '温度 超时 token 历史']] },
    general: { title: '通用与数据', icon: 'settings', tabs: [['general', '软件与数据', '数据 文件夹 高级配置 位置 配置文件'], ['quotes', '自定义语录', '语录 编辑 碎碎念'], ['about', '关于项目', '关于 版本 托盘 退出']] },
  };
  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    paw: '<ellipse cx="12" cy="16" rx="5" ry="4"/><ellipse cx="5" cy="9" rx="2" ry="2.6"/><ellipse cx="10" cy="5.8" rx="1.8" ry="2.4"/><ellipse cx="15" cy="5.8" rx="1.8" ry="2.4"/><ellipse cx="20" cy="9" rx="2" ry="2.6"/>',
    heart: '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-2 11 12 21 12 21S26 11 20 5Z"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2V11.5A8.5 8.5 0 0 1 11.5 3H13a8 8 0 0 1 8 8.5Z"/><path d="M7 9h10M7 13h7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18m-13 5 3 3 5-5"/>',
    workflow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v6m3-9h7a2 2 0 0 1 2 2v7"/>',
    sparkles: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Zm7-1v4m-2-2h4"/>',
    settings: '<path d="m9 3-.8 2.8-2.5 1-2.5-.7-2 3.5L3 11v2l-1.8 1.4 2 3.5 2.5-.7 2.5 1L9 21h6l.8-2.8 2.5-1 2.5.7 2-3.5L21 13v-2l1.8-1.4-2-3.5-2.5.7-2.5-1L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  document.querySelectorAll('[data-panel-icon]').forEach(node => { node.innerHTML = icon(node.dataset.panelIcon); });
  const content = $('panel-content');
  const roots = {};
  for (const id of Object.keys(pages)) {
    const root = document.createElement('div');
    root.id = 'panel-page-' + id;
    root.className = 'panel-page';
    root.setAttribute('role', 'tabpanel');
    roots[id] = root;
    content.append(root);
  }
  // A pane's own visibility is independent from hidden states managed by the feature modules.
  function pane(parent, tab, nodes, title) {
    const box = document.createElement('div');
    box.className = 'panel-pane';
    box.dataset.panelView = tab;
    if (title) {
      const heading = document.createElement('h2');
      heading.className = 'pane-heading'; heading.textContent = title; box.append(heading);
    }
    nodes.filter(Boolean).forEach(node => box.append(node));
    parent.append(box);
    return box;
  }
  function openDetails(node) {
    node.open = true; node.classList.add('panel-open-details');
    const summary = node.querySelector('summary');
    const heading = document.createElement('h3'); heading.className = 'panel-detail-heading'; heading.textContent = summary.textContent; summary.after(heading);
  }
  const character = document.querySelector('.character-card');
  const options = character.querySelector('.character-options');
  const behavior = character.querySelector('.skin-behavior');
  pane(character, 'display', [options, $('character-companion').closest('label'), $('pet-size-form'), document.querySelector('main > .actions')]);
  pane(character, 'position', [$('position-settings-form')]);
  pane(character, 'visibility', [$('display-settings-form')]);
  pane(character, 'motion', [behavior], '动作开关');
  pane(character, 'drag', [$('drag-settings-form')]);
  roots.pet.classList.add('pet-layout');
  roots.pet.append(character);
  character.append($('character-status'));
  const names = { dafeiyu: '大肥鱼', bailong: '白龙' };
  const media = {
    dafeiyu: 'backend/assets/webm/' + encodeURIComponent('待机呼吸休闲.webm'),
    bailong: 'backend/assets/characters/bailong/outputs/' + encodeURIComponent('白龙桌宠素材') + '/' + encodeURIComponent('透明WebM') + '/idle.webm',
  };
  function video(src, label) {
    const node = document.createElement('video'); node.src = src; node.muted = true;
    node.loop = true; node.playsInline = true; node.preload = 'metadata';
    node.setAttribute('aria-label', label); return node;
  }
  for (const id of Object.keys(names)) {
    const art = document.createElement('span'); art.className = 'character-art';
    art.append(video(media[id], names[id] + '待机动画'));
    $('character-' + id).prepend(art);
  }
  const preview = document.createElement('aside'); preview.className = 'pet-preview'; preview.dataset.panelView = 'display';
  preview.innerHTML = '<div class="preview-heading"><strong>桌面预览</strong><small>内置动画示意</small></div><div class="preview-stage"><p class="preview-bubble"></p><div class="preview-video"></div><small>YOUR LITTLE COMPANION</small></div><div class="preview-info"><strong id="panel-preview-name">正在读取…</strong><span id="panel-preview-size"></span></div>';
  const previewVideo = video(media.dafeiyu, '当前桌宠形象预览');
  preview.querySelector('.preview-video').append(previewVideo);
  roots.pet.append(preview);
  const presence = document.querySelector('.status-card'); $('panel-presence').append(presence);
  presence.querySelector('small').textContent = '在这里陪你';
  const mood = $('mood-card'); roots.mood.append(mood);
  pane(mood, 'status', [mood.querySelector('.mood-head'), $('mood-reason'), $('mood-bars'), $('mood-meals'), $('mood-talk'), $('mood-feeding')]);
  pane(mood, 'quiet', [$('mood-quiet')], '安静时段');
  mood.append($('mood-message'), $('mood-days'));
  const chat = document.querySelector('.chat-card'); roots.chat.append(chat);
  const preferences = chat.querySelector('.chat-preferences');
  const persona = $('persona-box'), profile = preferences.querySelector('details:not(#persona-box)');
  const chatMemoryLabel = $('chat-memory').closest('label');
  pane(chat, 'conversation', [chat.querySelector('.chat-toolbar'), $('chat-model-source'), $('chat-expanded'), $('chat-form'), $('chat-result')]);
  openDetails(persona); openDetails(profile);
  pane(chat, 'persona', [persona]);
  pane(chat, 'memory', [chatMemoryLabel, $('chat-memory-note'), profile]);
  preferences.remove();
  // Start with conversation history visible, using the original expansion handler.
  $('chat-expand').click();
  const reminders = $('reminder-card'); roots.reminders.append(reminders);
  pane(reminders, 'list', [$('reminder-list')]);
  pane(reminders, 'new', [$('reminder-parse'), $('reminder-confirm')]);
  reminders.append($('reminder-message'));
  const integrations = document.querySelector('.integrations-card'); roots.work.append(integrations);
  const bridge = integrations.querySelector('details'); openDetails(bridge);
  const connectionNodes = Array.from(integrations.children).filter(node => node.matches('.integration-row, .integration-status, .integration-note'));
  pane(integrations, 'connections', connectionNodes);
  pane(integrations, 'bridge', [bridge]);
  integrations.append($('integration-result'));
  const model = $('llm-card'); roots.model.append(model);
  const llmForm = $('llm-form');
  const advancedNodes = Array.from(llmForm.children).filter(node => node.tagName === 'DETAILS');
  advancedNodes.forEach(openDetails);
  const modelActions = llmForm.querySelector('.actions'), modelStatus = $('llm-status');
  const modelNote = llmForm.lastElementChild;
  const basicNodes = Array.from(llmForm.children).filter(node => !advancedNodes.includes(node) && ![modelActions, modelStatus, modelNote].includes(node));
  pane(llmForm, 'source', basicNodes);
  pane(llmForm, 'advanced', advancedNodes);
  llmForm.append(modelActions, modelStatus, modelNote);
  const llmFields = document.createElement('fieldset'); llmFields.className = 'panel-form-fields'; llmFields.disabled = true;
  llmFields.append(...Array.from(llmForm.children)); llmForm.append(llmFields);
  llmForm.hidden = false;
  $('llm-toggle').setAttribute('aria-expanded', 'true');
  const general = document.querySelector('.settings'); roots.general.append(general);
  pane(general, 'general', Array.from(general.querySelectorAll('[data-action="settings"], [data-action="folder"]')), '本地配置与数据');
  pane(general, 'quotes', [general.querySelector('[data-action="quotes"]')], '她的碎碎念');
  const about = pane(general, 'about', [], 'Codex-dafeiyu');
  const aboutText = document.createElement('p'); aboutText.className = 'about-copy'; aboutText.textContent = 'v1.6.0 · 你的桌面小伙伴'; about.append(aboutText);
  let page = 'pet', tab = 'display', searching = false, updatePending = false;
  const rememberedTabs = new Map(), scrollPositions = new Map();
  const saveTargets = {
    'pet/display': ['pet-size-apply', '应用大小', 'pet-size-status'],
    'pet/position': ['position-apply', '保存并应用位置', 'position-settings-status'],
    'pet/drag': ['drag-settings-apply', '应用拖拽设置', 'drag-settings-status'],
    'chat/persona': ['persona-save', '保存人设', 'persona-status'],
    'chat/memory': ['profile-save', '保存画像', 'profile-status'],
    'model/source': ['llm-save', '保存模型配置', 'llm-status'],
    'model/advanced': ['llm-save', '保存模型配置', 'llm-status'],
  };
  const immediateStatus = { pet: 'character-status', mood: 'mood-message', reminders: 'reminder-message', work: 'integration-result' };
  function target() {
    if (searching) return null;
    if (page === 'reminders' && tab === 'new') {
      const confirming = !$('reminder-confirm').hidden;
      const form = confirming ? $('reminder-confirm') : $('reminder-parse');
      return [form.querySelector('button[type="submit"]'), confirming ? '确认保存提醒' : '整理成提醒', 'reminder-message'];
    }
    const item = saveTargets[page + '/' + tab];
    return item ? [$(item[0]), ...item.slice(1)] : null;
  }
  function text(node, value) { if (node.textContent !== value) node.textContent = value; }
  function updateFooter() {
    // Expanded forms must remain unavailable until their original controllers have loaded real settings.
    if (llmFields.disabled !== $('llm-toggle').disabled) llmFields.disabled = $('llm-toggle').disabled;
    const current = target(), button = $('panel-save');
    button.hidden = !current;
    if (current) { text(button, current[1]); button.disabled = current[0].matches(':disabled'); }
    const status = current?.[2] || (page === 'pet' && tab === 'visibility' ? 'display-settings-status' : immediateStatus[page]);
    text($('panel-save-status'), searching ? '' : $(status)?.textContent || '');
  }
  function updatePreview() {
    const id = Object.keys(names).find(id => $('character-' + id).getAttribute('aria-pressed') === 'true') || 'dafeiyu';
    if (previewVideo.dataset.character !== id) { previewVideo.src = media[id]; previewVideo.dataset.character = id; }
    text($('panel-preview-name'), names[id]);
    const size = Math.min(500, Math.max(100, Number($('pet-size-number').value) || 400));
    text($('panel-preview-size'), size + ' px');
    text(preview.querySelector('.preview-bubble'), $('activity').textContent);
    const scale = .4 + .6 * (size - 100) / 400;
    preview.querySelector('.preview-video').style.setProperty('--preview-scale', scale);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.character-art video, .preview-video video').forEach(node => {
      const visible = page === 'pet' && tab === 'display' && !searching && !reduced;
      if (!visible) node.pause(); else if (node.paused) node.play().catch(() => {});
    });
  }
  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(() => { updatePending = false; updateFooter(); updatePreview(); });
  }
  function navigate(nextPage, nextTab, focus = false) {
    if (!pages[nextPage]) nextPage = 'pet';
    nextTab = nextTab || rememberedTabs.get(nextPage) || pages[nextPage].tabs[0][0];
    if (!pages[nextPage].tabs.some(item => item[0] === nextTab)) nextTab = pages[nextPage].tabs[0][0];
    if (!searching) scrollPositions.set(page + '/' + tab, content.scrollTop);
    page = nextPage; tab = nextTab; rememberedTabs.set(page, tab); searching = false;
    $('panel-search').value = ''; searchResults.hidden = true;
    for (const [id, root] of Object.entries(roots)) {
      root.hidden = id !== page;
      root.querySelectorAll('[data-panel-view], [data-panel-views]').forEach(node => node.classList.toggle('panel-pane-inactive', !(node.dataset.panelViews || node.dataset.panelView).split(' ').includes(tab)));
    }
    document.querySelectorAll('[data-panel-page]').forEach(node => {
      node.classList.toggle('active', node.dataset.panelPage === page);
      if (node.dataset.panelPage === page) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    });
    text($('panel-title'), pages[page].title); text($('panel-breadcrumb'), pages[page].title);
    text($('character-title'), page === 'pet' && tab === 'visibility' ? '隐藏、置顶与吸边' : tab === 'drag' && page === 'pet' ? '拖拽设置' : '桌面形象');
    for (const id of ['character-active', 'character-status']) $(id).classList.toggle('panel-pane-inactive', page === 'pet' && ['drag', 'visibility'].includes(tab));
    const tabs = $('panel-tabs'); tabs.hidden = false; tabs.setAttribute('aria-label', pages[page].title + '页签'); tabs.replaceChildren();
    for (const [id, label] of pages[page].tabs) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.id = 'panel-tab-' + id; button.dataset.panelTab = id; button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(id === tab)); button.setAttribute('aria-controls', roots[page].id); button.tabIndex = id === tab ? 0 : -1;
      button.onclick = () => navigate(page, id); tabs.append(button);
    }
    roots[page].setAttribute('aria-labelledby', 'panel-tab-' + tab);
    content.scrollTop = scrollPositions.get(page + '/' + tab) || 0;
    // These forms are now permanently expanded; their sub-panes provide progressive disclosure.
    if (page === 'model') llmForm.hidden = false;
    updateFooter(); updatePreview();
    if (focus) $('panel-tab-' + tab).focus();
  }
  const nav = $('panel-navigation');
  for (const [id, config] of Object.entries(pages)) {
    if (id === 'pet' || id === 'work') {
      const label = document.createElement('p'); label.className = 'panel-nav-label'; label.textContent = id === 'pet' ? '我的小伙伴' : '连接与管理'; nav.append(label);
    }
    const button = document.createElement('button'); button.type = 'button'; button.dataset.panelPage = id;
    button.innerHTML = icon(config.icon) + '<span></span>'; button.querySelector('span').textContent = config.title;
    button.onclick = () => navigate(id); nav.append(button);
  }
  const searchResults = document.createElement('div'); searchResults.className = 'panel-search-results'; searchResults.hidden = true; content.append(searchResults);
  const searchIndex = Object.entries(pages).flatMap(([id, config]) => config.tabs.map(([view, label, keywords]) => ({ page: id, tab: view, label, title: config.title, terms: (config.title + ' ' + label + ' ' + keywords).toLowerCase() })));
  $('panel-search').addEventListener('input', () => {
    const query = $('panel-search').value.trim().toLowerCase();
    if (!query) { navigate(page, tab); return; }
    if (!searching) scrollPositions.set(page + '/' + tab, content.scrollTop);
    searching = true; for (const root of Object.values(roots)) root.hidden = true;
    $('panel-tabs').hidden = true; searchResults.hidden = false; searchResults.replaceChildren();
    text($('panel-title'), '搜索设置'); text($('panel-breadcrumb'), '搜索');
    const matches = searchIndex.filter(item => query.split(/\s+/).every(word => item.terms.includes(word)));
    for (const result of matches) {
      const button = document.createElement('button'); button.type = 'button';
      const strong = document.createElement('strong'); strong.textContent = result.label;
      const small = document.createElement('small'); small.textContent = result.title + ' › ' + result.label;
      button.append(strong, small); button.onclick = () => navigate(result.page, result.tab, true); searchResults.append(button);
    }
    if (!matches.length) { const note = document.createElement('p'); note.textContent = '没有找到相关设置，试试「大小」「安静」「API」等关键词。'; searchResults.append(note); }
    content.scrollTop = 0; updateFooter(); updatePreview();
  });
  function saveCurrent() {
    const current = target(); if (!current || current[0].matches(':disabled')) return;
    const button = current[0];
    if (button.type === 'submit' && button.form) button.form.requestSubmit(button); else button.click();
    scheduleUpdate();
  }
  $('panel-save').onclick = saveCurrent;
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveCurrent(); }
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) { event.preventDefault(); $('panel-search').focus(); }
    if (event.target === $('panel-search') && event.key === 'Escape') { event.preventDefault(); navigate(page, tab, true); }
    if (event.target === $('panel-search') && event.key === 'Enter' && searching) { event.preventDefault(); searchResults.querySelector('button')?.click(); }
    if (event.target.matches('[data-panel-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const list = pages[page].tabs, index = list.findIndex(item => item[0] === tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      navigate(page, list[next][0], true);
    }
  });
  content.addEventListener('input', scheduleUpdate);
  window.addEventListener('pet-character-changed', scheduleUpdate);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', scheduleUpdate);
  // Editing an existing reminder must reveal its confirmation form in the new-reminder pane.
  const reminderObserver = new MutationObserver(() => {
    if (!$('reminder-confirm').hidden && (page !== 'reminders' || tab !== 'new' || searching)) navigate('reminders', 'new');
    scheduleUpdate();
  });
  reminderObserver.observe($('reminder-confirm'), { attributes: true, attributeFilter: ['hidden'] });
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-pressed'] });
  observer.observe(presence, { subtree: true, childList: true, characterData: true });
  window.addEventListener('beforeunload', () => { observer.disconnect(); reminderObserver.disconnect(); });
  window.addEventListener('pet-manager-open', event => {
    if (event.detail?.view === 'reminders') navigate('reminders', 'list');
  });
  navigate('pet', 'display');
  document.body.classList.add('panel-layout-ready');
})();
