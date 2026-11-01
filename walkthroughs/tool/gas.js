// In-memory Apps Script for running an app's real server code in Node (used to record tour videos).
// Not a full Apps Script: enough of Sheets, Properties, HtmlService templates and friends for these apps.
// Sheets coerce numeric-looking text, booleans, and strip a leading apostrophe, like the real grid.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Like Sheets, date-looking text ("1-4", "8/17") becomes a Date unless the cell is formatted as text ('@').
function coerce(v, asText) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v === 'string') {
    if (v.charAt(0) === "'") return v.slice(1);
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
    if (!asText && /^\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?$/.test(t)) { const m = t.split(/[\/-]/).map(Number); return new Date(m[2] ? (m[2] < 100 ? 2000 + m[2] : m[2]) : 2026, m[0] - 1, m[1]); }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) return v; // ISO strings stay text (the code never writes them raw)
    return v;
  }
  return v;
}
function copyVal(v) { return v instanceof Date ? new Date(v.getTime()) : v; }

// Formatting and other calls that don't change data (setBackground, autoResizeColumns, protect, ...)
// are accepted and ignored, so any app's setup code runs.
const LENIENT = /^(set|clear|insert|auto|hide|show|merge|protect|add|remove|sort|activate|copy|apply|trim|create|uncheck|check|expand|collapse|freeze|group|shift)/;
function lenient(obj) {
  return new Proxy(obj, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && LENIENT.test(k)) return function () { return lenient(t); }; return undefined; } });
}
class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; return lenient(this); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(copyVal(this.sh.get(this.r + i, this.c + j))); out.push(row); } return out; }
  getValue() { return copyVal(this.sh.get(this.r, this.c)); }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('The number of rows/columns in the data does not match the range.');
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const v = vals[i][j];
      if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
      this.sh.set(this.r + i, this.c + j, coerce(v, this.sh.textFmt && this.sh.textFmt[(this.r + i) + ':' + (this.c + j)]));
    }
    this.sh.ss.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  getRow() { return this.r; }
  setNumberFormat(f) { if (f === '@') { this.sh.textFmt = this.sh.textFmt || {}; for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.textFmt[(this.r + i) + ':' + (this.c + j)] = 1; } return this; }
  setNumberFormats() { return this; }
  getNumRows() { return this.nr; }
  getColumn() { return this.c; }
  getDisplayValues() { return this.getValues().map(r => r.map(v => v instanceof Date ? v.toISOString() : String(v))); }
  setFontWeight() { return this; }
  setWrap() { return this; }
  createTextFinder(text) {
    const self = this; let entire = false, mc = false;
    const f = {
      matchEntireCell(b) { entire = b; return f; }, matchCase(b) { mc = b; return f; },
      findAll() {
        const out = [];
        for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) {
          const raw = self.sh.get(self.r + i, self.c + j); let s = raw instanceof Date ? raw.toString() : String(raw === '' || raw == null ? '' : raw);
          let q = String(text); if (!mc) { s = s.toLowerCase(); q = q.toLowerCase(); }
          if (entire ? s === q : s.indexOf(q) >= 0) out.push(new Range(self.sh, self.r + i, self.c + j));
        }
        return out;
      }
    };
    return f;
  }
}
class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.maxCols = 26; return lenient(this); }
  getName() { return this.name; } getSheetName() { return this.name; } getParent() { return this.ss; } getSheetId() { return this.name.length; }
  getName() { return this.name; }
  get(r, c) { const row = this.rows[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; if (c > this.maxCols) this.maxCols = c; }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => v !== '' && v != null)) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => { for (let j = r.length; j > 0; j--) if (r[j - 1] !== '' && r[j - 1] != null) { m = Math.max(m, j); break; } }); return m; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('A1 not supported in mock');
    if (r < 1 || c < 1 || (nr !== undefined && nr < 1) || (nc !== undefined && nc < 1)) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, r, c, nr, nc);
  }
  getDataRange() { this.ss.fullReads++; return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.set(r, j + 1, coerce(v, this.textFmt && this.textFmt[r + ':' + (j + 1)]))); this.ss.writes++; return this; }
  setFrozenRows() {}
  getFrozenRows() { return 1; }
  autoResizeColumns() { return this; }
  setColumnWidth() { return this; }
  hideSheet() { return this; }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  insertRowsAfter() { return this; }
  deleteRow() { throw new Error('deleteRow must never be called on student tabs'); }
}
class Spreadsheet {
  constructor(name) { this.name = name; this.id = 'ss_' + Math.random().toString(36).slice(2); this.sheets = {}; this.writes = 0; this.fullReads = 0; return lenient(this); }
  deleteSheet(sh) { delete this.sheets[sh.name]; } getSheetById(id) { return this.getSheets().find(x => x.getSheetId() === id) || null; } getActiveSheet() { return this.getSheets()[0] || null; } rename(n) { this.name = n; }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; } getName() { return this.name; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { if (this.sheets[n]) throw new Error('A sheet with the name "' + n + '" already exists.'); return (this.sheets[n] = new Sheet(this, n)); }
  getSheets() { return Object.values(this.sheets); }
}

function makeGas(opts) {
  opts = opts || {};
  const state = { user: '', spreadsheets: {}, scriptProps: {}, userProps: {}, cache: {}, appDir: opts.appDir, url: opts.url || 'https://script.google.com/a/macros/school.org/s/FAKE/exec', fetchLog: [], canvas: opts.canvas || null };
  const props = (store) => ({
    getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); return this; },
    deleteProperty: k => { delete store[k]; }, getProperties: () => Object.assign({}, store), setProperties: o => { Object.assign(store, o); },
    getKeys: () => Object.keys(store), deleteAllProperties: () => { Object.keys(store).forEach(k => delete store[k]); }
  });
  // HtmlService: real template scriptlets (<? ?>, <?= ?>, <?!= ?>), evaluated in the app's own context.
  const output = html => ({ getContent: () => html, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; },
    setSandboxMode() { return this; }, setFaviconUrl() { return this; }, setWidth() { return this; }, setHeight() { return this; }, append(x) { html += x; return this; } });
  const readHtml = name => { const f = path.join(state.appDir, name + '.html'); if (!fs.existsSync(f)) throw new Error('No HTML file named ' + name + ' was found.'); return fs.readFileSync(f, 'utf8'); };
  function compile(src) {
    let code = 'var __o=[];with(__t){', i = 0;
    const lit = t => { if (t) code += '__o.push(' + JSON.stringify(t) + ');'; };
    while (i < src.length) {
      const a = src.indexOf('<?', i); if (a < 0) { lit(src.slice(i)); break; }
      lit(src.slice(i, a)); const b = src.indexOf('?>', a); if (b < 0) { lit(src.slice(a)); break; }
      let inner = src.slice(a + 2, b); i = b + 2;
      if (inner[0] === '!' && inner[1] === '=') code += '__o.push(String((' + inner.slice(2).trim().replace(/;\s*$/, '') + ')));';
      else if (inner[0] === '=') code += '__o.push(__esc((' + inner.slice(1).trim().replace(/;\s*$/, '') + ')));';
      else code += inner + '\n';
    }
    return code + '}return __o.join("");';
  }
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const template = src => { const t = { evaluate() { const fn = state.vmRun('(function(__t,__esc){' + compile(src) + '})'); const vars = Object.assign({}, this); delete vars.evaluate; delete vars.getRawContent; return output(fn(vars, esc)); }, getRawContent: () => src }; return t; };
  const g = {
    state,
    SpreadsheetApp: {
      create: name => { const s = new Spreadsheet(name); state.spreadsheets[s.id] = s; return s; },
      // The Sheet the script is attached to (a copied app's own Sheet).
      getActiveSpreadsheet: () => { if (!state.bound) { state.bound = new Spreadsheet('App Sheet'); state.spreadsheets[state.bound.id] = state.bound; } return state.bound; },
      getActive: () => g.SpreadsheetApp.getActiveSpreadsheet(),
      getUi: () => ({ alert() {}, createMenu() { return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; }, showModalDialog() {}, showSidebar() {}, ButtonSet: {} }),
      openById: id => { const s = state.spreadsheets[id]; if (!s) throw new Error('Document ' + id + ' is missing'); return s; },
      flush: () => {}
    },
    PropertiesService: { getScriptProperties: () => props(state.scriptProps), getUserProperties: () => props(state.userProps) },
    CacheService: { getScriptCache: () => ({ get: k => state.cache[k] || null, put: (k, v) => { state.cache[k] = String(v); }, remove: k => { delete state.cache[k]; } }) },
    LockService: (() => { const mk = () => { let held = false; return { tryLock: () => (held = true), waitLock: () => { held = true; }, releaseLock: () => { held = false; }, hasLock: () => held }; }; const sl = mk(); return { getUserLock: mk, getScriptLock: () => sl, getDocumentLock: mk }; })(),
    Session: { getActiveUser: () => ({ getEmail: () => state.user }), getEffectiveUser: () => ({ getEmail: () => state.user }), getScriptTimeZone: () => 'Pacific/Honolulu' },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(), sleep: () => {},
      formatDate: (d, tz, fmt) => { const x = new Date(d.getTime() - 10 * 3600 * 1000); const p = n => String(n).padStart(2, '0'); return fmt.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate())); },
      base64Encode: s => Buffer.from(Array.isArray(s) ? Buffer.from(s.map(b => b & 255)) : String(s)).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(String(s), 'base64')).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (d, t, n) => ({ getBytes: () => (Array.isArray(d) ? d : Array.from(Buffer.from(String(d)))), getDataAsString: () => String(d), getContentType: () => t, getName: () => n, setName() { return this; } }),
      jsonStringify: JSON.stringify, jsonParse: JSON.parse
    },
    HtmlService: {
      createHtmlOutputFromFile: name => output(readHtml(name)),
      createHtmlOutput: html => output(String(html || '')),
      createTemplateFromFile: name => template(readHtml(name)),
      createTemplate: src => template(String(src)),
      XFrameOptionsMode: { ALLOWALL: 1, DEFAULT: 0 }, SandboxMode: { IFRAME: 1 }
    },
    ScriptApp: { getService: () => ({ getUrl: () => state.url }), getScriptId: () => 'demo-script', getOAuthToken: () => 'demo-token',
      newTrigger: () => ({ timeBased() { return this; }, everyMinutes() { return this; }, everyHours() { return this; }, after() { return this; }, create() { return {}; } }),
      getProjectTriggers: () => [], deleteTrigger: () => {} },
    MailApp: { sendEmail: () => {}, getRemainingDailyQuota: () => 100 },
    GmailApp: { sendEmail: () => {} },
    DocumentApp: { create: n => ({ getId: () => 'doc_' + Math.random().toString(36).slice(2), getUrl: () => 'https://docs.google.com/document/d/demo', getBody: () => ({ appendParagraph() { return { setHeading() { return this; } }; }, clear() {} }), saveAndClose() {} }), ParagraphHeading: {} },
    ContentService: { createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }), MimeType: { JSON: 'json', TEXT: 'text' } },
    UrlFetchApp: { fetch: (url, o) => { state.fetchLog.push({ url, o }); if (state.canvas) return state.canvas(url, o || {}); return { getResponseCode: () => 404, getContentText: () => '{}', getHeaders: () => ({}) }; } },
    DriveApp: { getRootFolder: () => ({}), createFolder: n => ({ getId: () => 'fold1', setSharing(){} }), getFolderById: id => ({ createFile: () => ({ getId: () => 'f' + Math.random(), setSharing(){} }) }), getFileById: id => ({ getBlob: () => ({ getBytes: () => [] , getContentType: () => 'image/jpeg' }), setSharing(){} , moveTo(){}, setTrashed(){} }), Access: {}, Permission: {} },
    Logger: { log: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };
  return g;
}

/** Loads the app's server files into one VM context with the mock globals. */
function loadServer(appDir, gas, files) {
  const vm = require('vm');
  const ctx = vm.createContext(Object.assign({ Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Symbol, Map, Set, WeakMap, encodeURIComponent, decodeURIComponent, escape, unescape, isNaN, isFinite, parseInt, parseFloat, Intl, Promise, Buffer }, gas));
  ctx.globalThis = ctx;
  gas.state.vmRun = code => vm.runInContext(code, ctx);
  (files || fs.readdirSync(appDir).filter(f => /\.js$/.test(f))).forEach(f => vm.runInContext(fs.readFileSync(path.join(appDir, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
module.exports = { makeGas, loadServer, coerce };
