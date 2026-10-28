// ============================================================================
// Podcast Studio -- grading (works exactly like Macbeth: tiles, counts, groups, labels, rules).
//   Handled      = has a teacher score OR is excluded (auto-scored quiz: finished OR excluded)
//   To grade     = turned in and not handled, plus redos
//   Redo         = has a score, and the work's fingerprint no longer matches the one the teacher
//                  was looking at when they marked it (MarkedFp)
//   Not submitted = total - handled - to grade
//   Ungraded is never 0: unmarked work is blank in totals, the gradebook and Canvas.
// ============================================================================

// The rubrics live in PodcastData.js (PC_RUBRICS, PC_FINAL_RUBRIC); pcRubricOf_/pcCompleteRubric_ are in Unit.js.

// ---------- 2026-10-26a: every scored assignment out of 7 (7 / 6 / 5 / 4 / 0) ----------
// Scores entered before were Complete / Partly / Incomplete out of 5 (logs, concept, cover,
// reflection) or 3 (discussions), and the Final Episode's lowest band was worth 2. Once, the first
// time any grading or grade view runs after the release, each of those scores is rescaled to 7 and
// snapped to the nearest band (a tie goes up): Complete -> 7, Partly -> 4, Incomplete -> 0, 4/5 -> 6.
// A Final Episode criterion scored 2 becomes 4 (the same descriptor, now worth 4). Process and
// Script were already out of 7 and keep their scores. MarkedFp is kept, so nothing shows as a redo.
// Every change is listed in the GradeChanges tab; the next Push sends the new numbers to Canvas.
var PC_SCALE_V = '7', PC_SCALE_PROP = 'PC_SCALE7_DONE';
function pcSnapToBand_(v) {
  var best = PC_RUBRIC_POINTS[0];
  PC_RUBRIC_POINTS.forEach(function (p) { var d = Math.abs(p - v), bd = Math.abs(best - v); if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && p > best)) best = p; });
  return best;
}
/** What one old grade row becomes, or null when it doesn't change. */
function pcRescaleRow_(r) {
  var m = /^w\d+_([A-Za-z0-9_-]+)$/.exec(String(r.ItemKey || '')); if (!m) return null;
  var act = m[1], has = r.Score !== '' && r.Score != null && isFinite(Number(r.Score));
  if (PC_OLD_MAX[act]) {
    if (!has) return null;
    var old = Number(r.Score), nw = pcSnapToBand_(Math.min(1, Math.max(0, old / PC_OLD_MAX[act])) * 7);
    return { Score: nw, CriteriaJson: r.CriteriaJson, changed: nw !== old, reason: 'out of ' + PC_OLD_MAX[act] + ' -> out of 7' };
  }
  if (act === 'episode' && r.CriteriaJson) {
    var cr = pcParse_(r.CriteriaJson, null); if (!cr || typeof cr !== 'object') return null;
    var moved = false;
    Object.keys(cr).forEach(function (k) { if (Number(cr[k]) === 2) { cr[k] = 4; moved = true; } });
    if (!moved) return null;
    var all = PC_FINAL_RUBRIC.every(function (c) { return cr[c.id] !== undefined; });
    return { Score: all ? PC_FINAL_RUBRIC.reduce(function (n, c) { return n + Number(cr[c.id]); }, 0) : '', CriteriaJson: JSON.stringify(cr), changed: true, reason: 'Final Episode band 2 -> 4' };
  }
  return null;
}
function pcEnsureScale7_() {
  if (PC_X_.scale7) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PC_SCALE_PROP)) { PC_X_.scale7 = true; return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;   // someone else is doing it; this view shows what's there now
  var was = PC_X_.scriptLocked; PC_X_.scriptLocked = true;
  try {
    if (props.getProperty(PC_SCALE_PROP)) { PC_X_.scale7 = true; return; }
    var sh = pcSheet_('Grades'), log = pcSheet_('GradeChanges'), n = 0;
    pcAllRows_(sh).forEach(function (r) {
      if (String(r.ScaleV || '') === PC_SCALE_V) return;
      var ch = pcRescaleRow_(r); if (!ch || !ch.changed) return;
      var fresh = pcReadRows_(sh, [r._row])[0];
      if (!fresh || String(fresh.ItemKey) !== String(r.ItemKey) || pcNorm_(fresh.Email) !== pcNorm_(r.Email) || String(fresh.ScaleV || '') === PC_SCALE_V) return;
      pcAppend_(log, { ClassId: fresh.ClassId, Email: fresh.Email, ItemKey: fresh.ItemKey, OldScore: fresh.Score, NewScore: ch.Score, OldCriteriaJson: fresh.CriteriaJson || '', NewCriteriaJson: ch.CriteriaJson || '', ChangedAt: new Date(), Reason: ch.reason });
      var o = {}; Object.keys(fresh).forEach(function (k) { if (k !== '_row') o[k] = fresh[k]; });
      o.Score = ch.Score; o.CriteriaJson = ch.CriteriaJson || ''; o.ScaleV = PC_SCALE_V;
      pcWriteRow_(sh, r._row, o); n++;
    });
    props.setProperty(PC_SCALE_PROP, new Date().toISOString() + ' · ' + n + ' changed');
    PC_X_.scale7 = true;
  } finally { PC_X_.scriptLocked = was; lock.releaseLock(); }
}

// ---------- the data every grading view is built from (one read per tab) ----------

function pcGradeData_(classId) {
  pcEnsureScale7_();
  var roster = pcRoster_(classId), inClass = {};
  roster.forEach(function (s) { inClass[s.email] = true; });
  var work = {}, quiz = {}, disc = {}, grades = {};
  pcReadColumns_(pcSheet_('Work'), ['ClassId', 'Email', 'Week', 'Kind', 'SubmittedAt', 'SubFp', 'UpdatedAt']).forEach(function (r) {
    if (String(r.ClassId) !== String(classId)) return;
    var e = pcNorm_(r.Email); if (!inClass[e]) return;
    work[e + '|' + pcItemKey_(r.Week, r.Kind)] = { submittedAt: pcIso_(r.SubmittedAt), fp: String(r.SubFp || ''), updatedAt: pcIso_(r.UpdatedAt), row: r._row };
  });
  pcReadColumns_(pcSheet_('Quiz'), ['ClassId', 'Email', 'Week', 'Score', 'Max', 'StartedAt', 'SubmittedAt', 'ActId']).forEach(function (r) {
    if (String(r.ClassId) !== String(classId)) return;
    var e = pcNorm_(r.Email); if (!inClass[e]) return;
    quiz[e + '|' + pcItemKey_(r.Week, r.ActId || 'quiz')] = { submittedAt: pcIso_(r.SubmittedAt), startedAt: pcIso_(r.StartedAt), score: r.SubmittedAt ? Number(r.Score) : null, max: Number(r.Max) || 0 };
  });
  var dsh = pcSheet_('Discuss');
  pcReadRows_(dsh, pcFindRowNums_(dsh, 'ClassId', classId)).forEach(function (r) {
    var e = pcNorm_(r.Email); if (!inClass[e] || !String(r.Text || '').trim()) return;
    var k = e + '|' + pcItemKey_(r.Week, r.ActId || 'discussion');
    (disc[k] = disc[k] || []).push({ id: String(r.PostId), parentId: String(r.ParentId || ''), text: pcCellText_(r.Text), createdAt: pcIso_(r.CreatedAt), editedAt: pcIso_(r.EditedAt) });
  });
  var gsh = pcSheet_('Grades');
  pcReadRows_(gsh, pcFindRowNums_(gsh, 'ClassId', classId)).forEach(function (r) {
    var e = pcNorm_(r.Email);
    grades[e + '|' + r.ItemKey] = { score: r.Score === '' || r.Score == null ? null : Number(r.Score), excluded: pcTruthy_(r.Excluded), comment: pcCellText_(r.Comment),
      gradedAt: pcIso_(r.GradedAt), gradedBy: pcCellText_(r.GradedBy), markedFp: String(r.MarkedFp || ''), postedScore: pcCellText_(r.CanvasPostedScore), commentFp: String(r.CanvasCommentFp || ''), criteria: pcParse_(r.CriteriaJson, {}) || {}, row: r._row };
  });
  return { roster: roster, work: work, quiz: quiz, disc: disc, grades: grades };
}
function pcDiscFp_(posts) {
  if (!posts || !posts.length) return PC_BLANK_FP;
  return pcFp_(pcStable_(posts.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).map(function (p) { return { p: p.parentId ? 1 : 0, t: p.text }; })));
}
/** One student, one item: everything the tile, the marking screen, the gradebook and Canvas agree on. */
function pcCellState_(data, settings, item, email) {
  var k = email + '|' + item.key, g = data.grades[k] || {};
  var classOff = !!(settings.noGrade || {})[item.key];
  var o = { email: email, key: item.key, excluded: !!g.excluded || classOff, studentExcluded: !!g.excluded, classExcluded: classOff, score: null, submitted: false, started: false, fp: PC_BLANK_FP, grade: g };
  if (item.kind === 'quiz') {
    var q = data.quiz[k] || {};
    o.started = !!q.startedAt; o.submitted = !!q.submittedAt; o.score = o.submitted ? q.score : null; o.max = q.max || item.max;
    o.handled = o.excluded || o.submitted; o.toGrade = false; o.redo = false;
    return o;
  }
  if (item.kind === 'discussion') {
    var posts = data.disc[k] || [];
    o.submitted = posts.length > 0; o.started = o.submitted; o.fp = pcDiscFp_(posts); o.posts = posts.length;
  } else {
    var w = data.work[k] || {};
    o.submitted = !!w.submittedAt; o.started = o.submitted || !!w.updatedAt; o.fp = w.fp || PC_BLANK_FP;
  }
  var scored = g.score !== null && g.score !== undefined;
  o.score = scored ? g.score : null;
  o.handled = scored || o.excluded;
  o.redo = scored && !o.excluded && o.submitted && !!g.markedFp && g.markedFp !== o.fp;
  o.toGrade = !o.excluded && ((o.submitted && !scored) || o.redo);
  return o;
}

// ---------- the Grading card ----------

function getGradingHub(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var s = pcStudyOf_(ctx.klass.ClassId);
  return Object.assign({ ok: true }, pcHubModel_(ctx.klass.ClassId, ctx.settings, s));
}
function pcHubModel_(classId, settings, s) {
  var data = pcGradeData_(classId), items = pcItems_(s), groups = {}, order = [], total = data.roster.length, needs = 0, redos = 0;
  var links = (settings.canvas || {}).assignments || {};
  items.forEach(function (it) {
    var t = { key: it.key, week: it.week, kind: it.kind, actType: it.actType, icon: it.icon, label: it.label, kindLabel: it.kindLabel, max: it.max, type: it.type,
      totalItems: total, graded: 0, needsGrading: 0, needsRegrade: 0, fresh: 0, answered: 0,
      allExcluded: !!(settings.noGrade || {})[it.key], released: pcReleased_(settings, it.key), due: (settings.due || {})[it.key] || '', firstToMark: '' };
    var first = '', firstRedo = '';
    data.roster.forEach(function (st) {
      var c = pcCellState_(data, settings, it, st.email);
      if (it.kind === 'quiz' && c.submitted) t.answered++;
      if (c.redo) { t.needsRegrade++; if (!firstRedo) firstRedo = st.email; }
      else if (c.toGrade) { t.fresh++; if (!first) first = st.email; }
      if (c.handled && !c.redo) t.graded++;
    });
    t.needsGrading = t.allExcluded ? 0 : t.fresh + t.needsRegrade;
    if (t.allExcluded) { t.needsRegrade = 0; t.fresh = 0; }
    t.firstToMark = firstRedo || first;
    var link = links[it.key] || {};
    t.canvas = { linked: !!link.assignmentId, lastPushAt: link.lastPushAt || '', htmlUrl: link.htmlUrl || '', moduleName: link.assignmentId && link.moduleId ? String(link.moduleName || '') : '' };
    needs += t.needsGrading; redos += t.needsRegrade;
    if (!groups[it.week]) { var u = s.units[it.week - 1] || {}; groups[it.week] = { week: it.week, unitLabel: it.unitLabel, title: u.title || '', reading: '', date: '', items: [] }; order.push(it.week); }
    groups[it.week].items.push(t);
  });
  var drafts = [];
  return { groups: order.map(function (w) { return groups[w]; }), drafts: drafts, unitWord: pcUnitWord_(s), needsGradingTotal: needs, needsRegradeTotal: redos, students: total, countedAt: new Date().toISOString() };
}

// ---------- marking screens ----------

function getMarking(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var classId = ctx.klass.ClassId, s = pcRequireStudy_(classId), ik = pcParseItemKey_(payload.itemKey), u = pcUnit_(s, ik.week);
  if (!u) throw new Error('That week isn’t in the unit.');
  var item = pcItems_(s).filter(function (x) { return x.key === ik.key; })[0];
  if (!item) throw new Error('That activity isn’t graded (or isn’t in this ' + pcUnitWord_(s).toLowerCase() + ' any more).');
  var a = (u.activities || []).filter(function (x) { return x.id === ik.act; })[0], form = item.kind;
  var data = pcGradeData_(classId), settings = ctx.settings, rows = [];
  var full = {};
  if (['quiz', 'discussion'].indexOf(form) < 0) {
    data.roster.forEach(function (st) {
      var r = pcWorkRow_(classId, st.email, ik.week, ik.act); if (!r) return;
      var sub = pcParseChunks_(r, 'SubJson', 3), draft = pcParseChunks_(r, 'DataJson', 3);
      full[st.email] = { sub: sub, draft: draft, draftFp: pcFp_(pcStable_(pcWorkPayload_(draft))), submittedAt: pcIso_(r.SubmittedAt), updatedAt: pcIso_(r.UpdatedAt) };
    });
  }
  var quizRows = {};
  if (form === 'quiz') data.roster.forEach(function (st) { var r = pcQuizRow_(classId, st.email, ik.week, ik.act); if (r) quizRows[st.email] = r; });
  var stats = {};
  if (form !== 'quiz' && form !== 'discussion') {
    var wsh = pcSheet_('WritingStats');
    pcReadRows_(wsh, pcFindRowNums_(wsh, 'ItemKey', ik.key)).forEach(function (r) { if (String(r.ClassId) === String(classId)) stats[pcNorm_(r.Email)] = pcParse_(r.StatsJson, {}) || {}; });
  }
  var names = {}; data.roster.forEach(function (st) { names[st.email] = st.name; });
  var allPosts = form === 'discussion' ? pcDiscussionFor_(classId, ik.week, ik.act, '', true).posts : [];
  var postById = {}; allPosts.forEach(function (p) { postById[p.id] = p; });
  data.roster.forEach(function (st) {
    var c = pcCellState_(data, settings, item, st.email), row = { email: st.email, name: st.name, demo: st.demo, cell: c, grade: c.grade };
    delete c.grade;
    if (form === 'quiz') {
      row.work = pcQuizTeacherView_(quizRows[st.email] || null, a);
    } else if (form === 'discussion') {
      row.work = { posts: allPosts.filter(function (p) { return p.email === st.email; }).map(function (p) {
        var parent = p.parentId ? postById[p.parentId] : null;
        return { id: p.id, text: p.text, createdAt: p.createdAt, editedAt: p.editedAt, replyTo: parent ? (names[parent.email] || parent.name) : '', replyToText: parent ? parent.text.slice(0, 160) : '' };
      }) };
    } else {
      var f = full[st.email];
      if (f) {
        var showDraft = !f.submittedAt;
        row.work = showDraft ? f.draft : f.sub;
        row.workIsDraft = showDraft;
        row.viewFp = showDraft ? f.draftFp : c.fp;
        row.editsAfterSubmit = !!f.submittedAt && f.draftFp !== c.fp && pcHasWriting_(f.draft);
        row.submittedAt = f.submittedAt; row.updatedAt = f.updatedAt;
        row.hasDraft = showDraft && pcHasWriting_(f.draft);
        row.unreadable = !!(row.work && row.work._unreadable);
      }
      row.stats = stats[st.email] || {};
    }
    if (!row.viewFp) row.viewFp = c.fp;
    rows.push(row);
  });
  var content = { eq: u.eq, title: u.title, prompt: a.prompt || '', fields: a.fields || [], assignment: a.assignment ? PC_PROCESS_ASSIGNMENT : null, actType: a.id };
  if (form === 'quiz') content.mc = a.mc;
  return { ok: true, item: item, content: content, rows: rows, rubric: item.type === 'rubric' ? pcRubricOf_(a) : null, complete: item.type === 'points' ? pcCompleteRubric_(a) : null,
    criteria: item.type === 'criteria' ? PC_FINAL_RUBRIC : null, library: PC_LIBRARY, classExcluded: !!(settings.noGrade || {})[ik.key], released: pcReleased_(settings, ik.key),
    weekItems: pcItems_(s).filter(function (x) { return x.week === ik.week; }), loadedAt: new Date(Date.now() - 1500).toISOString() };
}

/** One student's quiz for the marking screen: the current try, every finished try, and how many are left. */
function pcQuizTeacherView_(r, a) {
  var info = pcQuizInfo_(r, a);
  function perQ(ans) { ans = ans || {}; return (a.mc || []).map(function (q) { var x = ans[q.id] || { tries: [], state: 'open', points: 0 }; return { id: q.id, tries: x.tries || [], state: x.state || 'open', points: Number(x.points) || 0 }; }); }
  var bestN = null, bestScore = -1;
  info.attempts.forEach(function (x) { if (x.counted !== false && Number(x.score) > bestScore) { bestScore = Number(x.score); bestN = Number(x.n); } });
  return { answers: perQ(info.answers), current: info.current, done: info.done, started: info.started, allowed: info.allowed, extra: info.extra, triesLeft: info.triesLeft, canRedo: info.canRedo,
    attempts: info.attempts.map(function (x) { return { n: Number(x.n), score: Number(x.score), max: Number(x.max) || info.max, at: String(x.at || ''), counted: x.counted !== false, best: Number(x.n) === bestN,
      setAsideBy: pcCellText_(x.setAsideBy), setAsideAt: String(x.setAsideAt || ''), answers: x.answers ? perQ(x.answers) : null }; }) };
}
/** The teacher's quiz tools share these checks: a quiz in this unit, a student in this class. */
function pcQuizTeacherCtx_(payload) {
  var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId, s = pcRequireStudy_(classId), ik = pcParseItemKey_(payload.itemKey);
  var item = pcItems_(s).filter(function (x) { return x.key === ik.key; })[0];
  if (!item || item.kind !== 'quiz') throw new Error('That isn’t a quiz in this unit.');
  var a = (pcUnit_(s, ik.week).activities || []).filter(function (x) { return x.id === ik.act; })[0];
  var email = pcNorm_(payload.email);
  if (!pcEnrollment_(classId, email)) throw new Error('That student is not in this class.');
  return { ctx: ctx, classId: classId, ik: ik, a: a, email: email, keys: { ClassId: classId, Email: email, Week: ik.week, ActId: ik.act } };
}
/**
 * "Don't count" / "Count again" one finished try. payload: {classId, itemKey, email, n, counted}.
 * A try set aside leaves the score (the best counted try is the score) and doesn't use up a try.
 */
function setQuizAttemptCounted(payload) {
  payload = payload || {}; var c = pcQuizTeacherCtx_(payload), err = '', counted = !!payload.counted, n = Math.floor(Number(payload.n));
  pcUserLock_(function () {
    pcUpsert_('Quiz', 'Email', c.keys, function (r, now) {
      if (!r) { err = 'That student hasn’t taken this check yet.'; return null; }
      var info = pcQuizInfo_(r, c.a), at = info.attempts.filter(function (x) { return Number(x.n) === n; })[0];
      if (!at) { err = 'That try isn’t finished (or isn’t there any more). Refresh the list.'; return null; }
      if ((at.counted !== false) === counted) return null;   // already that way
      if (counted) { at.counted = true; delete at.setAsideBy; delete at.setAsideAt; }
      else { at.counted = false; at.setAsideBy = c.ctx.teacher.email; at.setAsideAt = now.toISOString(); }
      var tot = pcQuizTotals_(info);
      return { AttemptsJson: pcQuizAttemptsJson_(info.attempts), Score: tot.Score, SubmittedAt: tot.SubmittedAt, UpdatedAt: now };
    }, { atomic: true });
  });
  if (err) throw new Error(err);
  return pcQuizToolResult_(c);
}
/** "Give another try": one more try for one student, on top of the usual number. */
function giveQuizTry(payload) {
  payload = payload || {}; var c = pcQuizTeacherCtx_(payload), err = '';
  pcUserLock_(function () {
    pcUpsert_('Quiz', 'Email', c.keys, function (r, now) {
      if (!r) { err = 'They haven’t started this check yet, so they still have all ' + pcQuizTries_(c.a) + ' tries.'; return null; }
      var info = pcQuizInfo_(r, c.a);
      if (info.extra >= 20) { err = 'That’s already plenty of extra tries.'; return null; }
      return { ExtraTries: info.extra + 1, AttemptsJson: pcQuizAttemptsJson_(info.attempts), UpdatedAt: now };
    }, { atomic: true });
  });
  if (err) throw new Error(err);
  return pcQuizToolResult_(c);
}
function pcQuizToolResult_(c) {
  var data = pcGradeData_(c.classId), item = pcItems_(pcRequireStudy_(c.classId)).filter(function (x) { return x.key === c.ik.key; })[0];
  var cell = pcCellState_(data, c.ctx.settings, item, c.email); delete cell.grade;
  return { ok: true, email: c.email, cell: cell, work: pcQuizTeacherView_(pcQuizRow_(c.classId, c.email, c.ik.week, c.ik.act), c.a) };
}

/**
 * One teacher action on one student's item. payload: {classId, itemKey, email, score?, excluded?,
 * comment?, prevComment?, markedFp?}. score: a number (0..max, halves allowed) or null to clear.
 * A comment save sends the comment this screen last saw (prevComment); if the sheet now holds
 * something else (another tab, a co-teacher), nothing is saved and the current one comes back.
 */
function saveGrade(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var classId = ctx.klass.ClassId, s = pcRequireStudy_(classId), ik = pcParseItemKey_(payload.itemKey);
  var item = pcItems_(s).filter(function (x) { return x.key === ik.key; })[0];
  if (!item) throw new Error('That assignment isn’t in the unit any more.');
  var email = pcNorm_(payload.email);
  if (!pcEnrollment_(classId, email)) throw new Error('That student is not in this class.');
  var hasCrit = item.type === 'criteria' && payload.criteria && typeof payload.criteria === 'object';
  if (item.type === 'criteria' && Object.prototype.hasOwnProperty.call(payload, 'score')) throw new Error('This assignment is scored criterion by criterion; its total is worked out from them.');
  if (hasCrit) delete payload.score;   // the total is worked out from the criteria
  var hasScore = Object.prototype.hasOwnProperty.call(payload, 'score'), hasEx = typeof payload.excluded === 'boolean', hasComment = typeof payload.comment === 'string';
  var score = null;
  if (hasScore) {
    if (item.kind === 'quiz') throw new Error('The quiz scores itself. You can only exclude it.');
    if (payload.score !== null && payload.score !== '') {
      score = Number(payload.score);
      if (!isFinite(score) || score < 0 || score > item.max || Math.round(score * 2) !== score * 2) throw new Error('Scores go from 0 to ' + item.max + ' (halves allowed).');
    }
  }
  var crit = {};
  if (hasCrit) Object.keys(payload.criteria).forEach(function (id) {
    var cdef = PC_FINAL_RUBRIC.filter(function (c) { return c.id === id; })[0]; if (!cdef) throw new Error('That rubric criterion isn’t in the rubric.');
    var v = payload.criteria[id];
    if (v === null || v === '') { crit[id] = null; return; }
    v = Number(v);
    if (!isFinite(v) || v < 0 || v > cdef.max || Math.round(v * 2) !== v * 2) throw new Error(cdef.label + ' goes from 0 to ' + cdef.max + ' (halves allowed).');
    crit[id] = v;
  });
  var out = null;
  pcRowCritical_(function () {
    pcUpsert_('Grades', 'Email', { ClassId: classId, Email: email, ItemKey: ik.key }, function (r, now) {
      var curComment = r ? pcCellText_(r.Comment) : '';
      if (hasComment && String(payload.prevComment == null ? '' : payload.prevComment) !== curComment && payload.force !== true) {
        out = { ok: false, conflict: true, current: curComment }; return null;
      }
      var f = {};
      if (hasScore) { f.Score = score === null ? '' : score; f.MarkedFp = String(payload.markedFp || ''); f.GradedBy = ctx.teacher.email; f.GradedAt = now; f.ScaleV = PC_SCALE_V; }
      if (hasCrit) {
        // One save records the fingerprint for the whole item; the grade is the total once every criterion is scored.
        var cur = Object.assign({}, r ? (pcParse_(r.CriteriaJson, {}) || {}) : {});
        Object.keys(crit).forEach(function (id) { if (crit[id] === null) delete cur[id]; else cur[id] = crit[id]; });
        var all = PC_FINAL_RUBRIC.every(function (c) { return cur[c.id] !== undefined; });
        f.CriteriaJson = JSON.stringify(cur);
        f.Score = all ? PC_FINAL_RUBRIC.reduce(function (n, c) { return n + Number(cur[c.id]); }, 0) : '';
        f.MarkedFp = String(payload.markedFp || ''); f.GradedBy = ctx.teacher.email; f.GradedAt = now; f.ScaleV = PC_SCALE_V;
      }
      if (hasEx) { f.Excluded = payload.excluded; f.GradedBy = ctx.teacher.email; f.GradedAt = now; }
      if (hasComment) { f.Comment = pcClean_(payload.comment, 6000); }
      if (!r) { f.CanvasPostedScore = ''; f.CanvasCommentFp = ''; }
      var merged = Object.assign({}, r || {}, f);
      out = { ok: true, grade: { score: merged.Score === '' || merged.Score == null ? null : Number(merged.Score), excluded: pcTruthy_(merged.Excluded), comment: pcCellText_(merged.Comment), markedFp: String(merged.MarkedFp || ''), gradedAt: pcIso_(merged.GradedAt), criteria: pcParse_(merged.CriteriaJson, {}) || {} } };
      return f;
    });
  });
  return out;
}

// ---------- class-wide switches ----------

function setRelease(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), on = payload.on === true, keys;
  keys = [pcParseItemKey_(payload.itemKey).key];
  var s = pcUpdateSettings_(ctx.klass.ClassId, function (st) { keys.forEach(function (k) { st.release[k] = on; }); });
  return { ok: true, release: s.release };
}
function setNoGrade(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), key = pcParseItemKey_(payload.itemKey).key, on = payload.on === true;
  // Scores already entered are kept either way.
  var s = pcUpdateSettings_(ctx.klass.ClassId, function (st) { if (on) st.noGrade[key] = true; else delete st.noGrade[key]; });
  return { ok: true, noGrade: s.noGrade };
}

// ---------- gradebook ----------

function getGradebook(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId;
  var s = pcStudyOf_(classId);
  var items = pcItems_(s), data = pcGradeData_(classId), settings = ctx.settings;
  var students = data.roster.map(function (st) {
    var cells = {}, earned = 0, possible = 0, unmarked = false;
    items.forEach(function (it) {
      var c = pcCellState_(data, settings, it, st.email), cell;
      if (c.excluded) cell = { t: 'ex' };
      else if (it.kind === 'quiz') cell = c.submitted ? { t: 'score', e: c.score, p: c.max || it.max } : { t: 'none', started: c.started };
      else if (c.score !== null) cell = { t: 'score', e: c.score, p: it.max, redo: c.redo };
      else if (c.submitted) cell = { t: 'unmarked' };
      else cell = { t: 'none' };
      if ((cell.t === 'score' || cell.t === 'complete' || cell.t === 'incomplete') && cell.e != null) { earned += Number(cell.e); possible += Number(cell.p); }
      if (cell.t === 'unmarked' || cell.redo) unmarked = true;
      cells[it.key] = cell;
    });
    return { email: st.email, name: st.name, demo: st.demo, cells: cells, unit: { earned: earned, possible: possible, pct: possible ? Math.round(earned / possible * 100) : null, unmarked: unmarked } };
  });
  return { ok: true, unitWord: pcUnitWord_(s), items: items.map(function (it) { return { key: it.key, week: it.week, kind: it.kind, actType: it.actType, icon: it.icon, kindLabel: it.kindLabel, label: it.label, unitLabel: it.unitLabel, max: it.max, type: it.type, released: pcReleased_(settings, it.key) }; }), students: students };
}

// ---------- the teacher dashboard in one call ----------

function getTeacherDashboard(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId;
  var s = pcStudyOf_(classId), roster = pcRoster_(classId);
  return { ok: true, klass: pcPublicClass_(ctx.klass, true), settings: ctx.settings, study: pcTeacherStudy_(s), roster: roster, shows: pcShows_(classId),
    canva: pcCanva_(ctx.settings), library: PC_LIBRARY, today: pcToday_(), canvas: pcCanvasStatus_(ctx.teacher.email), lmsHub: lmsHubEnabled_(), serverNow: new Date().toISOString(),
    hub: pcHubModel_(classId, ctx.settings, s), gradebook: getGradebook({ classId: classId }) };
}
/** Each student's show (from Show Concept, drafts too): name, solo/crew, crew names. Teacher only. */
function pcShows_(classId) {
  var out = {}, sh = pcSheet_('Work');
  pcReadRows_(sh, pcFindRowNums_(sh, 'Kind', 'concept')).forEach(function (r) {
    if (String(r.ClassId) !== String(classId) || Number(r.Week) !== 2) return;
    var d = pcParseChunks_(r, 'DataJson', 3), f = (d && d.f) || {};
    if (f.name || f.crew) out[pcNorm_(r.Email)] = { name: String(f.name || ''), crew: String(f.crew || ''), members: String(f.members || ''), turnedIn: !!r.SubmittedAt };
  });
  return out;
}
