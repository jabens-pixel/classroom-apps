// Pretend class for the Bell Ringers tour: a teacher, five students, two bell ringers from the built-in
// library, and three students' responses to the first. Runs through the app's real server code.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupSchEnglishBellRingers', [], T);
  const c = await rpc('createClass', [{ className: 'English 2', period: '1', grade: '10' }], T);
  const classId = c.class.classId, code = c.class.joinCode;
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim'], ['Dani', 'Ortiz'], ['Eli', 'Park']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) {
    await rpc('joinClass', [{ joinCode: code, studentName: names[i].join(' ') }], S[i]);
    await rpc('setBrStudentName', [{ firstName: names[i][0], lastName: names[i][1] }], S[i]);
  }
  const lib = await rpc('getLibrary', [], T);
  const pick = lib.builtIn.slice(0, 2);
  const made = [];
  for (const it of pick.reverse()) made.push((await rpc('assignBellRinger', [Object.assign({ classId, libraryId: it.id || it.libraryId }, it)], T)).assignment);
  const first = made[made.length - 1];
  const texts = ['The quiet before a storm is louder than the storm. Everyone in the hallway stopped talking at once, and I could hear the clock tick.',
    'My grandmother keeps every receipt in a shoebox. To her, paper is proof that a day happened.',
    'I used to think brave meant not scared. Now I think it means being scared and raising your hand anyway.'];
  for (let i = 1; i <= 3; i++) await rpc('submitResponse', [{ assignmentId: first.assignmentId, text: texts[i - 1], clientUpdatedAt: new Date().toISOString() }], S[i]);
  return { teacher: T, student: S[0], classId, assignmentId: first.assignmentId };
};
