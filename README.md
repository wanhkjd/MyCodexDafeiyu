# Codex-dafeiyu 🐟

Windows 桌面大肥鱼：透明动画、拖拽、碎碎念、提醒便签、Codex 状态与额度、可选聊天和 B 站生活。

基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)、[GPT-Niang](https://github.com/T7moris/GPT-Niang) 等项目二次开发。与 OpenAI、DeepSeek 及上游项目无官方隶属关系。

> **仓库现状：这是从 v1.4.5 分发包整理的可运行工程，不是完整原始源码工程。** JavaScript 可编辑并重新组装便携包，但后台的原始 TypeScript 和 DesktopBridge 的 C# 源码当前缺失。后者暂保留分发包中的 8 KiB 二进制及 SHA-256 校验。见[来源与可重建边界](docs/PROVENANCE.md)。

## 克隆后运行 / 修改工程

需要 Git、**Node.js 24.19.0 x64**（随附 npm 11），首次安装需要网络。约 65 MiB 应用代码和素材会随 Git 拉取；Electron 由 npm 安装脚本下载，不把巨大运行时提交 Git。

先用本仓库 GitHub 页的 **Code → HTTPS** 地址克隆并进入目录，再运行：

```powershell
npm ci
npm test
npm start
```

- `npm ci` 安装严格锁定的依赖；Electron 当前固定为 **43.8.4**。
- `npm start` 先检查并组装便携运行目录，再启动；不要直接运行 `electron app`，那不是此整理版支持的入口。
- 生成目录是 `.runtime/Codex-dafeiyu-v1.4.5-windows-x64/`，不会进入 Git。修改 `app/` 后退出桌宠，再次启动即可生效。
- 首次运行无需登录；Codex/B 站/模型接口不是离线启动的前提。

## 功能条件与费用

| 功能 | 需要什么 |
| --- | --- |
| 本地动画、拖拽、语录、心情、提醒 | 无账号；提醒在本机保存 |
| Codex 额度、工作状态、Codex 聊天 | 本机安装 Codex 并登录；可用模型与额度取决于账号和接口 |
| 第三方模型聊天 | 在管理窗口填写自己的服务地址和 Key；测试连接也会调用模型，可能收费 |
| B 站生活 | 默认关闭，需要主动开启；部分能力需要扫码登录，可选识图会消耗模型额度 |

没有 Codex 时，额度/聊天提示不可用不代表桌宠启动失败。第三方 Key 不是安装配置，**不要写进源码或提交 GitHub**。

## 配置与隐私

- 用户数据：`%APPDATA%\CodexPet\data`；日志及管理窗口资料：`%APPDATA%\CodexPet`。
- 桌宠聊天记录保存在上述数据目录的 `pet-conversations.json`；“关联 Codex 对我的了解”会读取 `CODEX_HOME`（默认用户目录下的 `.codex`）中的个人记忆摘要。升级不要删除个人数据目录。
- API Key 与 B 站登录态通过 Electron safeStorage 加密保存；聊天、日记、提醒、截图等普通数据**并非全部加密**。
- 额度会读取本地 Codex 登录信息；工作状态会读取本地任务记录。第三方聊天只应配置你信任的 HTTPS 服务，发出的消息会交给该服务处理。
- 可选环境变量、网络说明见[使用说明](docs/USAGE.md)。不要把个人数据目录、截图、认证文件或日志打进发布包。

## 开发检查

```powershell
npm run check       # 文件完整性、语法、基础敏感信息/大文件、依赖版本、桥接哈希
npm test            # 不需要账号的自动化回归
npm run build       # 组装 .runtime 下的便携目录
npm run test:smoke  # Windows 隔离数据目录的真实启动检查
npm audit           # 包含 Electron 开发依赖的安全检查
```

不要提交 `node_modules`、`.runtime`、`dist`、旧成品目录、`backups` 或个人运行数据。当前以源码运行和后续改造为主，不提供或自动生成 Release 附件。Windows CI 只进行安装、检查、测试和隔离启动验证。

## 目录

```text
app/                 可编辑的管理窗口、默认配置及运行时代码
  backend/lib/       已构建 JavaScript（原始 TypeScript 不在此目录）
  backend/runtime/   Codex、模型、B 站、心情、提醒及桌面窗口
  backend/assets/    动画、图像、字体与配置
  DesktopBridge.exe  暂无对应源码的 Windows 桥接程序
scripts/             检查、启动、组装、打包与隔离启动验证
tests/               不依赖账号的回归测试
docs/                使用说明与代码来源说明
licenses/            保留的上游许可证和素材声明
```

## 许可证与感谢

项目代码适用 [MIT](LICENSE)；**不代表所有素材都可商用**。继承自 dsh-pet 的动画、动作提示词及源视频按上游非商业开源使用要求保留署名和链接。字体、角色形象及第三方标识另有权利边界；分发前应确认授权，尤其不要仅凭代码 MIT 判断字体可再分发。

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)、[T7moris/GPT-Niang](https://github.com/T7moris/GPT-Niang)、[ERUIHNIYHBKBNF/dafeiyu-persona](https://github.com/ERUIHNIYHBKBNF/dafeiyu-persona)、[Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)、Electron、Node.js 及相关依赖作者。详细范围见[第三方声明](THIRD_PARTY_NOTICES.md)。
