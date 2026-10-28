# Hosting Margin (Supabase + Vercel)

Margin is local by default: projects stay on each researcher's computer. Hosting is an opt-in
deployment for labs that want to share boards online. It adds sign-in, and a project only leaves a
researcher's browser when they choose **Work together → Share this project**. After that it is stored
in the lab's own Supabase project, and only the accounts added to that project can open it. Everyone
else who signs in sees only their own projects and the demo.

Before sharing real interview data, confirm that your IRB protocol allows de-identified transcripts
to be stored with Supabase, a US cloud database.

## 1. Supabase

1. Create a new Supabase project for Margin. Keep it separate from any other study app.
2. **SQL Editor → New query**: paste all of `supabase/migrations/202610040001_margin.sql` and run it
   once. It only creates Margin's own `margin_*` tables, access rules and functions.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up" and turn
   **off** anonymous sign-ins, so only accounts you create can sign in.
4. **Authentication → Users → Add user** for each person (email and password, auto-confirm). The
   user ID shown there is what you paste into **People** when sharing a project.
5. **Project Settings → API**: note the project URL, the publishable (anon) key and the secret
   (service role) key. Keep the secret key out of the repository and out of chat.

## 2. Vercel

1. Create a Vercel project for this folder (`npx vercel link`).
2. In the Vercel dashboard, under **Settings → Environment Variables** (Production), add
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
3. Run `npx vercel deploy --prod`. Vercel builds hosted mode (`npm run build:hosted`, set in
   `vercel.json`).
4. Sign in with a test account, share a synthetic project with a second test account, and check
   that a third account cannot see it.

## 3. Move a study in

In local Margin, use **Export → Project backup**. Then sign in on the hosted site, choose **Open a
project backup** with that file, then **Work together → Share this project** and add your co-authors
under **People**. Shared projects can be up to 1.5 MB; a study with about 15 interviews and 500
quotes is roughly 1 MB.

## What the tests cover

`npm test` runs the migration in a real PostgreSQL engine (PGlite) and checks the access rules: each
role, project membership and row-level security. `npm run test:hosted:browser` runs the hosted app in
a browser against that database. Sign-in in both is simulated with synthetic accounts, so run the
check in step 2.4 against your own Supabase project before inviting anyone.
`npm run dev:hosted:test` previews hosted mode locally with synthetic accounts
(`reader-a@example.invalid` / `synthetic-only-password`).
