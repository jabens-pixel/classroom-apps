// Developer helper: seeds an app and saves screenshots while you work out its tour script.
//   node walkthroughs/tool/explore.js <app> <file-with-steps.js>   (steps file exports async (page, info, base, shot) => {})
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright'); const { start } = require('./server'); const { useLocalFonts } = require('./fonts');
const [APP, STEPS] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '..', '..'); const DIR = path.join(ROOT, 'walkthroughs', APP);
const SCRIPT = fs.existsSync(path.join(DIR, 'walkthrough.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'walkthrough.json'), 'utf8')) : {};
(async () => {
  const B = 'http://localhost:8791', server = await start(path.join(ROOT, 'apps', APP), 8791, SCRIPT.reset || process.env.RESET || '');
  const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j.value; };
  const info = await require(path.join(DIR, 'seed.js'))({ rpc: (fn, args, user) => post('/rpc', { fn, args, user }), ev: (code, user) => post('/__eval', { code, user }) });
  console.log('info', JSON.stringify(info).slice(0, 600));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); await useLocalFonts(ctx);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  const outDir = path.join(ROOT, 'walkthroughs', 'out', 'explore-' + APP); fs.mkdirSync(outDir, { recursive: true });
  const shot = n => page.screenshot({ path: path.join(outDir, n + '.png') });
  try { await require(path.resolve(STEPS))(page, info, B, shot, post); } catch (e) { console.log('STEP ERROR', e.message); await shot('zz_error'); }
  console.log('errors', JSON.stringify(errs.slice(0, 5)));
  await b.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
