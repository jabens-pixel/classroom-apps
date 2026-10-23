const GATSBY_DB_PROP = 'GATSBY_DB_ID';
const SHEETS = {
  USERS: ['email','name','role','status','createdAt','updatedAt'],
  CLASSES: ['classId','teacherEmail','className','period','joinCode','settingsJson','active','createdAt','updatedAt'],
  ENROLL: ['classId','studentEmail','studentName','joinedAt','active'],
  WORK: ['classId','studentEmail','studentName','stateJson','updatedAt'],
  DISCUSS: ['postId','classId','studentEmail','studentName','text','createdAt'],
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
  // 'essayRubric' (one row per criterion of the finished essay: Meaning,
  // Style, Form, Conventions). Same row shape for all four; only the set of
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
const ESSAY_CRITERIA = ['Meaning','Style','Form','Conventions'];
const ESSAY_CRITERION_MAX = 7;
// Points per level of the four-criterion rubric, best first -- matching the band
// headings the students see on the self-evaluation step ("7 to >6 pts", ...).
const ESSAY_CRITERION_POINTS = [7,6,5,4,1];
const ESSAY_FINAL_KEY = 'final';

function essayStepPoints_(key) { return key === 'thesis' ? ESSAY_THESIS_POINTS : ESSAY_RUBRIC_MAX; }
function essayFinalPoints_() { return ESSAY_CRITERIA.length * ESSAY_CRITERION_MAX; }

// Mirrors GatsbyData.html's CHAPTERS/QUESTIONS (client-side only) just enough
// for server-side total calculations: which chapter each key belongs to, and
// the correct multiple-choice option index, so a student's raw picks can be
// scored the same way AppLogic.html's answerInfo() scores them on screen.
// If a chapter's MC question or its correct answer ever changes in
// GatsbyData.html, update the matching entry here too.
// Keys stay in the "act.scene" shape Macbeth used (scene is always 1 here --
// this novel has 9 chapters and no sub-scene structure) so every place that
// groups/sorts by "act" keeps working unchanged; "act" below just means
// "chapter number."
const SCENE_META = {
  '1.1':{act:1,correctIdx:1}, '2.1':{act:2,correctIdx:2}, '3.1':{act:3,correctIdx:0},
  '4.1':{act:4,correctIdx:3}, '5.1':{act:5,correctIdx:1}, '6.1':{act:6,correctIdx:2},
  '7.1':{act:7,correctIdx:3}, '8.1':{act:8,correctIdx:1}, '9.1':{act:9,correctIdx:2}
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('The Great Gatsby - American Dream, Class, Illusion')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Used by Index.html to pull in AppLogic.html and BackendClient.html as
// separate files, so no single pasted file has to be enormous.
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupGatsbyBackend() {
  const email = currentEmail_();
  if (!email) throw new Error('No Google Workspace email was detected. Run setup while signed into your school Google account.');
  let id = PropertiesService.getScriptProperties().getProperty(GATSBY_DB_PROP);
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('Gatsby Unit Backend');
    PropertiesService.getScriptProperties().setProperty(GATSBY_DB_PROP, ss.getId());
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
  const result = {ok:true, email, name:(user && user.name) || displayNameFromEmail_(email), role, accessStatus:user ? user.status : 'student', classes:[]};
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
        {posts: result.discussion.filter(function(p){ return norm_(p.email) === norm_(email); })});
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
  return {ok:true, updatedAt:res.updatedAt, merged:res.merged, kept:res.kept};
}

function saveClassSettings(payload) {
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
  const existing = parseJson_(klass.settingsJson, {});
  const settings = Object.assign(defaultClassSettings_(), existing, payload.settings || {});
  sh.getRange(rowIndex+1, headers.indexOf('settingsJson')+1).setValue(JSON.stringify(settings));
  sh.getRange(rowIndex+1, headers.indexOf('updatedAt')+1).setValue(new Date().toISOString());
  return {ok:true, settings};
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
  if (!(act >= 1 && act <= 9)) throw new Error('Chapter must be between 1 and 9.');
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
  if (ESSAY_CRITERIA.indexOf(itemKey) === -1) throw new Error('Unknown essay rubric criterion: ' + itemKey);
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
  }
  upsertGradeItem_(classId, studentEmail, enrollment.studentName, itemType, itemKey, score, excluded, comment, me.email, markedText);
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
    if (!(act >= 1 && act <= 9)) throw new Error('Chapter must be between 1 and 9.');
    const scenes = Object.keys(SCENE_META).filter(function(k){ return SCENE_META[k].act === act; });
    pairs = [];
    scenes.forEach(function(k){ pairs.push(['mc', k]); pairs.push(['dok', k]); });
    label = 'Chapter ' + act;
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
  if (!m || !Array.isArray(m.spans) || !m.spans.length) return null;
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
  if (!spans.length) return null;
  return {spans:spans, pasted:pasted, quoted:quoted, total:len, events:Number(m.events || 0)};
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
        editedAfterGrading: !!(item && editedSinceMarked_(item.markedText, (st.dok || {})[sceneKey] || '')),
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
// then scores Meaning, Style, Form and Conventions together.
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
      const base = {
        email: s.studentEmail,
        name: s.studentName,
        updatedAt: work ? work.updatedAt : '',
        text: essayTextFor_(st, isFinal ? ESSAY_FINAL_KEY : stepKey, posts).trim()
      };
      if (isFinal) {
        base.criteria = summary.essay.criteria;
        base.finalTotal = summary.essay.finalTotal;
        // The word count is the one thing a teacher always wants before opening
        // a 900-word essay, and it is cheaper to send than to compute twice.
        base.words = base.text ? base.text.split(/\s+/).filter(function(w){ return w; }).length : 0;
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
      base.submitted = rec.submitted;
      if (stepKey === 'discussion') base.posts = posts.map(function(p){ return {text:p.text, date:p.date}; });
      if (stepKey === 'body') {
        const e = essayOf_(st);
        base.bodies = essayBodies_(e).map(function(b){ return String(b || ''); });
        base.rebuttal = String(e.rebuttal || '');
        base.thesis = String(e.thesis || '');
      }
      if (stepKey === 'intro' || stepKey === 'conclusion') base.thesis = String(essayOf_(st).thesis || '');
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

// Every student's discussion posts for one class, keyed by lowercased email --
// read once and passed down, rather than once per student inside a loop.
function discussPostsByEmail_(classId) {
  const out = {};
  sheetObjects_('DISCUSS').forEach(function(r){
    if (r.classId !== classId) return;
    const k = norm_(r.studentEmail);
    (out[k] = out[k] || []).push({text:r.text, date:r.createdAt});
  });
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
  [1,2,3,4,5,6,7,8,9].forEach(a => {
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
            editedAfterGrading: !!(dokRow && editedSinceMarked_(dokRow.markedText, dokText[key] || dokText[keyOf_(key)] || '')),
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
    const submitted = String(text).trim().length > 0;
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
      editedAfterGrading: !!(row && editedSinceMarked_(row.markedText, text)),
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
  const criteria = {};
  const finalText = essayAssembledText_(e);
  const finalSubmitted = finalText.trim().length > 0;
  const finalTotal = {earned:0, possible:0, pending:0, unmarked:0, hasAnyResult:false, submitted:finalSubmitted, complete:true};
  ESSAY_CRITERIA.forEach(function(c){
    const row = itemFor('essayRubric', c);
    const excluded = !!(row && truthy_(row.excluded));
    const teacherScore = row && row.score !== '' && row.score !== null && row.score !== undefined ? Number(row.score) : null;
    let display = teacherScore, pending = false;
    if (!excluded && display === null) {
      const idx = selfEval[c];
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
      selfEvalIdx: selfEval[c] === undefined ? '' : selfEval[c],
      selfComment: (e.selfComments || {})[c] || '',
      excluded: excluded,
      possible: ESSAY_CRITERION_MAX,
      comment: row ? (row.comment || '') : '',
      gradedAt: row ? row.gradedAt : '',
      gradedBy: row ? row.gradedBy : ''
    };
    if (!excluded) {
      finalTotal.possible += ESSAY_CRITERION_MAX;
      if (teacherScore !== null) { finalTotal.earned += teacherScore; finalTotal.hasAnyResult = true; }
      else {
        finalTotal.complete = false;
        if (pending) finalTotal.pending++;
        if (finalSubmitted) finalTotal.unmarked++;
      }
    }
  });
  const editedFinal = ESSAY_CRITERIA.some(function(c){
    const row = itemFor('essayRubric', c);
    return !!(row && editedSinceMarked_(row.markedText, finalText));
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
  const acts = [1,2,3,4,5,6,7,8,9].map(function(act){
    const scenes = Object.keys(SCENE_META).filter(function(k){ return SCENE_META[k].act === act; }).sort(sceneSortKey_);
    let submitted = 0, graded = 0, needsGrading = 0, mcAnswered = 0, mcPossible = 0;
    let firstToMark = '';
    scenes.forEach(function(key){
      students.forEach(function(stu){
        const st = stateFor[norm_(stu.studentEmail)] || {};
        const text = String((st.dok || {})[key] || (st.dok || {})[keyOf_(key)] || '').trim();
        const row = itemRow('dok', key, stu.studentEmail);
        const isHandled = handled_(row);
        if (text) submitted++;
        if (isHandled) graded++;
        if (text && !isHandled) {
          needsGrading++;
          if (!firstToMark) firstToMark = key;
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
      label: 'Chapter ' + act,
      scenes: scenes.length,
      submitted: submitted, graded: graded, needsGrading: needsGrading,
      // Every scene's written response is one item, so the ceiling for both
      // counts is scenes x students -- shown as "12/25 marked", not a bare number.
      totalItems: scenes.length * students.length,
      mcAnswered: mcAnswered, mcPossible: mcPossible,
      firstToMark: firstToMark || scenes[0] || '',
      pointsPossible: pointsPossible, pointsError: pointsError,
      allExcluded: excludedForAll_(scenes.map(function(k){ return ['dok', k]; })),
      released: (parseJson_(klass.settingsJson, {}).releasedActs || []).indexOf(act) !== -1
    };
  });

  // ---- the six essay pieces ----
  const essay = ESSAY_STEP_KEYS.map(function(key){
    let submitted = 0, graded = 0, needsGrading = 0;
    students.forEach(function(stu){
      const st = stateFor[norm_(stu.studentEmail)] || {};
      const text = essayTextFor_(st, key, postsBy[norm_(stu.studentEmail)] || []).trim();
      const row = itemRow('essay', key, stu.studentEmail);
      let isHandled = handled_(row);
      // The thesis marks itself, so a drafted thesis is not on the to-do list.
      if (key === 'thesis' && text && !isHandled) isHandled = true;
      if (text) submitted++;
      if (isHandled) graded++;
      if (text && !isHandled) needsGrading++;
    });
    return {
      kind: 'essay', key: key, label: ESSAY_STEP_LABELS[key],
      submitted: submitted, graded: graded, needsGrading: needsGrading,
      totalItems: students.length,
      pointsPossible: essayStepPoints_(key),
      gradingType: key === 'thesis' ? 'pass_fail' : 'points',
      allExcluded: excludedForAll_([['essay', key]])
    };
  });

  // The finished essay is four items per student; it is only off the to-do list
  // once all four are handled, because a half-scored essay still needs you.
  let fSubmitted = 0, fGraded = 0, fNeeds = 0;
  students.forEach(function(stu){
    const st = stateFor[norm_(stu.studentEmail)] || {};
    const text = essayAssembledText_(essayOf_(st)).trim();
    const done = ESSAY_CRITERIA.every(function(c){ return handled_(itemRow('essayRubric', c, stu.studentEmail)); });
    if (text) fSubmitted++;
    if (done) fGraded++;
    if (text && !done) fNeeds++;
  });
  essay.push({
    kind: 'essay', key: ESSAY_FINAL_KEY, label: 'Final Essay',
    submitted: fSubmitted, graded: fGraded, needsGrading: fNeeds,
    totalItems: students.length,
    pointsPossible: essayFinalPoints_(),
    gradingType: 'points',
    allExcluded: excludedForAll_(ESSAY_CRITERIA.map(function(c){ return ['essayRubric', c]; }))
  });

  return {
    ok: true,
    totalStudents: students.length,
    acts: acts,
    essay: essay,
    needsGradingTotal: acts.reduce(function(n, a){ return n + (a.allExcluded ? 0 : a.needsGrading); }, 0) +
                       essay.reduce(function(n, e){ return n + (e.allExcluded ? 0 : e.needsGrading); }, 0)
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
function actGradeRows_(classId, act) {
  if (!(act >= 1 && act <= 9)) throw new Error('Chapter must be between 1 and 9.');
  const students = sheetObjects_('ENROLL').filter(r => r.classId === classId && truthy_(r.active));
  const works = sheetObjects_('WORK').filter(w => w.classId === classId);
  const allItems = sheetObjects_('GRADEITEMS').filter(g => g.classId === classId);
  if (!students.length) throw new Error('No students are enrolled in this class yet.');

  // The points this Act is out of: every scene's MC and written response,
  // EXCEPT anything excluded for every enrolled student (a class-wide exclusion).
  const pointsPossible = actPointsPossibleForClass_(act, allItems, students);
  if (!pointsPossible) throw new Error('Every question in Act ' + act + ' is excluded for the whole class, so there is nothing to send.');

  const rows = [], skipped = [], adjusted = [], unmarked = [];
  students.forEach(s => {
    const work = works.find(w => norm_(w.studentEmail) === norm_(s.studentEmail));
    const st = work ? parseJson_(work.stateJson, {}) : {};
    const itemsForStudent = allItems.filter(g => norm_(g.studentEmail) === norm_(s.studentEmail));
    const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent);
    const actTotal = summary.acts[act];
    const who = s.studentName || s.studentEmail;
    // A student who has done nothing in this Act is left BLANK, not zeroed, so
    // sending again later still fills them in and nobody is zeroed for work
    // that isn't due yet. A student who did some of it is scored out of the
    // full Act total, with the parts they skipped counting as zero.
    const hasAnyGrade = actTotal.possible > 0 && actTotal.touched;
    if (!hasAnyGrade) { skipped.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null}); return; }
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
    rows.push({email:s.studentEmail, name:s.studentName, score:value});
  });
  return {
    kind: 'act',
    act: act,
    label: 'The Great Gatsby \u2014 Chapter ' + act,
    gradingType: 'points',
    pointsPossible: pointsPossible,
    rows: rows,
    sent: rows.filter(r => r.score !== null).length,
    skipped: skipped,
    adjusted: adjusted,
    unmarked: unmarked
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
  if (!(act >= 1 && act <= 9)) throw new Error('Chapter must be between 1 and 9.');
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
  const label = 'Gatsby Essay — ' + (isFinal ? 'Final Essay' : ESSAY_STEP_LABELS[stepKey]);

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

  const rows = [], skipped = [], adjusted = [], unmarked = [];
  students.forEach(function(s){
    const work = works.find(function(w){ return norm_(w.studentEmail) === norm_(s.studentEmail); });
    const st = work ? parseJson_(work.stateJson, {}) : {};
    const itemsForStudent = allItems.filter(function(g){ return norm_(g.studentEmail) === norm_(s.studentEmail); });
    const summary = gradeSummaryForStudent_(classId, s.studentEmail, st, itemsForStudent, {posts: postsBy[norm_(s.studentEmail)] || []});
    const who = s.studentName || s.studentEmail;
    const essay = summary.essay;

    if (isFinal) {
      const t = essay.finalTotal;
      // Nothing graded yet is left BLANK, not zeroed -- the same rule as an Act.
      if (!t.hasAnyResult) { skipped.push(who); rows.push({email:s.studentEmail, name:s.studentName, score:null}); return; }
      if (t.unmarked) unmarked.push(who + ' (' + t.unmarked + ')');
      let value = t.earned;
      if (t.possible !== pointsPossible && t.possible > 0) {
        value = Math.round((t.earned / t.possible) * pointsPossible * 100) / 100;
        adjusted.push(who + ': ' + t.earned + '/' + t.possible + ' → ' + value + '/' + pointsPossible);
      }
      rows.push({email:s.studentEmail, name:s.studentName, score:value});
      return;
    }

    const rec = essay.steps[stepKey];
    // Excused for this one student: Canvas holds a single points value per
    // assignment, so there is no honest number to send. Leave it blank and say
    // so, rather than sending a zero or a full score neither of which is true.
    if (rec.excluded) { skipped.push(who + ' (excused)'); rows.push({email:s.studentEmail, name:s.studentName, score:null}); return; }
    if (rec.score === null) {
      if (rec.submitted) unmarked.push(who);
      skipped.push(who);
      rows.push({email:s.studentEmail, name:s.studentName, score:null});
      return;
    }
    rows.push({email:s.studentEmail, name:s.studentName, score:rec.score});
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
    unmarked: unmarked
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
    ? ('Gatsby Chapter ' + ref.act + ' - MC + Written Response')
    : data.label.replace(/\u2014/g, '-');
  const rows = [
    ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', headerTitle],
    ['    Points Possible', '', '', '', '', data.pointsPossible]
  ];
  data.rows.forEach(r => rows.push([r.name, '', '', r.email, '', r.score === null ? '' : r.score]));

  return {
    ok: true,
    filename: csvSafeName_(klass.className + ' - ' + (ref.kind === 'act' ? 'Chapter ' + ref.act : data.label.replace(/\u2014/g, '-')) + ' Grades') + '.csv',
    content: rows.map(row => row.map(csvCell_).join(',')).join('\n'),
    sent: data.sent,
    skipped: data.skipped,
    pointsPossible: data.pointsPossible,
    adjusted: data.adjusted,
    unmarked: data.unmarked
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
  return String(value || 'Gatsby Grades').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function postThesisDiscussion(payload) {
  const email = currentEmail_();
  payload = payload || {};
  const classId = String(payload.classId || '');
  const text = String(payload.text || '').trim();
  if (!isEnrolled_(classId, email)) throw new Error('You are not enrolled in this class.');
  if (!text) throw new Error('Write a thesis before posting.');
  const enroll = sheetObjects_('ENROLL').find(r => r.classId === classId && norm_(r.studentEmail) === norm_(email));
  appendRow_('DISCUSS', [Utilities.getUuid(), classId, email, enroll ? enroll.studentName : displayNameFromEmail_(email), text, new Date().toISOString()]);
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

// releasedEssayThrough is the id of the LAST essay stage a student can open.
// 'self' is the last stage, so the default is the whole essay open -- which is
// what every class that existed before this setting should keep getting.
function defaultClassSettings_(){ return {releasedActs:[1],releasedScenes:{},releasedEssayThrough:'self',teacherResources:true,modernSupport:true,canvas:{courseId:'',courseName:'',assignmentGroupId:'',assignmentGroupName:'',assignments:{}},assignmentSchedule:{}}; }
function sanitizeClassSettingsForStudent_(s){ return {releasedActs:s.releasedActs||[1],releasedScenes:s.releasedScenes||{},releasedEssayThrough:s.releasedEssayThrough||'self',teacherResources:s.teacherResources!==false}; }
function getStudentWork_(classId,email){
  const w=sheetObjects_('WORK').find(r=>r.classId===classId&&norm_(r.studentEmail)===norm_(email));
  return w ? {state:parseJson_(w.stateJson,{}), updatedAt:String(w.updatedAt||'')} : {state:{}, updatedAt:''};
}
function getStudentState_(classId,email){ return getStudentWork_(classId,email).state; }
function getClassDiscussion_(classId){ return sheetObjects_('DISCUSS').filter(r=>r.classId===classId).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(r=>({id:r.postId,name:r.studentName,email:r.studentEmail,text:r.text,date:r.createdAt})); }
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
function respFingerprint_(text){
  const t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  if (!t) return '';
  return t.length + ':' + md5Hex_(t).slice(0, 10);
}
function editedSinceMarked_(markedText, currentText){
  const stored = String(markedText || '').trim();
  if (!stored) return false;              // marked before this was recorded, or nothing to compare
  return stored !== respFingerprint_(currentText);
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

function ensureDb_(){ if(!PropertiesService.getScriptProperties().getProperty(GATSBY_DB_PROP)) throw new Error('Backend is not initialized. Run setupGatsbyBackend() once from the Apps Script editor.'); }
function db_(){ ensureDb_(); return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(GATSBY_DB_PROP)); }
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
function sheetObjects_(name){ const sh=db_().getSheetByName(name); if(!sh||sh.getLastRow()<2)return[]; const vals=sh.getDataRange().getValues(); const h=vals.shift(); return vals.filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]]))); }
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
  return {state: state, kept: kept};
}
function mergeStateNode_(a, b, path, kept){   // a = what is stored, b = what arrived
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
      if (storedUpdatedAt && String(baseUpdatedAt||'') !== storedUpdatedAt){
        const merged = mergeStudentState_(parseJson_(vals[row][h.indexOf('stateJson')],{}), state);
        state = merged.state; kept = merged.kept;
      }
      sh.getRange(row+1,h.indexOf('studentName')+1).setValue(name); sh.getRange(row+1,h.indexOf('stateJson')+1).setValue(JSON.stringify(state)); sh.getRange(row+1,h.indexOf('updatedAt')+1).setValue(now); }
    else sh.appendRow([classId,email,name,JSON.stringify(state),now]);
    return {updatedAt:now, merged:kept.length>0, kept:kept.slice(0,40)};
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
  release: 'gatsby-2026-10-23 (choose the Canvas assignment group per assignment)',
  files: {
    Index:         {chars: 32279, md5: 'df94a95f6ebade6e2cbfed58d60db039', md5ws: '6e6af05eeff91ae547faf32876c72047'},
    Images:        {chars: 13918, md5: '8d0d5181cab31be8c468c7a1a79c4577', md5ws: 'b93b29a2b579341f4bebe61b3a0d9d49'},
    GatsbyData:    {chars: 27435, md5: '67c46495537e1ecb8b17a212b2699240', md5ws: '160907ad05624e7d088d54e6d6945720'},
    AppLogic:      {chars: 94652, md5: '40dfb4871c63008e9a1454dcc4cffe4c', md5ws: 'c379f3ece8f324b8ab332402973020a8'},
    BackendClient: {chars: 183767, md5: 'a1709b5a1d4b0898a6a6e9360bf39a0a', md5ws: '675a602ad0b779192f6771cdd9d40d27'}
  },
  // Unlike Macbeth, no pasted file here stores the novel's own text (the
  // teacher pastes that separately into Index.html's storyTextStore, which
  // this fingerprint check does not cover), so no file needs the stricter
  // spacing-sensitive check Macbeth used for PlayData. A spacing-only reflow
  // in any file here is harmless.
  whitespaceMatters: {}
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
    // Same code, different spacing -- the editor reflowed the paste. Harmless in
    // every file here: unlike Macbeth's PlayData, none of these five files store
    // the novel's own text (that lives in Index.html's storyTextStore, which this
    // fingerprint check deliberately does not cover), so no file is spacing-
    // sensitive. whitespaceMatters is kept below only so a future file that DOES
    // need the stricter check has somewhere to be added.
    if (want.md5ws && got.md5ws === want.md5ws && !FILE_FINGERPRINTS.whitespaceMatters[name]) {
      Logger.log('OK*      ' + name + '  ' + got.chars + ' characters -- every character except spacing is identical. Nothing to do.');
      return;
    }
    bad.push(name);
    if (want.md5ws && got.md5ws === want.md5ws) {
      Logger.log('SPACING  ' + name + '  the text matches but its line breaks moved, and this file is listed in ' +
                 'whitespaceMatters as one where that matters -- re-paste it.');
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
//     this app on "Loading Gatsby..." forever: the consent dialog renders
//     inside the app's sandboxed iframe and cannot be completed. Authorize it
//     from a plain editor tab FIRST, by running testCanvasSetup() below, and
//     only then deploy. SETUP_BACKEND.md spells out the order.
// ===========================================================================
const CANVAS_BASE_URL_USER_PROP = 'GATSBY_CANVAS_BASE_URL';
const CANVAS_TOKEN_USER_PROP = 'GATSBY_CANVAS_TOKEN';

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
    lastGradeSyncAt: old.lastGradeSyncAt || ''
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
  const canvasStudents = canvasCourseStudents_(c.courseId);
  const form = {}, unmatched = [];
  let sent = 0;
  data.rows.forEach(function(r){
    if (r.score === null || r.score === undefined) return;   // nothing done yet: leave Canvas alone
    const u = canvasMatchStudent_(r.email, canvasStudents);
    if (!u) { unmatched.push((r.name || r.email) + ' (' + r.email + ')'); return; }
    // A complete/incomplete assignment takes the words, not a number.
    form['grade_data[' + u.id + '][posted_grade]'] =
      data.gradingType === 'pass_fail' ? (Number(r.score) > 0 ? 'complete' : 'incomplete') : String(r.score);
    sent++;
  });
  let progress = null;
  if (sent) {
    progress = canvasRequest_('post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId) + '/submissions/update_grades', form);
  }
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
    pointsPossible: data.pointsPossible,
    unmatched: unmatched,
    skipped: data.skipped,
    adjusted: data.adjusted,
    unmarked: data.unmarked,
    assignment: link,
    sharedWith: sharedWith,
    pointsConflict: pointsConflict,
    progressUrl: progress && progress.url ? progress.url : ''
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
  // passes one silently writes "Read Chapter [object Object]" into Canvas.
  if (typeof ref === 'number' || typeof ref === 'string') ref = {kind:'act', key:String(ref), act:Number(ref)};
  const url = appWebUrl_();
  const intro = ref.kind === 'essay'
    ? '<p>' + ESSAY_CANVAS_BLURB[ref.key] + ' Your teacher marks your work in the Gatsby app and the score is synced back to Canvas.</p>'
    : '<p>Read Chapter ' + ref.act + ' and answer its questions in the Gatsby app. ' +
      'Your teacher marks your work there and the score is synced back to Canvas.</p>';
  if (!url) return intro;
  return intro + '<p><a href="' + url + '" target="_blank" rel="noopener"><strong>Open the Gatsby app</strong></a></p>' +
    '<p><small>Sign in with your school Google account.</small></p>';
}
// What each essay assignment asks students to do, in the Canvas description.
const ESSAY_CANVAS_BLURB = {
  thesis: 'Draft your thesis on Step 1 of the Writing Workshop: an arguable claim about whether the American Dream in this novel is alive, dead, or corrupted.',
  discussion: 'Post your thesis to the class discussion on Step 2 of the Writing Workshop, and respond to what your classmates posted.',
  body: 'Write your three body paragraphs on Step 3 of the Writing Workshop — plus the optional counterargument paragraph if you want it.',
  intro: 'Write your introduction on Step 4 of the Writing Workshop, ending on your thesis.',
  conclusion: 'Write your conclusion on Step 5 of the Writing Workshop.',
  final: 'Assemble and submit your finished essay in the Writing Workshop. It is scored on Meaning, Style, Form and Conventions — the same four-criterion rubric you use for your self-evaluation.'
};

// Whether an assignment should be published (visible to students) in Canvas.
// An Act follows its release toggle. The essay has no release toggle, so its
// assignments are published as soon as the teacher sets them up -- which is the
// only reason to set one up.
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
  [1,2,3,4,5,6,7,8,9].forEach(function(a){ add({kind:'act', key:String(a), act:a}, 'Chapter ' + a, 'Reading'); });
  ESSAY_STEP_KEYS.forEach(function(k){ add({kind:'essay', key:k}, ESSAY_STEP_LABELS[k], 'Essay'); });
  add({kind:'essay', key:ESSAY_FINAL_KEY}, 'Final Essay', 'Essay');
  return {ok:true, assignments:out, canvas:c};
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
