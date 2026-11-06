// Pretend class for the Hunger Games & Ender's Game Lit Circles tour: a teacher, three students in a
// Hunger Games group, three in an Ender's Game group, plus the app's built-in demo students (two more
// groups with work in progress). Week 1 and 2 open.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupLiteratureCirclesBackend', [], T);
  const c = await rpc('createLiteratureClass', [{ className: 'English 1', period: '3' }], T);
  const classId = c.classInfo.classId, code = c.classInfo.joinCode;
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) await rpc('joinLiteratureClass', [{ joinCode: code, firstName: names[i][0], lastName: names[i][1] }], S[i]);
  await rpc('saveGroupSetup', [S[0], 'The Hunger Games', S.join(','), ['Ch. 1–2', 'Ch. 3–4', 'Ch. 5', 'Ch. 6–7']], S[0]);
  // A second group on the other book (the app's sections for it are fixed; the reading list sent is ignored).
  const names2 = [['Dia', 'Reyes'], ['Eli', 'Moss'], ['Fay', 'Ng']];
  const S2 = names2.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S2.length; i++) await rpc('joinLiteratureClass', [{ joinCode: code, firstName: names2[i][0], lastName: names2[i][1] }], S2[i]);
  await rpc('saveGroupSetup', [S2[0], 'Ender’s Game', S2.join(','), []], S2[0]);
  for (const w of [1, 2]) await rpc('setLiteratureWeekRelease', [{ classId, week: w, released: true }], T);
  await rpc('seedLiteratureCirclesDemoStudents', [{ classId }], T);
  return { teacher: T, student: S[0], classId };
};
