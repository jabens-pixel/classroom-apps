/**
 * Lit Circles (Simplified) — Web App (server)
 * A copy of Jaben's Literature Circles app (live 2026-10-29b) without the Reader's Journal and the
 * Hybrid: Step 1 is always two reading strategies. Each class has a Unit setup (Teacher dashboard →
 * Unit setup) that decides
 *   - books: ONE book for the whole class (title, author and four weekly sections set by the
 *     teacher), or DIFFERENT books (each group types its own book and chapters, as in Lit Circles);
 *   - strategies: the SAME two for everyone each week (the teacher picks them), or ROTATING roles
 *     (each group member gets a different pair each week; the pairs rotate so that over four weeks
 *     every student does all of them).
 * Reading Quizzes are shared: groups reading the same book and the same section get one quiz.
 * The weekly routine is unchanged: Step 1 Submission → Step 2 Plan → Reading Quiz → Discussion →
 * Step 3 Peer → Step 4 Reflection.
 * Backend: one Google Sheet (the database) + this Apps Script web app.
 *
 * Release 2026-09-26a — the grading rebuild. The teacher dashboard now uses the same
 * tile + marking-screen design as the Macbeth and Short Story apps, and the student
 * saves were hardened:
 *   - every student call is tied to the signed-in Google account (teachers may still
 *     open any student's view);
 *   - student saves read and write ONLY that student's rows (TextFinder lookups, one
 *     setValues per write) instead of re-reading whole tabs under a script-wide lock;
 *   - long answers are split across DataJson..DataJson5 so the 50,000-character cell
 *     limit can't silently lose work;
 *   - "redone after grading" is detected by a content fingerprint, not a timestamp;
 *   - class settings are changed under a lock with a fresh read, so a Canvas push can't
 *     undo a release switch.
 * New columns are always appended at the END of a tab, so existing rows keep their place.
 */
// The app's first admin. In a copy shared with another teacher this is left '' — then whoever
// runs setupLiteratureCirclesBackend() first becomes the admin (only while the app has no admin).
var TEACHER_EMAIL = '';

// ---------- The unit plan (one per class, set in Unit setup on the Teacher dashboard) ----------
// Stored in the class settings as settings.plan:
//   bookMode 'single' | 'multiple'; book {title, author, reading[4]} (single only);
//   strategyMode 'same' | 'rotate'; weeks {1..4: [a, b]} (same); pairs [[a, b] x 4] (rotate).
// Changing it later only affects work not started yet: a student's saved Step 1 keeps the two
// strategies it was written for (lcChoicesFor_), so nothing they wrote is ever hidden.
var LC_STRATEGY_NAMES = { summarizer: 'Summarizer', researcher: 'Researcher', connector: 'Connector', questioner: 'Questioner', literaryLuminary: 'Literary Luminary', predictor: 'Predictor', inferences: 'Making Inferences with Fiction', illustrator: 'Character Analysis' };
var LC_STRATEGY_KEYS = Object.keys(LC_STRATEGY_NAMES);
var LC_DEFAULT_PAIRS = [['summarizer', 'researcher'], ['predictor', 'illustrator'], ['connector', 'questioner'], ['literaryLuminary', 'inferences']];
function lcDefaultPlan_() {
  return { bookMode: 'multiple', book: { title: '', author: '', reading: ['', '', '', ''] }, strategyMode: 'same',
    weeks: { 1: LC_DEFAULT_PAIRS[0].slice(), 2: LC_DEFAULT_PAIRS[1].slice(), 3: LC_DEFAULT_PAIRS[2].slice(), 4: LC_DEFAULT_PAIRS[3].slice() },
    pairs: LC_DEFAULT_PAIRS.map(function (p) { return p.slice(); }) };
}
function lcValidPair_(p) {
  return Array.isArray(p) && p.length === 2 && LC_STRATEGY_KEYS.indexOf(String(p[0])) >= 0 && LC_STRATEGY_KEYS.indexOf(String(p[1])) >= 0 && String(p[0]) !== String(p[1]);
}
/** A plan as stored (never throws; anything unreadable falls back to the defaults). */
function lcNormalizePlan_(raw) {
  var d = lcDefaultPlan_(); raw = raw && typeof raw === 'object' ? raw : {};
  if (raw.bookMode === 'single' || raw.bookMode === 'multiple') d.bookMode = raw.bookMode;
  var b = raw.book && typeof raw.book === 'object' ? raw.book : {};
  d.book.title = String(b.title || '').trim().slice(0, 300);
  d.book.author = String(b.author || '').trim().slice(0, 200);
  d.book.reading = [0, 1, 2, 3].map(function (i) { return String((Array.isArray(b.reading) ? b.reading[i] : '') || '').trim().slice(0, 200); });
  if (raw.strategyMode === 'same' || raw.strategyMode === 'rotate') d.strategyMode = raw.strategyMode;
  [1, 2, 3, 4].forEach(function (w) { var p = raw.weeks && raw.weeks[w]; if (lcValidPair_(p)) d.weeks[w] = [String(p[0]), String(p[1])]; });
  if (Array.isArray(raw.pairs) && raw.pairs.length === 4 && raw.pairs.every(lcValidPair_)) d.pairs = raw.pairs.map(function (p) { return [String(p[0]), String(p[1])]; });
  return d;
}
/** One book for the class only once the teacher has typed its title. */
function lcPlanSingle_(plan) { return !!(plan && plan.bookMode === 'single' && plan.book && plan.book.title); }
/** The class whose plan a student follows: the first active class they're enrolled in. */
function lcStudentPlanClass_(email) {
  var ids = lcEnrollmentsForStudent_(email), out = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (c) {
    if (out || ids.indexOf(String(c.ClassId)) < 0 || !lcTruth_(c.Active)) return;
    out = { classId: String(c.ClassId), plan: lcNormalizeClassSettings_(c.SettingsJson).plan };
  });
  return out || { classId: '', plan: lcDefaultPlan_() };
}
/** The two strategies the plan gives this member of this group for this week. Rotating roles: the
 *  member's place in the group decides their first pair; it moves on one pair each week. */
function lcPlanPairFor_(plan, group, email, week) {
  week = Number(week) || 1;
  if (plan.strategyMode !== 'rotate') return plan.weeks[week].slice();
  var members = ((group && group.memberEmails) || []).map(normEmail_), i = Math.max(0, members.indexOf(normEmail_(email)));
  return plan.pairs[(i + week - 1) % plan.pairs.length].slice();
}
/** The two strategies a student's Step 1 uses: the ones their saved work or draft already has (so
 *  a plan change never hides writing), otherwise the plan's. */
function lcChoicesFor_(group, email, week, clientPair) {
  function two(rec) {
    if (!rec || String(rec.PrepType || '') !== 'strategies') return null;
    var c = String(rec.Choices || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return LC_STRATEGY_KEYS.indexOf(x) >= 0; });
    return c.length === 2 ? c : null;
  }
  // nothing saved yet: the pair the page is showing (it may have loaded before a plan change or a
  // group change shifted the rotation — the writing on it belongs to those two), else the plan's
  return two(lcOwnRow_(workSheet_(), group.groupId, email, week)) || two(lcOwnRow_(draftSheet_(), group.groupId, email, week)) || (lcValidPair_(clientPair) ? [String(clientPair[0]), String(clientPair[1])] : lcPlanPairFor_(lcStudentPlanClass_(email).plan, group, email, week));
}
/** What the student's page needs: the plan, this student's pair each week, and (rotating roles)
 *  who in the group has which pair. */
function lcStudentPlan_(email, group) {
  var pc = lcStudentPlanClass_(email), plan = pc.plan, mine = {}, roles = {}, names = {};
  if (group && plan.strategyMode === 'rotate' && pc.classId) lcEnrollments_(pc.classId).forEach(function (e) { names[normEmail_(e.StudentEmail)] = String(e.StudentName || ''); });
  [1, 2, 3, 4].forEach(function (w) {
    mine[w] = lcPlanPairFor_(plan, group, email, w);
    if (group && plan.strategyMode === 'rotate') roles[w] = group.memberEmails.map(function (m) { var em = normEmail_(m); return { email: em, name: names[em] || lcNameFromEmail_(em), choices: lcPlanPairFor_(plan, group, em, w) }; });
  });
  return { bookMode: lcPlanSingle_(plan) ? 'single' : 'multiple', book: plan.book, strategyMode: plan.strategyMode, mine: mine, roles: roles };
}

// ---------- Getting a student's writing back (run from the Apps Script editor) ----------
// Every time a student's saved writing is about to be replaced in a way that could lose something
// (it gets much shorter, the pathway changes, the stored copy can't be read, another device's
// newer copy is involved — and otherwise at most once every 10 minutes), the old copy is first
// kept in the WorkBackups tab. To look at or restore one:
//   1. Type the student's email between the quotes of BACKUP_STUDENT below (and a week number in
//      BACKUP_WEEK, or leave it '' for every week). Save (Ctrl+S).
//   2. Pick listWorkBackups in the function menu at the top and click Run. The Execution log lists
//      every kept copy, newest first, with its row number in the WorkBackups tab and a preview.
//   3. Type that row number in BACKUP_ROW, save, pick restoreWorkBackup and click Run. The copy
//      becomes the student's newest DRAFT (their current copy is backed up first), so the student
//      sees it the next time they open that step and can submit it. Nothing they submitted changes.
//   4. Put the three values back to '' when you're done.
var BACKUP_STUDENT = '';
var BACKUP_WEEK = '';
var BACKUP_ROW = '';

// Google periodically retires older Gemini model IDs for new API keys/projects (this is what
// caused the "no longer available to new users" error) — kept as one constant so bumping to a
// newer model later is a one-line change instead of a code hunt.
var GEMINI_MODEL = 'gemini-3.7-flash';

// Bump on every release: here, LCH_RELEASE at the top of BackendClient.html (it sets the badge and
// LC_CLIENT_VERSION, so Index.html only needs re-pasting when Index itself changes) and
// FILE_FINGERPRINTS.release at the bottom of this file.
var LC_APP_VERSION = '2026-11-06a';
var LC_LIVE_VERSION_PROP = 'LC_LIVE_APP_VERSION';

var SHEET_NAMES = { GROUPS: 'Groups', WORK: 'WeeklyWork', DRAFTS: 'WeeklyDrafts', PEER: 'PeerAssessments', HISTORY: 'BookHistory', REFLECT: 'Reflections', RESUME: 'StudentResume', SELF: 'DiscussionSelfAssessments', STEP: 'StepDrafts', BACKUP: 'WorkBackups', WSTATS: 'WritingStats', AWAY: 'DiscussionAway' };

// Column lists. Existing columns keep their positions; anything new goes at the end and is
// added to an existing tab automatically the first time the tab is opened (lcEnsureColumns_).
var LC_SHEET_HEADERS = {
  Groups: ['GroupId', 'BookTitle', 'MemberEmails', 'Week1Reading', 'Week2Reading', 'Week3Reading', 'Week4Reading', 'CreatedAt'],
  WeeklyWork: ['GroupId', 'Email', 'Week', 'PrepType', 'Choices', 'DataJson', 'UpdatedAt', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5', 'SubmissionFp', 'SubmittedAt', 'PlanComplete', 'PlanUpdatedAt'],
  WeeklyDrafts: ['GroupId', 'Email', 'Week', 'PrepType', 'Choices', 'DataJson', 'UpdatedAt', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5'],
  PeerAssessments: ['GroupId', 'Week', 'AssessorEmail', 'AssessedEmail', 'Participation', 'ParticipationComment', 'Leadership', 'LeadershipComment', 'ActiveEngagement', 'ActiveEngagementComment', 'SubmittedAt'],
  BookHistory: ['Email', 'OldGroupId', 'OldBookTitle', 'ArchivedAt'],
  Reflections: ['GroupId', 'Email', 'Week', 'Type', 'Answers', 'Goal', 'SubmittedAt', 'AnswersFp', 'Answers2', 'Answers3', 'Answers4', 'Answers5'],
  DiscussionSelfAssessments: ['GroupId', 'Email', 'Week', 'Participation', 'Leadership', 'ActiveEngagement', 'SubmittedAt'],
  StudentResume: ['Email', 'View', 'Week', 'FlowStage', 'FocusIndex', 'HybridMoment', 'UpdatedAt', 'MarkStyle'],
  // Half-finished Step 2 plans and Step 4 reflections (Kind = 'plan' | 'reflection'). Blanked in
  // place when the real Plan / Reflection save succeeds.
  StepDrafts: ['Email', 'Week', 'Kind', 'UpdatedAt', 'DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5', 'GroupId'],
  // Earlier copies of student writing, kept before a risky overwrite (see BACKUP_STUDENT at the top).
  WorkBackups: ['Email', 'Week', 'Kind', 'SavedAt', 'Reason', 'Chars', 'GroupId', 'PrepType', 'Choices', 'DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5'],
  // Writing-process stats (WritingStats.html): one row per student per week per group. DataJson
  // holds { boxes: { boxKey: stats }, clocks: { s1..s4: step writing time } }. Don't edit by hand.
  WritingStats: ['Email', 'Week', 'GroupId', 'UpdatedAt', 'DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5'],
  // A groupmate (or the teacher) marked this student away for that week's Discussion Day.
  // One row per group/week/student; Away false = they were there after all. Rows are never deleted.
  DiscussionAway: ['GroupId', 'Week', 'Email', 'Away', 'MarkedBy', 'MarkedAt']
};

/** Serves the app. Index.html is a template so the teacher dashboard (BackendClient.html) can be
 *  spliced in. XFrameOptionsMode.ALLOWALL lets it be embedded in an <iframe> on another website. */
function doGet(e) {
  lcRegisterLiveAppVersion_();
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Lit Circles (Simplified)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Files that are spliced in right after another include, so adding a file never needs an edit to
 *  the 400 KB Index.html. WritingStats (per-box writing stats) and WritingFocus (focus mode for Step 1
 *  writing) ride along too. Checklists (the Step 1 writing checklists) and SaveGuard (keeps student
 *  writing safe: stale tabs, unsaved text, Steps 2 and 4 drafts) ride along with BackendClient. */
var LC_INCLUDE_WITH = {"BackendClient": ["Checklists","SaveGuard","StrategyArt","WritingStats","WritingFocus","ReadingQuiz","DiscussionDeck","DiscussionAway","CommentBank","WeekDueDates","Bullets","MarkStyle","UnitPlan"]};

/** Splices another HTML file into Index. A missing file becomes a visible warning, not a blank page. */
function include_(name) {
  var out = lcIncludeOne_(name);
  (LC_INCLUDE_WITH[name] || []).forEach(function (extra) { out += lcIncludeOne_(extra); });
  return out;
}
function lcIncludeOne_(name) {
  try {
    return HtmlService.createHtmlOutputFromFile(name).getContent();
  } catch (e) {
    return '<script>window.__LC_MISSING=(window.__LC_MISSING||[]).concat([' + JSON.stringify(String(name)) + ']);</script>';
  }
}

// ---------- Version marker (sends stale browser tabs to the current build) ----------

function lcAppVersionParts_(v) {
  var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})([a-z]*)$/);
  if (!m) return null;
  var suffix = 0;
  for (var i = 0; i < m[4].length; i++) suffix = suffix * 26 + (m[4].charCodeAt(i) - 96);
  return [Number(m[1]), Number(m[2]), Number(m[3]), suffix];
}
function lcCompareAppVersions_(a, b) {
  var pa = lcAppVersionParts_(a), pb = lcAppVersionParts_(b);
  if (!pa && !pb) return 0; if (!pa) return -1; if (!pb) return 1;
  for (var i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
function lcLiveAppVersion_() {
  return PropertiesService.getScriptProperties().getProperty(LC_LIVE_VERSION_PROP) || LC_APP_VERSION;
}
/** Only ever moves the live marker forward, so an old deployment URL can't pull it back. The link
 *  (/exec) that served the newest build is remembered with it, so a tab on an older link can be
 *  sent to the link that actually has it. A test (/dev) link never counts: students can't open it. */
var LC_LIVE_URL_PROP = 'LC_LIVE_APP_URL';
function lcRegisterLiveAppVersion_() {
  try {
    var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
    if (url && !/\/exec(\?|$)/.test(url)) return; // the editor's test link
    var props = PropertiesService.getScriptProperties();
    var live = props.getProperty(LC_LIVE_VERSION_PROP);
    if (!live || lcCompareAppVersions_(LC_APP_VERSION, live) > 0) {
      props.setProperty(LC_LIVE_VERSION_PROP, LC_APP_VERSION);
      if (url) props.setProperty(LC_LIVE_URL_PROP, url);
    }
  } catch (e) {}
}
/** serverBuild: the build THIS link serves right now (a reload gets exactly this).
 *  version: the newest build any /exec link has served; liveUrl: that link. */
function getAppVersion() {
  var url = '', liveUrl = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  try { liveUrl = PropertiesService.getScriptProperties().getProperty(LC_LIVE_URL_PROP) || ''; } catch (e) {}
  return { ok: true, version: lcLiveAppVersion_(), serverBuild: LC_APP_VERSION, url: url, liveUrl: liveUrl };
}

// ---------- Per-execution caches ----------
// Apps Script globals live for one server call, so these never go stale across users.
var LC_X_ = { ss: null, sheets: {}, headers: {}, users: null, classes: null, enroll: null };

function getSs_() {
  if (LC_X_.ss) return LC_X_.ss;
  var props = PropertiesService.getScriptProperties();
  var storedId = props.getProperty('SPREADSHEET_ID');
  if (storedId) {
    // A brief "Service Spreadsheets timed out" must never send the app to a new, empty database:
    // retry, then use the Sheet this script is attached to, then give up with a retryable error.
    for (var attempt = 0; attempt < 3; attempt++) {
      try { LC_X_.ss = SpreadsheetApp.openById(storedId); return LC_X_.ss; } catch (e) { if (attempt < 2) Utilities.sleep(400 * (attempt + 1)); }
    }
    var bound = null; try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { bound = null; }
    if (bound && bound.getId() === storedId) { LC_X_.ss = bound; return bound; }
    if (bound) { LC_X_.ss = bound; return bound; } // attached script: its own Sheet is the database
    throw new Error('The class database is busy right now — please try again in a moment. (Nothing was lost.)');
  }
  // If this script is bound to a Sheet (created via that Sheet's Extensions > Apps Script menu),
  // use it and remember its ID.
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { props.setProperty('SPREADSHEET_ID', active.getId()); LC_X_.ss = active; return active; }
  // Standalone script — create the database the first time and remember it.
  var created = SpreadsheetApp.create('Lit Circles (Simplified) - App Data');
  props.setProperty('SPREADSHEET_ID', created.getId());
  LC_X_.ss = created;
  return created;
}

/** Get (or create) a tab and make sure every column the code expects exists — new ones at the end. */
function getSheet_(name, headers) {
  if (LC_X_.sheets[name]) return LC_X_.sheets[name];
  var ss = getSs_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    lcEnsureColumns_(sh, headers);
  }
  LC_X_.sheets[name] = sh;
  return sh;
}
function lcEnsureColumns_(sh, headers) {
  var lastCol = Math.max(1, sh.getLastColumn());
  var have = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) {
    var start = have.length;
    while (start > 0 && !have[start - 1]) start--;
    if (sh.getMaxColumns() < start + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - sh.getMaxColumns());
    sh.getRange(1, start + 1, 1, missing.length).setValues([missing]);
    have = have.slice(0, start).concat(missing);
  }
  delete LC_X_.headers[sh.getName()];
  return have;
}
/** Header names of a tab (cached for this call). */
function lcHeaders_(sh) {
  var n = sh.getName();
  if (!LC_X_.headers[n]) {
    var lastCol = Math.max(1, sh.getLastColumn());
    LC_X_.headers[n] = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  }
  return LC_X_.headers[n];
}
function lcCol_(sh, header) { var i = lcHeaders_(sh).indexOf(header); return i < 0 ? 0 : i + 1; }

/** Row numbers (ascending) whose `header` cell equals `value` — found with TextFinder, so a
 *  big tab is never downloaded just to locate one student's rows. */
function lcFindRowNumbers_(sh, header, value) {
  var col = lcCol_(sh, header), last = sh.getLastRow();
  if (!col || last < 2 || value === '' || value == null) return [];
  var cells = sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(false).findAll();
  return cells.map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; });
}
/** Read whole rows as header-keyed objects: [{_row, Header: value, ...}]. */
function lcReadRows_(sh, rowNums) {
  var headers = lcHeaders_(sh), out = [];
  (rowNums || []).forEach(function (r) {
    var vals = sh.getRange(r, 1, 1, headers.length).getValues()[0], o = { _row: r };
    headers.forEach(function (h, i) { if (h) o[h] = vals[i]; });
    out.push(o);
  });
  return out;
}
/** All rows of a tab as header-keyed objects (teacher views only). */
function lcAllRows_(sh) {
  var last = sh.getLastRow(), headers = lcHeaders_(sh);
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, headers.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], any = false, o = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) { if (headers[j]) o[headers[j]] = row[j]; if (row[j] !== '' && row[j] !== null) any = true; }
    if (any) out.push(o);
  }
  return out;
}
/** Only the listed columns of a tab, one column read each — lets tile counts skip big JSON cells. */
function lcReadColumns_(sh, names) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = {}, n = last - 1;
  names.forEach(function (h) { var c = lcCol_(sh, h); cols[h] = c ? sh.getRange(2, c, n, 1).getValues() : null; });
  var out = [];
  for (var i = 0; i < n; i++) {
    var o = { _row: i + 2 }, any = false;
    names.forEach(function (h) { var v = cols[h] ? cols[h][i][0] : ''; o[h] = v; if (v !== '' && v !== null) any = true; });
    if (any) out.push(o);
  }
  return out;
}
/** Header-driven row values: every column gets obj[header] or ''. Never positional. */
function lcRowFromObject_(sh, obj) {
  return lcHeaders_(sh).map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return v;
    v = lcText_(v);
    // A Sheets cell holds at most 50,000 characters; say so plainly instead of Google's raw error.
    if (v.length > LC_CELL_MAX) throw new Error('This is too long to save: one box holds at most ' + LC_CELL_MAX.toLocaleString() + ' characters and this has ' + v.length.toLocaleString() + '. Please shorten it — nothing was changed.');
    return v;
  });
}
var LC_CELL_MAX = 49500;
function lcWriteObjectRow_(sh, rowNum, obj) {
  var vals = lcRowFromObject_(sh, obj);
  sh.getRange(rowNum, 1, 1, vals.length).setValues([vals]);
}
function lcAppendObject_(sh, obj) { sh.appendRow(lcRowFromObject_(sh, obj)); }

/**
 * Upsert one student-owned row identified by `keys` (header -> value, compared as text).
 * Finds candidate rows by the student's email with TextFinder, takes the LAST match (the
 * same row every reader uses), re-checks its keys right before writing (another call may
 * have removed a row above it), and writes the whole row with a single setValues.
 */
function lcUpsertByKeys_(sh, emailHeader, keys, fields, opts) {
  opts = opts || {};
  function matches(rec) {
    return Object.keys(keys).every(function (k) {
      return k === emailHeader ? normEmail_(rec[k]) === normEmail_(keys[k]) : String(rec[k]) === String(keys[k]);
    });
  }
  // `fields` may be a function of the row exactly as it is just before the write (or null for a
  // new row) and the save time — so a merge (e.g. keeping the discussion plan inside a submission)
  // is always made from the newest copy, never from an earlier read. The save time is taken right
  // before the write, so a page that loads while this save is running can never get a later load
  // time than a write it didn't see.
  function run() {
    if (opts.groupOf) {
      // A teacher may have moved this student to another group since the save started.
      lcInvalidateGroups_();
      var g = findGroupByEmail_(opts.groupOf);
      if (!g || String(g.groupId) !== String(keys.GroupId)) throw new Error(LC_GROUP_CHANGED_MSG);
    }
    for (var attempt = 0; attempt < 2; attempt++) {
      var recs = lcReadRows_(sh, lcFindRowNumbers_(sh, emailHeader, keys[emailHeader])).filter(matches);
      if (!recs.length) {
        var now0 = new Date();
        if (opts.noCreate) return { created: false, record: null, now: now0 };
        var f0 = typeof fields === 'function' ? fields(null, now0) : fields;
        var fresh = {}; Object.keys(keys).forEach(function (k) { fresh[k] = keys[k]; });
        Object.keys(f0).forEach(function (k) { fresh[k] = f0[k]; });
        lcAppendObject_(sh, fresh);
        return { created: true, record: fresh, now: now0 };
      }
      var rowNum = recs[recs.length - 1]._row;
      // re-read that row immediately before writing: its key cells must still match, and every
      // column this save doesn't set is carried over from this newest copy
      var check = lcReadRows_(sh, [rowNum])[0];
      if (!check || !matches(check)) continue;
      var now = new Date();
      var f = typeof fields === 'function' ? fields(check, now) : fields;
      var merged = {}; Object.keys(check).forEach(function (k) { if (k !== '_row') merged[k] = check[k]; });
      Object.keys(f).forEach(function (k) { merged[k] = f[k]; });
      lcWriteObjectRow_(sh, rowNum, merged);
      return { created: false, record: merged, previous: check, now: now };
    }
    throw new Error('Your work could not be saved because the sheet was being reorganized. Please try again.');
  }
  // atomic: rows with more than one writer (the submission and the discussion plan share a row)
  // are read and written under a short class-wide lock, so the two can never interleave.
  return opts.atomic ? lcRowCritical_(run) : run();
}
var LC_GROUP_CHANGED_MSG = 'Your teacher just changed your Literature Circle group, so this save was stopped. Reload the page — your writing is kept on this device and will be offered back.';
/** Short class-wide lock around one row's read + write. Re-entrant inside withLock_. If the lock
 *  can't be had in 15 s (a long teacher tool), the write still goes ahead — it is one re-read and
 *  one write, so the window is tiny — rather than failing a student's save. */
function lcRowCritical_(fn) {
  if (LC_X_.scriptLocked) return fn();
  var lock = null, held = false;
  try { lock = LockService.getScriptLock(); held = lock.tryLock(15000); } catch (e) { held = false; }
  if (held) LC_X_.scriptLocked = true;
  try { return fn(); } finally { if (held) { LC_X_.scriptLocked = false; try { lock.releaseLock(); } catch (e2) {} } }
}

// ---------- Values ----------

function normEmail_(s) { return (s || '').toString().trim().toLowerCase(); }
function lcWeek_(w) { var n = Number(w); if (!(n >= 1 && n <= 4) || Math.floor(n) !== n) throw new Error('Invalid week.'); return n; }
function lcIsoValue_(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  var d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
function lcIsLater_(a, b) { var da = new Date(a || ''), db = new Date(b || ''); return !isNaN(da.getTime()) && !isNaN(db.getTime()) && da.getTime() > db.getTime() + 1000; }

// Google Sheets silently auto-converts typed text that *looks* like a date (e.g. "8/17") into a
// real Date value. A raw Date nested in a google.script.run response makes the browser receive
// NO data at all, so every freeform cell returned to the client goes through this.
function cellToText_(v) {
  if (v instanceof Date) return (v.getMonth() + 1) + '/' + v.getDate() + '/' + v.getFullYear();
  return v || v === 0 ? v.toString() : '';
}

/** Free text a person typed ("7/7", "=)", "10/10 great") must stay text. A leading apostrophe
 *  tells Sheets "this is text" and is not stored as part of the value. */
function lcText_(v) {
  var s = String(v == null ? '' : v);
  if (!s) return '';
  var t = s.trim();
  if (/^[=+\-@']/.test(s) || /^-?[\d.,\s]+%?$/.test(t) || /^(true|false)$/i.test(t) || /^\d{1,4}[\/.\-]\d{1,2}([\/.\-]\d{1,4})?(\s|$)/.test(t) || /^\d{1,2}:\d{2}/.test(t) ||
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i.test(t)) return "'" + s;
  return s;
}

// ---------- Big JSON cells ----------
// A cell stops at 50,000 characters. JSON is split across DataJson..DataJson5 (45,000 each).
// A chunk that doesn't reassemble is reported as unreadable instead of silently becoming {}.
var LC_CHUNK_SIZE = 45000;
var LC_CHUNK_COLS = ['DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5'];
function lcSplitJson_(json) {
  json = String(json || '');
  var parts = [], i = 0;
  while (i < json.length) {
    var end = Math.min(json.length, i + LC_CHUNK_SIZE);
    var code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xD800 && code <= 0xDBFF) end--; // keep an emoji in one piece
    parts.push(json.substring(i, end)); i = end;
  }
  if (parts.length > LC_CHUNK_COLS.length) throw new Error('This response is too long to save (' + Math.round(json.length / 1000) + 'k characters). Please shorten it.');
  var out = {};
  LC_CHUNK_COLS.forEach(function (c, i) { out[c] = parts[i] || ''; });
  // A chunk that starts with "=" or "+" would be read as a formula; JSON never starts a chunk
  // that way except mid-string, so prefix-protect the continuation chunks.
  for (var k = 1; k < LC_CHUNK_COLS.length; k++) if (out[LC_CHUNK_COLS[k]]) out[LC_CHUNK_COLS[k]] = '​' + out[LC_CHUNK_COLS[k]];
  return out;
}
function lcJoinJson_(rec) {
  var s = String(rec.DataJson == null ? '' : rec.DataJson);
  for (var k = 1; k < LC_CHUNK_COLS.length; k++) {
    var part = rec[LC_CHUNK_COLS[k]];
    if (part === '' || part == null) break;
    s += String(part).replace(/^​/, '');
  }
  return s;
}
function lcParseDataRec_(rec) {
  var s = lcJoinJson_(rec);
  if (!s) return {};
  try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; }
  catch (e) { return { _unreadable: true, _chars: s.length }; }
}
function lcParse_(v, fallback) { try { return (v && typeof v === 'object') ? v : JSON.parse(String(v || '')); } catch (e) { return fallback; } }

// ---------- Fingerprints ----------
// "fp:" + length + ":" + first 10 hex of MD5. The prefix stops Sheets reading it as a time.
var LC_BLANK_FP = 'fp:empty';
function lcMd5Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}
function lcStableStringify_(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(lcStableStringify_).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + lcStableStringify_(v[k]); }).join(',') + '}';
  if (typeof v === 'string') return JSON.stringify(v.replace(/\s+/g, ' ').trim());
  return JSON.stringify(v);
}
function lcFingerprint_(text) {
  var t = String(text || '');
  if (!t || t === '{}' || t === '[]') return LC_BLANK_FP;
  return 'fp:' + t.length + ':' + lcMd5Hex_(t).slice(0, 10);
}
/** What the teacher grades in Step 1: the pathway, the chosen strategies and the written work —
 *  not the discussion plan (Step 2) and not bookkeeping fields. */
function lcSubmissionFp_(prepType, choices, data) {
  if (!prepType) return LC_BLANK_FP;
  var d = {};
  Object.keys(data || {}).forEach(function (k) { if (k !== 'discussionPlan' && k.charAt(0) !== '_') d[k] = data[k]; });
  return lcFingerprint_(lcStableStringify_({ p: String(prepType), c: (choices || []).map(String), d: d }));
}
function lcReflectionFp_(answers, goal) {
  var a = answers || {};
  var any = Object.keys(a).some(function (k) { return String(a[k] || '').trim(); }) || String(goal || '').trim();
  if (!any) return LC_BLANK_FP;
  return lcFingerprint_(lcStableStringify_({ a: a, g: String(goal || '') }));
}

// ---------- Identity and locks ----------

var LC_TEACHER_VIEW_MSG = 'Teacher view is read-only: this student\'s work was not changed. (Open a demo student to try saving.)';
function lcCurrentEmail_() { try { return normEmail_(Session.getActiveUser().getEmail()); } catch (e) { return ''; } }

/**
 * Every student call names an email. It must be the signed-in account — except for an active
 * teacher/admin, who may open any student's view (and the demo students). If Google can't tell
 * us who is signed in (outside the school domain), the old behaviour is kept.
 */
function lcActingEmail_(email, write) {
  var e = normEmail_(email);
  if (!e) throw new Error('Missing student email.');
  var session = lcCurrentEmail_();
  if (!session || session === e) return e;
  var u = lcUser_(session);
  if (u && String(u.Status) === 'active' && ['teacher', 'admin'].indexOf(String(u.Role)) >= 0) {
    // A teacher looking at a real student's pages can read them but never save over the student's
    // own work (the student may be writing in their own tab at that moment). Demo students are fine.
    if (write && !lcIsDemoEmail_(e)) throw new Error(LC_TEACHER_VIEW_MSG);
    return e;
  }
  throw new Error('You are signed in as ' + session + ', so you can only open that account\'s Literature Circle. Use "Switch" to go back to your own work.');
}

/** A student's own rows. The lock only stops the same student's two saves from racing; every
 *  write is already one setValues on that student's own row (re-checked just before writing), so
 *  if the lock is busy for a few seconds the save goes ahead rather than failing. */
function lcWithUserLock_(fn) {
  var lock = null, held = false;
  try { lock = LockService.getUserLock(); held = lock.tryLock(6000); } catch (e) { held = false; }
  try { return fn(); } finally { if (held) { try { lock.releaseLock(); } catch (e2) {} } }
}
/** Shared rows (groups, grades, class settings, bulk teacher tools). Kept short. */
function withLock_(fn) {
  if (LC_X_.scriptLocked) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The class sheet is busy — please try again in a moment.');
  LC_X_.scriptLocked = true;
  try { return fn(); } finally { LC_X_.scriptLocked = false; lock.releaseLock(); }
}

// ============================================================================
// STUDENT DATA
// ============================================================================

function groupsSheet_() { return getSheet_(SHEET_NAMES.GROUPS, LC_SHEET_HEADERS.Groups); }
function workSheet_() { return getSheet_(SHEET_NAMES.WORK, LC_SHEET_HEADERS.WeeklyWork); }
function draftSheet_() { return getSheet_(SHEET_NAMES.DRAFTS, LC_SHEET_HEADERS.WeeklyDrafts); }
function peerSheet_() { return getSheet_(SHEET_NAMES.PEER, LC_SHEET_HEADERS.PeerAssessments); }
/** Audit trail of "Start New Book" events — powers the read-only "Past Lit Circles" list. */
function historySheet_() { return getSheet_(SHEET_NAMES.HISTORY, LC_SHEET_HEADERS.BookHistory); }
/** Weeks 1-3 "weekly" reflection + goal; Week 4 "growth" reflection. Same tab, Type column. */
function reflectSheet_() { return getSheet_(SHEET_NAMES.REFLECT, LC_SHEET_HEADERS.Reflections); }
/** Quick rubric-based self-rating completed at the end of Discussion Day. */
function selfAssessSheet_() { return getSheet_(SHEET_NAMES.SELF, LC_SHEET_HEADERS.DiscussionSelfAssessments); }
/** Lightweight navigation state so returning students reopen exactly where they left off. */
function resumeSheet_() { return getSheet_(SHEET_NAMES.RESUME, LC_SHEET_HEADERS.StudentResume); }
/** Half-finished Step 2 plans / Step 4 reflections (saveStepDraft). */
function stepDraftSheet_() { return getSheet_(SHEET_NAMES.STEP, LC_SHEET_HEADERS.StepDrafts); }
/** Earlier copies of student writing (lcBackupPrev_). Rows are only ever appended here. */
function backupSheet_() { return getSheet_(SHEET_NAMES.BACKUP, LC_SHEET_HEADERS.WorkBackups); }
/** Writing-process stats per student / week (saveWritingStats). */
function writingStatsSheet_() { return getSheet_(SHEET_NAMES.WSTATS, LC_SHEET_HEADERS.WritingStats); }

// ---------- Save-safety helpers (stale tabs + backups) ----------

/** The LAST row of `sh` for this student + group + week (+ optional extra keys) — the same row
 *  lcUpsertByKeys_ writes to — or null. Reads only this student's rows. */
function lcOwnRow_(sh, groupId, email, week, extra) {
  var recs = lcReadRows_(sh, lcFindRowNumbers_(sh, 'Email', email)).filter(function (r) {
    if (String(r.GroupId) !== String(groupId) || Number(r.Week) !== Number(week)) return false;
    return Object.keys(extra || {}).every(function (k) { return String(r[k]) === String(extra[k]); });
  });
  return recs.length ? recs[recs.length - 1] : null;
}
/** Later of two ISO times ('' when neither is a time). */
function lcLaterIso_(a, b) {
  a = lcIsoValue_(a); b = lcIsoValue_(b);
  if (!a || isNaN(new Date(a).getTime())) return b && !isNaN(new Date(b).getTime()) ? b : '';
  if (!b || isNaN(new Date(b).getTime())) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
/** When this student's Step 1 for a week was last written by ANY tab or device: the draft row's
 *  UpdatedAt (a submission also stamps it when it empties the draft) or the submission's
 *  SubmittedAt. Saving the discussion plan does not count (it doesn't touch the Step 1 writing). */
function lcStep1WrittenAt_(draftRec, workRec) {
  return lcLaterIso_(draftRec ? draftRec.UpdatedAt : '', workRec ? workRec.SubmittedAt : '');
}
/** True if `base` (the newest server time the student's tab has seen) is older than `at`. */
function lcIsStale_(at, base) { return !!(base && at && lcIsLater_(at, base)); }

/** Does a parsed record contain any actual writing? (Tags, bookkeeping and blank boxes don't count.) */
function lcHasWriting_(v, depth) {
  depth = depth || 0;
  if (depth > 12 || v == null) return false;
  if (typeof v === 'string') return v.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
  if (typeof v !== 'object') return false;
  return Object.keys(v).some(function (k) { return k.charAt(0) !== '_' && !/Tags$/.test(k) && lcHasWriting_(v[k], depth + 1); });
}

/**
 * Keep the previous copy of a student's writing in WorkBackups before it is replaced, when the
 * replacement could lose something. NEVER throws — a backup problem must not fail the save.
 *   kind       'draft' | 'work' | 'plan' | 'reflection' | 'step-plan' | 'step-reflection'
 *   prevJson   the stored text being replaced (raw — it may be unreadable)
 *   nextJson   the text replacing it ('' when it is being emptied)
 *   meta       { email, week, groupId, prepType, prevPrepType, choices }
 *   force      a reason that always backs up ('conflict', 'before-restore', ...)
 * Rules: unreadable old copy → always; new copy under 80% of the old length (or emptied) → always;
 * pathway changed → always; otherwise at most once per student/week/kind every 10 minutes.
 */
function lcBackupPrev_(kind, prevJson, nextJson, meta, force) {
  try {
    prevJson = String(prevJson || '');
    if (!prevJson || prevJson === '{}') return false;
    var parsed = null, unreadable = false;
    try { parsed = JSON.parse(prevJson); } catch (e) { unreadable = true; }
    if (!unreadable && !lcHasWriting_(parsed)) return false;
    meta = meta || {};
    var cacheKey = 'lcbk:' + kind + ':' + normEmail_(meta.email) + ':' + meta.week, cache = null;
    try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
    var reason = force || (unreadable ? 'unreadable' : '');
    if (!reason && String(nextJson || '').length < prevJson.length * 0.8) reason = 'shorter';
    if (!reason && meta.prevPrepType && meta.prepType !== undefined && String(meta.prevPrepType) !== String(meta.prepType || '')) reason = 'pathway';
    if (!reason) { var seen = null; try { seen = cache && cache.get(cacheKey); } catch (e) { seen = null; } if (!seen) reason = 'periodic'; }
    if (!reason) return false;
    var chunks = lcSplitJson_(prevJson);
    var row = { Email: normEmail_(meta.email), Week: Number(meta.week) || '', Kind: kind, SavedAt: new Date(), Reason: reason, Chars: prevJson.length,
      GroupId: meta.groupId || '', PrepType: meta.prevPrepType || '', Choices: meta.choices || '' };
    Object.keys(chunks).forEach(function (k) { row[k] = chunks[k]; });
    lcAppendObject_(backupSheet_(), row);
    try { if (cache) cache.put(cacheKey, '1', 600); } catch (e) {}
    return true;
  } catch (e) {
    try { console.warn('lcBackupPrev_ failed: ' + (e && e.message)); } catch (e2) {}
    return false;
  }
}
/** Backup of a WeeklyWork / WeeklyDrafts row (raw chunks, so an unreadable copy is kept as-is). */
function lcBackupWorkRow_(kind, rec, nextJson, meta, force) {
  if (!rec) return false;
  meta = meta || {}; meta.prevPrepType = String(rec.PrepType || ''); meta.choices = String(rec.Choices || '');
  return lcBackupPrev_(kind, lcJoinJson_(rec), nextJson, meta, force);
}

// ---------- Resume ----------

function getStudentResume_(email) {
  email = normEmail_(email);
  var recs = lcReadRows_(resumeSheet_(), lcFindRowNumbers_(resumeSheet_(), 'Email', email));
  if (!recs.length) return null;
  var r = recs[recs.length - 1];
  return {
    view: String(r.View || 'dashboard'),
    week: Number(r.Week || 1),
    flowStage: String(r.FlowStage || 'pathway'),
    focusIndex: Number(r.FocusIndex || 0),
    hybridMoment: Number(r.HybridMoment || 0),
    updatedAt: lcIsoValue_(r.UpdatedAt),
    markStyle: String(r.MarkStyle || '') === 'fill' ? 'fill' : String(r.MarkStyle || '') === 'underline' ? 'underline' : ''
  };
}

/** 2026-10-29b: how this student wants their strategy marks shown — 'underline' (default) or
 *  'fill' (highlighter). Only the look on their own screens; the writing itself doesn't change. */
function saveStudentMarkStyle(email, style) {
  email = lcActingEmail_(email);
  var sess = lcCurrentEmail_();
  if (sess && sess !== email && !lcIsDemoEmail_(email)) return { ok: true, skipped: true }; // a teacher viewing doesn't change the student's setting
  var v = String(style) === 'fill' ? 'fill' : 'underline';
  return lcWithUserLock_(function () {
    lcUpsertByKeys_(resumeSheet_(), 'Email', { Email: email }, { MarkStyle: v });
    return { ok: true, markStyle: v };
  });
}

function saveStudentResume(email, resumeObj) {
  email = lcActingEmail_(email);
  var sess = lcCurrentEmail_();
  if (sess && sess !== email && !lcIsDemoEmail_(email)) return { ok: true, skipped: true }; // a teacher's viewing never moves the student's place
  return lcWithUserLock_(function () {
    resumeObj = resumeObj || {};
    var allowed = ['dashboard', 'week', 'week_strategies', 'week_plan', 'week_peer', 'week_reflection', 'feedback', 'growth'];
    var view = allowed.indexOf(String(resumeObj.view || '')) >= 0 ? String(resumeObj.view) : 'dashboard';
    var week = Math.max(1, Math.min(4, Number(resumeObj.week || 1)));
    var stage = ['pathway', 'picker', 'rubric', 'workspace'].indexOf(String(resumeObj.flowStage || '')) >= 0 ? String(resumeObj.flowStage) : 'pathway';
    var focus = Math.max(0, Number(resumeObj.focusIndex || 0));
    var hybrid = Math.max(0, Math.min(2, Number(resumeObj.hybridMoment || 0)));
    lcUpsertByKeys_(resumeSheet_(), 'Email', { Email: email }, { View: view, Week: week, FlowStage: stage, FocusIndex: focus, HybridMoment: hybrid, UpdatedAt: new Date() });
    return { ok: true };
  });
}
/** Send a student back to their home screen next time (used instead of deleting rows). */
function lcResetResume_(email) {
  lcUpsertByKeys_(resumeSheet_(), 'Email', { Email: normEmail_(email) }, { View: 'dashboard', Week: 1, FlowStage: 'pathway', FocusIndex: 0, HybridMoment: 0, UpdatedAt: new Date() });
}

// ---------- Groups ----------

function rowToGroup_(row) {
  return {
    groupId: row[0],
    bookTitle: cellToText_(row[1]),
    memberEmails: (row[2] || '').toString().split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    weekReading: [cellToText_(row[3]), cellToText_(row[4]), cellToText_(row[5]), cellToText_(row[6])],
    createdAt: row[7] instanceof Date ? row[7].toISOString() : (row[7] ? row[7].toString() : '')
  };
}
/** The Groups tab is small (one row per group), so it is read once per call and cached. */
function lcGroupRows_() {
  if (!LC_X_.groupRows) {
    var sh = groupsSheet_(), last = sh.getLastRow();
    LC_X_.groupRows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 8).getValues().map(function (r, i) { return { row: i + 2, values: r }; });
  }
  return LC_X_.groupRows;
}
function lcInvalidateGroups_() { LC_X_.groupRows = null; }
function findGroupByEmail_(email) {
  email = normEmail_(email);
  var rows = lcGroupRows_();
  for (var i = 0; i < rows.length; i++) {
    var members = (rows[i].values[2] || '').toString().split(',').map(function (s) { return normEmail_(s); });
    if (members.indexOf(email) !== -1) return rowToGroup_(rows[i].values);
  }
  return null;
}

/** Read-only list of a student's archived (finished) books, most recent first. */
function getBookHistory_(email) {
  email = normEmail_(email);
  var recs = lcReadRows_(historySheet_(), lcFindRowNumbers_(historySheet_(), 'Email', email));
  return recs.map(function (r) {
    return { groupId: String(r.OldGroupId || ''), bookTitle: cellToText_(r.OldBookTitle), archivedAt: lcIsoValue_(r.ArchivedAt) };
  }).reverse();
}

// ---------- Whole student state ----------

function lcWorkFromRec_(rec) {
  var data = lcParseDataRec_(rec);
  var out = {
    prepType: String(rec.PrepType || ''),
    choices: rec.Choices ? rec.Choices.toString().split(',') : [],
    data: data,
    updatedAt: lcIsoValue_(rec.UpdatedAt)
  };
  // WeeklyWork only: when the Step 1 writing was submitted / the plan was saved (UpdatedAt moves
  // for both). The browser uses these to show whichever of draft and submission is newer.
  if (rec.SubmittedAt) out.submittedAt = lcIsoValue_(rec.SubmittedAt);
  if (rec.PlanUpdatedAt) out.planUpdatedAt = lcIsoValue_(rec.PlanUpdatedAt);
  if (data._unreadable) out.unreadable = true;
  return out;
}
/** Reflection answers, or { unreadable: true } when the stored Answers can't be parsed. */
function lcReflectionAnswers_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return { answers: {} };
  try { var o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) return { answers: o }; } catch (e) {}
  return { answers: {}, unreadable: true };
}

/** Client entry point: everything the student app needs, read from ONLY this student's rows. */
function getState(email) {
  try {
    email = lcActingEmail_(email);
    var group = findGroupByEmail_(email);
    var result = {
      email: email, group: group, weeklyWork: {}, weeklyDrafts: {}, peerAssessmentsGiven: [],
      pastBooks: getBookHistory_(email), reflections: {}, selfAssessments: {}, peerFeedbackReceived: {}, resume: getStudentResume_(email),
      // Server time of this read: the browser sends it back as `base` with each save, so a save
      // from a tab that hasn't seen newer work (another tab / device) is refused, not applied.
      // (1.5 s early, so a save landing at the very moment of this read is never mistaken as seen)
      loadedAt: new Date(Date.now() - 1500).toISOString(),
      stepDrafts: {},
      plan: lcStudentPlan_(email, group)
    };
    // 2026-10-29a: the page asks a student for their first and last name until they give it
    // (only for the student themself, never when a teacher opens their pages).
    if (normEmail_(lcCurrentEmail_()) === email && lcNeedsName_(email)) { result.needsName = true; result.nameSuggest = lcNameSuggestion_(email); }
    if (group) {
      var gid = String(group.groupId);
      function mine(sh, header) { return lcReadRows_(sh, lcFindRowNumbers_(sh, header, email)).filter(function (r) { return String(r.GroupId) === gid; }); }

      mine(workSheet_(), 'Email').forEach(function (r) { result.weeklyWork[Number(r.Week)] = lcWorkFromRec_(r); });
      mine(draftSheet_(), 'Email').forEach(function (r) {
        if (!r.PrepType && !lcJoinJson_(r)) return; // a draft cleared by a submission
        result.weeklyDrafts[Number(r.Week)] = lcWorkFromRec_(r);
      });

      // Peer ratings this student GAVE (full detail, for their PDF), and ratings they RECEIVED
      // (assessor identity is intentionally left out to keep feedback low-stakes).
      var given = {}, received = {};
      // every cell goes through cellToText_: a comment like "5/5" is stored by Sheets as a Date,
      // and one Date anywhere in this response would blank the whole app for the student
      function peerRec(p) {
        return {
          participation: cellToText_(p.Participation), participationComment: cellToText_(p.ParticipationComment),
          leadership: cellToText_(p.Leadership), leadershipComment: cellToText_(p.LeadershipComment),
          activeEngagement: cellToText_(p.ActiveEngagement), activeEngagementComment: cellToText_(p.ActiveEngagementComment)
        };
      }
      mine(peerSheet_(), 'AssessorEmail').forEach(function (p) {
        var r = peerRec(p); r.week = Number(p.Week); r.assessedEmail = normEmail_(p.AssessedEmail);
        given[String(p.Week) + '|' + normEmail_(p.AssessedEmail)] = r;
      });
      mine(peerSheet_(), 'AssessedEmail').forEach(function (p) {
        var r = peerRec(p); r.week = Number(p.Week);
        received[String(p.Week) + '|' + normEmail_(p.AssessorEmail)] = r;
      });
      result.peerAssessmentsGiven = Object.keys(given).map(function (k) { return given[k]; });
      Object.keys(received).forEach(function (k) {
        var fb = received[k], wk = fb.week; delete fb.week;
        (result.peerFeedbackReceived[wk] = result.peerFeedbackReceived[wk] || []).push(fb);
      });

      mine(selfAssessSheet_(), 'Email').forEach(function (r) {
        result.selfAssessments[Number(r.Week)] = {
          participation: String(r.Participation || ''), leadership: String(r.Leadership || ''),
          activeEngagement: String(r.ActiveEngagement || ''), updatedAt: lcIsoValue_(r.SubmittedAt)
        };
      });
      mine(reflectSheet_(), 'Email').forEach(function (r) {
        var ans = lcReflectionAnswers_(lcReflRaw_(r));
        result.reflections[Number(r.Week)] = {
          type: String(r.Type || ''), answers: ans.answers, goal: cellToText_(r.Goal), updatedAt: lcIsoValue_(r.SubmittedAt)
        };
        if (ans.unreadable) result.reflections[Number(r.Week)].unreadable = true;
      });
      // Half-finished Step 2 / Step 4 writing (blank rows = already saved for real).
      mine(stepDraftSheet_(), 'Email').forEach(function (r) {
        var kind = String(r.Kind || ''), s = lcJoinJson_(r);
        if (!s || (kind !== 'plan' && kind !== 'reflection')) return;
        var wk = Number(r.Week), entry = { updatedAt: lcIsoValue_(r.UpdatedAt) };
        try { entry.data = JSON.parse(s); } catch (e) { entry.unreadable = true; }
        (result.stepDrafts[wk] = result.stepDrafts[wk] || {})[kind] = entry;
      });
      // Writing-process stats, so the counts carry on where they left off. Never blocks the load.
      try { result.writingStats = lcWritingStatsFor_(email, gid); } catch (e) { result.writingStats = {}; }
      // Reading Quiz: which weeks have an approved quiz and how far this student got (never the questions)
      result.quizzes = lcQuizStudentSummary_(email, group);
    }
    // Who in the group was away for each week's Discussion Day. Never blocks the load.
    try { result.discussionAway = group ? lcAwayForGroup_(group.groupId) : {}; } catch (e) { result.discussionAway = {}; }
    // Scores and comments from the teacher, once they are in Canvas. Never blocks the load.
    try { result.teacherFeedback = lcStudentTeacherFeedback_(email); } catch (e) { result.teacherFeedback = {}; }
    return result;
  } catch (e) {
    // Keep the original message, prefixed so it is traceable if it reaches the error banner.
    throw new Error('getState: ' + (e && e.message ? e.message : e));
  }
}

/** Create or update the calling student's group (book + teammates + 4 reading ranges). */
/** Book titles compare loosely: "the hobbit" = "The Hobbit" = "Hobbit, The". */
function lcBookKey_(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '').replace(/ (the|a|an)$/, ''); }
function lcNamesOf_(emails) {
  var names = {}; try { lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (x) { if (x.StudentName) names[normEmail_(x.StudentEmail)] = String(x.StudentName); }); } catch (e) {}
  return (emails || []).map(function (e) { e = normEmail_(e); return names[e] || lcNameFromEmail_(e); }).join(', ');
}

/**
 * Create or update the calling student's group (book + teammates + 4 reading ranges).
 * Only ONE student needs to do this; the others are added by email. So:
 *  - A student whose page shows the setup form but who was ALREADY added by a teammate (their page
 *    loaded before that) is never allowed to rewrite that group: they simply join it.
 *  - A student setting up a new group who lists a teammate already in a group for the SAME book joins
 *    that group (with any listed classmates who have no group yet) instead of getting an error.
 *  - A tab that loaded the group earlier (Edit Book / Group Setup) only applies ITS changes.
 * The reply is the new state; `notice` (when present) tells the student what happened.
 */
function saveGroupSetup(email, bookTitle, memberEmailsCsv, weekReadingArr, baseMembersCsv) {
  email = lcActingEmail_(email, true);
  var notice = '';
  withLock_(function () {
    function list(csv) { return String(csv || '').split(/[,;\s]+/).map(function (s) { return normEmail_(s); }).filter(function (s) { return /^[^=+\-@'"\s<>,][^@\s<>",]*@[^@\s<>"',]+\.[^@\s<>"',]+$/.test(s); }); }
    var members = list(memberEmailsCsv);
    if (members.indexOf(email) === -1) members.push(email);
    var seen = {}; members = members.filter(function (m) { if (seen[m]) return false; seen[m] = true; return true; });
    var reading = (weekReadingArr || []).slice(0, 4).map(function (x) { return String(x == null ? '' : x).slice(0, 2000); });
    while (reading.length < 4) reading.push('');
    bookTitle = String(bookTitle || '').slice(0, 500);
    // One book for the class (Unit setup): its title and sections, whatever the page sent.
    var splan = lcStudentPlanClass_(email).plan;
    if (lcPlanSingle_(splan)) { bookTitle = splan.book.title; reading = splan.book.reading.slice(); }
    lcInvalidateGroups_();
    var existing = findGroupByEmail_(email), sh = groupsSheet_();

    // 1. Already added by a teammate while this page showed the setup form: join, change nothing.
    if (existing && typeof baseMembersCsv !== 'string') {
      var others = existing.memberEmails.map(normEmail_).filter(function (m) { return m !== email; });
      notice = 'Your group was already set up' + (others.length ? ' by ' + lcNamesOf_(others) : '') + ' — "' + (existing.bookTitle || 'your book') + '". You\'re in it. (To add or remove anyone, use Edit Book / Group Setup on your home page.)';
      return;
    }

    // 2. A new group that names a classmate who already has a group for the same book: join that one.
    if (!existing) {
      var joinTo = null, clash = null;
      members.forEach(function (m) {
        if (m === email || joinTo) return;
        var other = findGroupByEmail_(m);
        if (!other) return;
        if (lcBookKey_(other.bookTitle) === lcBookKey_(bookTitle)) joinTo = other; else if (!clash) clash = { email: m, group: other };
      });
      if (joinTo) {
        var cur = joinTo.memberEmails.map(normEmail_), addedNames = [];
        members.forEach(function (m) { if (cur.indexOf(m) < 0 && (m === email || !findGroupByEmail_(m))) { cur.push(m); if (m !== email) addedNames.push(m); } });
        lcSetGroupMembersById_(joinTo.groupId, cur);
        notice = 'A teammate had already set up your group for "' + (joinTo.bookTitle || bookTitle) + '", so you joined it' + (addedNames.length ? ' (and added ' + lcNamesOf_(addedNames) + ')' : '') + '. The reading schedule is the one your group already chose.';
        return;
      }
      if (clash) {
        throw new Error(lcNamesOf_([clash.email]) + ' (' + clash.email + ') is already in a group reading "' + (clash.group.bookTitle || 'another book') + '" with ' + (lcNamesOf_(clash.group.memberEmails.map(normEmail_).filter(function (m) { return m !== clash.email; })) || 'no one else yet') + '. Only one person sets up a group. If that\'s your group, ask them to add your email — or check the book title. Otherwise take their email out.');
      }
    }

    // 3. Editing an existing group from a tab that loaded it: apply only this tab's changes.
    if (existing && typeof baseMembersCsv === 'string') {
      var base = list(baseMembersCsv), curM = existing.memberEmails.map(normEmail_);
      var added = members.filter(function (m) { return base.indexOf(m) < 0; }), removed = base.filter(function (m) { return members.indexOf(m) < 0 && m !== email; });
      members = curM.filter(function (m) { return removed.indexOf(m) < 0; });
      added.forEach(function (m) { if (members.indexOf(m) < 0) members.push(m); });
      if (members.indexOf(email) === -1) members.push(email);
    }
    // A classmate who already belongs to another group can't be pulled in from here: their work is
    // filed under that group and would silently disappear from their view.
    members.forEach(function (m) {
      if (m === email) return;
      var other = findGroupByEmail_(m);
      if (other && (!existing || String(other.groupId) !== String(existing.groupId))) {
        throw new Error(lcNamesOf_([m]) + ' (' + m + ') is already in another group, reading "' + (other.bookTitle || 'another book') + '". Take their email out, or ask your teacher to move them.');
      }
    });
    // Teammates taken OUT of the group keep their work: it is logged as an archived book they (and
    // the teacher's restore tool) can find, instead of being left with no group at all.
    if (existing) {
      existing.memberEmails.map(normEmail_).forEach(function (m) {
        if (m && m !== email && members.indexOf(m) < 0) lcArchiveIfMissing_(m, existing);
      });
    }
    // Book title + reading ranges are forced to plain text so "8/17" can't become a Date.
    if (existing) {
      var rec = lcGroupRows_().filter(function (g) { return String(g.values[0]) === String(existing.groupId); })[0];
      if (rec) {
        sh.getRange(rec.row, 2, 1, 6).setNumberFormat('@');
        sh.getRange(rec.row, 2, 1, 6).setValues([[String(bookTitle || '').replace(/^'/, ''), members.join(','), reading[0], reading[1], reading[2], reading[3]]]);
      }
    } else {
      var newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 2, 1, 6).setNumberFormat('@');
      sh.getRange(newRow, 1, 1, 8).setValues([[Utilities.getUuid(), String(bookTitle || ''), members.join(','), reading[0], reading[1], reading[2], reading[3], new Date()]]);
    }
    lcInvalidateGroups_();
  });
  var out = getState(email);
  if (notice) out.notice = notice;
  return out;
}

/**
 * Student-initiated "Start New Book": removes this student from their current group (their
 * groupmates keep full access) and logs the old book. All work is keyed by GroupId, and the
 * next saveGroupSetup always creates a new GroupId, so old responses can't carry over.
 */
function startNewBook(email) {
  email = lcActingEmail_(email, true);
  withLock_(function () {
    var group = findGroupByEmail_(email);
    if (!group) throw new Error('You don\'t have an active book to archive yet.');
    var rec = lcGroupRows_().filter(function (g) { return String(g.values[0]) === String(group.groupId); })[0];
    if (rec) {
      var remaining = (rec.values[2] || '').toString().split(',').map(function (s) { return s.trim(); }).filter(function (m) { return m && normEmail_(m) !== email; });
      groupsSheet_().getRange(rec.row, 3).setValue(remaining.join(','));
    }
    historySheet_().appendRow([email, group.groupId, group.bookTitle, new Date()]);
    // A new book is a new journey: point the resume marker home (rows are never deleted here).
    lcResetResume_(email);
    lcInvalidateGroups_();
  });
  return getState(email);
}

// ---------- Weekly prep work ----------

function lcRequireGroup_(email) {
  var group = findGroupByEmail_(email);
  if (!group) throw new Error('Set up your group first.');
  return group;
}

/** Background autosave target. Drafts live apart from submissions so half-finished work never
 *  looks submitted on the teacher dashboard.
 *  base (optional, from SaveGuard): the newest server time the student's tab has seen for this
 *  week's Step 1. If another tab or device wrote after that, nothing is written and the reply is
 *  { ok:false, stale:true, serverAt } so the tab can ask the student which copy to keep. Callers
 *  that don't send base (older pages) keep the old last-write-wins behaviour. */
function saveWeeklyDraft(email, week, prepType, choicesArr, dataObj, base) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email), dsh = draftSheet_();
    prepType = 'strategies'; choicesArr = lcChoicesFor_(group, email, week, choicesArr); // always two strategies, from the class's Unit setup
    var json = JSON.stringify(dataObj || {});
    var chunks = lcSplitJson_(json); // "too long" is refused here, before anything is written
    var meta = { email: email, week: week, groupId: group.groupId, prepType: prepType || '' };
    var drec = lcOwnRow_(dsh, group.groupId, email, week);
    if (base) {
      var wrec = lcOwnRow_(workSheet_(), group.groupId, email, week);
      var at = lcStep1WrittenAt_(drec, wrec);
      if (lcIsStale_(at, base)) {
        // keep the newer copy safe too, whichever version the student ends up choosing
        if (drec && lcJoinJson_(drec)) lcBackupWorkRow_('draft', drec, '', meta, 'conflict');
        else if (wrec) lcBackupWorkRow_('work', wrec, '', meta, 'conflict');
        return { ok: false, stale: true, serverAt: at };
      }
    }
    lcBackupWorkRow_('draft', drec, json, meta);
    var res = lcUpsertByKeys_(dsh, 'Email', { GroupId: group.groupId, Email: email, Week: week }, function (rec, now) {
      var fields = { PrepType: prepType || '', Choices: (choicesArr || []).join(','), UpdatedAt: now };
      Object.keys(chunks).forEach(function (k) { fields[k] = chunks[k]; });
      return fields;
    });
    return { ok: true, savedAt: res.now.toISOString() };
  });
}

/** After a submission the draft is emptied in place (never deleted, so no row ever shifts under
 *  another student's save). `now` is the submission time, so the tab's next base matches. */
function clearWeeklyDraft_(groupId, email, week, now, nextJson) {
  var drec = lcOwnRow_(draftSheet_(), groupId, normEmail_(email), Number(week));
  if (!drec) return;
  if (lcJoinJson_(drec)) lcBackupWorkRow_('draft', drec, nextJson || '', { email: email, week: week, groupId: groupId });
  var blank = { PrepType: '', Choices: '', UpdatedAt: now || new Date() };
  LC_CHUNK_COLS.forEach(function (c) { blank[c] = ''; });
  lcUpsertByKeys_(draftSheet_(), 'Email', { GroupId: groupId, Email: normEmail_(email), Week: Number(week) }, blank, { noCreate: true });
}

function lcDiscussionPlanComplete_(plan) {
  if (!plan || typeof plan !== 'object') return false;
  var required = ['focus', 'evidence', 'question1', 'question2', 'open', 'explore', 'deepen', 'close'];
  return required.every(function (k) { return String(plan[k] || '').trim().length > 0; });
}

/** Step 1 submission. base: as saveWeeklyDraft — a submission from a tab that hasn't seen newer
 *  work is refused with { ok:false, stale:true } instead of replacing it (and emptying the draft).
 *  The check and the write happen under one short lock, together with the discussion plan (which
 *  shares this row), so neither can ever write back an older copy of the other. */
function saveWeeklyWork(email, week, prepType, choicesArr, dataObj, base) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email), sh = workSheet_();
    prepType = 'strategies'; choicesArr = lcChoicesFor_(group, email, week, choicesArr); // always two strategies, from the class's Unit setup
    var incoming = dataObj && typeof dataObj === 'object' ? dataObj : {};
    var choices = (choicesArr || []).map(String);
    var meta = { email: email, week: week, groupId: group.groupId, prepType: prepType || '' };
    lcSplitJson_(JSON.stringify(incoming)); // refuse "too long" before anything else happens
    return lcRowCritical_(function () {
      var drec = lcOwnRow_(draftSheet_(), group.groupId, email, week);
      if (base) {
        var prevRec0 = lcOwnRow_(sh, group.groupId, email, week);
        var at = lcStep1WrittenAt_(drec, prevRec0);
        if (lcIsStale_(at, base)) {
          if (drec && lcJoinJson_(drec)) lcBackupWorkRow_('draft', drec, '', meta, 'conflict');
          else if (prevRec0) lcBackupWorkRow_('work', prevRec0, '', meta, 'conflict');
          return { ok: false, stale: true, serverAt: at };
        }
      }
      var json = '';
      var res = lcUpsertByKeys_(sh, 'Email', { GroupId: group.groupId, Email: email, Week: week }, function (prevRec, now) {
        var prev = prevRec ? lcParseDataRec_(prevRec) : {};
        if (prev._unreadable) prev = {};
        // The plan is saved only by saveDiscussionPlan, so the stored plan is always the newest one —
        // it wins over whatever copy the submitting tab happens to carry (a stale tab's would be older).
        if (prev.discussionPlan) incoming.discussionPlan = prev.discussionPlan;
        incoming._submissionUpdatedAt = now.toISOString();
        json = JSON.stringify(incoming);
        var chunks = lcSplitJson_(json);
        lcBackupWorkRow_('work', prevRec, json, meta); // unreadable / much shorter / new pathway / every 10 min
        var fields = {
          PrepType: prepType || '', Choices: choices.join(','), UpdatedAt: now,
          SubmissionFp: lcSubmissionFp_(prepType, choices, incoming), SubmittedAt: now.toISOString(),
          PlanComplete: lcDiscussionPlanComplete_(incoming.discussionPlan)
        };
        Object.keys(chunks).forEach(function (k) { fields[k] = chunks[k]; });
        return fields;
      }, { atomic: true, groupOf: email });
      clearWeeklyDraft_(group.groupId, email, week, res.now, json);
      return { ok: true, savedAt: res.now.toISOString() };
    });
  });
}

/** Save the 5-minute discussion plan without overwriting the Lit Circle submission.
 *  base (optional): refused as { ok:false, stale:true } when another tab or device saved this plan
 *  (or a half-finished copy of it) after this tab last saw it. */
function saveDiscussionPlan(email, week, planObj, base) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email), sh = workSheet_();
    var nextPlan = planObj && typeof planObj === 'object' ? planObj : {};
    var meta = { email: email, week: week, groupId: group.groupId };
    return lcRowCritical_(function () {
      if (base) {
        var w0 = lcOwnRow_(sh, group.groupId, email, week), sd0 = lcOwnRow_(stepDraftSheet_(), group.groupId, email, week, { Kind: 'plan' });
        var at = lcLaterIso_(w0 ? w0.PlanUpdatedAt : '', sd0 && lcJoinJson_(sd0) ? sd0.UpdatedAt : '');
        if (lcIsStale_(at, base)) {
          var cur0 = w0 ? lcParseDataRec_(w0) : {};
          if (cur0.discussionPlan) lcBackupPrev_('plan', JSON.stringify(cur0.discussionPlan), '', meta, 'conflict');
          return { ok: false, stale: true, serverAt: at };
        }
      }
      var res = lcUpsertByKeys_(sh, 'Email', { GroupId: group.groupId, Email: email, Week: week }, function (rec, now) {
        var current = rec ? lcParseDataRec_(rec) : {};
        if (current._unreadable) {
          lcBackupWorkRow_('work', rec, '', meta, 'unreadable');
          throw new Error('Your saved Week ' + week + ' work could not be read, so the plan was not saved over it. Please tell your teacher.');
        }
        if (current.discussionPlan) lcBackupPrev_('plan', JSON.stringify(current.discussionPlan), JSON.stringify(nextPlan), meta);
        current.discussionPlan = nextPlan;
        var chunks = lcSplitJson_(JSON.stringify(current));
        var fields = { PlanComplete: lcDiscussionPlanComplete_(current.discussionPlan), PlanUpdatedAt: now.toISOString(), UpdatedAt: now };
        Object.keys(chunks).forEach(function (k) { fields[k] = chunks[k]; });
        if (!rec) { fields.PrepType = ''; fields.Choices = ''; fields.SubmissionFp = LC_BLANK_FP; }
        return fields;
      }, { atomic: true, groupOf: email });
      lcClearStepDraft_(group.groupId, email, week, 'plan', res.now); // the half-finished copy is now the real one
      return { ok: true, savedAt: res.now.toISOString() };
    });
  });
}

// ---------- Half-finished Step 2 plans / Step 4 reflections ----------

/**
 * Background save of what a student has typed into the Step 2 plan or the Step 4 reflection,
 * before it is complete enough for the real Save button. kind: 'plan' | 'reflection'. data: the
 * fields as typed. base (optional): refused as { ok:false, stale:true } if another tab or device
 * saved this step after it. Teachers and the grading screens never read this tab.
 */
function saveStepDraft(email, week, kind, data, base) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  kind = String(kind || '');
  if (kind !== 'plan' && kind !== 'reflection') throw new Error('Invalid draft.');
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email), sh = stepDraftSheet_();
    var json = JSON.stringify(data && typeof data === 'object' ? data : {});
    var chunks = lcSplitJson_(json);
    var prev = lcOwnRow_(sh, group.groupId, email, week, { Kind: kind });
    if (base) {
      // stale if this step's half-finished copy OR its real saved copy is newer than this tab
      var finalAt = '';
      if (kind === 'plan') { var w = lcOwnRow_(workSheet_(), group.groupId, email, week); finalAt = w ? lcIsoValue_(w.PlanUpdatedAt) : ''; }
      else { var r = lcOwnRow_(reflectSheet_(), group.groupId, email, week); finalAt = r ? lcIsoValue_(r.SubmittedAt) : ''; }
      var at = lcLaterIso_(prev ? prev.UpdatedAt : '', finalAt);
      if (lcIsStale_(at, base)) {
        if (prev && lcJoinJson_(prev)) lcBackupPrev_('step-' + kind, lcJoinJson_(prev), '', { email: email, week: week, groupId: group.groupId }, 'conflict');
        return { ok: false, stale: true, serverAt: at };
      }
    }
    if (prev) lcBackupPrev_('step-' + kind, lcJoinJson_(prev), json, { email: email, week: week, groupId: group.groupId });
    var res = lcUpsertByKeys_(sh, 'Email', { Email: email, Week: week, Kind: kind, GroupId: group.groupId }, function (rec, now) {
      var fields = { UpdatedAt: now };
      Object.keys(chunks).forEach(function (k) { fields[k] = chunks[k]; });
      return fields;
    });
    return { ok: true, savedAt: res.now.toISOString() };
  });
}
/** Blank (never delete) a step draft once the real save has happened. */
function lcClearStepDraft_(groupId, email, week, kind, now) {
  try {
    var blank = { UpdatedAt: now || new Date() };
    LC_CHUNK_COLS.forEach(function (c) { blank[c] = ''; });
    lcUpsertByKeys_(stepDraftSheet_(), 'Email', { Email: normEmail_(email), Week: Number(week), Kind: kind, GroupId: groupId }, blank, { noCreate: true });
  } catch (e) {} // the real save already succeeded; a leftover draft only shows the same writing again
}

/** A copy a student's tab chose NOT to keep ("Load newer", "Dismiss", an older copy found on the
 *  device) is filed in WorkBackups, so the teacher can always bring it back. Never throws. */
function keepWorkCopy(email, week, kind, data) {
  try {
    email = lcActingEmail_(email, true); week = lcWeek_(week);
    kind = ['draft', 'plan', 'reflection', 'step-plan', 'step-reflection', 'peer'].indexOf(String(kind)) >= 0 ? String(kind) : 'draft';
    data = data && typeof data === 'object' ? data : {};
    // a Step 1 copy arrives as { prepType, choices, data }: file it the way Step 1 rows are kept
    var isStep1 = kind === 'draft' && data.data && typeof data.data === 'object';
    var json = JSON.stringify(isStep1 ? data.data : data);
    if (json.length > 230000) return { ok: false };
    var group = findGroupByEmail_(email);
    lcBackupPrev_(kind, json, '', { email: email, week: week, groupId: group ? group.groupId : '', prevPrepType: isStep1 ? String(data.prepType || '') : '', choices: isStep1 && data.choices ? [].concat(data.choices).join(',') : '' }, 'not-kept-on-device');
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

// ---------- Peer assessment ----------

function getGroupmates(email) {
  email = lcActingEmail_(email);
  var group = findGroupByEmail_(email);
  if (!group) return [];
  return group.memberEmails.filter(function (m) { return normEmail_(m) !== email; });
}

var LC_RATING_VALUES = ['5', '4', '3', '1'];
/**
 * ratings  = { participation: '5', leadership: '4', activeEngagement: '3' } (string point values)
 * comments = { participation: '...', leadership: '...', activeEngagement: '...' }
 */
function submitPeerAssessment(assessorEmail, assessedEmail, week, ratings, comments) {
  assessorEmail = lcActingEmail_(assessorEmail, true); assessedEmail = normEmail_(assessedEmail); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(assessorEmail);
    var mates = group.memberEmails.map(normEmail_);
    if (mates.indexOf(assessedEmail) < 0 || assessedEmail === assessorEmail) throw new Error('You can only rate members of your own Literature Circle group.');
    ratings = ratings || {}; comments = comments || {};
    ['participation', 'leadership', 'activeEngagement'].forEach(function (k) {
      if (LC_RATING_VALUES.indexOf(String(ratings[k] || '')) < 0) throw new Error('Please choose a rating for every part of the rubric.');
    });
    var next = { participation: String(comments.participation || ''), leadership: String(comments.leadership || ''), activeEngagement: String(comments.activeEngagement || '') };
    lcUpsertByKeys_(peerSheet_(), 'AssessorEmail', { GroupId: group.groupId, Week: week, AssessorEmail: assessorEmail, AssessedEmail: assessedEmail }, function (rec, now) {
      if (rec) { // keep the comments being replaced
        var old = { assessed: assessedEmail, participation: cellToText_(rec.ParticipationComment), leadership: cellToText_(rec.LeadershipComment), activeEngagement: cellToText_(rec.ActiveEngagementComment) };
        if ((old.participation + old.leadership + old.activeEngagement).trim()) lcBackupPrev_('peer', JSON.stringify(old), JSON.stringify(next), { email: assessorEmail, week: week, groupId: group.groupId });
      }
      return {
        Participation: String(ratings.participation), ParticipationComment: next.participation,
        Leadership: String(ratings.leadership), LeadershipComment: next.leadership,
        ActiveEngagement: String(ratings.activeEngagement), ActiveEngagementComment: next.activeEngagement,
        SubmittedAt: now
      };
    });
    // Rating a groupmate means they were there: a "away" mark on this student for the week is lifted.
    try { if ((lcAwayForGroup_(group.groupId)[week] || {})[assessorEmail]) lcSetAway_(group.groupId, week, assessorEmail, false, assessorEmail); } catch (eAway) {}
    // Peer feedback stays in the app: the assessed student sees it in My Peer Feedback.
    return { ok: true };
  });
}

// ---------- Away on Discussion Day (2026-10-22b) ----------
// A student rating their group can mark a groupmate "Not here today". That groupmate no longer
// has to be rated (so the rater can go on to the self-rating and reflection), and the student who
// was away is EXCUSED from the Step 3 peer grade (lcEvalStage_ -> excluded -> Canvas EXCUSED),
// skips the self-rating, and gets reflection questions that don't depend on group feedback.
// The away student can say "I was there" (or just rate their group) to lift it; so can the teacher.
/** { week: { email: { by, at } } } for students currently marked away in this group. */
function lcAwayForGroup_(groupId) {
  var sh = awaySheet_(), out = {};
  lcReadRows_(sh, lcFindRowNumbers_(sh, 'GroupId', String(groupId))).forEach(function (r) {
    if (String(r.GroupId) !== String(groupId)) return;
    var w = Number(r.Week), em = normEmail_(r.Email); if (!(w >= 1 && w <= 4) || !em) return;
    var on = lcTruth_(r.Away);
    out[w] = out[w] || {};
    if (on) out[w][em] = { by: normEmail_(r.MarkedBy), at: lcIsoValue_(r.MarkedAt) }; else delete out[w][em];
  });
  return out;
}
function lcSetAway_(groupId, week, email, away, by) {
  withLock_(function () {
    lcUpsertByKeys_(awaySheet_(), 'Email', { GroupId: String(groupId), Week: week, Email: email }, { Away: !!away, MarkedBy: by, MarkedAt: new Date() });
  });
}
/** Student page: mark a groupmate away (or not), or say "I was there" (self, away=false only). */
function setDiscussionAway(email, week, mateEmail, away) {
  email = lcActingEmail_(email, true); week = lcWeek_(week); mateEmail = normEmail_(mateEmail); away = !!away;
  var group = lcRequireGroup_(email), members = group.memberEmails.map(normEmail_);
  if (members.indexOf(mateEmail) < 0) throw new Error('You can only mark members of your own Literature Circle group.');
  if (mateEmail === email && away) throw new Error('Your groupmates or your teacher mark who was away.');
  lcSetAway_(group.groupId, week, mateEmail, away, email);
  return { ok: true, week: week, away: lcAwayForGroup_(group.groupId)[week] || {} };
}
/** Teacher marking screen: mark a student away for a week's Discussion Day, or lift it. */
function setLiteratureDiscussionAway(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), email = normEmail_(payload.studentEmail), week = lcWeek_(payload.week || 1);
  var t = lcRequireClass_(id);
  if (!lcIsEnrolled_(id, email)) throw new Error('Student is not enrolled in this class.');
  var group = findGroupByEmail_(email); if (!group) throw new Error('This student isn’t in a group yet.');
  lcSetAway_(group.groupId, week, email, !!payload.away, t.email);
  return { ok: true, away: !!payload.away };
}

// ---------- Discussion-day rubric self-assessment ----------

function saveDiscussionSelfAssessment(email, week, ratings) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email);
    ratings = ratings || {};
    ['participation', 'leadership', 'activeEngagement'].forEach(function (k) {
      if (LC_RATING_VALUES.indexOf(String(ratings[k] || '')) < 0) throw new Error('Please complete all three self-ratings.');
    });
    lcUpsertByKeys_(selfAssessSheet_(), 'Email', { GroupId: group.groupId, Email: email, Week: week }, {
      Participation: String(ratings.participation), Leadership: String(ratings.leadership), ActiveEngagement: String(ratings.activeEngagement), SubmittedAt: new Date()
    });
    return { ok: true };
  });
}

// ---------- Reflection & goal-setting ----------

/** Reflection answers are JSON split across Answers..Answers5 (45,000 characters each), like the
 *  Step 1 writing, so a long reflection never hits the 50,000-character cell limit. */
var LC_ANSWER_COLS = ['Answers', 'Answers2', 'Answers3', 'Answers4', 'Answers5'];
function lcReflRaw_(r) {
  var s = String(r.Answers == null ? '' : r.Answers);
  for (var k = 1; k < LC_ANSWER_COLS.length; k++) {
    var part = r[LC_ANSWER_COLS[k]];
    if (part === '' || part == null) break;
    s += String(part).replace(/^​/, '');
  }
  return s;
}

/**
 * type: 'weekly' (weeks 1-3) or 'growth' (week 4). answers: object keyed by question id (see
 * REFLECTION_QUESTIONS / GROWTH_QUESTIONS in Index.html). goal: free-text goal string.
 * base (optional): refused as { ok:false, stale:true } when another tab or device saved this
 * reflection (or a half-finished copy of it) after this tab last saw it.
 */
function saveReflection(email, week, type, answers, goal, base) {
  email = lcActingEmail_(email, true); week = lcWeek_(week);
  return lcWithUserLock_(function () {
    var group = lcRequireGroup_(email);
    var answersJson = JSON.stringify(answers || {});
    var parts = lcSplitJson_(answersJson), cells = {};
    LC_CHUNK_COLS.forEach(function (c, i) { cells[LC_ANSWER_COLS[i]] = parts[c]; });
    goal = String(goal || '');
    var meta = { email: email, week: week, groupId: group.groupId };
    return lcRowCritical_(function () {
      var prev = lcOwnRow_(reflectSheet_(), group.groupId, email, week);
      if (base) {
        var sd0 = lcOwnRow_(stepDraftSheet_(), group.groupId, email, week, { Kind: 'reflection' });
        var at = lcLaterIso_(prev ? prev.SubmittedAt : '', sd0 && lcJoinJson_(sd0) ? sd0.UpdatedAt : '');
        if (lcIsStale_(at, base)) {
          if (prev && lcReflRaw_(prev).trim()) { var pa0 = lcReflectionAnswers_(lcReflRaw_(prev)); lcBackupPrev_('reflection', JSON.stringify(pa0.unreadable ? { answersRaw: lcReflRaw_(prev), goal: cellToText_(prev.Goal) } : { answers: pa0.answers, goal: cellToText_(prev.Goal) }), '', meta, 'conflict'); }
          return { ok: false, stale: true, serverAt: at };
        }
      }
      var res = lcUpsertByKeys_(reflectSheet_(), 'Email', { GroupId: group.groupId, Email: email, Week: week }, function (rec, now) {
        // Keep the copy being replaced (always, if it can't be read).
        if (rec && lcReflRaw_(rec).trim()) {
          var pa = lcReflectionAnswers_(lcReflRaw_(rec));
          var prevJson = pa.unreadable ? JSON.stringify({ answersRaw: lcReflRaw_(rec), goal: cellToText_(rec.Goal) }) : JSON.stringify({ answers: pa.answers, goal: cellToText_(rec.Goal) });
          lcBackupPrev_('reflection', prevJson, JSON.stringify({ answers: answers || {}, goal: goal }), meta, pa.unreadable ? 'unreadable' : '');
        }
        var fields = { Type: type === 'growth' ? 'growth' : 'weekly', Goal: goal, SubmittedAt: now, AnswersFp: lcReflectionFp_(answers || {}, goal) };
        Object.keys(cells).forEach(function (c) { fields[c] = cells[c]; });
        return fields;
      }, { atomic: true, groupOf: email });
      lcClearStepDraft_(group.groupId, email, week, 'reflection', res.now);
      return { ok: true, savedAt: res.now.toISOString() };
    });
  });
}

// ---------- Writing-process stats (WritingStats.html) ----------
// For every writing box: writing time (from the student's own edits), sittings, pastes that went in,
// paste attempts that were blocked, and which characters of the current text arrived by paste.
// Kept apart from the writing itself, so a stats save can never get in the way of a work save.
// No keystroke log and no clipboard history: the only text kept is a pasted stretch that is still
// in the student's box (so the teacher's view can find and highlight it).
var LC_WS_MAX_SPANS = 300, LC_WS_SNIP_MAX = 4000, LC_WS_MAX_JSON = 200000;
function lcWsNum_(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
function lcWsCleanBox_(m) {
  if (!m || typeof m !== 'object') return null;
  var out = {
    v: 1, events: Math.floor(lcWsNum_(m.events)), blocked: Math.floor(lcWsNum_(m.blocked)),
    len: Math.floor(lcWsNum_(m.len)), lead: Math.floor(lcWsNum_(m.lead)), hash: String(m.hash || '').slice(0, 40), at: lcWsNum_(m.at)
  };
  if (typeof m.activeMs === 'number') {
    out.activeMs = lcWsNum_(m.activeMs); out.sessions = Math.floor(lcWsNum_(m.sessions)); out.lastInputAt = lcWsNum_(m.lastInputAt);
    out.timeStartedAt = String(m.timeStartedAt || '').slice(0, 40); out.untimedChars = Math.floor(lcWsNum_(m.untimedChars));
  }
  out.spans = (Array.isArray(m.spans) ? m.spans : []).slice(0, LC_WS_MAX_SPANS).map(function (sp) {
    if (!Array.isArray(sp) || sp.length < 3) return null;
    var a = Math.floor(lcWsNum_(sp[0])), b = Math.floor(lcWsNum_(sp[1])), k = sp[2] === 'p' ? 'p' : sp[2] === 'u' ? 'u' : '';
    if (!k || !(b > a)) return null;
    return k === 'p' && typeof sp[3] === 'string' ? [a, b, k, sp[3].slice(0, LC_WS_SNIP_MAX)] : [a, b, k];
  }).filter(function (sp) { return sp; });
  return out;
}
function lcWsCleanClock_(c) {
  if (!c || typeof c !== 'object' || typeof c.activeMs !== 'number') return null;
  return { activeMs: lcWsNum_(c.activeMs), sessions: Math.floor(lcWsNum_(c.sessions)), lastInputAt: lcWsNum_(c.lastInputAt), timeStartedAt: String(c.timeStartedAt || '').slice(0, 40) };
}
function lcWsValidKey_(k) { return /^s[1-4]\.[A-Za-z0-9_.]{1,160}$/.test(String(k || '')); }
function lcWsParse_(rec) {
  var d = rec ? lcParseDataRec_(rec) : {};
  if (!d || d._unreadable) d = {};
  return { boxes: d.boxes && typeof d.boxes === 'object' ? d.boxes : {}, clocks: d.clocks && typeof d.clocks === 'object' ? d.clocks : {} };
}
/** This student's stats for their current group: { week: { boxes, clocks } }. */
function lcWritingStatsFor_(email, groupId) {
  var sh = writingStatsSheet_(), out = {};
  lcReadRows_(sh, lcFindRowNumbers_(sh, 'Email', email)).forEach(function (r) {
    if (String(r.GroupId) !== String(groupId)) return;
    var wk = Number(r.Week); if (!(wk >= 1 && wk <= 4)) return;
    out[wk] = lcWsParse_(r);
  });
  return out;
}
/**
 * Student page: store the stats of the boxes that changed. payload = { boxes: {key: stats},
 * clocks: {s1..s4: step time} }. Each box keeps whichever copy is newer, so two tabs never wipe
 * each other's counts. A teacher viewing a student never records anything.
 */
function saveWritingStats(email, week, payload) {
  email = lcActingEmail_(email); week = lcWeek_(week);
  var session = lcCurrentEmail_();
  if (session && session !== email) return { ok: true, skipped: true };
  payload = payload && typeof payload === 'object' ? payload : {};
  return lcWithUserLock_(function () {
    var group = findGroupByEmail_(email);
    if (!group) return { ok: true, skipped: true };
    var sh = writingStatsSheet_(), prev = lcOwnRow_(sh, group.groupId, email, week), cur = lcWsParse_(prev);
    Object.keys(payload.boxes || {}).forEach(function (k) {
      if (!lcWsValidKey_(k)) return;
      var m = lcWsCleanBox_(payload.boxes[k]); if (!m) return;
      var have = cur.boxes[k];
      if (!have || lcWsNum_(m.at) >= lcWsNum_(have.at)) cur.boxes[k] = m;
    });
    Object.keys(payload.clocks || {}).forEach(function (k) {
      if (!/^s[1-4]$/.test(k)) return;
      var c = lcWsCleanClock_(payload.clocks[k]); if (!c) return;
      var have = cur.clocks[k];
      if (!have || c.lastInputAt >= lcWsNum_(have.lastInputAt)) cur.clocks[k] = c;
    });
    var json = JSON.stringify(cur);
    if (json.length > LC_WS_MAX_JSON) { // very long pasted stretches: keep the counts, drop the copies
      Object.keys(cur.boxes).forEach(function (k) { (cur.boxes[k].spans || []).forEach(function (sp) { if (sp.length > 3) sp.length = 3; }); });
      json = JSON.stringify(cur);
    }
    var fields = { UpdatedAt: new Date() }, chunks = lcSplitJson_(json);
    Object.keys(chunks).forEach(function (c) { fields[c] = chunks[c]; });
    lcUpsertByKeys_(sh, 'Email', { Email: email, Week: week, GroupId: group.groupId }, fields);
    return { ok: true };
  });
}
/** Teacher views: every student's stats in their current group, keyed 'email|week'. */
function lcWritingStatsByKey_(snap) {
  var out = {};
  lcAllRows_(writingStatsSheet_()).forEach(function (r) {
    var em = normEmail_(r.Email), g = snap.groupByEmail[em];
    if (!g || String(g.groupId) !== String(r.GroupId || '')) return;
    out[em + '|' + Number(r.Week)] = lcWsParse_(r);
  });
  return out;
}
/** Only the boxes of one step (s1..s4), plus that step's clock. */
function lcWritingForStage_(data, stage) {
  if (!data) return null;
  var pre = { submission: 's1', preparation: 's2', peer: 's3', reflection: 's4' }[stage];
  var boxes = {}, any = false;
  Object.keys(data.boxes || {}).forEach(function (k) { if (k.indexOf(pre + '.') === 0) { boxes[k] = data.boxes[k]; any = true; } });
  var clock = (data.clocks || {})[pre] || null;
  return any || clock ? { boxes: boxes, clock: clock } : null;
}

// ---------- Work backups: editor tools (see BACKUP_STUDENT at the top of this file) ----------

/** Lists the kept copies for a student (and week). Run from the editor, or call with arguments. */
function listWorkBackups(email, week) {
  lcRequireTeacher_();
  email = normEmail_(typeof email === 'string' && email ? email : BACKUP_STUDENT);
  week = (typeof week === 'number' || (typeof week === 'string' && week)) ? week : BACKUP_WEEK;
  if (!email) throw new Error('Type the student\'s email in BACKUP_STUDENT at the top of Code.gs first.');
  var sh = backupSheet_(), rows = lcReadRows_(sh, lcFindRowNumbers_(sh, 'Email', email)).filter(function (r) { return !week || Number(r.Week) === Number(week); });
  var out = rows.reverse().map(function (r) {
    var s = lcJoinJson_(r), text = s.replace(/<[^>]*>/g, ' ').replace(/\\[nrt]/g, ' ').replace(/[{}\[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
    return { row: r._row, week: Number(r.Week), kind: String(r.Kind || ''), savedAt: lcIsoValue_(r.SavedAt), reason: String(r.Reason || ''), chars: Number(r.Chars) || s.length, prepType: String(r.PrepType || ''), preview: text.slice(0, 160) };
  });
  Logger.log(out.length ? out.map(function (b) { return 'row ' + b.row + ' · Week ' + b.week + ' · ' + b.kind + (b.prepType ? ' (' + b.prepType + ')' : '') + ' · ' + b.savedAt + ' · ' + b.reason + ' · ' + b.chars + ' chars\n    ' + b.preview; }).join('\n') : 'No kept copies for ' + email + (week ? ' in Week ' + week : '') + '.');
  return { ok: true, email: email, backups: out };
}

/**
 * Puts a kept copy back as the student's newest DRAFT (Step 1 → WeeklyDrafts; plan / reflection →
 * StepDrafts), backing up what is there now first. Submitted work and grades are not touched; the
 * student sees the copy the next time they open that step and submits it themselves.
 */
function restoreWorkBackup(row) {
  lcRequireTeacher_();
  row = Number(typeof row === 'number' || (typeof row === 'string' && row) ? row : BACKUP_ROW);
  var sh = backupSheet_();
  if (!(row >= 2) || row > sh.getLastRow()) throw new Error('Type a row number from listWorkBackups in BACKUP_ROW at the top of Code.gs first.');
  var b = lcReadRows_(sh, [row])[0], json = lcJoinJson_(b), data;
  try { data = JSON.parse(json); } catch (e) { throw new Error('Row ' + row + ' is a damaged copy, so it can\'t be restored automatically. Open the WorkBackups tab and copy the text from its DataJson cells by hand.'); }
  var email = normEmail_(b.Email), week = lcWeek_(b.Week), kind = String(b.Kind || '');
  var group = findGroupByEmail_(email);
  if (!group) throw new Error(email + ' is not in a Literature Circle group right now. Put them back in a group first.');
  var note = String(b.GroupId || '') && String(b.GroupId) !== String(group.groupId) ? ' (this copy came from an earlier group; it was restored into the current one)' : '';
  var now = new Date(), fields = { UpdatedAt: now };
  if (kind === 'draft' || kind === 'work') {
    var dsh = draftSheet_(), cur = lcOwnRow_(dsh, group.groupId, email, week);
    lcBackupWorkRow_('draft', cur, '', { email: email, week: week, groupId: group.groupId }, 'before-restore');
    var clean = {}; Object.keys(data || {}).forEach(function (k) { if (k.charAt(0) !== '_') clean[k] = data[k]; });
    var chunks = lcSplitJson_(JSON.stringify(clean));
    fields.PrepType = String(b.PrepType || ''); fields.Choices = String(b.Choices || '');
    Object.keys(chunks).forEach(function (k) { fields[k] = chunks[k]; });
    lcUpsertByKeys_(dsh, 'Email', { GroupId: group.groupId, Email: email, Week: week }, fields);
  } else {
    var stepKind = /reflection/.test(kind) ? 'reflection' : 'plan';
    if (kind === 'reflection' && data.answersRaw !== undefined) throw new Error('Row ' + row + ' is a damaged reflection; copy its text from the WorkBackups tab by hand.');
    var ssh = stepDraftSheet_(), curS = lcOwnRow_(ssh, group.groupId, email, week, { Kind: stepKind });
    if (curS) lcBackupPrev_('step-' + stepKind, lcJoinJson_(curS), '', { email: email, week: week, groupId: group.groupId }, 'before-restore');
    var sChunks = lcSplitJson_(JSON.stringify(data));
    Object.keys(sChunks).forEach(function (k) { fields[k] = sChunks[k]; });
    lcUpsertByKeys_(ssh, 'Email', { Email: email, Week: week, Kind: stepKind, GroupId: group.groupId }, fields);
  }
  var msg = 'Restored row ' + row + ' (' + kind + ', Week ' + week + ') for ' + email + ' as their newest draft' + note + '. They will see it the next time they open that step.';
  Logger.log(msg);
  return { ok: true, message: msg };
}

// ---------- PDF export ----------

/**
 * Builds a student's strategies + reflections into a PDF they can submit to Canvas or another
 * LMS — either the whole unit so far, or just one section of one week (Strategies, Feedback Loop,
 * or Reflection), depending on what the client sends. The client (Index.html) already knows how to
 * turn raw prep/reflection/peer data into readable text (buildPrepSummaryText, etc. — the single
 * source of truth for strategy field labels lives there in STRATEGY_DEFS), so it sends this
 * function pre-formatted blocks of text; this function's only job is text -> Google Doc -> PDF.
 *
 * sections: [{ week, reading, blocks: [{ heading, text }, ...] }, ...]
 */
function exportReportPdf(email, bookTitle, membersStr, sections) {
  email = lcActingEmail_(email);
  var doc = DocumentApp.create('LitCircle Report - temp - ' + Utilities.getUuid());
  var body = doc.getBody();
  body.appendParagraph('Lit Circles Report').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(bookTitle || '(untitled book)').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Student: ' + email);
  body.appendParagraph('Group: ' + (membersStr || ''));

  (sections || []).forEach(function (s) {
    body.appendParagraph('Week ' + s.week + ' — ' + (s.reading || 'reading range not set')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    (s.blocks || []).forEach(function (b) {
      body.appendParagraph(b.heading || '').setHeading(DocumentApp.ParagraphHeading.HEADING3);
      body.appendParagraph(b.text || '(Nothing saved yet.)');
    });
  });

  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  var pdfBlob = file.getAs('application/pdf');
  var base64 = Utilities.base64Encode(pdfBlob.getBytes());
  file.setTrashed(true); // clean up the temp Doc — only the downloaded PDF is meant to stick around

  var safeTitle = (bookTitle || 'Lit Circle').toString().replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Lit Circle';
  return { base64: base64, filename: safeTitle + ' - Lit Circle Report.pdf' };
}

// ---------- Illustrator image upload (optional) ----------

/** Saves a base64-encoded image to Drive and returns a viewable URL. */
function saveIllustration(base64Data, mimeType, fileName) {
  var folder = DriveApp.getRootFolder();
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType, fileName || 'illustration');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function awaySheet_() { return getSheet_(SHEET_NAMES.AWAY, LC_SHEET_HEADERS.DiscussionAway); }
// (The Reader's Journal and its pictures are not part of this copy.)

// ---------- AI feedback (optional) ----------

/**
 * Gives a student short, coaching-style feedback on their reading-strategy prep, via Gemini.
 *
 * SETUP: get a free API key at https://aistudio.google.com/apikey, then in this Apps Script
 * project go to Project Settings (gear icon, left sidebar) > Script Properties > Add script
 * property, with property name GEMINI_API_KEY and the key as the value. The key is only ever
 * read here, server-side — it is never sent to the browser or visible to students.
 */
// The AI Feedback button was replaced by the built-in Step 1 checklists (Checklists.html) in
// release 2026-09-27a: with one shared Gemini key, a class clicking at once kept getting "busy".
// Set this to true to switch the server side back on (the button itself would also need restoring).
var LC_AI_FEEDBACK_ENABLED = false;

function getAIFeedback(bookTitle, weekLabel, prepLabel, summaryText) {
  if (!LC_AI_FEEDBACK_ENABLED) throw new Error('AI feedback has been replaced by the checklist beside your writing. Use it to check your work before you submit.');
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('AI feedback isn\'t set up yet. Ask your teacher to add a GEMINI_API_KEY under Project Settings > Script Properties in the Apps Script editor.');
  }

  var prompt = [
    'You are a supportive reading coach for a middle/high school Literature Circle.',
    'Book: ' + (bookTitle || 'unknown'),
    'This week\'s reading: ' + (weekLabel || 'unknown'),
    'The student chose: ' + prepLabel,
    '',
    'Here is what the student wrote:',
    summaryText,
    '',
    'Give the student 2-4 sentences of specific, encouraging feedback on this work, aimed at ' +
    'helping them lead a great discussion. Point out one thing that is working well, and one ' +
    'concrete way to go deeper (for example, asking a more open-ended "thick" question, or ' +
    'digging into a more meaningful connection). Do not write the answer or question for them — ' +
    'coach them toward improving it themselves. Keep the tone warm and age-appropriate for a ' +
    'student. Do not use markdown formatting or asterisks.'
  ].join('\n');

  // Gemini 3 models spend part of maxOutputTokens on hidden internal "thinking" before writing the
  // visible answer, by default at the highest ("high") level — for a short coaching comment like
  // this, that step isn't needed, and left on it can eat the whole token budget and cut the real
  // answer off mid-sentence. Which thinking-level values a given model version actually accepts
  // has proven inconsistent (both 'minimal' and, in the future, possibly others have been rejected
  // outright by specific models with a 400 error) — so rather than hardcode one value and break
  // again on the next model update, try progressively "safer" settings and fall back automatically.
  var attempts = [
    { thinkingConfig: { thinkingLevel: 'low' } },
    { thinkingConfig: { thinkingBudget: 0 } },
    {} // last resort: no thinking config at all, just a generous token budget
  ];

  var lastError = null;
  for (var i = 0; i < attempts.length; i++) {
    try {
      return callGemini_(apiKey, prompt, attempts[i]);
    } catch (e) {
      lastError = e;
      var msg = e && e.message ? e.message : String(e);
      // Only retry the NEXT attempt for the specific "this setting isn't supported" failure —
      // any other error (bad key, quota, network) should surface immediately, not retry 3x.
      if (msg.indexOf('THINKING_CONFIG_UNSUPPORTED') === -1) throw e;
    }
  }
  throw lastError;
}

/** Makes one Gemini generateContent call. Throws an Error prefixed with THINKING_CONFIG_UNSUPPORTED
 * specifically when the model rejected the given thinkingConfig, so getAIFeedback knows to retry
 * with a different one rather than giving up. */
function callGemini_(apiKey, promptText, extraGenerationConfig) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  var generationConfig = { temperature: 0.7, maxOutputTokens: 500 };
  for (var key in extraGenerationConfig) generationConfig[key] = extraGenerationConfig[key];

  var payload = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: generationConfig
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var bodyText = response.getContentText();

  if (code !== 200) {
    if (code === 400 && extraGenerationConfig.thinkingConfig && /thinking level|thinking.?budget/i.test(bodyText)) {
      throw new Error('THINKING_CONFIG_UNSUPPORTED: ' + bodyText.substring(0, 300));
    }
    var hint = code === 404 ? ' (this usually means the GEMINI_MODEL name in Code.gs has been retired by Google — check https://ai.google.dev/gemini-api/docs/models for a current model name and update that one constant.)' : '';
    throw new Error('AI feedback request failed (HTTP ' + code + ')' + hint + ': ' + bodyText.substring(0, 300));
  }

  var json = JSON.parse(bodyText);
  var candidate = json && json.candidates && json.candidates[0];
  var feedback = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

  if (!feedback) {
    var reason = candidate && candidate.finishReason;
    throw new Error('AI feedback came back empty' + (reason ? ' (reason: ' + reason + ')' : '') + '. Try again in a moment.');
  }

  return feedback.trim();
}


// ============================================================================
// LITERATURE CIRCLES PLATFORM LAYER
// Classes, teacher/admin access, release controls, grading, rubrics, CSV.
// ============================================================================

var LC_PLATFORM_SHEETS = { USERS: 'LC_Users', CLASSES: 'LC_Classes', ENROLL: 'LC_Enrollment', GRADES: 'LC_Grades' };
var LC_PLATFORM_HEADERS = {
  LC_Users: ['Email', 'Name', 'Role', 'Status', 'UpdatedAt'],
  LC_Classes: ['ClassId', 'TeacherEmail', 'ClassName', 'Period', 'JoinCode', 'SettingsJson', 'Active', 'CreatedAt', 'UpdatedAt'],
  // NameSetAt (2026-10-29a): when the student typed their own first and last name.
  LC_Enrollment: ['ClassId', 'StudentEmail', 'StudentName', 'Active', 'JoinedAt', 'NameSetAt'],
  // MarkedFp: fingerprint of the work at the moment it was scored (for "redone after grading").
  // CanvasCommentFp: which version of the comment was last posted to Canvas.
  LC_Grades: ['ClassId', 'StudentEmail', 'ItemKey', 'Score', 'MaxPoints', 'RubricJson', 'Feedback', 'Excluded', 'UpdatedAt', 'UpdatedBy', 'MarkedFp', 'CanvasCommentFp', 'CanvasPostedScore']
};

var LC_RUBRICS = {
  submission: {
    title: 'Lit Circle Submission', max: 7,
    pathways: {
      strategies: { title:'2 Reading Strategies Rubric', levels:[
        {points:7,label:'Excellent',text:'Student consistently and effectively uses the two assigned reading strategies to demonstrate a deep understanding of the novel. Page numbers are accurately referenced, and the strategies significantly enhance comprehension.'},
        {points:6,label:'Very Good',text:'Student uses the two assigned reading strategies to demonstrate a good understanding of the novel. Page numbers are provided as references, and the strategies enhance comprehension.'},
        {points:5,label:'Good',text:'Student demonstrates a basic understanding of the novel. Page numbers are occasionally referenced, and the strategies used somewhat help comprehension.'},
        {points:4,label:'Decent',text:'Student shows a limited understanding of the novel. Page numbers are rarely referenced, and the strategies only partially contribute to comprehension.'},
        {points:0,label:'No Marks',text:'Student does not effectively use the required reading strategies. Page references and meaningful strategy thinking are missing or substantially incomplete.'}
      ]}
    }
  },
  preparation: { title:'Discussion Preparation', max:3, completeScore:3 },
  peer: { title:'Peer Assessment Completion', max:2, completeScore:2 },
  quiz: { title:'Reading Quiz', max:10 },
  reflection: { title:'Weekly Reflection', max:7, levels:[
    {points:7,label:'Excellent',text:'The reflection is deep, honest, and specific. It uses peer feedback and the student’s own rubric self-rating to analyze strengths, patterns, and meaningful areas for growth. The student explains what the feedback reveals and sets a specific, actionable next step. Strong effort is evident.'},
    {points:6,label:'Very Good',text:'The reflection thoughtfully uses specific peer feedback and self-assessment to explain strengths and areas for growth. The next step is realistic and clearly connected to the discussion. Clear effort and depth are evident.'},
    {points:5,label:'Good',text:'The reflection addresses peer feedback and self-assessment with some explanation. It identifies a strength and a next step, but depth, specificity, or effort is uneven.'},
    {points:4,label:'Decent',text:'The reflection is basic or brief. It mentions feedback but remains general, shows limited analysis of the student’s discussion habits, or sets a broad next step with limited connection to the evidence.'},
    {points:0,label:'No Marks',text:'The reflection is missing, substantially incomplete, or does not meaningfully respond to peer feedback and self-assessment.'}
  ]},
  // Compatibility aliases for older deployed client code. New grading uses the
  // submission/preparation/peer/reflection structure above.
  prep: { title:'Lit Circle Submission', max:7, criteria:[] },
  discussion: { title:'Peer Assessment Completion', max:2, criteria:[] }
};

// The four steps of every week. Steps 1 and 4 are marked by the teacher on a rubric; Steps 2
// and 3 score themselves (complete / not complete) and the teacher can override them.
// 2026-10-18b: the Reading Quiz (Quiz.js) sits between Step 2 and Step 3. It has no step number;
// `step` is how every message names a step ("Step 1" … "Reading Quiz").
var LC_STAGES = ['submission', 'preparation', 'quiz', 'peer', 'reflection'];
var LC_STAGE_META = {
  submission: { no: 1, step: 'Step 1', title: 'Lit Circle Submission', short: 'Submission', max: 7, teacher: true },
  preparation: { no: 2, step: 'Step 2', title: 'Discussion Preparation', short: 'Plan', max: 3, teacher: false },
  quiz: { no: 0, step: 'Reading Quiz', title: 'Reading Quiz', short: 'Quiz', max: 10, teacher: false },
  peer: { no: 3, step: 'Step 3', title: 'Peer Assessment', short: 'Peer', max: 2, teacher: false },
  reflection: { no: 4, step: 'Step 4', title: 'Reflection', short: 'Reflection', max: 7, teacher: true }
};
function lcItemKey_(week, stage) { return 'w' + Number(week) + '_' + stage; }
function lcParseItemKey_(key) {
  var m = String(key || '').match(/^w([1-4])_(submission|preparation|quiz|peer|reflection)$/);
  return m ? { week: Number(m[1]), stage: m[2] } : null;
}

function lcPlatformSheet_(name) { return getSheet_(name, LC_PLATFORM_HEADERS[name]); }

/** True once the Users tab has an active admin. */
function lcHasActiveAdmin_() {
  return lcSheetObjects_(LC_PLATFORM_SHEETS.USERS).some(function (u) { return String(u.Role) === 'admin' && String(u.Status) === 'active'; });
}

function lcEnsurePlatform_(firstAdmin) {
  Object.keys(LC_PLATFORM_HEADERS).forEach(function (n) { lcPlatformSheet_(n); });
  var admin = normEmail_(TEACHER_EMAIL);
  // A copy with TEACHER_EMAIL blank: the person running setup becomes admin, but only while there is none.
  if (!admin && firstAdmin && !lcHasActiveAdmin_()) admin = normEmail_(firstAdmin);
  if (admin && !lcUser_(admin)) {
    lcAppendObject_(lcPlatformSheet_(LC_PLATFORM_SHEETS.USERS), { Email: admin, Name: lcNameFromEmail_(admin), Role: 'admin', Status: 'active', UpdatedAt: new Date() });
    LC_X_.users = null;
  }
  return getSs_();
}

/** Run once from the editor after pasting a new release (optional — every tab migrates itself). */
function setupLiteratureCirclesBackend() {
  var t = lcCurrentEmail_();
  var u = t ? lcUser_(t) : null;
  var configured = normEmail_(TEACHER_EMAIL);
  if (t && u === null && (configured ? configured !== t : lcHasActiveAdmin_())) throw new Error('Teacher access required.');
  [groupsSheet_, workSheet_, draftSheet_, peerSheet_, historySheet_, reflectSheet_, selfAssessSheet_, resumeSheet_].forEach(function (f) { f(); });
  lcEnsurePlatform_(t);
  return { ok: true, spreadsheetUrl: getSs_().getUrl(), adminEmail: configured || t, version: LC_APP_VERSION };
}

function lcSheetObjects_(name) {
  if (name === LC_PLATFORM_SHEETS.USERS && LC_X_.users) return LC_X_.users;
  if (name === LC_PLATFORM_SHEETS.CLASSES && LC_X_.classes) return LC_X_.classes;
  if (name === LC_PLATFORM_SHEETS.ENROLL && LC_X_.enroll) return LC_X_.enroll;
  var rows = lcAllRows_(lcPlatformSheet_(name));
  if (name === LC_PLATFORM_SHEETS.USERS) LC_X_.users = rows;
  if (name === LC_PLATFORM_SHEETS.CLASSES) LC_X_.classes = rows;
  if (name === LC_PLATFORM_SHEETS.ENROLL) LC_X_.enroll = rows;
  return rows;
}
function lcNameFromEmail_(email) {
  var p = normEmail_(email).split('@')[0].replace(/\+.*$/, '').replace(/[._-]+/g, ' ');
  return p.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
function lcTruth_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function lcUuid_() { return Utilities.getUuid(); }
function lcJoinCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = '';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
function lcDefaultClassSettings_() {
  return { plan: lcDefaultPlan_(), releasedWeeks: [1], teacherResources: true, dueDates: {}, excluded: {}, grading: { submission: 7, preparation: 3, quiz: 10, peer: 2, reflection: 7 }, canvas: { courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: '', assignments: {} }, assignmentSchedule: {}, quizOpen: {}, quizOpenedAt: {} };
}
function lcNormalizeClassSettings_(value) {
  var raw = (value && typeof value === 'object') ? value : lcParse_(value, {}), d = lcDefaultClassSettings_();
  raw = raw || {};
  if (Array.isArray(raw.releasedWeeks)) d.releasedWeeks = raw.releasedWeeks.map(Number).filter(function (n) { return n >= 1 && n <= 4; }).sort();
  if (raw.teacherResources != null) d.teacherResources = !!raw.teacherResources;
  d.dueDates = raw.dueDates || {};
  d.excluded = {};
  Object.keys(raw.excluded || {}).forEach(function (k) { if (raw.excluded[k] && lcParseItemKey_(k)) d.excluded[k] = true; });
  d.grading = Object.assign({}, d.grading, raw.grading || {});
  d.canvas = Object.assign({}, d.canvas, raw.canvas || {});
  d.canvas.assignments = Object.assign({}, (raw.canvas && raw.canvas.assignments) || {});
  d.assignmentSchedule = Object.assign({}, raw.assignmentSchedule || {});
  // Reading Quiz: which weeks have "Quiz open now" on, and when each was last opened
  Object.keys(raw.quizOpen || {}).forEach(function (k) { if (raw.quizOpen[k] && Number(k) >= 1 && Number(k) <= 4) d.quizOpen[String(Number(k))] = true; });
  d.quizOpenedAt = Object.assign({}, raw.quizOpenedAt || {});
  d.plan = lcNormalizePlan_(raw.plan);
  return d;
}
/** { 'w1_submission': dueAt, ... } — each step's due date from "Week N · Due dates & Canvas" (or Canvas). */
function lcStepDueDates_(settings) {
  var out = {}, sch = (settings && settings.assignmentSchedule) || {}, links = ((settings && settings.canvas) || {}).assignments || {};
  [1, 2, 3, 4].forEach(function (w) {
    LC_STAGES.forEach(function (st) {
      var k = lcCanvasAssessmentKey_(w, st), due = String((sch[k] || {}).dueAt || (links[k] || {}).dueAt || '');
      if (due) out[lcItemKey_(w, st)] = due;
    });
  });
  return out;
}
function lcPublicClass_(c) {
  return { classId: String(c.ClassId), teacherEmail: normEmail_(c.TeacherEmail), className: String(c.ClassName || ''), period: cellToText_(c.Period), joinCode: String(c.JoinCode || ''), settings: lcNormalizeClassSettings_(c.SettingsJson), active: lcTruth_(c.Active) };
}

function lcUser_(email) {
  var e = normEmail_(email), found = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.USERS).forEach(function (u) { if (normEmail_(u.Email) === e) found = u; });
  return found;
}
function lcRequireTeacher_() {
  var email = lcCurrentEmail_(); var u = lcUser_(email);
  if (!u || String(u.Status) !== 'active' || ['teacher', 'admin'].indexOf(String(u.Role)) < 0) throw new Error('Teacher access has not been authorized.');
  return { email: email, role: String(u.Role), name: String(u.Name || lcNameFromEmail_(email)) };
}
function lcRequireAdmin_() { var t = lcRequireTeacher_(); if (t.role !== 'admin') throw new Error('Administrator access required.'); return t; }
function lcClass_(id) {
  var found = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (c) { if (String(c.ClassId) === String(id)) found = c; });
  return found;
}
function lcTeacherOwnsClass_(id, teacher) { var c = lcClass_(id); return !!c && (teacher.role === 'admin' || normEmail_(c.TeacherEmail) === teacher.email); }
function lcRequireClass_(classId) {
  var t = lcRequireTeacher_();
  if (!lcTeacherOwnsClass_(classId, t)) throw new Error('Class not found or access denied.');
  return t;
}
function lcEnrollments_(classId) {
  var byEmail = {};
  lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (e) {
    if (String(e.ClassId) !== String(classId)) return;
    var em = normEmail_(e.StudentEmail); if (!em) return;
    byEmail[em] = e; // last row for an email wins, so a re-join or a deactivation is honoured
  });
  return Object.keys(byEmail).map(function (k) { return byEmail[k]; }).filter(function (e) { return lcTruth_(e.Active); })
    .sort(function (a, b) { return lcSortName_(a).localeCompare(lcSortName_(b)); });
}
function lcSortName_(e) { var n = String(e.StudentName || lcNameFromEmail_(e.StudentEmail)).trim().split(/\s+/); return (n.length > 1 ? n[n.length - 1] + ' ' + n.slice(0, -1).join(' ') : n[0]).toLowerCase(); }
function lcIsEnrolled_(classId, email) { var e = normEmail_(email); return lcEnrollments_(classId).some(function (x) { return normEmail_(x.StudentEmail) === e; }); }
function lcEnrollmentsForStudent_(email) {
  var e = normEmail_(email), ids = {};
  lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (x) { if (normEmail_(x.StudentEmail) === e) ids[String(x.ClassId)] = lcTruth_(x.Active); });
  return Object.keys(ids).filter(function (k) { return ids[k]; });
}

// ---- 2026-10-29a: every student gives their first and last name ------------
// A student who joined with only an email (or whom the teacher added by email)
// is asked once for their first and last name; it replaces the name in every
// class they are in. NameSetAt marks rows the student has named themselves.
function lcCleanNamePart_(v, what) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Please type your ' + what + '.');
  if (s.length > 40) throw new Error('Your ' + what + ' is too long (40 letters at most).');
  if (!/[A-Za-z\u00C0-\u024F\u0100-\u017F\u02BB\u0370-\u1FFF]/.test(s) || /[<>@=]/.test(s)) throw new Error('Please type your real ' + what + '.');
  return s;
}
function lcNeedsName_(email) {
  var e = normEmail_(email); if (!e) return false;
  var rows = lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).filter(function (x) { return normEmail_(x.StudentEmail) === e && lcTruth_(x.Active); });
  if (!rows.length) return false;
  return !rows.some(function (x) { return x.NameSetAt !== '' && x.NameSetAt != null; });
}
function lcNameSuggestion_(email) {
  var e = normEmail_(email), name = '';
  lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (x) { if (normEmail_(x.StudentEmail) === e && String(x.StudentName || '').trim()) name = String(x.StudentName).replace(/^'/, '').trim(); });
  var parts = (name || lcNameFromEmail_(e)).split(/\s+/);
  return { first: parts[0] || '', last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
}
function setMyLiteratureName(payload) {
  payload = payload || {};
  lcEnsurePlatform_();
  var email = lcActingEmail_(payload.email || lcCurrentEmail_(), true);
  var name = lcCleanNamePart_(payload.firstName, 'first name') + ' ' + lcCleanNamePart_(payload.lastName, 'last name');
  var updated = 0;
  withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.ENROLL);
    lcReadRows_(sh, lcFindRowNumbers_(sh, 'StudentEmail', email)).forEach(function (r) {
      if (normEmail_(r.StudentEmail) !== email) return;
      var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; });
      o.StudentName = lcText_(name); o.NameSetAt = new Date();
      lcWriteObjectRow_(sh, r._row, o); updated++;
    });
    LC_X_.enroll = null;
  });
  if (!updated) throw new Error('You are not in a class yet. Ask your teacher for the class code.');
  return { ok: true, name: name, updated: updated };
}

function getLiteratureBootstrap() {
  lcEnsurePlatform_();
  var email = lcCurrentEmail_();
  var u = lcUser_(email);
  var role = (u && String(u.Status) === 'active') ? String(u.Role) : 'student';
  var classes = [];
  if (role === 'teacher' || role === 'admin') {
    classes = lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).filter(function (c) { return lcTruth_(c.Active) && (role === 'admin' || normEmail_(c.TeacherEmail) === email); }).map(lcPublicClass_);
  } else if (email) {
    var ids = lcEnrollmentsForStudent_(email);
    classes = lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).filter(function (c) { return ids.indexOf(String(c.ClassId)) >= 0 && lcTruth_(c.Active); }).map(function (c) {
      // students only need the release switches, not Canvas links or tokens of any kind
      var pc = lcPublicClass_(c);
      pc.settings = { releasedWeeks: pc.settings.releasedWeeks, teacherResources: pc.settings.teacherResources, quizOpen: pc.settings.quizOpen,
        stepDue: lcStepDueDates_(pc.settings), notGraded: Object.keys(pc.settings.excluded || {}) }; // 2026-10-26a: due dates on the week page
      pc.joinCode = '';
      return pc;
    });
  }
  var needsName = role === 'student' && !!email && lcNeedsName_(email);
  return { ok: true, email: email, name: (u && u.Name) || lcNameFromEmail_(email), role: role, classes: classes, needsName: needsName, nameSuggest: needsName ? lcNameSuggestion_(email) : null, rubrics: LC_RUBRICS, appVersion: lcLiveAppVersion_(), serverBuild: LC_APP_VERSION, lastClassId: (role === 'teacher' || role === 'admin') ? lcTeacherLastClass_(email) : '', defaultClassId: (role === 'teacher' || role === 'admin') ? lcBusiestClass_(classes) : '' };
}

// 2026-10-18f: the teacher dashboard opens on the class the teacher had open last (on any device),
// not on the first class in the list. One script property per teacher; not a sheet column.
var LC_LAST_CLASS_PROP = 'LC_LAST_CLASS::';
function lcTeacherLastClass_(email) {
  try { return String(PropertiesService.getScriptProperties().getProperty(LC_LAST_CLASS_PROP + normEmail_(email)) || ''); } catch (e) { return ''; }
}
/** 2026-10-18g: with nothing remembered yet, open the class with the most students (a test class
 *  made first has only a few), not simply the first class in the list. */
function lcBusiestClass_(classes) {
  if (!classes || classes.length < 2) return classes && classes[0] ? String(classes[0].classId) : '';
  var count = {}, seen = {};
  lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (e) {
    var k = String(e.ClassId) + '|' + normEmail_(e.StudentEmail);
    if (seen[k] || !(lcTruth_(e.Active) || e.Active === '' || e.Active == null)) return;
    seen[k] = true; count[String(e.ClassId)] = (count[String(e.ClassId)] || 0) + 1;
  });
  var best = String(classes[0].classId);
  classes.forEach(function (c) { if ((count[String(c.classId)] || 0) > (count[best] || 0)) best = String(c.classId); });
  return best;
}
function rememberLiteratureTeacherClass(payload) {
  var classId = String((payload || {}).classId || '');
  var t = lcRequireClass_(classId);
  PropertiesService.getScriptProperties().setProperty(LC_LAST_CLASS_PROP + normEmail_(t.email), classId);
  return { ok: true, classId: classId };
}

function createLiteratureClass(payload) {
  lcEnsurePlatform_(); var t = lcRequireTeacher_(); payload = payload || {};
  var name = String(payload.className || '').trim(); if (!name) throw new Error('Enter a class name.');
  var id = lcUuid_(), code = lcJoinCode_(), settings = lcDefaultClassSettings_();
  withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.CLASSES);
    sh.getRange(sh.getLastRow() + 1, lcCol_(sh, 'Period')).setNumberFormat('@');
    lcAppendObject_(sh, { ClassId: id, TeacherEmail: t.email, ClassName: name, Period: String(payload.period || ''), JoinCode: code, SettingsJson: JSON.stringify(settings), Active: true, CreatedAt: new Date(), UpdatedAt: new Date() });
    LC_X_.classes = null;
  });
  return { ok: true, classInfo: { classId: id, teacherEmail: t.email, className: name, period: String(payload.period || ''), joinCode: code, settings: settings, active: true } };
}

/** The one place class rows are rewritten: under the lock, from a fresh read of that row. */
function lcUpdateClassRow_(classId, fn) {
  return withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.CLASSES);
    var recs = lcReadRows_(sh, lcFindRowNumbers_(sh, 'ClassId', String(classId)));
    if (!recs.length) throw new Error('Class not found.');
    var rec = recs[recs.length - 1], obj = {};
    Object.keys(rec).forEach(function (k) { if (k !== '_row') obj[k] = rec[k]; });
    if (String(obj.SettingsJson || '').trim() && lcParse_(obj.SettingsJson, null) === null) {
      // Never replace settings that can't be read with defaults (released weeks, Canvas links...).
      throw new Error('This class\'s saved settings could not be read, so nothing was changed. Open the LC_Classes tab and check the SettingsJson cell for this class, or ask for help.');
    }
    var settings = lcNormalizeClassSettings_(obj.SettingsJson);
    var result = fn(obj, settings);
    obj.SettingsJson = JSON.stringify(settings);
    if (obj.SettingsJson.length > 48000) throw new Error('Class settings are too large to save.');
    obj.UpdatedAt = new Date();
    obj.ClassName = cellToText_(obj.ClassName); obj.Period = cellToText_(obj.Period); obj.JoinCode = String(obj.JoinCode || '');
    lcWriteObjectRow_(sh, rec._row, obj);
    LC_X_.classes = null;
    return { settings: settings, result: result, row: obj };
  });
}
/** Change class settings safely: fn(settings) mutates a FRESH copy under the lock. */
function lcMutateClassSettings_(classId, fn) {
  return lcUpdateClassRow_(classId, function (row, settings) { return fn(settings); }).settings;
}

function updateLiteratureClass(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  lcUpdateClassRow_(id, function (row, settings) {
    if (payload.className != null) { var n = String(payload.className).trim(); if (!n) throw new Error('Enter a class name.'); row.ClassName = n; }
    if (payload.period != null) row.Period = String(payload.period);
    if (payload.active != null) row.Active = !!payload.active;
    if (payload.settings != null) {
      var s = lcNormalizeClassSettings_(payload.settings);
      Object.keys(s).forEach(function (k) { settings[k] = s[k]; });
    }
  });
  return { ok: true };
}

function joinLiteratureClass(payload) {
  lcEnsurePlatform_(); payload = payload || {};
  var email = lcActingEmail_(payload.email || lcCurrentEmail_()); var code = String(payload.joinCode || '').trim().toUpperCase();
  if (!code) throw new Error('Enter the class join code.');
  var c = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (x) { if (String(x.JoinCode || '').toUpperCase() === code && lcTruth_(x.Active)) c = x; });
  if (!c) throw new Error('That class code was not found.');
  var classId = String(c.ClassId);
  withLock_(function () {
    LC_X_.enroll = null;
    // 2026-10-29a: a student joining gives a first and last name (lcCleanNamePart_ checks both).
    var typed = (payload.firstName || payload.lastName) ? lcCleanNamePart_(payload.firstName, 'first name') + ' ' + lcCleanNamePart_(payload.lastName, 'last name') : '';
    if (!lcIsEnrolled_(classId, email)) lcAppendObject_(lcPlatformSheet_(LC_PLATFORM_SHEETS.ENROLL), { ClassId: classId, StudentEmail: email, StudentName: lcText_(typed || String(payload.name || lcNameFromEmail_(email))), Active: true, JoinedAt: new Date(), NameSetAt: typed ? new Date() : '' });
    LC_X_.enroll = null;
  });
  var pc = lcPublicClass_(c);
  pc.settings = { releasedWeeks: pc.settings.releasedWeeks, teacherResources: pc.settings.teacherResources };
  return { ok: true, classInfo: pc };
}

function teacherAddLiteratureStudents(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var emails = String(payload.emails || '').split(/[\s,;]+/).map(normEmail_).filter(function (x) { return x && x.indexOf('@') > 0; });
  var added = 0;
  withLock_(function () {
    LC_X_.enroll = null;
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.ENROLL), have = {};
    lcEnrollments_(id).forEach(function (e) { have[normEmail_(e.StudentEmail)] = true; });
    var rows = [];
    emails.forEach(function (email) { if (!have[email]) { have[email] = true; rows.push(lcRowFromObject_(sh, { ClassId: id, StudentEmail: email, StudentName: lcNameFromEmail_(email), Active: true, JoinedAt: new Date() })); added++; } });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    LC_X_.enroll = null;
  });
  return { ok: true, added: added };
}

/** Remove a student from the class roster (their work and grades are kept). */
function teacherRemoveLiteratureStudent(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), email = normEmail_(payload.studentEmail);
  lcRequireClass_(id);
  withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.ENROLL);
    lcReadRows_(sh, lcFindRowNumbers_(sh, 'StudentEmail', email)).forEach(function (r) {
      if (String(r.ClassId) !== id) return;
      var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; }); o.Active = false;
      lcWriteObjectRow_(sh, r._row, o);
    });
    LC_X_.enroll = null;
  });
  return { ok: true };
}

function adminListLiteratureAccess() { lcRequireAdmin_(); return { ok: true, access: lcSheetObjects_(LC_PLATFORM_SHEETS.USERS).map(function (u) { return { email: normEmail_(u.Email), name: String(u.Name || ''), role: String(u.Role || ''), status: String(u.Status || '') }; }) }; }
function adminSetLiteratureAccess(payload) {
  lcRequireAdmin_(); payload = payload || {};
  var email = normEmail_(payload.email), role = ['teacher', 'admin'].indexOf(String(payload.role)) >= 0 ? String(payload.role) : 'teacher', status = String(payload.status || 'active') === 'inactive' ? 'inactive' : 'active';
  if (!email || email.indexOf('@') < 0) throw new Error('Enter an email.');
  withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.USERS);
    lcUpsertByKeys_(sh, 'Email', { Email: email }, { Name: String(payload.name || (lcUser_(email) || {}).Name || lcNameFromEmail_(email)), Role: role, Status: status, UpdatedAt: new Date() });
    LC_X_.users = null;
  });
  return { ok: true };
}

// ============================================================================
// GRADING — one snapshot, one set of rules, used by the tiles, the marking screens,
// the gradebook, the CSVs and the Canvas push, so none of them can disagree.
// ============================================================================

/**
 * Read the class evidence once. `light` skips the big DataJson/Answers cells (tile recounts
 * every 60 s only need fingerprints and flags); legacy rows that predate the fingerprint
 * columns are filled in from the JSON so their counts are still right.
 */
function lcTeacherClassSnapshot_(classId, opts) {
  opts = opts || {};
  var light = !!opts.light, onlyEmail = opts.email ? normEmail_(opts.email) : '';
  var enr = lcEnrollments_(classId), wanted = {};
  enr.forEach(function (e) { var em = normEmail_(e.StudentEmail); if (!onlyEmail || em === onlyEmail) wanted[em] = true; });

  var groupByEmail = {};
  lcGroupRows_().forEach(function (gr) {
    var g = rowToGroup_(gr.values);
    g.memberEmails.forEach(function (m) { var em = normEmail_(m); if (wanted[em] && !groupByEmail[em]) groupByEmail[em] = g; });
  });
  function inGroup(em, gid) { return wanted[em] && groupByEmail[em] && String(groupByEmail[em].groupId) === String(gid || ''); }

  // ---- WeeklyWork
  var wsh = workSheet_(), workByKey = {};
  var wcols = ['GroupId', 'Email', 'Week', 'PrepType', 'Choices', 'UpdatedAt', 'SubmissionFp', 'SubmittedAt', 'PlanComplete', 'PlanUpdatedAt'];
  var wrows = light ? lcReadColumns_(wsh, wcols) : lcAllRows_(wsh);
  var needJson = [];
  wrows.forEach(function (r) {
    var em = normEmail_(r.Email); if (!inGroup(em, r.GroupId)) return;
    var rec = {
      prepType: String(r.PrepType || ''), choices: r.Choices ? String(r.Choices).split(',') : [], updatedAt: lcIsoValue_(r.UpdatedAt),
      fp: String(r.SubmissionFp || ''), submittedAt: lcIsoValue_(r.SubmittedAt), planComplete: r.PlanComplete === '' ? null : lcTruth_(r.PlanComplete),
      planUpdatedAt: lcIsoValue_(r.PlanUpdatedAt), _row: r._row
    };
    if (!light) { rec.data = lcParseDataRec_(r); if (rec.data._unreadable) rec.unreadable = true; }
    if (rec.fp.indexOf('fp:') !== 0 || rec.planComplete === null) needJson.push(rec);
    workByKey[em + '|' + Number(r.Week)] = rec;
  });
  if (needJson.length) {
    // Legacy rows (saved before 2026-09-26a): derive the fingerprint, plan flag and submit time.
    var dataByRow = {};
    if (light) {
      var jcols = lcReadColumns_(wsh, ['DataJson', 'DataJson2', 'DataJson3', 'DataJson4', 'DataJson5']);
      jcols.forEach(function (j) { dataByRow[j._row] = lcParseDataRec_(j); });
    }
    needJson.forEach(function (rec) {
      var data = rec.data || dataByRow[rec._row] || {};
      if (rec.fp.indexOf('fp:') !== 0) rec.fp = data._unreadable ? '' : lcSubmissionFp_(rec.prepType, rec.choices, data);
      if (rec.planComplete === null) rec.planComplete = lcDiscussionPlanComplete_(data.discussionPlan);
      if (!rec.submittedAt && rec.prepType) rec.submittedAt = data._submissionUpdatedAt ? lcIsoValue_(data._submissionUpdatedAt) : rec.updatedAt;
      if (!rec.planUpdatedAt && data.discussionPlan) rec.planUpdatedAt = rec.updatedAt;
      rec.hasPlan = !!data.discussionPlan;
    });
  }
  Object.keys(workByKey).forEach(function (k) {
    var rec = workByKey[k];
    if (rec.hasPlan === undefined) rec.hasPlan = !!rec.planUpdatedAt || !!(rec.data && rec.data.discussionPlan);
  });

  // ---- Away on Discussion Day, by group (mates of the wanted students count too)
  var awayByGroup = {};
  try {
    lcAllRows_(awaySheet_()).forEach(function (r) {
      var gid = String(r.GroupId || ''), w = Number(r.Week), em = normEmail_(r.Email); if (!gid || !(w >= 1 && w <= 4) || !em) return;
      var byW = awayByGroup[gid] = awayByGroup[gid] || {}, gw = byW[w] = byW[w] || {};
      if (lcTruth_(r.Away)) gw[em] = { by: normEmail_(r.MarkedBy), at: lcIsoValue_(r.MarkedAt) }; else delete gw[em];
    });
  } catch (eAway) { awayByGroup = {}; }

  // ---- PeerAssessments
  var peerGiven = {}, peerReceived = {};
  var pcols = ['GroupId', 'Week', 'AssessorEmail', 'AssessedEmail', 'Participation', 'Leadership', 'ActiveEngagement', 'SubmittedAt'];
  (light ? lcReadColumns_(peerSheet_(), pcols) : lcAllRows_(peerSheet_())).forEach(function (p) {
    var w = Number(p.Week), assessor = normEmail_(p.AssessorEmail), assessed = normEmail_(p.AssessedEmail);
    var rec = { assessedEmail: assessed, participation: p.Participation, leadership: p.Leadership, activeEngagement: p.ActiveEngagement, submittedAt: lcIsoValue_(p.SubmittedAt) };
    if (!light) { rec.participationComment = cellToText_(p.ParticipationComment); rec.leadershipComment = cellToText_(p.LeadershipComment); rec.activeEngagementComment = cellToText_(p.ActiveEngagementComment); }
    if (inGroup(assessor, p.GroupId)) { var gk = assessor + '|' + w; (peerGiven[gk] = peerGiven[gk] || {})[assessed] = rec; }
    if (inGroup(assessed, p.GroupId)) {
      var rk = assessed + '|' + w, r2 = {}; Object.keys(rec).forEach(function (k) { if (k !== 'assessedEmail') r2[k] = rec[k]; });
      (peerReceived[rk] = peerReceived[rk] || {})[assessor] = r2;
    }
  });

  // ---- Self ratings
  var selfByKey = {};
  lcAllRows_(selfAssessSheet_()).forEach(function (s) {
    var em = normEmail_(s.Email); if (!inGroup(em, s.GroupId)) return;
    selfByKey[em + '|' + Number(s.Week)] = { participation: String(s.Participation || ''), leadership: String(s.Leadership || ''), activeEngagement: String(s.ActiveEngagement || ''), updatedAt: lcIsoValue_(s.SubmittedAt) };
  });

  // ---- Reflections
  var reflectionByKey = {}, rsh = reflectSheet_();
  var rrows = light ? lcReadColumns_(rsh, ['GroupId', 'Email', 'Week', 'Type', 'SubmittedAt', 'AnswersFp']) : lcAllRows_(rsh);
  var needAns = [];
  rrows.forEach(function (r) {
    var em = normEmail_(r.Email); if (!inGroup(em, r.GroupId)) return;
    var rec = { type: String(r.Type || ''), updatedAt: lcIsoValue_(r.SubmittedAt), fp: String(r.AnswersFp || ''), _row: r._row };
    if (!light) { rec.answers = lcParse_(lcReflRaw_(r), {}); rec.goal = cellToText_(r.Goal); }
    if (rec.fp.indexOf('fp:') !== 0) needAns.push(rec);
    reflectionByKey[em + '|' + Number(r.Week)] = rec;
  });
  if (needAns.length) {
    var ansByRow = {};
    if (light) lcReadColumns_(rsh, ['Goal'].concat(LC_ANSWER_COLS)).forEach(function (a) { a.Answers = lcReflRaw_(a); ansByRow[a._row] = a; });
    needAns.forEach(function (rec) {
      var a = rec.answers ? { Answers: rec.answers, Goal: rec.goal } : (ansByRow[rec._row] || {});
      rec.fp = lcReflectionFp_(typeof a.Answers === 'object' ? a.Answers : lcParse_(a.Answers, {}), a.Goal);
    });
  }

  // ---- Grades (last row for a key wins — the same row saveLiteratureGrade updates)
  var gradesByKey = {};
  var gsh = lcPlatformSheet_(LC_PLATFORM_SHEETS.GRADES);
  var grows = onlyEmail ? lcReadRows_(gsh, lcFindRowNumbers_(gsh, 'StudentEmail', onlyEmail)) : lcAllRows_(gsh);
  grows.forEach(function (g) {
    if (String(g.ClassId) !== String(classId)) return;
    var em = normEmail_(g.StudentEmail); if (!wanted[em]) return;
    gradesByKey[em + '|' + String(g.ItemKey)] = lcGradeFromRow_(g);
  });

  // ---- Book history
  var historyByEmail = {};
  if (!light) {
    lcAllRows_(historySheet_()).forEach(function (h) {
      var em = normEmail_(h.Email); if (!wanted[em]) return;
      (historyByEmail[em] = historyByEmail[em] || []).push({ groupId: String(h.OldGroupId || ''), bookTitle: cellToText_(h.OldBookTitle), archivedAt: lcIsoValue_(h.ArchivedAt) });
    });
    Object.keys(historyByEmail).forEach(function (em) { historyByEmail[em].reverse(); });
  }
  return {
    classId: String(classId), enrollments: enr.filter(function (e) { return wanted[normEmail_(e.StudentEmail)]; }), groupByEmail: groupByEmail, workByKey: workByKey,
    peerGiven: peerGiven, peerReceived: peerReceived, awayByGroup: awayByGroup, selfByKey: selfByKey, reflectionByKey: reflectionByKey, gradesByKey: gradesByKey, historyByEmail: historyByEmail, light: light
  };
}

/** Fingerprint of what a student has turned in right now for a teacher-marked step
 *  (targeted reads of that student's rows only). */
function lcCurrentStageFp_(email, week, stage) {
  var group = findGroupByEmail_(email);
  if (!group) return LC_BLANK_FP;
  var gid = String(group.groupId);
  if (stage === 'submission') {
    var w = lcReadRows_(workSheet_(), lcFindRowNumbers_(workSheet_(), 'Email', email)).filter(function (r) { return String(r.GroupId) === gid && Number(r.Week) === Number(week); });
    var r = w[w.length - 1];
    if (!r || !r.PrepType) return LC_BLANK_FP;
    if (String(r.SubmissionFp || '').indexOf('fp:') === 0) return String(r.SubmissionFp);
    var d = lcParseDataRec_(r);
    return d._unreadable ? '' : lcSubmissionFp_(String(r.PrepType), r.Choices ? String(r.Choices).split(',') : [], d);
  }
  if (stage === 'reflection') {
    var rr = lcReadRows_(reflectSheet_(), lcFindRowNumbers_(reflectSheet_(), 'Email', email)).filter(function (x) { return String(x.GroupId) === gid && Number(x.Week) === Number(week); });
    var x = rr[rr.length - 1];
    if (!x) return LC_BLANK_FP;
    if (String(x.AnswersFp || '').indexOf('fp:') === 0) return String(x.AnswersFp);
    return lcReflectionFp_(lcParse_(lcReflRaw_(x), {}), x.Goal);
  }
  return '';
}

function lcGradeFromRow_(g) {
  var hasScore = g.Score !== '' && g.Score !== null && g.Score !== undefined && isFinite(Number(g.Score));
  return {
    score: hasScore ? Number(g.Score) : '', maxPoints: Number(g.MaxPoints || 0), feedback: cellToText_(g.Feedback), rubric: lcParse_(g.RubricJson, {}),
    excluded: lcTruth_(g.Excluded), updatedAt: lcIsoValue_(g.UpdatedAt), updatedBy: String(g.UpdatedBy || ''),
    markedFp: typeof g.MarkedFp === 'string' ? g.MarkedFp : '', canvasCommentFp: String(g.CanvasCommentFp || ''),
    canvasPostedScore: (g.CanvasPostedScore === '' || g.CanvasPostedScore == null) ? '' : String(g.CanvasPostedScore)
  };
}
function lcHasScore_(g) { return !!g && g.score !== '' && g.score !== null && g.score !== undefined && isFinite(Number(g.score)); }

/** A week counts as started once the student did anything in it — or once the teacher has given
 *  a mark for it (a mark survives a move to another group, so it must still count). */
function lcWeekStarted_(snap, email, week) {
  var k = email + '|' + week, w = snap.workByKey[k];
  if ((w && (w.prepType || w.hasPlan)) || Object.keys(snap.peerGiven[k] || {}).length || snap.reflectionByKey[k] || snap.selfByKey[k]) return true;
  if (lcQuizSnapshot_(snap).attempts[k]) return true;
  for (var i = 0; i < LC_STAGES.length; i++) {
    var g = snap.gradesByKey[email + '|' + lcItemKey_(week, LC_STAGES[i])];
    if (lcHasScore_(g) && !g.excluded) return true;
  }
  return false;
}

/**
 * The single source of truth for one student × week × step.
 * status (teacher steps): excluded · graded · redo · pending (turned in, not marked) · missing
 * status (automatic steps): excluded · na (no groupmates) · override · auto · notStarted
 * effective: the number that counts (null = blank, never a silent zero).
 */
function lcEvalStage_(snap, settings, email, week, stage) {
  var meta = LC_STAGE_META[stage], k = email + '|' + week, key = lcItemKey_(week, stage);
  var grade = snap.gradesByKey[email + '|' + key] || null, group = snap.groupByEmail[email] || null;
  var classExcluded = !!(settings.excluded || {})[key];
  var out = { stage: stage, week: week, itemKey: key, max: meta.max, grade: grade, classExcluded: classExcluded, excluded: classExcluded || !!(grade && grade.excluded), submitted: false, complete: false, submittedAt: '', fp: LC_BLANK_FP, redo: false, markedBlank: false, effective: null, status: '', started: lcWeekStarted_(snap, email, week) };
  var work = snap.workByKey[k] || null;
  if (stage === 'submission') {
    out.submitted = !!(work && work.prepType); out.complete = out.submitted;
    out.submittedAt = out.submitted ? (work.submittedAt || work.updatedAt) : '';
    out.fp = out.submitted ? (work.fp || '') : LC_BLANK_FP;
  } else if (stage === 'reflection') {
    var refl = snap.reflectionByKey[k] || null;
    out.submitted = !!refl; out.complete = out.submitted;
    out.submittedAt = refl ? refl.updatedAt : '';
    out.fp = refl ? (refl.fp || '') : LC_BLANK_FP;
  } else if (stage === 'preparation') {
    out.submitted = !!(work && work.hasPlan); out.complete = !!(work && work.planComplete);
    out.submittedAt = work ? (work.planUpdatedAt || '') : '';
    out.auto = out.complete ? meta.max : 0;
  } else if (stage === 'peer') {
    var mates = group ? group.memberEmails.map(normEmail_).filter(function (m) { return m && m !== email; }) : [];
    var given = snap.peerGiven[k] || {};
    // 2026-10-22b: groupmates marked away that day don't have to be rated
    var awayW = group ? (((snap.awayByGroup || {})[String(group.groupId)] || {})[week] || {}) : {};
    var present = mates.filter(function (m) { return !awayW[m]; });
    var done = present.filter(function (m) { return !!given[m]; });
    out.expected = present.length; out.given = done.length; out.mates = mates; out.givenTo = mates.filter(function (m) { return !!given[m]; });
    out.awayMates = mates.filter(function (m) { return !!awayW[m]; });
    out.missingMates = present.filter(function (m) { return !given[m]; });
    out.submitted = Object.keys(given).length > 0; out.complete = mates.length > 0 && done.length >= present.length;
    // the student who was away (and rated no one) is excused from this step
    if (awayW[email] && !Object.keys(given).length) { out.away = true; out.awayBy = awayW[email].by; if (!out.excluded) { out.excluded = true; out.awayExcused = true; } }
    Object.keys(given).forEach(function (m) { var at = given[m].submittedAt; if (at && (!out.submittedAt || lcIsLater_(at, out.submittedAt))) out.submittedAt = at; });
    out.na = mates.length === 0;
    out.auto = out.complete ? meta.max : 0;
  } else if (stage === 'quiz') {
    lcQuizEvalInto_(snap, settings, email, week, out);
  }

  if (out.excluded) { out.status = 'excluded'; return out; }
  if (meta.teacher) {
    if (lcHasScore_(grade)) {
      out.effective = Number(grade.score);
      var marked = grade.markedFp;
      if (marked && marked.indexOf('fp:') === 0) {
        out.redo = out.submitted && out.fp.indexOf('fp:') === 0 && out.fp !== LC_BLANK_FP && out.fp !== marked;
        out.markedBlank = out.redo && marked === LC_BLANK_FP;
      } else {
        // grades saved before fingerprints existed: fall back to "turned in after it was marked"
        out.redo = out.submitted && !!grade.updatedAt && !!out.submittedAt && lcIsLater_(out.submittedAt, grade.updatedAt);
      }
      out.status = out.redo ? 'redo' : 'graded';
    } else {
      out.status = out.submitted ? 'pending' : 'missing';
    }
    return out;
  }
  // automatic steps
  if (stage === 'peer' && out.na && !lcHasScore_(grade)) { out.status = 'na'; return out; }
  if (stage === 'quiz') {
    // Reading Quiz: n/a when the group has no approved quiz; blank (never 0) until it is taken.
    if (lcHasScore_(grade)) { out.effective = Number(grade.score); out.status = 'override'; return out; }
    if (out.na) { out.status = 'na'; return out; }
    if (out.complete) { out.effective = out.auto; out.status = 'auto'; return out; }
    out.status = out.submitted ? 'inProgress' : 'notTaken';
    return out;
  }
  if (lcHasScore_(grade)) { out.effective = Number(grade.score); out.status = 'override'; return out; }
  if (!out.started) { out.status = 'notStarted'; return out; }
  out.effective = out.auto; out.status = 'auto';
  return out;
}

/** Week and unit totals for one student. Only exclusions (and a peer step with nobody to rate)
 *  lower what a week is worth; the unit total counts only weeks the student has started. */
function lcStudentSummary_(snap, settings, email) {
  var weeks = [], unitEarned = 0, unitPossible = 0, unitWaiting = 0;
  for (var w = 1; w <= 4; w++) {
    var stages = {}, earned = 0, possible = 0, waiting = 0, redo = 0, started = lcWeekStarted_(snap, email, w);
    LC_STAGES.forEach(function (st) {
      var ev = lcEvalStage_(snap, settings, email, w, st);
      stages[st] = { status: ev.status, effective: ev.effective, max: ev.max, feedback: ev.grade ? ev.grade.feedback : '', redo: ev.redo, excluded: ev.excluded, classExcluded: ev.classExcluded, submitted: ev.submitted, complete: ev.complete, given: ev.given, expected: ev.expected };
      if (ev.status === 'excluded' || ev.status === 'na') return;
      possible += ev.max;
      if (ev.effective != null) earned += ev.effective;
      if (ev.status === 'pending' || ev.status === 'redo') waiting++;
      if (ev.status === 'redo') redo++;
    });
    var released = (settings.releasedWeeks || []).indexOf(w) >= 0;
    weeks.push({ week: w, stages: stages, earned: Math.round(earned * 100) / 100, possible: possible, started: started, waiting: waiting, redo: redo, released: released });
    if (started) { unitEarned += earned; unitPossible += possible; unitWaiting += waiting; }
  }
  return { weeks: weeks, earned: Math.round(unitEarned * 100) / 100, possible: unitPossible, waiting: unitWaiting, percent: unitPossible ? Math.round(unitEarned / unitPossible * 1000) / 10 : null };
}

// ---------- Gradebook / roster payload ----------

function getLiteratureTeacherDashboard(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var c = lcPublicClass_(lcClass_(id)), snap = lcTeacherClassSnapshot_(id), settings = c.settings;
  var students = snap.enrollments.map(function (e) {
    var email = normEmail_(e.StudentEmail), group = snap.groupByEmail[email] || null;
    var weeks = [1, 2, 3, 4].map(function (w) {
      var work = snap.workByKey[email + '|' + w] || null, refl = snap.reflectionByKey[email + '|' + w] || null;
      var peer = lcEvalStage_(snap, settings, email, w, 'peer');
      var recvObj = snap.peerReceived[email + '|' + w] || {}, recv = Object.keys(recvObj).map(function (k) { return recvObj[k]; });
      var total = 0, count = 0; recv.forEach(function (r) { ['participation', 'leadership', 'activeEngagement'].forEach(function (k) { var n = Number(r[k]); if (n) { total += n; count++; } }); });
      return {
        week: w, prep: !!(work && work.prepType), prepType: lcSubmissionType_(work), plan: !!(work && work.hasPlan), planComplete: !!(work && work.planComplete),
        reflection: !!refl, peerGiven: peer.given, peerExpected: peer.expected, peerComplete: peer.complete, peerAway: !!peer.away, peerAverage: count ? total / count : null, feedbackReceived: recv.length,
        submissionUpdatedAt: work ? (work.submittedAt || '') : '', reflectionUpdatedAt: refl ? refl.updatedAt : ''
      };
    });
    var gs = {}; Object.keys(snap.gradesByKey).forEach(function (k) { if (k.indexOf(email + '|') === 0) { var g = snap.gradesByKey[k]; gs[k.substring(email.length + 1)] = { score: g.score, maxPoints: g.maxPoints, feedback: g.feedback, rubric: g.rubric, excluded: g.excluded, updatedAt: g.updatedAt }; } });
    return {
      email: email, name: String(e.StudentName || lcNameFromEmail_(email)), bookTitle: group ? group.bookTitle : '', groupId: group ? String(group.groupId) : '',
      groupMembers: group ? group.memberEmails : [], weekReading: group && group.weekReading ? group.weekReading.slice() : [], archivedBooks: (snap.historyByEmail[email] || []),
      weeks: weeks, grades: gs, summary: lcStudentSummary_(snap, settings, email)
    };
  });
  var activeGroups = [], seenGroups = {};
  students.forEach(function (st) { if (st.groupId && !seenGroups[st.groupId]) { seenGroups[st.groupId] = true; activeGroups.push({ groupId: st.groupId, bookTitle: st.bookTitle || 'Untitled Book', memberEmails: (st.groupMembers || []).slice(), weekReading: (st.weekReading || []).slice() }); } });
  activeGroups.sort(function (a, b) { return String(a.bookTitle || '').localeCompare(String(b.bookTitle || '')); });
  return { ok: true, classInfo: c, students: students, activeGroups: activeGroups, rubrics: LC_RUBRICS, appVersion: lcLiveAppVersion_() };
}
function lcSubmissionType_(work) {
  if (!work || !work.prepType) return '';
  return 'strategies'; // the only kind of Step 1 in this copy
}

// ---------- Grading tiles ----------

/** Counts for the four week tiles. Light read: fingerprints and flags only, no big JSON. */
function getLiteratureGradingHub(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var c = lcPublicClass_(lcClass_(id)), settings = c.settings, snap = lcTeacherClassSnapshot_(id, { light: true });
  var emails = snap.enrollments.map(function (e) { return normEmail_(e.StudentEmail); });
  var weeks = [], needsTotal = 0, redoTotal = 0;
  for (var w = 1; w <= 4; w++) {
    var tile = { week: w, released: settings.releasedWeeks.indexOf(w) >= 0, totalStudents: emails.length, toGrade: 0, redo: 0, graded: 0, notSubmitted: 0, totalItems: 0, pointsPossible: 0, stages: {}, firstStage: '', firstRedoStage: '' };
    var excludedAll = true;
    LC_STAGES.forEach(function (st) {
      var meta = LC_STAGE_META[st], key = lcItemKey_(w, st), classEx = !!settings.excluded[key];
      var s = { key: key, max: meta.max, teacher: meta.teacher, allExcluded: classEx, submitted: 0, toGrade: 0, redo: 0, graded: 0, missing: 0, excluded: 0, complete: 0, incomplete: 0, override: 0, na: 0, notStarted: 0, inProgress: 0, notTaken: 0 };
      if (!classEx && (st !== 'quiz' || lcQuizWeekHasAny_(snap, w))) { tile.pointsPossible += meta.max; excludedAll = false; }
      emails.forEach(function (em) {
        var ev = lcEvalStage_(snap, settings, em, w, st);
        if (ev.submitted) s.submitted++;
        if (meta.teacher) {
          if (ev.status === 'redo') { s.redo++; s.toGrade++; }
          else if (ev.status === 'pending') s.toGrade++;
          else if (ev.status === 'graded') s.graded++;
          else if (ev.status === 'excluded') { s.excluded++; }
          else s.missing++;
        } else {
          if (ev.status === 'excluded') s.excluded++;
          else if (ev.status === 'na') s.na++;
          else if (ev.status === 'override') s.override++;
          else if (ev.status === 'notStarted') s.notStarted++;
          else if (ev.status === 'inProgress') s.inProgress++;
          else if (ev.status === 'notTaken') s.notTaken++;
          else if (ev.complete) s.complete++; else s.incomplete++;
        }
      });
      if (meta.teacher && !classEx) {
        tile.toGrade += s.toGrade; tile.redo += s.redo; tile.graded += s.graded + s.excluded; tile.notSubmitted += s.missing; tile.totalItems += emails.length;
        if (!tile.firstRedoStage && s.redo) tile.firstRedoStage = st;
        if (!tile.firstStage && s.toGrade) tile.firstStage = st;
      }
      if (st === 'quiz') s.quiz = lcQuizHubInfo_(snap, w, settings);
      tile.stages[st] = s;
    });
    tile.firstStage = tile.firstRedoStage || tile.firstStage || 'submission';
    tile.allExcluded = excludedAll;
    tile.schedule = {};
    LC_STAGES.forEach(function (st) {
      var k = lcCanvasAssessmentKey_(w, st), link = (settings.canvas.assignments || {})[k] || null, sch = settings.assignmentSchedule[k] || {};
      tile.schedule[st] = { dueAt: sch.dueAt || (link && link.dueAt) || '', linked: !!(link && link.assignmentId), htmlUrl: link ? (link.htmlUrl || '') : '', lastGradeSyncAt: link ? (link.lastGradeSyncAt || '') : '' };
    });
    if (!tile.allExcluded) { needsTotal += tile.toGrade; redoTotal += tile.redo; }
    weeks.push(tile);
  }
  return { ok: true, classId: id, totalStudents: emails.length, weeks: weeks, needsGradingTotal: needsTotal, needsRegradeTotal: redoTotal, canvas: { courseId: settings.canvas.courseId || '', courseName: settings.canvas.courseName || '' }, settings: settings, checkedAt: new Date().toISOString() };
}

// ---------- Marking screens ----------

function getLiteratureWeekAssessmentResponses(payload) {
  payload = payload || {};
  var id = String(payload.classId || ''), week = lcWeek_(payload.week || 1), stage = String(payload.stage || 'submission');
  lcRequireClass_(id);
  if (LC_STAGES.indexOf(stage) < 0) throw new Error('Invalid assessment stage.');
  var c = lcPublicClass_(lcClass_(id)), settings = c.settings, snap = lcTeacherClassSnapshot_(id);
  var nameOf = {}; snap.enrollments.forEach(function (e) { nameOf[normEmail_(e.StudentEmail)] = String(e.StudentName || lcNameFromEmail_(e.StudentEmail)); });
  var wsByKey = {}; try { wsByKey = lcWritingStatsByKey_(snap); } catch (wsErr) { wsByKey = {}; } // stats never block marking
  var responses = snap.enrollments.map(function (e) {
    var email = normEmail_(e.StudentEmail), group = snap.groupByEmail[email] || null, k = email + '|' + week;
    var ev = lcEvalStage_(snap, settings, email, week, stage);
    var work = snap.workByKey[k] || null, reflection = snap.reflectionByKey[k] || null;
    var recvObj = snap.peerReceived[k] || {}, peerFeedback = Object.keys(recvObj).map(function (x) { return recvObj[x]; });
    var row = {
      email: email, name: nameOf[email], bookTitle: group ? group.bookTitle : '', reading: group && group.weekReading ? String(group.weekReading[week - 1] || '') : '',
      groupMembers: group ? group.memberEmails.map(normEmail_).filter(function (m) { return m !== email; }).map(function (m) { return nameOf[m] || lcNameFromEmail_(m); }) : [],
      stage: stage, status: ev.status, submitted: ev.submitted, complete: ev.complete, submittedAt: ev.submittedAt, resubmitted: ev.redo, redo: ev.redo, markedBlank: ev.markedBlank, fp: ev.fp || '',
      excluded: ev.excluded, classExcluded: ev.classExcluded, effective: ev.effective, auto: ev.auto, na: !!ev.na, started: ev.started,
      grade: ev.grade ? { score: ev.grade.score, feedback: ev.grade.feedback, rubric: ev.grade.rubric, excluded: ev.grade.excluded, updatedAt: ev.grade.updatedAt } : null,
      writing: lcWritingForStage_(wsByKey[k], stage)
    };
    if (stage === 'submission') {
      row.prepType = lcSubmissionType_(work);
      row.work = work && work.prepType ? { prepType: work.prepType, choices: work.choices, data: lcStripMeta_(work.data), unreadable: !!work.unreadable } : null;
    } else if (stage === 'preparation') {
      row.plan = work && work.data ? (work.data.discussionPlan || null) : null;
    } else if (stage === 'peer') {
      row.given = ev.given; row.expected = ev.expected;
      row.givenTo = (ev.givenTo || []).map(function (m) { return nameOf[m] || lcNameFromEmail_(m); });
      row.missingMates = (ev.missingMates || []).map(function (m) { return nameOf[m] || lcNameFromEmail_(m); });
      row.awayMates = (ev.awayMates || []).map(function (m) { return nameOf[m] || lcNameFromEmail_(m); });
      row.away = !!ev.away; row.awayBy = ev.awayBy ? (nameOf[ev.awayBy] || lcNameFromEmail_(ev.awayBy)) : '';
      row.selfAssessment = snap.selfByKey[k] || null;
      var givenObj = snap.peerGiven[k] || {};
      row.ratingsGiven = Object.keys(givenObj).map(function (m) { var r = givenObj[m]; return { to: nameOf[m] || lcNameFromEmail_(m), toEmail: m, participation: r.participation, leadership: r.leadership, activeEngagement: r.activeEngagement, comments: [r.participationComment, r.leadershipComment, r.activeEngagementComment].filter(function (x) { return x; }), commentsByKey: { participation: r.participationComment || '', leadership: r.leadershipComment || '', activeEngagement: r.activeEngagementComment || '' } }; });
    } else if (stage === 'quiz') {
      row.quiz = lcQuizResultForTeacher_(snap, settings, email, week);
      row.finished = !!ev.finished;
    } else if (stage === 'reflection') {
      row.reflection = reflection ? { type: reflection.type, answers: reflection.answers, goal: reflection.goal, updatedAt: reflection.updatedAt } : null;
      row.selfAssessment = snap.selfByKey[k] || null;
      row.peerFeedback = peerFeedback;
    }
    return row;
  });
  return { ok: true, classId: id, week: week, stage: stage, responses: responses, rubrics: LC_RUBRICS, settings: { excluded: settings.excluded, releasedWeeks: settings.releasedWeeks, quizOpen: settings.quizOpen } };
}
function lcStripMeta_(data) {
  var d = {}; Object.keys(data || {}).forEach(function (k) { if (k !== 'discussionPlan' && k.charAt(0) !== '_') d[k] = data[k]; }); return d;
}

/**
 * Save one mark. Only the fields present in the payload change (score, feedback, excluded,
 * rubric). A new score re-includes an item unless `excluded` is sent too, and records the
 * fingerprint of the work being marked so a later rewrite is flagged "redone".
 */
function saveLiteratureGrade(payload) {
  payload = payload || {};
  var classId = String(payload.classId || ''), email = normEmail_(payload.studentEmail), itemKey = String(payload.itemKey || '');
  var t = lcRequireClass_(classId);
  var parsed = lcParseItemKey_(itemKey);
  if (!parsed) throw new Error('Missing or unknown grade item.');
  if (!lcIsEnrolled_(classId, email)) throw new Error('Student is not enrolled in this class.');
  var meta = LC_STAGE_META[parsed.stage], max = meta.max;
  var has = function (k) { return Object.prototype.hasOwnProperty.call(payload, k); };
  var fields = { MaxPoints: max, UpdatedAt: new Date(), UpdatedBy: t.email };
  if (has('score')) {
    var s = payload.score;
    if (s === '' || s === null) { fields.Score = ''; fields.MarkedFp = ''; }
    else {
      var n = Math.round(Number(s) * 100) / 100;
      if (!isFinite(n) || n < 0 || n > max) throw new Error('Score must be between 0 and ' + max + '.');
      fields.Score = n;
      if (!has('excluded')) fields.Excluded = false;
      // The version the teacher was looking at when they marked it (sent by the marking screen),
      // so a rewrite that lands while they read is still flagged "redone".
      if (meta.teacher) fields.MarkedFp = (typeof payload.markedFp === 'string' && payload.markedFp.indexOf('fp:') === 0) ? payload.markedFp : lcCurrentStageFp_(email, parsed.week, parsed.stage);
    }
  }
  if (!has('score') && meta.teacher) {
    // A comment- or exclusion-only save of a mark made before fingerprints existed must not
    // clear a genuine "redone" flag just because the row's UpdatedAt moves: pin the flag now.
    var pre = lcTeacherClassSnapshot_(classId, { light: true, email: email });
    var pg = pre.gradesByKey[email + '|' + itemKey];
    if (pg && lcHasScore_(pg) && !(pg.markedFp && pg.markedFp.indexOf('fp:') === 0)) {
      var pev = lcEvalStage_(pre, lcNormalizeClassSettings_({}), email, parsed.week, parsed.stage);
      fields.MarkedFp = pev.redo ? 'fp:before-rewrite' : (pev.submitted ? (pev.fp || '') : LC_BLANK_FP);
    }
  }
  if (has('feedback')) fields.Feedback = String(payload.feedback || '');
  if (has('excluded')) fields.Excluded = !!payload.excluded;
  if (has('rubric')) fields.RubricJson = JSON.stringify(payload.rubric || {});
  // prevFeedback: the comment this teacher's screen last had from the sheet. If the sheet now holds
  // a different comment (another tab, or a co-teacher), the save is refused instead of replacing it.
  var checkPrev = has('feedback') && has('prevFeedback');
  function same(a, b) { return String(a == null ? '' : a).replace(/\r\n?/g, '\n').trim() === String(b == null ? '' : b).replace(/\r\n?/g, '\n').trim(); }
  var saved;
  withLock_(function () {
    var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.GRADES);
    var res = lcUpsertByKeys_(sh, 'StudentEmail', { ClassId: classId, StudentEmail: email, ItemKey: itemKey }, function (rec) {
      if (checkPrev) {
        var cur = rec ? cellToText_(rec.Feedback) : '';
        var okPrev = [].concat(payload.prevFeedback).some(function (p) { return same(cur, p); }); // this tab's own earlier copies count as seen
        if (!okPrev && !same(cur, payload.feedback)) {
          throw new Error('Changed elsewhere: this comment was edited in another tab or by another teacher after your screen loaded it. It now reads: "' + cur.slice(0, 160) + (cur.length > 160 ? '…' : '') + '". Your comment is still in its box — press Retry to save yours over it.');
        }
      }
      return fields;
    });
    saved = res.record;
  });
  return { ok: true, itemKey: itemKey, grade: lcGradeFromRow_(saved) };
}

// ---------- Teacher feedback for the student (2026-10-22a) ----------
// A student sees a step's score and the teacher's comment in the app's Feedback page once they
// have been pushed to Canvas -- the same thing the student can see in Canvas. Score = the score
// Canvas has (CanvasPostedScore; 'EX' = excused). Comment = the current comment, only while it is
// the version that was posted (CanvasCommentFp ends with its md5); a comment edited after the
// last push stays hidden until the next push. Nothing is shown for marking that wasn't pushed.
function lcStudentTeacherFeedback_(email) {
  email = normEmail_(email);
  var classes = lcEnrollmentsForStudent_(email), out = {};
  if (!classes.length) return out;
  var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.GRADES), byKey = {};
  lcReadRows_(sh, lcFindRowNumbers_(sh, 'StudentEmail', email)).forEach(function (g) {
    if (classes.indexOf(String(g.ClassId)) < 0 || normEmail_(g.StudentEmail) !== email) return;
    if (!lcParseItemKey_(g.ItemKey)) return;
    byKey[String(g.ClassId) + '|' + String(g.ItemKey)] = g; // last row for a key wins
  });
  Object.keys(byKey).forEach(function (k) {
    var row = byKey[k], p = lcParseItemKey_(row.ItemKey), meta = LC_STAGE_META[p.stage], g = lcGradeFromRow_(row);
    var posted = String(g.canvasPostedScore || '').replace(/^'+/, '').trim(), text = String(g.feedback || '').trim();
    var comment = !!text && !!g.canvasCommentFp && g.canvasCommentFp.slice(-13) === ':' + lcMd5Hex_(text).slice(0, 12);
    var item = { stage: p.stage, title: meta.title, step: meta.step, max: meta.max };
    if (posted === 'EX') item.excused = true;
    else if (posted !== '' && isFinite(Number(posted))) item.score = Number(posted);
    if (comment) item.comment = text;
    if (item.excused || item.score !== undefined || item.comment) (out[p.week] = out[p.week] || []).push(item);
  });
  Object.keys(out).forEach(function (w) { out[w].sort(function (a, b) { return LC_STAGES.indexOf(a.stage) - LC_STAGES.indexOf(b.stage); }); });
  return out;
}
/** The Feedback page asks again when it opens, so a push shows up without reloading. */
function getMyLiteratureFeedback(email) {
  email = lcActingEmail_(email);
  return { ok: true, teacherFeedback: lcStudentTeacherFeedback_(email) };
}

/** Leave a whole week (or one step of it) out for the class — or count it again. Marks are kept. */
function setLiteratureGradeForClass(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcRequireClass_(id);
  var stages = payload.stage ? [String(payload.stage)] : LC_STAGES;
  stages.forEach(function (s) { if (LC_STAGES.indexOf(s) < 0) throw new Error('Invalid assessment stage.'); });
  var excluded = !!payload.excluded, keys = stages.map(function (s) { return lcItemKey_(week, s); });
  var settings = lcMutateClassSettings_(id, function (st) {
    st.excluded = st.excluded || {};
    keys.forEach(function (k) { if (excluded) st.excluded[k] = true; else delete st.excluded[k]; });
  });
  return { ok: true, excluded: excluded, itemKeys: keys, settings: settings };
}

/** Open or hide one week for students (a fresh read under the lock — never a stale array). */
/** Unit setup (Teacher dashboard): books and strategies for this class. Work already started keeps
 *  its strategies. With one book, every group of this class is moved onto that book and its four
 *  sections (titles and chapter ranges only — nobody's writing changes). */
function saveLiteratureUnitPlan(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var raw = payload.plan || {}, plan = lcNormalizePlan_(raw);
  if (raw.bookMode !== 'single' && raw.bookMode !== 'multiple') throw new Error('Choose one book or different books.');
  if (raw.strategyMode !== 'same' && raw.strategyMode !== 'rotate') throw new Error('Choose the same strategies or rotating roles.');
  if (plan.bookMode === 'single') {
    if (!plan.book.title) throw new Error('Type the book’s title.');
    var missing = []; plan.book.reading.forEach(function (r, i) { if (!r) missing.push(i + 1); });
    if (missing.length) throw new Error('Type the reading for Week ' + missing.join(', ') + ' (for example "Ch. 1–6").');
  }
  var bad = [];
  if (plan.strategyMode === 'same') [1, 2, 3, 4].forEach(function (w) { if (!lcValidPair_(raw.weeks && raw.weeks[w])) bad.push('Week ' + w); });
  else [0, 1, 2, 3].forEach(function (i) { if (!lcValidPair_(raw.pairs && raw.pairs[i])) bad.push('Pair ' + (i + 1)); });
  if (bad.length) throw new Error(bad.join(', ') + ': pick two different strategies.');
  var settings = lcMutateClassSettings_(id, function (st) { st.plan = plan; });
  var moved = 0;
  if (lcPlanSingle_(plan)) moved = withLock_(function () {
    var inClass = {}; lcEnrollments_(id).forEach(function (e) { inClass[normEmail_(e.StudentEmail)] = true; });
    var sh = groupsSheet_(), n = 0;
    lcInvalidateGroups_();
    lcGroupRows_().forEach(function (g) {
      var members = String(g.values[2] || '').split(',').map(normEmail_).filter(Boolean);
      if (!members.some(function (m) { return inClass[m]; })) return;
      var want = [plan.book.title].concat(plan.book.reading), have = [cellToText_(g.values[1]), cellToText_(g.values[3]), cellToText_(g.values[4]), cellToText_(g.values[5]), cellToText_(g.values[6])];
      if (want.join('|') === have.join('|')) return;
      sh.getRange(g.row, 2).setNumberFormat('@').setValue(plan.book.title);
      sh.getRange(g.row, 4, 1, 4).setNumberFormat('@').setValues([plan.book.reading.slice()]);
      n++;
    });
    lcInvalidateGroups_();
    return n;
  });
  return { ok: true, settings: settings, groupsUpdated: moved };
}

function setLiteratureWeekRelease(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), week = lcWeek_(payload.week || 1), on = !!payload.released;
  lcRequireClass_(id);
  var settings = lcMutateClassSettings_(id, function (st) {
    var arr = (st.releasedWeeks || []).filter(function (w) { return w !== week; });
    if (on) arr.push(week);
    st.releasedWeeks = arr.sort();
  });
  return { ok: true, settings: settings };
}

function saveLiteratureClassSettings(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var settings = lcMutateClassSettings_(id, function (st) {
    if (payload.releasedWeeks) st.releasedWeeks = payload.releasedWeeks.map(Number).filter(function (n) { return n >= 1 && n <= 4; }).sort();
    if (payload.dueDates) st.dueDates = payload.dueDates;
    if (payload.teacherResources != null) st.teacherResources = !!payload.teacherResources;
  });
  return { ok: true, settings: settings };
}

/** Everything the teacher's "View work" panel needs for one student. */
function getLiteratureStudentGradingDetail(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), email = normEmail_(payload.studentEmail);
  lcRequireClass_(id);
  if (!lcIsEnrolled_(id, email)) throw new Error('Student is not enrolled in this class.');
  var s = getState(email), c = lcPublicClass_(lcClass_(id)), snap = lcTeacherClassSnapshot_(id, { email: email });
  var gradeMap = {}; Object.keys(snap.gradesByKey).forEach(function (k) { var g = snap.gradesByKey[k]; gradeMap[k.split('|')[1]] = { score: g.score, maxPoints: g.maxPoints, rubric: g.rubric, feedback: g.feedback, excluded: g.excluded }; });
  return { ok: true, email: email, name: lcNameFromEmail_(email), state: s, grades: gradeMap, rubrics: LC_RUBRICS, summary: lcStudentSummary_(snap, c.settings, email) };
}

// ---------- CSV ----------

function lcCsv_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) {
      var x = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(x) && !/^-?\d/.test(x)) x = "'" + x; // formula-injection guard
      return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
    }).join(',');
  }).join('\r\n');
}

/** Full-class CSV, from the same summary the gradebook shows. EX = left out; blank = not graded yet. */
function exportLiteratureGradesCsv(payload) {
  payload = payload || {}; var id = String(payload.classId || '');
  lcRequireClass_(id);
  var c = lcPublicClass_(lcClass_(id)), snap = lcTeacherClassSnapshot_(id, { light: true });
  var head = ['Student', 'Email', 'Book'];
  for (var w = 1; w <= 4; w++) LC_STAGES.forEach(function (st) { head.push('W' + w + ' ' + LC_STAGE_META[st].short + ' /' + LC_STAGE_META[st].max); });
  head.push('Weeks Started', 'Earned', 'Possible', 'Percent', 'Waiting to be marked');
  var rows = [head];
  snap.enrollments.forEach(function (e) {
    var email = normEmail_(e.StudentEmail), g = snap.groupByEmail[email], sum = lcStudentSummary_(snap, c.settings, email);
    var row = [String(e.StudentName || lcNameFromEmail_(email)), email, g ? g.bookTitle : ''], started = 0;
    sum.weeks.forEach(function (wk) {
      if (wk.started) started++;
      LC_STAGES.forEach(function (st) {
        var s = wk.stages[st];
        row.push(s.status === 'excluded' ? 'EX' : s.status === 'na' ? 'N/A' : (s.effective == null ? '' : s.effective));
      });
    });
    row.push(started, sum.earned, sum.possible, sum.percent == null ? '' : sum.percent, sum.waiting);
    rows.push(row);
  });
  return { ok: true, filename: (c.className || 'Lit Circles') + (c.period ? ' P' + c.period : '') + ' - Grades.csv', csv: lcCsv_(rows) };
}

// ============================================================================
// CANVAS GRADEBOOK INTEGRATION (2026-09-18)
// Credentials live only in each signed-in teacher's User Properties. Literature
// Circles class/course links, week assignments, due dates, and module choices
// live in LC_Classes SettingsJson so the class remembers its Canvas destination.
// ============================================================================
var LC_CANVAS_BASE_URL_USER_PROP = 'LITCIRCLES_CANVAS_BASE_URL';
var LC_CANVAS_TOKEN_USER_PROP = 'LITCIRCLES_CANVAS_TOKEN';

function lcNormalizeCanvasBaseUrl_(value){
  var s=String(value||'').trim().replace(/\/+$/,'');
  if(!s) throw new Error('Enter your Canvas URL, for example https://school.instructure.com.');
  if(!/^https:\/\//i.test(s)) s='https://'+s.replace(/^https?:\/\//i,'');
  s=s.replace(/\/api\/v1$/i,'');
  return s;
}
function lcCanvasConnection_(){
  var p=PropertiesService.getUserProperties();
  var baseUrl=String(p.getProperty(LC_CANVAS_BASE_URL_USER_PROP)||'').trim();
  var token=String(p.getProperty(LC_CANVAS_TOKEN_USER_PROP)||'').trim();
  return {baseUrl:baseUrl,token:token,connected:!!(baseUrl&&token)};
}
function lcCanvasErrorMessage_(body,fallback){
  try{var j=JSON.parse(String(body||''));if(Array.isArray(j.errors)&&j.errors.length)return j.errors.map(function(e){return e.message||e.error||String(e);}).join('; ');if(j.message)return j.message;if(j.error)return typeof j.error==='string'?j.error:JSON.stringify(j.error);}catch(e){}
  return String(body||fallback||'Canvas request failed.').slice(0,700);
}
function lcCanvasRequestWith_(conn,method,path,payload){
  if(!conn||!conn.baseUrl||!conn.token) throw new Error('Canvas is not connected for this teacher yet.');
  var url=/^https:\/\//i.test(path)?path:conn.baseUrl+path;
  if(url.indexOf(conn.baseUrl)!==0) throw new Error('Canvas returned an unexpected URL.');
  var opt={method:String(method||'get').toLowerCase(),headers:{Authorization:'Bearer '+conn.token,Accept:'application/json'},muteHttpExceptions:true,followRedirects:true};
  if(payload&&Object.keys(payload).length) opt.payload=payload;
  var res=UrlFetchApp.fetch(url,opt),status=res.getResponseCode(),body=res.getContentText();
  if(status<200||status>=300){var err=new Error('Canvas '+status+': '+lcCanvasErrorMessage_(body,res.getStatusLine&&res.getStatusLine()));err.canvasStatus=status;throw err;}
  if(!body)return{};try{return JSON.parse(body);}catch(e){return{raw:body};}
}
function lcCanvasRequest_(method,path,payload){return lcCanvasRequestWith_(lcCanvasConnection_(),method,path,payload);}

function saveLiteratureCanvasConnection(payload){
  lcRequireTeacher_();payload=payload||{};var existing=lcCanvasConnection_();
  var baseUrl=lcNormalizeCanvasBaseUrl_(payload.baseUrl||existing.baseUrl),token=String(payload.token||existing.token||'').trim();
  if(!token)throw new Error('Paste a Canvas access token. It stays private in your Apps Script user properties.');
  var conn={baseUrl:baseUrl,token:token},profile=lcCanvasRequestWith_(conn,'get','/api/v1/users/self/profile');
  var p=PropertiesService.getUserProperties();p.setProperty(LC_CANVAS_BASE_URL_USER_PROP,baseUrl);p.setProperty(LC_CANVAS_TOKEN_USER_PROP,token);
  return {ok:true,connected:true,baseUrl:baseUrl,profile:{id:profile.id,name:profile.name||profile.short_name||'',email:profile.primary_email||profile.email||''}};
}
function clearLiteratureCanvasConnection(){lcRequireTeacher_();var p=PropertiesService.getUserProperties();p.deleteProperty(LC_CANVAS_BASE_URL_USER_PROP);p.deleteProperty(LC_CANVAS_TOKEN_USER_PROP);return{ok:true};}
function getLiteratureCanvasConnectionStatus(){
  lcRequireTeacher_();var conn=lcCanvasConnection_();if(!conn.connected)return{ok:true,connected:false};
  try{var profile=lcCanvasRequestWith_(conn,'get','/api/v1/users/self/profile');return{ok:true,connected:true,valid:true,baseUrl:conn.baseUrl,profile:{id:profile.id,name:profile.name||profile.short_name||'',email:profile.primary_email||profile.email||''}};}catch(e){return{ok:true,connected:true,valid:false,baseUrl:conn.baseUrl,message:e.message};}
}
function listLiteratureCanvasCourses(){lcRequireTeacher_();var rows=lcCanvasRequest_('get','/api/v1/courses?enrollment_type=teacher&per_page=100&include[]=term');return{ok:true,courses:(Array.isArray(rows)?rows:[]).map(function(c){return{id:String(c.id),name:c.name||c.course_code||('Course '+c.id),courseCode:c.course_code||'',workflowState:c.workflow_state||'',term:c.term&&c.term.name?c.term.name:''};})};}
function listLiteratureCanvasAssignmentGroups(payload){lcRequireTeacher_();var courseId=String((payload||{}).courseId||'');if(!courseId)throw new Error('Choose a Canvas course first.');var rows=lcCanvasRequest_('get','/api/v1/courses/'+encodeURIComponent(courseId)+'/assignment_groups?per_page=100');return{ok:true,groups:(Array.isArray(rows)?rows:[]).map(function(g){return{id:String(g.id),name:g.name||('Group '+g.id),position:g.position||0};})};}
function listLiteratureCanvasModules(payload){lcRequireTeacher_();var courseId=String((payload||{}).courseId||'');if(!courseId)throw new Error('Choose a Canvas course first.');var rows=lcCanvasRequest_('get','/api/v1/courses/'+encodeURIComponent(courseId)+'/modules?per_page=100');return{ok:true,modules:(Array.isArray(rows)?rows:[]).filter(function(m){return m.workflow_state!=='deleted';}).map(function(m){return{id:String(m.id),name:m.name||('Module '+m.id),position:Number(m.position||0),published:m.published!==false};}).sort(function(a,b){return(a.position-b.position)||a.name.localeCompare(b.name);})};}

function lcSyncCanvasModuleItem_(courseId,assignment,desiredModuleId,desiredModuleName,oldLink,title,published){
  desiredModuleId=String(desiredModuleId||'');oldLink=oldLink||{};var oldModuleId=String(oldLink.moduleId||''),oldItemId=String(oldLink.moduleItemId||''),assignmentId=String((assignment||{}).id||''),oldAssignmentId=String(oldLink.assignmentId||''),encCourse=encodeURIComponent(courseId);
  function del(){if(!oldModuleId||!oldItemId)return;try{lcCanvasRequest_('delete','/api/v1/courses/'+encCourse+'/modules/'+encodeURIComponent(oldModuleId)+'/items/'+encodeURIComponent(oldItemId));}catch(e){if(e.canvasStatus!==404)throw e;}oldModuleId='';oldItemId='';}
  if(oldAssignmentId&&assignmentId&&oldAssignmentId!==assignmentId)del();
  if(!desiredModuleId){del();return{moduleId:'',moduleName:'',moduleItemId:''};}
  var moduleObj=lcCanvasRequest_('get','/api/v1/courses/'+encCourse+'/modules/'+encodeURIComponent(desiredModuleId)),moduleName=moduleObj.name||String(desiredModuleName||''),itemForm={'module_item[title]':title},item=null;if(published)itemForm['module_item[published]']='true';
  if(oldItemId&&oldModuleId){try{var path='/api/v1/courses/'+encCourse+'/modules/'+encodeURIComponent(oldModuleId)+'/items/'+encodeURIComponent(oldItemId),update=Object.assign({},itemForm);if(oldModuleId!==desiredModuleId)update['module_item[module_id]']=desiredModuleId;item=lcCanvasRequest_('put',path,update);}catch(e){if(e.canvasStatus!==404)throw e;oldItemId='';oldModuleId='';}}
  if(!item){item=lcCanvasRequest_('post','/api/v1/courses/'+encCourse+'/modules/'+encodeURIComponent(desiredModuleId)+'/items',{'module_item[title]':title,'module_item[type]':'Assignment','module_item[content_id]':assignmentId});try{item=lcCanvasRequest_('put','/api/v1/courses/'+encCourse+'/modules/'+encodeURIComponent(desiredModuleId)+'/items/'+encodeURIComponent(item.id),itemForm);}catch(e){}}
  return{moduleId:desiredModuleId,moduleName:moduleName,moduleItemId:String(item.id||oldItemId||'')};
}

// 2026-10-18f -- module placement for "Due dates & Canvas… > Save".
// (1) Two classes linked to the same Canvas course share each assignment. Each class used to add its
//     own module item, so the module showed every assignment twice. Now, when another class in the
//     course already has this assignment in the chosen module, this class reuses that item.
// (2) A step that was never placed (e.g. the Reading Quiz, made after the others) goes into the
//     module the rest of the week is in, even if the module box wasn't changed.
// 2026-10-18g -- an assignment deleted in Canvas is made again. The app kept the link to the deleted
// assignment, so "Due dates & Canvas… > Save" and Push kept updating something that no longer
// exists. Now every Save, Push and opening of the due-date window first asks Canvas whether each of
// the week's linked assignments still exists. A deleted one is forgotten -- by this class and by any
// other class in the same course that shares it (and by the LMS Hub) -- so the next Save or Push
// makes it again, in the module the week was in (remembered in canvas.weekModules).
/** True when Canvas says this assignment was deleted (404, or workflow_state "deleted"). Any other
 *  answer (an error, no connection) counts as "still there", so a hiccup never drops a link. */
function lcCanvasAssignmentDeleted_(classId, c, key, link) {
  var conn = lcCanvasConnection_();
  if (conn.connected) {
    try {
      var a = lcCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId));
      return !!a && String(a.workflow_state || '') === 'deleted';
    } catch (e) { return !!e && e.canvasStatus === 404; }
  }
  if (typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_()) {
    try { lcHub_(function () { return LmsHub.assignment(classId, key, true, lcRequireTeacher_().email); }); return false; }
    catch (e2) { return !!e2 && e2.lmsStatus === 404; }
  }
  return false;
}
/** Forget the week's Canvas assignments that were deleted in Canvas. Returns the step titles. */
function lcCanvasForgetDeleted_(classId, week, stages) {
  var raw = lcClass_(classId); if (!raw) return [];
  var c = lcNormalizeClassSettings_(raw.SettingsJson).canvas || {};
  if (!c.courseId) return [];
  var deadIds = {}, gone = [];
  (stages || LC_STAGES).forEach(function (st) {
    var key = lcCanvasAssessmentKey_(week, st), l = (c.assignments || {})[key];
    if (!l || !l.assignmentId) return;
    var id = String(l.assignmentId);
    if (deadIds[id] || lcCanvasAssignmentDeleted_(classId, c, key, l)) { deadIds[id] = true; gone.push(LC_STAGE_META[st].title); }
  });
  if (!gone.length) return [];
  var hub = typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_();
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).slice().forEach(function (k) {
    var kc = lcNormalizeClassSettings_(k.SettingsJson).canvas || {};
    if (String(kc.courseId || '') !== String(c.courseId)) return;
    var keys = Object.keys(kc.assignments || {}).filter(function (key) { return deadIds[String((kc.assignments[key] || {}).assignmentId || '')]; });
    if (!keys.length) return;
    if (hub) keys.forEach(function (key) { try { lcHub_(function () { return LmsHub.forgetAssignment(String(k.ClassId), key, normEmail_(k.TeacherEmail)); }); } catch (e) {} });
    lcMutateClassSettings_(String(k.ClassId), function (s) {
      if (String((s.canvas || {}).courseId || '') !== String(c.courseId)) return;
      s.canvas.weekModules = s.canvas.weekModules || {};
      keys.forEach(function (key) {
        var l = (s.canvas.assignments || {})[key] || {}, km = /^assessment:([1-4]):/.exec(key);
        if (!deadIds[String(l.assignmentId || '')]) return;
        if (km && l.moduleId && !s.canvas.weekModules[km[1]]) s.canvas.weekModules[km[1]] = { moduleId: String(l.moduleId), moduleName: String(l.moduleName || '') };
        delete s.canvas.assignments[key];
      });
    });
  });
  return gone;
}

function lcRemadeNote_(remade, notMade) {
  if (!remade || !remade.length) return [];
  var what = remade.length === 1 ? remade[0] + ' was' : remade.join(', ') + ' were';
  return [what + ' deleted in Canvas. ' + (notMade ? 'Push all doesn’t make assignments: Save in Due dates & Canvas… (or Push that tile) to make ' + (remade.length === 1 ? 'it' : 'them') + ' again.' : (remade.length === 1 ? 'It was' : 'They were') + ' made again; scores and comments go to the new assignment.')];
}
/** Another class in the same course whose link for `key` exists (the hub/adopt shares it). */
function lcSiblingCanvasLink_(classId, courseId, key) {
  var out = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (k) {
    if (out || String(k.ClassId) === String(classId)) return;
    var c = lcNormalizeClassSettings_(k.SettingsJson).canvas || {};
    var l = String(c.courseId || '') === String(courseId) ? (c.assignments || {})[key] : null;
    if (l && l.assignmentId) out = l;
  });
  return out;
}
/** A module item another class in the course already has for this assignment in this module. */
function lcSiblingModuleItem_(classId, courseId, assignmentId, moduleId) {
  var out = null;
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (k) {
    if (out || String(k.ClassId) === String(classId)) return;
    var c = lcNormalizeClassSettings_(k.SettingsJson).canvas || {};
    if (String(c.courseId || '') !== String(courseId)) return;
    Object.keys(c.assignments || {}).forEach(function (key) {
      var l = c.assignments[key] || {};
      if (!out && String(l.assignmentId || '') === String(assignmentId) && String(l.moduleId || '') === String(moduleId) && l.moduleItemId) out = { moduleId: String(l.moduleId), moduleName: String(l.moduleName || ''), moduleItemId: String(l.moduleItemId) };
    });
  });
  return out;
}
/** What to do about the module for one step: {} = leave it; {moduleId, moduleName} = place it there;
 *  {adopt: {moduleId, moduleName, moduleItemId}} = another class already placed this assignment there. */
function lcCanvasModulePlan_(classId, c, week, key, payload, assignmentId) {
  var links = c.assignments || {}, own = links[key] || {}, want, wantName = '';
  if (payload.moduleId !== undefined) { want = String(payload.moduleId || ''); wantName = String(payload.moduleName || ''); }
  else if (!own.moduleItemId) {
    Object.keys(links).forEach(function (k) {
      var l = links[k] || {};
      if (want === undefined && k !== key && /^assessment:/.test(k) && Number(l.week) === Number(week) && l.moduleId) { want = String(l.moduleId); wantName = String(l.moduleName || ''); }
    });
  }
  if (want === undefined && !own.moduleItemId && payload.moduleId === undefined) {
    var wm = (c.weekModules || {})[String(week)];
    if (wm && wm.moduleId) { want = String(wm.moduleId); wantName = String(wm.moduleName || ''); }
  }
  if (want === undefined) return {};
  if (want && assignmentId && !(own.moduleItemId && String(own.moduleId || '') === want)) {
    var sib = lcSiblingModuleItem_(classId, c.courseId, assignmentId, want);
    if (sib) return { adopt: sib };
  }
  return { moduleId: want, moduleName: wantName };
}

function lcCanvasTeacherContext_(classId) {
  var t = lcRequireTeacher_(), raw = lcClass_(classId); if (!raw) throw new Error('Class not found.');
  if (!lcTeacherOwnsClass_(classId, t)) throw new Error('You do not manage this class.');
  return { teacher: t, classInfo: lcPublicClass_(raw), settings: lcNormalizeClassSettings_(raw.SettingsJson) };
}
function lcCanvasWeekReleased_(week, settings) { return (settings.releasedWeeks || []).indexOf(Number(week)) >= 0; }
function lcAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

function linkLiteratureCanvasCourse(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''); lcCanvasTeacherContext_(classId);
  var courseId = String(payload.courseId || ''); if (!courseId) throw new Error('Choose a Canvas course.');
  var course = lcCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId)), groupId = String(payload.assignmentGroupId || ''), groupName = '';
  if (groupId) { var g = lcCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(groupId)); groupName = g.name || String(payload.assignmentGroupName || ''); }
  var settings = lcMutateClassSettings_(classId, function (s) {
    var old = s.canvas || {};
    s.canvas = { courseId: courseId, courseName: course.name || String(payload.courseName || ''), assignmentGroupId: groupId, assignmentGroupName: groupName, assignments: String(old.courseId || '') === courseId ? (old.assignments || {}) : {} };
  });
  return { ok: true, canvas: settings.canvas, settings: settings };
}
function unlinkLiteratureCanvasCourse(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''); lcCanvasTeacherContext_(classId);
  var settings = lcMutateClassSettings_(classId, function (s) { s.canvas = { courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: '', assignments: {} }; });
  return { ok: true, settings: settings };
}

/** Every page of a Canvas list (follows the Link: rel="next" header). */
function lcCanvasGetAll_(path) {
  var conn = lcCanvasConnection_();
  if (!conn.connected) throw new Error('Canvas is not connected for this teacher yet.');
  var url = conn.baseUrl + path, out = [], guard = 0;
  while (url && guard++ < 30) {
    if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected URL.');
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true });
    var status = res.getResponseCode(), body = res.getContentText();
    if (status < 200 || status >= 300) { var err = new Error('Canvas ' + status + ': ' + lcCanvasErrorMessage_(body)); err.canvasStatus = status; throw err; }
    var rows = []; try { rows = JSON.parse(body || '[]'); } catch (e) {}
    if (Array.isArray(rows)) out = out.concat(rows);
    var headers = res.getHeaders ? res.getHeaders() : {}, link = String(headers.Link || headers.link || ''), next = '';
    link.split(',').forEach(function (part) { var m = part.match(/<([^>]+)>\s*;\s*rel="next"/); if (m) next = m[1]; });
    url = next;
  }
  return out;
}
function lcCanvasCourseStudents_(courseId) {
  var rows = lcCanvasGetAll_('/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&include[]=email&per_page=100');
  return rows.map(function (u) { return { id: String(u.id), name: u.name || u.short_name || '', email: String(u.email || u.login_id || '').trim().toLowerCase(), loginId: String(u.login_id || '').trim().toLowerCase(), sisId: String(u.sis_user_id || '').trim().toLowerCase() }; });
}
function lcCanvasMatchStudent_(email, students) { var e = normEmail_(email); for (var i = 0; i < students.length; i++) { var u = students[i]; if (e && (u.email === e || u.loginId === e || u.sisId === e)) return u; } return null; }

// ---------- Four Canvas assignments per week (7 / 3 / 2 / 7) ----------

function lcCanvasAssessmentKey_(week, stage) { return 'assessment:' + Number(week) + ':' + String(stage); }
function lcCanvasAssessmentMeta_(week, stage) {
  var m = LC_STAGE_META[String(stage)]; if (!m) throw new Error('Invalid assessment stage.');
  return { week: Number(week), stage: String(stage), title: m.title, points: m.max, label: 'Lit Circles - Week ' + Number(week) + ' - ' + m.title, key: lcCanvasAssessmentKey_(week, stage) };
}
// What students see in each Canvas assignment. Edit the sentences in quotes to change the
// message; keep the quotes and commas. The app sends this on every Push and every Save in
// "Due dates & Canvas…", so edit it here, not in Canvas (Canvas edits get replaced).
function lcCanvasDescription_(week, stage) {
  var messages = {
    submission: 'Complete your Week ' + week + ' Lit Circle submission (Step 1: your two reading strategies) in the Lit Circles app. It is marked with the 2 Reading Strategies rubric (7 points).',
    preparation: 'Complete your Week ' + week + ' five-minute discussion plan (Step 2) in the Lit Circles app. A complete plan earns 3 points.',
    quiz: 'Take your Week ' + week + ' Reading Quiz in the Lit Circles app right before your group discussion. It has 10 multiple-choice questions on your group\'s reading for the week, one point each. Your teacher opens it in class.',
    peer: 'Rate every groupmate after the Week ' + week + ' discussion (Step 3) in the Lit Circles app. Complete peer feedback earns 2 points.',
    reflection: 'Complete your Week ' + week + ' written reflection (Step 4) in the Lit Circles app. It is marked with the 7-point reflection rubric.'
  };
  var afterText = 'Your teacher marks the work in the app and sends the score here.';
  var linkText = 'Open Lit Circles';
  var signInNote = 'Sign in with your school Google account.';

  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var url = lcAppUrl_();
  var html = '<p>' + esc(messages[stage] || '') + '</p><p>' + esc(afterText) + '</p>';
  if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener"><strong>' + esc(linkText) + '</strong></a></p><p><small>' + esc(signInNote) + '</small></p>';
  return html;
}
// Canvas refuses to unpublish an assignment that already has grades, so after creation the app
// only ever publishes (when the week is open) and never sends published=false.
function lcCanvasAssignmentForm_(c, m, settings, schedule, withDates, creating, group) {
  var released = lcCanvasWeekReleased_(m.week, settings);
  var form = {
    'assignment[name]': m.label, 'assignment[points_possible]': String(m.points), 'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none', 'assignment[description]': lcCanvasDescription_(m.week, m.stage)
  };
  if (creating || released) form['assignment[published]'] = released ? 'true' : 'false';
  // Group: one picked for this step in the Week window (group, sent only when changed). Creating:
  // that, else the group saved for it (c.itemGroups), else the class default. Updates never send a
  // group otherwise, so a move made in Canvas stays.
  var grp = String(group || '') || (creating ? String((c.itemGroups || {})[m.key] || c.assignmentGroupId || '') : '');
  if (grp) form['assignment[assignment_group_id]'] = grp;
  if (withDates) { schedule = schedule || {}; form['assignment[due_at]'] = schedule.dueAt || ''; form['assignment[unlock_at]'] = schedule.unlockAt || ''; form['assignment[lock_at]'] = schedule.lockAt || ''; }
  return form;
}
/** Create the assignment, reuse the stored one, or adopt one another class already made in the
 *  same course (so two sections can share a Canvas course without duplicate columns). */
function lcCanvasEnsureAssignment_(c, m, settings, schedule, withDates, group) {
  var enc = encodeURIComponent(c.courseId), link = (c.assignments || {})[m.key] || {}, adopted = false, assignment = null;
  if (link.assignmentId) {
    try { assignment = lcCanvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId), lcCanvasAssignmentForm_(c, m, settings, schedule, withDates, false, group)); }
    catch (e) { if (e.canvasStatus !== 404) throw e; assignment = null; link = {}; }
  }
  if (!assignment) {
    var found = null;
    try { lcCanvasGetAll_('/api/v1/courses/' + enc + '/assignments?search_term=' + encodeURIComponent(m.label) + '&per_page=100').forEach(function (a) { if (!found && String(a.name) === m.label) found = a; }); } catch (e2) {}
    if (found) { adopted = true; assignment = lcCanvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(found.id), lcCanvasAssignmentForm_(c, m, settings, schedule, withDates, false, group)); }
    else assignment = lcCanvasRequest_('post', '/api/v1/courses/' + enc + '/assignments', lcCanvasAssignmentForm_(c, m, settings, schedule, true, true, group));
  }
  return { assignment: assignment, adopted: adopted, previous: link };
}
function lcCanvasLinkFrom_(m, assignment, prev, mod) {
  prev = prev || {};
  return {
    week: m.week, stage: m.stage, assignmentId: String(assignment.id), name: assignment.name || m.label, htmlUrl: assignment.html_url || prev.htmlUrl || '',
    pointsPossible: Number(assignment.points_possible || m.points), dueAt: assignment.due_at || prev.dueAt || '', published: String(assignment.published) !== 'false',
    moduleId: mod ? mod.moduleId : (prev.moduleId || ''), moduleName: mod ? mod.moduleName : (prev.moduleName || ''), moduleItemId: mod ? mod.moduleItemId : (prev.moduleItemId || ''),
    lastAssignmentSyncAt: new Date().toISOString(), lastGradeSyncAt: prev.lastGradeSyncAt || ''
  };
}

/**
 * What goes to Canvas for one step — shared by Push and the CSV, so they can never disagree.
 * Blank (not zero) for: work not turned in, turned in but not marked yet, left out, no groupmates,
 * and a student who hasn't started the week.
 */
function lcStageGradeRows_(snap, settings, week, stage) {
  var meta = lcCanvasAssessmentMeta_(week, stage);
  // 10-08a: an automatic step (Plan, Peer) that isn't complete is held back as blank until its due
  // date passes, so a 0 never reaches Canvas before the step is due. With no due date set it still
  // counts as 0, as before. Push and the CSV both use this, so they can't disagree.
  var notDue = false;
  if (stage === 'preparation' || stage === 'peer') {
    var sch = (settings.assignmentSchedule || {})[meta.key] || {}, link = ((settings.canvas || {}).assignments || {})[meta.key] || {};
    var due = String(sch.dueAt || link.dueAt || '');
    if (due && !isNaN(new Date(due).getTime()) && new Date(due).getTime() > Date.now()) notDue = true;
  }
  var rows = snap.enrollments.map(function (e) {
    var email = normEmail_(e.StudentEmail), ev = lcEvalStage_(snap, settings, email, week, stage);
    var r = { email: email, name: String(e.StudentName || lcNameFromEmail_(email)), score: null, reason: ev.status, redo: ev.redo, feedback: ev.grade ? String(ev.grade.feedback || '') : '', commentFp: ev.grade ? ev.grade.canvasCommentFp : '', postedScore: ev.grade ? ev.grade.canvasPostedScore : '', classExcluded: !!ev.classExcluded };
    if (ev.status === 'graded' || ev.status === 'redo' || ev.status === 'override' || ev.status === 'auto') r.score = ev.effective;
    if (notDue && ev.status === 'auto' && Number(r.score) < Number(meta.points)) { r.score = null; r.reason = 'notDue'; }
    return r;
  });
  return { meta: meta, rows: rows };
}

function getLiteratureCanvasWeekSetup(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcCanvasTeacherContext_(classId);
  var deleted = lcCanvasForgetDeleted_(classId, week);
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, conn = lcCanvasConnection_();
  // Assignment groups, and where each step's assignment is in Canvas now (it may have been moved there).
  var groups = [], groupsError = '', where = {};
  if (conn.connected && c.courseId) {
    try {
      groups = listLiteratureCanvasAssignmentGroups({ courseId: c.courseId }).groups;
      lcCanvasGetAll_('/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments?per_page=100').forEach(function (a) { where[String(a.id)] = String(a.assignment_group_id || ''); });
    } catch (e) { groupsError = e.message; }
  }
  var qsnap = null, snapFn = function () { return qsnap || (qsnap = lcTeacherClassSnapshot_(classId, { light: true })); };
  var stages = LC_STAGES.filter(function (st) { return !lcQuizSkipCanvas_(st, week, (c.assignments || {})[lcCanvasAssessmentKey_(week, st)], snapFn); }).map(function (st) {
    var m = lcCanvasAssessmentMeta_(week, st), link = (c.assignments || {})[m.key] || null;
    return { stage: st, title: m.title, points: m.points, label: m.label, key: m.key, link: link, schedule: ctx.settings.assignmentSchedule[m.key] || {},
      groupId: link && link.assignmentId ? (where[String(link.assignmentId)] || '') : String((c.itemGroups || {})[m.key] || c.assignmentGroupId || '') };
  });
  var modules = [], modulesError = '';
  if (conn.connected && c.courseId) { try { modules = listLiteratureCanvasModules({ courseId: c.courseId }).modules; } catch (e) { modulesError = e.message; } }
  var moduleId = ''; stages.forEach(function (s) { if (!moduleId && s.link && s.link.moduleId) moduleId = s.link.moduleId; });
  if (!moduleId && c.weekModules && c.weekModules[String(week)]) moduleId = String(c.weekModules[String(week)].moduleId || '');
  return { ok: true, week: week, deletedInCanvas: deleted, connected: conn.connected, course: { courseId: c.courseId || '', courseName: c.courseName || '', assignmentGroupName: c.assignmentGroupName || '' }, stages: stages, modules: modules, modulesError: modulesError, groups: groups, groupsError: groupsError, moduleId: moduleId, released: lcCanvasWeekReleased_(week, ctx.settings), appUrl: lcAppUrl_() };
}

/** Create/update the week's four Canvas assignments with their dates and module placement. */
function syncLiteratureCanvasWeek(payload) {
  if (typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_()) return hubSyncLiteratureCanvasWeek_(payload);
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcCanvasTeacherContext_(classId);
  var remade = lcCanvasForgetDeleted_(classId, week);
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  var schedules = payload.schedules || {}, links = {}, newSchedules = {}, adopted = [];
  var pickedGroups = payload.groups || {}, chosenGroups = {};   // {stage: groupId}, only the steps whose group was changed
  var qsnap = null, snapFn = function () { return qsnap || (qsnap = lcTeacherClassSnapshot_(classId, { light: true })); };
  LC_STAGES.forEach(function (st) {
    if (lcQuizSkipCanvas_(st, week, (c.assignments || {})[lcCanvasAssessmentKey_(week, st)], snapFn)) return; // no Reading Quiz this week
    var m = lcCanvasAssessmentMeta_(week, st), sch = schedules[st] || ctx.settings.assignmentSchedule[m.key] || {};
    sch = { dueAt: String(sch.dueAt || ''), unlockAt: String(sch.unlockAt || ''), lockAt: String(sch.lockAt || '') };
    newSchedules[m.key] = sch;
    if (pickedGroups[st]) chosenGroups[m.key] = String(pickedGroups[st]);
    var res = lcCanvasEnsureAssignment_(c, m, ctx.settings, sch, true, chosenGroups[m.key] || '');
    if (res.adopted) adopted.push(m.title);
    var mod = null, plan = lcCanvasModulePlan_(classId, c, week, m.key, payload, res.assignment && res.assignment.id);
    if (plan.adopt) mod = plan.adopt;
    else if (plan.moduleId !== undefined) mod = lcSyncCanvasModuleItem_(c.courseId, res.assignment, plan.moduleId, plan.moduleName, res.previous, m.label, lcCanvasWeekReleased_(week, ctx.settings));
    links[m.key] = lcCanvasLinkFrom_(m, res.assignment, res.previous, mod);
  });
  var settings = lcMutateClassSettings_(classId, function (s) {
    if (String(s.canvas.courseId || '') !== String(c.courseId)) return; // course changed meanwhile — don't write stale links
    s.canvas.assignments = s.canvas.assignments || {};
    Object.keys(links).forEach(function (k) { s.canvas.assignments[k] = links[k]; });
    Object.keys(newSchedules).forEach(function (k) { s.assignmentSchedule[k] = newSchedules[k]; });
    if (Object.keys(chosenGroups).length) { s.canvas.itemGroups = s.canvas.itemGroups || {}; Object.keys(chosenGroups).forEach(function (k) { s.canvas.itemGroups[k] = chosenGroups[k]; }); }
  });
  return { ok: true, week: week, links: links, adopted: adopted, remade: remade, settings: settings };
}

/**
 * Push the week: all four steps, scores AND the teacher's comments. Assignments are created
 * on the first push and reused after that. A comment that hasn't changed isn't posted again.
 */
// `shared` is internal: pushLiteratureCanvasGradebook passes the class snapshot and the Canvas
// roster so a push of every week reads them once. payload.onlyLinked (Push all) skips any step
// that isn't in Canvas yet instead of creating it.
// 2026-10-18a -- the latest push is the truth in Canvas (same rule as Short Story Lab v27 and
// Macbeth 2026-10-18a): a step left out for ONE student is sent as EXCUSED, so a score pushed
// before stops counting; once it counts again and has a score, the excusal is lifted and the
// score sent. CanvasPostedScore holds 'EX' while this app has the student excused. A step left
// out for the whole class keeps the old behaviour (scores this app sent are cleared).
function pushLiteratureCanvasWeek(payload, shared) {
  if (typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_()) return hubPushLiteratureCanvasWeek_(payload, shared);
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcCanvasTeacherContext_(classId);
  var remade = lcCanvasForgetDeleted_(classId, week, (payload.stage && LC_STAGES.indexOf(String(payload.stage)) >= 0) ? [String(payload.stage)] : null);
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, conn = lcCanvasConnection_();
  if (!conn.connected) throw new Error('Connect Canvas first (Canvas button at the top of the dashboard).');
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  var snap = (shared && shared.snap) || lcTeacherClassSnapshot_(classId, { light: true }), roster = (shared && shared.roster) || lcCanvasCourseStudents_(c.courseId), enc = encodeURIComponent(c.courseId);
  var links = {}, stagesOut = [], commentReqs = [], commentMeta = [], postedMeta = [], warnings = [];
  // 10-08a tiles: payload.stage pushes one step only (one tile); without it, all four steps.
  var pushStages = (payload.stage && LC_STAGES.indexOf(String(payload.stage)) >= 0) ? [String(payload.stage)] : LC_STAGES;
  pushStages.forEach(function (st) {
    var m = lcCanvasAssessmentMeta_(week, st), out = { stage: st, title: m.title, points: m.points, sent: 0, blank: [], pending: [], unmatched: [], redo: [], excluded: 0, excused: [], unexcused: [], cleared: [], notDue: [], commentsQueued: 0, created: false, adopted: false };
    var classEx = !!ctx.settings.excluded[lcItemKey_(week, st)];
    var existing = (c.assignments || {})[m.key] || {};
    if (lcQuizSkipCanvas_(st, week, existing, function () { return snap; })) { out.skipped = 'No Reading Quiz this week'; out.noQuiz = true; stagesOut.push(out); return; }
    if (classEx && !existing.assignmentId) { out.skipped = 'Not graded for this class'; stagesOut.push(out); return; }
    if (payload.onlyLinked && !existing.assignmentId) { out.skipped = 'Not in Canvas yet'; out.notInCanvas = true; stagesOut.push(out); return; }
    var res = lcCanvasEnsureAssignment_(c, m, ctx.settings, ctx.settings.assignmentSchedule[m.key] || {}, !existing.assignmentId);
    out.created = !existing.assignmentId && !res.adopted; out.adopted = res.adopted;
    var link = lcCanvasLinkFrom_(m, res.assignment, res.previous, null);
    if (!existing.assignmentId) { // 2026-10-18g: a step made by Push goes into the week's module too
      try {
        var plan = lcCanvasModulePlan_(classId, c, week, m.key, {}, res.assignment && res.assignment.id), pm = null;
        if (plan.adopt) pm = plan.adopt;
        else if (plan.moduleId) pm = lcSyncCanvasModuleItem_(c.courseId, res.assignment, plan.moduleId, plan.moduleName, {}, m.label, lcCanvasWeekReleased_(week, ctx.settings));
        if (pm) { link.moduleId = pm.moduleId; link.moduleName = pm.moduleName; link.moduleItemId = pm.moduleItemId; }
      } catch (eMod) { warnings.push(m.title + ' is in Canvas but couldn’t be added to the module: ' + eMod.message); }
    }
    var data = lcStageGradeRows_(snap, ctx.settings, week, st), gradeForm = {};
    data.rows.forEach(function (r) {
      var wasExcused = String(r.postedScore) === 'EX';
      // 2026-10-18a: left out for this one student -> EXCUSED in Canvas (sent every push, so
      // Canvas matches the app even if someone changed it there).
      if (r.reason === 'excluded' && !r.classExcluded) {
        var xu = lcCanvasMatchStudent_(r.email, roster);
        if (!xu) { out.unmatched.push(r.name); return; }
        gradeForm['grade_data[' + xu.id + '][excuse]'] = 'true';
        out.excused.push(r.name); out.excluded++;
        if (!wasExcused) postedMeta.push({ email: r.email, itemKey: lcItemKey_(week, st), score: 'EX' });
        return;
      }
      // Excused earlier and still no score (or now left out for the whole class): leave Canvas as
      // it is -- the excusal stays.
      if (wasExcused && r.score == null) { if (r.reason === 'pending') out.pending.push(r.name); if (r.reason === 'excluded') out.excluded++; return; }
      // 10-08a: a score this app sent before but no longer has (cleared, or left out for the whole class) is cleared in Canvas too.
      // (a Reading Quiz someone is still taking — the quiz was reopened — keeps what Canvas has)
      if ((r.reason === 'excluded' || r.score == null) && r.reason !== 'notDue' && r.reason !== 'inProgress' && r.postedScore !== '' && r.postedScore != null) {
        var cu = lcCanvasMatchStudent_(r.email, roster);
        if (cu) { gradeForm['grade_data[' + cu.id + '][posted_grade]'] = ''; out.cleared.push(r.name); postedMeta.push({ email: r.email, itemKey: lcItemKey_(week, st), score: '' }); }
      }
      if (r.reason === 'notDue') { out.notDue.push(r.name); return; }
      if (r.reason === 'excluded') { out.excluded++; return; }
      if (r.reason === 'pending') out.pending.push(r.name);
      if (r.score == null) { if (r.reason !== 'pending' && r.reason !== 'na') out.blank.push(r.name); return; }
      var u = lcCanvasMatchStudent_(r.email, roster);
      if (!u) { out.unmatched.push(r.name); return; }
      gradeForm['grade_data[' + u.id + '][posted_grade]'] = String(r.score);
      if (wasExcused) { gradeForm['grade_data[' + u.id + '][excuse]'] = 'false'; out.unexcused.push(r.name); }
      out.sent++;
      if (String(r.postedScore) !== String(r.score)) postedMeta.push({ email: r.email, itemKey: lcItemKey_(week, st), score: String(r.score) });
      if (r.redo) out.redo.push(r.name);
      var text = String(r.feedback || '').trim();
      if (text) {
        var fp = 'cc:' + String(link.assignmentId) + ':' + lcMd5Hex_(text).slice(0, 12);
        if (fp !== r.commentFp) {
          commentReqs.push({ url: conn.baseUrl + '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId) + '/submissions/' + encodeURIComponent(u.id), method: 'put', headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, payload: { 'comment[text_comment]': text }, muteHttpExceptions: true });
          commentMeta.push({ email: r.email, itemKey: lcItemKey_(week, st), fp: fp, stage: st });
          out.commentsQueued++;
        } else out.commentsSkipped = (out.commentsSkipped || 0) + 1;
      }
    });
    if (Object.keys(gradeForm).length) lcCanvasRequest_('post', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId) + '/submissions/update_grades', gradeForm);
    link.lastGradeSyncAt = new Date().toISOString();
    links[m.key] = link;
    out.htmlUrl = link.htmlUrl;
    stagesOut.push(out);
  });
  // Comments go in parallel batches; each one is recorded only after Canvas accepts it.
  var posted = [], failed = 0;
  for (var i = 0; i < commentReqs.length; i += 20) {
    var batch = commentReqs.slice(i, i + 20), resps = UrlFetchApp.fetchAll(batch);
    resps.forEach(function (res, j) { var code = res.getResponseCode(); if (code >= 200 && code < 300) posted.push(commentMeta[i + j]); else failed++; });
  }
  stagesOut.forEach(function (o) { o.commentsPosted = posted.filter(function (p) { return p.stage === o.stage; }).length; });
  // 10-08a: record what reached Canvas FIRST (comment fingerprints, posted scores), so a later
  // failure can't make the next Push post the same comments again.
  if (posted.length || postedMeta.length) {
    try {
      withLock_(function () {
        var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.GRADES);
        posted.forEach(function (p) { lcUpsertByKeys_(sh, 'StudentEmail', { ClassId: classId, StudentEmail: p.email, ItemKey: p.itemKey }, { CanvasCommentFp: p.fp }); });
        postedMeta.forEach(function (p) { lcUpsertByKeys_(sh, 'StudentEmail', { ClassId: classId, StudentEmail: p.email, ItemKey: p.itemKey }, { CanvasPostedScore: p.score }); });
      });
    } catch (e) { warnings.push('Scores and comments reached Canvas, but the app couldn’t record that (' + e.message + '). The next Push may post those comments again.'); }
  }
  var settings = ctx.settings;
  try {
    settings = lcMutateClassSettings_(classId, function (s) {
      if (String(s.canvas.courseId || '') !== String(c.courseId)) return;
      s.canvas.assignments = s.canvas.assignments || {};
      Object.keys(links).forEach(function (k) { var prev = s.canvas.assignments[k] || {}; links[k].moduleId = prev.moduleId || links[k].moduleId; links[k].moduleName = prev.moduleName || links[k].moduleName; links[k].moduleItemId = prev.moduleItemId || links[k].moduleItemId; s.canvas.assignments[k] = links[k]; });
    });
  } catch (e) { warnings.push('Canvas has the grades, but the app couldn’t save the assignment links (' + e.message + '). Push again later.'); }
  return { ok: true, week: week, stages: stagesOut, commentsPosted: posted.length, commentsFailed: failed, settings: settings, course: c.courseName || '', warnings: lcRemadeNote_(remade, !!payload.onlyLinked).concat(warnings), remade: remade };
}

/**
 * 2026-10-18a -- "↗ Push all to Canvas" on the Gradebook card (ported from Short Story Lab and
 * Macbeth). Pushes every released week, one after another, through pushLiteratureCanvasWeek --
 * the same code as each week's Push -- with onlyLinked, so it never creates a Canvas assignment.
 * Reads the class once and the Canvas roster once. One week failing doesn't stop the others;
 * it stops before Apps Script's 6-minute limit and says which weeks are left.
 */
function pushLiteratureCanvasGradebook(payload) {
  payload = payload || {}; var classId = String(payload.classId || '');
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, hub = typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_();
  if (!hub && !lcCanvasConnection_().connected) throw new Error('Connect Canvas first (Canvas button at the top of the dashboard).');
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  var links = c.assignments || {}, released = (ctx.settings.releasedWeeks || []).map(Number).sort(), weeks = [], notInCanvas = [], hiddenWeeks = [];
  [1, 2, 3, 4].forEach(function (w) {
    var linked = LC_STAGES.filter(function (st) { var l = links[lcCanvasAssessmentKey_(w, st)]; return l && l.assignmentId; });
    if (released.indexOf(w) < 0) { if (linked.length) hiddenWeeks.push('Week ' + w); return; }
    if (!linked.length) { notInCanvas.push('Week ' + w + ' (all steps)'); return; }
    weeks.push(w);
  });
  if (!weeks.length) throw new Error('None of the open weeks are in Canvas yet. Use Push on a week once to create its Canvas assignments.');
  var shared = { snap: lcTeacherClassSnapshot_(classId, { light: true }) };
  if (!hub) shared.roster = lcCanvasCourseStudents_(c.courseId);
  var started = Date.now(), results = [], failures = [], notReached = [], warnings = [], settings = ctx.settings;
  var totals = { sent: 0, excused: 0, unexcused: 0, comments: 0, commentsFailed: 0 };
  var lists = { pending: [], unmatched: [], notDue: [], cleared: [], classExcluded: [] };
  function addAll(list, into) { (list || []).forEach(function (n) { if (n && into.indexOf(n) < 0) into.push(n); }); }
  weeks.forEach(function (w) {
    if (Date.now() - started > 270000) { notReached.push('Week ' + w); return; }
    try {
      var r = pushLiteratureCanvasWeek({ classId: classId, week: w, onlyLinked: true }, shared);
      if (r.settings) settings = r.settings;
      (r.stages || []).forEach(function (st) {
        var label = 'Week ' + w + ' ' + LC_STAGE_META[st.stage].step;
        if (st.noQuiz) return;
        if (st.notInCanvas) { notInCanvas.push(label); return; }
        if (st.skipped) { lists.classExcluded.push(label); return; }
        totals.sent += st.sent || 0; totals.excused += (st.excused || []).length; totals.unexcused += (st.unexcused || []).length;
        addAll(st.pending, lists.pending); addAll(st.unmatched, lists.unmatched); addAll(st.notDue, lists.notDue); addAll(st.cleared, lists.cleared);
      });
      totals.comments += r.commentsPosted || 0; totals.commentsFailed += r.commentsFailed || 0;
      addAll(r.warnings, warnings);
      results.push({ week: w, stages: r.stages || [] });
    } catch (e) { failures.push({ label: 'Week ' + w, message: e.message || String(e) }); }
  });
  return { ok: !failures.length && !notReached.length, weeks: results, totals: totals, pending: lists.pending, unmatched: lists.unmatched, notDue: lists.notDue, cleared: lists.cleared, classExcluded: lists.classExcluded, notInCanvas: notInCanvas, hiddenWeeks: hiddenWeeks, failures: failures, notReached: notReached, warnings: warnings, settings: settings, via: hub ? 'lmsHub' : 'canvas' };
}

/** CSV fallback for Canvas's gradebook import: one column per step, same numbers as Push. */
function exportLiteratureCanvasWeekCsv(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, snap = lcTeacherClassSnapshot_(classId, { light: true });
  var cols = LC_STAGES.filter(function (st) { return !ctx.settings.excluded[lcItemKey_(week, st)] && !lcQuizSkipCanvas_(st, week, (c.assignments || {})[lcCanvasAssessmentKey_(week, st)], function () { return snap; }); }).map(function (st) { return lcStageGradeRows_(snap, ctx.settings, week, st); });
  var head = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section'], pts = ['Points Possible', '', '', '', ''];
  cols.forEach(function (d) { var link = (c.assignments || {})[d.meta.key]; head.push(d.meta.label + (link && link.assignmentId ? ' (' + link.assignmentId + ')' : '')); pts.push(d.meta.points); });
  var rows = [head, pts];
  snap.enrollments.forEach(function (e, i) {
    var row = [String(e.StudentName || lcNameFromEmail_(e.StudentEmail)), '', '', normEmail_(e.StudentEmail), ''];
    cols.forEach(function (d) { var r = d.rows[i]; row.push(r.score == null ? '' : r.score); });
    rows.push(row);
  });
  return { ok: true, filename: 'Lit Circles - Week ' + week + ' - Canvas.csv', csv: lcCsv_(rows) };
}


// ============================================================================
// DEMO STUDENT DATA — teacher-only preview helpers (2026-09-18)
// Adds/removes 10 clearly isolated fake students so the teacher can test the
// Week 1 whole-class grading workflow without touching real student records.
// ============================================================================
var LC_DEMO_DOMAIN = '@demo.litcircles.local';

function lcIsDemoEmail_(email){ return normEmail_(email).indexOf(LC_DEMO_DOMAIN) > 0; }
// Rows are BLANKED in place, never deleted: a deleted row shifts every row below it, and a
// student saving at that moment would write into someone else's row.
function lcDeleteRowsWhere_(sh, predicate){
  if(!sh || sh.getLastRow() < 2) return 0;
  var vals = sh.getDataRange().getValues(), removed = 0, width = vals[0].length;
  for(var i=1;i<vals.length;i++){
    if(predicate(vals[i])){ sh.getRange(i+1,1,1,width).clearContent(); removed++; }
  }
  return removed;
}
// appendRow is atomic, so a student's own appendRow can never land in the same row.
function lcAppendRows_(sh, rows){
  (rows || []).forEach(function(r){ sh.appendRow(r); });
}
function lcRemoveDemoRows_(classId){
  var ss=getSs_(), removed=0;
  lcEnsurePlatform_();
  // Scope cleanup to the demo emails enrolled in THIS class, so teachers can load
  // demo data into more than one class without one class deleting another's preview.
  var enrollSh=ss.getSheetByName(LC_PLATFORM_SHEETS.ENROLL), enrollVals=enrollSh.getDataRange().getValues(), target={};
  for(var ei=1;ei<enrollVals.length;ei++) if(String(enrollVals[ei][0])===String(classId)&&lcIsDemoEmail_(enrollVals[ei][1])) target[normEmail_(enrollVals[ei][1])]=true;
  removed += lcDeleteRowsWhere_(enrollSh, function(r){return String(r[0])===String(classId)&&!!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(ss.getSheetByName(LC_PLATFORM_SHEETS.GRADES), function(r){return String(r[0])===String(classId)&&!!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(workSheet_(), function(r){return !!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(draftSheet_(), function(r){return !!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(peerSheet_(), function(r){return !!target[normEmail_(r[2])]||!!target[normEmail_(r[3])];});
  removed += lcDeleteRowsWhere_(reflectSheet_(), function(r){return !!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(selfAssessSheet_(), function(r){return !!target[normEmail_(r[1])];});
  removed += lcDeleteRowsWhere_(resumeSheet_(), function(r){return !!target[normEmail_(r[0])];});
  removed += lcDeleteRowsWhere_(writingStatsSheet_(), function(r){return !!target[normEmail_(r[0])];});
  LC_X_.enroll = null; lcInvalidateGroups_();
  removed += lcDeleteRowsWhere_(groupsSheet_(), function(r){
    var members=String(r[2]||'').split(',').map(normEmail_).filter(Boolean);
    return members.length>0 && members.every(function(m){return !!target[m];});
  });
  return removed;
}

/** Generic demo writing for one strategy (book-neutral; student i's version is fuller when i is even). */
function lcDemoStrategyData_(key,i){
  var full=i%2===0, pg=function(n){return 'p. '+(12+n*7+i);};
  var why=' This helped me understand why the main character keeps choosing loyalty over safety.';
  switch(key){
    case 'summarizer': var o={summary:full?'This section opens with the main character under pressure at home, then follows a choice that changes their place in the community. By the end, a friendship is tested and a new rule shows who really holds power.'+why:'The main character makes a big choice and things get harder.'};for(var k=1;k<=7;k++)o['keyPoint'+k]=(full||k<4)?pg(k)+' — a key event that moves the conflict forward.':'';return o;
    case 'researcher': return{topic1:'The time period the story is set in',findings1:full?'Daily life at the time was shaped by scarcity, which explains why small trades matter so much in the story.':'It was a hard time.',topic2:full?'How the author’s life shaped the book':'',findings2:full?'The author has said a family experience inspired the conflict.':'',sourceLinks:'',reflection:full?'The research made the setting feel real and explained the characters’ fear of authority.':'It helped a little.'};
    case 'connector': return{items:[0,1,2,3,4].map(function(n){return{connection:(full||n<3)?pg(n)+' — this connects to how people in my community look out for each other.'+(n===0?why:''):''};})};
    case 'questioner': return{items:[0,1,2,3,4].map(function(n){return{question:(full||n<3)?pg(n)+' — Why does the character trust someone who has let them down before? It matters because it shows what they value.':''};})};
    case 'literaryLuminary': return{items:[0,1,2,3].map(function(n){return{pageNumber:pg(n),passage:'(the student copies a short passage from the page here)',whyMatters:(full||n<2)?'This moment shows the turning point in the character’s thinking.':''};})};
    case 'predictor': return{items:[0,1,2,3].map(function(n){return{prediction:'The character will break the rule before the end of the next section.',reason:(full||n<2)?'On '+pg(n)+' and '+pg(n+1)+' they question the rule and hide evidence from an authority figure.':'',whatHappened:'Not resolved yet'};})};
    case 'inferences': return{items:[0,1,2,3,4,5].map(function(n){return{summary:(full||n<3)?pg(n)+' — what happens in this part.':'',inference:(full||n<3)?'I infer that the character is more afraid than they admit.':''};})};
    case 'illustrator': return{character:'The main character',scene1:pg(1)+' — they protect a younger friend.',reveals1:'They are loyal.',scene2:full?pg(3)+' — they argue with an adult.':'',reveals2:full?'They are starting to question authority.':'',scene3:'',reveals3:'',change:full?'They began quiet and are now willing to speak up.':''};
  }
  return{};
}
function seedLiteratureCirclesDemoStudents(payload){
  var t=lcRequireTeacher_(); payload=payload||{}; var classId=String(payload.classId||'');
  if(!lcTeacherOwnsClass_(classId,t)) throw new Error('Class not found or access denied.');
  return withLock_(function(){
    lcRemoveDemoRows_(classId);
    var ss=getSs_(), now=new Date(), minute=60*1000;
    var names=['Maya Chen','Noah Williams','Sofia Ramirez','Liam Nakamura','Ava Johnson','Ethan Lee','Leilani Kealoha','Mateo Garcia','Riley Thompson','Kai Anderson'];
    var slugs=['maya.chen','noah.williams','sofia.ramirez','liam.nakamura','ava.johnson','ethan.lee','leilani.kealoha','mateo.garcia','riley.thompson','kai.anderson'];
    var classToken=String(classId).replace(/[^a-z0-9]/gi,'').toLowerCase().substring(0,8)||'class';
    var students=names.map(function(name,i){return{name:name,email:slugs[i]+'+'+classToken+LC_DEMO_DOMAIN};});
    var groupA=students.slice(0,5), groupB=students.slice(5), gidA='DEMO-'+classId+'-A-'+Utilities.getUuid().substring(0,8), gidB='DEMO-'+classId+'-B-'+Utilities.getUuid().substring(0,8);
    var dplan=lcNormalizeClassSettings_((lcClass_(classId)||{}).SettingsJson).plan, one=lcPlanSingle_(dplan);
    var bookA=one?dplan.book.title:'The Giver', readA=one?dplan.book.reading.slice():['Chapters 1–5','Chapters 6–10','Chapters 11–15','Chapters 16–23'];
    var bookB=one?dplan.book.title:'The Hunger Games', readB=one?dplan.book.reading.slice():['Chapters 1–6','Chapters 7–13','Chapters 14–20','Chapters 21–27'];
    var groups=[
      // lcText_: a reading typed like "1-4" must stay text (appendRow would turn it into a date)
      [gidA,lcText_(bookA),groupA.map(function(s){return s.email;}).join(','),lcText_(readA[0]),lcText_(readA[1]),lcText_(readA[2]),lcText_(readA[3]),now],
      [gidB,lcText_(bookB),groupB.map(function(s){return s.email;}).join(','),lcText_(readB[0]),lcText_(readB[1]),lcText_(readB[2]),lcText_(readB[3]),now]
    ];
    lcAppendRows_(groupsSheet_(),groups);lcInvalidateGroups_();LC_X_.enroll=null;
    lcAppendRows_(ss.getSheetByName(LC_PLATFORM_SHEETS.ENROLL),students.map(function(s){return[classId,s.email,s.name,true,now];}));

    function planFor(name){return{
      focus:'How pressure changes the choices characters make',
      evidence:'Pages 42 and 57 show the character making different choices when the stakes rise.',
      question1:'Which choice in this section tells us the most about the character?',
      question2:'How would the scene change if the character had made the opposite choice?',
      open:'0:00–0:45 — Open with the focus question and invite one quick reaction.',
      explore:'0:45–2:30 — Compare the two pieces of page evidence and ask for interpretations.',
      deepen:'2:30–4:15 — Use the follow-up question and ask group members to build on one another.',
      close:'4:15–5:00 — Summarize the strongest idea and name one question to keep reading for.',
      backup:'If conversation stalls, ask everyone to choose the more important page and explain why.'
    };}
    // Each demo student's Week 1 uses the two strategies the class's Unit setup gives them. The
    // writing is generic (no particular book) and never quotes anything.
    function demoGroupOf(i){return{memberEmails:(i<5?groupA:groupB).map(function(x){return x.email;})};}
    function strategyData(i,choices){var out={};choices.forEach(function(k){out[k]=lcDemoStrategyData_(k,i);});return out;}
    function submissionFor(i,submittedIso){
      var plan=planFor(students[i].name), choices=lcPlanPairFor_(dplan,demoGroupOf(i),students[i].email,1), data=strategyData(i,choices);
      data.discussionPlan=plan;data._submissionUpdatedAt=submittedIso;return{type:'strategies',choices:choices,data:data};
    }

    var workRows=[], reflectRows=[], selfRows=[], gradeRows=[];
    students.forEach(function(s,i){
      // Students 4 & 5 intentionally have a newer submission than their saved grade so the
      // teacher can see the Resubmitted bucket. Others are either ungraded or normally graded.
      var isResub=(i===3||i===4), hasSubGrade=(i<5), hasRefGrade=(i<3), refResub=(i===2);
      var gradeTime=new Date(now.getTime()-25*minute+i*minute), submitTime=isResub?new Date(now.getTime()-5*minute+i*minute):new Date(now.getTime()-45*minute+i*minute);
      var sub=submissionFor(i,submitTime.toISOString()), gid=i<5?gidA:gidB;
      workRows.push([gid,s.email,1,sub.type,sub.choices.join(','),JSON.stringify(sub.data),submitTime]);
      selfRows.push([gid,s.email,1,String(3+(i%3)),String(4+(i%2)),String(3+((i+1)%3)),new Date(now.getTime()-12*minute+i*minute)]);
      var answers={
        strengthFromFeedback:'My peers said I helped keep the discussion moving and used specific page evidence instead of staying general.',
        growthFromFeedback:'I need to leave more space after asking a question instead of answering it myself. Next time I will count to three before I jump back in.',
        selfCompare:'I rated my leadership a little higher than my peers did. Their comments helped me realize that leading also means making room for quieter group members.'
      };
      var refTime=refResub?new Date(now.getTime()-3*minute):new Date(now.getTime()-18*minute+i*minute);
      reflectRows.push([gid,s.email,1,'weekly',JSON.stringify(answers),'Ask one follow-up question that brings another group member into the conversation.',refTime]);
      if(hasSubGrade){var pts=[7,6,5,6,5][i];gradeRows.push([classId,s.email,'w1_submission',pts,7,JSON.stringify({rubricKey:sub.type==='strategies'?'strategies':sub.type,level:pts}),'Demo teacher feedback: clear evidence and thoughtful preparation.',false,gradeTime,t.email]);}
      if(hasRefGrade){var rp=[7,6,5][i];var rgTime=refResub?new Date(now.getTime()-30*minute):new Date(now.getTime()-8*minute+i*minute);gradeRows.push([classId,s.email,'w1_reflection',rp,7,JSON.stringify({rubricKey:'reflection',level:rp}),'Demo teacher feedback: specific reflection with a useful next step.',false,rgTime,t.email]);}
    });
    lcAppendRows_(workSheet_(),workRows);lcAppendRows_(selfAssessSheet_(),selfRows);lcAppendRows_(reflectSheet_(),reflectRows);lcAppendRows_(ss.getSheetByName(LC_PLATFORM_SHEETS.GRADES),gradeRows);

    var peerRows=[];
    [groupA,groupB].forEach(function(group,gi){var gid=gi===0?gidA:gidB;group.forEach(function(assessor,ai){group.forEach(function(target,ti){if(assessor.email===target.email)return;var p=3+((ai+ti)%3),l=3+((ai+ti+1)%3),a=3+((ai+ti+2)%3);peerRows.push([gid,1,assessor.email,target.email,p,'You came prepared and referred to the reading. One next step is to invite another person into the conversation.',l,'Your opening question helped the group get started. Try using one more follow-up question before changing topics.',a,'You responded directly to other people’s ideas and built on evidence from the book.',new Date(now.getTime()-15*minute+(ai+ti)*1000)]);});});});
    lcAppendRows_(peerSheet_(),peerRows);
    lcAppendRows_(resumeSheet_(),students.map(function(s){return[s.email,'week_reflection',1,'workspace',0,0,now];}));
    // Sample writing-process stats, so the marking screens show what they look like.
    try {
      var wsRows=[];
      students.forEach(function(s,i){
        var sub=submissionFor(i,now.toISOString()), gid=i<5?gidA:gidB, mates=(i<5?groupA:groupB).filter(function(m){return m.email!==s.email;});
        var peerComments=['You came prepared and referred to the reading. One next step is to invite another person into the conversation.','Your opening question helped the group get started. Try using one more follow-up question before changing topics.','You responded directly to other people’s ideas and built on evidence from the book.'];
        var answers={strengthFromFeedback:'My peers said I helped keep the discussion moving and used specific page evidence instead of staying general.',growthFromFeedback:'I need to leave more space after asking a question instead of answering it myself. Next time I will count to three before I jump back in.',selfCompare:'I rated my leadership a little higher than my peers did. Their comments helped me realize that leading also means making room for quieter group members.'};
        var data=lcDemoWritingStats_(i,sub,planFor(s.name),mates,peerComments,answers,'Ask one follow-up question that brings another group member into the conversation.',now.getTime());
        if(!data)return;
        var chunks=lcSplitJson_(JSON.stringify(data)), row={Email:s.email,Week:1,GroupId:gid,UpdatedAt:now};
        Object.keys(chunks).forEach(function(c){row[c]=chunks[c];});
        wsRows.push(lcRowFromObject_(writingStatsSheet_(),row));
      });
      lcAppendRows_(writingStatsSheet_(),wsRows);
    } catch (wsErr) {}
    return{ok:true,added:students.length,emails:students.map(function(s){return s.email;}),message:'10 demo students added with Week 1 complete.'};
  });
}

/** Same text check as WritingStats.html (FNV-1a + length), so demo stats line up with demo text. */
function lcWsHash_(s) {
  s = String(s || '');
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return s.length + ':' + ('0000000' + h.toString(16)).slice(-8);
}
function lcWsDemoText_(v, html) {
  var t = String(v || '');
  if (html) t = t.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return t;
}
/** Plausible stats for one demo student's Week 1. Student 3 pasted a sentence into the summary,
 *  students 1 and 5 tried to paste into blocked boxes, student 8 pasted then deleted it, student 9
 *  wrote before tracking began (no stats). */
function lcDemoWritingStats_(i, sub, plan, mates, peerComments, answers, goal, nowMs) {
  if (i === 8) return null;
  var boxes = {}, clocks = {}, minute = 60000;
  function words(t) { t = String(t || '').trim(); return t ? t.split(/\s+/).length : 0; }
  function box(key, value, html, extra) {
    var plain = lcWsDemoText_(value, html), text = plain.trim();
    if (!text) return 0;
    var ms = Math.round(words(html ? String(value).replace(/<\/p>/g, ' </p>').replace(/<[^>]*>/g, ' ') : text) * (2200 + ((i * 37 + key.length * 13) % 1400)));
    var m = { v: 1, spans: [], events: 0, blocked: 0, activeMs: ms, sessions: 1 + ((i + key.length) % 2), lastInputAt: nowMs - (40 + i) * minute, timeStartedAt: new Date(nowMs - 3 * 24 * 60 * minute).toISOString(), untimedChars: 0, len: text.length, lead: plain.length - plain.replace(/^\s+/, '').length, hash: lcWsHash_(text), at: nowMs - (40 + i) * minute };
    if (extra) extra(m, plain);
    boxes[key] = m;
    return ms;
  }
  var t1 = 0, d = sub.data;
  {
    sub.choices.forEach(function (k) {
      var v = d[k] || {};
      if (Array.isArray(v.items)) v.items.forEach(function (it, ii) {
        Object.keys(it).forEach(function (f) {
          if (f === 'prediction' || f === 'whatHappened') return; // one-line fields aren't tracked
          t1 += box('s1.' + k + '__item' + ii + '__' + f, it[f], false, i === 0 && ii === 0 ? function (m) { m.blocked = 1; } : null);
        });
      });
      else Object.keys(v).forEach(function (f) {
        if (f === 'character') return;
        // student 3 pasted one sentence of the summary in from somewhere else (a sample paste to look at)
        t1 += box('s1.' + k + '__' + f, v[f], false, i === 2 && k === 'summarizer' && f === 'summary' ? function (m, plain) {
          var snip = plain.split('. ')[1] || '', a = snip ? plain.indexOf(snip) : -1;
          if (a >= 0) { m.spans.push([a, a + snip.length, 'p', snip.slice(0, 60)]); m.events = 1; }
        } : null);
      });
    });
  }
  var t2 = 0; Object.keys(plan).forEach(function (k) { t2 += box('s2.' + k, plan[k], false, i === 4 && k === 'evidence' ? function (m) { m.blocked = 2; } : null); });
  var t3 = 0; mates.forEach(function (mate) { var sid = String(mate.email).replace(/[^a-zA-Z0-9]/g, '_'); ['participation', 'leadership', 'activeEngagement'].forEach(function (c, ci) { t3 += box('s3.' + sid + '.' + c, peerComments[ci], false); }); });
  var t4 = 0; Object.keys(answers).forEach(function (k) { t4 += box('s4.' + k, answers[k], false); }); t4 += box('s4.goal', goal, false);
  function clock(key, ms, sittings) { if (ms > 0) clocks[key] = { activeMs: Math.round(ms * 1.12), sessions: sittings, lastInputAt: nowMs - (40 + i) * minute, timeStartedAt: new Date(nowMs - 3 * 24 * 60 * minute).toISOString() }; }
  clock('s1', t1, 2 + (i % 2)); clock('s2', t2, 1); clock('s3', t3, 1); clock('s4', t4, 1 + (i % 2));
  return { boxes: boxes, clocks: clocks };
}

function removeLiteratureCirclesDemoStudents(payload){
  var t=lcRequireTeacher_(); payload=payload||{}; var classId=String(payload.classId||'');
  if(!lcTeacherOwnsClass_(classId,t)) throw new Error('Class not found or access denied.');
  return withLock_(function(){var removed=lcRemoveDemoRows_(classId);return{ok:true,removed:removed};});
}



// ============================================================================
// TEACHER GROUP + ARCHIVE RECOVERY TOOLS — 2026-09-18
// ============================================================================
function lcTeacherStudentEnrolled_(classId,email){
  email=normEmail_(email);
  return lcEnrollments_(classId).some(function(e){return normEmail_(e.StudentEmail)===email;});
}
function lcGroupRowById_(groupId){
  groupId=String(groupId||'');var sh=groupsSheet_(),vals=sh.getDataRange().getValues();
  for(var i=1;i<vals.length;i++)if(String(vals[i][0])===groupId)return{sheet:sh,row:i+1,values:vals[i],group:rowToGroup_(vals[i])};
  return null;
}
function lcSetGroupMembersById_(groupId,members){
  var rec=lcGroupRowById_(groupId);if(!rec)throw new Error('That Literature Circle group no longer exists.');
  var clean=[],seen={};(members||[]).forEach(function(m){var e=normEmail_(m);if(e&&!seen[e]){seen[e]=true;clean.push(e);}});
  rec.sheet.getRange(rec.row,3).setValue(clean.join(','));lcInvalidateGroups_();return rowToGroup_([rec.values[0],rec.values[1],clean.join(','),rec.values[3],rec.values[4],rec.values[5],rec.values[6],rec.values[7]]);
}
function lcRemoveStudentFromGroup_(groupId,email){
  var rec=lcGroupRowById_(groupId);if(!rec)return;
  var members=rec.group.memberEmails.filter(function(m){return normEmail_(m)!==normEmail_(email);});
  rec.sheet.getRange(rec.row,3).setValue(members.join(','));lcInvalidateGroups_();
}
function lcAddStudentToGroup_(groupId,email){
  var rec=lcGroupRowById_(groupId);if(!rec)throw new Error('That Literature Circle group no longer exists.');
  var members=rec.group.memberEmails.slice(),e=normEmail_(email);
  if(members.map(normEmail_).indexOf(e)<0)members.push(e);
  rec.sheet.getRange(rec.row,3).setValue(members.join(','));lcInvalidateGroups_();return rec.group;
}
function lcClearResumeTeacher_(email){
  // Point the student home instead of deleting rows (a deleted row shifts every row below it
  // while other students may be saving).
  lcResetResume_(email);
}
function lcArchiveIfMissing_(email,group){
  if(!group)return;email=normEmail_(email);var sh=historySheet_(),vals=sh.getDataRange().getValues();
  for(var i=1;i<vals.length;i++)if(normEmail_(vals[i][0])===email&&String(vals[i][1])===String(group.groupId))return;
  sh.appendRow([email,group.groupId,group.bookTitle,new Date()]);
}
function lcMigrateOwnedRows_(sheet,email,fromGroupId,toGroupId){
  email=normEmail_(email);var vals=sheet.getDataRange().getValues();
  for(var i=1;i<vals.length;i++)if(String(vals[i][0])===String(fromGroupId)&&normEmail_(vals[i][1])===email)sheet.getRange(i+1,1).setValue(toGroupId);
}
function lcMigrateStudentOwnedWork_(email,fromGroupId,toGroupId){
  lcMigrateOwnedRows_(workSheet_(),email,fromGroupId,toGroupId);
  lcMigrateOwnedRows_(draftSheet_(),email,fromGroupId,toGroupId);
  lcMigrateOwnedRows_(reflectSheet_(),email,fromGroupId,toGroupId);
  lcMigrateOwnedRows_(selfAssessSheet_(),email,fromGroupId,toGroupId);
  // These two keep GroupId in a different column: found by header name.
  lcMigrateByHeader_(stepDraftSheet_(),email,fromGroupId,toGroupId);
  lcMigrateByHeader_(writingStatsSheet_(),email,fromGroupId,toGroupId);
}
function lcMigrateByHeader_(sheet,email,fromGroupId,toGroupId){
  var gc=lcCol_(sheet,'GroupId'),ec=lcCol_(sheet,'Email');if(!gc||!ec)return;
  lcFindRowNumbers_(sheet,'Email',normEmail_(email)).forEach(function(r){
    if(String(sheet.getRange(r,gc).getValue())===String(fromGroupId))sheet.getRange(r,gc).setValue(toGroupId);
  });
}
/** Take an email that isn't a student in any class (usually a typo) out of a group's member list.
 *  Real students are moved with the roster's Group menu instead, which keeps their work. */
function teacherRemoveLiteratureGroupMember(payload){
  return withLock_(function(){
    var t=lcRequireTeacher_();payload=payload||{};var classId=String(payload.classId||''),email=normEmail_(payload.email),groupId=String(payload.groupId||'');
    if(!lcTeacherOwnsClass_(classId,t))throw new Error('Class not found or access denied.');
    var rec=lcGroupRowById_(groupId);if(!rec)throw new Error('That group no longer exists.');
    if(rec.group.memberEmails.map(normEmail_).indexOf(email)<0)return{ok:true};
    var enrolled=lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).some(function(x){return normEmail_(x.StudentEmail)===email&&lcTruth_(x.Active);});
    if(enrolled)throw new Error(email+' is a student in one of your classes. Use the Group menu next to their name to move them, so their work goes with them.');
    lcArchiveIfMissing_(email,rec.group); // if it was a real person, their book stays listed under Past books
    lcRemoveStudentFromGroup_(groupId,email);
    return{ok:true};
  });
}
function teacherMoveLiteratureStudentGroup(payload){
  return withLock_(function(){
    var t=lcRequireTeacher_();payload=payload||{};var classId=String(payload.classId||''),email=normEmail_(payload.studentEmail),targetId=String(payload.targetGroupId||'');
    if(!lcTeacherOwnsClass_(classId,t))throw new Error('Class not found or access denied.');
    if(!email||!lcTeacherStudentEnrolled_(classId,email))throw new Error('That student is not enrolled in this class.');
    var current=findGroupByEmail_(email),target=targetId?lcGroupRowById_(targetId):null;
    if(targetId&&!target)throw new Error('The destination group could not be found.');
    if(current&&target&&String(current.groupId)===String(target.group.groupId))return{ok:true};
    if(current)lcRemoveStudentFromGroup_(current.groupId,email);
    if(target){
      var sameBook=current&&String(current.bookTitle||'').trim().toLowerCase()===String(target.group.bookTitle||'').trim().toLowerCase();
      if(current&&sameBook)lcMigrateStudentOwnedWork_(email,current.groupId,target.group.groupId);
      else if(current&&!sameBook){lcArchiveIfMissing_(email,current);lcClearResumeTeacher_(email);}
      lcAddStudentToGroup_(target.group.groupId,email);
    }else{
      lcClearResumeTeacher_(email);
    }
    return{ok:true};
  });
}
function teacherCreateLiteratureGroupForStudent(payload){
  return withLock_(function(){
    var t=lcRequireTeacher_();payload=payload||{};var classId=String(payload.classId||''),email=normEmail_(payload.studentEmail),bookTitle=String(payload.bookTitle||'').trim();
    var cplan=lcNormalizeClassSettings_((lcClass_(classId)||{}).SettingsJson).plan;if(lcPlanSingle_(cplan))bookTitle=cplan.book.title;
    if(!lcTeacherOwnsClass_(classId,t))throw new Error('Class not found or access denied.');
    if(!email||!lcTeacherStudentEnrolled_(classId,email))throw new Error('That student is not enrolled in this class.');
    if(!bookTitle)throw new Error('Enter a book title for the new group.');
    var current=findGroupByEmail_(email),sameBook=current&&String(current.bookTitle||'').trim().toLowerCase()===bookTitle.toLowerCase();
    if(current){lcRemoveStudentFromGroup_(current.groupId,email);if(!sameBook){lcArchiveIfMissing_(email,current);lcClearResumeTeacher_(email);}}
    var readings=lcPlanSingle_(cplan)?cplan.book.reading.slice():(payload.weekReading||['','','','']);while(readings.length<4)readings.push('');
    var gid=Utilities.getUuid(),sh=groupsSheet_(),row=sh.getLastRow()+1;sh.getRange(row,2).setNumberFormat('@');sh.getRange(row,4,1,4).setNumberFormat('@');
    sh.getRange(row,1,1,8).setValues([[gid,bookTitle,email,String(readings[0]||''),String(readings[1]||''),String(readings[2]||''),String(readings[3]||''),new Date()]]);lcInvalidateGroups_();
    if(current&&sameBook)lcMigrateStudentOwnedWork_(email,current.groupId,gid);
    return{ok:true,groupId:gid};
  });
}
function teacherRestoreLiteratureArchive(payload){
  return withLock_(function(){
    var t=lcRequireTeacher_();payload=payload||{};var classId=String(payload.classId||''),email=normEmail_(payload.studentEmail),archiveGroupId=String(payload.groupId||'');
    if(!lcTeacherOwnsClass_(classId,t))throw new Error('Class not found or access denied.');
    if(!email||!lcTeacherStudentEnrolled_(classId,email))throw new Error('That student is not enrolled in this class.');
    var target=lcGroupRowById_(archiveGroupId);if(!target)throw new Error('That archived Literature Circle group no longer exists.');
    var current=findGroupByEmail_(email);
    if(current&&String(current.groupId)!==archiveGroupId){lcRemoveStudentFromGroup_(current.groupId,email);lcArchiveIfMissing_(email,current);}
    lcAddStudentToGroup_(archiveGroupId,email);
    var h=historySheet_(),vals=h.getDataRange().getValues();
    for(var i=vals.length-1;i>=1;i--)if(normEmail_(vals[i][0])===email&&String(vals[i][1])===archiveGroupId){h.deleteRow(i+1);break;}
    lcClearResumeTeacher_(email);
    return{ok:true,bookTitle:target.group.bookTitle};
  });
}

// ============================================================================
// ESSENTIAL QUESTIONS / MARKING ALERT METADATA / EXCLUDED GRADE SUPPORT
// 2026-09-18
// ============================================================================

// ============================================================================
// RELEASE CHECK — run checkFiles from the Apps Script editor after pasting.
// It compares each pasted HTML file with the release it came from, so a paste that was cut
// short (or an old copy) is caught before students see it. It checks FILE CONTENTS only: it
// cannot tell whether a new version has been deployed (Deploy > Manage deployments).
// Regenerate FILE_FINGERPRINTS with Node every release.
// ============================================================================
var FILE_FINGERPRINTS = {
  "release": "2026-11-06a",
  "files": {
    "Index": {
      "chars": 414737,
      "md5": "f5e8f40121b3773b998ae55bbd4f148c",
      "md5ws": "d7080e385af3c23aaba190118c7d4446"
    },
    "BackendClient": {
      "chars": 291739,
      "md5": "733e07b3b9e261d16de48d23c16dc9ef",
      "md5ws": "352d21489bcc8d9f94cd24097ffc868a"
    },
    "Checklists": {
      "chars": 37708,
      "md5": "e142662a05ddddebcbebfcf599017a08",
      "md5ws": "8ced0b6c9c34f42e2c77c23e4675e9fc"
    },
    "SaveGuard": {
      "chars": 69934,
      "md5": "bba51bf125f14e43176fb41be37bd3d3",
      "md5ws": "e2b286d6ecd70641c10be3934fd2b946"
    },
    "StrategyArt": {
      "chars": 5333,
      "md5": "2b9db4e2bd154796bd102b21855addde",
      "md5ws": "6941470697e0d906f3ee954b7cb7e749"
    },
    "WritingStats": {
      "chars": 40917,
      "md5": "e7250d78ea66c64ad91fe9d52ad3abc9",
      "md5ws": "e05289cf9fc6447cdc49f5c5f4d41edf"
    },
    "WritingFocus": {
      "chars": 15073,
      "md5": "4f5c5516c5f622f66ef4daddac507927",
      "md5ws": "b957e6ed7e7bb406b3df20166f4072b8"
    },
    "ReadingQuiz": {
      "chars": 27234,
      "md5": "7c8edc57551b0579d9eb71ea6cb4b7dc",
      "md5ws": "7362eb8f96e819f661c56f99c7c1f6dc"
    },
    "DiscussionDeck": {
      "chars": 40018,
      "md5": "66d4a299e4371d95e8d48440b7c3c550",
      "md5ws": "c038469243dbf59547ee7cb70bd56e38"
    },
    "DiscussionAway": {
      "chars": 11011,
      "md5": "d96ac6acc1afe4884da2f05b79e4cc94",
      "md5ws": "b231f6e2675671dc652bb21b5972741f"
    },
    "CommentBank": {
      "chars": 8440,
      "md5": "ed80ae6318e8ed28388165d7badeb89b",
      "md5ws": "2614fe902070bc8f82030a73a495604e"
    },
    "WeekDueDates": {
      "chars": 11869,
      "md5": "900bdbc8aef4eea9e0dee8467cadc6df",
      "md5ws": "3c3ecc1aba1f02c5b6a0bf5727fd53ae"
    },
    "Bullets": {
      "chars": 8020,
      "md5": "d8aee7ba288c6f9ababc9a9e564a1ef7",
      "md5ws": "b63ac98c4d757eca759e72092e0b3d78"
    },
    "MarkStyle": {
      "chars": 10860,
      "md5": "0706167565478718870781d769673d50",
      "md5ws": "d7487e82fe6723edd480fc42386d0e5f"
    },
    "UnitPlan": {
      "chars": 25869,
      "md5": "62b444c4ad02280cf4cd3445ea9c7c70",
      "md5ws": "1a7756a5a996db4562f83667a7ba8107"
    },
    "LibraryTheme": {
      "chars": 232280,
      "md5": "dad179517742439f77438553b0295dfa",
      "md5ws": "3728d5708c6815961a48cd70fec62c28"
    }
  }
};

function lcFileFingerprint_(name) {
  var text = HtmlService.createTemplateFromFile(name).getRawContent().replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
  return { chars: text.length, md5: lcMd5Hex_(text), md5ws: lcMd5Hex_(text.replace(/\s+/g, '')) };
}

function checkFiles() {
  var lines = ['Lit Circles release ' + FILE_FINGERPRINTS.release + ' (server code: ' + LC_APP_VERSION + ')'];
  var expected = FILE_FINGERPRINTS.files, allOk = true;
  Object.keys(expected).forEach(function (name) {
    var want = expected[name], got;
    try { got = lcFileFingerprint_(name); } catch (e) { lines.push(name + ': MISSING — add an HTML file named exactly "' + name + '"'); allOk = false; return; }
    var status;
    if (got.md5 === want.md5) status = 'OK';
    else if (got.md5ws === want.md5ws) status = 'OK* (only spacing differs)';
    else if (got.chars < want.chars * 0.98) { status = 'SHORT — ' + got.chars + ' of ' + want.chars + ' characters. The paste was probably cut off; paste it again.'; allOk = false; }
    else if (got.chars > want.chars * 1.02) { status = 'TOO BIG — ' + got.chars + ' vs ' + want.chars + ' characters. Was something pasted twice?'; allOk = false; }
    else { status = 'DIFFERS — ' + got.chars + ' vs ' + want.chars + ' characters. This is not the ' + FILE_FINGERPRINTS.release + ' copy.'; allOk = false; }
    lines.push(name + ': ' + status);
  });
  lines.push(allOk ? 'All files match. Now deploy a new version (Deploy > Manage deployments > pencil > New version).' : 'Fix the files above before deploying.');
  var msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}
