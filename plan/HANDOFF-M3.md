# HANDOFF-M3 — dsh-prompt-polisher 风格与独立 API

> 交接快照，2026-09-29 M2 对话收尾落盘；M2 实机目检于 2026-09-30 续跑并**全部通过**（见「M2 目检实录」）。新对话凭本文件零上下文续接 M3。
>
> **✅ M3 已完成（2026-09-30）**：本文件所列 M3 待办全部落地（FR8 风格菜单 / FR9 独立 API / FR10 自定义模板最简形 / 配套测试 62/62），实机冒烟全过，config 流端到端验证通过。决策已回写 plan/06（M3 决策行），M3 收尾交接快照见 **plan/HANDOFF-M4.md**（M4 续接凭它）。本文件保留原文供追溯 M2 目检实录与 M3 计划口径。

## M2 目检实录（2026-09-30，本机实机 + 用户浏览器，全部通过）

- **①按钮渲染 ✅**：优化按钮出现在 composer 工具行（input.right，模型选择器左侧，自绘笔尖图标）。
- **②真实模型优化回填 ✅**：输入烂提示词点按钮 → 会话模型优化回填（引擎通路端到端：RPC → sessionController.resolveAgent → workflowEngine → spawn 子代理 → 清洗 → setDraft）。
- **③状态条 + 还原 ✅**：优化后 composer 卡片上方显示"已用「精炼明确」优化 · 还原"，点还原恢复原文。
- **④竞态 ✅（自动化证据闭环）**：真实模型响应快，人工来不及在返回前打字（非缺陷）；竞态语义由 decideBackfill 纯函数单测 + 垫片 race 态渲染断言（[替换][放弃]）覆盖，真实引擎取消链路由 real-engine AbortSignal 用例覆盖。
- **⑤禁用态 ✅**：短草稿/@ 引用禁用 + tooltip 正常。
- **目检揪出并修复的两个 M1 起潜伏问题**：
  1. **useInput 契约**：`useInput` 是 `SnapshotSelectorHook`，**selector 必传**（官方写法 `useInput((s)=>s)`）；M1 起无参调用 → 渲染崩溃 → 按钮从未显示。诊断回路抓到 `render:PolishButton: l is not a function` 定位。plan/02 证据行 `useInput() → InputState` 形态失真已证伪。垫片 stub 同步改真实形态（教训：**stub 必须按官方契约写，垫片绿 ≠ 官方契约绿**）。
  2. **状态条席位两次迭代**：`composer.dock`（官方仅会话型 composer 变体渲染，blank-session hero 无出口）→ `input.overlay`（blank 也渲染但**浮在草稿文本上重叠**，不可用）→ **终选 `input.dock`**（composer 卡片上方全宽，官方 queue-notice/Todo 面板同位，渲染无条件限制）。选席位前先在官方 conversation bundle grep 渲染点确认条件。
- **新增诊断回路（永久保留）**：client 生命周期各环节（factory try/catch / apply / 席位注册 / 组件渲染 ErrorBoundary）失败自动 POST `/api/prompt-polisher/debug` → 宿主 console.error 进启动日志——CDP 坏环境下唯一浏览器侧可观测通道；M4 打磨可加开关。

## 当前进度（M2 已完成，2026-09-29）

- **引擎通路全线打通**：`cordis.patch.yml` 翻转 `workflow-ptc / disabled: false`（官方 tool-workflow 保持禁用；dump-config 根层 L313 引擎行无 disabled=启用，插件行 L1270 在）；compatibility floor `>=0.2.0-rc.1` 复审通过（patch 行 id workflow-ptc 自 0.2.0-rc.1 出现）。host 半新增独立引擎子插件（`src/engine-half.ts`，inject `['workflowEngine','subagents','sessionController']`），apply 时经 `src/dispatch.ts` 发布 dispatch、dispose 撤销。
- **优化管线（src/optimize.ts）**：parse（含 sessionId）→ dispatch（真模型）→ 响应；M1 echo 管线已删（marker 退场，测试同步改）。RPC handler（src/web.ts）：sessionId 缺失 → 400 传输级；`request.signal` 传播进引擎 run（会话切换取消子代理）。
- **R5**：script 体固定常量 `POLISH_SCRIPT = agent(args.prompt,{label:'polish'}); return polished`；草稿经 `args` JSON 物化进 guest realm；真引擎实测反引号/`${}`/换行/emoji 草稿无损。
- **R4 清洗器（src/scrub.ts）**：围栏+成对引号交替剥到不动点（≤6 轮）、>8000 截断、空 → PARSE_FAILED；`mapEngineResult` 单一映射归宿（cancelled→CANCELLED、其余非 completed→UPSTREAM_FAILED、value null→UPSTREAM_FAILED、空/非串→PARSE_FAILED）。
- **模板（src/templates.ts）**：concise/structured × zh/en（CJK 占比判语言），输出约束写死（不解释/不包裹/不改语言/保留 @ 与 / 记号）。
- **client 半**：按钮（`client/PolishButton.tsx`）状态机 idle→working(spinner)→done(绿色闪烁 1.2s)/error(红+tooltip 冻结码)；禁用条件=working ∨ phase!=='plain' ∨ 空 ∨ trim<8 ∨ `occurrences.length>0`（tooltip 分别解释）；R6 经 `src/race.ts` 纯函数：rev 变且文变 → 状态条竞态提示。状态条（`client/PolishBar.tsx`，`conversation.input.dock` 席位 id `prompt-polisher-bar`——M2 目检两连跳后的终选，见目检实录）：applied 态"已用〈风格〉优化 ·[还原]"、race 态"[替换][放弃]"；记录存 `client/store.ts` per-session Map 单例（bundle 导出 `polishStore` 供垫片测试），bar unmount 即清。i18n 12 键 × zh/en。
- **测试 44/44 全绿**（`pnpm lint && pnpm test`，node:test 全离线）：rpc（管线+RPC+registry）、scrub+templates、dispatch（fake 引擎映射表）、**real-engine 6 例**（真 `dsh-workflow-ptc` 0.2.0-rc.1 + 桩 ptcRuntime[data:URL 导入真 guest]/subagents[run 带 id]/sandboxPolicy + 手动 new 引擎传全量 config）、client-bundle（双席位+渲染断言+store）、bench 雏形 **17 例**（桩模型回原始文本走真 mapEngineResult，耗时表输出）。
- **实机冒烟全过**（0.2.0-rc.1）：重装 link → dump-config 翻转生效 → 后台启动 0 条 "did not activate" 且 host/engine 双半日志在 → cookie 认证下 RPC 三路（sessionId 缺失 400 / BAD_STYLE 200 / 未知会话 200 UPSTREAM_FAILED=sessionController→引擎接线通）→ combo bundle 466KB 含双席位+全部 M2 标记。

## M3 首项（用户协助，约 2 分钟）

- **实机目检 + 真实模型全流程**：启动 dsh web profile，开浏览器：①按钮在输入框工具行 ②输入烂提示词点按钮 → 真实模型优化回填 ③继续编辑 → 状态条"已优化·还原"点还原 → 原文回来 ④优化返回前打字 → 竞态提示[替换][放弃] ⑤短草稿/含 @ 引用时按钮灰+tooltip。目检不理想 → 备选席位与结论记 06 决策表（本机 CDP 坏只能人工；真实模型端到端需要有可用会话模型的实机会话，自动化侧无法替代）。

## M3 待办（DoD 见 plan/05 §M3）

1. **风格菜单**（FR8）：按钮旁下拉（或长按），列 concise/structured 预设 + 风格 zh/en 名（locale `style.*` 键已就位）；选中即以该 style 发起优化；默认风格记忆到 localStorage；切换后结果不同用测试钉住。
2. **自定义模板通路**（FR10 最简形）：用户配置覆盖内置模板（配置机制先调研宿主 config/设置页席位，M3 调研后定形；fallback=host 侧数据文件）。
3. **独立 API 通路**（FR9，plan/02 通路 B）：host 半 Node fetch 调 OpenAI 兼容 `/chat/completions`；base_url/key/model 用户配置，**key 只存宿主侧绝不下发浏览器**；通路分派（配置了独立 API → 直连，否则引擎）；连通性测试按钮；API 未配/失败 → 提示可切回会话模型（`modelVia: 'api'` 响应字段已预留）。
4. 测试：新通路离线桩 fetch 测试；风格菜单垫片断言；golden 快照基建留 M4（本里程碑只需结果可辨）。

## 既定口径（动了必须重跑对应验证并记入新 HANDOFF）

- 目标 dsh 0.2.0-rc.1；compatibility floor `>=0.2.0-rc.1`；patch 翻转 workflow-ptc 已落（勿回退）。
- RPC `POST /api/prompt-polisher/optimize`；请求 `{draft,style,sessionId,source?}`（sessionId 必带）；响应 `{ok:true,optimized,style,modelVia:'session'|'api'}|{ok:false,error}`；错误码封闭 `EMPTY_DRAFT/TOO_LONG/UPSTREAM_FAILED/PARSE_FAILED/CANCELLED/BAD_STYLE`；业务错误 HTTP 200，传输错误 400（malformed body、缺 sessionId）。另有诊断路由 `POST /api/prompt-polisher/debug`（client 失败上报 → 宿主日志，M2 目检起）。
- 缺 style → 默认 `concise`；显式未知 style（含空串）→ `BAD_STYLE`；`DRAFT_MAX_LENGTH = OUTPUT_MAX_LENGTH = 8000`（src/limits.ts，防循环依赖的单一归宿）。
- script 体固定 + args 注入（R5）；清洗器语义（R4）与映射表在 `mapEngineResult`（基准与真实 dispatch 共用，动它必重跑 bench）。
- client bundle require 白名单：`react`、`react/jsx-runtime`（6 require sites / 2 externals）；服务 inject `['slots','locale']`；新增浏览器依赖三处同步（package.json `dsh.client.external`(+inject) / build-client.mjs SEED_MODULES / client/ambient.d.ts）。
- FR5 阈值 8（8 可用 7 禁用）；FR6 occurrences>0 禁用；竞态=rev 变且文变（decideBackfill）；还原存客户端 store 不依赖 undo；会话切换清记录。
- 触发仅按钮；不做输入自动优化/发送拦截/composer 接管；图标自绘不复用魔法棒。
- 测试全离线 node:test，模型 API 永不进 CI；`@deepseek-ai/*` 精确 pin；golden 快照（M4 起）字节冻结 + `.gitattributes`（已配 `* text=auto eol=lf`）。

## 本机环境坑（M2 实测更新）

- CDP 浏览器自动化损坏（Chrome/Edge 均 "exited early without DevToolsActivePort"）——勿再走该路径；GUI 验证 = 用户手工浏览器 + Node 垫片 + **client 诊断回路（debug RPC，本次新增）**。Computer Use（OS 层）可用但会占用用户屏幕，按需。
- **客户端 API 形态必须包源码直读核实，垫片 stub 不是证据**（本次 useInput selector 教训）；官方 bundle（npm 全局 `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`，未混淆）是消费形态的权威样本；官方插件开发文档在 `dsh-agent-preset/skills/cordis-plugin-development/`（references/ui-plugin.md + decoration 模板）。
- 官方布局席位渲染条件差异大：`composer.dock` 仅会话型 composer 变体渲染；`input.overlay` 仅需 sessionId。选席位前先在官方 bundle 里 grep 渲染点确认条件。
- Git Bash 下 `npm i -g` 段错误：改 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" i -g <pkg>`。
- **Git Bash 里 curl -d '中文' 会按 GBK 发出**——RPC 中文用例先 `node -e` 写 UTF-8 文件再 `--data-binary @file`（M2 复测：文件体通）。
- pnpm 10 拦 esbuild postinstall（警告可忽略）；pnpm 符号链接显示带 `@` 后缀，真实包路径在 node_modules/.pnpm/ 下直读。
- `python` 是商店 stub（exit 49）——codemod 用 node；powershell -Command 内联整条用单引号；`node -e` 不认 `/c/...` 路径，用 Windows 路径。
- 同一命令连续失败 ≤3 次换通道（crash-loop-rescue 纪律）。
- M2 新增：optimize→dispatch→scrub 曾闭环依赖（DRAFT_MAX_LENGTH 初始化 ReferenceError）→ 已抽 `src/limits.ts` 断环，新增共享常量一律进 limits.ts 不回头引 optimize.ts。
- M2 新增：client bundle 垫片 require 种子表若加包，同步 build-client.mjs SEED_MODULES + test seedRequire 两个映射（本里程碑未加浏览器依赖）。

## M2 验证命令实录（复跑即可复验）

```sh
cd D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher
pnpm lint && pnpm test          # 双 tsc 0 错；44/44 全绿（real-engine 6 例 + bench 17 例）
cd .. && dsh plugin --profile web add ./dsh-prompt-polisher   # 已装（link），改动后重跑
dsh --profile web --dump-config | grep -A2 "id: workflow-ptc"  # 根层行无 disabled=翻转生效；tool-workflow 仍 disabled:true
dsh --profile web --no-open --port 0 &                          # ~13s，日志 0 条 did not activate
#   日志应有：[dsh-prompt-polisher] host half applied ... + engine half applied; provider "spawn" dispatch published
# curl：先 GET /?token=<日志token> -c jar 拿 cookie（303），再带 -b jar POST /api/prompt-polisher/optimize
#   请求体必须含 sessionId（缺失→400）；未知 sessionId→200 {ok:false,error:UPSTREAM_FAILED}（正常，无真实会话时）
# 中文/特殊字符用例：node -e 写 UTF-8 文件 → --data-binary @file
# client bundle：外壳 HTML 取 combo URL（??...,dsh-prompt-polisher/client.js,...&rev=<rev>），GET 应 200 且含 prompt-polisher-bar
# 清理：netstat -ano | grep <port> 找 LISTENING PID → taskkill //PID <n> //F
```

## 必读材料

- 本项目 `plan/00-06`（重点 02 架构 / 03 详设 / 05 里程碑）+ `plan/HANDOFF-M2.md`（M2 决策上下文）+ `plan/06` M2 决策行。
- skill：`dsh-plugin-dev`（必读全文；§4 引擎契约 / §5 client 半 / §6 测试桩形态已在本包测试落形）。
- 可运行参照：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`（真实引擎测试桩形态、web 半 resolveAgent 先例、独立 API 可参考其 provider/config 组织）。
- 本包 M2 新文件速查：`src/limits.ts`（共享上限）、`src/templates.ts`、`src/scrub.ts`、`src/race.ts`、`src/dispatch.ts`（POLISH_SCRIPT/mapEngineResult/registry）、`src/engine-half.ts`、`client/store.ts`、`client/PolishBar.tsx`。
