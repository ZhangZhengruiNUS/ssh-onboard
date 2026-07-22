# SSH Onboard 产品需求规格

| 字段     | 内容                              |
| -------- | --------------------------------- |
| 状态     | Draft，待用户评审                 |
| 目标版本 | V0.1                              |
| 日期     | 2026-07-21                        |
| 产品形态 | Windows 本地 VS Code UI Extension |

## 1. 产品定位

SSH Onboard 解决一个明确问题：用户希望保留官方 Remote - SSH 的完整远程开发体验，但不愿逐台服务器手工生成、复制和配置 SSH 公钥。

扩展的职责边界如下：

```text
SSH Onboard
  主机资料 + 首次信任 + 公钥部署 + SSH Config + 默认目录 + 启动
                                      ↓
Microsoft Remote - SSH
  VS Code Server + Explorer + 终端 + 远程扩展 + Git + 调试 + 端口转发
```

目标用户是使用 Windows VS Code 管理多台 Linux 开发机、测试机或算力服务器，并且当前只能或主要通过账号密码首次登录的开发者。

## 2. V0.1 成功标准

一个普通用户应能在不阅读 SSH 命令教程的情况下完成：

1. 添加服务器名称、主机、端口、用户和默认目录。
2. 在可复制的身份页面查看算法与 SHA256 指纹，首次可明确选择 TOFU 信任，也可粘贴独立渠道取得的指纹精确核对。
3. 输入一次服务器密码；密码仅在当前初始化流程的内存中使用。
4. 选择默认独立密钥，或在高级配置中选择已有密钥/共享组密钥。
5. 安全追加公钥，不覆盖已有 `authorized_keys` 内容。
6. 生成受控 SSH Host 配置并通过指定密钥执行无交互验证。
7. 在新窗口用官方 Remote - SSH 直接打开默认目录。
8. 后续重复连接时不再输入服务器密码。

V0.1 只有在 Windows x64 本地和真实 Linux `sshd` 上完成端到端验证后才可发布稳定版。

## 3. 范围

### 3.1 包含

- 原生 Tree View 服务器列表、分组、搜索和状态展示。
- 编辑区单页 Add/Edit 表单，支持主题、高对比度、键盘操作、即时字段校验与唯一 Alias 建议。
- Add Host 默认保存后立即初始化，仍提供“仅保存”以支持稍后设置。
- 初始化使用连续的分阶段进度提示，并在可复制的 Host Identity 页面完成信任决定。
- 主机配置的添加、编辑、删除与本地导出（导出不包含凭据）。
- Windows OpenSSH、`ssh-keygen` 和 Remote - SSH 前置检查。
- 首次 SSH 主机指纹展示、确认、持久化和变更阻断。
- 一次性密码认证，不提供“记住密码”。
- 生成每主机独立 Ed25519 密钥。
- 高级选择已有密钥或按组共享密钥。
- 安全更新标准 Linux 用户（包括用户明确选择的 `root`）的 `~/.ssh/authorized_keys`。
- 维护独立 SSH Config include 文件和独立 `known_hosts`。
- 指定密钥的 BatchMode 验证、默认目录验证和连接诊断。
- 调用 Remote - SSH 打开远程默认目录。
- 只撤销能够证明由本扩展追加的公钥；预先存在或归属不明的同指纹公钥只能标记为外部管理。
- 英文默认 UI 与简体中文本地化；中文设计文档，发布 README 提供中英文入口。

### 3.2 不包含

- 自研 SSH 终端、SFTP 文件系统、远程 Extension Host 或 VS Code Server。
- FTP/FTPS、云同步、AI、遥测、登录审计、端口转发和商业授权。
- 自动启用或修改远端 `sshd_config`。
- 自动提权、`sudo`或把普通账号自动切换为 `root`。
- ProxyJump、ProxyCommand、堡垒机、MFA、OTP、密码过期修改。
- Windows/macOS/BSD 远端主机。
- 非标准 `AuthorizedKeysFile`、`AuthorizedKeysCommand`、集中式账号系统。
- NFS Home、特殊 ACL/xattr/SELinux 策略的兼容承诺。

## 4. 用户体验

### 4.1 Tree View

```text
SSH ONBOARD

Example Group
  ● example-host-01        Ready
    /home/developer/project-a

  ○ example-host-02        Setup required
    /home/developer/project-b
```

状态定义：

- `Setup required`：配置存在，但没有通过指定密钥验证。
- `Host trusted`：主机指纹已确认，尚未完成密钥部署。
- `Ready`：指定密钥与默认目录最近一次验证成功。
- `Needs attention`：指纹变化、配置冲突、密钥丢失或验证失败。

状态是诊断结果，不是永久事实；界面必须显示最后验证时间。

单击 `Ready` 主机直接打开 Remote - SSH；单击 `Setup required`、`Host trusted` 或 `Needs attention` 主机直接进入或恢复初始化，不要求用户寻找右键命令。

### 4.2 Add/Edit 表单

Add Host 与 Edit Host 在编辑区复用一个单例表单，不再连续弹出顶部输入框。表单分为连接信息、Remote - SSH 和 SSH Key 三部分；Save/Cancel 在窄窗口和滚动时保持可见。表单必须使用 VS Code 主题变量，并支持浅色、深色、高对比度、键盘导航、首个错误聚焦和 `aria-live`。

Existing Key 只通过 Extension Host 的原生文件选择器选择。Webview 不接收私钥路径或任何授权材料；它只显示文件名标签并暂存一个短期随机 token。共享组密钥仍在保存时显示原生风险确认。

### 4.3 主要命令

| 命令                            | 行为                                     |
| ------------------------------- | ---------------------------------------- |
| Add Host                        | 默认保存并立即初始化；可选择仅保存       |
| Initialize Key Access           | 信任指纹、输入一次密码、部署并验证公钥   |
| Connect and Open Default Folder | 用 Remote - SSH 打开默认目录             |
| Test Key Connection             | 使用指定密钥做 BatchMode 验证            |
| Edit Host                       | 修改显示名、地址、端口、用户、目录和分组 |
| Advanced Key Settings           | 选择独立、已有或共享组密钥策略           |
| Revoke Deployed Key             | 精确移除本扩展部署的目标公钥             |
| Remove Host                     | 删除本地资料；受管或待定授权必须先撤销   |
| Show Diagnostics                | 显示脱敏诊断和可执行的修复建议           |

删除本地资料与撤销远端访问是两个独立动作。对 SSH Onboard 已部署或已进入待定状态的授权，Remove 必须先要求 Revoke，防止丢失远端公钥归属记录。未初始化主机只删除 ProfileStore，不读写 SSH Config；仅保存了主机信任的主机只更新扩展自有文件，用户 SSH Config 保持逐字节不变。

### 4.4 新增与初始化流程

基础字段：

- 显示名称：用户可读，不进入 Shell。
- SSH Alias：只允许 ASCII 字母、数字、点、下划线和连字符，且必须唯一。
- Host：DNS 名称、IPv4 或 IPv6。
- Port：1–65535，默认 22。
- Username：不得包含控制字符或换行。
- Default Path：空值表示初始化时探测并保存的远端绝对 Home；非空必须是绝对 POSIX 路径。
- Group：可选，仅用于 UI 和共享密钥策略。

Add 表单主按钮为“保存并初始化”，次按钮为“仅保存”；Edit 表单只保存修改。保存并初始化成功后直接执行配置预检和主机发现，不要求用户再去侧栏右键操作。初始化过程中持续显示当前阶段，等待网络时必须显示“正在联系服务器”并允许取消。

首次观察到主机密钥时，使用编辑区 Host Identity 页面展示 endpoint、算法和可选择/可复制的 SHA256 指纹，并提供：

- “信任并继续”：采用 TOFU，固定当前 exact key；
- “手动核对”：粘贴独立获得的期望指纹并精确比较；
- “取消”：立即关闭正在进行的连接。

TOFU 不能独立证明首次连接身份，界面和文档必须如实说明。若已固定身份发生任何变化，不显示“信任并继续”，只允许输入独立取得的新指纹后替换。

初始化执行前明确说明会修改：

- 本地 `~/.ssh/config` 的一条 Include；
- 本地扩展专用 SSH 配置和 `known_hosts`；
- 远端当前用户的 `~/.ssh/authorized_keys`。

### 4.5 密钥策略

默认策略：

```text
Generated per host
→ 每台主机一把专用、无口令 Ed25519 密钥
→ 私钥仅保存在当前 Windows 用户的 .ssh 目录
→ 不默认加入 ssh-agent
```

高级策略：

| 策略               | 约束                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| Existing key       | V0.1 支持用户选择可无交互读取的现有私钥/公钥；加密私钥与 ssh-agent 支持推迟到后续版本 |
| Shared group key   | 必须显示共享该私钥的完整主机列表与风险；组内轮换和撤销作为一个整体                    |
| Generated per host | 可恢复为默认策略并重新初始化                                                          |

高级选项不能降低主机指纹校验、日志脱敏和 `authorized_keys` 保留要求。

## 5. 数据与接口

概念数据模型：

```ts
type KeyStrategy =
  | { kind: 'generated-per-host'; keyId: string }
  | { kind: 'existing'; privateKeyPath: string; publicKeyFingerprint: string }
  | { kind: 'generated-per-group'; groupId: string; keyId: string };

interface ServerProfileV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  alias: string;
  host: string;
  port: number;
  username: string;
  resolvedHome?: string;
  defaultPath?: string;
  groupId?: string;
  platform: 'linux';
  keyStrategy: KeyStrategy;
  authorization?:
    | {
        ownership: 'managed';
        fingerprint: string;
        deploymentMarker: string;
        deployedPublicKeyLine: string;
      }
    | { ownership: 'external'; fingerprint: string };
  lastVerifiedAt?: string;
}
```

实际实现需使用显式 schema version 和迁移函数。`authorization` 只在完成探测或部署后写入；已有同指纹公钥标记为 `external`，不提供撤销按钮。主机资料属于本机敏感元数据，不启用 Settings Sync；密码、私钥内容和私钥口令不进入任何 VS Code 存储。

公开扩展接口：V0.1 不向其他扩展导出 API。命令 ID 使用 `sshOnboard.*` 命名空间，配置使用 `sshOnboard.*`。

## 6. 兼容性与依赖

- VS Code Desktop：最低版本在实现时按实际使用的稳定 API 固定，不追求过旧版本兼容。
- 本地系统：Windows 10/11 x64。
- 本地工具：`ssh.exe`、`ssh-keygen.exe`；V0.1 不依赖 `ssh-agent`。
- 远端：标准 Linux OpenSSH Server、可写 Home、SFTP 子系统和普通 POSIX 文件语义。
- 必需扩展：`ms-vscode-remote.remote-ssh`。

## 7. 发布验收

稳定版发布前必须同时满足：

- 所有自动化检查通过，VSIX 可在全新隔离配置中安装和激活。
- 至少一台低权限 Linux 测试机完成“密码初始化 → 密钥验证 → Remote - SSH 打开默认目录”。
- 错误密码、未知指纹、指纹变化、重复密钥、配置冲突、断网和权限错误均有明确且安全的失败结果。
- 测试密码不出现在进程参数、环境变量、日志、异常、临时文件、测试快照和 VSIX 中。
- 发布资产包含 VSIX、SHA-256 校验文件、SBOM、GitHub 构建来源证明和变更说明。
- GitHub Release 先发布预发布版本；获得真实试用反馈后再发布稳定版并上传 Marketplace。
