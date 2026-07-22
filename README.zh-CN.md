# SSH Onboard

[English](README.md)

> 预览软件：用于重要环境前，请先在可丢弃的测试服务器验证。当前版本可从 [GitHub Releases](https://github.com/ZhangZhengruiNUS/ssh-onboard/releases) 下载。

SSH Onboard 把首次 SSH 公钥配置变成有引导、可验证的流程，日常远程开发仍完整交给微软官方 Remote - SSH。

## 为什么开发 SSH Onboard

微软官方 **Remote - SSH** 是一套非常强大的 VS Code 远程开发工具：它提供远程文件、集成终端、远程扩展、语言服务、Git、调试和端口转发等完整体验。

但在使用密码认证时，Remote - SSH 默认不会保存密码并在新连接时自动登录。大家搜索解决方案时，通常会看到“在本机生成 SSH 密钥，再把公钥上传到服务器的 `~/.ssh/authorized_keys`”。这个流程对熟悉 SSH 的开发者并不复杂，但对新手很麻烦且容易出错：选错文件、破坏 `authorized_keys`、权限不安全、编辑错 SSH Config，或者从未验证最终登录到底使用了哪把密钥。

默认打开路径也是一个高频痛点。许多开发者连接某台服务器后，总是进入同一个项目目录；但每次仍要手动选择或打开文件夹，切换窗口时甚至可能再次输入密码，既麻烦又打断工作节奏。

SSH Onboard 正是为解决这些问题而生：

```text
添加服务器并设置默认目录，点击“保存并初始化”
→ 在持续显示进度时查看可复制的主机身份页面
→ 首次连接可直接信任，也可粘贴独立渠道获得的指纹进行核对
→ 首次只输入一次服务器密码（永不保存）
→ 自动生成或选择 SSH 密钥
→ 安全部署公钥并验证纯密钥登录
→ 用微软 Remote - SSH 直接打开默认目录
```

SSH Onboard **不是重写一套完整的 SSH 连接管理**，而是微软官方 Remote - SSH 的轻量增强。连接后的 Explorer、终端、远程扩展、Git、调试和语言服务仍全部由 Remote - SSH 提供。

## V0.1 功能

- 原生 Tree View 用于分组、搜索、连接和删除主机，添加与编辑使用可访问的编辑区表单。
- 添加主机默认“保存并初始化”，需要稍后处理时仍可选择“仅保存”。
- 提供可复制的主机身份页面，并在网络和密钥设置期间显示分阶段进度。
- 明确信任主机密钥后，使用一次性密码初始化公钥。
- 默认每台主机生成独立 Ed25519 密钥。
- 高级选项可使用已有的未加密密钥，或显式共享一把组密钥。
- 检测冲突地维护 SSH Config Include 和隔离的 `known_hosts`。
- 加锁、保守地更新 `authorized_keys`，并可精确撤销由插件部署的公钥。
- 使用唯一指定身份、关闭密码回退的系统 OpenSSH 非交互验证。
- 一键调用 Remote - SSH 打开验证过的默认目录。
- 提供脱敏诊断和资料导出；没有遥测、云同步、AI 或付费功能。

## 支持范围

- 本地：Windows x64、VS Code Desktop、Windows OpenSSH Client。
- 远端：可直接访问、允许密码认证和公钥认证的标准 Linux OpenSSH 服务器。
- 账号：主目录可写的普通 Linux 用户。

`root`、跳板机、MFA、非标准 `AuthorizedKeysFile`、加密的已有私钥，以及 macOS/Linux 本地客户端暂不属于 V0.1 的已测试范围。

## 安装

安装当前 GitHub 预览版：

1. 在 [Releases](https://github.com/ZhangZhengruiNUS/ssh-onboard/releases) 下载 `ssh-onboard-<version>.vsix`。
2. 在 VS Code 执行 **扩展: 从 VSIX 安装...**。
3. 选择下载的文件并重新加载 VS Code。

本地开发版本：

```powershell
npm ci
npm run check
npm run package:vsix
```

在发布说明明确稳定前，请只在测试用 VS Code Profile 中安装生成的 `artifacts/ssh-onboard-<version>.vsix`。

## 使用

1. 打开 Activity Bar 中的 **SSH Onboard**，选择 **添加主机**。
2. 填写服务器、用户、SSH 别名、可选分组和默认 POSIX 绝对路径。
3. 保留推荐的每主机独立密钥，或进入高级密钥策略。
4. 选择 **保存并初始化**；只有打算稍后设置时才选择 **仅保存**。
5. 查看可选择、可复制的指纹。首次连接可选择 **信任并继续**；需要更强保证时，可粘贴通过管理员或控制台独立取得的指纹精确核对。
6. 输入一次 SSH 密码；SSH Onboard 不会持久化它。
7. 通过分阶段进度了解当前步骤；验证通过后选择 **连接并打开默认目录**。

如果选择了 **仅保存**，准备好后直接单击侧栏中的 **需要初始化** 主机即可继续，不必寻找右键菜单。

## 安全边界

- 密码、私钥口令和 OTP 永不持久化或写入日志。
- 展示并信任主机密钥前不会尝试认证。
- 首次连接的 **信任并继续** 使用 SSH 常见的“首次使用时信任”（TOFU）模型：会固定该精确密钥供后续校验，但不能独立证明第一次连接没有被冒充。需要这种保证时请使用手动指纹核对。
- 后续出现密钥、算法或指纹变化时会硬性阻断；替换信任必须独立核对，不提供一键绕过。
- 不关闭主机密钥检查，也不把 `/dev/null` 当作 `known_hosts`。
- 受管私钥的 Windows ACL 只允许当前用户和 `SYSTEM`。
- 保留已有 `authorized_keys` 内容；发现不安全的所有权、布局、链接或并发修改即停止。
- 最终成功必须由系统 OpenSSH 使用确切的目标身份完成 BatchMode 登录。
- 资料导出不包含密码、密钥、密钥路径或主机信任记录。

预览版用于重要服务器前请阅读 [SECURITY.md](SECURITY.md)。安全问题请通过其中的私密渠道报告，不要创建公开 Issue。

## 配置故障排查

SSH Onboard 遇到不明确的 Remote - SSH 设置或 SSH 文件时会安全中止，不会接管现有 `Host` 块，也不会覆盖外部修改过的受管文件。

- 如果 `remote.SSH.path` 或 `remote.SSH.configFile` 设置在 Workspace 范围，请移到 User 设置后重试。
- 如果 SSH 别名已存在，请编辑主机并换用唯一别名。
- 如果受管文件在 SSH Onboard 外部发生变化，请通过错误操作打开 SSH Config 或日志，检查后再重试。
- 在确认指纹后取消密码输入而产生的精确 Preview.2 遗留会自动恢复；任何未知差异均保持不动。
- 删除从未初始化的主机只改 ProfileStore。删除只保存了主机信任的资料时，只更新 SSH Onboard 自有文件，不修改用户 SSH Config。

## 项目文档

- [产品需求规格](docs/PRODUCT_SPEC.md)
- [技术架构设计](docs/ARCHITECTURE.md)
- [安全设计与威胁模型](docs/SECURITY.md)
- [开发、测试与发布计划](docs/DEVELOPMENT_PLAN.md)
- [贡献指南](CONTRIBUTING.md)
- [支持说明](SUPPORT.md)

## 许可证与名称

项目采用 [MIT License](LICENSE)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目与 Microsoft 无隶属或背书关系；Remote - SSH 等产品名称属于各自权利人。
