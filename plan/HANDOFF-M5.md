# HANDOFF-M5 — dsh-prompt-polisher 发布上架（M5 交接）

> 交接快照，2026-09-30 M4 对话收尾落盘。M4 六项待办（基准定稿 / locale 复核 / 图标候选 / README+pack 预清点 / 脱敏预扫 / 可选诊断开关）全部完成，lint/test/bench ALL GREEN（71/71）+ 实机冒烟全过。新对话凭本文件零上下文续接 M5。

## M4 完成实录（2026-09-30）

### 基准定稿（发布证据，零 API 依赖）

- **形态**：`data/fixtures/manifest.json` 20 用例数据驱动；`scripts/bench-cases.mjs` = 固定 seed 用例表（`scripts/seed-fixtures.mjs` 播种，字节稳定可重跑）；`scripts/bench-runner.mjs` = 共享执行器（放 scripts/ 避开 node --test 发现器）；`scripts/update-golden.mjs` = golden 重生成。
- **管线**：校验 → 渲染（真 `renderTemplate`，与 createEngineDispatch 同一调用点）→ 桩模型（表驱动）→ 清洗（真 `mapEngineResult`，基准与实现不可漂移）。golden = `data/golden/<case>.json`（完整响应 JSON，2 空格缩进 + LF + 尾换行，字节冻结）。
- **三重门/用例**：manifest 可读期望（ok/error/style）→ golden 字节比对 → 草稿以数据身份进渲染 prompt（R5 bench 级代理）+ FR10 用例钉覆盖骨架前缀。
- **覆盖面**（=plan/04 分布）：中/英、口语化（01）、歧义（10）、近上限 7050 字（11）/超上限 8001 字（19）、特殊字符反引号+`${}`+引号+换行+emoji（07）、`/name`+`@` 记号原样（08）、空（17）/输出截断 8000（20）、错误码全样本（12/13 PARSE_FAILED、14/16 UPSTREAM_FAILED、15 CANCELLED、18 BAD_STYLE）、默认风格缺省（01 不带 style）、FR10 覆盖走 router 形通路（10）。
- **EOL 守门**：`test/bench.test.js` 遍历 data/ 逐字节扫 CR 即失败；`.gitattributes` `* text=auto eol=lf` 已在（M2 配）。台账 `data/README.md`（来源：全部 2026-09-30 自编，无真实数据；人工评审口径：质量不自动评分）。
- **纪律**：golden 冻结——改错误码语义/清洗器/模板输出/RPC 响应形后必须 update-golden + HANDOFF+06 记录；对不上任何已记录变更的 diff = 回归，修代码不改快照。

### locale 复核（FR11 闭环）

- 官方 common 词表直读（`@deepseek-ai/dsh-client-locale/lib/types/locales/*.d.ts` + 编译产物词值）。对齐四处 zh 进行时态（优化中→**正在优化**、测试中→**正在测试**、保存中→**正在保存**、配置加载中→**正在加载配置**，官方惯式 `正在提交…`）；api.failedHint UI 路径对齐「」（官方 `「设置 → 内置插件」` 形）；form.unavailable「非本机」→「非环回」；en saveFailed 破折号→分号。键集 36 不变（后因诊断开关 +2=38）。
- **FR11 测试**（`test/locale.test.js`）：zh/en 键集一致、插值占位符配对、client 源码 `t('...')` 引用全双语可达（动态前缀 `style.*` 钉住）；解析器从 client/i18n.ts 源文抽取（client 是单 esbuild bundle，源码即真相）。

### 图标候选（开放项 → 用户挑选）

- `plan/icon-candidates.html`：三案 16/24/48px + 明暗底。A=笔尖+双星火（M2 目检方向，**代码现状默认**）、B=双星火焕亮（无笔）、C=笔尖+单大星。**回复 A/B/C 定稿**；挑选后把所选 SVG 内联进 `client/PolishButton.tsx` 的 PolishIcon 并重跑 lint/test + 按钮目检一次。

### 诊断开关（M2 预告件收口）

- Config 加 `clientDiagnostics`（`z.boolean().default(true).volatile()`，加法扩展不动冻结字段名）；**宿主侧门**：`handleDebugRequest(request, resolveDiagnostics?)` per-report 现读 config（M3 坑：不得缓存闭包），门关=不镜像日志但恒 200 `{ok:true}`（fire-and-forget 客户端行为不变）；设置面板加复选框（apiEnabled 同款 draft/mutate 模式）+ i18n 2 键 ×2。
- 测试：rpc.test.js 钉门关不打日志/实时翻转生效；垫片词典大小断言 36→38。

### 脱敏预扫（阶段 7 四步脚本化起步）

- `scripts/desensitize-audit.mjs`：git 感知（repo 内 `git ls-files`，预 init 树遍历排除 node_modules/.git/lib/.clean-store）；step1 .gitignore 覆盖（新建 `.gitignore`：lib//node_modules//*.log/.env/.env.*/**/_private//.clean-store/）+ 违禁文件名（.env/*.key/secret/token）；step2 内容级 7 模式——**email 正则 TLD 末段限字母**（否则 pnpm-lock 的 `name@version` 形态 570 误报，实测），apiKey 阈值 `sk-`+20 位（测试夹具 `sk-test-1234567890` 天然豁免），手机/身份证带 alnum lookaround 防哈希误报；step3 二进制 sha256 白名单（现 0 二进制）；step4 历史重写 = push 时点专属（脚本留提示，M5 执行）。ALLOWLIST 空数组起步，条目必须带 reason。
- **渗透自检通过**：植入 `sk-abcdef…` → 正确 FAIL（消息含 `src\_canary.tmp.js:1`）。守门进套件（`test/desensitize.test.js` spawn 断言 `DESENSITIZE_AUDIT_OK` + allowlist 输出为空）。

### README / 发包装形

- `README.md` 新建（特性/安装/配置表/开发三守门/目录/限制/MIT；plan 深链用 GitHub 绝对链接，**`<owner>` 占位待 M5 建仓回填**）；`LICENSE` MIT 新建。
- `files` = lib + cordis.patch.yml + **data**（fixtures+golden 随包供参考格式）。**本插件无独立 locale/ 目录**（i18n 编译进 client bundle）——发布门"locale/"措辞按实况 = 无此项。
- `npm pack --dry-run`：**81 文件 45.5KB**，仅 LICENSE/README/patch/lib/data，无 src/test/scripts/plan 泄漏。

### 验证门（全部通过）

- `pnpm lint` 双 tsc 0 错 + `pnpm test` **71/71**（M3 64 → bench 重写 2→4、locale +3、诊断门 +1、脱敏守门 +1）。
- 实机冒烟（0.2.0-rc.1）：重装 link（already up to date）→ dump-config 根层 `workflow-ptc disabled:false` + 插件行在（用户 M3 的 apiEnabled/key 仍在 profile）→ 后台启动 **0 条 did not activate** + host/engine 双半日志 → cookie RPC：缺 sessionId 400 / BAD_STYLE 200 / **test-api 真调端点回 401 错误映射**（key 已失效，见下）→ combo bundle 491KB 含 `form.clientDiagnostics`×6 / `plugins.bundle.config` / `prompt-polisher-bar` 全部标记 → netstat+taskkill 清理。

### M4 冒烟发现的用户侧问题（M5 前需用户处理）

- **M3 所配 DeepSeek key 已被端点判无效**（test-api 回 `HTTP 401: api key ****e40d is invalid`；M3 目检时同 key 曾 648ms 成功）。判定 = key 被撤销/轮换，**非代码回归**（错误映射、端点侧掩码、config→schema→apply→tester 链路全正常）。用户需在设置页重填有效 key 才能用独立 API 通路。本文档与一切留档**只记录尾号 e40d，不复述字面值**。

## M5 待办（DoD 见 plan/05 §M5 与 plan/06 发布门 checklist）

1. ~~图标定稿~~ **已完成（2026-09-30 用户定稿 C=笔尖+单大星）**：PolishIcon 已内联替换（保留 seed transform 原样），lint 0 错 + 71/71 + 服务中 combo bundle 实测新路径在/旧路径 0；按钮最终目检随 M5 干净环境复验。
2. ~~用户重填有效 API key~~ **用户拍板（2026-09-30）：FR9 以 M3 双验证为终局**，M4 冒烟的 401 观察记录在案即可，不设阻塞项（独立 API 通路代码面 M4 实测正常）。
3. **GitHub 建仓**：仓库内容 = 本包目录 + `plan/`（含 00-06、HANDOFF-M1..M5）；`.gitattributes`/`.gitignore` 已备；README `<owner>` 占位回填真实 owner。
4. **脱敏四步收尾**：在 repo 根重跑 `node scripts/desensitize-audit.mjs <repo-root>`（注意 profile patch 里的真实 key 在 `C:\Users\<user>\.dsh\` 下，**绝不入仓**）；首次 push 后按 skill 阶段 7 step4 判断是否需要历史重写（新仓库通常无需）。
5. **干净环境验证**（发布门核心）：开发机全新 clone（Windows，autocrlf=true 场景——`.gitattributes` 已拦，EOL 守门测试是 tripwire）+ 隔离 store `pnpm install --store-dir .clean-store`（已 gitignore）+ 逐条照 README 跑 `pnpm lint && pnpm test`。注意 pnpm 10 "Ignored build scripts: esbuild" 警告**不是故障**。
6. **npm 发包**（链首）：`npm whoami` 未登录即早停移交用户；`npm pack --dry-run` 终清点（81 文件口径）；发包成功后才动下游。
7. **渠道**（时序纪律：链首阻塞则下游对外宣称一律暂停）：GitHub topic `dsh-plugin` → awesome-dsh PR。
8. tag/release/topics 经用户对话确认后执行；发布后 GitHub 全新 clone 复核全量测试 + 历史三扫。
9. compatibility floor 终审：`>=0.2.0-rc.1` 与 patch 行 id（workflow-ptc）+ schemastery 依赖实况核对（M4 未动引擎面，预计无变化，发前再看一眼）。

## 既定口径（动了必须重跑对应验证并记入新 HANDOFF）

- 全部 M3 口径继续有效（RPC 契约/错误码封闭集/模板 id/config 字段名/client require 白名单/FR5-6/竞态/localStorage 键）。M4 新增：
- **golden 冻结**：`data/golden/*.json` 字节冻结；重生成仅限已记录契约变更（update-golden.mjs）；EOL 守门 = data/ 全目录 CR 即失败。
- **config 字段名追加**：`clientDiagnostics`（默认 true）；全部 volatile、per-operation 现读（禁缓存闭包）。
- **debug 路由语义**：响应恒 200 `{ok:true}`，`clientDiagnostics=false` 只抑制日志镜像。
- **bench 形态**：20 用例 manifest 驱动；桩模型+真 mapEngineResult；fixtures 由 seed-fixtures.mjs 生成（固定 seed = 字面量表）。
- **发包装形**：files = lib + cordis.patch.yml + data；README/LICENSE 随包；无独立 locale/ 目录。
- **脱敏纪律**：ALLOWLIST 条目必须带 reason；守门测试随 `pnpm test` 跑；留档不复述敏感字面值（如只写 key 尾号）。
- 测试 71/71 为 M4 基线数；locale 词典 38 键 ×2。

## 本机环境坑（沿用 M2/M3 全部 + M4 增补）

- M2/M3 全部坑仍有效（CDP 坏 / npm -g 段错误通道 / pnpm 悬空链接 / python stub / curl 中文 GBK / 同命令 ≤3 败换通道 / powershell 单引号 / node -e 用 Windows 路径 / 全局 grep 实为 ugrep——正则元字符转义或 grep -F）。
- **M4 新增：大文件 Write 工具可能连续中断**——同一 Write 被打断 2 次即换通道（拆两个较小文件写入，如 bench-cases.mjs + seed-fixtures.mjs 的拆分）。
- **M4 新增：`node -e` 内联正则经 bash 转义必炸**（`\\` 层层剥壳）——调试脚本一律写成临时 .mjs 文件执行，用完即删。
- **M4 新增：node:assert/strict 无 `dontMatch`**——用 `assert.ok(!re.test(s))`。
- **M4 新增：启动日志的 token 含连字符**（`...9jE-qJ2k` 形）——grep 提取时字符类必须含 `[-A-Za-z0-9]`，漏了 `-` 会拿到截断 token 然后 401（M4 二次冒烟实测踩过）。
- **M4 新增：profile dump-config 会显示用户真实 key**（`C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml` 持久化）——终端输出/留档/测试断言一律不复制该值。

## M5 验证命令实录（复跑即可复验）

```sh
cd D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher
pnpm lint && pnpm test          # 双 tsc 0 错；71/71（含 bench 20 用例 golden 比对 + EOL 门 + locale 门 + 脱敏门）
node scripts/desensitize-audit.mjs   # 单跑脱敏审计 → DESSENSITIZE_AUDIT_OK
node scripts/update-golden.mjs       # （仅契约变更后）重生成 golden → git diff 应为空
cd .. && dsh plugin --profile web add ./dsh-prompt-polisher   # link 已在
dsh --profile web --dump-config | grep -A5 "^- id: workflow-ptc"  # 根层 disabled:false
dsh --profile web --no-open --port 0 &    # ~18s；日志 0 条 did not activate
#   日志：[dsh-prompt-polisher] host half applied ... + engine half applied ... + dsh web: http://127.0.0.1:<port>/?token=<token>
# curl：GET /?token=<token> -c jar（303）→ 带 -b jar：
#   POST /api/prompt-polisher/optimize 缺 sessionId→400；BAD_STYLE→200 {"ok":false,"error":"BAD_STYLE"}
#   POST /api/prompt-polisher/test-api → 200（key 有效则 ok:true+latencyMs；无效则 401 映射，端点侧掩码）
# combo bundle：外壳 HTML 第三个 /plugins/?? URL（含 dsh-prompt-polisher/client.js，&amp; 转义还原）→ GET ~491KB
#   含 form.clientDiagnostics / clientDiagnosticsHint / plugins.bundle.config / prompt-polisher-bar 标记
# 清理：netstat -ano | grep <port> 找 LISTENING PID → taskkill //PID <n> //F
npm pack --dry-run              # 81 文件 45.5KB；无 src/test/scripts/plan 泄漏
```

## 必读材料

- 本项目 `plan/00-06`（重点 04 基准口径 / 05 §M5 / 06 发布门 checklist 与 M4 决策行）+ `plan/HANDOFF-M3.md`（M3 决策上下文）。
- skill：`dsh-plugin-dev`（必读全文；M5 重点 §10 发布与上架 + §8 环境坑）；`ai-tool-project-sprint` 阶段 7（脱敏四步/干净环境/EOL 门/发布链时序纪律）。
- M4 新文件速查：`scripts/bench-cases.mjs`（用例表）、`scripts/seed-fixtures.mjs`（播种）、`scripts/bench-runner.mjs`（执行器）、`scripts/update-golden.mjs`（golden 重生成）、`scripts/desensitize-audit.mjs`（脱敏）、`test/bench.test.js`（重写）、`test/locale.test.js`、`test/desensitize.test.js`、`data/**`（fixtures+golden+台账）、`README.md`、`LICENSE`、`.gitignore`、`plan/icon-candidates.html`；改动文件：`src/config.ts`（+clientDiagnostics）、`src/web.ts`（debug 门）、`src/index.ts`（thunk 接线）、`client/ApiTestPanel.tsx`（诊断复选框）、`client/i18n.ts`（38 键+措辞对齐）、`package.json`（files+data）、`test/rpc.test.js`（诊断门测试）、`test/client-bundle.test.js`（词典 38+复选框断言）。
