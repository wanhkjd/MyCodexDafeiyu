# 来源与可重建边界

整理日期：2026-10-30。

本工程从本机已有的 Codex-dafeiyu-v1.4.5-windows-x64/resources/app 整理，原目录保留且不提交 Git。没有从上游另取代码覆盖本机修改，没有访问用户运行数据。

## 当前保留

- 管理窗口、前端面板、默认数据、backend/runtime 的 JavaScript。
- backend/lib 的 standalone.js、index.js、client.js：分发包中的已构建 JavaScript，可检查/编辑，但不是原始 TypeScript。
- 动画、图像、字体、原许可证副本。
- DesktopBridge.exe：原分发包 Windows 桥接，8192 字节，SHA-256：

    b8ba71e72ad1d63149dccab8c264e4d445fca53509463d857888c4a573d187e8

## 缺失与限制

- 原 README 提到的 app-shell、backend/src、原 scripts、TypeScript 配置、DesktopBridge C# 源码、部分 docs 及演示 GIF 均不在当前工作区。
- 原 backend/package.json 中的 build/typecheck/test 脚本依赖缺失文件，已用诚实的运行时清单替代。运行依赖统一由根目录 package-lock.json 锁定。
- 新 build 是将分发 JS、已有桥接程序、npm 下载的 Electron 和当前固定 Node 组装成便携包，**不是完整从原始源码编译**。
- 不支持完整 DSH 插件构建、npm 发布或跨平台桌面发行。

## 维护变化

- Electron 从旧成品的 43.3.0 升级并锁定至 43.8.4，保留 Electron/Chromium 许可证。
- Node.js 固定 24.19.0，与现有 Node 许可证副本匹配。
- qrcode 1.5.4、dijkstrajs 1.0.3 等改为通过 npm 锁文件安装，不再提交裁剪后的 node_modules。
- 增加检查、组装、打包、测试与 GitHub Actions；原成品和备份不受影响。

## 发布待确认

字体“上首软糖体.ttf”未发现独立再分发授权文件；角色、动画和派生素材受上游规则约束。现有归属声明不代替法律授权。请维护者补充授权证明，或在确认后移除/替换相应素材并回归界面，再对公众发行。
