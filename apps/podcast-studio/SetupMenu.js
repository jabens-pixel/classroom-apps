/**
 * "Set up my app" — guided setup for a teacher's copy of this app.
 *
 * This file is added to the PUBLIC copy by public-release-tools/build-public-copy.js.
 * It is not part of Jaben's classroom version.
 *
 * In the copied Google Sheet: Classroom App ▸ Set up my app.
 *   1. makes this Sheet the app's backend and makes the teacher the admin (automatic),
 *   2. shows 5 short steps to publish the app as a web app (Google only lets the owner do this), and
 *   3. saves the student link the teacher pastes back, so it can be found again.
 * Until a copy is set up, opening the Sheet shows a note (bottom right) that explains Google's
 * "hasn't verified this app" screen before the teacher meets it (2026-10-29). School accounts often
 * skip that screen (seen 2026-10-31), so the note says "if". Setup replaces the note when it finishes.
 * Running it again is safe: the setup keeps the existing data.
 */
var CAS_APP = {"title":"Podcast Studio","setup":"setupPodcastStudio","dbProp":"PODCAST_STUDIO_DB_ID"};
var CAS_PROP_URL = 'CLASSROOM_APP_STUDENT_URL';
var CAS_PROP_FOR = 'CLASSROOM_APP_SET_UP_FOR';   // the script these settings belong to (a copied Sheet brings the old ones along)

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Classroom App')
    .addItem('Set up my app', 'classroomAppSetup')
    .addItem('Show my student link', 'classroomAppShowLink')
    .addToUi();
  // Until this copy is set up: warn about Google's "hasn't verified this app" screen before it appears.
  // (Runs as a simple trigger: no permission needed, and it must never stop the menu from showing.)
  try {
    if (PropertiesService.getScriptProperties().getProperty(CAS_PROP_FOR) !== ScriptApp.getScriptId()) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        // Keep it this short: Sheets cuts a longer note off at the bottom of the window (checked 2026-10-29).
        'If Google says it “hasn’t verified this app,” that’s normal for your copy: Advanced ▸ Go to … (unsafe) ▸ Allow.',
        'Next: Classroom App ▸ Set up my app', -1);
    }
  } catch (e) {}
}

/** Menu: Classroom App ▸ Set up my app */
function classroomAppSetup() {
  var props = PropertiesService.getScriptProperties();
  try {
    var ss = null;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
    if (props.getProperty(CAS_PROP_FOR) !== ScriptApp.getScriptId()) {
      // A fresh copy: forget every setting that came along from the Sheet it was copied from
      // (database, student link, folders, admin). A key the teacher added themselves is kept.
      var keep = { GEMINI_API_KEY: true };
      props.getKeys().forEach(function (k) { if (!keep[k]) props.deleteProperty(k); });
    }
    if (CAS_APP.dbProp && ss && !props.getProperty(CAS_APP.dbProp)) props.setProperty(CAS_APP.dbProp, ss.getId());
    if (CAS_APP.setup && typeof globalThis[CAS_APP.setup] === 'function') globalThis[CAS_APP.setup]();
    props.setProperty(CAS_PROP_FOR, ScriptApp.getScriptId());
    // Replace the "Next: Set up my app" note: it never closes on its own and covers the side panel's Save button.
    if (ss) try { ss.toast('Now publish it: follow the steps in the side panel.', 'Setup done', 5); } catch (e) {}
  } catch (err) {
    Logger.log('Set up my app: ' + (err && err.message));
    casShow_(casProblemHtml_(err), 'Setup needs a hand');
    return '';
  }
  var url = casSavedUrl_();
  if (url) casShow_(casDoneHtml_(url, true), 'Your app is ready'); else casSide_(casPublishHtml_(), 'Publish it for students');
  return url;
}

/** Menu: Classroom App ▸ Show my student link */
function classroomAppShowLink() {
  var url = casSavedUrl_();
  if (url) casShow_(casDoneHtml_(url, false), 'Student link'); else casSide_(casPublishHtml_(), 'Publish it for students');
  return url;
}

/** Called from the box when the teacher pastes the web-app link. */
function classroomAppSaveLink(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(url)) {
    throw new Error(/\/dev(\?|$)/.test(url)
      ? 'That is the test link (it ends in /dev). Use the Web app link from the Deploy box. It ends in /exec.'
      : 'That doesn’t look like a web-app link. It starts with https://script.google.com/ and ends in /exec.');
  }
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CAS_PROP_FOR) !== ScriptApp.getScriptId()) throw new Error('Click Classroom App ▸ Set up my app first, then paste the link again.');
  props.setProperty(CAS_PROP_URL, url);
  return url;
}

/** The link the teacher saved for THIS copy (never one copied from another Sheet). */
function casSavedUrl_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CAS_PROP_FOR) !== ScriptApp.getScriptId()) return '';
  return props.getProperty(CAS_PROP_URL) || '';
}

// ---------------- the boxes the teacher sees ----------------
function casEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
var CAS_STYLE = '<style>body{font:14px/1.45 Arial,sans-serif;color:#1f1b16;margin:0}h2{font-size:17px;margin:0 0 6px}' +
  'input{width:100%;box-sizing:border-box;padding:8px;font:13px monospace;border:1px solid #c9bfae;border-radius:4px}' +
  '.row{display:flex;gap:8px;margin:10px 0;align-items:center}.btn{display:inline-block;padding:7px 13px;border-radius:4px;border:1px solid #7d2235;background:#7d2235;color:#fff;text-decoration:none;font-weight:bold;cursor:pointer;font-size:13px}' +
  '.btn.light{background:#fff;color:#7d2235}ol{padding-left:20px;margin:6px 0}li{margin-bottom:5px}.small{color:#5f574c;font-size:12.5px}' +
  '.ok{color:#2e6b2e;font-weight:bold}.err{color:#a3261b}.k{background:#f3efe7;border:1px solid #ddd3c2;border-radius:3px;padding:0 4px;white-space:nowrap}</style>';

function casPublishHtml_() {
  var who = '';
  try { who = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  var editor = 'https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit' + (who ? '?authuser=' + encodeURIComponent(who) : '');
  return CAS_STYLE + '<h2>✓ Setup done. Now publish it (about a minute)</h2>' +
    '<p class="small">Google only lets the owner publish an app, so this part is yours. You only do it once. Keep this panel open while you work.</p>' +
    '<ol><li>In this Sheet’s menu, click <span class="k">Extensions</span> ▸ <span class="k">Apps Script</span>. The app’s code page opens in a new tab. ' +
    '<span class="small">(Or <a href="' + casEsc_(editor) + '" target="_blank">open it here</a>.)</span></li>' +
    '<li>Click the blue <span class="k">Deploy</span> button (top right) ▸ <span class="k">New deployment</span>.</li>' +
    '<li><span class="k">Web app</span> is usually chosen already. If not, click the gear ⚙ next to “Select type” ▸ <span class="k">Web app</span>.</li>' +
    '<li>Set <b>Execute as</b> to <span class="k">Me</span> and <b>Who has access</b> to <span class="k">Anyone within your school</span>. Click <span class="k">Deploy</span> (approve again if Google asks).</li>' +
    '<li>Copy the <b>Web app</b> link (it ends in <b>/exec</b>) and paste it here:</li></ol>' +
    '<input id="u" placeholder="https://script.google.com/…/exec">' +
    '<div class="row"><button class="btn" id="b" onclick="save()">Save my student link</button><span id="m" class="small"></span></div>' +
    '<script>function save(){var m=document.getElementById("m"),b=document.getElementById("b");b.disabled=true;m.className="small";m.textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(u){m.className="ok";m.innerHTML="Saved. Share this link with your students. Find it again any time under Classroom App ▸ Show my student link.";b.textContent="Saved";})' +
    '.withFailureHandler(function(e){b.disabled=false;m.className="err";m.textContent=e.message;}).classroomAppSaveLink(document.getElementById("u").value);}</script>';
}

function casDoneHtml_(url, again) {
  return CAS_STYLE + '<h2>' + casEsc_(CAS_APP.title) + ' is ready</h2>' +
    (again ? '<p class="small">Setup ran again. Your students’ work and your student link are unchanged.</p>' : '') +
    '<p>Share this link with your students (in Canvas, Google Classroom or your class page):</p>' +
    '<input id="u" readonly value="' + casEsc_(url) + '" onclick="this.select()">' +
    '<div class="row"><button class="btn" onclick="var u=document.getElementById(\'u\');u.select();document.execCommand(\'copy\');this.textContent=\'Copied\'">Copy link</button>' +
    '<a class="btn light" href="' + casEsc_(url) + '" target="_blank">Open my app</a></div>' +
    '<p class="small">Open it yourself first and make a class. You’re the admin, so you’ll see the teacher tools.</p>' +
    '<p class="small"><b>After an update:</b> on the code page, click <span class="k">Deploy</span> ▸ <span class="k">Manage deployments</span> ▸ the pencil ✎ ▸ Version: <span class="k">New version</span> ▸ <span class="k">Deploy</span>. The student link stays the same.</p>';
}

function casProblemHtml_(err) {
  return CAS_STYLE + '<h2>Setup didn’t finish</h2>' +
    '<p>Google said: <i>' + casEsc_(err && err.message) + '</i></p>' +
    '<p>Make sure you’re signed in with your school Google account, then try <b>Classroom App ▸ Set up my app</b> again.</p>';
}

function casShow_(html, title) {
  try { SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(470), title); }
  catch (e) { Logger.log(title + ': ' + String(html).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); }
}
/** A side panel, so the Sheet's menus still work while the steps stay on screen. */
function casSide_(html, title) {
  try { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle(title)); }
  catch (e) { casShow_(html, title); }
}
