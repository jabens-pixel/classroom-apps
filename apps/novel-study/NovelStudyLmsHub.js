// ============================================================================
// Novel Study -- adapter to the shared LMS Hub (LmsHub.gs; never edit that file per app).
// Off unless Script Properties has LMS_HUB_ENABLED = true, LMS_HUB_URL and LMS_HUB_KEY
// (a key made for the hub app "novelstudy" on the hub's /setup page).
// ============================================================================

var NV_HUB_APP_ID = 'novelstudy';

function lmsHubEnabled_() {
  var p = PropertiesService.getScriptProperties();
  return String(p.getProperty('LMS_HUB_ENABLED') || '').trim().toLowerCase() === 'true' &&
    !!String(p.getProperty('LMS_HUB_URL') || '').trim() && !!String(p.getProperty('LMS_HUB_KEY') || '').trim() && typeof LmsHub !== 'undefined';
}
function nvHubCall_(fn) {
  try { return fn(); } catch (e) {
    var code = e && e.hubCode, msg = String((e && e.message) || e), text;
    if (/LMS Hub is not set up|Could not tell which teacher/.test(msg)) text = msg;
    else if (!code && !(e && e.status)) text = 'Couldn’t reach the LMS Hub (' + msg.replace(/^Exception:\s*/, '') + ').';
    else if (code === 'unauthorized') text = 'The LMS Hub didn’t accept this app’s key. Check LMS_HUB_KEY in Script Properties (it must be the key made for "' + NV_HUB_APP_ID + '").';
    else if (code === 'lms_unauthorized') text = 'Canvas turned down the access token. Paste a new token in the Canvas card, then push again.';
    else if (code === 'not_connected') text = 'Canvas isn’t connected in the LMS Hub yet. Connect Canvas in the Canvas card, then push again.';
    else text = 'The LMS Hub reported a problem: ' + msg;
    var err = new Error(text + ' To push straight to Canvas instead, set LMS_HUB_ENABLED to false in Script Properties.');
    err.hubCode = code; throw err;
  }
}
function nvHubStamp_(c) {
  var a = c.assignments || {};
  return nvMd5_([String(c.courseId || ''), String(c.assignmentGroupId || '')].concat(Object.keys(a).sort().map(function (k) { return k + '|' + (a[k].assignmentId || ''); })).join('\n')).slice(0, 16);
}
/** The hub has this teacher's Canvas token and this class's course link (importing any assignment
 *  the app already made directly, so nothing is duplicated). */
function nvHubEnsureClass_(classId, c, teacher) {
  var me = nvHubCall_(function () { return LmsHub.me(teacher); });
  if (me.app && me.app.id && me.app.id !== NV_HUB_APP_ID) throw new Error('LMS_HUB_KEY belongs to the hub app "' + me.app.id + '", not "' + NV_HUB_APP_ID + '". Make a key for "' + NV_HUB_APP_ID + '" on the hub’s /setup page.');
  var conn = nvCanvasConn_(teacher), hc = (me.connections || []).filter(function (x) { return x.platform === 'canvas'; })[0];
  if (!hc) {
    if (!conn.connected) throw new Error('Connect Canvas first (Canvas card).');
    nvHubCall_(function () { return LmsHub.saveConnection({ platform: 'canvas', baseUrl: conn.baseUrl, token: conn.token }, teacher); });
  }
  var stamp = nvHubStamp_(c);
  var link = nvHubCall_(function () { return LmsHub.getClassLink(classId, teacher).link; });
  if (link && link.platform === 'canvas' && String(link.courseId) === String(c.courseId) && String(link.groupId || '') === String(c.assignmentGroupId || '') && (c.lmsHub || {}).stamp === stamp) return stamp;
  var assignments = {};
  Object.keys(c.assignments || {}).forEach(function (k) {
    var x = c.assignments[k] || {}; if (!x.assignmentId) return;
    assignments[k] = { lmsAssignmentId: String(x.assignmentId), name: x.name || '', htmlUrl: x.htmlUrl || '', pointsPossible: x.pointsPossible, gradingType: 'points', published: true,
      placementId: '', placementName: '', placementItemId: '', dueAt: '', unlockAt: '', lockAt: '', lastAssignmentSyncAt: '', lastGradeSyncAt: x.lastPushAt || '', feedback: [] };
  });
  nvHubCall_(function () {
    return LmsHub.importClass(classId, { platform: 'canvas', courseId: String(c.courseId), courseName: c.courseName || '', groupId: String(c.assignmentGroupId || ''), groupName: c.assignmentGroupName || '', assignments: assignments }, teacher);
  });
  return stamp;
}
/** Push one item through the hub. Excluded students go as {excused:true, score:null}; the hub can't
 *  send excuse=false, so lifting an excusal comes with a warning by name. */
function nvHubPush_(ctx, classId, settings, s, meta, rows) {
  var c = settings.canvas, teacher = ctx.teacher.email, key = meta.key;
  nvHubEnsureClass_(classId, c, teacher);
  var out = { ok: true, label: meta.item.label, title: meta.label, created: false, adopted: false, sent: 0, comments: 0, unmarked: [], unmatched: [], excused: [], unexcused: [], warnings: [], via: 'lmsHub' };
  var hubRows = [], byEmail = {}, stillExcused = [];
  var excusedBefore = ((c.assignments || {})[key] || {}).excusedEmails || {};
  rows.forEach(function (r) {
    byEmail[r.email] = r;
    if (r.excluded) { hubRows.push({ email: r.email, name: r.name, score: null, excused: true, feedback: '' }); out.excused.push(r.name); return; }
    if (r.score == null) { if (r.submitted) out.unmarked.push(r.name); return; }
    if (excusedBefore[r.email]) stillExcused.push(r.name);
    hubRows.push({ email: r.email, name: r.name, score: Number(r.score), feedback: r.comment || '' });
  });
  var spec = { title: meta.label, pointsPossible: meta.points, gradingType: 'points', description: nvCanvasDescription_(s, meta.item), published: true };
  var sched = nvSchedule_(settings, key); if (sched.hasDue) spec.dueAt = sched.dueAt;
  var res = nvHubCall_(function () { return LmsHub.pushGrades(classId, key, spec, hubRows, teacher); });
  var skip = {};
  (res.unmatched || []).forEach(function (u) { var m = /\(([^()]+)\)$/.exec(u); var em = m ? nvNorm_(m[1]) : ''; skip[em] = true; out.unmatched.push(byEmail[em] ? byEmail[em].name : u); });
  (res.failed || []).forEach(function (f) { skip[nvNorm_(f.email)] = true; });
  (res.pending || []).forEach(function (e) { skip[nvNorm_(e)] = true; });
  var excusedNow = {}, posted = [];
  Object.keys(excusedBefore).forEach(function (e) { var r = byEmail[e]; if (r && r.score == null && !r.excluded) excusedNow[e] = true; });
  hubRows.forEach(function (h) {
    if (h.excused) { if (!skip[h.email] || excusedBefore[h.email]) excusedNow[h.email] = true; return; }
    if (skip[h.email]) { if (excusedBefore[h.email]) excusedNow[h.email] = true; return; }
    var r = byEmail[h.email], p = { email: h.email };
    if (String(r.postedScore) !== String(h.score)) p.score = h.score;
    if (r.comment) { var cfp = nvFp_(r.comment); if (cfp !== r.commentFp) { p.commentFp = cfp; out.comments++; } }
    if (p.score !== undefined || p.commentFp !== undefined) posted.push(p);
  });
  out.sent = Number(res.sent) || 0; out.created = !!res.created; out.adopted = !!res.adopted;
  (res.warnings || []).forEach(function (w) { out.warnings.push(w); });
  if ((res.failed || []).length) out.warnings.push('Canvas couldn’t apply ' + res.failed.length + ' score(s). Push again.');
  if ((res.pending || []).length) out.warnings.push(res.pending.length + ' student(s) still waiting. Push again to finish.');
  if (stillExcused.length) out.warnings.push('These were excused in Canvas earlier and now count again. The LMS Hub sent their scores but can’t lift the excusal itself: ' + stillExcused.join(', ') + '. If Canvas still shows them as Excused, push once with LMS_HUB_ENABLED=false.');
  try { nvRecordPosted_(classId, key, posted); } catch (e) { out.warnings.push('Scores reached Canvas, but the app couldn’t note that (' + e.message + ').'); }
  var a = res.assignment || {};
  var link = { assignmentId: String(a.lmsAssignmentId || ''), name: a.name || meta.label, htmlUrl: a.htmlUrl || '', pointsPossible: Number(a.pointsPossible || meta.points), lastPushAt: new Date().toISOString(), sent: out.sent, excusedEmails: excusedNow };
  try {
    var s2 = nvSaveCanvasLink_(classId, c.courseId, key, link);
    nvSaveCanvasLink_(classId, c.courseId, key, {}, { appId: NV_HUB_APP_ID, stamp: nvHubStamp_(s2.canvas), at: new Date().toISOString() });
  } catch (e) { out.warnings.push('Canvas has the scores, but the app couldn’t save the assignment link (' + e.message + ').'); }
  out.htmlUrl = link.htmlUrl; out.lastPushAt = link.lastPushAt;
  return out;
}
/** From the editor: checks the hub key and connection for this app. */
function testNovelStudyLmsHub() {
  var me = LmsHub.me();
  Logger.log('Hub app: ' + (me.app && me.app.id) + (me.app && me.app.id !== NV_HUB_APP_ID ? '  (WARNING: this app needs a key made for "' + NV_HUB_APP_ID + '")' : ''));
  Logger.log('Canvas connected in hub for you: ' + ((me.connections || []).some(function (c) { return c.platform === 'canvas'; }) ? 'yes' : 'no'));
  Logger.log('LMS_HUB_ENABLED: ' + (lmsHubEnabled_() ? 'on: Push goes through the hub' : 'off: Push goes straight to Canvas'));
  return me;
}
