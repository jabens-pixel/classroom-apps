// Runs an app's real server code in Node (gas.js) and serves its real page, with google.script.run
// answered by that server code. Used by record.js; also handy for trying an app without Google.
//   node server.js <appDir> [port] [resetCode]
//   page: /?user=<email>      rpc: POST /rpc {fn, args, user}      setup: POST /__eval {code, user}, GET /__reset
'use strict';
const http = require('http');
const vm = require('vm');
const { makeGas, loadServer } = require('./gas');

function start(appDir, port, resetCode) {
  let gas, ctx;
  const boot = () => { gas = makeGas({ appDir }); ctx = loadServer(appDir, gas); };
  boot();
  // Every google.script.run call is a fresh execution in Apps Script: module-level caches start empty.
  const reset = () => { if (resetCode) vm.runInContext(resetCode, ctx); };
  const hasDate = (v, d) => { d = d || 0; if (d > 40 || v == null) return false; if (Object.prototype.toString.call(v) === '[object Date]') return true; return typeof v === 'object' && Object.keys(v).some(k => hasDate(v[k], d + 1)); };
  function call(fn, args, user) {
    gas.state.user = user || ''; reset();
    if (typeof ctx[fn] !== 'function' || /_$/.test(fn)) throw new Error('Script function not found: ' + fn);
    const out = ctx[fn].apply(null, args || []);
    if (hasDate(out)) return { __blanked: true };   // a raw Date blanks the whole response in Apps Script
    return out == null ? null : JSON.parse(JSON.stringify(out));
  }
  function page(user) {
    gas.state.user = user || ''; reset();
    const html = ctx.doGet({ parameter: {}, parameters: {} }).getContent();
    const mock = `<script>(function(){
  var q = new URLSearchParams(location.search), user = q.get('user') || '';
  function chain(){
    var ok = function(){}, fail = function(e){ console.error(e); }, uo;
    var api = new Proxy({}, { get: function(_, name){
      if (name === 'withSuccessHandler') return function(f){ ok = f; return api; };
      if (name === 'withFailureHandler') return function(f){ fail = f; return api; };
      if (name === 'withUserObject') return function(o){ uo = o; return api; };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: name, args: args, user: user }) })
          .then(function(r){ return r.json(); })
          .then(function(j){ if (j.error) fail(new Error(j.error), uo); else ok(j.blanked ? null : j.value, uo); })
          .catch(function(e){ fail(e, uo); });
      };
    }});
    return api;
  }
  window.google = { script: { run: new Proxy({}, { get: function(_, name){ return chain()[name]; } }),
    host: { close: function(){}, setHeight: function(){}, setWidth: function(){}, editor: { focus: function(){} } },
    url: { getLocation: function(cb){ cb({ parameter: {}, parameters: {}, hash: '' }); } },
    history: { push: function(){}, replace: function(){}, setChangeHandler: function(){} } } };
})();</script>`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + mock) : mock + html;
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
        res.setHeader('Content-Type', 'application/json');
        if (u.pathname === '/rpc') {
          try { const v = call(j.fn, j.args, j.user); res.end(JSON.stringify(v && v.__blanked ? { blanked: true } : { value: v })); }
          catch (e) { res.end(JSON.stringify({ error: String(e && e.message || e) })); }
          return;
        }
        if (u.pathname === '/__eval') {
          try { gas.state.user = j.user || ''; reset(); const v = vm.runInContext('(function(){' + j.code + '})()', ctx); res.end(JSON.stringify({ value: v === undefined ? null : v })); }
          catch (e) { res.end(JSON.stringify({ error: String(e && e.stack || e) })); }
          return;
        }
        res.statusCode = 404; res.end('{}');
      });
      return;
    }
    if (u.pathname === '/__reset') { boot(); res.end('ok'); return; }
    if (u.pathname === '/' || u.pathname === '/exec') {
      try { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(u.searchParams.get('user'))); }
      catch (e) { res.statusCode = 500; res.end('<pre>' + String(e && e.stack || e) + '</pre>'); }
      return;
    }
    res.statusCode = 404; res.end('not found');
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

module.exports = { start };
if (require.main === module) {
  const path = require('path');
  start(path.resolve(process.argv[2]), Number(process.argv[3] || 8787), process.argv[4] || '').then(() => console.log('serving ' + process.argv[2]));
}
