// ============================================================================
// Novel Study -- grading (works exactly like Macbeth: tiles, counts, groups, labels, rules).
//   Handled      = has a teacher score OR is excluded (auto-scored quiz: finished OR excluded)
//   To grade     = turned in and not handled, plus redos
//   Redo         = has a score, and the work's fingerprint no longer matches the one the teacher
//                  was looking at when they marked it (MarkedFp)
//   Not submitted = total - handled - to grade
//   Ungraded is never 0: unmarked work is blank in totals, the gradebook and Canvas.
// ============================================================================

var NV_RUBRIC = [
  { score: 1, label: 'Incomplete', text: 'No response yet, or it doesn’t answer the prompt.' },
  { score: 2, label: 'Minimal', text: 'A few ideas, mostly retelling what happened. No evidence from the book.' },
  { score: 3, label: 'Developing', text: 'Tries a claim, but the evidence is vague, has no location, or doesn’t connect to the claim.' },
  { score: 4, label: 'Adequate', text: 'A clear claim with at least one relevant piece of evidence and some explanation.' },
  { score: 5, label: 'Proficient', text: 'A clear claim, two or more well-chosen pieces of evidence with chapter/page, and an explanation of how each supports the claim.' },
  { score: 6, label: 'Strong', text: 'A precise claim. Evidence is well chosen and explained, and the reasoning connects to the essential question.' },
  { score: 7, label: 'Exemplary', text: 'An insightful claim of the student’s own. Evidence is analyzed (word choice, craft, patterns), not just explained, and the response deepens the essential question.' }
];
var NV_COMPLETE_RUBRIC = {
  evidence: { complete: 'At least three evidence cards, each with a location and a sentence on why it matters.', incomplete: 'Fewer than three cards, or cards with no location or no explanation.' },
  discussion: { complete: 'A post that answers the question using the book, plus a reply that builds on a classmate’s idea.', incomplete: 'No post, a post with no reference to the book, or no reply.' },
  close: { complete: 'A short passage with its location, and an analysis of one specific choice the author made and what it does.', incomplete: 'No passage or location, or a summary instead of an analysis.' },
  vocab: { complete: 'Every word has its location, its meaning in that sentence, and why the author chose it.', incomplete: 'Missing words, locations, or meanings copied from a dictionary without the context.' },
  text: { complete: 'Does everything the directions ask, with specific evidence from the book.', incomplete: 'Missing, off the prompt, or no reference to the book.' }
};
/** Points-based activities are marked Complete (full) / Partial (half) / Incomplete (0), or any score in the box. */
function nvCompleteRubric_(a) { return NV_COMPLETE_RUBRIC[nvActForm_(a)] || NV_COMPLETE_RUBRIC.text; }

// ---------- the data every grading view is built from (one read per tab) ----------

function nvGradeData_(classId) {
  var roster = nvRoster_(classId), inClass = {};
  roster.forEach(function (s) { inClass[s.email] = true; });
  var work = {}, quiz = {}, disc = {}, grades = {};
  nvReadColumns_(nvSheet_('Work'), ['ClassId', 'Email', 'Week', 'Kind', 'SubmittedAt', 'SubFp', 'UpdatedAt']).forEach(function (r) {
    if (String(r.ClassId) !== String(classId)) return;
    var e = nvNorm_(r.Email); if (!inClass[e]) return;
    work[e + '|' + nvItemKey_(r.Week, r.Kind)] = { submittedAt: nvIso_(r.SubmittedAt), fp: String(r.SubFp || ''), updatedAt: nvIso_(r.UpdatedAt), row: r._row };
  });
  nvReadColumns_(nvSheet_('Quiz'), ['ClassId', 'Email', 'Week', 'Score', 'Max', 'StartedAt', 'SubmittedAt', 'ActId']).forEach(function (r) {
    if (String(r.ClassId) !== String(classId)) return;
    var e = nvNorm_(r.Email); if (!inClass[e]) return;
    quiz[e + '|' + nvItemKey_(r.Week, r.ActId || 'quiz')] = { submittedAt: nvIso_(r.SubmittedAt), startedAt: nvIso_(r.StartedAt), score: r.SubmittedAt ? Number(r.Score) : null, max: Number(r.Max) || 0 };
  });
  var dsh = nvSheet_('Discuss');
  nvReadRows_(dsh, nvFindRowNums_(dsh, 'ClassId', classId)).forEach(function (r) {
    var e = nvNorm_(r.Email); if (!inClass[e] || !String(r.Text || '').trim()) return;
    var k = e + '|' + nvItemKey_(r.Week, r.ActId || 'discussion');
    (disc[k] = disc[k] || []).push({ id: String(r.PostId), parentId: String(r.ParentId || ''), text: nvCellText_(r.Text), createdAt: nvIso_(r.CreatedAt), editedAt: nvIso_(r.EditedAt) });
  });
  var gsh = nvSheet_('Grades');
  nvReadRows_(gsh, nvFindRowNums_(gsh, 'ClassId', classId)).forEach(function (r) {
    var e = nvNorm_(r.Email);
    grades[e + '|' + r.ItemKey] = { score: r.Score === '' || r.Score == null ? null : Number(r.Score), excluded: nvTruthy_(r.Excluded), comment: nvCellText_(r.Comment),
      gradedAt: nvIso_(r.GradedAt), gradedBy: nvCellText_(r.GradedBy), markedFp: String(r.MarkedFp || ''), postedScore: nvCellText_(r.CanvasPostedScore), commentFp: String(r.CanvasCommentFp || ''), row: r._row };
  });
  return { roster: roster, work: work, quiz: quiz, disc: disc, grades: grades };
}
function nvDiscFp_(posts) {
  if (!posts || !posts.length) return NV_BLANK_FP;
  return nvFp_(nvStable_(posts.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).map(function (p) { return { p: p.parentId ? 1 : 0, t: p.text }; })));
}
/** One student, one item: everything the tile, the marking screen, the gradebook and Canvas agree on. */
function nvCellState_(data, settings, item, email) {
  var k = email + '|' + item.key, g = data.grades[k] || {};
  var classOff = !!(settings.noGrade || {})[item.key];
  var o = { email: email, key: item.key, excluded: !!g.excluded || classOff, studentExcluded: !!g.excluded, classExcluded: classOff, score: null, submitted: false, started: false, fp: NV_BLANK_FP, grade: g };
  if (item.kind === 'quiz') {
    var q = data.quiz[k] || {};
    o.started = !!q.startedAt; o.submitted = !!q.submittedAt; o.score = o.submitted ? q.score : null; o.max = q.max || item.max;
    o.handled = o.excluded || o.submitted; o.toGrade = false; o.redo = false;
    return o;
  }
  if (item.kind === 'discussion') {
    var posts = data.disc[k] || [];
    o.submitted = posts.length > 0; o.started = o.submitted; o.fp = nvDiscFp_(posts); o.posts = posts.length;
  } else {
    var w = data.work[k] || {};
    o.submitted = !!w.submittedAt; o.started = o.submitted || !!w.updatedAt; o.fp = w.fp || NV_BLANK_FP;
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
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var s = nvStudyOf_(ctx.klass.ClassId);
  if (!s || !s.book || s._unreadable) return { ok: true, groups: [], drafts: [], needsGradingTotal: 0, needsRegradeTotal: 0, students: nvRoster_(ctx.klass.ClassId).length };
  return Object.assign({ ok: true }, nvHubModel_(ctx.klass.ClassId, ctx.settings, s));
}
function nvHubModel_(classId, settings, s) {
  var data = nvGradeData_(classId), items = nvItems_(s), groups = {}, order = [], total = data.roster.length, needs = 0, redos = 0;
  var links = (settings.canvas || {}).assignments || {};
  items.forEach(function (it) {
    var t = { key: it.key, week: it.week, kind: it.kind, actType: it.actType, icon: it.icon, label: it.label, kindLabel: it.kindLabel, max: it.max, type: it.type,
      totalItems: total, graded: 0, needsGrading: 0, needsRegrade: 0, fresh: 0, answered: 0,
      allExcluded: !!(settings.noGrade || {})[it.key], released: nvReleased_(settings, it.key), due: (settings.due || {})[it.key] || '', firstToMark: '' };
    var first = '', firstRedo = '';
    data.roster.forEach(function (st) {
      var c = nvCellState_(data, settings, it, st.email);
      if (it.kind === 'quiz' && c.submitted) t.answered++;
      if (c.redo) { t.needsRegrade++; if (!firstRedo) firstRedo = st.email; }
      else if (c.toGrade) { t.fresh++; if (!first) first = st.email; }
      if (c.handled && !c.redo) t.graded++;
    });
    t.needsGrading = t.allExcluded ? 0 : t.fresh + t.needsRegrade;
    if (t.allExcluded) { t.needsRegrade = 0; t.fresh = 0; }
    t.firstToMark = firstRedo || first;
    var link = links[it.key] || {};
    t.canvas = { linked: !!link.assignmentId, lastPushAt: link.lastPushAt || '', htmlUrl: link.htmlUrl || '' };
    needs += t.needsGrading; redos += t.needsRegrade;
    if (!groups[it.week]) { var u = s.units[it.week - 1] || {}; groups[it.week] = { week: it.week, unitLabel: it.unitLabel, title: u.title || '', reading: (u.reading || {}).label || '', date: u.date || '', items: [] }; order.push(it.week); }
    groups[it.week].items.push(t);
  });
  var drafts = [];
  for (var n = 1; n <= nvUnitCount_(s); n++) if ((s.units[n - 1] || {}).status !== 'approved') drafts.push(n);
  return { groups: order.map(function (w) { return groups[w]; }), drafts: drafts, unitWord: nvUnitWord_(s), needsGradingTotal: needs, needsRegradeTotal: redos, students: total, countedAt: new Date().toISOString() };
}

// ---------- marking screens ----------

function getMarking(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var classId = ctx.klass.ClassId, s = nvRequireStudy_(classId), ik = nvParseItemKey_(payload.itemKey), u = nvUnit_(s, ik.week);
  if (!u || u.status !== 'approved') throw new Error('That ' + nvUnitWord_(s).toLowerCase() + ' isn’t approved yet.');
  var item = nvItems_(s).filter(function (x) { return x.key === ik.key; })[0];
  if (!item) throw new Error('That activity isn’t graded (or isn’t in this ' + nvUnitWord_(s).toLowerCase() + ' any more).');
  var a = (u.activities || []).filter(function (x) { return x.id === ik.act; })[0], form = item.kind;
  var data = nvGradeData_(classId), settings = ctx.settings, rows = [];
  var full = {};
  if (['quiz', 'discussion'].indexOf(form) < 0) {
    data.roster.forEach(function (st) {
      var r = nvWorkRow_(classId, st.email, ik.week, ik.act); if (!r) return;
      var sub = nvParseChunks_(r, 'SubJson', 3), draft = nvParseChunks_(r, 'DataJson', 3);
      full[st.email] = { sub: sub, draft: draft, draftFp: nvFp_(nvStable_(nvWorkPayload_(draft))), submittedAt: nvIso_(r.SubmittedAt), updatedAt: nvIso_(r.UpdatedAt) };
    });
  }
  var quizRows = {};
  if (form === 'quiz') data.roster.forEach(function (st) { var r = nvQuizRow_(classId, st.email, ik.week, ik.act); if (r) quizRows[st.email] = nvParse_(r.AnswersJson, {}) || {}; });
  var stats = {};
  if (form !== 'quiz' && form !== 'discussion') {
    var wsh = nvSheet_('WritingStats');
    nvReadRows_(wsh, nvFindRowNums_(wsh, 'ItemKey', ik.key)).forEach(function (r) { if (String(r.ClassId) === String(classId)) stats[nvNorm_(r.Email)] = nvParse_(r.StatsJson, {}) || {}; });
  }
  var names = {}; data.roster.forEach(function (st) { names[st.email] = st.name; });
  var allPosts = form === 'discussion' ? nvDiscussionFor_(classId, ik.week, ik.act, '', true).posts : [];
  var postById = {}; allPosts.forEach(function (p) { postById[p.id] = p; });
  data.roster.forEach(function (st) {
    var c = nvCellState_(data, settings, item, st.email), row = { email: st.email, name: st.name, demo: st.demo, cell: c, grade: c.grade };
    delete c.grade;
    if (form === 'quiz') {
      var ans = quizRows[st.email] || {};
      row.work = { answers: (a.mc || []).map(function (q) { var x = ans[q.id] || { tries: [], state: 'open', points: 0 }; return { id: q.id, tries: x.tries, state: x.state, points: x.points }; }) };
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
        row.editsAfterSubmit = !!f.submittedAt && f.draftFp !== c.fp && nvHasWriting_(f.draft);
        row.submittedAt = f.submittedAt; row.updatedAt = f.updatedAt;
        row.hasDraft = showDraft && nvHasWriting_(f.draft);
        row.unreadable = !!(row.work && row.work._unreadable);
      }
      row.stats = stats[st.email] || {};
    }
    if (!row.viewFp) row.viewFp = c.fp;
    rows.push(row);
  });
  var content = { reading: (u.reading || {}).label || '', eq: u.eq, title: u.title, prompt: a.prompt, directions: a.directions || [], minWords: a.minWords || 0, words: a.words || [], focus: u.focus || [], actType: a.type };
  if (form === 'quiz') content.mc = a.mc;
  return { ok: true, item: item, content: content, rows: rows, rubric: item.type === 'rubric' ? NV_RUBRIC : null, complete: item.type === 'points' ? nvCompleteRubric_(a) : null,
    highlightKey: s.highlightKey || [], classExcluded: !!(settings.noGrade || {})[ik.key], released: nvReleased_(settings, ik.key),
    weekItems: nvItems_(s).filter(function (x) { return x.week === ik.week; }), loadedAt: new Date(Date.now() - 1500).toISOString() };
}

/**
 * One teacher action on one student's item. payload: {classId, itemKey, email, score?, excluded?,
 * comment?, prevComment?, markedFp?}. score: a number (0..max, halves allowed) or null to clear.
 * A comment save sends the comment this screen last saw (prevComment); if the sheet now holds
 * something else (another tab, a co-teacher), nothing is saved and the current one comes back.
 */
function saveGrade(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var classId = ctx.klass.ClassId, s = nvRequireStudy_(classId), ik = nvParseItemKey_(payload.itemKey);
  var item = nvItems_(s).filter(function (x) { return x.key === ik.key; })[0];
  if (!item) throw new Error('That assignment isn’t in this study any more.');
  var email = nvNorm_(payload.email);
  if (!nvEnrollment_(classId, email)) throw new Error('That student is not in this class.');
  var hasScore = Object.prototype.hasOwnProperty.call(payload, 'score'), hasEx = typeof payload.excluded === 'boolean', hasComment = typeof payload.comment === 'string';
  var score = null;
  if (hasScore) {
    if (item.kind === 'quiz') throw new Error('The quiz scores itself. You can only exclude it.');
    if (payload.score !== null && payload.score !== '') {
      score = Number(payload.score);
      if (!isFinite(score) || score < 0 || score > item.max || Math.round(score * 2) !== score * 2) throw new Error('Scores go from 0 to ' + item.max + ' (halves allowed).');
    }
  }
  var out = null;
  nvRowCritical_(function () {
    nvUpsert_('Grades', 'Email', { ClassId: classId, Email: email, ItemKey: ik.key }, function (r, now) {
      var curComment = r ? nvCellText_(r.Comment) : '';
      if (hasComment && String(payload.prevComment == null ? '' : payload.prevComment) !== curComment && payload.force !== true) {
        out = { ok: false, conflict: true, current: curComment }; return null;
      }
      var f = {};
      if (hasScore) { f.Score = score === null ? '' : score; f.MarkedFp = String(payload.markedFp || ''); f.GradedBy = ctx.teacher.email; f.GradedAt = now; }
      if (hasEx) { f.Excluded = payload.excluded; f.GradedBy = ctx.teacher.email; f.GradedAt = now; }
      if (hasComment) { f.Comment = nvClean_(payload.comment, 6000); }
      if (!r) { f.CanvasPostedScore = ''; f.CanvasCommentFp = ''; }
      var merged = Object.assign({}, r || {}, f);
      out = { ok: true, grade: { score: merged.Score === '' || merged.Score == null ? null : Number(merged.Score), excluded: nvTruthy_(merged.Excluded), comment: nvCellText_(merged.Comment), markedFp: String(merged.MarkedFp || ''), gradedAt: nvIso_(merged.GradedAt) } };
      return f;
    });
  });
  return out;
}

// ---------- class-wide switches ----------

function setRelease(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), on = payload.on === true, keys;
  if (payload.week) {
    var st0 = nvRequireStudy_(ctx.klass.ClassId), u = nvUnit_(st0, payload.week);
    if (!u) throw new Error('That ' + nvUnitWord_(st0).toLowerCase() + ' isn’t in this study.');
    keys = (u.activities || []).map(function (a) { return nvItemKey_(u.n || payload.week, a.id); }).concat([nvItemKey_(payload.week, '_read')]);
  } else keys = [nvParseItemKey_(payload.itemKey).key];
  // Off is stored as false (not deleted), so a day that opens on its date can still be held back.
  var s = nvUpdateSettings_(ctx.klass.ClassId, function (st) { keys.forEach(function (k) { st.release[k] = on; }); });
  return { ok: true, release: s.release, openOn: s.openOn || {} };
}
function setNoGrade(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), key = nvParseItemKey_(payload.itemKey).key, on = payload.on === true;
  // Scores already entered are kept either way.
  var s = nvUpdateSettings_(ctx.klass.ClassId, function (st) { if (on) st.noGrade[key] = true; else delete st.noGrade[key]; });
  return { ok: true, noGrade: s.noGrade };
}

// ---------- gradebook ----------

function getGradebook(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId;
  var s = nvStudyOf_(classId);
  if (!s || !s.book || s._unreadable) return { ok: true, items: [], students: [] };
  var items = nvItems_(s), data = nvGradeData_(classId), settings = ctx.settings;
  var students = data.roster.map(function (st) {
    var cells = {}, earned = 0, possible = 0, unmarked = false;
    items.forEach(function (it) {
      var c = nvCellState_(data, settings, it, st.email), cell;
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
  return { ok: true, unitWord: nvUnitWord_(s), items: items.map(function (it) { return { key: it.key, week: it.week, kind: it.kind, actType: it.actType, icon: it.icon, kindLabel: it.kindLabel, label: it.label, unitLabel: it.unitLabel, max: it.max, type: it.type, released: nvReleased_(settings, it.key) }; }), students: students };
}

// ---------- the teacher dashboard in one call ----------

function getTeacherDashboard(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || '')), classId = ctx.klass.ClassId;
  var s = nvStudyOf_(classId) || nvEmptyStudy_();
  var roster = nvRoster_(classId);
  var progress = {};
  var psh = nvSheet_('Progress');
  nvReadRows_(psh, nvFindRowNums_(psh, 'ClassId', classId)).forEach(function (r) { progress[nvNorm_(r.Email)] = { borrowedAt: nvIso_(r.BorrowedAt), weeks: nvParse_(r.ReadingJson, {}) || {} }; });
  var out = { ok: true, klass: nvPublicClass_(ctx.klass, true), settings: ctx.settings, study: nvTeacherStudy_(s), roster: roster, progress: progress, access: NV_ACCESS, colors: NV_COLORS, choices: nvChoices_(), today: nvToday_(),
    canvas: nvCanvasStatus_(ctx.teacher.email), lmsHub: lmsHubEnabled_(), aiConfigured: !!PropertiesService.getScriptProperties().getProperty(NV_GEMINI_PROP), serverNow: new Date().toISOString() };
  if (s.book && !s._unreadable) { out.hub = nvHubModel_(classId, ctx.settings, s); out.gradebook = getGradebook({ classId: classId }); out.standards = nvStandardsPayload_(s); }
  return out;
}
