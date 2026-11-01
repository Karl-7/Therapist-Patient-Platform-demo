// Bundles the page scripts into plain (non-module) files in assets/build/,
// so the pages also work when an HTML file is opened directly (file://).
//   node scripts/build.mjs          rebuild assets/build/ (run after editing anything in assets/*.js)
//   node scripts/build.mjs --dist   also copy the public site into dist/ (what Netlify publishes)
import { build } from 'esbuild'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'

const entries = ['private', 'doctor', 'login']

await build({
  entryPoints: entries.map((name) => `assets/${name}.js`),
  outdir: 'assets/build',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: '// Built by scripts/build.mjs from assets/*.js. Do not edit; run `npm run build`.' },
  logLevel: 'warning',
})
console.log('Built assets/build/: ' + entries.map((e) => e + '.js').join(', '))

if (process.argv.includes('--dist')) {
  rmSync('dist', { recursive: true, force: true })
  mkdirSync('dist/assets', { recursive: true })
  for (const file of readdirSync('.')) {
    if (file.endsWith('.html') || file === 'affirmations.json') cpSync(file, `dist/${file}`)
  }
  cpSync('assets/site.css', 'dist/assets/site.css')
  cpSync('assets/fonts.css', 'dist/assets/fonts.css')
  cpSync('assets/fonts', 'dist/assets/fonts', { recursive: true })
  cpSync('assets/build', 'dist/assets/build', { recursive: true })
  console.log('Copied the public site into dist/')
}
