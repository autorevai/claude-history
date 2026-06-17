/**
 * LLM enrichment — turns a raw session into a scannable card: a human title, a
 * one-line outcome, 2-5 topic tags, and a status (completed / in_progress /
 * abandoned).
 *
 * AUTH: runs entirely through the local `claude` CLI (`claude -p`), which uses the
 * logged-in Claude subscription — NOT a pay-per-token API key. Two hard guarantees:
 *   1. We never import the Anthropic SDK here, so no billed client can be created.
 *   2. We spawn the CLI with ANTHROPIC_API_KEY explicitly DELETED from the child
 *      env, so even if a key were present it physically cannot be used.
 * Each call writes a throwaway session under a dedicated labeler cwd that the
 * indexer ignores (see LABELER_DIRNAME in index-store).
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readSession, type Message } from './sessions';
import { loadIndex, saveIndex, CACHE_DIR, LABELER_DIRNAME, type IndexRecord, type SessionStatus } from './index-store';

const LABELER_CWD = join(CACHE_DIR, LABELER_DIRNAME);

function flatten(messages: Message[]): string {
  const head = messages.slice(0, 12);
  const tail = messages.length > 16 ? messages.slice(-4) : [];
  const render = (m: Message) => {
    const text = m.text.slice(0, 900);
    const tools = m.toolUses.map(t => `[tool:${t.name}]`).join(' ');
    return `${m.role.toUpperCase()}: ${text} ${tools}`.trim();
  };
  const parts = head.map(render);
  if (tail.length) parts.push('... [later in session] ...', ...tail.map(render));
  return parts.join('\n\n');
}

const INSTRUCTIONS = `You label a Claude Code session transcript so a developer can find it again later.
Output ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "title": "<=70 chars, specific, what this session was actually about (use real file/feature/tech names)",
  "summary": "<=140 chars, what was accomplished, decided, or left unresolved",
  "tags": ["3-6 short lowercase topic tags: feature areas, tech, or domains, e.g. stripe, webhook, auth, dialer; hyphenate multiword, no spaces"],
  "status": "completed | in_progress | abandoned"
}
Be concrete. completed = task got done; in_progress = clearly mid-task at the end; abandoned = started then dropped/blocked. If unsure, use in_progress.`;

const VALID: SessionStatus[] = ['completed', 'in_progress', 'abandoned', 'unknown'];

export type EnrichResult = { title: string; summary: string; tags: string[]; status: SessionStatus };

function parseResult(text: string): EnrichResult | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.slice(0, 100).trim() : '';
    const summary = typeof o.summary === 'string' ? o.summary.slice(0, 200).trim() : '';
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === 'string')
          .map(t => t.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
          .filter(Boolean).slice(0, 6)
      : [];
    const status = (VALID.includes(o.status as SessionStatus) ? o.status : 'unknown') as SessionStatus;
    if (!title) return null;
    return { title, summary, tags, status };
  } catch {
    return null;
  }
}

/** Call the local `claude` CLI headlessly. Subscription auth; API key forcibly removed. */
function runClaude(prompt: string): Promise<string> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;        // hard guarantee: never bill a token API key
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['-p', prompt, '--model', 'haiku', '--output-format', 'json', '--max-turns', '1'],
      { env, cwd: LABELER_CWD, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const env = JSON.parse(stdout) as { result?: string; is_error?: boolean };
          if (env.is_error || typeof env.result !== 'string') return reject(new Error('cli error'));
          resolve(env.result);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

/** Probe: is the `claude` CLI installed + usable (subscription)? Cached. */
let cliOk: boolean | null = null;
export async function isClaudeCliAvailable(): Promise<boolean> {
  if (cliOk !== null) return cliOk;
  try {
    await mkdir(LABELER_CWD, { recursive: true });
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    cliOk = await new Promise<boolean>(resolve => {
      execFile('claude', ['--version'], { env, timeout: 15_000 }, err => resolve(!err));
    });
  } catch {
    cliOk = false;
  }
  return cliOk;
}

async function enrichOne(r: IndexRecord): Promise<EnrichResult | null> {
  const messages = await readSession(r.projectId, r.sessionId);
  if (messages.length === 0) return null;
  const prompt = `${INSTRUCTIONS}\n\nSession (${messages.length} messages):\n\n${flatten(messages)}`;
  const text = await runClaude(prompt);
  return parseResult(text);
}

export type EnrichProgress = { processed: number; failed: number; remaining: number; total: number; cliUnavailable?: boolean };

/**
 * Enrich up to `limit` not-yet-enriched interactive sessions. Batched + resumable so
 * the UI can call repeatedly and show progress. Concurrency kept low: each call
 * spawns a full CLI process.
 */
export async function enrichBatch(limit = 12, concurrency = 3): Promise<EnrichProgress> {
  const records = await loadIndex();
  // skip templated app/headless ("agent") sessions — never worth labeling
  const pending = [...records.values()].filter(r => !r.enriched && r.kind !== 'agent');
  const total = records.size;

  if (!(await isClaudeCliAvailable())) {
    return { processed: 0, failed: 0, remaining: pending.length, total, cliUnavailable: true };
  }

  const batch = pending.slice(0, limit);
  let processed = 0, failed = 0;

  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const r = batch[idx++];
      try {
        const result = await enrichOne(r);
        if (result) {
          r.title = result.title;
          r.summary = result.summary;
          r.tags = result.tags;
          r.status = result.status;
          r.enriched = true;
          r.enrichedMtime = r.mtime;
          r.embedded = false; // fresh label invalidates the embedding (text changed)
          processed += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));

  await saveIndex(records);
  const remaining = [...records.values()].filter(r => !r.enriched && r.kind !== 'agent').length;
  return { processed, failed, remaining, total };
}
