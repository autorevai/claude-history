/**
 * Index store — a single JSON file at ~/.claude/history-cache/index.json holding
 * one record per Claude Code session, plus incremental scan logic.
 *
 * Why JSON, not SQLite: at ~1-10k sessions the whole index is a few MB and scans
 * in-memory in <10ms. Zero native deps (no better-sqlite3 / node:sqlite flag
 * fragility across Node versions), trivially portable for an eventual OSS release.
 *
 * Enrichment (LLM title/summary/tags/status) and embeddings live in sibling files
 * but are keyed back to these records so a base re-scan never destroys them unless
 * the underlying transcript actually changed (mtime guard).
 */
import { readFile, writeFile, readdir, stat, mkdir, rename } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PROJECTS_DIR, resolveProjectPath, type RawLine } from './sessions';

export const CACHE_DIR = join(homedir(), '.claude', 'history-cache');
export const INDEX_PATH = join(CACHE_DIR, 'index.json');

// Bump when parseSession's output shape changes — forces a re-parse of unchanged
// files on the next scan so old records pick up new fields (kind, impact, …).
export const SCHEMA_VERSION = 4;

// The enrichment labeler runs `claude -p` in this throwaway cwd; the sessions it
// spawns land in ~/.claude/projects and must be excluded from our own index.
export const LABELER_DIRNAME = 'labeler';

export type SessionStatus = 'completed' | 'in_progress' | 'abandoned' | 'unknown';
export type SessionKind = 'interactive' | 'agent';

/** Deterministic work signals harvested from the transcript (no LLM). */
export type ImpactSignals = {
  edits: number;        // Edit tool calls
  writes: number;       // Write tool calls
  bash: number;         // Bash tool calls
  commits: number;      // `git commit` invocations
  pushes: number;       // `git push` invocations
  prs: number;          // `gh pr create` invocations
  filesTouched: number; // unique file paths edited/written
  toolTotal: number;    // all tool_use blocks
  score: number;        // weighted impact score
};

export type IndexRecord = {
  key: string;           // `${projectId}__${sessionId}`
  projectId: string;
  projectPath: string;
  sessionId: string;
  mtime: number;
  bytes: number;
  firstActivity: string | null;
  lastActivity: string | null;
  messageCount: number;
  userMessageCount: number;
  approxTokens: number;
  fallbackTitle: string;       // first real user message, cleaned
  searchText: string;          // cleaned user-message text, capped (keyword search corpus)
  firstMsgKey: string;         // normalized first-message fingerprint (bot-cluster detection)
  kind: SessionKind;           // interactive (a real chat) vs agent (app/headless runtime spam)
  impact: ImpactSignals;       // deterministic work signals + score
  commitSubjects: string[];    // git commit subject lines made in this session (newest last)
  schemaV: number;             // parseSession output version (re-parse trigger)
  // --- enrichment (LLM, optional) ---
  title?: string;
  summary?: string;
  tags?: string[];
  status?: SessionStatus;
  enriched?: boolean;
  enrichedMtime?: number;      // transcript mtime at enrichment time
  // --- embedding bookkeeping (vectors live in embeddings file) ---
  embedded?: boolean;
  embeddedMtime?: number;
  embedVersion?: number;
  indexedAt: string;
};

type IndexFile = { version: number; records: Record<string, IndexRecord> };

const CLEAN_RE = [
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
  /<command-args>/g,
  /<\/command-args>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<persisted-output>[\s\S]*?<\/persisted-output>/g,
];

function cleanUserText(text: string): string {
  let t = text;
  for (const re of CLEAN_RE) t = t.replace(re, ' ');
  // drop bare screenshot/temp-file path noise that dominates some first messages
  t = t.replace(/'\/[^']*?\.(png|jpg|jpeg|pdf|mov|gif)'/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function extractText(content: RawLine['message'] extends infer M ? M extends { content?: infer C } ? C : never : never): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text?: string } => typeof c === 'object' && c !== null && 'type' in c)
      .map(c => (c.type === 'text' && c.text ? c.text : ''))
      .join('');
  }
  return '';
}

async function* readJsonlLines(path: string): AsyncGenerator<RawLine> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line) as RawLine; } catch { continue; }
  }
}

const SEARCH_TEXT_CAP = 8000;

/**
 * Extract git commit subject lines from a Bash command, anchored to `git commit -m`
 * so trailing `echo`/`&&` noise can't leak in. Handles three forms:
 *   git commit -m "subject"
 *   git commit -m 'subject'
 *   git commit -m "$(cat <<'EOF'\nsubject\nbody…\nEOF\n)"   ← this repo's convention
 */
function extractCommitSubjects(cmd: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const ci = cmd.indexOf('git commit', from);
    if (ci < 0) break;
    from = ci + 10;
    const seg = cmd.slice(ci, ci + 4000);
    const mi = seg.search(/-m\b/);
    if (mi < 0) continue;
    const rest = seg.slice(mi + 2).replace(/^\s+/, '');
    let subject = '';
    if (/^["']?\$\(cat\s+<<-?\s*['"]?\w+/.test(rest)) {
      // heredoc: subject is the first non-empty line after the opener line
      const afterOpener = rest.slice(rest.indexOf('\n') + 1);
      subject = afterOpener.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    } else if (rest[0] === '"' || rest[0] === "'") {
      const end = rest.indexOf(rest[0], 1);
      subject = (end > 0 ? rest.slice(1, end) : rest.slice(1)).split('\n')[0];
    } else {
      subject = rest.split('\n')[0].split(/\s&&|\s;|\s\|/)[0];
    }
    subject = subject.replace(/["'`]/g, '').trim().slice(0, 90);
    if (subject.length >= 3 && !subject.startsWith('$')) out.push(subject);
  }
  return out;
}

function scoreImpact(s: Omit<ImpactSignals, 'score'>): number {
  return (
    s.prs * 8 +
    s.commits * 5 +
    s.pushes * 4 +
    s.writes * 2 +
    s.edits * 1 +
    Math.min(s.filesTouched, 30) * 0.6 +
    s.bash * 0.15
  );
}

/** One pass over a transcript → base metadata + work signals (no LLM, no embedding). */
export async function parseSession(
  projectId: string,
  projectPath: string,
  sessionId: string,
  mtime: number,
  bytes: number
): Promise<IndexRecord | null> {
  const path = join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
  try {
    let firstActivity: string | null = null;
    let lastActivity: string | null = null;
    let fallbackTitle = '';
    let messageCount = 0;
    let userMessageCount = 0;
    let approxTokens = 0;
    const userChunks: string[] = [];
    let searchLen = 0;

    let edits = 0, writes = 0, bash = 0, commits = 0, pushes = 0, prs = 0, toolTotal = 0;
    const files = new Set<string>();
    const commitSubjects: string[] = [];
    let interactiveMarker = false;

    for await (const line of readJsonlLines(path)) {
      // Interactive Claude Code sessions emit these line types; headless `claude -p`
      // runs (cron jobs, app copilots) never do. This is the bot-vs-human classifier.
      if (line.type === 'mode' || line.type === 'permission-mode' ||
          line.type === 'file-history-snapshot' || line.type === 'ai-title') {
        interactiveMarker = true;
      }
      if (line.type !== 'user' && line.type !== 'assistant') continue;
      messageCount += 1;
      if (line.timestamp) {
        if (!firstActivity) firstActivity = line.timestamp;
        lastActivity = line.timestamp;
      }
      const content = line.message?.content;
      const raw = extractText(content ?? '');
      approxTokens += Math.ceil(raw.length / 4);

      // harvest tool-use work signals from assistant turns
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c !== 'object' || c === null || (c as { type?: string }).type !== 'tool_use') continue;
          const block = c as { name?: string; input?: unknown };
          toolTotal += 1;
          const name = block.name ?? '';
          const input = (block.input ?? {}) as { file_path?: string; command?: string };
          if (name === 'Edit' || name === 'NotebookEdit') { edits += 1; if (input.file_path) files.add(input.file_path); }
          else if (name === 'Write') { writes += 1; if (input.file_path) files.add(input.file_path); }
          else if (name === 'Bash') {
            bash += 1;
            const rawCmd = input.command ?? '';
            const cmd = rawCmd.toLowerCase();
            if (/\bgit\s+commit\b/.test(cmd)) {
              commits += 1;
              for (const s of extractCommitSubjects(rawCmd)) {
                if (commitSubjects.length < 40) commitSubjects.push(s);
              }
            }
            if (/\bgit\s+push\b/.test(cmd)) pushes += 1;
            if (/\bgh\s+pr\s+create\b/.test(cmd)) prs += 1;
          }
        }
      }

      if (line.type === 'user') {
        userMessageCount += 1;
        const cleaned = cleanUserText(raw);
        if (cleaned) {
          if (!fallbackTitle) fallbackTitle = cleaned.slice(0, 140);
          if (searchLen < SEARCH_TEXT_CAP) {
            const take = cleaned.slice(0, SEARCH_TEXT_CAP - searchLen);
            userChunks.push(take);
            searchLen += take.length;
          }
        }
      }
      if (line.message?.usage) {
        const u = line.message.usage;
        approxTokens = Math.max(approxTokens, (u.input_tokens ?? 0) + (u.output_tokens ?? 0));
      }
    }

    if (messageCount === 0) return null;

    const impactBase = { edits, writes, bash, commits, pushes, prs, filesTouched: files.size, toolTotal };
    const impact: ImpactSignals = { ...impactBase, score: Math.round(scoreImpact(impactBase) * 10) / 10 };

    return {
      key: `${projectId}__${sessionId}`,
      projectId,
      projectPath,
      sessionId,
      mtime,
      bytes,
      firstActivity,
      lastActivity: lastActivity ?? new Date(mtime).toISOString(),
      messageCount,
      userMessageCount,
      approxTokens,
      fallbackTitle: fallbackTitle || '(no user message)',
      searchText: [userChunks.join('  •  '), commitSubjects.join('  •  ')].filter(Boolean).join('  •  '),
      firstMsgKey: (fallbackTitle || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120),
      kind: interactiveMarker ? 'interactive' : 'agent',
      impact,
      commitSubjects,
      schemaV: SCHEMA_VERSION,
      indexedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---- persistence (in-memory cache, mtime-guarded reload) ----
let cache: { records: Map<string, IndexRecord>; loadedMtime: number } | null = null;

async function readIndexFile(): Promise<Map<string, IndexRecord>> {
  if (!existsSync(INDEX_PATH)) return new Map();
  try {
    const parsed = JSON.parse(await readFile(INDEX_PATH, 'utf8')) as IndexFile;
    return new Map(Object.entries(parsed.records ?? {}));
  } catch {
    return new Map();
  }
}

export async function loadIndex(): Promise<Map<string, IndexRecord>> {
  let fileMtime = 0;
  try { fileMtime = (await stat(INDEX_PATH)).mtimeMs; } catch { /* no file yet */ }
  if (cache && cache.loadedMtime === fileMtime) return cache.records;
  const records = await readIndexFile();
  cache = { records, loadedMtime: fileMtime };
  return records;
}

export async function saveIndex(records: Map<string, IndexRecord>): Promise<void> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
  const obj: IndexFile = { version: 1, records: Object.fromEntries(records) };
  const tmp = INDEX_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(obj));
  await rename(tmp, INDEX_PATH);          // atomic swap
  cache = null;                           // force reload with fresh mtime next read
}

export type ScanStats = { total: number; added: number; updated: number; unchanged: number; removed: number };

/**
 * Incremental base scan: walk every project's *.jsonl, (re)parse only new or
 * changed files (mtime guard), drop records whose file disappeared. Preserves
 * enrichment + embedding flags when the transcript is unchanged; clears them when
 * it changed so the next enrich/embed pass refreshes that session.
 */
export async function scanBase(): Promise<ScanStats> {
  const existing = await loadIndex();
  const next = new Map<string, IndexRecord>();
  const stats: ScanStats = { total: 0, added: 0, updated: 0, unchanged: 0, removed: 0 };

  let projectDirs: string[] = [];
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return stats;
  }

  for (const projectId of projectDirs) {
    const dir = join(PROJECTS_DIR, projectId);
    let files: string[];
    try { files = await readdir(dir); } catch { continue; }
    const jsonl = files.filter(f => f.endsWith('.jsonl'));
    if (jsonl.length === 0) continue;
    const projectPath = await resolveProjectPath(projectId);
    // skip the labeler's own throwaway sessions (claude -p runtime spawned by enrich)
    if (projectPath.includes(`history-cache/${LABELER_DIRNAME}`) || projectPath.includes('history-cache')) continue;

    for (const f of jsonl) {
      const sessionId = f.replace(/\.jsonl$/, '');
      const key = `${projectId}__${sessionId}`;
      let s;
      try { s = await stat(join(dir, f)); } catch { continue; }
      stats.total += 1;

      const prev = existing.get(key);
      if (prev && prev.mtime === s.mtimeMs) {
        // unchanged file. If the record predates the current schema, re-parse to
        // backfill new fields while preserving enrichment + embedding.
        if (prev.schemaV === SCHEMA_VERSION) {
          next.set(key, { ...prev, projectPath });
        } else {
          const reparsed = await parseSession(projectId, projectPath, sessionId, s.mtimeMs, s.size);
          next.set(key, reparsed ? {
            ...reparsed,
            title: prev.title, summary: prev.summary, tags: prev.tags, status: prev.status,
            enriched: prev.enriched, enrichedMtime: prev.enrichedMtime,
            embedded: prev.embedded, embeddedMtime: prev.embeddedMtime, embedVersion: prev.embedVersion,
          } : { ...prev, projectPath });
        }
        stats.unchanged += 1;
        continue;
      }

      const parsed = await parseSession(projectId, projectPath, sessionId, s.mtimeMs, s.size);
      if (!parsed) continue;
      if (prev) {
        // changed transcript: carry nothing stale — enrichment/embedding must redo
        next.set(key, parsed);
        stats.updated += 1;
      } else {
        next.set(key, parsed);
        stats.added += 1;
      }
    }
  }

  stats.removed = [...existing.keys()].filter(k => !next.has(k)).length;
  await saveIndex(next);
  return stats;
}

export type IndexStatus = {
  total: number;
  interactive: number;
  agent: number;
  enriched: number;
  embedded: number;
  hasApiKey: boolean;
  lastScanAt: string | null;
};

export async function getStatus(): Promise<IndexStatus> {
  const records = await loadIndex();
  // enriched/embedded are only ever applied to interactive sessions, so count them
  // within that set — keeps the coverage percentages coherent (≤ 100%).
  let enriched = 0, embedded = 0, agent = 0, lastScanAt: string | null = null;
  for (const r of records.values()) {
    if (r.kind === 'agent') { agent += 1; continue; }
    if (r.enriched) enriched += 1;
    if (r.embedded) embedded += 1;
    if (!lastScanAt || (r.indexedAt > lastScanAt)) lastScanAt = r.indexedAt;
  }
  return {
    total: records.size,
    interactive: records.size - agent,
    agent,
    enriched,
    embedded,
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    lastScanAt,
  };
}
