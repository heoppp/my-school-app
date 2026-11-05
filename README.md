# School App

An Android app for attendance and marks. Teachers take attendance and enter marks. Students and parents see their own record with a code — no email or account needed. Everything stays in sync on every phone.

- **Teachers** log in with email and password. Each teacher sees only their own classes.
- **Students** and **parents** each get a 10-character code (like `K7Q2M-9XPBR`) from the teacher. A code opens only that one student's record.

---

## Part 1 — Set up the school's database (one person, once, about 10 minutes)

1. Go to **supabase.com** and sign up (free).
2. Tap **New project**. Give it a name (e.g. `school-register`), make up a database password, choose the region closest to you, and create it. Wait about 2 minutes.
3. In the left menu open **SQL Editor** → **New query**. Copy everything in `supabase/schema.sql`, paste it in, and press **Run**. You should see "Success".
4. Open **Authentication** → **Sign In / Providers** → **Email**. Turn **off** "Confirm email" and save. (Teachers can then log in right after signing up.)
5. Open **Authentication** → **Emails** (Email Templates) → **Reset Password**. Replace the message with:
   ```
   <p>Your School App code is: <b>{{ .Token }}</b></p>
   ```
   and save. (This lets teachers reset a forgotten password inside the app.)
6. Open **Project Settings** → **API**. Copy the **Project URL** and the **anon public** key. You need these in Part 2.

> The anon key is safe to put in the app: the database rules only let teachers see their own classes, and codes only open one student's record.

## Part 2 — Build the app

Every push to `main` builds the app automatically (see the **Actions** tab).

**Recommended:** put your server details into the app so nobody has to type them:

1. In this GitHub repo open **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add `SUPABASE_URL` = your Project URL, and `SUPABASE_ANON_KEY` = your anon public key.
3. Open **Actions** → **Build app** → **Run workflow**.

(If you skip this, the app asks for the server address and key the first time it opens on each phone.)

When the build finishes (about 5 minutes), open the **Releases** page → **Latest build** → download **SchoolApp.apk**. Send this file to teachers, students and parents (WhatsApp, email, etc.). On their Android phone they open it and allow "Install unknown apps".

## Part 3 — Using the app

**Teachers**

1. Open the app → **I'm a teacher** → **Create teacher account**.
2. **+ New class** → type the class name, subject and term.
3. **Students** tab → add each student (roll no. and name).
4. **Attendance** tab → tap **P** (present), **L** (late) or **A** (absent) for each student. "Mark the rest present" fills in everyone not marked yet. Use ‹ › to change the day.
5. **Marks** tab → add a test (name, out of, date) → type each score.
6. **Students** tab → tap a student → **Share** their student code and parent code (WhatsApp, SMS…).

**Students and parents**

1. Open the app → **I'm a student or parent** → type the code from the teacher.
2. They see attendance %, recent days, attendance by month and all marks. It refreshes by itself.
3. The app remembers the code, so next time it opens straight to the record.

If a code is lost or shared with the wrong person, the teacher taps **New code…** on that student. The old code stops working.

## Good to know

- Free Supabase projects pause after 7 days with nobody using them. Open the Supabase dashboard and press **Restore** if that happens. Daily use keeps it awake.
- Students with attendance under 75% or an average under 50% get a red label.
- To delete a class with everything in it: open the class → ⚙ → **Delete class**.

## How it's built

| Folder | What's inside |
|---|---|
| `web/` | The app's screens (HTML, CSS, JavaScript). Works in a phone browser too. |
| `supabase/schema.sql` | Database tables and security rules. |
| `app/` | Android wrapper that bundles `web/` into an APK. |
| `.github/workflows/build.yml` | Builds the APK on GitHub. |
