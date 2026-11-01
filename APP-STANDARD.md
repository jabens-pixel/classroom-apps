# The Curriculum Vibes app standard

Every app on this site works the same way, so a teacher who knows one knows them all. These are
the rules an app follows before it is listed, whoever wrote it. They come from real classrooms:
almost every rule is here because something once went wrong without it.

If you'd like to add your own app, read this first, then follow **[How to submit an app](#how-to-submit-an-app)**
at the end.

---

## 1. Students never lose work

This rule outranks everything else.

- Writing **saves itself** a few seconds after a student stops typing, and again when they leave
  the page. A copy stays in the browser until the save is confirmed.
- **Two tabs or two devices can't overwrite each other.** A save from an older page is refused,
  and the student chooses which version to keep. The other version is backed up, never thrown away.
- **Submit works once.** A double click can't submit twice, and typing during a submit isn't lost.
- **Nothing is ever deleted** from the students' tabs in the Sheet. Before work is replaced, a backup is kept.
- **Long answers fit.** Text longer than one spreadsheet cell is split across cells and read back whole.
- **Typed text stays text.** "7/7" stays "7/7", never a date.
- **A teacher viewing a student's page can read, but can't change it.**

## 2. Grading works the same in every app

Every app's teacher dashboard looks and behaves like the others.

- **One tile per graded assignment**, grouped by week or part. Each tile shows *To grade · Graded ·
  Not submitted*, a red number when work is waiting, and ↻ when a student redid something after it
  was graded.
- **Grading screen:** the rubric is on screen, students are grouped *Resubmitted → Ready to grade →
  Not submitted → Graded → Excluded*, and there is a **Focused grading** view (one student at a time).
- **Ungraded is blank, never 0.** "Exclude from grade" removes an item for one student or the whole class.
- **Gradebook** with **Push all to Canvas**. Excluded work goes to Canvas as *Excused*.
- Scores and comments save on their own; anything that didn't save is listed with a Retry button.

## 3. Student / Teacher / Admin buttons are always at the top

The header shows the app name, the signed-in account, and the role buttons. Students see none.
Teachers see Student + Teacher; admins see all three. The role always comes from the server,
never from the browser.

## 4. Content

- **No copyrighted book, story or article text.** Public-domain texts may be included. For anything
  else the app ships an empty space the teacher fills in with their own copy.
- **Questions, summaries and supports are your own words.** They may describe a book; they may not quote it.
- **Pictures are yours, public domain, or licensed for this use** — never film stills, book covers or
  characters from someone else's work. Say where each picture came from.
- Lesson content is shared under **CC BY-NC-SA 4.0**; code under **PolyForm Noncommercial 1.0.0**.

## 5. Privacy and setup

- **No personal or school details in the code:** no emails, school domains, Canvas addresses, keys or
  tokens. Secrets go in Script Properties, and each teacher's Canvas token is stored for that teacher only.
- **Everything stays in the teacher's own Google Drive.** No outside servers unless the teacher turns one on.
- **No new Google permissions without a reason.** The usual set is spreadsheets, drive.file,
  userinfo.email and external_request (for Canvas and AI feedback). Explain any other.
- **"Set up my app" works on a fresh copy:** the first person to run it becomes the admin and the copied
  Sheet becomes the app's database. Settings carried over from the template are cleared.

## 6. Looks and feel

- Works on a phone and a laptop, in light and dark mode, with readable contrast.
- Graded work looks different from practice work.
- No dead ends: every focused screen has an obvious way back, and the browser Back button works.
- A **version badge**, and a "new version is ready — Reload" bar that waits for saves to finish.

## 7. A tile picture and a one-minute tour

Every listed app has:

- **A tile picture** in the site's style: one flat, printed-looking picture on cream paper, square,
  at least 1000 × 1000 pixels.
- **A pretend class** (`walkthroughs/<app>/seed.js`) — a teacher, a few made-up students and a little
  work, so the app can be shown without anyone's real data.
- **A tour script** (`walkthroughs/<app>/walkthrough.json`) — the clicks and captions for a
  60–90 second video. The site's video tool turns it into the tour shown on the app's card, and makes
  it again whenever the app changes. See [walkthroughs/README.md](walkthroughs/README.md).

---

## Checklist before an app is listed

Copy this into your submission and tick each line.

- [ ] Writing autosaves, keeps a local copy until saved, and warns before leaving with unsaved work.
- [ ] Two tabs of the same student can't overwrite each other; the older one is asked to choose.
- [ ] Submit can't be sent twice; text typed during submit is kept.
- [ ] A teacher viewing a real student's page can't change it.
- [ ] Teacher dashboard: tiles with To grade / Graded / Not submitted, red counts, ↻ redos.
- [ ] Grading screen with the rubric on screen, the five groups, and Focused grading.
- [ ] Ungraded is blank; Exclude from grade works per student and per class.
- [ ] Gradebook with Push all to Canvas (or the app has no grades — say so).
- [ ] Student / Teacher / Admin buttons at the top.
- [ ] No copyrighted text; pictures are mine, public domain, or licensed (sources listed).
- [ ] No emails, school domains, Canvas addresses or keys in the code.
- [ ] Only the usual Google permissions, or each extra one is explained.
- [ ] "Set up my app" on a fresh copy makes me admin and uses the copied Sheet.
- [ ] Works on a phone; readable in light and dark mode.
- [ ] Tile picture (square, cream paper, flat printed style).
- [ ] Pretend class and tour script in `walkthroughs/<app>/`.

## How to submit an app

1. **Open a "Submit an app" request** on GitHub (Issues → New issue → *Submit an app*). It asks for the
   app's name, grades, what it does, a link to the code (a GitHub fork or a shared Apps Script project),
   where the content and pictures came from, and the checklist above.
2. **Review.** The app is checked against this standard. You'll get a list of anything that needs
   changing, in plain words.
3. **Publishing.** Once it passes, the app gets its "Make a copy" template, its tile picture and its
   tour video, and goes on the site with your name as the author.

By submitting, you agree that your app is shared under this project's licenses and that Jaben Schalk
may also offer it under other terms (see [CONTRIBUTING.md](CONTRIBUTING.md)). You keep the credit.
