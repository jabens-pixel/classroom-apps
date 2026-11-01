// Pretend class for the Root Word Study tour: a teacher and five students. Runs through the app's real server code.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupRootWordStudy', [], T);
  const c = await rpc('createRootClass', [{ className: 'English 1', period: '3' }], T);
  const code = c.joinCode || (c.classInfo && c.classInfo.joinCode) || (c.class && c.class.joinCode);
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim'], ['Dani', 'Ortiz'], ['Eli', 'Park']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) {
    await rpc('joinRootClass', [{ joinCode: code, firstName: names[i][0], lastName: names[i][1] }], S[i]);
    await rpc('saveMyName', [{ firstName: names[i][0], lastName: names[i][1] }], S[i]);
  }
  return { teacher: T, student: S[0], info: JSON.stringify(c).slice(0, 300) };
};
