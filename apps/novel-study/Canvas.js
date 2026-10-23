// ============================================================================
// Novel Study -- Canvas.
// Tokens are stored PER TEACHER (Script Properties keyed by a hash of the teacher's email): the app
// runs as its owner, so one UserProperties key would be shared by every teacher.
// With LMS_HUB_ENABLED=true everything goes through the shared LMS Hub (NovelStudyLmsHub); otherwise
// straight to Canvas. Both use nvCanvasRows_ so Push, Push all and the CSV always agree.
// The latest push is the truth in Canvas: excluded -> Excused; excused earlier by this app and now
// scored -> excusal lifted and the score sent; no score and not excluded -> nothing sent.
// ============================================================================

var NV_CANVAS_PROP_PREFIX = 'NV_CANVAS_';
function nvCanvasPropKey_(email) { return NV_CANVAS_PROP_PREFIX + nvMd5_(nvNorm_(email)).slice(0, 20); }
function nvCanvasConn_(email) {
  var raw = nvParse_(PropertiesService.getScriptProperties().getProperty(nvCanvasPropKey_(email)), null) || {};
  return { baseUrl: String(raw.baseUrl || ''), token: String(raw.token || ''), connected: !!(raw.baseUrl && raw.token) };
}
function nvCanvasStatus_(email) { var c = nvCanvasConn_(email); return { connected: c.connected, baseUrl: c.baseUrl }; }
function nvCanvasUrl_(v) {
  var s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Type your Canvas address, for example https://yourschool.instructure.com');
  if (!/^https:\/\//i.test(s)) s = 'https://' + s.replace(/^https?:\/\//i, '');
  return s.replace(/\/api\/v1$/i, '');
}
function nvCanvasError_(body) {
  try { var j = JSON.parse(String(body || '')); if (Array.isArray(j.errors) && j.errors.length) return j.errors.map(function (e) { return e.message || String(e); }).join('; '); if (j.message) return j.message; } catch (e) {}
  return String(body || 'Canvas request failed.').slice(0, 400);
}
function nvCanvasRequest_(conn, method, path, payload) {
  if (!conn || !conn.connected) throw new Error('Connect Canvas first (Canvas card on the dashboard).');
  var url = /^https:\/\//i.test(path) ? path : conn.baseUrl + path;
  if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
  var opt = { method: String(method || 'get').toLowerCase(), headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true };
  if (payload && Object.keys(payload).length) opt.payload = payload;
  var res = UrlFetchApp.fetch(url, opt), status = res.getResponseCode(), body = res.getContentText();
  if (status < 200 || status >= 300) {
    var err = new Error(status === 401 ? 'Canvas didn’t accept the access token. Paste a new token in the Canvas card.' : 'Canvas ' + status + ': ' + nvCanvasError_(body));
    err.canvasStatus = status; throw err;
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch (e) { return { raw: body }; }
}
function nvCanvasGetAll_(conn, path) {
  var url = conn.baseUrl + path, out = [], guard = 0;
  while (url && guard++ < 30) {
    if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true });
    var status = res.getResponseCode(), body = res.getContentText();
    if (status < 200 || status >= 300) { var err = new Error('Canvas ' + status + ': ' + nvCanvasError_(body)); err.canvasStatus = status; throw err; }
    var rows = []; try { rows = JSON.parse(body || '[]'); } catch (e) {}
    if (Array.isArray(rows)) out = out.concat(rows);
    var h = res.getHeaders ? res.getHeaders() : {}, link = String(h.Link || h.link || ''), next = '';
    link.split(',').forEach(function (part) { var m = part.match(/<([^>]+)>\s*;\s*rel="next"/); if (m) next = m[1]; });
    url = next;
  }
  return out;
}

// ---------- an assignment deleted in Canvas is made again (cross-app, Lit Circles 2026-10-18g) ----------
// The app kept the link to an assignment someone deleted in Canvas, so Push and due dates went on
// updating something that no longer exists (or Push all quietly made it again). Now a tile's Push, the
// due-date window and Save first ask Canvas whether the linked assignment still exists. A deleted one
// is forgotten -- by this class, by every other class on the same course that shares it, and by the
// LMS Hub -- so the next tile Push (or Save in the due-date window) makes it again. Push all never
// makes assignments: it names the deleted ones instead.
/** True only when Canvas says it was deleted (404, or workflow_state "deleted"). Any other answer --
 *  an error, no connection -- counts as "still there", so a hiccup never drops a link. */
function nvCanvasAssignmentDeleted_(classId, c, key, link, teacher) {
  if (lmsHubEnabled_()) {
    try { LmsHub.assignment(classId, key, true, teacher); return false; }
    catch (e) { return !!e && Number(e.lmsStatus) === 404; }
  }
  var conn = nvCanvasConn_(teacher);
  if (!conn.connected) return false;
  try {
    var a = nvCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId));
    return !!a && String(a.workflow_state || '') === 'deleted';
  } catch (e2) {
    if (!e2 || e2.canvasStatus !== 404) return false;
    try { nvCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId)); return true; } catch (e3) { return false; }
  }
}
/** Forgets the linked assignments among `keys` that were deleted in Canvas. Returns the keys forgotten. */
function nvCanvasForgetDeleted_(classId, keys, teacher) {
  var k = nvClass_(classId); if (!k) return [];
  var c = nvSettingsOf_(k).canvas || {}; if (!c.courseId) return [];
  var deadIds = {}, gone = [];
  (keys || []).forEach(function (key) {
    var l = (c.assignments || {})[key]; if (!l || !l.assignmentId) return;
    var id = String(l.assignmentId);
    if (deadIds[id] || nvCanvasAssignmentDeleted_(classId, c, key, l, teacher)) { deadIds[id] = true; gone.push(key); }
  });
  if (!gone.length) return [];
  var hub = lmsHubEnabled_();
  nvClasses_().slice().forEach(function (kk) {
    var kc = (nvSettingsOf_(kk).canvas) || {};
    if (String(kc.courseId || '') !== String(c.courseId)) return;
    var ks = Object.keys(kc.assignments || {}).filter(function (x) { return deadIds[String((kc.assignments[x] || {}).assignmentId || '')]; });
    if (!ks.length) return;
    if (hub) ks.forEach(function (x) { try { LmsHub.forgetAssignment(String(kk.ClassId), x, nvNorm_(kk.TeacherEmail)); } catch (e) {} });
    try {
      nvUpdateSettings_(String(kk.ClassId), function (st) {
        if (String((st.canvas || {}).courseId || '') !== String(c.courseId)) return;
        st.canvas.deleted = st.canvas.deleted || {};
        ks.forEach(function (x) { if (deadIds[String(((st.canvas.assignments || {})[x] || {}).assignmentId || '')]) { delete st.canvas.assignments[x]; st.canvas.deleted[x] = true; } });
      });
      ks.forEach(function (x) { nvClearPosted_(String(kk.ClassId), x); });
    } catch (e) { try { console.warn('forget deleted: ' + e.message); } catch (e2) {} }
  });
  NV_X_.classes = null;
  return gone;
}
/** What reached the deleted assignment no longer counts: the new one gets every score and comment. */
function nvClearPosted_(classId, key) {
  var sh = nvSheet_('Grades');
  nvRowCritical_(function () {
    nvReadRows_(sh, nvFindRowNums_(sh, 'ItemKey', key)).forEach(function (r) {
      if (String(r.ClassId) !== String(classId) || String(r.ItemKey) !== String(key) || (r.CanvasPostedScore === '' && r.CanvasCommentFp === '')) return;
      var fresh = nvReadRows_(sh, [r._row])[0]; if (!fresh || String(fresh.ClassId) !== String(classId) || String(fresh.ItemKey) !== String(key)) return;
      var o = {}; Object.keys(fresh).forEach(function (k) { if (k !== '_row') o[k] = fresh[k]; });
      o.CanvasPostedScore = ''; o.CanvasCommentFp = '';
      nvWriteRow_(sh, r._row, o);
    });
  });
}
/** The due-date window asks this when it opens: a deleted assignment is forgotten, and Save makes it again. */
function checkCanvasItem(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), key = nvParseItemKey_(payload.itemKey).key, c = ctx.settings.canvas, out;
  if (!c.courseId || !((c.assignments || {})[key] || {}).assignmentId) out = { ok: true, linked: false, deletedInCanvas: false };
  else { var gone = nvCanvasForgetDeleted_(ctx.klass.ClassId, [key], ctx.teacher.email); out = { ok: true, linked: !gone.length, deletedInCanvas: gone.length > 0, hub: lmsHubEnabled_() }; }
  // The window's assignment-group list, and where this assignment is in Canvas now (it may have been
  // moved there). Before it exists: the group saved for it, else the class default.
  out.groups = []; out.groupsError = ''; out.currentGroupId = String((c.itemGroups || {})[key] || c.assignmentGroupId || '');
  if (c.courseId && !lmsHubEnabled_()) {
    try {
      var conn = nvCanvasConn_(ctx.teacher.email);
      if (conn.connected) {
        out.groups = listCanvasGroups({ courseId: c.courseId }).groups;
        if (out.linked) out.currentGroupId = String(nvCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(c.assignments[key].assignmentId)).assignment_group_id || '');
      }
    } catch (e) { out.groupsError = e.message; }
  }
  return out;
}

// ---------- connection + course link ----------

function saveCanvasConnection(payload) {
  payload = payload || {}; var t = nvRequireTeacher_(), old = nvCanvasConn_(t.email);
  var conn = { baseUrl: nvCanvasUrl_(payload.baseUrl || old.baseUrl), token: String(payload.token || old.token || '').trim(), connected: true };
  if (!conn.token) throw new Error('Paste a Canvas access token (Canvas → Account → Settings → New Access Token).');
  var p = nvCanvasRequest_(conn, 'get', '/api/v1/users/self/profile');
  PropertiesService.getScriptProperties().setProperty(nvCanvasPropKey_(t.email), JSON.stringify({ baseUrl: conn.baseUrl, token: conn.token, savedAt: new Date().toISOString() }));
  return { ok: true, canvas: { connected: true, baseUrl: conn.baseUrl, name: p.name || '' } };
}
function clearCanvasConnection() {
  var t = nvRequireTeacher_(); PropertiesService.getScriptProperties().deleteProperty(nvCanvasPropKey_(t.email));
  return { ok: true, canvas: { connected: false, baseUrl: '' } };
}
function listCanvasCourses() {
  var t = nvRequireTeacher_(), conn = nvCanvasConn_(t.email);
  return { ok: true, courses: nvCanvasGetAll_(conn, '/api/v1/courses?enrollment_type=teacher&per_page=100&include[]=term').filter(function (c) { return c && c.id && c.workflow_state !== 'deleted'; })
    .map(function (c) { return { id: String(c.id), name: c.name || c.course_code || ('Course ' + c.id), term: c.term && c.term.name ? c.term.name : '' }; }) };
}
function listCanvasGroups(payload) {
  var t = nvRequireTeacher_(), courseId = String((payload || {}).courseId || ''); if (!courseId) throw new Error('Choose a Canvas course first.');
  return { ok: true, groups: nvCanvasGetAll_(nvCanvasConn_(t.email), '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100').map(function (g) { return { id: String(g.id), name: g.name || ('Group ' + g.id) }; }) };
}
function linkCanvasCourse(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), conn = nvCanvasConn_(ctx.teacher.email);
  var courseId = String(payload.courseId || ''); if (!courseId) throw new Error('Choose a Canvas course.');
  var course = nvCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId)), gid = String(payload.assignmentGroupId || ''), gname = '';
  if (gid) gname = nvCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(gid)).name || '';
  var s = nvUpdateSettings_(ctx.klass.ClassId, function (st) {
    var keep = String(st.canvas.courseId || '') === courseId ? st.canvas.assignments : {};
    st.canvas = { courseId: courseId, courseName: course.name || '', assignmentGroupId: gid, assignmentGroupName: gname, assignments: keep || {} };
  });
  return { ok: true, canvas: s.canvas };
}
function unlinkCanvasCourse(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  nvUpdateSettings_(ctx.klass.ClassId, function (st) { st.canvas = nvDefaultSettings_().canvas; });
  return { ok: true };
}

// ---------- one assignment ----------

function nvCanvasMeta_(s, item) {
  var title = s.book ? s.book.title : 'Novel Study';
  return { key: item.key, label: title + ' · ' + item.unitLabel + ' · ' + item.kindLabel, points: item.max, item: item };
}
function nvAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }
/** What students see in the Canvas assignment. Sent on every push, so edit it here, not in Canvas. */
function nvCanvasDescription_(s, item) {
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var u = s.units[item.week - 1] || {}, a = (u.activities || []).filter(function (x) { return x.id === item.act; })[0] || {};
  var what = item.kind === 'quiz' ? 'Answer the ' + item.kindLabel + ' in Novel Study. Right on the first try earns 1 point; right on the second try earns ½ point.'
    : 'Complete “' + item.kindLabel + '” for ' + item.unitLabel + ' in Novel Study.';
  var html = '<p>' + esc(what) + '</p>' + (a.prompt ? '<p>' + esc(a.prompt) + '</p>' : '') + ((u.reading || {}).label ? '<p>' + esc('Reading: ' + u.reading.label) + '</p>' : '');
  var url = nvAppUrl_();
  if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener"><strong>Open Novel Study</strong></a></p><p><small>Sign in with your school Google account.</small></p>';
  return html;
}
/** Every row Push and the CSV send for one item. Demo students are never sent. */
function nvCanvasRows_(classId, settings, s, item, data) {
  data = data || nvGradeData_(classId);
  return data.roster.filter(function (st) { return !st.demo; }).map(function (st) {
    var c = nvCellState_(data, settings, item, st.email), g = data.grades[st.email + '|' + item.key] || {};
    // Per student only: an item left out for the whole class keeps blank (never excuse a whole class).
    var ex = c.studentExcluded;
    var score = ex || c.classExcluded ? null : c.score;
    return { email: st.email, name: st.name, excluded: ex, score: score === undefined ? null : score, submitted: c.submitted, comment: ex ? '' : (g.comment || ''), postedScore: g.postedScore || '', commentFp: g.commentFp || '' };
  });
}
function nvSchedule_(settings, key) { var d = (settings.due || {})[key]; return d ? { hasDue: true, dueAt: d } : { hasDue: false, dueAt: '' }; }
function nvCanvasForm_(c, meta, s, opts) {
  opts = opts || {};
  var f = { 'assignment[name]': meta.label, 'assignment[points_possible]': String(meta.points), 'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none', 'assignment[description]': nvCanvasDescription_(s, meta.item) };
  if (opts.publish) f['assignment[published]'] = 'true'; else if (opts.creating) f['assignment[published]'] = 'false';
  if (opts.sched && opts.sched.hasDue) f['assignment[due_at]'] = opts.sched.dueAt || '';
  // Group: one picked in this assignment's "Due date & Canvas" window (opts.group, sent only when
  // changed). Creating: that, else the group saved for it (c.itemGroups), else the class default.
  // Updates never send a group otherwise, so a move made in Canvas stays.
  var grp = String(opts.group || '') || (opts.creating ? String((c.itemGroups || {})[meta.key] || c.assignmentGroupId || '') : '');
  if (grp) f['assignment[assignment_group_id]'] = grp;
  return f;
}
/** Reuse the stored assignment, adopt one with the same name (a second section on the same course), or create it. */
function nvCanvasEnsure_(conn, c, meta, s, opts) {
  var enc = encodeURIComponent(c.courseId), link = (c.assignments || {})[meta.key] || {}, a = null, adopted = false, created = false;
  var upd = nvCanvasForm_(c, meta, s, opts);
  if (link.assignmentId) {
    try { a = nvCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId), upd); }
    catch (e) { if (e.canvasStatus !== 404) throw e; a = null; }
  }
  if (!a) {
    var found = null;
    try { nvCanvasGetAll_(conn, '/api/v1/courses/' + enc + '/assignments?search_term=' + encodeURIComponent(meta.label) + '&per_page=100').forEach(function (x) { if (!found && String(x.name) === meta.label) found = x; }); } catch (e2) {}
    if (found) { adopted = true; a = nvCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(found.id), upd); }
    else { created = true; a = nvCanvasRequest_(conn, 'post', '/api/v1/courses/' + enc + '/assignments', nvCanvasForm_(c, meta, s, Object.assign({ creating: true }, opts))); }
  }
  return { assignment: a, adopted: adopted, created: created, previous: link };
}
function nvCanvasRoster_(conn, courseId) {
  return nvCanvasGetAll_(conn, '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&include[]=email&per_page=100').map(function (u) {
    return { id: String(u.id), email: nvNorm_(u.email || u.login_id), loginId: nvNorm_(u.login_id), sisId: nvNorm_(u.sis_user_id) };
  });
}
function nvCanvasMatch_(email, roster) {
  for (var i = 0; i < roster.length; i++) { var u = roster[i]; if (email && (u.email === email || u.loginId === email || u.sisId === email)) return u; }
  return null;
}
function nvSaveCanvasLink_(classId, courseId, key, link, hubStamp) {
  return nvUpdateSettings_(classId, function (st) {
    if (String(st.canvas.courseId || '') !== String(courseId)) return;   // course changed meanwhile
    st.canvas.assignments[key] = Object.assign({}, st.canvas.assignments[key] || {}, link);
    if (st.canvas.deleted && link.assignmentId) delete st.canvas.deleted[key];   // made again
    if (hubStamp) st.canvas.lmsHub = hubStamp;
  });
}
/** Notes what reached Canvas on each student's grade row (score + comment fingerprint). */
function nvRecordPosted_(classId, key, posted) {
  posted.forEach(function (p) {
    nvRowCritical_(function () {
      nvUpsert_('Grades', 'Email', { ClassId: classId, Email: p.email, ItemKey: key }, function () {
        var f = {}; if (p.score !== undefined) f.CanvasPostedScore = p.score === null ? '' : p.score; if (p.commentFp !== undefined) f.CanvasCommentFp = p.commentFp; return f;
      });
    });
  });
}

/** Due date for one item; synced to Canvas right away when the class is linked. dueAt: ISO or ''. */
function saveItemSchedule(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, key = nvParseItemKey_(payload.itemKey).key;
  var dueAt = nvIso_(payload.dueAt);
  if (String(payload.dueAt || '').trim() && !dueAt) throw new Error('That due date isn’t a real date.');
  var group = String(payload.assignmentGroupId || '');   // only when the teacher changed it in the window
  var settings = nvUpdateSettings_(classId, function (st) {
    if (dueAt) st.due[key] = dueAt; else delete st.due[key];
    if (group) { st.canvas.itemGroups = st.canvas.itemGroups || {}; st.canvas.itemGroups[key] = group; }
  });
  var out = { ok: true, due: settings.due, warnings: [] }, c = settings.canvas;
  if (!c.courseId) return out;
  var s = nvRequireStudy_(classId), item = nvItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) return out;
  var meta = nvCanvasMeta_(s, item), remake = payload.remake === true || !!(c.deleted || {})[key];
  if ((c.assignments[key] || {}).assignmentId && nvCanvasForgetDeleted_(classId, [key], ctx.teacher.email).length) {
    remake = true; settings = nvSettingsOf_(nvClass_(classId)); c = settings.canvas;
  }
  if (remake && !(c.assignments[key] || {}).assignmentId) {
    // Deleted in Canvas: Save makes it again (direct); through the hub, the next tile Push does.
    if (lmsHubEnabled_()) { out.warnings.push('This assignment was deleted in Canvas. Press ↗ Push on its tile to make it again.'); return out; }
    var conn0 = nvCanvasConn_(ctx.teacher.email);
    if (!conn0.connected) { out.warnings.push('This assignment was deleted in Canvas. Connect Canvas, then press ↗ Push on its tile to make it again.'); return out; }
    try {
      var ens0 = nvCanvasEnsure_(conn0, c, meta, s, { sched: nvSchedule_(settings, key), publish: nvReleased_(settings, key), group: group }), a0 = ens0.assignment;
      nvSaveCanvasLink_(classId, c.courseId, key, { assignmentId: String(a0.id), name: a0.name || meta.label, htmlUrl: a0.html_url || '', pointsPossible: Number(a0.points_possible || meta.points), excusedEmails: {} });
      out.remade = true; out.canvasSynced = true;
      out.warnings.push('It had been deleted in Canvas, so it was made again' + (ens0.adopted ? ' (another class on this course had already made it, so this class uses that one)' : '') + '. Press ↗ Push to send the scores.');
    } catch (e0) { out.warnings.push('Saved in the app, but Canvas didn’t make the assignment again (' + e0.message + ').'); }
    return out;
  }
  if (!(c.assignments[key] || {}).assignmentId) return out;   // not in Canvas yet: the date goes with the first push
  try {
    if (lmsHubEnabled_()) {
      nvHubEnsureClass_(classId, c, ctx.teacher.email);
      nvHubCall_(function () { return LmsHub.syncAssignment(classId, key, Object.assign({ title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: nvCanvasDescription_(s, item), dueAt: dueAt }, group ? { groupId: group } : {}), ctx.teacher.email); });
    } else {
      var conn = nvCanvasConn_(ctx.teacher.email);
      if (conn.connected) nvCanvasEnsure_(conn, c, meta, s, { sched: nvSchedule_(settings, key), group: group });
    }
    out.canvasSynced = true;
  } catch (e) { out.warnings.push('Saved in the app, but Canvas didn’t take the new date (' + e.message + ').'); }
  return out;
}

/** ↗ Push on a tile: scores, excusals and new/changed comments for one item. `shared` (internal):
 *  Push all passes the Canvas roster and grade data so they're read once. */
function pushCanvasGrades(payload, shared) {
  payload = payload || {}; shared = shared || {};
  var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, settings = shared.settings || ctx.settings, c = settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var s = shared.study || nvRequireStudy_(classId), key = nvParseItemKey_(payload.itemKey).key;
  var item = nvItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) throw new Error('That assignment isn’t approved yet.');
  var remade = false;
  if (!payload.onlyLinked && ((c.assignments || {})[key] || {}).assignmentId && nvCanvasForgetDeleted_(classId, [key], ctx.teacher.email).length) {
    remade = true; settings = nvSettingsOf_(nvClass_(classId)); c = settings.canvas;
  }
  var meta = nvCanvasMeta_(s, item), link = (c.assignments || {})[key] || {};
  if (payload.onlyLinked && !link.assignmentId) return { ok: true, skipped: 'notInCanvas', notInCanvas: true, label: item.label, sent: 0 };
  var rows = nvCanvasRows_(classId, settings, s, item, shared.data);
  var remadeNote = 'It had been deleted in Canvas, so it was made again; scores and comments went to the new assignment.';
  if (lmsHubEnabled_()) { var hr = nvHubPush_(ctx, classId, settings, s, meta, rows); if (remade) { hr.remade = true; hr.warnings.unshift(remadeNote); } return hr; }
  var conn = nvCanvasConn_(ctx.teacher.email);
  if (!conn.connected) throw new Error('Connect Canvas first (Canvas card).');
  var ens = nvCanvasEnsure_(conn, c, meta, s, { sched: nvSchedule_(settings, key), publish: true }), a = ens.assignment;
  var roster = shared.roster || nvCanvasRoster_(conn, c.courseId);
  var out = { ok: true, label: item.label, title: meta.label, created: ens.created, adopted: ens.adopted, remade: remade, sent: 0, comments: 0, unmarked: [], unmatched: [], excused: [], unexcused: [], warnings: remade ? [remadeNote] : [], via: 'canvas' };
  // A different Canvas assignment than last time (made again, or adopted from another class): every comment goes again.
  var freshAssignment = String(a.id) !== String(link.assignmentId || '');
  var form = {}, posted = [], excusedBefore = link.excusedEmails || {}, excusedNow = {};
  rows.forEach(function (r) {
    var u = nvCanvasMatch_(r.email, roster);
    if (r.excluded) {
      if (!u) { out.unmatched.push(r.name); if (excusedBefore[r.email]) excusedNow[r.email] = true; return; }
      form['grade_data[' + u.id + '][excuse]'] = 'true'; excusedNow[r.email] = true; out.excused.push(r.name);
      return;
    }
    if (r.score == null) {
      if (excusedBefore[r.email]) excusedNow[r.email] = true;   // blank stays blank; Canvas is left alone
      if (r.submitted) out.unmarked.push(r.name);
      return;
    }
    if (!u) { out.unmatched.push(r.name); return; }
    form['grade_data[' + u.id + '][posted_grade]'] = String(r.score);
    if (excusedBefore[r.email]) { form['grade_data[' + u.id + '][excuse]'] = 'false'; out.unexcused.push(r.name); }
    var p = { email: r.email };
    if (String(r.postedScore) !== String(r.score)) p.score = r.score;
    var cfp = r.comment ? nvFp_(r.comment) : '';
    if (r.comment && (freshAssignment || cfp !== r.commentFp)) { form['grade_data[' + u.id + '][text_comment]'] = r.comment; p.commentFp = cfp; out.comments++; }
    if (p.score !== undefined || p.commentFp !== undefined) posted.push(p);
    out.sent++;
  });
  if (Object.keys(form).length) nvCanvasRequest_(conn, 'post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(a.id) + '/submissions/update_grades', form);
  try { nvRecordPosted_(classId, key, posted); } catch (e) { out.warnings.push('Scores reached Canvas, but the app couldn’t note that (' + e.message + ').'); }
  var newLink = { assignmentId: String(a.id), name: a.name || meta.label, htmlUrl: a.html_url || '', pointsPossible: Number(a.points_possible || meta.points), lastPushAt: new Date().toISOString(), sent: out.sent, excusedEmails: excusedNow };
  try { nvSaveCanvasLink_(classId, c.courseId, key, newLink); } catch (e) { out.warnings.push('Canvas has the scores, but the app couldn’t save the assignment link (' + e.message + ').'); }
  out.htmlUrl = newLink.htmlUrl; out.lastPushAt = newLink.lastPushAt;
  return out;
}

/** ↗ Push all to Canvas (Gradebook card): every item already in Canvas AND released to students, one
 *  after another through pushCanvasGrades. Never creates an assignment. One failure never stops the
 *  rest; stops before the 6-minute limit and names what's left. */
function pushCanvasGradebook(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var s = nvRequireStudy_(classId), hub = lmsHubEnabled_(), links = c.assignments || {}, toPush = [], notInCanvas = [], hidden = [], noGrade = [];
  nvItems_(s).forEach(function (it) {
    var linked = !!(links[it.key] || {}).assignmentId;
    if ((ctx.settings.noGrade || {})[it.key]) { noGrade.push(it.label); return; }
    if (!nvReleased_(ctx.settings, it.key)) { if (linked) hidden.push(it.label); return; }
    if (!linked) { notInCanvas.push(it.label); return; }
    toPush.push(it);
  });
  var started = Date.now(), deleted = [];
  if (toPush.length) {
    var gone = nvCanvasForgetDeleted_(classId, toPush.map(function (it) { return it.key; }), ctx.teacher.email);
    if (gone.length) {
      toPush = toPush.filter(function (it) { if (gone.indexOf(it.key) >= 0) { deleted.push(it.label); return false; } return true; });
      ctx.settings = nvSettingsOf_(nvClass_(classId));
    }
  }
  var out = { ok: true, items: [], sent: 0, comments: 0, excused: 0, unexcused: 0, unmarked: [], unmatched: [], warnings: [], failures: [], notReached: [], notInCanvas: notInCanvas, hidden: hidden, noGrade: noGrade, deletedInCanvas: deleted, via: hub ? 'lmsHub' : 'canvas' };
  if (deleted.length) out.warnings.push((deleted.length === 1 ? deleted[0] + ' was' : deleted.join(', ') + ' were') + ' deleted in Canvas. Push all doesn’t make assignments: press ↗ Push on ' + (deleted.length === 1 ? 'its tile' : 'their tiles') + ' to make ' + (deleted.length === 1 ? 'it' : 'them') + ' again.');
  if (!toPush.length && deleted.length) { out.ok = false; out.message = out.warnings.shift(); return out; }
  if (!toPush.length) { out.ok = false; out.message = 'None of the open assignments are in Canvas yet. Use ↗ Push on a tile once to create it.'; return out; }
  var shared = { settings: ctx.settings, study: s, data: nvGradeData_(classId) };
  if (!hub) {
    var conn = nvCanvasConn_(ctx.teacher.email);
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas card).');
    shared.roster = nvCanvasRoster_(conn, c.courseId);
  }
  function addAll(list, into) { (list || []).forEach(function (n) { if (n && into.indexOf(n) < 0) into.push(n); }); }
  toPush.forEach(function (it) {
    if (Date.now() - started > 270000) { out.notReached.push(it.label); return; }
    try {
      var r = pushCanvasGrades({ classId: classId, itemKey: it.key, onlyLinked: true }, shared);
      if (r.notInCanvas) { out.notInCanvas.push(it.label); return; }
      out.sent += r.sent || 0; out.comments += r.comments || 0; out.excused += (r.excused || []).length; out.unexcused += (r.unexcused || []).length;
      addAll(r.unmarked, out.unmarked); addAll(r.unmatched, out.unmatched);
      (r.warnings || []).forEach(function (x) { out.warnings.push(it.label + ': ' + x); });
      out.items.push({ label: it.label, sent: r.sent || 0 });
      shared.settings = nvSettingsOf_(nvClass_(classId));   // the link it just saved (excusals) for the next item
    } catch (e) { out.failures.push({ label: it.label, message: e.message || String(e) }); }
  });
  out.ok = !out.failures.length && !out.notReached.length && !deleted.length;
  return out;
}

/** Canvas gradebook import file for one item (the same numbers as Push; excluded stays blank). */
function exportCanvasCsv(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, s = nvRequireStudy_(classId);
  var key = nvParseItemKey_(payload.itemKey).key, item = nvItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) throw new Error('That assignment isn’t approved yet.');
  var meta = nvCanvasMeta_(s, item), link = (ctx.settings.canvas.assignments || {})[key];
  var lines = [['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', meta.label + (link && link.assignmentId ? ' (' + link.assignmentId + ')' : '')], ['Points Possible', '', '', '', '', meta.points]];
  nvCanvasRows_(classId, ctx.settings, s, item).forEach(function (r) { lines.push([r.name, '', '', r.email, '', r.excluded || r.score == null ? '' : r.score]); });
  var csv = lines.map(function (row) { return row.map(function (v) { var x = String(v == null ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(','); }).join('\r\n');
  return { ok: true, filename: meta.label.replace(/[\\\/:*?"<>|]/g, '-') + '.csv', csv: csv };
}
