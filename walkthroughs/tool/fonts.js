// Serves Google Fonts from local @fontsource packages, so videos use the app's real fonts even
// where fonts.googleapis.com can't be reached. Packages are installed into tool/node_modules on first use.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOOL = __dirname;
const tried = {};
function pkgDir(family) {
  const pkg = '@fontsource/' + family.trim().toLowerCase().replace(/\s+/g, '-');
  const dir = path.join(TOOL, 'node_modules', pkg);
  if (!fs.existsSync(dir) && !tried[pkg]) {
    tried[pkg] = true;
    try { execSync('npm install --no-save --silent ' + pkg, { cwd: TOOL, stdio: 'ignore', timeout: 120000 }); } catch (e) {}
  }
  return fs.existsSync(path.join(dir, 'files')) ? { pkg, dir } : null;
}
function families(url) {
  const u = new URL(url), out = [];
  u.searchParams.getAll('family').forEach(f => f.split('|').forEach(x => out.push(x.split(':')[0].replace(/\+/g, ' '))));
  return out;
}
function css(url) {
  let text = '';
  families(url).forEach(fam => {
    const p = pkgDir(fam); if (!p) return;
    fs.readdirSync(path.join(p.dir, 'files')).filter(f => /-latin-(\d+)-(normal|italic)\.woff2$/.test(f)).forEach(f => {
      const [, w, st] = f.match(/-latin-(\d+)-(normal|italic)\.woff2$/);
      text += `@font-face{font-family:'${fam}';font-style:${st};font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/__local/${p.pkg.replace('@fontsource/', '')}/${f}) format('woff2');}\n`;
    });
  });
  return text;
}
/** Hooks a Playwright page or context so Google Fonts load from the local packages. */
async function useLocalFonts(target) {
  await target.route(/https:\/\/fonts\.googleapis\.com\/.*/, r => r.fulfill({ status: 200, contentType: 'text/css', body: css(r.request().url()) }));
  await target.route(/https:\/\/fonts\.gstatic\.com\/.*/, r => {
    const m = r.request().url().match(/__local\/([^/]+)\/([^/?]+)/);
    const f = m && path.join(TOOL, 'node_modules', '@fontsource', m[1], 'files', m[2]);
    if (f && fs.existsSync(f)) return r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) });
    return r.fulfill({ status: 404, body: '' });
  });
}
/** A data: URL @font-face block for the title cards. */
function cardFonts() {
  const one = (fam, w) => { const p = pkgDir(fam); if (!p) return ''; const f = path.join(p.dir, 'files', p.pkg.replace('@fontsource/', '') + '-latin-' + w + '-normal.woff2'); return fs.existsSync(f) ? `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')})}` : ''; };
  return one('Literata', 500) + one('Literata', 700) + one('Source Sans 3', 400) + one('Source Sans 3', 600);
}
module.exports = { useLocalFonts, cardFonts };
