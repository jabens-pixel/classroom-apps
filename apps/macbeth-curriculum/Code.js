const MACBETH_DB_PROP = 'MACBETH_DB_ID';
// Bump this value for every published Macbeth build. The browser compares its
// embedded build number with this server value so a cached/stale page cannot
// quietly keep students on old code after a new deployment.
const MACBETH_APP_VERSION = '2026-10-23e';
// Shared across deployment versions. This is the important part of the update
// guard: an old open page can still read this property even when its
// google.script.run calls are executing older deployed code.
const MACBETH_LIVE_VERSION_PROP = 'MACBETH_LIVE_VERSION';
const SHEETS = {
  USERS: ['email','name','role','status','createdAt','updatedAt'],
  CLASSES: ['classId','teacherEmail','className','period','joinCode','settingsJson','active','createdAt','updatedAt'],
  ENROLL: ['classId','studentEmail','studentName','joinedAt','active'],
  WORK: ['classId','studentEmail','studentName','stateJson','updatedAt'],
  DISCUSS: ['postId','classId','studentEmail','studentName','text','createdAt','updatedAt'],
  DISCUSS_REPLIES: ['replyId','classId','postId','studentEmail','studentName','text','createdAt'],
  // Legacy: one holistic 1-7 score per (class, student, Act). Superseded by
  // GRADEITEMS below (per-question grading) but left in place, untouched, so
  // any grades already saved under the old model are not lost.
  GRADES: ['classId','studentEmail','studentName','act','score','comment','gradedBy','gradedAt'],
  // Per-question grading: one row per (class, student, itemType, itemKey).
  // itemType is 'mc' (multiple choice -- a row here only ever records a
  // teacher's "exclude this from the grade" choice; the score itself is
  // always computed from the student's own saved answers, never teacher-
  // entered) or 'dok' (one row per scene's written response, teacher-scored
  // 1-7 and independently excludable), or -- for the essay -- 'essay' (one row
  // per essay step: thesis, discussion, body, intro, conclusion) or
  // 'essayRubric' (one row per criterion of the finished essay: Argument &
  // Insight, Evidence & Analysis, Organization & Coherence, Language & Control).
  // Same row shape for all four; only the set of
  // valid itemKeys and the point value differ.
  // markedText is a fingerprint (length + short hash) of the student's written
  // response AS IT STOOD when the teacher marked it -- not the text itself.
  // Comparing it to the response now is how a redone answer is detected, and
  // it beats comparing timestamps because it does not trust a device's clock.
  GRADEITEMS: ['classId','studentEmail','studentName','itemType','itemKey','score','excluded','comment','gradedBy','gradedAt','markedText']
};

// Point values for the auto-totaled Act score: each scene contributes one
// multiple-choice question (auto-graded from the student's quiz attempts,
// unless the teacher excludes it) and one written/DOK response (teacher-
// graded on the clickable 1-7 rubric, unless the teacher excludes it).
const MC_POINTS = 4;
const DOK_POINTS = 7;

// ---- The essay, graded step by step ----------------------------------------
// Each step of the Writing Workshop is its own gradebook entry and its own
// Canvas assignment, so a student's essay grade is not one number that arrives
// at the end of the unit. The thesis is a completion mark; the four written
// steps are each scored 1-7 on their own rubric; the finished essay is scored
// on the four-criterion rubric the students already self-assess against.
//
// The rubric DESCRIPTORS live client-side in AppLogic.html (BODY_RUBRIC and
// friends). Only the point values are mirrored here, which is all the server
// needs to validate a score -- the same split as DOK_RUBRIC/DOK_POINTS.
const ESSAY_STEP_KEYS = ['thesis','discussion','body','intro','conclusion'];
const ESSAY_STEP_LABELS = {
  thesis: 'Thesis',
  discussion: 'Thesis Discussion',
  body: 'Body Paragraphs',
  intro: 'Introduction',
  conclusion: 'Conclusion'
};
const ESSAY_RUBRIC_MAX = 7;
// The thesis is a completion mark, not a rubric score: one point, and the only
// question is whether they drafted one. In Canvas it is a complete/incomplete
// assignment so it shows as done or missing without moving a percentage much.
const ESSAY_THESIS_POINTS = 1;
const ESSAY_CRITERIA = ['Argument & Insight','Evidence & Analysis','Organization & Coherence','Language & Control'];
const LEGACY_ESSAY_CRITERIA = ['Meaning','Style','Form','Conventions'];
const LEGACY_SELF_CRITERION = {
  'Argument & Insight':'Meaning',
  'Evidence & Analysis':'Meaning',
  'Organization & Coherence':'Form',
  'Language & Control':'Style'
};
const ESSAY_CRITERION_MAX = 7;
// Points per level of the four-criterion rubric, best first -- matching the band
// headings the students see on the self-evaluation step ("7 to >6 pts", ...).
const ESSAY_CRITERION_POINTS = [7,6,5,4,1];
const ESSAY_FINAL_KEY = 'final';

function essayStepPoints_(key) { return key === 'thesis' ? ESSAY_THESIS_POINTS : ESSAY_RUBRIC_MAX; }
function essayFinalPoints_() { return ESSAY_CRITERIA.length * ESSAY_CRITERION_MAX; }

// Mirrors PlayData.html's SCENES/QUESTIONS (client-side only) just enough
// for server-side total calculations: which Act each scene belongs to, and
// the correct multiple-choice option index, so a student's raw picks can be
// scored the same way AppLogic.html's answerInfo() scores them on screen.
// If a scene's MC question or its correct answer ever changes in
// PlayData.html, update the matching entry here too.
const SCENE_META = {
  '1.1':{act:1,correctIdx:0}, '1.2':{act:1,correctIdx:1}, '1.3':{act:1,correctIdx:2}, '1.4':{act:1,correctIdx:1},
  '1.5':{act:1,correctIdx:1}, '1.6':{act:1,correctIdx:1}, '1.7':{act:1,correctIdx:0},
  '2.1':{act:2,correctIdx:2}, '2.2':{act:2,correctIdx:1}, '2.3':{act:2,correctIdx:2}, '2.4':{act:2,correctIdx:1},
  '3.1':{act:3,correctIdx:0}, '3.2':{act:3,correctIdx:1}, '3.3':{act:3,correctIdx:1}, '3.4':{act:3,correctIdx:1},
  '3.5':{act:3,correctIdx:1}, '3.6':{act:3,correctIdx:2},
  '4.1':{act:4,correctIdx:1}, '4.2':{act:4,correctIdx:1}, '4.3':{act:4,correctIdx:0},
  '5.1':{act:5,correctIdx:0}, '5.2':{act:5,correctIdx:1}, '5.3':{act:5,correctIdx:1}, '5.4':{act:5,correctIdx:1},
  '5.5':{act:5,correctIdx:1}, '5.6':{act:5,correctIdx:1}, '5.7':{act:5,correctIdx:1}, '5.8':{act:5,correctIdx:1}
};

// Turn a release id such as 2026-09-24i into a value that can be compared.
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
  return PropertiesService.getScriptProperties().getProperty(MACBETH_LIVE_VERSION_PROP) || MACBETH_APP_VERSION;
}

// A new deployed page advances the shared live-version marker. It NEVER moves
// backward, so an old/alternate deployment cannot accidentally tell the whole
// class to downgrade. Script Properties are shared by every deployment version
// of this Apps Script project, which makes them a reliable bridge from an old
// open tab to a newly published build.
function registerLiveAppVersion_() {
  const lock = LockService.getScriptLock();
  try { lock.tryLock(2000); } catch (_e) {}
  try {
    const props = PropertiesService.getScriptProperties();
    const live = props.getProperty(MACBETH_LIVE_VERSION_PROP) || '';
    if (!live || compareAppVersions_(MACBETH_APP_VERSION, live) > 0) {
      props.setProperty(MACBETH_LIVE_VERSION_PROP, MACBETH_APP_VERSION);
      return MACBETH_APP_VERSION;
    }
    return live;
  } finally {
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_e2) {}
  }
}

function doGet() {
  // The first real request to a newly deployed build publishes that version to
  // the shared marker. Subsequent requests are reads only.
  registerLiveAppVersion_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Macbeth - Ambition, Destiny, Consequence')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called by the browser before bootstrap. IMPORTANT: return the SHARED live
// marker rather than this server file's constant. An old page may still be
// running old server code, but Script Properties are shared across versions,
// so it can still discover that a newer build has gone live.
function getAppVersion() {
  return {
    version: liveAppVersion_(),
    serverBuild: MACBETH_APP_VERSION,
    url: ScriptApp.getService().getUrl() || ''
  };
}

// Used by Index.html to pull in AppLogic.html and BackendClient.html as
// separate files, so no single pasted file has to be enormous.
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupMacbethBackend() {
  const email = currentEmail_();
  if (!email) throw new Error('No Google Workspace email was detected. Run setup while signed into your school Google account.');
  let id = PropertiesService.getScriptProperties().getProperty(MACBETH_DB_PROP);
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('Macbeth Curriculum Backend');
    PropertiesService.getScriptProperties().setProperty(MACBETH_DB_PROP, ss.getId());
  }
  Object.keys(SHEETS).forEach(key => ensureSheet_(ss, key, SHEETS[key]));
  upsertUser_(email, displayNameFromEmail_(email), 'admin', 'active');
  return {ok:true, spreadsheetId:ss.getId(), spreadsheetUrl:ss.getUrl(), adminEmail:email};
}

function getBootstrap() {
  const email = currentEmail_();
  if (!email) return {ok:false, error:'EMAIL_NOT_AVAILABLE', message:'Your Google account email is not available. Deploy the web app for users in your Google Workspace domain and require sign-in.'};
  ensureDb_();
  const user = getUser_(email);
  const role = user && user.status === 'active' ? user.role : 'student';
  const result = {ok:true, email, name:(user && user.name) || displayNameFromEmail_(email), role, accessStatus:user ? user.status : 'student', classes:[], appVersion:liveAppVersion_(), appUrl:ScriptApp.getService().getUrl() || ''};
  if (role === 'admin' || role === 'teacher') {
    result.classes = getTeacherClasses_(email, role === 'admin');
    result.access = role === 'admin' ? adminListAccess_() : null;
  } else {
    result.classes = getStudentClasses_(email);
    // Show the enrolled name (what the teacher marks against), not the one
    // derived from the email address, and flag it when it still looks derived.
    const myEnroll = lastMatch_(sheetObjects_('ENROLL'), function(r){ return norm_(r.studentEmail) === norm_(email) && truthy_(r.active); });
    if (myEnroll && String(myEnroll.studentName || '').trim()) result.name = String(myEnroll.studentName).trim();
    result.needsName = result.classes.length ? nameLooksIncomplete_(result.name) : false;
  }
  if (result.classes.length) {
    const classId = result.classes[0].classId;
    result.activeClassId = classId;
    if (role === 'student') {
      const work = getStudentWork_(classId, email);
      result.state = work.state;
      // The browser sends this back with every save so the server can tell a
      // save built on the current copy from one built on yesterday's.
      result.stateUpdatedAt = work.updatedAt;
      result.classSettings = sanitizeClassSettingsForStudent_(parseJson_(result.classes[0].settingsJson, defaultClassSettings_()));
      result.discussion = getClassDiscussion_(classId);
      result.grades = getStudentGrades_(classId, email);
      result.gradeSummary = gradeSummaryForStudent_(classId, email, result.state, null,
        {posts: (discussPostsByEmail_(classId)[norm_(email)] || [])});
    }
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
  appendRow_('CLASSES', [classId, me.email, className, period, code, JSON.stringify(defaultClassSettings_()), true, now, now]);
  return {ok:true, classId, className, period, joinCode:code};
}

function joinClass(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Sign in with your school Google account first.');
  payload = payload || {};
  const code = String(payload.code || '').trim().toUpperCase();
  if (!code) throw new Error('Enter a class code.');
  const name = requireFullName_(payload.firstName, payload.lastName, payload.name);
  const rows = sheetObjects_('CLASSES');
  const klass = rows.find(r => String(r.joinCode).toUpperCase() === code && truthy_(r.active));
  if (!klass) throw new Error('That class code was not found or the class is inactive.');
  const enrollRows = sheetObjects_('ENROLL');
  const existing = enrollRows.find(r => r.classId === klass.classId && norm_(r.studentEmail) === norm_(email));
  if (!existing) appendRow_('ENROLL', [klass.classId, email, name, new Date().toISOString(), true]);
  else if (String(existing.studentName || '').trim() !== name) setStudentNameEverywhere_(email, name);
  ensureStudentWork_(klass.classId, email, name);
  return {ok:true, classId:klass.classId, className:klass.className, teacherEmail:klass.teacherEmail};
}

function saveStudentState(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Not signed in.');
  payload = payload || {};
  const classId = String(payload.classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const state = payload.state || {};
  const enroll = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(email));
  const name = enroll ? enroll.studentName : displayNameFromEmail_(email);
  const res = upsertWork_(classId, email, name, state, payload.baseUpdatedAt);
  const out = {ok:true, updatedAt:res.updatedAt, merged:res.merged, kept:res.kept};
  // Used when the browser hands back work it was holding that never reached
  // the account: it needs the merged result, not just "saved".
  if (payload.returnState) out.state = res.state;
  return out;
}


// Student-side refresh for the Writing Workshop. The browser flushes any
// pending draft first, then asks for the authoritative saved copy so Refresh
// actually updates writing sections instead of repainting stale local state.
function getStudentStateRefresh(payload) {
  const email = currentEmail_();
  if (!email) throw new Error('Not signed in.');
  payload = payload || {};
  const classId = String(payload.classId || '');
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  const work = getStudentWork_(classId, email);
  return {
    ok:true,
    state:work.state,
    stateUpdatedAt:work.updatedAt,
    classSettings:sanitizeClassSettingsForStudent_(parseJson_(klass.settingsJson, defaultClassSettings_())),
    discussion:getClassDiscussion_(classId)
  };
}

function saveClassSettings(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  // Lesson links have their own save (saveLessonLink), which checks them; they
  // are never taken from here.
  const incoming = Object.assign({}, payload.settings || {});
  delete incoming.lessonLinks;
  // Read-modify-write of one small row, under the lock, re-reading inside it, so
  // this and saveLessonLink can never undo each other.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = db_().getSheetByName('CLASSES');
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const rowIndex = values.findIndex((r,i) => i>0 && r[headers.indexOf('classId')] === classId);
    if (rowIndex < 1) throw new Error('Class not found.');
    const existing = parseJson_(values[rowIndex][headers.indexOf('settingsJson')], {});
    const settings = Object.assign(defaultClassSettings_(), existing, incoming);
    settings.releasedEssayStages = essayReleaseStagesFromSettings_(settings);
    sh.getRange(rowIndex+1, headers.indexOf('settingsJson')+1).setValue(JSON.stringify(settings));
    sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
    return {ok:true, settings};
  } finally {
    lock.releaseLock();
  }
}

// ---- A lesson link for an essay stage (the Introduction's Nearpod lesson) ----
// Each teacher launches their own copy of the lesson, so the link belongs to the
// class, not to the app. Accepts the student link Nearpod gives (https only) or
// its 5-letter join code; an empty value removes it.
const LESSON_LINK_STAGES_ = ['thesis','discussion','body','intro','conclusion','assemble','self'];
function lessonLinkFrom_(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  if (/^[A-Za-z]{5}$/.test(v)) return {code: v.toUpperCase()};
  if (v.length <= 500 && /^https:\/\/[^\s"'<>]+$/i.test(v)) return {url: v};
  throw new Error('Paste the student link Nearpod gives you (it starts with https://) or the 5-letter code.');
}
function lessonLinksForStudent_(links) {
  const out = {};
  Object.keys(links || {}).forEach(function(k){
    const l = links[k] || {};
    if (LESSON_LINK_STAGES_.indexOf(k) === -1) return;
    if (l.code && /^[A-Z]{5}$/.test(String(l.code))) out[k] = {code: String(l.code)};
    else if (l.url && /^https:\/\//i.test(String(l.url))) out[k] = {url: String(l.url)};
  });
  return out;
}
function saveLessonLink(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const stage = String(payload.stage || '');
  if (LESSON_LINK_STAGES_.indexOf(stage) === -1) throw new Error('Unknown essay step: ' + stage);
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const link = lessonLinkFrom_(payload.value);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = db_().getSheetByName('CLASSES');
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const rowIndex = values.findIndex((r,i) => i>0 && r[headers.indexOf('classId')] === classId);
    if (rowIndex < 1) throw new Error('Class not found.');
    // Change ONLY the lesson link. The stored settings are otherwise written back
    // exactly as they were -- no defaults merged in, which on an older class
    // could quietly close essay stages for students.
    const settings = parseJson_(values[rowIndex][headers.indexOf('settingsJson')], {}) || {};
    settings.lessonLinks = Object.assign({}, settings.lessonLinks || {});
    if (link) settings.lessonLinks[stage] = Object.assign(link, {updatedAt: new Date().toISOString()});
    else delete settings.lessonLinks[stage];
    const json = JSON.stringify(settings);
    sh.getRange(rowIndex+1, headers.indexOf('settingsJson')+1).setValue(json);
    sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
    return {ok:true, lessonLinks: settings.lessonLinks, settingsJson: json};
  } finally {
    lock.releaseLock();
  }
}

function updateClass(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const sh = db_().getSheetByName('CLASSES');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rowIndex = values.findIndex((r,i) => i>0 && r[headers.indexOf('classId')] === classId);
  if (rowIndex < 1) throw new Error('Class not found.');
  if (payload.className !== undefined) {
    const className = String(payload.className || '').trim();
    if (!className) throw new Error('Class name cannot be blank.');
    sh.getRange(rowIndex+1, headers.indexOf('className')+1).setValue(className);
  }
  if (payload.period !== undefined) {
    sh.getRange(rowIndex+1, headers.indexOf('period')+1).setValue(String(payload.period || '').trim());
  }
  sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
  return {ok:true};
}

function archiveClass(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const sh = db_().getSheetByName('CLASSES');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rowIndex = values.findIndex((r,i) => i>0 && r[headers.indexOf('classId')] === classId);
  if (rowIndex < 1) throw new Error('Class not found.');
  sh.getRange(rowIndex+1, headers.indexOf('active')+1).setValue(false);
  sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
  return {ok:true};
}

function getClassDashboard(payload) {
  const me = requireTeacher_();
  const classId = typeof payload === 'string' ? payload : String((payload||{}).classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(r => r.classId === classId);
  const allGrades = sheetObjects_('GRADES').filter(g => g.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  // Read once for the whole class rather than once per student inside the loop.
  const postsBy = discussPostsByEmail_(classId);
  return {
    ok:true,
    classInfo: publicClass_(klass),
    settings: parseJson_(klass.settingsJson, defaultClassSettings_()),
    students: students.map(s => {
      const work = works.find(w => norm_(w.studentEmail) === norm_(s.studentEmail));
      const st = work ? parseJson_(work.stateJson,{}) : {};
      const gradeMap = {};
      allGrades.filter(g => norm_(g.studentEmail) === norm_(s.studentEmail)).forEach(g => { gradeMap[g.act] = {score:Number(g.score), comment:g.comment||'', gradedAt:g.gradedAt}; });
      const itemsForStudent = allItems.filter(g => norm_(g.studentEmail) === norm_(s.studentEmail));
      const gradeSummary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent, {posts: postsBy[norm_(s.studentEmail)] || []});
      return Object.assign({email:s.studentEmail,name:s.studentName,joinedAt:s.joinedAt,updatedAt:work ? work.updatedAt : '',grades:gradeMap,gradeSummary:gradeSummary}, progressSummary_(st));
    })
  };
}

function getStudentWork(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const studentEmail = String(payload.studentEmail || '').trim();
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const work = sheetObjects_('WORK').find(w => w.classId === classId && norm_(w.studentEmail) === norm_(studentEmail));
  const enrollment = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(studentEmail));
  const st = work ? parseJson_(work.stateJson,{}) : {};
  const posts = discussPostsByEmail_(classId)[norm_(studentEmail)] || [];
  return {ok:true, student:{email:studentEmail,name:enrollment ? enrollment.studentName : displayNameFromEmail_(studentEmail)}, state:st, updatedAt:work ? work.updatedAt : '', grades:getStudentGrades_(classId, studentEmail), gradeSummary:gradeSummaryForStudent_(classId, studentEmail, st, null, {posts:posts})};
}

// ---- Written-response grading (1-7 rubric, one score per Act) ----

function saveActGrade(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const studentEmail = String(payload.studentEmail || '').trim();
  const act = Number(payload.act);
  const score = Number(payload.score);
  const comment = String(payload.comment || '').trim();
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  if (!(act >= 1 && act <= 5)) throw new Error('Act must be between 1 and 5.');
  if (!(score >= 1 && score <= 7)) throw new Error('Score must be between 1 and 7.');
  const enrollment = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(studentEmail));
  if (!enrollment) throw new Error('That student is not enrolled in this class.');
  upsertGrade_(classId, studentEmail, enrollment.studentName, act, score, comment, me.email);
  return {ok:true, grade:{act, score, comment, gradedBy:me.email, gradedAt:new Date().toISOString()}};
}

// ---- Per-question grading (MC auto-scored + DOK 1-7, each excludable) ----

// The four kinds of row GRADEITEMS holds. Anything else is rejected outright
// rather than written, because a typo'd itemType would create a row that
// nothing ever reads and no total would ever notice was missing.
function gradeItemType_(v) {
  const t = String(v || '');
  return (t === 'mc' || t === 'dok' || t === 'essay' || t === 'essayRubric') ? t : '';
}
function validateGradeItemKey_(itemType, itemKey) {
  if (!itemType) throw new Error('Item type must be "mc", "dok", "essay" or "essayRubric".');
  if (itemType === 'mc' || itemType === 'dok') {
    if (!SCENE_META[itemKey]) throw new Error('Unknown scene: ' + itemKey);
    return;
  }
  if (itemType === 'essay') {
    if (ESSAY_STEP_KEYS.indexOf(itemKey) === -1) throw new Error('Unknown essay step: ' + itemKey);
    return;
  }
  if (ESSAY_CRITERIA.indexOf(itemKey) === -1 && LEGACY_ESSAY_CRITERIA.indexOf(itemKey) === -1) throw new Error('Unknown essay rubric criterion: ' + itemKey);
}
function gradeItemLabel_(itemType, itemKey) {
  if (itemType === 'essay') return ESSAY_STEP_LABELS[itemKey] || itemKey;
  if (itemType === 'essayRubric') return itemKey;
  return itemKey;
}

function setGradeItem(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const studentEmail = String(payload.studentEmail || '').trim();
  const itemType = gradeItemType_(payload.itemType);
  const itemKey = String(payload.itemKey || '');
  const excluded = !!payload.excluded;
  const comment = String(payload.comment || '').trim();
  let score = (payload.score === null || payload.score === undefined || payload.score === '') ? null : Number(payload.score);
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  validateGradeItemKey_(itemType, itemKey);
  if (itemType === 'dok' && !excluded && score !== null && !(score >= 1 && score <= 7)) throw new Error('DOK score must be between 1 and 7.');
  if ((itemType === 'essay' || itemType === 'essayRubric') && !excluded && score !== null) {
    const max = itemType === 'essayRubric' ? ESSAY_CRITERION_MAX : essayStepPoints_(itemKey);
    if (!(score >= 0 && score <= max)) throw new Error(gradeItemLabel_(itemType, itemKey) + ' must be scored between 0 and ' + max + '.');
  }
  if (itemType === 'mc') score = null; // MC score always comes from the student's own saved answers, never teacher-entered
  const enrollment = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(studentEmail));
  if (!enrollment) throw new Error('That student is not enrolled in this class.');
  // Snapshot what the response says right now, so a later rewrite is detectable.
  // Re-saving a mark refreshes this, which is what clears an "edited" flag.
  // Written work can be rewritten after it is marked -- in the essay as much as
  // in a scene response -- so the essay steps get the same fingerprint.
  let markedText = '';
  if (itemType === 'dok' || itemType === 'essay' || itemType === 'essayRubric') {
    const work = sheetObjects_('WORK').find(w => w.classId === classId && norm_(w.studentEmail) === norm_(studentEmail));
    const st = work ? parseJson_(work.stateJson, {}) : {};
    if (itemType === 'dok') {
      markedText = respFingerprint_((st.dok || {})[itemKey] || (st.dok || {})[keyOf_(itemKey)] || '');
    } else {
      const posts = itemKey === 'discussion' ? (discussPostsByEmail_(classId)[norm_(studentEmail)] || []) : null;
      markedText = respFingerprint_(essayTextFor_(st, itemType === 'essayRubric' ? ESSAY_FINAL_KEY : itemKey, posts));
    }
    // The essay marking screens send back the fingerprint of the version they
    // showed. Store that one: if the student replied or rewrote since the
    // screen loaded, the grade belongs to the version the teacher read, and the
    // newer one stays flagged as a resubmission.
    const seen = String(payload.seenFp || '');
    if (itemType !== 'dok' && /^fp:(empty|\d+:[0-9a-f]{10})$/.test(seen)) markedText = seen;
  }
  upsertGradeItem_(classId, studentEmail, enrollment.studentName, itemType, itemKey, score, excluded, comment, me.email, markedText);

  // Essay grading can happen before a student explicitly submits a stage.
  // Return the freshly recomputed summary so the teacher's open gradebook can
  // replace its stale in-memory copy immediately instead of waiting for a full
  // dashboard refresh. Submission remains a separate fact from the teacher mark.
  if (itemType === 'essay' || itemType === 'essayRubric') {
    const workNow = sheetObjects_('WORK').find(function(w){ return w.classId === classId && norm_(w.studentEmail) === norm_(studentEmail); });
    const stateNow = workNow ? parseJson_(workNow.stateJson, {}) : {};
    const postsNow = discussPostsByEmail_(classId)[norm_(studentEmail)] || [];
    return {
      ok: true,
      gradeSummary: gradeSummaryForStudent_(classId, studentEmail, stateNow, null, {posts: postsNow})
    };
  }
  return {ok:true};
}

// Excludes (or re-includes) work for EVERY enrolled student at once -- for
// something that turned out to be flawed or unfair for the whole class, or that
// simply was not assessed this time round. Done as a single sheet read plus
// batched writes, because calling setGradeItem once per student would mean one
// lock + one full sheet read each time.
//
// Takes either ONE item -- {itemType, itemKey} -- or a whole Act, {act: 3},
// which is every scene in it, multiple choice and written response alike. An
// Act excluded this way is worth nothing and drops out of the unit; the scores
// already entered are deliberately left in place, so counting it again brings
// them all back rather than starting over.
function setGradeItemForClass(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const excluded = !!payload.excluded;
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');

  // The set of (itemType, itemKey) pairs this call covers.
  let pairs, label;
  if (payload.act !== undefined && payload.act !== '' && payload.act !== null) {
    const act = Number(payload.act);
    if (!(act >= 1 && act <= 5)) throw new Error('Act must be between 1 and 5.');
    const scenes = Object.keys(SCENE_META).filter(function(k){ return SCENE_META[k].act === act; });
    pairs = [];
    scenes.forEach(function(k){ pairs.push(['mc', k]); pairs.push(['dok', k]); });
    label = 'Act ' + act;
  } else if (payload.essayFinal === true) {
    // The finished essay is four rubric criteria per student. Leaving it out of
    // the grade means all four, in the same single pass an Act uses.
    pairs = ESSAY_CRITERIA.map(function(c){ return ['essayRubric', c]; });
    label = 'Final Essay';
  } else {
    const itemType = gradeItemType_(payload.itemType);
    const itemKey = String(payload.itemKey || '');
    validateGradeItemKey_(itemType, itemKey);
    pairs = [[itemType, itemKey]];
    label = gradeItemLabel_(itemType, itemKey);
  }

  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  if (!students.length) throw new Error('No students are enrolled in this class yet.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ensureSheet_(db_(), 'GRADEITEMS', SHEETS.GRADEITEMS);
    const vals = sh.getDataRange().getValues();
    const h = vals[0];
    const c = {};
    SHEETS.GRADEITEMS.forEach(function(k){ c[k] = h.indexOf(k); });
    const now = new Date().toISOString();

    // One pass over the sheet for ALL the pairs, not one pass each -- an Act is
    // 14 to 16 pairs, and re-reading GRADEITEMS that many times is how a click
    // turns into a timeout on a class with real data in it.
    const rowFor = {};   // "type|key|email" -> row index
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (r[c.classId] !== classId) continue;
      rowFor[keyOf_(r[c.itemType]) + '|' + keyOf_(r[c.itemKey]) + '|' + norm_(r[c.studentEmail])] = i;
    }

    const appends = [];
    let updated = 0;
    pairs.forEach(function(p) {
      students.forEach(function(s) {
        const k = keyOf_(p[0]) + '|' + keyOf_(p[1]) + '|' + norm_(s.studentEmail);
        if (rowFor[k] !== undefined) {
          const i = rowFor[k];
          if (c.excluded >= 0) vals[i][c.excluded] = excluded;   // score and comment deliberately preserved
          if (c.gradedBy >= 0) vals[i][c.gradedBy] = me.email;
          if (c.gradedAt >= 0) vals[i][c.gradedAt] = now;
          updated++;
        } else {
          appends.push(rowFromObject_(h, {
            classId: classId, studentEmail: s.studentEmail, studentName: s.studentName,
            itemType: p[0], itemKey: p[1], score: '', excluded: excluded,
            comment: '', gradedBy: me.email, gradedAt: now
          }));
        }
      });
    });

    if (vals.length > 1) sh.getRange(1, 1, vals.length, h.length).setValues(vals);
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, h.length).setValues(appends);
    return {ok:true, excluded:excluded, label:label, items:pairs.length, updated:updated, created:appends.length};
  } finally {
    lock.releaseLock();
  }
}

// Batch-grading support: every enrolled student's written response (and any
// existing score/exclude/comment) for ONE scene, so a teacher can grade a
// whole class's answer to the same question in one pass instead of opening
// each student individually. Deliberately scoped to a single scene rather
// than returning full state for every student -- that keeps the payload
// small even for a large class, and lets the client cache per-scene the same
// way it already caches per-class dashboards.
// The student app records which characters of a written response arrived by
// paste (see attachDokBox in AppLogic). Those ranges index the RAW stored text,
// while the marking view displays it trimmed, so every offset shifts by the
// leading whitespace that trimming removes.
function pasteMetaFor_(st, sceneKey, rawText, trimmedText){
  const all = (st && st.dokMeta) || {};
  const m = all[sceneKey] || all[keyOf_(sceneKey)] || null;
  if (!m) return null;
  const time = writingTimeOf_(m);
  if (!Array.isArray(m.spans) || !m.spans.length) {
    return time.timed ? {spans:[], pasted:0, quoted:0, total:String(trimmedText).length, events:Number(m.events || 0), time:time} : null;
  }
  const lead = String(rawText).length - String(rawText).replace(/^\s+/, '').length;
  const len = String(trimmedText).length;
  const spans = [];
  let pasted = 0, quoted = 0;
  m.spans.slice(0, 200).forEach(function(sp){
    if (!sp || sp.length < 2) return;
    const a = Math.max(0, Number(sp[0]) - lead);
    const b = Math.min(len, Number(sp[1]) - lead);
    if (!(b > a)) return;
    const kind = sp[2] === 'q' ? 'q' : 'p';
    spans.push([a, b, kind]);
    if (kind === 'q') quoted += b - a; else pasted += b - a;
  });
  if (!spans.length && !time.timed) return null;
  return {spans:spans, pasted:pasted, quoted:quoted, total:len, events:Number(m.events || 0), time:time};
}

function getSceneResponses(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const sceneKey = String(payload.sceneKey || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  if (!SCENE_META[sceneKey]) throw new Error('Unknown scene: ' + sceneKey);
  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(r => r.classId === classId);
  const items = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId && keyOf_(g.itemType) === 'dok' && keyOf_(g.itemKey) === keyOf_(sceneKey));
  return {
    ok: true,
    sceneKey: sceneKey,
    responses: students.map(s => {
      const work = works.find(w => norm_(w.studentEmail) === norm_(s.studentEmail));
      const st = work ? parseJson_(work.stateJson, {}) : {};
      const dokText = String((st.dok || {})[sceneKey] || '').trim();
      const paste = pasteMetaFor_(st, sceneKey, String((st.dok || {})[sceneKey] || ''), dokText);
      const item = lastMatch_(items, function(g){ return norm_(g.studentEmail) === norm_(s.studentEmail); });
      const score = item && item.score !== '' && item.score !== null && item.score !== undefined ? Number(item.score) : null;
      return {
        email: s.studentEmail,
        name: s.studentName,
        dokText: dokText,
        paste: paste,
        // The student rewrote this after it was marked. Nothing in the app used
        // to stop them, so the score could be attached to text that no longer
        // existed -- and nothing said so.
        editedAfterGrading: !!(item && editedSinceMarked_(markedBaseline_(item), (st.dok || {})[sceneKey] || '')),
        markedBlank: !!(item && markedBlank_(item)),
        gradedAt: item ? (item.gradedAt || '') : '',
        updatedAt: work ? work.updatedAt : '',
        score: score,
        excluded: item ? truthy_(item.excluded) : false,
        comment: item ? (item.comment || '') : '',
      };
    })
  };
}

// The same idea as getSceneResponses, for the essay: every enrolled student's
// work on ONE step, so the class can be marked in a single pass. stepKey is one
// of ESSAY_STEP_KEYS, or 'final' for the finished essay -- which comes back with
// all four rubric criteria at once, because a teacher reads the essay once and
// then scores the four final criteria together.

// Essay writing-process metadata. The browser stores only character-origin
// ranges and paste-event counts; no clipboard history or keystroke log is kept.
// "q" = pasted from Macbeth/evidence, "p" = other paste, "u" = text that
// existed before process tracking was introduced.
// Writing time for one box, as the student's browser recorded it (see
// writingClockTick_ in AppLogic). A box that has never been timed reports
// timed:false rather than zero -- "not measured" and "no time" are different.
function writingTimeOf_(m){
  if (!m || typeof m.activeMs !== 'number') return {timed:false, activeMs:0, sessions:0, untimedChars:0};
  return {timed:true, activeMs:Math.max(0, Number(m.activeMs) || 0), sessions:Math.max(0, Number(m.sessions) || 0),
          untimedChars:Math.max(0, Number(m.untimedChars) || 0)};
}
function essayProcessMetaFor_(e, slot, index, rawText, trimmedText){
  e = e && typeof e === 'object' ? e : {};
  const wm = e.writingMeta && typeof e.writingMeta === 'object' ? e.writingMeta : {};
  let m = null;
  if (slot === 'bodies') m = Array.isArray(wm.bodies) ? wm.bodies[index] : null;
  else m = wm[slot] || null;
  const raw = String(rawText || '');
  const text = String(trimmedText || '');
  const lead = raw.length - raw.replace(/^\s+/, '').length;
  const len = text.length;
  const spans = [];
  let pasted = 0, quoted = 0, unknown = 0;
  if (m && Array.isArray(m.spans)) {
    m.spans.slice(0, 1000).forEach(function(sp){
      if (!sp || sp.length < 2) return;
      const a = Math.max(0, Number(sp[0]) - lead);
      const b = Math.min(len, Number(sp[1]) - lead);
      if (!(b > a)) return;
      const kind = sp[2] === 'q' ? 'q' : sp[2] === 'p' ? 'p' : sp[2] === 'u' ? 'u' : 't';
      if (kind === 't') return;
      spans.push([a,b,kind]);
      if (kind === 'q') quoted += b-a;
      else if (kind === 'p') pasted += b-a;
      else if (kind === 'u') unknown += b-a;
    });
  }
  // If this build has never seen this box, all existing text predates tracking.
  // That is materially different from "typed" and should be reported as such.
  if (!m && len) unknown = len;
  const events = Number((m && m.events) || 0);
  const outsideEvents = Number((m && m.outsideEvents) || 0);
  const sourceEvents = Number((m && m.sourceEvents) || 0);
  return {
    spans:spans, pasted:pasted, quoted:quoted, unknown:unknown, total:len,
    typed:Math.max(0, len-pasted-quoted-unknown), events:events,
    outsideEvents:outsideEvents, sourceEvents:sourceEvents,
    trackingStartedAt:m && m.trackingStartedAt ? String(m.trackingStartedAt) : '',
    time:writingTimeOf_(m)
  };
}
function essayProcessAggregate_(parts){
  const out = {pasted:0,quoted:0,unknown:0,total:0,typed:0,events:0,outsideEvents:0,sourceEvents:0,
               time:{timed:false, activeMs:0, sessions:0, untimedChars:0}};
  (parts || []).forEach(function(p){
    if (!p) return;
    // Time adds up across the boxes that were timed. A box holding text that
    // was never timed makes the total a lower bound, counted as untimed text.
    const t = p.time || {};
    if (t.timed) {
      out.time.timed = true;
      out.time.activeMs += Number(t.activeMs || 0);
      out.time.sessions += Number(t.sessions || 0);
      out.time.untimedChars += Number(t.untimedChars || 0);
    } else if (Number(p.total || 0) > 0) {
      out.time.untimedChars += Number(p.total || 0);
    }
    out.pasted += Number(p.pasted || 0);
    out.quoted += Number(p.quoted || 0);
    out.unknown += Number(p.unknown || 0);
    out.total += Number(p.total || 0);
    out.typed += Number(p.typed || 0);
    out.events += Number(p.events || 0);
    out.outsideEvents += Number(p.outsideEvents || 0);
    out.sourceEvents += Number(p.sourceEvents || 0);
  });
  return out;
}
function wordCount_(text){
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).filter(function(w){ return w; }).length : 0;
}
function essayProcessBundle_(e){
  e = e && typeof e === 'object' ? e : {};
  const bodyTexts = essayBodies_(e).map(function(b){ return String(b || ''); });
  const bodyProcesses = bodyTexts.map(function(raw, i){ return essayProcessMetaFor_(e, 'bodies', i, raw, raw.trim()); });
  const rebuttalRaw = String(e.rebuttal || '');
  const introRaw = String(e.intro || '');
  const conclusionRaw = String(e.conclusion || '');
  const thesisRaw = String(e.thesis || '');
  return {
    thesis:essayProcessMetaFor_(e,'thesis',0,thesisRaw,thesisRaw.trim()),
    bodies:bodyProcesses,
    rebuttal:essayProcessMetaFor_(e,'rebuttal',0,rebuttalRaw,rebuttalRaw.trim()),
    intro:essayProcessMetaFor_(e,'intro',0,introRaw,introRaw.trim()),
    conclusion:essayProcessMetaFor_(e,'conclusion',0,conclusionRaw,conclusionRaw.trim())
  };
}

function getEssayResponses(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const stepKey = String(payload.stepKey || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const isFinal = stepKey === ESSAY_FINAL_KEY;
  if (!isFinal && ESSAY_STEP_KEYS.indexOf(stepKey) === -1) throw new Error('Unknown essay step: ' + stepKey);

  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(r => r.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  const postsBy = discussPostsByEmail_(classId);

  return {
    ok: true,
    stepKey: stepKey,
    label: isFinal ? 'Final Essay' : ESSAY_STEP_LABELS[stepKey],
    pointsPossible: isFinal ? essayFinalPoints_() : essayStepPoints_(stepKey),
    responses: students.map(function(s){
      const work = works.find(function(w){ return norm_(w.studentEmail) === norm_(s.studentEmail); });
      const st = work ? parseJson_(work.stateJson, {}) : {};
      const posts = postsBy[norm_(s.studentEmail)] || [];
      const itemsForStudent = allItems.filter(function(g){ return norm_(g.studentEmail) === norm_(s.studentEmail); });
      const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent, {posts:posts});
      const essay = essayOf_(st);
      const processBundle = essayProcessBundle_(essay);
      const rawText = essayTextFor_(st, isFinal ? ESSAY_FINAL_KEY : stepKey, posts);
      const base = {
        email: s.studentEmail,
        name: s.studentName,
        updatedAt: work ? work.updatedAt : '',
        text: rawText.trim(),
        // The fingerprint of exactly the version this screen shows. Saving a
        // score sends it back (seenFp), so a reply or rewrite that lands while
        // the teacher is still reading down the list stays flagged instead of
        // being absorbed into the grade unseen.
        fp: respFingerprint_(rawText)
      };
      base.words = wordCount_(base.text);
      if (isFinal) {
        base.criteria = summary.essay.criteria;
        base.finalTotal = summary.essay.finalTotal;
        // Final-process totals aggregate the boxes that actually make up the
        // essay; discussion replies and self-evaluation are intentionally not
        // mixed into the authorship signal.
        base.process = essayProcessAggregate_([processBundle.intro].concat(processBundle.bodies).concat([processBundle.rebuttal, processBundle.conclusion]));
        return base;
      }
      const rec = summary.essay.steps[stepKey];
      base.score = rec.score;
      base.teacherScore = rec.teacherScore;
      base.auto = rec.auto;
      base.excluded = rec.excluded;
      base.comment = rec.comment;
      base.gradedAt = rec.gradedAt;
      base.editedAfterGrading = rec.editedAfterGrading;
      // 26c computed this but never sent it, so the "marked while blank" wording
      // on the essay screens could not appear.
      base.markedBlank = rec.markedBlank;
      base.submitted = rec.submitted;
      if (stepKey === 'thesis') base.process = processBundle.thesis;
      if (stepKey === 'discussion') {
        const drow = lastMatch_(itemsForStudent, function(g){ return keyOf_(g.itemType) === 'essay' && keyOf_(g.itemKey) === 'discussion'; });
        const unseen = rec.editedAfterGrading && drow ? discussionUnseen_(posts, markedBaseline_(drow), rec.gradedAt) : {replies: 0, thesis: false, flags: []};
        base.posts = posts.map(function(p, i){
          return {text:p.text, date:p.date, kind:p.kind || 'post', isNew: !!unseen.flags[i]};
        });
        base.newSince = {replies: unseen.replies, thesis: unseen.thesis};
        // The discussion post is the student's thesis mirrored into the class
        // thread, so show the thesis box's process data rather than pretending
        // the server-side post itself was independently typed.
        base.process = processBundle.thesis;
      }
      if (stepKey === 'body') {
        base.bodies = essayBodies_(essay).map(function(b){ return String(b || ''); });
        base.bodyProcesses = processBundle.bodies;
        base.rebuttal = String(essay.rebuttal || '');
        base.rebuttalProcess = processBundle.rebuttal;
        base.process = essayProcessAggregate_(processBundle.bodies.concat([processBundle.rebuttal]));
        base.thesis = String(essay.thesis || '');
      }
      if (stepKey === 'intro') { base.thesis = String(essay.thesis || ''); base.process = processBundle.intro; }
      if (stepKey === 'conclusion') { base.thesis = String(essay.thesis || ''); base.process = processBundle.conclusion; }
      return base;
    })
  };
}

// Scores a multiple-choice attempt the same way AppLogic.html's answerInfo()
// scores it for the student on screen: full credit on the first try, half
// credit on the second, 0 after two wrong tries, null if not attempted yet.
function mcScoreFor_(raw, correctIdx) {
  const picks = Array.isArray(raw) ? raw : (raw !== undefined && raw !== null ? [raw] : []);
  if (!picks.length) return null;
  const correct = picks.indexOf(correctIdx) !== -1;
  if (correct) return picks[0] === correctIdx ? 1 : 0.5;
  return picks.length >= 2 ? 0 : null;
}

// ---- The essay, as the grader sees it --------------------------------------
// What counts as "the work" for each step. The body step deliberately includes
// the counterargument paragraph: it lives inside that step in the app, it is
// optional, and it is marked as part of the same rubric score.
function essayOf_(state) {
  const e = (state || {}).essay;
  return e && typeof e === 'object' ? e : {};
}
function essayBodies_(e) { return Array.isArray(e.bodies) ? e.bodies : []; }

// posts: this student's discussion posts, oldest first (may be undefined --
// callers that grade the discussion pass them in; the rest do not pay for the
// sheet read).
function essayTextFor_(state, key, posts) {
  const e = essayOf_(state);
  if (key === 'thesis') return String(e.thesis || '');
  if (key === 'intro') return String(e.intro || '');
  if (key === 'conclusion') return String(e.conclusion || '');
  if (key === 'body') {
    const parts = essayBodies_(e).map(function(b){ return String(b || ''); });
    if (String(e.rebuttal || '').trim()) parts.push(String(e.rebuttal));
    return parts.join('\n\n');
  }
  if (key === 'discussion') return (posts || []).map(function(p){ return String(p.text || ''); }).join('\n\n');
  if (key === ESSAY_FINAL_KEY) return essayAssembledText_(e);
  return '';
}

// The finished essay in reading order: introduction, every body paragraph, the
// counterargument if there is one, then the conclusion. Same order the student's
// own "Put It Together" screen uses, so the teacher reads what the student sees.
function essayAssembledText_(e) {
  const parts = [String(e.intro || '')]
    .concat(essayBodies_(e).map(function(b){ return String(b || ''); }));
  if (String(e.rebuttal || '').trim()) parts.push(String(e.rebuttal));
  parts.push(String(e.conclusion || ''));
  return parts.filter(function(x){ return x.trim(); }).join('\n\n');
}


// ---- Explicit essay submissions -------------------------------------------
// Autosave protects drafts; it does NOT mean the student has submitted them.
// Each submission stores a tiny signature of the exact current version. If the
// student revises later, the signature stops matching and the draft leaves the
// Ready to Grade queue until they submit again.
function essaySubmissionSig_(text) {
  const t = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return t.length + ':' + h.toString(16);
}
function essayDiscussionPostText_(state, posts) {
  const list = Array.isArray(posts) ? posts.filter(function(p){ return !p.kind || p.kind === 'post'; }) : [];
  if (list.length) return String(list[list.length - 1].text || '').trim();
  const e = essayOf_(state);
  const local = Array.isArray(e.discussion) ? e.discussion : [];
  return local.length ? String(local[local.length - 1].text || '').trim() : '';
}
function essaySubmissionTextFor_(state, key, posts) {
  const e = essayOf_(state);
  if (key === 'discussion') return essayDiscussionPostText_(state, posts);
  if (key === 'body') {
    const parts = essayBodies_(e).map(function(b){ return String(b || '').trim(); });
    if (String(e.rebuttal || '').trim()) parts.push(String(e.rebuttal || '').trim());
    return parts.join('\n\n').trim();
  }
  if (key === ESSAY_FINAL_KEY) {
    const parts = [e.intro].concat(essayBodies_(e));
    if (String(e.rebuttal || '').trim()) parts.push(e.rebuttal);
    parts.push(e.conclusion);
    return parts.map(function(x){ return String(x || '').trim(); }).filter(Boolean).join('\n\n');
  }
  return String(essayTextFor_(state, key, posts) || '').trim();
}
function essaySubmissionStatus_(state, key, posts) {
  const e = essayOf_(state);
  const subs = e.submissions && typeof e.submissions === 'object' ? e.submissions : {};
  const rec = subs[key] || {};
  const text = essaySubmissionTextFor_(state, key, posts);
  const sig = essaySubmissionSig_(text);
  const signed = !!(rec && rec.sig && text && String(rec.sig) === sig);
  if (key === 'discussion') {
    // Posting IS handing in. A thesis post and every reply are public the
    // moment they are made, so there is no private draft to protect and nothing
    // to wait for: any post or reply in the class discussion counts as
    // submitted. (Before 2026-09-26e this waited for a Submit button on the
    // Discussion stage that no student ever pressed, so posts never reached
    // Ready to Grade and new replies after a grade were never flagged.)
    const act = discussionActivity_(state, posts);
    return {
      submitted: signed || act.any,
      submittedAt: act.lastAt || (rec && rec.submittedAt ? String(rec.submittedAt) : ''),
      sig: sig,
      text: text
    };
  }
  return {
    submitted: signed,
    submittedAt: rec && rec.submittedAt ? String(rec.submittedAt) : '',
    sig: sig,
    text: text
  };
}
// Has this student put anything in the class discussion -- a thesis post or a
// reply? Uses the server's posts when the caller read them; otherwise the
// student's own copy of their posts in their saved state.
function discussionActivity_(state, posts) {
  const local = essayOf_(state).discussion;
  const list = (Array.isArray(posts) ? posts : (Array.isArray(local) ? local : []))
    .filter(function(p){ return p && String(p.text || '').trim(); });
  let lastAt = '';
  list.forEach(function(p){ const d = String(p.date || ''); if (d > lastAt) lastAt = d; });
  return {any: list.length > 0, lastAt: lastAt};
}
// Which of a graded student's discussion posts the teacher hasn't seen. The
// fingerprint already decided THAT something changed; this only says WHAT.
// First the stored fingerprint is tried as a prefix: when a student has only
// added replies, the graded version is exactly their first k posts, so
// everything after k is new -- including a reply that landed while the teacher
// was reading down the list. An updated thesis moves that post, so otherwise
// fall back to the server's own timestamps: anything dated after the grade.
function timeOf_(v) {
  if (v instanceof Date) return v.getTime();
  const t = new Date(String(v || '')).getTime();
  return isNaN(t) ? 0 : t;
}
function discussionUnseen_(posts, baseline, gradedAt) {
  const list = posts || [];
  const flags = list.map(function(){ return false; });
  const g = timeOf_(gradedAt);
  let found = false;
  const stored = typeof baseline === 'string' ? baseline.trim() : '';
  if (stored) {
    for (let k = list.length - 1; k >= 0 && !found; k--) {
      const core = respFingerprintCore_(list.slice(0, k).map(function(p){ return String(p.text || ''); }).join('\n\n'));
      const fp = core ? 'fp:' + core : BLANK_FINGERPRINT_;
      if (stored === fp || (core && stored === core)) {
        for (let i = k; i < list.length; i++) flags[i] = true;
        found = true;
      }
    }
  }
  if (!found) {
    if (g) list.forEach(function(p, i){ if (timeOf_(p.date) > g) flags[i] = true; });
  }
  // A new thesis post is 'posted' when the graded version had none, and
  // 'updated' when it replaced one the teacher had read. With a prefix match the
  // graded posts are all still there unchanged, so a new thesis there is a first
  // one; by timestamps, it is an update if the post already existed at grading.
  const out = {replies: 0, thesis: false, flags: flags};
  list.forEach(function(p, i){
    if (!flags[i]) return;
    if (p.kind === 'reply') { out.replies++; return; }
    const created = timeOf_(p.created);
    out.thesis = found ? 'posted' : (!created || created <= g ? 'updated' : 'posted');
  });
  return out;
}

// Every student's discussion posts for one class, keyed by lowercased email --
// read once and passed down, rather than once per student inside a loop.
function discussPostsByEmail_(classId) {
  const out = {};
  const latestPost = {};
  function add_(email, text, date, kind, created) {
    const k = norm_(email);
    (out[k] = out[k] || []).push({text:text, date:date, kind:kind, created:created});
  }
  // Older versions allowed multiple thesis posts. For grading, count only the
  // student's newest thesis text; replies still all count as discussion work.
  sheetObjects_('DISCUSS').forEach(function(r){
    if (r.classId !== classId) return;
    const k = norm_(r.studentEmail);
    const when = String(r.updatedAt || r.createdAt || '');
    if (!latestPost[k] || when >= latestPost[k].when) latestPost[k] = {row:r, when:when};
  });
  Object.keys(latestPost).forEach(function(k){
    const r = latestPost[k].row;
    add_(r.studentEmail, r.text, r.updatedAt || r.createdAt, 'post', r.createdAt);
  });
  const replySheet = db_().getSheetByName('DISCUSS_REPLIES');
  if (replySheet && replySheet.getLastRow() >= 2) {
    sheetObjects_('DISCUSS_REPLIES').forEach(function(r){
      if (r.classId !== classId) return;
      add_(r.studentEmail, 'Reply to a classmate: ' + String(r.text || ''), r.createdAt, 'reply');
    });
  }
  Object.keys(out).forEach(function(k){
    out[k].sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
  });
  return out;
}

// Combines a student's own MC answers (from their saved state) with
// teacher-entered DOK scores and either type's "exclude from grade" flag
// into one authoritative set of per-scene and per-Act totals. Mirrors the
// client-side optimistic recompute in BackendClient.html so the numbers a
// teacher sees while grading match what getClassDashboard/CSV export show.
// itemsOverride lets callers that already fetched the whole GRADEITEMS
// sheet (e.g. getClassDashboard, once for all students) skip refetching it
// per student.
function gradeSummaryForStudent_(classId, email, state, itemsOverride, opts) {
  state = state || {};
  opts = opts || {};
  const answers = state.answers || {};
  const items = itemsOverride || getStudentGradeItems_(classId, email);
  const itemFor = (type, key) => lastMatch_(items, function(g){ return keyOf_(g.itemType) === keyOf_(type) && keyOf_(g.itemKey) === keyOf_(key); });
  const dokText = state.dok || {};
  const scenes = {};
  const acts = {};
  [1,2,3,4,5].forEach(a => {
    acts[a] = {earned:0,possible:0,mcEarned:0,mcPossible:0,dokEarned:0,dokPossible:0,complete:true,
               mcUnanswered:0,dokUnmarked:0,dokMissing:0,pendingPoints:0,touched:false};
  });
  Object.keys(SCENE_META).forEach(key => {
    const meta = SCENE_META[key];
    const act = acts[meta.act];
    const mcRow = itemFor('mc', key);
    const mcExcluded = !!(mcRow && truthy_(mcRow.excluded));
    const mcScore = mcScoreFor_(answers[key], meta.correctIdx);
    const mcEarned = mcScore === 1 ? MC_POINTS : mcScore === 0.5 ? MC_POINTS / 2 : 0;
    const dokRow = itemFor('dok', key);
    const dokExcluded = !!(dokRow && truthy_(dokRow.excluded));
    const dokScore = dokRow && dokRow.score !== '' && dokRow.score !== null && dokRow.score !== undefined ? Number(dokRow.score) : null;
    const dokSubmitted = String(dokText[key] || dokText[keyOf_(key)] || '').trim().length > 0;
    scenes[key] = {
      mc: {score:mcScore, excluded:mcExcluded, possible:MC_POINTS},
      dok: {score:dokExcluded ? null : dokScore, excluded:dokExcluded, possible:DOK_POINTS, submitted:dokSubmitted,
            editedAfterGrading: !!(dokRow && editedSinceMarked_(markedBaseline_(dokRow), dokText[key] || dokText[keyOf_(key)] || '')),
            comment:dokRow ? (dokRow.comment || '') : '', gradedAt:dokRow ? dokRow.gradedAt : '', gradedBy:dokRow ? dokRow.gradedBy : ''}
    };
    if (mcScore !== null || dokSubmitted || dokScore !== null) act.touched = true;

    // An Act is worth its FULL point value. A question the student never
    // answered scores zero -- it does not quietly shrink the denominator, which
    // is what used to let a half-finished Act read as 100%. The only thing that
    // lowers the total is an exclusion, individual or class-wide.
    if (!mcExcluded) {
      act.mcPossible += MC_POINTS;
      act.mcEarned += mcEarned;
      if (mcScore === null) { act.mcUnanswered++; act.complete = false; }
    }
    if (!dokExcluded) {
      act.dokPossible += DOK_POINTS;
      act.dokEarned += dokScore === null ? 0 : dokScore;
      if (dokScore === null) {
        act.complete = false;
        // Written but not yet marked is a teacher to-do; never written is a
        // student zero. Both currently count as zero, so the difference is
        // reported rather than hidden.
        if (dokSubmitted) { act.dokUnmarked++; act.pendingPoints += DOK_POINTS; }
        else act.dokMissing++;
      }
    }
  });
  Object.keys(acts).forEach(a => {
    const act = acts[a];
    act.earned = act.mcEarned + act.dokEarned;
    act.possible = act.mcPossible + act.dokPossible;
  });
  return {scenes, acts, essay: essaySummary_(state, itemFor, opts.posts)};
}

// The essay half of a student's grade summary: one record per step, one per
// rubric criterion, and totals for each. Same shape and the same rules as the
// Act totals above -- a step the student never wrote counts as zero rather than
// shrinking the denominator, and only an exclusion lowers what it is out of.
function essaySummary_(state, itemFor, posts) {
  const e = essayOf_(state);
  const steps = {}, stepsTotal = {earned:0, possible:0, unmarked:0, missing:0, pendingPoints:0, touched:false, complete:true};
  ESSAY_STEP_KEYS.forEach(function(key){
    const row = itemFor('essay', key);
    const excluded = !!(row && truthy_(row.excluded));
    const points = essayStepPoints_(key);
    const text = essayTextFor_(state, key, posts);
    const submitState = essaySubmissionStatus_(state, key, posts);
    const submitted = submitState.submitted;
    const raw = row && row.score !== '' && row.score !== null && row.score !== undefined ? Number(row.score) : null;
    // The thesis is a completion mark. The teacher can still override it, but
    // if they have not, a drafted thesis is simply complete -- there is nothing
    // to read a rubric against, and making them tick 25 boxes to say "yes, they
    // wrote one" would be work the app can do for them.
    let score = raw, auto = false;
    if (key === 'thesis' && !excluded && raw === null && submitted) { score = ESSAY_THESIS_POINTS; auto = true; }
    if (submitted || raw !== null) stepsTotal.touched = true;
    steps[key] = {
      key: key,
      label: ESSAY_STEP_LABELS[key],
      score: excluded ? null : score,
      teacherScore: raw,
      auto: auto,
      excluded: excluded,
      possible: points,
      submitted: submitted,
      submittedAt: submitState.submittedAt,
      draft: !!String(text || '').trim() && !submitted,
      // A teacher may intentionally grade the autosaved draft even when the
      // student never clicked Submit. The teacher score is authoritative for
      // the Macbeth gradebook and for the next Canvas push; submission status
      // stays separate so we never claim the student submitted when they did not.
      teacherGradedDraft: raw !== null && !submitted,
      editedAfterGrading: !!(row && editedSinceMarked_(markedBaseline_(row), text)),
      markedBlank: !!(row && markedBlank_(row)),
      comment: row ? (row.comment || '') : '',
      gradedAt: row ? row.gradedAt : '',
      gradedBy: row ? row.gradedBy : ''
    };
    if (!excluded) {
      stepsTotal.possible += points;
      stepsTotal.earned += score === null ? 0 : score;
      if (score === null) {
        stepsTotal.complete = false;
        if (submitted) { stepsTotal.unmarked++; stepsTotal.pendingPoints += points; }
        else stepsTotal.missing++;
      }
    }
  });

  // The finished essay, on the four-criterion rubric. Where the teacher has not
  // scored a criterion yet, the student's own self-evaluation is shown as a
  // SUGGESTION (pending) -- visible while marking, never counted.
  const selfEval = e.selfEval || {};
  const selfComments = e.selfComments || {};
  function selfValue_(criterion) {
    if (selfEval[criterion] !== undefined && selfEval[criterion] !== '') return selfEval[criterion];
    const legacy = LEGACY_SELF_CRITERION[criterion];
    return legacy && selfEval[legacy] !== undefined ? selfEval[legacy] : '';
  }
  function selfComment_(criterion) {
    if (selfComments[criterion]) return selfComments[criterion];
    const legacy = LEGACY_SELF_CRITERION[criterion];
    return legacy ? (selfComments[legacy] || '') : '';
  }
  const criteria = {};
  const finalText = essayAssembledText_(e);
  const finalSubmitState = essaySubmissionStatus_(state, ESSAY_FINAL_KEY, posts);
  const finalSubmitted = finalSubmitState.submitted;
  const finalTotal = {earned:0, possible:0, pending:0, unmarked:0, hasAnyResult:false, submitted:finalSubmitted, submittedAt:finalSubmitState.submittedAt, draft:!!finalText.trim() && !finalSubmitted, teacherGradedDraft:false, complete:true};
  ESSAY_CRITERIA.forEach(function(c){
    const row = itemFor('essayRubric', c);
    const excluded = !!(row && truthy_(row.excluded));
    const teacherScore = row && row.score !== '' && row.score !== null && row.score !== undefined ? Number(row.score) : null;
    let display = teacherScore, pending = false;
    if (!excluded && display === null) {
      const idx = selfValue_(c);
      if (idx !== undefined && idx !== '' && ESSAY_CRITERION_POINTS[Number(idx)] !== undefined) {
        display = ESSAY_CRITERION_POINTS[Number(idx)];
        pending = true;
      }
    }
    criteria[c] = {
      key: c,
      score: excluded ? null : display,
      teacherScore: teacherScore,
      pending: pending,
      selfEvalIdx: selfValue_(c),
      selfComment: selfComment_(c),
      excluded: excluded,
      possible: ESSAY_CRITERION_MAX,
      comment: row ? (row.comment || '') : '',
      gradedAt: row ? row.gradedAt : '',
      gradedBy: row ? row.gradedBy : ''
    };
    if (!excluded) {
      finalTotal.possible += ESSAY_CRITERION_MAX;
      if (teacherScore !== null) { finalTotal.earned += teacherScore; finalTotal.hasAnyResult = true; if (!finalSubmitted) finalTotal.teacherGradedDraft = true; }
      else {
        finalTotal.complete = false;
        if (pending) finalTotal.pending++;
        if (finalSubmitted) finalTotal.unmarked++;
      }
    }
  });
  const editedFinal = ESSAY_CRITERIA.some(function(c){
    const row = itemFor('essayRubric', c);
    return !!(row && editedSinceMarked_(markedBaseline_(row), finalText));
  });
  finalTotal.editedAfterGrading = editedFinal;
  return {
    steps: steps,
    stepsTotal: stepsTotal,
    criteria: criteria,
    finalTotal: finalTotal,
    total: {
      earned: stepsTotal.earned + finalTotal.earned,
      possible: stepsTotal.possible + finalTotal.possible,
      touched: stepsTotal.touched || finalSubmitted || finalTotal.hasAnyResult
    }
  };
}

// ---- The Grading Hub's counts ----------------------------------------------
// One number per assignment: how many students are waiting on the teacher. That
// is the only thing the dashboard tiles need, and it is deliberately NOT part of
// getClassDashboard -- the dashboard is per-student rows and this is per-
// assignment totals, they are wanted at different moments, and loading them
// together would make every grading click refetch both.
//
// "Needs grading" means submitted AND not yet handled, where handled is a score
// OR an exclusion. A student who has written nothing is not on the teacher's
// to-do list; a student whose work is excused is not either.
function getGradingHubSummary(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');

  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(r => r.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  const postsBy = discussPostsByEmail_(classId);
  const stateFor = {};
  students.forEach(function(s){
    const w = works.find(function(x){ return norm_(x.studentEmail) === norm_(s.studentEmail); });
    stateFor[norm_(s.studentEmail)] = w ? parseJson_(w.stateJson, {}) : {};
  });
  const itemRow = function(type, key, email) {
    return lastMatch_(allItems, function(g){
      return keyOf_(g.itemType) === keyOf_(type) && keyOf_(g.itemKey) === keyOf_(key) && norm_(g.studentEmail) === norm_(email);
    });
  };
  const handled_ = function(row) {
    return !!row && (truthy_(row.excluded) || (row.score !== '' && row.score !== null && row.score !== undefined));
  };
  const excludedForAll_ = function(pairs) {
    if (!students.length) return false;
    return pairs.every(function(p){
      return students.every(function(s){
        const row = itemRow(p[0], p[1], s.studentEmail);
        return !!row && truthy_(row.excluded);
      });
    });
  };

  // ---- the five Acts ----
  const acts = [1,2,3,4,5].map(function(act){
    const scenes = Object.keys(SCENE_META).filter(function(k){ return SCENE_META[k].act === act; }).sort(sceneSortKey_);
    let submitted = 0, graded = 0, needsGrading = 0, needsRegrade = 0, mcAnswered = 0, mcPossible = 0;
    let firstRedo = '', firstNew = '';
    scenes.forEach(function(key){
      students.forEach(function(stu){
        const st = stateFor[norm_(stu.studentEmail)] || {};
        const rawText = String((st.dok || {})[key] || (st.dok || {})[keyOf_(key)] || '');
        const text = rawText.trim();
        const row = itemRow('dok', key, stu.studentEmail);
        const isHandled = handled_(row);
        const hasTeacherScore = !!(row && row.score !== '' && row.score !== null && row.score !== undefined && !truthy_(row.excluded));
        const isRedo = !!(text && hasTeacherScore && editedSinceMarked_(markedBaseline_(row), rawText));
        if (text) submitted++;
        // A prior score does not count as current/finished once the student has
        // rewritten that response. It returns to the teacher's to-do list.
        if (isHandled && !isRedo) graded++;
        if (isRedo) {
          needsGrading++;
          needsRegrade++;
          if (!firstRedo) firstRedo = key;
        } else if (text && !isHandled) {
          needsGrading++;
          if (!firstNew) firstNew = key;
        }
        const mcRow = itemRow('mc', key, stu.studentEmail);
        if (!(mcRow && truthy_(mcRow.excluded))) {
          mcPossible++;
          if (mcScoreFor_((st.answers || {})[key], SCENE_META[key].correctIdx) !== null) mcAnswered++;
        }
      });
    });
    let pointsPossible = 0, pointsError = '';
    try { pointsPossible = actPointsPossibleForClass_(act, allItems, students); }
    catch (e) { pointsError = e.message; }
    return {
      kind: 'act', key: String(act), act: act,
      label: 'Act ' + act,
      scenes: scenes.length,
      submitted: submitted, graded: graded, needsGrading: needsGrading, needsRegrade: needsRegrade,
      // Every scene's written response is one item, so the ceiling for both
      // counts is scenes x students -- shown as "12/25 marked", not a bare number.
      totalItems: scenes.length * students.length,
      mcAnswered: mcAnswered, mcPossible: mcPossible,
      // A redo outranks a first-time submission when the teacher opens the Act.
      firstToMark: firstRedo || firstNew || scenes[0] || '',
      pointsPossible: pointsPossible, pointsError: pointsError,
      allExcluded: excludedForAll_(scenes.map(function(k){ return ['dok', k]; })),
      released: (parseJson_(klass.settingsJson, {}).releasedActs || []).indexOf(act) !== -1
    };
  });

  // ---- the six essay pieces ----
  const essay = ESSAY_STEP_KEYS.map(function(key){
    let submitted = 0, graded = 0, needsGrading = 0, needsRegrade = 0;
    students.forEach(function(stu){
      const st = stateFor[norm_(stu.studentEmail)] || {};
      const posts = postsBy[norm_(stu.studentEmail)] || [];
      const text = essayTextFor_(st, key, posts).trim();
      const submitState = essaySubmissionStatus_(st, key, posts);
      const row = itemRow('essay', key, stu.studentEmail);
      let isHandled = handled_(row);
      // The thesis is completion-only, but only after the student explicitly
      // submits the current thesis version.
      if (key === 'thesis' && submitState.submitted && !isHandled) isHandled = true;
      const hasTeacherScore = !!(row && row.score !== '' && row.score !== null && row.score !== undefined && !truthy_(row.excluded));
      // Essay revisions only become teacher work again when the student submits
      // that revised version. Autosaved changes remain a private draft until then.
      const isRedo = !!(submitState.submitted && text && hasTeacherScore && editedSinceMarked_(markedBaseline_(row), text));
      if (submitState.submitted) submitted++;
      if (isHandled && !isRedo) graded++;
      if (isRedo) {
        needsGrading++;
        needsRegrade++;
      } else if (submitState.submitted && !isHandled) {
        needsGrading++;
      }
    });
    return {
      kind: 'essay', key: key, label: ESSAY_STEP_LABELS[key],
      submitted: submitted, graded: graded, needsGrading: needsGrading, needsRegrade: needsRegrade,
      totalItems: students.length,
      pointsPossible: essayStepPoints_(key),
      gradingType: key === 'thesis' ? 'pass_fail' : 'points',
      allExcluded: excludedForAll_([['essay', key]])
    };
  });

  // The finished essay is four items per student; it is only off the to-do list
  // once all four are handled, because a half-scored essay still needs you.
  let fSubmitted = 0, fGraded = 0, fNeeds = 0, fRegrade = 0;
  students.forEach(function(stu){
    const st = stateFor[norm_(stu.studentEmail)] || {};
    const text = essayAssembledText_(essayOf_(st)).trim();
    const submitState = essaySubmissionStatus_(st, ESSAY_FINAL_KEY, postsBy[norm_(stu.studentEmail)] || []);
    const criterionRows = ESSAY_CRITERIA.map(function(c){ return itemRow('essayRubric', c, stu.studentEmail); });
    const done = criterionRows.every(function(row){ return handled_(row); });
    const isRedo = !!(submitState.submitted && text && criterionRows.some(function(row){
      const scored = row && row.score !== '' && row.score !== null && row.score !== undefined && !truthy_(row.excluded);
      return scored && editedSinceMarked_(markedBaseline_(row), text);
    }));
    if (submitState.submitted) fSubmitted++;
    if (done && !isRedo) fGraded++;
    if (isRedo) { fNeeds++; fRegrade++; }
    else if (submitState.submitted && !done) fNeeds++;
  });
  essay.push({
    kind: 'essay', key: ESSAY_FINAL_KEY, label: 'Final Essay',
    submitted: fSubmitted, graded: fGraded, needsGrading: fNeeds, needsRegrade: fRegrade,
    totalItems: students.length,
    pointsPossible: essayFinalPoints_(),
    gradingType: 'points',
    allExcluded: excludedForAll_(ESSAY_CRITERIA.map(function(c){ return ['essayRubric', c]; }))
  });

  const needsGradingTotal = acts.reduce(function(n, a){ return n + (a.allExcluded ? 0 : a.needsGrading); }, 0) +
                            essay.reduce(function(n, e){ return n + (e.allExcluded ? 0 : e.needsGrading); }, 0);
  const needsRegradeTotal = acts.reduce(function(n, a){ return n + (a.allExcluded ? 0 : (a.needsRegrade || 0)); }, 0) +
                            essay.reduce(function(n, e){ return n + (e.allExcluded ? 0 : (e.needsRegrade || 0)); }, 0);
  return {
    ok: true,
    totalStudents: students.length,
    acts: acts,
    essay: essay,
    needsGradingTotal: needsGradingTotal,
    needsRegradeTotal: needsRegradeTotal,
    needsNewTotal: Math.max(0, needsGradingTotal - needsRegradeTotal)
  };
}

// Scene keys sort as text by default, which puts 1.10 before 1.2. Sort on the
// two numbers instead. (There is no scene past 1.7 today, but the reader's
// scene list is data and this stops a future one from sorting wrong.)
function sceneSortKey_(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  return (pa[0] - pb[0]) || (pa[1] - pb[1]);
}

function getClassGrades(payload) {
  const me = requireTeacher_();
  const classId = typeof payload === 'string' ? payload : String((payload||{}).classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const rows = sheetObjects_('GRADES').filter(g => g.classId === classId);
  const byStudent = {};
  rows.forEach(g => {
    byStudent[g.studentEmail] = byStudent[g.studentEmail] || {};
    byStudent[g.studentEmail][g.act] = {score:Number(g.score), comment:g.comment||'', gradedBy:g.gradedBy, gradedAt:g.gradedAt};
  });
  return {ok:true, grades:byStudent};
}

// ---- Canvas export, as a downloadable CSV ----
// A direct Canvas-API connection (UrlFetchApp) needs a new OAuth scope, and
// that turned out to trigger a Google-side bug rendering the permission
// dialog inside this app's sandboxed iframe on at least one real deployment
// (a known-fragile combination -- see SETUP_BACKEND.md). To sidestep it
// entirely, this exports a CSV the teacher downloads and imports into
// Canvas's own Gradebook "Import" feature -- no external network call from
// this script, so no new permission is ever required. The column layout
// matches the "manual workflow" CSV your Bell Ringer app already produces
// (Student, ID, SIS User ID, SIS Login ID, Section, then the assignment
// column), so it's the same format you've used there before.

// One canonical Act calculation, used by BOTH the CSV download and the direct
// Canvas push. They used to be able to drift; now a change to the rules lands
// in both at once, and a student cannot get one score in the file and a
// different one in the gradebook.

function cleanTeacherComment_(value) { return String(value || '').trim(); }
function actCanvasFeedback_(act, summary) {
  const parts = [];
  Object.keys(SCENE_META).sort(sceneSortKey_).forEach(function(key){
    if (SCENE_META[key].act !== act) return;
    const scene = summary && summary.scenes ? summary.scenes[key] : null;
    const comment = scene && scene.dok ? cleanTeacherComment_(scene.dok.comment) : '';
    if (comment) parts.push('Scene ' + key + ': ' + comment);
  });
  return parts.length ? ('Macbeth Act ' + act + ' feedback\n\n' + parts.join('\n\n')) : '';
}
function essayCanvasFeedback_(stepKey, essay) {
  essay = essay || {};
  if (stepKey === ESSAY_FINAL_KEY) {
    const parts = [];
    ESSAY_CRITERIA.forEach(function(c){
      const comment = essay.criteria && essay.criteria[c] ? cleanTeacherComment_(essay.criteria[c].comment) : '';
      if (comment) parts.push(c + ': ' + comment);
    });
    return parts.length ? ('Macbeth Final Essay feedback\n\n' + parts.join('\n\n')) : '';
  }
  const rec = essay.steps && essay.steps[stepKey] ? essay.steps[stepKey] : null;
  const comment = rec ? cleanTeacherComment_(rec.comment) : '';
  return comment ? ('Macbeth Essay — ' + (ESSAY_STEP_LABELS[stepKey] || stepKey) + ' feedback\n\n' + comment) : '';
}

function actGradeRows_(classId, act) {
  if (!(act >= 1 && act <= 5)) throw new Error('Act must be between 1 and 5.');
  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(w => w.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  if (!students.length) throw new Error('No students are enrolled in this class yet.');

  // The points this Act is out of: every scene's MC and written response,
  // EXCEPT anything excluded for every enrolled student (a class-wide exclusion).
  const pointsPossible = actPointsPossibleForClass_(act, allItems, students);
  if (!pointsPossible) throw new Error('Every question in Act ' + act + ' is excluded for the whole class, so there is nothing to send.');

  const rows = [], skipped = [], adjusted = [], unmarked = [], excused = [];
  students.forEach(s => {
    const work = works.find(w => norm_(w.studentEmail) === norm_(s.studentEmail));
    const st = work ? parseJson_(work.stateJson, {}) : {};
    const itemsForStudent = allItems.filter(g => norm_(g.studentEmail) === norm_(s.studentEmail));
    const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent);
    const actTotal = summary.acts[act];
    const feedback = actCanvasFeedback_(act, summary);
    const who = s.studentName || s.studentEmail;
    // Every question in this Act is excluded for this student (but not for the
    // whole class). They are EXCUSED, and Canvas is told so rather than left
    // blank, so a score pushed before the exclusion stops counting.
    // (2026-10-18a -- the same rule as Short Story Lab v27.)
    if (actTotal.possible === 0) { excused.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, excused:true, feedback:feedback}); return; }
    // A student who has done nothing in this Act is left BLANK, not zeroed, so
    // sending again later still fills them in and nobody is zeroed for work
    // that isn't due yet. A student who did some of it is scored out of the
    // full Act total, with the parts they skipped counting as zero.
    const hasAnyGrade = actTotal.possible > 0 && actTotal.touched;
    if (!hasAnyGrade) { skipped.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback}); return; }
    if (actTotal.dokUnmarked) unmarked.push(who + ' (' + actTotal.dokUnmarked + ')');

    // A student with an individual exclusion is scored out of a smaller total
    // than the rest of the class, but Canvas holds only one points value per
    // assignment. Scale to the class total so the PERCENTAGE they actually
    // earned is what lands in Canvas -- 30/37 becomes 35.68/44, not 30/44,
    // which would silently penalise them for a question they were excused.
    let value;
    if (actTotal.possible === pointsPossible) {
      value = actTotal.earned;
    } else {
      value = Math.round((actTotal.earned / actTotal.possible) * pointsPossible * 100) / 100;
      adjusted.push(who + ': ' + actTotal.earned + '/' + actTotal.possible + ' \u2192 ' + value + '/' + pointsPossible);
    }
    rows.push({email:s.studentEmail, name:s.studentName, score:value, feedback:feedback});
  });
  return {
    kind: 'act',
    act: act,
    label: 'Macbeth \u2014 Act ' + act,
    gradingType: 'points',
    pointsPossible: pointsPossible,
    rows: rows,
    sent: rows.filter(r => r.score !== null).length,
    skipped: skipped,
    adjusted: adjusted,
    unmarked: unmarked,
    excused: excused
  };
}

// ---- Assignments: an Act, an essay step, or the finished essay -------------
// The Canvas layer below used to speak only in Acts. Now that every essay step
// is its own assignment, everything that used to take `act` takes an assignment
// REFERENCE instead -- {kind:'act', act:2} or {kind:'essay', key:'body'}. The
// old {act:N} payload shape still works, so nothing that already worked breaks.
function assignmentRef_(payload) {
  payload = payload || {};
  if (String(payload.kind || '') === 'essay') {
    const key = String(payload.key || '');
    if (key !== ESSAY_FINAL_KEY && ESSAY_STEP_KEYS.indexOf(key) === -1) throw new Error('Unknown essay step: ' + key);
    return {kind:'essay', key:key};
  }
  const act = Number(payload.act !== undefined && payload.act !== '' ? payload.act : payload.key);
  if (!(act >= 1 && act <= 5)) throw new Error('Act must be between 1 and 5.');
  return {kind:'act', key:String(act), act:act};
}
// The key this assignment's Canvas link is filed under in class settings.
// 'act:2' is the shape already stored for every class that has used Canvas, so
// it must not change; essay steps get their own namespace beside it.
function assignmentSettingsKey_(ref) { return ref.kind === 'act' ? ('act:' + ref.key) : ('essay:' + ref.key); }
function assignmentGradeRows_(classId, ref) {
  return ref.kind === 'act' ? actGradeRows_(classId, ref.act) : essayGradeRows_(classId, ref.key);
}

// The essay equivalent of actGradeRows_ -- one canonical calculation shared by
// the CSV download and the Canvas push, for the same reason: they must not be
// able to drift.
function essayGradeRows_(classId, stepKey) {
  const isFinal = stepKey === ESSAY_FINAL_KEY;
  if (!isFinal && ESSAY_STEP_KEYS.indexOf(stepKey) === -1) throw new Error('Unknown essay step: ' + stepKey);
  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(w => w.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  if (!students.length) throw new Error('No students are enrolled in this class yet.');
  const postsBy = discussPostsByEmail_(classId);
  const label = 'Macbeth Essay — ' + (isFinal ? 'Final Essay' : ESSAY_STEP_LABELS[stepKey]);

  // Excluded for EVERY enrolled student means the whole class is excused, which
  // is the only thing that lowers what an assignment is out of.
  const emails = students.map(s => norm_(s.studentEmail));
  const excludedForAll = function(itemType, itemKey) {
    const set = {};
    allItems.forEach(function(g){
      if (truthy_(g.excluded) && keyOf_(g.itemType) === itemType && keyOf_(g.itemKey) === keyOf_(itemKey)) set[norm_(g.studentEmail)] = true;
    });
    return emails.length ? emails.every(function(e){ return set[e]; }) : false;
  };

  let pointsPossible;
  if (isFinal) {
    pointsPossible = ESSAY_CRITERIA.filter(function(c){ return !excludedForAll('essayRubric', c); }).length * ESSAY_CRITERION_MAX;
  } else {
    pointsPossible = excludedForAll('essay', stepKey) ? 0 : essayStepPoints_(stepKey);
  }
  if (!pointsPossible) throw new Error(label + ' is excluded for the whole class, so there is nothing to send.');

  const rows = [], skipped = [], adjusted = [], unmarked = [], waiting = [], excused = [];
  students.forEach(function(s){
    const work = works.find(function(w){ return norm_(w.studentEmail) === norm_(s.studentEmail); });
    const st = work ? parseJson_(work.stateJson, {}) : {};
    const itemsForStudent = allItems.filter(function(g){ return norm_(g.studentEmail) === norm_(s.studentEmail); });
    const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent, {posts: postsBy[norm_(s.studentEmail)] || []});
    const who = s.studentName || s.studentEmail;
    const essay = summary.essay;
    const feedback = essayCanvasFeedback_(stepKey, essay);

    if (isFinal) {
      const t = essay.finalTotal;
      // Every criterion excluded for this student: excused in Canvas (2026-10-18a).
      if (t.possible === 0) { excused.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, excused:true, feedback:feedback}); return; }
      // Nothing graded yet is left BLANK, not zeroed -- the same rule as an Act.
      if (!t.hasAnyResult) { skipped.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback}); return; }
      if (t.unmarked) unmarked.push(who + ' (' + t.unmarked + ')');
      let value = t.earned;
      if (t.possible !== pointsPossible && t.possible > 0) {
        value = Math.round((t.earned / t.possible) * pointsPossible * 100) / 100;
        adjusted.push(who + ': ' + t.earned + '/' + t.possible + ' → ' + value + '/' + pointsPossible);
      }
      rows.push({email:s.studentEmail, name:s.studentName, score:value, feedback:feedback});
      return;
    }

    const rec = essay.steps[stepKey];
    // Excluded for this one student: there is no honest number to send, so
    // Canvas marks the submission EXCUSED -- it drops out of the student's
    // grade, and any score pushed before the exclusion stops counting.
    // (2026-10-18a. Before this the cell was left blank, which kept an older
    // pushed score counting. Same rule as Short Story Lab v27.)
    if (rec.excluded) { excused.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null, excused:true, feedback:feedback}); return; }
    if (rec.score === null) {
      // Turned in but not marked: nothing is sent, so Canvas keeps it blank.
      // (Before 26e these names were listed both as "nothing done yet" and as
      // "counted as 0", and neither was true.)
      if (rec.submitted) waiting.push(who);
      else skipped.push(who);
      rows.push({email:s.studentEmail, name:s.studentName, score:null, feedback:feedback});
      return;
    }
    rows.push({email:s.studentEmail, name:s.studentName, score:rec.score, feedback:feedback});
  });

  return {
    kind: 'essay',
    stepKey: stepKey,
    label: label,
    // The thesis is a tick, not a score, so Canvas is told to grade it
    // complete/incomplete rather than out of one point.
    gradingType: stepKey === 'thesis' ? 'pass_fail' : 'points',
    pointsPossible: pointsPossible,
    rows: rows,
    sent: rows.filter(function(r){ return r.score !== null; }).length,
    skipped: skipped,
    adjusted: adjusted,
    unmarked: unmarked,
    waiting: waiting,
    excused: excused
  };
}

function exportActGradesCsv(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  // Takes an Act or an essay step -- the same reference the Canvas push takes,
  // so the download and the push can never mean different things.
  const ref = assignmentRef_(payload);

  const data = assignmentGradeRows_(classId, ref);
  if (!data.sent) throw new Error('No students in this class have a grade for ' + data.label + ' yet.');

  const headerTitle = ref.kind === 'act'
    ? ('Macbeth Act ' + ref.act + ' - MC + Written Response')
    : data.label.replace(/\u2014/g, '-');
  const rows = [
    ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', headerTitle],
    ['    Points Possible', '', '', '', '', data.pointsPossible]
  ];
  data.rows.forEach(r => rows.push([r.name, '', '', r.email, '', r.score === null ? '' : r.score]));

  return {
    ok: true,
    filename: csvSafeName_(klass.className + ' - ' + (ref.kind === 'act' ? 'Act ' + ref.act : data.label.replace(/\u2014/g, '-')) + ' Grades') + '.csv',
    content: rows.map(row => row.map(csvCell_).join(',')).join('\n'),
    sent: data.sent,
    skipped: data.skipped,
    pointsPossible: data.pointsPossible,
    adjusted: data.adjusted,
    unmarked: data.unmarked,
    waiting: data.waiting || []
  };
}

// Act maximum for the class as a whole. Starts from every scene in the Act
// (MC + written response) and drops only those pieces excluded for EVERY
// enrolled student, which is what a class-wide exclusion produces.
function actPointsPossibleForClass_(act, allItems, students) {
  const emails = students.map(s => norm_(s.studentEmail));
  const excludedBy = {};   // itemType|itemKey -> set of student emails excluded
  allItems.forEach(g => {
    if (!truthy_(g.excluded)) return;
    const k = keyOf_(g.itemType) + '|' + keyOf_(g.itemKey);
    (excludedBy[k] = excludedBy[k] || {})[norm_(g.studentEmail)] = true;
  });
  const excludedForAll = function(type, key) {
    const set = excludedBy[keyOf_(type) + '|' + keyOf_(key)];
    if (!set || !emails.length) return false;
    return emails.every(e => set[e]);
  };
  let total = 0;
  Object.keys(SCENE_META).forEach(key => {
    if (SCENE_META[key].act !== act) return;
    if (!excludedForAll('mc', key)) total += MC_POINTS;
    if (!excludedForAll('dok', key)) total += DOK_POINTS;
  });
  return total;
}

function csvCell_(value) {
  const s = String(value === null || value === undefined ? '' : value);
  // Prevent spreadsheet apps from treating student-entered text as a formula.
  let out = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + out.replace(/"/g, '""') + '"';
}

function csvSafeName_(value) {
  return String(value || 'Macbeth Grades').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function postThesisDiscussion(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const text = String(payload.text || '').trim();
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  if (!text) throw new Error('Write a thesis before posting.');

  // One persistent thesis post per student. If the student revises their thesis,
  // update the existing row instead of appending a second post. Keeping the same
  // postId is important because classmates' replies are attached to that id.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = db_();
    const sh = ensureSheet_(ss, 'DISCUSS', SHEETS.DISCUSS);
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const classCol = headers.indexOf('classId');
    const emailCol = headers.indexOf('studentEmail');
    const textCol = headers.indexOf('text');
    const updatedCol = headers.indexOf('updatedAt');
    let rowIndex = -1;

    // Use the most recent existing post if an older build already allowed the
    // student to create duplicates. New revisions will keep updating this row.
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][classCol]) === classId && norm_(values[i][emailCol]) === norm_(email)) {
        rowIndex = i;
        break;
      }
    }

    const now = new Date().toISOString();
    if (rowIndex >= 1) {
      sh.getRange(rowIndex + 1, textCol + 1).setValue(text);
      if (updatedCol >= 0) sh.getRange(rowIndex + 1, updatedCol + 1).setValue(now);
    } else {
      const enroll = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(email));
      sh.appendRow([Utilities.getUuid(), classId, email, enroll ? enroll.studentName : displayNameFromEmail_(email), text, now, now]);
    }
  } finally {
    lock.releaseLock();
  }
  return {ok:true, discussion:getClassDiscussion_(classId)};
}

function postThesisReply(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const postId = String(payload.postId || '');
  const text = String(payload.text || '').trim();
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  if (!postId) throw new Error('Choose a thesis post to reply to.');
  if (!text) throw new Error('Write a reply before posting.');
  if (text.length > 3000) throw new Error('Keep your reply under 3,000 characters.');
  const parent = sheetObjects_('DISCUSS').find(function(r){ return r.classId === classId && String(r.postId) === postId; });
  if (!parent) throw new Error('That thesis post could not be found. Refresh the discussion and try again.');
  const enroll = sheetObjects_('ENROLL').find(function(r){ return r.classId === classId && norm_(r.studentEmail) === norm_(email); });
  ensureSheet_(db_(), 'DISCUSS_REPLIES', SHEETS.DISCUSS_REPLIES);
  appendRow_('DISCUSS_REPLIES', [Utilities.getUuid(), classId, postId, email, enroll ? enroll.studentName : displayNameFromEmail_(email), text, new Date().toISOString()]);
  return {ok:true, discussion:getClassDiscussion_(classId)};
}

function getClassDiscussion(payload) {
  const email = currentEmail_();
  const classId = typeof payload === 'string' ? payload : String((payload||{}).classId || '');
  const role = roleFor_(email);
  if (role === 'student' && !isEnrolled_(classId,email)) throw new Error('You are not enrolled in this class.');
  if ((role === 'teacher' || role === 'admin')) {
    const klass = getClass_(classId);
    if (!klass || (role !== 'admin' && norm_(klass.teacherEmail)!==norm_(email))) throw new Error('You do not manage this class.');
  }
  return getClassDiscussion_(classId);
}

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
  return sheetObjects_('USERS').filter(u => u.role === 'teacher' || u.role === 'admin').map(u => ({email:u.email,name:u.name,role:u.role,status:u.status,updatedAt:u.updatedAt}));
}

function getTeacherClasses_(email, all) {
  return sheetObjects_('CLASSES').filter(r => truthy_(r.active) && (all || norm_(r.teacherEmail)===norm_(email))).map(publicClass_);
}
function getStudentClasses_(email) {
  const enrolls = sheetObjects_('ENROLL').filter(r => norm_(r.studentEmail)===norm_(email) && truthy_(r.active));
  const classes = sheetObjects_('CLASSES');
  return enrolls.map(e => classes.find(c=>c.classId===e.classId)).filter(Boolean).map(publicClass_);
}
function publicClass_(r){ return {classId:r.classId,teacherEmail:r.teacherEmail,className:r.className,period:r.period,joinCode:r.joinCode,settingsJson:r.settingsJson,active:truthy_(r.active)}; }

// Writing stages are released independently. `releasedEssayThrough` remains as
// a migration bridge for classes created before per-stage release existed.
const ESSAY_RELEASE_STAGE_IDS_ = ['thesis','discussion','body','intro','conclusion','assemble','self'];
function essayReleaseStagesFromSettings_(s) {
  s = s || {};
  const raw = s.releasedEssayStages;
  if (raw && typeof raw === 'object' && ESSAY_RELEASE_STAGE_IDS_.some(function(id){ return Object.prototype.hasOwnProperty.call(raw,id); })) {
    const out = {};
    ESSAY_RELEASE_STAGE_IDS_.forEach(function(id){ out[id] = raw[id] === true; });
    return out;
  }
  // Old classes used "open through". Missing legacy data means the class
  // predates release controls entirely, so preserve its old all-open behavior.
  let through = String(s.releasedEssayThrough || 'self');
  let last = ESSAY_RELEASE_STAGE_IDS_.indexOf(through);
  if (last < 0) last = ESSAY_RELEASE_STAGE_IDS_.length - 1;
  const out = {};
  ESSAY_RELEASE_STAGE_IDS_.forEach(function(id, i){ out[id] = i <= last; });
  return out;
}
function defaultClassSettings_(){ return {releasedActs:[1],releasedScenes:{},releasedEssayThrough:'thesis',releasedEssayStages:null,teacherResources:true,modernSupport:true,canvas:{courseId:'',courseName:'',assignmentGroupId:'',assignmentGroupName:'',assignments:{}},assignmentSchedule:{}}; }
function sanitizeClassSettingsForStudent_(s){ s=s||{}; return {releasedActs:s.releasedActs||[1],releasedScenes:s.releasedScenes||{},releasedEssayThrough:s.releasedEssayThrough||'self',releasedEssayStages:essayReleaseStagesFromSettings_(s),teacherResources:s.teacherResources!==false,lessonLinks:lessonLinksForStudent_(s.lessonLinks)}; }
function getStudentWork_(classId,email){
  const w=sheetObjects_('WORK').find(r=>r.classId===classId&&norm_(r.studentEmail)===norm_(email));
  return w ? {state:parseJson_(w.stateJson,{}), updatedAt:String(w.updatedAt||'')} : {state:{}, updatedAt:''};
}
function getStudentState_(classId,email){ return getStudentWork_(classId,email).state; }
function getClassDiscussion_(classId){
  ensureSheet_(db_(), 'DISCUSS', SHEETS.DISCUSS);
  const allPosts = sheetObjects_('DISCUSS')
    .filter(function(r){ return r.classId === classId; });

  // Collapse duplicates left behind by older builds into one visible thesis per
  // student. The newest thesis text wins, but replies made to any of that
  // student's older post IDs are preserved and shown under the current thesis.
  const grouped = {};
  allPosts.forEach(function(r){
    const key = norm_(r.studentEmail);
    const bucket = grouped[key] = grouped[key] || {posts:[], postIds:[]};
    bucket.posts.push(r);
    bucket.postIds.push(String(r.postId));
  });

  ensureSheet_(db_(), 'DISCUSS_REPLIES', SHEETS.DISCUSS_REPLIES);
  const repliesByPost = {};
  sheetObjects_('DISCUSS_REPLIES')
    .filter(function(r){ return r.classId === classId; })
    .sort(function(a,b){ return String(a.createdAt).localeCompare(String(b.createdAt)); })
    .forEach(function(r){
      (repliesByPost[String(r.postId)] = repliesByPost[String(r.postId)] || []).push({
        id:r.replyId, name:r.studentName, email:r.studentEmail, text:r.text, date:r.createdAt
      });
    });

  return Object.keys(grouped).map(function(key){
    const bucket = grouped[key];
    bucket.posts.sort(function(a,b){
      return String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || ''));
    });
    const r = bucket.posts[bucket.posts.length - 1];
    let replies = [];
    bucket.postIds.forEach(function(id){ replies = replies.concat(repliesByPost[id] || []); });
    replies.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
    return {
      id:r.postId,
      name:r.studentName,
      email:r.studentEmail,
      text:r.text,
      date:r.createdAt,
      updatedAt:r.updatedAt || '',
      replies:replies
    };
  }).sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
}
function progressSummary_(st){
  st=st||{}; const essay=st.essay||{}; const bodies=essay.bodies||[];
  // Required sections are the introduction, the first three body paragraphs and
  // the conclusion. Extra paragraphs and the optional counterargument are
  // counted separately so writing MORE never looks like progress going down.
  const required=[essay.intro,bodies[0],bodies[1],bodies[2],essay.conclusion];
  const major=required.filter(x=>String(x||'').trim()).length;
  const extras=bodies.slice(3).filter(x=>String(x||'').trim()).length + (String(essay.rebuttal||'').trim()?1:0);
  return {mcAnswered:Object.keys(st.answers||{}).length,dokAnswered:Object.values(st.dok||{}).filter(x=>String(x||'').trim()).length,evidenceCount:(st.evidence||[]).length,activities:Object.values(st.activityResponses||{}).filter(x=>String(x||'').trim()).length,essaySections:major,essayExtras:extras,selfAssessment:Object.keys(essay.selfEval||{}).filter(k=>essay.selfEval[k]!==''&&essay.selfEval[k]!==undefined).length};
}

function requireTeacher_(){ const email=currentEmail_(); const user=getUser_(email); if(!user||user.status!=='active'||(user.role!=='teacher'&&user.role!=='admin')) throw new Error('Teacher access has not been authorized by the curriculum administrator.'); return {email,role:user.role,name:user.name}; }
function requireAdmin_(){ const email=currentEmail_(); const user=getUser_(email); if(!user||user.status!=='active'||user.role!=='admin') throw new Error('Administrator access required.'); return {email,role:user.role,name:user.name}; }
function roleFor_(email){ const u=getUser_(email); return u&&u.status==='active'?u.role:'student'; }
function currentEmail_(){ return String(Session.getActiveUser().getEmail()||'').trim().toLowerCase(); }
function displayNameFromEmail_(email){ const s=String(email||'').split('@')[0].replace(/[._-]+/g,' '); return s.replace(/\b\w/g,c=>c.toUpperCase()); }

// Student names used to fall back to the Google username ("Jsmith1234"), which
// is useless in the marking list. Names are now collected as first + last and
// validated on both sides.
function normalizeStudentName_(first, last, whole){
  var f = String(first || '').trim().replace(/\s+/g, ' ');
  var l = String(last || '').trim().replace(/\s+/g, ' ');
  if (!f && !l) {
    var w = String(whole || '').trim().replace(/\s+/g, ' ');
    var parts = w ? w.split(' ') : [];
    f = parts.shift() || '';
    l = parts.join(' ');
  }
  return {first:f, last:l, full:(f + ' ' + l).trim()};
}
function requireFullName_(first, last, whole){
  var n = normalizeStudentName_(first, last, whole);
  if (!n.first || !n.last) throw new Error('Please enter both your first name and your last name.');
  if (!/[A-Za-z]/.test(n.first) || !/[A-Za-z]/.test(n.last)) throw new Error('Please enter your name using letters.');
  return n.full;
}
// True for a name that came from an email address rather than a student: one
// word, empty, or carrying digits.
function nameLooksIncomplete_(name){
  var s = String(name || '').trim();
  if (!s) return true;
  if (/\d/.test(s)) return true;
  return s.split(/\s+/).filter(function(p){ return /[A-Za-z]/.test(p); }).length < 2;
}
// One student's display name is copied into every tab as work is saved, so a
// correction has to reach all of them or the marking list keeps the old name.
function setStudentNameEverywhere_(email, name){
  var ss = db_();
  ['ENROLL','WORK','DISCUSS','GRADES','GRADEITEMS'].forEach(function(tab){
    var sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getDataRange().getValues();
    var h = vals[0];
    var ei = h.indexOf('studentEmail'), ni = h.indexOf('studentName');
    if (ei < 0 || ni < 0) return;
    var col = [], changed = false;
    for (var i = 1; i < vals.length; i++) {
      var mine = norm_(vals[i][ei]) === norm_(email);
      if (mine && vals[i][ni] !== name) changed = true;
      col.push([mine ? name : vals[i][ni]]);
    }
    if (changed) sh.getRange(2, ni + 1, col.length, 1).setValues(col);
  });
}
function updateMyName(payload){
  const email = currentEmail_();
  if (!email) throw new Error('Sign in with your school Google account first.');
  payload = payload || {};
  const full = requireFullName_(payload.firstName, payload.lastName, payload.name);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { setStudentNameEverywhere_(email, full); } finally { lock.releaseLock(); }
  const u = getUser_(email);
  if (u) upsertUser_(email, full, u.role, u.status);
  return {ok:true, name:full};
}
function norm_(s){ return String(s||'').trim().toLowerCase(); }

// Scene keys look like numbers ("1.1", "5.8"), and Google Sheets stores a
// numeric-looking string as an actual NUMBER. Read back, the cell holds 1.1,
// which never equals the string '1.1' under ===, so a saved grade became
// invisible to every lookup -- the mark was written, then could not be found
// again. Compare item keys as text, which also repairs rows written before
// this fix without touching the stored data.
function keyOf_(v){ return String(v === null || v === undefined ? '' : v).trim(); }

// Fingerprint of a written response: its length plus a short hash, with runs of
// whitespace flattened so a stray space is not treated as a rewrite. Stored on
// the grade row at marking time; if the response no longer matches, the student
// has redone it since.
// The fingerprint is written into a spreadsheet cell, and Google Sheets
// "helpfully" converts anything that looks like a time. The old format --
// length, colon, 10 hex characters -- read as a duration whenever the hex
// happened to be all digits ("449:1291990657" became 449 hours and change), so
// the stored value could never match again and that student's redo flag could
// never be cleared, however many times it was re-marked. The "fp:" prefix
// keeps every fingerprint plain text. Older unprefixed fingerprints are still
// honoured, and one Sheets has already converted is treated as "no baseline"
// -- the same as a response marked before fingerprints existed -- rather than
// as a permanent false alarm.
function respFingerprintCore_(text){
  const t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  if (!t) return '';
  return t.length + ':' + md5Hex_(t).slice(0, 10);
}
// A response marked while it was still BLANK gets a fingerprint of its own,
// so writing it afterwards counts as a resubmission. (It used to store an
// empty fingerprint, which means "no baseline", so a student who filled in a
// box after being given a 1 never came back onto the teacher's list.)
const BLANK_FINGERPRINT_ = 'fp:empty';
function respFingerprint_(text){
  const core = respFingerprintCore_(text);
  return core ? 'fp:' + core : BLANK_FINGERPRINT_;
}
// Rows marked blank BEFORE that change have an empty markedText, which on its
// own can't be told from a row marked before fingerprints existed at all.
// Fingerprints began in this spreadsheet on 2026-09-16, so a row scored since
// then with no fingerprint was scored blank -- and it is only treated that way
// when the score is the "incomplete" mark (1 or less), because nobody gives a
// blank box more than that. Anything else stays "no baseline", as before.
const FINGERPRINTS_SINCE_ = '2026-09-16';
function markedBaseline_(row){
  if (!row) return '';
  const mt = row.markedText;
  if (typeof mt !== 'string') return mt;                       // converted by Sheets -> no baseline
  if (mt.trim()) return mt;
  const scored = row.score !== '' && row.score !== null && row.score !== undefined && !truthy_(row.excluded);
  const at = row.gradedAt instanceof Date ? row.gradedAt.toISOString() : String(row.gradedAt || '');
  if (scored && Number(row.score) <= 1 && at >= FINGERPRINTS_SINCE_) return BLANK_FINGERPRINT_;
  return '';
}
function markedBlank_(row){ return markedBaseline_(row) === BLANK_FINGERPRINT_; }
function editedSinceMarked_(markedText, currentText){
  if (typeof markedText !== 'string') return false;   // empty, or a cell Sheets turned into a date/number
  const stored = markedText.trim();
  if (!stored) return false;              // marked before this was recorded, or nothing to compare
  const core = respFingerprintCore_(currentText);
  if (stored.indexOf('fp:') === 0) return stored !== (core ? 'fp:' + core : BLANK_FINGERPRINT_);
  return stored !== core;                 // an older, unprefixed fingerprint
}

// Where a (class, student, item) has more than one row -- duplicates created
// while the mismatch above stopped upsert from finding the existing row -- the
// most recently written row is the one that counts. Reads and writes both use
// this, so they always agree.
function lastMatch_(list, pred){
  for (var i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i];
  return undefined;
}
function truthy_(v){ return v===true||String(v).toLowerCase()==='true'||String(v)==='1'; }
function parseJson_(s,fallback){ try{return typeof s==='object'&&s!==null?s:JSON.parse(String(s||''));}catch(e){return fallback;} }

function ensureDb_(){ if(!PropertiesService.getScriptProperties().getProperty(MACBETH_DB_PROP)) throw new Error('Backend is not initialized. Run setupMacbethBackend() once from the Apps Script editor.'); }
function db_(){ ensureDb_(); return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(MACBETH_DB_PROP)); }
function ensureSheet_(ss,name,headers){
  let sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);}
  if(sh.getLastRow()===0){sh.appendRow(headers); sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#eee8dc'); sh.setFrozenRows(1); return sh;}
  ensureColumns_(sh,headers);
  return sh;
}
// Adds any column this version expects that an older sheet doesn't have yet.
// APPEND ONLY -- existing columns are never moved or renamed, so data already
// in the sheet cannot shift. (A positional write into a shifted layout is the
// bug that made a whole class's grades unreadable once already.)
function ensureColumns_(sh,headers){
  const width=Math.max(sh.getLastColumn(),1);
  const have=sh.getRange(1,1,1,width).getValues()[0].map(function(v){return String(v).trim();});
  const missing=headers.filter(function(h){return have.indexOf(h)===-1;});
  if(!missing.length) return;
  sh.getRange(1,have.length+1,1,missing.length).setValues([missing]).setFontWeight('bold').setBackground('#eee8dc');
}
function sheetObjects_(name){ const sh=db_().getSheetByName(name); if(!sh||sh.getLastRow()<2)return[]; const vals=sh.getDataRange().getValues(); const h=vals.shift(); const rows=vals.filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]]))); if(name==='WORK'){ const idx=workChunkCols_(h); if(idx.length) rows.forEach(function(o, n){ o.stateJson=joinWorkChunks_(o.stateJson, idx.map(function(c){ return o[h[c]]; })); }); } return rows; }

// ---- Saved work bigger than one spreadsheet cell (added 2026-10-02d) -------
// A Google Sheets cell holds at most 50,000 characters. A student who has done
// the whole unit -- 28 written responses, the evidence bank, the essay and its
// writing-process data -- can need more than that. Before this release such a
// save was REFUSED by Sheets, the browser kept retrying, and the student's
// newest work only lived in that browser (and was thrown away the next time
// the page loaded). Now the saved work is split across stateJson, then
// stateJson2, stateJson3, ... in extra columns at the end of the WORK tab.
// Every continuation cell starts with "~" so Sheets can never mistake a piece
// for a number, date or formula; the "~" is removed when the pieces are joined.
const WORK_CHUNK_SIZE = 45000;
function workChunkCols_(headers){
  const out = [];
  headers.forEach(function(k, i){ const m = /^stateJson(\d+)$/.exec(String(k)); if (m) out.push({n:Number(m[1]), i:i}); });
  return out.sort(function(a,b){ return a.n - b.n; }).map(function(x){ return x.i; });
}
function joinWorkChunks_(first, rest){
  let s = String(first === null || first === undefined ? '' : first);
  (rest || []).forEach(function(v){ v = String(v === null || v === undefined ? '' : v); if (v.charAt(0) === '~') s += v.slice(1); });
  return s;
}
// Saved work that will not open is never simply written over: a raw copy goes
// to the WORK_BACKUP tab first, so whatever is still in it can be recovered.
function backupWorkRow_(classId, email, name, json, updatedAt, why){
  try {
    const ss = db_();
    const sh = ensureSheet_(ss, 'WORK_BACKUP', ['backedUpAt','why','classId','studentEmail','studentName','updatedAt','stateJson']);
    const pieces = [];
    for (let i = 0; i < json.length || i === 0; i += WORK_CHUNK_SIZE) pieces.push((i ? '~' : '') + json.slice(i, i + WORK_CHUNK_SIZE));
    sh.appendRow([new Date().toISOString(), why, classId, email, name, updatedAt].concat(pieces));
  } catch (e) { console.error('backupWorkRow_ failed: ' + e); }
}
function storedWorkJson_(row, h){
  const idx = workChunkCols_(h);
  return joinWorkChunks_(row[h.indexOf('stateJson')], idx.map(function(c){ return row[c]; }));
}
// Write one student's whole saved work into row `rowNum` (1-based sheet row),
// adding continuation columns when needed and clearing any it no longer uses.
function writeWorkJson_(sh, h, rowNum, json){
  const pieces = [];
  for (let i = 0; i < json.length || i === 0; i += WORK_CHUNK_SIZE) pieces.push(json.slice(i, i + WORK_CHUNK_SIZE));
  let idx = workChunkCols_(h);
  for (let n = idx.length + 2; n <= pieces.length; n++) {
    const col = h.length + 1;
    if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
    sh.getRange(1, col).setValue('stateJson' + n);
    h.push('stateJson' + n);
  }
  idx = workChunkCols_(h);
  sh.getRange(rowNum, h.indexOf('stateJson') + 1).setValue(pieces[0]);
  idx.forEach(function(c, k){
    const piece = pieces[k + 1];
    sh.getRange(rowNum, c + 1).setValue(piece ? '~' + piece : '');
  });
}
function appendRow_(name,row){ const lock=LockService.getScriptLock(); lock.waitLock(10000); try{db_().getSheetByName(name).appendRow(row);}finally{lock.releaseLock();} }
function getUser_(email){ return sheetObjects_('USERS').find(r=>norm_(r.email)===norm_(email)); }
function upsertUser_(email,name,role,status){
  const sh=db_().getSheetByName('USERS'); const vals=sh.getDataRange().getValues(); const h=vals[0]; const idxEmail=h.indexOf('email'); const row=vals.findIndex((r,i)=>i>0&&norm_(r[idxEmail])===norm_(email)); const now=new Date().toISOString();
  if(row>0){ sh.getRange(row+1,h.indexOf('name')+1).setValue(name); sh.getRange(row+1,h.indexOf('role')+1).setValue(role); sh.getRange(row+1,h.indexOf('status')+1).setValue(status); sh.getRange(row+1,h.indexOf('updatedAt')+1).setValue(now); }
  else sh.appendRow([email,name,role,status,now,now]);
}
function getClass_(id){ return sheetObjects_('CLASSES').find(r=>r.classId===id); }
function isEnrolled_(classId,email){ return sheetObjects_('ENROLL').some(r=>r.classId===classId&&norm_(r.studentEmail)===norm_(email)&&truthy_(r.active)); }
function ensureStudentWork_(classId,email,name){ if(!sheetObjects_('WORK').some(r=>r.classId===classId&&norm_(r.studentEmail)===norm_(email))) appendRow_('WORK',[classId,email,name,JSON.stringify({}),new Date().toISOString()]); }
// ---- Two copies of the same student's work ---------------------------------
//
// A student leaves the app open on a school laptop, goes home and writes on a
// phone. Tomorrow the laptop wakes up and autosaves -- and the old code wrote
// its whole state blob straight over the top, so the evening's writing was
// gone with no error anywhere. Last write wins is the wrong rule for an essay.
//
// So every save now carries the `updatedAt` of the copy it was built on. If the
// stored copy has moved on since then, the two are MERGED instead of one
// overwriting the other, under one rule: for any piece of writing, the longer
// of the two wins, and anything present in only one of them is kept. A save
// built on the current copy is written exactly as it arrives, so a student
// deleting their own paragraph still works normally.
//
// These keys are navigation and class settings, not work, so the incoming copy
// always wins -- otherwise a merge could yank a student back to whatever page
// the other window happened to be on.
var STATE_TAKE_INCOMING = {'view':1,'navAct':1,'role':1,'className':1,'releasedActs':1,'releasedScenes':1,'teacherResources':1,'discussion':1,'essay.step':1};

function stateValueEmpty_(v){
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
// A multiple-choice answer is an append-only list of ATTEMPTS at one question
// (`state.answers[key] = [...picks, picked]`), not one slot per question.
// Merging it element by element splices two attempt histories together and
// invents an answer nobody gave -- a student who re-answered [0] against a
// stored [1,3] came out with [0,3]. These lists are taken whole: more attempts
// wins.
function atomicArrayPath_(path){
  return /^answers(\.|$)/.test(path);
}
function mergeStudentState_(stored, incoming){
  const kept = [];
  const state = mergeStateNode_(stored, incoming, '', kept);
  keepSubmittedText_(state, [stored, incoming]);
  return {state: state, kept: kept};
}
// "Longer wins" is right for drafts, but it must never break a submission. If
// a step was submitted and one of the copies holds exactly the submitted text,
// that copy's text is used for that step, so the submission still matches
// what is saved and does not fall back to "draft" on the teacher's screen.
// (Before 2026-10-04b, a longer old paragraph from another device could be
// merged into a submitted essay, which then showed as not submitted.)
var SUBMISSION_FIELDS_ = {thesis:['thesis'], body:['bodies','rebuttal'], intro:['intro'], conclusion:['conclusion'], final:['intro','bodies','rebuttal','conclusion']};
function keepSubmittedText_(state, copies){
  const e = essayOf_(state);
  const subs = e.submissions && typeof e.submissions === 'object' ? e.submissions : {};
  ['thesis','body','intro','conclusion','final'].forEach(function(k){
    const rec = subs[k];
    if (!rec || !rec.sig) return;
    if (essaySubmissionSig_(essaySubmissionTextFor_(state, k, [])) === String(rec.sig)) return;
    const match = (copies || []).find(function(c){
      return c && essaySubmissionSig_(essaySubmissionTextFor_(c, k, [])) === String(rec.sig);
    });
    if (!match) return;
    const src = essayOf_(match);
    state.essay = state.essay || {};
    SUBMISSION_FIELDS_[k].forEach(function(f){
      if (src[f] === undefined) delete state.essay[f];
      else state.essay[f] = JSON.parse(JSON.stringify(src[f]));
    });
  });
}
function mergeStateNode_(a, b, path, kept){   // a = what is stored, b = what arrived
  // Writing-time counters only ever grow. A stale window must not wind a
  // student's recorded time back to what it was when that window last saved.
  if (typeof a === 'number' && typeof b === 'number' && /\.(activeMs|sessions|lastInputAt)$/.test(path)){
    if (a > b){ kept.push(path); return a; }
    return b;
  }
  if (b === undefined || b === null){
    if (!stateValueEmpty_(a)){ kept.push(path); return a; }
    return b;
  }
  if (typeof a === 'string' && typeof b === 'string'){
    if (a.trim().length > b.trim().length){ kept.push(path); return a; }
    return b;
  }
  if (Array.isArray(a) && Array.isArray(b)){
    if (atomicArrayPath_(path)){
      if (a.length > b.length){ kept.push(path); return a; }
      return b;
    }
    const out = b.slice();
    for (let i = 0; i < a.length; i++){
      const p = path + '[' + i + ']';
      if (i >= out.length){ if (!stateValueEmpty_(a[i])){ out.push(a[i]); kept.push(p); } }
      else out[i] = mergeStateNode_(a[i], out[i], p, kept);
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)){
    // Submission records are version markers, not prose. On a stale-device
    // merge, keep whichever submission happened later so an old tab cannot
    // silently put an already-submitted stage back into an older state.
    if (/^essay\.submissions\.[^.]+$/.test(path)) {
      const at = Date.parse(String(a.submittedAt || '')) || 0;
      const bt = Date.parse(String(b.submittedAt || '')) || 0;
      if (at > bt) { kept.push(path); return a; }
      return b;
    }
    const out = {};
    Object.keys(b).forEach(function(k){ out[k] = b[k]; });
    Object.keys(a).forEach(function(k){
      const p = path ? path + '.' + k : k;
      if (STATE_TAKE_INCOMING[p]) return;
      if (!(k in out)){ if (!stateValueEmpty_(a[k])){ out[k] = a[k]; kept.push(p); } return; }
      out[k] = mergeStateNode_(a[k], out[k], p, kept);
    });
    return out;
  }
  return b;
}

function upsertWork_(classId,email,name,state,baseUpdatedAt){
  const lock=LockService.getScriptLock(); lock.waitLock(10000); try{
    const sh=db_().getSheetByName("WORK"); const vals=sh.getDataRange().getValues(); const h=vals[0]; const row=vals.findIndex((r,i)=>i>0&&r[h.indexOf("classId")]===classId&&norm_(r[h.indexOf("studentEmail")])===norm_(email)); let now=new Date().toISOString();
    let kept=[];
    if(row>0){
      const storedUpdatedAt = String(vals[row][h.indexOf('updatedAt')]||'');
      // The stamp is what tells one copy of the work from another, so no two
      // saves may ever carry the same one. Two saves inside the same
      // millisecond -- a phone and a laptop firing together, which is exactly
      // the case this is here for -- would otherwise be indistinguishable and
      // the second would sail through as if it were based on the first.
      if (storedUpdatedAt && now <= storedUpdatedAt){
        const t = Date.parse(storedUpdatedAt);
        if (!isNaN(t)) now = new Date(t + 1).toISOString();
      }
      const storedJson = storedWorkJson_(vals[row], h);
      if (storedJson && parseJson_(storedJson, null) === null) backupWorkRow_(classId, email, name, storedJson, storedUpdatedAt, 'unreadable, about to be replaced by a save');
      if (storedUpdatedAt && String(baseUpdatedAt||'') !== storedUpdatedAt){
        const merged = mergeStudentState_(parseJson_(storedWorkJson_(vals[row], h),{}), state);
        state = merged.state; kept = merged.kept;
      }
      sh.getRange(row+1,h.indexOf('studentName')+1).setValue(name); writeWorkJson_(sh, h, row+1, JSON.stringify(state)); sh.getRange(row+1,h.indexOf('updatedAt')+1).setValue(now); }
    else { sh.appendRow([classId,email,name,'',now]); writeWorkJson_(sh, h, sh.getLastRow(), JSON.stringify(state)); }
    return {updatedAt:now, merged:kept.length>0, kept:kept.slice(0,40), state:state};
  } finally { lock.releaseLock(); }
}
function getStudentGrades_(classId,email){
  const rows = sheetObjects_('GRADES').filter(g => g.classId === classId && norm_(g.studentEmail) === norm_(email));
  const out = {};
  rows.forEach(g => { out[g.act] = {score:Number(g.score), comment:g.comment||'', gradedBy:g.gradedBy, gradedAt:g.gradedAt}; });
  return out;
}
function upsertGrade_(classId,email,name,act,score,comment,gradedBy){
  const lock=LockService.getScriptLock(); lock.waitLock(10000); try{
    const ss=db_(); const sh=ensureSheet_(ss,'GRADES',SHEETS.GRADES); const vals=sh.getDataRange().getValues(); const h=vals[0];
    const row=vals.findIndex((r,i)=>i>0&&r[h.indexOf('classId')]===classId&&norm_(r[h.indexOf('studentEmail')])===norm_(email)&&Number(r[h.indexOf('act')])===Number(act));
    const now=new Date().toISOString();
    if(row>0){
      sh.getRange(row+1,h.indexOf('studentName')+1).setValue(name);
      sh.getRange(row+1,h.indexOf('score')+1).setValue(score);
      sh.getRange(row+1,h.indexOf('comment')+1).setValue(comment);
      sh.getRange(row+1,h.indexOf('gradedBy')+1).setValue(gradedBy);
      sh.getRange(row+1,h.indexOf('gradedAt')+1).setValue(now);
    } else sh.appendRow([classId,email,name,act,score,comment,gradedBy,now]);
  } finally { lock.releaseLock(); }
}
function getStudentGradeItems_(classId,email){
  return sheetObjects_('GRADEITEMS').filter(g => g.classId === classId && norm_(g.studentEmail) === norm_(email));
}
// Builds a row that matches the sheet's OWN header order, rather than assuming
// the column order in SHEETS. A GRADEITEMS tab created by an older version of
// this app has a different layout (no studentName column), and writing a fixed
// positional array into it silently shifted every value one column left -- the
// score landed in `excluded`, the scene key landed in `score`. Writing by header
// name makes column order and extra columns irrelevant.
// ---- One-time repair for a GRADEITEMS tab created by an older version ----
//
// An older GRADEITEMS layout has no `studentName` column, so rows written by
// the current code landed one column to the left: the student's name went into
// `itemType`, 'dok' into `itemKey`, the scene key into `score`, and the score
// itself into `excluded`. Run this ONCE from the editor. It copies the tab to a
// timestamped backup first, then rewrites it in the correct layout, repairing
// shifted rows and keeping the most recent grade where a row was duplicated.
// Safe to run more than once -- rows already correct are left as they are.
function migrateGradeItems() {
  const ss = db_();
  const sh = ss.getSheetByName('GRADEITEMS');
  if (!sh) { Logger.log('No GRADEITEMS sheet — nothing to migrate.'); return; }
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) { Logger.log('GRADEITEMS is empty — nothing to migrate.'); return; }

  const backupName = 'GRADEITEMS_BACKUP_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  sh.copyTo(ss).setName(backupName);
  Logger.log('Backup written to tab: ' + backupName);

  const oldHeaders = vals[0].map(function (x) { return String(x).trim(); });
  const at = function (row, col) { const i = oldHeaders.indexOf(col); return i >= 0 ? row[i] : ''; };
  const isItemType = function (v) { const s = keyOf_(v).toLowerCase(); return s === 'mc' || s === 'dok'; };

  let repaired = 0, kept = 0, skipped = 0;
  const records = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (!r.some(function (v) { return v !== '' && v !== null; })) continue;
    let rec;
    if (isItemType(at(r, 'itemType'))) {
      // Row already sits where this sheet's own headers say it should.
      rec = {
        classId: at(r, 'classId'), studentEmail: at(r, 'studentEmail'),
        studentName: at(r, 'studentName'), itemType: keyOf_(at(r, 'itemType')).toLowerCase(),
        itemKey: keyOf_(at(r, 'itemKey')), score: at(r, 'score'), excluded: at(r, 'excluded'),
        comment: at(r, 'comment'), gradedBy: at(r, 'gradedBy') || at(r, 'teacherEmail'),
        gradedAt: at(r, 'gradedAt')
      };
      kept++;
    } else if (isItemType(r[3])) {
      // Shifted row: values follow the CURRENT code's order regardless of headers.
      rec = {
        classId: r[0], studentEmail: r[1], studentName: r[2], itemType: keyOf_(r[3]).toLowerCase(),
        itemKey: keyOf_(r[4]), score: r[5], excluded: r[6], comment: r[7],
        gradedBy: r[8], gradedAt: r[9]
      };
      repaired++;
    } else {
      skipped++;
      continue;
    }
    if (!rec.classId || !rec.studentEmail || !SCENE_META[rec.itemKey]) { skipped++; continue; }
    if (!rec.studentName) {
      const en = sheetObjects_('ENROLL').find(function (e) {
        return e.classId === rec.classId && norm_(e.studentEmail) === norm_(rec.studentEmail);
      });
      rec.studentName = en ? en.studentName : displayNameFromEmail_(rec.studentEmail);
    }
    records.push(rec);
  }

  // Keep the most recent row per (class, student, itemType, itemKey).
  const byKey = {};
  records.forEach(function (rec, idx) {
    const k = rec.classId + '|' + norm_(rec.studentEmail) + '|' + rec.itemType + '|' + rec.itemKey;
    const prev = byKey[k];
    if (!prev || String(rec.gradedAt || '') >= String(prev.rec.gradedAt || '') || idx > prev.idx) {
      byKey[k] = { rec: rec, idx: idx };
    }
  });
  const finalRows = Object.keys(byKey).map(function (k) { return byKey[k].rec; });

  sh.clear();
  sh.appendRow(SHEETS.GRADEITEMS);
  sh.getRange(1, 1, 1, SHEETS.GRADEITEMS.length).setFontWeight('bold').setBackground('#eee8dc');
  sh.setFrozenRows(1);
  if (finalRows.length) {
    const out = finalRows.map(function (rec) { return rowFromObject_(SHEETS.GRADEITEMS, rec); });
    sh.getRange(2, 1, out.length, SHEETS.GRADEITEMS.length).setValues(out);
  }
  Logger.log('rows read: ' + (vals.length - 1) + ' | already correct: ' + kept +
             ' | repaired from shifted: ' + repaired + ' | unrecognised, dropped: ' + skipped);
  Logger.log('rows written after removing duplicates: ' + finalRows.length);
  Logger.log('Done. Original data is preserved in ' + backupName);
}

// Reports any sheet whose columns no longer match what the code expects.
// ---------------------------------------------------------------------------
// checkFiles() -- run this from the Apps Script editor after pasting any file.
//
// A big file pasted into the editor can be silently cut short, and the app then
// fails at load time with a message that names the file but not the reason.
// This compares every file against the size and fingerprint of the version that
// was shipped, so a bad paste is caught in five seconds instead of in front of
// a class. Update FILE_FINGERPRINTS whenever a new set of files is released.
// ---------------------------------------------------------------------------
// Generate `chars` with Node, NOT Python: JS's /^\s+|\s+$/g and Python's
// re.sub(r'\s+$', ...) disagree, and a wrong length makes the DIFFERS message
// quote a number that was never true.
// Two fingerprints per file. `md5` is the exact text; `md5ws` is the text with
// ALL whitespace removed. When md5 differs but md5ws matches, every character
// that isn't a space or a line break is identical -- the editor reflowed the
// paste, which is not worth a re-paste.
var FILE_FINGERPRINTS = {
  release: '2026-10-23e (redesigned pictures)',
  files: {
    Index:         {chars: 37039, md5: 'd91e59c5782e7c958dfe99bf86403f7d', md5ws: '94aafac0e71eb10b56d2c3ff9381251b'},
    Images:        {chars: 453785, md5: 'e5f4a57636ff9141c7db437eb634f93b', md5ws: '5a75ddb3d0bd6bf4de41aef7ccd3e362'},
    PlayData:      {chars: 241404, md5: 'ec7f019c4d9e1b61178d9b826279249b', md5ws: 'e70c572bf8b027504e9b7f354575c5af'},
    AppLogic:      {chars: 154281, md5: 'd6481df3f65f7889a01a48e84200bef9', md5ws: '69222def9f45099506b70d3f46f9a069'},
    BackendClient: {chars: 300852, md5: '2378f2d9ec37327bbd8fea3c618de8d8', md5ws: '301446c165723c313ad088dc0ec2303b'}
  },
  // In this one file, spacing is content: the play text's line breaks are what
  // the reader counts to place Folger line numbers. A spacing-only difference
  // here still needs looking at.
  whitespaceMatters: {PlayData: true}
};

function md5Hex_(text){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function fileFingerprint_(name){
  // Raw file text, with line-ending and surrounding-whitespace differences
  // normalised away so a harmless editor quirk is not reported as damage.
  var raw = HtmlService.createTemplateFromFile(name).getRawContent();
  var text = String(raw).replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
  var flat = text.replace(/\s+/g, '');
  return {chars: text.length, md5: md5Hex_(text), md5ws: md5Hex_(flat)};
}

// ---------------------------------------------------------------------------
// diagnoseMarkingOrder() -- run from the editor when the Grade Written
// Responses list isn't ordered the way you expect.
//
// It prints, for every enrolled student, the three facts the marking list sorts
// on, and the group each one lands in. If this says "Needs grading" for a
// student but the app shows them somewhere else, the app is running older code
// than this file and needs a NEW DEPLOYMENT VERSION, not a new paste.
//
// Change DIAGNOSE_SCENE to look at a different scene.
// ---------------------------------------------------------------------------
var DIAGNOSE_SCENE = '1.1';

function diagnoseMarkingOrder(sceneKey){
  const me = currentEmail_();
  const key = String(sceneKey || DIAGNOSE_SCENE);
  const classes = getTeacherClasses_(me, true).filter(function(c){ return truthy_(c.active); });
  if (!classes.length) { Logger.log('No active classes found for ' + me); return; }
  const klass = classes[0];
  Logger.log('Class: ' + klass.className + '   Scene: ' + key);
  Logger.log('(edit DIAGNOSE_SCENE at the top of this function for another scene)\n');

  const res = getSceneResponses({classId: klass.classId, sceneKey: key});
  const groupOf = function(r){
    if (r.editedAfterGrading && r.dokText) return '1. REDONE since marking';
    if (!r.dokText) return '3. Not submitted yet';
    return (r.excluded || r.score !== null) ? '4. Already graded' : '2. NEEDS GRADING';
  };
  const counts = {};
  res.responses.map(function(r){ return {g: groupOf(r), r: r}; })
    .sort(function(a,b){ return a.g < b.g ? -1 : a.g > b.g ? 1 : String(a.r.name).localeCompare(String(b.r.name)); })
    .forEach(function(x){
      counts[x.g] = (counts[x.g] || 0) + 1;
      Logger.log([
        x.g,
        '| ' + (x.r.name || x.r.email),
        '| wrote ' + (x.r.dokText ? x.r.dokText.length + ' chars' : 'NOTHING'),
        '| score ' + (x.r.score === null ? 'none' : x.r.score),
        '| excluded ' + (x.r.excluded ? 'YES' : 'no'),
        '| redone ' + (x.r.editedAfterGrading ? 'YES' : 'no')
      ].join(' '));
    });
  Logger.log('\nThis is the order the marking list SHOULD show:');
  Object.keys(counts).sort().forEach(function(g){ Logger.log('   ' + g + ': ' + counts[g] + ' student(s)'); });
  Logger.log('\nIf the app shows a different order than this, the deployed web app is');
  Logger.log('running older code. Deploy > Manage deployments > pencil > Version: New version.');
  return counts;
}

function checkFiles(){
  var expected = FILE_FINGERPRINTS.files;
  var names = Object.keys(expected);
  var bad = [];
  Logger.log('Checking against release: ' + FILE_FINGERPRINTS.release);
  names.forEach(function(name){
    var got;
    try { got = fileFingerprint_(name); }
    catch (e) { bad.push(name); Logger.log('MISSING  ' + name + ' -- no file with that name (capitals matter)'); return; }
    var want = expected[name];
    if (got.md5 === want.md5) { Logger.log('OK       ' + name + '  ' + got.chars + ' characters'); return; }
    // Same code, different spacing -- the editor reflowed the paste. Harmless
    // everywhere except PlayData, where line breaks are part of the play text.
    if (want.md5ws && got.md5ws === want.md5ws && !FILE_FINGERPRINTS.whitespaceMatters[name]) {
      Logger.log('OK*      ' + name + '  ' + got.chars + ' characters -- every character except spacing is identical. Nothing to do.');
      return;
    }
    bad.push(name);
    if (want.md5ws && got.md5ws === want.md5ws) {
      Logger.log('SPACING  ' + name + '  the text matches but its line breaks moved. In this file the play text\'s ' +
                 'line breaks drive the line numbers in the reader, so re-paste it.');
      return;
    }
    if (got.chars < want.chars * 0.98) {
      Logger.log('SHORT    ' + name + '  ' + got.chars + ' of ' + want.chars + ' characters (' +
                 Math.round((got.chars / want.chars) * 100) + '%) -- the paste was cut off. Re-paste this file.');
    } else if (got.chars > want.chars * 1.02) {
      Logger.log('TOO BIG  ' + name + '  ' + got.chars + ' of ' + want.chars +
                 ' characters -- this file may hold something extra, or another app\'s code.');
    } else {
      Logger.log('DIFFERS  ' + name + '  right length (' + got.chars + ') but different content -- ' +
                 'either an edit you made on purpose, or the wrong file pasted here.');
    }
  });
  if (!bad.length) Logger.log('\nAll ' + names.length + ' files match. Safe to deploy.');
  else Logger.log('\nRe-paste: ' + bad.join(', ') + '  (fix the first one first)');
  return {ok: !bad.length, problems: bad, release: FILE_FINGERPRINTS.release};
}

function checkSchemas() {
  const ss = db_();
  Object.keys(SHEETS).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) { Logger.log(name + ': MISSING'); return; }
    const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
      .map(function (x) { return String(x).trim(); }).filter(String);
    const want = SHEETS[name];
    const missing = want.filter(function (c) { return have.indexOf(c) < 0; });
    const sameOrder = want.every(function (c, i) { return have[i] === c; });
    Logger.log(name + ': ' + (missing.length ? 'MISSING ' + missing.join(',') : 'all columns present') +
               (sameOrder ? '' : ' | order differs from expected') +
               '\n    actual: ' + have.join(' | '));
  });
}

function rowFromObject_(headers, obj){
  return headers.map(function(h){ return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; });
}

function upsertGradeItem_(classId,email,name,itemType,itemKey,score,excluded,comment,gradedBy,markedText){
  const lock=LockService.getScriptLock(); lock.waitLock(10000); try{
    const ss=db_(); const sh=ensureSheet_(ss,'GRADEITEMS',SHEETS.GRADEITEMS); const vals=sh.getDataRange().getValues(); const h=vals[0];
    const iClass=h.indexOf('classId'), iEmail=h.indexOf('studentEmail'), iType=h.indexOf('itemType'), iKey=h.indexOf('itemKey');
    // Search from the bottom so the newest row for this item is the one updated.
    let row=-1;
    for(let i=vals.length-1;i>0;i--){
      const r=vals[i];
      if(r[iClass]===classId&&norm_(r[iEmail])===norm_(email)&&keyOf_(r[iType])===keyOf_(itemType)&&keyOf_(r[iKey])===keyOf_(itemKey)){ row=i; break; }
    }
    const now=new Date().toISOString();
    const set=function(col,val){ const idx=h.indexOf(col); if(idx>=0) sh.getRange(row+1,idx+1).setValue(val); };
    if(row>0){
      set('studentName',name); set('score',score===null?'':score); set('excluded',excluded);
      set('comment',comment); set('gradedBy',gradedBy); set('gradedAt',now);
      set('markedText',markedText===undefined?'':markedText);
    } else sh.appendRow(rowFromObject_(h,{
      classId:classId, studentEmail:email, studentName:name, itemType:itemType, itemKey:itemKey,
      score:score===null?'':score, excluded:excluded, comment:comment, gradedBy:gradedBy, gradedAt:now,
      markedText:markedText===undefined?'':markedText
    }));
  } finally { lock.releaseLock(); }
}
function uniqueJoinCode_(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const existing=new Set(sheetObjects_('CLASSES').map(r=>String(r.joinCode).toUpperCase())); for(let t=0;t<100;t++){let s='';for(let i=0;i<6;i++)s+=chars[Math.floor(Math.random()*chars.length)];if(!existing.has(s))return s;} return Utilities.getUuid().slice(0,6).toUpperCase(); }

// ===========================================================================
// Canvas: push Act scores straight into a Canvas course.
//
// Ported from the Short Story Lab app, where this is already working in
// production. Two things about it matter more than the code:
//
//  1. The teacher's Canvas token lives in USER properties, not script
//     properties -- it is that teacher's own credential, is never written to
//     the backend spreadsheet, and is never sent to the browser.
//  2. This needs the `script.external_request` OAuth scope. Adding a new scope
//     to an ALREADY-DEPLOYED Apps Script project is exactly what once hung
//     this app on "Loading Macbeth..." forever: the consent dialog renders
//     inside the app's sandboxed iframe and cannot be completed. Authorize it
//     from a plain editor tab FIRST, by running testCanvasSetup() below, and
//     only then deploy. SETUP_BACKEND.md spells out the order.
// ===========================================================================
const CANVAS_BASE_URL_USER_PROP = 'MACBETH_CANVAS_BASE_URL';
const CANVAS_TOKEN_USER_PROP = 'MACBETH_CANVAS_TOKEN';

// Run this ONCE from the Apps Script editor (script.google.com, a normal
// browser tab) after adding the scope and before deploying. It makes a
// harmless outbound request purely to trigger the permission prompt in a
// context where the dialog can actually render.
function testCanvasSetup() {
  const res = UrlFetchApp.fetch('https://www.instructure.com/robots.txt', {muteHttpExceptions:true});
  Logger.log('External requests are authorized. HTTP ' + res.getResponseCode() + '.');
  Logger.log('You can now deploy a new version and connect Canvas from the Teacher Dashboard.');
  const conn = canvasConnection_();
  Logger.log(conn.connected ? 'A Canvas token is already saved for ' + currentEmail_() + '.' : 'No Canvas token saved yet -- connect one in the app.');
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
  const baseUrl = String(p.getProperty(CANVAS_BASE_URL_USER_PROP) || '').trim();
  const token = String(p.getProperty(CANVAS_TOKEN_USER_PROP) || '').trim();
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
  // Never follow a path that would send the token somewhere other than the
  // Canvas host this teacher configured.
  if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected URL.');
  const opt = {
    method: String(method || 'get').toLowerCase(),
    headers: {Authorization:'Bearer ' + conn.token, Accept:'application/json'},
    muteHttpExceptions: true,
    followRedirects: true
  };
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
  const me = requireTeacher_();
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  return {me:me, klass:klass, settings:Object.assign(defaultClassSettings_(), parseJson_(klass.settingsJson, {}))};
}
function saveWholeClassSettings_(classId, settings) {
  const sh = db_().getSheetByName('CLASSES');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rowIndex = values.findIndex(function(r,i){ return i>0 && r[headers.indexOf('classId')] === classId; });
  if (rowIndex < 1) throw new Error('Class not found.');
  sh.getRange(rowIndex+1, headers.indexOf('settingsJson')+1).setValue(JSON.stringify(settings));
  sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
}

function saveCanvasConnection(payload) {
  requireTeacher_();
  payload = payload || {};
  const existing = canvasConnection_();
  const baseUrl = normalizeCanvasBaseUrl_(payload.baseUrl || existing.baseUrl);
  const token = String(payload.token || existing.token || '').trim();
  if (!token) throw new Error('Paste a Canvas access token. It is stored privately against your own Google account.');
  // Prove the token works before saving it, so a typo fails here rather than
  // halfway through a grade push.
  const profile = canvasRequestWith_({baseUrl:baseUrl, token:token}, 'get', '/api/v1/users/self/profile');
  const p = PropertiesService.getUserProperties();
  p.setProperty(CANVAS_BASE_URL_USER_PROP, baseUrl);
  p.setProperty(CANVAS_TOKEN_USER_PROP, token);
  return {ok:true, connected:true, baseUrl:baseUrl, profile:{name:profile.name||profile.short_name||'', email:profile.primary_email||''}};
}
function clearCanvasConnection() {
  requireTeacher_();
  const p = PropertiesService.getUserProperties();
  p.deleteProperty(CANVAS_BASE_URL_USER_PROP);
  p.deleteProperty(CANVAS_TOKEN_USER_PROP);
  return {ok:true, connected:false};
}
function getCanvasConnectionStatus() {
  requireTeacher_();
  const conn = canvasConnection_();
  if (!conn.connected) return {ok:true, connected:false};
  try {
    const profile = canvasRequestWith_(conn, 'get', '/api/v1/users/self/profile');
    return {ok:true, connected:true, valid:true, baseUrl:conn.baseUrl, profile:{name:profile.name||profile.short_name||'', email:profile.primary_email||''}};
  } catch (e) {
    return {ok:true, connected:true, valid:false, baseUrl:conn.baseUrl, message:e.message};
  }
}
function listCanvasCourses() {
  requireTeacher_();
  const rows = canvasRequest_('get', '/api/v1/courses?enrollment_type=teacher&enrollment_state=active&per_page=100&include[]=term');
  return {ok:true, courses:(Array.isArray(rows)?rows:[]).map(function(c){
    return {id:String(c.id), name:c.name||c.course_code||('Course '+c.id), courseCode:c.course_code||'', term:(c.term&&c.term.name)||''};
  })};
}
function listCanvasAssignmentGroups(payload) {
  requireTeacher_();
  const courseId = String((payload||{}).courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course first.');
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100');
  return {ok:true, groups:(Array.isArray(rows)?rows:[]).map(function(g){ return {id:String(g.id), name:g.name||('Group '+g.id)}; })};
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
  if (groupId) {
    const g = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(groupId));
    groupName = g.name || '';
  }
  const old = ctx.settings.canvas || {};
  ctx.settings.canvas = {
    courseId: courseId,
    courseName: course.name || '',
    assignmentGroupId: groupId,
    assignmentGroupName: groupName,
    // Keep the Act-to-assignment links only if it is the same course.
    assignments: String(old.courseId || '') === courseId ? (old.assignments || {}) : {}
  };
  saveWholeClassSettings_(classId, ctx.settings);
  return {ok:true, canvas:ctx.settings.canvas};
}
function unlinkCanvasCourse(payload) {
  const classId = String((payload||{}).classId || '');
  const ctx = canvasTeacherClass_(classId);
  ctx.settings.canvas = {courseId:'',courseName:'',assignmentGroupId:'',assignmentGroupName:'',assignments:{}};
  saveWholeClassSettings_(classId, ctx.settings);
  return {ok:true, canvas:ctx.settings.canvas};
}

function canvasCourseStudents_(courseId) {
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&per_page=100');
  return (Array.isArray(rows)?rows:[]).map(function(u){
    return {
      id: String(u.id),
      name: u.name || u.short_name || '',
      email: String(u.email || u.login_id || '').trim().toLowerCase(),
      loginId: String(u.login_id || '').trim().toLowerCase(),
      sisId: String(u.sis_user_id || '').trim().toLowerCase()
    };
  });
}
// Match on any of the three things Canvas might carry the school email in.
function canvasMatchStudent_(email, canvasStudents) {
  const e = norm_(email);
  if (!e) return null;
  return canvasStudents.find(function(u){ return u.email === e || u.loginId === e || u.sisId === e; }) || null;
}

// Creates the Canvas assignment for an Act, or updates it if this class has
// already been linked to one. Graded in this app, so the Canvas assignment
// takes no submissions.
function syncCanvasAssignment(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ref = assignmentRef_(payload);
  const ctx = canvasTeacherClass_(classId);
  const c = ctx.settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  const data = assignmentGradeRows_(classId, ref);
  const aKey = assignmentSettingsKey_(ref);
  c.assignments = c.assignments || {};
  const old = c.assignments[aKey] || {};
  // Set only when the teacher changed the group in this window; '' leaves Canvas as it is.
  const chosenGroup = String(payload.assignmentGroupId || '');
  const published = assignmentPublished_(ctx.settings, ref);
  ctx.settings.assignmentSchedule = ctx.settings.assignmentSchedule || {};
  // Dates only change when this call supplies them, so pushing grades later
  // never silently wipes a due date set earlier.
  const prior = canvasScheduleFor_(ctx.settings, ref);
  const schedule = {
    dueAt: payload.dueAt !== undefined ? String(payload.dueAt || '') : prior.dueAt,
    unlockAt: payload.unlockAt !== undefined ? String(payload.unlockAt || '') : prior.unlockAt,
    lockAt: payload.lockAt !== undefined ? String(payload.lockAt || '') : prior.lockAt
  };
  ctx.settings.assignmentSchedule[aKey] = schedule;
  const form = applyCanvasSchedule_({
    'assignment[name]': data.label,
    'assignment[points_possible]': String(data.pointsPossible),
    'assignment[grading_type]': data.gradingType || 'points',
    'assignment[submission_types][]': 'none',
    'assignment[published]': published ? 'true' : 'false',
    'assignment[description]': canvasDescriptionHtml_(ref)
  }, schedule);
  let assignment, adopted = false;
  if (old.assignmentId) {
    try {
      assignment = canvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(old.assignmentId), canvasWithGroup_(form, null, chosenGroup));
    } catch (e) {
      // Someone deleted it in Canvas; make a fresh one rather than dead-ending.
      if (e.canvasStatus !== 404) throw e;
      assignment = canvasRequest_('post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments', canvasWithGroup_(form, c, chosenGroup));
    }
  } else {
    // TWO CLASSES, ONE CANVAS COURSE. Both of Jaben's blocks are one course in
    // Canvas, so the second class must JOIN the assignment the first one made
    // rather than create a twin of it. Creating blindly here would leave two
    // identically-named assignments each holding half the roster's grades.
    // Pushes are safe to share: each one sends grades only for the students it
    // matched, so neither class can blank the other's.
    // A failed lookup must never block creating the assignment -- worst case we
    // create one where we might have adopted, which the teacher can see and
    // fix, rather than leaving them unable to set the Act up at all.
    let existing = null;
    try { existing = canvasFindAssignmentByName_(c.courseId, data.label); } catch (e) { existing = null; }
    if (existing) {
      adopted = true;
      // Adopt what is already there. Don't touch its dates -- the other class
      // set those, and they are the thing being shared.
      // Keep the description (it carries the app link, and refreshing it is
      // the point), drop the dates -- those belong to the class that set them.
      const adoptForm = {};
      Object.keys(form).forEach(function(k){
        if (k.indexOf('_at]') === -1) adoptForm[k] = form[k];
      });
      assignment = canvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(existing.id), canvasWithGroup_(adoptForm, null, chosenGroup));
    } else {
      assignment = canvasRequest_('post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments', canvasWithGroup_(form, c, chosenGroup));
    }
  }
  const moduleLink = syncCanvasModuleItem_(
    c.courseId, assignment,
    payload.moduleId !== undefined ? String(payload.moduleId || '') : String(old.moduleId || ''),
    String(payload.moduleName || old.moduleName || ''),
    old, data.label, published
  );
  c.assignments[aKey] = {
    kind: ref.kind,
    key: ref.key,
    act: ref.kind === 'act' ? ref.act : undefined,
    assignmentId: String(assignment.id),
    name: assignment.name || data.label,
    htmlUrl: assignment.html_url || '',
    pointsPossible: Number(assignment.points_possible || data.pointsPossible),
    dueAt: assignment.due_at || schedule.dueAt || '',
    published: assignment.published !== false,
    assignmentGroupId: String(assignment.assignment_group_id || ''),
    moduleId: moduleLink.moduleId,
    moduleName: moduleLink.moduleName,
    moduleItemId: moduleLink.moduleItemId,
    lastAssignmentSyncAt: new Date().toISOString(),
    lastGradeSyncAt: old.lastGradeSyncAt || '',
    feedbackSync: old.feedbackSync || {}
  };
  ctx.settings.canvas = c;
  saveWholeClassSettings_(classId, ctx.settings);
  return {ok:true, assignment:c.assignments[aKey], canvas:c, adopted:adopted,
          sharedWith:canvasSharedWith_(classId, c.courseId, String(assignment.id))};
}

// Exact-name lookup, so a second class can find the assignment the first one
// already created instead of making a duplicate.
function canvasFindAssignmentByName_(courseId, name) {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) +
    '/assignments?per_page=100&search_term=' + encodeURIComponent(wanted));
  const list = Array.isArray(rows) ? rows : [];
  const hit = list.find(function(a){ return String(a.name || '').trim() === wanted; });
  return hit ? {id:String(hit.id), name:hit.name, pointsPossible:Number(hit.points_possible || 0)} : null;
}

// Which OTHER classes in this app point at the same Canvas assignment. Used to
// tell the teacher the assignment is shared, and to warn when the two classes
// disagree about what the Act is out of.
function canvasSharedWith_(classId, courseId, assignmentId) {
  if (!assignmentId) return [];
  const out = [];
  sheetObjects_('CLASSES').forEach(function(k){
    if (k.classId === classId || !truthy_(k.active)) return;
    const st = parseJson_(k.settingsJson, {});
    const cc = st.canvas || {};
    if (String(cc.courseId || '') !== String(courseId)) return;
    const hit = Object.keys(cc.assignments || {}).some(function(key){
      return String((cc.assignments[key] || {}).assignmentId || '') === String(assignmentId);
    });
    if (hit) out.push(k.className || k.classId);
  });
  return out;
}

// Pushes this Act's scores into the linked Canvas assignment in one call.
// Creates the assignment first if it does not exist yet, so the teacher only
// ever presses one button.
// `shared` is internal: pushCanvasGradebook passes the course's Canvas roster
// so pushing eleven assignments fetches it once, not eleven times.
function pushCanvasGrades(payload, shared) {
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
  const data = assignmentGradeRows_(classId, ref);
  if (!link || !link.assignmentId) throw new Error('Could not find or create the Canvas assignment for ' + data.label + '.');
  // Keep the denominator honest: a class-wide exclusion since the last push
  // changes what this Act is out of, and Canvas must be told before the scores
  // land against the old maximum.
  // Deliberately NO date fields here. Canvas leaves out-of-form fields alone,
  // so omitting them preserves whatever the assignment already has -- and when
  // two classes share one assignment, it stops this class's stale copy of the
  // schedule from overwriting a due date the other class just set. Dates change
  // only when you set them in the Act's Canvas screen.
  const updateForm = {
    'assignment[name]': data.label,
    'assignment[points_possible]': String(data.pointsPossible),
    'assignment[grading_type]': data.gradingType || 'points',
    'assignment[submission_types][]': 'none',
    'assignment[published]': assignmentPublished_(ctx.settings, ref) ? 'true' : 'false',
    'assignment[description]': canvasDescriptionHtml_(ref)
  };
  // If another class shares this assignment and the two disagree about the
  // denominator -- because one of them excluded a question class-wide and the
  // other didn't -- whoever pushes last silently decides. Read what Canvas has
  // BEFORE overwriting it, or the comparison is always against our own value
  // and the clash can never be seen.
  const sharedWith = canvasSharedWith_(classId, c.courseId, String(link.assignmentId));
  let pointsConflict = '';
  if (sharedWith.length) {
    try {
      const before = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId));
      if (Number(before.points_possible) !== Number(data.pointsPossible)) {
        pointsConflict = 'This assignment is shared with ' + sharedWith.join(', ') + '. Canvas had it out of ' +
          Number(before.points_possible) + ' points and this class works out to ' + data.pointsPossible +
          ', so Canvas now says ' + data.pointsPossible + '. That happens when a question is excluded for one class and not the other.';
      }
    } catch (e) {}
  }
  const updated = canvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId), updateForm);
  const canvasStudents = (shared && shared.canvasStudents) || canvasCourseStudents_(c.courseId);
  const form = {}, unmatched = [];
  const matched = [];
  let sent = 0, excusedCount = 0, unexcusedCount = 0;
  // The latest push is the truth in Canvas (2026-10-18a, same rule as Short
  // Story Lab v27). Work excluded in this app is sent as EXCUSED, so an older
  // pushed score stops counting. A student this app excused earlier who now
  // has a counted score is un-excused and gets the score. A student with no
  // score and no exclusion is left exactly as Canvas has them.
  const excusedBefore = link.excusedEmails || {};
  const excusedNow = {};
  const keepExcused = function(email){ if (excusedBefore[email]) excusedNow[email] = true; };
  data.rows.forEach(function(r){
    const email = norm_(r.email);
    const hasScore = r.score !== null && r.score !== undefined;
    const feedback = cleanTeacherComment_(r.feedback);
    if (r.excused) {
      const ux = canvasMatchStudent_(r.email, canvasStudents);
      if (!ux) { unmatched.push((r.name || r.email) + ' (' + r.email + ')'); keepExcused(email); return; }
      form['grade_data[' + ux.id + '][excuse]'] = 'true';
      excusedNow[email] = true;
      excusedCount++;
      return;
    }
    if (!hasScore && !feedback) { keepExcused(email); return; }   // nothing to send for this student
    const u = canvasMatchStudent_(r.email, canvasStudents);
    if (!u) { unmatched.push((r.name || r.email) + ' (' + r.email + ')'); keepExcused(email); return; }
    matched.push({row:r, user:u, feedback:feedback});
    if (!hasScore) { keepExcused(email); return; }
    // A complete/incomplete assignment takes the words, not a number.
    form['grade_data[' + u.id + '][posted_grade]'] =
      data.gradingType === 'pass_fail' ? (Number(r.score) > 0 ? 'complete' : 'incomplete') : String(r.score);
    if (excusedBefore[email]) { form['grade_data[' + u.id + '][excuse]'] = 'false'; unexcusedCount++; }
    sent++;
  });
  let progress = null;
  if (sent || excusedCount) {
    progress = canvasRequest_('post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId) + '/submissions/update_grades', form);
  }

  // Canvas comments are additive. Remember the exact feedback version last
  // sent for each student so repeated grade pushes do not spam duplicates; if
  // the teacher revises a comment, its hash changes and the new version is
  // posted on the next push.
  link.feedbackSync = link.feedbackSync || {};
  let feedbackPosted = 0, feedbackSkipped = 0;
  const feedbackFailed = [];
  matched.forEach(function(m){
    if (!m.feedback) return;
    const emailKey = norm_(m.row.email);
    const hash = md5Hex_(m.feedback);
    const prior = link.feedbackSync[emailKey];
    const priorHash = prior && typeof prior === 'object' ? String(prior.hash || '') : String(prior || '');
    if (priorHash === hash) { feedbackSkipped++; return; }
    try {
      canvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId) + '/submissions/' + encodeURIComponent(m.user.id), {
        'comment[text_comment]': m.feedback
      });
      link.feedbackSync[emailKey] = {hash:hash, syncedAt:new Date().toISOString()};
      feedbackPosted++;
    } catch (e) {
      feedbackFailed.push((m.row.name || m.row.email) + ': ' + canvasErrorMessage_('', e.message || String(e)));
    }
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
  link.excusedEmails = excusedNow;
  link.lastGradeSyncAt = new Date().toISOString();
  c.assignments[aKey] = link;
  ctx.settings.canvas = c;
  saveWholeClassSettings_(classId, ctx.settings);
  return {
    ok: true,
    kind: ref.kind,
    key: ref.key,
    act: ref.kind === 'act' ? ref.act : undefined,
    label: data.label,
    sent: sent,
    excused: excusedCount,
    excusedNames: data.excused || [],
    unexcused: unexcusedCount,
    pointsPossible: data.pointsPossible,
    unmatched: unmatched,
    skipped: data.skipped,
    adjusted: data.adjusted,
    unmarked: data.unmarked,
    waiting: data.waiting || [],
    assignment: link,
    sharedWith: sharedWith,
    pointsConflict: pointsConflict,
    feedbackPosted: feedbackPosted,
    feedbackSkipped: feedbackSkipped,
    feedbackFailed: feedbackFailed,
    progressUrl: progress && progress.url ? progress.url : ''
  };
}

// ---- Push all to Canvas (2026-10-18a, ported from Short Story Lab) --------
// The Gradebook's "↗ Push all to Canvas". Sends every assignment that is
// already in Canvas and released to students, one after another, through
// pushCanvasGrades -- so every rule (blank stays blank, excused, scaling,
// comments only when changed) is exactly the tile button's. It never CREATES
// a Canvas assignment; the tile's ↗ Push does that the first time. It stops
// before Apps Script's 6-minute limit and says which ones are left.
function macbethAssignmentRefs_() {
  const refs = [1,2,3,4,5].map(function(a){ return {kind:'act', key:String(a), act:a}; });
  ESSAY_STEP_KEYS.concat([ESSAY_FINAL_KEY]).forEach(function(k){ refs.push({kind:'essay', key:k}); });
  return refs;
}
function macbethAssignmentLabel_(ref) {
  if (ref.kind === 'act') return 'Act ' + ref.act;
  return 'Essay — ' + (ref.key === ESSAY_FINAL_KEY ? 'Final Essay' : (ESSAY_STEP_LABELS[ref.key] || ref.key));
}
function pushCanvasGradebook(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = canvasTeacherClass_(classId);
  const c = ctx.settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  const links = c.assignments || {};
  const toPush = [], notInCanvas = [], hidden = [];
  macbethAssignmentRefs_().forEach(function(ref){
    const link = links[assignmentSettingsKey_(ref)];
    const label = macbethAssignmentLabel_(ref);
    if (!link || !link.assignmentId) { notInCanvas.push(label); return; }
    if (!assignmentPublished_(ctx.settings, ref)) { hidden.push(label); return; }
    toPush.push(ref);
  });
  if (!toPush.length) {
    throw new Error('None of the released Macbeth assignments are in Canvas yet. Use ↗ Push on an assignment tile once to create it in Canvas.');
  }
  const shared = {canvasStudents: canvasCourseStudents_(c.courseId)};
  const started = Date.now();
  const results = [], failures = [], classExcluded = [], notReached = [];
  const unmatched = {}, waiting = {}, unmarked = {};
  let totalSent = 0, totalExcused = 0, totalUnexcused = 0, totalFeedback = 0;
  toPush.forEach(function(ref){
    const label = macbethAssignmentLabel_(ref);
    if (Date.now() - started > 270000) { notReached.push(label); return; }
    try {
      const r = pushCanvasGrades(ref.kind === 'act' ? {classId:classId, kind:'act', act:ref.act} : {classId:classId, kind:'essay', key:ref.key}, shared);
      totalSent += r.sent || 0;
      totalExcused += r.excused || 0;
      totalUnexcused += r.unexcused || 0;
      totalFeedback += r.feedbackPosted || 0;
      (r.unmatched || []).forEach(function(x){ unmatched[x] = true; });
      (r.waiting || []).forEach(function(x){ waiting[x] = true; });
      (r.unmarked || []).forEach(function(x){ unmarked[x.replace(/ \(\d+\)$/, '')] = true; });
      results.push({label:label, sent:r.sent || 0, excused:r.excused || 0, feedbackPosted:r.feedbackPosted || 0,
                    pointsConflict:r.pointsConflict || '', feedbackFailed:r.feedbackFailed || []});
    } catch (e) {
      const msg = e.message || String(e);
      if (/excluded for the whole class/i.test(msg)) classExcluded.push(label);
      else failures.push({label:label, message:msg});
    }
  });
  return {
    ok: failures.length === 0 && notReached.length === 0,
    assignments: results,
    totalSent: totalSent,
    totalExcused: totalExcused,
    totalUnexcused: totalUnexcused,
    totalFeedbackPosted: totalFeedback,
    failures: failures,
    notReached: notReached,
    notInCanvas: notInCanvas,
    hidden: hidden,
    classExcluded: classExcluded,
    unmatched: Object.keys(unmatched),
    waiting: Object.keys(waiting),
    unmarked: Object.keys(unmarked)
  };
}

// The deployed web app's own URL, so the Canvas assignment can link students
// straight to the work. Read fresh on every sync, which means redeploying and
// pressing Create/Update (or pushing grades) refreshes the link in Canvas --
// the URL is never typed in or stored anywhere that could go stale.
function appWebUrl_() {
  try {
    const u = ScriptApp.getService().getUrl();
    return u ? String(u) : '';
  } catch (e) {
    return '';
  }
}
function canvasDescriptionHtml_(ref) {
  // Tolerate the old call shape (a bare act number) so nothing that still
  // passes one silently writes "Read Act [object Object]" into Canvas.
  if (typeof ref === 'number' || typeof ref === 'string') ref = {kind:'act', key:String(ref), act:Number(ref)};
  const url = appWebUrl_();
  const intro = ref.kind === 'essay'
    ? '<p>' + ESSAY_CANVAS_BLURB[ref.key] + ' Your teacher marks your work in the Macbeth app and the score is synced back to Canvas.</p>'
    : '<p>Read Act ' + ref.act + ' and answer its questions in the Macbeth app. ' +
      'Your teacher marks your work there and the score is synced back to Canvas.</p>';
  if (!url) return intro;
  return intro + '<p><a href="' + url + '" target="_blank" rel="noopener"><strong>Open the Macbeth app</strong></a></p>' +
    '<p><small>Sign in with your school Google account.</small></p>';
}
// What each essay assignment asks students to do, in the Canvas description.
const ESSAY_CANVAS_BLURB = {
  thesis: 'Draft your thesis on Step 1 of the Writing Workshop: an arguable claim about whether Macbeth is a play about control and destiny, ambition and power, or justice and guilt.',
  discussion: 'Post your thesis to the class discussion on Step 2 of the Writing Workshop, and respond to what your classmates posted.',
  body: 'Write your three body paragraphs on Step 3 of the Writing Workshop — plus the optional counterargument paragraph if you want it.',
  intro: 'Write your introduction on Step 4 of the Writing Workshop, ending on your thesis.',
  conclusion: 'Write your conclusion on Step 5 of the Writing Workshop.',
  final: 'Assemble and submit your finished essay in the Writing Workshop. It is scored on Argument & Insight, Evidence & Analysis, Organization & Coherence, and Language & Control — the same four-criterion rubric you use for your self-evaluation.'
};

// Whether an assignment should be published (visible to students) in Canvas.
// Act assignments follow the Act release toggle. Essay-stage release controls
// access inside this app; Canvas assignments remain publishable independently
// so a teacher can set up the full Canvas sequence in advance.
function assignmentPublished_(settings, ref) {
  if (ref.kind === 'essay') return true;
  return (settings.releasedActs || []).indexOf(ref.act) !== -1;
}

function listCanvasModules(payload) {
  requireTeacher_();
  const courseId = String((payload||{}).courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course first.');
  const rows = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/modules?per_page=100');
  const modules = (Array.isArray(rows)?rows:[]).filter(function(m){ return m.workflow_state !== 'deleted'; });
  return {ok:true, modules:modules.map(function(m){
    return {id:String(m.id), name:m.name || ('Module ' + m.id), position:Number(m.position||0), published:m.published !== false};
  }).sort(function(a,b){ return (a.position - b.position) || a.name.localeCompare(b.name); })};
}

// Keeps a module item pointing at the Act's assignment without duplicating the
// assignment itself. Clearing the module selection removes ONLY the module
// item -- the Canvas assignment and every grade on it stay put.
function syncCanvasModuleItem_(courseId, assignment, desiredModuleId, desiredModuleName, oldLink, title, published) {
  desiredModuleId = String(desiredModuleId || '');
  oldLink = oldLink || {};
  let oldModuleId = String(oldLink.moduleId || '');
  let oldItemId = String(oldLink.moduleItemId || '');
  const assignmentId = String((assignment||{}).id || '');
  const oldAssignmentId = String(oldLink.assignmentId || '');
  const encCourse = encodeURIComponent(courseId);

  function deleteOld_() {
    if (!oldModuleId || !oldItemId) return;
    try {
      canvasRequest_('delete', '/api/v1/courses/' + encCourse + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId));
    } catch (e) {
      if (e.canvasStatus !== 404) throw e;   // already gone is fine
    }
    oldModuleId = ''; oldItemId = '';
  }

  // If the assignment was recreated (its old id 404'd), the stale module item
  // points at something that no longer exists and has to be rebuilt.
  if (oldAssignmentId && assignmentId && oldAssignmentId !== assignmentId) deleteOld_();

  if (!desiredModuleId) { deleteOld_(); return {moduleId:'', moduleName:'', moduleItemId:''}; }

  const moduleObj = canvasRequest_('get', '/api/v1/courses/' + encCourse + '/modules/' + encodeURIComponent(desiredModuleId));
  const moduleName = moduleObj.name || String(desiredModuleName || '');
  const itemForm = {'module_item[title]':title, 'module_item[published]':published ? 'true' : 'false'};
  let item = null;

  if (oldItemId && oldModuleId) {
    try {
      const update = Object.assign({}, itemForm);
      if (oldModuleId !== desiredModuleId) update['module_item[module_id]'] = desiredModuleId;
      item = canvasRequest_('put', '/api/v1/courses/' + encCourse + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId), update);
    } catch (e) {
      if (e.canvasStatus !== 404) throw e;
      oldItemId = ''; oldModuleId = '';
    }
  }
  if (!item) {
    item = canvasRequest_('post', '/api/v1/courses/' + encCourse + '/modules/' + encodeURIComponent(desiredModuleId) + '/items', {
      'module_item[title]':title, 'module_item[type]':'Assignment', 'module_item[content_id]':assignmentId
    });
    // Some Canvas installations ignore `published` on create, so set it after.
    try {
      item = canvasRequest_('put', '/api/v1/courses/' + encCourse + '/modules/' + encodeURIComponent(desiredModuleId) + '/items/' + encodeURIComponent(item.id), itemForm);
    } catch (e) {}
  }
  return {moduleId:desiredModuleId, moduleName:moduleName, moduleItemId:String(item.id || oldItemId || '')};
}

// The dates an assignment's Canvas entry carries. Stored per class so they
// survive re-pushes and are reapplied on every sync.
function canvasScheduleFor_(settings, ref) {
  if (typeof ref === 'number' || typeof ref === 'string') ref = {kind:'act', key:String(ref)};
  return (settings.assignmentSchedule || {})[assignmentSettingsKey_(ref)] || {dueAt:'', unlockAt:'', lockAt:''};
}
function applyCanvasSchedule_(form, schedule) {
  if (schedule.dueAt !== undefined) form['assignment[due_at]'] = schedule.dueAt || '';
  if (schedule.unlockAt !== undefined) form['assignment[unlock_at]'] = schedule.unlockAt || '';
  if (schedule.lockAt !== undefined) form['assignment[lock_at]'] = schedule.lockAt || '';
  return form;
}
// Read back what Canvas has for an assignment, so the setup screen can show the
// real current state rather than only what this app last sent. Still named for
// Acts because that is what the client already calls; it takes either shape.
function getCanvasActSetup(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ref = assignmentRef_(payload);
  const ctx = canvasTeacherClass_(classId);
  const c = ctx.settings.canvas || {};
  const link = (c.assignments || {})[assignmentSettingsKey_(ref)] || null;
  const data = assignmentGradeRows_(classId, ref);
  let modules = [];
  let modulesError = '';
  let groups = [];
  let groupsError = '';
  if (c.courseId) {
    try { modules = listCanvasModules({courseId:c.courseId}).modules; }
    catch (e) { modulesError = e.message; }
    try { groups = listCanvasAssignmentGroups({courseId:c.courseId}).groups; }
    catch (e) { groupsError = e.message; }
  }
  // Read the live assignment when there is one, so the dates shown are the real
  // ones -- including a date the other class (or Canvas itself) set.
  let live = null;
  if (link && link.assignmentId) {
    try { live = canvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId)); }
    catch (e) { live = null; }
  }
  const stored = canvasScheduleFor_(ctx.settings, ref);
  const schedule = live
    ? {dueAt: live.due_at || '', unlockAt: live.unlock_at || '', lockAt: live.lock_at || ''}
    : stored;
  return {
    ok: true,
    kind: ref.kind,
    key: ref.key,
    act: ref.kind === 'act' ? ref.act : undefined,
    label: data.label,
    gradingType: data.gradingType || 'points',
    pointsPossible: data.pointsPossible,
    canvasPointsPossible: live ? Number(live.points_possible || 0) : null,
    canvas: c,
    link: link,
    sharedWith: link && link.assignmentId ? canvasSharedWith_(classId, c.courseId, String(link.assignmentId)) : [],
    schedule: schedule,
    modules: modules,
    modulesError: modulesError,
    groups: groups,
    groupsError: groupsError,
    // Where the assignment is in Canvas now (it may have been moved there); before it exists, the class default.
    currentGroupId: live ? String(live.assignment_group_id || '') : String(c.assignmentGroupId || ''),
    appUrl: appWebUrl_(),
    published: assignmentPublished_(ctx.settings, ref)
  };
}

// Every assignment this class can push, with whatever Canvas already knows
// about it -- so the Canvas screen can list the five Acts and the six essay
// pieces together instead of asking one at a time.
function listCanvasAssignments(payload) {
  payload = payload || {};
  const classId = String(payload.classId || '');
  const ctx = canvasTeacherClass_(classId);
  const c = ctx.settings.canvas || {};
  const out = [];
  const add = function(ref, label, group) {
    const aKey = assignmentSettingsKey_(ref);
    const link = (c.assignments || {})[aKey] || null;
    let pointsPossible = null, error = '';
    try { pointsPossible = assignmentGradeRows_(classId, ref).pointsPossible; }
    catch (e) { error = e.message; }
    out.push({
      kind: ref.kind, key: ref.key, group: group, label: label,
      pointsPossible: pointsPossible, error: error, link: link,
      schedule: canvasScheduleFor_(ctx.settings, ref),
      published: assignmentPublished_(ctx.settings, ref)
    });
  };
  [1,2,3,4,5].forEach(function(a){ add({kind:'act', key:String(a), act:a}, 'Act ' + a, 'Reading'); });
  ESSAY_STEP_KEYS.forEach(function(k){ add({kind:'essay', key:k}, ESSAY_STEP_LABELS[k], 'Essay'); });
  add({kind:'essay', key:ESSAY_FINAL_KEY}, 'Final Essay', 'Essay');
  return {ok:true, assignments:out, canvas:c};
}

// ===========================================================================
// Gemini: suggested feedback on the Final Essay (added 2026-10-02a)
//
// On the Final Essay grading screen, a teacher clicks "Suggest feedback" on a
// student's essay. Gemini reads the essay against the four-criterion rubric and
// sends back FOUR short statements per criterion, written in the teacher's own
// voice ("I think you were successful...", "I loved...", "Good work..., but...").
// The teacher clicks a statement to add it to that criterion's comment box.
// Nothing is ever added, scored or sent to Canvas without the teacher's click.
//
//  - The Gemini API key is the teacher's own. It is pasted once in the app and
//    stored in USER properties (like the Canvas token): never written to the
//    spreadsheet, never sent to a browser, never visible to students.
//    A key in Script Properties under GEMINI_API_KEY also works, as a fallback.
//  - Only the essay text, the thesis and the rubric are sent to Gemini. No
//    student name or email ever leaves this script.
//  - Uses the same `script.external_request` permission the Canvas push
//    already uses, so no new permission prompt. testGeminiSetup() below checks
//    the key from the editor if anything goes wrong.
//  - To use a different model, add a Script Property GEMINI_MODEL
//    (e.g. gemini-3.5-flash). Otherwise the newest model in GEMINI_MODELS that
//    the key can reach is used.
// ===========================================================================
const GEMINI_KEY_USER_PROP = 'MACBETH_GEMINI_KEY';
const GEMINI_KEY_SCRIPT_PROP = 'GEMINI_API_KEY';
const GEMINI_MODEL_SCRIPT_PROP = 'GEMINI_MODEL';
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_CACHE_SECONDS = 6 * 60 * 60;
const GEMINI_STATEMENTS_PER_CRITERION = 4;
// Bump when the prompt changes, so suggestions saved under the old wording are
// not served from the 6-hour cache.
const GEMINI_PROMPT_VERSION = 'p2-varied-openers';

function geminiKey_() {
  const own = String(PropertiesService.getUserProperties().getProperty(GEMINI_KEY_USER_PROP) || '').trim();
  if (own) return {key: own, source: 'teacher'};
  const shared = String(PropertiesService.getScriptProperties().getProperty(GEMINI_KEY_SCRIPT_PROP) || '').trim();
  return shared ? {key: shared, source: 'script'} : {key: '', source: ''};
}
// Which models to try, best first. Rather than guessing model names (Google
// renames and retires them often, and free and paid keys can see different
// ones), ask the API which models THIS key can use, and pick the Flash models
// from that list: newest version first, full Flash before Flash-Lite, stable
// before preview. The list is cached for 6 hours. A Script Property
// GEMINI_MODEL overrides all of this.
function geminiVersionOf_(name) {
  const m = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
}
function geminiListModels_(key) {
  const names = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const r = geminiFetch_(key, 'get', '/models?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    if (r.status !== 200) return {ok:false, status:r.status, body:r.body, names:names};
    const j = parseJson_(r.body, {});
    (j.models || []).forEach(function(m){
      const methods = m.supportedGenerationMethods || [];
      if (methods.indexOf('generateContent') !== -1) names.push(String(m.name || '').replace(/^models\//, ''));
    });
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return {ok:true, names:names};
}
function geminiModels_(key) {
  const forced = String(PropertiesService.getScriptProperties().getProperty(GEMINI_MODEL_SCRIPT_PROP) || '').trim();
  if (forced) return [forced];
  if (!key) return GEMINI_MODELS.slice();
  const cache = CacheService.getUserCache();
  const cacheKey = 'aimodels:' + md5Hex_(key);
  const hit = parseJson_(cache.get(cacheKey), null);
  if (Array.isArray(hit) && hit.length) return hit;
  const listed = geminiListModels_(key);
  const usable = listed.names.filter(function(n){
    return /^gemini-/.test(n) && /flash/.test(n) &&
      !/(tts|image|audio|live|embedding|transcribe|translate|omni|exp\b|thinking-exp)/.test(n);
  });
  const rank = function(n){
    return geminiVersionOf_(n) * 10
      - (/lite/.test(n) ? 3 : 0)
      - (/preview|exp/.test(n) ? 2 : 0)
      - (/-\d{3}$|-\d{2}-\d{2}$/.test(n) ? 1 : 0);   // dated snapshots after the plain name
  };
  usable.sort(function(a, b){ return rank(b) - rank(a) || a.length - b.length; });
  // One model per family: gemini-3.6-flash-001 is the same model as
  // gemini-3.6-flash, so when one is overloaded the other is too.
  const seen = {}, out = [];
  usable.forEach(function(n){
    const base = n.replace(/-\d{3}$|-\d{2}-\d{2}$|-preview.*$/, '');
    if (seen[base] || out.length >= 4) return;
    seen[base] = true; out.push(n);
  });
  if (!out.length) return GEMINI_MODELS.slice();
  try { cache.put(cacheKey, JSON.stringify(out), GEMINI_CACHE_SECONDS); } catch (e) {}
  return out;
}
function geminiErrorMessage_(status, body) {
  let msg = '';
  try { const j = JSON.parse(String(body || '')); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) {}
  msg = String(msg || body || '').slice(0, 400);
  if (status === 400 && /api key/i.test(msg)) return 'Gemini did not accept that API key. Check it was copied in full from Google AI Studio.';
  if (status === 403) return 'This API key is not allowed to use Gemini (' + msg + '). Make sure the Gemini API is enabled for the key in Google AI Studio.';
  if (status === 429) return 'Gemini is busy, or the key has reached its limit for now. Wait a minute and try again.';
  if (status === 503) return 'Gemini\'s servers are overloaded right now (503) - every model was tried. Wait a minute or two and click Suggest feedback again.';
  if (status >= 500) return 'Gemini had a problem on its side (' + status + '). Try again in a moment.';
  return 'Gemini ' + status + ': ' + msg;
}
function geminiFetch_(key, method, path, body) {
  const opt = {
    method: method,
    headers: {'x-goog-api-key': key},
    muteHttpExceptions: true
  };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(GEMINI_API_BASE + path, opt);
  return {status: res.getResponseCode(), body: res.getContentText()};
}

// Run ONCE from the Apps Script editor if the app ever says Gemini can't be
// reached. It confirms outbound requests are authorized and the key works.
function testGeminiSetup() {
  const k = geminiKey_();
  if (!k.key) { Logger.log('No Gemini key saved yet. Paste one in the app: Grade the Essay > Final Essay > Connect Gemini.'); return {ok:false}; }
  const r = geminiFetch_(k.key, 'get', '/models?pageSize=50');
  if (r.status !== 200) { Logger.log('Key check failed: ' + geminiErrorMessage_(r.status, r.body)); return {ok:false}; }
  Logger.log('The Gemini key works (' + (k.source === 'teacher' ? 'saved for ' + currentEmail_() : 'Script Property ' + GEMINI_KEY_SCRIPT_PROP) + ').');
  const listed = geminiListModels_(k.key);
  Logger.log('Models this key can use for text: ' + (listed.names.filter(function(n){ return /^gemini-/.test(n); }).join(', ') || '(none listed)'));
  try { CacheService.getUserCache().remove('aimodels:' + md5Hex_(k.key)); } catch (e) {}
  Logger.log('The app will try, in order: ' + geminiModels_(k.key).join(', '));
  return {ok:true};
}

function getGeminiStatus() {
  requireTeacher_();
  const k = geminiKey_();
  return {ok:true, connected: !!k.key, source: k.source, hint: k.key ? '••••' + k.key.slice(-4) : ''};
}
function saveGeminiKey(payload) {
  requireTeacher_();
  const key = String((payload || {}).key || '').trim();
  if (!key) throw new Error('Paste your Gemini API key first.');
  if (/\s/.test(key) || key.length < 20) throw new Error('That does not look like a Gemini API key. Copy the whole key from Google AI Studio.');
  // Prove the key works before saving it, so a typo fails here and not in the
  // middle of grading.
  const r = geminiFetch_(key, 'get', '/models?pageSize=1');
  if (r.status !== 200) throw new Error(geminiErrorMessage_(r.status, r.body));
  PropertiesService.getUserProperties().setProperty(GEMINI_KEY_USER_PROP, key);
  return {ok:true, connected:true, source:'teacher', hint:'••••' + key.slice(-4)};
}
function clearGeminiKey() {
  requireTeacher_();
  PropertiesService.getUserProperties().deleteProperty(GEMINI_KEY_USER_PROP);
  const k = geminiKey_();
  return {ok:true, connected: !!k.key, source: k.source, hint: k.key ? '••••' + k.key.slice(-4) : ''};
}

// The rubric descriptors live client-side (RUBRIC in PlayData), so the browser
// sends them with the request. They are checked and trimmed here: only the
// four known criteria, five short descriptors each.
function cleanGeminiRubric_(rubric) {
  rubric = rubric && typeof rubric === 'object' ? rubric : {};
  const bands = ['Exceeds', 'Strong', 'Developing', 'Limited', 'Beginning'];
  return ESSAY_CRITERIA.map(function(c){
    const levels = Array.isArray(rubric[c]) ? rubric[c].slice(0, 5) : [];
    const lines = levels.map(function(d, i){
      return '  - ' + bands[i] + ' (' + ESSAY_CRITERION_POINTS[i] + ' pts): ' + String(d || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    });
    return c + (lines.length ? ':\n' + lines.join('\n') : ' (no descriptors provided)');
  }).join('\n\n');
}

function geminiFeedbackPrompt_(essayText, thesis, rubricText, scores) {
  const scoreLines = ESSAY_CRITERIA.map(function(c){
    const s = scores && scores[c];
    return (s !== null && s !== undefined && s !== '' && isFinite(Number(s))) ? '- ' + c + ': the teacher scored this ' + Number(s) + ' out of ' + ESSAY_CRITERION_MAX : '';
  }).filter(Boolean);
  const system = [
    'You are helping a high school English teacher write feedback on a student\'s literary argument essay about Shakespeare\'s Macbeth.',
    'You write AS THE TEACHER, speaking directly to the student ("you", "your"), warm, encouraging and honest.',
    'Your feedback is student-focused: it names what THIS student actually did in THIS essay, and tells them clearly what to do next.',
    '',
    'For EACH of the four rubric criteria, write exactly ' + GEMINI_STATEMENTS_PER_CRITERION + ' feedback statements, in this order:',
    '  1. A specific strength.',
    '  2. A different specific strength.',
    '  3. A balanced comment: praise one thing, then name one specific thing to improve (the teacher\'s "Good work ..., but ..." pattern).',
    '  4. A clear, specific next step for revision.',
    '',
    'THE TEACHER\'S VOICE. These are the teacher\'s own openers. Use them, and others in the same warm, direct, conversational style:',
    '  Strengths: "I think you were successful in ...", "I loved how you ...", "Great work ...", "I really liked ...", "Nice job ...", "I was impressed by ...", "You did a great job ...", "I appreciated how you ...", "Well done ...", "One thing that really stood out to me was ...", "I can tell you ...", "Your ... was strong because ..."',
    '  Balanced: "Good work ..., but ...", "Nice job ..., however ...", "You are on the right track with ..., but ...", "This is a great start ..., now ...", "I liked ..., but I wanted ...", "Strong work ..., although ..."',
    '  Next steps: "Next time, try ...", "To make this even stronger, ...", "I would like to see you ...", "Try ...", "Consider ...", "One way to push this further is ...", "Before your next essay, ..."',
    'VARY THE OPENERS. Across all ' + (GEMINI_STATEMENTS_PER_CRITERION * ESSAY_CRITERIA.length) + ' statements, use as many different openers as you can: never start two statements in the same criterion the same way, and do not use any one opener more than twice in the whole set. Mix in sentences that start with the student\'s own idea (e.g. "Your point about ... is ...") so it does not read like a template. Keep the same warm, plain, teacher-to-student tone throughout: first person "I", talking to "you".',
    '',
    'Rules:',
    '- Judge the essay against that criterion\'s rubric descriptors. Every statement must be about that criterion only.',
    '- Be specific: refer to the student\'s actual claims, evidence, paragraphs or wording. You may quote a few of the student\'s own words in quotation marks, but never invent a quote and never put words in the student\'s mouth.',
    '- If the essay is weak on a criterion, still find something real to praise in statements 1-3, and make statements 3-4 point clearly at the gap.',
    '- Each statement is one or two sentences, under 45 words, plain language a 10th grader understands.',
    '- Do not mention points, scores, bands, rubric level names, AI, or Gemini. Do not use the student\'s name. No emojis.',
    '- Do not rewrite the essay for the student.'
  ].join('\n');
  const user = [
    'RUBRIC (best level first):',
    rubricText,
    '',
    scoreLines.length ? 'The teacher has already scored some criteria. Keep the balance of praise and criticism consistent with these scores:\n' + scoreLines.join('\n') + '\n' : '',
    'STUDENT\'S THESIS:',
    thesis ? thesis : '(none saved separately - find it in the introduction)',
    '',
    'STUDENT\'S ESSAY:',
    '"""',
    essayText,
    '"""'
  ].join('\n');
  return {system: system, user: user};
}

function geminiResponseSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      criteria: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            criterion: {type: 'STRING', enum: ESSAY_CRITERIA.slice()},
            statements: {type: 'ARRAY', items: {type: 'STRING'}}
          },
          required: ['criterion', 'statements']
        }
      }
    },
    required: ['criteria']
  };
}

// One call to Gemini, trying each model in turn if a model name isn't
// available to this key (404). If the structured-output settings are refused
// (400 not about the key), it retries once with a plain request.
function geminiGenerateJson_(key, prompt) {
  const fancy = {
    systemInstruction: {parts: [{text: prompt.system}]},
    contents: [{role: 'user', parts: [{text: prompt.user}]}],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: geminiResponseSchema_(),
      thinkingConfig: {thinkingLevel: 'low'}
    }
  };
  const plain = {
    systemInstruction: {parts: [{text: prompt.system + '\n\nReply with JSON only, shaped like {"criteria":[{"criterion":"Argument & Insight","statements":["...","...","...","..."]}, ...]} with all four criteria.'}]},
    contents: [{role: 'user', parts: [{text: prompt.user}]}],
    generationConfig: {responseMimeType: 'application/json'}
  };
  const models = geminiModels_(key);
  const busy = [], missing = [];
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    const path = '/models/' + encodeURIComponent(model) + ':generateContent';
    let body = fancy;
    let r = null;
    // A 503 ("model overloaded") or 500 is usually momentary: wait and retry
    // the same model twice, then move on to the next model in the list.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) Utilities.sleep(attempt * 2000);
      r = geminiFetch_(key, 'post', path, body);
      if (r.status === 400 && body === fancy && !/api key/i.test(r.body)) {
        body = plain;
        r = geminiFetch_(key, 'post', path, body);
      }
      if (r.status !== 500 && r.status !== 503) break;
    }
    if (r.status === 404) { missing.push(model); continue; }
    if (r.status === 500 || r.status === 503) { busy.push(model); continue; }
    if (r.status !== 200) throw new Error(geminiErrorMessage_(r.status, r.body));
    let j;
    try { j = JSON.parse(r.body); } catch (e) { throw new Error('Gemini sent back something unreadable. Try again.'); }
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini declined to read this essay (' + j.promptFeedback.blockReason + ').');
    const cand = (j.candidates || [])[0];
    const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
    const text = parts.filter(function(p){ return p && typeof p.text === 'string' && !p.thought; }).map(function(p){ return p.text; }).join('').trim();
    if (!text) throw new Error('Gemini returned no feedback' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '. Try again.');
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch (e) { throw new Error('Gemini\'s answer was not in the expected format. Try again.'); }
    return {model: model, data: parsed};
  }
  // Forget the cached model list, in case it is out of date.
  try { CacheService.getUserCache().remove('aimodels:' + md5Hex_(key)); } catch (e) {}
  if (busy.length) throw new Error('Gemini\'s servers are overloaded right now (503) for ' + busy.join(', ') +
    (missing.length ? ' (and ' + missing.join(', ') + ' is not available to this key)' : '') +
    '. Wait a minute or two and try again. A key with billing turned on gets priority when Gemini is busy.');
  throw new Error('None of these Gemini models are available to this key: ' + missing.join(', ') +
    '. Run testGeminiSetup in the Apps Script editor to see which models your key can use.');
}

function tidyGeminiStatement_(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s\-•\d.)]+/, '').trim().slice(0, 600);
}

// payload: {classId, studentEmail, rubric:{criterion:[5 descriptors]}, scores:{criterion:score}, refresh:bool}
function getAiEssayFeedback(payload) {
  const me = requireTeacher_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const email = norm_(payload.studentEmail);
  const klass = getClass_(classId);
  if (!klass) throw new Error('Class not found.');
  if (me.role !== 'admin' && norm_(klass.teacherEmail) !== norm_(me.email)) throw new Error('You do not manage this class.');
  const enrolled = sheetObjects_('ENROLL').some(function(r){ return r.classId === classId && norm_(r.studentEmail) === email; });
  if (!enrolled) throw new Error('That student is not in this class.');
  const k = geminiKey_();
  if (!k.key) return {ok:false, needsKey:true};

  const work = sheetObjects_('WORK').find(function(w){ return w.classId === classId && norm_(w.studentEmail) === email; });
  const st = work ? parseJson_(work.stateJson, {}) : {};
  const raw = essayTextFor_(st, ESSAY_FINAL_KEY);
  const essayText = raw.trim();
  if (wordCount_(essayText) < 40) throw new Error('This essay is too short for useful feedback yet.');
  const thesis = String(essayOf_(st).thesis || '').trim();
  const fp = respFingerprint_(raw);

  const scores = {};
  ESSAY_CRITERIA.forEach(function(c){
    const v = payload.scores ? payload.scores[c] : null;
    scores[c] = (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);
  });
  const cache = CacheService.getUserCache();
  const cacheKey = 'aifb:' + md5Hex_([GEMINI_PROMPT_VERSION, classId, email, fp, JSON.stringify(scores)].join('|'));
  if (!payload.refresh) {
    const hit = cache.get(cacheKey);
    if (hit) { const obj = parseJson_(hit, null); if (obj) { obj.fromCache = true; return obj; } }
  }

  const prompt = geminiFeedbackPrompt_(essayText.slice(0, 30000), thesis.slice(0, 1500), cleanGeminiRubric_(payload.rubric), scores);
  const out = geminiGenerateJson_(k.key, prompt);
  const list = (out.data && Array.isArray(out.data.criteria)) ? out.data.criteria : [];
  const criteria = {};
  ESSAY_CRITERIA.forEach(function(c){
    const found = list.find(function(x){ return x && norm_(x.criterion) === norm_(c); });
    const statements = (found && Array.isArray(found.statements) ? found.statements : [])
      .map(tidyGeminiStatement_).filter(Boolean).slice(0, GEMINI_STATEMENTS_PER_CRITERION);
    criteria[c] = statements;
  });
  if (!ESSAY_CRITERIA.some(function(c){ return criteria[c].length; })) throw new Error('Gemini did not return any feedback. Try again.');
  const result = {ok:true, fp:fp, model:out.model, criteria:criteria, generatedAt:new Date().toISOString()};
  try { cache.put(cacheKey, JSON.stringify(result), GEMINI_CACHE_SECONDS); } catch (e) {}
  return result;
}

// ===========================================================================
// checkStudentWork() -- run from the Apps Script editor (added 2026-10-02d)
//
// Looks for students whose work did not make it into their account. Set
// CHECK_STUDENT to part of a name or email to get a full report on one student;
// everyone else is scanned too, and anyone with a warning sign is listed.
//
// Warning signs:
//   LARGE, STILL IN ONE CELL  big saved work from before 2026-10-02d that has
//                      not been re-saved yet. Harmless: it is split across
//                      cells automatically the next time the student saves.
//   SHRANK AFTER GRADING  a response you graded is now shorter than it was
//                      when you graded it.
//   SPLIT ACROSS CLASSES  the student is enrolled in more than one class, so
//                      their work may be in a class you are not looking at.
//   DUPLICATE ROWS     more than one saved-work row for the same class.
// ===========================================================================
var CHECK_STUDENT = 'Schmaeling';

function checkStudentWork(nameOrEmail){
  const q = norm_(nameOrEmail || CHECK_STUDENT);
  const ss = db_();
  const sh = ss.getSheetByName('WORK');
  const vals = sh.getDataRange().getValues();
  const h = vals[0];
  const iClass = h.indexOf('classId'), iEmail = h.indexOf('studentEmail'), iName = h.indexOf('studentName'),
        iJson = h.indexOf('stateJson'), iAt = h.indexOf('updatedAt');
  const chunkCols = workChunkCols_(h);
  const className = {};
  sheetObjects_('CLASSES').forEach(function(c){ className[c.classId] = (c.className || '') + (c.period ? ' (' + c.period + ')' : ''); });
  const activeEnroll = {};
  sheetObjects_('ENROLL').filter(function(r){ return truthy_(r.active); }).forEach(function(r){
    const e = norm_(r.studentEmail); (activeEnroll[e] = activeEnroll[e] || []).push(r.classId);
  });
  const gradeItems = sheetObjects_('GRADEITEMS');
  const rowCount = {};
  const reports = [];

  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    if (!row[iEmail]) continue;
    const email = norm_(row[iEmail]);
    const classId = row[iClass];
    const k = classId + '|' + email;
    rowCount[k] = (rowCount[k] || 0) + 1;
    const firstCell = String(row[iJson] || '');
    const json = storedWorkJson_(row, h);
    const st = parseJson_(json, null);
    const flags = [];
    let unreadable = null;
    if (!st && json) {
      flags.push('SAVED WORK IS UNREADABLE');
      unreadable = describeBrokenJson_(json, [String(row[iJson] || '').length].concat(chunkCols.map(function(c){ return String(row[c] || '').length; })));
    }
    const s = st || {};
    if (!chunkCols.some(function(c){ return String(row[c] || ''); }) && firstCell.length >= 44000)
      flags.push('LARGE, STILL IN ONE CELL (' + firstCell.length + ' characters) - safe; it is split into pieces automatically the next time this student saves');

    // Multiple choice and written responses, by Act.
    const acts = {};
    Object.keys(SCENE_META).forEach(function(key){
      const a = SCENE_META[key].act;
      acts[a] = acts[a] || {scenes:0, mcDone:0, mcRight:0, written:0};
      acts[a].scenes++;
      const sc = mcScoreFor_((s.answers || {})[key], SCENE_META[key].correctIdx);
      if (sc !== null) { acts[a].mcDone++; if (sc > 0) acts[a].mcRight++; }
      if (String((s.dok || {})[key] || '').trim()) acts[a].written++;
    });
    const e = essayOf_(s);
    const essayWords = wordCount_(essayAssembledText_(e));

    // Anything you graded that is shorter now than when you graded it.
    const shrunk = [];
    gradeItems.filter(function(g){ return g.classId === classId && norm_(g.studentEmail) === email; }).forEach(function(g){
      const m = /^fp:(\d+):/.exec(String(g.markedText || ''));
      if (!m) return;
      const type = keyOf_(g.itemType), key = keyOf_(g.itemKey);
      let now = '';
      if (type === 'dok') now = (s.dok || {})[g.itemKey] || (s.dok || {})[key] || '';
      else if (type === 'essay' || type === 'essayRubric') now = essayTextFor_(s, type === 'essayRubric' ? ESSAY_FINAL_KEY : key, []);
      else return;
      if (type === 'essay' && key === 'discussion') return;   // lives in the discussion tab
      const core = respFingerprintCore_(now);
      const nowLen = core ? Number(core.split(':')[0]) : 0;
      const was = Number(m[1]);
      if (nowLen < was * 0.8) shrunk.push((type === 'dok' ? 'Scene ' : 'Essay ') + g.itemKey + ': ' + was + ' characters when graded, ' + nowLen + ' now');
    });
    if (shrunk.length) flags.push('SHRANK AFTER GRADING (' + shrunk.length + ')');
    const classes = activeEnroll[email] || [];
    if (classes.length > 1) flags.push('SPLIT ACROSS CLASSES: ' + classes.map(function(c){ return className[c] || c; }).join(' + '));

    reports.push({
      email: email, name: String(row[iName] || ''), classId: classId, cls: className[classId] || classId,
      chars: json.length, firstCell: firstCell.length, updatedAt: String(row[iAt] || ''),
      acts: acts, essayWords: essayWords, evidence: (s.evidence || []).length,
      shrunk: shrunk, flags: flags, unreadable: unreadable,
      subs: (q && (norm_(String(row[iName] || '')).indexOf(q) !== -1 || email.indexOf(q) !== -1)) ? submissionSummary_(s) : null
    });
  }
  const rowsByEmail = {};
  reports.forEach(function(rep){ (rowsByEmail[rep.email] = rowsByEmail[rep.email] || []).push(rep); });
  reports.forEach(function(rep){
    const others = rowsByEmail[rep.email].filter(function(o){ return o !== rep && o.classId !== rep.classId; });
    if (others.length) rep.flags.push('ALSO HAS SAVED WORK IN ANOTHER CLASS: ' + others.map(function(o){ return o.cls + ' (' + o.chars + ' characters)'; }).join(', '));
    if (rowCount[rep.classId + '|' + rep.email] > 1) rep.flags.push('DUPLICATE ROWS (' + rowCount[rep.classId + '|' + rep.email] + ')');
  });

  const describe = function(rep){
    Logger.log('----------------------------------------------------------------');
    Logger.log(rep.name + '  <' + rep.email + '>  -  ' + rep.cls);
    Logger.log('  Saved work: ' + rep.chars + ' characters, last saved ' + rep.updatedAt);
    Object.keys(rep.acts).sort().forEach(function(a){
      const x = rep.acts[a];
      Logger.log('  Act ' + a + ': multiple choice ' + x.mcDone + '/' + x.scenes + ' answered (' + x.mcRight + ' right), written responses ' + x.written + '/' + x.scenes);
    });
    Logger.log('  Evidence bank: ' + rep.evidence + ' quotes.  Essay: ' + rep.essayWords + ' words.');
    if (rep.subs) rep.subs.forEach(function(x){ Logger.log('  ' + x); });
    rep.flags.forEach(function(f){ Logger.log('  !! ' + f); });
    rep.shrunk.forEach(function(x){ Logger.log('       ' + x); });
    if (rep.unreadable) rep.unreadable.forEach(function(x){ Logger.log('       ' + x); });
  };

  Logger.log('=== ' + (q ? 'Students matching "' + q + '"' : 'No student named') + ' ===');
  const focus = reports.filter(function(rep){ return q && (norm_(rep.name).indexOf(q) !== -1 || rep.email.indexOf(q) !== -1); });
  if (q && !focus.length) Logger.log('No saved work found for "' + q + '". Check the spelling, or try part of their email.');
  focus.forEach(describe);

  const flagged = reports.filter(function(rep){ return rep.flags.length; }).sort(function(a,b){ return b.chars - a.chars; });
  Logger.log('');
  Logger.log('=== Everyone with a warning sign: ' + flagged.length + ' of ' + reports.length + ' saved-work rows ===');
  flagged.forEach(describe);

  Logger.log('');
  Logger.log('=== The 10 largest saved-work rows (any size is fine; big ones are split across cells) ===');
  reports.slice().sort(function(a,b){ return b.chars - a.chars; }).slice(0, 10).forEach(function(rep){
    Logger.log('  ' + rep.chars + '  ' + rep.name + '  -  ' + rep.cls);
  });
  return {students: reports.length, flagged: flagged.length};
}


// What exactly is wrong with saved work that will not open, and what text is
// still inside it. Read-only: it changes nothing.
function describeBrokenJson_(json, cellLengths){
  const out = [];
  out.push('Cell sizes: ' + cellLengths.join(' + ') + ' characters');
  let msg = '';
  try { JSON.parse(json); } catch (e) { msg = String(e && e.message || e); }
  out.push('Problem: ' + msg.slice(0, 200));
  const m = /position (\d+)/.exec(msg);
  const pos = m ? Number(m[1]) : json.length;
  out.push('At character ' + pos + ' of ' + json.length + (m ? '' : ' (the text seems to stop part-way through)'));
  out.push('Just before: ' + JSON.stringify(json.slice(Math.max(0, pos - 120), pos)));
  out.push('From there:  ' + JSON.stringify(json.slice(pos, pos + 80)));
  out.push('Starts: ' + JSON.stringify(json.slice(0, 60)) + '   Ends: ' + JSON.stringify(json.slice(-60)));
  // Is the writing still in there? Pull out the essay fields as plain text.
  const found = [];
  ['thesis', 'intro', 'conclusion', 'rebuttal'].forEach(function(k){
    const t = salvageJsonString_(json, '"' + k + '":"');
    if (t !== null) found.push(k + ' ' + t.length + ' chars');
  });
  const dokCount = (json.match(/"\d\.\d":"/g) || []).length;
  out.push('Still inside it: ' + (found.length ? found.join(', ') : 'no essay fields found') + '; ' + dokCount + ' scene entries');
  return out;
}
function salvageJsonString_(json, marker){
  const i = json.lastIndexOf(marker);
  if (i === -1) return null;
  let j = i + marker.length, s = '';
  while (j < json.length) {
    const ch = json.charAt(j);
    if (ch === '\\') { s += json.slice(j, j + 2); j += 2; continue; }
    if (ch === '"') break;
    s += ch; j++;
  }
  try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
}

// ===========================================================================
// recoverStudentWork() -- run from the Apps Script editor (added 2026-10-04b)
//
// Puts back work that was in a student's damaged saved copy. It reads every
// copy it can find for that student:
//   - rows in the WORK_BACKUP tab (raw copies kept before a damaged save was
//     replaced), and
//   - optionally, the WORK tab of an older COPY of the spreadsheet made from
//     File > Version history (put its ID in RECOVER_FROM_COPY_ID),
// pulls out every piece that can still be read -- even from a damaged copy --
// and MERGES it into the student's current work: the longer version of any
// writing wins, and nothing in the current work is removed.
//
// STEP 1: set RECOVER_STUDENT, leave RECOVER_COMMIT = false, run. The log
//         shows what would come back, Act by Act. Nothing is changed.
// STEP 2: if it looks right, set RECOVER_COMMIT = true and run again. The
//         current copy is backed up to WORK_BACKUP first.
// ===========================================================================
var RECOVER_STUDENT = 'Schmaeling';
var RECOVER_COMMIT = false;
var RECOVER_FROM_COPY_ID = '';   // optional: ID of a spreadsheet copy from Version history

function recoverStudentWork(nameOrEmail, commit){
  const q = norm_(nameOrEmail || RECOVER_STUDENT);
  const doCommit = commit === undefined ? RECOVER_COMMIT === true : commit === true;
  if (!q) throw new Error('Set RECOVER_STUDENT to part of the student\'s name or email.');
  const ss = db_();
  const sh = ss.getSheetByName('WORK');
  const vals = sh.getDataRange().getValues();
  const h = vals[0];
  const iClass = h.indexOf('classId'), iEmail = h.indexOf('studentEmail'), iName = h.indexOf('studentName'), iAt = h.indexOf('updatedAt');
  const targets = [];
  for (let r = 1; r < vals.length; r++) {
    const e = norm_(vals[r][iEmail]), n = norm_(vals[r][iName]);
    if (e && (e.indexOf(q) !== -1 || n.indexOf(q) !== -1)) targets.push(r);
  }
  if (!targets.length) { Logger.log('No saved work found for "' + q + '".'); return; }

  // Every other copy of this student's work we can find.
  const sources = [];
  const addRowsFrom = function(sheet, label){
    if (!sheet || sheet.getLastRow() < 2) return;
    const v = sheet.getDataRange().getValues(), hh = v[0];
    const ie = hh.indexOf('studentEmail'), ic = hh.indexOf('classId');
    const jsonCols = [];
    hh.forEach(function(k, i){ if (k === 'stateJson' || /^stateJson\d+$/.test(String(k))) jsonCols.push(i); });
    for (let r = 1; r < v.length; r++) {
      let json = '';
      // WORK_BACKUP keeps continuation pieces in the columns after stateJson.
      if (label.indexOf('WORK_BACKUP') === 0) {
        const start = hh.indexOf('stateJson');
        json = String(v[r][start] || '');
        for (let c = start + 1; c < v[r].length; c++) { const piece = String(v[r][c] || ''); if (piece.charAt(0) === '~') json += piece.slice(1); }
      } else json = storedWorkJson_(v[r], hh);
      sources.push({label: label + ' row ' + (r + 1), email: norm_(v[r][ie]), classId: v[r][ic], json: json,
                    at: String(v[r][hh.indexOf('backedUpAt')] || v[r][hh.indexOf('updatedAt')] || '')});
    }
  };
  addRowsFrom(ss.getSheetByName('WORK_BACKUP'), 'WORK_BACKUP');
  if (RECOVER_FROM_COPY_ID) {
    try { addRowsFrom(SpreadsheetApp.openById(RECOVER_FROM_COPY_ID).getSheetByName('WORK'), 'Version-history copy WORK'); }
    catch (e) { Logger.log('Could not open the copy ' + RECOVER_FROM_COPY_ID + ': ' + e.message); }
  }

  targets.forEach(function(r){
    const email = norm_(vals[r][iEmail]), classId = vals[r][iClass], name = String(vals[r][iName] || '');
    const currentJson = storedWorkJson_(vals[r], h);
    const current = parseJson_(currentJson, null) || salvageStateJson_(currentJson);
    Logger.log('================================================================');
    Logger.log(name + ' <' + email + '>  current copy: ' + currentJson.length + ' characters, saved ' + vals[r][iAt]);
    Logger.log('  NOW:    ' + workSummary_(current));
    submissionSummary_(current).forEach(function(x){ Logger.log('          ' + x); });
    let merged = current;
    const copies = [current];
    const mine = sources.filter(function(s){ return s.email === email && s.classId === classId; });
    if (!mine.length) Logger.log('  No other copies found (no WORK_BACKUP rows' + (RECOVER_FROM_COPY_ID ? ' and nothing in the copy' : '; try RECOVER_FROM_COPY_ID') + ').');
    mine.forEach(function(s){
      const exact = parseJson_(s.json, null);
      const got = exact || salvageStateJson_(s.json);
      Logger.log('  Source ' + s.label + ' (' + s.at + ', ' + s.json.length + ' chars, ' + (exact ? 'readable' : 'damaged - salvaged') + '): ' + workSummary_(got));
      // Navigation and class settings always come from the current copy, and
      // so does any writing the student has now: recovery only FILLS GAPS, so
      // it can never overwrite a newer revision or un-match a submission.
      Object.keys(STATE_TAKE_INCOMING).forEach(function(k){ if (k.indexOf('.') === -1) delete got[k]; });
      copies.push(JSON.parse(JSON.stringify(got)));   // whole copy: may hold the exact submitted text
      pruneToGaps_(got, merged);
      merged = mergeStudentState_(got, merged).state;
    });
    keepSubmittedText_(merged, copies);
    Logger.log('  AFTER:  ' + workSummary_(merged));
    if (!mine.length) return;
    if (!doCommit) { Logger.log('  (Nothing changed. Set RECOVER_COMMIT = true and run again to put this back.)'); return; }
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      backupWorkRow_(classId, email, name, currentJson, String(vals[r][iAt] || ''), 'before recoverStudentWork');
      const fresh = sh.getDataRange().getValues(), fh = fresh[0];
      const row = fresh.findIndex(function(x, i){ return i > 0 && x[fh.indexOf('classId')] === classId && norm_(x[fh.indexOf('studentEmail')]) === email; });
      if (row < 1) throw new Error('Row disappeared.');
      writeWorkJson_(sh, fh, row + 1, JSON.stringify(merged));
      sh.getRange(row + 1, fh.indexOf('updatedAt') + 1).setValue(new Date().toISOString());
      Logger.log('  RESTORED. Ask the student to reload the app; their browser merges with this copy.');
    } finally { lock.releaseLock(); }
  });
}

// Remove from a recovered copy everything the current copy already has.
function pruneToGaps_(got, current){
  const has = function(v){ return !stateValueEmpty_(v); };
  ['dok','dokMeta','activityResponses'].forEach(function(k){
    if (!got[k] || typeof got[k] !== 'object') return;
    Object.keys(got[k]).forEach(function(x){ if (current[k] && has(current[k][x])) delete got[k][x]; });
  });
  if (got.answers && current.answers) Object.keys(got.answers).forEach(function(x){
    const a = current.answers[x], b = got.answers[x];
    if (Array.isArray(a) && a.length && !(Array.isArray(b) && b.length > a.length)) delete got.answers[x];
  });
  if (has(current.evidence)) delete got.evidence;
  if (got.essay && current.essay) {
    ['thesis','intro','conclusion','rebuttal','theme'].forEach(function(f){ if (has(current.essay[f])) delete got.essay[f]; });
    if (Array.isArray(current.essay.bodies) && current.essay.bodies.some(function(b){ return String(b || '').trim(); })) delete got.essay.bodies;
    delete got.essay.submissions; delete got.essay.writingMeta; delete got.essay.step;
  }
}

function workSummary_(s){
  s = s || {};
  const parts = [];
  [1,2,3,4,5].forEach(function(a){
    let mc = 0, w = 0, n = 0;
    Object.keys(SCENE_META).forEach(function(k){
      if (SCENE_META[k].act !== a) return;
      n++;
      if (mcScoreFor_((s.answers || {})[k], SCENE_META[k].correctIdx) !== null) mc++;
      if (String((s.dok || {})[k] || '').trim()) w++;
    });
    parts.push('Act ' + a + ' ' + mc + '/' + w + '/' + n);
  });
  return parts.join(', ') + ' (MC/written/scenes); evidence ' + ((s.evidence || []).length) + '; essay ' + wordCount_(essayAssembledText_(essayOf_(s))) + ' words';
}

// For each essay step: did the student press Submit, and is what they
// submitted still exactly what is saved? A submission counts only while the
// text matches it, so "submitted, but changed since" means the teacher's
// screen shows it as a draft.
function submissionSummary_(s){
  const subs = (essayOf_(s).submissions) || {};
  return ['thesis','body','intro','conclusion',ESSAY_FINAL_KEY].map(function(k){
    const rec = subs[k] || null;
    const label = k === ESSAY_FINAL_KEY ? 'Final essay' : (ESSAY_STEP_LABELS[k] || k);
    if (!rec || !rec.sig) return label + ': never submitted';
    const st = essaySubmissionStatus_(s, k, []);
    return label + ': submitted ' + String(rec.submittedAt || '?') + (st.submitted ? ' - matches what is saved' : ' - BUT the saved text has changed since, so it shows as a draft');
  });
}

// Read as much as possible out of a damaged saved copy. Each top-level part
// (answers, dok, evidence, essay, ...) is read on its own, and a part that is
// itself damaged is read entry by entry, so one broken spot costs only the
// entry it is in.
function salvageStateJson_(json){
  json = String(json || '');
  let out = salvageObjectText_(json, 0);
  out = out && typeof out === 'object' ? out : {};
  // A broken quote early on throws the reading of everything after it out of
  // step. So also find each part by its name and read it from there, and read
  // the scene responses and essay paragraphs one by one; then keep the better
  // of the two readings for every piece.
  const anchored = anchoredSalvage_(json);
  return mergeStudentState_(out, anchored).state;
}
function salvageStringAt_(json, pos){   // pos = index of the opening quote of a JSON string
  const end = scanString_(json, pos);
  const raw = json.slice(pos + 1, end < 0 ? json.length : end);
  try { return JSON.parse('"' + raw + '"'); } catch (e) {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}
function anchoredSalvage_(json){
  const names = ['answers','dok','dokMeta','evidence','essay','activityResponses'];
  const at = {};
  names.forEach(function(n){ const i = json.indexOf('"' + n + '":'); if (i !== -1) at[n] = i; });
  const starts = Object.keys(at).map(function(n){ return at[n]; }).sort(function(a,b){ return a - b; });
  const regionOf = function(n){
    const a = at[n];
    const b = starts.find(function(x){ return x > a; });
    return json.slice(a + n.length + 3, b === undefined ? json.length : b);
  };
  const out = {};
  Object.keys(at).forEach(function(n){
    const text = regionOf(n).trim();
    try {
      if (text.charAt(0) === '{') out[n] = salvageObjectText_(text, 1);
      else if (text.charAt(0) === '[') out[n] = salvageArrayText_(text);
    } catch (e) {}
  });
  // Scene-by-scene: written responses and multiple-choice attempts.
  if (at.dok !== undefined) {
    const t = regionOf('dok'), re = /"(\d\.\d{1,2})":"/g;
    let m; out.dok = out.dok && typeof out.dok === 'object' ? out.dok : {};
    while ((m = re.exec(t))) {
      const v = salvageStringAt_(t, m.index + m[0].length - 1);
      if (v && (!out.dok[m[1]] || String(out.dok[m[1]]).length < v.length)) out.dok[m[1]] = v;
    }
  }
  if (at.answers !== undefined) {
    const t = regionOf('answers'), re = /"(\d\.\d{1,2})":\[([0-9,\s]*)\]/g;
    let m; out.answers = out.answers && typeof out.answers === 'object' ? out.answers : {};
    while ((m = re.exec(t))) {
      const picks = m[2].split(',').map(function(x){ return x.trim(); }).filter(Boolean).map(Number);
      if (picks.length && (!Array.isArray(out.answers[m[1]]) || out.answers[m[1]].length < picks.length)) out.answers[m[1]] = picks;
    }
  }
  // Essay paragraphs, one by one.
  if (at.essay !== undefined) {
    const t = regionOf('essay');
    out.essay = out.essay && typeof out.essay === 'object' ? out.essay : {};
    ['thesis','intro','conclusion','rebuttal','theme'].forEach(function(k){
      const i = t.indexOf('"' + k + '":"');
      if (i === -1) return;
      const v = salvageStringAt_(t, i + k.length + 3);
      if (v && String(out.essay[k] || '').length < v.length) out.essay[k] = v;
    });
    const bi = t.indexOf('"bodies":[');
    if (bi !== -1) {
      const bodies = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      re.lastIndex = bi + 10;
      let m;
      while ((m = re.exec(t)) && bodies.length < 8) {
        bodies.push(salvageStringAt_(t, m.index));
        const after = t.slice(re.lastIndex).replace(/^\s+/, '');
        if (after.charAt(0) !== ',') break;
      }
      if (bodies.length && (!Array.isArray(out.essay.bodies) || out.essay.bodies.join('').length < bodies.join('').length)) out.essay.bodies = bodies;
    }
  }
  return out;
}
function salvageObjectText_(text, depth){
  try { return JSON.parse(text); } catch (e) {}
  const out = {};
  if (depth > 3) return out;
  const members = splitTopMembers_(text);
  members.forEach(function(m){
    let v;
    try { v = JSON.parse(m.value); }
    catch (e) {
      const t = m.value.trim();
      if (t.charAt(0) === '{') v = salvageObjectText_(t, depth + 1);
      else if (t.charAt(0) === '[') v = salvageArrayText_(t);
      else if (t.charAt(0) === '"') v = salvageJsonString_('"x":' + t, '"x":"');
      else return;
    }
    if (v !== undefined && v !== null) out[m.key] = v;
  });
  return out;
}
function salvageArrayText_(text){
  const out = [];
  splitTopItems_(text).forEach(function(item){
    try { out.push(JSON.parse(item)); }
    catch (e) { const t = item.trim(); if (t.charAt(0) === '{') { const o = salvageObjectText_(t, 2); if (Object.keys(o).length) out.push(o); } }
  });
  return out;
}
// Splits '{"a":1,"b":{...},...}' into its top-level key/value texts, tracking
// strings and nesting. Stops cleanly at the end of the text if it is cut off.
function splitTopMembers_(text){
  const out = [];
  let i = text.indexOf('{');
  if (i === -1) return out;
  i++;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text.charAt(i))) i++;
    if (text.charAt(i) !== '"') break;
    const keyEnd = scanString_(text, i);
    if (keyEnd < 0) break;
    let key;
    try { key = JSON.parse(text.slice(i, keyEnd + 1)); } catch (e) { break; }
    let j = keyEnd + 1;
    while (j < text.length && /\s/.test(text.charAt(j))) j++;
    if (text.charAt(j) !== ':') break;
    j++;
    const end = scanValue_(text, j);
    out.push({key: key, value: text.slice(j, end)});
    i = end;
    if (text.charAt(i) === '}') break;
  }
  return out;
}
function splitTopItems_(text){
  const out = [];
  let i = text.indexOf('[');
  if (i === -1) return out;
  i++;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text.charAt(i))) i++;
    if (i >= text.length || text.charAt(i) === ']') break;
    const end = scanValue_(text, i);
    if (end <= i) break;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}
function scanString_(text, i){   // i at the opening quote; returns index of closing quote, or -1
  for (let j = i + 1; j < text.length; j++) {
    const ch = text.charAt(j);
    if (ch === '\\') { j++; continue; }
    if (ch === '"') return j;
  }
  return -1;
}
function scanValue_(text, i){    // returns the index just past the value starting at i
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text.charAt(j);
    if (ch === '"') { const e = scanString_(text, j); if (e < 0) return text.length; j = e; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { if (depth === 0) return j; depth--; if (depth === 0) return j + 1; }
    else if (ch === ',' && depth === 0) return j;
  }
  return text.length;
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
