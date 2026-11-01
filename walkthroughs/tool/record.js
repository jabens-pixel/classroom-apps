// Records an app's one-minute tour video from its tour script.
//   node walkthroughs/tool/record.js <app-folder-name>      (run from the repo root)
// Reads  walkthroughs/<app>/walkthrough.json  (captions and clicks)  and  walkthroughs/<app>/seed.js  (pretend class)
// Uses   apps/<app>/  (the app's real code)  and  docs/img/<app>.webp  (tile picture for the title card)
// Writes walkthroughs/out/<app>.mp4
// Needs Node 18+, Playwright with Chromium (npm i playwright && npx playwright install chromium) and ffmpeg.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { start } = require('./server');
const { useLocalFonts, cardFonts } = require('./fonts');

const APP = process.argv[2];
if (!APP) { console.error('Usage: node walkthroughs/tool/record.js <app-folder-name>'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'walkthroughs', APP);
const SCRIPT = JSON.parse(fs.readFileSync(path.join(DIR, 'walkthrough.json'), 'utf8'));
const seed = require(path.join(DIR, 'seed.js'));
const APPDIR = path.join(ROOT, 'apps', APP);
const OUT = path.join(ROOT, 'walkthroughs', 'out'); fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 8790), B = 'http://localhost:' + PORT;
const [W, H] = SCRIPT.viewport || [1280, 720];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const tileFile = path.join(ROOT, 'docs', 'img', APP + '.webp');
const TILE = fs.existsSync(tileFile) ? 'data:image/webp;base64,' + fs.readFileSync(tileFile).toString('base64') : '';
function card(kicker, title, sub, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${cardFonts()}
  html,body{margin:0;height:100%}body{background:#f5efe0;color:#1f1b16;font-family:'Source Sans 3',sans-serif;display:flex;align-items:center}
  .wrap{display:flex;align-items:center;gap:40px;padding:0 90px;width:100%;box-sizing:border-box}
  .txt{flex:1}.k{font:600 18px 'Source Sans 3',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8c2f39;margin:0 0 18px}
  h1{font:700 64px/1.08 Literata,Georgia,serif;margin:0 0 18px}p{font:400 27px/1.4 'Source Sans 3',sans-serif;color:#4b443b;margin:0;max-width:640px}
  .f{margin-top:30px;font-weight:600;font-size:21px;color:#1f5f74}
  .art{flex:none;width:430px;height:430px;${TILE ? `background:url(${TILE}) 82% 50%/auto 100% no-repeat;` : ''}border-radius:16px}
  </style></head><body><div class="wrap"><div class="txt"><p class="k">${kicker}</p><h1>${title}</h1><p>${sub}</p>${foot ? `<p class="f">${foot}</p>` : ''}</div><div class="art"></div></div></body></html>`;
}

// Caption bar and a visible cursor, kept on top of whatever the app draws.
const OVERLAY = `(() => {
  if (document.getElementById('vidCap')) return;
  const st = document.createElement('style');
  st.textContent = '#vidCap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);max-width:1040px;background:rgba(24,20,16,.92);color:#fff;font:600 24px/1.35 "Source Sans 3",Arial,sans-serif;padding:14px 26px;border-radius:12px;z-index:2147483646;opacity:0;transition:opacity .35s,transform .35s;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.3);pointer-events:none}'
   + '#vidCap.on{opacity:1;transform:translateX(-50%) translateY(0)}'
   + '#vidCur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .7s cubic-bezier(.4,.1,.2,1)}'
   + '#vidCur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}'
   + '.vidRing{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #e8a33d;border-radius:50%;z-index:2147483646;pointer-events:none;animation:vr .5s ease-out forwards}'
   + '@keyframes vr{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}';
  document.documentElement.appendChild(st);
  const c = document.createElement('div'); c.id = 'vidCap'; document.documentElement.appendChild(c);
  const k = document.createElement('div'); k.id = 'vidCur';
  k.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(k);
})()`;

(async () => {
  const server = await start(APPDIR, PORT, SCRIPT.reset || '');
  async function post(p, body) { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j.value; }
  await fetch(B + '/__reset');
  const info = await seed({ rpc: (fn, args, user) => post('/rpc', { fn, args, user }), ev: (code, user) => post('/__eval', { code, user }) });
  const fill = s => typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => (k in info ? info[k] : m)) : s;

  const raw = path.join(OUT, 'raw-' + APP); fs.rmSync(raw, { recursive: true, force: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: raw, size: { width: W, height: H } } });
  await useLocalFonts(ctx);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let cur = { x: Math.round(W * 0.7), y: Math.round(H * 0.58) };
  const wait = ms => p.waitForTimeout(ms);
  async function ov() { await p.evaluate(OVERLAY); await p.evaluate(c => { const k = document.getElementById('vidCur'); k.style.transition = 'none'; k.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)'; k.offsetWidth; k.style.transition = ''; }, cur); }
  async function cap(text, hold) {
    await ov();
    await p.evaluate(t => { const c = document.getElementById('vidCap'); c.classList.remove('on'); if (!t) return; setTimeout(() => { c.textContent = t; c.classList.add('on'); }, c.textContent ? 250 : 0); }, text || '');
    if (hold) await wait(hold);
  }
  async function find(sel, optional) {
    const el = p.locator(sel).first();
    try { await el.waitFor({ state: 'visible', timeout: 5000 }); return el; }
    catch (e) {
      if (optional) return null;
      const shot = path.join(OUT, 'stuck-' + APP + '.png'); await p.screenshot({ path: shot }).catch(() => {});
      throw new Error('The tour script points at something that isn\'t on the screen: ' + sel + '\nWhat the screen showed: ' + shot);
    }
  }
  async function moveTo(el) {
    await ov(); await el.scrollIntoViewIfNeeded(); await wait(250);
    const b = await el.boundingBox();
    cur = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height / 2, 40)) };
    await p.evaluate(c => { document.getElementById('vidCur').style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)'; }, cur);
    await wait(800);
  }
  async function clickEl(el, after) {
    await moveTo(el);
    await p.evaluate(c => { const r = document.createElement('div'); r.className = 'vidRing'; r.style.left = c.x + 'px'; r.style.top = c.y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); }, cur);
    await el.click(); await wait(after == null ? 900 : after);
  }

  // Title card
  await p.setContent(card(esc(SCRIPT.kicker || 'Classroom Apps · free for teachers'), esc(SCRIPT.title), esc(SCRIPT.summary || '')));
  await wait(4200);

  for (const raw0 of SCRIPT.steps) {
    const s = JSON.parse(fill(JSON.stringify(raw0)));
    if (s.as) { await cap('', 0); await p.goto(B + '/?user=' + encodeURIComponent(info[s.as] || s.as)); await p.waitForLoadState('networkidle').catch(() => {}); await wait(s.wait || 1100); }
    if (s.caption !== undefined) await cap(s.caption, s.hold == null ? 3500 : s.hold);
    if (s.scrollTo) { const el = await find(s.scrollTo, s.optional); if (el) { await el.evaluate((e, b) => e.scrollIntoView({ behavior: 'smooth', block: b || 'start' }), s.block); await wait(s.after || 1200); } }
    if (s.scroll) { await p.evaluate(d => window.scrollBy({ top: d, behavior: 'smooth' }), s.scroll); await wait(s.after || 1300); }
    if (s.move) { const el = await find(s.move, s.optional); if (el) { await moveTo(el); await wait(s.after || 900); } }
    if (s.click) { const el = await find(s.click, s.optional); if (el) await clickEl(el, s.after); }
    if (s.type) { const el = await find(s.type, s.optional); if (el) { await clickEl(el, 300); await el.pressSequentially(s.text, { delay: s.delay || 38 }); await wait(s.after || 700); } }
    if (s.wait && !s.as) await wait(s.wait);
  }

  // End card
  await cap('', 0);
  const end = SCRIPT.end || {};
  await p.setContent(card(esc(end.kicker || 'Free for teachers'), esc(end.title || 'Make your own copy'),
    end.summary ? esc(end.summary) : 'Click <b>Make a copy</b> on the Classroom Apps site, then <b>Classroom App ▸ Set up my app</b>. About five minutes.',
    esc(end.foot || 'Your students’ work stays in your own Google Drive.')));
  await wait(4500);

  await ctx.close(); await browser.close(); server.close();
  const webm = fs.readdirSync(raw).filter(f => f.endsWith('.webm')).map(f => path.join(raw, f))[0];
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm]).toString());
  const mp4 = path.join(OUT, APP + '.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', `fps=30,format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${(dur - 0.8).toFixed(2)}:d=0.8`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(raw, { recursive: true, force: true });
  console.log(`${APP}: ${mp4} (${dur.toFixed(0)} s)` + (errors.length ? `\nPage errors:\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
})().catch(e => { console.error(e.message || e); process.exit(1); });
