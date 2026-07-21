# SSH Onboard 开发、测试与发布计划

## 1. 总体策略

采用“本地开发验证 → GitHub 协作与 CI → GitHub 预发布 → 稳定 Release → Marketplace”的渐进路线。

必须区分：

- **Git push**：把源码和提交同步到 GitHub，用于备份、审查和 CI；不等于对用户发布。
- **GitHub Release**：创建带 tag 的可下载 VSIX，才属于公开可安装版本。
- **Marketplace publish**：提供搜索发现和自动更新，是稳定版之后的独立发布动作。

本地在第一次 push 前至少完成文档评审、脚手架、静态检查和基础测试。GitHub Preview 可以在明确标注未完成真实端到端验证的前提下用于收集测试反馈；完整真实 Windows → Linux → Remote - SSH 端到端测试通过前，不创建稳定 GitHub Release；预发布反馈稳定前，不上传 Marketplace。

## 2. 已锁定决策

| 项目      | 决策                                            |
| --------- | ----------------------------------------------- |
| 产品名    | `SSH Onboard`                                   |
| 仓库      | `ZhangZhengruiNUS/ssh-onboard`，公开仓库        |
| 扩展 name | `ssh-onboard`                                   |
| Publisher | 暂定 `ZhangZhengruiNUS`，Marketplace 发布前创建 |
| 许可证    | MIT；版权署名 `ZhangZhengruiNUS`                |
| 默认分支  | `main`                                          |
| 本地平台  | Windows 10/11 x64                               |
| 远端平台  | 直连标准 Linux OpenSSH                          |
| 默认密钥  | 每主机独立、无口令 Ed25519                      |
| 高级密钥  | 已有密钥或显式共享组密钥                        |
| 密码      | 仅单次内存使用，不持久化                        |
| 日常连接  | 官方 Remote - SSH                               |

名称检查只代表截至 2026-07-21 未发现精确同名，不替代商标法律检索。

## 3. 开发阶段

### Phase 0：设计基线

交付：

- 产品规格、架构、安全设计和本计划。
- 用户已确认 V0.1 范围、名称和许可证署名；公开联系方式策略在发布前确定。
- 建立 ADR：混合 SSH 架构、每主机密钥、独立 known_hosts、SSH Config Include。

完成条件：文档之间没有范围或安全契约冲突，尚无业务代码。

### Phase 1：标准扩展脚手架

交付：

- TypeScript strict、Node 24 LTS 构建环境、npm lockfile、esbuild、ESLint、Prettier；扩展产物按最低 VS Code 1.101 的 Node.js 22 Extension Host 构建。
- Manifest：`extensionKind: ["ui"]`、Remote - SSH 扩展包推荐与运行时软检测、Workspace Trust、英文/简中本地化。
- 原生 Tree View 空状态、Output Log Channel 和领域错误骨架。
- VS Code 调试任务、Extension Development Host 测试入口。

检查：typecheck、lint、format check、unit test、bundle、`vsce ls`。

### Phase 2：Profile 与原生 UI

交付：

- 版本化 ServerProfile/Group/KeyReference schema 与迁移入口。
- globalState repository；明确不启用 sync。
- 添加、编辑、删除、分组、搜索、状态与最后验证时间。
- 字段验证、取消流程和本地化错误。

检查：schema 迁移、重复 Alias、IPv4/IPv6、异常字符和空状态测试。

### Phase 3：Windows OpenSSH 与密钥管理

交付：

- `ssh.exe`、`ssh-keygen.exe`、可选 `ssh-agent` 能力探测。
- 默认每主机 Ed25519 生成、独占路径和 Windows ACL 验证。
- 已有未加密密钥验证；agent 中加密密钥支持推迟到 V0.2+。
- 共享组密钥风险确认和影响主机列表。

检查：路径含空格/中文、不覆盖已有文件、错误 ACL、丢失 `.pub`、agent 未运行。

### Phase 4：主机信任与一次性密码引导

交付：

- `ssh2` bootstrap adapter，强制 hostVerifier。
- SHA256 指纹展示、期望指纹精确匹配、信任替换流程。
- 密码 InputBox、单次认证、超时/取消和日志脱敏。
- 独立 managed known_hosts 写入。

检查：认证前未发送密码、MITM/变化阻断、错误密码、超时和连接关闭。

### Phase 5：远端公钥部署

交付：

- Home/UID 探测、SFTP lstat、权限和所有权检查。
- `authorized_keys` fingerprint 去重、插件并发锁、临时文件，以及 rename 前 hash/元数据复核。
- 授权归属记录、幂等初始化与仅针对扩展自有唯一 marker 的精确撤销。
- 失败恢复与可操作诊断。

检查：真实 Linux sshd 集成测试、重复 key、受限 key、损坏行、无换行、并发、断连、只读和符号链接。

### Phase 6：SSH Config 与验证

交付：

- 主 Config Include 预览、备份、锁、hash 复核和幂等更新。
- 独立 managed config 原子生成与 Alias 冲突检查。
- `ssh -G` 展开验证。
- 隔离最小配置、`ssh -G` 唯一身份断言、指定密钥 BatchMode 验证和远端 Home/默认目录探测。

检查：BOM、CRLF/LF、注释、Host *、Match、并发编辑、系统配置注入和 agent 多密钥误用。

### Phase 7：Remote - SSH 启动

交付：

- `vscode.openFolder` remote URI adapter。
- 新窗口用 `vscode.Uri.from` 打开 `defaultPath ?? resolvedHome`；失败时提供官方 CLI 命令。
- Remote - SSH 缺失、版本不兼容和默认目录不存在的指引。

检查：当前 Stable VS Code + Stable Remote - SSH 的手工烟测与 Extension Host 测试；路径覆盖空值、空格、Unicode、`#` 和 `%`。

### Phase 8：产品化与文档

交付：

- 英文 `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、根 `SECURITY.md`、`SUPPORT.md`、`CODE_OF_CONDUCT.md`。
- MIT LICENSE（版权署名 `ZhangZhengruiNUS`）。
- PNG 图标、截图和 Marketplace 描述；不得使用不符合 Marketplace 规则的 SVG 资源。
- 第三方许可证、隐私说明、故障排查和卸载/清理指南。

检查：文档链接、截图、隐私声明、VSIX 文件列表和许可证扫描。

## 4. 测试策略

### 4.1 单元测试

覆盖纯逻辑：

- Profile schema/migration；
- Alias、Host、Port、User、远端路径验证；
- OpenSSH key 与 `authorized_keys` 解析；
- fingerprint、known_hosts 地址和去重；
- SSH Config Include/受控块生成；
- 日志与错误脱敏；
- 状态机和失败恢复决策。

### 4.2 集成测试

- Ubuntu runner/容器启动真实 `sshd`，创建低权限测试用户和隔离 Home。
- 覆盖密码认证、host key、SFTP、权限、原子更新、并发和撤销。
- Windows runner 覆盖 OpenSSH 工具发现、路径、ACL、config 与 BatchMode。
- 测试凭据为短生命周期随机值，工作流结束强制销毁。

### 4.3 VS Code 扩展测试

使用 `@vscode/test-cli` 与 `@vscode/test-electron`：

- View/command 激活；
- globalState 持久化和迁移；
- Workspace Trust 行为；
- Remote - SSH 软依赖缺失/禁用提示，且不影响服务器管理和密钥初始化；
- 隔离用户数据目录中的 VSIX 安装/卸载。

### 4.4 手工端到端

使用可丢弃 Linux VM 和普通用户：

```text
Fresh Windows/VS Code profile
→ Install local VSIX
→ Add host
→ Verify fingerprint out of band
→ Enter password once
→ Deploy key
→ BatchMode passes
→ Remote - SSH opens default path
→ Reload/reconnect without server password
→ Revoke key and confirm access is removed
```

稳定版必须保留测试记录、版本、VS Code/Remote - SSH/OpenSSH 版本和最终结果。

## 5. 本地质量门禁

目标质量脚本按阶段逐步启用；Phase 1 已提供除集成测试外的下列门禁：

```text
npm run format:check
npm run lint:markdown
npm run lint
npm run typecheck
npm run test:unit
npm run test:extension
npm run package
npm run package:vsix
npm run verify:package-files
npm run audit:dependencies
```

涉及 SSH、文件系统和配置写入的实现开始后，再增加 `test:integration`；发布阶段再增加对已生成 VSIX 的独立解包验证。

任何发布候选必须从干净 working tree 使用 `npm ci` 重建。VSIX 解包后检查只包含运行所需 bundle、清单、图标、README、CHANGELOG、LICENSE 和第三方通知；不得包含源码映射中的敏感路径、测试凭据、开发配置或私钥样本。

## 6. GitHub 仓库治理

仓库使用 `main` 作为默认分支，公开仓库目标为 `ZhangZhengruiNUS/ssh-onboard`。首次公开发布前单独确认 GitHub 与 Marketplace 发布权限。

第一次 push 前完成：

- 文档评审通过；
- 脚手架和基础测试全绿；
- Git 历史中不存在密码、私钥、测试服务器或无关文件；
- `.gitignore`、`.vscodeignore` 和许可证就绪；
- 本地提交按功能拆分且可回退。

创建公开 `ZhangZhengruiNUS/ssh-onboard` 后设置：

- 默认分支 `main`；
- 创建时先关闭 Issues；推送后立即启用 private vulnerability reporting，并用非管理员或无痕会话确认 `/security/advisories/new` 可访问，验证通过后才开启 Issues；
- squash merge，自动删除已合并分支；
- Issue/PR 模板、CODEOWNERS、private vulnerability reporting；
- Dependabot alerts/security updates/version updates；
- CodeQL、secret scanning、dependency review；
- `main` ruleset：PR、required checks、禁止 force push/delete；
- GitHub Actions 默认 `contents: read`，任务按需最小提权；
- 第三方 Action 固定到完整 commit SHA，由 Dependabot 维护。

单维护者初始 bootstrap 可以直接建立 `main`；规则启用后，所有功能从 `codex/<topic>` 分支经 PR 和 squash merge 进入。

## 7. CI 与发布流水线

### CI

PR 和 main push 触发：

1. `npm ci`；
2. format/lint/typecheck/unit；
3. Linux sshd 集成测试；
4. Windows OpenSSH 与 Extension Host 测试；
5. dependency review、CodeQL；
6. 生成但不发布 VSIX，并做包内容检查。

### GitHub 预发布

只有带保护环境审批的版本 tag 才触发：

1. 校验 tag、`package.json` 和 CHANGELOG 版本一致；
2. 在干净 Windows x64 runner 构建一次平台 VSIX；
3. 生成 SHA-256、CycloneDX SBOM 和第三方许可证；
4. 生成 GitHub artifact attestation；
5. 创建 GitHub Pre-release 并上传同一组不可变资产；
6. 发布说明列出支持范围、已知限制、安装与校验命令。

首个 Preview 的最低证据为：Windows/Ubuntu CI、Windows OpenSSH 配置集成测试、VS Code Extension Host 测试、依赖漏洞与签名审计、VSIX 文件白名单、隔离 VS Code Profile 安装验证。若尚无真实 Linux 服务器端到端证据，Release 标题和说明必须使用 Preview，并将“密码引导、公钥部署、原生 Remote - SSH 打开默认目录尚待真实环境验证”列为已知限制。

预发布建议从 `0.1.0` 开始；真实用户验证完成后再发布稳定 tag。版本遵循 SemVer，CHANGELOG 遵循 Keep a Changelog，提交采用 Conventional Commits。

### Marketplace

Publisher ID 是 Marketplace 必需且创建后不可随意更改，但本地开发和 GitHub VSIX 发布不要求先创建。建议在名称与扩展 ID 锁定后、首个稳定版之前创建 `ZhangZhengruiNUS` Publisher。

首个 Marketplace 稳定版手工上传与 GitHub Release 完全相同、已校验的 VSIX；确认发布链路后再自动化。由于 Azure DevOps 全局 PAT 将于 2026-12-01 退役，长期自动发布不设计为长期 PAT secret，而采用 Microsoft Entra ID workload identity federation 的官方安全发布方案。

## 8. 发布与回滚门禁

不得发布的情况：

- 任何密码/私钥泄漏测试失败；
- hostVerifier 缺失或主机变化可被绕过；
- `authorized_keys`/config 文件完整性测试不稳定；
- BatchMode 可能使用非目标 agent key；
- 稳定版没有真实 Windows → Linux → Remote - SSH 端到端证据；
- 高危或严重依赖漏洞未处理；
- Release VSIX 与被测试 VSIX 不是同一 SHA-256。

发现问题时：撤下 Marketplace 版本前先评估兼容影响；GitHub 发布修复 patch 和安全公告。不得用相同版本号替换已发布 VSIX，任何修复都发布新 SemVer patch。

## 9. 下一步

1. 用户评审并确认本组设计文档。
2. 在发布前确认公开安全联系渠道。
3. 进入 Phase 1，只创建标准脚手架和测试基础，不实现 SSH 业务。
4. 每个 Phase 单独验收和提交；Phase 7 结束后再决定首个 GitHub Pre-release 日期。
