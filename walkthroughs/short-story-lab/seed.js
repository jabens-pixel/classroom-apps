// Pretend class for the Short Story Lab tour: a teacher and five students. Runs through the app's real server code.
module.exports = async function seed({ rpc }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupShortStoryBackend', [], T);
  const c = await rpc('createClass', [{ className: 'English 1', period: '2' }], T);
  const names = [['Ava', 'Lee'], ['Ben', 'Cruz'], ['Cy', 'Kim'], ['Dani', 'Ortiz'], ['Eli', 'Park']];
  const S = names.map(n => (n[0] + '.' + n[1]).toLowerCase() + '@yourschool.org');
  for (let i = 0; i < S.length; i++) await rpc('joinClass', [{ code: c.joinCode, first: names[i][0], last: names[i][1] }], S[i]);
  return { teacher: T, student: S[0], classId: c.classId, info: JSON.stringify(c).slice(0, 200) };
};
