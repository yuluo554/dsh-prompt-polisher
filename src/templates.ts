/**
 * Style templates (M2/M3, plan/03 §3.4): built-in prompt templates per style,
 * rendered on the host side. M2 ships the two frozen presets (`concise`,
 * `structured`); M3 adds the FR10 override channel — a user config may
 * replace a style's whole template with a full prompt text containing the
 * `{draft}` placeholder (see src/config.ts; invalid overrides fall back to
 * the built-in skeleton).
 *
 * The rendered text is the FULL prompt the single workflow `agent()` sees:
 * agent opts carry no system field, so the role + output constraints ride
 * in the prompt body. The output contract is written into every template:
 * answer with the rewritten prompt only — no explanations, no code fences,
 * keep the draft's language, keep `@` and `/` reference markers verbatim
 * (R1 companion, applies even while chips-bearing drafts are disabled).
 *
 * The DRAFT is interpolated into the rendered prompt as DATA (a JS string
 * value) — never into the engine script literal (R5, src/dispatch.ts).
 */

/** Placeholder a custom override must carry; replaced with the draft literally. */
export const TEMPLATE_DRAFT_TOKEN = '{draft}'

/** FR10 overrides as consumed by renderTemplate (absent/invalid keys fall back to built-in). */
export interface TemplateOverrides {
  concise?: string
  structured?: string
}

/** An override is usable when non-empty and carrying the draft placeholder. */
export function isValidTemplateOverride(text: string | undefined): boolean {
  return text !== undefined && text.trim().length > 0 && text.includes(TEMPLATE_DRAFT_TOKEN)
}

/** Drafts with at least this share of CJK code points get the zh skeleton. */
const CJK_THRESHOLD = 0.15

function isCJKDominant(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  if (cjk === 0) return false
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  if (letters === 0) return true
  return cjk / letters >= CJK_THRESHOLD
}

interface StyleTemplate {
  zh: (draft: string) => string
  en: (draft: string) => string
}

const TEMPLATES: Record<string, StyleTemplate> = {
  concise: {
    zh: (draft) => [
      '你是提示词优化助手。把下面的用户草稿改写成一条清晰、明确、无歧义的提示词。',
      '要求：',
      '- 保持原意与原语言，不扩写主题范围；',
      '- 消解歧义、补全必要的上下文与目标；',
      '- 删除冗余表达，句子精炼但不丢信息。',
      '输出约束：只输出改写后的提示词文本本身——不要解释、不要用代码块或引号包裹、不要改变语言；草稿中的 @ 与 / 开头的引用记号原样保留。',
      '',
      '用户草稿：',
      draft,
    ].join('\n'),
    en: (draft) => [
      'You are a prompt-polishing assistant. Rewrite the user draft below into one clear, unambiguous prompt.',
      'Requirements:',
      '- Keep the original meaning and language; do not widen the topic;',
      '- Resolve ambiguity and supply missing context and intent;',
      '- Remove redundancy; concise but lossless.',
      'Output contract: output ONLY the rewritten prompt text itself — no explanations, no code fences or surrounding quotes, no language switch; keep every @ and / reference marker in the draft verbatim.',
      '',
      'User draft:',
      draft,
    ].join('\n'),
  },
  structured: {
    zh: (draft) => [
      '你是提示词优化助手。把下面的用户草稿改写成一条结构化提示词，按以下四段组织（保留草稿原语言）：',
      '【角色】模型应扮演的角色与专业背景；',
      '【任务】要完成的具体事项与目标；',
      '【约束】必须遵守的限制、口径与范围；',
      '【输出格式】期望的回答形态（列表/代码/篇幅等）。',
      '四段内容必须从草稿推导：草稿没写的维度留空该项，不要编造具体细节。',
      '输出约束：只输出改写后的提示词文本本身——不要解释、不要用代码块或引号包裹、不要改变语言；草稿中的 @ 与 / 开头的引用记号原样保留。',
      '',
      '用户草稿：',
      draft,
    ].join('\n'),
    en: (draft) => [
      'You are a prompt-polishing assistant. Rewrite the user draft below into one structured prompt organized in four sections (keep the draft\'s language):',
      '[Role] the persona and expertise the model should adopt;',
      '[Task] the concrete job and goal;',
      '[Constraints] the limits, conventions and scope to obey;',
      '[Output format] the expected answer shape (lists, code, length...).',
      'Derive every section from the draft: leave a section empty rather than inventing specifics.',
      'Output contract: output ONLY the rewritten prompt text itself — no explanations, no code fences or surrounding quotes, no language switch; keep every @ and / reference marker in the draft verbatim.',
      '',
      'User draft:',
      draft,
    ].join('\n'),
  },
}

/**
 * Render the full single-agent prompt for one style. FR10: a valid override
 * for the style replaces BOTH language skeletons (the user owns the whole
 * template); the draft is substituted literally (function replacer — the
 * draft's `$` sequences never act as replacement patterns). Unknown styles
 * are unreachable here (validation happens first in the pipeline); they fall
 * back to the `concise` skeleton so the template layer stays total.
 */
export function renderTemplate(style: string, draft: string, overrides?: TemplateOverrides): string {
  const override = style === 'concise'
    ? overrides?.concise
    : style === 'structured'
      ? overrides?.structured
      : undefined
  if (isValidTemplateOverride(override)) {
    return override!.replaceAll(TEMPLATE_DRAFT_TOKEN, () => draft)
  }
  const template = TEMPLATES[style] ?? TEMPLATES.concise
  return isCJKDominant(draft) ? template.zh(draft) : template.en(draft)
}
