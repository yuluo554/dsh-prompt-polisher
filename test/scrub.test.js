/**
 * Scrubber + template tests (M2, R4/R5): the output scrubber is the last
 * line of defense between the model and the composer — fence stripping,
 * paired-quote stripping, the length cap, and the empty-output rejection
 * (PARSE_FAILED, never backfilled). Template tests pin the rendered prompt
 * shape: draft embedded as data, output contract present, zh/en selection.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scrubModelOutput, OUTPUT_MAX_LENGTH } from '../lib/scrub.js'
import { renderTemplate } from '../lib/templates.js'
import { POLISH_SCRIPT, POLISH_META, ENGINE_PROVIDER } from '../lib/dispatch.js'

test('scrubber: plain text passes through untouched', () => {
  assert.deepEqual(scrubModelOutput('帮我写一封邮件'), { ok: true, text: '帮我写一封邮件' })
  assert.deepEqual(scrubModelOutput('  spaced out  '), { ok: true, text: 'spaced out' })
})

test('scrubber: strips a whole-text code fence, with or without language tag', () => {
  assert.deepEqual(scrubModelOutput('```\n优化后的提示词\n```'), { ok: true, text: '优化后的提示词' })
  assert.deepEqual(scrubModelOutput('```text\npolished prompt\n```'), { ok: true, text: 'polished prompt' })
  assert.deepEqual(scrubModelOutput('```\n\nmulti\nline\n\n```'), { ok: true, text: 'multi\nline' })
})

test('scrubber: strips quotes wrapped around the text AND around a fence', () => {
  assert.deepEqual(scrubModelOutput('"quoted prompt"'), { ok: true, text: 'quoted prompt' })
  assert.deepEqual(scrubModelOutput("'single quoted'"), { ok: true, text: 'single quoted' })
  assert.deepEqual(scrubModelOutput('“中文引号”'), { ok: true, text: '中文引号' })
  assert.deepEqual(scrubModelOutput('「角引号」'), { ok: true, text: '角引号' })
  assert.deepEqual(scrubModelOutput('"```\nfenced\n```"'), { ok: true, text: 'fenced' })
  // Unpaired quotes are content and must survive.
  assert.deepEqual(scrubModelOutput("it's fine"), { ok: true, text: "it's fine" })
  assert.deepEqual(scrubModelOutput('说"你好"再见'), { ok: true, text: '说"你好"再见' })
})

test('scrubber: nested fence-in-quote-in-fence is fully unwrapped (bounded passes)', () => {
  assert.deepEqual(scrubModelOutput('```\n"inner prompt"\n```'), { ok: true, text: 'inner prompt' })
})

test('scrubber: code fences INSIDE a rewrite survive (not whole-text)', () => {
  const raw = '第一步用 ```python\nprint(1)\n``` 测试'
  assert.deepEqual(scrubModelOutput(raw), { ok: true, text: raw })
})

test('scrubber: empty output is rejected (PARSE_FAILED, never backfilled)', () => {
  assert.deepEqual(scrubModelOutput(''), { ok: false })
  assert.deepEqual(scrubModelOutput('   \n  '), { ok: false })
  assert.deepEqual(scrubModelOutput('```\n```'), { ok: false }, 'a fence around nothing is empty')
  assert.deepEqual(scrubModelOutput('"  "'), { ok: false }, 'quotes around whitespace is empty')
  assert.deepEqual(scrubModelOutput(undefined), { ok: false })
})

test(`scrubber: output above ${OUTPUT_MAX_LENGTH} is truncated to the cap`, () => {
  const raw = 'x'.repeat(OUTPUT_MAX_LENGTH + 500)
  const scrubbed = scrubModelOutput(raw)
  assert.equal(scrubbed.ok, true)
  assert.equal(scrubbed.text.length, OUTPUT_MAX_LENGTH)
})

test('templates: the draft rides in the rendered prompt as data (zh for CJK drafts)', () => {
  const rendered = renderTemplate('concise', '帮我@file 写个东西')
  assert.ok(rendered.includes('帮我@file 写个东西'), 'draft verbatim in the prompt')
  assert.ok(rendered.includes('用户草稿'), 'zh skeleton for a CJK draft')
  assert.ok(rendered.includes('@'), 'reference-marker contract present')
  assert.ok(!rendered.includes('```'), 'no fence in the skeleton itself')
})

test('templates: en skeleton for latin drafts, style shapes differ', () => {
  const concise = renderTemplate('concise', 'write me an email please')
  assert.ok(concise.includes('User draft:'))
  const structured = renderTemplate('structured', 'write me an email please')
  for (const section of ['[Role]', '[Task]', '[Constraints]', '[Output format]']) {
    assert.ok(structured.includes(section), `structured en skeleton has ${section}`)
  }
  const structuredZh = renderTemplate('structured', '帮我写个邮件')
  for (const section of ['【角色】', '【任务】', '【约束】', '【输出格式】']) {
    assert.ok(structuredZh.includes(section), `structured zh skeleton has ${section}`)
  }
})

test('templates: unknown style falls back to concise (validation happens earlier)', () => {
  assert.equal(renderTemplate('nope', '帮我写个东西'), renderTemplate('concise', '帮我写个东西'))
})

test('dispatch vocabulary: fixed script body, identity block, provider name', () => {
  // The script references args.prompt — the draft NEVER appears in it (R5).
  assert.equal(POLISH_SCRIPT, "const polished = await agent(args.prompt, { label: 'polish' })\nreturn polished")
  assert.ok(!POLISH_SCRIPT.includes('draft'))
  assert.equal(POLISH_META.name, 'prompt-polisher')
  assert.ok(POLISH_META.description.length > 0, 'meta.description must be non-empty (engine strong validation)')
  assert.equal(ENGINE_PROVIDER, 'spawn')
})
