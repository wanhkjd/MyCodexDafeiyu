/**
 * dsh-pet desktop helper —— 宠物本体（PetSprite 类）。
 *
 * 播放 / 拖拽抛掷 / 跨窗碰撞 / 点击穿透 / 右键菜单 / 聊天弹窗 / 气泡渲染。
 * 事件联动（余额 / 碎碎念 / 广播 / 工作状态）不在此文件——见 events.js。
 * 依赖 constants.js 的全局（CONFIG / VIEW / BASE / S / config / sprites 等），须后加载。
 */
'use strict';

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
class PetSprite {
  constructor(pet) {
    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    // 页面级缩放（main 对窗口 setZoomFactor(CONFIG.scale)，见 DESIGN.md §3.5）统一放大整窗：
    // renderSize（未补偿时为 pet.size）即 CSS 像素基准，**不再手工乘 CONFIG.scale**——固定 px UI（菜单/积分/聊天）
    // 随同一缩放自动恢复 DIP 观感；跨进程交换（bounds/几何/碰撞）由 constants.js 的
    // toScreen/toLocal 收口换算，这里与 shared 组件一样零乘除。
    // Compensate for character-specific transparent padding before computing all render/hit/physics geometry.
    this.size = pet.renderSize ?? pet.size;
    this.character = pet.character || null;
    this.behavior = { largeActions: true, run: true, flight: true, ...pet.behavior };
    this.runRef = null;
    this.runToken = 0;
    this.pendingRun = null;
    this.runPlan = null;
    this.nextRunAt = performance.now() + 20000;
    this.suspended = false;
    this.flightRef = null;
    this.flightToken = 0;
    this.pendingFlight = null;
    this.flightPlan = null;
    this.nextFlightAt = performance.now() + 20000;
    const geometry = this.character?.geometry || { width: 640, height: 360, feetY: S.FEET_Y, hitBox: S.HIT_BOX };
    this.geometry = geometry;
    this.height = this.size * geometry.height / geometry.width;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = this.height * (geometry.height - geometry.feetY) / geometry.height;
    this.winH = this.height + this.bottomPad;
    const box = geometry.hitBox;
    this.hitRect = {
      x: box.x0 / geometry.width * this.size,
      y: this.bottomPad + box.y0 / geometry.height * this.height,
      w: (box.x1 - box.x0) / geometry.width * this.size,
      h: (box.y1 - box.y0) / geometry.height * this.height,
    };
    this.sideAllow = Math.min(box.x0, geometry.width - box.x1) / geometry.width * this.size;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = { ...S.DEFAULT_PHYSICS, ...(pet.physics || config.physics) };
    this.dragSettings = DragMotion.normalize(config.dragSettings);
    this.throwKind = null;
    // 抛掷锁定在当前屏幕（根字段；拍平已吹入实例，兜底回主条目/默认）：
    // true = 甩出去只在松手时所在那块屏内弹（屏缝当墙），false = 照常跨屏飞行
    this.confineToScreen = pet.confineToScreen === true || config.confineToScreen === true;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetRoot = pet.assetRoot || pet.id;
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(this.assetRoot) + '/';
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    this._interactive = null; // 已上报的可交互状态（setInteractive 去重用）
    this._inputBusy = null; // 已上报的"正在用输入"状态（syncInputBusy 去重用）
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    this.space = null; // 抛掷空间（逐屏 AABB）缓存；显示器变化时由 relayout() 置空重建
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    if(params.get('restoreX') && params.get('restoreY')) {
      const x=toLocal(Number(params.get('restoreX')))-VIEW.x,y=toLocal(Number(params.get('restoreY')))-VIEW.y;
      if(Number.isFinite(x)&&Number.isFinite(y))this.customPos={rx:(x+this.halfW)/VIEW.w,ry:(y+this.halfH)/VIEW.h};
      if(params.get('restoreFacing')==='right')this.facing='right';
    }
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    // 悬浮提示（替代原生 title 属性）：显隐 + 最近一次光标位置（**视口坐标**，见 renderTip）
    this.tipOn = false;
    this.tipCursor = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = 当前余额气泡是不可用的「文字说明」（多行，需换行变体）
    this.prevTick = 0;
    // 说话（碎碎念 / 命令气泡 / 对话回复三合一）：文本/配图由容器统一轮询 /state 后经
    // showWhisper 送进来，本精灵不再自己轮询（改造前的 whisperLoopTimer / broadcastLoopTimer 已删）
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // 配图名称（配置 memes 的键；whisperImageEnabled 开启时由 host 随机抽定，随文本一起来）
    this.whisperImage = '';
    // 心情（宿主经 /state 的 mood 叶子推来，见 events.js applyMoodLeaf）：null = 心情系统关闭或未就绪，
    // 随机链与点击回应保持原行为。moodLines 记录各心情台词上次出现时间，同一心情 2 分钟内不重复说
    this.mood = null;
    this.moodLines = {};
    // 工作状态联动（DSH 会话状态）：容器 1s 轮询 /state 递增 workTick → 本宠物按档位播动画+气泡。
    // 气泡单槽优先级 终态任务 > whisper > balance > 非终态任务（见 renderBubble）；
    // workStatusEnabled 未启用时完全免疫（与浏览器一致）
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // 最近一次工作状态（互动/事件动画播完恢复档位循环用）
    this.prevWorkState = null; // 上一档状态（气泡只在状态变化时点亮/收起，Bug 2）
    this.prevWorkTick = 0;
    // 对话弹窗（shared 组件）：当前挂载的 close() 句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatClose = null;
    this.chatOpen = false;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    // Text/bubbles keep the shared setting's scale; only the pet's media canvas is compensated.
    this.el.style.setProperty('--pet-size', pet.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.width = this.size + 'px';
    stage.style.height = this.height + 'px';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = this.hitRect.x + 'px';
    this.hit.style.top = (this.hitRect.y - this.bottomPad) + 'px';
    this.hit.style.width = this.hitRect.w + 'px';
    this.hit.style.height = this.hitRect.h + 'px';
    // 原先这里挂 title（原生系统提示）：已换成自绘浮层，但无障碍名称不能跟着丢
    this.hit.setAttribute('aria-label', this.pet.name);
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';
    // 悬浮提示：与气泡同处 this.el 内的绝对定位浮层，位置/翻转由 renderTip 决定，
    // 样式走 shared 的 TOOLTIP_CSS（renderer.js 注入，与浏览器端同一份）
    this.tip = document.createElement('div');
    this.tip.className = S.TOOLTIP_CLASS;
    this.tip.setAttribute('aria-hidden', 'true');

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.feedingBusy = false;
    this.riceActive = false;
    this.riceSession = null;
    this.el.appendChild(this.bubble);
    this.el.appendChild(this.tip);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.edgePeek = new EdgePeek.Controller(this, {
      view: () => VIEW, panels: () => PANELS.length ? PANELS : AREAS, areas: () => AREAS,
      reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      now: () => performance.now(), frame: cb => requestAnimationFrame(cb), cancelFrame: id => cancelAnimationFrame(id),
      setTimer: (cb, ms) => setTimeout(cb, ms), clearTimer: id => clearTimeout(id),
    });
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.riceStateClose = window.petBridge?.onRiceState?.(state => {
      if (this.ac.signal.aborted) return;
      this.riceActive = state.active === true;
      this.riceSession = this.riceActive ? state.session : null;
      this.el.classList.toggle('is-rice-target', this.riceActive && state.over === true);
      if (this.riceActive) { this.stopThrow(); this.stopFlight(); this.stopMove(); this.setTip(false); }
    });
    this.riceDropClose = window.petBridge?.onRiceDrop?.(request => { void this.feedRice(request); });
    // 级联菜单新增面板、聊天输入增长都可能在鼠标停住时发生，不能只等下一次 mousemove。
    this.inputRegionResize = new ResizeObserver(() => this.syncInputRegions());
    this.inputRegionElements = new Set();
    this.inputRegionMutation = new MutationObserver(() => this.syncInputRegions());
    this.inputRegionMutation.observe(document.body, { childList: true, subtree: true });
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    // Pointer Events only emit pointerup for the last button in a chord; mouseup always emits for left release.
    window.addEventListener('mouseup', e => {
      if (e.button === 0 && this.dragState.active) this.onPointerUp({ pointerId: this.activePointerId, button: 0, screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey });
    }, { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, true), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e, true), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'blur',
      () => {
        // 切到其它应用后旧菜单不应继续占着整个透明窗口；丢失松手时也释放拖拽。
        this.closeMenu();
        if (this.dragState.active) this.onPointerUp();
        if (!this.chatOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透。
        // 拖拽中与对话弹窗开着都不恢复：前者会绕过 busy 造成穿透并丢失 pointerup，
        // 后者要留光标回来点输入框。
        this.closeMenu();
        if (!this.chatOpen && !this.dragState.active) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            // 碰撞 broker 协议单位是物理像素（与窗口 bounds 一致）：÷scale 进本窗口 CSS 系（§3.5）
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
  }

  dispose() {
    this.edgePeek.dispose();
    this.ac.abort();
    window.petBridge?.cancelRice?.();
    this.riceStateClose?.();
    this.riceDropClose?.();
    this.inputRegionMutation.disconnect();
    this.inputRegionResize.disconnect();
    this.inputRegionElements.clear();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  // 目标包围盒左上角（视口相对坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）。
  // setContentBounds 要**屏幕**坐标：pos 是视口（桌面外接矩形）相对坐标，先加 VIEW.x/y
  // 再统一 ×scale 回物理像素（§3.5 IPC 收口）——主进程收到的数字与线性化旧行为逐位一致，
  // 主进程侧（bounds/去重/碰撞 broker）完全不用改。
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    if (window.petBridge) {
      // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场
      // （此前只有 report-flight 带尺寸，从没飞过的宠物 size=0 被碰撞检测直接跳过）；
      // vx/vy 带当前速度——飞行中实时值、静止/拖拽 = 0，避免落地后残留上次飞行速度干扰碰撞动量。
      const fly = this.throwState;
      window.petBridge.setBounds(
        toScreen(this.pos.x - this.margin.l + VIEW.x),
        toScreen(this.pos.y - this.margin.t + VIEW.y),
        toScreen(this.size + this.margin.l + this.margin.r),
        toScreen(this.winH + this.margin.t + this.margin.b),
        toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        toScreen(this.pos.y),
        toScreen(this.size),
        toScreen(this.bottomPad),
        fly ? toScreen(fly.vx) : 0,
        fly ? toScreen(fly.vy) : 0,
      );
    }
    // 位置变了（宠物漫游/拖拽/飞行，窗口跟着动）：提示若正显示必须重摆一次——它跟的是光标，
    // 而光标存的是视口坐标，窗口一移，光标相对窗口的位置就变了，不重摆提示会跟着窗口漂走。
    // 只在显示时重摆：漫游逐帧调本函数，没显示提示时不做无谓的 DOM 写入。
    if (this.tipOn) this.renderTip();
    this.syncRiceTarget();
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    if (this.edgePeek?.dock) return;
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // 角落取**主屏**而不是外接矩形：不规则多屏布局下外接矩形的角落可能不属于任何显示器
      // （实测右倒 T 型双屏，top-left 落在主屏上方的空洞里），配了该角落的宠物开机即隐身。
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY 是配置里的绝对像素：页面级缩放（§3.5）已统一放大整窗，
        // 配置值不再手工乘 CONFIG.scale——150% 屏上与「线性化 + 旧 CONFIG.scale 补偿」观感一致
        marginX: this.pet.position.marginX,
        // macOS 顶部边距对齐身体命中盒，扣掉动画画布头顶留白。
        marginY:
          this.pet.position.marginY -
          (this.pet.position.corner.startsWith('top-') ? this.size * CONFIG.topInsetRatio : 0),
        size: this.size,
        height: this.height,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间（逐屏 AABB）。AREAS/PANELS 变化时由 relayout() 置空重建——飞行中每帧重算太浪费 */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, height: this.height, sideAllow: this.sideAllow });
      for (const b of this.space.bounds) b.minY -= this.size * CONFIG.topInsetRatio;
    }
    return this.space;
  }

  /**
   * 显示器几何变化（改分辨率/缩放、插拔屏、旋转）后就地重挂：
   * 抛掷空间作废，并把宠物从可能变成空洞的位置拉回可见区。
   * 拖拽中不动它（用户正握着，位置由指针决定）；飞行中也不动（下一帧物理自会按新边界夹取）。
   */
  relayout() {
    this.space = null;
    this.edgePeek.reflow();
    if (this.edgePeek.dock) return;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const p = S.clampPointToRegion(AREAS, cx, cy);
    if (p.x !== cx || p.y !== cy) {
      this.customPos = { rx: p.x / VIEW.w, ry: p.y / VIEW.h };
    }
    this.position();
    this.clampFlightPosition();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  resolveAnimation(name) {
    if (!this.character) return name;
    return Object.hasOwn(this.character.clips, name) ? name : this.character.aliases[name] || this.character.fallback;
  }

  isFlightAnimation(name) {
    return !!this.character?.flightAnimations?.includes(this.resolveAnimation(name));
  }

  isRunAnimation(name) {
    return !this.character && this.assetRoot === 'main' && name === RunMotion.ANIMATION;
  }

  actionAllowed(name) {
    const resolved = this.resolveAnimation(name);
    if (this.isRunAnimation(resolved)) return this.behavior.largeActions && this.behavior.run;
    if (this.isFlightAnimation(resolved)) return this.behavior.largeActions && this.behavior.flight;
    if (this.behavior.largeActions) return true;
    return resolved === this.animations.idle[0] || this.animations.clicks.includes(resolved) || this.animations.drag.includes(resolved) || resolved === this.character?.landing;
  }

  setBehavior(value) {
    const wasFlying = !!this.flightPlan || !!this.pendingFlight;
    const wasRunning = !this.character && this.assetRoot === 'main' && (!!this.runPlan || !!this.pendingRun || this.moveRef !== null || !!this.pendingMove);
    this.behavior = { largeActions: value?.largeActions !== false, run: value?.run !== false, flight: value?.flight !== false };
    if (wasRunning && (!this.behavior.largeActions || !this.behavior.run)) {
      this.stopMove();
      if (!this.suspended && !this.dragState.active) this.playOnce(this.animations.idle[0]);
    } else if (wasFlying && (!this.behavior.largeActions || !this.behavior.flight)) {
      this.stopMove();
      this.clampFlightPosition();
      if (!this.suspended && !this.dragState.active) this.playOnce(this.character.landing);
    } else if (!this.behavior.largeActions && !this.dragState.active && !this.actionAllowed(this.anim)) {
      this.stopMove();
      if (!this.suspended) this.playOnce(this.animations.idle[0]);
    }
  }

  clampFlightPosition() {
    if (!this.character || this.edgePeek.dock) return;
    const b = FlightMotion.boundsAt({ ...this.pos, width: this.size, height: this.winH, areas: PANELS.length ? PANELS : AREAS });
    if (!b) return;
    const x = Math.max(b.minX, Math.min(b.maxX, this.pos.x)), y = Math.max(b.minY, Math.min(b.maxY, this.pos.y));
    this.customPos = { rx: (x + this.halfW) / VIEW.w, ry: (y + this.halfH) / VIEW.h };
    this.sendBounds(x, y);
  }

  tryFlight(name) {
    if (this.edgePeek.dock) return false;
    if (this.dragSettings.lockPosition || this.throwRef !== null) return false;
    if (this.riceActive || !this.character?.flightAnimations?.length || !this.behavior.flight || !this.behavior.largeActions || this.suspended || this.dragState.active || this.menuOpen || this.chatOpen || this.throwRef !== null) return false;
    const clip = name ? this.character.clips[name] : null;
    if (name && !this.isFlightAnimation(name)) return false;
    const plan = FlightMotion.plan({ ...this.pos, width: this.size, height: this.winH, areas: PANELS.length ? PANELS : AREAS, direction: clip?.sourceFacing });
    if (!plan) return false;
    const animation = name || this.character.flightAnimations.find(id => this.character.clips[id].sourceFacing === plan.direction);
    if (!animation) return false;
    this.stopThrow();this.stopMove();
    this.facing = plan.direction;
    this.pendingFlight = { ...plan, animation };
    this.nextFlightAt = performance.now() + 45000 + Math.random() * 45000;
    this.sendBounds(plan.start.x, plan.start.y);
    this.playOnce(animation);
    return true;
  }

  maybeFly() {
    if (this.pet.fixedEnabled || performance.now() < this.nextFlightAt || this.inputBusy() || this.workState && !['success', 'error'].includes(this.workState)) return false;
    if (Math.random() > 0.25) return false;
    return this.tryFlight();
  }

  startFlightDrive(el) {
    if (this.dragSettings.lockPosition || this.throwRef !== null) return;
    const plan = this.pendingFlight;
    if (!plan || this.suspended || this.flightRef !== null) return;
    this.pendingFlight = null;this.flightPlan = plan;
    const clip = this.character.clips[plan.animation], token = ++this.flightToken;
    const step = () => {
      if (this.flightToken !== token || this.suspended) return;
      const pose = FlightMotion.sample(plan, (el.currentTime || 0) * 1000, clip.moveStartMs, clip.moveStopMs);
      this.sendBounds(pose.x, pose.y);
      this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
      if (pose.progress < 1) this.flightRef = requestAnimationFrame(step);
      else this.flightRef = null;
    };
    this.flightRef = requestAnimationFrame(step);
  }

  stopFlight() {
    const active = this.flightPlan || this.pendingFlight;
    this.flightToken++;
    if (this.flightRef !== null) cancelAnimationFrame(this.flightRef);
    this.flightRef = null;this.flightPlan = null;this.pendingFlight = null;
    if (active) {
      this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
    }
  }

  tryRun() {
    if (this.edgePeek.dock) return false;
    if (this.character || this.assetRoot !== 'main' || !this.behavior.run || !this.behavior.largeActions || this.suspended || this.pet.fixedEnabled || this.inputBusy() || this.riceActive || this.throwRef !== null || this.workState && !['success', 'error'].includes(this.workState)) return false;
    const plan = RunMotion.plan({ ...this.pos, width: this.size, height: this.winH, areas: AREAS.length ? AREAS : PANELS });
    if (!plan) return false;
    this.stopMove();
    this.facing = plan.direction;
    this.pendingRun = plan;
    this.nextRunAt = performance.now() + 45000 + Math.random() * 45000;
    this.sendBounds(plan.start.x, plan.start.y);
    this.once = false;
    this.switchTo(RunMotion.ANIMATION, false);
    return true;
  }

  maybeRun() {
    if (this.dragSettings.lockPosition || this.throwRef !== null) return false;
    if (performance.now() < this.nextRunAt || Math.random() > 0.25) return false;
    return this.tryRun();
  }

  startRunDrive(el) {
    if (this.dragSettings.lockPosition || this.throwRef !== null) return;
    const plan = this.pendingRun;
    if (!plan || this.suspended || this.runRef !== null) return;
    this.pendingRun = null; this.runPlan = plan;
    const token = ++this.runToken;
    let elapsed = 0, previous = el.currentTime || 0, advancedAt = performance.now();
    const step = () => {
      if (this.runToken !== token || this.suspended) return;
      if (this.inputBusy() || this.riceActive || this.pet.fixedEnabled) {
        this.stopRun(); this.playOnce(this.animations.idle[0]); return;
      }
      // Follow decoded clip time across loops: buffering/paused media must not slide the pet.
      const current = el.currentTime || 0;
      const delta = !el.paused && !el.seeking ? RunMotion.mediaDelta(previous, current, el.duration) : 0;
      previous = current;
      elapsed += delta * 1000;
      if (delta > 0) advancedAt = performance.now();
      const pose = RunMotion.sample(plan, elapsed);
      this.sendBounds(pose.x, pose.y);
      this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
      if (pose.progress >= 1 || el.error || performance.now() - advancedAt > 10000) {
        this.stopRun();
        this.playOnce(this.animations.idle[0]);
      } else this.runRef = requestAnimationFrame(step);
    };
    this.runRef = requestAnimationFrame(step);
  }

  stopRun() {
    const active = this.runPlan || this.pendingRun;
    this.runToken++;
    if (this.runRef !== null) cancelAnimationFrame(this.runRef);
    this.runRef = null; this.runPlan = null; this.pendingRun = null;
    if (active) {
      this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
      // Menus/feeding can cancel without switching clips. Never leave a stationary endless run loop.
      for (const el of [this.videoA, this.videoB]) if (el?.dataset.animation === RunMotion.ANIMATION) {
        el.loop = false;
        el.onended = () => this.handleEnded();
      }
      this.once = true;
    }
  }

  videoTransform(name) {
    if (!this.character) return this.facing === 'right' ? 'scaleX(-1)' : '';
    const clip = this.character.clips[this.resolveAnimation(name)];
    return 'translate(' + clip.renderOffset[0] * this.size + 'px,' + clip.renderOffset[1] * this.height + 'px) scale(' + clip.renderScale + ')';
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next || this.suspended) return;
    if (this.edgePeek.dock && !this.edgePeek.expanded && !this.dragState.dragging) next = this.animations.idle[0];
    next = this.resolveAnimation(next);
    if (!this.actionAllowed(next)) next = this.animations.idle[0];
    if ((this.flightPlan || this.pendingFlight) && next !== (this.flightPlan || this.pendingFlight).animation) this.stopFlight();
    if ((this.runPlan || this.pendingRun) && !this.isRunAnimation(next)) this.stopRun();
    this.anim = next;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.dataset.animation = next;
    el.style.transformOrigin = 'bottom center';
    el.src = this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = false;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    // 加载兜底（与浏览器 web 端 fetch+blob 的 10s 超时同义）：素材加载失败或卡住时必须释放
    // pending，否则它永久挂起——之后相同目标会被防重分支吞掉、不同目标靠 gen 覆盖，
    // 表现就是"点了没反应"（#62 报告的就是 web 端同一类问题，桌面端此前完全没有兜底）。
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[dsh-pet] 素材加载失败 pet=' + this.pet.id + ' anim=' + next + '：' + why + '（已释放本次切换）');
      this.stopMove();
      if (this.character && !this.characterRecovery) {
        this.characterRecovery = true;
        // A missing local pack falls back on config reload; don't loop over invalid media.
        window.setTimeout(() => this.reloadDesktop(), 2200);
      }
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    const onReady = () => {
      if (el.onloadeddata === onReady) el.onloadeddata = null;
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.gen !== gen || !this.pending || this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      el.style.transform = this.videoTransform(next);
      if (this.isRunAnimation(next) && !this.pendingRun) {
        el.loop = false;
        el.onended = () => this.handleEnded();
      }
      if (!this.suspended) el.play().catch(() => {}); else el.pause();
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove && !this.suspended) this.startMoveDrive(el);
      if (this.pendingFlight && !this.suspended) this.startFlightDrive(el);
      if (this.pendingRun && !this.suspended) this.startRunDrive(el);
    };
    el.onloadeddata = onReady;
    el.load();
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    if (this.edgePeek.dock) { this.playOnce(this.animations.idle[0]); return; }
    if (this.suspended || this.dragState.active || this.throwRef !== null) return;
    if (this.riceActive) { this.edgePeek.expand(false); this.stopMove(); this.playOnce(this.animations.idle[0]); return; }
    if (this.maybeFly() || this.maybeRun()) return;
    if (!this.behavior.largeActions || this.inputBusy()) { this.stopMove(); this.playOnce(this.animations.idle[0]); return; }
    const mods = this.mood && this.mood.mods;
    if (mods) {
      this.playMoodIdle(mods);
      return;
    }
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    // 宠物固定（pets[].fixedEnabled）：掷骰时把「转向 / 移动」两档权重按 0 算（与浏览器同一份
    // 决策）——随机链不再让宠物自己翻朝向或走开。右键菜单点播与 /anim 接口不走这里，不受影响。
    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled || this.dragSettings.lockPosition });
    let next;
    if (k === 'idle') {
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  // 心情版动画链：待机/转向/移动、各分类与心情加权动作放进同一张权重表（同为 100 分制）一次抽签。
  // 倍率与加权动作由宿主 mood.mjs 决定；宠物固定时不转向不移动，文字类朝右不选（与原链同语义）。
  playMoodIdle(mods) {
    this.stopMove();
    // 工作状态非终态时由档位动画接管，随机链不插队
    if (this.resumeWorkStatusAnim()) return;
    const animations = this.animations;
    const fixed = this.pet.fixedEnabled || this.dragSettings.lockPosition;
    const cats = mods.cats || {};
    const entries = [{ kind: 'idle', weight: this.weights.idle * (mods.idle ?? 1) }];
    if (!fixed) {
      entries.push({ kind: 'turn', weight: this.weights.turn * (mods.turn ?? 1) });
      entries.push({ kind: 'move', weight: this.weights.move * (mods.move ?? 1) });
    }
    for (const cat of animations.categories) {
      if (!cat.actions.length || (cat.noMirror && this.facing === 'right')) continue;
      entries.push({ kind: 'cat', cat, weight: cat.weight * (cats[cat.id] ?? 1) });
    }
    for (const [anim, weight] of Object.entries(mods.boost || {})) {
      if (this.character && !this.character.clips[anim] && !this.character.aliases[anim]) continue;
      if (anim === this.anim && !mods.sticky) continue;
      if (this.facing === 'right' && S.isNoMirrorAnimation(animations.categories, anim)) continue;
      entries.push({ kind: 'boost', anim, weight });
    }
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    let roll = Math.random() * total;
    const hit = entries.find((e) => (roll -= Math.max(0, e.weight)) < 0) || entries[0];
    let next;
    if (hit.kind === 'idle') next = S.pick(animations.idle, this.anim);
    else if (hit.kind === 'turn') next = S.pick(animations.turn, this.anim);
    else if (hit.kind === 'cat') next = S.pick(hit.cat.actions, this.anim);
    else if (hit.kind === 'boost') next = hit.anim;
    else {
      const moved = this.tryMove();
      if (moved === false) next = S.pick(animations.idle, this.anim);
      else if (typeof moved === 'string') next = moved;
      else {
        this.playOnce(this.anim);
        return;
      }
    }
    this.playOnce(next);
  }

  /** 宿主 mood 叶子：enabled=false 或缺省 → 回到原行为 */
  setMood(data) {
    this.mood = data && data.enabled === true ? data : null;
    this.syncRiceTarget();
    this.syncInputRegions();
  }

  /** Local physical body bounds: the main process adds the current native window origin. */
  syncRiceTarget() {
    if (!window.petBridge?.setRiceTarget || !this.hit) return;
    const r = this.hit.getBoundingClientRect();
    const data = { enabled: !!this.mood, rect: { x: toScreen(r.x), y: toScreen(r.y), width: toScreen(r.width), height: toScreen(r.height) } };
    const key = JSON.stringify(data);
    if (key === this._riceTarget) return;
    this._riceTarget = key;
    window.petBridge.setRiceTarget(data);
  }

  /** Only a validated native drop may feed; spawning or clicking food never does. */
  async feedRice(request) {
    if (!request || !this.riceActive || request.session !== this.riceSession) return;
    const result = { ...request, ok: false };
    if (!this.mood || this.feedingBusy || this.suspended || this.ac.signal.aborted) {
      window.petBridge?.riceResult?.(result);
      return;
    }
    this.feedingBusy = true;
    this.setTip(false);
    this.stopMove();
    try {
      result.ok = await S.postAction(BASE + '/mood', { action: 'feed' });
      if (!this.ac.signal.aborted) {
        if (result.ok) pollStateNow(); // Host publishes the eating action for either character.
        else this.showWhisper('还没喂成功，白饭先留着，稍后再拖过来～');
      }
    } catch {
      if (!this.ac.signal.aborted) this.showWhisper('暂时连不上后台，白饭留着稍后再喂～');
    } finally {
      this.feedingBusy = false;
      if (!this.ac.signal.aborted) window.petBridge?.riceResult?.(result);
    }
  }

  /** 互动上报给宿主心情系统（点击/拖拽/扔/点播）；失败静默，不影响宠物本身 */
  reportMood(event) {
    void S.postAction(BASE + '/mood', { type: 'event', event });
  }

  handleEnded() {
    if (this.dragState.active || this.suspended) return;
    if (this.edgePeek.dock && !this.edgePeek.expanded) { this.playOnce(this.animations.idle[0]); return; }
    if (this.isRunAnimation(this.anim)) {
      this.stopRun(); this.playOnce(this.animations.idle[0]); return;
    }
    if (this.flightPlan && this.isFlightAnimation(this.anim)) {
      this.stopFlight();this.clampFlightPosition();this.playOnce(this.character.landing);return;
    }
    const { animations } = { animations: this.animations };
    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // 工作状态多候选档位：播完一段自动轮换到下一候选（排除当前段，避免连抽），继续循环——
      // 长时间状态不单段重复（与浏览器 ended 护栏共用同一决策 nextWorkStatusAnim）。
      // 仅非终态档位轮换；终态（success/error）播完一次即结束，绝不轮换续播。单候选档位由
      // loop 无限循环（不触发 ended，不会走到这里）。
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus 档内轮换: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // 继续播一遍（once=true）→ ended 再轮换
        return;
      }
      // 非 workStatus 事件动画（余额/碎碎念）播完：workStatus 仍非终态 → 立即恢复档位循环动画，
      // 不进随机链（长事件期间状态不变，随机链会一直播到状态切换才被拉回）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // 互动动画播完：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器同一语义）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  // 互动/事件动画播完后恢复 workStatus 档位循环：非终态 → 按当前状态档位重选动画（多候选档内
  // 随机并避开当前段）；终态/空闲 → false 不接管，调用方走原逻辑（回 idle / 随机池，与浏览器一致）。
  resumeWorkStatusAnim() {
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // 避开当前正播动画（避免连续重复）
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id + ' 恢复工作状态动画: ' + name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // 多候选：播完由 handleEnded 轮换
    else this.switchTo(name, false); // 单候选：无限循环
    return true;
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    if (this.edgePeek.dock) return false;
    if (this.dragSettings.lockPosition) return false;
    if (!this.behavior.largeActions || (!this.character && this.assetRoot === 'main' && !this.behavior.run) || this.suspended || this.dragState.active || this.flightPlan || this.pendingFlight || this.runPlan || this.pendingRun) return false;
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const sourceFacing = this.character?.clips[chosen.name]?.sourceFacing;
    if (sourceFacing) this.facing = sourceFacing;
    const dir = sourceFacing ? (sourceFacing === 'right' ? 1 : -1) : (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin, // 同 position() 的 marginX/marginY：页面级缩放统一放大，配置值不再乘 scale（§3.5）
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    if (this.dragSettings.lockPosition || this.throwRef !== null) return;
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.stopRun();
    this.stopFlight();
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  setDragSettings(value) {
    const next = DragMotion.normalize(value), previous = this.dragSettings;
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    this.dragSettings = next;
    if (next.lockPosition || next.shiftDrag !== previous.shiftDrag) {
      if (this.dragState.active) this.onPointerUp(undefined, true);
    }
    if (next.lockPosition || (this.throwKind === 'throw' && !next.dragPhysics) || (this.throwKind === 'drop' && !next.dropGravity)) {
      this.stopThrow(); this.stopMove();
      this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
      this.sendBounds(this.pos.x, this.pos.y); // Clear the collision broker's old velocity too.
    }
    if (!next.dragPhysics) {
      const target = this.dragTarget;
      this.stopDragFollow();
      if (this.dragState.active && target) this.sendBounds(target.x, target.y);
    }
  }

  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
    this.throwKind = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy, kind = 'throw') {
    if (this.edgePeek.dock) return;
    if (this.dragSettings.lockPosition || this.suspended) return;
    this.stopThrow();
    this.throwKind = kind;
    ({ vx, vy } = DragMotion.limit({ vx, vy }, DragMotion.cap(this.dragSettings)));
    this.stopDragFollow();
    this.stopMove();
    // 边界 = 显示器工作区**并集**：空洞是墙（宠物再也飞不进不可见区域），屏缝不是墙（跨屏弹跳照旧）
    // confineToScreen 开启时改为锁定**松手这一刻所在的那块屏**：屏缝同样当墙，只在目标屏内弹。
    // 锁定屏在抛掷开始时定下、飞行途中不重取；relayout 改了屏数时由 throwStepRegion 退回不锁定。
    const lockScreen = this.confineToScreen ? S.screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      // 每帧重取：显示器变化时 relayout() 会让缓存失效，res.screen 必须与这一份对应
      const sp = this.throwSpaceOf();
      const collisionPhysics = DragMotion.collisionPhysics(this.physics, this.dragSettings);
      const physics = this.throwKind === 'drop' ? DragMotion.dropPhysics(collisionPhysics) : collisionPhysics;
      const res = S.throwStepRegion(state, dt, sp, physics, lockScreen);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测；
      // broker 协议单位 = 物理像素，这里 ×scale（§3.5 收口）
      if (!this.character && window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: toScreen(state.x),
          y: toScreen(state.y),
          vx: toScreen(state.vx),
          vy: toScreen(state.vy),
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.throwKind !== 'drop' && !this.character && this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad, hitRect: this.hitRect });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // 被撞方初速同为 broker 物理像素协议：×scale（§3.5 收口）
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）。
      // 「地面」是**当前所在屏**的底边——多屏各有各的地面高度
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (this.throwKind !== 'drop' && res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest && (this.throwKind !== 'drop' || grounded)) {
        this.throwRef = null;
        this.throwState = null;
        this.throwKind = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        if (this.character?.landing) this.playOnce(this.character.landing);
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    if (this.character || this.dragSettings.lockPosition || !this.dragSettings.dragPhysics || this.throwKind === 'drop') return;
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = this.videoTransform(el.dataset.animation || this.anim) + ' scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.videoTransform(el.dataset.animation || this.anim);
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0 || this.dragState.active || this.suspended || this.forcedPassThrough) return;
    this.suppressNextClick = false;
    if (this.edgePeek.dock) this.edgePeek.cancel();
    this.setInteractive(true);
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [{ t: performance.now(), x: toLocal(e.screenX), y: toLocal(e.screenY) }];
    this.hit.classList.add('dragging');
    // 收起悬浮提示：拖拽期间窗口逐帧跟随光标，指针始终在身体内、onMouseMove 的 inBody 恒为真，
    // 不主动收就会让提示跟着宠物一路飘（松开后由 onPointerUp 按指针位置复位）
    this.setTip(false);
    this.stopMove();
    this.activePointerId = e.pointerId;
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    // 屏幕坐标是物理像素，除以 CONFIG.scale 进 CSS 系（§3.5）——增量公式两边同一单位。
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
      allowed: DragMotion.canDrag(this.dragSettings, e.shiftKey),
    };
    // 拖拽信号（桌面端专有）：主进程的兜底穿透通道按**光标与窗口矩形**判定，而窗口比宠物身体大一圈；
    // 拖拽中宠物滞后于光标，光标可能跑到窗口外→窗口翻回穿透→本窗口收不到 pointermove/pointerup
    // （宠物"飞"出去，见 pointer-target.js）。这里上报"我正在用输入"，主进程据此绝不翻回穿透。
    this.syncInputBusy();
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    if (!d.allowed || !DragMotion.canDrag(this.dragSettings, e.shiftKey)) {
      if (d.dragging) this.onPointerUp(undefined, true);
      return;
    }
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）；屏幕坐标 ÷scale 进 CSS 系
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      this.edgePeek.detachForDrag(d);
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length) {
        this.playOnce(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // 拖拽成立：主进程兜底通道闭嘴（见 inputBusy）
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用；÷scale 进 CSS 系）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    if (this.dragSettings.dragPhysics) this.startDragFollow();
    else this.sendBounds(this.dragTarget.x, this.dragTarget.y);
  }

  onPointerUp(e, cancelled = !e) {
    if (e && (e.pointerId !== this.activePointerId || (!cancelled && e.button !== 0))) return;
    const d = this.dragState;
    if (!d.active) return;
    const wasDragging = d.dragging;
    cancelled = cancelled || !d.allowed || this.dragSettings.lockPosition || (this.dragSettings.shiftDrag && e?.shiftKey === false);
    if (cancelled && wasDragging) this.suppressNextClick = true;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.syncInputBusy(); // 拖拽结束：交还给常规判定（幂等，非拖拽时多调一次不发 IPC）
    const pointerId = this.activePointerId;
    this.activePointerId = null;
    if (Number.isInteger(pointerId)) {
      try { this.hit.releasePointerCapture(pointerId); } catch {}
    }
    // 提示复位：点击/拖拽期间收起的悬浮提示，指针仍在命中区内就恢复（与浏览器 handlePointerUp 同一处理）。
    // 用 hitRect 几何判定而不是 getBoundingClientRect：命中区是窗口坐标里的权威几何，与 onMouseMove 同源。
    // 位置有讲究：必须留在 syncInputBusy() 之后——pointer-target.test.ts 只扫本函数开头 400 字符
    // 来找上报调用，插到它前面会把上报挤出窗口（该断言守的是"松手必上报，否则窗口粘在可交互"）。
    if (e && Number.isFinite(e.clientX)) {
      const r = this.hitRect;
      const px = e.clientX - this.margin.l;
      const py = e.clientY - this.margin.t;
      // 先按松手位置更新光标再摆位/显示，否则会重现拖拽前的位置（与浏览器 placeTip 同一处理）
      this.tipCursor = {
        x: this.pos.x - this.margin.l + e.clientX,
        y: this.pos.y - this.margin.t + e.clientY,
      };
      this.setTip(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    }
    if (!wasDragging && this.edgePeek.dock) {
      this.edgePeek.render(this.pos.x, this.pos.y, this.edgePeek.angle);
      this.edgePeek.schedule();
      return;
    }
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      // 吸边优先于甩出和下落；弹簧滞后时也检查指针的最终拖拽目标。
      if (!cancelled && (this.edgePeek.attach() || this.dragTarget && this.edgePeek.attach(this.dragTarget))) {
        this.dragTrail = []; this.reportMood('drag'); return;
      }
      // 拖拽松手：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器 handlePointerUp 一致）
      // 修复：旧实现 switchTo(idle,false)（loop=true，ended 永不触发）→ 随机链永远回不来，
      // 永远卡在同一段待机动画；改为 playOnce（once=true）播一遍 → ended → handleEnded → playIdle 随机链
      if (!this.resumeWorkStatusAnim()) {
        if (this.character?.landing) this.playOnce(this.character.landing);
        else if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const stationary = DragMotion.isStationary(this.dragTrail, performance.now());
      const estimated = S.estimateReleaseVelocity(this.dragTrail, performance.now(), { ...this.physics, maxThrowSpeed: DragMotion.cap(this.dragSettings) });
      const vel = !cancelled && this.dragSettings.dragPhysics ? estimated : null;
      this.dragTrail = [];
      this.reportMood(vel ? 'throw' : 'drag');
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy, 'throw');
      } else if (!cancelled && stationary && this.dragSettings.dropGravity) {
        this.startThrow(px, py, 0, 0, 'drop');
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  /**
   * 本窗口是否**必须保持可交互**（= "我正在用这个窗口的鼠标输入"）。
   *
   * 三个来源：拖拽中 / 右键菜单开着 / 对话弹窗开着——它们都是"窗口内的 DOM 或事件链正在被使用"，
   * 而它们的输入全部来自**窗口级鼠标事件**（pointermove/pointerup/click）：窗口一旦变回穿透，
   * 输入链就断了（拖拽会定格在最后一次采样上，松手也没人报 pointerup → 宠物按旧速度飞出去）。
   *
   * 这个信号是**渲染端专有的知识**：只有它知道"我正在用输入"，主进程无从推断（光看光标位置和窗口
   * 位移分不清"拖拽跟手"和"漫游/抛掷"）。同时上报控件矩形：菜单/聊天框外的透明区域继续穿透。
   */
  inputBusy() {
    return this.dragState.active || this.menuOpen || this.chatOpen || !!this.stickyOn;
  }

  /**
   * 上报一次"要不要保持可交互"。**所有**状态变化点都走这里（幂等：值没变不发 IPC）。
   * 与 setInteractive 的分工：setInteractive 表达"光标在不在身体上"（常规判定），
   * 本方法表达"我有没有在用输入"（优先级更高，覆写常规判定）。
   */
  syncInputBusy() {
    this.syncInputRegions();
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  }

  syncInputRegions() {
    this.syncRiceTarget();
    if (!window.petBridge || !window.petBridge.setInputRegions) return;
    const rects = [];
    const controls = [...document.querySelectorAll('.dsh-pet-menu-column, .dsh-pet-chat, .pet-sticky:not([hidden])')];
    for (const el of this.inputRegionElements) {
      if (!controls.includes(el)) {
        this.inputRegionResize.unobserve(el);
        this.inputRegionElements.delete(el);
      }
    }
    for (const el of controls) {
      if (!this.inputRegionElements.has(el)) {
        this.inputRegionElements.add(el);
        this.inputRegionResize.observe(el);
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x: toScreen(r.x), y: toScreen(r.y), width: toScreen(r.width), height: toScreen(r.height) });
      }
    }
    const body = EdgePeek.polygon(this.hitRect, this.edgePeek.angle).map(p => ({
      x: toScreen(p.x + this.margin.l), y: toScreen(p.y + this.margin.t),
    }));
    const input = { dragging: this.dragState.active, rects, body };
    const key = JSON.stringify(input);
    if (key === this._inputRegions) return;
    this._inputRegions = key;
    window.petBridge.setInputRegions(input);
  }

  setInteractive(flag) {
    const next = !!flag && !this.forcedPassThrough;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  /**
   * 悬浮提示显隐（替代原先挂在命中层 title 上的原生系统提示）。
   *
   * 由 onMouseMove 的「光标在不在身体命中区」驱动，而不是 pointerenter/pointerleave：
   * 身体外整窗是穿透的（main 的 setIgnoreMouseEvents(true, {forward:true})），光标离开身体时
   * pointerleave 未必派发，提示会赖在屏幕上不走；几何判定与点击穿透翻转同源，才不会有第二种口径。
   */
  setTip(on) {
    const next = !!on;
    if (next === this.tipOn) return;
    this.tipOn = next;
    this.renderTip();
  }

  /**
   * 悬浮提示渲染：文本 = 宠物显示名（host 已保证 name = rawName || id，不会空）；
   * 位置 = 光标右下（装不下自动翻边），摆位判据与浏览器端共用 shared 的 tooltipPlacement。
   *
   * 坐标要绕一次：光标存的是**视口坐标**（this.tipCursor），而提示是 position:fixed、
   * DOM 坐标相对**窗口**，所以这里减掉窗口原点（= 宠物包围盒左上角 − 四周余量）。
   * 为什么要存视口坐标而不是窗口坐标：宠物自己走动/被抛出时窗口会移动，存视口坐标就只需
   * 在这里按当前窗口原点重算一次，贴光标不会漂（sendBounds 每帧会调本函数）。
   */
  renderTip() {
    if (this.tip.textContent !== this.pet.name) this.tip.textContent = this.pet.name;
    const cursor = this.tipCursor;
    if (cursor) {
      const winX = this.pos.x - this.margin.l;
      const winY = this.pos.y - this.margin.t;
      const winW = this.size + this.margin.l + this.margin.r;
      const winH = this.winH + this.margin.t + this.margin.b;
      // 允许显示范围 = 窗口 ∩ 光标所在屏的工作区，两者必须取交集：
      // 只按窗口夹，窗口能贴到屏幕外，提示会被画到看不见的地方；只按工作区夹，提示会落到窗口外
      // （index.html 的 html,body 是 overflow:hidden，一样看不见）。
      const area = S.resolveRect(WORK_AREAS, cursor.x, cursor.y) ?? { x: winX, y: winY, width: winW, height: winH };
      const x0 = Math.max(winX, area.x);
      const y0 = Math.max(winY, area.y);
      const x1 = Math.min(winX + winW, area.x + area.width);
      const y1 = Math.min(winY + winH, area.y + area.height);
      const p = S.tooltipPlacement(
        { x: cursor.x - winX, y: cursor.y - winY },
        { w: this.tip.offsetWidth, h: this.tip.offsetHeight },
        { x: x0 - winX, y: y0 - winY, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
        this.size * S.TOOLTIP_GAP_RATIO,
      );
      this.tip.style.left = p.x + 'px';
      this.tip.style.top = p.y + 'px';
    }
    this.tip.classList.toggle('is-on', this.tipOn);
  }

  onMouseMove(e) {
    if (this.forcedPassThrough) { this.setTip(false); this.setInteractive(false); return; }
    // 拖拽态下所有按键已松开：说明 pointerup/pointercancel/lostpointercapture 全部丢失，
    // 就地按松手收尾，否则 dragState.active 与 inputBusy 永久为 true（穿透永不恢复）。
    // Electron's Windows forwarding hook posts WM_MOUSEMOVE with wParam=0,
    // even while the left button is held. A queued forwarded move must not
    // cancel a live captured press. Only recover when capture is also gone.
    if (this.dragState.active && e.buttons === 0 && !this.hit.hasPointerCapture(this.activePointerId)) {
      this.onPointerUp();
      return;
    }
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单/对话弹窗开启：整窗保持可交互（悬停菜单项/点输入框都不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen || this.chatOpen || this.stickyOn) {
      this.syncInputRegions(); // 级联菜单按悬停增减面板，及时更新其真实占用区域
      this.setInteractive(true);
      this.setTip(false); // 菜单/弹窗期间提示让位：光标已不在身体上，也不该跟浮层抢注意力
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 − 窗口屏幕位置推导（hitRect/pos 均为 CSS 系）：屏幕坐标 ÷scale 后
    // 减去窗口屏幕原点（CSS 系）即窗口内坐标
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    const inBody = EdgePeek.contains(EdgePeek.polygon(r, this.edgePeek.angle), px, py);
    // 光标位置存**视口坐标**（窗口原点 + 窗口内坐标）：窗口随宠物移动时贴光标不会漂，见 renderTip。
    // 必须在 setTip 之前更新：setTip 变显隐时会立刻渲染一次，晚一步就会用上一次的光标摆位。
    if (inBody) this.tipCursor = { x: this.pos.x - this.margin.l + wx, y: this.pos.y - this.margin.t + wy };
    this.setInteractive(inBody);
    // 悬浮提示与可交互判定同源（同一个 inBody）：光标进身体 → 提示出现，离开 → 收起
    this.setTip(inBody);
    // 跟随光标：位置依赖光标，所以每次移动都得重摆一次（setTip 只在显隐变化时才渲染）
    if (this.tipOn) this.renderTip();
  }

  onClick() {
    if (this.suppressNextClick) { this.suppressNextClick = false; return; }
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    if (this.edgePeek.expand()) { this.pressScoreFired = false; return; }
    this.reportMood('click');
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    // 心情点击反应：困了会被戳醒、寂寞时特别开心、被连戳会傲娇；台词同一心情 2 分钟内只说一次
    const click = this.mood && this.mood.click;
    if (click && Math.random() < (click.chance ?? 1)) {
      this.pendingSquash = true;
      const now = Date.now();
      if (now - (this.moodLines[this.mood.label] || 0) > 120000) {
        this.moodLines[this.mood.label] = now;
        this.showWhisper(S.pick(click.lines), '', click.anim);
      } else {
        this.playOnce(click.anim);
      }
      return;
    }
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  // 菜单/弹窗可视矩形（窗口局部坐标）= 窗口 ∩ 工作区（#41）：宠物贴屏幕底/右时窗口外扩余量
  // 伸出屏幕，窗口内固定定位的菜单/弹窗会走进被屏幕裁掉的部分。把菜单/弹窗约束到这个矩形内
  // 即可完整显示——**窗口和宠物零移动**，不存在跨进程位移竞态，也就不会瞬移闪帧。
  // 退化（可视区过小/窗口整体出屏，光标也点不到宠物）返回 null → 调用方按窗口视口兜底。
  visibleClampRect() {
    // pos 是视口相对坐标，窗口屏幕位置 = pos + VIEW 原点 − 外扩余量（见 sendBounds）；
    // 比较双方都用屏幕坐标（坐标系不混），返回的夹取矩形仍是窗口局部坐标。
    // 夹取用**宠物所在的那块屏**而不是外接矩形：外接矩形含空洞，按它夹菜单会伸进
    // 不属于任何显示器的区域（看不见）；菜单本来也不该跨屏显示。
    const area = S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.margin.l;
    const winY = this.pos.y + VIEW.y - this.margin.t;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }

  onContextMenu(e) {
    const d = this.dragState;
    e.preventDefault();
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    this.edgePeek.expand(false); // 先展开再约束菜单；菜单占用时不自动缩回。
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // 桌面专属工具根项（打开网站 / 碎碎念 / 对话 / 回到初始位置 / 重载配置）+ 共享菜单树（动作→分类→具体动画）
    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）
    // 首项文案随宿主形态变（OPEN_TARGET）：宿主是 DSH 桌面应用时点是"唤起桌面应用窗口"，仍叫「打开网站」会误导
    const tools = [];
    if (this.mood) tools.push({ label: '喂白饭', action: 'feed' });
    tools.push(
      { label: '碎碎念（来一句）', action: 'whisper' },
      { label: '和桌宠对话', action: 'chat' },
      { label: 'DDL 提醒 · 便签', action: 'reminders' },
      { label: '打开 Codex', action: 'open-codex' },
      { label: '打开 DeepSeek Harness', action: 'open-harness' },
      { label: '回到初始位置', action: 'home' },
      // 显示位置（仅网页/仅桌面/两者/都不）：改这只宠物的 display 配置 + 宿主重载生效。
      // 与浏览器端注入的是**同一份**子菜单（shared 的 displayMenuBranch），两端文案/取值不会漂移。
      // 为什么不就地关窗/开窗：桌面宠物共用一个 Electron 进程，窗口是进程启动时按 DSH_PET_PETS
      // 一次性建的——就地增删窗口既改不了磁盘配置（下次启动又回来）也改不了窗口数量。
      S.displayMenuBranch(),
      // 改配置文件后免去回设置页点保存：请宿主重启桌面 Helper（全部桌面宠物窗口按最新配置重建）。
      // 放在最后：它是"重新加载"这类维护动作，与上面几个宠物互动项语义不同。
      { label: '重载配置', action: 'reload' },
    );
    const tree = tools.concat(S.buildMenuTree(this.animations));
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    this.syncInputBusy();
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // 只允许在「窗口 ∩ 工作区」内显示：宠物贴边时外扩余量伸出屏幕，菜单走进那里会被 OS 裁掉（#41）
      clamp: this.visibleClampRect(),
      // 只有真人在右键菜单里点选才算互动；宿主经 anim 叶子点播（如安静时段的开饭）也走 onMenuAction，不能算
      onAction: (leaf) => {
        this.reportMood('menu');
        this.onMenuAction(leaf);
      },
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        this.syncInputBusy();
        if (!this.inputBusy()) this.setInteractive(false);
      },
    });
    this.menuClose = m.close;
    this.syncInputRegions(); // mountContextMenu 完成布局后才能读取菜单矩形
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (leaf.action === 'reminders') { window.showPetReminders?.(this); return; }
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action === 'open-harness') { window.petBridge?.openHarness(); return; }
    if (leaf.action === 'open-codex') { S.postAction(BASE + '/ack').then(()=>pollStateNow()).catch(()=>{}); window.petBridge?.openCodex(); return; }
    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // 系统默认浏览器打开（等效 Ctrl+点击链接）
      return;
    }
    if (leaf.action === 'feed') { this.syncRiceTarget(); window.petBridge?.spawnRice?.(); return; }
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }
    if (leaf.action === 'set-display') {
      this.setPetDisplay(leaf.display); // 改这只宠物的显示位置：写 display 配置，由宿主重载生效
      return;
    }
    if (leaf.action === 'reload') {
      this.reloadDesktop(); // 请宿主重启桌面 Helper：全部桌面宠物窗口按最新配置重建
      return;
    }
    if (!leaf.anim) return;
    if (!this.actionAllowed(leaf.anim)) { this.showWhisper('此动作已禁止，请到管理面板开启相应动作开关。'); return; }
    if (this.isFlightAnimation(leaf.anim)) {
      if (!this.tryFlight(leaf.anim)) this.showWhisper('当前方向空间不足，或正在交互中，请稍后再试。');
      return;
    }
    this.stopMove();
    if (leaf.anim.startsWith('碎碎念-')) { this.showWhisperFromMenu(leaf.anim); return; }
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    this.syncInputBusy(); // 菜单关：若没有别的占用（拖拽/弹窗）则交还常规判定
    if (!this.inputBusy()) this.setInteractive(false);
  }

  // 「碎碎念」菜单：POST 动作让 host 立即新生成一句（写进 S），随即立刻跑一拍 /state 拿文本展示
  // （0 延迟，不用等下一个 1s）。动作不回文本——文本只有一个出口（S）。
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期，手动永远可用。
  showWhisperFromMenu(animation) {
    S.postAction(WHISPER_URL + '?pet=' + encodeURIComponent(this.pet.id) + (animation ? '&animation=' + encodeURIComponent(animation) : ''))
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单碎碎念：生成动作未成功 pet=' + this.pet.id);
        pollStateNow(); // 立即拉一拍：文本随这一拍到达并展示
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。
  showChatFromMenu() {
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
      return; // 已开着：先关旧的
    }
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // 弹窗同菜单：只允许在「窗口 ∩ 工作区」内显示，贴边时不被屏幕裁掉（#41）
      clamp: this.visibleClampRect(),
      onSent: () => {
        // 发送成功：回复已写进 S，立刻跑一拍 /state 让气泡 0 延迟出现（不必等下一个 1s）
        console.info('[dsh-pet] 对话已发送 pet=' + this.pet.id);
        pollStateNow();
      },
      onClose: () => {
        this.chatClose = null;
        this.chatOpen = false;
        this.syncInputBusy(); // 弹窗关：交还常规判定（菜单还开着的话仍保持忙，见 inputBusy）
        if (!this.menuOpen) this.setInteractive(false); // 弹窗关了且无菜单：恢复命中区穿透
      },
    });
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    this.syncInputBusy();
    this.setInteractive(true);
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    if (this.dragSettings.lockPosition) return;
    this.edgePeek.release(false);
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  // 「重载配置」菜单：请宿主重启桌面 Helper —— 与设置页「保存」**同一条**重启路径
  // （宿主 POST /reload → syncDesktop：串行队列 + 等旧进程真正退出再起新的）。
  // 为什么不在渲染端就地重拉配置：① 每只宠物一个窗口是宿主按 DSH_PET_PETS 建的，
  // 就地重拉改不了宠物数量/display/size；② 本页的余额/工作状态等全局轮询是一次性启动的
  // （events.js 的 loopsStarted 门控），就地重建 sprite 会漏启新循环或留下旧定时器。
  // 本请求由**即将被重启的这个进程**发出：响应可能永远不回（宿主杀进程时回调地址已失效），
  // 故不 await、不重试，失败只记日志——重载本身就是把本进程换掉。
  reloadDesktop() {
    fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {
      console.warn('[dsh-pet] 重载配置请求失败（宿主不可达？）', e);
    });
  }

  // 「显示位置」菜单：改**这一只**宠物的 display（仅网页/仅桌面/两者/都不）—— 写它自己的配置，
  // 再由宿主重载生效。取值直接来自菜单项（shared 的 displayMenuBranch），渲染端不做任何推导：
  // 当前状态以配置为准，推导只会多一处可能与真相不符的猜测（旧实现的 both→web 就是这种猜测）。
  // 为什么不在渲染端就地关窗/开窗：桌面宠物共用一个 Electron 进程，窗口是进程启动时按 DSH_PET_PETS
  // 一次性建的——就地增删窗口既改不了磁盘配置（宿主下次重载它又回来），也改不了窗口数量。
  // 与 reloadDesktop 同一处境：选"仅网页/都不"时本进程就会在重载中被换掉，响应可能永远不回
  // （宿主杀进程时回调地址已失效），故不 await、不重试，失败只记日志。
  setPetDisplay(display) {
    if (!display) return;
    fetch(BASE + '/pet-display', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: this.pet.id, display }),
    }).catch((e) => {
      console.warn('[dsh-pet] 显示位置请求失败（宿主不可达？）', e);
    });
  }

  renderBubble() {
    // 气泡单槽：同一时刻只显示一个（优先级：终态任务 > 碎碎念/对话 > 余额 > 非终态任务）。
    // 为什么终态任务不让位：完成/失败气泡只活 10s，被事件顶掉就彻底看不到了；非终态任务气泡
    // 常驻（不设自动收起），让位 10s 零损失。与浏览器 src/client/pet.ts 的单槽优先级同一套。
    // 工作气泡与碎碎念同款弹窗样式：宽度自适应 + 自动换行（is-whisper：正常 white-space、宽随内容）
    // 配图标记交给 CSS：带图时取消 min-width（样式在 shared 的 MEME_BUBBLE_CSS，两端同一份）。
    // 图片 URL 与视频同规则：传 BASE 前缀（桌面是 file:// 页面，必须绝对地址）
    // 素材根同理（配图的归属与动画一致：pet/<素材根>-memes/ 独占 → 用户目录 → 包内）
    const workOn = !!(this.workOn && this.workText);
    const whisperOn = !!(this.whisperOn && this.whisperView);
    const balanceOn = !!(this.bubbleOn && this.balanceView);
    const workTerminal = this.workState === 'success' || this.workState === 'error';
    const slot =
      Date.now() < (this.ackUntil || 0) && whisperOn ? 'whisper' : workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';
    const whisperImg = slot === 'whisper' ? S.createMemeImage(this.whisperImage, BASE, this.assetRoot) : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // 余额「文字说明」（不可用状态）同样要换行变体：默认 nowrap 会把长文案顶出宠物宽度
      slot === 'whisper' || slot === 'work' || (slot === 'balance' && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    if (slot === 'none') {
      // 三者都没有可显示的内容：隐藏（不占位，也就不会挡住任何一层）
      this.bubble.classList.remove('is-on');
      return;
    }
    this.bubble.innerHTML = '';
    if (slot === 'work') {
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
    } else if (slot === 'whisper') {
      // 配图（shared 生成的 <img> + 共用样式）：先看图再读话，符合"配图"的阅读顺序
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
    } else {
      const rows = this.balanceView;
      const hasTier = rows.some((r) => r.role === 'tier');
      if (hasTier) {
        // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
        const line = document.createElement('div');
        line.className = 'pet-bub-row';
        for (const r of rows) {
          const span = document.createElement('span');
          if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
          span.textContent = r.text;
          line.appendChild(span);
        }
        this.bubble.appendChild(line);
      } else {
        for (const r of rows) {
          const div = document.createElement('div');
          if (r.role === 'error') div.className = 'pet-bub-err';
          else if (r.role === 'stale') div.className = 'pet-bub-row pet-bub-sub pet-bub-stale';
          else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
          else div.className = 'pet-bub-row';
          div.textContent = r.text;
          this.bubble.appendChild(div);
        }
      }
    }
    this.bubble.classList.add('is-on');
  }
}
