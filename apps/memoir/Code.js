/**
 * Memoir — Lead to Climax
 * =========================================================
 * Google Apps Script backend for the Memoir unit app. Same engine as the
 * Macbeth Curriculum and Short Story apps: classes and join codes, one
 * spreadsheet backend, whole-state autosave, per-piece grading, grading
 * tiles, Canvas push, and a writing-process record for every writing box.
 *
 * FIRST-TIME SETUP (see READ_ME_FIRST.txt for the full walkthrough)
 *   1. Paste every file into this Apps Script project.
 *   2. Run setupMemoirBackend() once from the editor. It creates the backend
 *      spreadsheet, makes you the administrator, and asks for permissions in a
 *      normal editor tab (never inside the app, where the dialog breaks).
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access:
 *      anyone in your Google Workspace domain.
 *   4. Optional: Project Settings > Script Properties > GEMINI_API_KEY for the
 *      writing coach and poster title ideas. Everything else works without it.
 */

const MEMOIR_DB_PROP = 'MEMOIR_DB_ID';
// Bump this value for every published build. The browser compares its embedded
// build number with the shared live marker, so a cached page cannot quietly
// keep students on old code after a new deployment.
const MEMOIR_APP_VERSION = '2026-10-23a';
// Shared across every deployment version of this project, so an old open tab
// can still discover that a newer build has gone live.
const MEMOIR_LIVE_VERSION_PROP = 'MEMOIR_LIVE_VERSION';

// Every tab and its columns. New columns always go at the END, so rows written
// by an older build keep their positions; ensureSheet_ appends any column the
// code expects but the sheet lacks. Writes are header-driven, never positional.
const SHEETS = {
  USERS: ['email','name','role','status','createdAt','updatedAt'],
  CLASSES: ['classId','teacherEmail','className','period','joinCode','settingsJson','active','createdAt','updatedAt'],
  ENROLL: ['classId','studentEmail','studentName','joinedAt','active'],
  // A student's whole saved state is one JSON string. A spreadsheet cell stops
  // at 50,000 characters, so it is chunked across stateJson..stateJson5. Every
  // reader goes through workState_(row) -- a truncated chunk would otherwise
  // parse to {} and show a student's work as empty rather than as an error.
  WORK: ['classId','studentEmail','studentName','stateJson','updatedAt','stateJson2','stateJson3','stateJson4','stateJson5'],
  // The Lead Share board. One post per student (revising the lead updates the
  // same post, so replies stay attached), replies in their own tab.
  DISCUSS: ['postId','classId','studentEmail','studentName','text','createdAt','updatedAt','topic'],
  DISCUSS_REPLIES: ['replyId','classId','postId','studentEmail','studentName','text','createdAt'],
  // One row per (class, student, itemType, itemKey). itemType is 'memoir' (one
  // row per graded piece: the six stages, Lead Share and the poster) or
  // 'memoirRubric' (one row per criterion of the final memoir). markedText is a
  // fingerprint of the work AS IT STOOD when the teacher marked it -- comparing
  // it with the work now is how a redo is detected, without trusting a clock.
  GRADEITEMS: ['classId','studentEmail','studentName','itemType','itemKey','score','excluded','comment','gradedBy','gradedAt','markedText'],
  // The poster a student turned in, as a JPEG split across img1..img8 (a cell
  // holds 50,000 characters). Kept out of WORK so it is not re-sent with every
  // autosave.
  POSTERS: ['classId','studentEmail','studentName','title','author','mimeType','width','height','savedAt','img1','img2','img3','img4','img5','img6','img7','img8']
};

// ---- The graded pieces -------------------------------------------------------
// Mirrors MemoirData.html. The server never needs the rubric WORDS, only which
// pieces exist and what each is worth.
const STAGE_KEYS = ['lead','beginning','rising','callback','climax','sowhat'];
const STAGE_LABELS = {lead:'The Lead', beginning:'The Beginning', rising:'Rising Action', callback:'The Callback', climax:'The Climax', sowhat:'So What?'};
const MEMOIR_STEP_KEYS = ['lead','share','beginning','rising','callback','climax','sowhat'];
const MEMOIR_FINAL_KEY = 'final';
const MEMOIR_POSTER_KEY = 'poster';
const MEMOIR_GRADE_KEYS = MEMOIR_STEP_KEYS.concat([MEMOIR_FINAL_KEY, MEMOIR_POSTER_KEY]);
const MEMOIR_PIECE_KEYS = MEMOIR_STEP_KEYS.concat([MEMOIR_POSTER_KEY]);  // scored one row each
const MEMOIR_GRADE_LABELS = {lead:'The Lead', share:'Lead Share', beginning:'The Beginning', rising:'Rising Action', callback:'The Callback', climax:'The Climax', sowhat:'So What?', final:'Final Memoir', poster:'Memoir Poster'};
const MEMOIR_STEP_POINTS = {lead:7, share:7, beginning:7, rising:7, callback:1, climax:7, sowhat:7, poster:1};
const MEMOIR_PASS_FAIL = {callback:true, poster:true};
const MEMOIR_CRITERIA = ['Structure & Frame','Pacing & Detail','Reflection & Significance','Voice & Conventions'];
const CRITERION_MAX = 7;
const CRITERION_POINTS = [7,6,5,4,1];
function pieceMax_(key) { return MEMOIR_STEP_POINTS[key] || 0; }
function memoirFinalPoints_() { return MEMOIR_CRITERIA.length * CRITERION_MAX; }
// Which stage a piece belongs to for release purposes. Everything is its own
// release switch; this just names them.
const RELEASE_KEYS = ['lead','share','beginning','rising','callback','climax','sowhat','final','poster'];

// ---- Writing coach & poster art (optional) ------------------------------------
// The coach is told never to rewrite the student's words.
const FEEDBACK_PROMPT =
  "You are a supportive creative writing coach for a middle/high school " +
  "student writing a memoir. Look at the section of their draft they've shared. " +
  "WITHOUT rewriting any of their sentences or providing replacement text, give " +
  "feedback that: (1) names one specific craft move that's working (e.g. sensory " +
  "detail, pacing, internal/external balance), (2) asks 1-2 guiding questions to " +
  "help them revise it themselves, (3) stays specific to THEIR words, not generic. " +
  "Keep your total response under 130 words.";
const TITLE_PROMPT =
  "You are helping a middle/high school student title their finished personal " +
  "memoir. Read their full draft below and suggest ONE short, specific, evocative " +
  "title (aim for 3-8 words). Avoid generic titles like 'My Memoir', 'A Memory', " +
  "or 'The Day That Changed My Life' — make it specific to a concrete detail, image, " +
  "or phrase from THEIR actual draft. Reply with ONLY the title itself — no quotation " +
  "marks, no explanation, no extra text.";
// The AI features (writing coach, title ideas, painted poster backgrounds) are
// switched OFF in this release. Everything else works without them. To bring
// them back later, change false to true here and redeploy; each class can then
// still turn them off in Release & Resources.
const AI_FEATURES_ON = false;
const FEEDBACK_MODEL = 'gemini-3.5-flash-lite';
// Pollinations.ai: free, no key, a plain GET that returns image bytes. Anonymous
// use is limited to about one image every 15 seconds.
const POSTER_IMAGE_BASE_URL = 'https://image.pollinations.ai/prompt/';
// Per student, per day. Keeps one enthusiastic student from spending the key.
const COACH_DAILY_LIMIT = 15;
const TITLE_DAILY_LIMIT = 8;
const ART_DAILY_LIMIT = 10;

// ===========================================================================
// Version guard
// ===========================================================================
// Turn a release id such as 2026-09-28b into a value that can be compared.
// The date sorts first; a, b, ... z, aa, ab... sort within the same date.
function appVersionParts_(value) {
  const text = String(value || '').trim().toLowerCase();
  const m = /^(\d{4}-\d{2}-\d{2})([a-z]+)?$/.exec(text);
  if (!m) return {date:text, suffix:0, raw:text};
  let suffix = 0;
  const letters = m[2] || '';
  for (let i = 0; i < letters.length; i++) suffix = suffix * 26 + (letters.charCodeAt(i) - 96);
  return {date:m[1], suffix:suffix, raw:text};
}
function compareAppVersions_(a, b) {
  const av = appVersionParts_(a), bv = appVersionParts_(b);
  if (av.date !== bv.date) return av.date < bv.date ? -1 : 1;
  if (av.suffix !== bv.suffix) return av.suffix < bv.suffix ? -1 : 1;
  if (av.raw === bv.raw) return 0;
  return av.raw < bv.raw ? -1 : 1;
}
function liveAppVersion_() {
  return PropertiesService.getScriptProperties().getProperty(MEMOIR_LIVE_VERSION_PROP) || MEMOIR_APP_VERSION;
}
// The marker only ever moves forward, so an old deployment can never tell the
// whole class to downgrade.
function registerLiveAppVersion_() {
  const lock = LockService.getScriptLock();
  try { lock.tryLock(2000); } catch (_e) {}
  try {
    const props = PropertiesService.getScriptProperties();
    const live = props.getProperty(MEMOIR_LIVE_VERSION_PROP) || '';
    if (!live || compareAppVersions_(MEMOIR_APP_VERSION, live) > 0) {
      props.setProperty(MEMOIR_LIVE_VERSION_PROP, MEMOIR_APP_VERSION);
      return MEMOIR_APP_VERSION;
    }
    return live;
  } finally {
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_e2) {}
  }
}

function doGet() {
  registerLiveAppVersion_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Memoir — Lead to Climax')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getAppVersion() {
  return {version: liveAppVersion_(), serverBuild: MEMOIR_APP_VERSION, url: appWebUrl_()};
}

// Index.html splices the other files in with this, so no single pasted file
// has to be enormous.
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Run ONCE from the Apps Script editor. Creates the backend spreadsheet (or
// reuses it), makes whoever runs it the administrator, and -- because it runs
// in a normal editor tab -- is where Google asks for every permission this app
// uses, including the outbound requests Canvas and the writing coach need.
function setupMemoirBackend() {
  const email = currentEmail_();
  if (!email) throw new Error('No Google Workspace email was detected. Run setup while signed into your school Google account.');
  let id = PropertiesService.getScriptProperties().getProperty(MEMOIR_DB_PROP);
  let ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('Memoir Unit Backend');
    PropertiesService.getScriptProperties().setProperty(MEMOIR_DB_PROP, ss.getId());
  }
  Object.keys(SHEETS).forEach(function(key){ ensureSheet_(ss, key, SHEETS[key]); });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  upsertUser_(email, displayNameFromEmail_(email), 'admin', 'active');
  // Touch the network once so the external-request permission is granted here,
  // in the editor, rather than half-rendering inside the web app later.
  try { UrlFetchApp.fetch('https://www.google.com/robots.txt', {muteHttpExceptions:true}); } catch (e) {}
  registerLiveAppVersion_();
  Logger.log('Backend ready: ' + ss.getUrl());
  Logger.log('You are the administrator (' + email + '). Deploy the web app next.');
  return {ok:true, spreadsheetId:ss.getId(), spreadsheetUrl:ss.getUrl(), adminEmail:email};
}

// ===========================================================================
// Sign-in, classes, joining
// ===========================================================================
function getBootstrap() {
  const email = currentEmail_();
  if (!email) return {ok:false, error:'EMAIL_NOT_AVAILABLE', message:'Your school Google account could not be detected. If you are signed into more than one Google account in this browser, sign out of all of them, sign back in with only your school account, and reload.'};
  ensureDb_();
  const user = getUser_(email);
  const role = user && user.status === 'active' ? user.role : 'student';
  const result = {ok:true, email:email, name:(user && user.name) || displayNameFromEmail_(email), role:role,
    accessStatus:user ? user.status : 'student', classes:[], appVersion:liveAppVersion_(), appUrl:appWebUrl_(),
    aiFeatures: AI_FEATURES_ON, aiConfigured: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')};
  if (role === 'admin' || role === 'teacher') {
    result.classes = getTeacherClasses_(email, role === 'admin');
    result.access = role === 'admin' ? adminListAccess_() : null;
    return result;
  }
  result.classes = getStudentClasses_(email);
  if (result.classes.length) {
    const klass = result.classes[0];
    const classId = klass.classId;
    result.activeClassId = classId;
    const enrolled = enrolledName_(classId, email);
    if (enrolled) result.name = enrolled;
    result.needsName = nameLooksIncomplete_(result.name);
    const work = getStudentWork_(classId, email);
    result.state = work.state;
    // Sent back with every save, so the server can tell a save built on the
    // current copy from one built on yesterday's.
    result.stateUpdatedAt = work.updatedAt;
    result.classSettings = sanitizeClassSettingsForStudent_(parseJson_(klass.settingsJson, defaultClassSettings_()));
    result.discussion = getLeadShare_(classId);
    const posts = discussPostsByEmail_(classId)[norm_(email)] || [];
    const poster = postersByEmail_(classId)[norm_(email)] || null;
    result.gradeSummary = gradeSummaryForStudent_(classId, email, work.state, null, {posts:posts, poster:poster});
    result.poster = poster ? {title:poster.title, author:poster.author, savedAt:poster.savedAt} : null;
  }
  return result;
}

function createClass(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const className = String(payload.className || '').trim();
  if (!className) throw new Error('Class name is required.');
  const period = String(payload.period || '').trim();
  const classId = Utilities.getUuid();
  const code = uniqueJoinCode_();
  const now = new Date().toISOString();
  const sh = ensureSheet_(db_(), 'CLASSES', SHEETS.CLASSES);
  withScriptLock_(15000, function(){
    sh.appendRow(rowFromObject_(headersOf_(sh), {classId:classId, teacherEmail:me.email, className:className, period:period,
      joinCode:code, settingsJson:JSON.stringify(defaultClassSettings_()), active:true, createdAt:now, updatedAt:now}));
  });
  return {ok:true, classId:classId, className:className, period:period, joinCode:code};
}

function joinClass(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Sign in with your school Google account first.');
  payload = payload || {};
  const code = String(payload.code || '').trim().toUpperCase();
  if (!code) throw new Error('Enter your class code.');
  const name = requireFullName_(payload.firstName, payload.lastName, payload.name);
  const klass = sheetObjects_('CLASSES').find(function(r){ return String(r.joinCode).toUpperCase() === code && truthy_(r.active); });
  if (!klass) throw new Error('That class code was not found. Check it with your teacher — the letters O and I are never used, so 0 and 1 are numbers.');
  const sh = ensureSheet_(db_(), 'ENROLL', SHEETS.ENROLL);
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [klass.classId, email]);
  if (row < 1) {
    withScriptLock_(15000, function(){
      if (findRowByKeys_(sh, h, ['classId','studentEmail'], [klass.classId, email]) < 1)
        sh.appendRow(rowFromObject_(h, {classId:klass.classId, studentEmail:email, studentName:name, joinedAt:new Date().toISOString(), active:true}));
    });
  } else {
    const vals = sh.getRange(row, 1, 1, h.length).getValues()[0];
    if (!truthy_(vals[h.indexOf('active')])) sh.getRange(row, h.indexOf('active') + 1).setValue(true);
    if (String(vals[h.indexOf('studentName')] || '').trim() !== name) setStudentNameEverywhere_(email, name);
  }
  ensureStudentWork_(klass.classId, email, name);
  return {ok:true, classId:klass.classId, className:klass.className};
}

function saveStudentState(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Not signed in.');
  payload = payload || {};
  const classId = String(payload.classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const state = payload.state && typeof payload.state === 'object' ? payload.state : {};
  const name = enrolledName_(classId, email) || displayNameFromEmail_(email);
  const res = upsertWork_(classId, email, name, state, payload.baseUpdatedAt);
  // After a merge the browser gets the combined copy back, so its next save
  // builds on it instead of quietly replacing it.
  return {ok:true, updatedAt:res.updatedAt, merged:res.merged, kept:res.kept, state:res.merged ? res.state : null};
}

// Refresh for a student: the browser flushes its own pending save first, then
// asks for the authoritative copy, so Refresh can never erase a sentence.
function getStudentStateRefresh(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Not signed in.');
  payload = payload || {};
  const classId = String(payload.classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  const work = getStudentWork_(classId, email);
  const posts = discussPostsByEmail_(classId)[norm_(email)] || [];
  const poster = postersByEmail_(classId)[norm_(email)] || null;
  return {
    ok:true, state:work.state, stateUpdatedAt:work.updatedAt,
    classSettings:sanitizeClassSettingsForStudent_(parseJson_(klass.settingsJson, defaultClassSettings_())),
    discussion:getLeadShare_(classId),
    gradeSummary:gradeSummaryForStudent_(classId, email, work.state, null, {posts:posts, poster:poster}),
    poster: poster ? {title:poster.title, author:poster.author, savedAt:poster.savedAt} : null
  };
}

// The student's own scores, fresh, for the Your Grades page.
function getMyGrades(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Not signed in.');
  const classId = String((payload || {}).classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const work = getStudentWork_(classId, email);
  const posts = discussPostsByEmail_(classId)[norm_(email)] || [];
  const poster = postersByEmail_(classId)[norm_(email)] || null;
  return {ok:true, gradeSummary:gradeSummaryForStudent_(classId, email, work.state, null, {posts:posts, poster:poster})};
}

function updateMyName(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Sign in with your school Google account first.');
  payload = payload || {};
  const full = requireFullName_(payload.firstName, payload.lastName, payload.name);
  withScriptLock_(15000, function(){ setStudentNameEverywhere_(email, full); });
  const u = getUser_(email);
  if (u) upsertUser_(email, full, u.role, u.status);
  return {ok:true, name:full};
}

// ===========================================================================
// Class settings
// ===========================================================================
function defaultReleased_() {
  const out = {};
  RELEASE_KEYS.forEach(function(k){ out[k] = true; });
  return out;
}
// Every stage opens by default -- the way the original Memoir tool worked --
// and each has its own switch. aiCoach and aiPoster only matter once a
// GEMINI_API_KEY is set; leadPaste lets students bring a Lead over from a
// discussion post.
function defaultClassSettings_() {
  // Internal/external highlighting starts OFF: it's a revision step the
  // teacher opens once the rough drafts are written.
  return {releasedSteps:defaultReleased_(), aiCoach:true, aiPoster:true, leadPaste:true, highlighting:false,
          canvas:{courseId:'',courseName:'',assignmentGroupId:'',assignmentGroupName:'',assignments:{}}, assignmentSchedule:{}};
}
function releasedFromSettings_(s) {
  const raw = s && s.releasedSteps && typeof s.releasedSteps === 'object' ? s.releasedSteps : null;
  const out = {};
  RELEASE_KEYS.forEach(function(k){ out[k] = raw && Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] === true : true; });
  return out;
}
function sanitizeClassSettingsForStudent_(s) {
  s = s || {};
  return {releasedSteps:releasedFromSettings_(s), aiCoach:s.aiCoach !== false, aiPoster:s.aiPoster !== false,
          leadPaste:s.leadPaste !== false, highlighting:s.highlighting === true, assignmentSchedule:s.assignmentSchedule || {}};
}
function managedClass_(classId) {
  const me = requireTeacher_();
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  return {me:me, klass:klass};
}

function saveClassSettings(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const incoming = payload.settings || {};
  // Only the switches a teacher flips on the dashboard come through here. The
  // Canvas links and due dates are owned by the Canvas calls and never
  // overwritten by a switch.
  const settings = updateClassSettings_(classId, function(s){
    if (incoming.releasedSteps) s.releasedSteps = releasedFromSettings_({releasedSteps:incoming.releasedSteps});
    ['aiCoach','aiPoster','leadPaste'].forEach(function(k){ if (incoming[k] !== undefined) s[k] = incoming[k] !== false; });
    if (incoming.highlighting !== undefined) s.highlighting = incoming.highlighting === true;
  });
  return {ok:true, settings:settings};
}

function updateClass(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const sh = db_().getSheetByName('CLASSES');
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId'], [classId]);
  if (row < 1) throw new Error('Class not found.');
  const vals = sh.getRange(row, 1, 1, h.length).getValues()[0];
  if (payload.className !== undefined) {
    const className = String(payload.className || '').trim();
    if (!className) throw new Error('Class name cannot be blank.');
    vals[h.indexOf('className')] = className;
  }
  if (payload.period !== undefined) vals[h.indexOf('period')] = String(payload.period || '').trim();
  vals[h.indexOf('updatedAt')] = new Date().toISOString();
  withUserLock_(function(){ sh.getRange(row, 1, 1, h.length).setValues([vals]); });
  return {ok:true};
}

// Archiving hides a class from the dashboard. Nothing is deleted.
function archiveClass(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const sh = db_().getSheetByName('CLASSES');
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId'], [classId]);
  if (row < 1) throw new Error('Class not found.');
  withUserLock_(function(){
    sh.getRange(row, h.indexOf('active') + 1).setValue(false);
    sh.getRange(row, h.indexOf('updatedAt') + 1).setValue(new Date().toISOString());
  });
  return {ok:true};
}

// Every change to a class's settings re-reads the stored copy inside the lock
// and changes only its own part, so a release switch and a Canvas push that
// land together can never overwrite each other.
function updateClassSettings_(classId, mutate) {
  const sh = db_().getSheetByName('CLASSES');
  const h = headersOf_(sh);
  return withScriptLock_(15000, function(){
    const row = findRowByKeys_(sh, h, ['classId'], [classId]);
    if (row < 1) throw new Error('Class not found.');
    const cell = sh.getRange(row, h.indexOf('settingsJson') + 1);
    const settings = Object.assign(defaultClassSettings_(), parseJson_(cell.getValue(), {}));
    mutate(settings);
    cell.setValue(JSON.stringify(settings));
    sh.getRange(row, h.indexOf('updatedAt') + 1).setValue(new Date().toISOString());
    return settings;
  });
}

// ===========================================================================
// Teacher dashboard
// ===========================================================================
function classRoster_(classId) {
  return sheetObjects_('ENROLL').filter(function(r){ return r.classId === classId && truthy_(r.active); });
}
function classWorkByEmail_(classId) {
  const out = {};
  sheetObjects_('WORK').forEach(function(w){ if (w.classId === classId) out[norm_(w.studentEmail)] = w; });
  return out;
}

function getClassDashboard(payload) {
  const classId = typeof payload === 'string' ? payload : String((payload || {}).classId || '');
  const ctx = managedClass_(classId);
  const students = classRoster_(classId);
  const works = classWorkByEmail_(classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(function(g){ return g.classId === classId; });
  const postsBy = discussPostsByEmail_(classId);
  const postersBy = postersByEmail_(classId);
  return {
    ok:true,
    classInfo:publicClass_(ctx.klass),
    settings:Object.assign(defaultClassSettings_(), parseJson_(ctx.klass.settingsJson, {}), {releasedSteps:releasedFromSettings_(parseJson_(ctx.klass.settingsJson, {}))}),
    aiFeatures: AI_FEATURES_ON, aiConfigured: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
    students: students.map(function(s){
      const k = norm_(s.studentEmail);
      const w = works[k];
      const st = w ? workState_(w) : {};
      const items = allItems.filter(function(g){ return norm_(g.studentEmail) === k; });
      const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, items, {posts:postsBy[k] || [], poster:postersBy[k] || null});
      return Object.assign({email:s.studentEmail, name:s.studentName, joinedAt:String(s.joinedAt || ''),
        updatedAt:w ? String(w.updatedAt || '') : '', gradeSummary:summary}, progressSummary_(st, postsBy[k] || [], postersBy[k] || null));
    }).sort(function(a, b){ return String(a.name || '').localeCompare(String(b.name || '')); })
  };
}

// Everything one student has written, for the teacher's View Work window.
function getStudentWork(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const studentEmail = String(payload.studentEmail || '').trim();
  const work = getStudentWork_(classId, studentEmail);
  const k = norm_(studentEmail);
  const posts = discussPostsByEmail_(classId)[k] || [];
  const poster = postersByEmail_(classId)[k] || null;
  const st = work.state;
  const m = memoirOf_(st);
  const sections = STAGE_KEYS.map(function(key){
    const raw = stageText_(st, key);
    return {key:key, label:STAGE_LABELS[key], text:raw.trim(), process:stageProcessMeta_(st, key, raw, raw.trim()),
            cadence:cadenceCounts_(m.cadence && m.cadence[key])};
  });
  return {ok:true, student:{email:studentEmail, name:enrolledName_(classId, studentEmail) || displayNameFromEmail_(studentEmail)},
    updatedAt:work.updatedAt, sections:sections, posts:posts, poster:poster ? {title:poster.title, author:poster.author, savedAt:poster.savedAt} : null,
    gradeSummary:gradeSummaryForStudent_(classId, studentEmail, st, null, {posts:posts, poster:poster})};
}

function progressSummary_(st, posts, poster) {
  const m = memoirOf_(st);
  let words = 0, written = 0, turnedIn = 0;
  STAGE_KEYS.forEach(function(k){
    const t = stageText_(st, k);
    const w = wordCount_(t);
    words += w;
    if (w) written++;
    if (submissionStatus_(st, k, posts, poster).submitted) turnedIn++;
  });
  return {
    words:words, stagesWritten:written, stagesTurnedIn:turnedIn,
    sharePosted:(posts || []).some(function(p){ return p.kind === 'post'; }),
    repliesWritten:(posts || []).filter(function(p){ return p.kind === 'reply'; }).length,
    finalTurnedIn:submissionStatus_(st, MEMOIR_FINAL_KEY, posts, poster).submitted,
    posterTurnedIn:!!poster,
    selfRated:Object.keys(m.selfEval || {}).filter(function(c){ return m.selfEval[c] !== '' && m.selfEval[c] !== undefined && m.selfEval[c] !== null; }).length
  };
}

// ===========================================================================
// The memoir, as the grader sees it
// ===========================================================================
// A student's work lives in state.memoir:
//   texts        {lead, beginning, rising, callback, climax, sowhat}
//   cadence      {stage: [{type:'internal'|'external', start, end}]}
//   checks       {stage: [bool, ...]}         the student's own craft checklist
//   meta         {stage: writing-process record}  see AppLogic attachWritingBox_
//   submissions  {stage|final: {sig, submittedAt}}
//   selfEval     {criterion: band index}   selfComments {criterion: text}
//   coach        {stage: [{at, text}]}     writing-coach replies, newest last
//   poster       {title, author, hint, savedAt}
function memoirOf_(state) {
  const m = state && state.memoir;
  return m && typeof m === 'object' ? m : {};
}
function stageText_(state, key) {
  const t = memoirOf_(state).texts || {};
  return String(t[key] === undefined || t[key] === null ? '' : t[key]);
}
// The finished memoir in reading order, one paragraph block per stage, no stage
// names -- the same text the student's poster and download show.
function memoirAssembledText_(state) {
  return STAGE_KEYS.map(function(k){ return stageText_(state, k).trim(); }).filter(Boolean).join('\n\n');
}
function shareText_(posts) {
  return (posts || []).map(function(p){ return (p.kind === 'reply' ? 'Reply to ' + (p.to || 'a classmate') + ': ' : '') + String(p.text || ''); }).join('\n\n');
}
function posterText_(poster) {
  if (!poster || !poster.savedAt) return '';
  return 'poster|' + String(poster.title || '') + '|' + String(poster.author || '') + '|' + String(poster.savedAt || '');
}
// What counts as "the work" for each graded piece. Its fingerprint is stored
// when the teacher marks it; a later mismatch is a redo.
function memoirTextFor_(state, key, posts, poster) {
  if (STAGE_KEYS.indexOf(key) !== -1) return stageText_(state, key);
  if (key === 'share') return shareText_(posts);
  if (key === MEMOIR_FINAL_KEY) return memoirAssembledText_(state);
  if (key === MEMOIR_POSTER_KEY) return posterText_(poster);
  return '';
}

// ---- Explicit hand-in ---------------------------------------------------------
// Autosave keeps drafts safe; it does not mean the student turned them in. Each
// turn-in stores a tiny signature of the exact version. Revise afterwards and
// the signature stops matching: the stage is a draft again until it is turned
// in again. The same FNV hash runs in the browser (AppLogic submissionSig_).
function submissionSig_(text) {
  const t = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return t.length + ':' + h.toString(16);
}
// The Lead Share board and the poster are turned in by doing them: posting a
// lead, or saving a poster. The stages and the final memoir are turned in by
// pressing Turn in.
function submissionStatus_(state, key, posts, poster) {
  if (key === 'share') {
    const post = (posts || []).filter(function(p){ return p.kind === 'post'; }).pop();
    return {submitted:!!(post && String(post.text || '').trim()), submittedAt:post ? String(post.date || '') : ''};
  }
  if (key === MEMOIR_POSTER_KEY) return {submitted:!!(poster && poster.savedAt), submittedAt:poster ? String(poster.savedAt || '') : ''};
  const m = memoirOf_(state);
  const subs = m.submissions && typeof m.submissions === 'object' ? m.submissions : {};
  const rec = subs[key] || {};
  const text = String(memoirTextFor_(state, key, posts, poster) || '').trim();
  return {submitted:!!(rec.sig && text && String(rec.sig) === submissionSig_(text)), submittedAt:rec.submittedAt ? String(rec.submittedAt) : ''};
}

// ---- Writing-process record ----------------------------------------------------
// The browser stores, per writing box, which characters arrived how:
//   p  pasted from outside the app          (flagged to the teacher)
//   q  moved in from the student's own writing in this app (not flagged)
//   u  already in the box before tracking began (reported as unknown)
// plus paste-event counts, blocked outside-paste attempts, and writing time.
// No clipboard contents and no keystroke history are ever kept.
function writingTimeOf_(m) {
  if (!m || typeof m.activeMs !== 'number') return {timed:false, activeMs:0, sessions:0, untimedChars:0};
  return {timed:true, activeMs:Math.max(0, Number(m.activeMs) || 0), sessions:Math.max(0, Number(m.sessions) || 0),
          untimedChars:Math.max(0, Number(m.untimedChars) || 0)};
}
function stageProcessMeta_(state, key, rawText, trimmedText) {
  const all = memoirOf_(state).meta || {};
  const m = all[key] || null;
  const raw = String(rawText || '');
  const text = String(trimmedText || '');
  // Offsets index the RAW stored text; the marking screen shows it trimmed.
  const lead = raw.length - raw.replace(/^\s+/, '').length;
  const len = text.length;
  const spans = [];
  let pasted = 0, moved = 0, unknown = 0;
  if (m && Array.isArray(m.spans)) {
    m.spans.slice(0, 1500).forEach(function(sp){
      if (!sp || sp.length < 2) return;
      const a = Math.max(0, Number(sp[0]) - lead);
      const b = Math.min(len, Number(sp[1]) - lead);
      if (!(b > a)) return;
      const kind = sp[2] === 'q' ? 'q' : sp[2] === 'p' ? 'p' : sp[2] === 'u' ? 'u' : 't';
      if (kind === 't') return;
      spans.push([a, b, kind]);
      if (kind === 'q') moved += b - a; else if (kind === 'p') pasted += b - a; else unknown += b - a;
    });
  }
  // A box this build never tracked: everything in it predates tracking.
  if (!m && len) unknown = len;
  return {
    spans:spans, pasted:pasted, moved:moved, unknown:unknown, total:len,
    typed:Math.max(0, len - pasted - moved - unknown),
    events:Number((m && m.events) || 0), outsideEvents:Number((m && m.outsideEvents) || 0),
    ownEvents:Number((m && m.ownEvents) || 0), blocked:Number((m && m.blocked) || 0),
    time:writingTimeOf_(m)
  };
}
function processAggregate_(parts) {
  const out = {pasted:0, moved:0, unknown:0, total:0, typed:0, events:0, outsideEvents:0, ownEvents:0, blocked:0,
               time:{timed:false, activeMs:0, sessions:0, untimedChars:0}};
  (parts || []).forEach(function(p){
    if (!p) return;
    const t = p.time || {};
    if (t.timed) {
      out.time.timed = true;
      out.time.activeMs += Number(t.activeMs || 0);
      out.time.sessions += Number(t.sessions || 0);
      out.time.untimedChars += Number(t.untimedChars || 0);
    } else if (Number(p.total || 0) > 0) out.time.untimedChars += Number(p.total || 0);
    ['pasted','moved','unknown','total','typed','events','outsideEvents','ownEvents','blocked'].forEach(function(f){ out[f] += Number(p[f] || 0); });
  });
  return out;
}
function cadenceCounts_(log) {
  const list = Array.isArray(log) ? log : [];
  return {internal:list.filter(function(t){ return t && t.type === 'internal'; }).length,
          external:list.filter(function(t){ return t && t.type === 'external'; }).length};
}
function wordCount_(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).filter(function(w){ return w; }).length : 0;
}
function hasScore_(row) {
  return !!row && row.score !== '' && row.score !== null && row.score !== undefined;
}

// ---- One student's grades -------------------------------------------------------
// Every piece is worth its full value; only an exclusion lowers what it is out
// of. Turned-in work nobody has marked yet is reported as waiting on the
// teacher, never silently as zero; a piece the student never touched is blank.
function gradeSummaryForStudent_(classId, email, state, itemsOverride, opts) {
  state = state || {};
  opts = opts || {};
  const items = itemsOverride || getStudentGradeItems_(classId, email);
  const itemFor = function(type, key){
    return lastMatch_(items, function(g){ return keyOf_(g.itemType) === keyOf_(type) && keyOf_(g.itemKey) === keyOf_(key); });
  };
  return {memoir: memoirSummary_(state, itemFor, opts.posts || [], opts.poster || null)};
}

function memoirSummary_(state, itemFor, posts, poster) {
  const m = memoirOf_(state);
  const steps = {};
  const stepsTotal = {earned:0, possible:0, unmarked:0, missing:0, pendingPoints:0, touched:false, complete:true};
  MEMOIR_PIECE_KEYS.forEach(function(key){
    const row = itemFor('memoir', key);
    const excluded = !!(row && truthy_(row.excluded));
    const points = pieceMax_(key);
    const text = memoirTextFor_(state, key, posts, poster);
    const sub = submissionStatus_(state, key, posts, poster);
    const raw = hasScore_(row) ? Number(row.score) : null;
    // Complete/incomplete pieces tick themselves when turned in. The teacher
    // can still override; nobody has to click 25 boxes to say "yes, done".
    let score = raw, auto = false;
    if (MEMOIR_PASS_FAIL[key] && !excluded && raw === null && sub.submitted) { score = points; auto = true; }
    if (sub.submitted || raw !== null) stepsTotal.touched = true;
    steps[key] = {
      key:key, label:MEMOIR_GRADE_LABELS[key],
      score:excluded ? null : score, teacherScore:raw, auto:auto, excluded:excluded, possible:points,
      passFail:!!MEMOIR_PASS_FAIL[key],
      submitted:sub.submitted, submittedAt:sub.submittedAt,
      draft:!!String(text || '').trim() && !sub.submitted,
      // A teacher may grade a saved draft the student never turned in. The
      // score counts; the submission status stays honest about it.
      teacherGradedDraft:raw !== null && !sub.submitted,
      editedAfterGrading:!!(row && editedSinceMarked_(markedBaseline_(row), text)),
      markedBlank:!!(row && markedBlank_(row)),
      comment:row ? String(row.comment || '') : '', gradedAt:row ? String(row.gradedAt || '') : ''
    };
    if (!excluded) {
      stepsTotal.possible += points;
      stepsTotal.earned += score === null ? 0 : score;
      if (score === null) {
        stepsTotal.complete = false;
        if (sub.submitted) { stepsTotal.unmarked++; stepsTotal.pendingPoints += points; }
        else stepsTotal.missing++;
      }
    }
  });

  // The final memoir on four criteria. Where the teacher has not scored one,
  // the student's own rating is shown as a SUGGESTION -- visible, never counted.
  const selfEval = m.selfEval || {};
  const selfComments = m.selfComments || {};
  const finalText = memoirAssembledText_(state);
  const finalSub = submissionStatus_(state, MEMOIR_FINAL_KEY, posts, poster);
  const criteria = {};
  const finalTotal = {earned:0, possible:0, pending:0, unmarked:0, hasAnyResult:false, submitted:finalSub.submitted,
    submittedAt:finalSub.submittedAt, draft:!!finalText && !finalSub.submitted, teacherGradedDraft:false, complete:true};
  MEMOIR_CRITERIA.forEach(function(c){
    const row = itemFor('memoirRubric', c);
    const excluded = !!(row && truthy_(row.excluded));
    const teacherScore = hasScore_(row) ? Number(row.score) : null;
    const selfIdx = selfEval[c] !== undefined && selfEval[c] !== null ? selfEval[c] : '';
    let display = teacherScore, pending = false;
    if (!excluded && display === null && selfIdx !== '' && CRITERION_POINTS[Number(selfIdx)] !== undefined) {
      display = CRITERION_POINTS[Number(selfIdx)];
      pending = true;
    }
    criteria[c] = {key:c, score:excluded ? null : display, teacherScore:teacherScore, pending:pending,
      selfEvalIdx:selfIdx, selfComment:String(selfComments[c] || ''), excluded:excluded, possible:CRITERION_MAX,
      comment:row ? String(row.comment || '') : '', gradedAt:row ? String(row.gradedAt || '') : ''};
    if (!excluded) {
      finalTotal.possible += CRITERION_MAX;
      if (teacherScore !== null) {
        finalTotal.earned += teacherScore;
        finalTotal.hasAnyResult = true;
        if (!finalSub.submitted) finalTotal.teacherGradedDraft = true;
      } else {
        finalTotal.complete = false;
        if (pending) finalTotal.pending++;
        if (finalSub.submitted) finalTotal.unmarked++;
      }
    }
  });
  finalTotal.editedAfterGrading = MEMOIR_CRITERIA.some(function(c){
    const row = itemFor('memoirRubric', c);
    return !!(row && editedSinceMarked_(markedBaseline_(row), finalText));
  });
  return {
    steps:steps, stepsTotal:stepsTotal, criteria:criteria, finalTotal:finalTotal,
    total:{earned:stepsTotal.earned + finalTotal.earned, possible:stepsTotal.possible + finalTotal.possible,
           touched:stepsTotal.touched || finalSub.submitted || finalTotal.hasAnyResult}
  };
}

// ===========================================================================
// Grading
// ===========================================================================
function gradeItemType_(v) {
  const t = String(v || '');
  return (t === 'memoir' || t === 'memoirRubric') ? t : '';
}
function validateGradeItemKey_(itemType, itemKey) {
  if (!itemType) throw new Error('Item type must be "memoir" or "memoirRubric".');
  if (itemType === 'memoir') {
    if (MEMOIR_PIECE_KEYS.indexOf(itemKey) === -1) throw new Error('Unknown memoir piece: ' + itemKey);
    return;
  }
  if (MEMOIR_CRITERIA.indexOf(itemKey) === -1) throw new Error('Unknown rubric criterion: ' + itemKey);
}
function gradeItemLabel_(itemType, itemKey) {
  return itemType === 'memoir' ? (MEMOIR_GRADE_LABELS[itemKey] || itemKey) : itemKey;
}

function setGradeItem(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = managedClass_(classId);
  const studentEmail = String(payload.studentEmail || '').trim();
  const itemType = gradeItemType_(payload.itemType);
  const itemKey = String(payload.itemKey || '');
  validateGradeItemKey_(itemType, itemKey);
  const excluded = !!payload.excluded;
  const comment = String(payload.comment || '').trim();
  const score = (payload.score === null || payload.score === undefined || payload.score === '') ? null : Number(payload.score);
  if (!excluded && score !== null) {
    const max = itemType === 'memoirRubric' ? CRITERION_MAX : pieceMax_(itemKey);
    if (!(score >= 0 && score <= max)) throw new Error(gradeItemLabel_(itemType, itemKey) + ' must be scored between 0 and ' + max + '.');
  }
  const name = enrolledName_(classId, studentEmail);
  if (!name) throw new Error('That student is not enrolled in this class.');
  // Snapshot the work as it stands right now, so a later rewrite is detectable.
  // Re-saving a mark refreshes this, which is what clears a redo flag.
  const work = getStudentWork_(classId, studentEmail);
  const k = norm_(studentEmail);
  const posts = discussPostsByEmail_(classId)[k] || [];
  const poster = postersByEmail_(classId)[k] || null;
  const markedText = respFingerprint_(memoirTextFor_(work.state, itemType === 'memoirRubric' ? MEMOIR_FINAL_KEY : itemKey, posts, poster));
  upsertGradeItem_(classId, studentEmail, name, itemType, itemKey, score, excluded, comment, ctx.me.email, markedText);
  // Return the recomputed summary so the open gradebook replaces its stale copy
  // at once instead of waiting for a full refresh.
  return {ok:true, gradeSummary:gradeSummaryForStudent_(classId, studentEmail, work.state, null, {posts:posts, poster:poster})};
}

// Excludes (or counts again) one piece for EVERY enrolled student -- for work
// that was flawed, or simply not assessed this time. One read of the sheet and
// batched writes for every pair, never one round-trip per student. Scores and
// comments already entered are left in place, so counting it again brings
// every mark back. Takes {itemType, itemKey} or {memoirFinal:true} (all four
// criteria at once).
function setGradeItemForClass(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = managedClass_(classId);
  const excluded = !!payload.excluded;
  let pairs, label;
  if (payload.memoirFinal === true) {
    pairs = MEMOIR_CRITERIA.map(function(c){ return ['memoirRubric', c]; });
    label = 'Final Memoir';
  } else {
    const itemType = gradeItemType_(payload.itemType);
    const itemKey = String(payload.itemKey || '');
    validateGradeItemKey_(itemType, itemKey);
    pairs = [[itemType, itemKey]];
    label = gradeItemLabel_(itemType, itemKey);
  }
  const students = classRoster_(classId);
  if (!students.length) throw new Error('No students are enrolled in this class yet.');
  return withScriptLock_(30000, function(){
    const sh = ensureSheet_(db_(), 'GRADEITEMS', SHEETS.GRADEITEMS);
    const vals = sh.getDataRange().getValues();
    const h = vals[0].map(function(x){ return String(x).trim(); });
    const c = {};
    SHEETS.GRADEITEMS.forEach(function(k){ c[k] = h.indexOf(k); });
    const now = new Date().toISOString();
    const rowFor = {};
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (r[c.classId] !== classId) continue;
      rowFor[keyOf_(r[c.itemType]) + '|' + keyOf_(r[c.itemKey]) + '|' + norm_(r[c.studentEmail])] = i;
    }
    const appends = [];
    let updated = 0;
    pairs.forEach(function(p){
      students.forEach(function(s){
        const key = keyOf_(p[0]) + '|' + keyOf_(p[1]) + '|' + norm_(s.studentEmail);
        if (rowFor[key] !== undefined) {
          const i = rowFor[key];
          vals[i][c.excluded] = excluded;   // score and comment deliberately kept
          if (c.gradedBy >= 0) vals[i][c.gradedBy] = ctx.me.email;
          if (c.gradedAt >= 0) vals[i][c.gradedAt] = now;
          updated++;
        } else {
          appends.push(rowFromObject_(h, {classId:classId, studentEmail:s.studentEmail, studentName:s.studentName,
            itemType:p[0], itemKey:p[1], score:'', excluded:excluded, comment:'', gradedBy:ctx.me.email, gradedAt:now, markedText:''}));
        }
      });
    });
    if (vals.length > 1) sh.getRange(1, 1, vals.length, h.length).setValues(vals);
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, h.length).setValues(appends);
    return {ok:true, excluded:excluded, label:label, items:pairs.length, updated:updated, created:appends.length};
  });
}

// Every enrolled student's work on ONE piece, for the marking screen. The final
// memoir comes back with all four criteria at once: the teacher reads it once
// and scores the four together.
function getMemoirResponses(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const stepKey = String(payload.stepKey || '');
  if (MEMOIR_GRADE_KEYS.indexOf(stepKey) === -1) throw new Error('Unknown memoir piece: ' + stepKey);
  const isFinal = stepKey === MEMOIR_FINAL_KEY;
  const students = classRoster_(classId);
  const works = classWorkByEmail_(classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(function(g){ return g.classId === classId; });
  const postsBy = discussPostsByEmail_(classId);
  const postersBy = postersByEmail_(classId);
  const refKey = {callback:'lead', climax:'lead', sowhat:'climax'}[stepKey] || '';
  return {
    ok:true, stepKey:stepKey, label:MEMOIR_GRADE_LABELS[stepKey],
    pointsPossible:isFinal ? memoirFinalPoints_() : pieceMax_(stepKey),
    responses: students.map(function(s){
      const k = norm_(s.studentEmail);
      const w = works[k];
      const st = w ? workState_(w) : {};
      const m = memoirOf_(st);
      const posts = postsBy[k] || [];
      const poster = postersBy[k] || null;
      const items = allItems.filter(function(g){ return norm_(g.studentEmail) === k; });
      const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, items, {posts:posts, poster:poster}).memoir;
      const base = {email:s.studentEmail, name:s.studentName, updatedAt:w ? String(w.updatedAt || '') : ''};
      if (isFinal) {
        base.sections = STAGE_KEYS.map(function(key){
          const raw = stageText_(st, key);
          return {key:key, label:STAGE_LABELS[key], text:raw.trim(), process:stageProcessMeta_(st, key, raw, raw.trim())};
        });
        base.text = memoirAssembledText_(st);
        base.words = wordCount_(base.text);
        base.process = processAggregate_(base.sections.map(function(x){ return x.process; }));
        base.cadence = STAGE_KEYS.reduce(function(acc, key){
          const cc = cadenceCounts_((m.cadence || {})[key]);
          acc.internal += cc.internal; acc.external += cc.external; return acc;
        }, {internal:0, external:0});
        base.criteria = summary.criteria;
        base.finalTotal = summary.finalTotal;
        return base;
      }
      const rec = summary.steps[stepKey];
      ['score','teacherScore','auto','excluded','comment','gradedAt','editedAfterGrading','markedBlank','submitted','submittedAt','teacherGradedDraft'].forEach(function(f){ base[f] = rec[f]; });
      if (stepKey === 'share') {
        base.post = posts.filter(function(p){ return p.kind === 'post'; }).pop() || null;
        base.replies = posts.filter(function(p){ return p.kind === 'reply'; });
        base.repliesReceived = base.post ? Number(base.post.replyCount || 0) : 0;
        base.text = shareText_(posts).trim();
        base.words = wordCount_(base.text);
        // The post is the student's Lead mirrored onto the board, so its process
        // record is the Lead box's.
        const leadRaw = stageText_(st, 'lead');
        base.process = stageProcessMeta_(st, 'lead', leadRaw, leadRaw.trim());
        return base;
      }
      if (stepKey === MEMOIR_POSTER_KEY) {
        base.poster = poster ? {title:poster.title, author:poster.author, savedAt:poster.savedAt, width:poster.width, height:poster.height} : null;
        base.text = memoirAssembledText_(st);
        base.words = wordCount_(base.text);
        return base;
      }
      const raw = stageText_(st, stepKey);
      base.text = raw.trim();
      base.words = wordCount_(base.text);
      base.process = stageProcessMeta_(st, stepKey, raw, base.text);
      // Highlight ranges index the raw text too.
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      base.cadence = cadenceCounts_((m.cadence || {})[stepKey]);
      base.cadenceRanges = ((m.cadence || {})[stepKey] || []).slice(0, 400).map(function(r){
        return {type:r && r.type, start:Math.max(0, Number(r && r.start) - lead), end:Math.max(0, Number(r && r.end) - lead)};
      }).filter(function(r){ return (r.type === 'internal' || r.type === 'external') && r.end > r.start; });
      const checks = Array.isArray((m.checks || {})[stepKey]) ? m.checks[stepKey] : [];
      base.checks = {ticked:checks.filter(function(x){ return x === true; }).length, total:checks.length};
      base.coach = Array.isArray((m.coach || {})[stepKey]) ? m.coach[stepKey].slice(-3) : [];
      if (refKey) base.ref = {key:refKey, label:STAGE_LABELS[refKey], text:stageText_(st, refKey).trim()};
      return base;
    })
  };
}

// ---- The Grading Hub's counts -----------------------------------------------------
// One tile per graded piece: how many students are waiting on the teacher.
// "Needs grading" means turned in AND not yet handled (a score or an exclusion).
// A student who wrote nothing is not on the to-do list; neither is one excused.
function getGradingHubSummary(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = managedClass_(classId);
  const settings = parseJson_(ctx.klass.settingsJson, {});
  const released = releasedFromSettings_(settings);
  const students = classRoster_(classId);
  const works = classWorkByEmail_(classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(function(g){ return g.classId === classId; });
  const postsBy = discussPostsByEmail_(classId);
  const postersBy = postersByEmail_(classId);
  const stateFor = {};
  students.forEach(function(s){ const w = works[norm_(s.studentEmail)]; stateFor[norm_(s.studentEmail)] = w ? workState_(w) : {}; });
  const itemRow = function(type, key, email){
    return lastMatch_(allItems, function(g){ return keyOf_(g.itemType) === keyOf_(type) && keyOf_(g.itemKey) === keyOf_(key) && norm_(g.studentEmail) === norm_(email); });
  };
  const handled_ = function(row){ return !!row && (truthy_(row.excluded) || hasScore_(row)); };
  const scored_ = function(row){ return !!row && hasScore_(row) && !truthy_(row.excluded); };
  const excludedForAll_ = function(pairs){
    if (!students.length) return false;
    return pairs.every(function(p){ return students.every(function(s){ const r = itemRow(p[0], p[1], s.studentEmail); return !!r && truthy_(r.excluded); }); });
  };
  const tiles = MEMOIR_PIECE_KEYS.map(function(key){
    let submitted = 0, graded = 0, needsGrading = 0, needsRegrade = 0;
    students.forEach(function(stu){
      const k = norm_(stu.studentEmail);
      const st = stateFor[k];
      const posts = postsBy[k] || [];
      const poster = postersBy[k] || null;
      const text = String(memoirTextFor_(st, key, posts, poster) || '').trim();
      const sub = submissionStatus_(st, key, posts, poster);
      const row = itemRow('memoir', key, stu.studentEmail);
      let isHandled = handled_(row);
      if (MEMOIR_PASS_FAIL[key] && sub.submitted && !isHandled) isHandled = true;   // ticks itself
      // A revision only comes back onto the pile once it is turned in again.
      const isRedo = !!(sub.submitted && text && scored_(row) && editedSinceMarked_(markedBaseline_(row), text));
      if (sub.submitted) submitted++;
      if (isHandled && !isRedo) graded++;
      if (isRedo) { needsGrading++; needsRegrade++; }
      else if (sub.submitted && !isHandled) needsGrading++;
    });
    return {kind:'memoir', key:key, label:MEMOIR_GRADE_LABELS[key], submitted:submitted, graded:graded,
      needsGrading:needsGrading, needsRegrade:needsRegrade, totalItems:students.length, pointsPossible:pieceMax_(key),
      gradingType:MEMOIR_PASS_FAIL[key] ? 'pass_fail' : 'points', allExcluded:excludedForAll_([['memoir', key]]), released:released[key]};
  });
  // The final memoir is four items per student; it is off the to-do list only
  // once all four are handled.
  let fSub = 0, fGraded = 0, fNeeds = 0, fRedo = 0;
  students.forEach(function(stu){
    const k = norm_(stu.studentEmail);
    const st = stateFor[k];
    const text = memoirAssembledText_(st);
    const sub = submissionStatus_(st, MEMOIR_FINAL_KEY, postsBy[k] || [], postersBy[k] || null);
    const rows = MEMOIR_CRITERIA.map(function(c){ return itemRow('memoirRubric', c, stu.studentEmail); });
    const done = rows.every(handled_);
    const isRedo = !!(sub.submitted && text && rows.some(function(r){ return scored_(r) && editedSinceMarked_(markedBaseline_(r), text); }));
    if (sub.submitted) fSub++;
    if (done && !isRedo) fGraded++;
    if (isRedo) { fNeeds++; fRedo++; }
    else if (sub.submitted && !done) fNeeds++;
  });
  const finalTile = {kind:'memoir', key:MEMOIR_FINAL_KEY, label:MEMOIR_GRADE_LABELS.final, submitted:fSub, graded:fGraded,
    needsGrading:fNeeds, needsRegrade:fRedo, totalItems:students.length, pointsPossible:memoirFinalPoints_(), gradingType:'points',
    allExcluded:excludedForAll_(MEMOIR_CRITERIA.map(function(c){ return ['memoirRubric', c]; })), released:released.final};
  // Tile order follows the unit: the seven drafting pieces, then the finished memoir and the poster.
  const drafting = tiles.filter(function(t){ return t.key !== MEMOIR_POSTER_KEY; });
  const finished = [finalTile, tiles.filter(function(t){ return t.key === MEMOIR_POSTER_KEY; })[0]];
  const all = drafting.concat(finished);
  const needsGradingTotal = all.reduce(function(n, t){ return n + (t.allExcluded ? 0 : t.needsGrading); }, 0);
  const needsRegradeTotal = all.reduce(function(n, t){ return n + (t.allExcluded ? 0 : t.needsRegrade); }, 0);
  return {ok:true, totalStudents:students.length, drafting:drafting, finished:finished,
          needsGradingTotal:needsGradingTotal, needsRegradeTotal:needsRegradeTotal, needsNewTotal:Math.max(0, needsGradingTotal - needsRegradeTotal)};
}

// ---- One calculation for Canvas and the CSV --------------------------------------
// The CSV download and the Canvas push both come from here, so they can never
// disagree about a student's score.
function cleanTeacherComment_(value) { return String(value || '').trim(); }
function memoirCanvasFeedback_(key, summary) {
  if (key === MEMOIR_FINAL_KEY) {
    const parts = [];
    MEMOIR_CRITERIA.forEach(function(c){
      const cm = summary.criteria && summary.criteria[c] ? cleanTeacherComment_(summary.criteria[c].comment) : '';
      if (cm) parts.push(c + ': ' + cm);
    });
    return parts.length ? ('Final Memoir feedback\n\n' + parts.join('\n\n')) : '';
  }
  const rec = summary.steps && summary.steps[key];
  const cm = rec ? cleanTeacherComment_(rec.comment) : '';
  return cm ? ('Memoir — ' + (MEMOIR_GRADE_LABELS[key] || key) + ' feedback\n\n' + cm) : '';
}
function assignmentRef_(payload) {
  payload = payload || {};
  const key = String(payload.key || '');
  if (MEMOIR_GRADE_KEYS.indexOf(key) === -1) throw new Error('Unknown memoir piece: ' + key);
  return {kind:'memoir', key:key};
}
function assignmentSettingsKey_(ref) { return 'memoir:' + ref.key; }
function assignmentLabel_(key) { return 'Memoir — ' + (MEMOIR_GRADE_LABELS[key] || key); }

function memoirGradeRows_(classId, key) {
  if (MEMOIR_GRADE_KEYS.indexOf(key) === -1) throw new Error('Unknown memoir piece: ' + key);
  const isFinal = key === MEMOIR_FINAL_KEY;
  const students = classRoster_(classId);
  if (!students.length) throw new Error('No students are enrolled in this class yet.');
  const works = classWorkByEmail_(classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(function(g){ return g.classId === classId; });
  const postsBy = discussPostsByEmail_(classId);
  const postersBy = postersByEmail_(classId);
  const label = assignmentLabel_(key);
  const emails = students.map(function(s){ return norm_(s.studentEmail); });
  const excludedForAll = function(itemType, itemKey){
    const set = {};
    allItems.forEach(function(g){ if (truthy_(g.excluded) && keyOf_(g.itemType) === itemType && keyOf_(g.itemKey) === keyOf_(itemKey)) set[norm_(g.studentEmail)] = true; });
    return emails.length ? emails.every(function(e){ return set[e]; }) : false;
  };
  const pointsPossible = isFinal
    ? MEMOIR_CRITERIA.filter(function(c){ return !excludedForAll('memoirRubric', c); }).length * CRITERION_MAX
    : (excludedForAll('memoir', key) ? 0 : pieceMax_(key));
  if (!pointsPossible) throw new Error(label + ' is excluded for the whole class, so there is nothing to send.');
  const rows = [], skipped = [], adjusted = [], unmarked = [];
  students.forEach(function(s){
    const k = norm_(s.studentEmail);
    const w = works[k];
    const st = w ? workState_(w) : {};
    const items = allItems.filter(function(g){ return norm_(g.studentEmail) === k; });
    const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, items, {posts:postsBy[k] || [], poster:postersBy[k] || null}).memoir;
    const who = s.studentName || s.studentEmail;
    const feedback = memoirCanvasFeedback_(key, summary);
    if (isFinal) {
      const t = summary.finalTotal;
      // Nothing marked yet is left BLANK, never zeroed.
      if (!t.hasAnyResult) { skipped.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback}); return; }
      if (t.unmarked) unmarked.push(who + ' (' + t.unmarked + ')');
      let value = t.earned;
      // Canvas holds one points value per assignment. A student excused from one
      // criterion is scaled to keep the percentage they actually earned.
      if (t.possible !== pointsPossible && t.possible > 0) {
        value = Math.round((t.earned / t.possible) * pointsPossible * 100) / 100;
        adjusted.push(who + ': ' + t.earned + '/' + t.possible + ' → ' + value + '/' + pointsPossible);
      }
      rows.push({email:s.studentEmail, name:s.studentName, score:value, feedback:feedback});
      return;
    }
    const rec = summary.steps[key];
    if (rec.excluded) { skipped.push(who + ' (excused)'); rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback}); return; }
    if (rec.score === null) {
      if (rec.submitted) unmarked.push(who);
      skipped.push(who);
      rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback});
      return;
    }
    rows.push({email:s.studentEmail, name:s.studentName, score:rec.score, feedback:feedback});
  });
  return {kind:'memoir', key:key, label:label, gradingType:MEMOIR_PASS_FAIL[key] ? 'pass_fail' : 'points',
    pointsPossible:pointsPossible, rows:rows, sent:rows.filter(function(r){ return r.score !== null; }).length,
    skipped:skipped, adjusted:adjusted, unmarked:unmarked};
}

// A CSV for Canvas's Gradebook > Import, in the same layout as the other apps.
function exportGradesCsv(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = managedClass_(classId);
  const ref = assignmentRef_(payload);
  const data = memoirGradeRows_(classId, ref.key);
  if (!data.sent) throw new Error('No students in this class have a grade for ' + data.label + ' yet.');
  const header = data.label.replace(/—/g, '-');
  const rows = [['Student','ID','SIS User ID','SIS Login ID','Section', header], ['    Points Possible','','','','', data.pointsPossible]];
  data.rows.forEach(function(r){
    const v = r.score === null ? '' : (data.gradingType === 'pass_fail' ? (Number(r.score) > 0 ? 'complete' : 'incomplete') : r.score);
    rows.push([r.name, '', '', r.email, '', v]);
  });
  return {ok:true, filename:csvSafeName_(ctx.klass.className + ' - ' + header + ' Grades') + '.csv',
    content:rows.map(function(row){ return row.map(csvCell_).join(','); }).join('\n'),
    sent:data.sent, skipped:data.skipped, pointsPossible:data.pointsPossible, adjusted:data.adjusted, unmarked:data.unmarked};
}
function csvCell_(value) {
  const s = String(value === null || value === undefined ? '' : value);
  // Keep a spreadsheet from treating student-entered text as a formula.
  const out = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + out.replace(/"/g, '""') + '"';
}
function csvSafeName_(value) {
  return String(value || 'Memoir Grades').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
}

// ===========================================================================
// Lead Share board
// ===========================================================================
// Every student's board activity for one class, keyed by lowercased email --
// read once and passed down, never once per student inside a loop.
//   {kind:'post', text, date, updatedAt, id, replyCount}
//   {kind:'reply', text, date, to}
function discussPostsByEmail_(classId) {
  const out = {};
  const add = function(email, rec){ const k = norm_(email); (out[k] = out[k] || []).push(rec); };
  const posts = leadPosts_(classId);
  const byId = {};
  const replyCount = {};
  posts.forEach(function(r){ byId[String(r.postId)] = r; });
  const replies = leadReplies_(classId);
  replies.forEach(function(r){ replyCount[String(r.postId)] = (replyCount[String(r.postId)] || 0) + 1; });
  // Older builds could leave more than one post per student; the newest counts.
  const latest = {};
  posts.forEach(function(r){
    const k = norm_(r.studentEmail);
    const when = String(r.updatedAt || r.createdAt || '');
    if (!latest[k] || when >= latest[k].when) latest[k] = {row:r, when:when};
  });
  Object.keys(latest).forEach(function(k){
    const r = latest[k].row;
    add(r.studentEmail, {kind:'post', id:String(r.postId), text:String(r.text || ''), date:String(r.createdAt || ''),
      updatedAt:String(r.updatedAt || ''), replyCount:replyCount[String(r.postId)] || 0});
  });
  replies.forEach(function(r){
    const parent = byId[String(r.postId)];
    add(r.studentEmail, {kind:'reply', text:String(r.text || ''), date:String(r.createdAt || ''), to:parent ? String(parent.studentName || '') : ''});
  });
  Object.keys(out).forEach(function(k){ out[k].sort(function(a, b){ return String(a.date).localeCompare(String(b.date)); }); });
  return out;
}
function leadPosts_(classId) {
  ensureSheet_(db_(), 'DISCUSS', SHEETS.DISCUSS);
  return sheetObjects_('DISCUSS').filter(function(r){ return r.classId === classId && (String(r.topic || 'lead') === 'lead'); });
}
function leadReplies_(classId) {
  ensureSheet_(db_(), 'DISCUSS_REPLIES', SHEETS.DISCUSS_REPLIES);
  return sheetObjects_('DISCUSS_REPLIES').filter(function(r){ return r.classId === classId; });
}
// The board as students see it: one post per student, newest text, every reply
// made to any of that student's posts.
function getLeadShare_(classId) {
  const me = norm_(currentEmail_());
  const staff = roleFor_(me) !== 'student';
  // Each item says whether it is the viewer's own; a student's copy carries no
  // addresses, only names.
  const forViewer = function(o){
    const out = Object.assign({}, o, {mine:norm_(o.email) === me});
    if (!staff) delete out.email;
    return out;
  };
  return leadShareAll_(classId).map(function(p){
    const o = forViewer(p);
    o.replies = (p.replies || []).map(forViewer);
    return o;
  });
}
function leadShareAll_(classId) {
  const posts = leadPosts_(classId);
  const grouped = {};
  posts.forEach(function(r){
    const k = norm_(r.studentEmail);
    const b = grouped[k] = grouped[k] || {posts:[], ids:[]};
    b.posts.push(r); b.ids.push(String(r.postId));
  });
  const repliesBy = {};
  leadReplies_(classId).sort(function(a, b){ return String(a.createdAt).localeCompare(String(b.createdAt)); }).forEach(function(r){
    (repliesBy[String(r.postId)] = repliesBy[String(r.postId)] || []).push({id:String(r.replyId), name:String(r.studentName || ''),
      email:String(r.studentEmail || ''), text:String(r.text || ''), date:String(r.createdAt || '')});
  });
  return Object.keys(grouped).map(function(k){
    const b = grouped[k];
    b.posts.sort(function(a, c){ return String(a.updatedAt || a.createdAt || '').localeCompare(String(c.updatedAt || c.createdAt || '')); });
    const r = b.posts[b.posts.length - 1];
    let replies = [];
    b.ids.forEach(function(id){ replies = replies.concat(repliesBy[id] || []); });
    replies.sort(function(a, c){ return String(a.date).localeCompare(String(c.date)); });
    return {id:String(r.postId), name:String(r.studentName || ''), email:String(r.studentEmail || ''), text:String(r.text || ''),
            date:String(r.createdAt || ''), updatedAt:String(r.updatedAt || ''), replies:replies};
  }).sort(function(a, c){ return String(a.date).localeCompare(String(c.date)); });
}
function getLeadShare(payload) {
  const email = currentEmail_();
  const classId = typeof payload === 'string' ? payload : String((payload || {}).classId || '');
  const role = roleFor_(email);
  if (role === 'student') { if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.'); }
  else managedClass_(classId);
  return {ok:true, discussion:getLeadShare_(classId)};
}
// One post per student. Revising the Lead and posting again updates the same
// post, so classmates' replies stay attached to it.
function postLeadShare(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const text = String(payload.text || '').trim();
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  if (!text) throw new Error('Write your Lead first, then post it.');
  if (text.length > 6000) throw new Error('Your Lead is too long to post — keep it under 6,000 characters.');
  const sh = ensureSheet_(db_(), 'DISCUSS', SHEETS.DISCUSS);
  const h = headersOf_(sh);
  const now = new Date().toISOString();
  const findMine = function(){
    const last = sh.getLastRow();
    if (last < 2) return -1;
    const vals = sh.getRange(1, 1, last, h.length).getValues();
    for (let i = vals.length - 1; i >= 1; i--) {
      if (String(vals[i][h.indexOf('classId')]) === classId && norm_(vals[i][h.indexOf('studentEmail')]) === norm_(email) &&
          String(vals[i][h.indexOf('topic')] || 'lead') === 'lead') return i + 1;
    }
    return -1;
  };
  const row = findMine();
  if (row > 0) {
    withUserLock_(function(){
      sh.getRange(row, h.indexOf('text') + 1).setValue(text);
      sh.getRange(row, h.indexOf('updatedAt') + 1).setValue(now);
    });
  } else {
    const name = enrolledName_(classId, email) || displayNameFromEmail_(email);
    withScriptLock_(15000, function(){
      if (findMine() > 0) return;
      sh.appendRow(rowFromObject_(h, {postId:Utilities.getUuid(), classId:classId, studentEmail:email, studentName:name,
        text:text, createdAt:now, updatedAt:now, topic:'lead'}));
    });
  }
  return {ok:true, discussion:getLeadShare_(classId)};
}
function postLeadShareReply(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const postId = String(payload.postId || '');
  const text = String(payload.text || '').trim();
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  if (!postId) throw new Error('Choose a classmate’s Lead to reply to.');
  if (!text) throw new Error('Write a reply before posting.');
  if (text.length > 3000) throw new Error('Keep your reply under 3,000 characters.');
  const parent = leadPosts_(classId).find(function(r){ return String(r.postId) === postId; });
  if (!parent) throw new Error('That post could not be found. Refresh the board and try again.');
  if (norm_(parent.studentEmail) === norm_(email)) throw new Error('Reply to a classmate’s Lead rather than your own.');
  const sh = ensureSheet_(db_(), 'DISCUSS_REPLIES', SHEETS.DISCUSS_REPLIES);
  const name = enrolledName_(classId, email) || displayNameFromEmail_(email);
  withScriptLock_(15000, function(){
    sh.appendRow(rowFromObject_(headersOf_(sh), {replyId:Utilities.getUuid(), classId:classId, postId:postId,
      studentEmail:email, studentName:name, text:text, createdAt:new Date().toISOString()}));
  });
  return {ok:true, discussion:getLeadShare_(classId)};
}
// Teacher moderation: remove one reply, or one post and the replies under it.
function removeLeadShareItem(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const kind = String(payload.kind || '');
  const id = String(payload.id || '');
  if (!id) throw new Error('Nothing to remove.');
  withScriptLock_(20000, function(){
    const deleteWhere = function(tab, test){
      const sh = db_().getSheetByName(tab);
      if (!sh || sh.getLastRow() < 2) return 0;
      const h = headersOf_(sh);
      const vals = sh.getRange(1, 1, sh.getLastRow(), h.length).getValues();
      let n = 0;
      for (let i = vals.length - 1; i >= 1; i--) {
        const obj = objFromRow_(h, vals[i]);
        if (obj.classId === classId && test(obj)) { sh.deleteRow(i + 1); n++; }
      }
      return n;
    };
    if (kind === 'post') {
      deleteWhere('DISCUSS_REPLIES', function(r){ return String(r.postId) === id; });
      deleteWhere('DISCUSS', function(r){ return String(r.postId) === id; });
    } else {
      deleteWhere('DISCUSS_REPLIES', function(r){ return String(r.replyId) === id; });
    }
  });
  return {ok:true, discussion:getLeadShare_(classId)};
}

// ===========================================================================
// Posters
// ===========================================================================
const POSTER_IMG_COLS = ['img1','img2','img3','img4','img5','img6','img7','img8'];
const POSTER_CHUNK = 45000;
const POSTER_MAX_CHARS = POSTER_IMG_COLS.length * POSTER_CHUNK;
const POSTER_META_COLS = ['classId','studentEmail','studentName','title','author','mimeType','width','height','savedAt'];
// The metadata only -- never the image chunks -- for every poster in a class.
function postersByEmail_(classId) {
  const sh = db_().getSheetByName('POSTERS');
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const h = headersOf_(sh);
  const width = Math.max.apply(null, POSTER_META_COLS.map(function(c){ return h.indexOf(c) + 1; }));
  const vals = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
  for (let i = 1; i < vals.length; i++) {
    const o = objFromRow_(h.slice(0, width), vals[i]);
    if (o.classId !== classId) continue;
    const saved = o.savedAt instanceof Date ? o.savedAt.toISOString() : String(o.savedAt || '');
    out[norm_(o.studentEmail)] = {title:String(o.title || ''), author:String(o.author || ''), savedAt:saved,
      mimeType:String(o.mimeType || 'image/jpeg'), width:Number(o.width || 0), height:Number(o.height || 0)};
  }
  return out;
}
function posterRow_(classId, email) {
  const sh = db_().getSheetByName('POSTERS');
  if (!sh) return null;
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row < 1) return null;
  const vals = sh.getRange(row, 1, 1, h.length).getValues()[0];
  const o = objFromRow_(h, vals);
  let image = '';
  POSTER_IMG_COLS.forEach(function(c){ image += String(o[c] === undefined || o[c] === null ? '' : o[c]); });
  return {title:String(o.title || ''), author:String(o.author || ''), mimeType:String(o.mimeType || 'image/jpeg'),
    width:Number(o.width || 0), height:Number(o.height || 0),
    savedAt:o.savedAt instanceof Date ? o.savedAt.toISOString() : String(o.savedAt || ''), image:image};
}
// Turning in the poster stores a JPEG of it with the class, so the teacher can
// see it while grading and the student gets it back on any device.
function saveMyPoster(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const image = String(payload.image || '').replace(/^data:[^,]+,/, '');
  if (!image) throw new Error('Paint your poster first, then turn it in.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('That poster image could not be read. Try again.');
  if (image.length > POSTER_MAX_CHARS) throw new Error('The poster image is too large to save. Try again — the app shrinks it automatically.');
  const sh = ensureSheet_(db_(), 'POSTERS', SHEETS.POSTERS);
  const h = headersOf_(sh);
  const now = new Date().toISOString();
  const rec = {classId:classId, studentEmail:email, studentName:enrolledName_(classId, email) || displayNameFromEmail_(email),
    title:String(payload.title || '').trim().slice(0, 120), author:String(payload.author || '').trim().slice(0, 80),
    mimeType:/^image\/(jpeg|png|webp)$/.test(String(payload.mimeType || '')) ? String(payload.mimeType) : 'image/jpeg',
    width:Number(payload.width || 0), height:Number(payload.height || 0), savedAt:now};
  POSTER_IMG_COLS.forEach(function(c, i){ rec[c] = image.substr(i * POSTER_CHUNK, POSTER_CHUNK); });
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row > 0) withUserLock_(function(){ sh.getRange(row, 1, 1, h.length).setValues([rowFromObject_(h, rec)]); });
  else withScriptLock_(15000, function(){
    const again = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
    if (again > 0) sh.getRange(again, 1, 1, h.length).setValues([rowFromObject_(h, rec)]);
    else sh.appendRow(rowFromObject_(h, rec));
  });
  return {ok:true, savedAt:now};
}
function getMyPoster(payload) {
  const email = currentEmail_();
  const classId = String((payload || {}).classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const p = posterRow_(classId, email);
  return {ok:true, poster:p && p.image ? p : null};
}
function getPosterImage(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const p = posterRow_(classId, String(payload.studentEmail || ''));
  return {ok:true, poster:p && p.image ? p : null};
}

// ===========================================================================
// Writing coach, title ideas and poster art (optional)
// ===========================================================================
function aiKey_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }
// Students may use a feature only when their class has it switched on. A
// teacher previewing the app can always try it.
function aiAllowed_(classId, flag) {
  const email = currentEmail_();
  if (!email) throw new Error('Couldn’t verify your school Google sign-in.');
  if (!AI_FEATURES_ON) throw new Error('The AI features are switched off in this version of the app.');
  const role = roleFor_(email);
  if (role === 'teacher' || role === 'admin') return email;
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const klass = getClass_(classId);
  const s = parseJson_(klass && klass.settingsJson, {});
  if (s[flag] === false) throw new Error('Your teacher has turned this off for your class.');
  return email;
}
function aiQuota_(email, kind, limit) {
  const cache = CacheService.getScriptCache();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Pacific/Honolulu', 'yyyyMMdd');
  const key = 'q:' + kind + ':' + norm_(email) + ':' + day;
  const used = Number(cache.get(key) || 0);
  return {
    used:used, left:Math.max(0, limit - used),
    check:function(){ if (used >= limit) throw new Error('That’s the limit for today (' + limit + '). It resets tomorrow — keep revising on your own in the meantime.'); },
    spend:function(){ cache.put(key, String(used + 1), 21600); }
  };
}
function geminiText_(systemPrompt, userText, maxTokens) {
  const apiKey = aiKey_();
  if (!apiKey) throw new Error('This isn’t turned on yet — your teacher needs to add a Gemini key.');
  const payload = {
    system_instruction:{parts:[{text:systemPrompt}]},
    contents:[{role:'user', parts:[{text:userText}]}],
    generationConfig:{maxOutputTokens:maxTokens || 400}
  };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + FEEDBACK_MODEL + ':generateContent', {
    method:'post', contentType:'application/json', headers:{'x-goog-api-key':apiKey},
    payload:JSON.stringify(payload), muteHttpExceptions:true
  });
  const status = res.getResponseCode();
  let result;
  try { result = JSON.parse(res.getContentText()); } catch (e) { throw new Error('The writing service sent back something unexpected. Try again in a minute.'); }
  if (status !== 200) throw new Error('The writing service is unavailable right now (' + ((result && result.error && result.error.message) || ('HTTP ' + status)) + ').');
  const cand = result.candidates && result.candidates[0];
  // Newer models can return a thinking part before the answer; use the answer.
  const parts = (cand && cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
  const text = parts.filter(function(p){ return p && !p.thought; }).map(function(p){ return p.text || ''; }).join('');
  if (!String(text).trim()) throw new Error('The writing service didn’t return anything — try again.');
  return String(text).trim();
}
function getCoachFeedback(payload) {
  payload = payload || {};
  try {
    const classId = String(payload.classId || '');
    const email = aiAllowed_(classId, 'aiCoach');
    const key = String(payload.stageKey || '');
    const label = STAGE_LABELS[key] || 'your writing';
    const text = String(payload.text || '').trim();
    if (!text) return {ok:false, error:'Write something first, then ask the coach.'};
    const q = aiQuota_(email, 'coach', COACH_DAILY_LIMIT);
    q.check();
    const feedback = geminiText_(FEEDBACK_PROMPT, 'Section: ' + label + '\n\nStudent\'s writing:\n"""\n' + text.slice(0, 6000) + '\n"""', 1024);
    q.spend();
    return {ok:true, feedback:feedback, at:new Date().toISOString(), left:Math.max(0, q.left - 1)};
  } catch (e) {
    return {ok:false, error:e.message || String(e)};
  }
}
function getPosterTitle(payload) {
  payload = payload || {};
  try {
    const email = aiAllowed_(String(payload.classId || ''), 'aiPoster');
    const text = String(payload.text || '').trim();
    if (!text) return {ok:false, error:'Write some of your memoir first, then ask for a title idea.'};
    const q = aiQuota_(email, 'title', TITLE_DAILY_LIMIT);
    q.check();
    let title = geminiText_(TITLE_PROMPT, 'Student\'s full memoir draft:\n"""\n' + text.slice(0, 8000) + '\n"""', 256);
    title = title.split('\n')[0].replace(/^["'“”*]+|["'“”*.]+$/g, '').trim().slice(0, 90);
    if (!title) return {ok:false, error:'No title came back — try again.'};
    q.spend();
    return {ok:true, title:title};
  } catch (e) {
    return {ok:false, error:e.message || String(e)};
  }
}
// Background art only. The prompt forbids letters, because image models cannot
// render a passage of text accurately -- the student's own words are drawn on
// top afterwards in the browser, character for character.
function getPosterBackground(payload) {
  payload = payload || {};
  try {
    const email = aiAllowed_(String(payload.classId || ''), 'aiPoster');
    const q = aiQuota_(email, 'art', ART_DAILY_LIMIT);
    q.check();
    const hint = String(payload.hint || '').trim().slice(0, 300);
    const prompt = 'soft atmospheric abstract background art, calm evening light, gentle texture, personal memoir keepsake poster backdrop for a high school student' +
      (hint ? (', themed around: ' + hint) : ', evocative of a turning-point memory') +
      ', no text, no words, no letters, no numbers, no writing, no typography, background art only';
    const url = POSTER_IMAGE_BASE_URL + encodeURIComponent(prompt) + '?width=1024&height=1365&model=flux&nologo=true&safe=true&seed=' + Math.floor(Math.random() * 1000000);
    const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    const status = res.getResponseCode();
    if (status === 429) return {ok:false, error:'The free art service allows about one picture every 15 seconds. Wait a moment and try again.'};
    if (status !== 200) return {ok:false, error:'The art service is unavailable right now (HTTP ' + status + '). You can still use a plain background.'};
    const blob = res.getBlob();
    const type = blob.getContentType() || 'image/jpeg';
    if (type.indexOf('image/') !== 0) return {ok:false, error:'The art service didn’t send back a picture — try again in a moment.'};
    q.spend();
    return {ok:true, imageBase64:Utilities.base64Encode(blob.getBytes()), mimeType:type};
  } catch (e) {
    return {ok:false, error:e.message || String(e)};
  }
}

// ===========================================================================
// Bringing drafts over from the original Memoir tool
// ===========================================================================
// The first version of this tool saved to its own sheet ("Memoir" tab: Email,
// Lead, Beginning, ... PosterAuthor). This copies those drafts into THIS class
// for enrolled students whose memoir here is still empty. It never overwrites
// anything a student has already written in this app, and it is only ever run
// by the teacher, from the Students card.
function importLegacyMemoirDrafts(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  managedClass_(classId);
  const source = String(payload.source || '').trim();
  if (!source) throw new Error('Paste the link to the old Memoir Data spreadsheet.');
  let ss;
  try { ss = /^https?:/i.test(source) ? SpreadsheetApp.openByUrl(source) : SpreadsheetApp.openById(source); }
  catch (e) { throw new Error('That spreadsheet could not be opened. Check the link, and that it is yours.'); }
  const sheet = ss.getSheetByName('Memoir') || ss.getSheets()[0];
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) throw new Error('That spreadsheet has no saved drafts in it.');
  const h = vals[0].map(function(x){ return String(x).trim(); });
  if (h.indexOf('Email') === -1 || h.indexOf('Lead') === -1) throw new Error('That does not look like the old Memoir tool’s sheet (it needs Email and Lead columns).');
  const legacy = {};
  for (let i = 1; i < vals.length; i++) {
    const o = objFromRow_(h, vals[i]);
    if (o.Email) legacy[norm_(o.Email)] = o;
  }
  const map = {lead:'Lead', beginning:'Beginning', rising:'Rising', callback:'Callback', climax:'Climax', sowhat:'SoWhat'};
  const imported = [], hasWork = [], notFound = [];
  classRoster_(classId).forEach(function(s){
    const old = legacy[norm_(s.studentEmail)];
    if (!old) { notFound.push(s.studentName || s.studentEmail); return; }
    const work = getStudentWork_(classId, s.studentEmail);
    const st = work.state || {};
    const already = STAGE_KEYS.some(function(k){ return stageText_(st, k).trim(); });
    if (already) { hasWork.push(s.studentName || s.studentEmail); return; }
    const cad = parseJson_(old.CadenceJSON, {}) || {};
    const checks = parseJson_(old.ChecksJSON, {}) || {};
    const m = memoirOf_(st);
    m.texts = m.texts || {}; m.cadence = m.cadence || {}; m.checks = m.checks || {};
    STAGE_KEYS.forEach(function(k){
      m.texts[k] = String(old[map[k]] === undefined || old[map[k]] === null ? '' : old[map[k]]);
      m.cadence[k] = migrateCadenceLog_(cad[k]);
      if (Array.isArray(checks[k])) m.checks[k] = checks[k].map(function(x){ return x === true; });
    });
    m.poster = Object.assign({}, m.poster || {}, {title:String(old.PosterTitle || ''), author:String(old.PosterAuthor || '')});
    m.importedAt = new Date().toISOString();
    st.memoir = m;
    if (old.ScaffoldPref === 'less' || old.ScaffoldPref === 'more') st.scaffold = old.ScaffoldPref;
    upsertWork_(classId, s.studentEmail, s.studentName, st, work.updatedAt);
    imported.push(s.studentName || s.studentEmail);
  });
  return {ok:true, imported:imported, hasWork:hasWork, notFound:notFound};
}
// Older cadence logs were sequential {type, end}; newer ones are explicit
// {type, start, end} ranges. Same conversion the original tool used.
function migrateCadenceLog_(log) {
  if (!Array.isArray(log)) return [];
  let cursor = 0;
  return log.map(function(entry){
    if (entry && typeof entry.start === 'number' && typeof entry.end === 'number') {
      cursor = Math.max(cursor, entry.end);
      return {type:entry.type, start:entry.start, end:entry.end};
    }
    const start = cursor;
    const end = entry && typeof entry.end === 'number' ? entry.end : start;
    cursor = Math.max(cursor, end);
    return {type:entry && entry.type, start:start, end:end};
  }).filter(function(r){ return r.end > r.start && (r.type === 'internal' || r.type === 'external'); });
}

// ===========================================================================
// Administration
// ===========================================================================
function adminAddTeacher(payload) {
  requireAdmin_();
  payload = payload || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || displayNameFromEmail_(email)).trim();
  if (!email || email.indexOf('@') < 1) throw new Error('Enter a valid teacher email.');
  upsertUser_(email, name, 'teacher', 'active');
  return {ok:true, access:adminListAccess_()};
}
function adminSetAccess(payload) {
  const me = requireAdmin_();
  payload = payload || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const status = payload.status === 'active' ? 'active' : 'revoked';
  if (norm_(email) === norm_(me.email) && status !== 'active') throw new Error('You cannot revoke your own admin access.');
  const user = getUser_(email);
  if (!user) throw new Error('User not found.');
  upsertUser_(email, user.name, user.role, status);
  return {ok:true, access:adminListAccess_()};
}
function adminListAccess() { requireAdmin_(); return {ok:true, access:adminListAccess_()}; }
function adminListAccess_() {
  return sheetObjects_('USERS').filter(function(u){ return u.role === 'teacher' || u.role === 'admin'; })
    .map(function(u){ return {email:u.email, name:u.name, role:u.role, status:u.status, updatedAt:String(u.updatedAt || '')}; });
}

// ===========================================================================
// People
// ===========================================================================
function requireTeacher_() {
  const email = currentEmail_();
  const user = getUser_(email);
  if (!user || user.status !== 'active' || (user.role !== 'teacher' && user.role !== 'admin')) throw new Error('Teacher access has not been authorized by the curriculum administrator.');
  return {email:email, role:user.role, name:user.name};
}
function requireAdmin_() {
  const email = currentEmail_();
  const user = getUser_(email);
  if (!user || user.status !== 'active' || user.role !== 'admin') throw new Error('Administrator access required.');
  return {email:email, role:user.role, name:user.name};
}
function roleFor_(email) { const u = getUser_(email); return u && u.status === 'active' ? u.role : 'student'; }
function currentEmail_() { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
function displayNameFromEmail_(email) {
  const s = String(email || '').split('@')[0].replace(/[._-]+/g, ' ');
  return s.replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
// Names are collected as first + last, because a name pulled from an email
// address ("Jsmith1234") is useless in a marking list.
function normalizeStudentName_(first, last, whole) {
  let f = String(first || '').trim().replace(/\s+/g, ' ');
  let l = String(last || '').trim().replace(/\s+/g, ' ');
  if (!f && !l) {
    const parts = String(whole || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    f = parts.shift() || '';
    l = parts.join(' ');
  }
  return {first:f, last:l, full:(f + ' ' + l).trim()};
}
function requireFullName_(first, last, whole) {
  const n = normalizeStudentName_(first, last, whole);
  if (!n.first || !n.last) throw new Error('Please enter both your first name and your last name.');
  if (!/[A-Za-z]/.test(n.first) || !/[A-Za-z]/.test(n.last)) throw new Error('Please enter your name using letters.');
  return n.full;
}
function nameLooksIncomplete_(name) {
  const s = String(name || '').trim();
  if (!s || /\d/.test(s)) return true;
  return s.split(/\s+/).filter(function(p){ return /[A-Za-z]/.test(p); }).length < 2;
}
// A student's name is copied into every tab as work is saved, so a correction
// has to reach all of them or the marking list keeps the old one.
function setStudentNameEverywhere_(email, name) {
  const ss = db_();
  ['ENROLL','WORK','DISCUSS','DISCUSS_REPLIES','GRADEITEMS','POSTERS'].forEach(function(tab){
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    const h = headersOf_(sh);
    const ei = h.indexOf('studentEmail'), ni = h.indexOf('studentName');
    if (ei < 0 || ni < 0) return;
    const width = Math.max(ei, ni) + 1;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    let changed = false;
    const col = vals.map(function(r){
      const mine = norm_(r[ei]) === norm_(email);
      if (mine && r[ni] !== name) changed = true;
      return [mine ? name : r[ni]];
    });
    if (changed) sh.getRange(2, ni + 1, col.length, 1).setValues(col);
  });
}
function getUser_(email) { return sheetObjects_('USERS').find(function(r){ return norm_(r.email) === norm_(email); }); }
function upsertUser_(email, name, role, status) {
  const sh = ensureSheet_(db_(), 'USERS', SHEETS.USERS);
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['email'], [email]);
  const now = new Date().toISOString();
  if (row > 0) {
    const vals = sh.getRange(row, 1, 1, h.length).getValues()[0];
    const obj = objFromRow_(h, vals);
    obj.name = name; obj.role = role; obj.status = status; obj.updatedAt = now;
    sh.getRange(row, 1, 1, h.length).setValues([rowFromObject_(h, obj)]);
  } else sh.appendRow(rowFromObject_(h, {email:email, name:name, role:role, status:status, createdAt:now, updatedAt:now}));
}
function getClass_(id) { return sheetObjects_('CLASSES').find(function(r){ return r.classId === id; }); }
function getTeacherClasses_(email, all) {
  return sheetObjects_('CLASSES').filter(function(r){ return truthy_(r.active) && (all || norm_(r.teacherEmail) === norm_(email)); }).map(publicClass_);
}
function getStudentClasses_(email) {
  const enrolls = sheetObjects_('ENROLL').filter(function(r){ return norm_(r.studentEmail) === norm_(email) && truthy_(r.active); });
  const classes = sheetObjects_('CLASSES');
  return enrolls.map(function(e){ return classes.find(function(c){ return c.classId === e.classId && truthy_(c.active); }); }).filter(Boolean).map(publicClass_);
}
function publicClass_(r) {
  return {classId:r.classId, teacherEmail:r.teacherEmail, className:String(r.className || ''), period:String(r.period === undefined ? '' : r.period),
          joinCode:String(r.joinCode || ''), settingsJson:String(r.settingsJson || ''), active:truthy_(r.active)};
}
function uniqueJoinCode_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const existing = new Set(sheetObjects_('CLASSES').map(function(r){ return String(r.joinCode).toUpperCase(); }));
  for (let t = 0; t < 100; t++) {
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    // A code the grid could read as a number (all digits, or digits-E-digits
    // like 345E67) would stop matching, so every code carries a letter other than E.
    if (!/[A-DF-Z]/.test(s)) continue;
    if (!existing.has(s)) return s;
  }
  return 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
}
function appWebUrl_() {
  try { const u = ScriptApp.getService().getUrl(); return u ? String(u) : ''; } catch (e) { return ''; }
}

// ===========================================================================
// The spreadsheet
// ===========================================================================
function norm_(s) { return String(s || '').trim().toLowerCase(); }
// Sheets stores a numeric-looking string as a NUMBER; compare keys as text.
function keyOf_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function lastMatch_(list, pred) { for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i]; return undefined; }
function truthy_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function parseJson_(s, fallback) { try { return typeof s === 'object' && s !== null ? s : JSON.parse(String(s || '')); } catch (e) { return fallback; } }
function ensureDb_() { if (!PropertiesService.getScriptProperties().getProperty(MEMOIR_DB_PROP)) throw new Error('The Memoir backend is not set up yet. Run setupMemoirBackend() once from the Apps Script editor.'); }
function db_() { ensureDb_(); return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(MEMOIR_DB_PROP)); }
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e9e4da');
    sh.setFrozenRows(1);
    return sh;
  }
  ensureColumns_(sh, headers);
  return sh;
}
// APPEND ONLY -- existing columns are never moved or renamed.
function ensureColumns_(sh, headers) {
  const have = headersOf_(sh);
  const missing = headers.filter(function(h){ return have.indexOf(h) === -1; });
  if (!missing.length) return;
  sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e9e4da');
}
function headersOf_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const row = sh.getRange(1, 1, 1, width).getValues()[0].map(function(v){ return String(v).trim(); });
  while (row.length && !row[row.length - 1]) row.pop();
  return row;
}
function objFromRow_(h, vals) { const o = {}; h.forEach(function(k, i){ if (k) o[k] = vals[i]; }); return o; }
function rowFromObject_(headers, obj) {
  return headers.map(function(h){ return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; });
}
function sheetObjects_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues();
  const h = vals.shift().map(function(x){ return String(x).trim(); });
  return vals.filter(function(r){ return r.some(function(v){ return v !== '' && v !== null; }); }).map(function(r){ return objFromRow_(h, r); });
}
// ---- Save contention ------------------------------------------------------------
// A WORK row is only ever written by the student it belongs to, and a grade row
// only by the teacher, so updating an existing row needs only a user lock and
// a single-row write. Creating a row takes the script lock, because two people
// appending at once genuinely can collide -- that path is rare. Critical
// sections are one read and one write, never a whole-sheet read.
function withUserLock_(fn) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(15000)) throw new Error('BUSY: the app is still saving your last change. It will retry automatically.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function withScriptLock_(ms, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ms || 15000)) throw new Error('BUSY: the class database is busy right now. It will retry automatically.');
  try { return fn(); } finally { lock.releaseLock(); }
}
// Finds a row by a few key columns WITHOUT pulling the whole sheet back -- on
// WORK the state columns hold every student's entire memoir.
function findRowByKeys_(sh, headers, keyCols, keyVals) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const idx = keyCols.map(function(c){ return headers.indexOf(c); });
  if (idx.some(function(i){ return i < 0; })) return -1;
  const maxCol = Math.max.apply(null, idx) + 1;
  const vals = sh.getRange(1, 1, lastRow, maxCol).getValues();
  for (let i = 1; i < vals.length; i++) {
    let hit = true;
    for (let k = 0; k < idx.length; k++) {
      const a = vals[i][idx[k]], b = keyVals[k];
      if (norm_(a) !== norm_(b)) { hit = false; break; }
    }
    if (hit) return i + 1;
  }
  return -1;
}
function isEnrolled_(classId, email) {
  const sh = db_().getSheetByName('ENROLL');
  if (!sh || !classId || !email) return false;
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row < 1) return false;
  return truthy_(sh.getRange(row, h.indexOf('active') + 1).getValue());
}
function enrolledName_(classId, email) {
  const sh = db_().getSheetByName('ENROLL');
  if (!sh) return '';
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row < 1) return '';
  return String(sh.getRange(row, h.indexOf('studentName') + 1).getValue() || '');
}

// ---- Student work ------------------------------------------------------------------
const WORK_STATE_COLS = ['stateJson','stateJson2','stateJson3','stateJson4','stateJson5'];
const WORK_CHUNK_CHARS = 45000;
const WORK_STATE_MAX_CHARS = WORK_STATE_COLS.length * WORK_CHUNK_CHARS;
function workState_(row) {
  if (!row) return {};
  let s = '';
  WORK_STATE_COLS.forEach(function(c){ s += String(row[c] === undefined || row[c] === null ? '' : row[c]); });
  const parsed = parseJson_(s, null);
  return parsed && typeof parsed === 'object' ? parsed : {};
}
function workStateChunks_(json) {
  return WORK_STATE_COLS.map(function(c, i){ return String(json).substr(i * WORK_CHUNK_CHARS, WORK_CHUNK_CHARS); });
}
function stampOf_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function studentWorkRow_(classId, email) {
  const sh = db_().getSheetByName('WORK');
  if (!sh) return null;
  const h = headersOf_(sh);
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row < 1) return null;
  return objFromRow_(h, sh.getRange(row, 1, 1, h.length).getValues()[0]);
}
function getStudentWork_(classId, email) {
  const w = studentWorkRow_(classId, email);
  return w ? {state:workState_(w), updatedAt:stampOf_(w.updatedAt)} : {state:{}, updatedAt:''};
}
function ensureStudentWork_(classId, email, name) {
  const sh = ensureSheet_(db_(), 'WORK', SHEETS.WORK);
  const h = headersOf_(sh);
  if (findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]) > 0) return;
  withScriptLock_(15000, function(){
    if (findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]) > 0) return;
    sh.appendRow(rowFromObject_(h, {classId:classId, studentEmail:email, studentName:name, stateJson:'{}', updatedAt:new Date().toISOString()}));
  });
}
function upsertWork_(classId, email, name, state, baseUpdatedAt) {
  const sh = ensureSheet_(db_(), 'WORK', SHEETS.WORK);
  const h = headersOf_(sh);
  const write = function(row){
    let now = new Date().toISOString();
    let finalState = state, kept = [];
    let obj = {};
    if (row > 0) {
      obj = objFromRow_(h, sh.getRange(row, 1, 1, h.length).getValues()[0]);
      const storedAt = stampOf_(obj.updatedAt);
      // No two saves may carry the same stamp -- a phone and a laptop firing in
      // the same millisecond would otherwise be indistinguishable.
      if (storedAt && now <= storedAt) { const t = Date.parse(storedAt); if (!isNaN(t)) now = new Date(t + 1).toISOString(); }
      // Built on an older copy than the one stored: merge, never overwrite.
      if (storedAt && String(baseUpdatedAt || '') !== storedAt) {
        const merged = mergeStudentState_(workState_(obj), state);
        finalState = merged.state; kept = merged.kept;
      }
    }
    const json = JSON.stringify(finalState);
    if (json.length > WORK_STATE_MAX_CHARS) throw new Error('This work is too large to save (' + json.length + ' characters). Your browser still has it — tell your teacher before closing the tab.');
    const chunks = workStateChunks_(json);
    Object.assign(obj, {classId:classId, studentEmail:email, studentName:name, updatedAt:now});
    WORK_STATE_COLS.forEach(function(c, i){ obj[c] = chunks[i]; });
    if (row > 0) sh.getRange(row, 1, 1, h.length).setValues([rowFromObject_(h, obj)]);
    else sh.appendRow(rowFromObject_(h, obj));
    return {updatedAt:now, merged:kept.length > 0, kept:kept.slice(0, 40), state:kept.length > 0 ? finalState : null};
  };
  const row = findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email]);
  if (row > 0) return withUserLock_(function(){ return write(row); });
  return withScriptLock_(15000, function(){ return write(findRowByKeys_(sh, h, ['classId','studentEmail'], [classId, email])); });
}

// ---- Two copies of the same student's work ---------------------------------------
// A laptop left open at school wakes up tomorrow and autosaves over the essay
// written on a phone last night. So a save built on an older copy is MERGED:
// for any piece of writing the longer version wins, and anything present in
// only one copy is kept. A save built on the current copy is written exactly as
// it arrives, so deleting your own paragraph still works.
//
// Navigation and class settings take the incoming copy. Writing-time counters
// only ever grow. A turn-in keeps whichever happened later. For each stage, the
// highlights and the writing-process record travel WITH the text that won --
// both index character positions in that text, so mixing them would point at
// the wrong words.
var STATE_TAKE_INCOMING = {'view':1,'role':1,'className':1,'releasedSteps':1,'aiCoach':1,'aiPoster':1,'leadPaste':1,
  'scaffold':1,'memoir.reviewMode':1,'navOpen':1};
function stateValueEmpty_(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
function mergeStudentState_(stored, incoming) {
  const kept = [];
  const state = mergeStateNode_(stored, incoming, '', kept);
  return {state:state, kept:kept};
}
function mergeMemoirNode_(a, b, kept) {
  const at = a.texts || {}, bt = b.texts || {};
  const ac = a.cadence || {}, bc = b.cadence || {};
  const am = a.meta || {}, bm = b.meta || {};
  const texts = {}, cadence = {}, meta = {};
  const keys = {};
  [at, bt, ac, bc, am, bm].forEach(function(o){ Object.keys(o).forEach(function(k){ keys[k] = 1; }); });
  Object.keys(keys).forEach(function(k){
    const sa = String(at[k] === undefined || at[k] === null ? '' : at[k]);
    const sb = String(bt[k] === undefined || bt[k] === null ? '' : bt[k]);
    const useA = sa.trim().length > sb.trim().length || (bt[k] === undefined && at[k] !== undefined);
    if (useA && sa.trim()) kept.push('memoir.texts.' + k);
    if (at[k] !== undefined || bt[k] !== undefined) texts[k] = useA ? at[k] : bt[k];
    const cad = useA ? ac[k] : (bc[k] !== undefined ? bc[k] : ac[k]);
    if (cad !== undefined) cadence[k] = cad;
    const src = useA ? am[k] : (bm[k] !== undefined ? bm[k] : am[k]);
    const other = useA ? bm[k] : am[k];
    if (src && typeof src === 'object') {
      const out = Object.assign({}, src);
      if (other && typeof other === 'object') {
        ['activeMs','sessions','lastInputAt','events','outsideEvents','ownEvents','blocked'].forEach(function(f){
          if (typeof other[f] === 'number' && !(typeof out[f] === 'number' && out[f] >= other[f])) out[f] = other[f];
        });
      }
      meta[k] = out;
    } else if (src !== undefined) meta[k] = src;
  });
  const restA = Object.assign({}, a), restB = Object.assign({}, b);
  ['texts','cadence','meta'].forEach(function(f){ delete restA[f]; delete restB[f]; });
  const out = mergeObjectNode_(restA, restB, 'memoir', kept);
  out.texts = texts; out.cadence = cadence; out.meta = meta;
  return out;
}
function mergeStateNode_(a, b, path, kept) {   // a = stored, b = incoming
  if (typeof a === 'number' && typeof b === 'number' && /\.(activeMs|sessions|lastInputAt)$/.test(path)) {
    if (a > b) { kept.push(path); return a; }
    return b;
  }
  if (b === undefined || b === null) {
    if (!stateValueEmpty_(a)) { kept.push(path); return a; }
    return b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a.trim().length > b.trim().length) { kept.push(path); return a; }
    return b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    // Coach replies are a history, taken whole: more entries wins.
    if (/^memoir\.coach\./.test(path)) { if (a.length > b.length) { kept.push(path); return a; } return b; }
    const out = b.slice();
    for (let i = 0; i < a.length; i++) {
      const p = path + '[' + i + ']';
      if (i >= out.length) { if (!stateValueEmpty_(a[i])) { out.push(a[i]); kept.push(p); } }
      else out[i] = mergeStateNode_(a[i], out[i], p, kept);
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    if (path === 'memoir') return mergeMemoirNode_(a, b, kept);
    if (/^memoir\.submissions\.[^.]+$/.test(path)) {
      const ta = Date.parse(String(a.submittedAt || '')) || 0, tb = Date.parse(String(b.submittedAt || '')) || 0;
      if (ta > tb) { kept.push(path); return a; }
      return b;
    }
    return mergeObjectNode_(a, b, path, kept);
  }
  return b;
}
// Key-by-key merge of two plain objects. mergeMemoirNode_ uses this directly
// for the memoir's other fields, so it never re-enters itself.
function mergeObjectNode_(a, b, path, kept) {
  const out = {};
  Object.keys(b).forEach(function(k){ out[k] = b[k]; });
  Object.keys(a).forEach(function(k){
    const p = path ? path + '.' + k : k;
    if (STATE_TAKE_INCOMING[p]) return;
    if (!(k in out)) { if (!stateValueEmpty_(a[k])) { out[k] = a[k]; kept.push(p); } return; }
    out[k] = mergeStateNode_(a[k], out[k], p, kept);
  });
  return out;
}

// ---- Grade rows -----------------------------------------------------------------------
function getStudentGradeItems_(classId, email) {
  return sheetObjects_('GRADEITEMS').filter(function(g){ return g.classId === classId && norm_(g.studentEmail) === norm_(email); });
}
function upsertGradeItem_(classId, email, name, itemType, itemKey, score, excluded, comment, gradedBy, markedText) {
  const sh = ensureSheet_(db_(), 'GRADEITEMS', SHEETS.GRADEITEMS);
  const h = headersOf_(sh);
  const rec = {classId:classId, studentEmail:email, studentName:name, itemType:itemType, itemKey:itemKey,
    score:score === null ? '' : score, excluded:!!excluded, comment:comment, gradedBy:gradedBy,
    gradedAt:new Date().toISOString(), markedText:markedText === undefined ? '' : markedText};
  const find = function(){
    // Newest matching row wins, the same rule every reader uses (lastMatch_).
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return -1;
    const cols = ['classId','studentEmail','itemType','itemKey'].map(function(c){ return h.indexOf(c); });
    const vals = sh.getRange(1, 1, lastRow, Math.max.apply(null, cols) + 1).getValues();
    for (let i = vals.length - 1; i >= 1; i--) {
      const r = vals[i];
      if (r[cols[0]] === classId && norm_(r[cols[1]]) === norm_(email) && keyOf_(r[cols[2]]) === keyOf_(itemType) && keyOf_(r[cols[3]]) === keyOf_(itemKey)) return i + 1;
    }
    return -1;
  };
  const row = find();
  if (row > 0) return withScriptLock_(15000, function(){ sh.getRange(row, 1, 1, h.length).setValues([rowFromObject_(h, rec)]); });
  return withScriptLock_(15000, function(){
    const again = find();
    if (again > 0) sh.getRange(again, 1, 1, h.length).setValues([rowFromObject_(h, rec)]);
    else sh.appendRow(rowFromObject_(h, rec));
  });
}

// ---- Redo detection ---------------------------------------------------------------------
// Fingerprint of a piece of work: its length plus a short hash, whitespace runs
// flattened so a stray space is not a rewrite. The "fp:" prefix keeps Sheets
// from reading it as a time. Work marked while BLANK gets its own fingerprint,
// so writing it afterwards counts as a resubmission.
function md5Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}
function respFingerprintCore_(text) {
  const t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  if (!t) return '';
  return t.length + ':' + md5Hex_(t).slice(0, 10);
}
const BLANK_FINGERPRINT_ = 'fp:empty';
function respFingerprint_(text) { const core = respFingerprintCore_(text); return core ? 'fp:' + core : BLANK_FINGERPRINT_; }
function markedBaseline_(row) {
  if (!row) return '';
  const mt = row.markedText;
  if (typeof mt !== 'string') return '';   // converted by Sheets -> no baseline
  return mt.trim();
}
function markedBlank_(row) { return markedBaseline_(row) === BLANK_FINGERPRINT_; }
function editedSinceMarked_(markedText, currentText) {
  if (typeof markedText !== 'string') return false;
  const stored = markedText.trim();
  if (!stored) return false;
  const core = respFingerprintCore_(currentText);
  return stored !== (core ? 'fp:' + core : BLANK_FINGERPRINT_);
}

// ===========================================================================
// Canvas: push scores and teacher comments straight into a Canvas course.
//
// Ported from the Macbeth and Short Story apps, where this already runs in
// production. Two things matter more than the code:
//  1. Each teacher's Canvas token is stored in the script's USER properties,
//     keyed by that teacher's email -- never in the class spreadsheet, never
//     sent to a browser.
//  2. Outbound requests need the script.external_request permission. It is
//     granted when you run setupMemoirBackend() from the editor, which is the
//     only place the permission dialog renders properly.
// ===========================================================================
const CANVAS_BASE_URL_USER_PROP = 'MEMOIR_CANVAS_BASE_URL';
const CANVAS_TOKEN_USER_PROP = 'MEMOIR_CANVAS_TOKEN';
function canvasPropKey_(base) { return base + ':' + norm_(currentEmail_()); }

// Run from the editor if Canvas ever says external requests are not allowed.
function testCanvasSetup() {
  const res = UrlFetchApp.fetch('https://www.instructure.com/robots.txt', {muteHttpExceptions:true});
  Logger.log('External requests are authorized. HTTP ' + res.getResponseCode() + '.');
  const conn = canvasConnection_();
  Logger.log(conn.connected ? 'A Canvas token is saved for ' + currentEmail_() + '.' : 'No Canvas token saved yet — connect one in the app.');
  return {ok:true};
}
function normalizeCanvasBaseUrl_(value) {
  let s = String(value || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Enter your Canvas address, for example https://yourschool.instructure.com.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https:\/\//i.test(s)) throw new Error('Canvas must use an https:// address.');
  return s.replace(/\/api\/v1$/i, '');
}
function canvasConnection_() {
  const p = PropertiesService.getUserProperties();
  const baseUrl = String(p.getProperty(canvasPropKey_(CANVAS_BASE_URL_USER_PROP)) || '').trim();
  const token = String(p.getProperty(canvasPropKey_(CANVAS_TOKEN_USER_PROP)) || '').trim();
  return {baseUrl:baseUrl, token:token, connected:!!(baseUrl && token)};
}
function canvasErrorMessage_(body, fallback) {
  try {
    const j = JSON.parse(String(body || ''));
    if (Array.isArray(j.errors) && j.errors.length) return j.errors.map(function(e){ return e.message || e.error || String(e); }).join('; ');
    if (j.message) return j.message;
    if (j.error) return typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
  } catch (e) {}
  return String(body || fallback || 'Canvas request failed.').slice(0, 700);
}
function canvasRequestWith_(conn, method, path, payload) {
  if (!conn || !conn.baseUrl || !conn.token) throw new Error('Canvas is not connected for this teacher yet.');
  const url = /^https:\/\//i.test(path) ? path : conn.baseUrl + path;
  // Never send the token anywhere but the Canvas host this teacher configured.
  const rest = url.slice(conn.baseUrl.length);
  if (url.indexOf(conn.baseUrl) !== 0 || (rest && rest.charAt(0) !== '/' && rest.charAt(0) !== '?')) throw new Error('Canvas returned an unexpected URL.');
  const opt = {method:String(method || 'get').toLowerCase(), headers:{Authorization:'Bearer ' + conn.token, Accept:'application/json'},
               muteHttpExceptions:true, followRedirects:true};
  if (payload && Object.keys(payload).length) opt.payload = payload;
  const res = UrlFetchApp.fetch(url, opt);
  const status = res.getResponseCode();
  const body = res.getContentText();
  if (status < 200 || status >= 300) {
    const err = new Error('Canvas ' + status + ': ' + canvasErrorMessage_(body));
    err.canvasStatus = status;
    throw err;
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch (e) { return {raw:body}; }
}
function canvasRequest_(method, path, payload) { return canvasRequestWith_(canvasConnection_(), method, path, payload); }
function canvasTeacherClass_(classId) {
  const ctx = managedClass_(classId);
  return {me:ctx.me, klass:ctx.klass, settings:Object.assign(defaultClassSettings_(), parseJson_(ctx.klass.settingsJson, {}))};
}

function saveCanvasConnection(payload) {
  requireTeacher_();
  payload = payload || {};
  const existing = canvasConnection_();
  const baseUrl = normalizeCanvasBaseUrl_(payload.baseUrl || existing.baseUrl);
  const token = String(payload.token || existing.token || '').trim();
  if (!token) throw new Error('Paste a Canvas access token. It is stored privately against your own Google account.');
  // Prove the token works before saving it.
  const profile = canvasRequestWith_({baseUrl:baseUrl, token:token}, 'get', '/api/v1/users/self/profile');
  const p = PropertiesService.getUserProperties();
  p.setProperty(canvasPropKey_(CANVAS_BASE_URL_USER_PROP), baseUrl);
  p.setProperty(canvasPropKey_(CANVAS_TOKEN_USER_PROP), token);
  return {ok:true, connected:true, baseUrl:baseUrl, profile:{name:profile.name || profile.short_name || '', email:profile.primary_email || ''}};
}
function clearCanvasConnection() {
  requireTeacher_();
  const p = PropertiesService.getUserProperties();
  p.deleteProperty(canvasPropKey_(CANVAS_BASE_URL_USER_PROP));
  p.deleteProperty(canvasPropKey_(CANVAS_TOKEN_USER_PROP));
  return {ok:true, connected:false};
}
function getCanvasConnectionStatus() {
  requireTeacher_();
  const conn = canvasConnection_();
  if (!conn.connected) return {ok:true, connected:false};
  try {
    const profile = canvasRequestWith_(conn, 'get', '/api/v1/users/self/profile');
    return {ok:true, connected:true, valid:true, baseUrl:conn.baseUrl, profile:{name:profile.name || profile.short_name || '', email:profile.primary_email || ''}};
  } catch (e) {
    return {ok:true, connected:true, valid:false, baseUrl:conn.baseUrl, message:e.message};
  }
}
function listCanvasCourses() {
  requireTeacher_();
  const rows = canvasRequest_('get', '/api/v1/courses?enrollment_type=teacher&enrollment_state=active&per_page=100&include[]=term');
  return {ok:true, courses:(Array.isArray(rows) ? rows : []).map(function(c){
    return {id:String(c.id), name:c.name || c.course_code || ('Course ' + c.id), courseCode:c.course_code || '', term:(c.term && c.term.name) || ''};
  })};
}
function listCanvasAssignmentGroups(payload) {
  requireTeacher_();
  const courseId = String((payload || {}).courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course first.');
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100');
  return {ok:true, groups:(Array.isArray(rows) ? rows : []).map(function(g){ return {id:String(g.id), name:g.name || ('Group ' + g.id)}; })};
}
function linkCanvasCourse(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = canvasTeacherClass_(classId);
  const courseId = String(payload.courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course.');
  const course = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId));
  const groupId = String(payload.assignmentGroupId || '');
  let groupName = '';
  if (groupId) groupName = (canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(groupId)).name) || '';
  const saved = updateClassSettings_(classId, function(s){
    const old = s.canvas || {};
    s.canvas = {courseId:courseId, courseName:course.name || '', assignmentGroupId:groupId, assignmentGroupName:groupName,
      // Keep the assignment links only when it is the same course.
      assignments:String(old.courseId || '') === courseId ? (old.assignments || {}) : {}};
  });
  return {ok:true, canvas:saved.canvas};
}
function unlinkCanvasCourse(payload) {
  const classId = String((payload || {}).classId || '');
  canvasTeacherClass_(classId);
  const saved = updateClassSettings_(classId, function(s){
    s.canvas = {courseId:'', courseName:'', assignmentGroupId:'', assignmentGroupName:'', assignments:{}};
  });
  return {ok:true, canvas:saved.canvas};
}
function canvasCourseStudents_(courseId) {
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&per_page=100');
  return (Array.isArray(rows) ? rows : []).map(function(u){
    return {id:String(u.id), name:u.name || u.short_name || '', email:String(u.email || u.login_id || '').trim().toLowerCase(),
            loginId:String(u.login_id || '').trim().toLowerCase(), sisId:String(u.sis_user_id || '').trim().toLowerCase()};
  });
}
function canvasMatchStudent_(email, list) {
  const e = norm_(email);
  if (!e) return null;
  return list.find(function(u){ return u.email === e || u.loginId === e || u.sisId === e; }) || null;
}
// Canvas assignments follow the release switch when they are created. An
// update never UNpublishes (Canvas refuses once grades exist); it only
// publishes when the piece is open to students.
function assignmentReleased_(settings, ref) { return releasedFromSettings_(settings)[ref.key] !== false; }
const CANVAS_BLURB = {
  lead: 'Write your Lead — one vivid beat right before your climax, with an action, a thought or question, a sound, and a line of dialogue.',
  share: 'Post your Lead to the Lead Share board and reply to at least two classmates with specific, useful feedback.',
  beginning: 'Rewind to the true beginning: time and place, the people who matter, your “before” normal, and a hint of what is coming.',
  rising: 'Narrate the events that build toward your climax, and show how each one changed what you wanted, feared, or believed.',
  callback: 'Echo an image, phrase, sound or question from your Lead as you arrive back at that moment.',
  climax: 'Slow your climax down into 3–5 micro-moments, each with an external detail and an internal reaction.',
  sowhat: 'Reflect honestly on how this moment changed or affected you.',
  final: 'Revise all six stages together and turn in your finished memoir. It is scored on Structure & Frame, Pacing & Detail, Reflection & Significance, and Voice & Conventions — the same rubric you rate yourself on.',
  poster: 'Turn your finished memoir into a poster — your title and byline at the top, then every word exactly as you wrote it.'
};
function canvasDescriptionHtml_(ref) {
  const url = appWebUrl_();
  const intro = '<p>' + (CANVAS_BLURB[ref.key] || '') + ' You do this work in the Memoir app; your teacher grades it there and the score is sent back to Canvas.</p>';
  if (!url) return intro;
  return intro + '<p><a href="' + url + '" target="_blank" rel="noopener"><strong>Open the Memoir app</strong></a></p><p><small>Sign in with your school Google account.</small></p>';
}
function canvasScheduleFor_(settings, ref) {
  return (settings.assignmentSchedule || {})[assignmentSettingsKey_(ref)] || {dueAt:'', unlockAt:'', lockAt:''};
}
function applyCanvasSchedule_(form, schedule) {
  if (schedule.dueAt !== undefined) form['assignment[due_at]'] = schedule.dueAt || '';
  if (schedule.unlockAt !== undefined) form['assignment[unlock_at]'] = schedule.unlockAt || '';
  if (schedule.lockAt !== undefined) form['assignment[lock_at]'] = schedule.lockAt || '';
  return form;
}
function canvasFindAssignmentByName_(courseId, name) {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignments?per_page=100&search_term=' + encodeURIComponent(wanted));
  const hit = (Array.isArray(rows) ? rows : []).find(function(a){ return String(a.name || '').trim() === wanted; });
  return hit ? {id:String(hit.id), name:hit.name, pointsPossible:Number(hit.points_possible || 0)} : null;
}
// Other classes in this app pointing at the same Canvas assignment -- two
// sections of one course share it, and neither blanks the other's scores.
function canvasSharedWith_(classId, courseId, assignmentId) {
  if (!assignmentId) return [];
  const out = [];
  sheetObjects_('CLASSES').forEach(function(k){
    if (k.classId === classId || !truthy_(k.active)) return;
    const cc = parseJson_(k.settingsJson, {}).canvas || {};
    if (String(cc.courseId || '') !== String(courseId)) return;
    if (Object.keys(cc.assignments || {}).some(function(key){ return String((cc.assignments[key] || {}).assignmentId || '') === String(assignmentId); }))
      out.push(k.className + (k.period ? ' · ' + k.period : ''));
  });
  return out;
}
function syncCanvasModuleItem_(courseId, assignment, desiredModuleId, desiredModuleName, oldLink, title, published) {
  desiredModuleId = String(desiredModuleId || '');
  oldLink = oldLink || {};
  let oldModuleId = String(oldLink.moduleId || ''), oldItemId = String(oldLink.moduleItemId || '');
  const assignmentId = String((assignment || {}).id || '');
  const enc = encodeURIComponent(courseId);
  const deleteOld = function(){
    if (!oldModuleId || !oldItemId) return;
    try { canvasRequest_('delete', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId)); }
    catch (e) { if (e.canvasStatus !== 404) throw e; }
    oldModuleId = ''; oldItemId = '';
  };
  if (oldLink.assignmentId && assignmentId && String(oldLink.assignmentId) !== assignmentId) deleteOld();
  if (!desiredModuleId) { deleteOld(); return {moduleId:'', moduleName:'', moduleItemId:''}; }
  const moduleObj = canvasRequest_('get', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId));
  const moduleName = moduleObj.name || String(desiredModuleName || '');
  const itemForm = {'module_item[title]':title, 'module_item[published]':published ? 'true' : 'false'};
  let item = null;
  if (oldItemId && oldModuleId) {
    try {
      const upd = Object.assign({}, itemForm);
      if (oldModuleId !== desiredModuleId) upd['module_item[module_id]'] = desiredModuleId;
      item = canvasRequest_('put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId), upd);
    } catch (e) { if (e.canvasStatus !== 404) throw e; oldItemId = ''; oldModuleId = ''; }
  }
  if (!item) {
    item = canvasRequest_('post', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items',
      {'module_item[title]':title, 'module_item[type]':'Assignment', 'module_item[content_id]':assignmentId});
    try { item = canvasRequest_('put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items/' + encodeURIComponent(item.id), itemForm); } catch (e) {}
  }
  return {moduleId:desiredModuleId, moduleName:moduleName, moduleItemId:String(item.id || oldItemId || '')};
}

// Creates the Canvas assignment for a piece, or updates the one this class
// already made. Graded in this app, so the Canvas assignment takes no
// submissions. A second class in the same course ADOPTS the first one's
// assignment instead of making a twin.
function syncCanvasAssignment(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ref = assignmentRef_(payload);
  const ctx = canvasTeacherClass_(classId);
  let c = ctx.settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  const data = memoirGradeRows_(classId, ref.key);
  const aKey = assignmentSettingsKey_(ref);
  c.assignments = c.assignments || {};
  const old = c.assignments[aKey] || {};
  // Set only when the teacher changed the group in this window; '' leaves Canvas as it is.
  const chosenGroup = String(payload.assignmentGroupId || '');
  const released = assignmentReleased_(ctx.settings, ref);
  ctx.settings.assignmentSchedule = ctx.settings.assignmentSchedule || {};
  const prior = canvasScheduleFor_(ctx.settings, ref);
  const schedule = {
    dueAt:payload.dueAt !== undefined ? String(payload.dueAt || '') : prior.dueAt,
    unlockAt:payload.unlockAt !== undefined ? String(payload.unlockAt || '') : prior.unlockAt,
    lockAt:payload.lockAt !== undefined ? String(payload.lockAt || '') : prior.lockAt
  };
  ctx.settings.assignmentSchedule[aKey] = schedule;
  const form = applyCanvasSchedule_({
    'assignment[name]':data.label, 'assignment[points_possible]':String(data.pointsPossible),
    'assignment[grading_type]':data.gradingType, 'assignment[submission_types][]':'none',
    'assignment[description]':canvasDescriptionHtml_(ref)
  }, schedule);
  if (released) form['assignment[published]'] = 'true';
  const enc = encodeURIComponent(c.courseId);
  let assignment, adopted = false;
  if (old.assignmentId) {
    try { assignment = canvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(old.assignmentId), canvasWithGroup_(form, null, chosenGroup)); }
    catch (e) {
      if (e.canvasStatus !== 404) throw e;   // deleted in Canvas: make a fresh one
      assignment = canvasRequest_('post', '/api/v1/courses/' + enc + '/assignments', canvasWithGroup_(Object.assign({'assignment[published]':released ? 'true' : 'false'}, form), c, chosenGroup));
    }
  } else {
    let existing = null;
    try { existing = canvasFindAssignmentByName_(c.courseId, data.label); } catch (e) { existing = null; }
    if (existing) {
      adopted = true;
      // Adopt it; leave its dates alone -- the other class set those.
      const adoptForm = {};
      Object.keys(form).forEach(function(k){ if (k.indexOf('_at]') === -1) adoptForm[k] = form[k]; });
      assignment = canvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(existing.id), canvasWithGroup_(adoptForm, null, chosenGroup));
    } else {
      assignment = canvasRequest_('post', '/api/v1/courses/' + enc + '/assignments', canvasWithGroup_(Object.assign({'assignment[published]':released ? 'true' : 'false'}, form), c, chosenGroup));
    }
  }
  const moduleLink = syncCanvasModuleItem_(c.courseId, assignment,
    payload.moduleId !== undefined ? String(payload.moduleId || '') : String(old.moduleId || ''),
    String(payload.moduleName || old.moduleName || ''), old, data.label, assignment.published !== false);
  const newLink = {kind:ref.kind, key:ref.key, assignmentId:String(assignment.id), name:assignment.name || data.label,
    htmlUrl:assignment.html_url || '', pointsPossible:Number(assignment.points_possible || data.pointsPossible),
    dueAt:assignment.due_at || schedule.dueAt || '', published:assignment.published !== false, assignmentGroupId:String(assignment.assignment_group_id || ''),
    moduleId:moduleLink.moduleId, moduleName:moduleLink.moduleName, moduleItemId:moduleLink.moduleItemId,
    lastAssignmentSyncAt:new Date().toISOString(), lastGradeSyncAt:old.lastGradeSyncAt || '', feedbackSync:old.feedbackSync || {}};
  const saved = updateClassSettings_(classId, function(s){
    s.assignmentSchedule = s.assignmentSchedule || {};
    s.assignmentSchedule[aKey] = schedule;
    s.canvas = s.canvas || {};
    s.canvas.assignments = s.canvas.assignments || {};
    const prior = s.canvas.assignments[aKey] || {};
    // A push that landed meanwhile keeps its record of comments already sent.
    newLink.feedbackSync = Object.assign({}, newLink.feedbackSync || {}, prior.feedbackSync || {});
    if (prior.lastGradeSyncAt && prior.lastGradeSyncAt > (newLink.lastGradeSyncAt || '')) newLink.lastGradeSyncAt = prior.lastGradeSyncAt;
    s.canvas.assignments[aKey] = newLink;
  });
  c = saved.canvas;
  return {ok:true, assignment:newLink, canvas:c, adopted:adopted, sharedWith:canvasSharedWith_(classId, c.courseId, String(assignment.id))};
}

// Sends this piece's scores AND teacher comments to Canvas in one press.
// Creates the assignment first if it does not exist yet.
function pushCanvasGrades(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ref = assignmentRef_(payload);
  let ctx = canvasTeacherClass_(classId);
  let c = ctx.settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  const aKey = assignmentSettingsKey_(ref);
  if (!(c.assignments || {})[aKey]) {
    syncCanvasAssignment(Object.assign({}, payload, {classId:classId}));
    ctx = canvasTeacherClass_(classId);
    c = ctx.settings.canvas || {};
  }
  const link = (c.assignments || {})[aKey];
  const data = memoirGradeRows_(classId, ref.key);
  if (!link || !link.assignmentId) throw new Error('Could not find or create the Canvas assignment for ' + data.label + '.');
  const enc = encodeURIComponent(c.courseId), encA = encodeURIComponent(link.assignmentId);
  // No date fields here: dates only change from the due-date screen, so a push
  // never overwrites a date the other section just set.
  const updateForm = {'assignment[name]':data.label, 'assignment[points_possible]':String(data.pointsPossible),
    'assignment[grading_type]':data.gradingType, 'assignment[submission_types][]':'none', 'assignment[description]':canvasDescriptionHtml_(ref)};
  if (assignmentReleased_(ctx.settings, ref)) updateForm['assignment[published]'] = 'true';
  const sharedWith = canvasSharedWith_(classId, c.courseId, String(link.assignmentId));
  let pointsConflict = '';
  if (sharedWith.length) {
    try {
      const before = canvasRequest_('get', '/api/v1/courses/' + enc + '/assignments/' + encA);
      if (Number(before.points_possible) !== Number(data.pointsPossible))
        pointsConflict = 'This assignment is shared with ' + sharedWith.join(', ') + '. Canvas had it out of ' + Number(before.points_possible) +
          ' points and this class works out to ' + data.pointsPossible + ', so Canvas now says ' + data.pointsPossible + '. That happens when a criterion is excluded for one class and not the other.';
    } catch (e) {}
  }
  const updated = canvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encA, updateForm);
  const canvasStudents = canvasCourseStudents_(c.courseId);
  const form = {}, unmatched = [], matched = [];
  let sent = 0;
  data.rows.forEach(function(r){
    const hasScore = r.score !== null && r.score !== undefined;
    const feedback = cleanTeacherComment_(r.feedback);
    if (!hasScore && !feedback) return;
    const u = canvasMatchStudent_(r.email, canvasStudents);
    if (!u) { unmatched.push((r.name || r.email) + ' (' + r.email + ')'); return; }
    matched.push({row:r, user:u, feedback:feedback});
    if (!hasScore) return;
    form['grade_data[' + u.id + '][posted_grade]'] = data.gradingType === 'pass_fail' ? (Number(r.score) > 0 ? 'complete' : 'incomplete') : String(r.score);
    sent++;
  });
  let progress = null;
  if (sent) progress = canvasRequest_('post', '/api/v1/courses/' + enc + '/assignments/' + encA + '/submissions/update_grades', form);
  // Canvas comments are additive: remember the version last sent to each
  // student so a second push does not post the same comment twice.
  link.feedbackSync = link.feedbackSync || {};
  let feedbackPosted = 0, feedbackSkipped = 0;
  const feedbackFailed = [];
  matched.forEach(function(m){
    if (!m.feedback) return;
    const k = norm_(m.row.email);
    const hash = md5Hex_(m.feedback);
    const prior = link.feedbackSync[k];
    if ((prior && typeof prior === 'object' ? String(prior.hash || '') : String(prior || '')) === hash) { feedbackSkipped++; return; }
    try {
      canvasRequest_('put', '/api/v1/courses/' + enc + '/assignments/' + encA + '/submissions/' + encodeURIComponent(m.user.id), {'comment[text_comment]':m.feedback});
      link.feedbackSync[k] = {hash:hash, syncedAt:new Date().toISOString()};
      feedbackPosted++;
    } catch (e) { feedbackFailed.push((m.row.name || m.row.email) + ': ' + (e.message || String(e))); }
  });
  link.pointsPossible = Number(updated.points_possible || data.pointsPossible);
  link.name = updated.name || data.label;
  link.htmlUrl = updated.html_url || link.htmlUrl || '';
  link.published = updated.published !== false;
  link.dueAt = updated.due_at || link.dueAt || '';
  if (link.moduleId) {
    const ml = syncCanvasModuleItem_(c.courseId, updated, link.moduleId, link.moduleName || '', link, data.label, link.published);
    link.moduleId = ml.moduleId; link.moduleName = ml.moduleName; link.moduleItemId = ml.moduleItemId;
  }
  link.lastGradeSyncAt = new Date().toISOString();
  updateClassSettings_(classId, function(s){
    s.canvas = s.canvas || {};
    s.canvas.assignments = s.canvas.assignments || {};
    const prior = s.canvas.assignments[aKey] || {};
    link.feedbackSync = Object.assign({}, prior.feedbackSync || {}, link.feedbackSync || {});
    s.canvas.assignments[aKey] = Object.assign({}, prior, link);
  });
  return {ok:true, kind:ref.kind, key:ref.key, label:data.label, sent:sent, pointsPossible:data.pointsPossible,
    unmatched:unmatched, skipped:data.skipped, adjusted:data.adjusted, unmarked:data.unmarked, assignment:link,
    sharedWith:sharedWith, pointsConflict:pointsConflict, feedbackPosted:feedbackPosted, feedbackSkipped:feedbackSkipped,
    feedbackFailed:feedbackFailed, progressUrl:progress && progress.url ? progress.url : ''};
}
function listCanvasModules(payload) {
  requireTeacher_();
  const courseId = String((payload || {}).courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course first.');
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/modules?per_page=100');
  return {ok:true, modules:(Array.isArray(rows) ? rows : []).filter(function(m){ return m.workflow_state !== 'deleted'; })
    .map(function(m){ return {id:String(m.id), name:m.name || ('Module ' + m.id), position:Number(m.position || 0), published:m.published !== false}; })
    .sort(function(a, b){ return (a.position - b.position) || a.name.localeCompare(b.name); })};
}
// What Canvas really has for one assignment, for the due-date screen.
function getCanvasAsgSetup(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ref = assignmentRef_(payload);
  const ctx = canvasTeacherClass_(classId);
  const c = ctx.settings.canvas || {};
  const link = (c.assignments || {})[assignmentSettingsKey_(ref)] || null;
  let pointsPossible = pieceMax_(ref.key) || memoirFinalPoints_(), gradingType = MEMOIR_PASS_FAIL[ref.key] ? 'pass_fail' : 'points', label = assignmentLabel_(ref.key), rowsError = '';
  try { const d = memoirGradeRows_(classId, ref.key); pointsPossible = d.pointsPossible; label = d.label; gradingType = d.gradingType; } catch (e) { rowsError = e.message; }
  let modules = [], modulesError = '';
  if (c.courseId) { try { modules = listCanvasModules({courseId:c.courseId}).modules; } catch (e) { modulesError = e.message; } }
  let groups = [], groupsError = '';
  if (c.courseId) { try { groups = listCanvasAssignmentGroups({courseId:c.courseId}).groups; } catch (e) { groupsError = e.message; } }
  let live = null;
  if (link && link.assignmentId) { try { live = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId)); } catch (e) { live = null; } }
  const stored = canvasScheduleFor_(ctx.settings, ref);
  return {ok:true, kind:ref.kind, key:ref.key, label:label, gradingType:gradingType, pointsPossible:pointsPossible, rowsError:rowsError,
    canvasPointsPossible:live ? Number(live.points_possible || 0) : null, canvas:c, link:link,
    sharedWith:link && link.assignmentId ? canvasSharedWith_(classId, c.courseId, String(link.assignmentId)) : [],
    schedule:live ? {dueAt:live.due_at || '', unlockAt:live.unlock_at || '', lockAt:live.lock_at || ''} : stored,
    modules:modules, modulesError:modulesError, groups:groups, groupsError:groupsError,
    // Where the assignment is in Canvas now (it may have been moved there); before it exists, the class default.
    currentGroupId:live ? String(live.assignment_group_id || '') : String(c.assignmentGroupId || ''),
    appUrl:appWebUrl_(), published:assignmentReleased_(ctx.settings, ref)};
}

// ===========================================================================
// checkFiles() -- run from the Apps Script editor after pasting any file.
//
// A big paste can be silently cut short. This compares every file with the
// size and fingerprint of the version that was shipped, so a bad paste is
// caught in five seconds instead of in front of a class. It checks the FILES
// only -- it says nothing about which version is deployed.
// Regenerated with Node every release (Python's \s differs from JavaScript's).
// ===========================================================================
var FILE_FINGERPRINTS = {
  release: '2026-10-23a',
  files: {
    "Index": {
      "chars": 64283,
      "md5": "5bf548f426d5272cb5cef451219a1c7d",
      "md5ws": "f739a4f9f777fc07c776b3edc655dff1"
    },
    "MemoirData": {
      "chars": 22380,
      "md5": "e2d5f17946c62c299504f1a4b5217279",
      "md5ws": "a2ad7ce32d35e684ebca1ac55da21199"
    },
    "AppLogic": {
      "chars": 83890,
      "md5": "4e1adbf3b6f7b2c5df857db0dda8b592",
      "md5ws": "34801055c8b005f1a4af92674dbd4f94"
    },
    "BackendClient": {
      "chars": 149606,
      "md5": "bf4c410e942dc79db591221a5dec78cd",
      "md5ws": "b23f9dc3b71c5f822f60638af570ebf2"
    }
  }
};
function fileFingerprint_(name) {
  const raw = HtmlService.createTemplateFromFile(name).getRawContent();
  const text = String(raw).replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
  return {chars:text.length, md5:md5Hex_(text), md5ws:md5Hex_(text.replace(/\s+/g, ''))};
}
function checkFiles() {
  const expected = FILE_FINGERPRINTS.files;
  const names = Object.keys(expected);
  const bad = [];
  Logger.log('Checking against release: ' + FILE_FINGERPRINTS.release);
  names.forEach(function(name){
    let got;
    try { got = fileFingerprint_(name); }
    catch (e) { bad.push(name); Logger.log('MISSING  ' + name + ' -- no file with that name (capitals matter)'); return; }
    const want = expected[name];
    if (got.md5 === want.md5) { Logger.log('OK       ' + name + '  ' + got.chars + ' characters'); return; }
    if (want.md5ws && got.md5ws === want.md5ws) { Logger.log('OK*      ' + name + '  ' + got.chars + ' characters -- identical apart from spacing. Nothing to do.'); return; }
    bad.push(name);
    if (got.chars < want.chars * 0.98) Logger.log('SHORT    ' + name + '  ' + got.chars + ' of ' + want.chars + ' characters (' + Math.round(got.chars / want.chars * 100) + '%) -- the paste was cut off. Re-paste this file.');
    else if (got.chars > want.chars * 1.02) Logger.log('TOO BIG  ' + name + '  ' + got.chars + ' of ' + want.chars + ' characters -- this file may hold something extra, or another app\'s code.');
    else Logger.log('DIFFERS  ' + name + '  right length (' + got.chars + ') but different content -- an edit you made on purpose, or the wrong file pasted here.');
  });
  if (!bad.length) Logger.log('\nAll ' + names.length + ' HTML files match. (Code.gs is this file — if it runs, it pasted.) Safe to deploy.');
  else Logger.log('\nRe-paste: ' + bad.join(', ') + '  (fix the first one first)');
  return {ok:!bad.length, problems:bad, release:FILE_FINGERPRINTS.release};
}
// Reports any tab whose columns no longer match what the code expects.
function checkSchemas() {
  const ss = db_();
  Object.keys(SHEETS).forEach(function(name){
    const sh = ss.getSheetByName(name);
    if (!sh) { Logger.log(name + ': MISSING (it is created the first time it is needed)'); return; }
    const have = headersOf_(sh);
    const missing = SHEETS[name].filter(function(c){ return have.indexOf(c) < 0; });
    Logger.log(name + ': ' + (missing.length ? 'MISSING ' + missing.join(', ') : 'all columns present'));
  });
}

// Canvas assignment groups: the app chooses the group only when it CREATES an assignment.
// Updates never send a group, so an assignment moved to another group in Canvas stays there.
// chosen = the group the teacher picked for THIS assignment in its "Due date & Canvas" window
// (sent only when they changed it). Creating: chosen, else the class default. Updating: pass
// c = null, so only an explicit choice moves it.
function canvasWithGroup_(form, c, chosen) {
  var f = {};
  Object.keys(form || {}).forEach(function (k) { f[k] = form[k]; });
  var g = String(chosen || '') || String((c && c.assignmentGroupId) || '');
  if (g) f['assignment[assignment_group_id]'] = g;
  return f;
}
