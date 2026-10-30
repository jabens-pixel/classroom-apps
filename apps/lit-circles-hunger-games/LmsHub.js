// ===========================================================================
// LmsHub.gs -- talk to your LMS Hub from any Apps Script app.
//
// Add this file to an app (Macbeth, Short Story Lab, Number the Stars ...),
// then in Project Settings > Script Properties add:
//   LMS_HUB_URL   https://lms-hub.<your-subdomain>.workers.dev
//   LMS_HUB_KEY   the hub_... key the hub gave this app
//
// It uses UrlFetchApp, which needs the script.external_request scope. An app
// that already pushes to Canvas has that scope, so adding this file asks for
// no new permission. A brand-new app: run testLmsHub() from the editor FIRST
// (so the permission prompt appears in a normal tab, not inside the app's
// iframe), then deploy.
// ===========================================================================

var LmsHub = (function () {
  var enc = encodeURIComponent;

  function config_() {
    var p = PropertiesService.getScriptProperties();
    var url = String(p.getProperty('LMS_HUB_URL') || '').trim().replace(/\/+$/, '');
    var key = String(p.getProperty('LMS_HUB_KEY') || '').trim();
    if (!url || !key) throw new Error('LMS Hub is not set up: add LMS_HUB_URL and LMS_HUB_KEY in Project Settings > Script Properties.');
    return { url: url, key: key };
  }

  function teacher_(teacher) {
    var t = String(teacher || Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!t) throw new Error('Could not tell which teacher is signed in.');
    return t;
  }

  // One call to the hub. Throws an Error whose .hubCode says what went wrong
  // (not_connected, class_not_linked, lms_unauthorized, reconnect_needed ...).
  function request_(method, path, body, teacher, appOnly) {
    var c = config_();
    var headers = { Authorization: 'Bearer ' + c.key, Accept: 'application/json' };
    if (!appOnly) headers['X-Hub-Teacher'] = teacher_(teacher);
    var opt = { method: method, headers: headers, muteHttpExceptions: true, followRedirects: false };
    if (body !== undefined) {
      opt.contentType = 'application/json';
      opt.payload = JSON.stringify(body);
    }
    var res = UrlFetchApp.fetch(c.url + path, opt);
    var code = res.getResponseCode();
    var text = res.getContentText();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = { ok: false, error: { message: 'LMS Hub ' + code + ': ' + text.slice(0, 300) } }; }
    if (code < 200 || code >= 300 || data.ok === false) {
      var err = new Error((data.error && data.error.message) || ('LMS Hub returned ' + code + '.'));
      err.hubCode = data.error && data.error.code;
      err.status = code;
      err.lmsStatus = data.error && data.error.lmsStatus;
      throw err;
    }
    return data;
  }

  // Grade push with automatic continuation: if the hub runs out of LMS calls
  // for one request (big class on Cloudflare's free plan), it returns the
  // students still pending and this sends just those again.
  function pushGrades_(classId, key, spec, rows, teacher, options) {
    var path = '/v1/classes/' + enc(classId) + '/assignments/' + enc(key) + '/grades';
    var body = { assignment: spec, rows: rows, createIfMissing: !(options && options.createIfMissing === false) };
    var total = null;
    for (var round = 0; round < 12; round++) {
      var r = request_('post', path, body, teacher);
      if (!total) {
        total = r;
      } else {
        total.sent += r.sent;
        total.feedbackPosted += r.feedbackPosted;
        total.feedbackSkipped += r.feedbackSkipped;
        total.unmatched = total.unmatched.concat(r.unmatched);
        total.failed = total.failed.concat(r.failed);
        total.feedbackFailed = total.feedbackFailed.concat(r.feedbackFailed);
        total.feedbackDeferred = total.feedbackDeferred.concat(r.feedbackDeferred);
        r.warnings.forEach(function (w) { if (total.warnings.indexOf(w) === -1) total.warnings.push(w); });
        total.pointsConflict = total.pointsConflict || r.pointsConflict;
        total.assignment = r.assignment;
        total.sharedWith = r.sharedWith;
        total.progressUrl = r.progressUrl || total.progressUrl;
        total.callsUsed += r.callsUsed;
      }
      total.pending = r.pending;
      total.rounds = round + 1;
      if (!r.pending || !r.pending.length) break;
      var waiting = {};
      r.pending.forEach(function (e) { waiting[e] = true; });
      body.rows = rows.filter(function (row) { return waiting[String(row.email).toLowerCase()]; });
      body.createIfMissing = false; // it exists now
    }
    return total;
  }

  return {
    request: request_,
    pushGrades: pushGrades_,

    me: function (teacher) { return request_('get', '/v1/me', undefined, teacher); },

    // A link the teacher opens in a new tab to connect Canvas / Schoology / Google Classroom.
    connectLink: function (platform, teacher) { return request_('post', '/v1/connect-links', platform ? { platform: platform } : {}, teacher); },
    connections: function (check, teacher) { return request_('get', '/v1/connections' + (check ? '?check=1' : ''), undefined, teacher); },
    // Server-to-server connect: {platform:'canvas', baseUrl, token} or {platform:'schoology', consumerKey, consumerSecret}
    saveConnection: function (payload, teacher) { return request_('post', '/v1/connections', payload, teacher); },
    removeConnection: function (platform, teacher) { return request_('delete', '/v1/connections/' + enc(platform), undefined, teacher); },

    courses: function (platform, teacher) { return request_('get', '/v1/courses?platform=' + enc(platform), undefined, teacher); },
    groups: function (platform, courseId, teacher) { return request_('get', '/v1/courses/' + enc(platform) + '/' + enc(courseId) + '/groups', undefined, teacher); },
    placements: function (platform, courseId, teacher) { return request_('get', '/v1/courses/' + enc(platform) + '/' + enc(courseId) + '/placements', undefined, teacher); },
    students: function (platform, courseId, teacher) { return request_('get', '/v1/courses/' + enc(platform) + '/' + enc(courseId) + '/students', undefined, teacher); },

    getClassLink: function (classId, teacher) { return request_('get', '/v1/classes/' + enc(classId) + '/link', undefined, teacher); },
    // link: {platform, courseId, groupId}
    linkClass: function (classId, link, teacher) { return request_('put', '/v1/classes/' + enc(classId) + '/link', link, teacher); },
    unlinkClass: function (classId, teacher) { return request_('delete', '/v1/classes/' + enc(classId) + '/link', undefined, teacher); },
    roster: function (classId, teacher) { return request_('get', '/v1/classes/' + enc(classId) + '/roster', undefined, teacher); },

    assignments: function (classId, teacher) { return request_('get', '/v1/classes/' + enc(classId) + '/assignments', undefined, teacher); },
    assignment: function (classId, key, live, teacher) {
      return request_('get', '/v1/classes/' + enc(classId) + '/assignments/' + enc(key) + (live ? '?live=1' : ''), undefined, teacher);
    },
    // spec: {title, pointsPossible, gradingType, description, url, published, dueAt, unlockAt, lockAt, placementId, groupId}
    syncAssignment: function (classId, key, spec, teacher) {
      return request_('put', '/v1/classes/' + enc(classId) + '/assignments/' + enc(key), { assignment: spec }, teacher);
    },
    forgetAssignment: function (classId, key, teacher) {
      return request_('delete', '/v1/classes/' + enc(classId) + '/assignments/' + enc(key), undefined, teacher);
    },

    importClass: function (classId, payload, teacher) { return request_('post', '/v1/classes/' + enc(classId) + '/import', payload, teacher); },
    log: function (classId, teacher) { return request_('get', '/v1/classes/' + enc(classId) + '/log', undefined, teacher); },

    // LTI: doGet(e) receives ?hub_launch=... when a student or teacher opens the app from their LMS.
    redeemLaunch: function (token) { return request_('post', '/v1/launches/redeem', { token: token }, undefined, true).launch; },
    // What a teacher can pick when adding this app inside an LMS: [{key, title, points, description}]
    setActivities: function (activities, launchUrl) {
      var body = { activities: activities };
      if (launchUrl) body.launchUrl = launchUrl;
      return request_('put', '/v1/app', body, undefined, true);
    }
  };
})();

// Same text in, same hash out as the hub (sha256 of the trimmed text, hex).
function lmsHubSha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || '').trim(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Run once from the editor: checks the Script Properties and the connection.
function testLmsHub() {
  var me = LmsHub.me();
  Logger.log('Connected to LMS Hub as app "' + me.app.name + '" for ' + me.teacher + '.');
  Logger.log('LMS accounts connected for you: ' + (me.connections.map(function (c) { return c.platform; }).join(', ') || 'none yet'));
  return me;
}
