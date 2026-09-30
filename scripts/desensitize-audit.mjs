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
 *   3. binary files must be sha256-allowlisted (none expected — icons are
 *      inline SVG)
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

/** Step 1: every line the .gitignore must carry. */
const REQUIRED_GITIGNORE = [/^\.env$/m, /^\.env\.\*$/m, /node_modules\//, /\*\*_private\/|m/, /lib\//, /\*\.log/]

/** Filename patterns that must never be tracked (step 1). */
const FORBIDDEN_FILE_RE = [/^\.env(\.|$)/i, /\.key$/i, /secret/i, /token/i]

/** Step 2 patterns. Hex/alnum lookarounds keep hash runs (lockfile, base64)
 * from false-positive as phone/id numbers. */
const PATTERNS = [
  { name: 'apiKey', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'keyAssign', re: /\b(api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i },
  { name: 'phone', re: /(?<![0-9A-Za-z])1[3-9]\d{9}(?![0-9A-Za-z])/ },
  { name: 'idNumber', re: /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/ },
  { name: 'personalPath', re: /C:[\\/]+Users[\\/]+[A-Za-z0-9._-]+|(?<![A-Za-z0-9])\/(?:home|Users)\/[A-Za-z0-9._-]+/ },
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
    failures.push(`step3: binary file not in the sha256 allowlist: ${rel} (sha256 ${sha})`)
    continue
  }
  const text = bytes.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (const { name, re } of PATTERNS) {
    for (let index = 0; index < lines.length; index += 1) {
      if (re.test(lines[index])) {
        const hit = { file: rel, pattern: name, line: index + 1 }
        const allowed = ALLOWLIST.find((entry) => entry.file instanceof RegExp
          ? entry.file.test(rel) && entry.pattern === name
          : entry.file === rel && entry.pattern === name)
        if (allowed !== undefined) tolerated.push({ ...hit, reason: allowed.reason })
        else failures.push(`step2: ${name} hit at ${rel}:${index + 1}`)
      }
    }
  }
}

// ---- Report ---------------------------------------------------------------
for (const hit of tolerated) console.log(`  [allowlisted] ${hit.pattern} at ${hit.file}:${hit.line} — ${hit.reason}`)
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
