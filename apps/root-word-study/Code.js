/**
 * Vocabulary Root Word Study — backend (Google Apps Script)
 * =========================================================
 * Release 2026-10-12a — classes, teacher + admin dashboard, weekly Final Quiz, Canvas.
 *
 * Files in this Apps Script project:
 *   Code.gs        this file (the server)
 *   RootWords.gs   the 20 weeks of roots (the page and the quiz both read it)
 *   LmsHub.gs      unchanged copy from Literature Circles (only used if LMS_HUB_ENABLED = true)
 *   VocabTool      the page (HTML file)
 *
 * ROLES (same model as Literature Circles)
 *   admin    — everything a teacher can do, for every class, plus the Access tab
 *              (add teachers / admins). TEACHER_EMAIL below is made admin on first run.
 *   teacher  — creates classes, shares a join code or adds students by email, opens each
 *              week's Final Quiz, sees results, allows retakes, pushes scores to Canvas.
 *   student  — everyone else signed in with a school Google account.
 *
 * STUDENT DATA
 *   VocabProgress  sentences, flashcards, pretests — the SAME tab and columns as before, so
 *                  existing students keep all their work.
 *   RW_Quiz        one row per quiz attempt. Questions and the answer key stay on the server;
 *                  each answer is checked here, never in the browser.
 *   RW_Users, RW_Classes, RW_Enrollment — access, classes, rosters.
 * New tabs and columns create themselves the first time they're needed.
 *
 * FINAL QUIZ SCORING
 *   12 multiple-choice questions from that week's 25 roots, 4 choices each.
 *   Right on the first try = 1 point. Wrong first try → one more try; right then = ½ point.
 *   Two misses = 0 and the right answer is shown. Out of 12.
 * ATTEMPTS (2026-10-12b)
 *   Each class sets attempts per week (1–5 or unlimited; default 1). Every attempt has new
 *   questions; the BEST finished attempt is the score (dashboard, gradebook, Canvas). A teacher
 *   can give one student extra attempts, or set an attempt aside ("Don't count" — it no longer
 *   counts toward the score or the limit; "Count again" undoes it). Nothing is ever deleted.
 */

// The app's first admin. In a copy shared with another teacher this is left '' — then whoever
// runs setupRootWordStudy() first becomes the admin (only while the app has no admin).
var TEACHER_EMAIL = '';

// Students must sign in with an account at this domain. Teachers/admins you add on the Teacher
// access tab can use any account. Set to '' to allow any Google account.
var RW_STUDENT_DOMAIN = '';

// ---------- Getting a student's sentences back (run from the Apps Script editor) ----------
// Before a risky overwrite (the saved copy can't be read, or a save would empty several sentences at
// once) the old copy is kept in the VocabBackups tab. To restore one:
//   1. Type the student's email in RESTORE_STUDENT below. Save. Run listVocabBackups.
//      The Execution log lists each backup with its row number.
//   2. Type that row number in RESTORE_ROW. Save. Run restoreVocabBackup.
//      The student's current copy is backed up first, so a restore can be undone.
//   3. Put both back to '' when you're done. The student reloads the page.
var RESTORE_STUDENT = '';
var RESTORE_ROW = '';
var RW_APP_VERSION = '2026-10-23b';

// ====== TOOL PAGE ======
var TOOL_FILE = 'VocabTool';

// ====== QUIZ SETTINGS ======
var RW_QUIZ_QUESTIONS = 12;   // questions per weekly Final Quiz (one point each)
var RW_QUIZ_CHOICES = 4;      // answer choices per question
var RW_SECOND_TRY_POINTS = 0.5;

// ====== SHEET SCHEMA ======
// VocabProgress keeps its original name and columns (A–H) so existing work carries over.
var SHEET_NAME = 'VocabProgress';
var SHEET_HEADERS = [
  'Email', 'LastSaved',
  'CurrentWeek', 'CurrentDay',
  'SentencesJSON', 'FlashKnownJSON', 'FlashLearningJSON', 'PretestDoneJSON',
  // Added 2026-10-12c at the END (column I): { w1: { pct: 64, known: 16, total: 25, at: '...' } }
  // pct = share of the week's roots matched right on the FIRST try in the pretest.
  'PretestScoreJSON',
  // Added 2026-10-12d (columns J–P): overflow for SentencesJSON. A Google Sheets cell holds at most
  // 50,000 characters, and a full year of sentences (500 roots) can pass that. The sentences are
  // split into pieces of RW_CHUNK characters: piece 1 stays in column E, the rest go here.
  'SentencesJSON2', 'SentencesJSON3', 'SentencesJSON4', 'SentencesJSON5', 'SentencesJSON6', 'SentencesJSON7', 'SentencesJSON8'
];
var RW_CHUNK = 45000;           // characters per cell (the hard limit is 50,000)
var RW_CHUNK_MARK = '~';        // pieces 2–8 start with this so Sheets never reads one as a number, date or formula
var RW_SENTENCE_COLS = ['SentencesJSON', 'SentencesJSON2', 'SentencesJSON3', 'SentencesJSON4', 'SentencesJSON5', 'SentencesJSON6', 'SentencesJSON7', 'SentencesJSON8'];
var RW_CELL_LIMIT = 50000;
var RW_BACKUP_SHEET = 'VocabBackups';
var RW_BACKUP_HEADERS = ['Email', 'SavedAt', 'Reason', 'Filled', 'Chars'].concat(RW_SENTENCE_COLS);
var RW_SHEETS = { USERS: 'RW_Users', CLASSES: 'RW_Classes', ENROLL: 'RW_Enrollment', QUIZ: 'RW_Quiz', STUDENTS: 'RW_Students' };
var RW_HEADERS = {
  RW_Users: ['Email', 'Name', 'Role', 'Status', 'UpdatedAt'],
  RW_Classes: ['ClassId', 'TeacherEmail', 'ClassName', 'Period', 'JoinCode', 'SettingsJson', 'Active', 'CreatedAt', 'UpdatedAt'],
  RW_Enrollment: ['ClassId', 'StudentEmail', 'StudentName', 'Active', 'JoinedAt', 'NameSource'],
  // The first and last name each student types the first time they sign in (email comes from Google).
  RW_Students: ['Email', 'FirstName', 'LastName', 'UpdatedAt'],
  // Status: in_progress | submitted | reset. CanvasPostedScore: what was last sent to Canvas.
  RW_Quiz: ['AttemptId', 'Email', 'WeekId', 'ClassId', 'Status', 'QuestionsJson', 'AnswersJson', 'Score', 'MaxScore', 'StartedAt', 'SubmittedAt', 'UpdatedAt', 'CanvasPostedScore', 'ResetBy']
};

// ============================================================================
// ENTRY POINT
// ============================================================================

/** Serves the page. The root lists are handed to the page from RootWords.gs, so they live in one place. */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile(TOOL_FILE);
  t.rootDataJson = JSON.stringify(rwWeeks_()).replace(/</g, '\\u003c');
  t.appVersion = RW_APP_VERSION;
  return t.evaluate()
    .setTitle('Vocabulary Root Word Study')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// SMALL HELPERS
// ============================================================================

var RW_X_ = { ss: null, sheets: {}, headers: {}, users: null, classes: null, enroll: null, students: null };

function normalizeEmail_(email) { return (email || '').toString().trim().toLowerCase(); }
function rwCurrentEmail_() { try { return normalizeEmail_(Session.getActiveUser().getEmail()); } catch (e) { return ''; } }
function rwTz_() { try { return Session.getScriptTimeZone() || 'UTC'; } catch (e) { return 'UTC'; } }
function rwNow_() { return Utilities.formatDate(new Date(), rwTz_(), 'yyyy-MM-dd HH:mm:ss'); }
/** Any cell value as plain text. Sheets turns date-looking text into Date objects, and a Date in a
 *  google.script.run reply makes the WHOLE reply arrive as null, so every date goes back as text. */
function rwText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, rwTz_(), 'yyyy-MM-dd HH:mm:ss');
  return String(v);
}
function rwTruth_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function rwParse_(v, fallback) { try { return (v && typeof v === 'object') ? v : JSON.parse(String(v || '')); } catch (e) { return fallback; } }
function rwNameFromEmail_(email) {
  var p = normalizeEmail_(email).split('@')[0].replace(/\+.*$/, '').replace(/[._-]+/g, ' ');
  return p.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
function rwMd5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text || ''), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function rwShuffle_(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function rwNum_(v) { var n = Number(v); return (v === '' || v === null || v === undefined || !isFinite(n)) ? null : n; }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The app is busy. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function rwAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

// ---------- sheets ----------

function rwSs_() { if (!RW_X_.ss) RW_X_.ss = SpreadsheetApp.getActiveSpreadsheet(); return RW_X_.ss; }

/** Opens a tab, creating it (with bold, frozen headers) or adding any missing columns at the END. */
function rwSheet_(name, headers) {
  if (RW_X_.sheets[name]) return RW_X_.sheets[name];
  var ss = rwSs_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  RW_X_.sheets[name] = sh;
  RW_X_.headers[name] = null;
  return sh;
}
function rwPlatformSheet_(name) { return rwSheet_(name, RW_HEADERS[name]); }
function rwHeaders_(sh) {
  var name = sh.getName();
  if (!RW_X_.headers[name]) RW_X_.headers[name] = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  return RW_X_.headers[name];
}
function rwCol_(sh, header) { return rwHeaders_(sh).indexOf(header) + 1; }
function rwRowToObj_(headers, values, rowNum) {
  var o = { _row: rowNum };
  headers.forEach(function (h, i) { if (h) o[h] = values[i]; });
  return o;
}
function rwAllRows_(sh) {
  var last = sh.getLastRow(); if (last < 2) return [];
  var h = rwHeaders_(sh), vals = sh.getRange(2, 1, last - 1, h.length).getValues();
  return vals.map(function (v, i) { return rwRowToObj_(h, v, i + 2); });
}
/** Only some columns of every row (cheap way to scan a big tab). */
function rwColumns_(sh, names) {
  var last = sh.getLastRow(); if (last < 2) return [];
  var cols = names.map(function (n) { return rwCol_(sh, n); });
  var data = cols.map(function (c) { return c ? sh.getRange(2, c, last - 1, 1).getValues() : null; });
  var out = [];
  for (var i = 0; i < last - 1; i++) {
    var o = { _row: i + 2 };
    names.forEach(function (n, j) { o[n] = data[j] ? data[j][i][0] : ''; });
    out.push(o);
  }
  return out;
}
/** Row numbers whose cell in `header` equals `value` exactly (case-insensitive). Uses TextFinder,
 *  so it doesn't read the big JSON columns. */
function rwFindRows_(sh, header, value) {
  var col = rwCol_(sh, header), last = sh.getLastRow();
  if (!col || last < 2 || !String(value)) return [];
  return sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(false)
    .findAll().map(function (r) { return r.getRow(); }).sort(function (a, b) { return a - b; });
}
function rwReadRow_(sh, rowNum) {
  var h = rwHeaders_(sh);
  return rwRowToObj_(h, sh.getRange(rowNum, 1, 1, h.length).getValues()[0], rowNum);
}
function rwObjToRow_(sh, obj) { return rwHeaders_(sh).map(function (h) { var v = obj[h]; return v === undefined || v === null ? '' : v; }); }
function rwAppend_(sh, obj) { sh.appendRow(rwObjToRow_(sh, obj)); return sh.getLastRow(); }
function rwPatchRow_(sh, rowNum, fields) {
  var cur = rwReadRow_(sh, rowNum);
  Object.keys(fields).forEach(function (k) { cur[k] = fields[k]; });
  sh.getRange(rowNum, 1, 1, rwHeaders_(sh).length).setValues([rwObjToRow_(sh, cur)]);
  return cur;
}
function rwPlatformRows_(name) {
  var key = { RW_Users: 'users', RW_Classes: 'classes', RW_Enrollment: 'enroll', RW_Students: 'students' }[name];
  if (key && RW_X_[key]) return RW_X_[key];
  var rows = rwAllRows_(rwPlatformSheet_(name));
  if (key) RW_X_[key] = rows;
  return rows;
}
function rwForget_() { RW_X_.users = null; RW_X_.classes = null; RW_X_.enroll = null; RW_X_.students = null; }

// ============================================================================
// STUDENT PROGRESS (sentences, flashcards, pretests) — unchanged format
// ============================================================================

function getCurrentUserEmail() { return rwCurrentEmail_(); }

/** Signed-in email if it's allowed to use the app as a student (school domain, or listed staff). */
function rwDomainOk_(email) {
  if (!RW_STUDENT_DOMAIN) return true;
  if (normalizeEmail_(email).split('@')[1] === String(RW_STUDENT_DOMAIN).toLowerCase()) return true;
  var u = rwUser_(email); return !!(u && String(u.Status) === 'active');
}
function rwWrongDomainMsg_(email) {
  return 'You’re signed in as ' + email + '. This app is for ' + RW_STUDENT_DOMAIN + ' school accounts. Switch to your ' + RW_STUDENT_DOMAIN + ' account (or sign out of the other one), then reload.';
}
function rwRequireStudentEmail_() {
  var email = rwCurrentEmail_();
  if (!email) throw new Error('Couldn’t verify your Google sign-in. Make sure you’re signed in to your ' + (RW_STUDENT_DOMAIN || 'school') + ' account.');
  if (!rwDomainOk_(email)) throw new Error(rwWrongDomainMsg_(email));
  return email;
}

function saveData(data) {
  var email = rwCurrentEmail_();
  if (!email) return { ok: false, error: "Couldn't verify your Google sign-in. Make sure you're logged into your school Google account." };
  if (!rwDomainOk_(email)) return { ok: false, error: rwWrongDomainMsg_(email) };
  return handleSave_(email, data || {});
}

function loadData() {
  var email = rwCurrentEmail_();
  if (!email) return { ok: false, error: "Couldn't verify your Google sign-in. Make sure you're logged into your school Google account." };
  return handleLoad_(email);
}

function getSheet_() {
  var sh = rwSs_().getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = rwSs_().insertSheet(SHEET_NAME);
    sh.appendRow(SHEET_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
  } else if (sh.getLastColumn() < SHEET_HEADERS.length) {
    sh.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]).setFontWeight('bold');
  }
  return sh;
}

/** The student's row (last match wins, as a safety net if a duplicate ever appears). */
function findRow_(sheet, email) {
  var last = sheet.getLastRow(); if (last < 2 || !email) return -1;
  var hits = sheet.getRange(2, 1, last - 1, 1).createTextFinder(email).matchEntireCell(true).matchCase(false).findAll();
  if (!hits.length) return -1;
  return hits[hits.length - 1].getRow();
}

/** Splits a long JSON string into cell-sized pieces (8 × 45,000 = 360,000 characters of room). */
function rwSplitChunks_(json) {
  json = String(json || '');
  var parts = [];
  for (var i = 0; i < RW_SENTENCE_COLS.length; i++) {
    var piece = json.slice(i * RW_CHUNK, (i + 1) * RW_CHUNK);
    parts.push(i === 0 || !piece ? piece : RW_CHUNK_MARK + piece);
  }
  if (json.length > RW_CHUNK * RW_SENTENCE_COLS.length) return null;
  return parts;
}
/** Joins the pieces back together (works for old rows that only have column E). */
function rwJoinChunks_(values) {
  return values.map(function (v, i) {
    var t = v instanceof Date ? '' : String(v == null ? '' : v);
    return i > 0 && t.charAt(0) === RW_CHUNK_MARK ? t.slice(1) : t;
  }).join('');
}
function rwFilledCount_(sentences) {
  var n = 0;
  Object.keys(sentences || {}).forEach(function (w) { var wk = sentences[w] || {}; Object.keys(wk).forEach(function (k) { if (String(wk[k] || '').trim()) n++; }); });
  return n;
}
/** Keeps a copy of a student's sentences in the VocabBackups tab before a risky overwrite. */
function rwBackupSentences_(email, rawJson, reason) {
  try {
    var sh = rwSheet_(RW_BACKUP_SHEET, RW_BACKUP_HEADERS), parts = rwSplitChunks_(rawJson) || [String(rawJson).slice(0, RW_CHUNK)];
    var parsed = rwParse_(rawJson, null);
    sh.appendRow([email, rwNow_(), reason, parsed ? rwFilledCount_(parsed) : '', String(rawJson).length].concat(parts));
  } catch (e) { /* a backup must never stop the save itself */ }
}

function handleSave_(email, data) {
  var sheet = getSheet_();
  var now = rwNow_();
  var sentCol = SHEET_HEADERS.indexOf('SentencesJSON');
  var rowValues = SHEET_HEADERS.map(function (h) {
    if (h === 'Email') return email;
    if (h === 'LastSaved') return now;
    if (RW_SENTENCE_COLS.indexOf(h) > 0) return '';           // filled from the split below
    var v = data[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  var sentJson = '';
  if (data.SentencesJSON !== undefined) {
    sentJson = typeof data.SentencesJSON === 'object' ? JSON.stringify(data.SentencesJSON || {}) : String(data.SentencesJSON || '');
    var parts = rwSplitChunks_(sentJson);
    if (!parts) return { ok: false, tooBig: true, error: 'Your sentences are too long to save (' + sentJson.length + ' characters). Your writing is still on this screen. Tell your teacher.' };
    RW_SENTENCE_COLS.forEach(function (h, k) { rowValues[SHEET_HEADERS.indexOf(h)] = parts[k]; });
  }
  // Nothing may ever be written into a cell past Google's 50,000-character limit: say so clearly
  // instead of failing the whole save (that is what silently lost work in other apps).
  for (var c = 0; c < rowValues.length; c++) {
    if (typeof rowValues[c] === 'string' && rowValues[c].length > RW_CELL_LIMIT - 500) {
      return { ok: false, tooBig: true, error: 'Part of your work (' + SHEET_HEADERS[c] + ') is too large to save. Your writing is still on this screen. Tell your teacher.' };
    }
  }
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(15000);
  try {
    var row = findRow_(sheet, email);
    if (row === -1) sheet.appendRow(rowValues);
    else {
      var existing = sheet.getRange(row, 1, 1, SHEET_HEADERS.length).getValues()[0];
      // A field the page didn't send (e.g. an older tab that doesn't know about PretestScoreJSON)
      // keeps what's already saved instead of being blanked.
      SHEET_HEADERS.forEach(function (h, i) {
        if (h === 'Email' || h === 'LastSaved') return;
        var key = RW_SENTENCE_COLS.indexOf(h) >= 0 ? 'SentencesJSON' : h;
        if (data[key] === undefined) rowValues[i] = existing[i];
      });
      if (data.SentencesJSON !== undefined) {
        // Safety net: keep a copy first if the saved sentences can't be read, or if this save
        // would empty out several sentences at once (e.g. a tab that loaded blank).
        var oldJson = rwJoinChunks_(RW_SENTENCE_COLS.map(function (h) { return existing[SHEET_HEADERS.indexOf(h)]; }));
        if (oldJson) {
          var oldObj = rwParse_(oldJson, null), newObj = rwParse_(sentJson, {});
          if (!oldObj) rwBackupSentences_(email, oldJson, 'saved copy could not be read');
          else if (rwFilledCount_(oldObj) - rwFilledCount_(newObj) >= 3) rwBackupSentences_(email, oldJson, 'save emptied ' + (rwFilledCount_(oldObj) - rwFilledCount_(newObj)) + ' sentences');
        }
      }
      sheet.getRange(row, 1, 1, SHEET_HEADERS.length).setValues([rowValues]);
    }
  } finally { if (locked) lock.releaseLock(); }
  return { ok: true, savedAt: now, chars: sentJson.length };
}

function rwProgressFromValues_(values) {
  var data = {};
  values = values.slice();
  var joined = rwJoinChunks_(RW_SENTENCE_COLS.map(function (h) { return values[SHEET_HEADERS.indexOf(h)]; }));
  values[SHEET_HEADERS.indexOf('SentencesJSON')] = joined;
  SHEET_HEADERS.forEach(function (h, i) {
    if (h === 'Email' || h === 'LastSaved' || RW_SENTENCE_COLS.indexOf(h) > 0) return;
    var v = values[i];
    if (v instanceof Date) v = rwText_(v);
    if (typeof v === 'string' && /JSON$/.test(h) && v) {
      try { v = JSON.parse(v); } catch (parseErr) { v = null; data._unreadable = (data._unreadable || []).concat([h]); }
    }
    data[h] = v;
  });
  return data;
}

function handleLoad_(email) {
  var sheet = getSheet_();
  var row = findRow_(sheet, email);
  if (row === -1) return { ok: true, found: false, data: {} };
  var values = sheet.getRange(row, 1, 1, SHEET_HEADERS.length).getValues()[0];
  return { ok: true, found: true, data: rwProgressFromValues_(values), lastSaved: rwText_(values[1]) };
}

/** Sentences + pretests for many students at once (teacher views). email -> parsed data. */
function rwProgressFor_(emails) {
  var want = {}; emails.forEach(function (e) { want[normalizeEmail_(e)] = true; });
  var sheet = getSheet_(), last = sheet.getLastRow(), out = {};
  if (last < 2) return out;
  var vals = sheet.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues();
  vals.forEach(function (v) {
    var em = normalizeEmail_(v[0]);
    if (want[em]) out[em] = rwProgressFromValues_(v);
  });
  return out;
}
function rwWeekUnlocked_(progress, week) {
  if (!progress) return false;
  if (progress.PretestDoneJSON && progress.PretestDoneJSON[week.id]) return true;
  return rwSentencesDone_(progress, week) > 0;
}
/** A student's pretest for one week: done?, and (if recorded) % of roots right on the first try. */
function rwPretestOf_(progress, weekId) {
  var done = !!(progress && progress.PretestDoneJSON && progress.PretestDoneJSON[weekId]);
  var sc = progress && progress.PretestScoreJSON && progress.PretestScoreJSON[weekId];
  var pct = sc && isFinite(Number(sc.pct)) ? Math.max(0, Math.min(100, Math.round(Number(sc.pct)))) : null;
  return { done: done || pct !== null, pct: pct, known: sc && isFinite(Number(sc.known)) ? Number(sc.known) : null, total: sc && Number(sc.total) || null };
}
function rwPct_(score, max) { return score == null || !max ? null : Math.round(score / max * 100); }
function rwMean_(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
function rwSentencesDone_(progress, week) {
  var s = (progress && progress.SentencesJSON && progress.SentencesJSON[week.id]) || {};
  return rwAllRoots_(week).filter(function (r) { return String(s[rwRootKey_(r)] || '').trim().length > 0; }).length;
}

// ============================================================================
// ACCESS: users, classes, enrollment
// ============================================================================

/** True once the RW_Users tab has an active admin. */
function rwHasActiveAdmin_() {
  return rwPlatformRows_(RW_SHEETS.USERS).some(function (u) { return String(u.Role) === 'admin' && String(u.Status) === 'active'; });
}

function rwEnsurePlatform_(firstAdmin) {
  Object.keys(RW_HEADERS).forEach(function (n) { rwPlatformSheet_(n); });
  var admin = normalizeEmail_(TEACHER_EMAIL);
  // A copy with TEACHER_EMAIL blank: the person running setup becomes admin, but only while there is none.
  if (!admin && firstAdmin && !rwHasActiveAdmin_()) admin = normalizeEmail_(firstAdmin);
  if (admin && !rwUser_(admin)) {
    withLock_(function () {
      rwForget_();
      if (!rwUser_(admin)) rwAppend_(rwPlatformSheet_(RW_SHEETS.USERS), { Email: admin, Name: rwNameFromEmail_(admin), Role: 'admin', Status: 'active', UpdatedAt: rwNow_() });
      rwForget_();
    });
  }
}

/** Run once from the Apps Script editor after pasting (creates the tabs, makes TEACHER_EMAIL admin,
 *  and brings up Google's permission prompt in a normal tab). */
function setupRootWordStudy() {
  getSheet_();
  var me = rwCurrentEmail_();
  rwEnsurePlatform_(me);
  Logger.log('Root Word Study ' + RW_APP_VERSION + ' is set up. Admin: ' + (normalizeEmail_(TEACHER_EMAIL) || me));
  Logger.log('Spreadsheet: ' + rwSs_().getUrl());
  return { ok: true, version: RW_APP_VERSION };
}

function rwUser_(email) {
  var e = normalizeEmail_(email), found = null;
  rwPlatformRows_(RW_SHEETS.USERS).forEach(function (u) { if (normalizeEmail_(u.Email) === e) found = u; });
  return found;
}
function rwRoleOf_(email) {
  var u = rwUser_(email);
  if (u && String(u.Status) === 'active' && ['teacher', 'admin'].indexOf(String(u.Role)) >= 0) return String(u.Role);
  return 'student';
}
function rwRequireTeacher_() {
  var email = rwCurrentEmail_(), role = rwRoleOf_(email);
  if (role !== 'teacher' && role !== 'admin') throw new Error('Teacher access has not been set up for ' + (email || 'this account') + '.');
  var u = rwUser_(email);
  return { email: email, role: role, name: String((u && u.Name) || rwNameFromEmail_(email)) };
}
function rwRequireAdmin_() { var t = rwRequireTeacher_(); if (t.role !== 'admin') throw new Error('Administrator access required.'); return t; }

function rwDefaultSettings_() {
  // quizAttempts: { w1: 2, ... } per week (0 = unlimited); weeks not listed use defaultAttempts.
  // bonusAttempts: { 'email|w1': 1 } — extra tries a teacher gave one student.
  // excludedQuiz: { 'email|w1': true } — that week's Final Quiz is left out of that student's grade
  //   (2026-10-18a). Their attempts are kept; Canvas marks the student Excused on the next push.
  // quizSchedule: { w1: { dueAt: '2026-10-16T09:59:00.000Z' or '', moduleId, moduleName } } — set on the week card.
  // visibleWeeks: the weeks students in this class can see (null = all of them, for classes made
  // before this setting existed). New classes start with Week 1 only.
  return { visibleWeeks: null, openQuizzes: [], defaultAttempts: 1, quizAttempts: {}, bonusAttempts: {}, excludedQuiz: {}, quizSchedule: {}, canvas: { courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: '', assignments: {} } };
}
function rwQuizExcluded_(settings, email, weekId) { return !!(settings.excludedQuiz || {})[normalizeEmail_(email) + '|' + weekId]; }
function rwWeekVisible_(settings, weekId) { return !settings.visibleWeeks || settings.visibleWeeks.indexOf(String(weekId)) >= 0; }
function rwVisibleList_(settings) { return rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return rwWeekVisible_(settings, w); }); }
function rwIsoOrBlank_(v) { var t = String(v || '').trim(); if (!t) return ''; var d = new Date(t); return isNaN(d.getTime()) ? '' : d.toISOString(); }
function rwAttemptsNum_(v) { var n = Math.floor(Number(v)); return isFinite(n) && n >= 0 && n <= 20 ? n : null; }
/** How many attempts this student gets for this week in this class (0 = unlimited). */
function rwAllowedAttempts_(settings, weekId, email) {
  var base = rwAttemptsNum_(settings.quizAttempts[weekId]);
  if (base === null) base = settings.defaultAttempts;
  if (base === 0) return 0;
  return base + (Number(settings.bonusAttempts[normalizeEmail_(email) + '|' + weekId]) || 0);
}
function rwNormalizeSettings_(value) {
  var raw = rwParse_(value, {}) || {}, d = rwDefaultSettings_();
  if (Array.isArray(raw.visibleWeeks)) d.visibleWeeks = rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return raw.visibleWeeks.map(String).indexOf(w) >= 0; });
  if (Array.isArray(raw.openQuizzes)) d.openQuizzes = raw.openQuizzes.map(String).filter(function (w) { return /^w([1-9]|1[0-9]|20)$/.test(w); });
  if (rwAttemptsNum_(raw.defaultAttempts) !== null && raw.defaultAttempts !== '') d.defaultAttempts = rwAttemptsNum_(raw.defaultAttempts);
  Object.keys(raw.quizAttempts || {}).forEach(function (w) { var n = rwAttemptsNum_(raw.quizAttempts[w]); if (n !== null && /^w([1-9]|1[0-9]|20)$/.test(w)) d.quizAttempts[w] = n; });
  Object.keys(raw.bonusAttempts || {}).forEach(function (k) { var n = rwAttemptsNum_(raw.bonusAttempts[k]); if (n) d.bonusAttempts[k] = n; });
  Object.keys(raw.excludedQuiz || {}).forEach(function (k) { if (raw.excludedQuiz[k] && /\|w([1-9]|1[0-9]|20)$/.test(k)) d.excludedQuiz[k] = true; });
  Object.keys(raw.quizSchedule || {}).forEach(function (w) {
    var x = raw.quizSchedule[w] || {}; if (!/^w([1-9]|1[0-9]|20)$/.test(w)) return;
    d.quizSchedule[w] = { dueAt: rwIsoOrBlank_(x.dueAt), moduleId: String(x.moduleId || ''), moduleName: String(x.moduleName || '') };
  });
  d.canvas = Object.assign({}, d.canvas, raw.canvas || {});
  d.canvas.assignments = Object.assign({}, (raw.canvas && raw.canvas.assignments) || {});
  if (raw.canvas && raw.canvas.lmsHub) d.canvas.lmsHub = raw.canvas.lmsHub;
  return d;
}
function rwClass_(id) {
  var found = null;
  rwPlatformRows_(RW_SHEETS.CLASSES).forEach(function (c) { if (String(c.ClassId) === String(id)) found = c; });
  return found;
}
function rwPublicClass_(c, forTeacher) {
  var s = rwNormalizeSettings_(c.SettingsJson), out = {
    classId: String(c.ClassId), className: rwText_(c.ClassName), period: rwText_(c.Period),
    teacherEmail: normalizeEmail_(c.TeacherEmail), active: rwTruth_(c.Active), openQuizzes: s.openQuizzes
  };
  out.visibleWeeks = rwVisibleList_(s);
  out.dueDates = {};
  Object.keys(s.quizSchedule).forEach(function (w) { if (s.quizSchedule[w].dueAt) out.dueDates[w] = s.quizSchedule[w].dueAt; });
  if (forTeacher) { out.defaultAttempts = s.defaultAttempts; out.quizAttempts = s.quizAttempts; out.quizSchedule = s.quizSchedule; }
  if (forTeacher) {
    out.joinCode = String(c.JoinCode || '');
    out.canvas = { courseId: s.canvas.courseId || '', courseName: s.canvas.courseName || '', assignmentGroupId: s.canvas.assignmentGroupId || '', assignmentGroupName: s.canvas.assignmentGroupName || '', assignments: s.canvas.assignments };
  }
  return out;
}
function rwRequireClass_(classId) {
  var t = rwRequireTeacher_(), c = rwClass_(classId);
  if (!c || (t.role !== 'admin' && normalizeEmail_(c.TeacherEmail) !== t.email)) throw new Error('Class not found or access denied.');
  return { teacher: t, raw: c, settings: rwNormalizeSettings_(c.SettingsJson) };
}
/** Active roster, one entry per email (the latest row for an email wins), sorted by last name. */
/** The name a student typed (first + last), or null if they haven't yet. */
function rwProfiles_() {
  var out = {};
  rwPlatformRows_(RW_SHEETS.STUDENTS).forEach(function (r) {
    var em = normalizeEmail_(r.Email), f = rwText_(r.FirstName).trim(), l = rwText_(r.LastName).trim();
    if (em && f && l) out[em] = { firstName: f, lastName: l };
  });
  return out;
}
function rwProfile_(email) { return rwProfiles_()[normalizeEmail_(email)] || null; }
/** Names: what the teacher typed with Rename wins, then the student's own first + last name,
 *  then a guess from the email. Sorted by last name. */
function rwEnrollments_(classId) {
  var byEmail = {}, teacherName = {}, profiles = rwProfiles_();
  rwPlatformRows_(RW_SHEETS.ENROLL).forEach(function (e) {
    if (String(e.ClassId) !== String(classId)) return;
    var em = normalizeEmail_(e.StudentEmail); if (!em) return;
    byEmail[em] = e;
    if (String(e.NameSource) === 'teacher') teacherName[em] = rwText_(e.StudentName);
    if (String(e.NameSource) === 'clear') delete teacherName[em];
  });
  return Object.keys(byEmail).map(function (k) { return byEmail[k]; }).filter(function (e) { return rwTruth_(e.Active); })
    .map(function (e) {
      var em = normalizeEmail_(e.StudentEmail), p = profiles[em];
      var name = teacherName[em] || (p ? p.firstName + ' ' + p.lastName : '') || rwText_(e.StudentName) || rwNameFromEmail_(em);
      return { email: em, name: name, firstName: p ? p.firstName : '', lastName: p ? p.lastName : '', named: !!p, renamed: !!teacherName[em], sortKey: p && !teacherName[em] ? (p.lastName + ' ' + p.firstName).toLowerCase() : rwSortName_(name) };
    })
    .sort(function (a, b) { return a.sortKey.localeCompare(b.sortKey); });
}
function rwSortName_(n) { var p = String(n).trim().split(/\s+/); return (p.length > 1 ? p[p.length - 1] + ' ' + p.slice(0, -1).join(' ') : p[0]).toLowerCase(); }

/** Cleans a typed name part: trims, single spaces, letters (any language), spaces, - ' . only. */
function rwCleanNamePart_(v, label) {
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Type your ' + label + '.');
  if (t.length > 40) throw new Error('Your ' + label + ' is too long (40 letters at most).');
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(t)) throw new Error('Use only letters in your ' + label + ' (spaces, hyphens and apostrophes are fine).');
  return t;
}
/** Student enters or changes their first and last name. The email always comes from Google. */
function saveMyName(payload) {
  payload = payload || {};
  var email = rwRequireStudentEmail_();
  var first = rwCleanNamePart_(payload.firstName, 'first name'), last = rwCleanNamePart_(payload.lastName, 'last name');
  rwEnsurePlatform_();
  withLock_(function () {
    var sh = rwPlatformSheet_(RW_SHEETS.STUDENTS), rows = rwFindRows_(sh, 'Email', email);
    var fields = { Email: email, FirstName: first, LastName: last, UpdatedAt: rwNow_() };
    if (rows.length) rwPatchRow_(sh, rows[rows.length - 1], fields); else rwAppend_(sh, fields);
    rwForget_();
  });
  return { ok: true, firstName: first, lastName: last, name: first + ' ' + last, email: email };
}
function rwClassesForStudent_(email) {
  var e = normalizeEmail_(email), state = {};
  rwPlatformRows_(RW_SHEETS.ENROLL).forEach(function (x) { if (normalizeEmail_(x.StudentEmail) === e) state[String(x.ClassId)] = rwTruth_(x.Active); });
  return rwPlatformRows_(RW_SHEETS.CLASSES).filter(function (c) { return state[String(c.ClassId)] && rwTruth_(c.Active); });
}
function rwUpdateClass_(classId, fn) {
  return withLock_(function () {
    var sh = rwPlatformSheet_(RW_SHEETS.CLASSES), rows = rwFindRows_(sh, 'ClassId', classId);
    if (!rows.length) throw new Error('Class not found.');
    var rec = rwReadRow_(sh, rows[rows.length - 1]), settings = rwNormalizeSettings_(rec.SettingsJson);
    var result = fn(rec, settings);
    var json = JSON.stringify(settings);
    if (json.length > 48000) throw new Error('Class settings are too large to save.');
    rwPatchRow_(sh, rec._row, { ClassName: rwText_(rec.ClassName), Period: rwText_(rec.Period), Active: rec.Active, SettingsJson: json, UpdatedAt: rwNow_() });
    rwForget_();
    return { settings: settings, result: result };
  });
}
function rwJoinCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = '';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// ============================================================================
// BOOTSTRAP — one call when the page opens
// ============================================================================

function getRootBootstrap() {
  var email = rwCurrentEmail_();
  if (!email) return { ok: false, error: "We couldn't detect a signed-in school Google account. Make sure you're logged into your school Google account in this browser, then try again." };
  rwEnsurePlatform_();
  if (!rwDomainOk_(email)) return { ok: false, wrongDomain: true, error: rwWrongDomainMsg_(email) };
  var role = rwRoleOf_(email), u = rwUser_(email), prof = rwProfile_(email);
  var classes = rwClassesForStudent_(email).map(function (c) { return rwPublicClass_(c, false); });
  var open = {}, vis = {};
  classes.forEach(function (c) {
    c.visibleWeeks.forEach(function (w) { vis[w] = true; });
    c.openQuizzes.forEach(function (w) { if (c.visibleWeeks.indexOf(w) >= 0) open[w] = true; });
  });
  return {
    ok: true, email: email, role: role,
    name: prof ? prof.firstName + ' ' + prof.lastName : String((u && u.Name) || rwNameFromEmail_(email)),
    firstName: prof ? prof.firstName : '', lastName: prof ? prof.lastName : '',
    needsName: role === 'student' && !prof,
    classes: classes, openQuizzes: Object.keys(open),
    // Students see only the weeks their teacher shows. No class yet (or staff): every week.
    visibleWeeks: role === 'student' && classes.length ? rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return vis[w]; }) : null, quizzes: rwQuizSummaryFor_(email),
    progress: handleLoad_(email), version: RW_APP_VERSION,
    quizRules: { questions: RW_QUIZ_QUESTIONS, choices: RW_QUIZ_CHOICES, secondTry: RW_SECOND_TRY_POINTS }
  };
}

function joinRootClass(payload) {
  payload = payload || {}; rwEnsurePlatform_();
  var email = rwRequireStudentEmail_();
  var code = String(payload.joinCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw new Error('Type the class code your teacher gave you.');
  var c = null;
  rwPlatformRows_(RW_SHEETS.CLASSES).forEach(function (x) { if (String(x.JoinCode || '').toUpperCase() === code && rwTruth_(x.Active)) c = x; });
  if (!c) throw new Error('That class code wasn’t found. Check it with your teacher.');
  var classId = String(c.ClassId);
  withLock_(function () {
    rwForget_();
    var already = rwEnrollments_(classId).some(function (e) { return e.email === email; });
    var p = rwProfile_(email);
    if (!already) rwAppend_(rwPlatformSheet_(RW_SHEETS.ENROLL), { ClassId: classId, StudentEmail: email, StudentName: p ? p.firstName + ' ' + p.lastName : rwNameFromEmail_(email), Active: true, JoinedAt: rwNow_(), NameSource: 'student' });
    rwForget_();
  });
  return { ok: true, classInfo: rwPublicClass_(rwClass_(classId), false) };
}

// ============================================================================
// FINAL QUIZ
// ============================================================================

var RW_STOP_TOKENS = ['of', 'the', 'a', 'an'];
function rwMeaningTokens_(m) {
  return String(m || '').toLowerCase().split(/[\/,]|\s+/).map(function (t) { return t.trim(); })
    .filter(function (t) { return t && RW_STOP_TOKENS.indexOf(t) < 0; });
}
/** Two meanings that are the same or share a word ("together"/"together", "in/not"/"not") must never
 *  sit side by side as "the answer" and "a wrong answer". */
function rwMeaningsClash_(a, b) {
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true;
  var ta = rwMeaningTokens_(a), tb = rwMeaningTokens_(b);
  return ta.some(function (t) { return tb.indexOf(t) >= 0; });
}
function rwStem_(root) { return String(root.root || root).toLowerCase().replace(/-/g, ''); }
/** A single, plain example word that really contains the root and isn't just the root itself. */
function rwUsableWords_(r) {
  var stem = rwStem_(r);
  return (r.examples || []).filter(function (w) {
    var lw = String(w).toLowerCase();
    return /^[a-z]+$/.test(lw) && lw.indexOf(stem) >= 0 && lw !== stem && lw.length >= stem.length + 2;
  });
}
function rwPickDistractors_(correct, candidates, clashFn, n) {
  var seen = {}, pool = [];
  candidates.forEach(function (c) {
    var k = String(c).toLowerCase();
    if (seen[k] || clashFn(c)) return;
    seen[k] = true; pool.push(c);
  });
  return rwShuffle_(pool).slice(0, n);
}

/** Builds one week's quiz: 12 different roots (2–3 from each day), 4 of each question kind. */
function rwBuildQuiz_(week) {
  var all = rwAllRoots_(week), everyRoot = [];
  rwWeeks_().forEach(function (w) { rwAllRoots_(w).forEach(function (r) { everyRoot.push(r); }); });
  var quotas = rwShuffle_([3, 3, 2, 2, 2]), chosen = [];
  week.days.forEach(function (d, i) {
    rwShuffle_(all.filter(function (r) { return r.day === d.day; })).slice(0, quotas[i]).forEach(function (r) { chosen.push(r); });
  });
  chosen = rwShuffle_(chosen).slice(0, RW_QUIZ_QUESTIONS);

  // 4 "word" questions go to roots that have a good example word; the rest split meaning/root.
  var wordCapable = chosen.filter(function (r) { return rwUsableWords_(r).length; });
  var wordSet = {};
  rwShuffle_(wordCapable).slice(0, Math.round(RW_QUIZ_QUESTIONS / 3)).forEach(function (r) { wordSet[rwRootKey_(r)] = true; });
  var flip = rwShuffle_([0, 1])[0];

  var questions = chosen.map(function (r, i) {
    var key = rwRootKey_(r), type;
    if (wordSet[key]) type = 'word';
    else { type = (flip % 2 === 0) ? 'meaning' : 'root'; flip++; }
    var choices, answer, lead, focus;
    var sameRoot = function (x) { return x.display === r.display; };
    if (type === 'meaning' || type === 'word') {
      var word = type === 'word' ? rwShuffle_(rwUsableWords_(r))[0] : '';
      var stemsInWord = type === 'word'
        ? all.filter(function (x) { return rwRootKey_(x) !== key && word.toLowerCase().indexOf(rwStem_(x)) >= 0; })
        : [];
      var clash = function (m) {
        if (rwMeaningsClash_(m, r.meaning)) return true;
        if (all.some(function (x) { return sameRoot(x) && rwMeaningsClash_(m, x.meaning); })) return true;
        return stemsInWord.some(function (x) { return rwMeaningsClash_(m, x.meaning); });
      };
      var picks = rwPickDistractors_(r.meaning, all.map(function (x) { return x.meaning; }), clash, RW_QUIZ_CHOICES - 1);
      if (picks.length < RW_QUIZ_CHOICES - 1) {
        var more = rwPickDistractors_(r.meaning, everyRoot.map(function (x) { return x.meaning; }), function (m) {
          return clash(m) || picks.some(function (p) { return rwMeaningsClash_(p, m); });
        }, RW_QUIZ_CHOICES - 1 - picks.length);
        picks = picks.concat(more);
      }
      choices = rwShuffle_([r.meaning].concat(picks));
      answer = choices.indexOf(r.meaning);
      if (type === 'word') { lead = 'This word is built on one of this week’s roots. What does that root mean?'; focus = word; }
      else { lead = 'What does this root mean?'; focus = r.display; }
    } else {
      var rootClash = function (d) {
        if (d === r.display) return true;
        return all.concat(everyRoot).some(function (x) { return x.display === d && rwMeaningsClash_(x.meaning, r.meaning); });
      };
      var rp = rwPickDistractors_(r.display, all.map(function (x) { return x.display; }), rootClash, RW_QUIZ_CHOICES - 1);
      if (rp.length < RW_QUIZ_CHOICES - 1) rp = rp.concat(rwPickDistractors_(r.display, everyRoot.map(function (x) { return x.display; }), function (d) { return rootClash(d) || rp.indexOf(d) >= 0; }, RW_QUIZ_CHOICES - 1 - rp.length));
      choices = rwShuffle_([r.display].concat(rp));
      answer = choices.indexOf(r.display);
      lead = 'Which root means…'; focus = '“' + r.meaning + '”';
    }
    return { n: i + 1, type: type, rootKey: key, root: r.display, meaning: r.meaning, day: r.day, lead: lead, focus: focus, choices: choices, answer: answer };
  });
  return questions;
}

function rwQuizSheet_() { return rwPlatformSheet_(RW_SHEETS.QUIZ); }

/** All attempt rows for one student and week, oldest first (no big columns read except for those rows). */
function rwAttemptRows_(email, weekId) {
  var sh = rwQuizSheet_();
  return rwFindRows_(sh, 'Email', email).map(function (n) { return rwReadRow_(sh, n); })
    .filter(function (r) { return String(r.WeekId) === String(weekId); });
}
function rwCurrentAttempt_(rows) {
  var live = rows.filter(function (r) { return r.Status === 'in_progress' || r.Status === 'submitted'; });
  return live.length ? live[live.length - 1] : null;
}
/** One student's attempts at one week, summed up. Finished attempts count; the BEST one is the score. */
function rwAttemptStats_(rows) {
  var submitted = rows.filter(function (r) { return r.Status === 'submitted'; });
  var inProgress = rows.filter(function (r) { return r.Status === 'in_progress'; }).pop() || null;
  var best = null, bestScore = null;
  submitted.forEach(function (r) { var sc = rwScore_(rwParse_(r.AnswersJson, []) || []); if (bestScore === null || sc > bestScore) { best = r; bestScore = sc; } });
  return { submitted: submitted, inProgress: inProgress, latest: submitted[submitted.length - 1] || null, best: best, bestScore: bestScore, used: submitted.length + (inProgress ? 1 : 0) };
}
function rwBlankAnswers_(n) { var a = []; for (var i = 0; i < n; i++) a.push({ tries: [], state: 'open', points: 0 }); return a; }
function rwScore_(answers) { return answers.reduce(function (s, a) { return s + (Number(a.points) || 0); }, 0); }

/** What the browser is allowed to see: no answer key until a question is finished. */
function rwClientAttempt_(rec, opts) {
  var qs = rwParse_(rec.QuestionsJson, []), ans = rwParse_(rec.AnswersJson, null) || rwBlankAnswers_(qs.length);
  var done = String(rec.Status) === 'submitted';
  return {
    attemptId: String(rec.AttemptId), weekId: String(rec.WeekId), status: String(rec.Status),
    preview: String(rec.ClassId) === 'preview', score: rwScore_(ans), max: qs.length,
    answered: ans.filter(function (a) { return a.state !== 'open'; }).length,
    startedAt: rwText_(rec.StartedAt), submittedAt: rwText_(rec.SubmittedAt),
    questions: qs.map(function (q, i) {
      var a = ans[i] || { tries: [], state: 'open', points: 0 }, locked = a.state !== 'open';
      var out = { index: i, type: q.type, lead: q.lead, focus: q.focus, choices: q.choices, tries: a.tries, state: a.state, points: a.points };
      if (locked || done || (opts && opts.teacher)) out.correct = q.answer;
      if (done || (opts && opts.teacher)) { out.root = q.root; out.meaning = q.meaning; }
      return out;
    })
  };
}
/** Attempts used / allowed / left for one student and week. left = null means unlimited. */
function rwAttemptInfo_(stats, access) {
  var allowed = access && access.open ? access.allowed : (access && access.allowed) || 0;
  var unlimited = allowed === 0;
  return {
    used: stats.used, allowed: allowed, unlimited: unlimited,
    left: unlimited ? null : Math.max(0, allowed - stats.used),
    canStart: !!(access && access.open) && !stats.inProgress && (unlimited || stats.used < allowed),
    best: stats.bestScore, max: RW_QUIZ_QUESTIONS, open: !!(access && access.open)
  };
}

/** Quiz status for every week, for one student (home screen tiles). Score = best finished attempt. */
function rwQuizSummaryFor_(email) {
  var sh = rwQuizSheet_(), byWeek = {}, out = {};
  rwFindRows_(sh, 'Email', email).forEach(function (n) { var r = rwReadRow_(sh, n); (byWeek[String(r.WeekId)] = byWeek[String(r.WeekId)] || []).push(r); });
  var classes = rwClassesForStudent_(email);
  Object.keys(byWeek).forEach(function (weekId) {
    var st = rwAttemptStats_(byWeek[weekId]);
    if (!st.used) return;
    var info = rwAttemptInfo_(st, rwQuizAccess_(email, weekId, classes));
    var ip = st.inProgress ? (rwParse_(st.inProgress.AnswersJson, []) || []) : [];
    out[weekId] = {
      status: st.inProgress ? 'in_progress' : 'submitted', score: st.bestScore, max: RW_QUIZ_QUESTIONS,
      answered: ip.filter(function (a) { return a.state !== 'open'; }).length,
      used: info.used, left: info.left, unlimited: info.unlimited, canStart: info.canStart
    };
  });
  return out;
}

/** Is this week's quiz open for this student, and how many attempts do they get? Open if ANY of
 *  their classes opened it; if several did, the most generous attempt limit wins. */
function rwQuizAccess_(email, weekId, classes) {
  var role = rwRoleOf_(email);
  if (role === 'teacher' || role === 'admin') return { open: true, classId: 'preview', preview: true, allowed: 0 };
  classes = classes || rwClassesForStudent_(email);
  if (!classes.length) return { open: false, allowed: 1, reason: 'Join your class first (ask your teacher for the class code). Quiz scores go to your teacher, so the quiz needs a class.' };
  var best = null;
  classes.forEach(function (k) {
    var s = rwNormalizeSettings_(k.SettingsJson);
    if (s.openQuizzes.indexOf(String(weekId)) < 0 || !rwWeekVisible_(s, weekId)) return;
    var allowed = rwAllowedAttempts_(s, String(weekId), email);
    if (!best || allowed === 0 || (best.allowed !== 0 && allowed > best.allowed)) best = { open: true, classId: String(k.ClassId), allowed: allowed };
  });
  return best || { open: false, allowed: 1, reason: 'Your teacher hasn’t opened this week’s Final Quiz yet.' };
}

function getMyQuizzes() {
  var email = rwRequireStudentEmail_();
  return { ok: true, quizzes: rwQuizSummaryFor_(email) };
}

/** Opens the student's Final Quiz for a week: resumes an unfinished attempt, shows the latest
 *  finished one, or (with begin) starts a new attempt if they have one left. */
function startWeekQuiz(payload) {
  payload = payload || {};
  var email = rwRequireStudentEmail_();
  rwEnsurePlatform_();
  var week = rwWeekById_(payload.weekId), access = rwQuizAccess_(email, week.id);
  var rows = rwAttemptRows_(email, week.id), sh = rwQuizSheet_(), st = rwAttemptStats_(rows);
  if (access.preview && payload.restart && st.inProgress) {
    rwPatchRow_(sh, st.inProgress._row, { Status: 'reset', ResetBy: email, UpdatedAt: rwNow_() });
    rows = rwAttemptRows_(email, week.id); st = rwAttemptStats_(rows);
  }
  var info = rwAttemptInfo_(st, access);
  if (st.inProgress) return { ok: true, attempt: rwClientAttempt_(st.inProgress), attempts: info };
  var wantNew = payload.begin && (!st.latest || payload.again || payload.restart);
  if (!wantNew) {
    if (st.latest) return { ok: true, attempt: rwClientAttempt_(st.latest), attempts: info };
    if (!access.open) return { ok: false, closed: true, error: access.reason, attempts: info };
  }
  if (!access.open) return { ok: false, closed: true, error: access.reason, attempts: info };
  if (!info.canStart) return { ok: false, noneLeft: true, error: 'You’ve used all ' + info.allowed + ' attempt' + (info.allowed === 1 ? '' : 's') + ' for this quiz. Your best score counts. Ask your teacher if you need another try.', attempts: info };
  if (!access.preview && !st.used) {
    var prog = handleLoad_(email);
    if (!rwWeekUnlocked_(prog.found ? prog.data : null, week)) return { ok: false, closed: true, error: 'Finish this week’s pretest first.', attempts: info };
  }
  if (!payload.begin) return { ok: true, ready: true, preview: !!access.preview, attempts: info };
  var questions = rwBuildQuiz_(week);
  var prevPosted = rows.length ? rows[rows.length - 1].CanvasPostedScore : '';
  var rec = {
    AttemptId: Utilities.getUuid(), Email: email, WeekId: week.id, ClassId: access.classId, Status: 'in_progress',
    QuestionsJson: JSON.stringify(questions), AnswersJson: JSON.stringify(rwBlankAnswers_(questions.length)),
    Score: 0, MaxScore: questions.length, StartedAt: rwNow_(), SubmittedAt: '', UpdatedAt: rwNow_(),
    CanvasPostedScore: prevPosted === undefined ? '' : prevPosted, ResetBy: ''
  };
  rec._row = rwAppend_(sh, rec);
  // Two quick clicks could start two attempts; the earliest unfinished one wins, the extra is set aside.
  var open = rwAttemptRows_(email, week.id).filter(function (r) { return r.Status === 'in_progress'; });
  if (open.length > 1 && String(open[0].AttemptId) !== rec.AttemptId) {
    rwPatchRow_(sh, rec._row, { Status: 'reset', ResetBy: 'duplicate', UpdatedAt: rwNow_() });
    rec = open[0];
  }
  return { ok: true, attempt: rwClientAttempt_(rec), attempts: rwAttemptInfo_(rwAttemptStats_(rwAttemptRows_(email, week.id)), access) };
}

/** Checks one answer. Right first try = 1, right second try = ½, two misses = 0 (answer shown).
 *  Safe to call twice with the same click: a finished question just reports its result again. */
function answerQuizQuestion(payload) {
  payload = payload || {};
  var email = rwRequireStudentEmail_();
  var sh = rwQuizSheet_(), rows = rwFindRows_(sh, 'AttemptId', String(payload.attemptId || ''));
  if (!rows.length) throw new Error('That quiz wasn’t found. Reload the page.');
  var rec = rwReadRow_(sh, rows[0]);
  if (normalizeEmail_(rec.Email) !== email) throw new Error('That quiz belongs to another account.');
  if (rec.Status === 'reset') throw new Error('Your teacher set this attempt aside. Reload the page.');
  var qs = rwParse_(rec.QuestionsJson, []), ans = rwParse_(rec.AnswersJson, null) || rwBlankAnswers_(qs.length);
  var i = Number(payload.index), choice = Number(payload.choice);
  if (!(i >= 0 && i < qs.length) || !(choice >= 0 && choice < qs[i].choices.length)) throw new Error('Invalid answer.');
  var a = ans[i];
  if (rec.Status === 'in_progress' && a.state === 'open' && a.tries.indexOf(choice) < 0) {
    a.tries.push(choice);
    if (choice === qs[i].answer) { a.state = a.tries.length === 1 ? 'right1' : 'right2'; a.points = a.tries.length === 1 ? 1 : RW_SECOND_TRY_POINTS; }
    else if (a.tries.length >= 2) { a.state = 'missed'; a.points = 0; }
    var finished = ans.every(function (x) { return x.state !== 'open'; });
    var fields = { AnswersJson: JSON.stringify(ans), Score: rwScore_(ans), UpdatedAt: rwNow_() };
    if (finished) { fields.Status = 'submitted'; fields.SubmittedAt = rwNow_(); }
    rec = rwPatchRow_(sh, rec._row, fields);
  }
  var client = rwClientAttempt_(rec), out = { ok: true, question: client.questions[i], attempt: client };
  if (rec.Status === 'submitted') out.attempts = rwAttemptInfo_(rwAttemptStats_(rwAttemptRows_(email, rec.WeekId)), rwQuizAccess_(email, rec.WeekId));
  return out;
}

// ============================================================================
// TEACHER DASHBOARD
// ============================================================================

function getTeacherHome() {
  rwEnsurePlatform_();
  var t = rwRequireTeacher_();
  var classes = rwPlatformRows_(RW_SHEETS.CLASSES)
    .filter(function (c) { return t.role === 'admin' || normalizeEmail_(c.TeacherEmail) === t.email; })
    .map(function (c) { var p = rwPublicClass_(c, true); p.students = rwEnrollments_(p.classId).length; return p; })
    .sort(function (a, b) { return (b.active - a.active) || a.className.localeCompare(b.className) || a.period.localeCompare(b.period); });
  return { ok: true, teacher: t, classes: classes, canvas: rwCanvasStatus_(t.email), hubEnabled: lmsHubEnabled_(), appUrl: rwAppUrl_(), weeks: rwWeeks_().map(function (w) { return { id: w.id, label: w.label }; }) };
}

function createRootClass(payload) {
  payload = payload || {}; rwEnsurePlatform_();
  var t = rwRequireTeacher_(), name = String(payload.className || '').trim();
  if (!name) throw new Error('Enter a class name.');
  var id = Utilities.getUuid(), code;
  withLock_(function () {
    rwForget_();
    var used = {}; rwPlatformRows_(RW_SHEETS.CLASSES).forEach(function (c) { used[String(c.JoinCode)] = true; });
    do { code = rwJoinCode_(); } while (used[code]);
    var sh = rwPlatformSheet_(RW_SHEETS.CLASSES);
    sh.getRange(sh.getLastRow() + 1, rwCol_(sh, 'Period')).setNumberFormat('@');
    var fresh = rwDefaultSettings_(); fresh.visibleWeeks = ['w1'];
    rwAppend_(sh, { ClassId: id, TeacherEmail: t.email, ClassName: name, Period: String(payload.period || ''), JoinCode: code, SettingsJson: JSON.stringify(fresh), Active: true, CreatedAt: rwNow_(), UpdatedAt: rwNow_() });
    rwForget_();
  });
  return { ok: true, classInfo: rwPublicClass_(rwClass_(id), true) };
}

function updateRootClass(payload) {
  payload = payload || {}; var id = String(payload.classId || ''); rwRequireClass_(id);
  rwUpdateClass_(id, function (row) {
    if (payload.className != null) { var n = String(payload.className).trim(); if (!n) throw new Error('Enter a class name.'); row.ClassName = n; }
    if (payload.period != null) row.Period = String(payload.period);
    if (payload.active != null) row.Active = !!payload.active;
  });
  return { ok: true, classInfo: rwPublicClass_(rwClass_(id), true) };
}

function addRootStudents(payload) {
  payload = payload || {}; var id = String(payload.classId || ''); rwRequireClass_(id);
  var emails = String(payload.emails || '').split(/[\s,;]+/).map(normalizeEmail_).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (!emails.length) throw new Error('Paste one or more school email addresses.');
  var added = 0;
  withLock_(function () {
    rwForget_();
    var have = {}; rwEnrollments_(id).forEach(function (e) { have[e.email] = true; });
    var sh = rwPlatformSheet_(RW_SHEETS.ENROLL), rows = [];
    emails.forEach(function (em) { if (!have[em]) { have[em] = true; rows.push(rwObjToRow_(sh, { ClassId: id, StudentEmail: em, StudentName: rwNameFromEmail_(em), Active: true, JoinedAt: rwNow_() })); added++; } });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    rwForget_();
  });
  return { ok: true, added: added, skipped: emails.length - added };
}

/** Takes a student off the roster. Their sentences and quiz attempts are kept. */
function removeRootStudent(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), em = normalizeEmail_(payload.studentEmail); rwRequireClass_(id);
  withLock_(function () {
    rwAppend_(rwPlatformSheet_(RW_SHEETS.ENROLL), { ClassId: id, StudentEmail: em, StudentName: rwText_(payload.studentName) || rwNameFromEmail_(em), Active: false, JoinedAt: rwNow_() });
    rwForget_();
  });
  return { ok: true };
}

function renameRootStudent(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), em = normalizeEmail_(payload.studentEmail); rwRequireClass_(id);
  var name = String(payload.name || '').trim(); if (!name && !payload.clear) throw new Error('Enter a name.');
  if (payload.clear) name = (rwProfile_(em) ? rwProfile_(em).firstName + ' ' + rwProfile_(em).lastName : rwNameFromEmail_(em));
  withLock_(function () {
    rwAppend_(rwPlatformSheet_(RW_SHEETS.ENROLL), { ClassId: id, StudentEmail: em, StudentName: name, Active: true, JoinedAt: rwNow_(), NameSource: payload.clear ? 'clear' : 'teacher' });
    rwForget_();
  });
  return { ok: true };
}

function getRootRoster(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || ''));
  return { ok: true, classInfo: rwPublicClass_(ctx.raw, true), students: rwEnrollments_(ctx.raw.ClassId) };
}

function setRootQuizOpen(payload) {
  payload = payload || {}; var id = String(payload.classId || ''); rwRequireClass_(id);
  var week = rwWeekById_(payload.weekId), open = !!payload.open;
  var r = rwUpdateClass_(id, function (row, s) {
    var set = {}; s.openQuizzes.forEach(function (w) { set[w] = true; });
    if (open) set[week.id] = true; else delete set[week.id];
    s.openQuizzes = rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return set[w]; });
    if (open && s.visibleWeeks && s.visibleWeeks.indexOf(week.id) < 0) s.visibleWeeks = rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return w === week.id || s.visibleWeeks.indexOf(w) >= 0; });
  });
  var out = { ok: true, openQuizzes: r.settings.openQuizzes, visibleWeeks: rwVisibleList_(r.settings) };
  // Opening the quiz also publishes a Canvas assignment that was set up ahead of time (best effort:
  // the quiz opens even if Canvas can't be reached; the next Push publishes it anyway).
  var c = r.settings.canvas, meta = rwCanvasMeta_(week), link = (c.assignments || {})[meta.key];
  if (open && c.courseId && link && link.assignmentId && link.published === false) {
    try {
      var ctx = rwRequireClass_(id), conn = rwCanvasConn_(ctx.teacher.email);
      if (lmsHubEnabled_()) {
        rwHubCall_(function () { return LmsHub.syncAssignment(id, meta.key, { title: meta.label, pointsPossible: meta.points, gradingType: 'points', published: true }, ctx.teacher.email); });
      } else if (conn.connected) {
        var a = rwCanvasRequest_(conn, 'put', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId), { 'assignment[published]': 'true' });
        if (link.moduleId && link.moduleItemId) rwCanvasSyncModule_(conn, c.courseId, a, link.moduleId, link, meta.label, true);
      } else throw new Error('Canvas isn’t connected for you');
      rwSaveCanvasLinkMerge_(id, c.courseId, meta.key, { published: true });
      out.canvasPublished = true;
    } catch (e) { out.warning = 'The quiz is open, but the Canvas assignment couldn’t be published yet (' + e.message + '). Pushing scores will publish it.'; }
  }
  return out;
}

/** Which weeks students in this class can see. weeks: array of week ids. Hiding a week also closes
 *  its Final Quiz. Students keep everything they wrote; it comes back when the week is shown again. */
function setRootVisibleWeeks(payload) {
  payload = payload || {}; var id = String(payload.classId || ''); rwRequireClass_(id);
  var want = (payload.weeks || []).map(String);
  var r = rwUpdateClass_(id, function (row, s) {
    s.visibleWeeks = rwWeeks_().map(function (w) { return w.id; }).filter(function (w) { return want.indexOf(w) >= 0; });
    s.openQuizzes = s.openQuizzes.filter(function (w) { return s.visibleWeeks.indexOf(w) >= 0; });
  });
  return { ok: true, visibleWeeks: rwVisibleList_(r.settings), openQuizzes: r.settings.openQuizzes };
}
/** Show or hide one week. */
function setRootWeekVisible(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), ctx = rwRequireClass_(id), week = rwWeekById_(payload.weekId);
  var cur = rwVisibleList_(ctx.settings).filter(function (w) { return w !== week.id; });
  if (payload.visible) cur.push(week.id);
  return setRootVisibleWeeks({ classId: id, weeks: cur });
}

/** Every student's attempts at one week: best score, attempts used, any unfinished attempt, and what
 *  was last sent to Canvas (kept on the student's newest row). */
function rwWeekAttempts_(emails, weekId, settings) {
  var want = {}; emails.forEach(function (e) { want[e] = true; });
  var sh = rwQuizSheet_(), rows = rwColumns_(sh, ['AttemptId', 'Email', 'WeekId', 'Status', 'AnswersJson', 'MaxScore', 'StartedAt', 'SubmittedAt', 'CanvasPostedScore']);
  var byEmail = {};
  rows.forEach(function (r) {
    var em = normalizeEmail_(r.Email);
    if (!want[em] || String(r.WeekId) !== String(weekId)) return;
    (byEmail[em] = byEmail[em] || []).push(r);
  });
  var out = {};
  Object.keys(byEmail).forEach(function (em) {
    var list = byEmail[em], st = rwAttemptStats_(list), last = list[list.length - 1];
    var ip = st.inProgress ? (rwParse_(st.inProgress.AnswersJson, []) || []) : [];
    out[em] = {
      status: st.best ? 'submitted' : st.inProgress ? 'in_progress' : 'reset',
      score: st.bestScore, max: RW_QUIZ_QUESTIONS, used: st.used, finished: st.submitted.length,
      inProgress: !!st.inProgress, answered: ip.filter(function (a) { return a.state !== 'open'; }).length,
      allowed: settings ? rwAllowedAttempts_(settings, weekId, em) : null,
      submittedAt: st.best ? rwText_(st.best.SubmittedAt) : '',
      postedScore: rwText_(last.CanvasPostedScore), postedRow: last._row
    };
  });
  return out;
}

function getRootClassWeek(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || '')), week = rwWeekById_(payload.weekId || 'w1');
  var students = rwEnrollments_(ctx.raw.ClassId), emails = students.map(function (s) { return s.email; });
  var progress = rwProgressFor_(emails), attempts = rwWeekAttempts_(emails, week.id, ctx.settings), total = rwAllRoots_(week).length;
  var rows = students.map(function (s) {
    var p = progress[s.email] || null, q = attempts[s.email] || { status: 'none', score: null, max: RW_QUIZ_QUESTIONS, used: 0, finished: 0, inProgress: false, answered: 0, allowed: rwAllowedAttempts_(ctx.settings, week.id, s.email), postedScore: '' };
    delete q.postedRow;
    var pre = rwPretestOf_(p, week.id);
    q.excluded = rwQuizExcluded_(ctx.settings, s.email, week.id);
    q.pct = rwPct_(q.score, q.max);
    return { email: s.email, name: s.name, pretestDone: pre.done, pretest: pre, sentencesDone: rwSentencesDone_(p, week), sentencesTotal: total, lastSaved: '', quiz: q,
      growth: !q.excluded && pre.pct !== null && q.pct !== null ? q.pct - pre.pct : null };
  });
  var prePcts = rows.filter(function (r) { return r.pretest.pct !== null; }).map(function (r) { return r.pretest.pct; });
  var growths = rows.filter(function (r) { return r.growth !== null; }).map(function (r) { return r.growth; });
  var taken = rows.filter(function (r) { return r.quiz.status === 'submitted' && !r.quiz.excluded; });
  var avg = taken.length ? taken.reduce(function (s, r) { return s + r.quiz.score; }, 0) / taken.length : null;
  var link = (ctx.settings.canvas.assignments || {})[rwCanvasKey_(week.id)] || null;
  return {
    ok: true, classInfo: rwPublicClass_(ctx.raw, true), week: { id: week.id, label: week.label, subtitle: week.subtitle },
    quizOpen: ctx.settings.openQuizzes.indexOf(week.id) >= 0 && rwWeekVisible_(ctx.settings, week.id), weekVisible: rwWeekVisible_(ctx.settings, week.id), rows: rows,
    attempts: { week: rwAttemptsNum_(ctx.settings.quizAttempts[week.id]), effective: rwAttemptsNum_(ctx.settings.quizAttempts[week.id]) !== null ? ctx.settings.quizAttempts[week.id] : ctx.settings.defaultAttempts, defaultAttempts: ctx.settings.defaultAttempts },
    stats: { enrolled: rows.length, submitted: taken.length, excluded: rows.filter(function (r) { return r.quiz.excluded; }).length, inProgress: rows.filter(function (r) { return r.quiz.inProgress; }).length, average: avg, max: RW_QUIZ_QUESTIONS, pretests: rows.filter(function (r) { return r.pretestDone; }).length,
      averagePct: rwPct_(avg, RW_QUIZ_QUESTIONS), pretestAvgPct: prePcts.length ? Math.round(rwMean_(prePcts)) : null, pretestScored: prePcts.length,
      growth: growths.length ? Math.round(rwMean_(growths)) : null, growthCount: growths.length },
    canvas: { linked: !!ctx.settings.canvas.courseId, courseName: ctx.settings.canvas.courseName || '', assignment: link, connected: rwCanvasConn_(ctx.teacher.email).connected },
    schedule: ctx.settings.quizSchedule[week.id] || null
  };
}

/** Every week's best quiz score for every student in the class (the Gradebook tab). */
function getRootGradebook(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || ''));
  var students = rwEnrollments_(ctx.raw.ClassId), want = {};
  students.forEach(function (s) { want[s.email] = true; });
  var groups = {};
  rwColumns_(rwQuizSheet_(), ['Email', 'WeekId', 'Status', 'AnswersJson']).forEach(function (r) {
    var em = normalizeEmail_(r.Email); if (!want[em]) return;
    (groups[em + '|' + r.WeekId] = groups[em + '|' + r.WeekId] || []).push(r);
  });
  var cells = {};
  Object.keys(groups).forEach(function (k) {
    var st = rwAttemptStats_(groups[k]), ip = st.inProgress ? (rwParse_(st.inProgress.AnswersJson, []) || []) : [];
    cells[k] = st.best ? { status: 'submitted', score: st.bestScore, tries: st.submitted.length, inProgress: !!st.inProgress }
      : st.inProgress ? { status: 'in_progress', answered: ip.filter(function (a) { return a.state !== 'open'; }).length }
      : { status: 'reset' };
  });
  var weeks = rwWeeks_().map(function (w) { return { id: w.id, label: w.label, open: ctx.settings.openQuizzes.indexOf(w.id) >= 0, visible: rwWeekVisible_(ctx.settings, w.id) }; });
  var progress = rwProgressFor_(students.map(function (s) { return s.email; }));
  return {
    ok: true, classInfo: rwPublicClass_(ctx.raw, true), weeks: weeks, max: RW_QUIZ_QUESTIONS,
    rows: students.map(function (s) {
      var r = { email: s.email, name: s.name, cells: {} };
      weeks.forEach(function (w) {
        var c = cells[s.email + '|' + w.id] || null, pre = rwPretestOf_(progress[s.email], w.id), ex = rwQuizExcluded_(ctx.settings, s.email, w.id);
        if (!c && !pre.done && !ex) return;
        c = c || { status: 'none' };
        if (ex) c.excluded = true;
        c.pretestDone = pre.done; c.pretest = pre.pct;
        r.cells[w.id] = c;
      });
      return r;
    })
  };
}

/** Class data file: every student, every week — pretest %, best Final Quiz score, quiz %, growth. */
function exportRootClassDataCsv(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || ''));
  var g = getRootGradebook({ classId: ctx.raw.ClassId }), weeks = g.weeks;
  var only = payload.weekId ? String(payload.weekId) : '';
  if (only) weeks = weeks.filter(function (w) { return w.id === only; });
  var head = ['Student', 'Email'];
  weeks.forEach(function (w) { head.push(w.label + ' Pretest %', w.label + ' Final Quiz best (of ' + RW_QUIZ_QUESTIONS + ')', w.label + ' Final Quiz %', w.label + ' Attempts', w.label + ' Growth (points)'); });
  var lines = [head];
  g.rows.forEach(function (r) {
    var line = [r.name, r.email];
    weeks.forEach(function (w) {
      var c = r.cells[w.id] || {}, qp = c.status === 'submitted' ? rwPct_(c.score, RW_QUIZ_QUESTIONS) : null;
      var pre = c.pretest != null ? c.pretest : (c.pretestDone ? 'done' : '');
      if (c.excluded) qp = null;
      line.push(pre, c.excluded ? 'excluded' : c.status === 'submitted' ? c.score : (c.status === 'in_progress' ? 'in progress' : ''), qp == null ? '' : qp, c.tries || (c.status === 'in_progress' ? 1 : ''), qp != null && c.pretest != null ? qp - c.pretest : '');
    });
    lines.push(line);
  });
  var cname = rwText_(ctx.raw.ClassName) + (rwText_(ctx.raw.Period) ? ' P' + rwText_(ctx.raw.Period) : '');
  var csv = lines.map(function (row) { return row.map(function (v) { var x = String(v == null ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(','); }).join('\r\n');
  return { ok: true, filename: 'Root Word Study - ' + cname + (only ? ' - ' + weeks[0].label : '') + ' - class data.csv', csv: csv };
}

/** One student, one week: their sentences and every quiz attempt (with the key), newest first. */
function getRootStudentWeek(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || '')), week = rwWeekById_(payload.weekId), em = normalizeEmail_(payload.studentEmail);
  var student = rwEnrollments_(ctx.raw.ClassId).filter(function (s) { return s.email === em; })[0];
  if (!student) throw new Error('That student isn’t in this class.');
  var p = rwProgressFor_([em])[em] || null, s = (p && p.SentencesJSON && p.SentencesJSON[week.id]) || {};
  var days = week.days.map(function (d) {
    return { day: d.day, label: d.label, roots: d.roots.map(function (r) { return { display: r.display, meaning: r.meaning, sentence: String(s[rwRootKey_(r)] || '') }; }) };
  });
  var rows = rwAttemptRows_(em, week.id).filter(function (r) { return r.ResetBy !== 'duplicate'; }), st = rwAttemptStats_(rows);
  var attempts = rows.map(function (r, i) {
    var a = rwClientAttempt_(r, { teacher: true });
    a.number = i + 1; a.counted = r.Status !== 'reset'; a.best = !!(st.best && r._row === st.best._row); a.setAsideBy = r.Status === 'reset' ? rwText_(r.ResetBy) : '';
    return a;
  }).reverse();
  return {
    ok: true, student: student, week: { id: week.id, label: week.label }, pretestDone: rwPretestOf_(p, week.id).done, pretest: rwPretestOf_(p, week.id),
    days: days, attempts: attempts, best: st.bestScore,
    allowed: rwAllowedAttempts_(ctx.settings, week.id, em), used: st.used,
    bonus: Number(ctx.settings.bonusAttempts[em + '|' + week.id]) || 0,
    excluded: rwQuizExcluded_(ctx.settings, em, week.id)
  };
}

/** 2026-10-18a: "Exclude from grade" for one student's Final Quiz in one week. The quiz stops counting
 *  in the app (averages, growth, gradebook "ex") and the next Canvas push marks the student Excused.
 *  Attempts are kept; un-excluding brings the score straight back. */
function setRootQuizExcluded(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), week = rwWeekById_(payload.weekId), em = normalizeEmail_(payload.studentEmail);
  if (!rwEnrollments_(classId).some(function (s) { return s.email === em; })) throw new Error('That student isn’t in this class.');
  var on = !!payload.excluded;
  rwUpdateClass_(classId, function (row, s) {
    var k = em + '|' + week.id;
    if (on) s.excludedQuiz[k] = true; else delete s.excludedQuiz[k];
  });
  return { ok: true, excluded: on };
}

/** Gives one student one more attempt at one week (on top of the class limit). Their best score counts. */
function grantRootQuizAttempt(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), week = rwWeekById_(payload.weekId), em = normalizeEmail_(payload.studentEmail);
  if (!rwEnrollments_(classId).some(function (s) { return s.email === em; })) throw new Error('That student isn’t in this class.');
  var r = rwUpdateClass_(classId, function (row, s) {
    var k = em + '|' + week.id;
    s.bonusAttempts[k] = (Number(s.bonusAttempts[k]) || 0) + (payload.remove ? -1 : 1);
    if (s.bonusAttempts[k] <= 0) delete s.bonusAttempts[k];
  });
  return { ok: true, allowed: rwAllowedAttempts_(r.settings, week.id, em) };
}

/** Older name, kept so an open teacher tab from the first release still works: one more attempt. */
function resetRootQuiz(payload) { return grantRootQuizAttempt(payload); }

/** Counts or sets aside one attempt (e.g. a do-over that shouldn't count). Set aside = not in the best
 *  score and not counted against the limit. Only finished attempts can be counted again. */
function setRootQuizAttemptCounted(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || '')), em = normalizeEmail_(payload.studentEmail);
  if (!rwEnrollments_(ctx.raw.ClassId).some(function (s) { return s.email === em; })) throw new Error('That student isn’t in this class.');
  var sh = rwQuizSheet_(), hit = rwFindRows_(sh, 'AttemptId', String(payload.attemptId || ''));
  if (!hit.length) throw new Error('Attempt not found.');
  var rec = rwReadRow_(sh, hit[0]);
  if (normalizeEmail_(rec.Email) !== em) throw new Error('Attempt not found.');
  if (payload.counted) {
    if (rec.Status !== 'reset') return { ok: true };
    if (!rwText_(rec.SubmittedAt)) throw new Error('Only finished attempts can be counted again.');
    rwPatchRow_(sh, rec._row, { Status: 'submitted', ResetBy: '', UpdatedAt: rwNow_() });
  } else {
    if (rec.Status === 'reset') return { ok: true };
    rwPatchRow_(sh, rec._row, { Status: 'reset', ResetBy: ctx.teacher.email, UpdatedAt: rwNow_() });
  }
  return { ok: true };
}

/** Attempts allowed for one week, or (allWeeks) for every week + the default for new ones. 0 = unlimited. */
function setRootQuizAttempts(payload) {
  payload = payload || {}; var id = String(payload.classId || ''); rwRequireClass_(id);
  var n = rwAttemptsNum_(payload.attempts); if (n === null || payload.attempts === '') throw new Error('Choose how many attempts.');
  var week = payload.allWeeks ? null : rwWeekById_(payload.weekId);
  var r = rwUpdateClass_(id, function (row, s) {
    if (week) s.quizAttempts[week.id] = n;
    else { s.defaultAttempts = n; s.quizAttempts = {}; }
  });
  return { ok: true, defaultAttempts: r.settings.defaultAttempts, quizAttempts: r.settings.quizAttempts };
}

// ============================================================================
// ADMIN — who is a teacher / admin
// ============================================================================

function adminListRootAccess() {
  rwRequireAdmin_();
  return { ok: true, access: rwPlatformRows_(RW_SHEETS.USERS).map(function (u) { return { email: normalizeEmail_(u.Email), name: rwText_(u.Name), role: rwText_(u.Role), status: rwText_(u.Status) }; }) };
}
function adminSetRootAccess(payload) {
  payload = payload || {}; var me = rwRequireAdmin_();
  var email = normalizeEmail_(payload.email);
  var role = ['teacher', 'admin'].indexOf(String(payload.role)) >= 0 ? String(payload.role) : 'teacher';
  var status = String(payload.status || 'active') === 'inactive' ? 'inactive' : 'active';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a full email address.');
  if (email === me.email && (role !== 'admin' || status !== 'active')) throw new Error('You can’t remove your own admin access. Ask another admin.');
  withLock_(function () {
    rwForget_();
    var sh = rwPlatformSheet_(RW_SHEETS.USERS), rows = rwFindRows_(sh, 'Email', email);
    var fields = { Email: email, Name: String(payload.name || (rwUser_(email) || {}).Name || rwNameFromEmail_(email)), Role: role, Status: status, UpdatedAt: rwNow_() };
    if (rows.length) rwPatchRow_(sh, rows[rows.length - 1], fields); else rwAppend_(sh, fields);
    rwForget_();
  });
  return adminListRootAccess();
}

// ============================================================================
// CANVAS
// Each teacher's Canvas URL + token is kept in Script Properties under their own key (the web app
// runs as its owner, so per-user properties would be shared by every teacher). Class → course
// links and the week assignments live in RW_Classes SettingsJson.
// ============================================================================

var RW_CANVAS_PROP_PREFIX = 'RW_CANVAS_';
function rwCanvasPropKey_(email) { return RW_CANVAS_PROP_PREFIX + rwMd5_(normalizeEmail_(email)).slice(0, 20); }
function rwCanvasConn_(email) {
  var raw = rwParse_(PropertiesService.getScriptProperties().getProperty(rwCanvasPropKey_(email)), null) || {};
  return { baseUrl: String(raw.baseUrl || ''), token: String(raw.token || ''), connected: !!(raw.baseUrl && raw.token) };
}
function rwCanvasStatus_(email) {
  var c = rwCanvasConn_(email);
  return { connected: c.connected, baseUrl: c.baseUrl };
}
function rwNormalizeCanvasUrl_(v) {
  var s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Enter your Canvas address, for example https://yourschool.instructure.com');
  if (!/^https:\/\//i.test(s)) s = 'https://' + s.replace(/^https?:\/\//i, '');
  return s.replace(/\/api\/v1$/i, '');
}
function rwCanvasError_(body, fallback) {
  try { var j = JSON.parse(String(body || '')); if (Array.isArray(j.errors) && j.errors.length) return j.errors.map(function (e) { return e.message || e.error || String(e); }).join('; '); if (j.message) return j.message; if (j.error) return typeof j.error === 'string' ? j.error : JSON.stringify(j.error); } catch (e) {}
  return String(body || fallback || 'Canvas request failed.').slice(0, 500);
}
function rwCanvasRequest_(conn, method, path, payload) {
  if (!conn || !conn.connected) throw new Error('Connect Canvas first (Canvas tab).');
  var url = /^https:\/\//i.test(path) ? path : conn.baseUrl + path;
  if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
  var opt = { method: String(method || 'get').toLowerCase(), headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true };
  if (payload && Object.keys(payload).length) opt.payload = payload;
  var res = UrlFetchApp.fetch(url, opt), status = res.getResponseCode(), body = res.getContentText();
  if (status < 200 || status >= 300) {
    var msg = status === 401 ? 'Canvas didn’t accept the access token. Paste a new token in the Canvas tab.' : 'Canvas ' + status + ': ' + rwCanvasError_(body);
    var err = new Error(msg); err.canvasStatus = status; throw err;
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch (e) { return { raw: body }; }
}
/** Every page of a Canvas list (follows Link: rel="next"). */
function rwCanvasGetAll_(conn, path) {
  var url = conn.baseUrl + path, out = [], guard = 0;
  while (url && guard++ < 30) {
    if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true });
    var status = res.getResponseCode(), body = res.getContentText();
    if (status < 200 || status >= 300) { var err = new Error('Canvas ' + status + ': ' + rwCanvasError_(body)); err.canvasStatus = status; throw err; }
    var rows = []; try { rows = JSON.parse(body || '[]'); } catch (e) {}
    if (Array.isArray(rows)) out = out.concat(rows);
    var h = res.getHeaders ? res.getHeaders() : {}, link = String(h.Link || h.link || ''), next = '';
    link.split(',').forEach(function (part) { var m = part.match(/<([^>]+)>\s*;\s*rel="next"/); if (m) next = m[1]; });
    url = next;
  }
  return out;
}

function saveRootCanvasConnection(payload) {
  payload = payload || {}; var t = rwRequireTeacher_(), old = rwCanvasConn_(t.email);
  var baseUrl = rwNormalizeCanvasUrl_(payload.baseUrl || old.baseUrl), token = String(payload.token || old.token || '').trim();
  if (!token) throw new Error('Paste a Canvas access token (Canvas → Account → Settings → New Access Token).');
  var conn = { baseUrl: baseUrl, token: token, connected: true };
  var profile = rwCanvasRequest_(conn, 'get', '/api/v1/users/self/profile');
  PropertiesService.getScriptProperties().setProperty(rwCanvasPropKey_(t.email), JSON.stringify({ baseUrl: baseUrl, token: token, savedAt: rwNow_() }));
  return { ok: true, canvas: { connected: true, baseUrl: baseUrl, name: profile.name || profile.short_name || '' } };
}
function clearRootCanvasConnection() {
  var t = rwRequireTeacher_();
  PropertiesService.getScriptProperties().deleteProperty(rwCanvasPropKey_(t.email));
  return { ok: true, canvas: { connected: false, baseUrl: '' } };
}
function checkRootCanvasConnection() {
  var t = rwRequireTeacher_(), conn = rwCanvasConn_(t.email);
  if (!conn.connected) return { ok: true, canvas: { connected: false } };
  try { var p = rwCanvasRequest_(conn, 'get', '/api/v1/users/self/profile'); return { ok: true, canvas: { connected: true, valid: true, baseUrl: conn.baseUrl, name: p.name || '' } }; }
  catch (e) { return { ok: true, canvas: { connected: true, valid: false, baseUrl: conn.baseUrl, message: e.message } }; }
}
function listRootCanvasCourses() {
  var t = rwRequireTeacher_(), conn = rwCanvasConn_(t.email);
  var rows = rwCanvasGetAll_(conn, '/api/v1/courses?enrollment_type=teacher&per_page=100&include[]=term');
  return { ok: true, courses: rows.filter(function (c) { return c && c.id && c.workflow_state !== 'deleted'; }).map(function (c) { return { id: String(c.id), name: c.name || c.course_code || ('Course ' + c.id), term: c.term && c.term.name ? c.term.name : '', state: c.workflow_state || '' }; }) };
}
function listRootCanvasAssignmentGroups(payload) {
  var t = rwRequireTeacher_(), courseId = String((payload || {}).courseId || ''); if (!courseId) throw new Error('Choose a Canvas course first.');
  var rows = rwCanvasGetAll_(rwCanvasConn_(t.email), '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100');
  return { ok: true, groups: rows.map(function (g) { return { id: String(g.id), name: g.name || ('Group ' + g.id) }; }) };
}
function linkRootCanvasCourse(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), conn = rwCanvasConn_(ctx.teacher.email);
  var courseId = String(payload.courseId || ''); if (!courseId) throw new Error('Choose a Canvas course.');
  var course = rwCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId)), groupId = String(payload.assignmentGroupId || ''), groupName = '';
  if (groupId) groupName = (rwCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(groupId)).name) || '';
  var r = rwUpdateClass_(classId, function (row, s) {
    var keep = String(s.canvas.courseId || '') === courseId ? (s.canvas.assignments || {}) : {};
    s.canvas = { courseId: courseId, courseName: course.name || '', assignmentGroupId: groupId, assignmentGroupName: groupName, assignments: keep };
  });
  return { ok: true, canvas: r.settings.canvas };
}
function unlinkRootCanvasCourse(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''); rwRequireClass_(classId);
  rwUpdateClass_(classId, function (row, s) { s.canvas = rwDefaultSettings_().canvas; });
  return { ok: true };
}

// ---------- the weekly quiz assignment ----------

function rwCanvasKey_(weekId) { return 'quiz:' + weekId; }
function rwCanvasMeta_(week) {
  return { key: rwCanvasKey_(week.id), label: 'Root Word Study - ' + week.label + ' - Final Quiz', points: RW_QUIZ_QUESTIONS, week: week };
}
// What students see in the Canvas assignment. Edit the sentences in quotes to change it. The app
// sends this on every Push, so edit it here, not in Canvas (Canvas edits get replaced).
function rwCanvasDescription_(week) {
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var html = '<p>' + esc('Take the ' + week.label + ' Final Quiz in Vocabulary Root Word Study: 12 multiple-choice questions on this week’s roots.') + '</p>' +
    '<p>' + esc('Right on the first try earns 1 point; right on the second try earns ½ point. If your teacher allows more than one attempt, your best score counts. The app scores it and your teacher sends the score here.') + '</p>';
  var url = rwAppUrl_();
  if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener"><strong>Open Root Word Study</strong></a></p><p><small>Sign in with your school Google account.</small></p>';
  return html;
}

/** What goes to Canvas for one week — shared by Push and the CSV so they always agree.
 *  Submitted quiz = its score. Not taken, in progress, or reset = blank (never an early zero). */
function rwQuizGradeRows_(classId, week, settings) {
  var students = rwEnrollments_(classId), attempts = rwWeekAttempts_(students.map(function (s) { return s.email; }), week.id);
  return students.map(function (s) {
    var q = attempts[s.email] || { status: 'none', score: null, postedScore: '', postedRow: 0 };
    // 2026-10-18a: excluded = no score here (blank in the CSV) and Excused in Canvas.
    var ex = !!(settings && rwQuizExcluded_(settings, s.email, week.id));
    return { email: s.email, name: s.name, status: q.status, score: !ex && q.status === 'submitted' ? q.score : null, excluded: ex, postedScore: q.postedScore, postedRow: q.postedRow };
  });
}

/** opts.sched: the week's schedule (its due date is sent when one has been saved, '' clears it).
 *  opts.publish: true publishes. Otherwise a NEW assignment starts unpublished and an existing one is
 *  left as it is (Canvas can't unpublish an assignment that already has grades). */
function rwCanvasAssignmentForm_(c, meta, opts) {
  opts = opts || {};
  var f = {
    'assignment[name]': meta.label, 'assignment[points_possible]': String(meta.points), 'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none', 'assignment[description]': rwCanvasDescription_(meta.week)
  };
  if (opts.publish) f['assignment[published]'] = 'true';
  else if (opts.creating) f['assignment[published]'] = 'false';
  if (opts.sched && opts.sched.hasDue) f['assignment[due_at]'] = opts.sched.dueAt || '';
  // Group: one picked for this week's quiz on its week page (opts.group, sent only when changed).
  // Creating: that, else the group saved for it (c.itemGroups), else the class default. Updates never
  // send a group otherwise, so a move made in Canvas stays.
  var grp = String(opts.group || '') || (opts.creating ? String((c.itemGroups || {})[meta.key] || c.assignmentGroupId || '') : '');
  if (grp) f['assignment[assignment_group_id]'] = grp;
  return f;
}
function rwWeekSchedule_(settings, weekId) {
  var x = settings.quizSchedule[weekId];
  return x ? { hasDue: true, dueAt: x.dueAt || '', moduleId: x.moduleId || '', moduleName: x.moduleName || '' } : { hasDue: false, dueAt: '', moduleId: '', moduleName: '' };
}
/** Reuse the stored assignment, adopt one with the same name (another section sharing the course),
 *  or create it. */
function rwCanvasEnsureAssignment_(conn, c, meta, opts) {
  opts = opts || {};
  var enc = encodeURIComponent(c.courseId), link = (c.assignments || {})[meta.key] || {}, a = null, adopted = false, created = false;
  var upd = rwCanvasAssignmentForm_(c, meta, { sched: opts.sched, publish: opts.publish, group: opts.group });
  if (link.assignmentId) {
    try { a = rwCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId), upd); }
    catch (e) { if (e.canvasStatus !== 404) throw e; a = null; }
  }
  if (!a) {
    var found = null;
    try { rwCanvasGetAll_(conn, '/api/v1/courses/' + enc + '/assignments?search_term=' + encodeURIComponent(meta.label) + '&per_page=100').forEach(function (x) { if (!found && String(x.name) === meta.label) found = x; }); } catch (e2) {}
    if (found) { adopted = true; a = rwCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(found.id), upd); }
    else { created = true; a = rwCanvasRequest_(conn, 'post', '/api/v1/courses/' + enc + '/assignments', rwCanvasAssignmentForm_(c, meta, { sched: opts.sched, publish: opts.publish, group: opts.group, creating: true })); }
  }
  return { assignment: a, adopted: adopted, created: created, previous: link };
}

/** Puts the assignment into the chosen Canvas module (or takes it out with ''). Moves it if the module
 *  changed or the assignment was re-created. Returns { moduleId, moduleName, moduleItemId }. */
function rwCanvasSyncModule_(conn, courseId, assignment, desiredModuleId, prev, title, published) {
  var enc = encodeURIComponent(courseId), want = String(desiredModuleId || ''), aid = String((assignment || {}).id || '');
  prev = prev || {};
  var oldMod = String(prev.moduleId || ''), oldItem = String(prev.moduleItemId || ''), oldAid = String(prev.assignmentId || '');
  var removeOld = function () {
    if (!oldMod || !oldItem) return;
    try { rwCanvasRequest_(conn, 'delete', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldMod) + '/items/' + encodeURIComponent(oldItem)); }
    catch (e) { if (e.canvasStatus !== 404) throw e; }
    oldMod = ''; oldItem = '';
  };
  if (oldItem && (oldMod !== want || (oldAid && oldAid !== aid))) removeOld();
  if (!want) return { moduleId: '', moduleName: '', moduleItemId: '' };
  var mod = rwCanvasRequest_(conn, 'get', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(want));
  var itemForm = { 'module_item[title]': title };
  if (published) itemForm['module_item[published]'] = 'true';
  var item = null;
  if (oldItem) {
    try { item = rwCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(want) + '/items/' + encodeURIComponent(oldItem), itemForm); }
    catch (e) { if (e.canvasStatus !== 404) throw e; item = null; }
  }
  if (!item) {
    var form = { 'module_item[title]': title, 'module_item[type]': 'Assignment', 'module_item[content_id]': aid };
    if (published) form['module_item[published]'] = 'true';
    item = rwCanvasRequest_(conn, 'post', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(want) + '/items', form);
  }
  return { moduleId: want, moduleName: mod.name || '', moduleItemId: String(item.id || '') };
}

function listRootCanvasModules(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || '')), c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas tab).');
  var rows = rwCanvasGetAll_(rwCanvasConn_(ctx.teacher.email), '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/modules?per_page=100');
  return { ok: true, modules: rows.filter(function (m) { return m.workflow_state !== 'deleted'; }).map(function (m) { return { id: String(m.id), name: m.name || ('Module ' + m.id), position: Number(m.position || 0) }; }).sort(function (a, b) { return a.position - b.position; }) };
}

/** Saves a week's due date and module, and (when the class is linked to Canvas) creates or updates the
 *  assignment right away, in that module. It's published if the quiz is open, otherwise it waits
 *  unpublished and is published when you open the quiz or push scores. dueAt: ISO time, or '' for none. */
/** The week page's "Assignment group" list: the course's groups and where this week's quiz is in Canvas
 *  now (it may have been moved there). Before it exists: the group saved for it, else the class default. */
function getRootCanvasGroupChoice(payload) {
  payload = payload || {}; var ctx = rwRequireClass_(String(payload.classId || '')), c = ctx.settings.canvas, week = rwWeekById_(payload.weekId);
  var key = rwCanvasMeta_(week).key, link = (c.assignments || {})[key] || {};
  var out = { ok: true, groups: [], currentGroupId: String((c.itemGroups || {})[key] || c.assignmentGroupId || ''), linked: !!link.assignmentId };
  if (!c.courseId || lmsHubEnabled_()) return out;
  var conn = rwCanvasConn_(ctx.teacher.email);
  out.groups = listRootCanvasAssignmentGroups({ courseId: c.courseId }).groups;
  if (link.assignmentId) {
    try { out.currentGroupId = String(rwCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId)).assignment_group_id || ''); }
    catch (e) { if (e.canvasStatus === 404) out.linked = false; }
  }
  return out;
}

function saveRootCanvasWeek(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), week = rwWeekById_(payload.weekId);
  var dueAt = rwIsoOrBlank_(payload.dueAt);
  if (String(payload.dueAt || '').trim() && !dueAt) throw new Error('That due date isn’t a real date.');
  var moduleId = String(payload.moduleId || ''), moduleName = String(payload.moduleName || '');
  var group = String(payload.assignmentGroupId || ''), gKey = rwCanvasMeta_(week).key;   // group: only when changed on the page
  var r = rwUpdateClass_(classId, function (row, s) {
    s.quizSchedule[week.id] = { dueAt: dueAt, moduleId: moduleId, moduleName: moduleName };
    if (group) { s.canvas.itemGroups = s.canvas.itemGroups || {}; s.canvas.itemGroups[gKey] = group; }
  });
  var settings = r.settings, c = settings.canvas, meta = rwCanvasMeta_(week), sched = rwWeekSchedule_(settings, week.id);
  var out = { ok: true, schedule: settings.quizSchedule[week.id], canvasSynced: false, link: (c.assignments || {})[meta.key] || null, warnings: [] };
  if (!c.courseId) { out.note = 'Saved. Link this class to a Canvas course to send it to Canvas.'; return out; }
  var open = settings.openQuizzes.indexOf(week.id) >= 0;
  if (lmsHubEnabled_()) {
    rwHubEnsureClass_(classId, c, ctx.teacher.email);
    var spec = { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: rwCanvasDescription_(week), dueAt: dueAt, placementId: moduleId };
    if (open) spec.published = true;
    if (group) spec.groupId = group;
    var hr = rwHubCall_(function () { return LmsHub.syncAssignment(classId, meta.key, spec, ctx.teacher.email); });
    var ha = hr.assignment || {};
    out.link = rwSaveCanvasLinkMerge_(classId, c.courseId, meta.key, { assignmentId: String(ha.lmsAssignmentId || ''), name: ha.name || meta.label, htmlUrl: ha.htmlUrl || '', pointsPossible: meta.points, dueAt: dueAt, published: ha.published !== false && !!(open || (out.link && out.link.published)), moduleId: ha.placementId || moduleId, moduleName: ha.placementName || moduleName, moduleItemId: ha.placementItemId || '' });
    out.canvasSynced = true; out.via = 'lmsHub';
    return out;
  }
  var conn = rwCanvasConn_(ctx.teacher.email);
  if (!conn.connected) { out.note = 'Saved in the app. Connect Canvas (Canvas tab) to send it to Canvas.'; return out; }
  var ens = rwCanvasEnsureAssignment_(conn, c, meta, { sched: sched, publish: open, group: group }), a = ens.assignment;
  var published = String(a.published) !== 'false';
  var mod = { moduleId: '', moduleName: '', moduleItemId: '' };
  try { mod = rwCanvasSyncModule_(conn, c.courseId, a, moduleId, ens.previous, meta.label, published); }
  catch (e) { out.warnings.push('The assignment is in Canvas, but it couldn’t be put in the module (' + e.message + ').'); }
  out.link = rwSaveCanvasLinkMerge_(classId, c.courseId, meta.key, { assignmentId: String(a.id), name: a.name || meta.label, htmlUrl: a.html_url || '', pointsPossible: Number(a.points_possible || meta.points), dueAt: a.due_at || '', published: published, moduleId: mod.moduleId, moduleName: mod.moduleName, moduleItemId: mod.moduleItemId });
  out.canvasSynced = true; out.created = ens.created; out.adopted = ens.adopted;
  return out;
}

/** Saves an assignment link, keeping fields the new record doesn't mention. */
function rwSaveCanvasLinkMerge_(classId, courseId, key, link) {
  var s = rwUpdateClass_(classId, function (row, st) {
    if (String(st.canvas.courseId || '') !== String(courseId)) return;
    st.canvas.assignments = st.canvas.assignments || {};
    st.canvas.assignments[key] = Object.assign({}, st.canvas.assignments[key] || {}, link);
  }).settings;
  return (s.canvas.assignments || {})[key] || link;
}
function rwCanvasCourseStudents_(conn, courseId) {
  return rwCanvasGetAll_(conn, '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&include[]=email&per_page=100').map(function (u) {
    return { id: String(u.id), email: normalizeEmail_(u.email || u.login_id), loginId: normalizeEmail_(u.login_id), sisId: normalizeEmail_(u.sis_user_id) };
  });
}
function rwCanvasMatch_(email, roster) {
  for (var i = 0; i < roster.length; i++) { var u = roster[i]; if (email && (u.email === email || u.loginId === email || u.sisId === email)) return u; }
  return null;
}
function rwRecordPosted_(posted) {
  if (!posted.length) return;
  var sh = rwQuizSheet_(), col = rwCol_(sh, 'CanvasPostedScore');
  posted.forEach(function (p) { if (p.row) sh.getRange(p.row, col).setValue(p.score); });
}
function rwSaveCanvasLink_(classId, courseId, key, link, hubStamp) {
  return rwUpdateClass_(classId, function (row, s) {
    if (String(s.canvas.courseId || '') !== String(courseId)) return; // course changed meanwhile
    s.canvas.assignments = s.canvas.assignments || {};
    s.canvas.assignments[key] = Object.assign({}, s.canvas.assignments[key] || {}, link);
    if (hubStamp) s.canvas.lmsHub = hubStamp;
  }).settings;
}

/** Push one week's Final Quiz scores to Canvas (creates the assignment the first time).
 *  `shared` is internal: pushRootGradebookToCanvas passes the Canvas roster so pushing every week
 *  fetches it once. payload.onlyLinked (Push all) skips a week that isn't in Canvas yet. */
function pushRootQuizToCanvas(payload, shared) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), week = rwWeekById_(payload.weekId);
  var c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas tab).');
  var meta = rwCanvasMeta_(week);
  if (payload.onlyLinked && !((c.assignments || {})[meta.key] || {}).assignmentId) return { ok: true, skipped: 'notInCanvas', week: week.label, sent: 0 };
  var rows = rwQuizGradeRows_(classId, week, ctx.settings);
  if (lmsHubEnabled_()) return rwHubPush_(ctx, classId, week, meta, rows);
  var conn = rwCanvasConn_(ctx.teacher.email);
  if (!conn.connected) throw new Error('Connect Canvas first (Canvas tab).');
  var sched = rwWeekSchedule_(ctx.settings, week.id);
  var ens = rwCanvasEnsureAssignment_(conn, c, meta, { sched: sched, publish: true }), a = ens.assignment, roster = (shared && shared.roster) || rwCanvasCourseStudents_(conn, c.courseId);
  var out = { ok: true, week: week.label, title: meta.label, created: ens.created, adopted: ens.adopted, sent: 0, notTaken: [], inProgress: [], unmatched: [], cleared: [], excused: [], unexcused: [], warnings: [], via: 'canvas' };
  var form = {}, posted = [];
  // 2026-10-18a -- the latest push is the truth in Canvas (same rule as the other apps): excluded ->
  // EXCUSED; excused earlier by this app and now scored -> excusal lifted and the score sent; no
  // score and not excluded -> left as Canvas has it. link.excusedEmails remembers this app's excusals.
  var excusedBefore = ((c.assignments || {})[meta.key] || {}).excusedEmails || {}, excusedNow = {};
  rows.forEach(function (r) {
    var u = rwCanvasMatch_(r.email, roster);
    if (r.excluded) {
      if (!u) { out.unmatched.push(r.name); if (excusedBefore[r.email]) excusedNow[r.email] = true; return; }
      form['grade_data[' + u.id + '][excuse]'] = 'true'; excusedNow[r.email] = true; out.excused.push(r.name);
      return;
    }
    if (r.score == null && excusedBefore[r.email]) { excusedNow[r.email] = true; if (r.status === 'in_progress') out.inProgress.push(r.name); else out.notTaken.push(r.name); return; }
    if (r.score == null) {
      if (r.status === 'in_progress') out.inProgress.push(r.name); else out.notTaken.push(r.name);
      if (r.postedScore !== '' && u) { form['grade_data[' + u.id + '][posted_grade]'] = ''; out.cleared.push(r.name); posted.push({ row: r.postedRow, score: '' }); }
      return;
    }
    if (!u) { out.unmatched.push(r.name); return; }
    form['grade_data[' + u.id + '][posted_grade]'] = String(r.score);
    if (excusedBefore[r.email]) { form['grade_data[' + u.id + '][excuse]'] = 'false'; out.unexcused.push(r.name); }
    out.sent++;
    if (String(r.postedScore) !== String(r.score)) posted.push({ row: r.postedRow, score: r.score });
  });
  if (Object.keys(form).length) rwCanvasRequest_(conn, 'post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(a.id) + '/submissions/update_grades', form);
  try { rwRecordPosted_(posted); } catch (e) { out.warnings.push('Scores reached Canvas, but the app couldn’t note that (' + e.message + ').'); }
  var link = { assignmentId: String(a.id), name: a.name || meta.label, htmlUrl: a.html_url || '', pointsPossible: Number(a.points_possible || meta.points), lastPushAt: rwNow_(), sent: out.sent, published: true, dueAt: a.due_at || '', excusedEmails: excusedNow };
  // Module: put it there now if a module was chosen and it isn't there yet (or the assignment is new).
  var prev = ens.previous || {};
  if (sched.moduleId && (prev.moduleId !== sched.moduleId || !prev.moduleItemId || String(prev.assignmentId || '') !== String(a.id) || prev.published === false)) {
    try { var m = rwCanvasSyncModule_(conn, c.courseId, a, sched.moduleId, prev, meta.label, true); link.moduleId = m.moduleId; link.moduleName = m.moduleName; link.moduleItemId = m.moduleItemId; }
    catch (e) { out.warnings.push('Scores are in Canvas, but the assignment couldn’t be put in the module (' + e.message + ').'); }
  }
  try { rwSaveCanvasLink_(classId, c.courseId, meta.key, link); } catch (e) { out.warnings.push('Canvas has the scores, but the app couldn’t save the assignment link (' + e.message + ').'); }
  out.htmlUrl = link.htmlUrl; out.lastPushAt = link.lastPushAt;
  return out;
}

/**
 * 2026-10-18a -- "↗ Push all to Canvas" on the Gradebook tab (ported from Short Story Lab, Macbeth
 * and Lit Circles). Pushes every week students can see whose Final Quiz is already in Canvas, one
 * after another, through pushRootQuizToCanvas -- the same code as each week's Push -- with
 * onlyLinked, so it never creates an assignment. Fetches the Canvas roster once. One week failing
 * doesn't stop the rest; it stops before Apps Script's 6-minute limit and says what's left.
 */
function pushRootGradebookToCanvas(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas tab).');
  var hub = lmsHubEnabled_(), links = c.assignments || {}, toPush = [], notInCanvas = [], hidden = [];
  rwWeeks_().forEach(function (w) {
    var linked = !!((links[rwCanvasKey_(w.id)] || {}).assignmentId), visible = rwWeekVisible_(ctx.settings, w.id);
    if (!visible) { if (linked) hidden.push(w.label); return; }
    if (!linked) { notInCanvas.push(w.label); return; }
    toPush.push(w);
  });
  if (!toPush.length) throw new Error('None of the weeks students can see are in Canvas yet. Use “Push scores to Canvas” on a week once to create it.');
  var shared = {};
  if (!hub) {
    var conn = rwCanvasConn_(ctx.teacher.email);
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas tab).');
    shared.roster = rwCanvasCourseStudents_(conn, c.courseId);
  }
  var started = Date.now(), out = { ok: true, weeks: [], sent: 0, notTaken: 0, excused: 0, unexcused: 0, inProgress: [], unmatched: [], cleared: [], warnings: [], failures: [], notReached: [], notInCanvas: notInCanvas, hidden: hidden, via: hub ? 'lmsHub' : 'canvas' };
  function addAll(list, into) { (list || []).forEach(function (n) { if (n && into.indexOf(n) < 0) into.push(n); }); }
  toPush.forEach(function (w) {
    if (Date.now() - started > 270000) { out.notReached.push(w.label); return; }
    try {
      var r = pushRootQuizToCanvas({ classId: classId, weekId: w.id, onlyLinked: true }, shared);
      if (r.skipped) { out.notInCanvas.push(w.label); return; }
      out.sent += r.sent || 0; out.notTaken += (r.notTaken || []).length; out.excused += (r.excused || []).length; out.unexcused += (r.unexcused || []).length;
      addAll(r.inProgress, out.inProgress); addAll(r.unmatched, out.unmatched); addAll(r.cleared, out.cleared);
      (r.warnings || []).forEach(function (x) { out.warnings.push(w.label + ': ' + x); });
      out.weeks.push({ week: w.label, sent: r.sent || 0 });
    } catch (e) { out.failures.push({ label: w.label, message: e.message || String(e) }); }
  });
  out.ok = !out.failures.length && !out.notReached.length;
  return out;
}

/** Canvas gradebook import file for one week (same numbers as Push). */
function exportRootQuizCsv(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), ctx = rwRequireClass_(classId), week = rwWeekById_(payload.weekId);
  var meta = rwCanvasMeta_(week), link = (ctx.settings.canvas.assignments || {})[meta.key];
  var head = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', meta.label + (link && link.assignmentId ? ' (' + link.assignmentId + ')' : '')];
  var lines = [head, ['Points Possible', '', '', '', '', meta.points]];
  rwQuizGradeRows_(classId, week, ctx.settings).forEach(function (r) { lines.push([r.name, '', '', r.email, '', r.score == null ? '' : r.score]); });
  var csv = lines.map(function (row) { return row.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
  return { ok: true, filename: 'Root Word Study - ' + week.label + ' - Final Quiz.csv', csv: csv };
}

// ============================================================================
// LMS HUB (same hub as Literature Circles; off unless LMS_HUB_ENABLED = true)
// Script Properties: LMS_HUB_URL, LMS_HUB_KEY (a key made for the hub app "rootwordstudy"),
// LMS_HUB_ENABLED = true. Needs LmsHub.gs in this project.
// ============================================================================

var RW_HUB_APP_ID = 'rootwordstudy';

function lmsHubEnabled_() {
  var p = PropertiesService.getScriptProperties();
  return String(p.getProperty('LMS_HUB_ENABLED') || '').trim().toLowerCase() === 'true' &&
    !!String(p.getProperty('LMS_HUB_URL') || '').trim() && !!String(p.getProperty('LMS_HUB_KEY') || '').trim() &&
    typeof LmsHub !== 'undefined';
}
function rwHubCall_(fn) {
  try { return fn(); } catch (e) {
    var code = e && e.hubCode, msg = String((e && e.message) || e), text;
    if (/LMS Hub is not set up|Could not tell which teacher/.test(msg)) text = msg;
    else if (!code && !(e && e.status)) text = 'Couldn’t reach the LMS Hub (' + msg.replace(/^Exception:\s*/, '') + ').';
    else if (code === 'unauthorized') text = 'The LMS Hub didn’t accept this app’s key. Check LMS_HUB_KEY in Script Properties (it must be the key made for "' + RW_HUB_APP_ID + '").';
    else if (code === 'lms_unauthorized') text = 'Canvas turned down the access token. Paste a new token in the Canvas tab, then push again.';
    else if (code === 'not_connected') text = 'Canvas isn’t connected in the LMS Hub yet. Connect Canvas in the Canvas tab, then push again.';
    else text = 'The LMS Hub reported a problem: ' + msg;
    var err = new Error(text + ' To push straight to Canvas instead, set LMS_HUB_ENABLED to false in Script Properties.');
    err.hubCode = code; throw err;
  }
}
function rwHubStamp_(c) {
  var a = c.assignments || {};
  return rwMd5_([String(c.courseId || ''), String(c.assignmentGroupId || '')].concat(Object.keys(a).sort().map(function (k) { return k + '|' + (a[k].assignmentId || ''); })).join('\n')).slice(0, 16);
}
/** The hub has this teacher's Canvas token and this class's course link (importing any assignment
 *  the app already made directly, so nothing is duplicated). */
function rwHubEnsureClass_(classId, c, teacher) {
  var me = rwHubCall_(function () { return LmsHub.me(teacher); });
  if (me.app && me.app.id && me.app.id !== RW_HUB_APP_ID) throw new Error('LMS_HUB_KEY belongs to the hub app "' + me.app.id + '", not "' + RW_HUB_APP_ID + '". Make a key for "' + RW_HUB_APP_ID + '" on the hub\'s /setup page.');
  var conn = rwCanvasConn_(teacher), hc = (me.connections || []).filter(function (x) { return x.platform === 'canvas'; })[0];
  if (!hc) {
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas tab).');
    rwHubCall_(function () { return LmsHub.saveConnection({ platform: 'canvas', baseUrl: conn.baseUrl, token: conn.token }, teacher); });
  }
  var stamp = rwHubStamp_(c);
  var link = rwHubCall_(function () { return LmsHub.getClassLink(classId, teacher).link; });
  if (link && link.platform === 'canvas' && String(link.courseId) === String(c.courseId) && String(link.groupId || '') === String(c.assignmentGroupId || '') && (c.lmsHub || {}).stamp === stamp) return stamp;
  var assignments = {};
  Object.keys(c.assignments || {}).forEach(function (k) {
    var x = c.assignments[k] || {}; if (!x.assignmentId) return;
    assignments[k] = { lmsAssignmentId: String(x.assignmentId), name: x.name || '', htmlUrl: x.htmlUrl || '', pointsPossible: x.pointsPossible, gradingType: 'points', published: true, placementId: '', placementName: '', placementItemId: '', dueAt: '', unlockAt: '', lockAt: '', lastAssignmentSyncAt: '', lastGradeSyncAt: x.lastPushAt || '', feedback: [] };
  });
  rwHubCall_(function () {
    return LmsHub.importClass(classId, { platform: 'canvas', courseId: String(c.courseId), courseName: c.courseName || '', groupId: String(c.assignmentGroupId || ''), groupName: c.assignmentGroupName || '', assignments: assignments }, teacher);
  });
  return stamp;
}
function rwHubPush_(ctx, classId, week, meta, rows) {
  var c = ctx.settings.canvas, teacher = ctx.teacher.email;
  rwHubEnsureClass_(classId, c, teacher);
  var out = { ok: true, week: week.label, title: meta.label, created: false, adopted: false, sent: 0, notTaken: [], inProgress: [], unmatched: [], cleared: [], excused: [], unexcused: [], warnings: [], via: 'lmsHub' };
  var hubRows = [], byEmail = {}, stillScored = [], stillExcused = [];
  var excusedBefore = ((c.assignments || {})[meta.key] || {}).excusedEmails || {};
  rows.forEach(function (r) {
    byEmail[r.email] = r;
    // 2026-10-18a: excluded -> sent through the hub as excused (Canvas marks it Excused). Excused
    // earlier and still no score -> left alone. Scored now -> the score goes, but the hub can't
    // send excuse=false, so the teacher is told to check.
    if (r.excluded) { hubRows.push({ email: r.email, name: r.name, score: null, excused: true, feedback: '' }); out.excused.push(r.name); return; }
    if (excusedBefore[r.email] && r.score == null) { if (r.status === 'in_progress') out.inProgress.push(r.name); else out.notTaken.push(r.name); return; }
    if (excusedBefore[r.email]) stillExcused.push(r.name);
    if (r.score == null) {
      if (r.status === 'in_progress') out.inProgress.push(r.name); else out.notTaken.push(r.name);
      if (r.postedScore !== '') stillScored.push(r.name);
      return;
    }
    hubRows.push({ email: r.email, name: r.name, score: Number(r.score), feedback: '' });
  });
  var spec = { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: rwCanvasDescription_(week), published: true };
  var hs = rwWeekSchedule_(ctx.settings, week.id);
  if (hs.hasDue) spec.dueAt = hs.dueAt;
  if (hs.moduleId) spec.placementId = hs.moduleId;
  var res = rwHubCall_(function () { return LmsHub.pushGrades(classId, meta.key, spec, hubRows, teacher); });
  var skip = {};
  (res.unmatched || []).forEach(function (u) { var m = /\(([^()]+)\)$/.exec(u); var em = m ? normalizeEmail_(m[1]) : ''; skip[em] = true; out.unmatched.push(byEmail[em] ? byEmail[em].name : u); });
  (res.failed || []).forEach(function (f) { skip[normalizeEmail_(f.email)] = true; });
  (res.pending || []).forEach(function (e) { skip[normalizeEmail_(e)] = true; });
  var posted = [];
  // Who this app has excused in Canvas after this push (kept on the link, like a direct push).
  var excusedNow = {};
  Object.keys(excusedBefore).forEach(function (e) { var r = byEmail[e]; if (r && r.score == null && !r.excluded) excusedNow[e] = true; });
  hubRows.forEach(function (h) {
    if (h.excused) { excusedNow[h.email] = !skip[h.email] || !!excusedBefore[h.email]; if (!excusedNow[h.email]) delete excusedNow[h.email]; return; }
    if (skip[h.email]) { if (excusedBefore[h.email]) excusedNow[h.email] = true; return; }
    var r = byEmail[h.email]; if (String(r.postedScore) !== String(h.score)) posted.push({ row: r.postedRow, score: h.score });
  });
  out.sent = Number(res.sent) || 0; out.created = !!res.created; out.adopted = !!res.adopted;
  (res.warnings || []).forEach(function (w) { out.warnings.push(w); });
  if ((res.failed || []).length) out.warnings.push('Canvas couldn’t apply ' + res.failed.length + ' score(s). Push again.');
  if ((res.pending || []).length) out.warnings.push(res.pending.length + ' student(s) still waiting. Push again to finish.');
  if (stillExcused.length) out.warnings.push('These were excused in Canvas earlier and now count again. The LMS Hub sent their scores but can’t lift the excusal itself: ' + stillExcused.join(', ') + '. If Canvas still shows them as Excused, push once with LMS_HUB_ENABLED=false.');
  if (stillScored.length) out.warnings.push('Through the LMS Hub a score can’t be removed from Canvas, so these still show their old score there: ' + stillScored.join(', ') + '. Clear it in Canvas, or push once with LMS_HUB_ENABLED=false.');
  try { rwRecordPosted_(posted); } catch (e) { out.warnings.push('Scores reached Canvas, but the app couldn’t note that (' + e.message + ').'); }
  var a = res.assignment || {};
  var link = { assignmentId: String(a.lmsAssignmentId || ''), name: a.name || meta.label, htmlUrl: a.htmlUrl || '', pointsPossible: Number(a.pointsPossible || meta.points), lastPushAt: rwNow_(), sent: out.sent, excusedEmails: excusedNow };
  try {
    var s2 = rwSaveCanvasLink_(classId, c.courseId, meta.key, link);
    rwSaveCanvasLink_(classId, c.courseId, meta.key, link, { appId: RW_HUB_APP_ID, stamp: rwHubStamp_(s2.canvas), at: rwNow_() });
  } catch (e) { out.warnings.push('Canvas has the scores, but the app couldn’t save the assignment link (' + e.message + ').'); }
  out.htmlUrl = link.htmlUrl; out.lastPushAt = link.lastPushAt;
  return out;
}

/** From the editor: checks the hub key and connection for this app. */
function testRootWordLmsHub() {
  var me = LmsHub.me();
  Logger.log('Hub app: ' + (me.app && me.app.id) + (me.app && me.app.id !== RW_HUB_APP_ID ? '  (WARNING: this app needs a key made for "' + RW_HUB_APP_ID + '")' : ''));
  Logger.log('Canvas connected in hub for you: ' + ((me.connections || []).some(function (c) { return c.platform === 'canvas'; }) ? 'yes' : 'no'));
  Logger.log('LMS_HUB_ENABLED: ' + (lmsHubEnabled_() ? 'on — Push goes through the hub' : 'off — Push goes straight to Canvas'));
  return me;
}

// ============================================================================
// RESTORING SENTENCES (editor tools — see RESTORE_STUDENT at the top)
// ============================================================================

function listVocabBackups() {
  var em = normalizeEmail_(RESTORE_STUDENT); if (!em) throw new Error('Type the student\'s email in RESTORE_STUDENT at the top of Code.gs first.');
  var sh = rwSheet_(RW_BACKUP_SHEET, RW_BACKUP_HEADERS), rows = rwFindRows_(sh, 'Email', em);
  if (!rows.length) { Logger.log('No backups for ' + em + '.'); return []; }
  return rows.reverse().map(function (n) {
    var r = rwReadRow_(sh, n), line = 'Row ' + n + ' · ' + rwText_(r.SavedAt) + ' · ' + r.Reason + ' · ' + r.Filled + ' sentences, ' + r.Chars + ' characters';
    Logger.log(line); return line;
  });
}
function restoreVocabBackup() {
  var em = normalizeEmail_(RESTORE_STUDENT), n = Number(RESTORE_ROW);
  if (!em || !(n >= 2)) throw new Error('Set RESTORE_STUDENT and RESTORE_ROW at the top of Code.gs first.');
  var bsh = rwSheet_(RW_BACKUP_SHEET, RW_BACKUP_HEADERS), b = rwReadRow_(bsh, n);
  if (normalizeEmail_(b.Email) !== em) throw new Error('Row ' + n + ' is not a backup for ' + em + '.');
  var json = rwJoinChunks_(RW_SENTENCE_COLS.map(function (h) { return b[h]; })), obj = rwParse_(json, null);
  if (!obj) throw new Error('That backup can\'t be read as sentences. Pick another row.');
  var cur = handleLoad_(em);
  var sheet = getSheet_(), row = findRow_(sheet, em);
  if (row > 0) rwBackupSentences_(em, rwJoinChunks_(RW_SENTENCE_COLS.map(function (h) { return sheet.getRange(row, SHEET_HEADERS.indexOf(h) + 1).getValue(); })), 'before restoring row ' + n);
  var res = handleSave_(em, { SentencesJSON: obj });
  Logger.log(res.ok ? 'Restored ' + rwFilledCount_(obj) + ' sentences for ' + em + ' from row ' + n + '. Ask them to reload the page.' : 'Restore failed: ' + res.error);
  return res;
}
