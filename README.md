<p align="center">
  <img src="docs/images/ceal.png" width="112" alt="Ceal the seal">
</p>

<h1 align="center">Margin</h1>

<p align="center">
  A quote board for qualitative interview analysis.
  <br>
  <a href="https://ceal-margin.vercel.app"><b>Try the demo</b></a> · <a href="docs/HOSTING.md">Host it for your lab</a>
</p>

![The Margin board: each group is a column of sticky notes, with a map of every group on top](docs/images/board.png)
<p align="center"><sub>A board built from fictional interviews.</sub></p>

Margin is for reading interviews closely and sorting what participants said. Quotes keep the participant's exact words and their place in the transcript. Grouping, notes and memos stay with the researcher: there is no automated coding and no AI.

<table>
  <tr>
    <td width="50%"><img src="docs/images/reader.png" alt="The transcript reader with a selected passage and the panel for filing it into a group"></td>
    <td width="50%"><img src="docs/images/tour.gif" alt="Ceal the seal guiding the first steps of the tour"></td>
  </tr>
  <tr>
    <td>Select a participant's words, then click a group or press its key to file them.</td>
    <td>On a first visit, Ceal walks people through a practice interview.</td>
  </tr>
</table>

## What it does

- **Transcripts.** Import interviews as plain text and confirm who is speaking. Only participant turns can become quotes; interviewer turns stay as context. Keys 1 to 9 file into the first nine groups and 0 into Ungrouped. Further groups can be clicked, or given their own key under Change keys.
- **Board.** Each group is a column of sticky notes in its own color. Drag quotes between groups, write your own notes beside them, and use the map to move around a large board. Group names written as `Section · Name` become section tabs.
- **Memos and codes.** Write memos about what the groups add up to. A codebook, themes and a coding map are there when a project needs more structure.
- **Undo and History.** Undo steps back through your recent changes. History keeps up to 20 restore points per project.
- **Export.** A lossless project backup (JSON), and CSV files for quotes and codes, the codebook, themes, the board and quote notes.
- **Display.** Light, dark or system theme and adjustable text size. Filing, moving and the tour all work from the keyboard.

## Run it locally

Requires Node 22.13 or newer.

```sh
npm ci
npm run dev
npm run open
```

`npm run dev` starts Margin on http://127.0.0.1:5173 and `npm run open` opens it in your browser. `npm run build` followed by `npm run preview` serves the production build on http://127.0.0.1:4178.

## Privacy and where work is saved

Margin is private by default. Work stays on the researcher's own computer unless a lab deliberately sets up hosting, which suits IRB protocols that keep transcripts off outside servers. Margin has no analytics, remote fonts or calls to AI services, and this repository contains only synthetic data.

| | Where projects are saved | Who can open them |
| --- | --- | --- |
| [Demo](https://ceal-margin.vercel.app) | This browser's storage | Only this browser. Clearing site data deletes them, so export backups. |
| Your computer (`npm run dev`) | `margin.sqlite` in Margin's data folder | Your user account. A browser also needs the folder's key, which `npm run open` passes to it. |
| Hosted, if your lab sets it up | Your lab's own Supabase project | Only accounts you invite, and only for the projects they were added to. |

On your computer, clearing browser data does not touch your projects. The data folder is `~/Library/Application Support/Margin` on macOS, `~/.local/share/margin` on Linux and `%APPDATA%\Margin` on Windows. Set `MARGIN_DATA_DIR` to keep it somewhere else, or `MARGIN_STORAGE=browser` to save in the browser instead. The file is not encrypted, so keep disk encryption (FileVault or BitLocker) on, and export backups now and then. The first time a browser opens the data file, any projects it already had are copied into the file.

Hosting is never switched on from inside the app. It is a separate deployment with sign-in, described in [docs/HOSTING.md](docs/HOSTING.md). Check that your IRB protocol allows a cloud database before uploading real transcripts.

## Working together

| | Who can open it | Where the project lives |
| --- | --- | --- |
| Live session | Browsers on the same computer | A small local server on 127.0.0.1:5180 |
| Send a copy | Whoever receives the file | A `.margin.json` backup |
| Hosted | Only the accounts you add | Your lab's Supabase project (Postgres with row-level security), served from Vercel |

## Development

```sh
npm run typecheck
npm run format                                          # Prettier
npm test                                                # unit tests (Vitest)
npm run build && MARGIN_TEST_PRODUCTION=1 npm run test:browser   # browser tests (Playwright, with axe checks)
npm run test:hosted:browser                             # hosted mode: the real migration in PostgreSQL, with simulated sign-in
```

Margin is built with React, TypeScript and Vite. The data model and its integrity checks are in `src/model.ts`, the board is `src/Board.tsx`, saving is `src/storage.ts` (browser) and `server/store.mjs` (the SQLite file), and the shared-edit protocol is `shared/operations.mjs`.

Related open-source tools: [Taguette](https://www.taguette.org/) and [QualCoder](https://qualcoder.wordpress.com/).
