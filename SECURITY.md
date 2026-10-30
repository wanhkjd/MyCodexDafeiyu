# 安全与隐私

不要在公开 Issue 中上传 API Key、Codex auth.json、B 站 cookies、完整日志、聊天数据、截图或个人配置。请通过 GitHub 私密漏洞报告（仓库启用后）或维护者公开指定的私密渠道报告安全问题；若尚无渠道，先仅询问联系方式。

- 后台绑定 127.0.0.1 随机端口，管理进程每次生成 Bearer token。不要手动暴露后台到局域网/公网，不要把该 token 写入 Issue。
- 管理窗口关闭 Node integration，开启 contextIsolation 与 sandbox，并阻止导航和弹出窗口。
- Key 与登录态由 safeStorage 加密保存；这不能防御已控制当前 Windows 账号的恶意程序。普通聊天、日记、记忆、日志不是加密备份。
- 第三方模型 API Key 只允许发送给 HTTPS 服务（本机 HTTP 服务例外）。不要使用不信任的中转站，也不要关闭证书检查。
- B 站截帧使用独立 Electron 窗口；MP4 截帧模式因跨域画布需要关闭 webSecurity，仅应加载该功能校验的地址。这是仍需持续关注的安全边界。
- 不要在日常运行中设置 CODEX_PET_TEST_CDP；调试端口只应用于隔离测试，会提供本机调试权限。
- 依赖检查须运行完整 npm audit，不能仅检查 omit=dev：Electron 虽列为开发依赖，却随发布包提供。

构建中保留了缺失源码的 DesktopBridge.exe。校验只能证明二进制没有变化，不能证明其内部安全。原始 C# 源码恢复与重新编译是完整供应链审查的待办。

基础正则扫描、单元测试及 npm audit 都不等于完整安全审计或“绝对没有秘密”。提交前仍应人工查看 Git 暂存清单，发布前确认素材授权。
