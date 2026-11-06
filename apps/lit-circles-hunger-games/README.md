# Hunger Games & Ender’s Game Lit Circles

A four-week literature circle unit where each group picks its novel: The Hunger Games (Suzanne Collins) or Ender’s Game (Orson Scott Card). Two assigned reading strategies a week, built-in reading quizzes for both books, discussion, peer and self assessment, grading and Canvas. Students need their own copy of the book.

Grades 9 · Google Apps Script · free for teachers and schools · works with any Google Workspace for Education school.

## Use it in your classroom (about 5 minutes)

**[Step-by-step with pictures](https://jabens-pixel.github.io/classroom-apps/setup/)**, including Google's "hasn't verified this app" screen.

1. **[Make a copy](https://docs.google.com/spreadsheets/d/1OA1mHfE8VGhnNCJ32zScy0zA1e_iPfd9gNGQSC2OQ8I/copy)** and click **Make a copy** in Google's box. The copy is a Google Sheet in *your* Drive.
2. In your copy, click **Classroom App ▸ Set up my app** (the menu appears a few seconds after the Sheet opens).
3. Approve Google's permission screen. Because your copy is your own app, which Google hasn't reviewed, Google says **"Google hasn't verified this app"** (a note in the corner of the Sheet warns you first). That's expected, and only you see it, once: click **Advanced ▸ Go to … (unsafe)**, then **Allow**. Your students never get this screen. Then click **Set up my app** once more if the box didn't appear.
4. The setup runs by itself. A box then walks you through publishing (Google only lets the owner do this part):
   **Open the app's code page ▸ Deploy ▸ New deployment ▸ ⚙ Web app ▸ Execute as: Me ▸ Who has access: Anyone within your school ▸ Deploy.**
5. Copy the **Web app** link (it ends in `/exec`), paste it into the box and click **Save my student link**. Share it in Canvas, Google Classroom or your class page. Open it yourself first to make a class.

Your students' work saves to this Sheet, in your Drive. You can find the link again under **Classroom App ▸ Show my student link**.

## Optional extras

- **Canvas:** Teacher dashboard → Canvas. Each teacher pastes their own Canvas access token. It is stored for that teacher only.
- **AI feedback** (in apps that have it): add a script property `GEMINI_API_KEY` with your own key (Extensions ▸ Apps Script ▸ Project Settings ▸ Script properties).
- **Time zone:** the copy is set to Pacific/Honolulu. Change `timeZone` in appsscript.json to yours.

## Updates

New versions are posted here. Paste the new files into your copy (Extensions ▸ Apps Script), then click **Deploy ▸ Manage deployments ▸ ✎ ▸ Version: New version ▸ Deploy**. The student link stays the same, and your students' work is never touched by an update.
