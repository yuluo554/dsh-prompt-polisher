# HANDOFF-M4 — dsh-prompt-polisher 打磨与发布准备（M4 交接）

> **已过时仅作历史**（2026-09-30 M4 对话收尾：M4 全部完成，续接请读 `HANDOFF-M5.md`）。

> 交接快照，2026-09-30 M3 对话收尾落盘（命名遵循惯例：HANDOFF-M<n> 由 M<n-1> 收尾对话写入、指向 M<n>）。M3 四项待办（FR8 风格菜单 / FR9 独立 API / FR10 自定义模板最简形 / 配套测试）全部完成，实机冒烟全过。新对话凭本文件零上下文续接 M4。

## M3 完成实录（2026-09-30）

### 配置机制定形（M3 调研结论，全部后续工作的地基）

- **bundle 行 config + schemastery `Config` schema** 是官方配置通路：模块导出 `Config`（`@deepseek-ai/schemastery` 3.18.4，z.object 链式），cordis-plugin-loader 用 `resolveConfig(runtime, config)` 校验行 config 并把 **schemastery 实例**传给 `apply(ctx, config)`；字段 `.get()` 每次现读（`Volatile` 协议，cosmokit 定义 cordis 转出）。
- **volatile 字段免重启生效**：loader `equalExceptVolatile` 判定只有 volatile 字段变更时不重启 fiber、原位更新 schema 实例 → 每次优化现读 config 即拿到新值（官方 web-search-deepseek 的 resolveOptions thunk 模式）。
- **声明 Config 自动获得 Web 设置页**（dsh-settings autoGenerate 默认 true）；`role('secret')` 字段跨 wire 剥除只写不读（dsh-settings redact）；`role('credential-ref')` 渲染凭据引用控件。
- **key 解析链**：literal `apiKey`（secret）→ `apiKeyEnv`（默认 DEEPSEEK_API_KEY）经 credentials 服务（`ctx.get('credentials')` 可选，`credentialRef()` 构造）→ process.env 兜底。
- **第三方插件设置面板席位**：`plugins.bundle.config`（keyed by 包名，root scope，owner = PluginConfigViewProps{view:'summary'|'page'}）——连通性测试按钮放这里；keyed 注册 `ctx.slots.register({name, key, inject}, component)`。
- 调研证据：Explore agent 报告（2026-09-30），关键文件 `cordis-plugin-loader/lib/index.js:461` / `dsh-web-search-deepseek/lib/index.js`（Config 形态全样本）/ `dsh-settings/lib/types/index.d.ts` / `dsh-client-ui-plugin-manager/lib/types/client/slot-contract.d.ts`。

### 三项功能落形

1. **FR9 独立 API**（`src/api-dispatch.ts` + `src/config.ts` + `src/router.ts`）：
   - Config：`apiEnabled`(默认 false) / `apiBaseURL`(默认 `https://api.deepseek.com`) / `apiKey`(secret) / `apiKeyEnv`(credential-ref) / `apiModel`(默认 deepseek-chat)，全 volatile。
   - 请求：Node fetch POST `{base}/chat/completions`（`completionsEndpoint` 归一化：容忍裸域/`/v1`/尾斜杠/已带路径），Bearer 认证，`{model, stream:false, messages:[{role:'user',content:渲染模板}]}`。
   - 映射：transport/非 2xx/非 JSON → `UPSTREAM_FAILED(+modelVia:'api')`；空/缺 content → `PARSE_FAILED(+modelVia)`；abort → `CANCELLED`（无标记）；成功走真清洗器 → `modelVia:'api'`。错误类 `UpstreamError/ParseError/AbortError` + `mapApiError` 单点映射。
   - Router（`src/router.ts`）：每 job 读快照 → `isApiCandidate`（enabled ∧ model 非空 ∧ URL 可解析 ∧ 有 key 线索）→ API leg，否则引擎 leg（缺席仍 UPSTREAM_FAILED）；**API 失败不静默降级**。FR10 覆盖由 router 挂到 job 上，两路共用。
   - RPC：`POST /api/prompt-polisher/test-api`（永远 200 业务级；宿主侧发一条 `max_tokens:1` 的 "ping"）；无 key/未配置 → 引导文案。
   - registry 拆分：`setEngineDispatch`（引擎半，M2 原样）+ `setActiveDispatch`（RPC 消费的 router）+ `setApiTester`；引擎 slot 单独发布**不再**直接喂 RPC（测试已钉住此语义）。
2. **FR8 风格菜单**（`client/style-pref.ts` + `PolishButton.tsx`）：按钮旁 chevron（同席位 span 相对定位 + fixed 透明背板 click-away）；列 `style.*` locale 名 + 默认勾选（menuitemradio/aria-checked）；选中 = localStorage（键 `dsh-prompt-polisher.style`，`readPreferredStyle`/`writePreferredStyle` 纯函数守卫 try/catch 与无效值）+ 按钮可用时**立即以该风格发起**；不绕过禁用守卫。bundle 导出 style-pref 助手供垫片（polishStore 先例）。
3. **FR10 自定义模板**（`src/templates.ts` + `config.ts`）：`templateConcise`/`templateStructured` 整段覆盖，必须含 `{draft}`；无效覆盖丢弃回退内置 + console.warn 一次（`sanitizeOverride`）；覆盖同时替代 zh/en（用户自管语言）；`replaceAll(TOKEN, () => draft)` 函数式替换（`$&` 字面）；router 把覆盖挂 job，引擎/API 两路同享。
4. **client 新席位**：`plugins.bundle.config` key `dsh-prompt-polisher`（`client/ApiTestPanel.tsx`，view!=='page' 渲 null）；i18n 12→20 键（menu/api hint/panel/test）；FR9 失败提示 = 错误臂 `modelVia==='api'` 时 tooltip 追加 `api.failedHint`。

### 验证门（全部通过）

- `pnpm lint`（双 tsc 0 错）+ `pnpm test` **64/64**（M2 44 → 新增 20：api-dispatch+router 13、rpc 3、client 席位/style-pref/面板+表单 8；目检修复后 +2）。bench 并入 node --test 照跑。
- 实机冒烟（0.2.0-rc.1）：重装 link → dump-config 插件行在 + workflow-ptc 根层 `disabled:false`（tool-workflow 保持禁用）→ 后台启动 **0 条 did not activate** + host/engine 双半日志 → cookie RPC 五路：缺 sessionId 400 / BAD_STYLE 200 / 未知会话 200 UPSTREAM_FAILED（引擎 leg）/ test-api 默认 "not enabled" 引导 / **config 流端到端**（profile patch 临时覆盖 `apiEnabled:true` + 假 env key → tester 真调 DeepSeek 官方端点回 401 且错误映射、optimize 走 api leg 回 `UPSTREAM_FAILED+modelVia:'api'`）→ combo bundle 479KB 含三席位全部 M3 标记。**profile patch 测后已还原字节一致**（备份 /tmp/dsh-patch-backup.yml 流程）。

## M3 遗留闭环实录（2026-09-30 目检终验，全部通过）

- **①风格菜单 ✅**：展开/选择/勾选记忆/选中即以该风格发起，用户浏览器确认。
- **②设置页 ✅（两轮修复后）**：自建表单全字段渲染（启用开关/BaseURL/模型/Key 密码框只写留空保持/KeyEnv/两模板 textarea），保存显示"已保存"，清除 Key 可用。
- **③真实 key 直连 ✅（双验证）**：测试连接"连接正常（deepseek-chat，648ms）"；RPC 优化通路实调一次小请求回 `{ok:true, optimized:"Write a professional email…", modelVia:"api"}`——FR9 DoD「配 key 实机走通直连」完整闭环。

### 目检揪出并修复的两个问题（M2 useInput 教训两度验证：**包源码直读才是证据，垫片绿 ≠ 官方契约绿**）

1. **plugins.bundle.config 席位抑制自动表单**：注册自定义面板后，宿主 autoGenerate（"无自定义页才生成"）让位 → schema 表单消失；且官方 bundle 页不向该席位传 form（只有 row/item 页有，官方 plugin-manager bundle renderSlot 渲染点证实）。修复 = 面板自建字段，经 `ctx.configForms.get('dsh-prompt-polisher')`（=settings ns=插件行 id）拿 ConfigForm 读写面，mutate 原子提交（revision fence），Key 密码框只写（留空=保持已存值，官方同款约定）。
2. **configForms 必须进 client inject**：兄弟 fiber 的 cordis 服务裸属性访问 = undefined（面板"配置加载中…"卡死根因）；`inject: ['slots', 'locale', 'configForms']` 后解析成功——官方 plugin-manager inject 列表含 `"configForms"` 同款。注意：这让整个 client 半（含 composer 席位）依赖 settings 服务在位；web profile 下 settings 恒在 boot group 1，可接受，HANDOFF 存档此耦合。

## M4 用户可选项（非阻塞）

- 输入框直连优化的**主观体验**（速度/质量对比会话模型）由用户日常使用自评；通路本身已实机验证。
- API 失败 tooltip 的"可切回会话模型"提示文案尚未人工触发过（需要故意配错 key 触发一次；自动化已覆盖语义）。


## M4 待办（DoD 见 plan/05 §M4）

1. 基准脚本定稿：bench 现 17 例雏形（桩模型回原始文本走真 mapEngineResult）→ 20 用例 + EOL 守门；golden 快照基建（字节冻结，M3 只做了"结果可辨"钉住）。
2. locale 中英全量复核（现 20 键 ×2 已双语，M4 对照官方 common 词表再核一遍措辞）。
3. 图标定稿：2~3 候选 SVG 交用户挑选（现笔尖+双星火自绘方向已获 M2 目检接受）。
4. README/plan 回写 + `npm pack --dry-run` 预清点（files 已含 lib+patch；**schemastery 已进 dependencies**——发包装机时它会被装进 profile，验证 `dsh plugin add` 通路时留意 pnpm 10 拦 postinstall 的既有行为）。
5. 脱敏预扫（阶段 7 四步脚本化起步）。
6. （可选）诊断回路加开关（M2 预告）；client bundle 诊断上报目前无条件开。

## 既定口径（动了必须重跑对应验证并记入新 HANDOFF）

- 目标 dsh 0.2.0-rc.1；compatibility floor `>=0.2.0-rc.1`；patch 翻转 workflow-ptc 已落（勿回退）。**新增依赖：`@deepseek-ai/schemastery` 3.18.4（dependencies，官方先例同位）；`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-client-ui-plugin-manager` 0.2.0-rc.1（peer+dev，类型与 credentialRef）**。
- RPC `POST /api/prompt-polisher/optimize`：请求 `{draft,style,sessionId,source?}`；响应 `{ok:true,optimized,style,modelVia:'session'|'api'}|{ok:false,error,modelVia?}`（错误臂 modelVia 是 M3 加法扩展）；错误码封闭集不变；业务错误 HTTP 200、传输错误 400。另有 debug 与 **test-api** 两条路由（test-api 永远 200）。
- 缺 style → concise；显式未知 → BAD_STYLE；`DRAFT_MAX_LENGTH=OUTPUT_MAX_LENGTH=8000`（src/limits.ts 单一归宿）。
- config schema 字段名冻结：`apiEnabled/apiBaseURL/apiKey/apiKeyEnv/apiModel/templateConcise/templateStructured`（设置页写入按名落盘，改名 = 用户配置丢失）。
- POLISH_SCRIPT 固定 + args 注入（R5）；清洗器（R4）与 `mapEngineResult` 单点映射（动必重跑 bench）；`renderTemplate(style, draft, overrides?)` 三参签名。
- client bundle require 白名单不变：react、react/jsx-runtime（8 require sites / 2 externals——M3 未加浏览器依赖）；服务 inject `['slots', 'locale', 'configForms']`（目检修复轮加入——兄弟 fiber 服务必须 inject）+ settings 包类型挂 ambient.d.ts；三处同步纪律（external+inject / SEED_MODULES / ambient.d.ts）不变。
- FR5 阈值 8；FR6 occurrences>0 禁用；竞态=rev 变且文变；还原存客户端 store；会话切换清记录；触发仅按钮。
- localStorage 键 `dsh-prompt-polisher.style`；菜单选择语义 = 记忆 + 可用时立即发起。
- 测试全离线 node:test；`@deepseek-ai/*` 精确 pin（schemastery 跟官方先例精确 pin 3.18.4）；golden 快照（M4 起）字节冻结 + `.gitattributes` 已配。

## 本机环境坑（M3 增补）

- 沿用 M2 全部坑（CDP 坏 / npm -g 段错误通道 / pnpm 悬空链接 / python stub / curl 中文 GBK / 同命令 ≤3 败换通道 / powershell 单引号 / node -e 用 Windows 路径）。
- **M3 新增：全局 grep 实为 ugrep**（`grep -o '??...'` 的 `?` 语义不同导致 combo URL 抓取失败）——正则元字符一律转义或用 `grep -F`。
- **M3 新增：volatile 免重启语义的双刃**——settings 改动即时生效的前提是 dispatch 每次现读 config（`.get()`），任何把 config 值缓存进闭包的新代码都会破坏它；新字段一律走 `snapshotConfig()` 快照模式。
- **M3 新增：profile patch 实机验证流程**——备份 `~/.dsh/profiles/web/cordis.patch.yml` → 追加行级覆盖（覆盖行只写 id+config，patch 同 id 行替换**整个 config**）→ 重启 → 验证 → 还原 diff 确认。这是无浏览器环境下验证 config 流的唯一通路。
- **M3 新增：第三方插件的上下文里 dsh-pipeline 也在 profile 中**（dump-config 头注释可见），它翻转的 patch 行与本插件互不冲突（行 id 不同），但排障时注意日志里两家插件并存。

## M3 验证命令实录（复跑即可复验）

```sh
cd D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher
pnpm lint && pnpm test          # 双 tsc 0 错；64/64
cd .. && dsh plugin --profile web add ./dsh-prompt-polisher   # 已装（link），改动后重跑
dsh --profile web --dump-config | grep -A2 "id: workflow-ptc"  # 根层 disabled:false；tool-workflow disabled:true
dsh --profile web --no-open --port 0 &                          # ~16s，日志 0 条 did not activate
#   日志应有：[dsh-prompt-polisher] host half applied ... + engine half applied
# curl：GET /?token=<日志token> -c jar（303→cookie）；带 -b jar：
#   POST /api/prompt-polisher/optimize   缺 sessionId→400；BAD_STYLE→200；未知会话→200 UPSTREAM_FAILED
#   POST /api/prompt-polisher/test-api   默认→200 {"ok":false,"error":"independent API is not enabled..."}
# config 流端到端（可选）：备份 profile patch → 追加 `- id: dsh-prompt-polisher / config: {apiEnabled: true}` →
#   DEEPSEEK_API_KEY=sk-fake 重启 → test-api 应回端点 401 错误映射；optimize 未知会话应回 UPSTREAM_FAILED+modelVia:'api' → 还原 patch
# client bundle：外壳 HTML 第二个 combo URL（含 dsh-prompt-polisher/client.js，注意 &amp; 转义）→ GET 479KB，
#   含 prompt-polisher-bar / menu.trigger / panel.title / test-api / plugins.bundle.config 标记
# 清理：netstat -ano | grep <port> 找 LISTENING PID → taskkill //PID <n> //F
```

## 必读材料

- 本项目 `plan/00-06`（重点 02 架构 / 03 详设 / 05 里程碑）+ `plan/HANDOFF-M2.md`（M2 决策上下文）+ `plan/06` M3 决策行（M3 全部决策已回写）。
- skill：`dsh-plugin-dev`（必读全文；本里程碑新增实证：§5 client 半的 keyed 席位注册、§3 patch 词汇表的"覆盖行替换整个 config"语义）。
- 官方 config 形态权威样本：全局 dsh 包 `node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js`（Config/apply/credentials 全套）。
- 可运行参照：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`（真实引擎测试桩形态）。
- 本包 M3 新文件速查：`src/config.ts`（Config schema+快照）、`src/api-dispatch.ts`（API leg+tester）、`src/router.ts`（分派）、`client/style-pref.ts`、`client/ApiTestPanel.tsx`；改动文件：`src/templates.ts`（overrides）、`src/dispatch.ts`（registry 拆分）、`src/optimize.ts`（modelVia 扩展）、`src/web.ts`（test-api 路由）、`src/index.ts`（apply(ctx,config) 接线）、`client/PolishButton.tsx`（菜单）、`client/index.tsx`（第三席位）、`client/i18n.ts`（20 键）、`client/ambient.d.ts`（plugin-manager 挂载）、`package.json`（三依赖）。
