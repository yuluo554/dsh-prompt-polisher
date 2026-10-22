/**
 * Desensitization audit (M4 起步, plan/06 发布门 / ai-tool-project-sprint
 * 阶段 7 四步, 脚本化可重跑): scans the repository tree for secrets and
 * personal information. Any FAIL exits non-zero; all pass prints
 * DESSENSITIZE_AUDIT_OK. Guarded into the offline test suite
 * (test/desensitize.test.js) so it runs with every `pnpm test`.
 *
 * The four steps:
 *   1. .gitignore coverage + forbidden filenames (.env / *.key / secret / token)
 *   2. content scan of every text file (keys, phone/id numbers, personal
 *      paths, internal domains, emails)
 *   3. binary files must be sha256-pinned (BINARY_ALLOWLIST; the only entry
 *      is the README preview screenshot — inline SVG icons need no pinning)
 *   4. history rewrite applies only once the repo is PUSHED (M5, plan/06);
 *      out of scope for the working-tree audit, printed as a note.
 *
 * Run: node scripts/desensitize-audit.mjs [root]
 *      (default root = the package directory; M5 re-runs it at the repo root)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, extname } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = process.argv[2] !== undefined
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories never scanned (dependencies, build output, VCS internals). */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'lib', '.clean-store'])

/**
 * File-scoped tolerated hits, each with a recorded reason (台账 discipline:
 * an allowlist entry without a reason is a bug). Keep this EMPTY unless a
 * verified false positive forces an entry.
 */
const ALLOWLIST = [
  // Example shape: { file: /^pnpm-lock\.yaml$/, pattern: 'phone', reason: '...' },
]

/**
 * Binary files are human-unreadable for step 2, so instead of scanning them
 * we pin their sha256: any edit changes the hash and re-enters review, and a
 * pinned entry without a reason is a bug. Keep this list minimal and justified
 * (the only entry is the README preview screenshot).
 */
const BINARY_ALLOWLIST = [
  {
    file: /^docs\/preview\.png$/,
    sha256: '2f6000a76b76c4f024961abd091a3bf4aa1c292f482c544c6109f483a457a9d2',
    reason: 'README preview: real 0.2.1-rc.2 UI screenshot (button + status bar); no personal data, hash pins the reviewed bytes',
  },
]

/** Step 1: every line the .gitignore must carry. */
const REQUIRED_GITIGNORE = [/^\.env$/m, /^\.env\.\*$/m, /node_modules\//, /\*\*_private\/|m/, /lib\//, /\*\.log/]

/** Filename patterns that must never be tracked (step 1). */
const FORBIDDEN_FILE_RE = [/^\.env(\.|$)/i, /\.key$/i, /secret/i, /token/i]

/** Step 2 patterns. Hex/alnum lookarounds keep hash runs (lockfile, base64)
 * from false-positive as phone/id numbers.
 *
 * ---- 2026-10-22 T4：个人路径正则扩写 ----
 * 原版只有两态：`C:\Users\<name>` 与 unix 的 `/home|/Users/<name>`。
 * 实测本仓入库的交接物里有 14 处 `<D>:\ProgramData\zcode\dsh-2\...`，
 * 审计照打 DESENSITIZE_AUDIT_OK —— 门绿着，路径已经公开。
 *
 * 扩写的两条约束（都是实测踩出来的）：
 *  1) 必须有 `(?<![A-Za-z0-9])` 前置断言。否则 URL 里的 `https:/`、`host:443`
 *     这类子串会被当成盘符路径（在 HWS-formal-math-navigator 上实测：
 *     松口径 2 文件 7 命中，全是 https）。
 *  2) **泛化兜底不能太宽**。PyInstaller / Qt 上游二进制会带上**别人的构建机路径**
 *     （`C:\Users\runneradmin\...`），`C:\Windows\Fonts\...` 是系统字体，
 *     `<user>` / `...` 是我们自己已脱敏的占位写法 —— 这三类一律不报，
 *     否则门会因为成片误报而被人关掉（同仓 labor-compliance 的
 *     `tools/release_assets.py` docstring 记了同一条教训）。
 *
 * 所以分两条：
 *  - personalPath：盘符 + **敏感根目录名**（Users/ProgramData/work/projects/Documents/Desktop）。
 *    这条语义最准，D:\ProgramData 就是它抓到的。
 *  - driveAbsPath：泛化兜底（任意盘符 + ≥2 段），但排除占位符与系统目录。
 *    它存在的理由是无法穷举敏感目录名（形如 `<盘符>:\a\b` 这类短路径）。
 */
const PATH_TAIL = String.raw`[^\s\`)\]"'|]*`
const PERSONAL_PATH_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}(?:Users|ProgramData|work|projects|Documents|Desktop)[\\/]${PATH_TAIL}`
  + String.raw`|(?<![A-Za-z0-9])\/(?:home|Users)\/[A-Za-z0-9._-]+\/[^\s\`)\]"'|]*`,
)
const DRIVE_ABS_PATH_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_.\u4e00-\u9fa5-]+[\\/]${PATH_TAIL}`,
)

/** 判一条命中是不是「已脱敏的占位 / 系统目录 / 别人的构建机」——是则不报。 */
function isBenignPathHit(text) {
  if (/<[^>]*>/.test(text)) return true // <user> / <repo> / <盘符>
  if (/(?:^|[\\/])\.\.\.(?:[\\/]|$)/.test(text)) return true // D:\ProgramData\...
  if (/:\s*\.\.\./.test(text)) return true
  if (/^[A-Za-z]:[\\/]{1,2}(?:Windows|Program Files)/i.test(text)) return true
  if (/[\\/]Users[\\/](?:runneradmin|runner|Public|Default|All Users)\b/i.test(text)) return true
  return false
}

const PATTERNS = [
  { name: 'apiKey', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'keyAssign', re: /\b(api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i },
  { name: 'phone', re: /(?<![0-9A-Za-z])1[3-9]\d{9}(?![0-9A-Za-z])/ },
  { name: 'idNumber', re: /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/ },
  { name: 'personalPath', re: PERSONAL_PATH_RE, benign: isBenignPathHit },
  { name: 'driveAbsPath', re: DRIVE_ABS_PATH_RE, benign: isBenignPathHit },
  { name: 'internalDomain', re: /\b[a-z0-9-]+\.(?:internal|corp|lan)\b/i },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
]

/** Text-ish extensions scanned always; everything else is sniffed for NUL. */
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt', '.html', '.css', '.gitattributes', '', '.npmrc', '.gitignore'])

function isExcluded(rel) {
  return rel.split(/[\\/]/).some((segment) => EXCLUDED_DIRS.has(segment))
}

/** Tracked files when inside a git repo, else the walked tree minus excludes. */
function listFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .split('\0')
      .filter((line) => line.length > 0)
    if (out.length > 0) return out
  } catch {
    // Not a git repo (M4: pre-init) — walk the tree.
  }
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const rel = relative(ROOT, path)
      if (isExcluded(rel)) continue
      if (statSync(path).isDirectory()) walk(path)
      else out.push(rel)
    }
  }
  walk(ROOT)
  return out
}

const failures = []
const tolerated = []
const pinnedHits = []
const files = listFiles()

// ---- Step 1: gitignore coverage + forbidden filenames --------------------
try {
  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
  for (const required of REQUIRED_GITIGNORE) {
    if (!required.test(gitignore)) failures.push(`step1: .gitignore misses ${required}`)
  }
} catch {
  failures.push('step1: .gitignore missing')
}
for (const rel of files) {
  const base = rel.split(/[\\/]/).pop()
  if (FORBIDDEN_FILE_RE.some((re) => re.test(base))) failures.push(`step1: forbidden filename tracked: ${rel}`)
}

// ---- Steps 2+3: content & binary scan -------------------------------------
for (const rel of files) {
  const path = join(ROOT, rel)
  const ext = extname(rel).toLowerCase()
  const assumeText = TEXT_EXTENSIONS.has(ext) || rel.startsWith('.git') || rel === '.npmrc'
  let bytes
  try {
    bytes = readFileSync(path)
  } catch {
    continue
  }
  const isBinary = !assumeText && bytes.subarray(0, 8192).includes(0)
  if (isBinary) {
    const sha = createHash('sha256').update(bytes).digest('hex')
    const pinned = BINARY_ALLOWLIST.find((entry) => entry.file.test(rel) && entry.sha256 === sha)
    if (pinned !== undefined) pinnedHits.push({ rel, reason: pinned.reason })
    else failures.push(`step3: binary file not in the sha256 allowlist: ${rel} (sha256 ${sha})`)
    continue
  }
  const text = bytes.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (const { name, re, benign } of PATTERNS) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!re.test(line)) continue
      // 同一行可能有多处命中：逐个判定，避免「一处占位」放过整行真路径
      const reGlobal = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      const found = [...line.matchAll(reGlobal)].map((m) => m[0])
      const real = benign === undefined ? found : found.filter((hit) => !benign(hit))
      if (real.length === 0) continue
      const hit = { file: rel, pattern: name, line: index + 1, sample: real[0].slice(0, 60) }
      const allowed = ALLOWLIST.find((entry) => entry.file instanceof RegExp
        ? entry.file.test(rel) && entry.pattern === name
        : entry.file === rel && entry.pattern === name)
      if (allowed !== undefined) tolerated.push({ ...hit, reason: allowed.reason })
      else failures.push(`step2: ${name} hit at ${rel}:${index + 1} — ${hit.sample}`)
    }
  }
}

// ---- Report ---------------------------------------------------------------
for (const hit of tolerated) console.log(`  [allowlisted] ${hit.pattern} at ${hit.file}:${hit.line} — ${hit.reason}`)
for (const hit of pinnedHits) console.log(`  [sha256-pinned] binary ${hit.rel} — ${hit.reason}`)
if (failures.length > 0) {
  console.error(`DESENSITIZE_AUDIT_FAILED (${failures.length} finding(s)):`)
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('Fix the finding (placeholder it out) or record a justified allowlist entry in scripts/desensitize-audit.mjs.')
  process.exit(1)
}
console.log(`[desensitize-audit] root=${ROOT}`)
console.log(`[desensitize-audit] files scanned: ${files.length}; steps 1-3 clean`)
console.log('[desensitize-audit] step 4 (history rewrite) applies at push time only — M5 release gate, plan/06.')
console.log('DESENSITIZE_AUDIT_OK')
