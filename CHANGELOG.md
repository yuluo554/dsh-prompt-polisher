# Changelog

本项目的版本记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-19

### 修复

- **dsh 兼容性门槛改为范围声明**：`peerDependencies` 里 5 个 `@deepseek-ai/dsh-*` 从精确 `0.2.0-rc.1` 改为 `^0.2.0-rc.1`。dsh 启动时按 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 校验 peer，精确 pin 会导致插件在 dsh `0.2.1` 上被**直接拒绝加载**（抛错，不是警告）。新范围覆盖 `0.2.0-rc.1` → `0.2.1`（含 `0.2.1-alpha.*` / `0.2.1-rc.*`），并排除将来的 `0.3`。
- `@deepseek-ai/cordis` 的 peer 从精确 `4.0.4` 改为 `^4.0.4`（覆盖 dsh 0.2.0 的 4.0.4 与 dsh 0.2.1 的 4.0.5）；开发依赖升级到 `4.0.5` 并在该版本上跑通全部测试。

### 变更

- 移除 `package.json` 里装饰性的 `dsh.compatibility.dsh` 字段：dsh 从不读取它（`@deepseek-ai/` 全树 grep 0 命中），真实门槛只有 `peerDependencies`。README 已按真实门槛重写，避免两处口径漂移。
- 状态条还原拆成两个入口：**还原上一步**（本次优化前的草稿）与**还原首次**（本会话第一次优化时手打的草稿，仅在两者不同时显示）。此前只有一个「还原」，连续优化多次时只能回到最近一步，用户无法一键回到最初的提示词。

### 验证

- 已在 dsh `0.2.0-rc.1` 与 `0.2.1-rc.2` 上实机装载：0 条 incompatible、0 条 `did not activate`，host/engine 双半激活，`workflow-ptc` patch 位翻转生效。
- 会话模型通路在 `0.2.1-rc.2` 上端到端成功（`{"ok":true,...,"modelVia":"session"}`）。
- 全量离线测试 71/71 通过，双 tsc 0 错。

### 升级提示

**0.1.0 在 dsh 0.2.1 上会被拒绝加载。** 如果你已经把 dsh 升级到 0.2.1，请升级本插件：

```sh
dsh plugin --profile web add dsh-prompt-polisher@0.2.0
```

本次没有新增功能、没有改 RPC 契约 / 错误码 / 模板 id / golden 快照。

## [0.1.0] - 2026-09-30

### 新增

- 「优化提示词」按钮（`conversation.input.right` 席位）：读取草稿 → 模型改写 → 回填。
- 状态条（`conversation.input.dock` 席位）：一键还原优化前的原文；优化期间继续编辑时提供「替换 / 放弃」竞态保护。
- 双模型通路：默认走 dsh workflow 引擎（会话模型，零配置）；可在设置页配置 OpenAI 兼容独立 API（base URL / 模型 / 密钥，密钥只存宿主侧）。
- 风格切换：`concise` / `structured` 两预设，按钮旁菜单选择并记忆；支持整段自定义模板覆盖（必须含 `{draft}`）。
- 引用 chips 保护：草稿含 `@` / `/` 引用时禁用优化。
- 设置页：启用开关、API 配置、模板覆盖、客户端诊断上报开关；全部字段 volatile，免重启生效。
- 离线测试套件：71 例，含真实引擎层、20 用例 golden 字节比对、EOL / locale / 脱敏守门。

[0.2.0]: https://github.com/yuluo554/dsh-prompt-polisher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yuluo554/dsh-prompt-polisher/releases/tag/v0.1.0
