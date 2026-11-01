// Pretend class for the Podcast Studio tour: a teacher, six students, a little work and one grade.
// Runs through the app's real server code. Returns the people the tour signs in as.
module.exports = async function seed({ rpc, ev }) {
  const T = 'teacher@yourschool.org';
  await ev("setupPodcastStudio(); return 1;", T);
  const c = await ev("return createClass({className:'Creative Writing', period:'3'});", T);
  const classId = c.classId, code = c.classes[0].joinCode;
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim'], ['Dani', 'Ortiz'], ['Eli', 'Park'], ['Fia', 'Moana']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) await ev("return joinClass({code:'" + code + "', firstName:'" + names[i][0] + "', lastName:'" + names[i][1] + "'});", S[i]);
  for (const w of [1, 2, 3]) await ev("return setWeekRelease({classId:'" + classId + "', week:" + w + ", on:true});", T);
  const save = (u, wk, act, f, submit) => ev("var it=getStudentItem({classId:'" + classId + "',week:" + wk + ",act:'" + act + "'}); return saveWork({classId:'" + classId + "',week:" + wk + ",act:'" + act + "',data:{f:" + JSON.stringify(f) + "},base:it.updatedAt||it.loadedAt,submit:" + !!submit + "});", u);
  await save(S[0], 1, 'listen1', { episode: 'moth_48', hook: 'It starts mid-story, with no music. I wanted to know why he was scared.', map: [{ t: '0:00', part: 'Cold open', does: 'Drops you into the moment.' }, { t: '1:10', part: 'Rising stakes', does: 'His son wants to ride.' }, { t: '4:30', part: 'Turn', does: 'He gets on.' }, { t: '7:40', part: 'Wrap-up', does: 'What he learned.' }], sound: 'No music at all, just the room laughing.', voice: 'Calm, a little nervous, funny.', stay: 'Leaned in at 4:30. Drifted around 2:00.', steal: 'Start in the middle.' }, true);
  await save(S[1], 1, 'listen1', { episode: 'storycorps_qa', hook: 'A kid asks his mom a question.', map: [{ t: '0:00', part: 'Cold open', does: 'Question' }] }, true);
  await save(S[2], 1, 'listen1', { episode: 'shortwave_scream', hook: 'A scream!' }, false);
  await save(S[1], 2, 'concept', { name: 'Bench Notes', tagline: 'A podcast about the rules nobody reads', crew: 'Crew', members: 'Ben Cruz, Cy Kim', format: 'Conversation (co-hosts)' }, true);
  await save(S[0], 2, 'concept', { name: 'Small Fears', tagline: 'Little things that scare big people', crew: 'Solo', format: 'Narrative story' }, true);
  await save(S[0], 2, 'script', { runsheet: [{ t: '0:00', seg: 'Cold open', what: 'Elevator door closing', sound: 'Ambient: elevator' }], text: 'The elevator doors close. My heart stops. This is Small Fears.', bites: [] }, true);
  await save(S[1], 3, 'episode', { link: 'https://www.canva.com/design/DAHexample/view', title: 'Bench Notes 1: The Mercy Rule', length: '4:12', notes: 'Our first episode.', credits: 'Ben and Cy.' }, true);
  await ev("var m=getMarking({classId:'" + classId + "',itemKey:'w1_listen1'}); var r=m.rows.filter(function(x){return x.email==='" + S[1] + "';})[0]; return saveGrade({classId:'" + classId + "',itemKey:'w1_listen1',email:'" + S[1] + "',score:2.5,markedFp:r.viewFp,comment:''});", T);
  await ev("return postDiscussion({classId:'" + classId + "',week:1,act:'goodpod',text:'1. A hook in the first 20 seconds. 2. Real sound. 3. A voice that fits the show.',clientId:'a'});", S[0]);
  await ev("return addDemoStudents({classId:'" + classId + "'});", T);
  return { teacher: T, student: S[0] };
};
