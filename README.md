# dsh-prompt-polisher

DeepSeek Harness (dsh) 桌面端插件：在聊天输入框工具行加一枚「优化提示词」按钮，点击后把输入框里的草稿交给模型改写，优化结果回填输入框，随时可继续编辑、可一键还原。交互形态对标 WorkBuddy 内置的提示词优化，图标自绘、不复用。

## 特性

- **一键优化**：`conversation.input.right` 席位按钮，读取当前草稿 → 模型改写 → 回填；原文保存在插件态，状态条（`conversation.input.dock`）一键还原。
- **双模型通路**：默认走会话模型（dsh workflow 引擎 `agent()` 单代理，零配置开箱可用）；也可在设置里配置 OpenAI 兼容独立 API（base URL / 模型 / 密钥）直连，**密钥只存宿主侧，绝不下发浏览器**。
- **风格切换**：`concise`（精炼明确）/ `structured`（结构化增强）两预设，按钮旁菜单选择、localStorage 记忆默认风格；支持整段自定义模板覆盖（必须含 `{draft}` 占位符）。
- **竞态保护**：优化期间你继续打字 → 回填前弹出「替换 / 放弃」，绝不静默覆盖；会话切换自动取消在途请求。
- **引用 chips 保护**：草稿含 `@` / `/` 引用时禁用优化（改写会破坏引用记号）。

## 安装

```sh
dsh plugin --profile web add dsh-prompt-polisher
```

要求 dsh `>=0.2.0-rc.1`（兼容性 floor 同此值）。插件会自动把 workflow 引擎（`workflow-ptc`）从 web profile 的默认禁用中翻转启用——这是会话模型优化通路的前提。

## 配置

Web 设置 → 插件 → Prompt Polisher：

| 字段 | 说明 |
|---|---|
| 启用独立 API | 开启后优化优先走独立 API；关闭/未配置走会话模型。API 失败**不静默降级**，错误提示可引导切回 |
| API Base URL | OpenAI 兼容端点，默认 `https://api.deepseek.com`（自动补 `/chat/completions`） |
| API Key | 密码框只写：留空=保持已存值；宿主侧存储，跨 wire 剥除 |
| Key 环境变量名 | 备用凭据来源（默认 `DEEPSEEK_API_KEY`：credentials 服务 → 进程环境） |
| 模型 | 默认 `deepseek-chat` |
| 自定义模板 ×2 | 整段覆盖对应风格的内置提示词，必须含 `{draft}`；无效覆盖自动回退内置 |
| 客户端诊断上报 | 浏览器侧插件故障自动上报到宿主日志（不出本机），默认开启 |

全部字段 volatile：改动**免重启即时生效**（每次优化现读配置）。

## 开发

要求 Node ≥ 22（测试的真实引擎层依赖 `@deepseek-ai/dsh-workflow-ptc`，其内部用到 node 22+ 的 `Promise.withResolvers`；CI 同此版本）。

```sh
pnpm install
pnpm lint   # 双 tsc（host + client）0 错
pnpm test   # 构建 + 全量离线测试（node --test，模型 API 永不进 CI）
```

测试套件内置三道发布守门：

1. **基准**（`test/bench.test.js`）：20 个冻结用例（`data/fixtures/`）走真实优化管线（校验 → 渲染 → 桩模型 → 清洗），响应与 `data/golden/` 做**字节级比对**，外加 EOL 守门（任何冻结文件出现 CR 即失败）。重生成 golden：`node scripts/update-golden.mjs`（仅限已记录的契约变更）。
2. **locale 完整性**（`test/locale.test.js`）：zh/en 键集一致、插值占位符配对、client 源码引用的每个翻译键双语可达。
3. **脱敏审计**（`scripts/desensitize-audit.mjs`，守门于 `test/desensitize.test.js`）：阶段 7 四步的工作树部分（.gitignore 覆盖 / 内容级扫描 / 二进制白名单），全过打印 `DESENSITIZE_AUDIT_OK`。

## 目录

```
src/        host 半（管线、双通路分派、config schema、RPC 路由）
client/     web 半（按钮、状态条、风格菜单、设置面板；构建为单 bundle）
scripts/    构建 / 播种 / golden 重生成 / 脱敏审计
data/       基准 fixtures 与 golden 快照（字节冻结，台账见 data/README.md）
lib/        构建产物（gitignored；npm 包随 lib 发布，安装零构建）
```

设计与决策记录见仓库 `plan/` 目录（[05-里程碑](https://github.com/yuluo554/dsh-prompt-polisher/blob/main/plan/05-里程碑.md)、[06-交付对标与决策记录](https://github.com/yuluo554/dsh-prompt-polisher/blob/main/plan/06-交付对标与决策记录.md)）。

## 限制

- 草稿 trim 后少于 8 字符禁用；含 `@` / `/` 引用记号禁用（改写会丢引用）。
- 风格预设 `concise` / `structured` 两个（错误码封闭集、模板 id 清单为冻结契约）。
- 非环回连接（远程访问本机 GUI）下配置为内存模式，不可持久保存。

## 许可

MIT
