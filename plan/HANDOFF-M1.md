# HANDOFF-M1 — dsh-prompt-polisher 骨架与点亮

> 交接快照，2026-09-29 规划对话收尾落盘。新对话凭本文件零上下文续接 M1；规划（M0）已全部完成。

## 当前进度（M0 已完成）

- plan/00-06 全部落盘；需求已由用户拍板（决策表见 plan/06）：触发**仅按钮**、模型**双通路**（M2 复用会话模型 / M3 独立 API）、风格**多风格可切换**、**发布上架**、UI 对标 WorkBuddy 但**图标自绘**。
- 项目名 `dsh-prompt-polisher`（用户已确认）。
- 可行性已用包源码核实（证据与结论见 plan/02）：
  - 按钮席位 `conversation.input.right`（list，提交动作前控件；备选 left/activity/overlay）；
  - 读草稿 `useInput().draft / draftRev`；写草稿 `inputActions.setDraft(text)`；
  - 证据文件：`@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/{slots,input,draft-editor,composer-submission}.d.ts`（本地副本在 `D:\ProgramData\zcode\dsh-1\dsh-pipeline\node_modules\@deepseek-ai\`，注意 pnpm 链接名后缀 `@` 是显示符号，真实路径走 `.pnpm` store）。

## M1 待办（DoD 见 plan/05 §M1）

1. 前置复核：实机 `dsh --version`。目标是 0.2.0-rc.1；若用户桌面端在 0.1.x 线，**停下**按 plan/02 降级选型（引擎包名/patch 行 id 不同）并向用户汇报后再动。
2. 按 plan/03 §3.1 落 npm 包骨架：package.json 三件套（`dsh.bundle.patch` / 默认导出 apply 的 host 半 / `dsh.client` + exports `./client`）、`cordis.patch.yml` insert 行、`scripts/build.mjs`（esbuild cjs bundle + ModuleLoader banner/footer + **require 白名单扫描门**）。
3. host 半：`apply(ctx)` 注册 RPC `POST /api/prompt-polisher/optimize`（`ctx.connection.fetch.register`，`requestBody:'buffered'`），M1 返回确定性 echo 伪优化；校验与错误码骨架（`EMPTY_DRAFT/TOO_LONG/UPSTREAM_FAILED/PARSE_FAILED/CANCELLED/BAD_STYLE`）就位。
4. client 半：按钮组件注册 `conversation.input.right`（session 作用域，standard kit 自带 `useInput`/`inputActions`），临时自绘图标；点击读 draft → POST → 成功 `setDraft` 回填；空草稿禁用。
5. 测试：RPC handler 单测（直调断言响应形）+ client bundle **Node 垫片**执行断言 ModuleLoader 接线与席位 id（本机 CDP 不可用）。
6. 验证门逐项过 plan/05 M1 清单；实机目检按钮位置与 WorkBuddy 近似度，不理想切备选席位（记录进 06 决策表）。
7. 收尾：回写 plan/00 状态表 + 05/06 勾选，落盘 `HANDOFF-M2.md` 后再结束对话。

## 既定口径（动了必须重跑对应验证并记入新 HANDOFF）

- 目标 dsh **0.2.0-rc.1**；兼容 floor 诚实门：floor 与 patch 行 id（workflow-ptc，M2 起）真实能力对齐。
- RPC path `/api/prompt-polisher/optimize`；错误码枚举如上；响应形 `{ok:true,optimized,style,modelVia}|{ok:false,error}`。
- 测试**全离线** node:test，模型 API 永不进 CI；golden 快照类资产（M4 起）字节冻结 + `.gitattributes` `* text=auto eol=lf`。
- `@deepseek-ai/*` 依赖**精确 pin**（不用 ^）。
- 触发仅按钮，**不做**输入自动优化/不做发送拦截/composer 接管。
- 图标自绘（笔尖+星火方向，不复用 WorkBuddy 魔法棒）。
- 草稿含引用 chips（`occurrences>0`）的禁用保护属 **M2** 范围，M1 不实现。

## 本机环境坑（dsh-pipeline 实测，详见 dsh-plugin-dev skill §8）

- CDP 浏览器自动化损坏（Chrome/Edge 均"exited early without DevToolsActivePort"）——勿再走该路径；GUI 验证 = 手工浏览器 + Node 垫片。
- Git Bash 下 `npm i -g` 段错误：改 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" i -g <pkg>`。
- 插件与宿主各解析一份 npm 包：跨接缝 instanceof 必失败，按 `err.code`/字段判别。
- `python` 是商店 stub（exit 49）——codemod 用 node；powershell -Command 内联整条用单引号（防 `$_` 被吃）；`node -e` 不认 `/c/...` 路径，用 Windows 路径。
- 同一命令连续失败 ≤3 次换通道（crash-loop-rescue 纪律）；profile 的 pnpm 符号链接可能悬空，读官方包类型用本项目自己 `pnpm add` 出的副本。

## 必读材料

- 本项目 `plan/00-06`（重点 02 架构/03 详设/05 里程碑）。
- skill：`dsh-plugin-dev`（必读全文）、`ai-tool-project-sprint`（阶段 0 纪律：HANDOFF 先落盘再结束对话）。
- 可运行参照：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`（构建脚本、测试三层、patch 形、workflow 引擎用法）；调研存档 `D:\ProgramData\zcode\dsh-1\dsh-plugin-research`（official-docs/0.2.0-rc.1）。

## 关键命令速查

```sh
# 装插件（本地路径）
dsh plugin --profile web add ./<包目录>
# 组合树核验（patch 生效 + 插件行在）
dsh --profile web --dump-config | grep prompt-polisher
# 后台启动冒烟（~13s；启动日志 0 条 "did not activate" = 激活通过）
dsh --profile web --no-open --port 0 &
# API 冒烟：先拿 token 换 cookie（303），再带 jar 调 RPC
curl -c jar "$BASE/?token=<启动日志里的token>"
# client bundle combo URL（rev 取外壳 HTML __DSH_BOOT__；手拼 404）
/plugins/??<id>/client.js&rev=<rev>
# 后台 dsh 清理
netstat -ano | findstr LISTENING   # 找 PID
taskkill //PID <n> //F
```
