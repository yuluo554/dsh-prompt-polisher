# HANDOFF-M2 — dsh-prompt-polisher 真实优化 MVP

> 交接快照，2026-09-29 M1 对话收尾落盘。新对话凭本文件零上下文续接 M2；M1 已完成（自动化门全绿）。

## 当前进度（M1 已完成，2026-09-29）

- 包形落地于 `D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher\`：package.json 三件套（`dsh.bundle.patch` + host apply 默认导出 + `dsh.client`/`exports ./client`）、`cordis.patch.yml`（仅 insert 本插件行；workflow-ptc 翻转留 M2）、`scripts/build-client.mjs`（esbuild cjs + ModuleLoader banner/footer + require 白名单扫描门，实测 2 require sites / 2 externals）。
- host 半：`src/index.ts`（apply 无强制依赖，激活零门槛）+ `src/web.ts`（`POST /api/prompt-polisher/optimize`，requestBody buffered，挂为等待 `connection` 的子插件）+ `src/optimize.ts`（校验→echo 伪优化→meta 纯函数）。
- client 半：`client/index.tsx`（inject `['slots','locale']`，注册 `conversation.input.right` 席位 id `prompt-polisher`）+ `PolishButton.tsx`（自绘笔尖+双星火临时图标；空草稿/非 plain phase/请求中禁用；点击 POST → `setDraft` 回填；会话切换 unmount abort）+ `api.ts` + `i18n.ts`（M1 最小 3 键 × zh/en）。
- 实机验证全过（0.2.0-rc.1 实测）：`dsh plugin --profile web add ./dsh-prompt-polisher` → dump-config 1269 行插件行在 → 后台启动 0 条 "did not activate" 且 host 半日志出现 → cookie 认证下 curl RPC 成功臂/EMPTY_DRAFT/BAD_STYLE/未认证 401 全对 → UTF-8 草稿回显无损 → client bundle 进启动 combo（10.3MB、58 模块，`id: "dsh-prompt-polisher"` 在）。
- 测试 11/11 全绿（`pnpm lint && pnpm test`）：RPC handler 直调断言响应形 + 路由注册接线 + echo 管线错误码 + client bundle Node 垫片（ModuleLoader 接线、席位 id、inject 面、react-dom/server 静态渲染断言禁用逻辑）。

## M2 首项（用户协助，1 分钟）

- **实机目检**：启动 dsh web profile，打开浏览器确认 ①优化按钮出现在输入框工具行（提交动作左侧区，WorkBuddy 位置基准）②有草稿点按钮 → 草稿被替换为 `[polisher:concise] <原文>` ③空草稿时按钮灰。目检不理想 → 切备选席位 `conversation.input.left`/`activity`（plan/02 席位表），结论记入 06 决策表。
  - 本机 CDP 自动化损坏（环境坑 #1），此步只能人工；自动化侧证据（bundle 服务面 + 垫片渲染断言）已闭环。

## M2 待办（DoD 见 plan/05 §M2）

1. workflow 引擎通路：`cordis.patch.yml` 加 `- id: workflow-ptc / disabled: false`（官方 tool-workflow 保持禁用）；**同轮重审 compatibility floor**（引擎行 id 出现 ⇒ floor 必须 ≥0.2.0-rc.1，现值已对，复查即可）；host 半加 `inject: ['workflowEngine','subagents']`（子插件形式，CLI profile 不挂）。
2. 草稿经 `args` 注入 script（R5）：script 体固定 `agent(args.prompt,...)`，草稿绝不拼进 script 字面量；fixtures 含反引号/`${}`/中文。
3. 输出清洗器（R4）：剥 ``` 围栏、去首尾成对引号、长度上限、空输出 → PARSE_FAILED，**绝不回填**；stopReason cancelled → CANCELLED，其余非 completed → UPSTREAM_FAILED。
4. 按钮状态机补全（FR3/FR5）：loading 转圈、错误可见、<8 字符禁用 + tooltip。
5. 还原状态条（FR4，R2）：`conversation.composer.dock` 席位，"已优化 · 还原"，原文存插件内存 per-session Map；竞态提示（R6，draftRev0 比对，草稿已变 → [替换]/[放弃] 不静默覆盖）。
6. chips 保护（FR6，R1）：`occurrences.length > 0` → 按钮禁用 + tooltip 说明。
7. 测试：真实 `dsh-workflow-ptc` 引擎 + 桩 ptcRuntime/subagents（run 带 `id` 字段）/sandboxPolicy（手动 new 引擎传全量 config——zod 默认只在 Cordis 流生效）；桩子代理返回含围栏输出 fixtures 验证清洗；基准雏形 ≥10 用例。

## 既定口径（动了必须重跑对应验证并记入新 HANDOFF）

- 目标 dsh 0.2.0-rc.1（M1 实测确认）；compatibility floor `>=0.2.0-rc.1`。
- RPC `POST /api/prompt-polisher/optimize`；请求 `{draft,style,source?}`；响应 `{ok:true,optimized,style,modelVia:'session'|'api'}|{ok:false,error}`；错误码 `EMPTY_DRAFT/TOO_LONG/UPSTREAM_FAILED/PARSE_FAILED/CANCELLED/BAD_STYLE`。
- **M1 定案（冻结）**：缺 style → 默认 `concise`；显式未知 style（含空串）→ `BAD_STYLE`；M1 echo 输出 = `[polisher:<style>] ` + 原文（M2 换真模型时此 marker 消失，属预期，同步改测试）；`DRAFT_MAX_LENGTH = 8000`；业务错误 HTTP 200，传输错误 400。
- client bundle require 白名单：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-locale`；服务 inject `['slots','locale']`；新增浏览器依赖三处同步（package.json `dsh.client.external`(+inject) / build-client.mjs SEED_MODULES / client/ambient.d.ts 类型 import）。
- 测试全离线 node:test，模型 API 永不进 CI；`@deepseek-ai/*` 精确 pin；golden 快照（M4 起）字节冻结 + `.gitattributes`（已配 `* text=auto eol=lf`）。
- 触发仅按钮；不做输入自动优化/发送拦截/composer 接管；图标自绘不复用魔法棒。
- M1 已实现的"空草稿禁用 + phase!=='plain' 禁用"保留；<8 字符阈值属 M2（FR5）。

## 本机环境坑（M1 实测更新）

- CDP 浏览器自动化损坏（Chrome/Edge 均 "exited early without DevToolsActivePort"）——勿再走该路径；GUI 验证 = 用户手工浏览器 + Node 垫片（M1 已验证垫片+react-dom/server 静态渲染可行）。
- Git Bash 下 `npm i -g` 段错误：改 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" i -g <pkg>`。
- **Git Bash 里 curl -d '中文' 会按 GBK 发出**——RPC 中文用例先 `node -e` 写 UTF-8 文件再 `--data-binary @file`（M1 实测：shell 直发回显即乱码，文件体回显无损）。
- pnpm 10 拦 esbuild postinstall（警告可忽略，平台二进制走 optionalDependencies 正常）；pnpm 符号链接显示带 `@` 后缀，真实包路径直接按名访问。
- Node 垫片 require 种子表：`react/jsx-runtime` 必须 `nodeRequire('react/jsx-runtime')` 整模块返回——主入口 react 不导出 `jsx`（dsh-pipeline 同款 shim 有此潜伏坑，本包测试已用整模块形态）。
- `python` 是商店 stub（exit 49）——codemod 用 node；powershell -Command 内联整条用单引号；`node -e` 不认 `/c/...` 路径，用 Windows 路径。
- 同一命令连续失败 ≤3 次换通道（crash-loop-rescue 纪律）。

## M1 验证命令实录（复跑即可复验）

```sh
cd D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher
pnpm lint && pnpm test          # 11/11 全绿
cd .. && dsh plugin --profile web add ./dsh-prompt-polisher   # 已装（link），改动后重跑
dsh --profile web --dump-config | grep prompt-polisher        # 插件行 ~L1269
dsh --profile web --no-open --port 0 &                          # ~13s，日志 0 条 did not activate
# curl：先 GET /?token=<日志token> -c jar 拿 cookie（303），再带 -b jar POST /api/prompt-polisher/optimize
# client bundle：外壳 HTML __DSH_BOOT__ 取 rev，GET /plugins/??dsh-prompt-polisher/client.js&rev=<rev>
# 清理：netstat -ano | grep <port> 找 PID → taskkill //PID <n> //F
```

## 必读材料

- 本项目 `plan/00-06`（重点 02 架构 / 03 详设 / 05 里程碑）+ `plan/HANDOFF-M1.md`（M1 决策上下文）。
- skill：`dsh-plugin-dev`（必读全文，§4 引擎契约 / §6 测试桩形态 M2 直接用）、`ai-tool-project-sprint`（HANDOFF 先落盘再结束对话）。
- 可运行参照：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`（真实引擎测试 `test/real-engine.test.js` + 桩形态 M2 照抄）。
