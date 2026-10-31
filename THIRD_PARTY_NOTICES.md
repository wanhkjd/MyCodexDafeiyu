# 上游来源与第三方声明

本项目是二次开发作品，保留来源与上游版权。感谢所有作者和贡献者。

| 来源 | 本项目使用范围 | 许可证副本 |
| --- | --- | --- |
| [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 桌宠源码、桌面窗口、交互、动画、配置与原项目所附素材 | 代码：[dsh-pet MIT](licenses/dsh-pet-MIT.txt)；动画、提示词、源视频另见[素材使用说明](licenses/dsh-pet-ASSET-NOTICE.txt) |
| [T7moris/GPT-Niang](https://github.com/T7moris/GPT-Niang) | `backend/runtime/codex-usage/` 中额度读取与套餐解析，另有本项目的路径兼容修改 | [GPT-Niang MIT](licenses/GPT-Niang-MIT.txt)；运行时目录保留副本 |
| [ERUIHNIYHBKBNF/dafeiyu-persona](https://github.com/ERUIHNIYHBKBNF/dafeiyu-persona) | 聊天提示词与大肥鱼角色表达的参考 | [人设 MIT](licenses/dafeiyu-persona-MIT.txt)；`backend/runtime/DAFEIYU-PERSONA-LICENSE` |
| [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) | 「她的 B 站」：B 站接口与 WBI 签名、请求保护、选题打分、看懂视频（字幕、弹幕热区、热评）、扫码登录、作息与分享闸门的规则，移植改写在 `backend/runtime/bili/` 与 `bili-login.cjs` | [dsh-bili-whale MIT](licenses/dsh-bili-whale-MIT.txt) |
| [soldair/node-qrcode](https://github.com/soldair/node-qrcode) 1.5.4、[tcort/dijkstrajs](https://github.com/tcort/dijkstrajs) 1.0.3 | 扫码登录的二维码生成，通过根目录锁文件安装，发布时收录正式运行依赖到 `resources/app/node_modules/` | [qrcode MIT](licenses/qrcode-MIT.txt)；[dijkstrajs MIT](licenses/dijkstrajs-MIT.txt) |

GPT-Niang 的 MIT 范围限于其源码与文档，不包括其角色和图片。本项目没有收录它的白发龙娘角色素材。桌宠的主要角色与动画来自 dsh-pet，保留其来源；图标和新增敬礼动画随本修改版提供。字体、角色形象、名称和第三方标识的权利归各自权利人，本仓库不声称这些权利属于本项目作者。

dsh-pet 的上游 README 将代码与素材分开说明：代码为 MIT；动画、动作提示词和源视频限非商业开源使用，并要求二次开发的介绍、展示、分发保留原作者 GitHub 地址。这里的代码 MIT 不扩大到这些素材，详情见[上游许可说明](https://github.com/PC2005-cloud/dsh-pet#许可)。

本工作副本另收录 jingh12312-rgb/bailong-desktop-pet v0.5.1 的 35 段透明白龙动画及经过校验、规范化的动作清单，用于个人使用。未收录其 EXE、Python/Qt 程序、FFmpeg 或其他运行库。原始素材声明保存在 `app/backend/assets/characters/bailong/ASSETS.md`；该声明未额外授予美术素材商用或再分发许可，不能将本项目代码 MIT 扩展为白龙素材授权。本次本地收录不代表公开发布授权。

Windows 发布包保留 Electron 的 `LICENSE`、`LICENSES.chromium.html` 与 Node.js 许可证；依赖目录保留对应包的许可证。当前目录不包含上游完整构建工程；后台原始 TypeScript 与 DesktopBridge 的 C# 源码未收录，保留现有运行文件及其来源声明。

v1.4.0 的白饭碗与碎碗散饭素材，来自用户提供并确认处理的 AI 视频。沿用 dsh-pet 角色形象与参考素材的来源说明和素材使用边界；此处不扩张原角色素材的许可范围。
