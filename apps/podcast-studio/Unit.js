// ============================================================================
// Podcast Studio -- the unit (from PodcastData.js) and everything a student does: lessons,
// fill-in forms (logs, plans, scripts, links), the parts quiz, discussions.
// Every class runs the same unit; what differs per class lives in class settings (release,
// due dates, "don't grade", Canvas, the Canva template links).
// ============================================================================

// ---------- the unit as a "study" (the shape the grading and Canvas code read) ----------

var PC_FORMS = { lesson: true, fields: true, quiz: true, discussion: true };
function pcStudyOf_(classId) {
  if (pcStudyOf_._cache) return pcStudyOf_._cache;
  var units = PC_UNIT.map(function (u) {
    var x = JSON.parse(JSON.stringify(u));
    x.status = 'approved'; x.reading = { label: '' }; x.focus = [];
    x.activities.forEach(function (a) { if (!PC_FORMS[a.form]) a.form = 'fields'; a.type = a.form; a.graded = a.form !== 'lesson'; });
    return x;
  });
  pcStudyOf_._cache = { v: 2, book: { title: PC_UNIT_TITLE }, structure: 'weekly', unitCount: units.length, units: units };
  return pcStudyOf_._cache;
}
function pcRequireStudy_(classId) { return pcStudyOf_(classId); }
function pcEmptyStudy_() { return pcStudyOf_(''); }
function pcUnitWord_(s) { return 'Week'; }
function pcUnitLabel_(s, n) { return 'Week ' + n; }
function pcUnitCount_(s) { return s.units.length; }
function pcUnit_(s, n) { n = Number(n); return n >= 1 && n <= pcUnitCount_(s) ? s.units[n - 1] : null; }
function pcToday_() { try { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Pacific/Honolulu', 'yyyy-MM-dd'); } catch (e) { return new Date().toISOString().slice(0, 10); } }
/** What the teacher dashboard needs to draw the Release card (no answer keys). */
function pcTeacherStudy_(s) {
  return { title: PC_UNIT_TITLE, units: s.units.map(function (u) {
    return { n: u.n, label: 'Week ' + u.n, title: u.title, eq: u.eq, activities: u.activities.map(function (a) {
      return { id: a.id, form: a.form, icon: a.icon || '', title: a.title, graded: a.graded, points: pcActMax_(a), gradeType: pcGradeType_(a) };
    }) };
  }) };
}

// ---------- items (one per graded activity) and release ----------

function pcItemKey_(n, actId) { return 'w' + Number(n) + '_' + actId; }
function pcParseItemKey_(key) {
  var m = /^w(\d+)_([A-Za-z0-9_-]{1,40})$/.exec(String(key || ''));
  if (!m) throw new Error('Unknown assignment.');
  return { week: Number(m[1]), act: m[2], key: String(key) };
}
function pcActForm_(a) { return a.form; }
function pcCriteriaMax_() { return PC_FINAL_RUBRIC.reduce(function (n, c) { return n + (Number(c.max) || 0); }, 0); }
function pcActMax_(a) {
  if (a.form === 'lesson') return 0;
  if (a.form === 'quiz') return (a.mc || []).length;
  if (a.criteria) return pcCriteriaMax_();
  return Number(a.points) || 0;
}
function pcGradeType_(a) {
  if (a.form === 'quiz') return 'auto';
  if (a.criteria) return 'criteria';
  if (a.rubric && PC_RUBRICS[a.rubric]) return 'rubric';
  return 'points';
}
function pcRubricOf_(a) { return a && a.rubric && PC_RUBRICS[a.rubric] ? PC_RUBRICS[a.rubric] : null; }
var PC_DEFAULT_COMPLETE = { complete: 'Does everything the directions ask, with specifics from your own work.', incomplete: 'Missing parts, or off the prompt.' };
function pcCompleteRubric_(a) { return (a && a.complete) || PC_DEFAULT_COMPLETE; }
/** Every graded activity, in tile order. */
function pcItems_(s) {
  var out = [];
  s.units.forEach(function (u) {
    (u.activities || []).forEach(function (a) {
      if (!a.graded || !pcActMax_(a)) return;
      out.push({ key: pcItemKey_(u.n, a.id), week: u.n, act: a.id, actType: a.id, kind: a.form, type: pcGradeType_(a), max: pcActMax_(a),
        label: 'Week ' + u.n + ' · ' + a.title, kindLabel: a.title, unitLabel: 'Week ' + u.n, icon: a.icon || '', weekTitle: u.title || '' });
    });
  });
  return out;
}
/** Open only when the teacher turned it on (explicit false = held back). */
function pcReleased_(settings, key) { return (settings.release || {})[key] === true; }

// ============================================================================
// STUDENT: home, items, saving
// ============================================================================

/** What a student may see of a week: no answer keys. Lessons carry their full content. */
function pcStudentUnit_(s, u, settings, teacherSelf) {
  var open = {}, due = {}, noGrade = {}, any = false;
  (u.activities || []).forEach(function (a) { var k = pcItemKey_(u.n, a.id); open[a.id] = pcReleased_(settings, k); due[a.id] = (settings.due || {})[k] || ''; noGrade[a.id] = !!(settings.noGrade || {})[k]; if (open[a.id]) any = true; });
  if (!any && !teacherSelf) return null;
  return { n: u.n, label: 'Week ' + u.n, title: u.title, eq: u.eq, summary: u.summary || '', anyOpen: any, open: open, due: due, noGrade: noGrade,
    activities: (u.activities || []).map(function (a) {
      var o = { id: a.id, form: a.form, icon: a.icon || '', title: a.title, prompt: a.prompt || '', graded: !!a.graded, points: pcActMax_(a), gradeType: pcGradeType_(a), mcCount: (a.mc || []).length };
      if (a.form === 'lesson') { o.sections = a.sections || []; o.parts = !!a.parts; }
      if (a.form === 'fields') { o.fields = a.fields || []; o.assignment = !!a.assignment; }
      return o;
    }) };
}
function pcCanva_(settings) { return Object.assign({}, PC_CANVA_DEFAULTS, settings.canva || {}); }
function getStudentHome(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, false);
  var settings = pcSettingsOf_(me.klass), s = pcStudyOf_(classId);
  var out = { ok: true, serverNow: new Date().toISOString(), today: pcToday_(), klass: pcPublicClass_(me.klass, false),
    me: { email: me.email, name: me.name, readOnly: !!me.readOnly, demo: !!me.demo, teacherSelf: !!me.teacherSelf },
    unitTitle: PC_UNIT_TITLE, units: [], status: {}, grades: {}, resume: null, library: PC_LIBRARY, parts: PC_PARTS, canva: pcCanva_(settings),
    processAssignment: PC_PROCESS_ASSIGNMENT, finalRubric: PC_FINAL_RUBRIC, show: null };
  s.units.forEach(function (u) { var su = pcStudentUnit_(s, u, settings, me.teacherSelf); if (su) out.units.push(su); });
  out.status = pcStudentStatus_(classId, me.email);
  out.grades = pcStudentGrades_(classId, me.email);
  out.resume = pcResumeOf_(classId, me.email);
  out.show = pcShowOf_(classId, me.email);
  return out;
}
/** The student's show (name, tagline, crew) from their Show Concept, for the home page banner. */
function pcShowOf_(classId, email) {
  try {
    var r = pcWorkRow_(classId, email, 2, 'concept'); if (!r) return null;
    var d = pcParseChunks_(r, 'DataJson', 3); if (d._unreadable) return null;
    var f = d.f || {};
    return f.name ? { name: String(f.name), tagline: String(f.tagline || ''), crew: String(f.crew || ''), members: String(f.members || '') } : null;
  } catch (e) { return null; }
}
/** Per item: none | draft | submitted (+ edited: turned in, then changed and not turned in again). */
function pcStudentStatus_(classId, email) {
  var out = {}, sh = pcSheet_('Work');
  pcReadRows_(sh, pcFindRowNums_(sh, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) {
    var key = pcItemKey_(r.Week, r.Kind), d = pcParseChunks_(r, 'DataJson', 3), has = pcHasWriting_(d), sub = !!r.SubmittedAt;
    var edited = sub && pcFp_(pcStable_(pcWorkPayload_(d))) !== String(r.SubFp || '');
    out[key] = { state: sub ? 'submitted' : (has ? 'draft' : 'none'), submittedAt: pcIso_(r.SubmittedAt), updatedAt: pcIso_(r.UpdatedAt), edited: edited && has };
  });
  var qs = pcSheet_('Quiz');
  pcReadRows_(qs, pcFindRowNums_(qs, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) {
    out[pcItemKey_(r.Week, r.ActId || 'quiz')] = { state: r.SubmittedAt ? 'submitted' : (r.StartedAt ? 'draft' : 'none'), score: r.SubmittedAt ? Number(r.Score) : null, max: Number(r.Max) || null, submittedAt: pcIso_(r.SubmittedAt) };
  });
  var ds = pcSheet_('Discuss');
  pcReadRows_(ds, pcFindRowNums_(ds, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId) && String(r.Text || '').trim(); }).forEach(function (r) {
    var key = pcItemKey_(r.Week, r.ActId || 'discussion'), o = out[key] || { state: 'none', posts: 0, replies: 0 };
    o.state = 'submitted'; if (r.ParentId) o.replies = (o.replies || 0) + 1; else o.posts = (o.posts || 0) + 1;
    out[key] = o;
  });
  return out;
}
function pcGradeOut_(r) {
  return { score: r.Score === '' || r.Score == null ? null : Number(r.Score), excluded: pcTruthy_(r.Excluded), comment: pcCellText_(r.Comment), gradedAt: pcIso_(r.GradedAt), criteria: pcParse_(r.CriteriaJson, {}) || {} };
}
function pcStudentGrades_(classId, email) {
  var out = {}, sh = pcSheet_('Grades');
  pcReadRows_(sh, pcFindRowNums_(sh, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) { out[String(r.ItemKey)] = pcGradeOut_(r); });
  return out;
}
function pcHasWriting_(v, depth) {
  depth = depth || 0;
  if (depth > 10 || v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v !== 'object') return false;
  return Object.keys(v).some(function (k) { return k.charAt(0) !== '_' && k !== 'id' && pcHasWriting_(v[k], depth + 1); });
}
/** Only the parts of a student's work the teacher grades (so bookkeeping never looks like a redo). */
function pcWorkPayload_(d) {
  d = d || {};
  var out = {};
  if (d.f && typeof d.f === 'object') {
    var f = {};
    Object.keys(d.f).sort().forEach(function (k) {
      var v = d.f[k];
      if (Array.isArray(v)) { v = v.filter(function (row) { return row && Object.keys(row).some(function (c) { return String(row[c] || '').trim(); }); }); if (v.length) f[k] = v; }
      else if (v !== undefined && String(v).trim() !== '') f[k] = v;
    });
    out.f = f;
  }
  return out;
}
/** Typing is never cut short silently: a box over its limit refuses the save with a plain message. */
function pcLimit_(v, n, label) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (s.length > n) throw new Error(label + ' is too long to save (' + s.length.toLocaleString() + ' characters; the limit is ' + n.toLocaleString() + '). Please shorten it. Nothing was changed.');
  return s;
}
var PC_FIELD_LIMITS = { long: 60000, short: 400, link: 800, choice: 200, episode: 800 };
/** Cleans a fields-form save. Known fields are checked by their kind; anything else is kept (cleaned)
 *  so a change to the unit's data never throws away writing a student already did. */
function pcCleanWork_(a, data, strict) {
  data = data || {};
  if (a.form !== 'fields') throw new Error('This activity isn’t saved this way.');
  var inF = data.f && typeof data.f === 'object' ? data.f : {}, spec = {}, out = {};
  (a.fields || []).forEach(function (fd) { spec[fd.id] = fd; });
  Object.keys(inF).slice(0, 60).forEach(function (id) {
    var fd = spec[id] || { kind: Array.isArray(inF[id]) ? 'rows' : 'long', label: id }, v = inF[id], label = '“' + (fd.label || id) + '”';
    if (Array.isArray(v)) {
      var rows = Array.isArray(v) ? v : [];
      if (rows.length > 40) throw new Error(label + ' holds up to 40 rows. Remove a few, then save again. Nothing was changed.');
      out[id] = rows.map(function (row, i) {
        var o = {}; row = row || {};
        Object.keys(row).slice(0, 8).forEach(function (c) { o[String(c).slice(0, 20)] = pcLimit_(row[c], 4000, label + ' row ' + (i + 1)); });
        return o;
      });
      return;
    }
    var s = pcLimit_(v, PC_FIELD_LIMITS[fd.kind] || 60000, label);
    // A link is only checked when the work is turned in: a half-typed link must never stop a draft from saving.
    if (strict && fd.kind === 'link' && s.trim() && !/^https?:\/\//i.test(s.trim())) throw new Error(label + ' must be a link that starts with https:// (copy it from Canva: Share → View-only link). Your work is saved; fix the link, then turn it in.');
    out[id] = s;
  });
  return { f: out };
}
/** The week and activity a student call is about; refuses what isn't open (a teacher's own view sees all). */
function pcOpenAct_(me, n, actId) {
  var s = pcStudyOf_(me.klass.ClassId), u = pcUnit_(s, n);
  if (!u) throw new Error('This isn’t ready yet.');
  var a = (u.activities || []).filter(function (x) { return x.id === String(actId); })[0];
  if (!a) throw new Error('That activity isn’t in this week any more. Reload the page.');
  var settings = pcSettingsOf_(me.klass), key = pcItemKey_(n, a.id);
  if (!pcReleased_(settings, key) && !me.teacherSelf) throw new Error('Your teacher hasn’t opened this yet. Anything you already wrote is kept.');
  return { study: s, unit: u, act: a, form: a.form, settings: settings, key: key, n: Number(n) };
}
function pcWorkRow_(classId, email, n, actId) { return pcFindOne_('Work', 'Email', { ClassId: classId, Email: email, Week: n, Kind: actId }); }

function getStudentItem(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, false);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act);
  var out = { ok: true, key: it.key, form: it.form, act: it.act.id, week: n, loadedAt: new Date(Date.now() - 1500).toISOString(), readOnly: !!me.readOnly };
  if (it.form === 'lesson') return out;
  if (it.form === 'quiz') out.quiz = pcQuizForStudent_(classId, me.email, n, it.act);
  else if (it.form === 'discussion') out.discussion = pcDiscussionFor_(classId, n, it.act.id, me.email, false);
  else {
    var r = pcWorkRow_(classId, me.email, n, it.act.id), d = pcParseChunks_(r, 'DataJson', 3);
    out.data = d._unreadable ? null : d; out.unreadable = !!d._unreadable;
    out.updatedAt = r ? pcIso_(r.UpdatedAt) : ''; out.submittedAt = r ? pcIso_(r.SubmittedAt) : '';
    out.subFp = r ? String(r.SubFp || '') : ''; out.fp = pcFp_(pcStable_(pcWorkPayload_(d)));
    out.stats = pcStatsOf_(classId, me.email, it.key);
  }
  out.grade = pcStudentGrades_(classId, me.email)[it.key] || null;
  out.excludedForClass = !!(it.settings.noGrade || {})[it.key];
  var gt = pcGradeType_(it.act);
  if (gt === 'rubric') out.rubric = pcRubricOf_(it.act);
  else if (gt === 'criteria') out.criteria = PC_FINAL_RUBRIC;
  else if (gt === 'points') out.complete = pcCompleteRubric_(it.act);
  return out;
}

/** Back up the old copy before it's replaced, when the replacement could lose something. Never throws. */
function pcBackup_(classId, email, n, kind, prevJson, nextJson, force) {
  try {
    prevJson = String(prevJson || '');
    if (!prevJson || prevJson === '{}') return false;
    var parsed = null, unreadable = false;
    try { parsed = JSON.parse(prevJson); } catch (e) { unreadable = true; }
    if (!unreadable && !pcHasWriting_(parsed)) return false;
    var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) {}
    var ck = 'pcbk:' + String(classId).slice(0, 8) + ':' + pcMd5_(email).slice(0, 10) + ':' + n + ':' + kind;
    var reason = force || (unreadable ? 'unreadable' : '');
    if (!reason && String(nextJson || '').length < prevJson.length * 0.8) reason = 'shorter';
    if (!reason) { var seen = null; try { seen = cache && cache.get(ck); } catch (e) {} if (!seen) reason = 'periodic'; }
    if (!reason) return false;
    var row = { ClassId: classId, Email: email, Week: n, Kind: kind, SavedAt: new Date(), Reason: reason, Chars: prevJson.length };
    var parts = pcSplit_('DataJson', 3, prevJson); Object.keys(parts).forEach(function (k) { row[k] = parts[k]; });
    pcAppend_(pcSheet_('WorkBackups'), row);
    try { if (cache && !force) cache.put(ck, '1', 600); } catch (e) {}
    return true;
  } catch (e) { try { console.warn('pcBackup_ failed: ' + (e && e.message)); } catch (e2) {} return false; }
}

/**
 * Autosave and Turn in. payload: {classId, week, act, data, base, submit, as}
 * base = the newest server time this tab has seen for this item. If the stored copy is newer, nothing
 * is written: {ok:false, stale:true, serverAt, server} -- and the newer copy is backed up first.
 */
function saveWork(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act);
  if (it.form !== 'fields') throw new Error('This activity isn’t saved this way.');
  var data = pcCleanWork_(it.act, payload.data, payload.submit === true), json = JSON.stringify(data), actId = it.act.id;
  if (json.length > PC_CHUNK * 3) throw new Error('This is too long to save (' + Math.round(json.length / 1000) + 'k characters). Please shorten it. Nothing was changed.');
  var submit = payload.submit === true, base = String(payload.base || ''), result = null;
  pcUserLock_(function () {
    pcUpsert_('Work', 'Email', { ClassId: classId, Email: me.email, Week: n, Kind: actId }, function (r, now) {
      if (r) {
        var prev = pcParseChunks_(r, 'DataJson', 3), prevJson = pcJoin_(r, 'DataJson', 3);
        if (prev._unreadable) {
          pcBackup_(classId, me.email, n, actId, prevJson, json, 'unreadable');
          throw new Error('Your saved copy of this could not be read, so nothing was saved over it. Tell your teacher. (Your writing is still on this screen.)');
        }
        if (pcLater_(r.UpdatedAt, base) || (!base && pcHasWriting_(prev) && prevJson !== json)) {
          pcBackup_(classId, me.email, n, actId, prevJson, json, 'conflict');
          result = { ok: false, stale: true, serverAt: pcIso_(r.UpdatedAt), server: prev, submittedAt: pcIso_(r.SubmittedAt) };
          return null;
        }
        pcBackup_(classId, me.email, n, actId, prevJson, json, '');
      }
      var f = pcSplit_('DataJson', 3, json);
      f.UpdatedAt = now;
      if (submit) { Object.assign(f, pcSplit_('SubJson', 3, json)); f.SubmittedAt = now; f.SubFp = pcFp_(pcStable_(pcWorkPayload_(data))); }
      result = { ok: true, savedAt: now.toISOString(), submittedAt: submit ? now.toISOString() : (r ? pcIso_(r.SubmittedAt) : ''), subFp: submit ? f.SubFp : (r ? String(r.SubFp || '') : '') };
      return f;
    });
  });
  if (result && result.ok) result.fp = pcFp_(pcStable_(pcWorkPayload_(data)));
  return result;
}
function keepWorkCopy(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act);
  var json = JSON.stringify(pcCleanWork_(it.act, payload.data));
  return { ok: pcBackup_(classId, me.email, n, it.act.id, json, '', String(payload.reason || 'kept-copy').slice(0, 30)) };
}

// ---------- writing stats (apart from the work: a stats save can never block a work save) ----------

function pcStatsOf_(classId, email, key) {
  var r = pcFindOne_('WritingStats', 'Email', { ClassId: classId, Email: email, ItemKey: key });
  return r ? (pcParse_(r.StatsJson, {}) || {}) : {};
}
function saveWritingStats(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me;
  try { me = pcActing_(classId, payload.as, true); } catch (e) { return { ok: true, skipped: true }; }
  if (!me.self && !me.demo) return { ok: true, skipped: true };
  var key = String(payload.key || ''); pcParseItemKey_(key);
  var inc = payload.stats || {};
  pcUserLock_(function () {
    pcUpsert_('WritingStats', 'Email', { ClassId: classId, Email: me.email, ItemKey: key }, function (r, now) {
      var cur = r ? (pcParse_(r.StatsJson, {}) || {}) : {};
      Object.keys(inc).slice(0, 60).forEach(function (box) {
        var a = cur[box] || {}, b = inc[box] || {};
        var pasted = (a.pasted || []).concat(b.pasted || []).map(function (p) { return pcClean_(p, 2000); }).filter(function (p, i, arr) { return p && arr.indexOf(p) === i; }).slice(-40);
        cur[box] = { ms: Math.max(Number(a.ms) || 0, Number(b.ms) || 0), sittings: Math.max(Number(a.sittings) || 0, Number(b.sittings) || 0),
          pastes: Math.max(Number(a.pastes) || 0, Number(b.pastes) || 0), pastedChars: Math.max(Number(a.pastedChars) || 0, Number(b.pastedChars) || 0),
          blocked: Math.max(Number(a.blocked) || 0, Number(b.blocked) || 0), pasted: pasted, last: Math.max(Number(a.last) || 0, Number(b.last) || 0),
          before: Math.max(Number(a.before) || 0, Number(b.before) || 0) };
      });
      var json = JSON.stringify(cur);
      if (json.length > PC_CELL_MAX) return null;
      return { StatsJson: json, UpdatedAt: now };
    });
  });
  return { ok: true };
}

// ---------- resume (a teacher's viewing never moves it) ----------

function pcResumeOf_(classId, email) {
  var r = pcFindOne_('Resume', 'Email', { ClassId: classId, Email: email });
  return r ? pcParse_(r.RouteJson, null) : null;
}
function saveResume(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me;
  try { me = pcActing_(classId, payload.as, false); } catch (e) { return { ok: true, skipped: true }; }
  if (!me.self && !me.demo) return { ok: true, skipped: true };
  var route = payload.route || {};
  var clean = { view: ['home', 'week'].indexOf(route.view) >= 0 ? route.view : 'home', week: Math.max(0, Math.floor(Number(route.week) || 0)), step: pcClean_(route.step, 40) };
  pcUserLock_(function () { pcUpsert_('Resume', 'Email', { ClassId: classId, Email: me.email }, { RouteJson: JSON.stringify(clean), UpdatedAt: new Date() }); });
  return { ok: true };
}

// ============================================================================
// QUIZ (scored on the server: 1 point right the first try, 0.5 the second, 0 after)
//
// TRIES (2026-10-21a). A student may redo a check once they finish it: PC_QUIZ_TRIES tries in all
// (an activity can set `tries`), plus any the teacher gives ("Give another try"). The BEST counted
// try is the score (dashboard, gradebook, Canvas). The teacher can set a try aside ("Don't count":
// it leaves the score and doesn't use up a try; "Count again" undoes it). Nothing is ever deleted.
// Quiz row: AnswersJson = the current try; AttemptsJson = every finished try
// [{n, score, max, at, counted, setAsideBy, setAsideAt, answers}]; CurrentTry; ExtraTries.
// Score / SubmittedAt = the best counted try (blank when none counts), so every grading view,
// the gradebook and Canvas read the quiz exactly as before. A row from before tries existed reads
// as one finished, counted try. Try 1 keeps the order as written; later tries shuffle the
// questions and choices (the same order for that try on every reload).
// ============================================================================

var PC_QUIZ_TRIES = 2;
function pcQuizTries_(a) { var n = Math.floor(Number(a && a.tries)); return n >= 1 ? n : PC_QUIZ_TRIES; }
function pcQuizRow_(classId, email, n, actId) { return pcFindOne_('Quiz', 'Email', { ClassId: classId, Email: email, Week: n, ActId: actId }); }
/** Everything about one student's tries on one quiz, from its row (null = never opened). */
function pcQuizInfo_(r, a) {
  var max = (a.mc || []).length, ans = r ? (pcParse_(r.AnswersJson, {}) || {}) : {};
  var attempts = r ? pcParse_(r.AttemptsJson, null) : null;
  if (!Array.isArray(attempts)) {
    attempts = [];
    if (r && r.SubmittedAt) attempts.push({ n: 1, score: Number(r.Score) || 0, max: Number(r.Max) || max, at: pcIso_(r.SubmittedAt), counted: true, answers: ans });
  }
  var current = Math.max(1, Math.floor(Number(r && r.CurrentTry)) || 1);
  var done = attempts.some(function (x) { return Number(x.n) === current; });
  var counted = attempts.filter(function (x) { return x.counted !== false; });
  var best = null;
  counted.forEach(function (x) { if (!best || Number(x.score) > Number(best.score)) best = x; });
  var extra = Math.max(0, Math.floor(Number(r && r.ExtraTries)) || 0), allowed = pcQuizTries_(a) + extra;
  var started = Object.keys(ans).some(function (k) { return ans[k] && (ans[k].tries || []).length; });
  var used = counted.length + (done ? 0 : 1);   // the try in progress (or about to start) uses one
  return { answers: ans, attempts: attempts, current: current, done: done, started: started, counted: counted.length, best: best, extra: extra, allowed: allowed,
    triesLeft: Math.max(0, allowed - used), canRedo: done && counted.length < allowed, max: max };
}
/** Score/SubmittedAt for the row: the best counted try, or blank. */
function pcQuizTotals_(info) {
  var c = info.attempts.filter(function (x) { return x.counted !== false; }), best = null;
  c.forEach(function (x) { if (!best || Number(x.score) > Number(best.score)) best = x; });
  return best ? { Score: Number(best.score), SubmittedAt: new Date(best.at) } : { Score: '', SubmittedAt: '' };
}
function pcQuizAttemptsJson_(attempts) {
  var json = JSON.stringify(attempts);
  // A cell holds 50,000 characters: keep every try's score, drop the oldest tries' answer detail first.
  for (var i = 0; json.length > 45000 && i < attempts.length; i++) { delete attempts[i].answers; json = JSON.stringify(attempts); }
  return json;
}
/** A small seeded shuffle, so a try shows the same order on every reload. */
function pcSeedShuffle_(arr, seed) {
  var h = 2166136261;
  for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  var out = arr.slice();
  for (var j = out.length - 1; j > 0; j--) {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x6D2B79F5) >>> 0;
    var k = h % (j + 1), t = out[j]; out[j] = out[k]; out[k] = t;
  }
  return out;
}
/** The questions for one try, in that try's order. Choices are {i: index as written, t: text}. */
function pcQuizOrder_(a, email, key, tryN) {
  var qs = (a.mc || []).slice();
  if (tryN > 1) qs = pcSeedShuffle_(qs, pcNorm_(email) + '|' + key + '|' + tryN);
  return qs.map(function (q) {
    var ch = q.choices.map(function (t, i) { return { i: i, t: t }; });
    if (tryN > 1) ch = pcSeedShuffle_(ch, pcNorm_(email) + '|' + key + '|' + tryN + '|' + q.id);
    return { q: q, choices: ch };
  });
}
function pcQuizForStudent_(classId, email, n, a) {
  var r = pcQuizRow_(classId, email, n, a.id), info = pcQuizInfo_(r, a), ans = info.answers;
  var mine = info.attempts.filter(function (x) { return Number(x.n) === info.current; })[0];
  return {
    questions: pcQuizOrder_(a, email, pcItemKey_(n, a.id), info.current).map(function (o) {
      var q = o.q, x = ans[q.id] || { tries: [], state: 'open', points: 0 }, closed = x.state !== 'open';
      var out = { id: q.id, q: q.q, choices: o.choices, tries: x.tries || [], state: x.state || 'open', points: Number(x.points) || 0 };
      if (closed) { out.answer = q.answer; out.why = q.why; }
      return out;
    }),
    score: r && r.SubmittedAt ? Number(r.Score) : null, max: info.max, submittedAt: r ? pcIso_(r.SubmittedAt) : '',
    tryN: info.current, done: info.done, started: info.started, allowed: info.allowed, triesLeft: info.triesLeft, canRedo: info.canRedo,
    thisScore: mine ? Number(mine.score) : null, thisCounted: mine ? mine.counted !== false : true,
    attempts: info.attempts.map(function (x) { return { n: Number(x.n), score: Number(x.score), max: Number(x.max) || info.max, at: String(x.at || ''), counted: x.counted !== false }; })
  };
}
function answerQuiz(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act), a = it.act;
  if (it.form !== 'quiz') throw new Error('That isn’t a quiz.');
  var q = (a.mc || []).filter(function (x) { return x.id === String(payload.qid); })[0];
  if (!q) throw new Error('That question changed. Reload the quiz.');
  var pick = Math.floor(Number(payload.pick)); if (!(pick >= 0 && pick < q.choices.length)) throw new Error('Choose an answer.');
  var out = null;
  pcUserLock_(function () {
    pcUpsert_('Quiz', 'Email', { ClassId: classId, Email: me.email, Week: n, ActId: a.id }, function (r, now) {
      var info = pcQuizInfo_(r, a), ans = info.answers, x = ans[q.id] || { tries: [], state: 'open', points: 0 };
      x.tries = x.tries || [];
      // A page still showing another try (a second tab, or a redo started elsewhere) reloads instead.
      if (payload.tryN && Number(payload.tryN) !== info.current) { out = { already: true, stale: true }; return null; }
      if (info.done || x.state !== 'open' || x.tries.indexOf(pick) >= 0) { out = { already: true, state: x.state, tries: x.tries, points: x.points }; return null; }
      x.tries.push(pick);
      if (pick === q.answer) { x.state = 'right'; x.points = x.tries.length === 1 ? 1 : 0.5; }
      else if (x.tries.length >= 2) { x.state = 'missed'; x.points = 0; }
      ans[q.id] = x;
      var all = (a.mc || []).every(function (y) { return ans[y.id] && ans[y.id].state !== 'open'; });
      var score = (a.mc || []).reduce(function (sum, y) { return sum + (ans[y.id] ? Number(ans[y.id].points) || 0 : 0); }, 0);
      var f = { AnswersJson: JSON.stringify(ans), Max: info.max, StartedAt: r && r.StartedAt ? r.StartedAt : now, UpdatedAt: now, CurrentTry: info.current };
      out = { state: x.state, tries: x.tries, points: x.points, finished: all, score: all ? score : null, max: info.max, tryN: info.current };
      if (all) {
        info.attempts.push({ n: info.current, score: score, max: info.max, at: now.toISOString(), counted: true, answers: ans });
        var tot = pcQuizTotals_(info);
        f.AttemptsJson = pcQuizAttemptsJson_(info.attempts); f.Score = tot.Score; f.SubmittedAt = tot.SubmittedAt;
        var after = pcQuizInfo_({ AnswersJson: f.AnswersJson, AttemptsJson: f.AttemptsJson, CurrentTry: info.current, ExtraTries: info.extra }, a);
        out.best = tot.Score === '' ? null : tot.Score; out.canRedo = after.canRedo; out.triesLeft = after.triesLeft;
      } else if (!r || !String(r.AttemptsJson || '')) f.AttemptsJson = pcQuizAttemptsJson_(info.attempts);
      return f;
    }, { atomic: true });
  });
  if (out.state && out.state !== 'open') { out.answer = q.answer; out.why = q.why; }
  return Object.assign({ ok: true, qid: q.id }, out);
}
/** The student starts another try. base = the try number their page shows (a second click is a no-op). */
function redoQuiz(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act), a = it.act;
  if (it.form !== 'quiz') throw new Error('That isn’t a quiz.');
  var err = '';
  pcUserLock_(function () {
    pcUpsert_('Quiz', 'Email', { ClassId: classId, Email: me.email, Week: n, ActId: a.id }, function (r, now) {
      if (!r) { err = 'Finish the check first.'; return null; }
      var info = pcQuizInfo_(r, a);
      if (Number(payload.base) !== info.current || !info.done) return null;   // already started (another click or tab)
      if (!info.canRedo) { err = 'You’ve used all your tries on this check. Your best try counts. If you need another, ask your teacher.'; return null; }
      return { AnswersJson: '{}', AttemptsJson: pcQuizAttemptsJson_(info.attempts), CurrentTry: info.current + 1, UpdatedAt: now };
    }, { atomic: true });
  });
  if (err) throw new Error(err);
  return { ok: true, quiz: pcQuizForStudent_(classId, me.email, n, a) };
}

// ============================================================================
// DISCUSSION (posts are appended; a student sees classmates' posts after posting once)
// ============================================================================

function pcDiscussionFor_(classId, n, actId, email, teacher) {
  var sh = pcSheet_('Discuss');
  var rows = pcReadRows_(sh, pcFindRowNums_(sh, 'ClassId', classId)).filter(function (r) { return Number(r.Week) === Number(n) && String(r.ActId || 'discussion') === String(actId) && String(r.Text || '').trim(); });
  var mine = rows.some(function (r) { return pcNorm_(r.Email) === pcNorm_(email) && !r.ParentId; });
  var posts = rows.map(function (r) {
    return { id: String(r.PostId), email: pcNorm_(r.Email), name: pcCellText_(r.Name), parentId: String(r.ParentId || ''), text: pcCellText_(r.Text), createdAt: pcIso_(r.CreatedAt), editedAt: pcIso_(r.EditedAt), mine: pcNorm_(r.Email) === pcNorm_(email) };
  });
  if (!teacher && !mine) posts = posts.filter(function (p) { return p.mine; });
  if (!teacher) posts.forEach(function (p) { if (!p.mine) delete p.email; });
  return { posts: posts, unlocked: teacher || mine, count: rows.filter(function (r) { return !r.ParentId; }).length };
}
function postDiscussion(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = pcOpenAct_(me, n, payload.act);
  if (it.form !== 'discussion') throw new Error('That isn’t a discussion.');
  var text = pcClean_(payload.text, 8000).trim(); if (!text) throw new Error('Write something first.');
  var parentId = String(payload.parentId || ''), clientId = pcClean_(payload.clientId, 60), sh = pcSheet_('Discuss');
  pcUserLock_(function () {
    if (clientId && pcFindRowNums_(sh, 'ClientId', clientId).length) return;   // a retry is stored once
    if (parentId && !pcFindRowNums_(sh, 'PostId', parentId).length) throw new Error('That post is gone. Reload the discussion.');
    pcAppend_(sh, { PostId: Utilities.getUuid(), ClassId: classId, Week: n, Email: me.email, Name: me.name, ParentId: parentId, Text: text, CreatedAt: new Date(), EditedAt: '', ClientId: clientId, ActId: it.act.id });
  });
  return { ok: true, discussion: pcDiscussionFor_(classId, n, it.act.id, me.email, false) };
}
function editDiscussion(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = pcActing_(classId, payload.as, true);
  var text = pcClean_(payload.text, 8000).trim(); if (!text) throw new Error('A post can’t be empty.');
  var n = 0, actId = '';
  pcUserLock_(function () {
    pcUpsert_('Discuss', 'PostId', { PostId: String(payload.postId || '') }, function (r, now) {
      if (!r || pcNorm_(r.Email) !== me.email || String(r.ClassId) !== classId) throw new Error('You can only edit your own posts.');
      n = Number(r.Week); actId = String(r.ActId || 'discussion');
      return { Text: text, EditedAt: now };
    });
  });
  pcOpenAct_(me, n, actId);
  return { ok: true, discussion: pcDiscussionFor_(classId, n, actId, me.email, false) };
}

// ============================================================================
// TEACHER: release a whole week, Canva template links
// ============================================================================

/** Open (or hide) every activity of a week at once, lessons included. Work is never deleted. */
function setWeekRelease(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || '')), on = payload.on === true;
  var u = pcUnit_(pcStudyOf_(ctx.klass.ClassId), payload.week); if (!u) throw new Error('That week isn’t in the unit.');
  var keys = u.activities.map(function (a) { return pcItemKey_(u.n, a.id); });
  var s = pcUpdateSettings_(ctx.klass.ClassId, function (st) { keys.forEach(function (k) { st.release[k] = on; }); });
  return { ok: true, release: s.release };
}
/** The teacher's Canva TEMPLATE links (Share → Template link in Canva), one per class. */
function saveCanvaLinks(payload) {
  payload = payload || {}; var ctx = pcTeacherClass_(String(payload.classId || ''));
  var clean = {};
  Object.keys(PC_CANVA_DEFAULTS).forEach(function (k) {
    var v = pcClean_((payload.links || {})[k], 800).trim();
    if (v && !/^https:\/\//i.test(v)) throw new Error('Canva links start with https://');
    clean[k] = v;
  });
  var s = pcUpdateSettings_(ctx.klass.ClassId, function (st) { st.canva = clean; });
  return { ok: true, canva: pcCanva_(s) };
}
