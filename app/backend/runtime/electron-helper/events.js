/**
 * dsh-pet desktop helper —— 事件联动（碎碎念 / 广播 / 工作状态）。
 *
 * 展示与 tick 回调经 PetSprite.prototype 挂载（运行时可解析，顺序无碍）；
 * startLoops 是全部轮询的组装入口（boot 后调用）。依赖 constants.js / sprite.js。
 */
'use strict';

// Public Codex text is display-only; it never enters chats, logs or persistent storage.
const CODEX_PROGRESS_DURATION_MS = 10000;
const CODEX_NOTICE_DURATION_MS = 15000;
function codexBubbleView(sprite) {
  const data = sprite.codexProgress;
  if (!sprite.pet.workStatusEnabled || !data?.enabled) return null;
  const fresh = n => Date.now() - n.at < (n.kind === 'progress' ? CODEX_PROGRESS_DURATION_MS : CODEX_NOTICE_DURATION_MS);
  const active = data.current || [];
  const current = active.filter(n => n.text && fresh(n));
  const important = new Map((data.notices || []).filter(n => fresh(n) &&
    !sprite.codexBaseline?.has(n.key + ':' + n.at)).map(n => [n.key, n]));
  for (const n of current) if (n.kind === 'waiting') important.set(n.key, n);
  const notices = important.size ? [...important.values()] : [...current].sort((a,b) => b.at - a.at).slice(0, 1);
  // Public progress is temporary, but the running state is not. Never use a
  // waiting/terminal/missing turn as evidence that Codex is still executing.
  if (!notices.length) return active.some(n => n.kind === 'progress')
    ? { important: false, text: '撰写回复中' } : null;
  // No project/status heading. Keep failure/interruption explicit within the sentence.
  const prefix = { failed: '任务失败：', interrupted: '任务已中断：', waiting: '需要确认：', unknown: '状态待确认：' };
  return { important: !!important.size, text: notices.map(n => (prefix[n.kind] || '') + n.text).join('\n\n') };
}
function refreshCodexBubble(sprite) {
  window.clearTimeout(sprite.codexBubbleTimer);
  sprite.renderBubble();
  // Expiry is based on the original event time, never on polling or rendering time.
  // The backend retains deduplication state, but an unchanged message must stay hidden.
  const remaining = [...(sprite.codexProgress?.current || []), ...(sprite.codexProgress?.notices || [])]
    .filter(n => n.text).map(n => n.at + (n.kind === 'progress' ? CODEX_PROGRESS_DURATION_MS : CODEX_NOTICE_DURATION_MS) - Date.now()).filter(ms => ms > 0);
  if (remaining.length) sprite.codexBubbleTimer = window.setTimeout(() => refreshCodexBubble(sprite), Math.min(...remaining) + 10);
}
function applyCodexProgress(data, baseline = false) {
  for (const sprite of sprites) {
    if (baseline) sprite.codexBaseline = new Set((data?.notices || []).map(n => n.key + ':' + n.at));
    sprite.codexProgress = data;
    refreshCodexBubble(sprite);
  }
}

// ---- 工作状态联动（DSH 会话状态，每只宠物按 workStatusEnabled 门控；容器 1s 轮询，ts 变化才递增 tick）----
// 气泡驻留语义与浏览器一致：thinking/working/result/waiting（"事情还没完"）常驻直到状态切走；
//   success/error（"这事结束了"）10s 自动收起；state=null（空闲/回合被打断）收起气泡回待机。
// 动画循环语义：进行中档位循环播（switchTo once=false），终态档位播一遍回 idle 链；
//   回空闲时把正在循环的那段改成"播完即停"（见下面空闲分支），否则 ended 永不触发、链回不去。
PetSprite.prototype.onWorkTick = function onWorkTick(snapshot, tick) {
  if (!this.pet.workStatusEnabled) return; // 未启用工作状态联动 -> 该宠物完全免疫（与浏览器一致）
  if (tick === 0 || tick === this.prevWorkTick) return;
  this.prevWorkTick = tick;
  const state = snapshot && snapshot.state ? snapshot.state : null;
  this.workSource = snapshot?.source || null;
  this.workState = state; // 当前工作状态：互动/事件动画播完恢复档位循环用（与浏览器 workStatusRef 同用途）
  const stateChanged = this.prevWorkState !== state;
  this.prevWorkState = state;
  if (!state) {
    // 回空闲：把正在**循环播**的进行中档位动画改成"播完即停"（与浏览器 src/client/pet.ts 的空闲分支
    // 同一处修复）。进行中档位走 switchTo(name, false)（el.loop=true、el.onended=null），ended 永不
    // 触发；而这里不切动画（原设计"由常规动画链回待机"），链因此拿不到推进信号 —— 宠物会一直卡在
    // 那段工作动画上。只把当前段改成播完即停：它结束后走 handleEnded → resumeWorkStatusAnim() 返回
    // false → playIdle；工作期间的原生 loop 不受影响。
    if (S.poolIncludes(this.animations.events?.workStatus ?? [], this.anim)) {
      const frontEl = this.front === 0 ? this.videoA : this.videoB;
      if (frontEl) {
        frontEl.loop = false;
        frontEl.onended = () => this.handleEnded();
      }
    }
    // 空闲：收起常驻气泡
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = null;
    this.workOn = false;
    this.workText = null;
    this.renderBubble();
    return;
  }
  const pool = this.animations.events?.workStatus;
  if (!pool || pool.length === 0) {
    console.error('[dsh-pet] 配置缺少 animations.events.workStatus，无法播放工作状态动画');
    return;
  }
  const idx = S.WORK_STATUS_INDEX[state];
  const slot = pool[idx];
  if (slot === undefined) {
    console.error('[dsh-pet] work-status 档位索引越界：state=' + state + ' idx=' + idx);
    return;
  }
  const name = S.pickSlot(slot, this.anim); // 数组槽位档内随机抽 1，且避开当前正播动画（避免连续重复，与浏览器一致）
  console.log(
    '[dsh-pet] ' +
      new Date().toTimeString().slice(0, 8) +
      ' workStatus pet=' +
      this.pet.id +
      ' state=' +
      state +
      ' -> [' +
      idx +
      '] ' +
      name,
  );
  this.stopMove();
  // 气泡文本：任务详情（todo/write 提供）优先，否则从条目级 workStatusTexts[档位]（数组）随机抽一句；
  // 整字段/整档缺失 = 不弹文本，只播动画（与浏览器同一语义）。
  const textGroup = Array.isArray(this.pet.workStatusTexts) ? this.pet.workStatusTexts[idx] : undefined;
  const configuredText =
    Array.isArray(textGroup) && textGroup.length > 0
      ? textGroup[Math.floor(Math.random() * textGroup.length)]
      : undefined;
  this.workText = (snapshot && snapshot.task) || configuredText || null;
  const terminal = state === 'success' || state === 'error';
  // 气泡点亮/收起只在状态变化时动作：同状态后续 tick（todo 文案更新、其它会话事件搅动 ts）
  // 不重新点亮**已自动收起的终态气泡**——否则"任务完成"的气泡会被后续 ts 变化反复弹回（Bug 2，
  // 与浏览器 workBubbleOn 同一语义）。
  if (stateChanged) {
    this.workOn = true;
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = terminal
      ? window.setTimeout(() => {
          this.workOn = false;
          this.renderBubble();
        }, BUBBLE_DURATION_MS)
      : null; // 非终态：常驻，不设自动收起
  }
  this.renderBubble();
  // 循环语义（与浏览器 setOnce 一致）：终态播一遍回 idle；非终态多候选档位播一遍 →
  // ended 由 sprite.handleEnded 轮换到下一候选（长时间状态不单段重复）；非终态单候选档位无限循环。
  if (Date.now() < (this.ackUntil || 0)) return; // Let an explicit acknowledgement finish.
  const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
  if (terminal || rotating) this.playOnce(name);
  else this.switchTo(name, false); // 进行中循环播（单动画/单候选档位）
};

// ---- 碎碎念 / 命令气泡 / 对话回复（**三合一**）：不再各自轮询 ----
// 改造前这里是两个循环（startWhisperLoop 按 eventsRefreshSec.whisper 轮询 /whisper、
// startBroadcastLoop 1s 轮询 /broadcast）。现在三者都写进 S 的 pets.<id>.say，由上面的
// /state 统一轮询分发到对应宠物（见 applySayLeaf）——本窗口只装一只宠物，按 id 命中即可。

// 宿主随台词点名的动画（开饭、心情点击反应）：只接受本宠物已有的待机/转向/拖拽/点击/随机动作，
// 移动类与未知名字不接（移动要走真实位移，未知名字会 404）
function isKnownAnimation(animations, name) {
  return [animations.idle, animations.turn, animations.drag, animations.clicks].some((pool) => (pool || []).includes(name)) ||
    (animations.categories || []).some((c) => c.actions.includes(name));
}

// 碎碎念展示（本宠物）：随机抽 events.whisper 动画 + 弹文本气泡（10s 消失）
// image：host 随机抽定的配图名称（未开配图/池为空则空串，与浏览器端同一契约）
PetSprite.prototype.showWhisper = function showWhisper(text, image, animation) {
  if (animation === '点击回应-收到敬礼') {
    this.ackUntil = Date.now() + 3500;
    window.setTimeout(() => this.renderBubble(), 3550);
  }
  if (animation && this.character) animation = this.resolveAnimation(animation);
  const pool = this.animations.events?.whisper;
  if (!pool || pool.length === 0) {
    console.error('[dsh-pet] 配置缺少 animations.events.whisper，无法播放碎碎念动画');
    return;
  }
  // 整池随机抽 1 槽（避开当前正播动画，避免连续重复）；槽位若为数组候选再档内随机（与浏览器一致）
  const name = animation && (animation.startsWith('碎碎念-') || ['点击回应-收到敬礼','工作状态-原地踱步张望','工作状态-雀跃庆祝','工作状态-垂头叹气冒汗'].includes(animation) || isKnownAnimation(this.animations, animation)) ? animation : S.pickSlot(S.pick(pool, this.anim), this.anim);
  console.log(
    '[dsh-pet] ' +
      new Date().toTimeString().slice(0, 8) +
      ' whisper pet=' +
      this.pet.id +
      ' -> [' +
      name +
      '] 「' +
      text +
      '」' +
      (image ? ' [' + image + ']' : ''),
  );
  this.stopMove();
  this.whisperOn = true;
  this.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });
  this.whisperImage = typeof image === 'string' ? image : '';
  this.renderBubble();
  // 气泡 10s 定时消失（与动画解耦；重复触发先清旧定时器）
  if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
  this.whisperTimer = window.setTimeout(() => {
    this.whisperOn = false;
    this.renderBubble();
  }, BUBBLE_DURATION_MS);
  this.playOnce(name);
};

// ---------- 统一轮询（GET /state，1s）：与浏览器同一份数据来源与渲染入口 ----------
// 每个叶子 = { counter, data }：首拉只记基线（不渲染），之后 counter 变了才渲染。
// 各功能逐个接入，旧的独立轮询循环随迁随删。
let stateBaseline = null;

/** 说话叶子 → 对应宠物播说话动画 + 气泡（碎碎念/命令气泡/对话回复三合一）。
 *  petId 由路径解析出来（pets.<id>.say）；本窗口只装一只宠物，按 id 命中即可。 */
function applySayLeaf(petId, leaf) {
  const said = S.readSay(leaf);
  if (!said) return;
  for (const s of sprites) {
    if (s.pet.id === petId || s.pet.sharedSayId === petId) s.showWhisper(said.text, said.image, leaf.data?.animation);
  }
}

/** 工作状态叶子 → 各宠物切档位动画 + 气泡（含回到空闲：state=null 用于收起常驻气泡） */
function applyWorkStatusLeaf(leaf) {
  const snap = S.toWorkStatus(leaf.data);
  if (snap) snap.source = leaf.data?.source || null;
  if (!snap) return;
  workTick++;
  for (const s of sprites) s.onWorkTick(snap, workTick);
}

/** 点播动画叶子 → 对应宠物播该动画（其他插件经 POST /anim 写进 S）。
 *  复用**右键菜单同一个处理函数** onMenuAction，所以镜像修正 / 移动类走真实位移 /
 *  其余播一遍的语义与菜单点一下完全一致，这里不重写一遍。
 *  petId 由路径解析出来（pets.<id>.anim）；本窗口只装一只宠物，按 id 命中即可。 */
function applyAnimLeaf(petId, leaf) {
  const hit = S.readAnim(leaf);
  if (!hit) return;
  for (const s of sprites) {
    if (s.pet.id === petId) s.onMenuAction({ label: hit.name, anim: hit.name });
  }
}

/** 心情叶子 → 各宠物换随机链权重与点击反应（不播动画、不弹气泡；下一段随机动作起生效） */
function applyMoodLeaf(leaf) {
  for (const s of sprites) s.setMood(leaf.data);
}

// Cached/looping media can keep playing after a local pack disappears. Revalidate occasionally,
// even with the manager closed, and rebuild once instead of leaving a stale character on screen.
let characterCheckAt = 0;
async function checkCharacterAvailability() {
  const sprite = sprites[0];
  if (!sprite || sprite.characterRecovery || Date.now() - characterCheckAt < 1000) return;
  characterCheckAt = Date.now();
  try {
    const response = await fetch(BASE + '/characters');
    if (!response.ok) return;
    const state = await response.json();
    if (state.ok) for (const pet of sprites) pet.setBehavior(state.behavior);
    if (state.ok && (sprite.pet.characterSlot === 'companion' ? state.companionActive : state.active) !== (sprite.character?.id || 'dafeiyu')) {
      sprite.characterRecovery = true;
      sprite.reloadDesktop();
    }
  } catch { /* A transient backend error is not evidence of a missing pack. */ }
}

/** 跑一拍 /state（1s 定时与「前端动作后立刻刷新」共用同一份实现） */
async function pollStateOnce() {
  // A native resume can arrive before boot creates the sprite. Do not consume its baseline.
  const recipients = sprites;
  if (!recipients.length) return;
  try {
    const s = await S.fetchState(STATE_URL);
    if (!s || sprites !== recipients) return; // Discard a response for a replaced sprite generation.
    if (stateBaseline === null) {
      if (s.sections?.codexProgress?.data) applyCodexProgress(s.sections.codexProgress.data, true);
      stateBaseline = S.flattenCounters(s); // 首拉：只记基线，不渲染（避免启动/重载时重放旧气泡）
      // Running state must appear even when the next operation takes a long time.
      if (s.sections?.workStatus?.data?.state) applyWorkStatusLeaf(s.sections.workStatus);
      // 心情是持续状态而非一次性事件：首拉就要生效
      if (s.sections?.mood?.data) applyMoodLeaf(s.sections.mood);
      return;
    }
    for (const change of S.takeChanged(s, stateBaseline)) {
      if (change.leaf.data === null) continue;
      if (change.path === 'sections.workStatus') applyWorkStatusLeaf(change.leaf);
      else if (change.path === 'sections.codexProgress') applyCodexProgress(change.leaf.data);
      else if (change.path === 'sections.mood') applyMoodLeaf(change.leaf);
      else if (change.path.startsWith('pets.') && change.path.endsWith('.say')) {
        // 宠物 id **允许含点号**：按前缀/后缀切片，绝不 split('.')
        applySayLeaf(change.path.slice('pets.'.length, -'.say'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.anim')) {
        // 点播动画：同样按前缀/后缀切片（counter 每次写入都递增，连点两次也会分发两次）
        applyAnimLeaf(change.path.slice('pets.'.length, -'.anim'.length), change.leaf);
      }
    }
  } catch {
    /* 轻量轮询失败静默：下一拍再试 */
  }
}

/** 立即跑一拍：右键菜单等**前端动作**完成后调用——结果 0 延迟可见，不用等下一个 1s */
function pollStateNow() {
  void pollStateOnce();
}

function startLoops() {
  if (loopsStarted) return;
  loopsStarted = true;

  // 统一轮询：1s 一拍（状态由 host 写入，这里只读）
  const stateLoop = async () => {
    try {
      const response = await fetch(BASE + '/drag-settings', { cache: 'no-store' });
      if (response.ok) { const state = await response.json(); if (state.ok) for (const pet of sprites) pet.setDragSettings(state.settings); }
    } catch { /* Keep the last applied settings during a transient backend outage. */ }
    try {
      const response = await fetch(BASE + '/position-settings', { cache: 'no-store' });
      if (response.ok) {
        const state = await response.json();
        if (state.ok) for (const pet of sprites) {
          const slot = pet.pet.characterSlot || 'primary';
          pet.setStartPosition(state.settings[slot]);
          if (!pet.suspended) await fetch(BASE + '/position-settings/current', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot, point: pet.screenPosition() }),
          });
        }
      }
    } catch { /* Keep the last saved position during a transient outage. */ }
    await checkCharacterAvailability();
    await pollStateOnce();
    setTimeout(() => void stateLoop(), 1000);
  };
  void stateLoop();
}
