# Novel Study

A simple novel study built around books students read in Sora (or any copy they have).

Grades 6–12 · Google Apps Script · free · works with any Google Workspace for Education school.

## Use it in your classroom (about 10 minutes)

**Easiest: [make a copy](https://docs.google.com/spreadsheets/d/1P-UddWYQyj-VCAFTFGRotiNcO_CEgZnCvrQ8JnmvhY0/copy).** Google makes a copy of the app's Sheet (with the app inside it) in *your* account. Then open **Extensions → Apps Script** in your copy and continue at step 3. Your students' work saves to *your* Google Drive.

**Or build it from this folder:**
1. Go to [script.google.com](https://script.google.com) and start a **New project** named "Novel Study".
2. Add every `.js` and `.html` file in this folder with the same names (`Code.js` goes into the existing **Code.gs**). Turn on **Project Settings → Show "appsscript.json"** and paste that file too.
3. In the editor, choose **`setupNovelStudy`** in the function list and click **Run**. Approve Google's permission prompt. This builds the app's backend Sheet in your Drive and makes **you** the admin.
4. **Deploy → New deployment → Web app.** Execute as: *Me*. Who has access: *anyone in your school domain*. Share that link with your students.

If you use clasp: `clasp create --type standalone --title "Novel Study"` in this folder, then `clasp push` and continue at step 3.

## Optional extras

- **Canvas:** Teacher dashboard → Canvas. Each teacher pastes their own Canvas access token. It is stored for that teacher only.
- **AI feedback** (in apps that have it): add a script property `GEMINI_API_KEY` with your own key (Project Settings → Script properties).
- **Time zone:** the copy is set to Pacific/Honolulu. Change `timeZone` in appsscript.json to yours.

## Updates

New versions are posted here. To update, replace your files with the new ones and deploy a **new version** of your existing deployment (Deploy → Manage deployments → pencil → New version), so your student link stays the same. Your students' work is never touched by an update.
