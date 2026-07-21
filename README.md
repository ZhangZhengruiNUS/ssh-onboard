# SSH Onboard

> 项目状态：开发阶段，尚未提供可安装版本。

## 为什么开发 SSH Onboard

微软官方 **Remote - SSH** 是一套非常强大的 VS Code 远程开发工具：它提供远程文件访问、集成终端、远程扩展、语言服务、Git、调试和端口转发等完整体验。

但在使用密码认证时，Remote - SSH 默认不会保存并自动填写服务器密码。建立新的 SSH 连接时，用户仍可能需要再次输入密码。常见解决办法是在本机生成 SSH 密钥，再把公钥写入服务器的 `~/.ssh/authorized_keys`；完成后即可通过公钥认证登录。

这个流程对熟悉 SSH 的开发者并不复杂，但对新手并不友好：需要理解公钥和私钥、选择正确文件、复制公钥、处理 `authorized_keys`、修正目录权限、编辑 SSH Config，并验证最终登录是否真的使用了目标密钥。任何一步出错，都可能导致认证失败，甚至影响原有 SSH 配置。

默认打开路径也是一个高频痛点。许多开发者连接某台服务器后，总是进入同一个项目目录；但常见流程仍是先连接主机，再手动选择或打开该目录。新连接或窗口切换还可能再次触发认证，重复操作既耗时又容易打断工作节奏。

SSH Onboard 正是为解决这些问题而生：

```text
添加服务器并设置默认目录
→ 首次输入一次密码并核对主机指纹
→ 自动生成或选择 SSH 密钥
→ 安全部署公钥并验证密钥登录
→ 配置官方 Remote - SSH
→ 一键连接并打开默认目录
```

SSH Onboard **不是重新实现一套 SSH 客户端或远程开发环境**，而是微软官方 Remote - SSH 的轻量增强层。它只负责服务器资料、首次公钥初始化、受控 SSH 配置和默认目录；连接后的 Explorer、终端、远程扩展、Git、调试和语言服务仍全部由官方 Remote - SSH 提供。

## 核心目标

- 首次连接只输入一次服务器密码，密码不持久化。
- 在发送密码前显示并确认服务器主机指纹。
- 默认为每台服务器生成独立的 Ed25519 密钥。
- 高级配置可选择已有密钥或显式共享组密钥。
- 保守、可检测冲突地维护本地 SSH Config 和远端 `authorized_keys`；发现外部并发修改即中止。
- 验证密钥登录成功后，一键用官方 Remote - SSH 打开默认目录。

## V0.1 支持范围

- 本地：Windows x64、VS Code Desktop、本机 OpenSSH Client。
- 远端：可直连、允许密码认证和公钥认证的标准 Linux SSH 主机。
- 默认账号：普通 Linux 用户；`root`、跳板机、MFA、非标准 `AuthorizedKeysFile` 暂不属于正式支持范围。

## 不做什么

- 不实现自己的 SFTP Explorer 或 SSH 终端。
- 不替代 Remote - SSH，也不在远端安装自有服务。
- 不保存服务器密码、私钥口令或一次性验证码。
- 不提供遥测、云同步、AI、审计平台或收费授权功能。

## 许可证

本项目采用 [MIT License](LICENSE)，版权署名为 `ZhangZhengruiNUS`。

贡献代码前请阅读 [贡献指南](CONTRIBUTING.md)；安全问题请通过 [安全策略](SECURITY.md) 中的私密渠道报告，不要创建公开 Issue。

## 设计文档

- [产品需求规格](docs/PRODUCT_SPEC.md)
- [技术架构设计](docs/ARCHITECTURE.md)
- [安全设计与威胁模型](docs/SECURITY.md)
- [开发、测试与发布计划](docs/DEVELOPMENT_PLAN.md)

## 已确认公开标识

| 项目                  | 值                                        |
| --------------------- | ----------------------------------------- |
| Display Name          | `SSH Onboard`                             |
| Extension Name        | `ssh-onboard`                             |
| GitHub Repository     | `ZhangZhengruiNUS/ssh-onboard`            |
| Command Namespace     | `sshOnboard`                              |
| Marketplace Publisher | 暂定 `ZhangZhengruiNUS`，发布前创建并确认 |

截至 2026-07-21，VS Code Marketplace、GitHub、npm 和公开软件搜索未发现 `SSH Onboard` / `ssh-onboard` 的精确同名项目。名称已由项目所有者确认；该结果不构成商标或法律可用性保证。项目与 Microsoft 无隶属或背书关系，Remote - SSH 是其各自权利人的产品。
