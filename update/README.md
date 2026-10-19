# dsh-prompt-polisher · 迭代交接物

> 诊断日期：2026-10-19 ｜ 仓库：`yuluo554/dsh-prompt-polisher`
> 本地：`D:\ProgramData\zcode\dsh-2\dsh-prompt-polisher` ｜ 分支 `main`（与远端 0/0，工作树干净）
>
> 本目录是**交接物**：诊断结论、迭代路线、可直接复制的提示词。
> 结论全部来自实测（命令与返回值见 `00-诊断报告.md`）。
> **本次迭代不是抢救** —— 仓库当前健康（lint 0 错 / 71 通过 / 已发布 / CI 绿）。

## 文件索引

| 文件 | 用途 |
|---|---|
| [`00-诊断报告.md`](00-诊断报告.md) | 现状核对 + 9 条缺陷（D1–D9）+ **dsh 兼容性机制的源码实证** |
| [`01-迭代路线.md`](01-迭代路线.md) | 五批计划、每批门禁、范围边界、方法论提醒 |
| [`02-提示词-迭代对话.md`](02-提示词-迭代对话.md) | 新对话直接复制的完整提示词 |
| [`02-执行记录.md`](02-执行记录.md) | **0.2.0 执行方记录**：每批命令与返回值、影响面/回滚、做不到的项、待复验清单（状态：待复验） |

## 一句话结论

**插件本身没问题，是「声明的门槛」跟不上 dsh 的推进**：dsh 已到 `0.2.1-rc.2`（2026-10-17），
而本插件的 `peerDependencies` 把 5 个 `@deepseek-ai/dsh-*` **精确 pin 在 `0.2.0-rc.1`**。
按 dsh 源码的校验逻辑，这会让插件在 dsh 0.2.1 上**被直接拒绝加载**（抛错，不是警告）。

## 三条关键实测结论（本次诊断最重要的部分）

**1. `dsh.compatibility` 字段是装饰性的。**
在 `@deepseek-ai/` 全树 grep `dsh.compatibility` / `manifest.compatibility` → **0 命中**。
dsh 从不读它。README 里「要求 dsh `>=0.2.0-rc.1`」在 0.2.1 上得不到兑现。
**真正决定插件能否加载的是 `peerDependencies` 里 `@deepseek-ai/dsh-*` 的 range。**

**2. dsh 的校验是「不兼容就抛错拒绝加载」。**
`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility()`：
`if (issue !== void 0 && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue))`。
判据 = `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，
只校验名字为 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的 peer。

**3. 修法已实测：把精确 pin 换成 `^0.2.0-rc.1`。**

| 写法 | 0.2.0-rc.1 | 0.2.1-alpha.5 | 0.2.1-rc.2 | 0.2.1 | 0.3.0-rc.1 |
|---|---|---|---|---|---|
| `0.2.0-rc.1`（现状） | ✓ | ✗ | ✗ | ✗ | ✗ |
| `^0.2.0-rc.1`（推荐） | ✓ | ✓ | ✓ | ✓ | ✗ |
| `>=0.2.0-rc.1`（无上界） | ✓ | ✓ | ✓ | ✓ | ✓ |

> 注意：dsh 传了 `includePrerelease: true`，所以 `^0.2.0-rc.1` **能**覆盖 `0.2.1-rc.2`。
> 凭「预发布不被 range 覆盖」的直觉会得出错误结论 —— 这一点已用 semver 实测钉死。

## 需要用户拍板的一项

**`dsh-pipeline`（同作者的另一个插件）有完全相同的问题**（13 个 peer 全 `0.2.0-rc.1`，见 D9）。
本次要不要一并修？默认做法：**只登记、不顺手改**（它是另一个插件的会话），
除非你明确要求一起处理。

## 本次迭代的边界

- 不加新功能、不动 golden/fixtures、不改冻结契约（错误码 / 模板 id）
- 升级 dsh 前必须备份 `~/.dsh/profiles/web/`（可回滚）
- 本机 profile 里有**真实 API key**，不得写进提交/报告/截图
- npm 发包必须显式 `--registry=https://registry.npmjs.org`（本机 `.npmrc` 指向只读的 npmmirror）