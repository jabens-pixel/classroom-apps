// Pretend class for the Macbeth tour: a teacher and five students. Runs through the app's real server code.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupMacbethBackend', [], T);
  const c = await rpc('createClass', [{ className: 'English 2', period: '4' }], T);
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim'], ['Dani', 'Ortiz'], ['Eli', 'Park']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) await rpc('joinClass', [{ code: c.joinCode, firstName: names[i][0], lastName: names[i][1] }], S[i]);
  return { teacher: T, student: S[0], classId: c.classId };
};
