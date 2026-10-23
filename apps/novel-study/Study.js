// ============================================================================
// Novel Study -- the study: the book (Sora or the class's own copies), how it is broken up
// (week by week, arcs, or day by day), and the activities each unit holds. Plus everything a
// student does: reading check-ins, written work, evidence cards, quizzes, discussions.
// Content lives in data, not code. The book's text is never stored here.
// ============================================================================

// ---------- choices the teacher picks from (tiles) ----------

var NV_SOURCES = {
  sora: { label: 'Sora', note: 'Students borrow the e-book (or audiobook) in Sora and read it there.' },
  own: { label: 'Our own copies', note: 'Students read a print copy or a class set. The app tells them what to read and where to stop.' }
};
var NV_ACCESS = {
  always: { label: 'Always Available', note: 'No waitlist. Every student can borrow it at the same time.' },
  classset: { label: 'Class set', note: 'Your school rented a copy for each student in the class.' },
  assigned: { label: 'Assigned to you', note: 'It appears on your Sora shelf automatically. You don’t have to borrow it.' },
  limited: { label: 'Limited copies', note: 'There may be a waitlist. Place a hold now, or ask your teacher about a print copy.' }
};
var NV_STRUCTURES = {
  weekly: { label: 'Week by week', unit: 'Week', note: 'One reading and a set of activities each week.' },
  arcs: { label: 'Arcs', unit: 'Arc', note: 'Sections that follow the book’s own movement, however long each one runs.' },
  daily: { label: 'Day by day', unit: 'Day', note: 'Today’s reading and today’s activities, one day at a time.' }
};
/** The activity library. form decides what students fill in; points is the default (teachers change it). */
var NV_ACT = {
  bellringer:    { label: 'Bell Ringer', icon: '⚡', form: 'text', points: 2, desc: 'A short entry task that warms up thinking before the reading.' },
  evidence:      { label: 'Evidence Log', icon: '🖍', form: 'evidence', points: 3, desc: 'Highlight while reading (Sora colors or sticky notes) and bring the evidence back as cards.' },
  quiz:          { label: 'Reading Quiz', icon: '✓', form: 'quiz', points: null, desc: 'Multiple choice that scores itself: 1 point first try, ½ second try.' },
  analysis:      { label: 'Written Response', icon: '✍️', form: 'text', points: 7, desc: 'A book-specific claim with evidence and explanation, scored on the 7-level rubric.' },
  close_reading: { label: 'Close Reading', icon: '🔍', form: 'close', points: 5, desc: 'Students pick a short passage and analyze one choice the author made.' },
  vocabulary:    { label: 'Vocabulary', icon: '🧠', form: 'vocab', points: 3, desc: 'Words in context: where it appears, what it means there, why the author chose it.' },
  discussion:    { label: 'Discussion', icon: '💬', form: 'discussion', points: 3, desc: 'A debatable question. Students post first, then reply to classmates.' },
  creative:      { label: 'Creative / Visual', icon: '🎨', form: 'text', points: 5, desc: 'A visual, structural or creative task that still needs evidence. Students can add a link.' },
  reflection:    { label: 'Reflection', icon: '↩', form: 'text', points: 5, desc: 'Back to the essential question: what changed in the student’s thinking.' }
};
var NV_FOCUS = ['Character', 'Theme', 'Conflict', 'Symbolism', 'Setting', 'Point of View', 'Author’s Craft', 'Structure', 'Historical / Social Context', 'Argument & Big Ideas'];
var NV_FRAMEWORKS = [
  { key: 'book_centered', label: 'Book-Centered', note: 'Let the novel’s own structure and ideas shape the study.' },
  { key: 'hero_journey', label: 'Hero’s Journey / Quest', note: 'Departure, trials, mentors, transformation, return.' },
  { key: 'coming_of_age', label: 'Coming of Age', note: 'Identity, independence, belonging, growing up.' },
  { key: 'dystopian_systems', label: 'Dystopia / Social Systems', note: 'Power, conformity, control, resistance.' },
  { key: 'tragedy', label: 'Tragedy', note: 'Choices, consequences, reversals, responsibility.' },
  { key: 'philosophical_inquiry', label: 'Big-Idea Inquiry', note: 'Contested questions about justice, freedom, meaning.' },
  { key: 'historical_cultural', label: 'Historical & Cultural Lens', note: 'The text in its time and place.' },
  { key: 'mystery_investigation', label: 'Mystery / Investigation', note: 'Clues, suspicion, reliability, revelation.' },
  { key: 'character_relationships', label: 'Character & Relationships', note: 'Motives, alliances, conflicts, change.' },
  { key: 'symbol_motif', label: 'Symbol & Motif', note: 'Recurring images and how their meaning grows.' },
  { key: 'perspective_reliability', label: 'Point of View & Reliability', note: 'What the narrator notices, hides or can’t know.' },
  { key: 'structure_time', label: 'Structure & Time', note: 'Nonlinear time, framing, pacing.' },
  { key: 'ethical_decisions', label: 'Ethical Decisions', note: 'Hard choices and competing values.' },
  { key: 'place_setting', label: 'Place & Setting', note: 'How place shapes people and conflict.' },
  { key: 'social_critique', label: 'Society & Power', note: 'The novel as an argument about society.' },
  { key: 'verse_novel', label: 'Verse Novel / Poetic Form', note: 'Line breaks, white space, sound, compression.' },
  { key: 'graphic_visual', label: 'Graphic / Visual Narrative', note: 'Panels, framing, image and word together.' },
  { key: 'multi_voice', label: 'Multiple Voices', note: 'Shifting narrators and what each one knows.' }
];
var NV_SPLITS = {
  chapters: { label: 'By chapters', note: 'Even runs of chapters (you give the number of chapters).' },
  pages: { label: 'By pages', note: 'Even page ranges (you give the number of pages and your edition).' },
  percent: { label: 'By Sora %', note: 'Sora shows how far through the book a reader is. Even slices, like 0–12%.' },
  ai: { label: 'Natural stopping points', note: 'AI suggests where each reading should end (check it against the table of contents).' },
  custom: { label: 'I’ll type each one', note: 'Write each reading yourself: “Chapter 4 to the end of the party”.' }
};

// Sora highlights in three colors: gold, pink and green. The key gives each one a meaning.
var NV_DEFAULT_KEY = [
  { color: 'gold', label: 'Characters', hint: 'What a character does, says, wants or hides' },
  { color: 'pink', label: 'Setting & mood', hint: 'Where and when, and how it feels' },
  { color: 'green', label: 'Big ideas', hint: 'Lines that connect to the essential question or a theme' }
];
var NV_COLORS = ['gold', 'pink', 'green'];
function nvColor_(c) {
  c = String(c || '').trim().toLowerCase();
  if (c === 'yellow') return 'gold';
  if (c === 'red') return 'pink';
  return NV_COLORS.indexOf(c) >= 0 ? c : '';
}
function nvCleanKey_(key) {
  key = Array.isArray(key) ? key : [];
  var labels = key.map(function (k) { return String((k || {}).label || ''); }).join('|');
  if (labels === 'Characters|Setting & mood|Big ideas|Questions') return NV_DEFAULT_KEY.slice();
  var seen = {}, out = [];
  key.forEach(function (k) {
    var c = nvColor_((k || {}).color); if (!c || seen[c] || out.length >= NV_COLORS.length) return; seen[c] = true;
    out.push({ color: c, label: nvClean_(k.label, 40).trim() || 'Highlight ' + (out.length + 1), hint: nvClean_(k.hint, 140).trim() });
  });
  return out.length ? out : NV_DEFAULT_KEY.slice();
}

/** Everything a setup screen needs to draw its tiles. */
function nvChoices_() {
  var acts = {}; Object.keys(NV_ACT).forEach(function (k) { acts[k] = NV_ACT[k]; });
  return { sources: NV_SOURCES, access: NV_ACCESS, structures: NV_STRUCTURES, activities: acts, focus: NV_FOCUS, frameworks: NV_FRAMEWORKS, splits: NV_SPLITS, colors: NV_COLORS, teachModes: NV_TEACH_MODES, readWhere: NV_READ_WHERE, sessionsDefault: NV_SESSIONS_DEFAULT };
}

// ============================================================================
// THE STUDY RECORD
// ============================================================================

function nvEmptyStudy_() {
  return { v: 2, source: '', book: null, highlightKey: NV_DEFAULT_KEY.slice(), structure: 'weekly', unitCount: 4, focusAreas: [], framework: { mode: 'auto', primary: '' },
    gradeBand: '', split: { mode: 'chapters', totalChapters: '', totalPages: '' }, pattern: [], schedule: { startDate: '', days: [1, 2, 3, 4, 5], autoOpen: false }, teaching: null, units: [], setupStep: 1 };
}
/** Studies made by the first version (fixed weeks: Evidence, Quiz, Response, Discussion) become units
 *  whose activities keep the same ids, so every saved answer, grade and Canvas link still matches. */
function nvMigrateStudy_(d) {
  if (d.v === 2 || !Array.isArray(d.weeks)) return d;
  var s = Object.assign(nvEmptyStudy_(), d);
  s.v = 2; s.source = d.book ? 'sora' : ''; s.structure = 'weekly';
  var count = Math.min(d.weeks.length, Number(d.weekCount) || d.weeks.length);
  s.unitCount = count || 4;
  s.units = d.weeks.map(function (w, i) {
    w = w || {};
    return { n: i + 1, title: w.title || '', reading: { label: w.reading || '', stopAt: w.stopAt || '' }, date: '', eq: w.eq || '', focus: w.focus || [],
      status: w.status === 'approved' ? 'approved' : 'draft', aiNote: w.aiNote || '', updatedAt: w.updatedAt || '',
      activities: [
        { id: 'evidence', type: 'evidence', title: 'Evidence Log', prompt: '', points: 3, graded: true },
        { id: 'quiz', type: 'quiz', title: 'Quiz', mc: w.mc || [], graded: true },
        { id: 'response', type: 'analysis', title: 'Response', prompt: (w.response || {}).prompt || '', minWords: (w.response || {}).minWords || 0, points: 7, graded: true },
        { id: 'discussion', type: 'discussion', title: 'Discussion', prompt: (w.discussion || {}).prompt || '', points: 3, graded: true }
      ] };
  });
  s.pattern = [{ type: 'evidence', points: 3, graded: true }, { type: 'quiz', graded: true }, { type: 'analysis', points: 7, graded: true }, { type: 'discussion', points: 3, graded: true }];
  s.setupStep = 5;
  delete s.weeks; delete s.weekCount;
  return s;
}
function nvStudyRow_(classId) { return nvFindOne_('Studies', 'ClassId', { ClassId: classId }); }
function nvNormalizeStudy_(d) {
  var s = Object.assign(nvEmptyStudy_(), nvMigrateStudy_(d || {}));
  s.units = Array.isArray(s.units) ? s.units : [];
  s.highlightKey = nvCleanKey_(s.highlightKey);
  s.units.forEach(function (u) { if (u && Array.isArray(u.focus)) u.focus = u.focus.map(nvColor_).filter(function (c, i, a) { return c && a.indexOf(c) === i; }); });
  return s;
}
function nvStudyOf_(classId) {
  var r = nvStudyRow_(classId);
  if (!r) return null;
  var d = nvParseChunks_(r, 'DataJson', 5);
  if (d._unreadable) return { _unreadable: true };
  var s = nvNormalizeStudy_(d);
  s.updatedAt = nvIso_(r.UpdatedAt);
  return s;
}
function nvRequireStudy_(classId) {
  var s = nvStudyOf_(classId);
  if (!s || !s.book) throw new Error('This class doesn’t have a book yet.');
  if (s._unreadable) throw new Error('This class’s book plan could not be read. Tell the app’s admin.');
  return s;
}
/** Teacher edits under the lock, from a fresh read. `base` refuses a save over a newer edit from another tab. */
function nvUpdateStudy_(classId, by, base, fn) {
  return nvWithLock_(function () {
    var out = null;
    nvUpsert_('Studies', 'ClassId', { ClassId: classId }, function (r, now) {
      var raw = r ? nvParseChunks_(r, 'DataJson', 5) : nvEmptyStudy_();
      if (raw._unreadable) throw new Error('The book plan could not be read, so nothing was changed.');
      if (r && base && nvLater_(r.UpdatedAt, base)) { var e = new Error('This book plan was changed in another tab or by a co-teacher. Reload to see the newest version. Your edits are still on this screen.'); e.stale = true; throw e; }
      var s = nvNormalizeStudy_(raw);
      fn(s);
      out = s; out.updatedAt = now.toISOString();
      var f = nvSplit_('DataJson', 5, JSON.stringify(s));
      f.UpdatedAt = now; f.UpdatedBy = by; f.StudyId = (r && r.StudyId) || Utilities.getUuid();
      return f;
    });
    return out;
  });
}
function nvCleanUrl_(u, label) {
  u = nvClean_(u, 800).trim(); if (!u) return '';
  if (!/^https:\/\//i.test(u)) throw new Error((label || 'Links') + ' must start with https://');
  return u;
}
/** Every form a Sora (or OverDrive) title link takes:
 *  soraapp.com/library/{school}/title/{id}, soraapp.com/library/{school}/{id}, soraapp.com/title/{id},
 *  overdrive.com/media/{id}/..., {library}.overdrive.com/media/{id}, libbyapp.com/.../{id}.
 *  Also a book on the teacher's own Sora shelf (soraapp.com/home/loans/{n}-{n}, holds, history):
 *  it names the book but only opens for the person who borrowed it, so it is marked notShareable,
 *  every number in it is a candidate (last first), and the lookup swaps in the book's own link. */
function nvSoraInfo_(url) {
  url = String(url || '').trim(); var m;
  if ((m = /soraapp\.com\/library\/([A-Za-z0-9_-]+)\/(?:[^?#]*\/)?title\/(\d+)/i.exec(url))) return { library: m[1], titleId: m[2] };
  if ((m = /soraapp\.com\/library\/([A-Za-z0-9_-]+)\/(\d+)(?:[\/?#]|$)/i.exec(url))) return { library: m[1], titleId: m[2] };
  if ((m = /soraapp\.com\/(?:[^?#]*\/)?title\/(\d+)/i.exec(url))) return { library: '', titleId: m[1] };
  if ((m = /(?:^|\/\/)(?:www\.)?overdrive\.com\/media\/(\d+)/i.exec(url))) return { library: '', titleId: m[1] };
  if ((m = /\/\/([A-Za-z0-9_-]+)\.overdrive\.com\/(?:[^?#]*\/)?media\/(\d+)/i.exec(url))) return { library: m[1], titleId: m[2] };
  if ((m = /libbyapp\.com\/library\/([A-Za-z0-9_-]+)\/(?:[^?#]*\/)?(\d{4,})(?:[\/?#]|$)/i.exec(url))) return { library: m[1], titleId: m[2] };
  if (/^https?:\/\/(?:[A-Za-z0-9-]+\.)?soraapp\.com\//i.test(url) && (m = url.split(/[?#]/)[0].match(/\d{4,}/g))) {
    var ids = m.slice().reverse();
    return { library: '', titleId: ids[0], alt: ids.slice(1, 3), notShareable: true };
  }
  return null;
}
/** The link students open for a title: the school's own Sora when known, otherwise Sora's school-free title link. */
function nvSoraTitleUrl_(library, id) { return library ? 'https://soraapp.com/library/' + encodeURIComponent(library) + '/' + id : 'https://soraapp.com/title/' + id; }
/** A school's Sora home page (the Open Sora button). */
function nvSoraHome_(library) { return library ? 'https://soraapp.com/library/' + encodeURIComponent(library) : 'https://soraapp.com/'; }

// ---------- reading a title's details from its Sora link ----------
// Sora runs on OverDrive's catalog. The same catalog Sora's own pages read gives the title, author,
// cover, format, reading levels and (for the school's collection) whether it is Always Available.
// If that can't be reached, the public overdrive.com page for the title gives title, author and cover.
// Only facts about the book are read -- never any of its text.

function lookupSoraTitle(payload) {
  payload = payload || {}; nvTeacherClass_(String(payload.classId || ''));
  return nvLookupSora_(nvClean_(payload.url, 800).trim(), payload.library);
}
/** Run from the Apps Script editor to see what Sora sends back for a title (View → Logs / Execution log). */
function testSoraLink() {
  nvRequireTeacher_();
  var url = PropertiesService.getScriptProperties().getProperty('NV_TEST_SORA_LINK') || 'https://www.overdrive.com/media/2610260/the-great-gatsby';
  try { var ti = nvSoraInfo_(url) || {}; CacheService.getScriptCache().remove('nvSora:-:' + [ti.titleId].concat(ti.alt || []).join('-')); } catch (e) {}
  var r = nvLookupSora_(url); Logger.log(url + '\n' + JSON.stringify(r, null, 2)); return r;
}
function nvLookupSora_(raw, libHint) {
  var info = nvSoraInfo_(raw);
  if (!info) return { ok: false, message: 'That doesn’t look like a link to one book in Sora. Open the book’s page in Sora and copy the address (it ends with the book’s number), or use Sora’s Share button.' };
  libHint = String(libHint || '').trim(); if (!/^[A-Za-z0-9_-]{1,60}$/.test(libHint)) libHint = '';
  // A shelf link carries no school, so use the school remembered from an earlier link (for availability).
  var lib = info.library || (info.notShareable ? libHint : '');
  var ids = [info.titleId].concat(info.alt || []);
  var cache = null, ck = 'nvSora:' + (lib || '-') + ':' + ids.join('-');
  try { cache = CacheService.getScriptCache(); var hit = cache && cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) {}
  var found = [], tried = [];
  for (var k = 0; k < ids.length; k++) {
    var one = nvLookupOne_(lib, ids[k], tried);
    if (one) { found.push({ id: ids[k], r: one }); if (!info.notShareable) break; }
  }
  if (!found.length) {
    if (info.notShareable) return { ok: false, message: 'That link is from your own Sora shelf, so it only opens for you, and Sora didn’t say which book it is. In Sora, tap the book’s cover to open its page, then copy that address (or Share → Copy link) and paste it here.', detail: tried.join(' | ').slice(0, 300) };
    return { ok: false, titleId: info.titleId, library: info.library, message: 'Sora didn’t send the book’s details this time, so type the title and author yourself. The link still works for students.', detail: tried.join(' | ').slice(0, 300) };
  }
  // More than one number on a shelf link can name a book: prefer the one the school owns, else the last number.
  var pick = 0;
  if (found.length > 1 && lib) for (var q = 0; q < found.length; q++) { var av = found[q].r.book.availability; if (av && av.access) { pick = q; break; } }
  var win = found[pick], out = win.r;
  out.book.soraTitleId = win.id; out.book.soraLibrary = info.library;
  var res = { ok: true, book: out.book, source: out.source, soraHome: nvSoraHome_(info.library || lib) };
  if (info.notShareable) {
    res.soraUrl = nvSoraTitleUrl_(lib, win.id); res.swapped = true;
    res.others = found.filter(function (x, i) { return i !== pick; }).map(function (x) { return { titleId: x.id, title: x.r.book.title, author: x.r.book.author, soraUrl: nvSoraTitleUrl_(lib, x.id) }; });
  }
  try { if (cache) cache.put(ck, JSON.stringify(res), 6 * 3600); } catch (e) {}
  return res;
}
/** One title number: the school's catalog, then the catalog without a school, then the public overdrive.com page. */
function nvLookupOne_(lib, id, tried) {
  var t, p;
  if (lib) { t = nvThunderTitle_(lib, id); if (t.book) return t; tried.push(t.why); }
  t = nvThunderTitle_('', id); if (t.book) return t; tried.push(t.why);
  p = nvOverDrivePage_(id); if (p.book) return p; tried.push(p.why);
  return null;
}
function nvFetchJson_(url) {
  try {
    var r = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
    var code = r.getResponseCode(); if (code < 200 || code >= 300) return { code: code };
    return { code: code, json: JSON.parse(r.getContentText()) };
  } catch (e) { return { code: 0, error: String(e && e.message || e) }; }
}
function nvThunderTitle_(library, id) {
  var url = 'https://thunder.api.overdrive.com/v2/' + (library ? 'libraries/' + encodeURIComponent(library) + '/' : '') + 'media/' + encodeURIComponent(id);
  var r = nvFetchJson_(url), j = r.json;
  if (!j || !j.title) return { why: 'catalog' + (library ? ' (' + library + ')' : '') + ': ' + (r.code || r.error || 'no title') };
  var creators = Array.isArray(j.creators) ? j.creators : [];
  var authors = creators.filter(function (c) { return /author|editor/i.test(String(c.role || '')); }).map(function (c) { return c.name; });
  if (!authors.length && j.firstCreatorName) authors = [j.firstCreatorName];
  var narrators = creators.filter(function (c) { return /narrator/i.test(String(c.role || '')); }).map(function (c) { return c.name; });
  var cv = j.covers || {}, cover = (cv.cover510Wide || cv.cover300Wide || cv.cover150Wide || {});
  var levels = (Array.isArray(j.levels) ? j.levels : []).map(function (l) {
    var v = l.value || (l.low && l.high ? l.low + '–' + l.high : l.low || l.high || '');
    return v ? { name: nvClean_(l.name || l.id, 30), value: nvClean_(v, 20) } : null;
  }).filter(Boolean).slice(0, 4);
  var type = String((j.type || {}).id || '').toLowerCase();
  var book = { title: nvClean_(j.title, 200), subtitle: nvClean_(j.subtitle, 200), author: nvClean_(authors.slice(0, 3).join(', '), 120),
    narrator: nvClean_(narrators.slice(0, 2).join(', '), 120), coverUrl: cover.isPlaceholderImage ? '' : nvSafeImg_(cover.href),
    format: type === 'audiobook' ? 'audiobook' : type === 'ebook' ? 'ebook' : type, publisher: nvClean_((j.publisher || {}).name, 120),
    series: nvClean_((j.detailedSeries || {}).seriesName || j.series, 120), levels: levels };
  if (library) book.availability = nvThunderAccess_(j);
  return { book: book, source: 'catalog' };
}
/** What the school's copy looks like: Always Available, a class set, or limited copies with a wait. */
function nvThunderAccess_(j) {
  var at = String(j.availabilityType || '').toLowerCase(), owned = Number(j.ownedCopies) || 0, avail = Number(j.availableCopies) || 0, holds = Number(j.holdsCount) || 0;
  if (at.indexOf('always') >= 0) return { access: 'always', note: 'Sora says this title is Always Available at your school: every student can borrow it at once.' };
  if (j.isOwned === false) return { access: '', note: 'Your school’s Sora collection doesn’t own this title right now. Check the link, or ask your librarian.' };
  if (!j.isAvailable || holds > 0) return { access: 'limited', note: 'Your school has ' + (owned || 'a few') + ' cop' + (owned === 1 ? 'y' : 'ies') + (holds ? ' and ' + holds + ' on the waitlist' : ', none free right now') + '. Students may wait for it.' };
  return { access: owned >= 25 ? 'classset' : 'limited', note: 'Your school has ' + owned + ' cop' + (owned === 1 ? 'y' : 'ies') + ' (' + avail + ' free right now).' };
}
function nvSafeImg_(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u.slice(0, 800) : ''; }
/** Fallback: the public overdrive.com page for the title (title, author and cover from its page tags). */
function nvOverDrivePage_(id) {
  var html = '';
  try {
    var r = UrlFetchApp.fetch('https://www.overdrive.com/media/' + encodeURIComponent(id), { method: 'get', muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() !== 200) return { why: 'overdrive.com: ' + r.getResponseCode() };
    html = r.getContentText();
  } catch (e) { return { why: 'overdrive.com: ' + (e && e.message || e) }; }
  function meta(prop) {
    var re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop.replace(/[:.]/g, '\\$&') + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'), re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop.replace(/[:.]/g, '\\$&') + '["\']', 'i');
    var m = re.exec(html) || re2.exec(html); return m ? nvUnescapeHtml_(m[1]) : '';
  }
  var t = meta('og:title') || ((/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || '');
  var format = /^\s*audiobook\b/i.test(t) ? 'audiobook' : /^\s*e-?book\b/i.test(t) ? 'ebook' : '';
  var title = nvUnescapeHtml_(t).replace(/^\s*(e-?book|audiobook|magazine|video)\s*[-–:]\s*/i, '').replace(/\s*[|·-]\s*OverDrive.*$/i, '').trim();
  if (!title) return { why: 'overdrive.com: no title on the page' };
  var author = '', m;
  if ((m = /"firstCreatorName"\s*:\s*"([^"]+)"/.exec(html))) author = m[1];
  else if ((m = /"author"\s*:\s*(?:\[\s*)?\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(html))) author = m[1];
  else if ((m = /href="\/creators\/\d+[^"]*"[^>]*>([^<]{2,80})<\/a>/i.exec(html))) author = m[1];
  else author = meta('author');
  return { book: { title: nvClean_(title, 200), subtitle: '', author: nvClean_(nvUnescapeHtml_(author).trim(), 120), narrator: '', coverUrl: nvSafeImg_(meta('og:image')), format: format, publisher: '', series: '', levels: [] }, source: 'overdrive.com' };
}
function nvUnescapeHtml_(s) {
  return String(s || '').replace(/&#(\d+);/g, function (a, n) { return String.fromCharCode(Number(n)); }).replace(/&#x([0-9a-f]+);/gi, function (a, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ---------- units ----------

function nvUnitWord_(s) { return (NV_STRUCTURES[s.structure] || NV_STRUCTURES.weekly).unit; }
function nvUnitLabel_(s, n) { return nvUnitWord_(s) + ' ' + n; }
function nvUnitCount_(s) { return Math.min(s.units.length, Number(s.unitCount) || s.units.length); }
function nvUnit_(s, n) { n = Number(n); return n >= 1 && n <= nvUnitCount_(s) ? s.units[n - 1] : null; }
function nvBlankUnit_(n) { return { n: n, title: '', reading: { label: '', from: '', to: '', stopAt: '' }, date: '', eq: '', focus: [], activities: [], status: 'draft', aiNote: '', updatedAt: '' }; }
function nvNewActId_(type, used) {
  for (var i = 0; i < 20; i++) { var id = String(type).slice(0, 4) + Utilities.getUuid().replace(/-/g, '').slice(0, 5); if (!used || !used[id]) return id; }
  return type + Date.now();
}
function nvCleanMc_(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map(function (q, i) {
    q = q || {};
    var choices = (Array.isArray(q.choices) ? q.choices : Array.isArray(q.options) ? q.options : []).slice(0, 4).map(function (c) { return nvClean_(c, 300).trim(); });
    while (choices.length < 4) choices.push('');
    var ans = Math.floor(Number(q.answer !== undefined ? q.answer : q.answerIndex)); if (!(ans >= 0 && ans <= 3)) ans = 0;
    return { id: String(q.id || ('q' + (i + 1) + '_' + Utilities.getUuid().slice(0, 4))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'q' + (i + 1), q: nvClean_(q.q || q.question, 600).trim(), choices: choices, answer: ans, why: nvClean_(q.why || q.rationale, 500).trim() };
  });
}
function nvPoints_(v, fallback) {
  var n = Number(v); if (!isFinite(n) || n < 0) return fallback;
  n = Math.round(n * 2) / 2; return Math.min(100, n);
}
function nvCleanActivity_(a, used) {
  a = a || {};
  var type = NV_ACT[a.type] ? a.type : 'analysis', lib = NV_ACT[type];
  var id = String(a.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  if (!id || (used && used[id])) id = nvNewActId_(type, used);
  if (used) used[id] = true;
  var out = { id: id, type: type, title: nvClean_(a.title, 120).trim() || lib.label, prompt: nvClean_(a.prompt, 2000).trim(),
    directions: (Array.isArray(a.directions) ? a.directions : []).map(function (d) { return nvClean_(d, 300).trim(); }).filter(String).slice(0, 8),
    graded: a.graded !== false, standards: (Array.isArray(a.standards) ? a.standards : []).map(function (x) { return nvClean_(x, 20).trim(); }).filter(String).slice(0, 6) };
  if (type === 'quiz') { out.mc = nvCleanMc_(a.mc || a.questions); out.points = out.mc.length; out.count = Math.max(1, Math.min(15, Math.floor(Number(a.count) || out.mc.length || 6))); }
  else out.points = nvPoints_(a.points, lib.points);
  if (lib.form === 'text') out.minWords = Math.max(0, Math.min(2000, Math.floor(Number(a.minWords) || 0)));
  if (type === 'vocabulary') out.words = (Array.isArray(a.words) ? a.words : []).slice(0, 15).map(function (w) { w = typeof w === 'string' ? { word: w } : (w || {}); return { word: nvClean_(w.word, 40).trim(), hint: nvClean_(w.hint, 200).trim() }; }).filter(function (w) { return w.word; });
  return out;
}
function nvCleanUnit_(u, n, keyColors, old) {
  u = u || {}; old = old || {};
  var used = {}, r = u.reading || {};
  // Activities keep their ids (students' work is filed under them).
  var acts = (Array.isArray(u.activities) ? u.activities : []).slice(0, 12).map(function (a) { return nvCleanActivity_(a, used); });
  // Quiz questions students already answered keep their ids.
  acts.forEach(function (a) {
    if (a.type !== 'quiz') return;
    var oa = (old.activities || []).filter(function (x) { return x.id === a.id; })[0];
    if (oa) a.mc.forEach(function (q, i) { var raw = ((u.activities || []).filter(function (x) { return x && x.id === a.id; })[0] || {}).mc || []; if (!(raw[i] && raw[i].id) && oa.mc && oa.mc[i]) q.id = oa.mc[i].id; });
  });
  return {
    n: n, title: nvClean_(u.title, 120).trim(),
    reading: { label: nvClean_(r.label, 200).trim(), from: nvClean_(r.from, 30).trim(), to: nvClean_(r.to, 30).trim(), stopAt: nvClean_(r.stopAt, 200).trim() },
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(u.date || '')) ? String(u.date) : '',
    eq: nvClean_(u.eq, 400).trim(),
    focus: (Array.isArray(u.focus) ? u.focus : []).map(nvColor_).filter(function (c, i, a) { return c && keyColors.indexOf(c) >= 0 && a.indexOf(c) === i; }),
    activities: acts, status: u.status === 'approved' ? 'approved' : 'draft', aiNote: nvClean_(u.aiNote, 600).trim(), updatedAt: new Date().toISOString()
  };
}
/** What still keeps a unit from being approved, in plain words. */
function nvUnitProblems_(u) {
  var p = [];
  if (!u.reading || !u.reading.label) p.push('the reading');
  (u.activities || []).forEach(function (a, i) {
    var name = (a.title || NV_ACT[a.type].label) + ' (activity ' + (i + 1) + ')';
    if (a.type === 'quiz') {
      if ((a.mc || []).length < 1) p.push(name + ': at least one question');
      (a.mc || []).forEach(function (q, j) { if (!q.q || q.choices.some(function (c) { return !c; })) p.push(name + ': question ' + (j + 1) + ' has a blank'); });
    } else if (a.type === 'vocabulary') { if (!(a.words || []).length && !a.prompt) p.push(name + ': words or directions'); }
    else if (a.type !== 'evidence' && !a.prompt) p.push(name + ': the prompt');
  });
  return p;
}

// ============================================================================
// SETUP (the four tiles) -- each step saves on its own, so a teacher can stop anywhere.
// ============================================================================

function getStudy(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var ai = false; try { ai = !!PropertiesService.getScriptProperties().getProperty(NV_GEMINI_PROP); } catch (e) {}
  var st0 = nvStudyOf_(ctx.klass.ClassId);
  return { ok: true, study: nvTeacherStudy_(st0 || nvEmptyStudy_()), choices: nvChoices_(), settings: ctx.settings,
    klass: { classId: ctx.klass.ClassId, className: nvCellText_(ctx.klass.ClassName), period: nvCellText_(ctx.klass.Period) }, aiConfigured: ai, today: nvToday_(), standards: nvStandardsPayload_(st0 && !st0._unreadable ? st0 : null) };
}
function nvTeacherStudy_(s) {
  s = s || nvEmptyStudy_();
  if (s._unreadable) return { _unreadable: true };
  var out = JSON.parse(JSON.stringify(s));
  out.unitCount = nvUnitCount_(s);
  out.unitWord = nvUnitWord_(s);
  out.teachingSet = !!(s.teaching && s.teaching.mode);
  out.teaching = nvCleanTeaching_(s.teaching || {}, s.structure);
  out.units = s.units.slice(0, out.unitCount).map(function (u, i) { var x = JSON.parse(JSON.stringify(u)); x.n = i + 1; x.label = nvUnitLabel_(s, i + 1); x.problems = nvUnitProblems_(u); return x; });
  out.updatedAt = s.updatedAt || '';
  return out;
}
/** Steps 1-3: where the book comes from, the book itself, and how the study is built. Any part may be sent. */
function saveSetup(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var s = nvUpdateStudy_(ctx.klass.ClassId, ctx.teacher.email, payload.base, function (st) {
    if (payload.source !== undefined) { if (!NV_SOURCES[payload.source]) throw new Error('Choose Sora or your own copies.'); st.source = payload.source; }
    if (payload.book) {
      var b = payload.book, title = nvClean_(b.title, 200).trim();
      if (!title) throw new Error('Type the book’s title.');
      var sora = st.source === 'sora' ? nvCleanUrl_(b.soraUrl, 'The Sora link') : '';
      if (sora && !/soraapp\.com|overdrive\.com|libbyapp\.com/i.test(sora)) throw new Error('That doesn’t look like a Sora link. Open the book in Sora and copy the address (it starts with https://soraapp.com/).');
      var info = nvSoraInfo_(sora);
      if (info && info.notShareable) throw new Error('That Sora link is from your own shelf (Loans), so it only opens for you. Press “Fill in from Sora” to swap in the book’s own link, or open the book’s page in Sora and copy that address.');
      st.book = { title: title, author: nvClean_(b.author, 120).trim(), soraUrl: sora, soraTitleId: info ? info.titleId : '', soraLibrary: info ? info.library : '',
        access: st.source === 'sora' ? (NV_ACCESS[b.access] ? b.access : 'always') : '', audioUrl: st.source === 'sora' ? nvCleanUrl_(b.audioUrl, 'The audiobook link') : '',
        coverUrl: nvCleanUrl_(b.coverUrl, 'The cover link'), gradeBand: nvClean_(b.gradeBand, 10).trim(), printNote: nvClean_(b.printNote, 300).trim(),
        subtitle: nvClean_(b.subtitle, 200).trim(), narrator: st.source === 'sora' ? nvClean_(b.narrator, 120).trim() : '', format: st.source === 'sora' && /^(ebook|audiobook)$/.test(String(b.format || '')) ? b.format : '',
        publisher: nvClean_(b.publisher, 120).trim(), series: nvClean_(b.series, 120).trim(),
        levels: (Array.isArray(b.levels) ? b.levels : []).slice(0, 4).map(function (l) { return { name: nvClean_((l || {}).name, 30).trim(), value: nvClean_((l || {}).value, 20).trim() }; }).filter(function (l) { return l.name && l.value; }),
        edition: nvClean_(b.edition, 200).trim(), totalChapters: Math.max(0, Math.min(500, Math.floor(Number(b.totalChapters) || 0))) || '', totalPages: Math.max(0, Math.min(5000, Math.floor(Number(b.totalPages) || 0))) || '' };
      st.gradeBand = st.book.gradeBand;
    }
    if (Array.isArray(payload.highlightKey)) st.highlightKey = nvCleanKey_(payload.highlightKey);
    if (payload.structure !== undefined) { if (!NV_STRUCTURES[payload.structure]) throw new Error('Choose week by week, arcs or day by day.'); st.structure = payload.structure; }
    if (payload.unitCount !== undefined) {
      var n = Math.floor(Number(payload.unitCount));
      if (!(n >= 1 && n <= NV_MAX_UNITS)) throw new Error('Choose between 1 and ' + NV_MAX_UNITS + ' ' + nvUnitWord_(st).toLowerCase() + 's.');
      st.unitCount = n;
      // Fewer units: the extra ones are kept but hidden (never deleted -- students may have work in them).
      while (st.units.length < n) st.units.push(nvBlankUnit_(st.units.length + 1));
    }
    if (Array.isArray(payload.focusAreas)) st.focusAreas = payload.focusAreas.filter(function (f) { return NV_FOCUS.indexOf(f) >= 0; });
    if (payload.framework) {
      var fk = String(payload.framework.primary || ''), ok = NV_FRAMEWORKS.some(function (f) { return f.key === fk; });
      st.framework = payload.framework.mode === 'manual' && ok ? { mode: 'manual', primary: fk } : { mode: 'auto', primary: '' };
    }
    if (payload.schedule) {
      var sc = payload.schedule;
      st.schedule = { startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(sc.startDate || '')) ? sc.startDate : '', days: (Array.isArray(sc.days) ? sc.days : []).map(Number).filter(function (d) { return d >= 0 && d <= 6; }), autoOpen: sc.autoOpen === true };
      if (!st.schedule.days.length) st.schedule.days = [1, 2, 3, 4, 5];
    }
    if (payload.teaching) st.teaching = nvCleanTeaching_(payload.teaching, st.structure);
    if (payload.setupStep) st.setupStep = Math.max(Number(st.setupStep) || 1, Math.min(5, Math.floor(Number(payload.setupStep))));
  });
  nvSyncOpenOn_(ctx.klass.ClassId, s);
  return { ok: true, study: nvTeacherStudy_(s), choices: nvChoices_(), standards: nvStandardsPayload_(s) };
}
/** Step 4: the readings for every unit, and the activity tiles each unit starts with.
 *  pattern: [{type, points, graded}] -- applied to units that have no activities yet; with
 *  replace=true also to draft units (activities of the same type keep their id and content). */
function savePlan(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var s = nvUpdateStudy_(ctx.klass.ClassId, ctx.teacher.email, payload.base, function (st) {
    if (!st.book) throw new Error('Add the book first.');
    var colors = st.highlightKey.map(function (k) { return k.color; });
    if (payload.split) st.split = { mode: NV_SPLITS[payload.split.mode] ? payload.split.mode : 'custom', totalChapters: Math.floor(Number(payload.split.totalChapters) || 0) || '', totalPages: Math.floor(Number(payload.split.totalPages) || 0) || '' };
    (Array.isArray(payload.readings) ? payload.readings : []).forEach(function (r) {
      var n = Math.floor(Number(r.n)), u = nvUnit_(st, n); if (!u) return;
      u.reading = { label: nvClean_(r.label, 200).trim(), from: nvClean_(r.from, 30).trim(), to: nvClean_(r.to, 30).trim(), stopAt: nvClean_(r.stopAt !== undefined ? r.stopAt : (u.reading || {}).stopAt, 200).trim() };
      if (r.title !== undefined && (!u.title || r.overwriteTitle)) u.title = nvClean_(r.title, 120).trim();
      if (r.date !== undefined) u.date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : '';
    });
    if (Array.isArray(payload.pattern)) {
      st.pattern = payload.pattern.slice(0, 12).filter(function (p) { return p && NV_ACT[p.type]; }).map(function (p) {
        return { type: p.type, points: p.type === 'quiz' ? null : nvPoints_(p.points, NV_ACT[p.type].points), graded: p.graded !== false, count: p.type === 'quiz' ? Math.max(1, Math.min(15, Math.floor(Number(p.count) || 6))) : undefined };
      });
      for (var i = 1; i <= nvUnitCount_(st); i++) {
        var u2 = st.units[i - 1];
        if (u2.activities.length && !(payload.replace === true && u2.status !== 'approved')) continue;
        var used = {}, keep = u2.activities.slice();
        u2.activities = st.pattern.map(function (p) {
          var same = keep.filter(function (a) { return a.type === p.type && !used[a.id]; })[0];
          if (same) { used[same.id] = true; if (p.type !== 'quiz') same.points = p.points; same.graded = p.graded; return same; }
          return nvCleanActivity_({ type: p.type, points: p.points, graded: p.graded, count: p.count, title: NV_ACT[p.type].label }, used);
        });
        u2.focus = (u2.focus || []).filter(function (c) { return colors.indexOf(c) >= 0; });
      }
    }
    st.setupStep = Math.max(Number(st.setupStep) || 1, 5);
  });
  nvSyncOpenOn_(ctx.klass.ClassId, s);
  return { ok: true, study: nvTeacherStudy_(s) };
}
/** One unit, whole (the unit editor and the AI build both end here). approve: true/false/undefined. */
function saveUnit(payload) {
  payload = payload || {}; var ctx = nvTeacherClass_(String(payload.classId || ''));
  var n = Math.floor(Number(payload.unit && payload.unit.n)), problems = [], cleaned = null;
  var s = nvUpdateStudy_(ctx.klass.ClassId, ctx.teacher.email, payload.base, function (st) {
    if (!st.book) throw new Error('Add the book first.');
    var old = nvUnit_(st, n); if (!old) throw new Error('That ' + nvUnitWord_(st).toLowerCase() + ' isn’t in this study.');
    cleaned = nvCleanUnit_(payload.unit, n, st.highlightKey.map(function (k) { return k.color; }), old);
    problems = nvUnitProblems_(cleaned);
    if (payload.approve === true) cleaned.status = problems.length ? 'draft' : 'approved';
    else if (payload.approve === false) cleaned.status = 'draft';
    else cleaned.status = old.status === 'approved' && !problems.length ? 'approved' : 'draft';
    st.units[n - 1] = cleaned;
  });
  nvSyncOpenOn_(ctx.klass.ClassId, s);
  return { ok: true, study: nvTeacherStudy_(s), problems: problems, approved: cleaned.status === 'approved' };
}
/** Day-by-day studies can open each day by itself on its date: settings.openOn = {n: 'yyyy-mm-dd'}. */
function nvSyncOpenOn_(classId, s) {
  try {
    var want = {};
    if (s.schedule && s.schedule.autoOpen) for (var i = 1; i <= nvUnitCount_(s); i++) { var u = s.units[i - 1]; if (u && u.date) want[i] = u.date; }
    var cur = nvSettingsOf_(nvClass_(classId));
    if (JSON.stringify(cur.openOn || {}) === JSON.stringify(want)) return;
    nvUpdateSettings_(classId, function (st) { st.openOn = want; });
  } catch (e) { try { console.warn('openOn: ' + e.message); } catch (e2) {} }
}

// ============================================================================
// ITEMS (one per graded activity) AND RELEASE
// ============================================================================

function nvItemKey_(n, actId) { return 'w' + Number(n) + '_' + actId; }
function nvParseItemKey_(key) {
  var m = /^w(\d+)_([A-Za-z0-9_-]{1,40})$/.exec(String(key || ''));
  if (!m) throw new Error('Unknown assignment.');
  return { week: Number(m[1]), act: m[2], key: String(key) };
}
function nvActForm_(a) { return (NV_ACT[a.type] || NV_ACT.analysis).form; }
function nvActMax_(a) { return a.type === 'quiz' ? (a.mc || []).length : Number(a.points) || 0; }
function nvGradeType_(a) { return a.type === 'quiz' ? 'auto' : nvActMax_(a) === 7 ? 'rubric' : 'points'; }
/** Every graded activity of the approved units, in tile order. */
function nvItems_(s) {
  var out = [];
  for (var n = 1; n <= nvUnitCount_(s); n++) {
    var u = s.units[n - 1]; if (!u || u.status !== 'approved') continue;
    (u.activities || []).forEach(function (a) {
      if (a.graded === false || !nvActMax_(a)) return;
      out.push({ key: nvItemKey_(n, a.id), week: n, act: a.id, actType: a.type, kind: nvActForm_(a), type: nvGradeType_(a), max: nvActMax_(a),
        label: nvUnitLabel_(s, n) + ' · ' + a.title, kindLabel: a.title, unitLabel: nvUnitLabel_(s, n), icon: (NV_ACT[a.type] || {}).icon || '', weekTitle: u.title || '' });
    });
  }
  return out;
}
function nvToday_() { try { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Pacific/Honolulu', 'yyyy-MM-dd'); } catch (e) { return new Date().toISOString().slice(0, 10); } }
/** Open when the teacher turned it on; for day-by-day studies with automatic opening, also once its day comes
 *  (unless the teacher turned that one off). */
function nvReleased_(settings, key) {
  var r = (settings.release || {})[key];
  if (r === true) return true;
  if (r === false) return false;
  var m = /^w(\d+)_/.exec(String(key)), d = m ? (settings.openOn || {})[m[1]] : '';
  return !!(d && d <= nvToday_());
}
function nvUnitOpen_(settings, u) { return (u.activities || []).some(function (a) { return nvReleased_(settings, nvItemKey_(u.n, a.id)); }) || nvReleased_(settings, nvItemKey_(u.n, '_read')); }

// ============================================================================
// STUDENT: home, items, saving
// ============================================================================

/** What a student may see of a unit: no answer keys, no AI notes. */
function nvStudentUnit_(s, u, n, settings, teacherSelf) {
  var open = {}, due = {}, noGrade = {}, any = false;
  (u.activities || []).forEach(function (a) { var k = nvItemKey_(n, a.id); open[a.id] = nvReleased_(settings, k); due[a.id] = (settings.due || {})[k] || ''; noGrade[a.id] = !!(settings.noGrade || {})[k]; if (open[a.id]) any = true; });
  if (nvReleased_(settings, nvItemKey_(n, '_read'))) any = true;
  if (!any && !teacherSelf) return null;
  return { n: n, label: nvUnitLabel_(s, n), title: u.title, reading: u.reading, date: u.date, eq: u.eq, focus: u.focus || [], anyOpen: any, open: open, due: due, noGrade: noGrade,
    activities: (u.activities || []).map(function (a) {
      return { id: a.id, type: a.type, form: nvActForm_(a), icon: (NV_ACT[a.type] || {}).icon || '', title: a.title, prompt: a.prompt, directions: a.directions, points: nvActMax_(a), graded: a.graded !== false,
        gradeType: nvGradeType_(a), minWords: a.minWords || 0, words: a.words || [], mcCount: (a.mc || []).length };
    }) };
}
function getStudentHome(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, false);
  var settings = nvSettingsOf_(me.klass), s = nvStudyOf_(classId);
  var out = { ok: true, serverNow: new Date().toISOString(), today: nvToday_(), klass: nvPublicClass_(me.klass, false), me: { email: me.email, name: me.name, readOnly: !!me.readOnly, demo: !!me.demo, teacherSelf: !!me.teacherSelf },
    book: null, source: '', structure: 'weekly', unitWord: 'Week', highlightKey: [], units: [], status: {}, grades: {}, progress: {}, resume: null, access: NV_ACCESS };
  if (!s || !s.book || s._unreadable) return out;
  out.source = s.source || 'sora'; out.structure = s.structure; out.unitWord = nvUnitWord_(s);
  out.book = { title: s.book.title, author: s.book.author, soraUrl: s.book.soraUrl, access: s.book.access, audioUrl: s.book.audioUrl, coverUrl: s.book.coverUrl, printNote: s.book.printNote, edition: s.book.edition };
  out.highlightKey = s.highlightKey || [];
  for (var n = 1; n <= nvUnitCount_(s); n++) {
    var u = s.units[n - 1]; if (!u || u.status !== 'approved') continue;
    var su = nvStudentUnit_(s, u, n, settings, me.teacherSelf); if (su) out.units.push(su);
  }
  out.status = nvStudentStatus_(classId, me.email);
  out.grades = nvStudentGrades_(classId, me.email);
  out.progress = nvProgressOf_(classId, me.email);
  out.resume = nvResumeOf_(classId, me.email);
  return out;
}
/** Per item: none | draft | submitted (+ edited: turned in, then changed and not turned in again). */
function nvStudentStatus_(classId, email) {
  var out = {}, sh = nvSheet_('Work');
  nvReadRows_(sh, nvFindRowNums_(sh, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) {
    var key = nvItemKey_(r.Week, r.Kind), d = nvParseChunks_(r, 'DataJson', 3), has = nvHasWriting_(d), sub = !!r.SubmittedAt;
    var edited = sub && nvFp_(nvStable_(nvWorkPayload_(d))) !== String(r.SubFp || '');
    out[key] = { state: sub ? 'submitted' : (has ? 'draft' : 'none'), submittedAt: nvIso_(r.SubmittedAt), updatedAt: nvIso_(r.UpdatedAt), edited: edited && has };
  });
  var qs = nvSheet_('Quiz');
  nvReadRows_(qs, nvFindRowNums_(qs, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) {
    out[nvItemKey_(r.Week, r.ActId || 'quiz')] = { state: r.SubmittedAt ? 'submitted' : (r.StartedAt ? 'draft' : 'none'), score: r.SubmittedAt ? Number(r.Score) : null, max: Number(r.Max) || null, submittedAt: nvIso_(r.SubmittedAt) };
  });
  var ds = nvSheet_('Discuss');
  nvReadRows_(ds, nvFindRowNums_(ds, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId) && String(r.Text || '').trim(); }).forEach(function (r) {
    var key = nvItemKey_(r.Week, r.ActId || 'discussion'), o = out[key] || { state: 'none', posts: 0, replies: 0 };
    o.state = 'submitted'; if (r.ParentId) o.replies = (o.replies || 0) + 1; else o.posts = (o.posts || 0) + 1;
    out[key] = o;
  });
  return out;
}
function nvStudentGrades_(classId, email) {
  var out = {}, sh = nvSheet_('Grades');
  nvReadRows_(sh, nvFindRowNums_(sh, 'Email', email)).filter(function (r) { return String(r.ClassId) === String(classId); }).forEach(function (r) {
    out[String(r.ItemKey)] = { score: r.Score === '' || r.Score == null ? null : Number(r.Score), excluded: nvTruthy_(r.Excluded), comment: nvCellText_(r.Comment), gradedAt: nvIso_(r.GradedAt) };
  });
  return out;
}
function nvHasWriting_(v, depth) {
  depth = depth || 0;
  if (depth > 10 || v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v !== 'object') return false;
  return Object.keys(v).some(function (k) { return k.charAt(0) !== '_' && k !== 'color' && k !== 'id' && k !== 'src' && k !== 'inbox' && nvHasWriting_(v[k], depth + 1); });
}
/** Only the parts of a student's work the teacher grades (so bookkeeping never looks like a redo). */
function nvWorkPayload_(d) {
  d = d || {};
  var out = {};
  if (d.cards) out.cards = (d.cards || []).map(function (c) { return { color: c.color || '', loc: c.loc || '', text: c.text || '', why: c.why || '' }; });
  ['text', 'link', 'loc', 'passage', 'analysis'].forEach(function (k) { if (d[k] !== undefined && d[k] !== '') out[k] = d[k]; });
  if (d.rows) out.rows = (d.rows || []).map(function (r) { return { word: r.word || '', loc: r.loc || '', meaning: r.meaning || '', why: r.why || '' }; });
  return out;
}
/** Typing is never cut short silently: a box over its limit refuses the save with a plain message. */
function nvLimit_(v, n, label) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (s.length > n) throw new Error(label + ' is too long to save (' + s.length.toLocaleString() + ' characters; the limit is ' + n.toLocaleString() + '). Please shorten it. Nothing was changed.');
  return s;
}
function nvCleanWork_(form, data) {
  data = data || {};
  if (form === 'evidence') {
    var list = Array.isArray(data.cards) ? data.cards : [];
    if (list.length > 60) throw new Error('An Evidence Log holds up to 60 cards. Remove a few, then save again. Nothing was changed.');
    return { cards: list.map(function (c, i) {
      return { id: nvClean_(c.id, 40) || Utilities.getUuid().slice(0, 8), color: nvColor_(c.color), src: c.src === 'sora' ? 'sora' : '', loc: nvLimit_(c.loc, 120, 'A location'),
        text: nvLimit_(c.text, 2000, 'Evidence card ' + (i + 1)), why: nvLimit_(c.why, 4000, 'The “why it matters” on card ' + (i + 1)) };
    }), inbox: nvLimit_(data.inbox, 30000, 'The pasted notes') };
  }
  if (form === 'text') {
    var link = nvLimit_(data.link, 800, 'The link').trim();
    if (link && !/^https?:\/\//i.test(link)) throw new Error('A link must start with https://');
    return { text: nvLimit_(data.text, 120000, 'Your writing'), link: link };
  }
  if (form === 'close') return { loc: nvLimit_(data.loc, 120, 'The location'), passage: nvLimit_(data.passage, 3000, 'The passage'), analysis: nvLimit_(data.analysis, 60000, 'Your analysis') };
  if (form === 'vocab') {
    var rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length > 30) throw new Error('A vocabulary list holds up to 30 words.');
    return { rows: rows.map(function (r, i) { return { word: nvLimit_(r.word, 60, 'Word ' + (i + 1)), loc: nvLimit_(r.loc, 120, 'A location'), meaning: nvLimit_(r.meaning, 1000, 'A meaning'), why: nvLimit_(r.why, 2000, 'An explanation') }; }) };
  }
  throw new Error('This activity isn’t saved this way.');
}
/** The unit and activity a student call is about; refuses what isn't open (a teacher's own view sees all). */
function nvOpenAct_(me, n, actId) {
  var s = nvRequireStudy_(me.klass.ClassId), u = nvUnit_(s, n);
  if (!u || u.status !== 'approved') throw new Error('This isn’t ready yet.');
  var a = (u.activities || []).filter(function (x) { return x.id === String(actId); })[0];
  if (!a) throw new Error('That activity isn’t in this ' + nvUnitWord_(s).toLowerCase() + ' any more. Reload the page.');
  var settings = nvSettingsOf_(me.klass), key = nvItemKey_(n, a.id);
  if (!nvReleased_(settings, key) && !me.teacherSelf) throw new Error('Your teacher hasn’t opened this yet. Anything you already wrote is kept.');
  return { study: s, unit: u, act: a, form: nvActForm_(a), settings: settings, key: key, n: Number(n) };
}
function nvWorkRow_(classId, email, n, actId) { return nvFindOne_('Work', 'Email', { ClassId: classId, Email: email, Week: n, Kind: actId }); }

function getStudentItem(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, false);
  var n = Math.floor(Number(payload.week)), it = nvOpenAct_(me, n, payload.act);
  var out = { ok: true, key: it.key, form: it.form, act: it.act.id, week: n, loadedAt: new Date(Date.now() - 1500).toISOString(), readOnly: !!me.readOnly };
  if (it.form === 'quiz') out.quiz = nvQuizForStudent_(classId, me.email, n, it.act);
  else if (it.form === 'discussion') out.discussion = nvDiscussionFor_(classId, n, it.act.id, me.email, false);
  else {
    var r = nvWorkRow_(classId, me.email, n, it.act.id), d = nvParseChunks_(r, 'DataJson', 3);
    out.data = d._unreadable ? null : d; out.unreadable = !!d._unreadable;
    out.updatedAt = r ? nvIso_(r.UpdatedAt) : ''; out.submittedAt = r ? nvIso_(r.SubmittedAt) : '';
    out.subFp = r ? String(r.SubFp || '') : ''; out.fp = nvFp_(nvStable_(nvWorkPayload_(d)));
    out.stats = nvStatsOf_(classId, me.email, it.key);
  }
  out.grade = nvStudentGrades_(classId, me.email)[it.key] || null;
  out.excludedForClass = !!(it.settings.noGrade || {})[it.key];
  if (it.act.graded !== false) {
    if (nvGradeType_(it.act) === 'rubric') out.rubric = NV_RUBRIC;
    else if (nvGradeType_(it.act) === 'points') out.complete = nvCompleteRubric_(it.act);
  }
  return out;
}

/** Back up the old copy before it's replaced, when the replacement could lose something. Never throws. */
function nvBackup_(classId, email, n, kind, prevJson, nextJson, force) {
  try {
    prevJson = String(prevJson || '');
    if (!prevJson || prevJson === '{}') return false;
    var parsed = null, unreadable = false;
    try { parsed = JSON.parse(prevJson); } catch (e) { unreadable = true; }
    if (!unreadable && !nvHasWriting_(parsed)) return false;
    var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) {}
    var ck = 'nvbk:' + String(classId).slice(0, 8) + ':' + nvMd5_(email).slice(0, 10) + ':' + n + ':' + kind;
    var reason = force || (unreadable ? 'unreadable' : '');
    if (!reason && String(nextJson || '').length < prevJson.length * 0.8) reason = 'shorter';
    if (!reason) { var seen = null; try { seen = cache && cache.get(ck); } catch (e) {} if (!seen) reason = 'periodic'; }
    if (!reason) return false;
    var row = { ClassId: classId, Email: email, Week: n, Kind: kind, SavedAt: new Date(), Reason: reason, Chars: prevJson.length };
    var parts = nvSplit_('DataJson', 3, prevJson); Object.keys(parts).forEach(function (k) { row[k] = parts[k]; });
    nvAppend_(nvSheet_('WorkBackups'), row);
    try { if (cache && !force) cache.put(ck, '1', 600); } catch (e) {}
    return true;
  } catch (e) { try { console.warn('nvBackup_ failed: ' + (e && e.message)); } catch (e2) {} return false; }
}

/**
 * Autosave and Turn in for written activities. payload: {classId, week, act, data, base, submit, as}
 * base = the newest server time this tab has seen for this item. If the stored copy is newer, nothing
 * is written: {ok:false, stale:true, serverAt, server} -- and the newer copy is backed up first.
 */
function saveWork(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = nvOpenAct_(me, n, payload.act);
  if (['quiz', 'discussion'].indexOf(it.form) >= 0) throw new Error('This activity isn’t saved this way.');
  var data = nvCleanWork_(it.form, payload.data), json = JSON.stringify(data), actId = it.act.id;
  if (json.length > NV_CHUNK * 3) throw new Error('This is too long to save (' + Math.round(json.length / 1000) + 'k characters). Please shorten it. Nothing was changed.');
  var submit = payload.submit === true, base = String(payload.base || ''), result = null;
  nvUserLock_(function () {
    nvUpsert_('Work', 'Email', { ClassId: classId, Email: me.email, Week: n, Kind: actId }, function (r, now) {
      if (r) {
        var prev = nvParseChunks_(r, 'DataJson', 3), prevJson = nvJoin_(r, 'DataJson', 3);
        if (prev._unreadable) {
          nvBackup_(classId, me.email, n, actId, prevJson, json, 'unreadable');
          throw new Error('Your saved copy of this could not be read, so nothing was saved over it. Tell your teacher. (Your writing is still on this screen.)');
        }
        if (nvLater_(r.UpdatedAt, base) || (!base && nvHasWriting_(prev) && prevJson !== json)) {
          nvBackup_(classId, me.email, n, actId, prevJson, json, 'conflict');
          result = { ok: false, stale: true, serverAt: nvIso_(r.UpdatedAt), server: prev, submittedAt: nvIso_(r.SubmittedAt) };
          return null;
        }
        nvBackup_(classId, me.email, n, actId, prevJson, json, '');
      }
      var f = nvSplit_('DataJson', 3, json);
      f.UpdatedAt = now;
      if (submit) { Object.assign(f, nvSplit_('SubJson', 3, json)); f.SubmittedAt = now; f.SubFp = nvFp_(nvStable_(nvWorkPayload_(data))); }
      result = { ok: true, savedAt: now.toISOString(), submittedAt: submit ? now.toISOString() : (r ? nvIso_(r.SubmittedAt) : ''), subFp: submit ? f.SubFp : (r ? String(r.SubFp || '') : '') };
      return f;
    });
  });
  if (result && result.ok) result.fp = nvFp_(nvStable_(nvWorkPayload_(data)));
  return result;
}
function keepWorkCopy(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = nvOpenAct_(me, n, payload.act);
  var json = JSON.stringify(nvCleanWork_(it.form, payload.data));
  return { ok: nvBackup_(classId, me.email, n, it.act.id, json, '', String(payload.reason || 'kept-copy').slice(0, 30)) };
}

// ---------- writing stats (apart from the work: a stats save can never block a work save) ----------

function nvStatsOf_(classId, email, key) {
  var r = nvFindOne_('WritingStats', 'Email', { ClassId: classId, Email: email, ItemKey: key });
  return r ? (nvParse_(r.StatsJson, {}) || {}) : {};
}
function saveWritingStats(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me;
  try { me = nvActing_(classId, payload.as, true); } catch (e) { return { ok: true, skipped: true }; }
  if (!me.self && !me.demo) return { ok: true, skipped: true };
  var key = String(payload.key || ''); nvParseItemKey_(key);
  var inc = payload.stats || {};
  nvUserLock_(function () {
    nvUpsert_('WritingStats', 'Email', { ClassId: classId, Email: me.email, ItemKey: key }, function (r, now) {
      var cur = r ? (nvParse_(r.StatsJson, {}) || {}) : {};
      Object.keys(inc).slice(0, 60).forEach(function (box) {
        var a = cur[box] || {}, b = inc[box] || {};
        var pasted = (a.pasted || []).concat(b.pasted || []).map(function (p) { return nvClean_(p, 2000); }).filter(function (p, i, arr) { return p && arr.indexOf(p) === i; }).slice(-40);
        cur[box] = { ms: Math.max(Number(a.ms) || 0, Number(b.ms) || 0), sittings: Math.max(Number(a.sittings) || 0, Number(b.sittings) || 0),
          pastes: Math.max(Number(a.pastes) || 0, Number(b.pastes) || 0), pastedChars: Math.max(Number(a.pastedChars) || 0, Number(b.pastedChars) || 0),
          blocked: Math.max(Number(a.blocked) || 0, Number(b.blocked) || 0), pasted: pasted, last: Math.max(Number(a.last) || 0, Number(b.last) || 0) };
      });
      var json = JSON.stringify(cur);
      if (json.length > NV_CELL_MAX) return null;
      return { StatsJson: json, UpdatedAt: now };
    });
  });
  return { ok: true };
}

// ---------- reading check-ins + "I have the book" ----------

function nvProgressOf_(classId, email) {
  var r = nvFindOne_('Progress', 'Email', { ClassId: classId, Email: email });
  return r ? { borrowedAt: nvIso_(r.BorrowedAt), weeks: nvParse_(r.ReadingJson, {}) || {} } : { borrowedAt: '', weeks: {} };
}
function saveProgress(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true), out = null;
  nvUserLock_(function () {
    nvUpsert_('Progress', 'Email', { ClassId: classId, Email: me.email }, function (r, now) {
      var weeks = r ? (nvParse_(r.ReadingJson, {}) || {}) : {}, f = { UpdatedAt: now };
      if (payload.borrowed === true) f.BorrowedAt = now;
      if (payload.borrowed === false) f.BorrowedAt = '';
      if (payload.week) {
        var n = String(Math.floor(Number(payload.week)));
        weeks[n] = { status: ['none', 'partway', 'done'].indexOf(payload.status) >= 0 ? payload.status : 'none', where: nvClean_(payload.where, 60).trim(), at: now.toISOString() };
        f.ReadingJson = JSON.stringify(weeks);
      }
      out = { borrowedAt: f.BorrowedAt !== undefined ? nvIso_(f.BorrowedAt) : (r ? nvIso_(r.BorrowedAt) : ''), weeks: weeks };
      return f;
    });
  });
  return { ok: true, progress: out };
}

// ---------- resume (a teacher's viewing never moves it) ----------

function nvResumeOf_(classId, email) {
  var r = nvFindOne_('Resume', 'Email', { ClassId: classId, Email: email });
  return r ? nvParse_(r.RouteJson, null) : null;
}
function saveResume(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me;
  try { me = nvActing_(classId, payload.as, false); } catch (e) { return { ok: true, skipped: true }; }
  if (!me.self && !me.demo) return { ok: true, skipped: true };
  var route = payload.route || {};
  var clean = { view: ['home', 'week'].indexOf(route.view) >= 0 ? route.view : 'home', week: Math.max(0, Math.floor(Number(route.week) || 0)), step: nvClean_(route.step, 40) };
  nvUserLock_(function () { nvUpsert_('Resume', 'Email', { ClassId: classId, Email: me.email }, { RouteJson: JSON.stringify(clean), UpdatedAt: new Date() }); });
  return { ok: true };
}

// ============================================================================
// QUIZ (scored on the server: 1 point right the first try, 0.5 the second, 0 after)
// ============================================================================

function nvQuizRow_(classId, email, n, actId) { return nvFindOne_('Quiz', 'Email', { ClassId: classId, Email: email, Week: n, ActId: actId }); }
function nvQuizForStudent_(classId, email, n, a) {
  var r = nvQuizRow_(classId, email, n, a.id), ans = r ? (nvParse_(r.AnswersJson, {}) || {}) : {};
  return {
    questions: (a.mc || []).map(function (q) {
      var x = ans[q.id] || { tries: [], state: 'open', points: 0 }, closed = x.state !== 'open';
      var o = { id: q.id, q: q.q, choices: q.choices, tries: x.tries || [], state: x.state || 'open', points: Number(x.points) || 0 };
      if (closed) { o.answer = q.answer; o.why = q.why; }
      return o;
    }),
    score: r && r.SubmittedAt ? Number(r.Score) : null, max: (a.mc || []).length, submittedAt: r ? nvIso_(r.SubmittedAt) : ''
  };
}
function answerQuiz(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = nvOpenAct_(me, n, payload.act), a = it.act;
  if (it.form !== 'quiz') throw new Error('That isn’t a quiz.');
  var q = (a.mc || []).filter(function (x) { return x.id === String(payload.qid); })[0];
  if (!q) throw new Error('That question changed. Reload the quiz.');
  var pick = Math.floor(Number(payload.pick)); if (!(pick >= 0 && pick <= 3)) throw new Error('Choose an answer.');
  var out = null;
  nvUserLock_(function () {
    nvUpsert_('Quiz', 'Email', { ClassId: classId, Email: me.email, Week: n, ActId: a.id }, function (r, now) {
      var ans = r ? (nvParse_(r.AnswersJson, {}) || {}) : {}, x = ans[q.id] || { tries: [], state: 'open', points: 0 };
      if (x.state !== 'open' || (r && r.SubmittedAt) || x.tries.indexOf(pick) >= 0) { out = { already: true, state: x.state, tries: x.tries, points: x.points }; return null; }
      x.tries.push(pick);
      if (pick === q.answer) { x.state = 'right'; x.points = x.tries.length === 1 ? 1 : 0.5; }
      else if (x.tries.length >= 2) { x.state = 'missed'; x.points = 0; }
      ans[q.id] = x;
      var all = (a.mc || []).every(function (y) { return ans[y.id] && ans[y.id].state !== 'open'; });
      var score = (a.mc || []).reduce(function (sum, y) { return sum + (ans[y.id] ? Number(ans[y.id].points) || 0 : 0); }, 0);
      out = { state: x.state, tries: x.tries, points: x.points, finished: all, score: all ? score : null, max: (a.mc || []).length };
      return { AnswersJson: JSON.stringify(ans), Score: all ? score : '', Max: (a.mc || []).length, StartedAt: r && r.StartedAt ? r.StartedAt : now, SubmittedAt: all ? now : '', UpdatedAt: now };
    });
  });
  if (out.state !== 'open') { out.answer = q.answer; out.why = q.why; }
  return Object.assign({ ok: true, qid: q.id }, out);
}

// ============================================================================
// DISCUSSION (posts are appended; a student sees classmates' posts after posting once)
// ============================================================================

function nvDiscussionFor_(classId, n, actId, email, teacher) {
  var sh = nvSheet_('Discuss');
  var rows = nvReadRows_(sh, nvFindRowNums_(sh, 'ClassId', classId)).filter(function (r) { return Number(r.Week) === Number(n) && String(r.ActId || 'discussion') === String(actId) && String(r.Text || '').trim(); });
  var mine = rows.some(function (r) { return nvNorm_(r.Email) === nvNorm_(email) && !r.ParentId; });
  var posts = rows.map(function (r) {
    return { id: String(r.PostId), email: nvNorm_(r.Email), name: nvCellText_(r.Name), parentId: String(r.ParentId || ''), text: nvCellText_(r.Text), createdAt: nvIso_(r.CreatedAt), editedAt: nvIso_(r.EditedAt), mine: nvNorm_(r.Email) === nvNorm_(email) };
  });
  if (!teacher && !mine) posts = posts.filter(function (p) { return p.mine; });
  if (!teacher) posts.forEach(function (p) { if (!p.mine) delete p.email; });
  return { posts: posts, unlocked: teacher || mine, count: rows.filter(function (r) { return !r.ParentId; }).length };
}
function postDiscussion(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true);
  var n = Math.floor(Number(payload.week)), it = nvOpenAct_(me, n, payload.act);
  if (it.form !== 'discussion') throw new Error('That isn’t a discussion.');
  var text = nvClean_(payload.text, 8000).trim(); if (!text) throw new Error('Write something first.');
  var parentId = String(payload.parentId || ''), clientId = nvClean_(payload.clientId, 60), sh = nvSheet_('Discuss');
  nvUserLock_(function () {
    if (clientId && nvFindRowNums_(sh, 'ClientId', clientId).length) return;   // a retry is stored once
    if (parentId && !nvFindRowNums_(sh, 'PostId', parentId).length) throw new Error('That post is gone. Reload the discussion.');
    nvAppend_(sh, { PostId: Utilities.getUuid(), ClassId: classId, Week: n, Email: me.email, Name: me.name, ParentId: parentId, Text: text, CreatedAt: new Date(), EditedAt: '', ClientId: clientId, ActId: it.act.id });
  });
  return { ok: true, discussion: nvDiscussionFor_(classId, n, it.act.id, me.email, false) };
}
function editDiscussion(payload) {
  payload = payload || {}; var classId = String(payload.classId || ''), me = nvActing_(classId, payload.as, true);
  var text = nvClean_(payload.text, 8000).trim(); if (!text) throw new Error('A post can’t be empty.');
  var n = 0, actId = '';
  nvUserLock_(function () {
    nvUpsert_('Discuss', 'PostId', { PostId: String(payload.postId || '') }, function (r, now) {
      if (!r || nvNorm_(r.Email) !== me.email || String(r.ClassId) !== classId) throw new Error('You can only edit your own posts.');
      n = Number(r.Week); actId = String(r.ActId || 'discussion');
      return { Text: text, EditedAt: now };
    });
  });
  nvOpenAct_(me, n, actId);
  return { ok: true, discussion: nvDiscussionFor_(classId, n, actId, me.email, false) };
}
