# 源码结构与功能扩展指南

> 阅读基线：2026-10-30，仓库版本 1.4.5。本文面向后续维护与功能新增，依据当前实际运行入口整理，不把中文设计稿中的设想视为已实现功能。
>
> 工作区：`D:\Ai\Codex-dafeiyu`。下文文件路径均相对于仓库根目录，便于迁移和复用。初次阅读后已进行模型路由的本地源码改造，并执行离线测试与语法检查；本轮已安装依赖、完成完整工程检查，并对已同步的旧便携版做隔离启动验证；没有调用真实模型或读取个人认证/Key。

## 1. 先建立正确的工程认知

这是一个 **Windows Electron 桌面陪伴应用**，包含管理窗口、透明桌宠窗口、独立 Node 后台，以及 Codex、第三方模型、提醒、心情和 B 站生活等服务。

需要特别记住：

1. **它是分发包恢复整理工程，不是完整原始源码工程。** `app/backend/lib/` 中的 JavaScript 可以编辑，但对应的原始 TypeScript、原构建配置不在仓库中。文件内的 `//#region src/...ts` 是构建来源标记，不代表这些 TS 文件实际存在。
2. **维护权威目录是 `app/`。** 根目录旧成品、`backups/`、`.runtime/` 和 `dist/` 不应作为业务修改目标。前两者是旧文件或备份，后两者是生成输出。用户若运行旧成品 EXE，源码修改不会自动生效；本地可用 `scripts/update-local.ps1` 备份并同步程序文件，个人数据保持独立。
3. **运行主入口是 `app/main.cjs → app/backend-entry.mjs → app/backend/lib/standalone.js`。** 不要只修改 `lib/index.js` 或 `lib/client.js` 就期待当前独立桌面程序生效。
4. **构建是组装便携包，不是重新编译全部原工程。** `DesktopBridge.exe` 暂时只有二进制，没有 C# 源码，不能从当前仓库完整重建。
5. **业务不全依赖 AI。** 动画、拖拽、语录、心情和提醒可本地运行；聊天与 B 站内容理解才涉及模型服务。

来源及限制以 `README.md`、`docs/PROVENANCE.md` 为准。当前基线有 256 个 Git 跟踪文件，其中 111 个 WEBM 动画；这是新增本文之前的统计。

### 技术栈

| 层 | 当前实现 |
| --- | --- |
| 桌面运行时 | Electron 43.8.4，Windows x64 |
| 后台运行时 | Node.js 24.19.0，随便携包复制 Node 可执行文件 |
| 管理界面 | 原生 HTML / CSS / JavaScript，分面板脚本，无 React/Vue 构建链 |
| 主进程 | CommonJS `.cjs`，桌宠 helper 使用独立 Electron 入口 |
| 业务服务 | ESM `.mjs` 及已构建的 ESM `.js` |
| 依赖管理 | 根目录 `package.json` 和 `package-lock.json`；npm 11 |
| 自动测试 | Node 内置 `node:test`；Windows 隔离启动 smoke |
| 主要外部依赖 | Electron、qrcode、Electron 下载/解压相关依赖 |

Electron 虽声明为开发依赖，但会成为交付运行时，所以发布前安全检查不能只使用 `npm audit --omit=dev`。

## 2. 目录导航

```text
Codex-dafeiyu/
├─ package.json / package-lock.json     唯一依赖锁定与开发命令入口
├─ README.md / SECURITY.md              使用入口、安全与隐私边界
├─ docs/
│  ├─ PROVENANCE.md                     来源、缺失源码、可重建范围
│  ├─ USAGE.md                          功能使用、环境变量等说明
│  └─ CODEBASE_GUIDE.md                 本文
├─ app/                                业务维护主目录
│  ├─ main.cjs                         管理主进程、托盘、IPC、后台生命周期
│  ├─ preload.cjs                      仅暴露 window.pet.status/action
│  ├─ runtime-utils.cjs                默认数据初始化、包完整性、代理环境
│  ├─ backend-entry.mjs                Node 后台入口、父进程存活、stdin 消息
│  ├─ bili-login.cjs                   B 站扫码登录与加密登录态管理
│  ├─ panel.html / panel.css / panel.js 管理窗口骨架、样式、状态与基础操作
│  ├─ chat-panel.js                    多会话、聊天、人设配置
│  ├─ llm-panel.js                     第三方服务配置、模型列表、测试连接
│  ├─ mood-panel.js                    心情状态、喂食、陪伴与设置
│  ├─ reminders-panel.js               提醒草稿、确认、列表与操作
│  ├─ bili-panel.js                    B 站生活、登录、日记与反馈
│  ├─ defaults/                        首次启动种子与语录升级清单
│  ├─ assets/                          管理窗口图标和图片
│  ├─ DesktopBridge.exe                无对应源码的 Windows 桥接二进制
│  └─ backend/
│     ├─ lib/
│     │  ├─ standalone.js              当前独立后台装配、配置、状态、路由
│     │  ├─ index.js                   保留的 DSH 宿主插件实现
│     │  └─ client.js                  保留的 DSH 浏览器插件 bundle
│     ├─ runtime/
│     │  ├─ codex-activity.mjs         本地 Codex 工作状态读取
│     │  ├─ codex-rpc.mjs              Codex app-server JSON-RPC 连接
│     │  ├─ model-router.mjs           聊天、B 站生成及识图的统一模型开关
│     │  ├─ codex-chat.mjs             Codex 聊天、后台生成、临时图片与模型选择
│     │  ├─ codex-usage/               账号/限额读取与计划信息
│     │  ├─ quota-cache.mjs            绑定登录身份的额度缓存
│     │  ├─ pet-conversations.mjs      会话、历史、流式状态、记忆、人设接入
│     │  ├─ persona.mjs                预设人设、此刻状态、动作标签
│     │  ├─ third-party-llm.mjs        OpenAI-compatible 模型与识图接口
│     │  ├─ reminders.mjs             本地中文提醒解析与调度状态
│     │  ├─ mood.mjs                  本地心情、情绪、亲密度与主动表达
│     │  ├─ bili/                     选视频、阅读、截帧、分享、日记、节奏
│     │  └─ electron-helper/          透明桌宠窗口、视频动画、交互与小游戏
│     └─ assets/
│        ├─ config.jsonc              包内基础配置
│        ├─ webm/                     动作视频，中文文件名是配置契约
│        ├─ pic/ / memes/             通知、光标、白饭、表情包等图片
│        └─ fonts/                    字体素材
├─ scripts/                            check/start/build/smoke/package 等
├─ tests/                              六个离线回归测试文件
├─ .github/workflows/ci.yml             Windows 安装、检查、测试、audit、smoke
├─ licenses/                           上游与运行时许可证副本
└─ THIRD_PARTY_NOTICES.md               第三方归属及素材声明
```

根目录中文设计/调研稿是有用的历史背景，但被 `.gitignore` 排除，不是当前工程的唯一事实来源。判断功能是否落地，应找到入口、服务装配、界面调用和测试证据。

## 3. 实际启动与进程结构

### 3.1 从开发命令到后台

```text
npm start
  → scripts/start.mjs
  → scripts/build.mjs：检查并组装 .runtime/Codex-dafeiyu-v1.4.5-windows-x64/
  → Codex-dafeiyu.exe
  → resources/app/main.cjs
      ├─ 管理窗口 / 托盘 / 单实例 / safeStorage
      ├─ DesktopBridge.exe：全屏检测、打开 Codex、聚焦管理窗口
      └─ resources/app/node.exe
          → backend-entry.mjs
          → backend/lib/standalone.js
              ├─ 本地 HTTP、业务服务、状态中心
              ├─ Electron 桌宠 helper（同一 EXE，CODEX_PET_HELPER=1）
              ├─ 按需 Codex app-server 子进程
              └─ 按需 B 站截帧 Electron 子进程
```

`main.cjs` 遇到 helper/截帧启动标志会转入对应入口，不再启动普通管理窗口。后台入口设置 `--port 0`，由操作系统分配端口；管理进程从后台输出中识别有效的 `127.0.0.1` 地址。

### 3.2 生命周期

- 管理程序是单实例；关闭管理窗口通常只是隐藏，托盘退出负责结束后台等资源。
- `backend-entry.mjs` 每 2 秒检查管理进程 PID，父进程消失则退出。
- helper 有后台宿主存活检查，避免留下孤儿桌宠窗口。
- helper 启动管理有重启退避/熔断逻辑；不能据此认为所有后台业务都有自动恢复。
- 管理进程对后台退出会报告状态，未见等价的完整后台自动重启方案。
- 改动 timer、监听器或子进程时，应同时检查 effect/dispose、stop 和退出清理。

## 4. 三种通信通道，不要混淆

### 4.1 管理窗口：preload → IPC → 后台 HTTP

```text
各面板脚本
  → window.pet.status() / window.pet.action(action, payload)
  → app/preload.cjs：ipcRenderer.invoke
  → app/main.cjs：pet:status / pet:action 白名单分发
  → 127.0.0.1 随机端口 HTTP，带本次运行 Bearer token
  → standalone.js 的 handlePetRoute
  → runtime 服务
```

管理 renderer 禁用 Node integration，启用 contextIsolation 和 sandbox，并限制导航/新窗口。preload 当前是很窄的通用桥；新增大多数面板功能，不需要扩大为任意 IPC 或任意文件访问接口。

HTTP 主路由前缀是 **`/dsh-pet-7340`**，其中 `7340` 是路径名，不是固定监听端口。

| 路径（省略前缀） | 主要用途 | 常用管理 action |
| --- | --- | --- |
| `state` GET | 额度、工作、通知、心情与桌宠增量计数快照 | `pet.status()` |
| `pet-chat` GET/POST | 会话、人设、记忆设置、发送等命令 | `chat-state` / `chat-command` |
| `chat` POST | 桌宠简易聊天，也接入当前会话服务 | `chat` |
| `llm` GET/POST | 第三方配置、模型列表和测试 | `llm-state` / `llm-command` |
| `mood` GET/POST | 心情视图、设置、事件 | `mood-state` / `mood-command` |
| `reminders` GET/POST | 提醒快照、解析、保存、完成等命令 | `reminders-state` / `reminders-command` |
| `bili` GET/POST | 生活设置、内容、日记、反馈、手动唤醒等 | `bili-state` / `bili-command` |
| `balance` POST | 手动刷新额度 | `quota` |
| `whisper` POST | 碎碎念 | `quote` |
| `control` POST | 请求/消费键盘控制模式 | `control` |
| `manager` POST | 写控制文件，请管理窗口打开提醒页 | helper 发起 |

另有 `config`、`config/meta`、`pet-display`、`reload`、`models`、`broadcast`、`anim` 及素材路由；它们在后台配置/桌宠能力中使用，不都暴露在管理面板。

路由返回的业务失败有时是 HTTP 200 加 `{ok:false,message}`，不能仅凭 HTTP 状态判断成功。

### 4.2 管理 → 后台 stdin：敏感信息和 presence

`backend-entry.mjs` 按换行解析 JSON 消息：

- `llm-keys`：管理进程解密的第三方 Key，交给第三方模块的内存 Key map。
- `bili-cred`：管理进程解密的 B 站登录态，交给 B 站客户端内存。
- `presence`：系统闲置/锁屏状态，输入心情系统。

不要把这些消息当成日志输出，也不要为了方便改成 Key 明文配置文件。

### 4.3 桌宠 helper：自定义 scheme → stdout → HTTP 回调

```text
helper renderer fetch(dsh-pet-bridge://...)
  → helper main.js 的 protocol.handle
  → stdout 输出 dsh-pet-bridge: 前缀的 JSON 请求行
  → standalone.js 的 HelperProcess 解析请求
  → 同一个 handlePetRoute 执行业务
  → 后台将应答 POST 到 helper 的本地随机端口 /respond
  → helper 匹配 pending 请求并组装 Response
  → renderer 获得 JSON / 图片 / WEBM
```

这是为规避 Windows Electron 管道 stdin 的问题而采用的双向桥，不是普通的 renderer 直连后台 HTTP，也不是只有 stdout 单向通信。素材应答传的是后台解析后的文件路径，由 helper 读盘；视频二进制不通过 stdout 传输。

修改桥协议时必须同时检查 `HelperProcess`、helper `main.js`、相关 preload/调用端及超时/退出逻辑。主 HTTP token 的保护不自动覆盖 helper 的回调服务器，详见风险清单。

## 5. 后台入口与重复 bundle 的维护策略

`standalone.js` 是目前较大的装配文件，包含以下职责：

- 配置解析、迁移、默认值/种类合并与素材路径解析。
- helper 进程控制、桥协议与响应转发。
- 额度刷新、本地语录、部分沿用的宿主聊天逻辑。
- `PollStateStore`、工作状态、通知及桌宠事件发布。
- `apply(ctx)` 中的服务实例化、生命周期与业务联动。
- `handlePetRoute` 路由，以及独立 HTTP server、context 适配与 CLI 启动。

`STANDALONE_PROVIDER = "codex"`；独立 context 中一些 DSH 命令、事件和模型接口是适配 stub。当前聊天及 B 站内容理解到底用 Codex 还是第三方模型，由 model-router 按每次请求读取第三方开关决定，不能只看宿主 provider 常量。

`index.js` 导出 DSH 宿主的 `apply/inject/name`；`client.js` 末尾向 `window.__ModuleLoader__` 注册 DSH 插件。它们和 standalone 存在重复实现，并已经不完全同步，例如独立版的心情、B 站和第三方模型装配并不能在插件入口中等价找到。

**推荐：新业务规则写入 `backend/runtime/` 的可测试模块，只在实际 standalone 入口做薄装配。** 不要盲目修改全部重复 bundle；若以后确实恢复插件兼容，应单独定义兼容目标、共享模块和构建流程。

## 6. 各功能模块的职责与关键调用链

### 6.1 桌宠、动画、交互与控制小游戏

核心目录：`app/backend/runtime/electron-helper/`。

| 文件 | 职责 |
| --- | --- |
| `main.js` | 透明窗口、每宠窗口管理、多屏/DPI、鼠标穿透、焦点、可见性恢复、全屏避让、桥协议 |
| `preload.js` | helper 主/渲染进程允许的交互接口 |
| `shared-core.js` | `window.PetShared` 共享纯逻辑：配置拍平、动画选择、菜单、气泡/聊天、物理与计数消费 |
| `constants.js` | 渲染基础设施与约定 |
| `sprite.js` | 桌宠本体、双 video 切换、待机/移动、拖拽/甩抛、点击、菜单、气泡、心情修饰 |
| `events.js` | 拉取状态，联动额度/工作/通知/心情/说话/动作 |
| `renderer.js` | 组装渲染对象与启动 |
| `features.js` | 提醒便签、控制请求消费等附加能力 |
| `game.html/js`、`game-preload.js`、`game-physics.js` | 键盘控制、白饭投射、摔倒及结束后恢复普通桌宠 |
| `desktop-geometry.js`、`dpi-linearization.js` | 桌面边界与 DPI 几何逻辑 |
| `pointer-target.js`、`visibility-recovery.js` | 指针目标及隐藏/穿透后恢复 |
| `host-liveness.js`、`topmost-watchdog.js` | 宿主存活和置顶保活 |

`index.html` 的经典 script 顺序是 shared-core → constants → sprite → events → renderer → features。这里不是常规前端 ESM 工程；调换顺序或直接引入 file:// ESM 需要考虑既有全局依赖和 CORS。

动画配置、素材文件名、后台动作标签及 renderer 选择逻辑是一条契约。增加动作不能只放一个 WEBM；还要确认配置分组/权重、名称解析、回退动作、切换结束和素材路由。

底层支持多个 pet 配置和窗口，但心情、会话、B 站和不少写状态调用仍使用 `main`。**“可以显示多宠”不等于“业务状态已经完全按宠物隔离”。**

### 6.2 Codex 工作状态、额度与聊天

三个功能的数据来源不同：

1. **工作状态**：`codex-activity.mjs` 用 Node 内置 SQLite 只读 `CODEX_HOME/thread_history_1.sqlite` 的 `thread_turns/thread_items`，每 2 秒聚合本地状态；等待优先、10 分钟无活动视为陈旧，近期完成/失败约展示 12 秒。发布的是状态摘要，不是任务消息、工具参数或文件名。
2. **额度**：`codex-usage/usage.mjs` 解析本机 Codex CLI，启动 `codex app-server --stdio`，执行 initialize → account/read → account/rateLimits/read；不是发送模型请求。仅手动按 ChatGPT 登录额度模式读取，默认折叠，后台不自动查询；它不是模型请求的前置条件。`quota-cache.mjs` 用认证文件哈希 scope 与账号 fingerprint 防跨账号旧缓存，查询失败可以标明 stale。
3. **聊天/生成/识图**：`model-router.mjs → codex-chat.mjs → codex-rpc.mjs`，按需复用 app-server 连接，每次请求读取有效配置；需要模型目录时缓存约 60 秒，闲置约 5 分钟且无在途请求才关闭。创建 read-only、ephemeral 会话，限制 shell、工具、插件、MCP、apps、web 和 memories 等能力；这是陪伴聊天，不应被误改为任意任务执行接口。

所有聊天/生成/识图优先使用本机 Codex 有效配置的 model 与 model_reasoning_effort，不覆盖 model_provider，不要求 ChatGPT 登录模式，也不要求 CC Switch 自定义模型出现在 model/list 中；思考档位未指定时交给 Codex 默认值。模型未配置时才取目录默认/首个可用项，不限定必须支持 low。已移除系列选择与 low 限制，旧 sol/luna 会话迁移为 auto，历史、画像补充和明确的画像开关保留；新用户画像读取默认关闭。SQLite schema 和 RPC 字段依赖外部 Codex 版本，应集中在适配层做容错。

已删除第三方“重置雷达”：管理面板、托盘、桌宠右键菜单及请求分支、IPC、standalone/旧插件后台路由与对应模块均不再提供该功能。普通手动额度查询仍可显示接口实际返回的重置时间，不涉及预测站。

### 6.3 会话、人设、记忆与动作

`pet-conversations.mjs` 负责多会话、active 会话、历史、全局发送互斥、pending 流式文本和错误记录。正常聊天历史用临时文件加 rename 保存；损坏历史保留 `.corrupt-*.bak`，另有旧 `dsh-pet/memory.json` 迁移入口。

```text
chat-panel / 桌宠聊天
  → pet-chat / chat
  → conversations.command
      ├─ 读取本条消息当前使用的 provider
      ├─ persona.buildPersona：稳定人设
      ├─ mood/persona 此刻状态：本轮上下文
      ├─ 可选授权个人摘要和用户补充
      ├─ 可选 B 站链接资料（B 站生活开关开启，Codex/第三方均可）
      └─ model-router 按单开关选择 Codex 或第三方模型流式生成
  → 移除并解析白名单 [动作:...] 标签
  → 存文本历史、返回动作、发布气泡/动画和心情事件
```

- 人设提供四种预设，以及名字、称呼、补充说明、共享状态/动作开关。
- 名字/称呼最多 12 字，人设补充最多 800 字；动作标签只映射白名单动画，不执行任意代码。
- 用户画像仅抽取 `CODEX_HOME/memories/memory_summary.md` 指定个人/偏好/当前项目标题块，最多 4500 字；另有最多 3000 字用户补充。不是读取所有 Codex 记忆。
- 用户消息 1–2000 字，最终回复截断到 1800 字；Codex 使用最近 6 条历史、每条最多 1200 字，第三方有可配置 historyRounds。
- “此刻”与视频资料用于当前请求，不应无意永久污染人设或原始会话历史。
- 管理聊天面板闲置约 2 秒轮询，流式时约 150 ms；不是端到端 WebSocket/SSE 推送。

### 6.4 第三方模型与 Key

`third-party-llm.mjs` 实现多 profile、当前服务选择、模型列表、测试连接、OpenAI-compatible Chat Completions、流式正文提取及识图配置。

`model-router.mjs` 是统一分流入口，chat/generate/see 每次调用按 enabled 选择同一个模型来源；第三方配置开启但不完整时提示错误，不回退 Codex。第三方关闭时忽略已保存的第三方识图配置。Codex generate/see 不受聊天输入/输出的 2000/1800 字截断；图片经 localImage 送入临时会话并在 finally 清理，失败时只取消本轮，不切换服务或中断其他在途请求。

- 支持 system/direct/custom 代理模式，以及本地无 Key 服务。
- SSE 提取回答正文，不把 `reasoning_content` 当回复展示。
- 400/422 时可以去掉可选参数重试一次，需要留意计费和重复请求语义。
- 带 Key 的请求只能发往 HTTPS，loopback HTTP 例外；未保存配置的测试/模型列表有已保存 Key 的地址匹配保护。
- 测试连接真的调用模型，可能收费，不是纯网络连通性探测。
- 非秘密配置是 `data/dsh-pet/third-party-llm.json`，Key 不写入该 JSON；管理进程通过 safeStorage 保存并经 stdin 注入内存。

新增服务商首先考虑复用 profile/兼容接口，不要在 UI、后台及多个 bundle 内分别硬编码一套请求逻辑。

### 6.5 心情与陪伴

`mood.mjs` 是 **本地规则状态机**，没有模型调用。九种标签为：睡着、傲娇、担心、开心、饿、困、寂寞、元气、平常；优先级集中在 `computeMood`。

主要输入/行为：

- 时间曲线能量、饱腹（每小时下降 12）、闲置/锁屏、点击/喂食/聊天。
- 自动饭点及忙碌导致的延后/错过；Codex 成功/失败、任务时长、提醒 DDL。
- 亲密度四档（0/60/80/95）、陪伴天数、成长与适度回落。
- joy/proud/annoyed 情绪叠加、半衰期与余温。
- 情景、节日、里程碑、离开归来、昨日任务回忆和点击反应。
- 约 30 秒 tick；发布心情修饰，影响动画权重、点击和语录选取。
- 主动讲话每日上限 40 条，讲话后至少约 3 分钟间隔，quiet hours、被忽略降频、随机轮次间隔和跨重启语录轮换。

改心情算法应先改/测纯函数，再接状态服务和 UI；不要在 sprite 内再计算另一套心情。修改文案时同时检查变量占位符、亲密度分组、轮换和静默规则。

### 6.6 提醒

`reminders.mjs` 用中文规则解析相对日期/时间，不依赖 LLM。流程是解析 → 草稿补充确认 → preview/save，不能把含糊的“提醒我交报告”直接解释为确定日期。

支持 IANA 时区、DST 不存在时间校验、once/daily/weekly、提前量、完成/跳过/删除/延后 15 分钟。最多 200 条提醒、最多 8 个提前触发点。

调度 tick 由 snapshot/command 等调用触发，**不是独立提醒定时器**；当前 helper 等轮询以及其他服务调用维持调度。若以后改变轮询或后台服务常驻模式，需要重新确认提醒是否按时触发。

存储文件是 `data/reminders.json`；损坏文件保留恢复依据。重复提醒、时区、升级数据和跨日逻辑是新增提醒功能时的重点测试对象。

### 6.7 B 站生活：当前只读内容，不对外发言

默认关闭。当前实现的闭环是：作息计划 → 选视频 → 粗读 → 模型筛选 → 细读 → 可选识图 → 桌面分享 → 日记 → 用户反馈/沉默降频。没有向 B 站发布评论或动态的业务功能。

| 文件 | 职责 |
| --- | --- |
| `bili/api.mjs` | WBI、cookies、设备标识、缓存、访问节奏、预算及风控熔断 |
| `bili/feed.mjs` | 搜索/热门/登录动态、口味、去重、seen/dislike 过滤 |
| `bili/watch.mjs` | BV/链接解析、简介/字幕/弹幕热点/评论与资料整理 |
| `bili/prompts.mjs` | screen/deep/look、两类日记、校准提示与结果解析 |
| `bili/life.mjs` | 作息 plan、串行 wake、分享限额、反馈和生活持久化 |
| `bili/frames.mjs` | 截帧时刻、页面优先/登录后流地址回退、3×3 拼图和清理 |
| `grabber.cjs/html/js`、`grabber-preload.cjs` | 独立隐藏 Electron 实际取视频画面 |
| `app/bili-login.cjs` | 管理进程扫码登录、验证、加密持久化与 stdin 交付 |

完整生活流程现在与聊天共用模型开关：第三方关闭时使用本机 Codex（含 CC Switch 中转），开启时使用第三方配置；不再要求先启用第三方 API。图片能力取决于实际模型，截帧/识图失败仍继续阅读文字资料。

默认计划为夜间 20–24 点一次，30% 概率不看，挑选 5 条候选，关闭识图，每日最多分享 3 条。客户端约 1.5 秒节奏、小时/日读取预算及 412 等风控熔断应保留，不要为了“加快”并发绕过。

陌生人标题/评论等被标记为外部资料而不是指令，用户名做脱敏。聊天中视频链接可以带当前视频资料/识图结果进入本轮上下文，但不把资料塞进永久聊天历史。

截帧生成 9 帧 3×3 JPEG，先走视频页，失败且有登录条件再走 MP4；保留最近约 20 张 grid。MP4 路径的 `webSecurity:false` 是已明确的持续安全关注点，不适合复用为通用浏览器。

“倾听”及“对外发言”等进一步交互应视为新需求，而不是当前已有能力；需要新的授权、内容安全、频率限制和失败补偿设计。

## 7. 状态、轮询与事件优先级

`PollStateStore` 的核心形状：

```js
{
  sections: {
    balance:    { counter, data },
    workStatus: { counter, data },
    notify:     { counter, data },
    mood:       { counter, data }
  },
  pets: {
    main: {
      say:  { counter, data },
      anim: { counter, data }
    }
  }
}
```

counter 按 `max(Date.now(), last + 1)` 单调增长。helper `events.js` 通常每秒拉取 `/state`，对比 counter 判断更新。第一次请求建立基线，避免重放历史气泡；持续性的工作/心情状态仍要首次应用。

**这是“每槽最新值快照”，不是可靠消息队列。** 两个服务在同一轮询间隔内写 say/anim，前者可能被后者覆盖。新增重要消息时需要明确去重、优先级、延后/排队和取消语义。

工作气泡已有类似“终态 > whisper > balance > 非终态”的抢占规则；新增消息不要绕过当前状态与气泡仲裁。心情已提供间隔/静默门控，其他主动消息也应审查是否一致遵守。

当前多个管理面板独立轮询：主状态约 2 秒、心情约 5 秒、聊天流式约 150 ms。历史增长时，快照中的完整会话/个人摘要与同步 JSON 写入可能成为性能成本，应通过测量再决定集中轮询、分页或推送。

## 8. 用户数据、默认配置与隐私边界

正常运行目录：

```text
%APPDATA%/CodexPet/
├─ app.log                         管理/后台日志
├─ llm-keys.bin                    safeStorage 加密 Key
├─ bili-cred.bin                   safeStorage 加密 B 站登录态
├─ renderer/                       helper Electron profile
└─ data/
   ├─ dsh-pet/
   │  ├─ main-config.jsonc         用户层主配置，兼容旧 main-config.json
   │  ├─ third-party-llm.json      第三方非秘密设置
   │  ├─ pet/                     种类配置和自定义素材
   │  └─ main-animation/、memes/   用户素材覆盖
   ├─ pet-conversations.json       会话、历史和相关设置
   ├─ chat-sandbox/                Codex 陪伴请求目录；vision-* 临时图片请求结束即删除
   ├─ reminders.json               提醒
   ├─ mood.json / mood-quotes.json 心情状态与语料
   ├─ quotes.json                  通用语录
   ├─ quotes-upgrade-state.json    语录升级标记及配套备份
   ├─ quota-latest.json            绑定登录身份的额度缓存
   ├─ visibility.json             显隐控制
   ├─ fullscreen.json             全屏状态
   ├─ manager-request.json        管理窗口打开请求
   └─ bili/
      ├─ settings.json / plan.json
      ├─ shares.json / seen.json / feedback.json
      ├─ log.jsonl / last-wake.json / last-diary.json
      ├─ cache/ / frames/ / covers/
      ├─ 给你的信.md
      └─ 私人日记.md
```

此处是代码声明的主要数据布局，不代表本次访问了用户真实文件；各目录还可能有迁移备份、缓存与临时文件。

默认配置关系：

1. `backend/assets/config.jsonc` 是包内基础配置。
2. `app/defaults/dsh-pet/main-config.jsonc` 是首次启动种子，复制到用户目录后成为可编辑用户配置。
3. 用户配置与种类文件经 `readAllConfig/mergeEntry` 组合；一些顶层字段整段覆盖，**不是所有对象递归深合并**。
4. `runtime-utils.cjs/prepareData` 只在目标缺失时复制默认文件，正常升级不能覆盖用户编辑。
5. 通用语录另有 revision 升级机制，精确替换已知旧文案、保留修改并备份；新版本语料不是简单覆盖整个 JSON。

safeStorage 不可用时拒绝明文保存 Key。它保护本机持久化，不等于会话/日记/截图全部加密，也不能防御已控制当前 Windows 账号的恶意软件。

扩展数据格式应加入明确的版本与迁移，保留旧文件恢复能力；不要修改默认文件后就假定老用户自动获得字段，也不要删除个人目录来规避迁移。

## 9. 新增功能时应改哪些层

| 需求 | 主要修改位置 | 需同时核查 | 测试建议 |
| --- | --- | --- | --- |
| 新增管理按钮/设置项 | 对应 panel JS、HTML/CSS、main IPC action、后台路由/服务 | 输入校验、失败消息、初始化、旧数据兼容 | 服务单测 + 隔离 UI 验证 |
| 新增独立业务能力 | 新 runtime 模块、standalone apply/route | effect/stop、计时器、状态发布、默认关闭与费用 | 新测试文件 + 装配 smoke |
| 新增心情/行为规则 | mood.mjs、mood-panel、必要的 events/sprite | 标签/优先级/动画权重/静默/语料/持久化 | mood.test.mjs，注入 clock/random |
| 新增动作/素材 | assets/webm、基础/默认配置、shared-core/sprite | 中文名称、回退、素材根、视频切换、DPI | 动作选择纯函数 + 真实视频解码 |
| 改聊天/人设 | pet-conversations、persona、chat-panel、provider adapter | 静态人设与当轮状态分离、动作白名单、取消与历史 | persona.test.mjs + 会话/错误回归 |
| 新增模型服务商 | model-router、third-party-llm、llm-panel | Key 不落 JSON、地址保护、代理、SSE、费用、识图选择 | mock HTTP/SSE，不用真实 Key |
| 改额度/工作状态 | codex-usage/quota-cache/codex-activity | 账号切换、退出登录、stale、schema/RPC 版本 | privacy-reminders.test.mjs + 新适配测试 |
| 扩展提醒 | reminders、reminders-panel、features | 时区/DST/重复/触发驱动/便签状态 | 日期边界、关闭后恢复、去重测试 |
| 扩展 B 站生活 | bili/life + api/feed/watch/prompts/frames、bili-panel | 预算/熔断/外部内容/异步停止/登录和分享门控 | bili.test.mjs，mock client/llm/grab |
| 完整多宠业务 | 配置 + 全部 main 状态写入 + 各服务/数据/UI | petId 生命周期、状态隔离、会话/心情归属 | 两宠并发、删除/重命名/恢复测试 |
| 修复焦点/穿透/多屏 | helper main、pointer/geometry/DPI/recovery | 全屏、睡眠唤醒、显示器拔插、缩放变动 | 纯几何单测 + Windows 手工矩阵 |

建议每次从一个完整纵切面入手：**输入 → 校验 → 业务 → 持久化/状态 → 展示 → 退出清理 → 测试**。先做最小可验证闭环，不要为增加一个按钮同时重写所有 bundle。

## 10. 值得优先推进的改善

以下为源码观察和后续专项建议，**不是已经修复的问题，也不是本次已经复现的漏洞列表**。

### 优先一：运行边界与安全加固

- **helper `/respond` 回调**：`electron-helper/main.js/startBridgeCallback` 当前只检查 POST 和路径，未见独立共享密钥验证或请求体大小限制；pending id 为递增值，素材响应由 `handleBridgeRequest` 信任 `resp.file` 读盘。建议专项验证本机请求伪造/响应注入的可达性，再增加回调认证、严格响应 schema、文件路径允许范围和 body 上限。主后台已有 Bearer token 不代表这一路受同等保护。本次未运行利用验证。
- **后台请求体限制**：standalone `readBody` 直接收集 chunks，未见上限。应与 helper 回调一起建立可预期的大小、超时和错误处理。
- **截帧隔离**：审查 MP4 路径 `webSecurity:false` 的 URL 校验、导航、权限及窗口生命周期，禁止通用化加载任意内容。
- **二进制与素材供应链**：恢复 DesktopBridge C# 源码，建立可重编译方案；哈希只证明文件未变，不证明内部安全。字体和角色/动画再分发授权需要另行确认。

### 优先二：恢复、数据兼容与测试补全

- 后台异常自动恢复、未完成聊天取消、退出过程中 B 站异步 wake 的停止语义。
- 为持久化格式建立 schema/version/migration，覆盖损坏、旧版、并发写入与回滚。
- 为 HTTP/IPC 路由、Key 管理、登录流程、pointer/DPI/visibility 等补充边界测试。
- 给外部 Codex SQLite/RPC 和模型命名适配增加版本变化回归样例。

### 优先三：结构、性能与可扩展性

- 渐进抽取 standalone、mood、sprite、shared-core 内大块职责，而不是全量重写。
- 明确 standalone 与 DSH 插件的支持范围，减少重复实现继续漂移。
- 测量重复轮询、全历史快照、同步磁盘写入；再考虑分页、统一轮询或推送。
- 对重要通知设计队列/优先级，避免单槽覆盖；统一各主动消息静默规则。
- 真正推进多宠时，先去除业务 `main` 硬编码、定义状态与数据归属。

## 11. 开发命令与本次验证结果

从仓库根目录执行：

```powershell
npm ci                 # 首次完整启动/构建前安装锁定依赖
npm test               # 离线单元回归
npm run check          # 文件/语法/依赖/版本/二进制哈希/基础秘密与大小检查
npm start              # 检查、组装便携目录并启动
npm run build          # 仅组装 .runtime 下的目录
npm run test:smoke     # 隔离数据、真实启动、解码动画、验证未认证访问被拒绝
npm audit              # 包含 Electron 的依赖安全检查
npm run package:win    # dist 便携目录、ZIP、SHA-256
```

`start/build/package/smoke` 会创建或更新生成目录；修改 `app/` 后应先正常退出运行实例，再重新启动组装。不支持直接 `electron app`。

2026-10-30 本地模型路由改造后的实际结果（初次阅读基线为 74 项测试、64 个脚本）：

| 项目 | 结果 |
| --- | --- |
| `npm test` | **91 项通过，0 失败，0 跳过** |
| 源码 JS/MJS/CJS（含本次新增文件）的独立 `node --check` | 已由完整 `npm run check` 检查通过 |
| `npm run check` | **通过**：语法、依赖、版本、二进制哈希及基础敏感信息/大小检查 |
| smoke | 已同步旧便携版隔离启动通过：后台就绪、未认证请求拒绝、默认数据建立、动画解码、实际桌宠右键菜单不含重置查询；保留该版 Electron 43.3.0 |
| build / package / npm audit | 本次未执行 |
| 管理 GUI | 已在 Chromium 加载便携版界面并模拟 IPC，确认额度折叠、模式/雷达移除、画像默认关闭、Codex/第三方来源显示切换；无真实模型调用 |
| 真实模型、真实 B 站账号、多屏/DPI | 本次未验证 |

不能把“隔离启动通过”写成“真实模型 / CC Switch / B 站账号验证或安全审计通过”。源码已通过带备份的同步脚本部署至用户当前便携程序目录，用户实例未自动重启。

现有离线测试对应范围：

- `tests/runtime.test.mjs`：源码包完整性、首次默认值、保留用户编辑、loopback 地址和代理环境，以及新/旧额度开关下实际右键菜单构建与废弃重置 action 的回归。
- `tests/privacy-reminders.test.mjs`：额度账号隔离/认证变化、提醒中文解析与日期/时区/损坏数据。
- `tests/persona.test.mjs`：人设、此刻、动作标签、保存校验以及聊天请求组织。
- `tests/mood.test.mjs`：能量/饱腹/优先级/自动吃饭/任务/亲密度/节日/静默/轮换/持久化。
- `tests/bili.test.mjs`：签名/节奏/预算/风控/筛选/资料/作息/分享反馈/日记/截帧/识图与聊天资料。
- `tests/model-routing.test.mjs`：单开关动态分流、不完整配置、错误不跨服务兜底、Codex 自定义中转模型、工具隔离、localImage/临时清理、完整后台文本、并发请求隔离、Codex 聊天视频资料、旧模式迁移与无账号手填画像。

2026-10-30 后续截图确认：此前管理窗口的模拟 GUI 检查没有覆盖桌宠自绘右键菜单，遗漏了 sprite.js 的重置项。这次先用菜单构建回归复现，再删除菜单与请求分支、清理旧插件残留路由；已带备份同步便携版，并扩展 smoke 直接在真实桌宠 renderer 上触发 contextmenu、检查 DOM 菜单项。

Windows CI 的顺序是 npm ci → check → test → audit（high）→ smoke；配置存在不代表本次运行过 CI。

## 12. 后续任务的推荐阅读顺序

1. 先读本文、README、PROVENANCE 和 SECURITY，确认功能与维护边界。
2. 读目标功能的面板调用，再读 main IPC 对应分支与 standalone 对应路由。
3. 读 runtime 模块的公开接口、状态/存储、生命周期，以及同类测试。
4. 如果影响桌宠表现，再读 events → sprite/shared-core；如果影响窗口，再读 helper main 和几何/穿透模块。
5. 修改默认值前读 prepareData/迁移；修改网络前读 Key、代理、预算、超时与停止处理。
6. 先补最小失败/边界测试，再做功能；离线通过后再使用隔离 smoke 和针对性手工验证。

### 每次功能改造的完成清单

- [ ] 改的是当前实际运行入口，而不是旧成品或不生效的插件副本。
- [ ] 数据结构和输入校验明确；旧用户数据不被直接覆盖。
- [ ] 状态更新、气泡/动画优先级和静默规则一致。
- [ ] timer、请求、窗口和子进程可以在停止/退出时正确清理。
- [ ] 不扩大 renderer 权限，不记录 Key/cookies/个人认证信息。
- [ ] 付费调用和外部网络行为有明确开关与错误提示。
- [ ] 对应离线测试通过，check 完成；需要时补隔离 smoke/手工矩阵。
- [ ] 使用说明和本指南随架构变化更新，未验证事项明确标注。
