/**
 * "Set up my app" — one-click setup for a teacher's copy of this app.
 *
 * This file is added to the PUBLIC copy by public-release-tools/build-public-copy.js.
 * It is not part of Jaben's classroom version.
 *
 * In the copied Google Sheet: Classroom App ▸ Set up my app.
 *   1. makes this Sheet the app's backend and makes the teacher the admin (the app's own setup),
 *   2. publishes the app as a web app through Google's Apps Script API, and
 *   3. shows the student link.
 * Running it again keeps the same student link and publishes the latest code to it.
 */
var CAS_APP = {"title":"Macbeth Curriculum","setup":"setupMacbethBackend","dbProp":"MACBETH_DB_ID"};
var CAS_PROP_DEPLOY = 'CLASSROOM_APP_DEPLOYMENT_ID';
var CAS_PROP_URL = 'CLASSROOM_APP_STUDENT_URL';
var CAS_API_SETTINGS = 'https://script.google.com/home/usersettings';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Classroom App')
    .addItem('Set up my app', 'classroomAppSetup')
    .addItem('Show my student link', 'classroomAppShowLink')
    .addToUi();
}

/** Menu: Classroom App ▸ Set up my app */
function classroomAppSetup() {
  var props = PropertiesService.getScriptProperties();
  var step = 'setup';
  try {
    // 1. This Sheet becomes the app's backend, unless the app already has one.
    var ss = null;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
    if (CAS_APP.dbProp && ss && !props.getProperty(CAS_APP.dbProp)) props.setProperty(CAS_APP.dbProp, ss.getId());
    if (CAS_APP.setup && typeof globalThis[CAS_APP.setup] === 'function') globalThis[CAS_APP.setup]();
    // 2. Publish as a web app.
    step = 'publish';
    var url = casPublish_(props);
    casShow_(casDoneHtml_(url), 'Your app is ready');
    return url;
  } catch (err) {
    var html = step === 'publish' && err.casApiOff ? casApiOffHtml_() : casProblemHtml_(step, err);
    casShow_(html, step === 'publish' && err.casApiOff ? 'One switch to turn on' : 'Setup needs a hand');
    Logger.log('Set up my app (' + step + '): ' + (err && err.message));
    return '';
  }
}

/** Menu: Classroom App ▸ Show my student link */
function classroomAppShowLink() {
  var url = PropertiesService.getScriptProperties().getProperty(CAS_PROP_URL) || '';
  if (!url) { try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {} }
  casShow_(url ? casDoneHtml_(url) : '<p>The app isn’t set up yet. Click <b>Classroom App ▸ Set up my app</b>.</p>', 'Student link');
  return url;
}

/** Creates a new version and puts it on the app's web-app deployment (made the first time). */
function casPublish_(props) {
  var id = ScriptApp.getScriptId();
  var base = 'https://script.googleapis.com/v1/projects/' + id;
  var token = ScriptApp.getOAuthToken();
  function call(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
    if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    var res = UrlFetchApp.fetch(base + path, opts);
    var code = res.getResponseCode(), text = res.getContentText(), json = {};
    try { json = JSON.parse(text); } catch (e) {}
    if (code >= 300) {
      var msg = (json.error && json.error.message) || text || ('HTTP ' + code);
      var err = new Error(msg);
      err.casCode = code;
      err.casApiOff = code === 403 && /Apps Script API|usersettings/i.test(msg);
      throw err;
    }
    return json;
  }
  var version = call('post', '/versions', { description: 'Set up my app · ' + new Date().toISOString().slice(0, 10) });
  var config = { scriptId: id, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: 'Student link' };
  var depId = props.getProperty(CAS_PROP_DEPLOY), dep = null;
  if (depId) {
    try { dep = call('put', '/deployments/' + depId, { deploymentConfig: config }); }
    catch (e) { if (e.casApiOff) throw e; dep = null; }   // deleted by hand: make a new one
  }
  if (!dep) dep = call('post', '/deployments', { versionNumber: config.versionNumber, manifestFileName: 'appsscript', description: 'Student link' });
  var url = '';
  (dep.entryPoints || []).forEach(function (ep) { if (ep.entryPointType === 'WEB_APP' && ep.webApp && ep.webApp.url) url = ep.webApp.url; });
  if (!url) throw new Error('Google published the app but didn’t return a web-app link. Is the "webapp" section missing from appsscript.json?');
  props.setProperty(CAS_PROP_DEPLOY, dep.deploymentId);
  props.setProperty(CAS_PROP_URL, url);
  return url;
}

// ---------------- the boxes the teacher sees ----------------
function casEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
var CAS_STYLE = '<style>body{font:14px/1.5 Arial,sans-serif;color:#1f1b16;margin:0}h2{font-size:18px;margin:0 0 8px}' +
  'input{width:100%;box-sizing:border-box;padding:8px;font:13px monospace;border:1px solid #c9bfae;border-radius:4px}' +
  '.row{display:flex;gap:8px;margin:10px 0}.btn{display:inline-block;padding:8px 14px;border-radius:4px;border:1px solid #7d2235;background:#7d2235;color:#fff;text-decoration:none;font-weight:bold;cursor:pointer}' +
  '.btn.light{background:#fff;color:#7d2235}ol{padding-left:20px;margin:6px 0}li{margin-bottom:4px}.small{color:#5f574c;font-size:12.5px}</style>';

function casDoneHtml_(url) {
  return CAS_STYLE + '<h2>' + casEsc_(CAS_APP.title) + ' is ready</h2>' +
    '<p>Share this link with your students (in Canvas, Google Classroom or your class page):</p>' +
    '<input id="u" readonly value="' + casEsc_(url) + '" onclick="this.select()">' +
    '<div class="row"><button class="btn" onclick="var u=document.getElementById(\'u\');u.select();document.execCommand(\'copy\');this.textContent=\'Copied\'">Copy link</button>' +
    '<a class="btn light" href="' + casEsc_(url) + '" target="_blank">Open my app</a></div>' +
    '<p class="small">Open it yourself first: you’ll see the Teacher button at the top, where you can make a class. ' +
    'You can find this link again any time under <b>Classroom App ▸ Show my student link</b>.</p>';
}
function casApiOffHtml_() {
  return CAS_STYLE + '<h2>Turn on one Google setting</h2>' +
    '<p>Your app is set up. To publish it for students, Google needs the Apps Script API switched on for your account (this only needs doing once).</p>' +
    '<ol><li><a href="' + CAS_API_SETTINGS + '" target="_blank">Open your Apps Script settings</a>.</li>' +
    '<li>Turn on <b>Google Apps Script API</b>.</li>' +
    '<li>Come back here, close this box, and click <b>Classroom App ▸ Set up my app</b> again.</li></ol>' +
    '<p class="small">If the switch is greyed out, your school has turned it off. Use the manual steps instead: ' + casManualSteps_() + '</p>';
}
function casProblemHtml_(step, err) {
  return CAS_STYLE + '<h2>' + (step === 'setup' ? 'Setup didn’t finish' : 'Publishing didn’t finish') + '</h2>' +
    '<p>Google said: <i>' + casEsc_(err && err.message) + '</i></p>' +
    (step === 'setup'
      ? '<p>Make sure you’re signed in with your school Google account, then try <b>Classroom App ▸ Set up my app</b> again.</p>'
      : '<p>Your app is set up, but it isn’t published yet. Try again, or publish it by hand: ' + casManualSteps_() + '</p>');
}
function casManualSteps_() {
  return 'Extensions ▸ Apps Script ▸ <b>Deploy ▸ New deployment</b> ▸ type <b>Web app</b>, execute as <b>Me</b>, ' +
    'who has access <b>anyone in your school</b> ▸ <b>Deploy</b>, then copy the web-app link.';
}
function casShow_(html, title) {
  try { SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(330), title); }
  catch (e) { Logger.log(title + ': ' + String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); }   // run from the editor
}
