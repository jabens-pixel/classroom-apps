# The Great Gatsby

A Great Gatsby unit with the full novel (public domain in the US since 2021), activities, grading and Canvas.

Grades 11–12 · Google Apps Script · free · works with any Google Workspace for Education school.

## Use it in your classroom (about 10 minutes)

**Easiest: make a copy** from the [website](https://jabens-pixel.github.io/classroom-apps/) once this app's copy link is up. Your students' work saves to *your* Google Drive.

**Or build it from this folder:**
1. Go to [script.google.com](https://script.google.com) and start a **New project** named "The Great Gatsby".
2. Add every `.js` and `.html` file in this folder with the same names (`Code.js` goes into the existing **Code.gs**). Turn on **Project Settings → Show "appsscript.json"** and paste that file too.
3. In the editor, choose **`setupGatsbyBackend`** in the function list and click **Run**. Approve Google's permission prompt. This builds the app's backend Sheet in your Drive and makes **you** the admin.
4. **Deploy → New deployment → Web app.** Execute as: *Me*. Who has access: *anyone in your school domain*. Share that link with your students.

If you use clasp: `clasp create --type standalone --title "The Great Gatsby"` in this folder, then `clasp push` and continue at step 3.

## Optional extras

- **Canvas:** Teacher dashboard → Canvas. Each teacher pastes their own Canvas access token. It is stored for that teacher only.
- **AI feedback** (in apps that have it): add a script property `GEMINI_API_KEY` with your own key (Project Settings → Script properties).
- **Time zone:** the copy is set to Pacific/Honolulu. Change `timeZone` in appsscript.json to yours.

## Updates

New versions are posted here. To update, replace your files with the new ones and deploy a **new version** of your existing deployment (Deploy → Manage deployments → pencil → New version), so your student link stays the same. Your students' work is never touched by an update.
