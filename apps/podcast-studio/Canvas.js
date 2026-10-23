// ============================================================================
// Podcast Studio -- Canvas.
// Tokens are stored PER TEACHER (Script Properties keyed by a hash of the teacher's email): the app
// runs as its owner, so one UserProperties key would be shared by every teacher.
// With LMS_HUB_ENABLED=true everything goes through the shared LMS Hub (PodcastLmsHub); otherwise
// straight to Canvas. Both use pcCanvasRows_ so Push, Push all and the CSV always agree.
// The latest push is the truth in Canvas: excluded -> Excused; excused earlier by this app and now
// scored -> excusal lifted and the score sent; no score and not excluded -> nothing sent.
// ============================================================================

var PC_CANVAS_PROP_PREFIX = 'PC_CANVAS_';
function pcCanvasPropKey_(email) { return PC_CANVAS_PROP_PREFIX + pcMd5_(pcNorm_(email)).slice(0, 20); }
function pcCanvasConn_(email) {
  var raw = pcParse_(PropertiesService.getScriptProperties().getProperty(pcCanvasPropKey_(email)), null) || {};
  return { baseUrl: String(raw.baseUrl || ''), token: String(raw.token || ''), connected: !!(raw.baseUrl && raw.token) };
}
function pcCanvasStatus_(email) { var c = pcCanvasConn_(email); return { connected: c.connected, baseUrl: c.baseUrl }; }
function pcCanvasUrl_(v) {
  var s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Type your Canvas address, for example https://yourschool.instructure.com');
  if (!/^https:\/\//i.test(s)) s = 'https://' + s.replace(/^https?:\/\//i, '');
  return s.replace(/\/api\/v1$/i, '');
}
function pcCanvasError_(body) {
  try { var j = JSON.parse(String(body || '')); if (Array.isArray(j.errors) && j.errors.length) return j.errors.map(function (e) { return e.message || String(e); }).join('; '); if (j.message) return j.message; } catch (e) {}
  return String(body || 'Canvas request failed.').slice(0, 400);
}
function pcCanvasRequest_(conn, method, path, payload) {
  if (!conn || !conn.connected) throw new Error('Connect Canvas first (Canvas card on the dashboard).');
  var url = /^https:\/\//i.test(path) ? path : conn.baseUrl + path;
  if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
  var opt = { method: String(method || 'get').toLowerCase(), headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true };
  if (payload && Object.keys(payload).length) opt.payload = payload;
  var res = UrlFetchApp.fetch(url, opt), status = res.getResponseCode(), body = res.getContentText();
  if (status < 200 || status >= 300) {
    var err = new Error(status === 401 ? 'Canvas didn’t accept the access token. Paste a new token in the Canvas card.' : 'Canvas ' + status + ': ' + pcCanvasError_(body));
    err.canvasStatus = status; throw err;
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch (e) { return { raw: body }; }
}
function pcCanvasGetAll_(conn, path) {
  var url = conn.baseUrl + path, out = [], guard = 0;
  while (url && guard++ < 30) {
    if (url.indexOf(conn.baseUrl) !== 0) throw new Error('Canvas returned an unexpected address.');
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: true });
    var status = res.getResponseCode(), body = res.getContentText();
    if (status < 200 || status >= 300) { var err = new Error('Canvas ' + status + ': ' + pcCanvasError_(body)); err.canvasStatus = status; throw err; }
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
function pcCanvasAssignmentDeleted_(classId, c, key, link, teacher) {
  if (lmsHubEnabled_()) {
    try { LmsHub.assignment(classId, key, true, teacher); return false; }
    catch (e) { return !!e && Number(e.lmsStatus) === 404; }
  }
  var conn = pcCanvasConn_(teacher);
  if (!conn.connected) return false;
  try {
    var a = pcCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(link.assignmentId));
    return !!a && String(a.workflow_state || '') === 'deleted';
  } catch (e2) {
    if (!e2 || e2.canvasStatus !== 404) return false;
    try { pcCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(c.courseId)); return true; } catch (e3) { return false; }
  }
}
/** Forgets the linked assignments among `keys` that were deleted in Canvas. Returns the keys forgotten. */
function pcCanvasForgetDeleted_(classId, keys, teacher) {
  var k = pcClass_(classId); if (!k) return [];
  var c = pcSettingsOf_(k).canvas || {}; if (!c.courseId) return [];
  var deadIds = {}, gone = [];
  (keys || []).forEach(function (key) {
    var l = (c.assignments || {})[key]; if (!l || !l.assignmentId) return;
    var id = String(l.assignmentId);
    if (deadIds[id] || pcCanvasAssignmentDeleted_(classId, c, key, l, teacher)) { deadIds[id] = true; gone.push(key); }
  });
  if (!gone.length) return [];
  var hub = lmsHubEnabled_();
  pcClasses_().slice().forEach(function (kk) {
    var kc = (pcSettingsOf_(kk).canvas) || {};
    if (String(kc.courseId || '') !== String(c.courseId)) return;
    var ks = Object.keys(kc.assignments || {}).filter(function (x) { return deadIds[String((kc.assignments[x] || {}).assignmentId || '')]; });
    if (!ks.length) return;
    if (hub) ks.forEach(function (x) { try { LmsHub.forgetAssignment(String(kk.ClassId), x, pcNorm_(kk.TeacherEmail)); } catch (e) {} });
    try {
      pcUpdateSettings_(String(kk.ClassId), function (st) {
        if (String((st.canvas || {}).courseId || '') !== String(c.courseId)) return;
        st.canvas.deleted = st.canvas.deleted || {};
        ks.forEach(function (x) { if (deadIds[String(((st.canvas.assignments || {})[x] || {}).assignmentId || '')]) { delete st.canvas.assignments[x]; st.canvas.deleted[x] = true; } });
      });
      ks.forEach(function (x) { pcClearPosted_(String(kk.ClassId), x); });
    } catch (e) { try { console.warn('forget deleted: ' + e.message); } catch (e2) {} }
  });
  PC_X_.classes = null;
  return gone;
}
/** What reached the deleted assignment no longer counts: the new one gets every score and comment. */
function pcClearPosted_(classId, key) {
  var sh = pcSheet_('Grades');
  pcRowCritical_(function () {
    pcReadRows_(sh, pcFindRowNums_(sh, 'ItemKey', key)).forEach(function (r) {
      if (String(r.ClassId) !== String(classId) || String(r.ItemKey) !== String(key) || (r.CanvasPostedScore === '' && r.CanvasCommentFp === '')) return;
      var fresh = pcReadRows_(sh, [r._row])[0]; if (!fresh || String(fresh.ClassId) !== String(classId) || String(fresh.ItemKey) !== String(key)) return;
      var o = {}; Object.keys(fresh).forEach(function (k) { if (k !== '_row') o[k] = fresh[k]; });
      o.CanvasPostedScore = ''; o.CanvasCommentFp = '';
      pcWriteRow_(sh, r._row, o);
    });
  });
}
/** The due-date window asks this when it opens: a deleted assignment is forgotten, and Save makes it again. */
function checkCanvasItem(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), key = pcParseItemKey_(payload.itemKey).key;
  if (!ctx.settings.canvas.courseId || !((ctx.settings.canvas.assignments || {})[key] || {}).assignmentId) return { ok: true, linked: false, deletedInCanvas: false };
  var gone = pcCanvasForgetDeleted_(ctx.klass.ClassId, [key], ctx.teacher.email);
  return { ok: true, linked: !gone.length, deletedInCanvas: gone.length > 0, hub: lmsHubEnabled_() };
}

// ---------- connection + course link ----------

function saveCanvasConnection(payload) {
  payload = payload || {}; var t = pcRequireTeacher_(), old = pcCanvasConn_(t.email);
  var conn = { baseUrl: pcCanvasUrl_(payload.baseUrl || old.baseUrl), token: String(payload.token || old.token || '').trim(), connected: true };
  if (!conn.token) throw new Error('Paste a Canvas access token (Canvas → Account → Settings → New Access Token).');
  var p = pcCanvasRequest_(conn, 'get', '/api/v1/users/self/profile');
  PropertiesService.getScriptProperties().setProperty(pcCanvasPropKey_(t.email), JSON.stringify({ baseUrl: conn.baseUrl, token: conn.token, savedAt: new Date().toISOString() }));
  return { ok: true, canvas: { connected: true, baseUrl: conn.baseUrl, name: p.name || '' } };
}
function clearCanvasConnection() {
  var t = pcRequireTeacher_(); PropertiesService.getScriptProperties().deleteProperty(pcCanvasPropKey_(t.email));
  return { ok: true, canvas: { connected: false, baseUrl: '' } };
}
function listCanvasCourses() {
  var t = pcRequireTeacher_(), conn = pcCanvasConn_(t.email);
  return { ok: true, courses: pcCanvasGetAll_(conn, '/api/v1/courses?enrollment_type=teacher&per_page=100&include[]=term').filter(function (c) { return c && c.id && c.workflow_state !== 'deleted'; })
    .map(function (c) { return { id: String(c.id), name: c.name || c.course_code || ('Course ' + c.id), term: c.term && c.term.name ? c.term.name : '' }; }) };
}
function listCanvasGroups(payload) {
  var t = pcRequireTeacher_(), courseId = String((payload || {}).courseId || ''); if (!courseId) throw new Error('Choose a Canvas course first.');
  return { ok: true, groups: pcCanvasGetAll_(pcCanvasConn_(t.email), '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups?per_page=100').map(function (g) { return { id: String(g.id), name: g.name || ('Group ' + g.id) }; }) };
}
function linkCanvasCourse(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), conn = pcCanvasConn_(ctx.teacher.email);
  var courseId = String(payload.courseId || ''); if (!courseId) throw new Error('Choose a Canvas course.');
  var course = pcCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId)), gid = String(payload.assignmentGroupId || ''), gname = '';
  if (gid) gname = pcCanvasRequest_(conn, 'get', '/api/v1/courses/' + encodeURIComponent(courseId) + '/assignment_groups/' + encodeURIComponent(gid)).name || '';
  var s = pcUpdateSettings_(ctx.klass.ClassId, function (st) {
    var same = String(st.canvas.courseId || '') === courseId;
    st.canvas = { courseId: courseId, courseName: course.name || '', assignmentGroupId: gid, assignmentGroupName: gname, assignments: (same && st.canvas.assignments) || {},
      unitModule: same ? st.canvas.unitModule || null : null, weekModules: (same && st.canvas.weekModules) || {}, itemModules: (same && st.canvas.itemModules) || {} };
  });
  return { ok: true, canvas: s.canvas };
}
function unlinkCanvasCourse(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  pcUpdateSettings_(ctx.klass.ClassId, function (st) { st.canvas = pcDefaultSettings_().canvas; });
  return { ok: true };
}

// ---------- one assignment ----------

function pcCanvasMeta_(s, item) {
  var title = PC_UNIT_TITLE;
  return { key: item.key, label: title + ' · ' + item.unitLabel + ' · ' + item.kindLabel, points: item.max, item: item };
}
function pcAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }
/** What students see in the Canvas assignment. Sent on every push, so edit it here, not in Canvas. */
function pcCanvasDescription_(s, item) {
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var u = s.units[item.week - 1] || {}, a = (u.activities || []).filter(function (x) { return x.id === item.act; })[0] || {};
  var what = item.kind === 'quiz' ? 'Answer the ' + item.kindLabel + ' in Podcast Studio. Right on the first try earns 1 point; right on the second try earns ½ point. You can take it ' + pcQuizTries_(a) + ' times; your best try counts.'
    : 'Complete “' + item.kindLabel + '” for ' + item.unitLabel + ' in Podcast Studio.';
  var html = '<p>' + esc(what) + '</p>' + (a.prompt ? '<p>' + esc(a.prompt) + '</p>' : '');
  var url = pcAppUrl_();
  if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener"><strong>Open Podcast Studio</strong></a></p><p><small>Sign in with your school Google account.</small></p>';
  return html;
}
/** Every row Push and the CSV send for one item. Demo students are never sent. */
function pcCanvasRows_(classId, settings, s, item, data) {
  data = data || pcGradeData_(classId);
  return data.roster.filter(function (st) { return !st.demo; }).map(function (st) {
    var c = pcCellState_(data, settings, item, st.email), g = data.grades[st.email + '|' + item.key] || {};
    // Per student only: an item left out for the whole class keeps blank (never excuse a whole class).
    var ex = c.studentExcluded;
    var score = ex || c.classExcluded ? null : c.score;
    var comment = ex ? '' : (g.comment || '');
    // The Final Episode rubric: each criterion's score goes with the comment, so students see the breakdown in Canvas.
    if (!ex && item.type === 'criteria' && score !== null && score !== undefined) comment = pcCriteriaSummary_(g.criteria || {}) + (comment ? '\n\n' + comment : '');
    return { email: st.email, name: st.name, excluded: ex, score: score === undefined ? null : score, submitted: c.submitted, comment: comment, postedScore: g.postedScore || '', commentFp: g.commentFp || '' };
  });
}
function pcCriteriaSummary_(crit) {
  return PC_FINAL_RUBRIC.map(function (c) { return c.label + ': ' + (crit[c.id] === undefined ? '—' : crit[c.id]) + '/' + c.max; }).join('\n');
}
function pcSchedule_(settings, key) {
  var d = (settings.due || {})[key], u = (settings.unlock || {})[key];
  return { hasDue: !!d, dueAt: d || '', hasUnlock: !!u, unlockAt: u || '' };
}
function pcCanvasForm_(c, meta, s, opts) {
  opts = opts || {};
  var f = { 'assignment[name]': meta.label, 'assignment[points_possible]': String(meta.points), 'assignment[grading_type]': 'points',
    'assignment[submission_types][]': 'none', 'assignment[description]': pcCanvasDescription_(s, meta.item) };
  if (opts.publish) f['assignment[published]'] = 'true'; else if (opts.creating) f['assignment[published]'] = 'false';
  // explicit (the week window's Save): send both dates, blank clears them in Canvas.
  if (opts.sched && (opts.sched.explicit || opts.sched.hasDue)) f['assignment[due_at]'] = opts.sched.dueAt || '';
  if (opts.sched && (opts.sched.explicit || opts.sched.hasUnlock)) f['assignment[unlock_at]'] = opts.sched.unlockAt || '';
  // Group: the one picked for this assignment in its Week window (opts.group, sent only when changed);
  // otherwise only when creating, the class default. A move made in Canvas is never undone.
  var grp = String(opts.group || '') || (opts.creating ? String(c.assignmentGroupId || '') : '');
  if (grp) f['assignment[assignment_group_id]'] = grp;
  return f;
}
/** Reuse the stored assignment, adopt one with the same name (a second section on the same course), or create it. */
function pcCanvasEnsure_(conn, c, meta, s, opts) {
  var enc = encodeURIComponent(c.courseId), link = (c.assignments || {})[meta.key] || {}, a = null, adopted = false, created = false;
  var upd = pcCanvasForm_(c, meta, s, opts);
  if (link.assignmentId) {
    try { a = pcCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(link.assignmentId), upd); }
    catch (e) { if (e.canvasStatus !== 404) throw e; a = null; }
  }
  if (!a) {
    var found = null;
    try { pcCanvasGetAll_(conn, '/api/v1/courses/' + enc + '/assignments?search_term=' + encodeURIComponent(meta.label) + '&per_page=100').forEach(function (x) { if (!found && String(x.name) === meta.label) found = x; }); } catch (e2) {}
    if (found) { adopted = true; a = pcCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/assignments/' + encodeURIComponent(found.id), upd); }
    else { created = true; a = pcCanvasRequest_(conn, 'post', '/api/v1/courses/' + enc + '/assignments', pcCanvasForm_(c, meta, s, Object.assign({ creating: true }, opts))); }
  }
  return { assignment: a, adopted: adopted, created: created, previous: link };
}
function pcCanvasRoster_(conn, courseId) {
  return pcCanvasGetAll_(conn, '/api/v1/courses/' + encodeURIComponent(courseId) + '/users?enrollment_type[]=student&include[]=email&per_page=100').map(function (u) {
    return { id: String(u.id), email: pcNorm_(u.email || u.login_id), loginId: pcNorm_(u.login_id), sisId: pcNorm_(u.sis_user_id) };
  });
}
function pcCanvasMatch_(email, roster) {
  for (var i = 0; i < roster.length; i++) { var u = roster[i]; if (email && (u.email === email || u.loginId === email || u.sisId === email)) return u; }
  return null;
}
function pcSaveCanvasLink_(classId, courseId, key, link, hubStamp) {
  return pcUpdateSettings_(classId, function (st) {
    if (String(st.canvas.courseId || '') !== String(courseId)) return;   // course changed meanwhile
    st.canvas.assignments[key] = Object.assign({}, st.canvas.assignments[key] || {}, link);
    if (st.canvas.deleted && link.assignmentId) delete st.canvas.deleted[key];   // made again
    if (hubStamp) st.canvas.lmsHub = hubStamp;
  });
}
/** Notes what reached Canvas on each student's grade row (score + comment fingerprint). */
function pcRecordPosted_(classId, key, posted) {
  posted.forEach(function (p) {
    pcRowCritical_(function () {
      pcUpsert_('Grades', 'Email', { ClassId: classId, Email: p.email, ItemKey: key }, function () {
        var f = {}; if (p.score !== undefined) f.CanvasPostedScore = p.score === null ? '' : p.score; if (p.commentFp !== undefined) f.CanvasCommentFp = p.commentFp; return f;
      });
    });
  });
}

/** Due date for one item; synced to Canvas right away when the class is linked. dueAt: ISO or ''. */
function saveItemSchedule(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, key = pcParseItemKey_(payload.itemKey).key;
  var dueAt = pcIso_(payload.dueAt);
  if (String(payload.dueAt || '').trim() && !dueAt) throw new Error('That due date isn’t a real date.');
  var settings = pcUpdateSettings_(classId, function (st) { if (dueAt) st.due[key] = dueAt; else delete st.due[key]; });
  var out = { ok: true, due: settings.due, warnings: [] }, c = settings.canvas;
  if (!c.courseId) return out;
  var s = pcRequireStudy_(classId), item = pcItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) return out;
  var meta = pcCanvasMeta_(s, item), remake = payload.remake === true || !!(c.deleted || {})[key];
  if ((c.assignments[key] || {}).assignmentId && pcCanvasForgetDeleted_(classId, [key], ctx.teacher.email).length) {
    remake = true; settings = pcSettingsOf_(pcClass_(classId)); c = settings.canvas;
  }
  if (remake && !(c.assignments[key] || {}).assignmentId) {
    // Deleted in Canvas: Save makes it again (direct); through the hub, the next tile Push does.
    if (lmsHubEnabled_()) { out.warnings.push('This assignment was deleted in Canvas. Press ↗ Push on its tile to make it again.'); return out; }
    var conn0 = pcCanvasConn_(ctx.teacher.email);
    if (!conn0.connected) { out.warnings.push('This assignment was deleted in Canvas. Connect Canvas, then press ↗ Push on its tile to make it again.'); return out; }
    try {
      var ens0 = pcCanvasEnsure_(conn0, c, meta, s, { sched: pcSchedule_(settings, key), publish: pcReleased_(settings, key) }), a0 = ens0.assignment;
      pcSaveCanvasLink_(classId, c.courseId, key, { assignmentId: String(a0.id), name: a0.name || meta.label, htmlUrl: a0.html_url || '', pointsPossible: Number(a0.points_possible || meta.points), excusedEmails: {} });
      out.remade = true; out.canvasSynced = true;
      out.warnings.push('It had been deleted in Canvas, so it was made again' + (ens0.adopted ? ' (another class on this course had already made it, so this class uses that one)' : '') + '. Press ↗ Push to send the scores.');
    } catch (e0) { out.warnings.push('Saved in the app, but Canvas didn’t make the assignment again (' + e0.message + ').'); }
    return out;
  }
  if (!(c.assignments[key] || {}).assignmentId) return out;   // not in Canvas yet: the date goes with the first push
  try {
    if (lmsHubEnabled_()) {
      pcHubEnsureClass_(classId, c, ctx.teacher.email);
      pcHubCall_(function () { return LmsHub.syncAssignment(classId, key, { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: pcCanvasDescription_(s, item), dueAt: dueAt }, ctx.teacher.email); });
    } else {
      var conn = pcCanvasConn_(ctx.teacher.email);
      if (conn.connected) pcCanvasEnsure_(conn, c, meta, s, { sched: pcSchedule_(settings, key) });
    }
    out.canvasSynced = true;
  } catch (e) { out.warnings.push('Saved in the app, but Canvas didn’t take the new date (' + e.message + ').'); }
  return out;
}

/** ↗ Push on a tile: scores, excusals and new/changed comments for one item. `shared` (internal):
 *  Push all passes the Canvas roster and grade data so they're read once. */
function pushCanvasGrades(payload, shared) {
  payload = payload || {}; shared = shared || {};
  var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, settings = shared.settings || ctx.settings, c = settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var s = shared.study || pcRequireStudy_(classId), key = pcParseItemKey_(payload.itemKey).key;
  var item = pcItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) throw new Error('That assignment isn’t in the unit any more.');
  var remade = false;
  if (!payload.onlyLinked && ((c.assignments || {})[key] || {}).assignmentId && pcCanvasForgetDeleted_(classId, [key], ctx.teacher.email).length) {
    remade = true; settings = pcSettingsOf_(pcClass_(classId)); c = settings.canvas;
  }
  var meta = pcCanvasMeta_(s, item), link = (c.assignments || {})[key] || {};
  if (payload.onlyLinked && !link.assignmentId) return { ok: true, skipped: 'notInCanvas', notInCanvas: true, label: item.label, sent: 0 };
  var rows = pcCanvasRows_(classId, settings, s, item, shared.data);
  var remadeNote = 'It had been deleted in Canvas, so it was made again; scores and comments went to the new assignment.';
  if (lmsHubEnabled_()) { var hr = pcHubPush_(ctx, classId, settings, s, meta, rows); if (remade) { hr.remade = true; hr.warnings.unshift(remadeNote); } return hr; }
  var conn = pcCanvasConn_(ctx.teacher.email);
  if (!conn.connected) throw new Error('Connect Canvas first (Canvas card).');
  var ens = pcCanvasEnsure_(conn, c, meta, s, { sched: pcSchedule_(settings, key), publish: true }), a = ens.assignment;
  var roster = shared.roster || pcCanvasRoster_(conn, c.courseId);
  var out = { ok: true, label: item.label, title: meta.label, created: ens.created, adopted: ens.adopted, remade: remade, sent: 0, comments: 0, unmarked: [], unmatched: [], excused: [], unexcused: [], warnings: remade ? [remadeNote] : [], via: 'canvas' };
  // A different Canvas assignment than last time (made again, or adopted from another class): every comment goes again.
  var freshAssignment = String(a.id) !== String(link.assignmentId || '');
  // A new assignment goes into its module (unit default, the week's, or its own choice).
  var placed = null;
  if (!link.assignmentId) {
    try { placed = pcPlaceInModule_(conn, classId, c, item, a, link, meta.label, true); }
    catch (eMod) { out.warnings.push('It’s in Canvas, but it couldn’t be added to the module (' + eMod.message + ').'); }
  }
  var form = {}, posted = [], excusedBefore = link.excusedEmails || {}, excusedNow = {};
  rows.forEach(function (r) {
    var u = pcCanvasMatch_(r.email, roster);
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
    var cfp = r.comment ? pcFp_(r.comment) : '';
    if (r.comment && (freshAssignment || cfp !== r.commentFp)) { form['grade_data[' + u.id + '][text_comment]'] = r.comment; p.commentFp = cfp; out.comments++; }
    if (p.score !== undefined || p.commentFp !== undefined) posted.push(p);
    out.sent++;
  });
  if (Object.keys(form).length) pcCanvasRequest_(conn, 'post', '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments/' + encodeURIComponent(a.id) + '/submissions/update_grades', form);
  try { pcRecordPosted_(classId, key, posted); } catch (e) { out.warnings.push('Scores reached Canvas, but the app couldn’t note that (' + e.message + ').'); }
  var newLink = { assignmentId: String(a.id), name: a.name || meta.label, htmlUrl: a.html_url || '', pointsPossible: Number(a.points_possible || meta.points), lastPushAt: new Date().toISOString(), sent: out.sent, excusedEmails: excusedNow };
  if (placed) { newLink.moduleId = placed.moduleId; newLink.moduleName = placed.moduleName; newLink.moduleItemId = placed.moduleItemId; }
  try { pcSaveCanvasLink_(classId, c.courseId, key, newLink); } catch (e) { out.warnings.push('Canvas has the scores, but the app couldn’t save the assignment link (' + e.message + ').'); }
  out.htmlUrl = newLink.htmlUrl; out.lastPushAt = newLink.lastPushAt;
  return out;
}

/** ↗ Push all to Canvas (Gradebook card): every item already in Canvas AND released to students, one
 *  after another through pushCanvasGrades. Never creates an assignment. One failure never stops the
 *  rest; stops before the 6-minute limit and names what's left. */
function pushCanvasGradebook(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var s = pcRequireStudy_(classId), hub = lmsHubEnabled_(), links = c.assignments || {}, toPush = [], notInCanvas = [], hidden = [], noGrade = [];
  pcItems_(s).forEach(function (it) {
    var linked = !!(links[it.key] || {}).assignmentId;
    if ((ctx.settings.noGrade || {})[it.key]) { noGrade.push(it.label); return; }
    if (!pcReleased_(ctx.settings, it.key)) { if (linked) hidden.push(it.label); return; }
    if (!linked) { notInCanvas.push(it.label); return; }
    toPush.push(it);
  });
  var started = Date.now(), deleted = [];
  if (toPush.length) {
    var gone = pcCanvasForgetDeleted_(classId, toPush.map(function (it) { return it.key; }), ctx.teacher.email);
    if (gone.length) {
      toPush = toPush.filter(function (it) { if (gone.indexOf(it.key) >= 0) { deleted.push(it.label); return false; } return true; });
      ctx.settings = pcSettingsOf_(pcClass_(classId));
    }
  }
  var out = { ok: true, items: [], sent: 0, comments: 0, excused: 0, unexcused: 0, unmarked: [], unmatched: [], warnings: [], failures: [], notReached: [], notInCanvas: notInCanvas, hidden: hidden, noGrade: noGrade, deletedInCanvas: deleted, via: hub ? 'lmsHub' : 'canvas' };
  if (deleted.length) out.warnings.push((deleted.length === 1 ? deleted[0] + ' was' : deleted.join(', ') + ' were') + ' deleted in Canvas. Push all doesn’t make assignments: press ↗ Push on ' + (deleted.length === 1 ? 'its tile' : 'their tiles') + ' to make ' + (deleted.length === 1 ? 'it' : 'them') + ' again.');
  if (!toPush.length && deleted.length) { out.ok = false; out.message = out.warnings.shift(); return out; }
  if (!toPush.length) { out.ok = false; out.message = 'None of the open assignments are in Canvas yet. Use ↗ Push on a tile once to create it.'; return out; }
  var shared = { settings: ctx.settings, study: s, data: pcGradeData_(classId) };
  if (!hub) {
    var conn = pcCanvasConn_(ctx.teacher.email);
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas card).');
    shared.roster = pcCanvasRoster_(conn, c.courseId);
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
      shared.settings = pcSettingsOf_(pcClass_(classId));   // the link it just saved (excusals) for the next item
    } catch (e) { out.failures.push({ label: it.label, message: e.message || String(e) }); }
  });
  out.ok = !out.failures.length && !out.notReached.length && !deleted.length;
  return out;
}

/** Canvas gradebook import file for one item (the same numbers as Push; excluded stays blank). */
function exportCanvasCsv(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, s = pcRequireStudy_(classId);
  var key = pcParseItemKey_(payload.itemKey).key, item = pcItems_(s).filter(function (x) { return x.key === key; })[0];
  if (!item) throw new Error('That assignment isn’t in the unit any more.');
  var meta = pcCanvasMeta_(s, item), link = (ctx.settings.canvas.assignments || {})[key];
  var lines = [['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', meta.label + (link && link.assignmentId ? ' (' + link.assignmentId + ')' : '')], ['Points Possible', '', '', '', '', meta.points]];
  pcCanvasRows_(classId, ctx.settings, s, item).forEach(function (r) { lines.push([r.name, '', '', r.email, '', r.excluded || r.score == null ? '' : r.score]); });
  var csv = lines.map(function (row) { return row.map(function (v) { var x = String(v == null ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(','); }).join('\r\n');
  return { ok: true, filename: meta.label.replace(/[\\\/:*?"<>|]/g, '-') + '.csv', csv: csv };
}

// ============================================================================
// MODULES and the week window (2026-10-22a; ported from Lit Circles 2026-10-18f/g)
// Where an assignment goes in Canvas, most specific first:
//   canvas.itemModules[key]   this one assignment ("Week's module" = not set)
//   canvas.weekModules[week]  the week ("Unit default" = not set)
//   canvas.unitModule         every Podcast Studio assignment (Canvas card)
// Each choice is {moduleId, moduleName}; moduleId '' means "no module". The link remembers where it
// was placed (moduleId, moduleName, moduleItemId). Two classes on one Canvas course share an
// assignment, so they share its module item too (never listed twice in a module).
// ============================================================================

/** Where this assignment should be: {moduleId, moduleName, from: 'item'|'week'|'unit'|''}. */
function pcWantModule_(c, key, week) {
  var im = (c.itemModules || {})[key], wm = (c.weekModules || {})[String(week)], um = c.unitModule;
  if (im && typeof im === 'object') return { moduleId: String(im.moduleId || ''), moduleName: String(im.moduleName || ''), from: 'item' };
  if (wm && typeof wm === 'object') return { moduleId: String(wm.moduleId || ''), moduleName: String(wm.moduleName || ''), from: 'week' };
  if (um && typeof um === 'object') return { moduleId: String(um.moduleId || ''), moduleName: String(um.moduleName || ''), from: 'unit' };
  return { moduleId: '', moduleName: '', from: '' };
}
function pcCleanModule_(m) {
  if (m === null || m === undefined) return null;
  return { moduleId: pcClean_(m.moduleId, 40).replace(/[^0-9A-Za-z_-]/g, ''), moduleName: pcClean_(m.moduleName, 200) };
}
/** The course's modules, in Canvas order. */
function pcCanvasModules_(classId, c, teacher) {
  var conn = pcCanvasConn_(teacher);
  if (conn.connected) {
    return pcCanvasGetAll_(conn, '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/modules?per_page=100').filter(function (m) { return m && m.id && m.workflow_state !== 'deleted'; })
      .map(function (m) { return { id: String(m.id), name: m.name || ('Module ' + m.id), position: Number(m.position || 0), published: m.published !== false }; })
      .sort(function (a, b) { return (a.position - b.position) || a.name.localeCompare(b.name); });
  }
  if (lmsHubEnabled_()) {
    var r = pcHubCall_(function () { return LmsHub.placements('canvas', String(c.courseId), teacher); });
    return (r.placements || r.modules || []).map(function (m, i) { return { id: String(m.id), name: m.name || ('Module ' + m.id), position: Number(m.position || i), published: m.published !== false }; });
  }
  throw new Error('Connect Canvas first (Canvas card).');
}
function listCanvasModules(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), c = ctx.settings.canvas;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  return { ok: true, modules: pcCanvasModules_(ctx.klass.ClassId, c, ctx.teacher.email), unitModule: c.unitModule || null };
}
/** Another class on the same course that already has this assignment in this module. */
function pcSiblingModuleItem_(classId, courseId, assignmentId, moduleId) {
  var out = null;
  pcClasses_().forEach(function (k) {
    if (out || String(k.ClassId) === String(classId)) return;
    var c = (pcSettingsOf_(k).canvas) || {};
    if (String(c.courseId || '') !== String(courseId)) return;
    Object.keys(c.assignments || {}).forEach(function (key) {
      var l = c.assignments[key] || {};
      if (!out && String(l.assignmentId || '') === String(assignmentId) && String(l.moduleId || '') === String(moduleId) && l.moduleItemId) out = { moduleId: String(l.moduleId), moduleName: String(l.moduleName || ''), moduleItemId: String(l.moduleItemId) };
    });
  });
  return out;
}
/** Moves/creates/removes the assignment's module item so it sits in desiredModuleId ('' = none). */
function pcSyncModuleItem_(conn, courseId, assignment, desiredModuleId, desiredModuleName, oldLink, title, published) {
  desiredModuleId = String(desiredModuleId || ''); oldLink = oldLink || {};
  var enc = encodeURIComponent(courseId), oldModuleId = String(oldLink.moduleId || ''), oldItemId = String(oldLink.moduleItemId || '');
  var assignmentId = String((assignment || {}).id || oldLink.assignmentId || ''), oldAssignmentId = String(oldLink.assignmentId || '');
  function del() {
    if (!oldModuleId || !oldItemId) return;
    try { pcCanvasRequest_(conn, 'delete', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId)); }
    catch (e) { if (e.canvasStatus !== 404) throw e; }
    oldModuleId = ''; oldItemId = '';
  }
  if (oldAssignmentId && assignmentId && oldAssignmentId !== assignmentId) { oldModuleId = ''; oldItemId = ''; }   // a new assignment: the old item went with the old one
  if (!desiredModuleId) { del(); return { moduleId: '', moduleName: '', moduleItemId: '' }; }
  var mod = pcCanvasRequest_(conn, 'get', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId));
  var name = mod.name || String(desiredModuleName || ''), form = { 'module_item[title]': title }, item = null;
  if (published) form['module_item[published]'] = 'true';
  if (oldItemId && oldModuleId) {
    if (oldModuleId === desiredModuleId) return { moduleId: desiredModuleId, moduleName: name, moduleItemId: oldItemId };
    try {
      var upd = Object.assign({ 'module_item[module_id]': desiredModuleId }, form);
      item = pcCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(oldModuleId) + '/items/' + encodeURIComponent(oldItemId), upd);
    } catch (e) { if (e.canvasStatus !== 404) throw e; item = null; }
  }
  if (!item) {
    item = pcCanvasRequest_(conn, 'post', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items', { 'module_item[title]': title, 'module_item[type]': 'Assignment', 'module_item[content_id]': assignmentId });
    if (published) { try { item = pcCanvasRequest_(conn, 'put', '/api/v1/courses/' + enc + '/modules/' + encodeURIComponent(desiredModuleId) + '/items/' + encodeURIComponent(item.id), form); } catch (e2) {} }
  }
  return { moduleId: desiredModuleId, moduleName: name, moduleItemId: String((item && item.id) || '') };
}
/** Puts one assignment (direct to Canvas) where pcWantModule_ says. Returns the link's module fields,
 *  or null when nothing needed to change. */
function pcPlaceInModule_(conn, classId, c, item, assignment, link, title, published) {
  link = link || {};
  var want = pcWantModule_(c, item.key, item.week), assignmentId = String((assignment || {}).id || link.assignmentId || '');
  var sameAssignment = String(link.assignmentId || '') === assignmentId;
  if (sameAssignment && want.moduleId === String(link.moduleId || '') && (!want.moduleId || link.moduleItemId)) return null;
  if (!want.moduleId && !link.moduleItemId) return { moduleId: '', moduleName: '', moduleItemId: '' };
  if (want.moduleId) { var sib = pcSiblingModuleItem_(classId, c.courseId, assignmentId, want.moduleId); if (sib) return sib; }
  return pcSyncModuleItem_(conn, c.courseId, assignment || { id: assignmentId }, want.moduleId, want.moduleName, sameAssignment ? link : { assignmentId: assignmentId }, title, published);
}

/** Week N · Due dates & Canvas: what the window shows. Deleted-in-Canvas assignments are forgotten first. */
function getCanvasWeekSetup(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId;
  var s = pcRequireStudy_(classId), week = Math.floor(Number(payload.week)), items = pcItems_(s).filter(function (it) { return it.week === week; });
  if (!items.length) throw new Error('That week has no graded assignments.');
  if (!ctx.settings.canvas.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var gone = pcCanvasForgetDeleted_(classId, items.map(function (it) { return it.key; }), ctx.teacher.email), settings = gone.length ? pcSettingsOf_(pcClass_(classId)) : ctx.settings, c = settings.canvas;
  var modules = [], modulesError = '';
  try { modules = pcCanvasModules_(classId, c, ctx.teacher.email); } catch (e) { modulesError = e.message; }
  var wm = (c.weekModules || {})[String(week)];
  // Assignment groups, and where each assignment is in Canvas now (it may have been moved there).
  var groups = [], groupsError = '', where = {};
  if (lmsHubEnabled_()) groupsError = 'Through the LMS Hub, the group list isn’t shown here — move assignments between groups in Canvas.';
  else {
    try {
      groups = listCanvasGroups({ courseId: c.courseId }).groups;
      pcCanvasGetAll_(pcCanvasConn_(ctx.teacher.email), '/api/v1/courses/' + encodeURIComponent(c.courseId) + '/assignments?per_page=100').forEach(function (a) { where[String(a.id)] = String(a.assignment_group_id || ''); });
    } catch (e) { groupsError = e.message; }
  }
  return { ok: true, week: week, title: ((s.units[week - 1] || {}).title) || '', hub: lmsHubEnabled_(),
    course: { courseId: c.courseId, courseName: c.courseName || '', assignmentGroupName: c.assignmentGroupName || '' },
    modules: modules, modulesError: modulesError, groups: groups, groupsError: groupsError, unitModule: c.unitModule || null, weekModule: wm && typeof wm === 'object' ? wm : null,
    deletedInCanvas: items.filter(function (it) { return gone.indexOf(it.key) >= 0; }).map(function (it) { return it.kindLabel; }),
    items: items.map(function (it) {
      var l = (c.assignments || {})[it.key] || {}, im = (c.itemModules || {})[it.key];
      return { key: it.key, label: it.kindLabel, icon: it.icon, points: it.max, released: pcReleased_(settings, it.key), noGrade: !!(settings.noGrade || {})[it.key],
        dueAt: (settings.due || {})[it.key] || '', groupId: l.assignmentId ? (where[String(l.assignmentId)] || '') : String(c.assignmentGroupId || ''), unlockAt: (settings.unlock || {})[it.key] || '', itemModule: im && typeof im === 'object' ? im : null,
        link: l.assignmentId ? { htmlUrl: l.htmlUrl || '', moduleId: String(l.moduleId || ''), moduleName: String(l.moduleName || '') } : null };
    }) };
}

/**
 * Week N · Save to Canvas: saves every graded assignment's due date and "available from" date, the
 * week's module and each assignment's own module choice, then makes or updates each assignment in
 * Canvas (published only if it's open to students) and puts it in its module.
 * payload: {classId, week, schedules: {key: {dueAt, unlockAt}}, weekModule?: {moduleId, moduleName}|null,
 *           itemModules?: {key: {moduleId, moduleName}|null}}   (null = follow the week / the unit)
 */
function syncCanvasWeek(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, teacher = ctx.teacher.email;
  var s = pcRequireStudy_(classId), week = Math.floor(Number(payload.week)), items = pcItems_(s).filter(function (it) { return it.week === week; });
  if (!items.length) throw new Error('That week has no graded assignments.');
  if (!ctx.settings.canvas.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var sch = payload.schedules || {}, dates = {};
  items.forEach(function (it) {
    var x = sch[it.key] || {}, d = pcIso_(x.dueAt), u = pcIso_(x.unlockAt);
    if (String(x.dueAt || '').trim() && !d) throw new Error(it.kindLabel + ': that due date isn’t a real date.');
    if (String(x.unlockAt || '').trim() && !u) throw new Error(it.kindLabel + ': that “available from” date isn’t a real date.');
    if (d && u && new Date(u).getTime() > new Date(d).getTime()) throw new Error(it.kindLabel + ' opens after it is due. Change its “Available from” date or its due date.');
    dates[it.key] = { dueAt: d, unlockAt: u };
  });
  var hasWeek = Object.prototype.hasOwnProperty.call(payload, 'weekModule'), itemMods = payload.itemModules || {};
  var itemGroups = payload.itemGroups || {};   // {key: groupId}, only the assignments whose group was changed in the window
  var settings = pcUpdateSettings_(classId, function (st) {
    items.forEach(function (it) {
      var dt = dates[it.key];
      if (dt.dueAt) st.due[it.key] = dt.dueAt; else delete st.due[it.key];
      st.unlock = st.unlock || {}; if (dt.unlockAt) st.unlock[it.key] = dt.unlockAt; else delete st.unlock[it.key];
      if (Object.prototype.hasOwnProperty.call(itemMods, it.key)) { var im = pcCleanModule_(itemMods[it.key]); if (im) st.canvas.itemModules[it.key] = im; else delete st.canvas.itemModules[it.key]; }
    });
    if (hasWeek) { var wm = pcCleanModule_(payload.weekModule); if (wm) st.canvas.weekModules[String(week)] = wm; else delete st.canvas.weekModules[String(week)]; }
  });
  var gone = pcCanvasForgetDeleted_(classId, items.map(function (it) { return it.key; }), teacher);
  if (gone.length) settings = pcSettingsOf_(pcClass_(classId));
  var c = settings.canvas, hub = lmsHubEnabled_(), conn = hub ? null : pcCanvasConn_(teacher);
  if (!hub && !conn.connected) throw new Error('Saved the dates in the app. Connect Canvas (Canvas card) to send them.');
  if (hub) pcHubEnsureClass_(classId, c, teacher);
  var out = { ok: true, week: week, done: [], created: [], adopted: [], skipped: [], warnings: [], remade: items.filter(function (it) { return gone.indexOf(it.key) >= 0; }).map(function (it) { return it.kindLabel; }), via: hub ? 'lmsHub' : 'canvas' };
  var started = Date.now();
  items.forEach(function (it) {
    var link = (c.assignments || {})[it.key] || {}, released = pcReleased_(settings, it.key);
    if ((settings.noGrade || {})[it.key] && !link.assignmentId) { out.skipped.push(it.kindLabel + ' (not graded for this class)'); return; }
    if (Date.now() - started > 270000) { out.warnings.push(it.kindLabel + ' wasn’t reached. Press Save again.'); return; }
    var meta = pcCanvasMeta_(s, it), when = { explicit: true, dueAt: dates[it.key].dueAt, unlockAt: dates[it.key].unlockAt };
    try {
      var nl;
      if (hub) {
        var want = pcWantModule_(c, it.key, it.week);
        var spec = { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: pcCanvasDescription_(s, it), dueAt: when.dueAt, unlockAt: when.unlockAt, placementId: want.moduleId };
        if (released) spec.published = true;
        if (itemGroups[it.key]) spec.groupId = String(itemGroups[it.key]);
        var r = pcHubCall_(function () { return LmsHub.syncAssignment(classId, it.key, spec, teacher); }), a = r.assignment || {};
        (r.warnings || []).forEach(function (w) { if (out.warnings.indexOf(w) < 0) out.warnings.push(w); });
        nl = { assignmentId: String(a.lmsAssignmentId || ''), name: a.name || meta.label, htmlUrl: a.htmlUrl || link.htmlUrl || '', pointsPossible: Number(a.pointsPossible || meta.points),
          moduleId: String(a.placementId || ''), moduleName: String(a.placementName || ''), moduleItemId: String(a.placementItemId || '') };
        if (!link.assignmentId) (r.adopted ? out.adopted : out.created).push(it.kindLabel);
        if (String(nl.assignmentId) !== String(link.assignmentId || '')) { nl.excusedEmails = {}; if (link.assignmentId) pcClearPosted_(classId, it.key); }
      } else {
        var ens = pcCanvasEnsure_(conn, c, meta, s, { sched: when, publish: released, group: String(itemGroups[it.key] || '') }), aa = ens.assignment;
        if (ens.created) out.created.push(it.kindLabel); else if (ens.adopted) out.adopted.push(it.kindLabel);
        nl = { assignmentId: String(aa.id), name: aa.name || meta.label, htmlUrl: aa.html_url || '', pointsPossible: Number(aa.points_possible || meta.points), assignmentGroupId: String(aa.assignment_group_id || '') };
        if (String(aa.id) !== String(link.assignmentId || '')) nl.excusedEmails = {};
        try {
          var pm = pcPlaceInModule_(conn, classId, c, it, aa, link, meta.label, released);
          if (pm) { nl.moduleId = pm.moduleId; nl.moduleName = pm.moduleName; nl.moduleItemId = pm.moduleItemId; }
        } catch (eMod) { out.warnings.push(it.kindLabel + ' is in Canvas, but it couldn’t be put in the module (' + eMod.message + ').'); }
      }
      pcSaveCanvasLink_(classId, c.courseId, it.key, nl);
      out.done.push({ key: it.key, label: it.kindLabel, htmlUrl: nl.htmlUrl, moduleName: nl.moduleId ? nl.moduleName : '' });
    } catch (e) { out.warnings.push(it.kindLabel + ': ' + (e.message || e)); }
  });
  if (hub) { try { var s3 = pcSettingsOf_(pcClass_(classId)); pcSaveCanvasLink_(classId, s3.canvas.courseId, items[0].key, {}, { appId: PC_HUB_APP_ID, stamp: pcHubStamp_(s3.canvas), at: new Date().toISOString() }); } catch (e) {} }
  var fin = pcSettingsOf_(pcClass_(classId));
  out.due = fin.due; out.unlock = fin.unlock; out.canvas = fin.canvas;
  return out;
}

/** Canvas card: the module every Podcast Studio assignment goes in unless its week or the assignment
 *  says otherwise. Assignments already in Canvas that follow this default are moved too. */
function saveUnitModule(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, teacher = ctx.teacher.email;
  if (!ctx.settings.canvas.courseId) throw new Error('Link this class to a Canvas course first (Canvas card).');
  var m = pcCleanModule_(payload.module);
  var settings = pcUpdateSettings_(classId, function (st) { st.canvas.unitModule = m && m.moduleId ? m : null; });
  var c = settings.canvas, s = pcRequireStudy_(classId), hub = lmsHubEnabled_(), conn = hub ? null : pcCanvasConn_(teacher);
  var out = { ok: true, moved: [], warnings: [], unitModule: c.unitModule || null };
  var follow = pcItems_(s).filter(function (it) {
    var l = (c.assignments || {})[it.key] || {};
    return l.assignmentId && pcWantModule_(c, it.key, it.week).from !== 'item' && pcWantModule_(c, it.key, it.week).from !== 'week' && String(l.moduleId || '') !== String((c.unitModule || {}).moduleId || '');
  });
  if (!follow.length) return out;
  if (!hub && !conn.connected) { out.warnings.push('Saved. Connect Canvas to move the assignments already there.'); return out; }
  if (hub) pcHubEnsureClass_(classId, c, teacher);
  var started = Date.now();
  follow.forEach(function (it) {
    if (Date.now() - started > 270000) { out.warnings.push(it.label + ' wasn’t moved yet. Press Save again.'); return; }
    var l = c.assignments[it.key], meta = pcCanvasMeta_(s, it), released = pcReleased_(settings, it.key);
    try {
      var nl;
      if (hub) {
        var spec = { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: pcCanvasDescription_(s, it), placementId: String((c.unitModule || {}).moduleId || '') };
        var sc = pcSchedule_(settings, it.key); if (sc.hasDue) spec.dueAt = sc.dueAt; if (sc.hasUnlock) spec.unlockAt = sc.unlockAt;
        var a = (pcHubCall_(function () { return LmsHub.syncAssignment(classId, it.key, spec, teacher); }).assignment) || {};
        nl = { moduleId: String(a.placementId || ''), moduleName: String(a.placementName || ''), moduleItemId: String(a.placementItemId || '') };
      } else {
        nl = pcPlaceInModule_(conn, classId, c, it, { id: l.assignmentId }, l, meta.label, released);
      }
      if (nl) { pcSaveCanvasLink_(classId, c.courseId, it.key, nl); out.moved.push(it.label); }
    } catch (e) { out.warnings.push(it.label + ': ' + (e.message || e)); }
  });
  out.canvas = pcSettingsOf_(pcClass_(classId)).canvas;
  return out;
}
