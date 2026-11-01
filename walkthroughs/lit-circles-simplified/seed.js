// Pretend class for the Lit Circles (Simplified) tour: a teacher, three students in one group reading a public-domain
// novel, plus the app's built-in demo students (two more groups with work in progress). Week 1 and 2 open.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupLiteratureCirclesBackend', [], T);
  const c = await rpc('createLiteratureClass', [{ className: 'English 1', period: '3' }], T);
  const classId = c.classInfo.classId, code = c.classInfo.joinCode;
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) await rpc('joinLiteratureClass', [{ joinCode: code, firstName: names[i][0], lastName: names[i][1] }], S[i]);
  await rpc('saveGroupSetup', [S[0], 'The Call of the Wild', S.join(','), ['Ch. 1–2', 'Ch. 3–4', 'Ch. 5', 'Ch. 6–7']], S[0]);
  for (const w of [1, 2]) await rpc('setLiteratureWeekRelease', [{ classId, week: w, released: true }], T);
  await rpc('seedLiteratureCirclesDemoStudents', [{ classId }], T);
  return { teacher: T, student: S[0], classId };
};
