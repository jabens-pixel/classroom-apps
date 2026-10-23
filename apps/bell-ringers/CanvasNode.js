/**
 * SchEnglish Bell Ringers — Canvas Node + Assessment Hub
 * Build 2026.10.19.2
 *
 * ADD this as a NEW script file named CanvasNode (File > + > Script).
 * Do not paste it into Code.gs. It only ADDS functions; it does not change
 * any existing Bell Ringer function, sheet column, or student save path.
 *
 * Ported from the Macbeth unit's Canvas layer (which came from Short Story
 * Lab, where it runs in production). The same two rules carry over:
 *
 *  1. Each teacher's Canvas token is kept in Apps Script user properties,
 *     filed under that teacher's own signed-in email. It is never written
 *     to the backend spreadsheet and never sent to the browser.
 *  2. Canvas calls use UrlFetchApp (the script.external_request scope). This
 *     project already has that scope because Writing Coach calls Gemini, so
 *     no new permission is needed. If you ever see "Loading…" hang after an
 *     update, run brCanvasSetupTest() once from the editor, then redeploy.
 *
 * Everything this file stores goes in ONE new tab, CANVAS_LINKS, created the
 * first time it is needed. The class's canvasCourseId column and each
 * assignment's canvasAssignmentId / dueAt columns are also kept in step so
 * CSV exports and older screens see the same values.
 */

const BR_CANVAS_NODE_VERSION = '2026.10.19.2';
const BR_CANVAS_BASE_URL_USER_PROP = 'SCHENGLISH_BR_CANVAS_BASE_URL';
const BR_CANVAS_TOKEN_USER_PROP = 'SCHENGLISH_BR_CANVAS_TOKEN';
const BR_CANVAS_SHEET = 'CANVAS_LINKS';
const BR_CANVAS_HEADERS = ['scope', 'key', 'classId', 'json', 'updatedAt'];
const BR_POINTS = 5;

// Run once from the Apps Script editor if Canvas calls ever report a missing
// permission. It makes one harmless outbound request so the consent prompt
// appears in the editor, where it can be completed.
function brCanvasSetupTest() {
  const res = UrlFetchApp.fetch('https://www.instructure.com/robots.txt', {muteHttpExceptions: true});
  Logger.log('External requests are authorized. HTTP ' + res.getResponseCode() + '.');
  const conn = brCanvasConnection_();
  Logger.log(conn.connected ? 'A Canvas token is saved for ' + brRequireEmail_() + '.' : 'No Canvas token saved yet. Connect one from Assessment > Canvas in the app.');
  return {ok: true, canvasNode: BR_CANVAS_NODE_VERSION};
}

function pingBrCanvasNode() {
  return {ok: true, canvasNode: BR_CANVAS_NODE_VERSION};
}

// ---------------------------------------------------------------------------
// Storage: one small tab, key/value JSON per class and per assignment.
// ---------------------------------------------------------------------------
function brCanvasSheet_(ss) {
  let sh = ss.getSheetByName(BR_CANVAS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BR_CANVAS_SHEET);
    sh.getRange(1, 1, 1, BR_CANVAS_HEADERS.length).setValues([BR_CANVAS_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function brCanvasAll_(ss) {
  const sh = brCanvasSheet_(ss);
  const lr = sh.getLastRow();
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, BR_CANVAS_HEADERS.length).getValues().map(function (r, i) {
    let data = {};
    try { data = JSON.parse(String(r[3] || '{}')); } catch (e) { data = {}; }
    return {row: i + 2, scope: String(r[0]), key: String(r[1]), classId: String(r[2]), data: data};
  });
}
function brCanvasGet_(ss, scope, key, all) {
  const hit = (all || brCanvasAll_(ss)).find(function (x) { return x.scope === scope && x.key === String(key); });
  return hit ? hit.data : null;
}
function brCanvasPut_(ss, scope, key, classId, data) {
  const lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine) lock.waitLock(10000);
  try {
    const sh = brCanvasSheet_(ss);
    const hit = brCanvasAll_(ss).find(function (x) { return x.scope === scope && x.key === String(key); });
    const row = [scope, String(key), String(classId || ''), JSON.stringify(data || {}), brNow_()];
    if (hit) sh.getRange(hit.row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
  } finally {
    if (mine) lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Connection (per teacher)
// ---------------------------------------------------------------------------
function brCanvasNormalizeBaseUrl_(value) {
  let s = String(value || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Enter your Canvas address, for example https://yourschool.instructure.com.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https:\/\//i.test(s)) throw new Error('Canvas must use an https:// address.');
  return s.replace(/\/api\/v1$/i, '');
}
// The web app runs as the app owner, so "user properties" belong to the
// owner for every visitor. Each teacher's token is therefore filed under a
// key derived from that teacher's own signed-in email: one teacher can never
// read or overwrite another teacher's Canvas connection.
function brCanvasPropKeys_() {
  const email = brRequireEmail_();
  const id = brCanvasHash_('schenglish-br-canvas:' + email).slice(0, 24);
  return {baseUrl: BR_CANVAS_BASE_URL_USER_PROP + '__' + id, token: BR_CANVAS_TOKEN_USER_PROP + '__' + id};
}
function brCanvasConnection_() {
  const p = PropertiesService.getUserProperties();
  const k = brCanvasPropKeys_();
  const baseUrl = String(p.getProperty(k.baseUrl) || '').trim();
  const token = String(p.getProperty(k.token) || '').trim();
  return {baseUrl: baseUrl, token: token, connected: !!(baseUrl && token)};
}
function brCanvasErrorMessage_(body, fallback) {
  try {
    const j = JSON.parse(String(body || ''));
    if (Array.isArray(j.errors) && j.errors.length) return j.errors.map(function (e) { return e.message || e.error || String(e); }).join('; ');
    if (j.message) return j.message;
    if (j.error) return typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
  } catch (e) {}
  return String(body || fallback || 'Canvas request failed.').slice(0, 700);
}
function brCanvasRequestWith_(conn, method, path, payload) {
  if (!conn || !conn.baseUrl || !conn.token) throw new Error('Canvas is not connected for this teacher yet.');
  const url = /^https:\/\//i.test(path) ? path : conn.baseUrl + path;
  // Never send the token anywhere except the Canvas host this teacher set.
  if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected URL.');
  const opt = {
    method: String(method || 'get').toLowerCase(),
    headers: {Authorization: 'Bearer ' + conn.token, Accept: 'application/json'},
    muteHttpExceptions: true,
    followRedirects: true
  };
  if (payload && Object.keys(payload).length) opt.payload = payload;
  const res = UrlFetchApp.fetch(url, opt);
  const status = res.getResponseCode();
  const body = res.getContentText();
  if (status < 200 || status >= 300) {
    const err = new Error('Canvas ' + status + ': ' + brCanvasErrorMessage_(body));
    err.canvasStatus = status;
    throw err;
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch (e) { return {raw: body}; }
}
function brCanvasRequest_(method, path, payload) {
  return brCanvasRequestWith_(brCanvasConnection_(), method, path, payload);
}

function getBrCanvasStatus() {
  const ss = brDb_();
  brRequireTeacher_(ss);
  const conn = brCanvasConnection_();
  const appLink = brAppLinkInfo_();
  if (!conn.connected) return brSafe_({ok: true, connected: false, canvasNode: BR_CANVAS_NODE_VERSION, appLink: appLink});
  try {
    const profile = brCanvasRequestWith_(conn, 'get', '/api/v1/users/self/profile');
    return brSafe_({ok: true, connected: true, valid: true, baseUrl: conn.baseUrl, canvasNode: BR_CANVAS_NODE_VERSION, appLink: appLink,
      profile: {name: profile.name || profile.short_name || '', email: profile.primary_email || ''}});
  } catch (e) {
    return brSafe_({ok: true, connected: true, valid: false, baseUrl: conn.baseUrl, canvasNode: BR_CANVAS_NODE_VERSION, appLink: appLink, message: e.message});
  }
}

function saveBrCanvasConnection(payload) {
  const ss = brDb_();
  brRequireTeacher_(ss);
  payload = payload || {};
  const existing = brCanvasConnection_();
  const baseUrl = brCanvasNormalizeBaseUrl_(payload.baseUrl || existing.baseUrl);
  const token = String(payload.token || existing.token || '').trim();
  if (!token) throw new Error('Paste a Canvas access token. It is stored privately against your own Google account.');
  // Prove the token works before saving it.
  const profile = brCanvasRequestWith_({baseUrl: baseUrl, token: token}, 'get', '/api/v1/users/self/profile');
  const p = PropertiesService.getUserProperties();
  const k = brCanvasPropKeys_();
  p.setProperty(k.baseUrl, baseUrl);
  p.setProperty(k.token, token);
  let hubNote = '';
  if (brHubEnabled_()) {
    try { LmsHub.saveConnection({platform: 'canvas', baseUrl: baseUrl, token: token}); hubNote = 'Also saved in the LMS Hub.'; }
    catch (e) { hubNote = 'Saved here; the LMS Hub will get it on the next push (' + (e.message || e) + ').'; }
  }
  return brSafe_({ok: true, connected: true, valid: true, baseUrl: baseUrl, hubNote: hubNote,
    profile: {name: profile.name || profile.short_name || '', email: profile.primary_email || ''}});
}

function clearBrCanvasConnection() {
  const ss = brDb_();
  brRequireTeacher_(ss);
  const p = PropertiesService.getUserProperties();
  const k = brCanvasPropKeys_();
  p.deleteProperty(k.baseUrl);
  p.deleteProperty(k.token);
  return brSafe_({ok: true, connected: false});
}

function listBrCanvasCourses() {
  const ss = brDb_();
  brRequireTeacher_(ss);
  const rows = brCanvasRequest_('get', '/api/v1/courses?enrollment_type=teacher&enrollment_state=active&per_page=100&include[]=term');
  return brSafe_({ok: true, courses: (Array.isArray(rows) ? rows : []).map(function (c) {
    return {id: String(c.id), name: c.name || c.course_code || ('Course ' + c.id), courseCode: c.course_code || '', term: (c.term && c.term.name) || ''};
  })});
}

function listBrCanvasAssignmentGroups(payload) {
  const ss = brDb_();
  brRequireTeacher_(ss);
  const courseId = String((payload || {}).courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course first.');
  const rows = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100');
  return brSafe_({ok: true, groups: (Array.isArray(rows) ? rows : []).map(function (g) { return {id: String(g.id), name: g.name || ('Group ' + g.id)}; })});
}

// ---------------------------------------------------------------------------
// Class <-> Canvas course link
// ---------------------------------------------------------------------------
function brCanvasClassLink_(ss, cls, all) {
  const stored = brCanvasGet_(ss, 'class', cls.classId, all) || {};
  // Older builds saved a bare course ID on the class row. Honour it.
  if (!stored.courseId && cls.canvasCourseId) stored.courseId = String(cls.canvasCourseId);
  return {
    courseId: String(stored.courseId || ''),
    courseName: String(stored.courseName || ''),
    assignmentGroupId: String(stored.assignmentGroupId || ''),
    assignmentGroupName: String(stored.assignmentGroupName || '')
  };
}

function linkBrCanvasCourse(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, payload.classId, teacher);
  const courseId = String(payload.courseId || '');
  if (!courseId) throw new Error('Choose a Canvas course.');
  const course = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId));
  const groupId = String(payload.assignmentGroupId || '');
  let groupName = '';
  if (groupId) {
    const g = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(groupId));
    groupName = g.name || '';
  }
  const link = {courseId: courseId, courseName: course.name || '', assignmentGroupId: groupId, assignmentGroupName: groupName};
  brCanvasPut_(ss, 'class', cls.classId, cls.classId, link);
  brUpdateByKey_(ss, 'CLASSES', 'classId', cls.classId, {
    canvasBaseUrl: brCanvasConnection_().baseUrl || cls.canvasBaseUrl || '',
    canvasCourseId: courseId,
    updatedAt: brNow_()
  });
  return brSafe_({ok: true, canvas: link});
}

function unlinkBrCanvasCourse(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  const link = {courseId: '', courseName: '', assignmentGroupId: '', assignmentGroupName: ''};
  brCanvasPut_(ss, 'class', cls.classId, cls.classId, link);
  brUpdateByKey_(ss, 'CLASSES', 'classId', cls.classId, {canvasCourseId: '', updatedAt: brNow_()});
  return brSafe_({ok: true, canvas: link});
}

// ---------------------------------------------------------------------------
// Grade rows: one place decides what each student's bell ringer is worth.
// Ported from the Macbeth unit's marking rules (2026-10-08a):
//   * Every save stores a fingerprint of the response the teacher was looking
//     at. If the student's text changes after that, the row is flagged
//     "REDONE - needs regrade" and goes to the top until it is marked again.
//   * A score wins over everything else: scoring a student who never submitted
//     files them under Graded, not Not Submitted.
//   * Excluded (per student) is its own group and is never counted or sent.
//   * Nothing marked is never sent to Canvas as a zero; it is left blank.
// ---------------------------------------------------------------------------
const BR_GRADE_SHEET = 'GRADE_SNAPSHOTS';
const BR_GRADE_HEADERS = ['key', 'assignmentId', 'classId', 'studentEmail', 'snapFp', 'snapBlank', 'excluded', 'gradedAt', 'updatedAt'];

function brHasScore_(v) { return !(v === '' || v === null || v === undefined); }
function brTime_(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
function brTextFp_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t ? brCanvasHash_(t) : '';
}
function brWords_(text) { const t = String(text || '').trim(); return t ? t.split(/\s+/).length : 0; }

function brGradeSheet_(ss) {
  let sh = ss.getSheetByName(BR_GRADE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BR_GRADE_SHEET);
    sh.getRange(1, 1, 1, BR_GRADE_HEADERS.length).setValues([BR_GRADE_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}
// Every grade record for one class, keyed "assignmentId|email".
function brGradeMeta_(ss, classId) {
  const sh = brGradeSheet_(ss), lr = sh.getLastRow(), out = {};
  if (lr < 2) return out;
  sh.getRange(2, 1, lr - 1, BR_GRADE_HEADERS.length).getValues().forEach(function (v, i) {
    if (classId && String(v[2]) !== String(classId)) return;
    out[String(v[0])] = {row: i + 2, snapFp: String(v[4] || ''), snapBlank: brBool_(v[5]), excluded: brBool_(v[6]),
      gradedAt: v[7] instanceof Date ? v[7].toISOString() : String(v[7] || '')};
  });
  return out;
}
function brGradeMetaPut_(ss, a, email, rec) {
  const lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine) lock.waitLock(10000);
  try {
    const sh = brGradeSheet_(ss), key = a.assignmentId + '|' + email;
    const now = brNow_();
    const row = [key, a.assignmentId, a.classId, email, rec.snapFp || '', rec.snapBlank ? true : false, rec.excluded ? true : false, rec.gradedAt || now, now];
    const lr = sh.getLastRow();
    let at = -1;
    if (lr >= 2) {
      const keys = sh.getRange(2, 1, lr - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { at = i + 2; break; }
    }
    if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
  } finally {
    if (mine) lock.releaseLock();
  }
}

// Rank, exactly as Macbeth sorts its marking list:
//  -1 redone since you marked it, 0 ready to grade, 1 not submitted,
//   2 graded, 3 excluded.
function brRowState_(r, meta) {
  const text = r ? String(r.text || '') : '';
  const scored = !!r && brHasScore_(r.score);
  const submitted = !!r && String(r.status || '') === 'submitted';
  const excluded = !!(meta && meta.excluded);
  let edited = false, markedBlank = false;
  if (scored && text.trim()) {
    if (meta && (meta.snapFp || meta.snapBlank)) {
      edited = brTextFp_(text) !== meta.snapFp;
      markedBlank = edited && meta.snapBlank;
    } else if (!meta) {
      // Graded before snapshots existed: fall back to "resubmitted after marking".
      edited = submitted && !!r.submittedAt && brTime_(r.submittedAt) >= brTime_(r.updatedAt);
    }
  }
  // Macbeth's rule, plus submitted work first: a score wins over everything;
  // submitted work needs grading (0); work started but NOT turned in is its
  // own group (4), after the submitted work; nothing written is Incomplete (1).
  let rank;
  if (excluded) rank = 3;
  else if (edited) rank = -1;
  else if (scored) rank = 2;
  else if (!text.trim()) rank = 1;
  else if (!submitted) rank = 4;
  else rank = 0;
  return {text: text, scored: scored, submitted: submitted, excluded: excluded, edited: edited, markedBlank: markedBlank, rank: rank,
    status: r ? String(r.status || 'none') : 'none'};
}
// Kept for anything else that only needs the simple flags.
function brResponseState_(r, meta) {
  const s = brRowState_(r, meta);
  return {scored: s.scored, submitted: s.submitted, redo: s.edited && !s.excluded, status: s.status};
}

function brAssignmentRows_(ss, a, roster, responses, meta) {
  roster = roster || brRows_(ss, 'ENROLL').filter(function (r) { return r.classId === a.classId && brBool_(r.active); });
  responses = responses || brRows_(ss, 'RESPONSES').filter(function (r) { return r.assignmentId === a.assignmentId; });
  meta = meta || brGradeMeta_(ss, a.classId);
  const map = {};
  responses.forEach(function (r) { if (r.assignmentId === a.assignmentId) map[brNormEmail_(r.studentEmail)] = r; });
  return roster.map(function (s) {
    const email = brNormEmail_(s.studentEmail);
    const r = map[email] || null;
    const m = meta[a.assignmentId + '|' + email] || null;
    const st = brRowState_(r, m);
    return {
      email: email,
      name: s.studentName || email,
      text: st.text,
      words: brWords_(st.text),
      fp: brTextFp_(st.text),
      score: st.scored ? Number(r.score) : null,
      feedback: r ? String(r.feedback || '') : '',
      process: r && typeof brProcParse_ === 'function' ? brProcParse_(r.processJson) : null,
      submitted: st.submitted,
      submittedAt: r ? String(r.submittedAt || '') : '',
      updatedAt: r ? String(r.updatedAt || '') : '',
      excluded: st.excluded,
      redo: st.edited && !st.excluded,
      markedBlank: st.markedBlank,
      gradedAt: m ? m.gradedAt : '',
      rank: st.rank,
      status: st.status,
      imageUrl: r ? String(r.imageUrl || '') : ''
    };
  });
}

// ---------------------------------------------------------------------------
// Assessment hub: everything the tiles and the gradebook need, in one call.
// ---------------------------------------------------------------------------
function getBrAssessmentHub(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, payload.classId, teacher);
  const all = brCanvasAll_(ss);
  const meta = brGradeMeta_(ss, cls.classId);
  const roster = brRows_(ss, 'ENROLL')
    .filter(function (r) { return r.classId === cls.classId && brBool_(r.active); })
    .sort(function (a, b) { return String(a.studentName || a.studentEmail || '').localeCompare(String(b.studentName || b.studentEmail || '')); });
  const assignments = brRows_(ss, 'ASSIGNMENTS')
    .filter(function (a) { return a.classId === cls.classId && brBool_(a.active); })
    .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
  const responses = brRows_(ss, 'RESPONSES').filter(function (r) { return r.classId === cls.classId; });
  const byAsg = {};
  responses.forEach(function (r) { (byAsg[r.assignmentId] = byAsg[r.assignmentId] || []).push(r); });

  const grid = {};
  let needsGradingTotal = 0, needsRegradeTotal = 0;
  const tiles = assignments.map(function (a) {
    const rows = brAssignmentRows_(ss, a, roster, byAsg[a.assignmentId] || [], meta);
    let graded = 0, needs = 0, redo = 0, submitted = 0, excluded = 0, started = 0;
    rows.forEach(function (r) {
      if (r.submitted) submitted++;
      if (r.rank === -1) { redo++; needs++; }
      else if (r.rank === 0) needs++;
      else if (r.rank === 2) graded++;
      else if (r.rank === 3) excluded++;
      else if (r.rank === 4) started++;
      (grid[r.email] = grid[r.email] || {})[a.assignmentId] = {
        score: r.score, submitted: r.submitted, needs: r.rank === 0, started: r.rank === 4, redo: r.redo, excluded: r.excluded, status: r.status, hasFeedback: !!r.feedback
      };
    });
    const link = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    if (!link.noGrade) { needsGradingTotal += needs; needsRegradeTotal += redo; }
    return {
      assignmentId: a.assignmentId,
      title: a.title,
      category: a.category || 'Bell Ringer',
      responseType: a.responseType || 'writing',
      prompt: a.prompt || '',
      createdAt: a.createdAt || '',
      dueAt: link.dueAt || a.dueAt || '',
      pointsPossible: BR_POINTS,
      totalItems: rows.length,
      submitted: submitted,
      graded: graded,
      needsGrading: needs,
      needsRegrade: redo,
      excluded: excluded,
      started: started,
      noGrade: !!link.noGrade,
      canvas: {
        assignmentId: String(link.canvasAssignmentId || a.canvasAssignmentId || ''),
        name: link.name || '',
        htmlUrl: link.htmlUrl || '',
        moduleName: link.moduleName || '',
        lastGradeSyncAt: link.lastGradeSyncAt || '',
        linkVersion: Number(link.descVersion || 0)
      }
    };
  });

  const students = roster.map(function (s) {
    const email = brNormEmail_(s.studentEmail);
    return {email: email, name: s.studentName || email, cells: grid[email] || {}};
  });

  return brSafe_({
    ok: true,
    canvasNode: BR_CANVAS_NODE_VERSION,
    class: {classId: cls.classId, className: cls.className, period: cls.period, grade: cls.grade, joinCode: cls.joinCode},
    canvas: brCanvasClassLink_(ss, cls, all),
    canvasConnected: brCanvasConnection_().connected,
    assignments: tiles,
    students: students,
    needsGradingTotal: needsGradingTotal,
    needsRegradeTotal: needsRegradeTotal,
    loadedAt: brNow_()
  });
}

// ---------------------------------------------------------------------------
// The marking screen (Macbeth "Grade Written Responses", one bell ringer at a
// time) and its single save call.
// ---------------------------------------------------------------------------
function getBrGradingList(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const a = brOwnedAssignment_(ss, payload.assignmentId, teacher);
  const cls = brOwnedClass_(ss, a.classId, teacher);
  const link = brCanvasGet_(ss, 'assignment', a.assignmentId, null) || {};
  const rows = brAssignmentRows_(ss, a).sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
  const others = brRows_(ss, 'ASSIGNMENTS')
    .filter(function (x) { return x.classId === a.classId && brBool_(x.active); })
    .sort(function (x, y) { return String(y.createdAt || '').localeCompare(String(x.createdAt || '')); })
    .map(function (x) { return {assignmentId: x.assignmentId, title: x.title, category: x.category || ''}; });
  return brSafe_({
    ok: true,
    assignment: {assignmentId: a.assignmentId, classId: a.classId, title: a.title, category: a.category || '', prompt: a.prompt || '',
      directions: a.directions || '', responseType: a.responseType || 'writing', dueAt: link.dueAt || a.dueAt || '', noGrade: !!link.noGrade},
    class: {classId: cls.classId, className: cls.className},
    assignments: others,
    rows: rows,
    loadedAt: brNow_()
  });
}

// One save for one student: score (or null), excluded, comment, and the
// fingerprint of the response the teacher had on screen (seenFp).
function setBrGradeItem(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const a = brOwnedAssignment_(ss, payload.assignmentId, teacher);
  const email = brNormEmail_(payload.studentEmail);
  let score = payload.score === null || payload.score === undefined || payload.score === '' ? '' : Number(payload.score);
  if (score !== '' && (!Number.isFinite(score) || score < 0 || score > BR_POINTS)) throw new Error('Scores run from 0 to ' + BR_POINTS + '.');
  if (score !== '') score = Math.round(score * 100) / 100;
  const excluded = !!payload.excluded;
  const comment = String(payload.comment || '');
  // 2026.10.19: a grade save holds the lock for well under a second. It reads
  // only the two key columns of RESPONSES (not every student's writing), writes
  // just the score / comment / time cells, and checks those cells afterwards.
  // Before, each save re-read the whole sheet four times inside the lock, so a
  // few quick clicks waited more than 30 seconds and failed as "busy".
  const sh = ss.getSheetByName('RESPONSES'), H = BR_SHEETS.RESPONSES;
  const cA = H.indexOf('assignmentId'), cE = H.indexOf('studentEmail'), cS = H.indexOf('score'), cF = H.indexOf('feedback'), cU = H.indexOf('updatedAt'), cT = H.indexOf('text');
  const lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine && !lock.tryLock(45000)) throw new Error('The grade sheet is busy with another save (' + BR_CANVAS_NODE_VERSION + '). Trying again…');
  let rows = [];
  try {
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const lo = Math.min(cA, cE), keys = sh.getRange(2, lo + 1, lr - 1, Math.abs(cE - cA) + 1).getValues();
      keys.forEach(function (k, i) { if (String(k[cA - lo]) === a.assignmentId && brNormEmail_(k[cE - lo]) === email) rows.push(i + 2); });
    }
    const now = brNow_();
    if (!rows.length && (score !== '' || comment)) {
      // Missing work can still be marked (e.g. a Zero): make the student's row.
      const enroll = brRows_(ss, 'ENROLL').find(function (x) { return x.classId === a.classId && brNormEmail_(x.studentEmail) === email; });
      if (!enroll) throw new Error('Student is not enrolled in this class.');
      brAppendObject_(ss, 'RESPONSES', {responseId: a.assignmentId + '__' + brHash_(email).slice(0, 20), assignmentId: a.assignmentId, classId: a.classId,
        studentEmail: email, studentName: enroll.studentName || brNameFromEmail_(email), text: '', imageUrl: '', drawingData: '', status: 'not started',
        score: score, feedback: comment, submittedAt: '', clientUpdatedAt: '', updatedAt: now});
      rows.push(sh.getLastRow());
    } else {
      rows.forEach(function (n) {
        if (cF === cS + 1) sh.getRange(n, cS + 1, 1, 2).setValues([[score, comment]]);
        else { sh.getRange(n, cS + 1).setValue(score); sh.getRange(n, cF + 1).setValue(comment); }
        sh.getRange(n, cU + 1).setValue(now);
      });
    }
    let seen = '';
    if (payload.seenFp !== undefined) seen = String(payload.seenFp || '');
    else if (rows.length) seen = brTextFp_(String(sh.getRange(rows[0], cT + 1).getValue() || ''));
    const meta = brGradeMeta_(ss, a.classId)[a.assignmentId + '|' + email] || {};
    brGradeMetaPut_(ss, a, email, {snapFp: seen, snapBlank: !seen, excluded: excluded, gradedAt: score !== '' ? brNow_() : (meta.gradedAt || '')});
  } finally {
    if (mine) lock.releaseLock();
  }
  // Read the saved cells back, so the screen can confirm what was really kept.
  let verified = true;
  rows.forEach(function (n) {
    const v = sh.getRange(n, cS + 1, 1, cF - cS + 1).getValues()[0];
    const got = v[0] === '' || v[0] === null ? '' : Number(v[0]);
    if (String(got) !== String(score) || String(v[cF - cS] || '') !== comment) verified = false;
  });
  return brSafe_({ok: true, verified: verified, score: score});
}

// ---------------------------------------------------------------------------
// Canvas assignments: create/update, due dates, modules, grade push.
// ---------------------------------------------------------------------------
// The link students follow from Canvas. Google's own guess
// (ScriptApp.getService().getUrl()) is often wrong: it can be the editor's
// /dev test link (students get "unable to open") or an older deployment.
// So the app uses the link the teacher saved - the /exec address students use.
const BR_APP_URL_PROP = 'SCHENGLISH_BR_APP_URL';
const BR_DESC_VERSION = 2;   // bump when the Canvas description/link format changes
function brCleanAppUrl_(u) {
  let s = String(u || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s;
}
function brAppUrlProblem_(u) {
  if (!u) return 'missing';
  if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+|macros)\/s\/[\w-]+\/(exec|dev)$/.test(u)) return 'notapp';
  if (/\/dev$/.test(u)) return 'dev';
  return '';
}
function brAppLinkInfo_() {
  const saved = brCleanAppUrl_(PropertiesService.getScriptProperties().getProperty(BR_APP_URL_PROP) || '');
  let detected = '';
  try { detected = brCleanAppUrl_(ScriptApp.getService().getUrl() || ''); } catch (e) { detected = ''; }
  const url = saved || detected;
  return {url: url, saved: !!saved, detected: detected, problem: brAppUrlProblem_(url)};
}
function brCanvasAppUrl_() {
  const info = brAppLinkInfo_();
  return info.problem ? '' : info.url;
}
function getBrAppLink() {
  const ss = brDb_();
  brRequireTeacher_(ss);
  return brSafe_(Object.assign({ok: true}, brAppLinkInfo_()));
}
function saveBrAppLink(payload) {
  const ss = brDb_();
  brRequireTeacher_(ss);
  const url = brCleanAppUrl_((payload || {}).url);
  const problem = brAppUrlProblem_(url);
  if (problem === 'missing') throw new Error('Paste the app link first.');
  if (problem === 'notapp') throw new Error('That is not an app link. Open the app the way students do and copy the address: it starts with https://script.google.com/ and ends with /exec.');
  if (problem === 'dev') throw new Error('That is the /dev test link - students cannot open it. Use the link that ends with /exec (Deploy > Manage deployments > Web app URL).');
  PropertiesService.getScriptProperties().setProperty(BR_APP_URL_PROP, url);
  return brSafe_(Object.assign({ok: true}, brAppLinkInfo_()));
}
// Rewrites the description (and so the student link) of every Canvas
// assignment this class has made. Dates, points and grades are not touched.
function updateBrCanvasLinks(payload) {
  if (brHubEnabled_()) return brHubUpdateLinks_(payload);
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  if (!brCanvasAppUrl_()) throw new Error('Save a working app link first.');
  const all = brCanvasAll_(ss), course = brCanvasClassLink_(ss, cls, all);
  if (!course.courseId) throw new Error('Link this class to a Canvas course first.');
  let updated = 0;
  const failed = [];
  brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return a.classId === cls.classId && brBool_(a.active); }).forEach(function (a) {
    const link = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    const cid = link.canvasAssignmentId || a.canvasAssignmentId;
    if (!cid) return;
    try {
      brCanvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(course.courseId) + '/assignments/' + encodeURIComponent(cid), {'assignment[description]': brCanvasDescription_(a)});
      if (link.canvasAssignmentId) { link.descVersion = BR_DESC_VERSION; brCanvasPut_(ss, 'assignment', a.assignmentId, cls.classId, link); }
      updated++;
    } catch (e) { failed.push(a.title + ': ' + (e.message || e)); }
  });
  return brSafe_({ok: true, updated: updated, failed: failed, url: brCanvasAppUrl_()});
}
function brCanvasEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function brCanvasDescription_(a) {
  const url = brCanvasAppUrl_();
  let html = '<p><strong>Bell ringer:</strong> ' + brCanvasEsc_(a.title) + '</p>';
  if (a.prompt) html += '<blockquote>' + brCanvasEsc_(a.prompt).replace(/\n/g, '<br>') + '</blockquote>';
  html += '<p>Complete this bell ringer in the SchEnglish Bell Ringers app. Your teacher assesses it there on the 5-point scale and the score is synced back to Canvas.</p>';
  if (url) {
    // Deep link: opens the app straight to this bell ringer. Only the bell
    // ringer id is in the link - the app works out which of the student's
    // classes it belongs to, so one Canvas assignment shared by several
    // periods works for every period.
    const link = url + '?br=' + encodeURIComponent(a.assignmentId || '');
    html += '<p><a href="' + brCanvasEsc_(link) + '" target="_blank" rel="noopener"><strong>Open this bell ringer in SchEnglish Bell Ringers</strong></a></p>' +
      '<p><small>Sign in with your school Google account. If Google says <em>\u201cSorry, unable to open the file at this time\u201d</em>, this browser is signed in to more than one Google account: open the link in an Incognito / private window, or sign out of the other accounts. App address: ' + brCanvasEsc_(url) + '</small></p>';
  }
  return html;
}
function brCanvasAssignmentContext_(ss, assignmentId) {
  const teacher = brRequireTeacher_(ss);
  const a = brOwnedAssignment_(ss, assignmentId, teacher);
  const cls = brOwnedClass_(ss, a.classId, teacher);
  const all = brCanvasAll_(ss);
  const course = brCanvasClassLink_(ss, cls, all);
  const link = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
  if (!link.canvasAssignmentId && a.canvasAssignmentId) link.canvasAssignmentId = String(a.canvasAssignmentId);
  return {teacher: teacher, a: a, cls: cls, all: all, course: course, link: link};
}
function brCanvasApplySchedule_(form, schedule) {
  if (schedule.dueAt !== undefined) form['assignment[due_at]'] = schedule.dueAt || '';
  if (schedule.unlockAt !== undefined) form['assignment[unlock_at]'] = schedule.unlockAt || '';
  if (schedule.lockAt !== undefined) form['assignment[lock_at]'] = schedule.lockAt || '';
  return form;
}
// Which OTHER classes in this app point at the same Canvas assignment.
function brCanvasSharedWith_(ss, classId, canvasAssignmentId, all) {
  if (!canvasAssignmentId) return [];
  const classes = {};
  brRows_(ss, 'CLASSES').forEach(function (c) { if (brBool_(c.active)) classes[c.classId] = c.className || c.classId; });
  const out = [];
  (all || brCanvasAll_(ss)).forEach(function (x) {
    if (x.scope !== 'assignment' || x.classId === classId || !classes[x.classId]) return;
    if (String(x.data.canvasAssignmentId || '') === String(canvasAssignmentId) && out.indexOf(classes[x.classId]) === -1) out.push(classes[x.classId]);
  });
  return out;
}
function brCanvasFindAssignmentByName_(courseId, name) {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const rows = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignments?per_page=100&search_term=' + encodeURIComponent(wanted));
  const hit = (Array.isArray(rows) ? rows : []).find(function (x) { return String(x.name || '').trim() === wanted; });
  return hit ? {id: String(hit.id), name: hit.name} : null;
}

function listBrCanvasModules_(courseId) {
  const rows = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/modules?per_page=100');
  return (Array.isArray(rows) ? rows : []).filter(function (m) { return m.workflow_state !== 'deleted'; }).map(function (m) {
    return {id: String(m.id), name: m.name || ('Module ' + m.id), position: Number(m.position || 0), published: m.published !== false};
  }).sort(function (a, b) { return (a.position - b.position) || a.name.localeCompare(b.name); });
}

// Keeps one module item pointing at the assignment. Clearing the module
// removes ONLY the module item; the assignment and its grades stay put.
function brCanvasSyncModuleItem_(courseId, assignment, desiredModuleId, desiredModuleName, oldLink, title) {
  desiredModuleId = String(desiredModuleId || '');
  oldLink = oldLink || {};
  let oldModuleId = String(oldLink.moduleId || '');
  let oldItemId = String(oldLink.moduleItemId || '');
  const assignmentId = String((assignment || {}).id || '');
  const oldAssignmentId = String(oldLink.canvasAssignmentId || '');
  const enc = encodeURIComponent(courseId);
  function deleteOld_() {
    if (!oldModuleId || !oldItemId) return;
    try { brCanvasRequest_('delete', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId)); }
    catch (e) { if (e.canvasStatus !== 404) throw e; }
    oldModuleId = ''; oldItemId = '';
  }
  if (oldAssignmentId && assignmentId && oldAssignmentId !== assignmentId) deleteOld_();
  if (!desiredModuleId) { deleteOld_(); return {moduleId: '', moduleName: '', moduleItemId: ''}; }
  const moduleObj = brCanvasRequest_('get', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId));
  const moduleName = moduleObj.name || String(desiredModuleName || '');
  const itemForm = {'module_item[title]': title, 'module_item[published]': 'true'};
  let item = null;
  if (oldItemId && oldModuleId) {
    try {
      const update = Object.assign({}, itemForm);
      if (oldModuleId !== desiredModuleId) update['module_item[module_id]'] = desiredModuleId;
      item = brCanvasRequest_('put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId), update);
    } catch (e) {
      if (e.canvasStatus !== 404) throw e;
      oldItemId = ''; oldModuleId = '';
    }
  }
  if (!item) {
    item = brCanvasRequest_('post', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items', {
      'module_item[title]': title, 'module_item[type]': 'Assignment', 'module_item[content_id]': assignmentId
    });
    try { item = brCanvasRequest_('put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items/' + encodeURIComponent(item.id), itemForm); } catch (e) {}
  }
  return {moduleId: desiredModuleId, moduleName: moduleName, moduleItemId: String(item.id || oldItemId || '')};
}

// "Do not grade" toggle for one bell ringer. Students can still do it; it
// just stays out of the to-grade counts and the gradebook total. If it is in
// Canvas, Canvas is told to leave it out of the final grade too.
function setBrAssignmentNoGrade(payload) {
  payload = payload || {};
  const ss = brDb_();
  const ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  const noGrade = !!payload.noGrade;
  const link = Object.assign({}, ctx.link, {noGrade: noGrade});
  brCanvasPut_(ss, 'assignment', ctx.a.assignmentId, ctx.cls.classId, link);
  let canvasNote = '';
  if (link.canvasAssignmentId && ctx.course.courseId && brCanvasConnection_().connected) {
    try {
      brCanvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(ctx.course.courseId) + '/assignments/' + encodeURIComponent(link.canvasAssignmentId),
        {'assignment[omit_from_final_grade]': noGrade ? 'true' : 'false'});
      canvasNote = noGrade ? 'Canvas will leave it out of the final grade.' : 'Canvas will count it in the final grade.';
    } catch (e) {
      canvasNote = 'Saved here, but Canvas could not be updated: ' + e.message;
    }
  }
  return brSafe_({ok: true, noGrade: noGrade, canvasNote: canvasNote});
}

// ---------------------------------------------------------------------------
// 2026.10.19.2 -- a Canvas assignment deleted in Canvas is made again (ported from
// Lit Circles 2026-10-18g and Novel Study 2026-10-19d). Before Save (Due date &
// Canvas), a tile's Push, Push all, and opening the Due date & Canvas window, the
// app asks Canvas whether the linked assignment still exists. Only a 404 (with the
// course itself still reachable, so a lost course or token never drops links) or
// workflow_state "deleted" counts. A deleted one is forgotten by this class, by
// every other class in the same course that shares it, and by the LMS Hub; its
// module is kept, and the posted-comment / excused records are cleared so the new
// assignment gets every score and comment. The next Save or tile Push makes it
// again, in the module it was in. Push all never makes assignments: it names them.
// ---------------------------------------------------------------------------
function brCanvasAssignmentDeleted_(ss, ctx) {
  const cid = String(ctx.link.canvasAssignmentId || ''), courseId = String(ctx.course.courseId || '');
  if (!cid || !courseId) return false;
  if (brCanvasConnection_().connected) {
    const base = '/api/v1/courses/' + encodeURIComponent(courseId);
    try {
      const x = brCanvasRequest_('get', base + '/assignments/' + encodeURIComponent(cid));
      return !!x && String(x.workflow_state || '') === 'deleted';
    } catch (e) {
      if (!e || e.canvasStatus !== 404) return false;
      try { brCanvasRequest_('get', base); return true; } catch (e2) { return false; }
    }
  }
  if (brHubEnabled_()) {
    try { LmsHub.assignment(ctx.cls.classId, ctx.a.assignmentId, true, ctx.teacher.email); return false; }
    catch (e) { return !!e && Number(e.lmsStatus) === 404; }
  }
  return false;
}
// Returns true when the link was dropped (ctx must be re-read afterwards).
function brCanvasForgetDeleted_(ss, ctx) {
  if (!brCanvasAssignmentDeleted_(ss, ctx)) return false;
  const deadId = String(ctx.link.canvasAssignmentId), courseId = String(ctx.course.courseId);
  const all = brCanvasAll_(ss), classes = {};
  brRows_(ss, 'CLASSES').forEach(function (k) { classes[k.classId] = k; });
  const hub = brHubEnabled_();
  all.forEach(function (x) {
    if (x.scope !== 'assignment' || String(x.data.canvasAssignmentId || '') !== deadId) return;
    const k = classes[x.classId];
    if (!k || brCanvasClassLink_(ss, k, all).courseId !== courseId) return;
    if (hub) { try { LmsHub.forgetAssignment(x.classId, x.key, brNormEmail_(k.teacherEmail) || ctx.teacher.email); } catch (e) {} }
    const d = Object.assign({}, x.data, {canvasAssignmentId: '', htmlUrl: '', moduleItemId: '', feedbackSync: {}, excusedEmails: {}, lastGradeSyncAt: '', deletedInCanvasAt: brNow_()});
    brCanvasPut_(ss, 'assignment', x.key, x.classId, d);
    brUpdateByKey_(ss, 'ASSIGNMENTS', 'assignmentId', x.key, {canvasAssignmentId: '', updatedAt: brNow_()});
  });
  // An older record kept only on the ASSIGNMENTS row.
  brUpdateByKey_(ss, 'ASSIGNMENTS', 'assignmentId', ctx.a.assignmentId, {canvasAssignmentId: '', updatedAt: brNow_()});
  return true;
}
// A module item another class in the same course already has for this Canvas
// assignment in this module (two classes sharing one assignment share one item).
function brCanvasSiblingModuleItem_(ss, classId, courseId, canvasAssignmentId, moduleId) {
  if (!canvasAssignmentId || !moduleId) return null;
  const all = brCanvasAll_(ss), classes = {};
  brRows_(ss, 'CLASSES').forEach(function (k) { if (brBool_(k.active)) classes[k.classId] = k; });
  let out = null;
  all.forEach(function (x) {
    if (out || x.scope !== 'assignment' || x.classId === classId || !classes[x.classId]) return;
    const d = x.data || {};
    if (String(d.canvasAssignmentId || '') !== String(canvasAssignmentId) || String(d.moduleId || '') !== String(moduleId) || !d.moduleItemId) return;
    if (brCanvasClassLink_(ss, classes[x.classId], all).courseId !== String(courseId)) return;
    out = {moduleId: String(d.moduleId), moduleName: String(d.moduleName || ''), moduleItemId: String(d.moduleItemId)};
  });
  return out;
}
// The Canvas assignment another class in this course made for a bell ringer of
// the same name (what Create in Canvas / the hub would join).
function brCanvasSiblingByName_(ss, classId, courseId, title) {
  const all = brCanvasAll_(ss), classes = {}, assignments = {};
  brRows_(ss, 'CLASSES').forEach(function (k) { if (brBool_(k.active)) classes[k.classId] = k; });
  brRows_(ss, 'ASSIGNMENTS').forEach(function (a) { assignments[a.assignmentId] = a; });
  let out = '';
  all.forEach(function (x) {
    if (out || x.scope !== 'assignment' || x.classId === classId || !classes[x.classId] || !x.data.canvasAssignmentId) return;
    const a = assignments[x.key];
    if (!a || String(a.title || '').trim() !== String(title || '').trim()) return;
    if (brCanvasClassLink_(ss, classes[x.classId], all).courseId === String(courseId)) out = String(x.data.canvasAssignmentId);
  });
  return out;
}
// Is any OTHER class's link using this module item?
function brCanvasModuleItemShared_(ss, classId, moduleItemId) {
  if (!moduleItemId) return false;
  return brCanvasAll_(ss).some(function (x) { return x.scope === 'assignment' && x.classId !== classId && String((x.data || {}).moduleItemId || '') === String(moduleItemId); });
}

// Everything the Assign window needs to offer "Also create this in Canvas".
function getBrAssignCanvasOptions(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  const conn = brCanvasConnection_();
  const course = brCanvasClassLink_(ss, cls, null);
  const out = {ok: true, connected: conn.connected, invalid: false, canvas: course, modules: [], modulesError: '', appLink: brAppLinkInfo_()};
  if (conn.connected && course.courseId) {
    try { out.modules = listBrCanvasModules_(course.courseId); }
    catch (e) { if (e.canvasStatus === 401) out.invalid = true; else out.modulesError = e.message; }
  }
  return brSafe_(out);
}

function getBrCanvasAssignmentSetup(payload) {
  payload = payload || {};
  const ss = brDb_();
  let ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  let deletedInCanvas = false;
  try { if (brCanvasForgetDeleted_(ss, ctx)) { deletedInCanvas = true; ctx = brCanvasAssignmentContext_(ss, payload.assignmentId); } } catch (e) {}
  const conn = brCanvasConnection_();
  let modules = [], modulesError = '', live = null, groups = [], groupsError = '';
  if (conn.connected && ctx.course.courseId) {
    try { modules = listBrCanvasModules_(ctx.course.courseId); } catch (e) { modulesError = e.message; }
    try { groups = listBrCanvasAssignmentGroups({courseId: ctx.course.courseId}).groups; } catch (e) { groupsError = e.message; }
    if (ctx.link.canvasAssignmentId) {
      try { live = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(ctx.course.courseId) + '/assignments/' + encodeURIComponent(ctx.link.canvasAssignmentId)); }
      catch (e) { live = null; }
    }
  }
  const schedule = live
    ? {dueAt: live.due_at || '', unlockAt: live.unlock_at || '', lockAt: live.lock_at || ''}
    : {dueAt: ctx.link.dueAt || ctx.a.dueAt || '', unlockAt: ctx.link.unlockAt || '', lockAt: ctx.link.lockAt || ''};
  // Dates changed in Canvas come back into the app: Canvas is read fresh every
  // time this window opens, and if its dates differ from what the app last
  // stored, the app adopts them (so the tile and students see the same date).
  let datesFromCanvas = false;
  if (live && (String(live.due_at || '') !== String(ctx.link.dueAt || '') ||
               String(live.unlock_at || '') !== String(ctx.link.unlockAt || '') ||
               String(live.lock_at || '') !== String(ctx.link.lockAt || ''))) {
    const updated = Object.assign({}, ctx.link, {dueAt: live.due_at || '', unlockAt: live.unlock_at || '', lockAt: live.lock_at || ''});
    brCanvasPut_(ss, 'assignment', ctx.a.assignmentId, ctx.cls.classId, updated);
    brUpdateByKey_(ss, 'ASSIGNMENTS', 'assignmentId', ctx.a.assignmentId, {dueAt: live.due_at || '', updatedAt: brNow_()});
    ctx.link = updated;
    datesFromCanvas = true;
  }
  return brSafe_({
    ok: true,
    assignment: {assignmentId: ctx.a.assignmentId, title: ctx.a.title, category: ctx.a.category || ''},
    pointsPossible: BR_POINTS,
    connected: conn.connected,
    canvas: ctx.course,
    link: ctx.link.canvasAssignmentId ? ctx.link : null,
    noGrade: !!ctx.link.noGrade,
    datesFromCanvas: datesFromCanvas,
    deletedInCanvas: deletedInCanvas,
    keptModuleName: deletedInCanvas ? String(ctx.link.moduleName || '') : '',
    sharedWith: brCanvasSharedWith_(ss, ctx.cls.classId, ctx.link.canvasAssignmentId, ctx.all),
    schedule: schedule,
    modules: modules,
    modulesError: modulesError,
    groups: groups,
    groupsError: groupsError,
    // Where the assignment is in Canvas now (it may have been moved there); before it exists, the class default.
    currentGroupId: live ? String(live.assignment_group_id || '') : String(ctx.course.assignmentGroupId || ''),
    appUrl: brCanvasAppUrl_()
  });
}

function syncBrCanvasAssignment(payload) {
  if (brHubEnabled_()) return brHubSyncAssignment_(payload);
  payload = payload || {};
  const ss = brDb_();
  let ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  let remade = false;
  if (!payload._checked && brCanvasForgetDeleted_(ss, ctx)) { remade = true; ctx = brCanvasAssignmentContext_(ss, payload.assignmentId); }
  if (!ctx.link.canvasAssignmentId && ctx.link.deletedInCanvasAt) remade = true;
  const c = ctx.course, old = ctx.link, a = ctx.a;
  // Set only when the teacher changed the group in this window; '' leaves Canvas as it is.
  const chosenGroup = String(payload.assignmentGroupId || '');
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  // Dates only change when this call supplies them, so a later grade push
  // never wipes a due date set earlier.
  const schedule = {
    dueAt: payload.dueAt !== undefined ? String(payload.dueAt || '') : String(old.dueAt || a.dueAt || ''),
    unlockAt: payload.unlockAt !== undefined ? String(payload.unlockAt || '') : String(old.unlockAt || ''),
    lockAt: payload.lockAt !== undefined ? String(payload.lockAt || '') : String(old.lockAt || '')
  };
  if (!brCanvasAppUrl_()) throw new Error('The student link to this app is not set up yet, so the Canvas assignment would have a broken link. Open Canvas settings and save the app link (the one ending in /exec) first.');
  const name = String(a.title || 'Bell Ringer').trim();
  const form = brCanvasApplySchedule_({
    'assignment[name]': name,
    'assignment[points_possible]': String(BR_POINTS),
    'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none',
    'assignment[published]': 'true',
    'assignment[omit_from_final_grade]': old.noGrade ? 'true' : 'false',
    'assignment[description]': brCanvasDescription_(a)
  }, schedule);
  const base = '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments';
  let assignment, adopted = false;
  if (old.canvasAssignmentId) {
    try { assignment = brCanvasRequest_('put', base + '/' + encodeURIComponent(old.canvasAssignmentId), brCanvasWithGroup_(form, null, chosenGroup)); }
    catch (e) {
      if (e.canvasStatus !== 404) throw e;          // deleted in Canvas: make a fresh one
      assignment = brCanvasRequest_('post', base, brCanvasWithGroup_(form, c, chosenGroup));
    }
  } else {
    // Two periods, one Canvas course: if ANOTHER class in this app already
    // made a Canvas assignment with this exact name, join it instead of making
    // a twin that holds half the roster. Only adopt one this app created, so
    // an unrelated Canvas assignment with the same name is never touched.
    let existing = null;
    try { existing = brCanvasFindAssignmentByName_(c.courseId, name); } catch (e) { existing = null; }
    if (existing && brCanvasSharedWith_(ss, ctx.cls.classId, existing.id, ctx.all).length) {
      adopted = true;
      const adoptForm = {};
      Object.keys(form).forEach(function (k) { if (k.indexOf('_at]') === -1) adoptForm[k] = form[k]; });
      assignment = brCanvasRequest_('put', base + '/' + encodeURIComponent(existing.id), brCanvasWithGroup_(adoptForm, null, chosenGroup));
    } else {
      assignment = brCanvasRequest_('post', base, brCanvasWithGroup_(form, c, chosenGroup));
    }
  }
  const wantModule = payload.moduleId !== undefined ? String(payload.moduleId || '') : String(old.moduleId || '');
  const ownItemThere = !!old.moduleItemId && String(old.canvasAssignmentId || '') === String(assignment.id) && String(old.moduleId || '') === wantModule;
  const sibItem = wantModule && !ownItemThere ? brCanvasSiblingModuleItem_(ss, ctx.cls.classId, c.courseId, assignment.id, wantModule) : null;
  let moduleLink;
  if (sibItem) {
    // Another class already placed this same Canvas assignment in that module: use its item
    // (one entry in the module, not one per class). Our own old item goes, unless another class uses it.
    if (old.moduleItemId && old.moduleId && !brCanvasModuleItemShared_(ss, ctx.cls.classId, old.moduleItemId)) {
      try { brCanvasRequest_('delete', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/modules/' + encodeURIComponent(old.moduleId) + '/items/' + encodeURIComponent(old.moduleItemId)); }
      catch (e) { if (e.canvasStatus !== 404) throw e; }
    }
    moduleLink = sibItem;
  } else {
    moduleLink = brCanvasSyncModuleItem_(c.courseId, assignment, wantModule, String(payload.moduleName || old.moduleName || ''), old, name);
  }
  const link = {
    canvasAssignmentId: String(assignment.id),
    courseId: c.courseId,
    name: assignment.name || name,
    htmlUrl: assignment.html_url || '',
    pointsPossible: Number(assignment.points_possible || BR_POINTS),
    assignmentGroupId: String(assignment.assignment_group_id || ''),
    dueAt: assignment.due_at || (adopted ? '' : schedule.dueAt) || '',
    unlockAt: assignment.unlock_at || (adopted ? '' : schedule.unlockAt) || '',
    lockAt: assignment.lock_at || (adopted ? '' : schedule.lockAt) || '',
    moduleId: moduleLink.moduleId,
    moduleName: moduleLink.moduleName,
    moduleItemId: moduleLink.moduleItemId,
    lastAssignmentSyncAt: brNow_(),
    lastGradeSyncAt: old.lastGradeSyncAt || '',
    feedbackSync: old.feedbackSync || {},
    noGrade: !!old.noGrade,
    descVersion: BR_DESC_VERSION
  };
  brCanvasPut_(ss, 'assignment', a.assignmentId, ctx.cls.classId, link);
  brUpdateByKey_(ss, 'ASSIGNMENTS', 'assignmentId', a.assignmentId, {
    canvasAssignmentId: link.canvasAssignmentId,
    dueAt: link.dueAt || a.dueAt || '',
    updatedAt: brNow_()
  });
  return brSafe_({ok: true, link: link, adopted: adopted, remade: remade, sharedModuleItem: !!sibItem, sharedWith: brCanvasSharedWith_(ss, ctx.cls.classId, link.canvasAssignmentId, null)});
}

function brCanvasCourseStudents_(courseId) {
  const rows = brCanvasRequest_('get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&per_page=100');
  return (Array.isArray(rows) ? rows : []).map(function (u) {
    return {
      id: String(u.id),
      name: u.name || u.short_name || '',
      email: String(u.email || u.login_id || '').trim().toLowerCase(),
      loginId: String(u.login_id || '').trim().toLowerCase(),
      sisId: String(u.sis_user_id || '').trim().toLowerCase()
    };
  });
}
function brCanvasMatchStudent_(email, list) {
  const e = brNormEmail_(email);
  if (!e) return null;
  return list.find(function (u) { return u.email === e || u.loginId === e || u.sisId === e; }) || null;
}
function brCanvasHash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Sends this bell ringer's scores and teacher comments to Canvas in one call.
// Creates the Canvas assignment first if there isn't one yet.
// `shared` is internal: pushBrCanvasGradebook passes the Canvas roster so pushing every bell
// ringer fetches it once. payload.onlyLinked (Push all) skips one that isn't in Canvas yet.
// 2026-10.18.1 -- the latest push is the truth in Canvas (same rule as Short Story Lab v27,
// Macbeth, Lit Circles, Root Word Study): excluded for a student -> EXCUSED; excused earlier by
// this app and scored now -> excusal lifted and score sent; no score and not excluded -> left
// as Canvas has it. link.excusedEmails remembers this app's excusals.
function pushBrCanvasGrades(payload, shared) {
  if (brHubEnabled_()) return brHubPushGrades_(payload, shared);
  payload = payload || {};
  const ss = brDb_();
  let ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  if (!ctx.course.courseId) throw new Error('Link this class to a Canvas course first.');
  let remade = false;
  if (brCanvasForgetDeleted_(ss, ctx)) {
    ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
    if (payload.onlyLinked) return brSafe_({ok: true, notInCanvas: true, deletedInCanvas: true, title: ctx.a.title, sent: 0});
    remade = true;
  }
  if (!ctx.link.canvasAssignmentId && ctx.link.deletedInCanvasAt) {
    if (payload.onlyLinked) return brSafe_({ok: true, notInCanvas: true, deletedInCanvas: true, title: ctx.a.title, sent: 0});
    remade = true;
  }
  if (payload.onlyLinked && !ctx.link.canvasAssignmentId) return brSafe_({ok: true, notInCanvas: true, title: ctx.a.title, sent: 0});
  if (!ctx.link.canvasAssignmentId) {
    syncBrCanvasAssignment({assignmentId: payload.assignmentId, _checked: true});
    ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  }
  const c = ctx.course, link = ctx.link, a = ctx.a;
  if (!link.canvasAssignmentId) throw new Error('Could not find or create the Canvas assignment for ' + a.title + '.');
  const rows = brAssignmentRows_(ss, a);
  const base = '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.canvasAssignmentId);
  // Keep name/points/description current. No date fields: Canvas leaves
  // fields not in the form alone, so a push never moves a due date.
  const updateForm = {
    'assignment[name]': String(a.title || 'Bell Ringer').trim(),
    'assignment[points_possible]': String(BR_POINTS),
    'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none'
  };
  // Refresh the student link too - but never replace a link with no link.
  if (brCanvasAppUrl_()) updateForm['assignment[description]'] = brCanvasDescription_(a);
  let updated;
  try { updated = brCanvasRequest_('put', base, updateForm); }
  catch (e) {
    if (e.canvasStatus === 404) throw new Error('The Canvas assignment for "' + a.title + '" can\u2019t be found in Canvas right now. Push again; if it was deleted in Canvas it will be made again.');
    throw e;
  }
  const canvasStudents = (shared && shared.canvasStudents) || brCanvasCourseStudents_(c.courseId);
  const form = {}, unmatched = [], matched = [], skipped = [], waiting = [], excused = [], unexcused = [];
  const excusedBefore = link.excusedEmails || {}, excusedNow = {};
  let sent = 0;
  let trialSkipped = 0;
  rows.forEach(function (r0) {
    let r = r0;
    if (brIsTrialEmail_(r.email)) { trialSkipped++; return; }   // trial students never go to Canvas
    const feedback = String(r.feedback || '').trim();
    const e = brNormEmail_(r.email);
    // Excluded for this one student: Canvas marks the submission EXCUSED, so a
    // score sent earlier stops counting there. No comment goes with it.
    if (r.excluded) {
      const xu = brCanvasMatchStudent_(r.email, canvasStudents);
      if (!xu) { unmatched.push(r.name + ' (' + r.email + ')'); if (excusedBefore[e]) excusedNow[e] = true; return; }
      form['grade_data[' + xu.id + '][excuse]'] = 'true'; excusedNow[e] = true; excused.push(r.name);
      return;
    }
    // Excused earlier and still no score: leave Canvas as it is (the excusal stays).
    if (r.score === null && excusedBefore[e]) { excusedNow[e] = true; if (r.submitted || r.rank === 0) waiting.push(r.name); return; }
    if (r.score === null) {
      // Turned in but not marked: nothing is sent, so Canvas keeps it blank.
      if (r.submitted || r.rank === 0) waiting.push(r.name);
      else if (!feedback) skipped.push(r.rank === 4 ? r.name + ' (draft, not submitted)' : r.name);
      if (!feedback) return;
    }
    const u = brCanvasMatchStudent_(r.email, canvasStudents);
    if (!u) { unmatched.push(r.name + ' (' + r.email + ')'); return; }
    matched.push({row: r, user: u, feedback: feedback});
    if (r.score === null) return;
    form['grade_data[' + u.id + '][posted_grade]'] = String(r.score);
    if (excusedBefore[e]) { form['grade_data[' + u.id + '][excuse]'] = 'false'; unexcused.push(r.name); }
    sent++;
  });
  let progress = null;
  if (Object.keys(form).length) progress = brCanvasRequest_('post', base + '/submissions/update_grades', form);

  // Canvas comments add up, so only post a comment when its text changed
  // since the last push for that student.
  link.feedbackSync = link.feedbackSync || {};
  let feedbackPosted = 0, feedbackSkipped = 0;
  const feedbackFailed = [];
  matched.forEach(function (m) {
    if (!m.feedback) return;
    const key = brNormEmail_(m.row.email);
    const hash = brCanvasHash_(m.feedback);
    const prior = link.feedbackSync[key];
    if (prior && String(prior.hash || '') === hash) { feedbackSkipped++; return; }
    try {
      brCanvasRequest_('put', base + '/submissions/' + encodeURIComponent(m.user.id), {'comment[text_comment]': m.feedback});
      link.feedbackSync[key] = {hash: hash, syncedAt: brNow_()};
      feedbackPosted++;
    } catch (e) {
      feedbackFailed.push(m.row.name + ': ' + (e.message || String(e)));
    }
  });
  link.name = updated.name || link.name || a.title;
  link.htmlUrl = updated.html_url || link.htmlUrl || '';
  link.pointsPossible = Number(updated.points_possible || BR_POINTS);
  link.dueAt = updated.due_at || link.dueAt || '';
  link.lastGradeSyncAt = brNow_();
  link.excusedEmails = excusedNow;
  if (updateForm['assignment[description]']) link.descVersion = BR_DESC_VERSION;
  brCanvasPut_(ss, 'assignment', a.assignmentId, ctx.cls.classId, link);
  return brSafe_({
    ok: true,
    title: a.title,
    remade: remade,
    sent: sent,
    excused: excused,
    unexcused: unexcused,
    pointsPossible: BR_POINTS,
    unmatched: unmatched,
    skipped: skipped,
    waiting: waiting,
    feedbackPosted: feedbackPosted,
    feedbackSkipped: feedbackSkipped,
    feedbackFailed: feedbackFailed,
    trialSkipped: trialSkipped,
    link: link,
    progressUrl: progress && progress.url ? progress.url : ''
  });
}

// ---------------------------------------------------------------------------
// 2026.10.18.1 -- "\u2197 Push all to Canvas" on the Gradebook card (ported from Short Story Lab,
// Macbeth, Lit Circles and Root Word Study). Pushes every active bell ringer of the class that is
// already in Canvas, one after another, through pushBrCanvasGrades -- the same code as each tile's
// Push -- with onlyLinked, so it never creates a Canvas assignment. Bell ringers set to "don't grade"
// are skipped. Fetches the Canvas roster once. One failure doesn't stop the rest; it stops before
// Apps Script's 6-minute limit and says what's left.
// ---------------------------------------------------------------------------
function pushBrCanvasGradebook(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, payload.classId, teacher);
  const all = brCanvasAll_(ss), course = brCanvasClassLink_(ss, cls, all);
  if (!course.courseId) throw new Error('Link this class to a Canvas course first.');
  const assignments = brRows_(ss, 'ASSIGNMENTS')
    .filter(function (a) { return a.classId === cls.classId && brBool_(a.active); })
    .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
  const toPush = [], notInCanvas = [], notGraded = [];
  assignments.forEach(function (a) {
    const link = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    const inCanvas = !!(link.canvasAssignmentId || a.canvasAssignmentId);
    if (link.noGrade) { notGraded.push(a.title); return; }
    if (!inCanvas) { notInCanvas.push(a.title); return; }
    toPush.push(a);
  });
  if (!toPush.length) throw new Error('None of this class\u2019s bell ringers are in Canvas yet. Use Push on a bell ringer once to create it in Canvas.');
  const shared = {};
  if (!brHubEnabled_()) shared.canvasStudents = brCanvasCourseStudents_(course.courseId);
  const started = Date.now();
  const out = {ok: true, deletedInCanvas: [], pushed: [], sent: 0, excused: 0, unexcused: 0, feedbackPosted: 0, waiting: [], unmatched: [], warnings: [], failures: [], notReached: [], notInCanvas: notInCanvas, notGraded: notGraded, via: brHubEnabled_() ? 'hub' : 'canvas'};
  function addAll(list, into) { (list || []).forEach(function (n) { if (n && into.indexOf(n) < 0) into.push(n); }); }
  toPush.forEach(function (a) {
    if (Date.now() - started > 270000) { out.notReached.push(a.title); return; }
    try {
      const r = pushBrCanvasGrades({assignmentId: a.assignmentId, onlyLinked: true}, shared);
      if (r.deletedInCanvas) { out.deletedInCanvas.push(a.title); return; }
      if (r.notInCanvas) { out.notInCanvas.push(a.title); return; }
      out.sent += r.sent || 0; out.excused += (r.excused || []).length; out.unexcused += (r.unexcused || []).length; out.feedbackPosted += r.feedbackPosted || 0;
      addAll(r.waiting, out.waiting); addAll(r.unmatched, out.unmatched);
      (r.warnings || []).forEach(function (w) { out.warnings.push(a.title + ': ' + w); });
      (r.feedbackFailed || []).forEach(function (f) { out.warnings.push(a.title + ': comment not posted for ' + f); });
      out.pushed.push(a.title);
    } catch (e) { out.failures.push({label: a.title, message: e.message || String(e)}); }
  });
  out.ok = !out.failures.length && !out.notReached.length;
  return brSafe_(out);
}

// ---------------------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------------------
function getBrAdminOverview() {
  const ss = brDb_();
  const admin = brRequireAdmin_(ss);
  const users = brRows_(ss, 'USERS');
  const classes = brRows_(ss, 'CLASSES').filter(function (c) { return brBool_(c.active); });
  const enroll = brRows_(ss, 'ENROLL').filter(function (e) { return brBool_(e.active); });
  const assignments = brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return brBool_(a.active); });
  const responses = brRows_(ss, 'RESPONSES');
  const activeIds = {};
  assignments.forEach(function (a) { activeIds[a.assignmentId] = true; });
  let waiting = 0, graded = 0, submitted = 0;
  responses.forEach(function (r) {
    if (!activeIds[r.assignmentId]) return;
    const st = brResponseState_(r);
    if (st.submitted) submitted++;
    if (st.scored && !st.redo) graded++;
    if ((st.submitted && !st.scored) || st.redo) waiting++;
  });
  const teachers = users.filter(function (u) { return u.role === 'teacher' || u.role === 'admin'; });
  const linked = brCanvasAll_(ss).filter(function (x) { return x.scope === 'class' && x.data.courseId; }).length;
  const byTeacher = {};
  classes.forEach(function (c) {
    const t = brNormEmail_(c.teacherEmail);
    byTeacher[t] = byTeacher[t] || {email: t, classes: 0, students: 0};
    byTeacher[t].classes++;
    byTeacher[t].students += enroll.filter(function (e) { return e.classId === c.classId; }).length;
  });
  return brSafe_({
    ok: true,
    adminEmail: admin.email,
    backendVersion: typeof BR_BACKEND_VERSION !== 'undefined' ? BR_BACKEND_VERSION : '',
    canvasNode: BR_CANVAS_NODE_VERSION,
    databaseUrl: ss.getUrl(),
    appUrl: brCanvasAppUrl_(),
    counts: {
      teachers: teachers.filter(function (u) { return u.status === 'active'; }).length,
      pendingTeachers: teachers.filter(function (u) { return u.status === 'pending'; }).length,
      students: users.filter(function (u) { return u.role === 'student'; }).length,
      classes: classes.length,
      canvasLinkedClasses: linked,
      enrollments: enroll.length,
      assignments: assignments.length,
      submitted: submitted,
      graded: graded,
      waiting: waiting
    },
    teachers: Object.keys(byTeacher).map(function (k) { return byTeacher[k]; })
  });
}

// ---------------------------------------------------------------------------
// Trial students: five pretend students so a teacher can practise the whole
// flow (grading, gradebook, Do not grade, Canvas) before real students join.
// They use @trial.schenglish.invalid addresses, so they can never sign in,
// are never sent to Canvas, and can be removed with one click.
// ---------------------------------------------------------------------------
const BR_TRIAL_DOMAIN = 'trial.schenglish.invalid';
const BR_TRIAL_STUDENTS = [
  {key: 'ava', name: 'Ava Brooks (trial)', plan: 'strong'},
  {key: 'marcus', name: 'Marcus Lee (trial)', plan: 'solid'},
  {key: 'priya', name: 'Priya Shah (trial)', plan: 'developing'},
  {key: 'jordan', name: 'Jordan Ellis (trial)', plan: 'draft'},
  {key: 'sam', name: 'Sam Rivera (trial)', plan: 'missing'}
];
function brIsTrialEmail_(email) { return /@trial\.schenglish\.invalid$/i.test(String(email || '')); }
function brTrialText_(category, plan) {
  const c = String(category || '').toLowerCase();
  const T = {
    surgery: {
      strong: 'Phones should stay in backpacks during class because a single notification pulls attention away from learning. When one phone buzzes, several students look over, and the teacher loses the thread of the lesson. Those lost minutes add up across a week. Students who keep phones away can follow multi-step explanations without having to catch up. A clear class rule removes the temptation entirely. Learning time is limited, and protecting it should come first.\n\nBiggest fix: I replaced vague words like "stuff" and "bad" with the actual effect on learning.',
      solid: 'Phones should not be allowed in class because they distract students. When someone gets a text, other people look at it too. This makes it harder for everyone to pay attention to the lesson. Teachers also have to stop teaching to deal with it. If phones were put away, students would focus better. That is why phones should be kept out of class.\n\nBiggest fix: I took out the sentence about my cousin.',
      developing: 'Phones are a problem in class because they distract people. When someone gets a text everyone looks. Teachers get mad and that is annoying. Phones should not be allowed because they are bad for learning.\n\nBiggest fix: fixed the fragments.'
    },
    perfect: {
      strong: 'The most useful ten-dollar upgrade for a classroom is a set of small whiteboards. Whiteboards let every student answer at once, so quiet students participate as much as confident ones. Teachers can see at a glance who understands and who needs help, which makes the next five minutes of a lesson far more effective. During a review game, for example, the whole class holds up answers instead of waiting for one volunteer. Other purchases, like snacks, disappear in a day, while whiteboards last all year. A small investment that changes how everyone participates is worth more than any one-time treat.',
      solid: 'The best way to spend ten dollars would be on whiteboards for the class. Whiteboards help everyone answer questions at the same time. This is good because more students get involved in the lesson. The teacher can also see who understands the topic. For example, in a review game everyone could show their answer. Whiteboards would make class better for everyone.',
      developing: 'Ten dollars should be spent on snacks. Snacks are good and everyone likes them. People get hungry in class. It would make the day better.'
    },
    vocab: {
      strong: 'A strong leader earns trust by staying ACCOUNTABLE for every decision, especially the unpopular ones. Real AUTHORITY does not come from a title; it comes from people believing the leader will act with INTEGRITY when no one is watching. Leaders who MANIPULATE their teams may get quick results, but those results collapse once the trick is noticed. The leaders people follow longest use their INFLUENCE to make others more capable, not more dependent. Trust, in the end, is the only authority that lasts.',
      solid: 'A leader people trust has INTEGRITY and tells the truth. They are ACCOUNTABLE when they make a mistake instead of blaming others. They use their INFLUENCE to help the team. Good leaders do not MANIPULATE people to get what they want. This is why people trust them.',
      developing: 'A good leader has AUTHORITY and people listen to them. They have a lot of INFLUENCE. Leaders should be nice to their team and help them.'
    },
    clutter: {
      strong: '1. The student council decided to discuss the dress code.\n2. Several reasons explain why students favor a later start.\n3. The teacher explained the assignment clearly.\n\nIn sentence 1, I cut the passive "was made by" and turned "have a discussion" into "discuss," which puts the actor first and cuts seven words.',
      solid: '1. The student council decided to have a discussion about the dress code.\n2. There are several reasons students want a later start time.\n3. The teacher explained the assignment in a clear way.\n\nI made sentence 3 shorter by using the verb "explained."',
      developing: '1. The decision was made by the student council to discuss the dress code.\n2. There are many reasons why students are in favor of a later start time.\n3. The teacher gave a clear explanation.\n\nI took out some words.'
    },
    transition: {
      strong: 'Our school tried a phone-free lunch period for one month. INITIALLY, many students complained during the first week. HOWEVER, conversations at lunch tables soon became noticeably louder and longer. MOREOVER, several students joined clubs that met during lunch. AS A RESULT, the school decided to keep the policy.\n\nI chose "however" because the louder conversations push against the complaints that came first.',
      solid: 'Our school tried a phone-free lunch for one month. At first many students complained. HOWEVER, conversations got louder and longer. ADDITIONALLY, some students joined clubs. THEREFORE, the school kept the policy.\n\nI used however because it shows a change.',
      developing: 'Our school tried a phone-free lunch. ALSO many students complained. THEREFORE conversations got louder. ALSO students joined clubs. The school kept it.\n\nI picked therefore because it sounds good.'
    },
    tone: {
      strong: '1. Hey! Practice is off today, the field is totally flooded. See you tomorrow.\n2. Attention, athletes: today\'s practice is canceled because the field is flooded. Please plan to attend tomorrow at the usual time.\n3. Dear families, due to flooding on the field, today\'s practice has been canceled. Please arrange pickup at the regular dismissal time. Thank you for your flexibility.\n\nThe parent email was hardest because it had to sound polite and give them something to do; "arrange pickup" made the biggest difference.',
      solid: '1. Practice is canceled, the field is flooded lol.\n2. Today\'s practice is canceled because the field is flooded.\n3. Dear parents, practice is canceled today because the field is flooded.\n\nThe announcement was hardest because it had to be clear.',
      developing: '1. no practice today\n2. Practice is canceled today because the field is flooded.\n3. Practice is canceled today because the field is flooded.\n\nThey were all easy.'
    },
    other: {
      strong: 'This response addresses every part of the prompt with specific, well-explained detail. Each idea builds on the one before it, and the final sentence connects the response back to why it matters.',
      solid: 'This response answers the prompt with a clear idea and some supporting detail. It is organized and easy to follow.',
      developing: 'This response starts to answer the prompt but needs more detail.'
    }
  };
  const key = c.indexOf('surgery') !== -1 ? 'surgery' : c.indexOf('perfect') !== -1 ? 'perfect' : c.indexOf('vocab') !== -1 ? 'vocab' :
    c.indexOf('clutter') !== -1 ? 'clutter' : c.indexOf('transition') !== -1 ? 'transition' : c.indexOf('tone') !== -1 ? 'tone' : 'other';
  const set = T[key];
  return plan === 'draft' ? set.developing.split(/\n\n/)[0].split('. ').slice(0, 2).join('. ') + '.' : (set[plan] || set.solid);
}

function addBrTrialStudents(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  const now = new Date();
  const enroll = brRows_(ss, 'ENROLL');
  const assignments = brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return a.classId === cls.classId && brBool_(a.active); });
  const responses = brRows_(ss, 'RESPONSES');
  let added = 0, made = 0;
  BR_TRIAL_STUDENTS.forEach(function (st, si) {
    const email = st.key + '.' + String(cls.joinCode || cls.classId).toLowerCase() + '@' + BR_TRIAL_DOMAIN;
    const existing = enroll.find(function (e) { return e.classId === cls.classId && brNormEmail_(e.studentEmail) === email; });
    if (existing && brBool_(existing.active)) return;
    if (existing) brUpdateMultiKey_(ss, 'ENROLL', function (e) { return e.classId === cls.classId && brNormEmail_(e.studentEmail) === email; }, {active: true});
    else brAppendObject_(ss, 'ENROLL', {classId: cls.classId, studentEmail: email, studentName: st.name, joinedAt: now.toISOString(), active: true});
    added++;
    assignments.forEach(function (a, ai) {
      // Rotate who does what, so every tile shows a different mix.
      const plans = ['strong', 'solid', 'developing', 'draft', 'missing'];
      const plan = plans[(si + ai) % plans.length];
      if (plan === 'missing') return;
      const responseId = a.assignmentId + '__' + brHash_(email).slice(0, 20);
      if (responses.some(function (r) { return r.responseId === responseId; })) return;
      const t = new Date(now.getTime() - (5 - si) * 60000 - ai * 3600000).toISOString();
      brAppendObject_(ss, 'RESPONSES', {
        responseId: responseId, assignmentId: a.assignmentId, classId: cls.classId, studentEmail: email, studentName: st.name,
        text: brTrialText_(a.category, plan), imageUrl: '', drawingData: '', status: plan === 'draft' ? 'draft' : 'submitted',
        score: '', feedback: '', submittedAt: plan === 'draft' ? '' : t, clientUpdatedAt: t, updatedAt: t
      });
      made++;
    });
  });
  return brSafe_({ok: true, added: added, responses: made});
}

function removeBrTrialStudents(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  let removed = 0;
  brRows_(ss, 'ENROLL').forEach(function (e) { if (e.classId === cls.classId && brBool_(e.active) && brIsTrialEmail_(e.studentEmail)) removed++; });
  if (removed) brUpdateMultiKey_(ss, 'ENROLL', function (e) { return e.classId === cls.classId && brIsTrialEmail_(e.studentEmail); }, {active: false});
  return brSafe_({ok: true, removed: removed});
}

/* ===== 2026.10.14.3 Add students by email (students enter their own name) + remember the class you are working in ===== */
// Teachers paste a list of student emails (optionally with names). Each student
// is enrolled straight away: the class appears for them the first time they
// open the app with that Google account - no join code needed.
const BR_ROSTER_MAX = 400;
const BR_LAST_CLASS_USER_PROP = 'SCHENGLISH_BR_LAST_CLASS';
const BR_EMAIL_RE_ = /^[^\s@<>(),;:"\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function brCleanStudentName_(name, email) {  // kept for older callers
  let n = String(name || '').replace(/[<>"\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  // "Brooks, Ava" -> "Ava Brooks" (how many school rosters export names)
  const m = n.match(/^([^,]+),\s*([^,]+)$/);
  if (m) n = m[2].trim() + ' ' + m[1].trim();
  return (n || brNameFromEmail_(email)).slice(0, 80);
}

function addBrStudentsByEmail(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, payload.classId, teacher);
  const list = Array.isArray(payload.entries) ? payload.entries : [];
  if (!list.length) throw new Error('Paste at least one student email.');
  if (list.length > BR_ROSTER_MAX) throw new Error('Add up to ' + BR_ROSTER_MAX + ' students at a time.');
  const lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine) lock.waitLock(20000);
  try {
    const enroll = brRows_(ss, 'ENROLL').filter(function (e) { return e.classId === cls.classId; });
    const byEmail = {};
    enroll.forEach(function (e) { byEmail[brNormEmail_(e.studentEmail)] = e; });
    const seen = {}, invalid = [], already = [], fresh = [], back = {};
    list.forEach(function (x) {
      const email = brNormEmail_(x && x.email);
      if (!email || !BR_EMAIL_RE_.test(email) || email.length > 120) { invalid.push(String((x && x.email) || '').slice(0, 120)); return; }
      if (seen[email]) return;
      seen[email] = true;
      if (email === brNormEmail_(cls.teacherEmail) || email === teacher.email) { invalid.push(email + ' (that is the teacher)'); return; }
      // No name from the teacher: the student types it the first time they open the app.
      const ex = byEmail[email];
      if (ex && brBool_(ex.active)) { already.push(email); return; }
      if (ex) { back[email] = ex.studentName || brKnownStudentName_(ss, email); return; }
      fresh.push({email: email, name: brKnownStudentName_(ss, email)});
    });
    const now = brNow_();
    if (fresh.length) {
      const sh = ss.getSheetByName('ENROLL'), headers = BR_SHEETS.ENROLL;
      const rows = fresh.map(function (f) {
        const o = {classId: cls.classId, studentEmail: f.email, studentName: f.name, joinedAt: now, active: true};
        return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
      });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    }
    const backList = Object.keys(back);
    backList.forEach(function (email) {
      brUpdateMultiKey_(ss, 'ENROLL', function (e) { return e.classId === cls.classId && brNormEmail_(e.studentEmail) === email; }, {active: true, studentName: back[email]}, true);
    });
    return brSafe_({ok: true, added: fresh.length, readded: backList.length, already: already, invalid: invalid,
      classId: cls.classId, className: cls.className});
  } finally {
    if (mine) lock.releaseLock();
  }
}

// Takes one student out of the class (same as the student leaving it). Their
// work stays in the backend, and adding them again brings it all back.
function removeBrStudent(payload) {
  payload = payload || {};
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, payload.classId, teacher);
  const email = brNormEmail_(payload.studentEmail);
  if (!email) throw new Error('Choose a student.');
  const done = brUpdateMultiKey_(ss, 'ENROLL', function (e) { return e.classId === cls.classId && brNormEmail_(e.studentEmail) === email; }, {active: false});
  return brSafe_({ok: true, removed: done ? 1 : 0});
}

// The class you are working in, remembered against your own account so the app
// opens there on any computer or browser (browser storage alone is unreliable
// inside the Google frame, especially in Safari).
function brLastClassKey_() {
  return BR_LAST_CLASS_USER_PROP + '__' + brCanvasHash_('schenglish-br-last:' + brRequireEmail_()).slice(0, 24);
}
function getBrLastClass() {
  const classId = String(PropertiesService.getUserProperties().getProperty(brLastClassKey_()) || '');
  // 2026-10-19.2 (from Lit Circles 2026-10-18g): nothing remembered yet -> the class with the most
  // students, not simply the first one made (a test class made first has only a few).
  let busiest = '';
  try {
    const ss = brDb_(), email = brRequireEmail_(), u = brFindOne_(ss, 'USERS', 'email', email);
    const admin = (PropertiesService.getScriptProperties().getProperty(BR_ADMIN_PROP) || '').toLowerCase() === email;
    if (admin || (u && ['teacher', 'admin'].indexOf(u.role) >= 0)) {
      const mine = brTeacherClasses_(ss, email, false), count = {}, seen = {};
      brRows_(ss, 'ENROLL').forEach(function (e) {
        const k = e.classId + '|' + brNormEmail_(e.studentEmail);
        if (seen[k] || !brBool_(e.active) || brIsTrialEmail_(e.studentEmail)) return;
        seen[k] = true; count[e.classId] = (count[e.classId] || 0) + 1;
      });
      mine.forEach(function (c) { if (!busiest || (count[c.classId] || 0) > (count[busiest] || 0)) busiest = c.classId; });
    }
  } catch (e) { busiest = ''; }
  return brSafe_({ok: true, classId: classId, busiest: busiest});
}
function setBrLastClass(payload) {
  const id = String((payload || {}).classId || '').trim();
  if (!id || id.length > 80 || !/^[\w-]+$/.test(id)) return brSafe_({ok: false});
  PropertiesService.getUserProperties().setProperty(brLastClassKey_(), id);
  return brSafe_({ok: true, classId: id});
}

// Which students on the roster have opened the app yet (a USERS row appears
// the first time someone signs in).
function getBrRosterStatus(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  const users = {};
  brRows_(ss, 'USERS').forEach(function (u) { users[brNormEmail_(u.email)] = true; });
  const out = {};
  brRows_(ss, 'ENROLL').forEach(function (e) {
    if (e.classId === cls.classId && brBool_(e.active)) out[brNormEmail_(e.studentEmail)] = !!users[brNormEmail_(e.studentEmail)];
  });
  return brSafe_({ok: true, signedIn: out});
}

// ---- Students enter their own name ------------------------------------------
// A student added by email has no name yet. The first time they open the app it
// asks for their first and last name, and that name is used in every class.
const BR_NAME_SHEET = 'STUDENT_NAMES';
const BR_NAME_HEADERS = ['email', 'firstName', 'lastName', 'updatedAt'];
let BR_NAME_CACHE_ = null;
function brNameSheet_(ss) {
  let sh = ss.getSheetByName(BR_NAME_SHEET);
  if (!sh) { sh = ss.insertSheet(BR_NAME_SHEET); sh.getRange(1, 1, 1, BR_NAME_HEADERS.length).setValues([BR_NAME_HEADERS]); }
  return sh;
}
function brNameRows_(ss) {
  if (BR_NAME_CACHE_) return BR_NAME_CACHE_;
  const sh = brNameSheet_(ss), lr = sh.getLastRow(), out = {};
  if (lr >= 2) sh.getRange(2, 1, lr - 1, BR_NAME_HEADERS.length).getValues().forEach(function (r, i) {
    const e = brNormEmail_(r[0]);
    if (e) out[e] = {row: i + 2, firstName: String(r[1] || ''), lastName: String(r[2] || '')};
  });
  BR_NAME_CACHE_ = out;
  return out;
}
// A name the student has already entered (empty when they have not).
function brKnownStudentName_(ss, email) {
  const n = brNameRows_(ss)[brNormEmail_(email)];
  return n ? (n.firstName + ' ' + n.lastName).trim() : '';
}
function brNamePart_(v) {
  return String(v || '').replace(/[<>"\\{}\[\]`|=@\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function getBrStudentProfile() {
  const email = brRequireEmail_(), ss = brDbReadOnly_();
  const enroll = brRows_(ss, 'ENROLL').filter(function (e) { return brNormEmail_(e.studentEmail) === email && brBool_(e.active); });
  const known = ss.getSheetByName(BR_NAME_SHEET) ? brNameRows_(ss)[email] : null;
  const derived = brNameFromEmail_(email);
  // Ask when the student is in a class under no real name: added by email
  // (blank), or still the placeholder made from the email address.
  const needsName = !known && enroll.length > 0 && enroll.some(function (e) {
    const n = String(e.studentName || '').trim();
    return !n || n === derived || n === email;
  });
  // Pre-fill the form with the name already on the roster (e.g. one typed when
  // joining with a code), so the student only has to check it and continue.
  const onRoster = enroll.map(function (e) { return String(e.studentName || '').trim(); }).find(function (n) { return n && n !== email; }) || '';
  const sp = onRoster.lastIndexOf(' ');
  return brSafe_({ok: true, needsName: needsName, confirmed: !!known,
    firstName: known ? known.firstName : '', lastName: known ? known.lastName : '', name: known ? (known.firstName + ' ' + known.lastName).trim() : onRoster,
    suggestFirst: known ? known.firstName : (sp > 0 ? onRoster.slice(0, sp) : onRoster), suggestLast: known ? known.lastName : (sp > 0 ? onRoster.slice(sp + 1) : '')});
}
function setBrStudentName(payload) {
  payload = payload || {};
  const email = brRequireEmail_(), ss = brDb_();
  const first = brNamePart_(payload.firstName), last = brNamePart_(payload.lastName);
  if (!first || !last) throw new Error('Please enter your first and last name.');
  const full = first + ' ' + last, now = brNow_();
  const lock = LockService.getScriptLock(), mine = !lock.hasLock();
  if (mine) lock.waitLock(20000);
  try {
    BR_NAME_CACHE_ = null;
    const sh = brNameSheet_(ss), known = brNameRows_(ss)[email];
    if (known) sh.getRange(known.row, 1, 1, BR_NAME_HEADERS.length).setValues([[email, first, last, now]]);
    else sh.appendRow([email, first, last, now]);
    BR_NAME_CACHE_ = null;
    brUpdateMultiKey_(ss, 'ENROLL', function (e) { return brNormEmail_(e.studentEmail) === email; }, {studentName: full});
    // RESPONSES rows are left alone on purpose: every screen takes the name from the roster.
    if (brFindOne_(ss, 'USERS', 'email', email)) brUpdateByKey_(ss, 'USERS', 'email', email, {name: full, updatedAt: now});
  } finally {
    if (mine) lock.releaseLock();
  }
  return brSafe_({ok: true, firstName: first, lastName: last, name: full});
}


// ---- Opening a bell ringer from its Canvas link (2026.10.14.3) -------------
// The Canvas link carries only the bell ringer id. One Canvas assignment can be
// shared by several periods (each period is its own class in the app), so the
// student is sent to the copy that belongs to a class they are actually in.
function resolveBrDeepLink(payload) {
  payload = payload || {};
  const ss = brDb_(), email = brRequireEmail_();
  const br = String(payload.br || ''), c = String(payload.c || '');
  const mine = {};
  brRows_(ss, 'ENROLL').forEach(function (e) { if (brNormEmail_(e.studentEmail) === email && brBool_(e.active)) mine[e.classId] = true; });
  const active = brRows_(ss, 'CLASSES').filter(function (k) { return brBool_(k.active); }).map(function (k) { return k.classId; });
  const assignments = brRows_(ss, 'ASSIGNMENTS').filter(function (x) { return brBool_(x.active) && mine[x.classId] && active.indexOf(x.classId) !== -1; });
  const a = brFindOne_(ss, 'ASSIGNMENTS', 'assignmentId', br);
  if (a && brBool_(a.active) && assignments.some(function (x) { return x.assignmentId === a.assignmentId; })) {
    return brSafe_({ok: true, classId: a.classId, assignmentId: a.assignmentId});
  }
  if (a) {
    const all = brCanvasAll_(ss);
    const cid = function (x) { const l = brCanvasGet_(ss, 'assignment', x.assignmentId, all) || {}; return String(l.canvasAssignmentId || x.canvasAssignmentId || ''); };
    const target = cid(a);
    let hit = target ? assignments.find(function (x) { return cid(x) === target; }) : null;
    if (!hit) hit = assignments.find(function (x) { return (a.libraryId && x.libraryId === a.libraryId) || String(x.title || '').trim() === String(a.title || '').trim(); });
    if (hit) return brSafe_({ok: true, classId: hit.classId, assignmentId: hit.assignmentId});
  }
  if (c && mine[c]) return brSafe_({ok: true, classId: c, assignmentId: '', reason: a ? 'notInClass' : 'notFound'});
  return brSafe_({ok: true, classId: '', assignmentId: '', reason: a ? 'notInClass' : 'notFound'});
}

// ===========================================================================
// LMS HUB BRIDGE (2026.10.14.3) -- Canvas through your Cloudflare LMS Hub
//
// When Script Properties has LMS_HUB_ENABLED = true (plus LMS_HUB_URL and
// LMS_HUB_KEY) and the LmsHub.gs file is in this project, creating Canvas
// assignments, pushing grades and comments, and refreshing student links all
// go through the hub instead of straight to Canvas. Nothing changes for you:
// same buttons, same results.
//
// The first time a class goes through the hub, the app sends your saved
// Canvas token to the hub (encrypted there) and imports this class's existing
// Canvas assignments and the record of comments already posted -- so no
// duplicate assignments and no repeated comments.
//
// Still direct to Canvas (read-only or one-field): the course, group and
// module lists, reading a due date back from Canvas, and the "Counts toward
// grade" switch (Canvas's omit-from-final-grade flag, which the hub does not
// carry).
//
// To go back: set LMS_HUB_ENABLED to false. The app keeps its own record of
// every Canvas assignment and comment, so the direct code carries on.
// ===========================================================================
function brHubEnabled_() {
  const p = PropertiesService.getScriptProperties();
  return String(p.getProperty('LMS_HUB_ENABLED') || '').trim().toLowerCase() === 'true' &&
    !!String(p.getProperty('LMS_HUB_URL') || '').trim() && !!String(p.getProperty('LMS_HUB_KEY') || '').trim() &&
    typeof LmsHub !== 'undefined';
}
function brHubWanted_() {
  return String(PropertiesService.getScriptProperties().getProperty('LMS_HUB_ENABLED') || '').trim().toLowerCase() === 'true';
}
// Turns a hub failure into a sentence a teacher can act on.
function brHubCall_(fn) {
  try { return fn(); } catch (e) {
    const code = e && e.hubCode, msg = String((e && e.message) || e);
    let text;
    if (/LMS Hub is not set up|Could not tell which teacher/.test(msg)) text = msg;
    else if (!code && !(e && e.status)) text = 'Could not reach the LMS Hub (' + msg.replace(/^Exception:\s*/, '') + ').';
    else if (code === 'unauthorized') text = 'The LMS Hub did not accept this app\'s key. Check LMS_HUB_KEY in Script Properties.';
    else if (code === 'lms_unauthorized') text = 'Canvas turned down the access token the hub has. Reconnect Canvas (Canvas settings), then try again.';
    else if (code === 'not_connected') text = 'Canvas is not connected in the LMS Hub yet. Connect Canvas in Canvas settings, then try again.';
    else if (code === 'class_not_linked') text = 'This class is not linked to a Canvas course in the hub yet. Try again; if it repeats, re-link the class in Canvas settings.';
    else text = 'The LMS Hub reported a problem: ' + msg;
    const err = new Error(text + ' (To go straight to Canvas instead, set LMS_HUB_ENABLED to false in Script Properties.)');
    err.hubCode = code;
    throw err;
  }
}
// Runs fn; if Canvas rejected the token the hub holds, sends the app's current
// token to the hub once and tries again (the teacher may have reconnected).
function brHubWithToken_(teacher, fn) {
  try { return brHubCall_(fn); } catch (e) {
    if (e.hubCode !== 'lms_unauthorized' && e.hubCode !== 'not_connected') throw e;
    const conn = brCanvasConnection_();
    if (!conn.connected) throw e;
    brHubCall_(function () { return LmsHub.saveConnection({platform: 'canvas', baseUrl: conn.baseUrl, token: conn.token}, teacher); });
    return brHubCall_(fn);
  }
}
function brMd5Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function brSha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s || '').trim(), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
// Changes whenever the class's course, group, or set of Canvas assignments changes.
function brHubStamp_(ss, cls, course, all) {
  const parts = [String(course.courseId || ''), String(course.assignmentGroupId || '')];
  brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return a.classId === cls.classId; }).forEach(function (a) {
    const l = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    if (l.canvasAssignmentId) parts.push(a.assignmentId + '|' + l.canvasAssignmentId);
  });
  return brMd5Hex_(parts.sort().join('\n')).slice(0, 16);
}
// Makes sure the hub has the teacher's Canvas token and this class's course
// link, importing the app's existing Canvas assignments the first time.
function brHubEnsureClass_(ss, cls, course, teacher) {
  if (!course.courseId) throw new Error('Link this class to a Canvas course first.');
  const all = brCanvasAll_(ss);
  const me = brHubCall_(function () { return LmsHub.me(teacher); });
  if (!(me.connections || []).some(function (x) { return x.platform === 'canvas'; })) {
    const conn = brCanvasConnection_();
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas settings).');
    brHubCall_(function () { return LmsHub.saveConnection({platform: 'canvas', baseUrl: conn.baseUrl, token: conn.token}, teacher); });
  }
  const stamp = brHubStamp_(ss, cls, course, all);
  const mark = brCanvasGet_(ss, 'hub', cls.classId, all) || {};
  const hubLink = brHubCall_(function () { return LmsHub.getClassLink(cls.classId, teacher).link; });
  if (hubLink && hubLink.platform === 'canvas' && String(hubLink.courseId) === String(course.courseId) &&
      String(hubLink.groupId || '') === String(course.assignmentGroupId || '') && mark.stamp === stamp) return;
  const assignments = {};
  const responses = brRows_(ss, 'RESPONSES').filter(function (r) { return r.classId === cls.classId; });
  brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return a.classId === cls.classId; }).forEach(function (a) {
    const l = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    if (!l.canvasAssignmentId) return;
    // The app remembers an MD5 of each comment it posted; the hub uses SHA-256.
    // For each student whose comment today is the one that was posted, tell
    // the hub, so it is not posted a second time.
    const feedback = [];
    const sent = l.feedbackSync || {};
    responses.forEach(function (r) {
      if (r.assignmentId !== a.assignmentId) return;
      const fb = String(r.feedback || '').trim(), e = brNormEmail_(r.studentEmail);
      const prior = sent[e];
      if (fb && prior && String(prior.hash || '') === brCanvasHash_(fb)) feedback.push({email: e, sha256: brSha256Hex_(fb)});
    });
    assignments[a.assignmentId] = {
      lmsAssignmentId: String(l.canvasAssignmentId), name: l.name || a.title || '', htmlUrl: l.htmlUrl || '',
      pointsPossible: BR_POINTS, gradingType: 'points', published: true,
      placementId: l.moduleId || '', placementName: l.moduleName || '', placementItemId: l.moduleItemId || '',
      dueAt: l.dueAt || '', unlockAt: l.unlockAt || '', lockAt: l.lockAt || '',
      lastAssignmentSyncAt: l.lastAssignmentSyncAt || '', lastGradeSyncAt: l.lastGradeSyncAt || '',
      feedback: feedback
    };
  });
  brHubCall_(function () {
    return LmsHub.importClass(cls.classId, {platform: 'canvas', courseId: String(course.courseId), courseName: course.courseName || '',
      groupId: String(course.assignmentGroupId || ''), groupName: course.assignmentGroupName || '', assignments: assignments}, teacher);
  });
  brCanvasPut_(ss, 'hub', cls.classId, cls.classId, {stamp: stamp, courseId: course.courseId, at: brNow_()});
}
// What the Canvas assignment should look like.
function brHubSpec_(a) {
  const spec = {title: String(a.title || 'Bell Ringer').trim(), pointsPossible: BR_POINTS, gradingType: 'points'};
  if (brCanvasAppUrl_()) spec.description = brCanvasDescription_(a);   // never replace a working link with none
  return spec;
}
// Writes the hub's answer back into the app's own Canvas record (the tiles,
// due-date window and a later direct push all read it).
function brHubMirror_(ss, ctx, hubAssignment, extra) {
  const old = ctx.link || {};
  const h = hubAssignment || {};
  const link = Object.assign({}, old, {
    canvasAssignmentId: String(h.lmsAssignmentId || old.canvasAssignmentId || ''),
    courseId: ctx.course.courseId,
    name: h.name || old.name || ctx.a.title,
    htmlUrl: h.htmlUrl || old.htmlUrl || '',
    pointsPossible: Number(h.pointsPossible || BR_POINTS),
    dueAt: h.dueAt !== undefined ? (h.dueAt || '') : (old.dueAt || ''),
    unlockAt: h.unlockAt !== undefined ? (h.unlockAt || '') : (old.unlockAt || ''),
    lockAt: h.lockAt !== undefined ? (h.lockAt || '') : (old.lockAt || ''),
    moduleId: h.placementId !== undefined ? (h.placementId || '') : (old.moduleId || ''),
    moduleName: h.placementName !== undefined ? (h.placementName || '') : (old.moduleName || ''),
    moduleItemId: h.placementItemId !== undefined ? (h.placementItemId || '') : (old.moduleItemId || ''),
    lastAssignmentSyncAt: h.lastAssignmentSyncAt || old.lastAssignmentSyncAt || '',
    lastGradeSyncAt: h.lastGradeSyncAt || old.lastGradeSyncAt || '',
    feedbackSync: old.feedbackSync || {},
    noGrade: !!old.noGrade,
    deletedInCanvasAt: h.lmsAssignmentId ? '' : (old.deletedInCanvasAt || ''),
    via: 'hub'
  }, extra || {});
  brCanvasPut_(ss, 'assignment', ctx.a.assignmentId, ctx.cls.classId, link);
  brUpdateByKey_(ss, 'ASSIGNMENTS', 'assignmentId', ctx.a.assignmentId, {
    canvasAssignmentId: link.canvasAssignmentId, dueAt: link.dueAt || ctx.a.dueAt || '', updatedAt: brNow_()
  });
  // The class's set of Canvas assignments may have changed: keep the stamp current.
  brCanvasPut_(ss, 'hub', ctx.cls.classId, ctx.cls.classId, {stamp: brHubStamp_(ss, ctx.cls, ctx.course, null), courseId: ctx.course.courseId, at: brNow_()});
  return link;
}
function brHubSharedNames_(ss, shared) {
  const names = {};
  brRows_(ss, 'CLASSES').forEach(function (k) { names[k.classId] = k.className || k.classId; });
  return (shared || []).map(function (s) { return names[s.classId] || s.classId; });
}
// "Counts toward grade" lives on the Canvas assignment; the hub does not carry it.
function brHubApplyOmit_(course, canvasAssignmentId, noGrade) {
  if (!noGrade || !canvasAssignmentId || !brCanvasConnection_().connected) return '';
  try {
    brCanvasRequest_('put', '/api/v1/courses/' + encodeURIComponent(course.courseId) + '/assignments/' + encodeURIComponent(canvasAssignmentId),
      {'assignment[omit_from_final_grade]': 'true'});
    return '';
  } catch (e) { return 'Canvas could not be told to leave it out of the final grade: ' + e.message; }
}

// Create / update the Canvas assignment through the hub (same result shape as syncBrCanvasAssignment).
function brHubSyncAssignment_(payload) {
  payload = payload || {};
  const ss = brDb_();
  let ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  let remade = false;
  if (!payload._checked && brCanvasForgetDeleted_(ss, ctx)) { remade = true; ctx = brCanvasAssignmentContext_(ss, payload.assignmentId); }
  if (!ctx.link.canvasAssignmentId && ctx.link.deletedInCanvasAt) remade = true;
  const c = ctx.course, old = ctx.link, a = ctx.a, teacher = ctx.teacher.email;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  if (!brCanvasAppUrl_()) throw new Error('The student link to this app is not set up yet, so the Canvas assignment would have a broken link. Open Canvas settings and save the app link (the one ending in /exec) first.');
  brHubEnsureClass_(ss, ctx.cls, c, teacher);
  const spec = brHubSpec_(a);
  spec.published = true;
  // Dates and module only change when this call supplies them. A brand-new
  // Canvas assignment starts with the app's due date.
  if (payload.dueAt !== undefined) spec.dueAt = String(payload.dueAt || '');
  else if (!old.canvasAssignmentId && a.dueAt) spec.dueAt = String(a.dueAt);
  if (payload.unlockAt !== undefined) spec.unlockAt = String(payload.unlockAt || '');
  if (payload.lockAt !== undefined) spec.lockAt = String(payload.lockAt || '');
  const wantModule = payload.moduleId !== undefined ? String(payload.moduleId || '') : ((remade || !old.canvasAssignmentId) && old.moduleId ? String(old.moduleId) : undefined);
  if (wantModule !== undefined) spec.placementId = wantModule;
  // A group chosen for this assignment in its window (only sent when changed); the hub moves it there.
  if (payload.assignmentGroupId) spec.groupId = String(payload.assignmentGroupId);
  // Two classes sharing one Canvas assignment share one module item: when another class already
  // placed it in that module, don't ask the hub to place it again.
  const guessId = String(old.canvasAssignmentId || '') || brCanvasSiblingByName_(ss, ctx.cls.classId, c.courseId, a.title);
  const ownThere = !!old.moduleItemId && String(old.moduleId || '') === String(wantModule || '');
  const sibItem = wantModule && guessId && !ownThere ? brCanvasSiblingModuleItem_(ss, ctx.cls.classId, c.courseId, guessId, wantModule) : null;
  if (sibItem) delete spec.placementId;
  const r = brHubWithToken_(teacher, function () { return LmsHub.syncAssignment(ctx.cls.classId, a.assignmentId, spec, teacher); });
  const extraLink = {descVersion: BR_DESC_VERSION, lastAssignmentSyncAt: brNow_()};
  if (sibItem && String((r.assignment || {}).lmsAssignmentId || '') === guessId) Object.assign(extraLink, sibItem);
  const link = brHubMirror_(ss, ctx, r.assignment, extraLink);
  const warn = brHubApplyOmit_(c, link.canvasAssignmentId, link.noGrade);
  return brSafe_({ok: true, link: link, adopted: !!r.adopted, created: !!r.created, remade: remade, via: 'hub',
    warnings: (r.warnings || []).concat(warn ? [warn] : []), sharedWith: brHubSharedNames_(ss, r.sharedWith)});
}

// Push scores and comments through the hub (same result shape as pushBrCanvasGrades).
function brHubPushGrades_(payload, shared) {
  payload = payload || {};
  const ss = brDb_();
  let ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
  if (!ctx.course.courseId) throw new Error('Link this class to a Canvas course first.');
  let remade = false;
  if (brCanvasForgetDeleted_(ss, ctx)) {
    ctx = brCanvasAssignmentContext_(ss, payload.assignmentId);
    if (payload.onlyLinked) return brSafe_({ok: true, notInCanvas: true, deletedInCanvas: true, title: ctx.a.title, sent: 0});
    remade = true;
  }
  if (!ctx.link.canvasAssignmentId && ctx.link.deletedInCanvasAt) {
    if (payload.onlyLinked) return brSafe_({ok: true, notInCanvas: true, deletedInCanvas: true, title: ctx.a.title, sent: 0});
    remade = true;
  }
  const c = ctx.course, a = ctx.a, teacher = ctx.teacher.email;
  if (payload.onlyLinked && !ctx.link.canvasAssignmentId) return brSafe_({ok: true, notInCanvas: true, title: a.title, sent: 0});
  if (!(shared && shared.hubReady)) brHubEnsureClass_(ss, ctx.cls, c, teacher);
  if (shared) shared.hubReady = true;
  const rows = brAssignmentRows_(ss, a);
  const hubRows = [], skipped = [], waiting = [], byEmail = {}, excused = [], stillExcused = [];
  const excusedBefore = ctx.link.excusedEmails || {};
  let trialSkipped = 0;
  rows.forEach(function (r) {
    if (brIsTrialEmail_(r.email)) { trialSkipped++; return; }   // trial students never go to Canvas
    const feedback = String(r.feedback || '').trim();
    let score = r.score === null || r.score === undefined ? null : Number(r.score);
    const e = brNormEmail_(r.email);
    // 2026.10.18.1: excluded for this one student -> sent as excused (the hub's rows take
    // excused:true and Canvas marks it Excused). No comment goes with it.
    if (r.excluded) { byEmail[r.email] = r; hubRows.push({email: r.email, name: r.name, score: null, excused: true, feedback: ''}); excused.push(r.name); return; }
    // Excused earlier and still no score: leave Canvas as it is.
    if (score === null && excusedBefore[e]) { if (r.submitted || r.rank === 0) waiting.push(r.name); return; }
    // Excused earlier and scored now: the score goes, but the hub can't send excuse=false.
    if (score !== null && excusedBefore[e]) stillExcused.push(r.name);
    if (score === null) {
      if (r.submitted || r.rank === 0) waiting.push(r.name);
      else if (!feedback) skipped.push(r.rank === 4 ? r.name + ' (draft, not submitted)' : r.name);
      if (!feedback) return;
    }
    byEmail[r.email] = r;
    hubRows.push({email: r.email, name: r.name, score: score, excused: false, feedback: feedback});
  });
  const spec = brHubSpec_(a);
  if (!ctx.link.canvasAssignmentId) {   // first push creates it: give it the app's due date and publish it
    spec.published = true;
    if (a.dueAt) spec.dueAt = String(ctx.link.dueAt || a.dueAt);
    if (ctx.link.moduleId) spec.placementId = String(ctx.link.moduleId);   // made again: back in the module it was in
  }
  const res = brHubWithToken_(teacher, function () { return LmsHub.pushGrades(ctx.cls.classId, a.assignmentId, spec, hubRows, teacher); });
  // Keep the app's own comment record current, so a later direct push never re-posts.
  const skip = {};
  (res.unmatched || []).forEach(function (u) { const m = /\(([^()]+)\)$/.exec(u); if (m) skip[brNormEmail_(m[1])] = true; });
  (res.failed || []).forEach(function (f) { skip[brNormEmail_(f.email)] = true; });
  (res.feedbackDeferred || []).forEach(function (e) { skip[brNormEmail_(e)] = true; });
  (res.pending || []).forEach(function (e) { skip[brNormEmail_(e)] = true; });
  const feedbackSync = Object.assign({}, ctx.link.feedbackSync || {});
  const excusedNow = {};
  Object.keys(excusedBefore).forEach(function (e) { if (!byEmail[e] || byEmail[e].score === null) excusedNow[e] = true; });
  hubRows.forEach(function (h) {
    const e = brNormEmail_(h.email);
    if (h.excused) { if (!skip[e] || excusedBefore[e]) excusedNow[e] = true; return; }
    if (excusedBefore[e] && !skip[e]) delete excusedNow[e];
    if (h.feedback && !skip[e]) feedbackSync[e] = {hash: brCanvasHash_(h.feedback), syncedAt: brNow_()};
  });
  const extra = {feedbackSync: feedbackSync, lastGradeSyncAt: brNow_(), excusedEmails: excusedNow};
  if (spec.description) extra.descVersion = BR_DESC_VERSION;
  const link = brHubMirror_(ss, ctx, res.assignment, extra);
  const warnings = (res.warnings || []).slice();
  if (res.pointsConflict) warnings.push(res.pointsConflict);
  if ((res.pending || []).length) warnings.push(res.pending.length + ' student(s) are still waiting - push again to finish.');
  if (stillExcused.length) warnings.push('These were excused in Canvas earlier and now have a score. The LMS Hub sent the score but can\u2019t lift the excusal itself: ' + stillExcused.join(', ') + '. If Canvas still shows them as Excused, push once with LMS_HUB_ENABLED=false.');
  if (res.created) { const w = brHubApplyOmit_(c, link.canvasAssignmentId, link.noGrade); if (w) warnings.push(w); }
  return brSafe_({
    ok: true, via: 'hub', title: a.title, remade: remade, sent: Number(res.sent) || 0, excused: excused, unexcused: [], pointsPossible: BR_POINTS,
    unmatched: res.unmatched || [], skipped: skipped, waiting: waiting,
    feedbackPosted: Number(res.feedbackPosted) || 0, feedbackSkipped: Number(res.feedbackSkipped) || 0,
    feedbackFailed: (res.feedbackFailed || []).concat((res.failed || []).map(function (f) { return (byEmail[f.email] ? byEmail[f.email].name : f.email) + ': ' + f.error; })),
    trialSkipped: trialSkipped, warnings: warnings, link: link, progressUrl: res.progressUrl || '',
    sharedWith: brHubSharedNames_(ss, res.sharedWith)
  });
}

// Refresh the student link in every Canvas assignment of a class, through the hub.
function brHubUpdateLinks_(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const cls = brOwnedClass_(ss, (payload || {}).classId, teacher);
  if (!brCanvasAppUrl_()) throw new Error('Save a working app link first.');
  const all = brCanvasAll_(ss), course = brCanvasClassLink_(ss, cls, all);
  if (!course.courseId) throw new Error('Link this class to a Canvas course first.');
  brHubEnsureClass_(ss, cls, course, teacher.email);
  let updated = 0;
  const failed = [];
  brRows_(ss, 'ASSIGNMENTS').filter(function (a) { return a.classId === cls.classId && brBool_(a.active); }).forEach(function (a) {
    const link = brCanvasGet_(ss, 'assignment', a.assignmentId, all) || {};
    if (!link.canvasAssignmentId) return;
    try {
      brHubWithToken_(teacher.email, function () { return LmsHub.syncAssignment(cls.classId, a.assignmentId, brHubSpec_(a), teacher.email); });
      link.descVersion = BR_DESC_VERSION;
      brCanvasPut_(ss, 'assignment', a.assignmentId, cls.classId, link);
      updated++;
    } catch (e) { failed.push(a.title + ': ' + (e.message || e)); }
  });
  return brSafe_({ok: true, updated: updated, failed: failed, url: brCanvasAppUrl_(), via: 'hub'});
}

// For the Canvas settings window: is the hub on, and does it answer?
function getBrHubStatus() {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const out = {ok: true, wanted: brHubWanted_(), enabled: brHubEnabled_(), fileMissing: brHubWanted_() && typeof LmsHub === 'undefined'};
  if (!out.enabled) return brSafe_(out);
  try {
    const me = LmsHub.me(teacher.email);
    out.app = me.app ? {id: me.app.id, name: me.app.name} : null;
    out.canvasConnected = (me.connections || []).some(function (x) { return x.platform === 'canvas'; });
    out.reachable = true;
  } catch (e) { out.reachable = false; out.message = String(e.message || e); }
  return brSafe_(out);
}

// Run from the editor: checks the hub key and connection for this app.
function testBellRingerLmsHub() {
  if (typeof LmsHub === 'undefined') { Logger.log('LmsHub.gs is missing from this project. Add it (same file as Root Word Study uses).'); return null; }
  const me = LmsHub.me();
  Logger.log('Hub app: ' + (me.app && (me.app.name + ' (' + me.app.id + ')')));
  Logger.log('Canvas connected in the hub for you: ' + ((me.connections || []).some(function (c) { return c.platform === 'canvas'; }) ? 'yes' : 'not yet (it is sent the first time you create or push)'));
  Logger.log('LMS_HUB_ENABLED: ' + (brHubEnabled_() ? 'on - Canvas goes through the hub' : 'off - Canvas goes direct'));
  return me;
}
// Canvas assignment groups: the app chooses the group only when it CREATES an assignment.
// Updates never send a group, so an assignment moved to another group in Canvas stays there.
// chosen = the group the teacher picked for THIS assignment in its "Due date & Canvas" window
// (sent only when they changed it). Creating: chosen, else the class default. Updating: pass
// c = null, so only an explicit choice moves it.
function brCanvasWithGroup_(form, c, chosen) {
  var f = {};
  Object.keys(form || {}).forEach(function (k) { f[k] = form[k]; });
  var g = String(chosen || '') || String((c && c.assignmentGroupId) || '');
  if (g) f['assignment[assignment_group_id]'] = g;
  return f;
}
