# SSH Onboard 安全设计与威胁模型

## 1. 安全目标

SSH Onboard 会接触服务器密码、私钥路径、SSH 主机身份以及两个关键配置文件，因此按高权限本地扩展对待。安全目标是：

- 密码只用于一次初始化，不落盘、不跨进程、不上传。
- 在发送密码前阻断未知或变化的主机身份。
- 不覆盖或静默删除用户已有 SSH 配置与远端授权。
- 任何用户输入都不能形成 Shell/参数注入。
- 最终成功必须由系统 OpenSSH 使用指定密钥实测证明。
- 发布资产能追溯到公开源码、提交和构建工作流。

## 2. 信任边界与资产

受保护资产：

- 一次性服务器密码；
- 本地 SSH 私钥和 agent 身份；
- 主机信任记录；
- 本地 `~/.ssh/config`；
- 远端 `~/.ssh/authorized_keys`；
- 服务器地址、用户名、目录等基础设施元数据。

信任边界：

```text
User input
  → VS Code extension process
  → ssh2 / Windows OpenSSH process
  → network
  → remote sshd / user home
```

VS Code 扩展并非系统安全沙箱。安装扩展意味着用户信任发布者和整个依赖链，因此源码、构建流程、依赖审计和可验证 Release 都属于产品安全的一部分。

## 3. 主要威胁

| 威胁                        | 控制措施                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| 首次连接遭遇 MITM           | 认证前展示或匹配 SHA256 指纹；精确保存 host key；变化硬失败                                               |
| 密码泄漏到进程或日志        | 不使用 CLI 参数、环境变量、文件或 SSH_ASKPASS；仅传给内存中的 ssh2 连接；统一日志脱敏                     |
| 恶意字段形成命令注入        | `spawn(exe, args[])`；固定远端命令；用户数据通过结构化 SSH/SFTP 通道处理                                  |
| 覆盖 SSH Config             | 独立 Include；备份、锁、hash 复核、受控区块与语法展开验证                                                 |
| 覆盖 authorized_keys        | 所有权/类型检查、插件锁、去重、同目录临时文件，以及 rename 前的 hash/元数据复核；外部竞态不作绝对无损保证 |
| 验证误用了 agent 中其他密钥 | 不 Include 用户配置的隔离最小配置；`ssh -G` 断言唯一目标身份；禁用密码/keyboard-interactive               |
| 无口令私钥被盗              | 每主机独立、严格 Windows ACL、无云同步、可精确撤销                                                        |
| 共享密钥扩大影响范围        | 仅高级模式；显示完整主机清单；明确轮换/撤销影响                                                           |
| 供应链篡改 VSIX             | 锁文件、依赖审查、CodeQL、固定 Action SHA、校验和、SBOM、GitHub artifact attestation                      |

## 4. 不可违反的安全契约

### 4.1 密码

- 通过 `showInputBox({ password: true })` 获取，但文档不得声称“内存可立即安全清零”；JavaScript 字符串可能在 GC 前留存。
- 变量作用域限制在单次操作，不写入闭包、全局状态、错误对象、遥测或测试快照。
- `ssh2` 不配置 debug logger；底层错误进入用户界面前先映射和脱敏。
- 操作结束、取消、超时或异常时立即关闭连接并释放引用。
- V0.1 不支持 SecretStorage 记住密码，也不提供隐藏开关。

### 4.2 主机密钥

- `hostVerifier` 是强制配置；默认 auto-accept 属于发布阻断项。
- 密码认证只能在 hostVerifier 接受后发生。
- 首次确认按钮文案必须是“我已核对并信任此指纹”，不能只是“继续”。
- 支持粘贴管理员提供的期望指纹并精确比较。
- 指纹变化默认没有自动修复；替换信任必须再次确认旧值、新值、主机和端口。
- 禁止 `StrictHostKeyChecking no/off/accept-new` 和 `UserKnownHostsFile /dev/null`。
- V0.1 固定 `UpdateHostKeys no`；新增或轮换 host key 必须逐把展示并带外确认。

### 4.3 私钥

- 生成前用不可预测 key ID 确定新路径，使用独占创建并拒绝覆盖。
- 只有本次操作新建的受管目录才会设置 ACL；已存在的同名目录只做读取验证，不合规时中止，不自动接管或改写其 ACL。
- 私钥 ACL 检查失败即不部署公钥。
- 不读取或显示完整私钥，不把私钥内容放入 VS Code state。
- 诊断只能显示路径末段和 SHA256 公钥指纹。
- 卸载扩展不自动删除私钥或远端公钥，避免不可恢复地切断访问；提供明确清理向导。

### 4.4 `authorized_keys`

- 拒绝符号链接、异常所有者和非普通文件。
- 不解析或执行 key comment；扩展只写自己生成的安全 comment。
- 去重依据 key fingerprint，而不是整行字符串；发现预存同指纹行时标记为外部管理，不新增也不允许扩展撤销。
- 保留已有空行、注释、选项、顺序和无末尾换行状态，仅做最小追加。
- 两个插件实例并发时只有一个获得锁；拿不到锁就退出。
- 写入前后记录并复核目标内容 hash、大小和修改时间；发现外部变化就中止。复核之后仍存在无法消除的外部竞态，V0.1 不承诺与其他管理工具并发写入时绝对无损。
- 写入验证失败不自动回滚；撤销必须由用户显式选择，且只删除 marker、fingerprint、key blob 和保存的规范化完整行均唯一匹配的扩展自有授权；歧义时硬失败。
- 撤销前必须明确提醒用户先确认备用密钥、密码登录或服务器控制台可用，避免移除最后一个有效登录凭据。

### 4.5 本地配置

- 不重写用户所有 Host 块，不生成 `Host *`、`Match`、`ProxyCommand` 或任意命令。
- Alias 必须在受控字符集内，并检查用户现有配置和受管配置中的冲突。
- Include 修改前备份；源 hash 变化时拒绝覆盖。
- 首次主机信任在同一受管锁内依次写空 `config`、`known_hosts`和最后的 V1 `state.json`；不将这一可恢复提交宣称为跨文件原子事务。
- Preview.2 自动恢复必须满足精确拓扑和逐字节渲染相等；已被用户修改的受管文件永不自动覆盖。
- V1 state 使用 ProfileStore authority hash 防止不同 VS Code Profile 对同一受管 SSH 路径相互覆盖；旧的无 authority V1 state 只能在当前渲染与两个文件都精确相等时迁移。
- 初始化在网络探测前、密码认证后且写入远端前、以及最终本地提交时重新预检。预检失败不调用密码连接，也不修改远端。
- 所有改变受管渲染结果的操作通过全局配置协调锁串行化；获锁后重读 ProfileStore。锁只有在所有权 token 仍匹配时才会被释放者删除。
- Windows 上必须能明确读取安全描述符并验证精确 DACL。owner 通过 Windows 原生 `GetNamedSecurityInfoW` 契约读取；仅当 API 成功、返回有效 security descriptor 且 owner SID 指针为空时才判定为明确缺失。owner 可读取为当前用户、Administrators、SYSTEM，或明确缺失；owner 明确缺失时，只有在 DACL 已关闭继承、且恰好以正确继承标志向当前用户和 SYSTEM 各授予一条 FullControl ACE 时才接受。owner 读取异常、模糊结果、未知非空 SID，或无法持久化精确 DACL 时安全中止。
- 受管文件每次写后使用 `ssh -G` 验证 HostName、User、Port、IdentityFile、known_hosts 和认证策略。
- BatchMode 使用不 Include 用户配置、且只写一条目标 IdentityFile 的一次性最小配置；`ssh -G` 必须证明展开结果恰好只有目标 IdentityFile，CertificateFile 为 none，ProxyCommand/ProxyJump/LocalCommand 不改变身份、路由或执行行为，并且 HostKeyAlias 精确等于 `ssh-onboard-<profile UUID>`。受管 `known_hosts` 只用这一固定别名绑定该 profile 已确认的 exact key，以隔离共享 endpoint 的不同 profile。
- 错误输出不得包含完整主机清单；用户主动打开 Diagnostics 时才显示脱敏值。

## 5. Workspace Trust 与网络

扩展不读取或执行工作区文件，也不接受 workspace-level 配置。所有敏感设置只来自扩展 UI 与全局本地状态，因此可声明支持 Untrusted Workspaces，但每个修改本地/远端状态的操作仍必须由用户显式触发。

允许的网络连接仅包括：

- 用户配置的 SSH 主机；
- Remote - SSH 自身需要的微软服务；这不属于本扩展实现。

扩展自身不包含遥测、更新服务器、许可证服务器、AI 服务或云同步。README 和 Marketplace Privacy 部分必须明确这一点。

## 6. 失败与恢复

| 失败阶段              | 必须保证                                                                |
| --------------------- | ----------------------------------------------------------------------- |
| 指纹未确认/变化       | 密码尚未发送，远端未修改                                                |
| 密码错误              | 不写 SSH Config Host 块，不部署 key                                     |
| 公钥部署中断          | 未检测到外部并发修改时原 `authorized_keys` 保持可用；临时文件可安全清理 |
| 本地配置写入失败      | 保留备份，已部署 key 可通过向导撤销                                     |
| 配置预检失败          | 远端零写入；按 reason 提供设置、SSH Config 或日志入口                   |
| BatchMode 失败        | 标记 Needs attention，不自动删 key，给出诊断与撤销入口                  |
| 默认目录无效          | 密钥保留且连接可用，只阻止自动打开目录                                  |
| Remote - SSH 启动失败 | 展示可复制的官方 CLI 连接命令，不回滚 SSH 配置                          |

恢复动作必须幂等：重复初始化不会追加重复 key，重复撤销不会删除其他 key，重复写配置不会产生多个 Include。

## 7. 安全测试清单

发布前必须自动或手工覆盖：

### 身份与认证

- 未确认指纹时抓包/服务器日志证明没有密码认证尝试。
- 指纹变化、算法变化、DNS 指向变化均被阻断。
- 错误密码只允许一次受控尝试，不自动暴力重试。
- password 和 keyboard-interactive 关闭后，隔离配置的 `ssh -G` 证明只有目标身份，BatchMode 只能用目标密钥成功。
- `UpdateHostKeys` 不得自动增加信任；主机密钥轮换必须阻断并要求带外确认。

### 注入与路径

- Host、User、Alias、默认目录、显示名包含空格、引号、反斜杠、换行、NUL、`$()`、反引号、分号和前导 `-`。
- IPv6 和非 22 端口的 known_hosts 地址格式正确。
- Windows 路径含空格、中文和长路径时，进程参数不经过 Shell。
- 默认远端目录覆盖 Home、空格、Unicode、`#` 和 `%`；URI 必须用结构化 API 构造，不得双重编码。

### 文件完整性

- `authorized_keys` 不存在、为空、有注释、有受限 key、有损坏行、无末尾换行、只读、符号链接、并发锁。
- 写入时断网、磁盘满、权限拒绝和进程终止后原文件可用。
- SSH Config 含 BOM、CRLF/LF、注释、Include、Host *、Match 和并发编辑。
- 同名 Alias、重复 Include 和外部修改受管文件时安全中止。

### 泄漏检查

- 在日志、Output Channel、异常、进程列表、环境变量、临时目录、globalState、测试产物、source map 和 VSIX 解包内容中搜索测试密码。
- 检查 npm 运行时依赖许可证与已知漏洞。
- 检查 Release VSIX 的 SHA-256、SBOM 和 attestation 与 tag commit 一致。

## 8. 安全披露

公开仓库必须在首个预发布前提供根目录 `SECURITY.md`，包含：

- 私下报告漏洞的渠道；
- 受支持版本；
- 响应时间目标；
- 不要在公开 Issue 中提交密码、私钥、完整服务器地址或日志；
- 凭据泄露后的立即轮换说明。

该文件在确认维护者公开联系邮箱后创建，避免把个人邮箱无意暴露在仓库中。
