// ============================================================================
// Podcast Studio -- server core.
// A three-week Creative Writing unit: listen to real podcasts like a producer, learn the parts of an
// episode, plan and script a show, then record and build it in Canva. Built on the classroom-app
// guide (CLASSROOM-APP-BUILD.md): Lit Circles saving rules, Macbeth grading, per-teacher Canvas.
//
// Setup (once, from the Apps Script editor, signed in with your school account):
//   1. Run setupPodcastStudio  -> makes the backend Sheet and makes you admin.
//   2. Optional: LMS_HUB_URL, LMS_HUB_KEY, LMS_HUB_ENABLED=true (Canvas through the hub).
//   3. Deploy > New deployment > Web app (Execute as: Me, Who has access: anyone at school).
//
// Files: Code (this), PodcastData (ALL the unit's content), Unit (the unit + student work), Grading,
// Canvas, PodcastLmsHub, LmsHub (shared -- never edit), Index (page shell), WritingStats, SaveGuard,
// Student, Teacher, Marking, PodcastTheme (last). (Read aloud was removed in 2026-10-26a.)
// ============================================================================

var PC_APP_VERSION = '2026-10-28b';
var PC_DB_PROP = 'PODCAST_STUDIO_DB_ID';
var PC_LIVE_VERSION_PROP = 'PODCAST_STUDIO_LIVE_VERSION';
var PC_DEMO_DOMAIN = 'demo.podcaststudio.local';

// Editor tools: type a student's email here, then run listWorkBackups / restoreWorkBackup.
var RESTORE_STUDENT = '';
var RESTORE_ROW = '';

var PC_SHEETS = {
  Users:       ['Email', 'Name', 'Role', 'Status', 'CreatedAt', 'UpdatedAt'],
  Classes:     ['ClassId', 'TeacherEmail', 'ClassName', 'Period', 'JoinCode', 'SettingsJson', 'Active', 'CreatedAt', 'UpdatedAt'],
  Enroll:      ['ClassId', 'Email', 'Name', 'JoinedAt', 'Active'],
  // One row per student per week per item (logs, plans, scripts, links). Draft = latest typing;
  // Sub = the copy the student turned in (what the teacher grades).
  Work:        ['ClassId', 'Email', 'Week', 'Kind', 'UpdatedAt', 'SubmittedAt', 'SubFp', 'DataJson', 'DataJson2', 'DataJson3', 'SubJson', 'SubJson2', 'SubJson3'],
  // One row per student per quiz. Score/SubmittedAt = the best counted try; AttemptsJson = every finished try.
  Quiz:        ['ClassId', 'Email', 'Week', 'AnswersJson', 'Score', 'Max', 'StartedAt', 'SubmittedAt', 'UpdatedAt', 'ActId', 'AttemptsJson', 'CurrentTry', 'ExtraTries'],
  Discuss:     ['PostId', 'ClassId', 'Week', 'Email', 'Name', 'ParentId', 'Text', 'CreatedAt', 'EditedAt', 'ClientId', 'ActId'],
  // ScaleV '7' = scored on the 7 / 6 / 5 / 4 / 0 rubrics (2026-10-26a); blank = from before (rescaled once).
  Grades:      ['ClassId', 'Email', 'ItemKey', 'Score', 'Excluded', 'Comment', 'GradedBy', 'GradedAt', 'MarkedFp', 'CanvasPostedScore', 'CanvasCommentFp', 'CriteriaJson', 'ScaleV'],
  // Every score the 2026-10-26a rescale changed, before and after (nothing is lost).
  GradeChanges:['ClassId', 'Email', 'ItemKey', 'OldScore', 'NewScore', 'OldCriteriaJson', 'NewCriteriaJson', 'ChangedAt', 'Reason'],
  WritingStats:['ClassId', 'Email', 'ItemKey', 'StatsJson', 'UpdatedAt'],
  Resume:      ['ClassId', 'Email', 'RouteJson', 'UpdatedAt'],
  WorkBackups: ['ClassId', 'Email', 'Week', 'Kind', 'SavedAt', 'Reason', 'Chars', 'DataJson', 'DataJson2', 'DataJson3']
};


// ============================================================================
// WEB APP
// ============================================================================

function doGet() {
  pcRegisterLiveVersion_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Podcast Studio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Splices another file into Index. A missing file becomes a visible warning, never a blank page. */
function include_(name) {
  try { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
  catch (e) { return '<div class="pc-missing" role="alert">This page is missing the file “' + name + '”. Ask your teacher to check the app (checkFiles in the editor).</div>'; }
}

// ---------- versions ----------

function pcVersionParts_(v) {
  var t = String(v || '').trim().toLowerCase(), m = /^(\d{4}-\d{2}-\d{2})([a-z]*)$/.exec(t);
  if (!m) return { date: t, n: 0 };
  var n = 0; for (var i = 0; i < m[2].length; i++) n = n * 26 + (m[2].charCodeAt(i) - 96);
  return { date: m[1], n: n };
}
function pcCompareVersions_(a, b) {
  var x = pcVersionParts_(a), y = pcVersionParts_(b);
  if (x.date !== y.date) return x.date < y.date ? -1 : 1;
  return x.n === y.n ? 0 : (x.n < y.n ? -1 : 1);
}
function pcRegisterLiveVersion_() {
  try {
    // The editor's /dev test link never moves the marker: only a deployed /exec build does.
    var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
    if (/\/dev(\?|$)/.test(url)) return;
    var p = PropertiesService.getScriptProperties(), live = p.getProperty(PC_LIVE_VERSION_PROP) || '';
    if (!live || pcCompareVersions_(PC_APP_VERSION, live) > 0) p.setProperty(PC_LIVE_VERSION_PROP, PC_APP_VERSION);
  } catch (e) {}
}
function pcLiveVersion_() { try { return PropertiesService.getScriptProperties().getProperty(PC_LIVE_VERSION_PROP) || PC_APP_VERSION; } catch (e) { return PC_APP_VERSION; } }
function getAppVersion() {
  var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return { ok: true, version: pcLiveVersion_(), serverBuild: PC_APP_VERSION, url: url };
}

// ============================================================================
// SETUP
// ============================================================================

function setupPodcastStudio() {
  var email = pcSessionEmail_();
  if (!email) throw new Error('No school email was detected. Run setup while signed in with your school Google account.');
  var p = PropertiesService.getScriptProperties(), id = p.getProperty(PC_DB_PROP);
  if (id) {
    // Never makes a second database: an existing one is reopened (and only an admin may run this again).
    pcDb_();
    // A database with no admin yet (a teacher's fresh copy, linked to its own Sheet) may be set up by anyone;
    // once it has an admin, only an admin can run setup again.
    var u = pcUser_(email);
    var hasAdmin = pcUsers_().some(function (r) { return String(r.Role) === 'admin' && String(r.Status || 'active') === 'active'; });
    if (hasAdmin && (!u || u.Role !== 'admin')) throw new Error('Podcast Studio is already set up. Only an admin can run setup again.');
  } else {
    var ss = SpreadsheetApp.create('Podcast Studio - Backend');
    p.setProperty(PC_DB_PROP, ss.getId());
    PC_X_.ss = ss;
  }
  Object.keys(PC_SHEETS).forEach(function (k) { pcSheet_(k); });
  pcUpsertUser_(email, pcNameFromEmail_(email), 'admin', 'active');
  var ssOut = pcDb_();
  Logger.log('Podcast Studio backend: ' + ssOut.getUrl());
  return { ok: true, spreadsheetUrl: ssOut.getUrl(), admin: email };
}

// ============================================================================
// SHEET HELPERS (header-driven; rows found with TextFinder; one setValues per write)
// ============================================================================

var PC_X_ = { ss: null, sheets: {}, headers: {}, users: null, classes: null, scriptLocked: false };

function pcDb_() {
  if (PC_X_.ss) return PC_X_.ss;
  var id = PropertiesService.getScriptProperties().getProperty(PC_DB_PROP);
  if (!id) throw new Error('Podcast Studio is not set up yet. Your teacher needs to run setupPodcastStudio once from the Apps Script editor.');
  // A brief Sheets timeout must never send the app to a new, empty database: retry, then give a retryable error.
  for (var i = 0; i < 3; i++) {
    try { PC_X_.ss = SpreadsheetApp.openById(id); return PC_X_.ss; } catch (e) { if (i < 2) Utilities.sleep(400 * (i + 1)); }
  }
  throw new Error('The class database is busy right now. Please try again in a moment. (Nothing was lost.)');
}
function pcSheet_(name) {
  if (PC_X_.sheets[name]) return PC_X_.sheets[name];
  var headers = PC_SHEETS[name], ss = pcDb_(), sh = ss.getSheetByName(name);
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
  PC_X_.sheets[name] = sh;
  delete PC_X_.headers[name];
  return sh;
}
function pcHeaders_(sh) {
  var n = sh.getName();
  if (!PC_X_.headers[n]) PC_X_.headers[n] = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h || '').trim(); });
  return PC_X_.headers[n];
}
function pcCol_(sh, h) { return pcHeaders_(sh).indexOf(h) + 1; }
/** Row numbers whose `header` cell equals `value` (TextFinder: a big tab is never downloaded to find one student). */
function pcFindRowNums_(sh, header, value) {
  var col = pcCol_(sh, header), last = sh.getLastRow();
  if (!col || last < 2 || value === '' || value == null) return [];
  return sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(false).findAll()
    .map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; });
}
function pcReadRows_(sh, nums) {
  var h = pcHeaders_(sh);
  return (nums || []).map(function (r) {
    var v = sh.getRange(r, 1, 1, h.length).getValues()[0], o = { _row: r };
    h.forEach(function (k, i) { if (k) o[k] = v[i]; });
    return o;
  });
}
function pcAllRows_(sh) {
  var last = sh.getLastRow(), h = pcHeaders_(sh);
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
function pcReadColumns_(sh, names) {
  var last = sh.getLastRow(); if (last < 2) return [];
  var n = last - 1, cols = {};
  names.forEach(function (h) { var c = pcCol_(sh, h); cols[h] = c ? sh.getRange(2, c, n, 1).getValues() : null; });
  var out = [];
  for (var i = 0; i < n; i++) {
    var o = { _row: i + 2 }, any = false;
    names.forEach(function (h) { var v = cols[h] ? cols[h][i][0] : ''; o[h] = v; if (v !== '' && v !== null) any = true; });
    if (any) out.push(o);
  }
  return out;
}
var PC_CELL_MAX = 49500;
function pcRowValues_(sh, obj) {
  return pcHeaders_(sh).map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return v;
    v = pcText_(v);
    if (v.length > PC_CELL_MAX) throw new Error('This is too long to save: one box holds at most ' + PC_CELL_MAX.toLocaleString() + ' characters and this has ' + v.length.toLocaleString() + '. Please shorten it. Nothing was changed.');
    return v;
  });
}
function pcWriteRow_(sh, rowNum, obj) { var v = pcRowValues_(sh, obj); sh.getRange(rowNum, 1, 1, v.length).setValues([v]); }
function pcAppend_(sh, obj) { sh.appendRow(pcRowValues_(sh, obj)); }

/**
 * Upsert one row by keys. Finds the student's rows with TextFinder on `findHeader`, takes the LAST
 * match, re-reads it right before writing (its keys must still match), and carries over every column
 * this save doesn't set. `fields` may be a function (freshRowOrNull, now) -> fields, so merges are made
 * from the newest copy. Returning null from it writes nothing.
 */
function pcUpsert_(sheetName, findHeader, keys, fields, opts) {
  opts = opts || {};
  var sh = pcSheet_(sheetName);
  function matches(r) { return Object.keys(keys).every(function (k) { return pcNorm_(r[k]) === pcNorm_(keys[k]); }); }
  function run() {
    for (var attempt = 0; attempt < 2; attempt++) {
      var recs = pcReadRows_(sh, pcFindRowNums_(sh, findHeader, keys[findHeader])).filter(matches);
      var now = new Date();
      if (!recs.length) {
        var f0 = typeof fields === 'function' ? fields(null, now) : fields;
        if (!f0) return { written: false, record: null, now: now };
        var fresh = {}; Object.keys(keys).forEach(function (k) { fresh[k] = keys[k]; }); Object.keys(f0).forEach(function (k) { fresh[k] = f0[k]; });
        pcAppend_(sh, fresh);
        return { written: true, created: true, record: fresh, now: now };
      }
      var rowNum = recs[recs.length - 1]._row, check = pcReadRows_(sh, [rowNum])[0];
      if (!check || !matches(check)) continue;
      now = new Date();
      var f = typeof fields === 'function' ? fields(check, now) : fields;
      if (!f) return { written: false, record: check, now: now };
      var merged = {}; Object.keys(check).forEach(function (k) { if (k !== '_row') merged[k] = check[k]; });
      Object.keys(f).forEach(function (k) { merged[k] = f[k]; });
      pcWriteRow_(sh, rowNum, merged);
      return { written: true, record: merged, previous: check, now: now };
    }
    throw new Error('Your work could not be saved because the sheet was being reorganized. Please try again.');
  }
  return opts.atomic ? pcRowCritical_(run) : run();
}
function pcFindOne_(sheetName, findHeader, keys) {
  var sh = pcSheet_(sheetName);
  var recs = pcReadRows_(sh, pcFindRowNums_(sh, findHeader, keys[findHeader])).filter(function (r) {
    return Object.keys(keys).every(function (k) { return pcNorm_(r[k]) === pcNorm_(keys[k]); });
  });
  return recs.length ? recs[recs.length - 1] : null;
}

// ---------- locks ----------
// The app runs as its owner, so getUserLock() is ONE lock for the whole class: best-effort only.
function pcUserLock_(fn) {
  var lock = null, held = false;
  try { lock = LockService.getUserLock(); held = lock.tryLock(6000); } catch (e) { held = false; }
  try { return fn(); } finally { if (held) { try { lock.releaseLock(); } catch (e2) {} } }
}
/** Short critical section around one shared row's re-read + write. Re-entrant. */
function pcRowCritical_(fn) {
  if (PC_X_.scriptLocked) return fn();
  var lock = null, held = false;
  try { lock = LockService.getScriptLock(); held = lock.tryLock(15000); } catch (e) { held = false; }
  if (held) PC_X_.scriptLocked = true;
  try { return fn(); } finally { if (held) { PC_X_.scriptLocked = false; try { lock.releaseLock(); } catch (e2) {} } }
}
/** Teacher-wide tools and class settings. Kept short; re-entrant. */
function pcWithLock_(fn) {
  if (PC_X_.scriptLocked) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The class sheet is busy. Please try again in a moment.');
  PC_X_.scriptLocked = true;
  try { return fn(); } finally { PC_X_.scriptLocked = false; lock.releaseLock(); }
}

// ---------- values ----------

function pcNorm_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function pcTruthy_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function pcParse_(v, fb) { try { return (v && typeof v === 'object') ? v : JSON.parse(String(v || '')); } catch (e) { return fb; } }
function pcClean_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n || 4000); }
function pcIso_(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  var d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString();
}
function pcLater_(a, b) { var x = new Date(a || ''), y = new Date(b || ''); return !isNaN(x.getTime()) && !isNaN(y.getTime()) && x.getTime() > y.getTime() + 1000; }
/** A raw Date anywhere in a google.script.run response blanks the whole response. */
function pcCellText_(v) {
  if (v instanceof Date) return v.toISOString();
  return v || v === 0 ? String(v) : '';
}
/** Typed text stays text: Sheets would turn "7/7", "=)", "10/10" into dates, formulas, numbers. */
function pcText_(v) {
  var s = String(v == null ? '' : v); if (!s) return '';
  var t = s.trim();
  if (/^[=+\-@']/.test(s) || /^-?[\d.,\s]+%?$/.test(t) || /^(true|false)$/i.test(t) || /^\d{1,4}[\/.\-]\d{1,2}([\/.\-]\d{1,4})?(\s|$)/.test(t) ||
      /^\d{1,2}:\d{2}/.test(t) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i.test(t)) return "'" + s;
  return s;
}
function pcMd5_(t) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(t), Utilities.Charset.UTF_8)
    .map(function (b) { var h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}
function pcStable_(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(pcStable_).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return k.charAt(0) !== '_'; }).map(function (k) { return JSON.stringify(k) + ':' + pcStable_(v[k]); }).join(',') + '}';
  if (typeof v === 'string') return JSON.stringify(v.replace(/\s+/g, ' ').trim());
  return JSON.stringify(v);
}
var PC_BLANK_FP = 'fp:empty';
function pcFp_(text) { var t = String(text || ''); if (!t || t === '{}' || t === '[]' || t === '""') return PC_BLANK_FP; return 'fp:' + t.length + ':' + pcMd5_(t).slice(0, 10); }

// ---------- big JSON cells ----------
// A cell stops at 50,000 characters. JSON is split across <base>, <base>2, <base>3 (45,000 each).
// Continuation chunks get a zero-width-space prefix so they can never parse as formulas.
var PC_CHUNK = 45000;
function pcSplit_(base, n, json) {
  json = String(json || '');
  var parts = [], i = 0;
  while (i < json.length) {
    var end = Math.min(json.length, i + PC_CHUNK), code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xD800 && code <= 0xDBFF) end--;  // keep an emoji in one piece
    parts.push(json.substring(i, end)); i = end;
  }
  if (parts.length > n) throw new Error('This is too long to save (' + Math.round(json.length / 1000) + 'k characters). Please shorten it. Nothing was changed.');
  var out = {};
  for (var k = 0; k < n; k++) { var col = k ? base + (k + 1) : base; out[col] = parts[k] ? (k ? '​' + parts[k] : parts[k]) : ''; }
  return out;
}
function pcJoin_(rec, base, n) {
  var s = String(rec[base] == null ? '' : rec[base]);
  for (var k = 1; k < n; k++) { var p = rec[base + (k + 1)]; if (p === '' || p == null) break; s += String(p).replace(/^​/, ''); }
  return s;
}
/** Unreadable is not empty: a chunk set that doesn't reassemble says so instead of becoming {}. */
function pcParseChunks_(rec, base, n) {
  if (!rec) return {};
  var s = pcJoin_(rec, base, n);
  if (!s) return {};
  try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch (e) { return { _unreadable: true, _chars: s.length }; }
}

// ============================================================================
// IDENTITY AND ROLES
// ============================================================================

function pcSessionEmail_() { try { return pcNorm_(Session.getActiveUser().getEmail()); } catch (e) { return ''; } }
function pcNameFromEmail_(e) {
  var p = String(e || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return p.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || 'Student';
}
function pcIsDemo_(email) { return new RegExp('@' + PC_DEMO_DOMAIN.replace(/\./g, '\\.') + '$').test(pcNorm_(email)); }
function pcUsers_() { if (!PC_X_.users) PC_X_.users = pcAllRows_(pcSheet_('Users')); return PC_X_.users; }
function pcUser_(email) { var e = pcNorm_(email); return pcUsers_().filter(function (u) { return pcNorm_(u.Email) === e; }).pop() || null; }
function pcUpsertUser_(email, name, role, status) {
  pcUpsert_('Users', 'Email', { Email: pcNorm_(email) }, function (r, now) {
    return { Name: name || (r && r.Name) || pcNameFromEmail_(email), Role: role, Status: status, UpdatedAt: now, CreatedAt: r ? r.CreatedAt : now };
  }, { atomic: true });
  PC_X_.users = null;
}
function pcRoleOf_(email) {
  var u = pcUser_(email);
  if (u && String(u.Status) === 'active' && (u.Role === 'teacher' || u.Role === 'admin')) return u.Role;
  return 'student';
}
function pcRequireTeacher_() {
  var e = pcSessionEmail_(), role = pcRoleOf_(e);
  if (!e || role === 'student') throw new Error('Teacher access required. Ask the Podcast Studio admin to add your school email.');
  return { email: e, role: role, isAdmin: role === 'admin' };
}
function pcRequireAdmin_() { var t = pcRequireTeacher_(); if (!t.isAdmin) throw new Error('Admin access required.'); return t; }

var PC_TEACHER_VIEW_MSG = 'Teacher view is read-only: this student’s work was not changed. (Open a demo student to try saving.)';

/**
 * Who a student call acts for. Normally the signed-in account. A teacher of the class may open a
 * student's pages: demo students are fully usable; a real student's pages are read-only (the student
 * may be writing in their own tab right now). A teacher using the Student view acts as themself.
 */
function pcActing_(classId, as, write) {
  var session = pcSessionEmail_();
  if (!session) throw new Error('Sign in with your school Google account first.');
  var klass = pcClass_(classId);
  if (!klass || !pcTruthy_(klass.Active)) throw new Error('This class is unavailable.');
  var target = pcNorm_(as) || session;
  if (target === session) {
    var role = pcRoleOf_(session);
    var enrolled = pcEnrollment_(classId, session);
    var teaches = role !== 'student' && (role === 'admin' || pcNorm_(klass.TeacherEmail) === session);
    if (!enrolled && !teaches) throw new Error('You are not in this class. Join it with the class code from your teacher.');
    return { email: session, name: enrolled ? (pcCellText_(enrolled.Name) || pcNameFromEmail_(session)) : pcNameFromEmail_(session), klass: klass, self: true, teacherSelf: !enrolled && teaches };
  }
  var t = pcRoleOf_(session);
  if (t === 'student' || (t !== 'admin' && pcNorm_(klass.TeacherEmail) !== session)) throw new Error('You are signed in as ' + session + ', so you can only open that account’s work.');
  var en = pcEnrollment_(classId, target);
  if (!en) throw new Error('That student is not in this class.');
  if (write && !pcIsDemo_(target)) throw new Error(PC_TEACHER_VIEW_MSG);
  return { email: target, name: pcCellText_(en.Name) || pcNameFromEmail_(target), klass: klass, self: false, demo: pcIsDemo_(target), readOnly: !pcIsDemo_(target) };
}

// ============================================================================
// CLASSES AND ENROLLMENT
// ============================================================================

function pcClasses_() { if (!PC_X_.classes) PC_X_.classes = pcAllRows_(pcSheet_('Classes')); return PC_X_.classes; }
function pcClass_(id) { return pcClasses_().filter(function (c) { return String(c.ClassId) === String(id); }).pop() || null; }
function pcDefaultSettings_() {
  return { release: {}, due: {}, unlock: {}, noGrade: {}, canva: {}, canvas: { courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: '', assignments: {} } };
}
function pcSettingsOf_(klass) {
  var raw = pcParse_(klass && klass.SettingsJson, null);
  if (klass && klass.SettingsJson && !raw) return { _unreadable: true };
  var s = Object.assign(pcDefaultSettings_(), raw || {});
  ['release', 'due', 'unlock', 'noGrade'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
  s.canvas = Object.assign(pcDefaultSettings_().canvas, s.canvas || {});
  s.canvas.assignments = s.canvas.assignments || {};
  ['weekModules', 'itemModules'].forEach(function (k) { if (!s.canvas[k] || typeof s.canvas[k] !== 'object') s.canvas[k] = {}; });
  return s;
}
/** Class settings change only under the lock, from a fresh read, never replaced with defaults. */
function pcUpdateSettings_(classId, fn) {
  return pcWithLock_(function () {
    PC_X_.classes = null;
    var out = null;
    pcUpsert_('Classes', 'ClassId', { ClassId: classId }, function (r, now) {
      if (!r) throw new Error('Class not found.');
      var s = pcSettingsOf_(r);
      if (s._unreadable) throw new Error('This class’s settings could not be read, so nothing was changed. Tell the app’s admin.');
      fn(s, r);
      var json = JSON.stringify(s);
      if (json.length > 48000) throw new Error('This class has too many settings to save. Nothing was changed.');
      out = s;
      return { SettingsJson: json, UpdatedAt: now };
    });
    PC_X_.classes = null;
    return out;
  });
}
function pcTeacherClass_(classId) {
  var t = pcRequireTeacher_(), k = pcClass_(classId);
  if (!k || !pcTruthy_(k.Active)) throw new Error('Class not found.');
  if (!t.isAdmin && pcNorm_(k.TeacherEmail) !== t.email) throw new Error('You do not manage this class.');
  return { teacher: t, klass: k, settings: pcSettingsOf_(k) };
}
function pcPublicClass_(k, forTeacher) {
  var o = { classId: String(k.ClassId), className: pcCellText_(k.ClassName), period: pcCellText_(k.Period), teacherEmail: pcNorm_(k.TeacherEmail) };
  if (forTeacher) o.joinCode = String(k.JoinCode);
  return o;
}
function pcEnrollAll_() { if (!PC_X_.enroll) PC_X_.enroll = pcAllRows_(pcSheet_('Enroll')); return PC_X_.enroll; }
function pcEnrollment_(classId, email) {
  var e = pcNorm_(email);
  return pcEnrollAll_().filter(function (r) { return String(r.ClassId) === String(classId) && pcNorm_(r.Email) === e && pcTruthy_(r.Active); }).pop() || null;
}
/** Enrolled students, sorted by last name. Demo students are kept (marked) so teachers can try flows. */
function pcRoster_(classId) {
  var seen = {}, out = [];
  pcEnrollAll_().forEach(function (r) {
    if (String(r.ClassId) !== String(classId) || !pcTruthy_(r.Active)) return;
    var e = pcNorm_(r.Email); if (seen[e]) return; seen[e] = true;
    out.push({ email: e, name: pcCellText_(r.Name) || pcNameFromEmail_(e), demo: pcIsDemo_(e), notYet: !pcCellText_(r.Name).trim() });
  });
  return out.sort(function (a, b) { return pcSortName_(a.name).localeCompare(pcSortName_(b.name)); });
}
function pcSortName_(n) { var p = String(n).trim().split(/\s+/); return (p.length > 1 ? p[p.length - 1] + ' ' + p.slice(0, -1).join(' ') : p[0]).toLowerCase(); }
function pcJoinCode_() {
  var used = {}; pcClasses_().forEach(function (c) { used[String(c.JoinCode).toUpperCase()] = true; });
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (var t = 0; t < 60; t++) { var s = ''; for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); if (!used[s]) return s; }
  return Utilities.getUuid().slice(0, 6).toUpperCase();
}

function createClass(payload) {
  var t = pcRequireTeacher_(); payload = payload || {};
  var name = pcClean_(payload.className, 120).trim();
  if (!name) throw new Error('Give the class a name.');
  var id = Utilities.getUuid(), now = new Date();
  pcWithLock_(function () {
    pcAppend_(pcSheet_('Classes'), { ClassId: id, TeacherEmail: t.email, ClassName: name, Period: pcClean_(payload.period, 30).trim(), JoinCode: pcJoinCode_(),
      SettingsJson: JSON.stringify(pcDefaultSettings_()), Active: true, CreatedAt: now, UpdatedAt: now });
  });
  PC_X_.classes = null;
  return { ok: true, classId: id, classes: pcTeacherClasses_(t) };
}
function renameClass(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var name = pcClean_(payload.className, 120).trim(); if (!name) throw new Error('Give the class a name.');
  pcWithLock_(function () { pcUpsert_('Classes', 'ClassId', { ClassId: ctx.klass.ClassId }, { ClassName: name, Period: pcClean_(payload.period, 30).trim(), UpdatedAt: new Date() }); });
  PC_X_.classes = null;
  return { ok: true, classes: pcTeacherClasses_(ctx.teacher) };
}
function pcTeacherClasses_(t) {
  return pcClasses_().filter(function (c) { return pcTruthy_(c.Active) && (t.isAdmin || pcNorm_(c.TeacherEmail) === t.email); }).map(function (c) {
    return pcPublicClass_(c, true);
  });
}
function pcStudentClasses_(email) {
  var ids = {}; pcEnrollAll_().forEach(function (r) { if (pcNorm_(r.Email) === pcNorm_(email) && pcTruthy_(r.Active)) ids[r.ClassId] = true; });
  return pcClasses_().filter(function (c) { return ids[c.ClassId] && pcTruthy_(c.Active); }).map(function (c) {
    return pcPublicClass_(c, false);
  });
}
function pcCleanNamePart_(v, label) {
  var s = pcClean_(v, 40).replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Type your ' + label + '.');
  if (!/[A-Za-zÀ-ɏ]/.test(s)) throw new Error('Type your real ' + label + '.');
  return s;
}
function joinClass(payload) {
  payload = payload || {};
  var email = pcSessionEmail_(); if (!email) throw new Error('Sign in with your school Google account first.');
  var code = String(payload.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw new Error('Type the class code from your teacher.');
  var name = pcCleanNamePart_(payload.firstName, 'first name') + ' ' + pcCleanNamePart_(payload.lastName, 'last name');
  var k = pcClasses_().filter(function (c) { return String(c.JoinCode).toUpperCase() === code && pcTruthy_(c.Active); }).pop();
  if (!k) throw new Error('That class code wasn’t found. Check it with your teacher.');
  pcUserLock_(function () {
    var en = pcEnrollment_(k.ClassId, email);
    if (!en) pcAppend_(pcSheet_('Enroll'), { ClassId: k.ClassId, Email: email, Name: name, JoinedAt: new Date(), Active: true });
    else if (!pcCellText_(en.Name).trim()) pcUpsert_('Enroll', 'Email', { ClassId: k.ClassId, Email: email }, function (r) { return r && !pcCellText_(r.Name).trim() ? { Name: name } : null; });   // added by email: their own name now
  });
  PC_X_.enroll = null;
  return { ok: true, classId: String(k.ClassId), classes: pcStudentClasses_(email) };
}
function removeStudent(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), e = pcNorm_(payload.email);
  // Never delete rows: the enrollment is switched off and every piece of work is kept.
  pcWithLock_(function () { pcUpsert_('Enroll', 'Email', { ClassId: ctx.klass.ClassId, Email: e }, function (r) { return r ? { Active: false } : null; }); });
  PC_X_.enroll = null;
  return { ok: true };
}
function renameStudent(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), e = pcNorm_(payload.email);
  var name = pcClean_(payload.name, 80).replace(/\s+/g, ' ').trim(); if (!name) throw new Error('Type a name.');
  pcWithLock_(function () { pcUpsert_('Enroll', 'Email', { ClassId: ctx.klass.ClassId, Email: e }, function (r) { return r ? { Name: name } : null; }); });
  PC_X_.enroll = null;
  return { ok: true };
}
/** Three demo students so every flow can be tried without touching real students. */
function addDemoStudents(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var names = ['Avery Demo', 'Jordan Demo', 'Riley Demo'], made = 0;
  pcWithLock_(function () {
    names.forEach(function (n, i) {
      var e = n.split(' ')[0].toLowerCase() + '.' + String(ctx.klass.ClassId).slice(0, 6).toLowerCase() + '@' + PC_DEMO_DOMAIN;
      if (!pcEnrollment_(ctx.klass.ClassId, e)) { pcAppend_(pcSheet_('Enroll'), { ClassId: ctx.klass.ClassId, Email: e, Name: n, JoinedAt: new Date(), Active: true }); made++; PC_X_.enroll = null; }
    });
  });
  PC_X_.enroll = null;
  return { ok: true, added: made, roster: pcRoster_(ctx.klass.ClassId) };
}

// ---------- Add students by email (cross-app; Bell Ringers 2026.10.14.3 is the reference) ----------
// The teacher pastes a list of emails. Each student is enrolled straight away: the class appears the
// first time they open the app with that Google account, no join code needed. No name is stored: the
// student types their own first and last name the first time (setMyName), and until then the roster
// shows a name made from the email, marked "Not signed in yet". Someone removed earlier is switched
// back on (their work was never deleted). A name the student already gave in another class is reused.
var PC_ROSTER_MAX = 400;
var PC_EMAIL_RE_ = /^[^\s@<>(),;:\x22\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
function pcKnownName_(email) {
  var e = pcNorm_(email), n = '';
  pcEnrollAll_().forEach(function (r) { if (!n && pcNorm_(r.Email) === e && pcCellText_(r.Name).trim()) n = pcCellText_(r.Name).trim(); });
  return n;
}
function addStudentsByEmail(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = String(ctx.klass.ClassId);
  var list = Array.isArray(payload.entries) ? payload.entries : [];
  if (!list.length) throw new Error('Paste at least one student email.');
  if (list.length > PC_ROSTER_MAX) throw new Error('Add up to ' + PC_ROSTER_MAX + ' students at a time.');
  var out = { ok: true, added: 0, readded: 0, already: [], invalid: [], classId: classId, className: pcCellText_(ctx.klass.ClassName) };
  pcWithLock_(function () {
    PC_X_.enroll = null;
    var mine = {};
    pcEnrollAll_().forEach(function (r) {
      if (String(r.ClassId) !== classId) return;
      var e = pcNorm_(r.Email); if (!mine[e] || pcTruthy_(r.Active)) mine[e] = r;
    });
    var seen = {}, fresh = [], back = [];
    list.forEach(function (x) {
      var raw = String((x && x.email) || ''), e = pcNorm_(raw).replace(/^mailto:/, '').replace(/\.+$/, '');
      if (!e || e.length > 120 || !PC_EMAIL_RE_.test(e)) { out.invalid.push(raw.slice(0, 120)); return; }
      if (seen[e]) return; seen[e] = true;
      if (e === pcNorm_(ctx.klass.TeacherEmail) || e === ctx.teacher.email) { out.invalid.push(e + ' (that’s the teacher)'); return; }
      if (pcIsDemo_(e)) { out.invalid.push(e + ' (a demo student: use Add demo students)'); return; }
      var ex = mine[e];
      if (ex && pcTruthy_(ex.Active)) { out.already.push(e); return; }
      if (ex) back.push(ex); else fresh.push(e);
    });
    if (fresh.length) {
      var sh = pcSheet_('Enroll'), now = new Date();
      var rows = fresh.map(function (e) { return pcRowValues_(sh, { ClassId: classId, Email: e, Name: pcKnownName_(e), JoinedAt: now, Active: true }); });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);   // one write for the whole list
      out.added = fresh.length;
    }
    back.forEach(function (r) {
      var fresh2 = pcReadRows_(pcSheet_('Enroll'), [r._row])[0];
      if (!fresh2 || String(fresh2.ClassId) !== classId || pcNorm_(fresh2.Email) !== pcNorm_(r.Email)) return;
      var o = {}; Object.keys(fresh2).forEach(function (k) { if (k !== '_row') o[k] = fresh2[k]; });
      o.Active = true; pcWriteRow_(pcSheet_('Enroll'), r._row, o); out.readded++;
    });
  });
  PC_X_.enroll = null;
  out.roster = pcRoster_(classId);
  return out;
}
/** Classes this person was added to by email and hasn't named themself in yet. */
function pcUnnamedClasses_(email) {
  var e = pcNorm_(email), ids = {};
  pcEnrollAll_().forEach(function (r) { if (pcNorm_(r.Email) === e && pcTruthy_(r.Active) && !pcCellText_(r.Name).trim()) ids[String(r.ClassId)] = true; });
  return pcClasses_().filter(function (c) { return ids[String(c.ClassId)] && pcTruthy_(c.Active); }).map(function (c) { return pcCellText_(c.ClassName); });
}
function pcGuessName_(email) {
  var p = String(email || '').split('@')[0].replace(/\d+/g, ' ').split(/[._-]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  var cap = function (x) { return x ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : ''; };
  return p.length >= 2 ? { first: cap(p[0]), last: cap(p[p.length - 1]) } : { first: '', last: '' };
}
/** A student added by email types their own name once; it fills every class that has no name yet. */
function setMyName(payload) {
  payload = payload || {};
  var email = pcSessionEmail_(); if (!email) throw new Error('Sign in with your school Google account first.');
  var name = pcCleanNamePart_(payload.firstName, 'first name') + ' ' + pcCleanNamePart_(payload.lastName, 'last name');
  var n = 0;
  pcUserLock_(function () {
    PC_X_.enroll = null;
    var sh = pcSheet_('Enroll');
    pcReadRows_(sh, pcFindRowNums_(sh, 'Email', email)).forEach(function (r) {
      if (pcNorm_(r.Email) !== email || !pcTruthy_(r.Active) || pcCellText_(r.Name).trim()) return;
      var fresh = pcReadRows_(sh, [r._row])[0];
      if (!fresh || pcNorm_(fresh.Email) !== email || pcCellText_(fresh.Name).trim()) return;
      var o = {}; Object.keys(fresh).forEach(function (k) { if (k !== '_row') o[k] = fresh[k]; });
      o.Name = name; pcWriteRow_(sh, r._row, o); n++;
    });
  });
  PC_X_.enroll = null;
  return { ok: true, name: name, updated: n, studentClasses: pcStudentClasses_(email) };
}

// ============================================================================
// BOOTSTRAP AND ADMIN
// ============================================================================

function getBootstrap() {
  var email = pcSessionEmail_();
  var base = { ok: true, version: pcLiveVersion_(), serverBuild: PC_APP_VERSION, email: email, serverNow: new Date().toISOString() };
  if (!PropertiesService.getScriptProperties().getProperty(PC_DB_PROP)) return Object.assign(base, { needsSetup: true, role: 'none' });
  if (!email) return Object.assign(base, { role: 'none' });
  var role = pcRoleOf_(email), u = pcUser_(email);
  var out = Object.assign(base, { role: role, name: u ? pcCellText_(u.Name) : '', studentClasses: pcStudentClasses_(email) });
  // Added by email (no name yet): the student types their own name the first time they open the app.
  var unnamed = pcUnnamedClasses_(email);
  if (unnamed.length) { var g = pcGuessName_(email); out.needsName = true; out.addedTo = unnamed; out.suggestFirst = g.first; out.suggestLast = g.last; }
  if (role !== 'student') {
    out.classes = pcTeacherClasses_({ email: email, isAdmin: role === 'admin' });
    out.lastClassId = pcTeacherLastClass_(email);
    out.defaultClassId = pcBusiestClass_(out.classes);
    out.lmsHub = typeof lmsHubEnabled_ === 'function' ? lmsHubEnabled_() : false;
    try { out.canvas = pcCanvasStatus_(email); } catch (e) { out.canvas = { connected: false }; }
  }
  return out;
}
// The teacher dashboard opens on the class used last, on any computer (cross-app, Lit Circles
// 2026-10-18g). One Script Property per teacher (the app runs as its owner, so UserProperties would be
// shared by everyone). With nothing remembered: the class with the most students, not the first made.
var PC_LAST_CLASS_PROP = 'PC_LAST_CLASS::';
function pcTeacherLastClass_(email) { try { return String(PropertiesService.getScriptProperties().getProperty(PC_LAST_CLASS_PROP + pcNorm_(email)) || ''); } catch (e) { return ''; } }
function pcBusiestClass_(classes) {
  if (!classes || classes.length < 2) return classes && classes[0] ? String(classes[0].classId) : '';
  var count = {}, seen = {};
  pcEnrollAll_().forEach(function (e) {
    var k = String(e.ClassId) + '|' + pcNorm_(e.Email);
    if (seen[k] || !pcTruthy_(e.Active) || pcIsDemo_(e.Email)) return;
    seen[k] = true; count[String(e.ClassId)] = (count[String(e.ClassId)] || 0) + 1;
  });
  var best = String(classes[0].classId);
  classes.forEach(function (c) { if ((count[String(c.classId)] || 0) > (count[best] || 0)) best = String(c.classId); });
  return best;
}
function rememberTeacherClass(payload) {
  var ctx = pcTeacherClass_(String((payload || {}).classId || ''));
  PropertiesService.getScriptProperties().setProperty(PC_LAST_CLASS_PROP + ctx.teacher.email, String(ctx.klass.ClassId));
  return { ok: true, classId: String(ctx.klass.ClassId) };
}
function adminListAccess() {
  pcRequireAdmin_(); PC_X_.users = null;
  return { ok: true, users: pcUsers_().map(function (u) { return { email: pcNorm_(u.Email), name: pcCellText_(u.Name), role: String(u.Role), status: String(u.Status) }; }),
    classes: pcClasses_().filter(function (c) { return pcTruthy_(c.Active); }).map(function (c) { return pcPublicClass_(c, true); }) };
}
function adminSetAccess(payload) {
  var me = pcRequireAdmin_(); payload = payload || {};
  var e = pcNorm_(payload.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Type a full school email address.');
  var role = ['teacher', 'admin'].indexOf(payload.role) >= 0 ? payload.role : 'teacher';
  var status = payload.status === 'inactive' ? 'inactive' : 'active';
  if (e === me.email && (status !== 'active' || role !== 'admin')) throw new Error('You can’t remove your own admin access.');
  pcUpsertUser_(e, pcClean_(payload.name, 80).trim() || pcNameFromEmail_(e), role, status);
  return adminListAccess();
}

// The unit (PodcastData.js) and everything students do lives in Unit.js.

// ============================================================================
// EDITOR TOOLS: restoring a student's earlier copy (restores as the newest DRAFT, never over turned-in work)
// ============================================================================

function listWorkBackups() {
  var e = pcNorm_(RESTORE_STUDENT); if (!e) throw new Error('Type the student’s email in RESTORE_STUDENT at the top of Code first.');
  var sh = pcSheet_('WorkBackups'), rows = pcReadRows_(sh, pcFindRowNums_(sh, 'Email', e));
  if (!rows.length) { Logger.log('No backups for ' + e + '.'); return []; }
  return rows.reverse().map(function (r) {
    var line = 'Row ' + r._row + ' · ' + pcIso_(r.SavedAt) + ' · Week ' + r.Week + ' ' + r.Kind + ' · ' + r.Reason + ' · ' + r.Chars + ' characters';
    Logger.log(line); return line;
  });
}
function restoreWorkBackup() {
  var e = pcNorm_(RESTORE_STUDENT), row = Number(RESTORE_ROW);
  if (!e || !row) throw new Error('Set RESTORE_STUDENT and RESTORE_ROW (from listWorkBackups) at the top of Code first.');
  var sh = pcSheet_('WorkBackups'), b = pcReadRows_(sh, [row])[0];
  if (!b || pcNorm_(b.Email) !== e) throw new Error('Row ' + row + ' is not a backup for ' + e + '.');
  var json = pcJoin_(b, 'DataJson', 3); JSON.parse(json);
  pcUpsert_('Work', 'Email', { ClassId: b.ClassId, Email: e, Week: b.Week, Kind: b.Kind }, function (r, now) {
    if (r) pcBackup_(String(b.ClassId), e, b.Week, b.Kind, pcJoin_(r, 'DataJson', 3), json, 'before-restore');
    var f = pcSplit_('DataJson', 3, json); f.UpdatedAt = now; return f;
  });
  Logger.log('Restored row ' + row + ' as the newest draft of Week ' + b.Week + ' ' + b.Kind + ' for ' + e + '. Turned-in work was not changed.');
  return true;
}

// ============================================================================
// checkFiles: proves every file in the project is the one this release shipped.
// ============================================================================

var FILE_FINGERPRINTS = {"Index":{"chars":15283,"md5":"14ec2b86df40f662b4f4829eaa801811","loose":"0377aaa3b28e26edd07bcc4e0e84533c"},"Marking":{"chars":45363,"md5":"2d044266012c000e2b2c3d8bfa2910a6","loose":"381f97a691b759e146c22d30df7cdbd1"},"PodcastTheme":{"chars":967118,"md5":"3bfe74cee43c81e01d4b4363e4405936","loose":"3ba5811dcca851796efae84323502ee2"},"SaveGuard":{"chars":13490,"md5":"502c603f291f88145f86cf77b318d426","loose":"dc67d5c95c2d30e31226be8533fa9a20"},"Student":{"chars":86680,"md5":"e66fe36ce34ae5cb3fdcba5c01ede7fd","loose":"2935992935f9a6658585201c46640ffa"},"Teacher":{"chars":66316,"md5":"81aa5fc364900c11fa8db30bee3aa263","loose":"774fa114688477acd419dba232cbfea4"},"WritingStats":{"chars":5075,"md5":"204ca2e52966b59319a8d88f4d66373a","loose":"b1ffb94ec4014918688ca9d78a498a09"}};
function checkFiles() {
  var lines = [];
  Object.keys(FILE_FINGERPRINTS).forEach(function (name) {
    var want = FILE_FINGERPRINTS[name], got = '';
    try { got = HtmlService.createHtmlOutputFromFile(name).getContent(); } catch (e) { lines.push('MISSING  ' + name); return; }
    var md5 = pcMd5_(got), loose = pcMd5_(got.replace(/\s+/g, ''));
    var status = md5 === want.md5 ? 'OK' : loose === want.loose ? 'OK (spacing only)' : got.length < want.chars ? 'SHORT' : got.length > want.chars ? 'TOO BIG' : 'DIFFERS';
    lines.push(status + '  ' + name + '  (' + got.length + ' of ' + want.chars + ' characters)');
  });
  lines.forEach(function (l) { Logger.log(l); });
  return lines;
}
