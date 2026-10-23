// ===========================================================================
// LitCirclesLmsHub.gs -- routes Literature Circles' Canvas push through the LMS Hub.
//
// Off by default. Nothing changes for the teacher: same buttons, same results
// line. Underneath, "Push Week N" and "Due dates & Canvas… > Save" go through the
// hub, so the same code can later reach Schoology, Google Classroom and LTI.
//
// INSTALL (fully reversible)
//  1. Add LmsHub.gs (unchanged from the hub repo) and this file to the project.
//  2. Script Properties: LMS_HUB_URL, LMS_HUB_KEY (the key made for app id
//     "literaturecircles"), and LMS_HUB_ENABLED = true.
//  3. Code.gs, first line inside two functions:
//       function syncLiteratureCanvasWeek(payload) {
//         if (typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_()) return hubSyncLiteratureCanvasWeek_(payload);
//       function pushLiteratureCanvasWeek(payload) {
//         if (typeof lmsHubEnabled_ === 'function' && lmsHubEnabled_()) return hubPushLiteratureCanvasWeek_(payload);
//  4. Run testLmsHub (or testLitCirclesLmsHub) from the editor, then deploy.
//
// The first hub push for a class moves it over by itself: the saved Canvas token
// is copied into the hub (encrypted there), the class is linked to the same
// course and assignment group, and the existing assignment ids and "comment
// already sent" records are imported, so nothing is duplicated. Every hub push
// also keeps the app's own records current (class settings, CanvasCommentFp,
// CanvasPostedScore), so LMS_HUB_ENABLED=false resumes direct Canvas cleanly.
// If a direct push happens in between, the next hub push notices (lmsHub.stamp)
// and re-imports, so the hub never re-posts a comment the app already sent.
//
// One thing the hub API cannot do: CLEAR a score that was sent earlier
// (score:null means "send nothing"). Those students are listed in `warnings`
// ("still has an old score in Canvas") and CanvasPostedScore is left as it is,
// so a direct push (LMS_HUB_ENABLED=false) clears them as before.
// ===========================================================================

var LC_HUB_APP_ID = 'literaturecircles';

function lmsHubEnabled_() {
  var p = PropertiesService.getScriptProperties();
  return String(p.getProperty('LMS_HUB_ENABLED') || '').trim().toLowerCase() === 'true' &&
    !!String(p.getProperty('LMS_HUB_URL') || '').trim() && !!String(p.getProperty('LMS_HUB_KEY') || '').trim();
}

// ---------------------------------------------------------------- errors

/** Runs one hub call; turns transport / key / Canvas problems into a sentence a teacher can act on. */
function lcHub_(fn) {
  try { return fn(); } catch (e) { throw lcHubError_(e); }
}
function lcHubError_(e) {
  if (e && e.lcHub) return e;
  var msg = String((e && e.message) || e), code = e && e.hubCode, status = e && e.status, text;
  if (/LMS Hub is not set up|Could not tell which teacher/.test(msg)) text = msg;
  else if (!code && !status) text = 'Couldn’t reach the LMS Hub (' + msg.replace(/^Exception:\s*/, '') + ').';
  else if (code === 'unauthorized') text = 'The LMS Hub didn’t accept this app’s key. Check LMS_HUB_KEY in Project Settings > Script Properties (it starts with hub_ and must be the key made for "' + LC_HUB_APP_ID + '").';
  else if (code === 'lms_unauthorized') text = 'Canvas turned down the access token. Paste a new Canvas token (Canvas button at the top of the dashboard), then push again.';
  else if (code === 'not_connected') text = 'Canvas isn’t connected in the LMS Hub yet. Connect Canvas in the app (Canvas button), then push again.';
  else text = 'The LMS Hub reported a problem: ' + msg;
  var err = new Error(text);
  err.lcHub = true; err.hubCode = code || (status ? '' : 'unreachable'); err.status = status; err.lmsStatus = e && e.lmsStatus;
  return err;
}
function lcHubFail_(err, done) {
  var tail = done && done.length
    ? ' Already sent before this happened: ' + done.join(', ') + '; the app recorded those.'
    : ' Nothing was changed in Canvas or in the app.';
  var e = new Error(err.message + tail + ' To push straight to Canvas instead, set LMS_HUB_ENABLED to false in Script Properties.');
  e.lcHub = true; e.hubCode = err.hubCode;
  return e;
}

// ---------------------------------------------------------------- linking / migration

function lcHubOrigin_(u) {
  var m = String(u || '').trim().toLowerCase().match(/^(?:https?:\/\/)?([^\/?#]+)/);
  return m ? 'https://' + m[1] : '';
}

/** A fingerprint of the app's Canvas links. If something other than this bridge (the direct push)
 *  changed them, it no longer matches what the bridge stored, and the class is re-imported. */
function lcHubStamp_(c) {
  var a = c.assignments || {};
  var parts = Object.keys(a).filter(function (k) { return /^assessment:/.test(k); }).sort().map(function (k) {
    var x = a[k] || {};
    return [k, x.assignmentId || '', x.lastGradeSyncAt || '', x.lastAssignmentSyncAt || '', x.moduleId || '', x.moduleItemId || ''].join('|');
  });
  return lcMd5Hex_([String(c.courseId || ''), String(c.assignmentGroupId || '')].concat(parts).join('\n')).slice(0, 16);
}

/** Does another class of this app, linked to the same Canvas course, already have this assignment? */
function lcHubSiblingHas_(classId, courseId, key) {
  return lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).some(function (k) {
    if (String(k.ClassId) === String(classId)) return false;
    var c = lcNormalizeClassSettings_(k.SettingsJson).canvas || {};
    return String(c.courseId || '') === String(courseId) && !!((c.assignments || {})[key] || {}).assignmentId;
  });
}

/** The hub has this teacher's Canvas token (the app's own one), or gets it now. */
function lcHubEnsureCanvas_(teacher, me, force) {
  var conn = lcCanvasConnection_();
  var hc = (me.connections || []).filter(function (x) { return x.platform === 'canvas'; })[0];
  if (!force && hc && (!conn.connected || lcHubOrigin_(hc.baseUrl) === lcHubOrigin_(conn.baseUrl))) return;
  if (!conn.connected) {
    if (hc && !force) return;
    throw new Error('Connect Canvas first (Canvas button at the top of the dashboard).');
  }
  lcHub_(function () { return LmsHub.saveConnection({ platform: 'canvas', baseUrl: conn.baseUrl, token: conn.token }, teacher); });
}

/**
 * Makes sure the hub has the Canvas token and this class's course link, importing the app's
 * existing assignment ids and sent-comment records the first time (or after a direct push).
 * Writes nothing to the app. Returns {link, imported, stamp}.
 */
function lcHubEnsureClass_(classId, settings, teacher, snap) {
  var c = settings.canvas || {};
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  var me = lcHub_(function () { return LmsHub.me(teacher); });
  if (me.app && me.app.id !== LC_HUB_APP_ID) {
    throw lcHubFail_(new Error('LMS_HUB_KEY belongs to the hub app "' + me.app.id + '" (' + (me.app.name || me.app.id) + '), not "' + LC_HUB_APP_ID + '". Make a key for "' + LC_HUB_APP_ID + '" (SETUP.md step 2) and put it in Script Properties.'));
  }
  lcHubEnsureCanvas_(teacher, me, false);
  var stamp = lcHubStamp_(c);
  var hubLink = lcHub_(function () { return LmsHub.getClassLink(classId, teacher).link; });
  if (hubLink && hubLink.platform === 'canvas' && String(hubLink.courseId) === String(c.courseId) &&
      String(hubLink.groupId || '') === String(c.assignmentGroupId || '') && (c.lmsHub || {}).stamp === stamp) {
    return { link: hubLink, imported: false, stamp: stamp };
  }
  snap = snap || lcTeacherClassSnapshot_(classId, { light: true });
  var assignments = {};
  Object.keys(c.assignments || {}).forEach(function (key) {
    var a = c.assignments[key] || {}, km = /^assessment:([1-4]):(submission|preparation|quiz|peer|reflection)$/.exec(key);
    if (!km || !a.assignmentId) return;
    var feedback = [];
    try {
      // The app remembers which comment it posted (cc:<assignmentId>:<md5>); the hub keeps a SHA-256.
      // Re-derive today's comment for each student; if it is the one already posted, tell the hub.
      lcStageGradeRows_(snap, settings, Number(km[1]), km[2]).rows.forEach(function (r) {
        var text = String(r.feedback || '').trim();
        if (text && r.commentFp === 'cc:' + String(a.assignmentId) + ':' + lcMd5Hex_(text).slice(0, 12)) feedback.push({ email: r.email, sha256: lmsHubSha256_(text) });
      });
    } catch (e) { /* nothing to import for a step that can't be computed */ }
    var sch = (settings.assignmentSchedule || {})[key] || {};
    assignments[key] = {
      lmsAssignmentId: String(a.assignmentId), name: a.name || '', htmlUrl: a.htmlUrl || '', pointsPossible: a.pointsPossible,
      gradingType: 'points', published: a.published !== false,
      placementId: a.moduleId || '', placementName: a.moduleName || '', placementItemId: a.moduleItemId || '',
      dueAt: a.dueAt || sch.dueAt || '', unlockAt: sch.unlockAt || '', lockAt: sch.lockAt || '',
      lastAssignmentSyncAt: a.lastAssignmentSyncAt || '', lastGradeSyncAt: a.lastGradeSyncAt || '', feedback: feedback
    };
  });
  var r = lcHub_(function () {
    return LmsHub.importClass(classId, {
      platform: 'canvas', courseId: String(c.courseId), courseName: c.courseName || '',
      groupId: String(c.assignmentGroupId || ''), groupName: c.assignmentGroupName || '', assignments: assignments
    }, teacher);
  });
  return { link: r.classLink, imported: true, stamp: stamp, assignmentsImported: r.assignmentsImported, feedbackHashesImported: r.feedbackHashesImported };
}

/** On "Canvas turned down the token", re-send the app's saved token once and try again. */
function lcHubRetryCanvas_(state, teacher, fn) {
  try { return fn(); } catch (e) {
    if (!(e && e.hubCode === 'lms_unauthorized') || state.resent || !lcCanvasConnection_().connected) throw e;
    state.resent = true;
    lcHubEnsureCanvas_(teacher, { connections: [] }, true);
    return fn();
  }
}

// ---------------------------------------------------------------- shapes

function lcHubSpec_(classId, c, m, settings, schedule) {
  var released = lcCanvasWeekReleased_(m.week, settings), has = !!((c.assignments || {})[m.key] || {}).assignmentId;
  var spec = { title: m.label, pointsPossible: m.points, gradingType: 'points', description: lcCanvasDescription_(m.week, m.stage) };
  // Same rule as the direct push: publish when the week is open; send published=false only when this
  // push is what CREATES the assignment (never to one that exists — Canvas can't unpublish graded work).
  if (released) spec.published = true;
  else if (!has && !lcHubSiblingHas_(classId, c.courseId, m.key)) spec.published = false;
  if (schedule) { spec.dueAt = String(schedule.dueAt || ''); spec.unlockAt = String(schedule.unlockAt || ''); spec.lockAt = String(schedule.lockAt || ''); }
  return spec;
}
/** A hub call that may have sent published=false to an assignment it adopted by name: if Canvas
 *  refuses (it already has grades), go again without touching published. */
function lcHubPublishedRetry_(spec, fn) {
  try { return fn(spec); } catch (e) {
    if (spec.published === false && e && e.hubCode === 'lms_error' && e.lmsStatus === 400) {
      var s2 = Object.assign({}, spec); delete s2.published; return fn(s2);
    }
    throw e;
  }
}

/** The hub's assignment record in the shape the app keeps in settings.canvas.assignments. */
function lcHubLinkFrom_(m, a, prev, gradePushed) {
  prev = prev || {}; a = a || {};
  var now = new Date().toISOString();
  return {
    week: m.week, stage: m.stage, assignmentId: String(a.lmsAssignmentId), name: a.name || m.label, htmlUrl: a.htmlUrl || prev.htmlUrl || '',
    pointsPossible: Number(a.pointsPossible != null && a.pointsPossible !== '' ? a.pointsPossible : m.points), dueAt: a.dueAt || '', published: a.published !== false,
    moduleId: a.placementId || '', moduleName: a.placementName || '', moduleItemId: a.placementItemId || '',
    lastAssignmentSyncAt: a.lastAssignmentSyncAt || now, lastGradeSyncAt: gradePushed ? now : (a.lastGradeSyncAt || prev.lastGradeSyncAt || '')
  };
}

function lcHubClassNames_(shared) {
  var names = {};
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (k) { names[String(k.ClassId)] = String(k.ClassName || '') + (k.Period !== '' && k.Period != null ? ' (Period ' + cellToText_(k.Period) + ')' : ''); });
  return (shared || []).filter(function (s) { return s.appId === LC_HUB_APP_ID; }).map(function (s) { return names[s.classId] || s.classId; });
}

/** Saves links (+ schedules) and the import stamp, under the lock, only if the class is still on that course. */
function lcHubSaveLinks_(classId, courseId, links, schedules) {
  return lcMutateClassSettings_(classId, function (s) {
    if (String(s.canvas.courseId || '') !== String(courseId)) return;
    s.canvas.assignments = s.canvas.assignments || {};
    Object.keys(links).forEach(function (k) { s.canvas.assignments[k] = links[k]; });
    Object.keys(schedules || {}).forEach(function (k) { s.assignmentSchedule[k] = schedules[k]; });
    s.canvas.lmsHub = { appId: LC_HUB_APP_ID, stamp: lcHubStamp_(s.canvas), at: new Date().toISOString() };
  });
}

// ---------------------------------------------------------------- the two drop-ins

/** Drop-in for syncLiteratureCanvasWeek: same payload, same result shape. */
function hubSyncLiteratureCanvasWeek_(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcCanvasTeacherContext_(classId);
  var remade = lcCanvasForgetDeleted_(classId, week); // 2026-10-18g: deleted in Canvas → made again
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, teacher = ctx.teacher.email;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  try { lcHubEnsureClass_(classId, ctx.settings, teacher); } catch (e) { throw e.lcHub && /LMS_HUB_ENABLED/.test(e.message) ? e : (e.lcHub ? lcHubFail_(e) : e); }
  var schedules = payload.schedules || {}, links = {}, newSchedules = {}, adopted = [], warnings = [], shared = [], done = [], state = {};
  var qsnap = null, snapFn = function () { return qsnap || (qsnap = lcTeacherClassSnapshot_(classId, { light: true })); };
  try {
    LC_STAGES.forEach(function (st) {
      if (lcQuizSkipCanvas_(st, week, (c.assignments || {})[lcCanvasAssessmentKey_(week, st)], snapFn)) return; // no Reading Quiz this week
      var m = lcCanvasAssessmentMeta_(week, st), sch = schedules[st] || ctx.settings.assignmentSchedule[m.key] || {};
      sch = { dueAt: String(sch.dueAt || ''), unlockAt: String(sch.unlockAt || ''), lockAt: String(sch.lockAt || '') };
      var spec = lcHubSpec_(classId, c, m, ctx.settings, sch);
      // 2026-10-18f: reuse another class's module item for a shared assignment, and place a step that
      // was never placed (the quiz) in the week's module (lcCanvasModulePlan_ in Code.js).
      var own = (c.assignments || {})[m.key] || {}, sib = own.assignmentId ? null : lcSiblingCanvasLink_(classId, c.courseId, m.key);
      var plan = lcCanvasModulePlan_(classId, c, week, m.key, payload, own.assignmentId || (sib && sib.assignmentId) || '');
      if (plan.moduleId !== undefined) spec.placementId = plan.moduleId;
      if ((payload.groups || {})[st]) spec.groupId = String(payload.groups[st]);   // group picked in the Week window
      var put = function (sp) { return lcHub_(function () { return LmsHub.syncAssignment(classId, m.key, sp, teacher); }); };
      var r = lcHubRetryCanvas_(state, teacher, function () { return lcHubPublishedRetry_(spec, put); });
      if (r.adopted) {
        adopted.push(m.title);
        // The hub leaves dates alone when it adopts another class's assignment; the teacher pressed
        // Save with these dates (as the direct code does), so apply them now that it is linked.
        var again = { title: spec.title, pointsPossible: spec.pointsPossible, gradingType: 'points', description: spec.description, dueAt: sch.dueAt, unlockAt: sch.unlockAt, lockAt: sch.lockAt };
        if (spec.published === true) again.published = true;
        r = put(again);
      }
      (r.warnings || []).forEach(function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); });
      lcHubClassNames_(r.sharedWith).forEach(function (n) { if (shared.indexOf(n) < 0) shared.push(n); });
      newSchedules[m.key] = sch;
      links[m.key] = lcHubLinkFrom_(m, r.assignment, (c.assignments || {})[m.key], false);
      if (plan.adopt && String(links[m.key].assignmentId) === String(own.assignmentId || (sib && sib.assignmentId) || '')) { links[m.key].moduleId = plan.adopt.moduleId; links[m.key].moduleName = plan.adopt.moduleName; links[m.key].moduleItemId = plan.adopt.moduleItemId; }
      done.push(LC_STAGE_META[st].step);
    });
  } catch (e) {
    if (Object.keys(links).length) { try { lcHubSaveLinks_(classId, c.courseId, links, newSchedules); } catch (e2) {} }
    throw e.lcHub ? lcHubFail_(e, done) : e;
  }
  var settings = lcHubSaveLinks_(classId, c.courseId, links, newSchedules);
  return { ok: true, week: week, links: links, adopted: adopted, remade: remade, settings: settings, sharedWith: shared, warnings: warnings, via: 'lmsHub' };
}

/** Drop-in for pushLiteratureCanvasWeek: same payload, same result shape (stages[], commentsPosted,
 *  commentsFailed, settings, course, warnings). */
function hubPushLiteratureCanvasWeek_(payload, shared) {
  payload = payload || {}; var classId = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcCanvasTeacherContext_(classId);
  var remade = lcCanvasForgetDeleted_(classId, week, (payload.stage && LC_STAGES.indexOf(String(payload.stage)) >= 0) ? [String(payload.stage)] : null);
  var ctx = lcCanvasTeacherContext_(classId), c = ctx.settings.canvas || {}, teacher = ctx.teacher.email;
  if (!c.courseId) throw new Error('Link this class to a Canvas course first.');
  var snap = (shared && shared.snap) || lcTeacherClassSnapshot_(classId, { light: true });
  try { lcHubEnsureClass_(classId, ctx.settings, teacher, snap); } catch (e) { throw e.lcHub && /LMS_HUB_ENABLED/.test(e.message) ? e : (e.lcHub ? lcHubFail_(e) : e); }

  var links = {}, stagesOut = [], fpMeta = [], postedMeta = [], warnings = [], stillScored = [], stillExcused = [], done = [], state = {}, failure = null;
  var commentsPosted = 0, commentsFailed = 0;
  try {
    var pushStages = (payload.stage && LC_STAGES.indexOf(String(payload.stage)) >= 0) ? [String(payload.stage)] : LC_STAGES;
    pushStages.forEach(function (st) {
      var m = lcCanvasAssessmentMeta_(week, st), out = { stage: st, title: m.title, points: m.points, sent: 0, blank: [], pending: [], unmatched: [], redo: [], excluded: 0, excused: [], unexcused: [], cleared: [], notDue: [], commentsQueued: 0, created: false, adopted: false };
      var classEx = !!ctx.settings.excluded[lcItemKey_(week, st)];
      var existing = (c.assignments || {})[m.key] || {};
      if (lcQuizSkipCanvas_(st, week, existing, function () { return snap; })) { out.skipped = 'No Reading Quiz this week'; out.noQuiz = true; stagesOut.push(out); return; }
      if (classEx && !existing.assignmentId) { out.skipped = 'Not graded for this class'; stagesOut.push(out); return; }
      if (payload.onlyLinked && !existing.assignmentId) { out.skipped = 'Not in Canvas yet'; out.notInCanvas = true; stagesOut.push(out); return; }
      var data = lcStageGradeRows_(snap, ctx.settings, week, st), rows = [], byEmail = {};
      data.rows.forEach(function (r) {
        byEmail[r.email] = r;
        var wasExcused = String(r.postedScore) === 'EX', tag = r.name + ' (' + LC_STAGE_META[st].step + ')';
        // 2026-10-18a: left out for this one student -> sent through the hub as excused (the hub's
        // rows take excused:true and Canvas marks the submission Excused).
        if (r.reason === 'excluded' && !r.classExcluded) { rows.push({ email: r.email, name: r.name, score: null, excused: true, feedback: '' }); out.excused.push(r.name); out.excluded++; return; }
        // Excused earlier and still no score: leave Canvas as it is (the excusal stays).
        if (wasExcused && r.score == null) { if (r.reason === 'pending') out.pending.push(r.name); return; }
        // Excused earlier and scored now: the score goes, but the hub can't send excuse=false, so warn.
        if (wasExcused) stillExcused.push(tag);
        // A score the app sent before but no longer has: the hub can't clear a Canvas score
        // (score:null means "send nothing"), so say so instead of pretending it was cleared.
        if ((r.reason === 'excluded' || r.score == null) && r.reason !== 'notDue' && r.reason !== 'inProgress' && r.postedScore !== '' && r.postedScore != null) stillScored.push(tag);
        if (r.reason === 'notDue') { out.notDue.push(r.name); return; }
        if (r.reason === 'excluded') { out.excluded++; return; }
        if (r.reason === 'pending') out.pending.push(r.name);
        if (r.score == null) { if (r.reason !== 'pending' && r.reason !== 'na') out.blank.push(r.name); return; }
        // Comments travel only with a score, exactly as before.
        rows.push({ email: r.email, name: r.name, score: Number(r.score), feedback: String(r.feedback || '').trim() });
      });
      var spec = lcHubSpec_(classId, c, m, ctx.settings, existing.assignmentId ? null : (ctx.settings.assignmentSchedule[m.key] || {}));
      var push = function (sp) { return lcHub_(function () { return LmsHub.pushGrades(classId, m.key, sp, rows, teacher); }); };
      var put2 = function (sp) { if (sp.published === false) { sp = Object.assign({}, sp); delete sp.published; } return lcHub_(function () { return LmsHub.syncAssignment(classId, m.key, sp, teacher); }); };
      var res = lcHubRetryCanvas_(state, teacher, function () { return lcHubPublishedRetry_(spec, push); });

      var skip = {};
      (res.unmatched || []).forEach(function (u) { var mm = /\(([^()]+)\)$/.exec(u); var em = mm ? normEmail_(mm[1]) : ''; skip[em] = true; out.unmatched.push(byEmail[em] ? byEmail[em].name : u); });
      (res.failed || []).forEach(function (f) { skip[normEmail_(f.email)] = true; });
      (res.pending || []).forEach(function (e) { skip[normEmail_(e)] = true; });
      var lmsId = String(res.assignment.lmsAssignmentId);
      rows.forEach(function (row) {
        if (skip[row.email]) return;
        var r = byEmail[row.email];
        if (r.redo) out.redo.push(r.name);
        var sentValue = row.excused ? 'EX' : String(row.score);
        if (String(r.postedScore) !== sentValue) postedMeta.push({ email: row.email, itemKey: lcItemKey_(week, st), score: sentValue });
        if (row.feedback) {
          // Posted now or skipped as already there: either way Canvas has this comment.
          var fp = 'cc:' + lmsId + ':' + lcMd5Hex_(row.feedback).slice(0, 12);
          if (fp !== r.commentFp) fpMeta.push({ email: row.email, itemKey: lcItemKey_(week, st), fp: fp });
        }
      });
      var failedComments = (res.failed || []).filter(function (f) { var r = byEmail[normEmail_(f.email)]; return r && String(r.feedback || '').trim(); }).length;
      out.sent = res.sent; out.created = !!res.created; out.adopted = !!res.adopted;
      out.commentsPosted = res.feedbackPosted || 0; out.commentsQueued = out.commentsPosted + failedComments;
      if (res.feedbackSkipped) out.commentsSkipped = res.feedbackSkipped;
      commentsPosted += out.commentsPosted; commentsFailed += failedComments;
      (res.warnings || []).forEach(function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); });
      if (res.pointsConflict) warnings.push(res.pointsConflict);
      if ((res.failed || []).length) warnings.push(LC_STAGE_META[st].step + ': Canvas could not apply ' + res.failed.length + ' score(s) (' + String(res.failed[0].error || '') + '). Push again.');
      if ((res.pending || []).length) warnings.push(LC_STAGE_META[st].step + ': ' + res.pending.length + ' student(s) still waiting. Push again to finish.');
      links[m.key] = lcHubLinkFrom_(m, res.assignment, existing, true);
      if (!existing.assignmentId && !links[m.key].moduleItemId) {
        // 2026-10-18g: a step made by Push goes into the week's module too (same rule as Save).
        try {
          var planP = lcCanvasModulePlan_(classId, c, week, m.key, {}, lmsId);
          if (planP.adopt) { links[m.key].moduleId = planP.adopt.moduleId; links[m.key].moduleName = planP.adopt.moduleName; links[m.key].moduleItemId = planP.adopt.moduleItemId; }
          else if (planP.moduleId) {
            var placed = put2(Object.assign({}, spec, { placementId: planP.moduleId }));
            links[m.key] = lcHubLinkFrom_(m, placed.assignment, existing, true);
          }
        } catch (eMod) { warnings.push(LC_STAGE_META[st].step + ' is in Canvas but couldn’t be added to the module: ' + eMod.message); }
      }
      out.htmlUrl = links[m.key].htmlUrl;
      stagesOut.push(out);
      done.push(LC_STAGE_META[st].step);
    });
  } catch (e) { failure = e; }

  if (stillExcused.length) warnings.push('These were excused in Canvas earlier and now have a score. The LMS Hub sent the score but can’t lift the excusal itself: ' + stillExcused.join(', ') + '. If Canvas still shows them as Excused, push once with LMS_HUB_ENABLED=false.');
  if (stillScored.length) warnings.push('Through the LMS Hub a score can’t be removed from Canvas, so these still have an old score in Canvas: ' + stillScored.join(', ') + '. Remove it in Canvas, or push once with LMS_HUB_ENABLED=false to clear it.');
  // Bookkeeping first (as the direct push does), so a later failure can't re-post comments.
  if (fpMeta.length || postedMeta.length) {
    try {
      withLock_(function () {
        var sh = lcPlatformSheet_(LC_PLATFORM_SHEETS.GRADES);
        fpMeta.forEach(function (p) { lcUpsertByKeys_(sh, 'StudentEmail', { ClassId: classId, StudentEmail: p.email, ItemKey: p.itemKey }, { CanvasCommentFp: p.fp }); });
        postedMeta.forEach(function (p) { lcUpsertByKeys_(sh, 'StudentEmail', { ClassId: classId, StudentEmail: p.email, ItemKey: p.itemKey }, { CanvasPostedScore: p.score }); });
      });
    } catch (e) { warnings.push('Scores and comments reached Canvas, but the app couldn’t record that (' + e.message + '). The hub still won’t repeat the comments.'); }
  }
  var settings = ctx.settings;
  if (Object.keys(links).length) {
    try { settings = lcHubSaveLinks_(classId, c.courseId, links, null); }
    catch (e) { warnings.push('Canvas has the grades, but the app couldn’t save the assignment links (' + e.message + '). Push again later.'); }
  }
  if (failure) throw failure.lcHub ? lcHubFail_(failure, done) : failure;
  return { ok: true, week: week, stages: stagesOut, commentsPosted: commentsPosted, commentsFailed: commentsFailed, settings: settings, course: c.courseName || '', remade: remade, warnings: lcRemadeNote_(remade, !!payload.onlyLinked).concat(warnings), via: 'lmsHub' };
}

// ---------------------------------------------------------------- editor tools

/** Optional, from the editor: move every one of YOUR Canvas-linked classes to the hub now instead
 *  of on each class's first push. Safe to run twice. */
function migrateMyClassesToLmsHub() {
  var t = lcRequireTeacher_(), out = [];
  lcSheetObjects_(LC_PLATFORM_SHEETS.CLASSES).forEach(function (k) {
    if (!lcTruth_(k.Active)) return;
    if (t.role !== 'admin' && normEmail_(k.TeacherEmail) !== t.email) return;
    var classId = String(k.ClassId), settings = lcNormalizeClassSettings_(k.SettingsJson), c = settings.canvas || {}, label = String(k.ClassName || classId) + ' ' + cellToText_(k.Period);
    if (!c.courseId) return;
    try {
      var r = lcHubEnsureClass_(classId, settings, t.email);
      if (r.imported) lcMutateClassSettings_(classId, function (s) {
        if (String(s.canvas.courseId || '') === String(c.courseId)) s.canvas.lmsHub = { appId: LC_HUB_APP_ID, stamp: lcHubStamp_(s.canvas), at: new Date().toISOString() };
      });
      var line = label + ': ' + (r.imported ? 'linked to ' + (r.link.courseName || r.link.courseId) + ', ' + r.assignmentsImported + ' assignment(s) and ' + r.feedbackHashesImported + ' sent comment(s) imported.' : 'already on the hub.');
      Logger.log(line); out.push(line);
    } catch (e) { Logger.log(label + ': ' + e.message); out.push(label + ': ' + e.message); }
  });
  return out;
}

/** From the editor: testLmsHub plus the checks this app needs. */
function testLitCirclesLmsHub() {
  var me = testLmsHub();
  if (me.app.id !== LC_HUB_APP_ID) Logger.log('WARNING: this key is for hub app "' + me.app.id + '". Literature Circles needs a key made for "' + LC_HUB_APP_ID + '".');
  var conn = lcCanvasConnection_();
  Logger.log('Canvas token saved in the app: ' + (conn.connected ? 'yes (' + conn.baseUrl + ')' : 'no — connect Canvas in the app first'));
  Logger.log('LMS_HUB_ENABLED: ' + (lmsHubEnabled_() ? 'on — pushes go through the hub' : 'off — pushes go straight to Canvas'));
  return { app: me.app, teacher: me.teacher, connections: me.connections, appCanvasConnected: conn.connected, enabled: lmsHubEnabled_() };
}
