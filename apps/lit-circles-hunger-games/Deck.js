/**
 * Literature Circles — Discussion Deck (release 2026-10-19a)
 *
 * One deck per group per week, built from what the group already turned in:
 *   - a title slide (book, this week's reading, who's in the group),
 *   - for every member: a "Reading strategies" slide (their Step 1 submission) and a
 *     "Discussion plan" slide (their Step 2 five-minute plan).
 * The members' own slides always show their latest SUBMITTED work (drafts never show); each
 * student changes their slides in Step 1 / Step 2 as before.
 * Anyone in the group can add to any slide ("Group adds"): each addition is its own row in the
 * DeckNotes tab with the writer's name, so nobody can overwrite anyone else. A student can edit or
 * remove their own additions; the teacher can remove any. Not graded, nothing goes to Canvas.
 *
 * Student calls: getLiteratureDiscussionDeck({email, week}), addLiteratureDeckNote,
 *                editLiteratureDeckNote, removeLiteratureDeckNote.
 * Teacher calls: listLiteratureDiscussionDecks({classId, week}),
 *                getLiteratureDiscussionDeck({classId, groupId, week}), removeLiteratureDeckNote({classId, noteId}).
 */

var LC_DECK_HEADERS = ['NoteId', 'GroupId', 'Week', 'Slide', 'Email', 'Name', 'Text', 'CreatedAt', 'UpdatedAt', 'Deleted', 'DeletedBy'];
var LC_DECK_NOTE_MAX = 600;      // characters in one addition
var LC_DECK_NOTES_PER_SLIDE = 40; // additions on one slide (all writers)

function lcDeckSheet_() { return getSheet_('DeckNotes', LC_DECK_HEADERS); }

function lcDeckCleanText_(s) {
  s = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!s) throw new Error('Write something first.');
  if (s.length > LC_DECK_NOTE_MAX) throw new Error('That’s ' + s.length + ' characters. Keep an addition under ' + LC_DECK_NOTE_MAX + ' — add a second one if you need more room.');
  return s;
}

/** Names for a list of emails (from the class lists; falls back to the email). */
function lcDeckNames_(emails) {
  var names = {};
  try { lcSheetObjects_(LC_PLATFORM_SHEETS.ENROLL).forEach(function (x) { var em = normEmail_(x.StudentEmail); if (em && x.StudentName && !names[em]) names[em] = String(x.StudentName); }); } catch (e) {}
  var out = {}; (emails || []).forEach(function (em) { em = normEmail_(em); out[em] = names[em] || lcNameFromEmail_(em); });
  return out;
}

/** Who is asking and for which group. Students: their own group, in a week that is open in their
 *  class. Teachers: any group with a student in one of their classes. */
function lcDeckCtx_(payload, write) {
  payload = payload || {};
  var week = lcWeek_(payload.week || 1);
  if (payload.classId) {
    var tg = lcQuizTeacherGroup_(String(payload.classId), String(payload.groupId || ''));
    return { teacher: tg.teacher, email: tg.teacher.email, week: week, group: tg.group, members: tg.group.memberEmails.map(normEmail_).filter(Boolean), classId: String(payload.classId) };
  }
  var email = lcActingEmail_(payload.email, !!write);
  lcInvalidateGroups_();
  var group = findGroupByEmail_(email);
  if (!group) throw new Error('Set up your group first.');
  if (!lcQuizStudentClass_(email, week)) throw new Error('Week ' + week + ' isn’t open yet.');
  return { teacher: null, email: email, week: week, group: group, members: group.memberEmails.map(normEmail_).filter(Boolean) };
}

/** A member's submitted Step 1 and saved Step 2 for this group and week (never drafts). */
function lcDeckMemberWork_(email, groupId, week) {
  var sh = workSheet_(), rec = null;
  lcReadRows_(sh, lcFindRowNumbers_(sh, 'Email', email)).forEach(function (r) {
    if (String(r.GroupId) === String(groupId) && Number(r.Week) === Number(week)) rec = r;
  });
  if (!rec) return { step1: null, plan: null };
  var w = lcWorkFromRec_(rec), data = w.data || {}, plan = data.discussionPlan || null;
  var step1 = null;
  if (w.prepType && !w.unreadable) {
    var copy = {};
    Object.keys(data).forEach(function (k) { if (k !== 'discussionPlan' && k.charAt(0) !== '_') copy[k] = data[k]; });
    step1 = { prepType: w.prepType, choices: w.choices.filter(Boolean), data: copy, submittedAt: w.submittedAt || w.updatedAt || '' };
  } else if (w.unreadable) step1 = { unreadable: true };
  return { step1: step1, plan: plan && typeof plan === 'object' ? plan : null, planAt: w.planUpdatedAt || '' };
}

function lcDeckNotes_(groupId, week, viewer, isTeacher) {
  var sh = lcDeckSheet_(), out = [];
  lcReadRows_(sh, lcFindRowNumbers_(sh, 'GroupId', String(groupId))).forEach(function (r) {
    if (Number(r.Week) !== Number(week) || lcTruth_(r.Deleted)) return;
    var em = normEmail_(r.Email);
    out.push({ id: String(r.NoteId), slide: String(r.Slide || ''), email: em, name: cellToText_(r.Name) || lcNameFromEmail_(em), text: cellToText_(r.Text),
      at: lcIsoValue_(r.CreatedAt), editedAt: lcIsoValue_(r.UpdatedAt) !== lcIsoValue_(r.CreatedAt) ? lcIsoValue_(r.UpdatedAt) : '',
      mine: !isTeacher && em === viewer });
  });
  out.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  return out;
}

function getLiteratureDiscussionDeck(payload) {
  var ctx = lcDeckCtx_(payload, false), g = ctx.group, week = ctx.week;
  var names = lcDeckNames_(ctx.members);
  var members = ctx.members.map(function (em) {
    var w = lcDeckMemberWork_(em, g.groupId, week);
    return { email: em, name: names[em], me: !ctx.teacher && em === ctx.email, step1: w.step1, plan: w.plan, planAt: w.planAt };
  });
  // the student first, then everyone else by name; the teacher sees everyone by name
  members.sort(function (a, b) { if (a.me !== b.me) return a.me ? -1 : 1; return String(a.name).localeCompare(String(b.name)); });
  return {
    ok: true, week: week, groupId: String(g.groupId), bookTitle: g.bookTitle || '', reading: String((g.weekReading || [])[week - 1] || ''),
    members: members, notes: lcDeckNotes_(g.groupId, week, ctx.email, !!ctx.teacher),
    teacher: !!ctx.teacher, canAdd: !ctx.teacher, me: ctx.teacher ? '' : ctx.email, noteMax: LC_DECK_NOTE_MAX, serverAt: new Date().toISOString()
  };
}

/** The slide keys that exist in this group's deck: "title" and "<email>|s" / "<email>|p". */
function lcDeckSlideOk_(slide, members) {
  slide = String(slide || '');
  if (slide === 'title') return true;
  var m = /^(.+)\|(s|p)$/.exec(slide);
  return !!m && members.indexOf(normEmail_(m[1])) >= 0;
}

function addLiteratureDeckNote(payload) {
  payload = payload || {};
  var ctx = lcDeckCtx_(payload, true);
  if (ctx.teacher) throw new Error('Additions come from the students in the group.');
  var text = lcDeckCleanText_(payload.text), slide = String(payload.slide || '');
  if (!lcDeckSlideOk_(slide, ctx.members)) throw new Error('That slide isn’t in your group’s deck any more. Reload the deck.');
  var name = lcDeckNames_([ctx.email])[ctx.email];
  var clientId = String(payload.clientId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return withLock_(function () {
    var sh = lcDeckSheet_(), existing = lcReadRows_(sh, lcFindRowNumbers_(sh, 'GroupId', String(ctx.group.groupId)));
    var onSlide = existing.filter(function (r) { return Number(r.Week) === ctx.week && String(r.Slide) === slide && !lcTruth_(r.Deleted); });
    // a retry of the same addition (the first answer got lost) doesn't add it twice
    if (clientId) { var dup = existing.filter(function (r) { return String(r.NoteId) === clientId; })[0]; if (dup) return { ok: true, id: clientId, notes: lcDeckNotes_(ctx.group.groupId, ctx.week, ctx.email, false) }; }
    if (onSlide.length >= LC_DECK_NOTES_PER_SLIDE) throw new Error('This slide is full (' + LC_DECK_NOTES_PER_SLIDE + ' additions). Add to another slide, or remove an old addition of yours.');
    var id = clientId || ('n' + Utilities.getUuid().replace(/-/g, '').slice(0, 16)), now = new Date();
    lcAppendObject_(sh, { NoteId: id, GroupId: String(ctx.group.groupId), Week: ctx.week, Slide: slide, Email: ctx.email, Name: String(name), Text: String(text), CreatedAt: now, UpdatedAt: now, Deleted: '', DeletedBy: '' });
    return { ok: true, id: id, notes: lcDeckNotes_(ctx.group.groupId, ctx.week, ctx.email, false) };
  });
}

/** The note row, checked: it belongs to this group and week (and to the writer, unless teacher). */
function lcDeckNoteRow_(ctx, noteId) {
  var sh = lcDeckSheet_(), rows = lcReadRows_(sh, lcFindRowNumbers_(sh, 'NoteId', String(noteId || '')));
  var r = rows.filter(function (x) { return String(x.GroupId) === String(ctx.group.groupId) && Number(x.Week) === ctx.week && !lcTruth_(x.Deleted); })[0];
  if (!r) throw new Error('That addition was already removed. Reload the deck.');
  if (!ctx.teacher && normEmail_(r.Email) !== ctx.email) throw new Error('You can only change your own additions.');
  return { sh: sh, row: r };
}

function editLiteratureDeckNote(payload) {
  payload = payload || {};
  var ctx = lcDeckCtx_(payload, true);
  if (ctx.teacher) throw new Error('Teachers can remove an addition, not rewrite it.');
  var text = lcDeckCleanText_(payload.text);
  return withLock_(function () {
    var f = lcDeckNoteRow_(ctx, payload.noteId), obj = {};
    Object.keys(f.row).forEach(function (k) { if (k !== '_row') obj[k] = f.row[k]; });
    obj.Text = String(text); obj.UpdatedAt = new Date(); obj.Name = String(cellToText_(obj.Name));
    lcWriteObjectRow_(f.sh, f.row._row, obj);
    return { ok: true, notes: lcDeckNotes_(ctx.group.groupId, ctx.week, ctx.email, false) };
  });
}

function removeLiteratureDeckNote(payload) {
  payload = payload || {};
  var ctx = lcDeckCtx_(payload, true);
  return withLock_(function () {
    var f = lcDeckNoteRow_(ctx, payload.noteId), obj = {};
    Object.keys(f.row).forEach(function (k) { if (k !== '_row') obj[k] = f.row[k]; });
    // kept in the tab (marked removed), so nothing a student wrote is ever lost for good
    obj.Deleted = true; obj.DeletedBy = ctx.email; obj.UpdatedAt = new Date();
    obj.Text = String(cellToText_(obj.Text)); obj.Name = String(cellToText_(obj.Name));
    lcWriteObjectRow_(f.sh, f.row._row, obj);
    return { ok: true, notes: lcDeckNotes_(ctx.group.groupId, ctx.week, ctx.email, !!ctx.teacher) };
  });
}

/** Teacher: the class's groups for a week, with how many members have Step 1 and Step 2 in. */
function listLiteratureDiscussionDecks(payload) {
  payload = payload || {}; var id = String(payload.classId || ''), week = lcWeek_(payload.week || 1);
  lcRequireClass_(id);
  var snap = lcTeacherClassSnapshot_(id, { light: true }), groups = {}, order = [];
  var nameOf = {}; snap.enrollments.forEach(function (e) { nameOf[normEmail_(e.StudentEmail)] = String(e.StudentName || lcNameFromEmail_(e.StudentEmail)); });
  snap.enrollments.forEach(function (e) {
    var em = normEmail_(e.StudentEmail), g = snap.groupByEmail[em]; if (!g) return;
    var gid = String(g.groupId);
    if (!groups[gid]) { groups[gid] = { groupId: gid, bookTitle: g.bookTitle || 'Untitled book', reading: String((g.weekReading || [])[week - 1] || ''), members: [], step1: 0, plan: 0, notes: 0 }; order.push(gid); }
    groups[gid].members.push(nameOf[em]);
    var w = snap.workByKey[em + '|' + week];
    if (w && w.prepType && !w.unreadable) groups[gid].step1++;
    if (w && (w.planComplete || w.planUpdatedAt)) groups[gid].plan++;
  });
  var sh = lcDeckSheet_(), last = sh.getLastRow();
  if (last >= 2) lcAllRows_(sh).forEach(function (r) { var x = groups[String(r.GroupId)]; if (x && Number(r.Week) === week && !lcTruth_(r.Deleted)) x.notes++; });
  var list = order.map(function (gid) { return groups[gid]; }).sort(function (a, b) { return String(a.bookTitle).localeCompare(String(b.bookTitle)); });
  return { ok: true, classId: id, week: week, groups: list };
}
