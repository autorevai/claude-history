import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { PROJECTS_DIR, resolveProjectPath } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type Hit = {
  project: string;
  projectPath: string;
  sessionId: string;
  lastActivityAt: string;
  matchCount: number;
  snippets: string[];
};

async function searchFile(path: string, regexes: RegExp[]): Promise<{ count: number; snippets: string[] } | null> {
  let count = 0;
  const snippets: string[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (count >= 3 && snippets.length >= 3) break;
      // cheap pre-check: all regexes must match somewhere in the raw line
      let matchesAll = true;
      for (const r of regexes) {
        if (!r.test(line)) { matchesAll = false; break; }
        r.lastIndex = 0;
      }
      if (!matchesAll) continue;

      // try to extract real text from JSON
      let text = '';
      try {
        const obj = JSON.parse(line);
        const c = obj?.message?.content;
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) text = c.map((x: { text?: string; content?: unknown }) => x.text ?? (typeof x.content === 'string' ? x.content : '')).join(' ');
      } catch {
        text = line;
      }

      // confirm against extracted text
      let allInText = true;
      for (const r of regexes) { if (!r.test(text)) { allInText = false; break; } r.lastIndex = 0; }
      if (!allInText) continue;

      count += 1;
      if (snippets.length < 3) {
        // build snippet around first match
        const firstMatch = text.search(regexes[0]);
        regexes[0].lastIndex = 0;
        const start = Math.max(0, firstMatch - 80);
        const snippet = text.slice(start, start + 280).replace(/\s+/g, ' ').trim();
        snippets.push((start > 0 ? '…' : '') + snippet + '…');
      }
    }
  } finally {
    rl.close();
  }

  return count > 0 ? { count, snippets } : null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ hits: [], message: 'query must be at least 2 characters' });
  }

  // multi-word AND search: each space-separated term must match
  const terms = q.split(/\s+/).filter(t => t.length > 0);
  const regexes = terms.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  const projectPathCache = new Map<string, string>();
  const hits: Hit[] = [];

  let projectDirs: string[];
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  // bounded concurrency to avoid blowing fd limits
  const concurrency = 8;
  const fileTasks: Array<{ project: string; file: string; path: string; mtime: number; bytes: number }> = [];

  for (const project of projectDirs) {
    let files: string[];
    try { files = await readdir(join(PROJECTS_DIR, project)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = join(PROJECTS_DIR, project, f);
      try {
        const s = await stat(fp);
        fileTasks.push({ project, file: f, path: fp, mtime: s.mtimeMs, bytes: s.size });
      } catch { continue; }
    }
  }

  let idx = 0;
  async function worker() {
    while (idx < fileTasks.length) {
      const i = idx++;
      const t = fileTasks[i];
      try {
        const result = await searchFile(t.path, regexes);
        if (!result) continue;
        let pp = projectPathCache.get(t.project);
        if (!pp) { pp = await resolveProjectPath(t.project); projectPathCache.set(t.project, pp); }
        hits.push({
          project: t.project,
          projectPath: pp,
          sessionId: basename(t.file, '.jsonl'),
          lastActivityAt: new Date(t.mtime).toISOString(),
          matchCount: result.count,
          snippets: result.snippets,
        });
      } catch { /* skip */ }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  hits.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return NextResponse.json({ hits: hits.slice(0, 100), total: hits.length, query: q });
}
