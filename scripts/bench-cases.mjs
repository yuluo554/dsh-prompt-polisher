/**
 * The 20-case bench roster (M4, plan/04 基准脚本). Consumed by
 * scripts/seed-fixtures.mjs (writes data/fixtures/**), scripts/bench-runner.mjs
 * (executes the pipeline), and scripts/update-golden.mjs (rewrites goldens).
 *
 * Fields:
 *   id              case + golden file name (unique)
 *   draft           fixture file path under data/fixtures, or {repeat:{text,times}}
 *   style           payload style; null = OMIT style from the payload (default-style contract)
 *   model           {file} | {raw} | {valueNull:true} | {stopReason} | {repeat:{text,lengthExtra}}
 *   noDispatch      validation must reject before the model; the dispatch throws if called
 *   expect          readable assertion mirrored into the test (the golden snapshot is the exact bytes)
 *   templateOverride FR10 case: full override template, must carry {draft}; the runner attaches
 *                   it router-shaped (src/router.ts) and the test pins the rendered skeleton
 *
 * Coverage spread (plan/04): 中/英、口语化、歧义、超长(近上限/超上限)、
 * 特殊字符(反引号+${}+引号+换行+emoji)、/name 与 @ 引用记号、空与边界、
 * 封闭错误码全样本。
 */
export const CASES = [
  {
    id: '01-concise-zh-default-style',
    draft: 'drafts/01-concise-zh-default-style.txt',
    style: null,
    model: { file: 'model-responses/01-concise-zh-default-style.txt' },
    expect: { ok: true, style: 'concise' },
  },
  {
    id: '02-concise-zh-fence',
    draft: 'drafts/02-concise-zh-fence.txt',
    style: 'concise',
    model: { file: 'model-responses/02-concise-zh-fence.txt' },
    expect: { ok: true },
  },
  {
    id: '03-concise-en-tagged-fence',
    draft: 'drafts/03-concise-en-tagged-fence.txt',
    style: 'concise',
    model: { file: 'model-responses/03-concise-en-tagged-fence.txt' },
    expect: { ok: true },
  },
  {
    id: '04-concise-en-quoted',
    draft: 'drafts/04-concise-en-quoted.txt',
    style: 'concise',
    model: { file: 'model-responses/04-concise-en-quoted.txt' },
    expect: { ok: true },
  },
  {
    id: '05-concise-zh-corner-quoted',
    draft: 'drafts/05-concise-zh-corner-quoted.txt',
    style: 'concise',
    model: { file: 'model-responses/05-concise-zh-corner-quoted.txt' },
    expect: { ok: true },
  },
  {
    id: '06-concise-zh-fence-in-quote',
    draft: 'drafts/06-concise-zh-fence-in-quote.txt',
    style: 'concise',
    model: { file: 'model-responses/06-concise-zh-fence-in-quote.txt' },
    expect: { ok: true },
  },
  {
    id: '07-concise-zh-special-chars',
    draft: 'drafts/07-concise-zh-special-chars.txt',
    style: 'concise',
    model: { file: 'model-responses/07-concise-zh-special-chars.txt' },
    expect: { ok: true },
  },
  {
    id: '08-concise-zh-ref-markers',
    draft: 'drafts/08-concise-zh-ref-markers.txt',
    style: 'concise',
    model: { file: 'model-responses/08-concise-zh-ref-markers.txt' },
    expect: { ok: true },
  },
  {
    id: '09-structured-en',
    draft: 'drafts/09-structured-en.txt',
    style: 'structured',
    model: { file: 'model-responses/09-structured-en.txt' },
    expect: { ok: true },
  },
  {
    id: '10-structured-zh-override',
    draft: 'drafts/10-structured-zh-override.txt',
    style: 'structured',
    templateOverride: '把下面的会议通知草稿改写成一条正式、完整的会议通知，补全缺失信息时用「待定」占位：\n{draft}',
    model: { file: 'model-responses/10-structured-zh-override.txt' },
    expect: { ok: true, style: 'structured' },
  },
  {
    id: '11-concise-zh-near-cap',
    draft: { repeat: { text: '请把本季度销售数据按区域拆分并标注环比变化，突出异常波动的原因。', times: 235 } },
    style: 'concise',
    model: { file: 'model-responses/11-concise-zh-near-cap.txt' },
    expect: { ok: true },
  },
  {
    id: '12-parse-failed-whitespace',
    draft: 'drafts/12-parse-failed-whitespace.txt',
    style: 'concise',
    model: { raw: '   ' },
    expect: { ok: false, error: 'PARSE_FAILED' },
  },
  {
    id: '13-parse-failed-empty-fence',
    draft: 'drafts/13-parse-failed-empty-fence.txt',
    style: 'concise',
    model: { file: 'model-responses/13-parse-failed-empty-fence.txt' },
    expect: { ok: false, error: 'PARSE_FAILED' },
  },
  {
    id: '14-upstream-child-null',
    draft: 'drafts/14-upstream-child-null.txt',
    style: 'concise',
    model: { valueNull: true },
    expect: { ok: false, error: 'UPSTREAM_FAILED' },
  },
  {
    id: '15-cancelled',
    draft: 'drafts/15-cancelled.txt',
    style: 'concise',
    model: { stopReason: 'cancelled' },
    expect: { ok: false, error: 'CANCELLED' },
  },
  {
    id: '16-upstream-run-error',
    draft: 'drafts/16-upstream-run-error.txt',
    style: 'concise',
    model: { stopReason: 'error' },
    expect: { ok: false, error: 'UPSTREAM_FAILED' },
  },
  {
    id: '17-empty-draft',
    draft: 'drafts/17-empty-draft.txt',
    style: 'concise',
    noDispatch: true,
    expect: { ok: false, error: 'EMPTY_DRAFT' },
  },
  {
    id: '18-bad-style',
    draft: 'drafts/18-bad-style.txt',
    style: 'magical',
    noDispatch: true,
    expect: { ok: false, error: 'BAD_STYLE' },
  },
  {
    id: '19-too-long-draft',
    draft: { repeat: { text: 'x', times: 8001 } },
    style: 'concise',
    noDispatch: true,
    expect: { ok: false, error: 'TOO_LONG' },
  },
  {
    id: '20-output-truncated',
    draft: 'drafts/20-output-truncated.txt',
    style: 'concise',
    model: { repeat: { text: 'y', lengthExtra: 1000 } },
    expect: { ok: true },
  },
]
