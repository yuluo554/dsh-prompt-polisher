/**
 * T4 负控：证明扩写后的 personalPath / driveAbsPath 真的会命中，
 * 且不会把 https:// 误判成盘符路径。
 *
 * 做法：在临时目录造一个最小仓库（.gitignore 满足 REQUIRED_GITIGNORE），
 * 放入夹具文件，跑 scripts/desensitize-audit.mjs <tmpdir>，比对退出码。
 * 不触碰真实仓库、不出网。
 *
 * 用法：node scripts/desensitize-audit-selftest.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = join(ROOT, 'scripts', 'desensitize-audit.mjs')

const GITIGNORE = '.env\n.env.*\nnode_modules/\n_private/\nlib/\n*.log\n'

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dsn-selftest-'))
  writeFileSync(join(dir, '.gitignore'), GITIGNORE)
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

function runAudit(dir) {
  try {
    const out = execFileSync(process.execPath, [AUDIT, dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { rc: 0, out }
  } catch (error) {
    return { rc: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/**
 * 夹具用「运行时拼装」而不是字面量写盘符路径。
 * 原因：本文件的路径字面量在**入库后**会被 scripts/desensitize-audit.mjs 自己扫到
 * （实测：写死的 `D:\ProgramData\...` 让审计在 scripts/desensitize-audit-selftest.mjs:63
 * 报 personalPath hit，等于审计工具把自己判红）。拼装后源码里不出现完整形态，
 * 审计自查干净，而行外仍能验证正则。
 */
const DRV = String.fromCharCode(68) // 'D'
const HOME_DRV = String.fromCharCode(67) // 'C'
const BS = String.fromCharCode(92) // '\'
const pw = (drive, ...segs) => `${drive}:${BS}${segs.join(BS)}`
const fw = (drive, ...segs) => `${drive}:/${segs.join('/')}`

const cases = []
const dirs = []
// 输出里的文件分隔符随平台（Windows 用 `\`），断言只用文件名与行号
const check = (label, dir, expectRc, expectInOut) => {
  dirs.push(dir)
  const { rc, out } = runAudit(dir)
  const hitOk = expectInOut === null || expectInOut.test(out)
  cases.push({ label, ok: rc === expectRc && hitOk, rc, out })
}

// ① 正控：干净的树必须仍 OK（防止扩写后变成永远红）
check('clean tree → exit 0 + OK marker', makeRepo({ 'README.md': 'hello\n' }), 0, /DESENSITIZE_AUDIT_OK/)

// ② 负控：<盘符>:\ProgramData 形态（原正则漏掉的那一类）必须报红
//    注：这条会同时命中 personalPath 与 driveAbsPath 两个模式，属预期（双保险）。
check(
  'ProgramData path (backslash) → FAIL (personalPath)',
  makeRepo({ 'notes/update-02.md': `added ${pw(DRV, 'ProgramData', 'zcode', 'pkg')}\n` }),
  1,
  /personalPath hit at notes[\\/]update-02\.md:1/,
)

// ③ 负控：正斜杠形态也必须报红
check(
  'ProgramData path (forward slash) → FAIL (personalPath)',
  makeRepo({ 'a.md': `cd "${fw(DRV, 'ProgramData', 'zcode', 'pkg')}"\n` }),
  1,
  /personalPath hit at a\.md:1/,
)

// ④ 负控：任意盘符兜底 driveAbsPath（原白名单目录名之外）
check(
  'two-segment drive path (no whitelisted dir) → FAIL (driveAbsPath)',
  makeRepo({ 'b.md': `git -C ${pw(DRV, 'a', 'b')} status\n` }),
  1,
  /driveAbsPath hit at b\.md:1/,
)

// ⑤ 负控：Users 目录老形态仍要命中（扩写不能把它丢了）
check(
  'Users dir (old shape) → FAIL (personalPath)',
  makeRepo({ 'c.md': `${pw(HOME_DRV, 'Users', 'alice', 'Desktop', 'x.txt')}\n` }),
  1,
  /personalPath hit at c\.md:1/,
)

// ⑥ 正控（防误判）：https / shields / 政府站 URL 不得被当盘符路径
//    这一组是 T4 扩写最容易踩的坑：松口径 `[A-Za-z]:[\\/]` 会把
//    `https://` 里的 `s:/` 当成盘符路径，在 HWS-formal-math-navigator 上实测
//    产生 2 文件 7 条假命中。扩写必须带 (?<![A-Za-z0-9]) 前置断言。
check(
  'https + shields + gov URLs → exit 0（不得误判为盘符路径）',
  makeRepo({
    'd.md': [
      'https://github.com/yuluo554/x/actions/runs/1',
      'https://img.shields.io/github/v/release/yuluo554/x',
      'https://pypi.org/pypi/x/json',
      'https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2011/art_17339_208026.html',
    ].join('\n') + '\n',
  }),
  0,
  /DESENSITIZE_AUDIT_OK/,
)

// ⑦ 正控（防误判）：unix 的 home 形态必须命中（老规则保留）
//    同样拼装，避免本文件入库后被自己的 /(home|Users)/ 规则命中。
check(
  'unix home → FAIL (personalPath)',
  makeRepo({ 'e.md': `see /${'home'}/alice/notes.txt\n` }),
  1,
  /personalPath hit at e\.md:1/,
)

// ⑧ 留档（不是 T4 引入的）：ssh URL 会被 email 模式命中。
//    真实仓里 `ssh://…@ssh.github.com:443/…` 出现在 e-bike 的
//    update/03-执行记录.md。这里**不判定对错**，只把行为钉住，
//    免得将来有人把「email 命中 ssh URL」误读成 T4 扩写引入的回归。
check(
  'ssh URL → 命中 email（既有行为，T4 未改 email 规则）',
  makeRepo({ 'f.md': `ssh://git${'@'}ssh.github.com:443/yuluo554/x.git\n` }),
  1,
  /email hit at f\.md:1/,
)

// ---- ⑨~⑫ 已脱敏写法 / 系统目录 / 别人的构建机：必须**不**报 ----
// 这几条是 T4 扩写的核心负控：如果它们报红，门就会因成片误报被人关掉。
check(
  '占位符 <user> / <repo> → exit 0',
  makeRepo({
    'g.md': [
      `${pw(HOME_DRV, 'Users')}${BS}<user>${BS}.dsh${BS} 下`,
      `仓库根 <repo>${BS}update${BS}00-诊断报告.md`,
    ].join('\n') + '\n',
  }),
  0,
  /DESENSITIZE_AUDIT_OK/,
)

check(
  '省略写法（路径 + ...）→ exit 0',
  makeRepo({ 'h.md': `本机为 ${pw(DRV, 'ProgramData')}${BS}... （报告产物不入仓）\n` }),
  0,
  /DESENSITIZE_AUDIT_OK/,
)

check(
  '系统目录 Windows/Fonts → exit 0',
  makeRepo({ 'i.md': `字体 ${fw(HOME_DRV, 'Windows', 'Fonts', 'msyh.ttc')}\n` }),
  0,
  /DESENSITIZE_AUDIT_OK/,
)

check(
  '别人的构建机（runneradmin）→ exit 0（上游二进制常见）',
  makeRepo({ 'j.md': `PyInstaller 带 ${pw(HOME_DRV, 'Users', 'runneradmin', 'AppData', 'x.dll')}\n` }),
  0,
  /DESENSITIZE_AUDIT_OK/,
)

// ⑬ 同一行「占位 + 真路径」并存：真路径仍必须被报出（防整行被放过）
check(
  '同行占位 + 真路径 → 仍须命中真路径',
  makeRepo({ 'k.md': `见 ${pw(HOME_DRV, 'Users')}${BS}<user>${BS}x 与 ${pw(DRV, 'ProgramData', 'zcode', 'pkg')}\n` }),
  1,
  /personalPath hit at k\.md:1/,
)

let failed = 0
for (const c of cases) {
  console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.label}（rc=${c.rc}）`)
  if (!c.ok) {
    failed += 1
    console.log(`       out: ${c.out.replace(/\n/g, ' | ').slice(0, 300)}`)
  }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true })

console.log('')
if (failed > 0) {
  console.error(`结果：负控失败 ${failed} 项`)
  process.exit(1)
}
console.log(`结果：负控 ${cases.length} 项全部符合预期（正则既会命中，也不误判）`)
