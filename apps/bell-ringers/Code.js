/**
 * SchEnglish Bell Ringers v3.0
 * Google Apps Script + private Google Sheet backend
 * One deployment, one Index.html, role-aware bootstrap.
 */

const BR_DB_PROP = 'SCHENGLISH_BR_DB_ID';
const BR_ADMIN_PROP = 'SCHENGLISH_BR_ADMIN_EMAIL';
const BR_BACKEND_VERSION = '3.17.0-podcast-craft';
const BR_GEMINI_KEY_PROP = 'SCHENGLISH_GEMINI_API_KEY';
const BR_GEMINI_MODEL_PROP = 'SCHENGLISH_GEMINI_MODEL';
const BR_GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const BR_STUDENT_AI_MAX_USES = 2;

const BR_SHEETS = {
  USERS: ['email','name','role','status','createdAt','updatedAt'],
  CLASSES: ['classId','teacherEmail','className','period','grade','joinCode','canvasBaseUrl','canvasCourseId','active','createdAt','updatedAt'],
  ENROLL: ['classId','studentEmail','studentName','joinedAt','active'],
  ASSIGNMENTS: ['assignmentId','classId','teacherEmail','libraryId','title','category','prompt','directions','responseType','assessmentType','pointsPossible','teacherNote','dueAt','canvasAssignmentId','active','createdAt','updatedAt'],
  RESPONSES: ['responseId','assignmentId','classId','studentEmail','studentName','text','imageUrl','drawingData','status','score','feedback','submittedAt','clientUpdatedAt','updatedAt','processJson'],
  CUSTOM_LIBRARY: ['itemId','teacherEmail','title','category','prompt','directions','responseType','assessmentType','pointsPossible','teacherNote','active','createdAt','updatedAt'],
  // 3.9: whenever a save would make a student's writing much shorter, the longer
  // version is copied here first, so nothing a student wrote is ever gone for good.
  RESPONSE_HISTORY: ['responseId','assignmentId','classId','studentEmail','text','words','savedAt','replacedByWords','reason']
};

function doGet() {
  const page = HtmlService.createHtmlOutputFromFile('Index');
  try { brRegisterLiveBuild_(brBuildFromHtml_(page.getContent())); } catch (e) {}
  return page
    .setTitle('SchEnglish Bell Ringers')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupSchEnglishBellRingers() {
  const email = brEmail_();
  if (!email) throw new Error('No Google Workspace email was detected. Run setup while signed into the owner account.');
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(BR_DB_PROP);
  let ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('SchEnglish Bell Ringers Backend');
    props.setProperty(BR_DB_PROP, ss.getId());
  }
  brEnsureSchema_(ss);
  props.setProperty(BR_ADMIN_PROP, email);
  brUpsertUser_(ss, email, brNameFromEmail_(email), 'admin', 'active');
  return brSafe_({ok:true, backendVersion:BR_BACKEND_VERSION, spreadsheetId:ss.getId(), spreadsheetUrl:ss.getUrl(), adminEmail:email, tabs:Object.keys(BR_SHEETS)});
}

function diagnoseSchEnglishBellRingers() {
  const email = brEmail_();
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(BR_DB_PROP) || '';
  const out = {backendVersion:BR_BACKEND_VERSION, activeEmail:email, databaseId:id, adminEmail:props.getProperty(BR_ADMIN_PROP)||''};
  if (!id) return brSafe_(Object.assign(out,{ok:false,message:'Run setupSchEnglishBellRingers() once.'}));
  const ss = SpreadsheetApp.openById(id);
  out.databaseName = ss.getName();
  out.sheets = ss.getSheets().map(s=>s.getName());
  out.user = email ? brFindOne_(ss,'USERS','email',email) : null;
  out.ok = true;
  return brSafe_(out);
}

function getBootstrap(payload) {
  try {
    payload = payload || {};
    const email = brEmail_();
    if (!email) return brSafe_({ok:false,error:'EMAIL_NOT_AVAILABLE',message:'Google did not provide a signed-in email. Use the Workspace-domain deployment settings in SETUP.md.'});
    const ss = brDbReadOnly_();
    const adminEmail = (PropertiesService.getScriptProperties().getProperty(BR_ADMIN_PROP)||'').toLowerCase();
    let user = brFindOne_(ss,'USERS','email',email);
    if (!user) {
      user = brUpsertUser_(ss,email,brNameFromEmail_(email),'student','active');
    }
    const isAdmin = email === adminEmail || user.role === 'admin';
    const isTeacher = isAdmin || user.role === 'teacher';
    const classes = isTeacher ? brTeacherClasses_(ss,email,isAdmin) : brStudentClasses_(ss,email);
    return brSafe_({
      ok:true, backendVersion:BR_BACKEND_VERSION,
      user:{email:email,name:user.name||brNameFromEmail_(email),role:isAdmin?'admin':(isTeacher?'teacher':'student'),status:user.status||'active'},
      isAdmin:isAdmin,isTeacher:isTeacher,classes:classes,
      preferredClassId:String(payload.preferredClassId||'')
    });
  } catch (err) { return brSafe_({ok:false,error:'BOOTSTRAP_FAILED',message:String(err.message||err)}); }
}

function requestTeacherAccess(name) {
  const ss = brDb_(), email = brRequireEmail_();
  const existing = brFindOne_(ss,'USERS','email',email);
  if (existing && ['teacher','admin'].includes(existing.role) && existing.status === 'active') return brSafe_({ok:true,status:'active'});
  brUpsertUser_(ss,email,String(name||brNameFromEmail_(email)).trim(),'teacher','pending');
  return brSafe_({ok:true,status:'pending'});
}

function setTeacherStatus(email,status) {
  const ss = brDb_(); brRequireAdmin_(ss);
  email = brNormEmail_(email); status = String(status||'').toLowerCase();
  if (!['active','disabled'].includes(status)) throw new Error('Invalid status.');
  const user = brFindOne_(ss,'USERS','email',email); if (!user) throw new Error('User not found.');
  brUpsertUser_(ss,email,user.name||brNameFromEmail_(email),'teacher',status);
  return brSafe_({ok:true});
}

function listTeacherRequests() {
  const ss = brDb_(); brRequireAdmin_(ss);
  return brSafe_({ok:true,users:brRows_(ss,'USERS').filter(r=>r.role==='teacher')});
}

function createClass(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss); payload = payload||{};
  const classId = Utilities.getUuid(), now = brNow_();
  const row = {
    classId, teacherEmail:teacher.email, className:String(payload.className||'').trim(), period:String(payload.period||'').trim(),
    grade:String(payload.grade||'10').trim(), joinCode:brUniqueJoinCode_(ss), canvasBaseUrl:'', canvasCourseId:'', active:true, createdAt:now, updatedAt:now
  };
  if (!row.className) throw new Error('Class name is required.');
  brAppendObject_(ss,'CLASSES',row);
  return brSafe_({ok:true,class:row});
}

function updateClass(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss); payload=payload||{};
  const cls = brOwnedClass_(ss,payload.classId,teacher);
  const updates = {
    className:String(payload.className||cls.className).trim(), period:String(payload.period!=null?payload.period:cls.period).trim(),
    grade:String(payload.grade||cls.grade||'10'), canvasBaseUrl:String(payload.canvasBaseUrl!=null?payload.canvasBaseUrl:cls.canvasBaseUrl||'').trim(),
    canvasCourseId:String(payload.canvasCourseId!=null?payload.canvasCourseId:cls.canvasCourseId||'').trim(), updatedAt:brNow_()
  };
  brUpdateByKey_(ss,'CLASSES','classId',cls.classId,updates);
  return brSafe_({ok:true});
}

function archiveClass(classId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const cls=brOwnedClass_(ss,classId,teacher);
  brUpdateByKey_(ss,'CLASSES','classId',cls.classId,{active:false,updatedAt:brNow_()});
  return brSafe_({ok:true});
}

function getTeacherClass(classId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const cls=brOwnedClass_(ss,classId,teacher);
  const enroll = brRows_(ss,'ENROLL').filter(r=>r.classId===classId && brBool_(r.active));
  const assignments = brRows_(ss,'ASSIGNMENTS').filter(r=>r.classId===classId && brBool_(r.active)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(a=>Object.assign({},a,{assessmentType:'rubric5',pointsPossible:5}));
  return brSafe_({ok:true,class:cls,roster:enroll,assignments:assignments});
}

function joinClass(payload) {
  const ss=brDb_(), email=brRequireEmail_(); payload=payload||{};
  const code=String(payload.joinCode||'').trim().toUpperCase();
  const cls=brRows_(ss,'CLASSES').find(r=>String(r.joinCode).toUpperCase()===code && brBool_(r.active));
  if (!cls) throw new Error('Class code not found.');
  const studentName=String(payload.studentName||brNameFromEmail_(email)).trim();
  const enrollRows=brRows_(ss,'ENROLL');
  const existing=enrollRows.find(r=>r.classId===cls.classId && brNormEmail_(r.studentEmail)===email);
  if (existing) brUpdateMultiKey_(ss,'ENROLL',r=>r.classId===cls.classId && brNormEmail_(r.studentEmail)===email,{studentName,active:true,joinedAt:existing.joinedAt||brNow_()});
  else brAppendObject_(ss,'ENROLL',{classId:cls.classId,studentEmail:email,studentName,joinedAt:brNow_(),active:true});
  brUpsertUser_(ss,email,studentName,'student','active');
  return brSafe_({ok:true,class:{classId:cls.classId,className:cls.className,period:cls.period,grade:cls.grade,teacherEmail:cls.teacherEmail}});
}

function leaveClass(classId) {
  const ss=brDb_(), email=brRequireEmail_();
  brUpdateMultiKey_(ss,'ENROLL',r=>r.classId===classId && brNormEmail_(r.studentEmail)===email,{active:false});
  return brSafe_({ok:true});
}

function getStudentClass(classId) {
  const ss=brDb_(), email=brRequireEmail_(); const cls=brEnrolledClass_(ss,classId,email);
  const assignments=brRows_(ss,'ASSIGNMENTS').filter(r=>r.classId===classId && brBool_(r.active)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const responses=brRows_(ss,'RESPONSES').filter(r=>r.classId===classId && brNormEmail_(r.studentEmail)===email);
  const byAssignment={}; responses.forEach(r=>byAssignment[r.assignmentId]=r);
  return brSafe_({ok:true,class:{classId:cls.classId,className:cls.className,period:cls.period,grade:cls.grade,teacherEmail:cls.teacherEmail},assignments:assignments.map(a=>brStudentAssignment_(a,byAssignment[a.assignmentId]))});
}

function getLibrary() {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  const loaded = brLoadBuiltInLibrary_();
  const custom = brRows_(ss,'CUSTOM_LIBRARY')
    .filter(r=>brNormEmail_(r.teacherEmail)===teacher.email && brBool_(r.active));
  return brSafe_({
    ok:true,
    builtIn:loaded.items,
    custom:custom,
    librarySource:loaded.source,
    libraryCount:loaded.items.length,
    libraryDiagnostic:loaded.diagnostic
  });
}

/**
 * Compatibility loader for the older Expository Bell Ringer library file.
 * This intentionally accepts several export names/shapes so the curriculum
 * file can stay separate from the new Sheet backend.
 */
function brLoadBuiltInLibrary_() {
  const attempts = [];

  function useValue_(name, value) {
    attempts.push(name);
    const items = brNormalizeLibraryValue_(value);
    if (items.length) return {items:items, source:name, diagnostic:''};
    return null;
  }

  function tryFunction_(name, fn) {
    if (typeof fn !== 'function') return null;
    try {
      return useValue_(name + '()', fn());
    } catch (err) {
      attempts.push(name + '() threw: ' + String(err && err.message ? err.message : err));
      return null;
    }
  }

  let hit;

  // Known public and private helper names used by earlier builds.
  const knownFunctions = [
    ['getBellRingerLibrary', typeof getBellRingerLibrary !== 'undefined' ? getBellRingerLibrary : null],
    ['getBellRingerLibrary_', typeof getBellRingerLibrary_ !== 'undefined' ? getBellRingerLibrary_ : null],
    ['bellRingerLibrary', typeof bellRingerLibrary !== 'undefined' ? bellRingerLibrary : null],
    ['bellRingerLibrary_', typeof bellRingerLibrary_ !== 'undefined' ? bellRingerLibrary_ : null],
    ['getBuiltInBellRingers', typeof getBuiltInBellRingers !== 'undefined' ? getBuiltInBellRingers : null],
    ['getBuiltInBellRingers_', typeof getBuiltInBellRingers_ !== 'undefined' ? getBuiltInBellRingers_ : null],
    ['builtInBellRingers', typeof builtInBellRingers !== 'undefined' ? builtInBellRingers : null],
    ['builtInBellRingers_', typeof builtInBellRingers_ !== 'undefined' ? builtInBellRingers_ : null],
    ['getBellRingers', typeof getBellRingers !== 'undefined' ? getBellRingers : null],
    ['getBellRingers_', typeof getBellRingers_ !== 'undefined' ? getBellRingers_ : null],
    ['getBellRingerItems', typeof getBellRingerItems !== 'undefined' ? getBellRingerItems : null],
    ['getBellRingerItems_', typeof getBellRingerItems_ !== 'undefined' ? getBellRingerItems_ : null],
    ['getLibraryItems', typeof getLibraryItems !== 'undefined' ? getLibraryItems : null],
    ['getLibraryItems_', typeof getLibraryItems_ !== 'undefined' ? getLibraryItems_ : null],
    ['getBellRingerCatalog', typeof getBellRingerCatalog !== 'undefined' ? getBellRingerCatalog : null],
    ['getBellRingerCatalog_', typeof getBellRingerCatalog_ !== 'undefined' ? getBellRingerCatalog_ : null],
    ['getCurriculum', typeof getCurriculum !== 'undefined' ? getCurriculum : null],
    ['getCurriculum_', typeof getCurriculum_ !== 'undefined' ? getCurriculum_ : null]
  ];

  for (let i = 0; i < knownFunctions.length; i++) {
    const pair = knownFunctions[i];
    if (typeof pair[1] === 'function') {
      hit = tryFunction_(pair[0], pair[1]);
      if (hit) return hit;
    }
  }

  // Known data names used by likely earlier variants.
  const knownValues = [];
  if (typeof BELL_RINGER_LIBRARY !== 'undefined') knownValues.push(['BELL_RINGER_LIBRARY', BELL_RINGER_LIBRARY]);
  if (typeof BELL_RINGER_LIBRARY_ !== 'undefined') knownValues.push(['BELL_RINGER_LIBRARY_', BELL_RINGER_LIBRARY_]);
  if (typeof BELL_RINGERS !== 'undefined') knownValues.push(['BELL_RINGERS', BELL_RINGERS]);
  if (typeof BELL_RINGERS_ !== 'undefined') knownValues.push(['BELL_RINGERS_', BELL_RINGERS_]);
  if (typeof BELLRINGERS !== 'undefined') knownValues.push(['BELLRINGERS', BELLRINGERS]);
  if (typeof BELLRINGERS_ !== 'undefined') knownValues.push(['BELLRINGERS_', BELLRINGERS_]);
  if (typeof BUILT_IN_BELL_RINGERS !== 'undefined') knownValues.push(['BUILT_IN_BELL_RINGERS', BUILT_IN_BELL_RINGERS]);
  if (typeof BUILTIN_BELL_RINGERS !== 'undefined') knownValues.push(['BUILTIN_BELL_RINGERS', BUILTIN_BELL_RINGERS]);
  if (typeof BELL_RINGER_ACTIVITIES !== 'undefined') knownValues.push(['BELL_RINGER_ACTIVITIES', BELL_RINGER_ACTIVITIES]);
  if (typeof BELLRINGER_ACTIVITIES !== 'undefined') knownValues.push(['BELLRINGER_ACTIVITIES', BELLRINGER_ACTIVITIES]);
  if (typeof BELL_RINGER_CATALOG !== 'undefined') knownValues.push(['BELL_RINGER_CATALOG', BELL_RINGER_CATALOG]);
  if (typeof BELL_RINGER_DATA !== 'undefined') knownValues.push(['BELL_RINGER_DATA', BELL_RINGER_DATA]);
  if (typeof BELL_RINGER_ITEMS !== 'undefined') knownValues.push(['BELL_RINGER_ITEMS', BELL_RINGER_ITEMS]);
  if (typeof BR_LIBRARY !== 'undefined') knownValues.push(['BR_LIBRARY', BR_LIBRARY]);
  if (typeof LIBRARY !== 'undefined') knownValues.push(['LIBRARY', LIBRARY]);
  if (typeof CURRICULUM !== 'undefined') knownValues.push(['CURRICULUM', CURRICULUM]);

  for (let i = 0; i < knownValues.length; i++) {
    hit = useValue_(knownValues[i][0], knownValues[i][1]);
    if (hit) return hit;
  }

  // Final compatibility pass: inspect the V8 global object for project-defined
  // names that look library-related. This catches older helper names without
  // requiring the curriculum file to be rewritten.
  try {
    const g = (function(){ return this; })();
    const names = Object.getOwnPropertyNames(g || {});
    const skip = /^(getLibrary|diagnoseBellRingerLibrary|brLoadBuiltInLibrary_|brNormalizeLibraryValue_|save|delete|assign|create|update|archive|export|upload|setup|test)/i;
    const interesting = /(bell.*ringer|ringer.*bell|bellringer|curriculum|writing.*prompt|prompt.*library|activity.*library|lesson.*library)/i;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!interesting.test(name) || skip.test(name)) continue;

      let value;
      try { value = g[name]; } catch (readErr) { continue; }

      if (typeof value === 'function') {
        // Only call no-argument helpers; skip mutating/action functions above.
        if (value.length === 0) {
          hit = tryFunction_('auto:' + name, value);
          if (hit) return hit;
        }
      } else {
        hit = useValue_('auto:' + name, value);
        if (hit) return hit;
      }
    }
  } catch (scanErr) {
    attempts.push('global scan failed: ' + String(scanErr && scanErr.message ? scanErr.message : scanErr));
  }

  return {
    items:[],
    source:'not found',
    diagnostic:'BellRingerLibrary.gs is not exposing a recognizable library value yet. Checked known public/private names and scanned V8 project globals. Attempts: ' + attempts.join(' | ')
  };
}

function brNormalizeLibraryValue_(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value !== 'object') return [];

  // Common wrapper shapes.
  const wrapperKeys = ['items','bellRingers','bellringers','activities','library','prompts','lessons'];
  for (let i=0;i<wrapperKeys.length;i++) {
    const v = value[wrapperKeys[i]];
    if (Array.isArray(v)) return v.filter(Boolean);
  }

  // Category/group objects: {Concision:[...], Vocabulary:[...]}.
  const out = [];
  Object.keys(value).forEach(function(key){
    const v = value[key];
    if (Array.isArray(v)) {
      v.forEach(function(item){
        if (!item) return;
        if (typeof item === 'object' && !item.category) {
          const copy = Object.assign({}, item, {category:key});
          out.push(copy);
        } else out.push(item);
      });
    }
  });
  return out;
}

function diagnoseBellRingerLibrary() {
  const loaded = brLoadBuiltInLibrary_();
  return brSafe_({
    ok: loaded.items.length > 0,
    source: loaded.source,
    count: loaded.items.length,
    firstItem: loaded.items.length ? loaded.items[0] : null,
    diagnostic: loaded.diagnostic
  });
}

function saveCustomBellRinger(payload) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); payload=payload||{}; const now=brNow_();
  const item={itemId:Utilities.getUuid(),teacherEmail:teacher.email,title:String(payload.title||'').trim(),category:String(payload.category||'Custom').trim(),prompt:String(payload.prompt||'').trim(),directions:String(payload.directions||'').trim(),responseType:String(payload.responseType||'writing'),assessmentType:'rubric5',pointsPossible:5,teacherNote:String(payload.teacherNote||''),active:true,createdAt:now,updatedAt:now};
  if (!item.title || !item.prompt) throw new Error('Title and prompt are required.');
  brAppendObject_(ss,'CUSTOM_LIBRARY',item); return brSafe_({ok:true,item:item});
}

function deleteCustomBellRinger(itemId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss);
  const item=brRows_(ss,'CUSTOM_LIBRARY').find(r=>r.itemId===itemId && brNormEmail_(r.teacherEmail)===teacher.email); if(!item)throw new Error('Item not found.');
  brUpdateByKey_(ss,'CUSTOM_LIBRARY','itemId',itemId,{active:false,updatedAt:brNow_()}); return brSafe_({ok:true});
}

function assignBellRinger(payload) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); payload=payload||{}; const cls=brOwnedClass_(ss,payload.classId,teacher), now=brNow_();
  const a={assignmentId:Utilities.getUuid(),classId:cls.classId,teacherEmail:teacher.email,libraryId:String(payload.libraryId||''),title:String(payload.title||'Untitled Bell Ringer').trim(),category:String(payload.category||'').trim(),prompt:String(payload.prompt||'').trim(),directions:String(payload.directions||'').trim(),responseType:String(payload.responseType||'writing'),assessmentType:'rubric5',pointsPossible:5,teacherNote:String(payload.teacherNote||''),dueAt:String(payload.dueAt||''),canvasAssignmentId:'',active:true,createdAt:now,updatedAt:now};
  brAppendObject_(ss,'ASSIGNMENTS',a); return brSafe_({ok:true,assignment:a});
}

function deleteAssignment(assignmentId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const a=brOwnedAssignment_(ss,assignmentId,teacher);
  brUpdateByKey_(ss,'ASSIGNMENTS','assignmentId',a.assignmentId,{active:false,updatedAt:brNow_()});
  return brSafe_({ok:true});
}

function getAssignmentReview(assignmentId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const a=brOwnedAssignment_(ss,assignmentId,teacher);
  const roster=brRows_(ss,'ENROLL').filter(r=>r.classId===a.classId && brBool_(r.active));
  const responses=brRows_(ss,'RESPONSES').filter(r=>r.assignmentId===assignmentId);
  const map={};responses.forEach(r=>map[brNormEmail_(r.studentEmail)]=r);
  return brSafe_({ok:true,assignment:Object.assign({},a,{assessmentType:'rubric5',pointsPossible:5}),rows:roster.map(s=>({student:s,response:map[brNormEmail_(s.studentEmail)]||null}))});
}

// A client time as milliseconds, whatever the sheet turned it into (a number,
// an ISO string, or a Date that Sheets converted the string into).
function brClientMs_(v){if(v===''||v===null||v===undefined)return 0;if(typeof v==='number')return v;if(v instanceof Date)return v.getTime();const s=String(v).trim();if(/^\d{11,14}$/.test(s))return Number(s);const t=Date.parse(s);return Number.isFinite(t)?t:0;}
function brKeepHistory_(ss,existing,newText,reason){
  const old=String(existing&&existing.text||'');if(!old.trim()||old===newText)return;
  const shrink=newText.length<old.length*0.75||brWordCount_(newText)<brWordCount_(old)-15;
  if(!shrink&&reason==='draft')return;
  try{brAppendObject_(ss,'RESPONSE_HISTORY',{responseId:existing.responseId,assignmentId:existing.assignmentId,classId:existing.classId,studentEmail:existing.studentEmail,text:old,words:brWordCount_(old),savedAt:brNow_(),replacedByWords:brWordCount_(newText),reason:reason});}catch(e){}
}
// ---- Writing process (3.13) ------------------------------------------------
// Per response: active writing time, typed / deleted / pasted characters, and
// each paste (when, how long, its first 60 characters, and whether it came from
// the bell ringer's own task text). Kept in RESPONSES.processJson. Two devices
// or an out-of-order save never lower a counter: the larger value is kept and
// paste lists are combined.
const BR_PROC_NUMS=['activeMs','inputEvents','typedChars','deletedChars','pastedChars','sessions','lastActivityAt','preChars'];
function brProcParse_(v){if(!v)return null;if(typeof v==='object')return v;try{const o=JSON.parse(String(v));return o&&typeof o==='object'?o:null;}catch(e){return null;}}
function brProcClean_(p){p=p&&typeof p==='object'?p:{};const o={v:1,startedAt:String(p.startedAt||'').slice(0,40)};
  BR_PROC_NUMS.forEach(k=>{const n=Number(p[k]);o[k]=Number.isFinite(n)&&n>0?Math.round(n):0;});
  o.pasteEvents=(Array.isArray(p.pasteEvents)?p.pasteEvents:[]).filter(e=>e&&typeof e==='object').map(e=>({at:String(e.at||'').slice(0,40),chars:Math.max(0,Math.round(Number(e.chars)||0)),replacedChars:Math.max(0,Math.round(Number(e.replacedChars)||0)),head:String(e.head||'').slice(0,60),fromSource:!!e.fromSource}));
  return o;}
function brProcMerge_(storedJson,incoming){const a=brProcClean_(brProcParse_(storedJson)),b=brProcClean_(incoming),o={v:1};
  o.startedAt=[a.startedAt,b.startedAt].filter(Boolean).sort()[0]||'';
  BR_PROC_NUMS.forEach(k=>o[k]=Math.max(a[k],b[k]));
  const seen={};o.pasteEvents=a.pasteEvents.concat(b.pasteEvents).filter(e=>{const k=e.at+'|'+e.chars+'|'+e.head;if(seen[k])return false;seen[k]=1;return true;}).sort((x,y)=>String(x.at).localeCompare(String(y.at))).slice(-100);
  let out=JSON.stringify(o);while(out.length>20000&&o.pasteEvents.length){o.pasteEvents.shift();out=JSON.stringify(o);}
  return out;}
function saveStudentDraft(payload) {
  const ss=brDb_(), email=brRequireEmail_(); payload=payload||{};
  const a=brAssignmentForStudent_(ss,payload.assignmentId,email); const lock=LockService.getUserLock(); lock.waitLock(20000);
  try {
    const responseId=a.assignmentId+'__'+brHash_(email).slice(0,20); const existing=brFindOne_(ss,'RESPONSES','responseId',responseId); const now=brNow_();
    // Out-of-order protection: a save that was typed EARLIER than what is
    // already stored never replaces it. Times are compared as numbers; a stored
    // time that is in the future (a clock or sheet-conversion problem) is not trusted.
    const incomingMs=brClientMs_(payload.clientUpdatedAt)||Date.now(), storedMs=existing?brClientMs_(existing.clientUpdatedAt):0;
    const clientUpdatedAt=incomingMs;
    if (!payload.force && existing && storedMs && storedMs < Date.now()+10*60*1000 && storedMs > incomingMs) return brSafe_({ok:true,ignored:true,updatedAt:existing.updatedAt,savedLength:String(existing.text||'').length});
    if (existing) brKeepHistory_(ss,existing,String(payload.text||''),payload.force?'submit':'draft');
    const enroll=brRows_(ss,'ENROLL').find(r=>r.classId===a.classId && brNormEmail_(r.studentEmail)===email && brBool_(r.active));
    const row={responseId,assignmentId:a.assignmentId,classId:a.classId,studentEmail:email,studentName:enroll?enroll.studentName:brNameFromEmail_(email),text:String(payload.text||''),imageUrl:String(payload.imageUrl||existing&&existing.imageUrl||''),drawingData:String(payload.drawingData||existing&&existing.drawingData||''),status:existing&&existing.status==='submitted'?'submitted':'draft',score:existing?existing.score:'',feedback:existing?existing.feedback:'',submittedAt:existing?existing.submittedAt:'',clientUpdatedAt:clientUpdatedAt||now,updatedAt:now};
    const upd={studentName:row.studentName,text:row.text,imageUrl:row.imageUrl,drawingData:row.drawingData,status:row.status,clientUpdatedAt:row.clientUpdatedAt,updatedAt:row.updatedAt};
    if (payload.process && typeof payload.process==='object') { try { upd.processJson=brProcMerge_(existing?existing.processJson:'',payload.process); row.processJson=upd.processJson; } catch (e) {} }  // writing stats never block a work save
    if (existing) brUpdateByKey_(ss,'RESPONSES','responseId',responseId,upd);
    else brWithLock_(()=>{ if (brFindOne_(ss,'RESPONSES','responseId',responseId)) brUpdateByKey_(ss,'RESPONSES','responseId',responseId,upd); else brAppendObject_(ss,'RESPONSES',row); });
    return brSafe_({ok:true,updatedAt:now,savedLength:row.text.length});
  } finally { lock.releaseLock(); }
}

function submitResponse(payload) {
  // Submit is the student's final word: their text always replaces the draft
  // (force), and then it is read back from the sheet so the screen can confirm
  // every character arrived before the window closes.
  payload=Object.assign({},payload||{},{force:true}); saveStudentDraft(payload);
  const ss=brDb_(), email=brRequireEmail_(); const a=brAssignmentForStudent_(ss,payload.assignmentId,email); const responseId=a.assignmentId+'__'+brHash_(email).slice(0,20), now=brNow_();
  brUpdateByKey_(ss,'RESPONSES','responseId',responseId,{status:'submitted',submittedAt:now,updatedAt:now});
  const saved=brFindOne_(ss,'RESPONSES','responseId',responseId);
  return brSafe_({ok:true,submittedAt:now,savedLength:saved?String(saved.text||'').length:0,sentLength:String(payload.text||'').length});
}

function gradeResponse(payload) {
  return brWithLock_(() => brGradeResponseLocked_(payload));
}
function brGradeResponseLocked_(payload) {
  const ss = brDb_(), teacher = brRequireTeacher_(ss);
  payload = payload || {};
  const a = brOwnedAssignment_(ss, payload.assignmentId, teacher);
  const email = brNormEmail_(payload.studentEmail);
  const score = payload.score === '' || payload.score == null ? '' : Number(payload.score);
  if (score !== '' && !Number.isFinite(score)) throw new Error('Score must be numeric.');

  let r = brRows_(ss, 'RESPONSES').find(x => x.assignmentId === a.assignmentId && brNormEmail_(x.studentEmail) === email);
  const now = brNow_();

  // Teachers must be able to assess missing work as Zero. If the student has
  // never opened the assignment, create a minimal response record for grading.
  if (!r) {
    const enroll = brRows_(ss, 'ENROLL').find(x => x.classId === a.classId && brNormEmail_(x.studentEmail) === email);
    if (!enroll) throw new Error('Student is not enrolled in this class.');
    r = {
      responseId: a.assignmentId + '__' + brHash_(email).slice(0,20),
      assignmentId: a.assignmentId,
      classId: a.classId,
      studentEmail: email,
      studentName: enroll.studentName || brNameFromEmail_(email),
      text: '',
      imageUrl: '',
      drawingData: '',
      status: 'not started',
      score: score,
      feedback: String(payload.feedback || ''),
      submittedAt: '',
      clientUpdatedAt: '',
      updatedAt: now
    };
    // Under the script lock; the student's own first save checks again under the same lock.
    if (brFindOne_(ss, 'RESPONSES', 'responseId', r.responseId)) brUpdateByKey_(ss, 'RESPONSES', 'responseId', r.responseId, {score: score, feedback: String(payload.feedback || ''), updatedAt: now});
    else brAppendObject_(ss, 'RESPONSES', r);
  } else {
    brUpdateByKey_(ss, 'RESPONSES', 'responseId', r.responseId, {
      score: score,
      feedback: String(payload.feedback || ''),
      updatedAt: now
    });
  }
  return brSafe_({ok:true, score:score, performanceLevel:brPerformanceLevel_(score)});
}

function brPerformanceLevel_(score) {
  const n = Number(score);
  if (n === 5) return 'Advanced';
  if (n === 4) return 'Proficient';
  if (n === 3) return 'Developing';
  if (n === 2) return 'Incomplete';
  if (n === 0) return 'Zero';
  return '';
}

function uploadStudentImage(payload) {
  const ss=brDb_(), email=brRequireEmail_(); payload=payload||{}; const a=brAssignmentForStudent_(ss,payload.assignmentId,email);
  const raw=String(payload.dataUrl||''); const m=raw.match(/^data:([^;]+);base64,(.+)$/); if(!m)throw new Error('Invalid image data.');
  const bytes=Utilities.base64Decode(m[2]); if(bytes.length>6*1024*1024)throw new Error('Image is too large.');
  const folders=DriveApp.getFoldersByName('SchEnglish Bell Ringer Photos'); const folder=folders.hasNext()?folders.next():DriveApp.createFolder('SchEnglish Bell Ringer Photos');
  const ext=(m[1].split('/')[1]||'jpg').replace(/[^a-z0-9]/gi,''); const file=folder.createFile(Utilities.newBlob(bytes,m[1],a.assignmentId+'_'+Date.now()+'.'+ext));
  try{ const cls=brFindOne_(ss,'CLASSES','classId',a.classId); if(cls&&cls.teacherEmail)file.addViewer(cls.teacherEmail); }catch(ignore){}
  return brSafe_({ok:true,url:file.getUrl(),fileId:file.getId()});
}

function exportAssignmentCsv(assignmentId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const a=brOwnedAssignment_(ss,assignmentId,teacher); const review=getAssignmentReview(assignmentId); if(!review.ok)throw new Error(review.message||'Could not load review.');
  const rows=[['Student','Email','Status','Score','Feedback','Response']]; review.rows.forEach(x=>{const r=x.response||{};rows.push([x.student.studentName,x.student.studentEmail,r.status||'not started',r.score==null?'':r.score,r.feedback||'',r.text||'']);});
  return brSafe_({ok:true,fileName:brCsvSafeName_(a.title)+'.csv',csv:rows.map(r=>r.map(brCsvCell_).join(',')).join('\n')});
}

function exportClassCsv(classId) {
  const ss=brDb_(), teacher=brRequireTeacher_(ss); const cls=brOwnedClass_(ss,classId,teacher); const assignments=brRows_(ss,'ASSIGNMENTS').filter(a=>a.classId===classId); const responses=brRows_(ss,'RESPONSES').filter(r=>r.classId===classId);
  const amap={};assignments.forEach(a=>amap[a.assignmentId]=a); const rows=[['Assignment','Student','Email','Status','Score','Feedback','Response','Submitted']]; responses.forEach(r=>{const a=amap[r.assignmentId]||{};rows.push([a.title||r.assignmentId,r.studentName,r.studentEmail,r.status,r.score,r.feedback,r.text,r.submittedAt]);});
  return brSafe_({ok:true,fileName:brCsvSafeName_(cls.className)+'_Bell_Ringers.csv',csv:rows.map(r=>r.map(brCsvCell_).join(',')).join('\n')});
}


// ---------- optional teacher AI feedback ----------
// These functions are intentionally isolated from doGet(), getBootstrap(),
// database setup, and the Sheet schema. The app can load normally even when
// Gemini is not configured or unavailable.

// ---- Gemini connection (same design as the Macbeth unit, 3.11) -------------
// - Each teacher can save their OWN Gemini API key. It is kept in this script's
//   private properties under a name made from that teacher's email (like the
//   Canvas token): never in the spreadsheet, never sent to a browser.
// - The key saved earlier by the admin still works for everyone as a fallback.
// - Students' Writing Coach uses the key of the teacher who owns the class.
// - Which model: the app asks Google which models THIS key can use and picks
//   the best Flash model (newest first, full Flash before Flash-Lite, stable
//   before preview). The list is cached for 6 hours. Script Property
//   GEMINI_MODEL forces one model.
const BR_GEMINI_TEACHER_PROP = 'SCHENGLISH_GEMINI_KEY_T_';
const BR_GEMINI_FORCE_MODEL_PROP = 'GEMINI_MODEL';
const BR_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
function brGeminiTeacherProp_(email) { return BR_GEMINI_TEACHER_PROP + brHash_('gemini:' + brNormEmail_(email)).slice(0, 24); }
// The key to use for a teacher: their own, else the shared one.
function brGeminiKeyFor_(teacherEmail) {
  const props = PropertiesService.getScriptProperties();
  const own = teacherEmail ? String(props.getProperty(brGeminiTeacherProp_(teacherEmail)) || '').trim() : '';
  if (own) return {key: own, source: 'teacher'};
  const shared = String(props.getProperty(BR_GEMINI_KEY_PROP) || '').trim();
  return shared ? {key: shared, source: 'shared'} : {key: '', source: ''};
}
function brGeminiFetch_(key, method, path, body) {
  const opt = {method: method, headers: {'x-goog-api-key': key}, muteHttpExceptions: true};
  if (body !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(BR_GEMINI_API_BASE + path, opt);
  let json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  return {status: res.getResponseCode(), body: json};
}
function brGeminiErrorMessage_(status, body) {
  const msg = String(body && body.error && body.error.message || ('HTTP ' + status)).slice(0, 300);
  if (status === 400 && /api key/i.test(msg)) return 'Gemini did not accept that API key. Check it was copied in full from Google AI Studio.';
  if (status === 401 || status === 403) return 'This API key is not allowed to use Gemini (' + msg + '). Make sure the Gemini API is enabled for the key in Google AI Studio.';
  if (status === 429) return 'Gemini is busy, or the key has reached its limit for now (the free tier\'s limit is small). Wait a minute and try again. Turning on billing for the key\'s Google Cloud project raises the limit.';
  if (status === 503) return 'Gemini\'s servers are overloaded right now (503) - every model was tried. Wait a minute or two and try again.';
  if (status >= 500) return 'Gemini had a problem on its side (' + status + '). Try again in a moment.';
  return 'Gemini ' + status + ': ' + msg;
}
function brGeminiVersionOf_(name) {
  const m = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  return m ? Number(m[1]) + Number(m[2] || 0) / 10 : 0;
}
function brGeminiListModels_(key) {
  const names = [];
  let pageToken = '';
  for (let n = 0; n < 5; n++) {
    const r = brGeminiFetch_(key, 'get', '/models?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    if (r.status !== 200) return {names: names, status: r.status, body: r.body};
    (r.body.models || []).forEach(function(m) {
      const methods = m.supportedGenerationMethods || [];
      if (!methods.length || methods.indexOf('generateContent') >= 0) names.push(String(m.name || '').replace(/^models\//, ''));
    });
    pageToken = r.body.nextPageToken || '';
    if (!pageToken) break;
  }
  return {names: names, status: 200};
}
function brGeminiModels_(key) {
  const forced = String(PropertiesService.getScriptProperties().getProperty(BR_GEMINI_FORCE_MODEL_PROP) || '').trim();
  if (forced) return [forced];
  const fallback = [BR_GEMINI_DEFAULT_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  if (!key) return fallback;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'brAiModels:' + brHash_(key).slice(0, 32);
  try { const hit = JSON.parse(cache.get(cacheKey) || 'null'); if (Array.isArray(hit) && hit.length) return hit; } catch (e) {}
  const listed = brGeminiListModels_(key);
  const usable = listed.names.filter(function(n) {
    return /^gemini-/.test(n) && /flash/.test(n) && !/(tts|image|audio|live|embedding|transcribe|translate|omni|exp\b|thinking-exp)/.test(n);
  });
  const rank = function(n) {
    return brGeminiVersionOf_(n) * 10 - (/lite/.test(n) ? 3 : 0) - (/preview|exp/.test(n) ? 2 : 0) - (/-\d{3}$|-\d{2}-\d{2}$/.test(n) ? 1 : 0);
  };
  usable.sort(function(a, b) { return rank(b) - rank(a) || a.length - b.length; });
  const seen = {}, out = [];
  usable.forEach(function(n) {
    const base = n.replace(/-\d{3}$|-\d{2}-\d{2}$|-preview.*$/, '');
    if (seen[base] || out.length >= 4) return;
    seen[base] = true; out.push(n);
  });
  if (!out.length) return fallback;
  try { cache.put(cacheKey, JSON.stringify(out), 6 * 60 * 60); } catch (e) {}
  return out;
}

function getTeacherAiStatus() {
  const ss = brDbReadOnly_();
  const teacher = brRequireTeacher_(ss);
  const k = brGeminiKeyFor_(teacher.email);
  let models = [];
  try { models = k.key ? brGeminiModels_(k.key) : []; } catch (e) { models = []; }
  return brSafe_({ok: true, configured: !!k.key, source: k.source, model: models[0] || '', models: models, canConfigure: true, isAdmin: !!teacher.isAdmin});
}

// Saves the key to the signed-in teacher's own slot (after testing it). An
// admin can tick "share" to make it the fallback key for every teacher.
function testAndSaveGeminiApiKey(apiKey, share) {
  const ss = brDb_();
  const teacher = brRequireTeacher_(ss);
  const key = String(apiKey || '').trim();
  if (!key || key.length < 20) throw new Error('Paste a valid Gemini API key.');
  const r = brGeminiFetch_(key, 'get', '/models?pageSize=50');
  if (r.status !== 200) throw new Error(brGeminiErrorMessage_(r.status, r.body));
  try { CacheService.getScriptCache().remove('brAiModels:' + brHash_(key).slice(0, 32)); } catch (e) {}
  const test = brGeminiGenerateWithFallback_('Reply with exactly: SchEnglish AI ready', key, 64);
  if (!test.text) throw new Error('Gemini returned an empty test response.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty(brGeminiTeacherProp_(teacher.email), key);
  if (share && teacher.isAdmin) props.setProperty(BR_GEMINI_KEY_PROP, key);
  return brSafe_({ok: true, configured: true, source: 'teacher', model: test.model, models: brGeminiModels_(key), shared: !!(share && teacher.isAdmin)});
}

function clearGeminiApiKey(which) {
  const ss = brDb_();
  const teacher = brRequireTeacher_(ss);
  const props = PropertiesService.getScriptProperties();
  if (which === 'shared') { brRequireAdmin_(ss); props.deleteProperty(BR_GEMINI_KEY_PROP); props.deleteProperty(BR_GEMINI_MODEL_PROP); }
  else props.deleteProperty(brGeminiTeacherProp_(teacher.email));
  const k = brGeminiKeyFor_(teacher.email);
  return brSafe_({ok: true, configured: !!k.key, source: k.source});
}

// Run once from the Apps Script editor if Gemini ever seems broken. It checks
// your key and lists the models it can use, in the order the app will try them.
function testGeminiSetup() {
  const k = brGeminiKeyFor_(Session.getActiveUser().getEmail());
  if (!k.key) { Logger.log('No Gemini key saved yet. In the app: Writing Coach setup > paste your key.'); return {ok: false}; }
  const r = brGeminiFetch_(k.key, 'get', '/models?pageSize=50');
  if (r.status !== 200) { Logger.log('Key check failed: ' + brGeminiErrorMessage_(r.status, r.body)); return {ok: false}; }
  Logger.log('The Gemini key works (' + (k.source === 'teacher' ? 'your own key' : 'the shared key') + ').');
  Logger.log('The app will try, in order: ' + brGeminiModels_(k.key).join(', '));
  const t = brGeminiGenerateWithFallback_('Reply with exactly: SchEnglish AI ready', k.key, 64);
  Logger.log('Test reply from ' + t.model + ': ' + t.text);
  return {ok: true, model: t.model};
}

function generateStudentWritingCoach(payload) {
  const ss = brDb_();
  const email = brRequireEmail_();
  payload = payload || {};

  const assignment = brAssignmentForStudent_(ss, String(payload.assignmentId || ''), email);
  if (!brIsWrittenResponseType_(assignment.responseType)) {
    throw new Error('Writing Coach is available only for written-response bell ringers.');
  }

  const text = String(payload.text || '').trim();
  const wordCount = brWordCount_(text);
  const minWords = brStudentCoachMinWords_(assignment.category);
  if (wordCount < minWords) {
    throw new Error('Write at least ' + minWords + ' words before asking Writing Coach for feedback.');
  }

  const props = PropertiesService.getScriptProperties();
  const owner = brFindOne_(ss, 'CLASSES', 'classId', assignment.classId) || {};
  const key = brGeminiKeyFor_(owner.teacherEmail).key;
  if (!key) throw new Error('Writing Coach is not configured yet. Ask your teacher to set it up.');

  const usageKey = 'SCHENGLISH_STUDENT_AI_' + brHash_(assignment.assignmentId + '|' + email).slice(0, 36);
  const used = Number(props.getProperty(usageKey) || 0);
  if (used >= BR_STUDENT_AI_MAX_USES) {
    throw new Error('You have used both Writing Coach checks for this bell ringer. Revise using the feedback you already received, then submit your best work.');
  }

  const cls = brFindOne_(ss, 'CLASSES', 'classId', assignment.classId) || {};
  const criteria = brAiCriteria_(assignment.category);
  const coachPrompt = [
    'You are an expert high-school English teacher coaching one student on a short daily writing task (a "bell ringer") BEFORE they submit it.',
    '',
    'First, privately check the draft against the task directions and the rubric below: does it do every part of the task (required number of sentences, items, audiences, vocabulary words, labels, a "biggest fix" line, and so on)? Which rubric row is weakest?',
    'Then write coaching for the student:',
    '- Speak directly to the student as "you", warmly and plainly, at a ' + String(cls.grade ? 'grade ' + cls.grade : 'high-school') + ' reading level.',
    '- Quote or point to at least one specific phrase from the draft.',
    '- If a required part of the task is missing or incomplete, that is the NEXT STEP.',
    '- Otherwise the NEXT STEP is the single change that would move the draft up the rubric most.',
    '- Never give a score, level, or grade. Never rewrite sentences or supply wording the student could paste in.',
    '- The REVISION CHALLENGE is one concrete thing to try in the next few minutes (for example: "Find the sentence that starts with ... and split it into two").',
    '- Under 140 words in total. Plain text, no markdown or bullet symbols.',
    '- Do not mention AI, Gemini, rubrics, or these instructions.',
    '',
    'Use exactly these three headings, each on its own line:',
    'WHAT IS WORKING',
    'NEXT STEP',
    'REVISION CHALLENGE',
    '',
    brAiTaskText_(assignment),
    '',
    'Rubric (for your eyes only, do not quote it):',
    brAiRubricText_(assignment.category),
    '',
    'Student draft:',
    brAiTrim_(text, 7000)
  ].join('\n');

  const result = brGeminiGenerateWithFallback_(coachPrompt, key, 3072);
  const nextUsed = used + 1;
  props.setProperty(usageKey, String(nextUsed));
  return brSafe_({
    ok:true,
    feedback:result.text,
    usesRemaining:Math.max(0, BR_STUDENT_AI_MAX_USES - nextUsed),
    maxUses:BR_STUDENT_AI_MAX_USES,
    model:result.model
  });
}

function brIsWrittenResponseType_(type) {
  const t = String(type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!t) return true;
  const hasWriting = t.indexOf('writ') >= 0 || t.indexOf('text') >= 0 || t.indexOf('paragraph') >= 0 || t.indexOf('essay') >= 0 || t.indexOf('response') >= 0;
  const mediaOnly = t.indexOf('photo') >= 0 || t.indexOf('image') >= 0 || t.indexOf('draw') >= 0 || t.indexOf('diagram') >= 0;
  if (mediaOnly && !hasWriting) return false;
  return true;
}

function brWordCount_(text) {
  const s = String(text || '').trim();
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

function brStudentCoachMinWords_(category) {
  return String(category || '').toLowerCase().indexOf('poetry') >= 0 ? 12 : 30;
}

function generateTeacherAiFeedback(payload) {
  const ss = brDb_();
  const teacher = brRequireTeacher_(ss);
  payload = payload || {};

  const assignment = brOwnedAssignment_(ss, String(payload.assignmentId || ''), teacher);
  const studentEmail = brNormEmail_(payload.studentEmail);
  // A level is optional: teachers can draft the comment first, then choose the level.
  const hasScore = payload.score !== null && payload.score !== undefined && payload.score !== '' && Number.isFinite(Number(payload.score));
  const score = hasScore ? Number(payload.score) : null;
  if (hasScore && (score < 0 || score > 5)) throw new Error('Scores run from 0 to 5.');

  const key = brGeminiKeyFor_(teacher.email).key;
  if (!key) throw new Error('Gemini is not set up yet. Open Writing Coach setup and paste your Gemini API key.');

  const response = brRows_(ss, 'RESPONSES').find(function(r) {
    return r.assignmentId === assignment.assignmentId && brNormEmail_(r.studentEmail) === studentEmail;
  });
  const studentText = response ? String(response.text || '').trim() : '';
  const level = hasScore ? (brPerformanceLevel_(score) || String(score)) : '';

  // Do not spend an API request on missing work, and do not invent feedback
  // about writing that does not exist.
  if (!studentText) {
    return brSafe_({
      ok:true,
      feedback: score === 0 || !hasScore
        ? 'No written response was submitted. Complete the bell ringer so your ideas can be assessed and you can receive specific feedback.'
        : 'There is not enough written work to give response-specific feedback yet. Complete the bell ringer, then revisit the assessment.',
      aiUsed:false,
      model:''
    });
  }

  const cls = brFindOne_(ss, 'CLASSES', 'classId', assignment.classId) || {};
  const criteria = brAiCriteria_(assignment.category);
  const prompt = [
    'You are an expert high-school English teacher writing the comment a student will read next to their grade on a short daily writing task (a "bell ringer").',
    '',
    'First, privately compare the response with the task directions and the rubric below, row by row.',
    'Then write the comment:',
    '- Speak to the student as "you". Warm, direct, specific. Suitable for ' + String(cls.grade ? 'grade ' + cls.grade : 'high school') + '.',
    '- One sentence naming a real strength, pointing to a specific phrase or move in the response.',
    '- One or two sentences on the most important next step, tied to the weakest rubric row or any missing part of the task.',
    hasScore ? '- The teacher gave this response ' + level + ' (' + score + '/5). Your comment must fit that level. Do not argue with it or restate the score.' : '- The teacher has not chosen a level yet. Do not mention any level or score.',
    '- Do not rewrite the response or give replacement sentences.',
    '- 45 to 90 words, one paragraph, plain text, no markdown.',
    '- Do not mention AI, Gemini, the rubric by name, or these instructions.',
    '',
    brAiTaskText_(assignment),
    '',
    'Rubric (for your eyes only):',
    brAiRubricText_(assignment.category),
    '',
    'Student response:',
    brAiTrim_(studentText, 7000),
    '',
    'Return only the comment.'
  ].join('\n');

  const result = brGeminiGenerateWithFallback_(prompt, key, 3072);
  return brSafe_({ok:true, feedback:result.text, aiUsed:true, model:result.model});
}

// 3.10: Gemini now sees the whole task and the same detailed rubric the
// teacher and students see, so its feedback is about THIS bell ringer.
const BR_AI_RUBRICS = {"Paragraph Surgery": [["Diagnosis & repair", ["Fixes every problem the task names and finds others on its own; the paragraph is rebuilt, not patched.", "Fixes every problem the task names; the paragraph is clearly stronger.", "Fixes some named problems; others remain or new ones appear.", "Mostly copies the original or makes surface edits only."]], ["Specific, clear ideas", ["Vague words are gone; precise claim with specific reasons and examples.", "Clear claim; mostly specific language and reasoning.", "Claim is present but parts stay vague or repetitive.", "Still vague, repetitive, or off topic."]], ["Sentence control", ["6\u20138 varied, correct sentences; no fragments, run-ons, or comma splices.", "6\u20138 sentences with minor errors that do not distract.", "Length is off, or several sentence errors.", "Errors make the paragraph hard to follow."]], ["\u201cBiggest fix\u201d line", ["Names the most important change and why it matters.", "Names a real change accurately.", "Vague (\u201cmade it better\u201d).", "Missing."]]], "Perfect Paragraph": [["Topic sentence / claim", ["Answers the question directly with a precise, arguable claim.", "Clear claim that answers the question.", "Claim is general, unclear, or only partly answers.", "No clear claim."]], ["Development", ["Two reasons, each explained, and a specific example that proves the point (Gr 11\u201312: a counterargument answered).", "Two reasons with explanation and an example.", "Reasons are listed more than explained, or the example is general.", "Little explanation or support."]], ["Focus & conclusion", ["Every sentence serves the claim; the last sentence adds insight.", "Stays on topic; conclusion wraps up without just repeating.", "Drifts, or the conclusion repeats the first sentence.", "Unfocused; no real conclusion."]], ["Length & conventions", ["6\u20138 polished sentences; no \u201cI\u201d or \u201cyou\u201d; concise.", "6\u20138 sentences; few errors.", "Length off or noticeable errors.", "Errors interfere with meaning."]]], "Vocabulary Challenge": [["Accurate use", ["Every word used shows clear understanding of its meaning.", "Words used correctly with at most one small slip.", "Some words are used incorrectly or vaguely.", "Most words are misused."]], ["How many, how naturally", ["All five words, each fitting naturally.", "Four words (or five with one forced).", "Three words, or several feel forced.", "Fewer than three."]], ["Paragraph quality", ["On topic, organized, 6\u20138 sentences; words strengthen the ideas.", "On topic and organized; meets length.", "Thin ideas or loosely organized; words feel inserted.", "Off topic, too short, or disorganized."]], ["Format", ["Every vocabulary word in ALL CAPS; forms adjusted correctly.", "Words marked in caps; minor form errors.", "Some words not marked, or several form errors.", "Words not marked."]]], "Cut the Clutter": [["Concision", ["All three cut by a third or more; every bit of padding is gone.", "All three noticeably tighter.", "One or two tightened; padding remains.", "Little was cut."]], ["Meaning kept", ["Every revision says exactly what the original meant.", "Meaning kept with a tiny shift.", "One revision changes or loses meaning.", "Meaning is lost."]], ["Correct sentences", ["All three revisions are correct and read smoothly.", "Minor errors.", "Errors in one or more revisions.", "Revisions are hard to read."]], ["Explanation", ["Names what was cut and why the shorter version is stronger.", "Accurate explanation.", "Vague explanation.", "Missing."]]], "Transition Lab": [["Right relationship", ["Every transition matches its logical relationship, including the contrast.", "Transitions fit with one minor mismatch.", "Several transitions do not fit the relationship.", "Transitions are random or missing."]], ["Variety & bank use", ["Four or more different transitions from the bank, all in ALL CAPS.", "Four different transitions.", "Two or three, or repeated ones.", "Fewer than two."]], ["Flow & combining", ["Reads as one smooth paragraph; sentences combined where it helps.", "Smooth paragraph; facts unchanged.", "Still reads like a list.", "Choppy, or facts changed."]], ["Contrast explanation", ["Clearly explains why the contrast transition fits.", "Accurate explanation.", "Vague explanation.", "Missing."]]], "Tone Match": [["Audience fit", ["Each version would truly work for its reader: diction, formality, and detail all fit.", "Each version fits its audience.", "One version does not fit its audience.", "Versions do not fit the audiences."]], ["Range of tone", ["Three clearly different voices through word choice and sentence style.", "Clear differences between versions.", "Versions sound similar.", "Little change between versions."]], ["Facts & clarity", ["Facts identical and clear in every version.", "Facts kept.", "A fact changed or lost.", "Message changed."]], ["Reflection", ["Insightful about the hardest version and the most powerful word choice.", "Accurate reflection.", "Vague reflection.", "Missing."]]], "Story Craft": [["Craft move", ["Uses the skill the task names fully and with control from start to finish; it shapes the whole piece.", "Uses the named skill accurately throughout.", "Attempts the skill, but slips back into telling, summary, or explaining.", "The named skill is missing or misunderstood."]], ["Specific, vivid detail", ["Concrete, sensory, surprising details that belong to this character and moment; no clich\u00e9s.", "Mostly specific details; few generic phrases.", "Several generic words or clich\u00e9s; the scene is hard to picture.", "Vague or generic throughout."]], ["Task & control", ["Meets every requirement (length, labels, rules); purposeful sentences; dialogue punctuated correctly.", "Meets the requirements; minor errors that do not distract.", "Misses a requirement, or errors distract.", "Several requirements missed, or errors interfere with meaning."]], ["\u201cWriter\u2019s move\u201d line", ["Names a specific choice and its effect on the reader.", "Names a real choice accurately.", "Vague (\u201cI added detail\u201d).", "Missing."]]], "Podcast Craft": [["Producer skill", ["Uses the skill the task names fully and with control (open questions, a real follow-up, a cold open, writing for the ear, a focused pitch).", "Uses the named skill accurately.", "Attempts the skill, but parts slip (closed or leading questions, a slow start, page-style sentences, a vague idea).", "The named skill is missing or misunderstood."]], ["Written for the ear", ["Short, natural, speakable sentences; a listener could follow it without seeing it.", "Mostly easy to say and follow aloud.", "Some long or tangled sentences a listener would lose.", "Reads like an essay, or is hard to follow aloud."]], ["Task & specifics", ["Meets every requirement (labels, counts, script format, quotes) with specific, concrete detail.", "Meets the requirements; mostly specific.", "Misses a requirement, or stays general.", "Several requirements missed."]], ["\u201cProducer\u2019s note\u201d line", ["Names a specific choice and what it does for the listener.", "Names a real choice accurately.", "Vague (\u201cI made it better\u201d).", "Missing."]]], "Default": [["Addresses the task", ["Fully addresses every part of the task.", "Addresses the task.", "Partly addresses the task.", "Barely addresses the task."]], ["Development", ["Specific, well-explained details throughout.", "Clear details and explanation.", "Some detail; explanation is thin.", "Little detail."]], ["Organization", ["Logical and smooth from start to finish.", "Organized and easy to follow.", "Some confusion in order.", "Hard to follow."]], ["Clarity & language", ["Precise, correct, and concise.", "Clear with minor errors.", "Errors or vague wording distract.", "Errors interfere with meaning."]]]};
function brAiRubricKey_(category) {
  const c = String(category || '').toLowerCase();
  const k = Object.keys(BR_AI_RUBRICS).filter(function(n) { return n !== 'Default'; }).find(function(n) { return c.indexOf(n.toLowerCase()) >= 0; });
  return k || 'Default';
}
function brAiRubricText_(category) {
  const levels = ['Advanced (5)', 'Proficient (4)', 'Developing (3)', 'Incomplete (2)'];
  return BR_AI_RUBRICS[brAiRubricKey_(category)].map(function(row) {
    return '- ' + row[0] + ': ' + row[1].map(function(d, i) { return levels[i] + ' = ' + d; }).join(' | ');
  }).join('\n') + '\n- Zero (0) = no response, or off task.';
}
// What an expert teacher checks first for each bell ringer type.
const BR_AI_FOCUS = {
  'Paragraph Surgery': 'Compare the revision with the original "patient" paragraph: were the named problems really fixed (vague words, repetition, passive voice, fragments) or just reworded? Is it 6-8 sentences? Is there a "Biggest fix" line that names the most important change?',
  'Perfect Paragraph': 'Check for a direct, arguable topic sentence that answers the question, two reasons that are explained (not just listed), one specific example, a closing sentence that adds insight, 6-8 sentences, and no "I" or "you".',
  'Vocabulary Challenge': 'Check each of the five vocabulary words: is it used with the right meaning and form, and written in ALL CAPS? Count how many were used naturally. Is the paragraph on topic and 6-8 sentences?',
  'Cut the Clutter': 'Check all three sentences: is each one noticeably shorter, does it keep the original meaning, and is it grammatically correct? Is the explanation of what was cut, and why, present?',
  'Transition Lab': 'Check whether each transition matches the logical relationship (especially the contrast), whether at least four different transitions from the bank are used in ALL CAPS, whether it reads as one paragraph with the facts unchanged, and whether the contrast choice is explained.',
  'Tone Match': 'Check each version against its named audience: word choice, formality, and detail. Are the versions clearly different in voice while keeping the same facts? Is the reflection present?',
  'Story Craft': 'This is a short-story skill builder, so judge it as fiction. First check the one craft move the directions name (the teacher note lists what to look for): is it really used, consistently, rather than mentioned or half done? Then check every rule in the task (banned words, labels, line or sentence counts, what must or must not happen), concrete and specific detail instead of cliches or summary, correct dialogue formatting when there is dialogue, and a \"Writer\'s move\" line that names a choice and its effect. Reward risk, voice, and originality. Do not ask for a thesis, evidence, or a formal tone, and do not suggest stating the emotion or the lesson.',
  'Podcast Craft': 'This is a podcast-unit skill builder, so judge it as writing meant to be heard. First check the one skill the directions name (the teacher note lists what to look for): open, neutral interview questions and a real follow-up; a cold open that starts mid-moment before any welcome; page writing turned into short, speakable sentences; or a focused pitch with a specific audience and format. Then check every labelled part and count the task asks for, and the "Producer\'s note" line. For a partner interview, the student writes up the interview they hosted; you cannot check that it happened, so judge the write-up. Do not ask for a thesis or formal essay style.'
};
function brAiTaskText_(a) {
  const key = brAiRubricKey_(a.category);
  return [
    BR_AI_FOCUS[key] ? 'What to check first for this type: ' + BR_AI_FOCUS[key] + '\n' : '',
    a.teacherNote ? 'The teacher\'s focus for this bell ringer (follow it): ' + brAiTrim_(a.teacherNote, 800) + '\n' : '',
    'Bell-ringer type: ' + String(a.category || 'English'),
    'Title: ' + String(a.title || ''),
    '',
    'What the student was given (prompt):',
    brAiTrim_(a.prompt, 3000),
    a.directions ? '\nWhat the student was asked to do (directions):\n' + brAiTrim_(a.directions, 2500) : ''
  ].join('\n');
}
function brAiCriteria_(category) {
  if (brAiRubricKey_(category) !== 'Default') return BR_AI_RUBRICS[brAiRubricKey_(category)].map(function(r) { return r[0]; });
  const c = String(category || '').toLowerCase();
  if (c.indexOf('argument') >= 0 || c.indexOf('analysis') >= 0) return ['clear claim or focus','reasoning or evidence','depth of analysis','clarity and control'];
  if (c.indexOf('poetry') >= 0) return ['purposeful imagery','language or figurative choices','line, sound, or structure','overall impact'];
  if (c.indexOf('creative') >= 0) return ['idea or scene development','specific detail','craft choices','voice and originality'];
  if (c.indexOf('style') >= 0 || c.indexOf('craft') >= 0) return ['intentional craft choice','sentence control','voice or tone','precision'];
  if (c.indexOf('narrative') >= 0 || c.indexOf('reflection') >= 0) return ['focused moment or idea','concrete detail','reflection or meaning','organization and clarity'];
  if (c.indexOf('vocabulary') >= 0 || c.indexOf('wordplay') >= 0) return ['accurate meaning','word choice','precision in context','originality'];
  return ['addresses the prompt','development and specific detail','organization','clarity and language'];
}

function brAiTrim_(value, maxChars) {
  const s = String(value || '');
  return s.length <= maxChars ? s : s.slice(0, maxChars) + '\n[response truncated]';
}

function brGeminiGenerateWithFallback_(prompt, apiKey, maxOutputTokens) {
  const models = brGeminiModels_(apiKey);
  let lastError = null;
  for (let i = 0; i < models.length; i++) {
    try {
      const text = brGeminiGenerate_(models[i], prompt, apiKey, maxOutputTokens);
      if (text) return {text: text, model: models[i]};
    } catch (err) {
      lastError = err;
      // Overloaded, missing, rate-limited or cut-off on this model: try the next one.
      if (!err.retryNext) throw err;
    }
  }
  throw lastError || new Error('Gemini did not return feedback.');
}

function brGeminiGenerate_(model, prompt, apiKey, maxOutputTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  // 3.10: Gemini's "thinking" counts against maxOutputTokens. The old limit of
  // 300-360 tokens was often used up by thinking, so feedback came back cut off
  // or empty. The real length limit lives in the prompt (word counts); this is
  // only a ceiling.
  const budget = Math.max(Number(maxOutputTokens || 0), 3072);
  const body = {
    contents: [{role:'user', parts:[{text:String(prompt || '')}]}],
    generationConfig: {
      maxOutputTokens: budget,
      temperature: 0.4,
      thinkingConfig: {thinkingLevel:'low'}
    }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {'x-goog-api-key': apiKey},
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  let json = {};
  try { json = JSON.parse(raw || '{}'); } catch (ignore) {}

  if (status < 200 || status >= 300) {
    const err = new Error(brGeminiErrorMessage_(status, json));
    err.retryNext = status === 404 || status === 429 || status >= 500;
    throw err;
  }

  const cand = json && json.candidates && json.candidates[0] || {};
  const parts = cand.content && cand.content.parts || [];
  // Skip the model's private "thought" parts; keep only the answer.
  const text = parts.filter(function(p) { return p && p.text && !p.thought; }).map(function(p) { return String(p.text); }).join('').trim();
  if (!text || (cand.finishReason === 'MAX_TOKENS' && text.split(/\s+/).length < 40)) {
    const err = new Error('Gemini returned no feedback text' + (cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '. Try again in a moment.');
    err.retryNext = true;
    throw err;
  }
  return text.replace(/\*\*/g, '');
}

function normalizeBellRingerPointsToFive() {
  const ss=brDb_(), teacher=brRequireTeacher_(ss);
  const sh=ss.getSheetByName('ASSIGNMENTS');
  const headers=BR_SHEETS.ASSIGNMENTS;
  const lr=sh.getLastRow();
  if(lr<2)return brSafe_({ok:true,updated:0});
  const vals=sh.getRange(2,1,lr-1,headers.length).getValues();
  const pIdx=headers.indexOf('pointsPossible'), aIdx=headers.indexOf('assessmentType');
  let updated=0;
  vals.forEach(row=>{
    if(row[pIdx]!==5 || String(row[aIdx])!=='rubric5'){row[pIdx]=5;row[aIdx]='rubric5';updated++;}
  });
  if(updated)sh.getRange(2,1,vals.length,headers.length).setValues(vals);
  return brSafe_({ok:true,updated:updated});
}

// ---------- helpers ----------
function brDbReadOnly_(){const id=PropertiesService.getScriptProperties().getProperty(BR_DB_PROP);if(!id)throw new Error('Backend is not initialized. Run setupSchEnglishBellRingers() once.');return SpreadsheetApp.openById(id);}
// ---- Which version is live (2026.10.19.2, the update bar from Lit Circles) ----
// serverBuild: the build THIS link serves right now (read from the Index.html it
// serves, so there is no second number to keep in step). The live marker only
// moves forward and remembers the /exec link that served it; the editor's /dev
// test link never counts.
const BR_LIVE_BUILD_PROP = 'SCHENGLISH_BR_LIVE_BUILD', BR_LIVE_URL_PROP = 'SCHENGLISH_BR_LIVE_URL';
function brBuildFromHtml_(html){const m=String(html||'').match(/BR_CLIENT_BUILD\s*=\s*'([^']+)'/);return m?m[1]:'';}
function brBuildCmp_(a,b){const pa=String(a||'').split('.').map(Number),pb=String(b||'').split('.').map(Number);if(!a&&!b)return 0;if(!a)return -1;if(!b)return 1;for(let i=0;i<Math.max(pa.length,pb.length);i++){const x=pa[i]||0,y=pb[i]||0;if(x!==y)return x<y?-1:1;}return 0;}
function brServedBuild_(){try{return brBuildFromHtml_(HtmlService.createHtmlOutputFromFile('Index').getContent());}catch(e){return '';}}
function brThisLinkUrl_(){let u='';try{u=String(ScriptApp.getService().getUrl()||'');}catch(e){u='';}return u;}
function brRegisterLiveBuild_(build){
  if(!build)return;const url=brThisLinkUrl_();if(url&&!/\/exec(\?|$)/.test(url))return;   // the editor's test link
  const props=PropertiesService.getScriptProperties(),live=props.getProperty(BR_LIVE_BUILD_PROP)||'';
  if(!live||brBuildCmp_(build,live)>0){props.setProperty(BR_LIVE_BUILD_PROP,build);let link='';try{link=(typeof brCanvasAppUrl_==='function'&&brCanvasAppUrl_())||'';}catch(e){link='';}link=link||url;if(link)props.setProperty(BR_LIVE_URL_PROP,link);}
}
function getBrAppVersion(){
  const serverBuild=brServedBuild_();
  try{brRegisterLiveBuild_(serverBuild);}catch(e){}
  const props=PropertiesService.getScriptProperties();
  // The reload link: the saved student link (/exec) when there is one, else what Google reports.
  let url='';try{url=(typeof brCanvasAppUrl_==='function'&&brCanvasAppUrl_())||'';}catch(e){url='';}
  const here=brThisLinkUrl_();if(!url&&/\/exec(\?|$)/.test(here))url=here;
  return {ok:true,serverBuild:serverBuild,version:props.getProperty(BR_LIVE_BUILD_PROP)||serverBuild,url:url,liveUrl:props.getProperty(BR_LIVE_URL_PROP)||'',backend:BR_BACKEND_VERSION};
}
function pingSchEnglish(){return {ok:true,version:BR_BACKEND_VERSION,time:new Date().toISOString()};}
// 3.13: the sheet layout check used to run on EVERY call (about 40 small sheet
// reads each time), which made every grade save slow enough that a few quick
// clicks queued up and timed out ("The app is busy saving other grades").
// It now runs once an hour, and straight away whenever the column list changes.
function brDb_(){const id=PropertiesService.getScriptProperties().getProperty(BR_DB_PROP);if(!id)throw new Error('Backend is not initialized. Run setupSchEnglishBellRingers() once.');const ss=SpreadsheetApp.openById(id);
  let cache=null,key='';try{cache=CacheService.getScriptCache();key='brSchema_'+Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,id+JSON.stringify(BR_SHEETS))).slice(0,16);}catch(e){cache=null;}
  if(cache&&cache.get(key))return ss;
  brEnsureSchema_(ss);
  try{if(cache)cache.put(key,'1',3600);}catch(e){}
  return ss;}
function brEnsureSchema_(ss){Object.keys(BR_SHEETS).forEach(name=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);const headers=BR_SHEETS[name];if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);else{const current=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0];headers.forEach((h,i)=>{if(current[i]!==h)sh.getRange(1,i+1).setValue(h);});}});const sheet1=ss.getSheetByName('Sheet1');if(sheet1&&ss.getSheets().length>1)ss.deleteSheet(sheet1);}
function brEmail_(){return brNormEmail_(Session.getActiveUser().getEmail());}
function brRequireEmail_(){const e=brEmail_();if(!e)throw new Error('Signed-in Google email is unavailable.');return e;}
function brNormEmail_(v){return String(v||'').trim().toLowerCase();}
function brNameFromEmail_(e){const s=String(e||'').split('@')[0].replace(/[._-]+/g,' ').trim();return s.replace(/\b\w/g,c=>c.toUpperCase());}
function brNow_(){return new Date().toISOString();}
function brBool_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1';}
function brRows_(ss,name){const sh=ss.getSheetByName(name), lr=sh.getLastRow(), lc=BR_SHEETS[name].length;if(lr<2)return[];const vals=sh.getRange(1,1,lr,lc).getValues(), headers=vals[0];const rows=vals.slice(1).map(row=>{const o={};headers.forEach((h,i)=>o[h]=brPrimitive_(row[i]));return o;});return name==='RESPONSES'?brOneResponseEach_(rows):rows;}
// ---- One response per student per bell ringer (3.12) -------------------------
// Older builds could, very occasionally, write TWO rows for the same student and
// bell ringer (two first saves at the same moment). After that, saves went to
// the first row while screens showed the second, so the student's typing and
// the teacher's grade both seemed not to save. Now every read uses the row that
// was saved most recently, and every write updates all copies, so they agree.
function brRespTime_(v){const t=Date.parse(String(v||''));return Number.isFinite(t)?t:0;}
function brOneResponseEach_(rows){
  const best={},order=[];
  rows.forEach(r=>{
    if(!r.assignmentId&&!r.responseId){order.push(r);return;}
    const k=String(r.assignmentId)+'|'+brNormEmail_(r.studentEmail);
    const cur=best[k];
    if(!cur){best[k]=r;order.push(k);return;}
    const tn=brRespTime_(r.updatedAt),tc=brRespTime_(cur.updatedAt);
    if(tn>tc||(tn===tc&&String(r.text||'').length>=String(cur.text||'').length))best[k]=r;
  });
  return order.map(k=>typeof k==='string'?best[k]:k);
}
// Editor tool: lists (and, with fix=true, merges) duplicate response rows.
function repairDuplicateResponses(fix){
  const ss=brDb_(),sh=ss.getSheetByName('RESPONSES'),headers=BR_SHEETS.RESPONSES,lr=sh.getLastRow();if(lr<2)return {duplicates:0};
  const vals=sh.getRange(2,1,lr-1,headers.length).getValues(),groups={};
  vals.forEach((row,i)=>{const o={};headers.forEach((h,j)=>o[h]=brPrimitive_(row[j]));const k=o.assignmentId+'|'+brNormEmail_(o.studentEmail);(groups[k]=groups[k]||[]).push({o,i});});
  let dups=0;
  Object.keys(groups).forEach(k=>{const g=groups[k];if(g.length<2)return;dups++;
    const keep=brOneResponseEach_(g.map(x=>x.o))[0];
    Logger.log('Duplicate rows for '+keep.studentEmail+' on '+keep.assignmentId+': rows '+g.map(x=>x.i+2).join(', ')+' - keeping the one saved '+keep.updatedAt+' ('+String(keep.text||'').split(/\s+/).filter(Boolean).length+' words)');
    if(fix)g.forEach(x=>{if(x.o!==keep)sh.getRange(x.i+2,1,1,headers.length).setValues([headers.map(h=>keep[h]===undefined?'':keep[h])]);});
  });
  Logger.log(dups?dups+' student response(s) had duplicate rows.'+(fix?' All copies now match.':' Run repairDuplicateResponses(true) to make the copies match.'):'No duplicate rows.');
  return {duplicates:dups};
}
function brPrimitive_(v){return v instanceof Date?v.toISOString():v;}
function brFindOne_(ss,name,key,value){return brRows_(ss,name).find(r=>String(r[key])===String(value))||null;}
// ---- Safe saves (3.8) -------------------------------------------------------
// Many people save at once: students typing, the teacher grading one student
// after another. Every write now (1) waits its turn with a script-wide lock and
// (2) changes only the cells it means to change - never rewrites the whole
// sheet. Before 3.8 two saves that overlapped could undo each other, so a grade
// or a student's draft could silently disappear.
function brWithLock_(fn){const lock=LockService.getScriptLock();const mine=!lock.hasLock();if(mine&&!lock.tryLock(30000))throw new Error('The app is busy saving other work. Please try again in a moment.');try{return fn();}finally{if(mine)lock.releaseLock();}}
function brAppendObject_(ss,name,obj){const sh=ss.getSheetByName(name),headers=BR_SHEETS[name];sh.appendRow(headers.map(h=>obj[h]===undefined?'':obj[h]));}
function brUpdateByKey_(ss,name,key,value,updates){return brUpdateMultiKey_(ss,name,r=>String(r[key])===String(value),updates,name!=='RESPONSES');}
function brUpdateMultiKey_(ss,name,pred,updates,firstOnly){return (()=>{
  const sh=ss.getSheetByName(name),headers=BR_SHEETS[name],lr=sh.getLastRow();if(lr<2)return false;
  const vals=sh.getRange(2,1,lr-1,headers.length).getValues();let matched=false;
  const cols=Object.keys(updates).map(k=>headers.indexOf(k)).filter(i=>i>=0).sort((a,b)=>a-b);
  for(let i=0;i<vals.length;i++){
    const obj={};headers.forEach((h,j)=>obj[h]=brPrimitive_(vals[i][j]));
    if(!pred(obj))continue;
    matched=true;
    // Write only the cells whose value actually changes, in runs of side-by-side cells.
    const diff=cols.filter(j=>String(brPrimitive_(vals[i][j]))!==String(updates[headers[j]]===undefined||updates[headers[j]]===null?'':updates[headers[j]]));
    for(let k=0;k<diff.length;){let e=k;while(e+1<diff.length&&diff[e+1]===diff[e]+1)e++;
      sh.getRange(i+2,diff[k]+1,1,e-k+1).setValues([diff.slice(k,e+1).map(j=>updates[headers[j]])]);k=e+1;}
    if(firstOnly)break;
  }
  return matched;
})();}
function brUpsertUser_(ss,email,name,role,status){email=brNormEmail_(email);const existing=brFindOne_(ss,'USERS','email',email),now=brNow_();if(existing){const nextRole=existing.role==='admin'?'admin':role;brUpdateByKey_(ss,'USERS','email',email,{name:name||existing.name,role:nextRole,status:status||existing.status,updatedAt:now});return Object.assign(existing,{name:name||existing.name,role:nextRole,status:status||existing.status,updatedAt:now});}const row={email,name:name||brNameFromEmail_(email),role,status,createdAt:now,updatedAt:now};brAppendObject_(ss,'USERS',row);return row;}
function brRequireTeacher_(ss){const email=brRequireEmail_(),admin=(PropertiesService.getScriptProperties().getProperty(BR_ADMIN_PROP)||'').toLowerCase();let u=brFindOne_(ss,'USERS','email',email);if(email===admin){if(!u)u=brUpsertUser_(ss,email,brNameFromEmail_(email),'admin','active');return {email,role:'admin',isAdmin:true};}if(!u||!['teacher','admin'].includes(u.role)||u.status!=='active')throw new Error('Teacher access is not active for this account.');return {email,role:u.role,isAdmin:u.role==='admin'};}
function brRequireAdmin_(ss){const t=brRequireTeacher_(ss);if(!t.isAdmin)throw new Error('Admin access required.');return t;}
function brTeacherClasses_(ss,email,isAdmin){return brRows_(ss,'CLASSES').filter(r=>brBool_(r.active)&&(isAdmin||brNormEmail_(r.teacherEmail)===email));}
function brStudentClasses_(ss,email){const enroll=brRows_(ss,'ENROLL').filter(r=>brNormEmail_(r.studentEmail)===email&&brBool_(r.active));const ids=new Set(enroll.map(r=>r.classId));return brRows_(ss,'CLASSES').filter(r=>ids.has(r.classId)&&brBool_(r.active)).map(r=>({classId:r.classId,className:r.className,period:r.period,grade:r.grade,teacherEmail:r.teacherEmail}));}
function brOwnedClass_(ss,classId,teacher){const c=brFindOne_(ss,'CLASSES','classId',String(classId||''));if(!c||!brBool_(c.active))throw new Error('Class not found.');if(!teacher.isAdmin&&brNormEmail_(c.teacherEmail)!==teacher.email)throw new Error('You do not own this class.');return c;}
function brEnrolledClass_(ss,classId,email){const c=brFindOne_(ss,'CLASSES','classId',String(classId||''));if(!c||!brBool_(c.active))throw new Error('Class not found.');const e=brRows_(ss,'ENROLL').find(r=>r.classId===c.classId&&brNormEmail_(r.studentEmail)===email&&brBool_(r.active));if(!e)throw new Error('You are not enrolled in this class.');return c;}
function brOwnedAssignment_(ss,id,teacher){const a=brFindOne_(ss,'ASSIGNMENTS','assignmentId',String(id||''));if(!a||!brBool_(a.active))throw new Error('Assignment not found.');brOwnedClass_(ss,a.classId,teacher);return a;}
function brAssignmentForStudent_(ss,id,email){const a=brFindOne_(ss,'ASSIGNMENTS','assignmentId',String(id||''));if(!a||!brBool_(a.active))throw new Error('Assignment not found.');brEnrolledClass_(ss,a.classId,email);return a;}
function brStudentAssignment_(a,r){return {assignmentId:a.assignmentId,classId:a.classId,title:a.title,category:a.category,prompt:a.prompt,directions:a.directions,responseType:a.responseType,assessmentType:'rubric5',pointsPossible:5,dueAt:a.dueAt,response:r?{text:r.text,imageUrl:r.imageUrl,drawingData:r.drawingData,status:r.status,score:r.score,feedback:r.feedback,submittedAt:r.submittedAt,updatedAt:r.updatedAt,process:brProcParse_(r.processJson)}:null};}
function brUniqueJoinCode_(ss){const used=new Set(brRows_(ss,'CLASSES').map(r=>String(r.joinCode).toUpperCase()));const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let n=0;n<100;n++){let s='';for(let i=0;i<6;i++)s+=chars[Math.floor(Math.random()*chars.length)];if(!used.has(s))return s;}throw new Error('Could not create a unique class code.');}
function brHash_(s){const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s));return bytes.map(b=>(b+256)%256).map(b=>('0'+b.toString(16)).slice(-2)).join('');}
function brCsvCell_(v){let s=String(v==null?'':v);if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function brCsvSafeName_(s){return String(s||'export').replace(/[^a-z0-9 _-]/gi,'').trim().replace(/\s+/g,'_').slice(0,80)||'export';}
function brSafe_(obj){return JSON.parse(JSON.stringify(obj));}
