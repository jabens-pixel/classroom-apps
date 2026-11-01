// Adds the background music to a tour video (record.js does this itself after recording).
//   node walkthroughs/tool/music.js <app>      adds music to walkthroughs/out/<app>.mp4 again
// The music is tool/music/upbeat.mp3 (original, made by tool/music/make-music.py) unless the tour script
// sets "music": "<another file in tool/music>" or "music": false. It fades in, ducks under nothing, and
// fades out with the video; the video picture is copied as is.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function musicFile(script) {
  if (script && script.music === false) return '';
  const f = path.join(__dirname, 'music', (script && typeof script.music === 'string') ? script.music : 'upbeat.mp3');
  return fs.existsSync(f) ? f : '';
}

function addMusic(mp4, script) {
  const music = musicFile(script); if (!music) return false;
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
  const vol = script && script.musicVolume != null ? script.musicVolume : 0.45;
  const tmp = mp4.replace(/\.mp4$/, '.music.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-stream_loop', '-1', '-i', music,
    '-filter_complex', `[1:a]atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, mp4);
  return true;
}

module.exports = { addMusic };
if (require.main === module) {
  const app = process.argv[2];
  const root = path.resolve(__dirname, '..', '..');
  const scriptFile = path.join(root, 'walkthroughs', app, 'walkthrough.json');
  const script = fs.existsSync(scriptFile) ? JSON.parse(fs.readFileSync(scriptFile, 'utf8')) : {};
  const mp4 = path.join(root, 'walkthroughs', 'out', app + '.mp4');
  // A video that already has music: take the picture only, then add the music again.
  const hasAudio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', mp4]).toString().trim();
  if (hasAudio) { const tmp = mp4.replace(/\.mp4$/, '.picture.mp4'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-an', '-c:v', 'copy', tmp]); fs.renameSync(tmp, mp4); }
  console.log(app + ': ' + (addMusic(mp4, script) ? 'music added' : 'no music (turned off or no music file)'));
}
