<div align="center">

# claude·history

**Search, grade, and resume every Claude Code session on your machine.**

A local-first dashboard that turns the raw JSONL transcripts in `~/.claude/projects`
into a searchable, AI-labeled, resumable library of your work.

100% local · binds to `127.0.0.1` · no API key required · MIT licensed

</div>

---

## Why

Claude Code stores every session as a JSONL transcript on disk — but they're named by
UUID, scattered across project folders, and **deleted after 30 days by default**. If you
close a terminal or VS Code, finding that one session where you fixed the gnarly bug means
grepping UUIDs by hand.

`claude·history` fixes that:

- 🔎 **Semantic + keyword search** across every session — find by *meaning*, not exact words
  ("the chat where we emailed resumes to apply for a job" → finds it).
- 🏷️ **AI labels** — every real session gets a clean title, one-line summary, topic tags, and
  a done / in-progress / abandoned status. Runs through your **Claude subscription** (the local
  `claude` CLI), so **no API key and no per-token charges**.
- 🤖 **Bot filtering** — automatically separates *your* chats from headless `claude -p` runtime
  noise (app integrations, cron jobs, automated standups). One project had 905 bot sessions
  drowning 108 real ones; the filter is deterministic and app-agnostic.
- ★ **Impact grading** — sessions are scored by real work signals pulled from the transcript
  (`git commit`, `git push`, `gh pr create`, files edited). Sort by impact to surface your most
  productive sessions.
- ⧉ **One-click resume** — copy `claude --resume <id>` and paste into a new terminal.
- 🗂️ **Faceted browsing** — filter by topic, status, or project; facets cut across all projects.

Everything runs on your machine. Nothing is uploaded. The server binds to loopback only.

---

## Quick start

```bash
git clone https://github.com/autorevai/claude-history.git
cd claude-history
npm install
npm run dev
```

Open **http://127.0.0.1:4000** and click **🔍 find & resume**.

First run, build the index from the control bar at the top of the search page:

1. **rescan** — parse every transcript (~5s for ~1,000 sessions).
2. **build semantic** — generate local embeddings for meaning-based search (no key, runs on-device).
3. **AI labels** — titles / summaries / tags via your `claude` CLI subscription (optional, ~0.5s each).

All three are **incremental and resumable** — re-run them anytime to pick up new sessions.

---

## Privacy & how auth works

- **The web app never leaves your machine.** `next dev` / `next start` bind to `127.0.0.1:4000`.
- **Semantic search is fully on-device** — embeddings use a local
  [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) model (~25 MB, downloaded once).
- **AI labels use your Claude subscription, not an API key.** The labeler shells out to the local
  `claude` CLI (`claude -p`), which authenticates with your logged-in subscription. The code:
  - never imports the Anthropic SDK, and
  - explicitly **deletes `ANTHROPIC_API_KEY` from the subprocess environment** before every call,
  so a billed token key physically cannot be used.

If you don't have the `claude` CLI installed, everything except AI labels still works.

---

## Keep more history

Claude Code purges transcripts older than `cleanupPeriodDays` (default **30**). To keep more,
add this to `~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 90 }
```

(`claude·history` can only show what's still on disk — older sessions are already gone.)

---

## How it works

```
~/.claude/projects/<encoded-cwd>/<session>.jsonl   ← Claude Code writes these
                │
       lib/index-store.ts   scan → parse → classify (interactive vs bot) → impact score
                │
   ~/.claude/history-cache/index.json               ← one JSON record per session
                │
        ┌───────┴────────┐
   lib/embed.ts       lib/enrich.ts
   local vectors      claude CLI labels
        │                  │
   embeddings.json    (title/summary/tags/status merged into index.json)
                │
        lib/search-index.ts   keyword · semantic · hybrid · facets · sort
                │
            Next.js UI (app/search)
```

| File | Responsibility |
|------|----------------|
| `lib/index-store.ts` | Scan, parse, classify (bot vs human), impact scoring, JSON persistence |
| `lib/embed.ts` | Local MiniLM embeddings + cosine search |
| `lib/enrich.ts` | AI labels via the `claude` CLI (subscription auth, no API key) |
| `lib/search-index.ts` | Keyword / semantic / hybrid search, facets, sort modes |
| `lib/sessions.ts` | Low-level JSONL reading + transcript rendering |
| `app/search` | The command center UI (search, facets, index controls) |

The index is a plain JSON file — no database, no native deps beyond the embedding model.
At a few thousand sessions it loads and searches in-memory in milliseconds.

---

## Tech stack

Next.js 15 (App Router) · React 19 · Tailwind · `@xenova/transformers` (local embeddings) ·
the `claude` CLI for labels.

---

## Roadmap / ideas to build on

- Resume-chain linking (group continuation sessions into one thread)
- Watch mode (auto-index new sessions as they're written)
- Export / archive sessions before the retention window deletes them
- Cross-machine sync of the index
- Per-session diff view (what files changed)

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE)
