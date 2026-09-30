/**
 * Client build (M1, plan/03 §3.1): bundles `client/index.tsx` into the
 * `lib/client.js` browser bundle that dsh's client-modules system serves to
 * the Web GUI.
 *
 * Format contract (verified against official client bundles and the
 * dsh-pipeline plugin): a lazy-CJS module registered via
 * `window.__ModuleLoader__.load({ id, factory })`; the factory receives a
 * synchronous `require` that resolves only against the frozen platform seed
 * table (react, react-dom, cordis, dsh-client-ui-*, ...) and boot graph rows
 * of packages declared in package.json `dsh.client.external` / `inject`
 * (here: the locale service). Anything else fails at runtime with
 * "require(...) missed the module table", so the post-build scan below
 * re-checks every emitted require against the allowlist — the build-time
 * mirror of the official bundle purity gate (dsh-plugin-dev §5).
 *
 * New browser dependency rule (three places in sync): package.json
 * `dsh.client.external` (+ `inject` when a service must exist before apply),
 * `SEED_MODULES` here, and the `import type {}` mount in client/ambient.d.ts.
 *
 * The host serves `./client` (exports map) as the package's client half; a
 * missing bundle makes web-profile activation fail loudly, hence this build
 * is chained into `pnpm build` right after tsc.
 */
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'lib', 'client.js')
const PACKAGE_ID = 'dsh-prompt-polisher'

/**
 * Module specifiers the bundle may `require` at runtime: exactly the frozen
 * platform seed table slice the bundle actually imports (react through the
 * JSX transform) plus the packages listed in package.json
 * `dsh.client.external` (loaded before us via `dsh.client.inject`).
 */
const SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  // dsh.client.external: locale service package (boot graph row, not seed)
  '@deepseek-ai/dsh-client-locale',
]

await build({
  entryPoints: [join(ROOT, 'client', 'index.tsx')],
  outfile: OUT,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: SEED_MODULES,
  legalComments: 'none',
  banner: {
    js: [
      `window.__ModuleLoader__.load({`,
      `\tid: ${JSON.stringify(PACKAGE_ID)},`,
      `\tfactory: (require) => {`,
      `\t\tvar module = { exports: {} };`,
      `\t\tvar __ppReport = function (stage, err) {`,
      `\t\t\ttry {`,
      `\t\t\t\tfetch('/api/prompt-polisher/debug', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: stage, message: String((err && err.message) || err), stack: String((err && err.stack) || '') }) }).catch(function () {});`,
      `\t\t\t} catch (e) {}`,
      `\t\t};`,
      `\t\ttry {`,
    ].join('\n'),
  },
  footer: {
    js: [
      `\t\t} catch (err) { __ppReport('factory', err); throw err; }`,
      `\t\treturn module.exports;`,
      `\t}`,
      `});`,
    ].join('\n'),
  },
})

// Bundle purity check: every require(...) emitted into the bundle must name
// an allowlisted specifier. esbuild keeps external requires verbatim; any
// accidental Node builtin or unlisted package would only explode in the
// browser, so fail the build here instead.
const js = await readFile(OUT, 'utf8')
const required = [...js.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
const unknown = [...new Set(required)].filter((spec) => !SEED_MODULES.includes(spec))
if (unknown.length > 0) {
  await writeFile(OUT, js) // keep the artifact for inspection
  throw new Error(
    `build-client: bundle requires non-seed modules ${JSON.stringify(unknown)} — `
    + 'add them to package.json dsh.client.external (+ dsh.client.inject when a '
    + 'service must exist before apply) and to SEED_MODULES here, or remove the import.',
  )
}
console.log(`[dsh-prompt-polisher] client bundle built: lib/client.js (${required.length} require sites, ${new Set(required).size} externals)`)
