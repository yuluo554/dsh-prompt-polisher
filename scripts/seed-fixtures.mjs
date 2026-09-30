/**
 * Fixture seeder (M4, plan/04 基准脚本): writes data/fixtures/** from the
 * CASES roster (scripts/bench-cases.mjs) plus the literal tables below —
 * deterministic, no timestamps, no randomness, so a re-run is byte-identical
 * (plan/04 生成器口径: 固定 seed 可复现; the seed is these literal tables).
 *
 * Re-run: node scripts/seed-fixtures.mjs   (idempotent, byte-stable)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './bench-cases.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'data', 'fixtures')
const DRAFTS = join(FIXTURES, 'drafts')
const RESPONSES = join(FIXTURES, 'model-responses')

/** Draft samples — one per case, the plan/04 spread (20 条内置草稿样例). */
const DRAFT_TEXTS = {
  '01-concise-zh-default-style': '那个啥 帮我想想周末团建去哪 五六个人 预算不多 最好别开太久的车 有没啥好玩的推荐下 谢啦',
  '02-concise-zh-fence': '写一封给供应商的催货邮件，语气坚定但礼貌，附上订单号与交期',
  '03-concise-en-tagged-fence': 'firm polite overdue delivery email with PO number and deadline',
  '04-concise-en-quoted': 'summarize the meeting notes into action items with owners',
  '05-concise-zh-corner-quoted': '把这份周报压缩成三句话，保留风险与下周计划',
  '06-concise-zh-fence-in-quote': '帮我写一分钟的面试自我介绍，突出两年后端经验',
  '07-concise-zh-special-chars': '优化这段：含反引号 `x` 与 ${danger} 与 "引号" 与换行\n第二行 🚀',
  '08-concise-zh-ref-markers': '把 /project-alpha 的会议纪要整理成要点，@张三 提出的风险项单独列一节',
  '09-structured-en': 'write a kickoff announcement for our new billing system rollout',
  '10-structured-zh-override': '帮我写个东西通知大家开会 时间还没定 地点也待定 反正就是周会 你看着办',
  '12-parse-failed-whitespace': '帮我写一份周会agenda',
  '13-parse-failed-empty-fence': '把这段总结成三句话',
  '14-upstream-child-null': '写一封道歉邮件给客户，因发货延迟',
  '15-cancelled': '起草产品发布的推特文案，突出性能提升',
  '16-upstream-run-error': '把会议决定整理成行动项，标注负责人',
  '17-empty-draft': '   ',
  '18-bad-style': '帮我把这段话整理清楚',
  '20-output-truncated': '把这份用户反馈归类成改进清单',
}

/** Canned model answers — the plausible rewrite the stub model returns. */
const RESPONSE_TEXTS = {
  '01-concise-zh-default-style': '规划一次周末团建：人数五到六人，预算有限，车程控制在一小时以内。请给出三个候选地点，每个附上人均预算、往返车程与主要活动，并说明推荐理由。',
  '02-concise-zh-fence': '```\n帮我写一封给供应商的催货邮件，语气坚定但礼貌，附上订单号与交期。\n```',
  '06-concise-zh-fence-in-quote': '"```\n用一分钟介绍两年后端经验：先说技术栈与核心项目，再讲一次线上故障的定位与复盘，最后说明为什么胜任这个岗位。\n```"',
  '03-concise-en-tagged-fence': 'Write a firm but polite overdue-delivery email: state the PO number, the original deadline, and request a firm new delivery date.',
  '04-concise-en-quoted': 'Summarize the meeting notes into a list of action items, each with a named owner and a due date.',
  '05-concise-zh-corner-quoted': '把这份周报压缩成三句话：第一句本周进展，第二句风险与对策，第三句下周计划。',
  '07-concise-zh-special-chars': '处理含特殊序列的文本：反引号 `x`、插值 ${danger}、双引号 "引号" 均按字面保留；保留换行结构与 emoji 🚀。',
  '08-concise-zh-ref-markers': '整理 /project-alpha 会议纪要要点：按议题分节摘录结论与待办；将 @张三 提出的风险项单独列为一节，每项附影响与建议。',
  '09-structured-en': '[Role] You are the internal comms lead for the platform team.\n[Task] Draft a kickoff announcement for the new billing system rollout.\n[Constraints] Keep it under 200 words; no internal codenames; address all staff.\n[Output format] Subject line + three short paragraphs: what changes, when, where to ask questions.',
  '10-structured-zh-override': '各位同事：本周例会定于本周五下午举行（具体时间待定），地点待定，主题为周会例行动项同步。请预留时间，具体安排将另行通知。',
  '11-concise-zh-near-cap': '已按区域拆分本季度销售数据并标注环比变化：整体增长平稳，华东区环比下降明显，需重点核查波动原因后输出分析结论。',
  '13-parse-failed-empty-fence': '```\n```',
  '20-output-truncated': '把这份用户反馈归类成改进清单：按可用性、性能、功能三类分节，每条附出现频次与建议优先级。',
}

mkdirSync(DRAFTS, { recursive: true })
mkdirSync(RESPONSES, { recursive: true })

for (const entry of CASES) {
  if (typeof entry.draft === 'string') {
    const text = DRAFT_TEXTS[entry.id]
    if (text === undefined) throw new Error(`seed table missing draft text for ${entry.id}`)
    writeFileSync(join(FIXTURES, entry.draft), text + '\n', 'utf8')
  }
  if (entry.model?.file !== undefined) {
    const text = RESPONSE_TEXTS[entry.id]
    if (text === undefined) throw new Error(`seed table missing response text for ${entry.id}`)
    writeFileSync(join(FIXTURES, entry.model.file), text + '\n', 'utf8')
  }
}

const manifest = {
  version: 1,
  generatedBy: 'scripts/seed-fixtures.mjs',
  note: 'Byte-frozen bench roster (plan/04). Golden snapshots in data/golden/ are the exact expected optimize() results; regenerate via scripts/update-golden.mjs after a recorded contract change only.',
  cases: CASES.map(({ id, draft, style, model, noDispatch, expect, templateOverride }) => ({
    id,
    draft,
    ...(style !== null ? { style } : {}),
    ...(noDispatch ? { noDispatch: true } : {}),
    ...(templateOverride !== undefined ? { templateOverride } : {}),
    model,
    expect,
  })),
}
writeFileSync(join(FIXTURES, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`[seed-fixtures] ${CASES.length} cases written under data/fixtures/`)
for (const entry of CASES) console.log(`  ${entry.id}`)
