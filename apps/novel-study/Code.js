// ============================================================================
// Novel Study -- server core.
// One book, one weekly routine (Read · Evidence · Quiz · Respond · Discuss),
// books borrowed in Sora (OverDrive). This app never stores or ships book text:
// students read in Sora; the app holds their thinking about it.
//
// Setup (once, from the Apps Script editor, signed in with your school account):
//   1. Run setupNovelStudy  -> makes the backend Sheet and makes you admin.
//   2. Optional: Project Settings > Script Properties > GEMINI_API_KEY (AI drafts).
//   3. Optional: LMS_HUB_URL, LMS_HUB_KEY, LMS_HUB_ENABLED=true (Canvas through the hub).
//   4. Deploy > New deployment > Web app (Execute as: Me, Who has access: anyone at school).
//
// Files: Code (this), Grading, Canvas, NovelStudyLmsHub, LmsHub (shared -- never edit),
// AI, Index (page shell), Student, SaveGuard, WritingStats, Teacher, Marking, NovelTheme (last).
// ============================================================================

var NV_APP_VERSION = '2026-10-23a';
var NV_DB_PROP = 'NOVEL_STUDY_DB_ID';
var NV_LIVE_VERSION_PROP = 'NOVEL_STUDY_LIVE_VERSION';
var NV_DEMO_DOMAIN = 'demo.novelstudy.local';

// Editor tools: type a student's email here, then run listWorkBackups / restoreWorkBackup.
var RESTORE_STUDENT = '';
var RESTORE_ROW = '';

var NV_SHEETS = {
  Users:       ['Email', 'Name', 'Role', 'Status', 'CreatedAt', 'UpdatedAt'],
  Classes:     ['ClassId', 'TeacherEmail', 'ClassName', 'Period', 'JoinCode', 'SettingsJson', 'Active', 'CreatedAt', 'UpdatedAt'],
  Enroll:      ['ClassId', 'Email', 'Name', 'JoinedAt', 'Active'],
  Studies:     ['ClassId', 'StudyId', 'UpdatedAt', 'UpdatedBy', 'DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5'],
  // One row per student per week per item (evidence / response). Draft = latest typing;
  // Sub = the copy the student turned in (what the teacher grades).
  Work:        ['ClassId', 'Email', 'Week', 'Kind', 'UpdatedAt', 'SubmittedAt', 'SubFp', 'DataJson', 'DataJson2', 'DataJson3', 'SubJson', 'SubJson2', 'SubJson3'],
  Quiz:        ['ClassId', 'Email', 'Week', 'AnswersJson', 'Score', 'Max', 'StartedAt', 'SubmittedAt', 'UpdatedAt', 'ActId'],
  Discuss:     ['PostId', 'ClassId', 'Week', 'Email', 'Name', 'ParentId', 'Text', 'CreatedAt', 'EditedAt', 'ClientId', 'ActId'],
  Progress:    ['ClassId', 'Email', 'BorrowedAt', 'ReadingJson', 'UpdatedAt'],
  Grades:      ['ClassId', 'Email', 'ItemKey', 'Score', 'Excluded', 'Comment', 'GradedBy', 'GradedAt', 'MarkedFp', 'CanvasPostedScore', 'CanvasCommentFp'],
  WritingStats:['ClassId', 'Email', 'ItemKey', 'StatsJson', 'UpdatedAt'],
  Resume:      ['ClassId', 'Email', 'RouteJson', 'UpdatedAt'],
  WorkBackups: ['ClassId', 'Email', 'Week', 'Kind', 'SavedAt', 'Reason', 'Chars', 'DataJson', 'DataJson2', 'DataJson3'],
  // Teacher guide for each unit (GuideData.js): the AI/teacher notes and how many class sessions the unit runs.
  Guides:      ['ClassId', 'Unit', 'GuideJson', 'Sessions', 'UpdatedAt', 'UpdatedBy']
};

var NV_MAX_UNITS = 40;   // weeks, arcs or days

// ============================================================================
// WEB APP
// ============================================================================

function doGet() {
  nvRegisterLiveVersion_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Novel Study')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Splices another file into Index. A missing file becomes a visible warning, never a blank page. */
function include_(name) {
  try { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
  catch (e) { return '<div class="nv-missing" role="alert">This page is missing the file “' + name + '”. Ask your teacher to check the app (checkFiles in the editor).</div>'; }
}

// ---------- versions ----------

function nvVersionParts_(v) {
  var t = String(v || '').trim().toLowerCase(), m = /^(\d{4}-\d{2}-\d{2})([a-z]*)$/.exec(t);
  if (!m) return { date: t, n: 0 };
  var n = 0; for (var i = 0; i < m[2].length; i++) n = n * 26 + (m[2].charCodeAt(i) - 96);
  return { date: m[1], n: n };
}
function nvCompareVersions_(a, b) {
  var x = nvVersionParts_(a), y = nvVersionParts_(b);
  if (x.date !== y.date) return x.date < y.date ? -1 : 1;
  return x.n === y.n ? 0 : (x.n < y.n ? -1 : 1);
}
function nvRegisterLiveVersion_() {
  try {
    // The editor's /dev test link never moves the marker: only a deployed /exec build does.
    var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
    if (/\/dev(\?|$)/.test(url)) return;
    var p = PropertiesService.getScriptProperties(), live = p.getProperty(NV_LIVE_VERSION_PROP) || '';
    if (!live || nvCompareVersions_(NV_APP_VERSION, live) > 0) p.setProperty(NV_LIVE_VERSION_PROP, NV_APP_VERSION);
  } catch (e) {}
}
function nvLiveVersion_() { try { return PropertiesService.getScriptProperties().getProperty(NV_LIVE_VERSION_PROP) || NV_APP_VERSION; } catch (e) { return NV_APP_VERSION; } }
function getAppVersion() {
  var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return { ok: true, version: nvLiveVersion_(), serverBuild: NV_APP_VERSION, url: url };
}

// ============================================================================
// SETUP
// ============================================================================

function setupNovelStudy() {
  var email = nvSessionEmail_();
  if (!email) throw new Error('No school email was detected. Run setup while signed in with your school Google account.');
  var p = PropertiesService.getScriptProperties(), id = p.getProperty(NV_DB_PROP);
  if (id) {
    // Never makes a second database: an existing one is reopened (and only an admin may run this again).
    nvDb_();
    var u = nvUser_(email);
    if (!u || u.Role !== 'admin') throw new Error('Novel Study is already set up. Only an admin can run setup again.');
  } else {
    var ss = SpreadsheetApp.create('Novel Study - Backend');
    p.setProperty(NV_DB_PROP, ss.getId());
    NV_X_.ss = ss;
  }
  Object.keys(NV_SHEETS).forEach(function (k) { nvSheet_(k); });
  nvUpsertUser_(email, nvNameFromEmail_(email), 'admin', 'active');
  var ssOut = nvDb_();
  Logger.log('Novel Study backend: ' + ssOut.getUrl());
  return { ok: true, spreadsheetUrl: ssOut.getUrl(), admin: email };
}

// ============================================================================
// SHEET HELPERS (header-driven; rows found with TextFinder; one setValues per write)
// ============================================================================

var NV_X_ = { ss: null, sheets: {}, headers: {}, users: null, classes: null, scriptLocked: false };

function nvDb_() {
  if (NV_X_.ss) return NV_X_.ss;
  var id = PropertiesService.getScriptProperties().getProperty(NV_DB_PROP);
  if (!id) throw new Error('Novel Study is not set up yet. Your teacher needs to run setupNovelStudy once from the Apps Script editor.');
  // A brief Sheets timeout must never send the app to a new, empty database: retry, then give a retryable error.
  for (var i = 0; i < 3; i++) {
    try { NV_X_.ss = SpreadsheetApp.openById(id); return NV_X_.ss; } catch (e) { if (i < 2) Utilities.sleep(400 * (i + 1)); }
  }
  throw new Error('The class database is busy right now. Please try again in a moment. (Nothing was lost.)');
}
function nvSheet_(name) {
  if (NV_X_.sheets[name]) return NV_X_.sheets[name];
  var headers = NV_SHEETS[name], ss = nvDb_(), sh = ss.getSheetByName(name);
  if (!sh) {
    try { sh = ss.insertSheet(name); }
    catch (e) { sh = ss.getSheetByName(name); if (!sh) throw e; }   // another call made it a moment ago
  }
  if (sh.getLastColumn() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    // New columns are appended at the END; nothing is ever reordered.
    var last = Math.max(1, sh.getLastColumn());
    var have = sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) {
      var start = have.length; while (start > 0 && !have[start - 1]) start--;
      if (sh.getMaxColumns() < start + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - sh.getMaxColumns());
      sh.getRange(1, start + 1, 1, missing.length).setValues([missing]);
    }
  }
  NV_X_.sheets[name] = sh;
  delete NV_X_.headers[name];
  return sh;
}
function nvHeaders_(sh) {
  var n = sh.getName();
  if (!NV_X_.headers[n]) NV_X_.headers[n] = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h || '').trim(); });
  return NV_X_.headers[n];
}
function nvCol_(sh, h) { return nvHeaders_(sh).indexOf(h) + 1; }
/** Row numbers whose `header` cell equals `value` (TextFinder: a big tab is never downloaded to find one student). */
function nvFindRowNums_(sh, header, value) {
  var col = nvCol_(sh, header), last = sh.getLastRow();
  if (!col || last < 2 || value === '' || value == null) return [];
  return sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(false).findAll()
    .map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; });
}
function nvReadRows_(sh, nums) {
  var h = nvHeaders_(sh);
  return (nums || []).map(function (r) {
    var v = sh.getRange(r, 1, 1, h.length).getValues()[0], o = { _row: r };
    h.forEach(function (k, i) { if (k) o[k] = v[i]; });
    return o;
  });
}
function nvAllRows_(sh) {
  var last = sh.getLastRow(), h = nvHeaders_(sh);
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, h.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var any = false, o = { _row: i + 2 };
    for (var j = 0; j < h.length; j++) { if (h[j]) o[h[j]] = vals[i][j]; if (vals[i][j] !== '' && vals[i][j] !== null) any = true; }
    if (any) out.push(o);
  }
  return out;
}
/** Only some columns of a tab (tile counts skip the big JSON cells). */
function nvReadColumns_(sh, names) {
  var last = sh.getLastRow(); if (last < 2) return [];
  var n = last - 1, cols = {};
  names.forEach(function (h) { var c = nvCol_(sh, h); cols[h] = c ? sh.getRange(2, c, n, 1).getValues() : null; });
  var out = [];
  for (var i = 0; i < n; i++) {
    var o = { _row: i + 2 }, any = false;
    names.forEach(function (h) { var v = cols[h] ? cols[h][i][0] : ''; o[h] = v; if (v !== '' && v !== null) any = true; });
    if (any) out.push(o);
  }
  return out;
}
var NV_CELL_MAX = 49500;
function nvRowValues_(sh, obj) {
  return nvHeaders_(sh).map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return v;
    v = nvText_(v);
    if (v.length > NV_CELL_MAX) throw new Error('This is too long to save: one box holds at most ' + NV_CELL_MAX.toLocaleString() + ' characters and this has ' + v.length.toLocaleString() + '. Please shorten it. Nothing was changed.');
    return v;
  });
}
function nvWriteRow_(sh, rowNum, obj) { var v = nvRowValues_(sh, obj); sh.getRange(rowNum, 1, 1, v.length).setValues([v]); }
function nvAppend_(sh, obj) { sh.appendRow(nvRowValues_(sh, obj)); }

/**
 * Upsert one row by keys. Finds the student's rows with TextFinder on `findHeader`, takes the LAST
 * match, re-reads it right before writing (its keys must still match), and carries over every column
 * this save doesn't set. `fields` may be a function (freshRowOrNull, now) -> fields, so merges are made
 * from the newest copy. Returning null from it writes nothing.
 */
function nvUpsert_(sheetName, findHeader, keys, fields, opts) {
  opts = opts || {};
  var sh = nvSheet_(sheetName);
  function matches(r) { return Object.keys(keys).every(function (k) { return nvNorm_(r[k]) === nvNorm_(keys[k]); }); }
  function run() {
    for (var attempt = 0; attempt < 2; attempt++) {
      var recs = nvReadRows_(sh, nvFindRowNums_(sh, findHeader, keys[findHeader])).filter(matches);
      var now = new Date();
      if (!recs.length) {
        var f0 = typeof fields === 'function' ? fields(null, now) : fields;
        if (!f0) return { written: false, record: null, now: now };
        var fresh = {}; Object.keys(keys).forEach(function (k) { fresh[k] = keys[k]; }); Object.keys(f0).forEach(function (k) { fresh[k] = f0[k]; });
        nvAppend_(sh, fresh);
        return { written: true, created: true, record: fresh, now: now };
      }
      var rowNum = recs[recs.length - 1]._row, check = nvReadRows_(sh, [rowNum])[0];
      if (!check || !matches(check)) continue;
      now = new Date();
      var f = typeof fields === 'function' ? fields(check, now) : fields;
      if (!f) return { written: false, record: check, now: now };
      var merged = {}; Object.keys(check).forEach(function (k) { if (k !== '_row') merged[k] = check[k]; });
      Object.keys(f).forEach(function (k) { merged[k] = f[k]; });
      nvWriteRow_(sh, rowNum, merged);
      return { written: true, record: merged, previous: check, now: now };
    }
    throw new Error('Your work could not be saved because the sheet was being reorganized. Please try again.');
  }
  return opts.atomic ? nvRowCritical_(run) : run();
}
function nvFindOne_(sheetName, findHeader, keys) {
  var sh = nvSheet_(sheetName);
  var recs = nvReadRows_(sh, nvFindRowNums_(sh, findHeader, keys[findHeader])).filter(function (r) {
    return Object.keys(keys).every(function (k) { return nvNorm_(r[k]) === nvNorm_(keys[k]); });
  });
  return recs.length ? recs[recs.length - 1] : null;
}

// ---------- locks ----------
// The app runs as its owner, so getUserLock() is ONE lock for the whole class: best-effort only.
function nvUserLock_(fn) {
  var lock = null, held = false;
  try { lock = LockService.getUserLock(); held = lock.tryLock(6000); } catch (e) { held = false; }
  try { return fn(); } finally { if (held) { try { lock.releaseLock(); } catch (e2) {} } }
}
/** Short critical section around one shared row's re-read + write. Re-entrant. */
function nvRowCritical_(fn) {
  if (NV_X_.scriptLocked) return fn();
  var lock = null, held = false;
  try { lock = LockService.getScriptLock(); held = lock.tryLock(15000); } catch (e) { held = false; }
  if (held) NV_X_.scriptLocked = true;
  try { return fn(); } finally { if (held) { NV_X_.scriptLocked = false; try { lock.releaseLock(); } catch (e2) {} } }
}
/** Teacher-wide tools and class settings. Kept short; re-entrant. */
function nvWithLock_(fn) {
  if (NV_X_.scriptLocked) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The class sheet is busy. Please try again in a moment.');
  NV_X_.scriptLocked = true;
  try { return fn(); } finally { NV_X_.scriptLocked = false; lock.releaseLock(); }
}

// ---------- values ----------

function nvNorm_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function nvTruthy_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function nvParse_(v, fb) { try { return (v && typeof v === 'object') ? v : JSON.parse(String(v || '')); } catch (e) { return fb; } }
function nvClean_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n || 4000); }
function nvIso_(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  var d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString();
}
function nvLater_(a, b) { var x = new Date(a || ''), y = new Date(b || ''); return !isNaN(x.getTime()) && !isNaN(y.getTime()) && x.getTime() > y.getTime() + 1000; }
/** A raw Date anywhere in a google.script.run response blanks the whole response. */
function nvCellText_(v) {
  if (v instanceof Date) return v.toISOString();
  return v || v === 0 ? String(v) : '';
}
/** Typed text stays text: Sheets would turn "7/7", "=)", "10/10" into dates, formulas, numbers. */
function nvText_(v) {
  var s = String(v == null ? '' : v); if (!s) return '';
  var t = s.trim();
  if (/^[=+\-@']/.test(s) || /^-?[\d.,\s]+%?$/.test(t) || /^(true|false)$/i.test(t) || /^\d{1,4}[\/.\-]\d{1,2}([\/.\-]\d{1,4})?(\s|$)/.test(t) ||
      /^\d{1,2}:\d{2}/.test(t) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i.test(t)) return "'" + s;
  return s;
}
function nvMd5_(t) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(t), Utilities.Charset.UTF_8)
    .map(function (b) { var h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}
function nvStable_(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(nvStable_).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return k.charAt(0) !== '_'; }).map(function (k) { return JSON.stringify(k) + ':' + nvStable_(v[k]); }).join(',') + '}';
  if (typeof v === 'string') return JSON.stringify(v.replace(/\s+/g, ' ').trim());
  return JSON.stringify(v);
}
var NV_BLANK_FP = 'fp:empty';
function nvFp_(text) { var t = String(text || ''); if (!t || t === '{}' || t === '[]' || t === '""') return NV_BLANK_FP; return 'fp:' + t.length + ':' + nvMd5_(t).slice(0, 10); }

// ---------- big JSON cells ----------
// A cell stops at 50,000 characters. JSON is split across <base>, <base>2, <base>3 (45,000 each).
// Continuation chunks get a zero-width-space prefix so they can never parse as formulas.
var NV_CHUNK = 45000;
function nvSplit_(base, n, json) {
  json = String(json || '');
  var parts = [], i = 0;
  while (i < json.length) {
    var end = Math.min(json.length, i + NV_CHUNK), code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xD800 && code <= 0xDBFF) end--;  // keep an emoji in one piece
    parts.push(json.substring(i, end)); i = end;
  }
  if (parts.length > n) throw new Error('This is too long to save (' + Math.round(json.length / 1000) + 'k characters). Please shorten it. Nothing was changed.');
  var out = {};
  for (var k = 0; k < n; k++) { var col = k ? base + (k + 1) : base; out[col] = parts[k] ? (k ? '​' + parts[k] : parts[k]) : ''; }
  return out;
}
function nvJoin_(rec, base, n) {
  var s = String(rec[base] == null ? '' : rec[base]);
  for (var k = 1; k < n; k++) { var p = rec[base + (k + 1)]; if (p === '' || p == null) break; s += String(p).replace(/^​/, ''); }
  return s;
}
/** Unreadable is not empty: a chunk set that doesn't reassemble says so instead of becoming {}. */
function nvParseChunks_(rec, base, n) {
  if (!rec) return {};
  var s = nvJoin_(rec, base, n);
  if (!s) return {};
  try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch (e) { return { _unreadable: true, _chars: s.length }; }
}

// ============================================================================
// IDENTITY AND ROLES
// ============================================================================

function nvSessionEmail_() { try { return nvNorm_(Session.getActiveUser().getEmail()); } catch (e) { return ''; } }
function nvNameFromEmail_(e) {
  var p = String(e || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return p.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || 'Student';
}
function nvIsDemo_(email) { return new RegExp('@' + NV_DEMO_DOMAIN.replace(/\./g, '\\.') + '$').test(nvNorm_(email)); }
function nvUsers_() { if (!NV_X_.users) NV_X_.users = nvAllRows_(nvSheet_('Users')); return NV_X_.users; }
function nvUser_(email) { var e = nvNorm_(email); return nvUsers_().filter(function (u) { return nvNorm_(u.Email) === e; }).pop() || null; }
function nvUpsertUser_(email, name, role, status) {
  nvUpsert_('Users', 'Email', { Email: nvNorm_(email) }, function (r, now) {
    return { Name: name || (r && r.Name) || nvNameFromEmail_(email), Role: role, Status: status, UpdatedAt: now, CreatedAt: r ? r.CreatedAt : now };
  }, { atomic: true });
  NV_X_.users = null;
}
function nvRoleOf_(email) {
  var u = nvUser_(email);
  if (u && String(u.Status) === 'active' && (u.Role === 'teacher' || u.Role === 'admin')) return u.Role;
  return 'student';
}
function nvRequireTeacher_() {
  var e = nvSessionEmail_(), role = nvRoleOf_(e);
  if (!e || role === 'student') throw new Error('Teacher access required. Ask the Novel Study admin to add your school email.');
  return { email: e, role: role, isAdmin: role === 'admin' };
}
function nvRequireAdmin_() { var t = nvRequireTeacher_(); if (!t.isAdmin) throw new Error('Admin access required.'); return t; }

var NV_TEACHER_VIEW_MSG = 'Teacher view is read-only: this student’s work was not changed. (Open a demo student to try saving.)';

/**
 * Who a student call acts for. Normally the signed-in account. A teacher of the class may open a
 * student's pages: demo students are fully usable; a real student's pages are read-only (the student
 * may be writing in their own tab right now). A teacher using the Student view acts as themself.
 */
function nvActing_(classId, as, write) {
  var session = nvSessionEmail_();
  if (!session) throw new Error('Sign in with your school Google account first.');
  var klass = nvClass_(classId);
  if (!klass || !nvTruthy_(klass.Active)) throw new Error('This class is unavailable.');
  var target = nvNorm_(as) || session;
  if (target === session) {
    var role = nvRoleOf_(session);
    var enrolled = nvEnrollment_(classId, session);
    var teaches = role !== 'student' && (role === 'admin' || nvNorm_(klass.TeacherEmail) === session);
    if (!enrolled && !teaches) throw new Error('You are not in this class. Join it with the class code from your teacher.');
    return { email: session, name: enrolled ? String(enrolled.Name) : nvNameFromEmail_(session), klass: klass, self: true, teacherSelf: !enrolled && teaches };
  }
  var t = nvRoleOf_(session);
  if (t === 'student' || (t !== 'admin' && nvNorm_(klass.TeacherEmail) !== session)) throw new Error('You are signed in as ' + session + ', so you can only open that account’s work.');
  var en = nvEnrollment_(classId, target);
  if (!en) throw new Error('That student is not in this class.');
  if (write && !nvIsDemo_(target)) throw new Error(NV_TEACHER_VIEW_MSG);
  return { email: target, name: String(en.Name), klass: klass, self: false, demo: nvIsDemo_(target), readOnly: !nvIsDemo_(target) };
}

// ============================================================================
// CLASSES AND ENROLLMENT
// ============================================================================

function nvClasses_() { if (!NV_X_.classes) NV_X_.classes = nvAllRows_(nvSheet_('Classes')); return NV_X_.classes; }
function nvClass_(id) { return nvClasses_().filter(function (c) { return String(c.ClassId) === String(id); }).pop() || null; }
function nvDefaultSettings_() {
  return { release: {}, due: {}, noGrade: {}, canvas: { courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: '', assignments: {} } };
}
function nvSettingsOf_(klass) {
  var raw = nvParse_(klass && klass.SettingsJson, null);
  if (klass && klass.SettingsJson && !raw) return { _unreadable: true };
  var s = Object.assign(nvDefaultSettings_(), raw || {});
  ['release', 'due', 'noGrade'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
  s.canvas = Object.assign(nvDefaultSettings_().canvas, s.canvas || {});
  s.canvas.assignments = s.canvas.assignments || {};
  return s;
}
/** Class settings change only under the lock, from a fresh read, never replaced with defaults. */
function nvUpdateSettings_(classId, fn) {
  return nvWithLock_(function () {
    NV_X_.classes = null;
    var out = null;
    nvUpsert_('Classes', 'ClassId', { ClassId: classId }, function (r, now) {
      if (!r) throw new Error('Class not found.');
      var s = nvSettingsOf_(r);
      if (s._unreadable) throw new Error('This class’s settings could not be read, so nothing was changed. Tell the app’s admin.');
      fn(s, r);
      var json = JSON.stringify(s);
      if (json.length > 48000) throw new Error('This class has too many settings to save. Nothing was changed.');
      out = s;
      return { SettingsJson: json, UpdatedAt: now };
    });
    NV_X_.classes = null;
    return out;
  });
}
function nvTeacherClass_(classId) {
  var t = nvRequireTeacher_(), k = nvClass_(classId);
  if (!k || !nvTruthy_(k.Active)) throw new Error('Class not found.');
  if (!t.isAdmin && nvNorm_(k.TeacherEmail) !== t.email) throw new Error('You do not manage this class.');
  return { teacher: t, klass: k, settings: nvSettingsOf_(k) };
}
function nvPublicClass_(k, forTeacher) {
  var o = { classId: String(k.ClassId), className: nvCellText_(k.ClassName), period: nvCellText_(k.Period), teacherEmail: nvNorm_(k.TeacherEmail) };
  if (forTeacher) o.joinCode = String(k.JoinCode);
  return o;
}
function nvEnrollAll_() { if (!NV_X_.enroll) NV_X_.enroll = nvAllRows_(nvSheet_('Enroll')); return NV_X_.enroll; }
function nvEnrollment_(classId, email) {
  var e = nvNorm_(email);
  return nvEnrollAll_().filter(function (r) { return String(r.ClassId) === String(classId) && nvNorm_(r.Email) === e && nvTruthy_(r.Active); }).pop() || null;
}
/** Enrolled students, sorted by last name. Demo students are kept (marked) so teachers can try flows. */
function nvRoster_(classId) {
  var seen = {}, out = [];
  nvEnrollAll_().forEach(function (r) {
    if (String(r.ClassId) !== String(classId) || !nvTruthy_(r.Active)) return;
    var e = nvNorm_(r.Email); if (seen[e]) return; seen[e] = true;
    out.push({ email: e, name: nvCellText_(r.Name) || nvNameFromEmail_(e), demo: nvIsDemo_(e) });
  });
  return out.sort(function (a, b) { return nvSortName_(a.name).localeCompare(nvSortName_(b.name)); });
}
function nvSortName_(n) { var p = String(n).trim().split(/\s+/); return (p.length > 1 ? p[p.length - 1] + ' ' + p.slice(0, -1).join(' ') : p[0]).toLowerCase(); }
function nvJoinCode_() {
  var used = {}; nvClasses_().forEach(function (c) { used[String(c.JoinCode).toUpperCase()] = true; });
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (var t = 0; t < 60; t++) { var s = ''; for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); if (!used[s]) return s; }
  return Utilities.getUuid().slice(0, 6).toUpperCase();
}

function createClass(payload) {
  var t = nvRequireTeacher_(); payload = payload || {};
  var name = nvClean_(payload.className, 120).trim();
  if (!name) throw new Error('Give the class a name.');
  var id = Utilities.getUuid(), now = new Date();
  nvWithLock_(function () {
    nvAppend_(nvSheet_('Classes'), { ClassId: id, TeacherEmail: t.email, ClassName: name, Period: nvClean_(payload.period, 30).trim(), JoinCode: nvJoinCode_(),
      SettingsJson: JSON.stringify(nvDefaultSettings_()), Active: true, CreatedAt: now, UpdatedAt: now });
  });
  NV_X_.classes = null;
  return { ok: true, classId: id, classes: nvTeacherClasses_(t) };
}
function renameClass(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var name = nvClean_(payload.className, 120).trim(); if (!name) throw new Error('Give the class a name.');
  nvWithLock_(function () { nvUpsert_('Classes', 'ClassId', { ClassId: ctx.klass.ClassId }, { ClassName: name, Period: nvClean_(payload.period, 30).trim(), UpdatedAt: new Date() }); });
  NV_X_.classes = null;
  return { ok: true, classes: nvTeacherClasses_(ctx.teacher) };
}
function nvTeacherClasses_(t) {
  return nvClasses_().filter(function (c) { return nvTruthy_(c.Active) && (t.isAdmin || nvNorm_(c.TeacherEmail) === t.email); }).map(function (c) {
    var o = nvPublicClass_(c, true), st = nvStudyOf_(c.ClassId); o.bookTitle = st && st.book ? st.book.title : ''; return o;
  });
}
function nvStudentClasses_(email) {
  var ids = {}; nvEnrollAll_().forEach(function (r) { if (nvNorm_(r.Email) === nvNorm_(email) && nvTruthy_(r.Active)) ids[r.ClassId] = true; });
  return nvClasses_().filter(function (c) { return ids[c.ClassId] && nvTruthy_(c.Active); }).map(function (c) {
    var o = nvPublicClass_(c, false), st = nvStudyOf_(c.ClassId); o.bookTitle = st && st.book ? st.book.title : ''; return o;
  });
}
function nvCleanNamePart_(v, label) {
  var s = nvClean_(v, 40).replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Type your ' + label + '.');
  if (!/[A-Za-zÀ-ɏ]/.test(s)) throw new Error('Type your real ' + label + '.');
  return s;
}
function joinClass(payload) {
  payload = payload || {};
  var email = nvSessionEmail_(); if (!email) throw new Error('Sign in with your school Google account first.');
  var code = String(payload.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw new Error('Type the class code from your teacher.');
  var name = nvCleanNamePart_(payload.firstName, 'first name') + ' ' + nvCleanNamePart_(payload.lastName, 'last name');
  var k = nvClasses_().filter(function (c) { return String(c.JoinCode).toUpperCase() === code && nvTruthy_(c.Active); }).pop();
  if (!k) throw new Error('That class code wasn’t found. Check it with your teacher.');
  nvUserLock_(function () {
    if (!nvEnrollment_(k.ClassId, email)) nvAppend_(nvSheet_('Enroll'), { ClassId: k.ClassId, Email: email, Name: name, JoinedAt: new Date(), Active: true });
  });
  NV_X_.enroll = null;
  return { ok: true, classId: String(k.ClassId), classes: nvStudentClasses_(email) };
}
function removeStudent(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), e = nvNorm_(payload.email);
  // Never delete rows: the enrollment is switched off and every piece of work is kept.
  nvWithLock_(function () { nvUpsert_('Enroll', 'Email', { ClassId: ctx.klass.ClassId, Email: e }, function (r) { return r ? { Active: false } : null; }); });
  NV_X_.enroll = null;
  return { ok: true };
}
function renameStudent(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), e = nvNorm_(payload.email);
  var name = nvClean_(payload.name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Type a name.');
  nvWithLock_(function () { nvUpsert_('Enroll', 'Email', { ClassId: ctx.klass.ClassId, Email: e }, function (r) { return r ? { Name: name } : null; }); });
  NV_X_.enroll = null;
  return { ok: true };
}
/** Three demo students so every flow can be tried without touching real students. */
function addDemoStudents(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var names = ['Avery Demo', 'Jordan Demo', 'Riley Demo'], made = 0;
  nvWithLock_(function () {
    names.forEach(function (n, i) {
      var e = n.split(' ')[0].toLowerCase() + '.' + String(ctx.klass.ClassId).slice(0, 6).toLowerCase() + '@' + NV_DEMO_DOMAIN;
      if (!nvEnrollment_(ctx.klass.ClassId, e)) { nvAppend_(nvSheet_('Enroll'), { ClassId: ctx.klass.ClassId, Email: e, Name: n, JoinedAt: new Date(), Active: true }); made++; NV_X_.enroll = null; }
    });
  });
  NV_X_.enroll = null;
  return { ok: true, added: made, roster: nvRoster_(ctx.klass.ClassId) };
}

// ============================================================================
// BOOTSTRAP AND ADMIN
// ============================================================================

function getBootstrap() {
  var email = nvSessionEmail_();
  var base = { ok: true, version: nvLiveVersion_(), serverBuild: NV_APP_VERSION, email: email, serverNow: new Date().toISOString() };
  if (!PropertiesService.getScriptProperties().getProperty(NV_DB_PROP)) return Object.assign(base, { needsSetup: true, role: 'none' });
  if (!email) return Object.assign(base, { role: 'none' });
  var role = nvRoleOf_(email), u = nvUser_(email);
  var out = Object.assign(base, { role: role, name: u ? nvCellText_(u.Name) : '', studentClasses: nvStudentClasses_(email) });
  if (role !== 'student') {
    out.classes = nvTeacherClasses_({ email: email, isAdmin: role === 'admin' });
    out.lastClassId = nvTeacherLastClass_(email);
    out.defaultClassId = nvBusiestClass_(out.classes);
    out.aiConfigured = !!PropertiesService.getScriptProperties().getProperty(NV_GEMINI_PROP);
    out.lmsHub = typeof lmsHubEnabled_ === 'function' ? lmsHubEnabled_() : false;
    try { out.canvas = nvCanvasStatus_(email); } catch (e) { out.canvas = { connected: false }; }
  }
  return out;
}
// The teacher dashboard opens on the class used last, on any computer (cross-app, Lit Circles
// 2026-10-18g). One Script Property per teacher (the app runs as its owner, so UserProperties would be
// shared by everyone). With nothing remembered: the class with the most students, not the first made.
var NV_LAST_CLASS_PROP = 'NV_LAST_CLASS::';
function nvTeacherLastClass_(email) { try { return String(PropertiesService.getScriptProperties().getProperty(NV_LAST_CLASS_PROP + nvNorm_(email)) || ''); } catch (e) { return ''; } }
function nvBusiestClass_(classes) {
  if (!classes || classes.length < 2) return classes && classes[0] ? String(classes[0].classId) : '';
  var count = {}, seen = {};
  nvEnrollAll_().forEach(function (e) {
    var k = String(e.ClassId) + '|' + nvNorm_(e.Email);
    if (seen[k] || !nvTruthy_(e.Active) || nvIsDemo_(e.Email)) return;
    seen[k] = true; count[String(e.ClassId)] = (count[String(e.ClassId)] || 0) + 1;
  });
  var best = String(classes[0].classId);
  classes.forEach(function (c) { if ((count[String(c.classId)] || 0) > (count[best] || 0)) best = String(c.classId); });
  return best;
}
function rememberTeacherClass(payload) {
  var ctx = nvTeacherClass_(String((payload || {}).classId || ''));
  PropertiesService.getScriptProperties().setProperty(NV_LAST_CLASS_PROP + ctx.teacher.email, String(ctx.klass.ClassId));
  return { ok: true, classId: String(ctx.klass.ClassId) };
}
function adminListAccess() {
  nvRequireAdmin_(); NV_X_.users = null;
  return { ok: true, users: nvUsers_().map(function (u) { return { email: nvNorm_(u.Email), name: nvCellText_(u.Name), role: String(u.Role), status: String(u.Status) }; }),
    classes: nvClasses_().filter(function (c) { return nvTruthy_(c.Active); }).map(function (c) { return nvPublicClass_(c, true); }) };
}
function adminSetAccess(payload) {
  var me = nvRequireAdmin_(); payload = payload || {};
  var e = nvNorm_(payload.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Type a full school email address.');
  var role = ['teacher', 'admin'].indexOf(payload.role) >= 0 ? payload.role : 'teacher';
  var status = payload.status === 'inactive' ? 'inactive' : 'active';
  if (e === me.email && (status !== 'active' || role !== 'admin')) throw new Error('You can’t remove your own admin access.');
  nvUpsertUser_(e, nvClean_(payload.name, 80).trim() || nvNameFromEmail_(e), role, status);
  return adminListAccess();
}

// The study (book, units, activities) and everything students do lives in Study.js.

// ============================================================================
// EDITOR TOOLS: restoring a student's earlier copy (restores as the newest DRAFT, never over turned-in work)
// ============================================================================

function listWorkBackups() {
  var e = nvNorm_(RESTORE_STUDENT); if (!e) throw new Error('Type the student’s email in RESTORE_STUDENT at the top of Code first.');
  var sh = nvSheet_('WorkBackups'), rows = nvReadRows_(sh, nvFindRowNums_(sh, 'Email', e));
  if (!rows.length) { Logger.log('No backups for ' + e + '.'); return []; }
  return rows.reverse().map(function (r) {
    var line = 'Row ' + r._row + ' · ' + nvIso_(r.SavedAt) + ' · Week ' + r.Week + ' ' + r.Kind + ' · ' + r.Reason + ' · ' + r.Chars + ' characters';
    Logger.log(line); return line;
  });
}
function restoreWorkBackup() {
  var e = nvNorm_(RESTORE_STUDENT), row = Number(RESTORE_ROW);
  if (!e || !row) throw new Error('Set RESTORE_STUDENT and RESTORE_ROW (from listWorkBackups) at the top of Code first.');
  var sh = nvSheet_('WorkBackups'), b = nvReadRows_(sh, [row])[0];
  if (!b || nvNorm_(b.Email) !== e) throw new Error('Row ' + row + ' is not a backup for ' + e + '.');
  var json = nvJoin_(b, 'DataJson', 3); JSON.parse(json);
  nvUpsert_('Work', 'Email', { ClassId: b.ClassId, Email: e, Week: b.Week, Kind: b.Kind }, function (r, now) {
    if (r) nvBackup_(String(b.ClassId), e, b.Week, b.Kind, nvJoin_(r, 'DataJson', 3), json, 'before-restore');
    var f = nvSplit_('DataJson', 3, json); f.UpdatedAt = now; return f;
  });
  Logger.log('Restored row ' + row + ' as the newest draft of Week ' + b.Week + ' ' + b.Kind + ' for ' + e + '. Turned-in work was not changed.');
  return true;
}

// ============================================================================
// checkFiles: proves every file in the project is the one this release shipped.
// ============================================================================

var FILE_FINGERPRINTS = {"Build":{"chars":82072,"md5":"bf9a8da07fe511466c697a03343086bb","loose":"34125f1a742507d3d7cf562f68845875"},"Guide":{"chars":56494,"md5":"02dc57f1e14e3a57b467e734d00ece6b","loose":"26f9e13f761899dff895db477b1f92dd"},"Index":{"chars":13907,"md5":"c404fda3c14bb13c34cc467ab48a6a36","loose":"d4a3d95c2a4baf6dcd4040e413f5b8e0"},"Marking":{"chars":36431,"md5":"87c75a3899c224f4aeee47960cd38cc9","loose":"80017e387d6b202ebbd260582605c19a"},"NovelTheme":{"chars":67018,"md5":"b1adcee4b09b57567ecff0a14b104d6f","loose":"288d2658f0a8a1d16737c2818371c463"},"SaveGuard":{"chars":12909,"md5":"96a68c6d598a88a64cfd50482b20fd81","loose":"d1326ba30012b614732bac7d834bc916"},"Student":{"chars":70141,"md5":"2780992b9de8dcbf575eeefe50219df1","loose":"39a92510650871396822d10a46f9e857"},"Teacher":{"chars":48594,"md5":"0cef1401141e57f6c10bed4370e766b5","loose":"199bee9bb8d26cbbc545f03fae03d5c9"},"WritingStats":{"chars":5075,"md5":"d4a458a7487746294cdcd5f78c0b497c","loose":"300edae45e156cada5af8f80f7146af5"}};
function checkFiles() {
  var lines = [];
  Object.keys(FILE_FINGERPRINTS).forEach(function (name) {
    var want = FILE_FINGERPRINTS[name], got = '';
    try { got = HtmlService.createHtmlOutputFromFile(name).getContent(); } catch (e) { lines.push('MISSING  ' + name); return; }
    var md5 = nvMd5_(got), loose = nvMd5_(got.replace(/\s+/g, ''));
    var status = md5 === want.md5 ? 'OK' : loose === want.loose ? 'OK (spacing only)' : got.length < want.chars ? 'SHORT' : got.length > want.chars ? 'TOO BIG' : 'DIFFERS';
    lines.push(status + '  ' + name + '  (' + got.length + ' of ' + want.chars + ' characters)');
  });
  lines.forEach(function (l) { Logger.log(l); });
  return lines;
}
