# Hosting Margin (Supabase + Vercel)

Hosted Margin adds sign-in and shared projects. A project stays in your browser until you choose
**Work together → Share this project**; after that it is stored in Supabase and only the accounts
you add can open it. Everyone else who signs in sees only their own projects and the demo.

Before sharing real interview data, confirm that your IRB protocol allows de-identified transcripts
to be stored with Supabase (a US cloud database).

## 1. Supabase (you, in the web dashboard)

1. Create a new project, e.g. `ceal-margin`. Keep it separate from the study app's project.
2. **SQL Editor → New query**: paste all of `supabase/migrations/202610040001_margin.sql`, run it once.
   It only creates Margin's own `margin_*` tables, access rules and functions.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up" and
   **off** anonymous sign-ins. Only accounts you create can then sign in.
4. **Authentication → Users → Add user** for each person (email + password, auto-confirm).
   The user's ID shown there is what you paste into **People** when sharing a project.
5. **Project Settings → API**: note the project URL, the publishable (anon) key and the secret
   (service role) key. Don't paste them into chat.

## 2. Vercel

Create a Vercel project for this folder (`npx vercel link`). Until Supabase is set up it can serve the
browser-only demo (each visitor's work stays in their own browser).

1. You, in the Vercel dashboard → ceal-margin → Settings → Environment Variables (Production):
   - `SUPABASE_URL` = the project URL
   - `SUPABASE_PUBLISHABLE_KEY` = the publishable (anon) key
   - `SUPABASE_SECRET_KEY` = the secret (service role) key
2. Me: `npx vercel deploy --prod` from this folder. Vercel then builds hosted mode
   (`npm run build:hosted`, from `vercel.json`) at the same address. Then a sign-in and sharing
   check with a test account.

## 3. Move a study in

In your local Margin, **Export → Project backup** so your own edits come along. Then sign in on
the hosted site, **Open a project backup** → that file, then **Work together →
Share this project** and add your co-authors under **People**. (Shared projects can be up to 1.5 MB;
a study with about 15 interviews and 500 quotes is roughly 1 MB.)

## Local mode still works

`npm run dev` (or the login item) runs the local, browser-only app at http://127.0.0.1:5173 as before.
`npm run dev:hosted:test` previews hosted mode locally with synthetic accounts
(`reader-a@example.invalid` / `synthetic-only-password`).
