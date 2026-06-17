# Contributing

Thanks for wanting to improve `claude·history`! It's a small, hackable codebase — easy to
build on.

## Dev setup

```bash
npm install
npm run dev        # http://127.0.0.1:4000
npx tsc --noEmit   # typecheck
npm run build      # production build check
```

## Architecture in one breath

- The index is a single JSON file at `~/.claude/history-cache/index.json` — one record per
  Claude Code session. No database.
- `lib/index-store.ts` builds it (scan → parse → classify → score). Bump `SCHEMA_VERSION` when
  you change `parseSession`'s output so existing records re-parse on the next scan.
- `lib/embed.ts` (local vectors) and `lib/enrich.ts` (AI labels via the `claude` CLI) decorate
  records but never destroy them — an unchanged transcript keeps its labels/embeddings.
- `lib/search-index.ts` is pure in-memory search/facets/sort over the loaded index.
- The UI lives in `app/` (App Router). The control bar is `components/IndexBar.tsx`.

## Principles

- **Local-first & private.** Don't add network calls that send transcript content anywhere.
  Servers must bind to `127.0.0.1`.
- **No API key for labels.** AI labels go through the `claude` CLI subscription. If you touch
  `lib/enrich.ts`, keep the `delete env.ANTHROPIC_API_KEY` guard.
- **Degrade gracefully.** Every feature should work (or no-op cleanly) when the embedding model
  or `claude` CLI is unavailable.
- **Keep it dependency-light.** The index is JSON on purpose.

## Good first issues

- Resume-chain linking, watch-mode auto-indexing, session export, per-session diff view
  (see the roadmap in the README).

Open a PR with a clear description and a passing `npx tsc --noEmit` + `npm run build`.
