# dsh-prompt-polisher — 项目总览

> DeepSeek Harness (dsh) 桌面端插件：在聊天输入框工具行加一枚"优化提示词"按钮，点击后把输入框里的草稿交给模型改写，优化结果回填输入框，用户随时可继续编辑、可一键还原。交互形态对标 WorkBuddy 内置的提示词优化（图标按钮位于模型选择器左侧），图标自绘、不复用。

## 状态表

| 里程碑 | 内容 | 状态 | 演示物 |
|---|---|---|---|
| M0 | 需求与计划：plan/00-06、可行性核实（席位/读写 API 包源码证据） | ✅ 完成 2026-09-29 | 本 plan/ 目录 |
| M1 | 骨架与点亮：npm 包三件套 + client 按钮进 composer 工具行 + host RPC(echo) 回填草稿 | ✅ 完成 2026-09-29，自动化验证门全绿（lint/test 11 通过 · dump-config 行在 · 启动 0 条 did not activate · curl RPC 通 · bundle 进启动图）；实机目检（按钮可见+点击回填）待用户 | 点按钮 → 草稿被改写（echo） |
| M2 | 真实优化 MVP：workflow 引擎 agent() 通路 + 默认风格 + loading/错误/还原 + 引用 chips 保护 | ✅ 完成（2026-09-29 代码+自动化门，2026-09-30 实机目检全过）：lint 双 tsc 0 错 · 测试 45/45 含真实 PTC 引擎 6 例 · 基准雏形 17 例 · 实机目检①②③④⑤全过（过程中修复 useInput selector 契约 bug 与状态条席位两连跳，终选 input.dock；详见 06 决策表与 HANDOFF-M3 目检实录） | 烂提示词 → 优化版回填 → 状态条还原（实机已验证） |
| M3 | 风格切换 + 自定义模板 + 独立 API 通路（OpenAI 兼容 base_url/key） | ✅ **全部完成含目检终验（2026-09-30）**：lint 双 tsc 0 错 · 测试 64/64 · 实机冒烟全过 · **目检：风格菜单 ✅ / 设置页自建表单 ✅（保存+清除 Key）/ 真实 DeepSeek key 直连双验证 ✅（测试连接 648ms + 优化实调 modelVia:'api'）**。过程中修复两个座位/服务解析问题（详见 06 决策表：bundle.config 席位抑制自动表单→面板自建；configForms 必须进 client inject） | 切风格出不同结果；配 key 直连优化（实机已验证） |
| M4 | 测试与打磨：基准定稿 20 用例 + golden 字节冻结 + EOL 守门 + locale 中英全量复核 + 图标定稿 + README/pack 预清点 + 脱敏预扫脚本化 + 诊断开关（可选件顺做） | ✅ 完成（2026-09-30）：lint 双 tsc 0 错 · 测试 71/71（bench 4 + locale 3 + 脱敏守门 1 + 诊断门 1）· 实机冒烟全过（0 条 did not activate / RPC 三路 / combo bundle 含 M4 标记）· `npm pack --dry-run` 81 文件 45.5KB 无 src/test/plan 泄漏 · **图标用户定稿 C（笔尖+单大星）已内联并实机验证服务 bundle** · 独立 API FR9 以 M3 双验证为终局（用户拍板） | 全绿测试 + 基准报告 + icon-candidates.html（档案） |
| M5 | 发布：npm 发包 + GitHub 开源 + awesome-dsh 渠道上架 | 未开始 | `dsh plugin add <npm 包名>` 可装 |

## 文档索引

- [01-需求解读.md](01-需求解读.md) — 痛点转译、FR 清单、边界与非目标
- [02-架构与技术选型.md](02-架构与技术选型.md) — 席位证据、双通路架构、关键契约
- [03-模块详设.md](03-模块详设.md) — host/client/RPC/模板/图标与交互细节
- [04-数据与测试计划.md](04-数据与测试计划.md) — 测试三层、基准脚本、样例集
- [05-里程碑.md](05-里程碑.md) — 每里程碑 DoD 与验证门
- [06-交付对标与决策记录.md](06-交付对标与决策记录.md) — 决策表、发布门 checklist

## 一句话架构

client 半在 `conversation.input.right` 席位注册图标按钮，读 `useInput().draft`、点按钮→RPC `/api/prompt-polisher/optimize`→host 半调模型（workflow 引擎 agent() 或用户配置的独立 API）→返回优化文本→`inputActions.setDraft()` 回填；原文保存在插件态供"还原"。
