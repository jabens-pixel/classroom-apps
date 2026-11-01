# Tour videos

Every app on the site has a one-minute tour: a few clicks as a student, then as the teacher, with a
caption for each step. The videos are **made from a script**, so when an app changes, its tour can be
made again in a couple of minutes, and every tour looks the same.

Each app has a folder here:

```
walkthroughs/<app>/seed.js            a pretend class: a teacher, made-up students, a little work
walkthroughs/<app>/walkthrough.json   the tour: captions and clicks
```

The `<app>` name is the app's folder name under `apps/`. The title card uses the app's tile picture
from `docs/img/<app>.webp`.

## Make a video

You need [Node 18+](https://nodejs.org), [ffmpeg](https://ffmpeg.org) and Playwright's Chromium:

```
cd walkthroughs/tool
npm install
npx playwright install chromium
cd ../..
node walkthroughs/tool/record.js <app>
```

The video is saved as `walkthroughs/out/<app>.mp4`. Nothing is sent to Google: the app's real code
runs on your computer against an in-memory stand-in for Google Sheets (`tool/gas.js`), so the video
only ever shows the pretend class.

## Music

Every tour gets the same short, upbeat background track: `tool/music/upbeat.mp3`, an original piece
synthesized from scratch by `tool/music/make-music.py`, so it is free to use anywhere. In a tour script,
`"music": false` turns it off, `"music": "other.mp3"` uses another file from `tool/music/` (only music
you made or are licensed to share), and `"musicVolume": 0.45` sets the level.
`node walkthroughs/tool/music.js <app>` puts the music on an existing video again without re-recording.

## The pretend class (`seed.js`)

`seed.js` sets the app up the way a teacher would, by calling the app's own server functions, and
returns the people the tour signs in as:

```js
module.exports = async function seed({ rpc, ev }) {
  const T = 'teacher@yourschool.org';
  await rpc('setupMyApp', [], T);                         // rpc(functionName, args, signedInAs)
  const c = await rpc('createClass', [{ className: 'English 1' }], T);
  await rpc('joinClass', [{ code: c.joinCode, firstName: 'Ava', lastName: 'Lee' }], 'ava.lee@yourschool.org');
  return { teacher: T, student: 'ava.lee@yourschool.org' };
};
```

Use made-up names and `@yourschool.org` addresses only. `ev(code, signedInAs)` runs a line of
server code directly, for anything there's no single function for.

## The tour (`walkthrough.json`)

```json
{
  "title": "My App",
  "summary": "One sentence for the title card.",
  "reset": "MY_CACHE_ = {};",
  "steps": [
    { "as": "student" },
    { "caption": "The student view.", "hold": 3500 },
    { "click": "#openWeek1", "after": 1200 },
    { "type": "#answer", "text": "Typed one letter at a time." },
    { "scrollTo": ".grade-tile", "block": "center" },
    { "as": "teacher" },
    { "click": "[data-email=\"{student}\"][data-score=\"6\"]" }
  ]
}
```

| Step | What it does |
|---|---|
| `"as": "student"` | Opens the app signed in as that person from `seed.js` (any key it returned). |
| `"caption": "…", "hold": 3500` | Shows a caption, then waits (milliseconds). `""` hides it. |
| `"click": "selector"` | Moves the pointer there and clicks. `"after"` sets the pause afterwards. |
| `"type": "selector", "text": "…"` | Clicks the box and types. `"delay"` sets milliseconds per letter. |
| `"move": "selector"` | Points at something without clicking. |
| `"scrollTo": "selector", "block": "center"` | Scrolls something into view. `"scroll": 300` scrolls by pixels. |
| `"wait": 1000` | Pauses. |
| `"optional": true` | Skips the step if it isn't on the screen, instead of stopping. |

Selectors are ordinary CSS selectors, plus Playwright's `text=…`, `:has-text("…")` and `>> nth=0`.
`{student}`, `{teacher}` and any other key `seed.js` returned are filled in.
`"reset"` is code run before every server call, for apps that keep a per-request cache in a global
(Apps Script starts every call fresh). `"end"` can change the closing card's text.

If a step points at something that isn't on the screen, the recorder stops, says which step, and saves
a screenshot of what the screen showed (`out/stuck-<app>.png`).

**Try it while writing a tour:** `node walkthroughs/tool/explore.js <app> my-steps.js` seeds the app
and runs a little Playwright script of your own, saving screenshots to `out/explore-<app>/`.
`node walkthroughs/tool/server.js apps/<app>` serves the app at http://localhost:8787/?user=<email>
so you can click around yourself.

## Good tours

- 60–90 seconds. Student first, then teacher. Six to ten captions.
- Show what's special about the app, then the grading screen.
- Captions are short, plain sentences: what the viewer is looking at and why it matters.
- No real student names or school details. Made-up content only, or public-domain text.
