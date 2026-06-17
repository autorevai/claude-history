/**
 * Search + facets over the in-memory index. Three modes:
 *   - keyword:  AND substring over title+summary+tags+fallbackTitle+searchText (instant)
 *   - semantic: cosine over local embeddings (finds by meaning, no exact words needed)
 *   - hybrid:   semantic recall, then boost rows that also keyword-match (default)
 *
 * Facets (projects, tags, status) are computed from the same loaded index so the UI
 * can offer a filter sidebar that cuts across projects — the "categorize by feature"
 * ask, powered by the LLM tags.
 */
import { loadIndex, type IndexRecord, type SessionStatus, type ImpactSignals } from './index-store';
import { loadEmbeddings, embedQuery, cosine, isEmbeddingAvailable } from './embed';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';
export type SortBy = 'relevance' | 'recent' | 'impact';

export type SearchHit = {
  key: string;
  projectId: string;
  projectPath: string;
  sessionId: string;
  title: string;
  summary: string;
  tags: string[];
  status: SessionStatus;
  kind: 'interactive' | 'agent';
  impact: ImpactSignals;
  lastCommit: string | null;
  commitSubjects: string[];
  lastActivityAt: string | null;
  messageCount: number;
  approxTokens: number;
  score: number;
  snippet: string;
};

export type Facets = {
  projects: Array<{ id: string; path: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  statuses: Array<{ status: SessionStatus; count: number }>;
};

export type SearchFilters = {
  project?: string;
  tag?: string;
  status?: SessionStatus;
  includeAgent?: boolean;   // include templated app/headless sessions (default: hide)
};

function displayTitle(r: IndexRecord): string {
  return r.title || r.fallbackTitle || r.sessionId.slice(0, 8);
}

function matchFilters(r: IndexRecord, f: SearchFilters): boolean {
  if (!f.includeAgent && r.kind === 'agent') return false;
  if (f.project && r.projectId !== f.project) return false;
  if (f.tag && !(r.tags ?? []).includes(f.tag)) return false;
  if (f.status && (r.status ?? 'unknown') !== f.status) return false;
  return true;
}

function haystack(r: IndexRecord): string {
  return `${r.title ?? ''}\n${r.summary ?? ''}\n${(r.tags ?? []).join(' ')}\n${r.fallbackTitle}\n${r.searchText}`.toLowerCase();
}

function makeSnippet(r: IndexRecord, terms: string[]): string {
  const text = r.summary || r.searchText || r.fallbackTitle;
  if (terms.length === 0) return text.slice(0, 200);
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) { const p = lower.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  if (pos < 0) return text.slice(0, 200);
  const start = Math.max(0, pos - 70);
  return (start > 0 ? '…' : '') + text.slice(start, start + 240).trim() + '…';
}

function toHit(r: IndexRecord, score: number, terms: string[]): SearchHit {
  return {
    key: r.key,
    projectId: r.projectId,
    projectPath: r.projectPath,
    sessionId: r.sessionId,
    title: displayTitle(r),
    summary: r.summary ?? '',
    tags: r.tags ?? [],
    status: r.status ?? 'unknown',
    kind: r.kind,
    impact: r.impact,
    lastCommit: r.commitSubjects?.length ? r.commitSubjects[r.commitSubjects.length - 1] : null,
    commitSubjects: r.commitSubjects ?? [],
    lastActivityAt: r.lastActivity,
    messageCount: r.messageCount,
    approxTokens: r.approxTokens,
    score,
    snippet: makeSnippet(r, terms),
  };
}

export async function computeFacets(includeAgent = false): Promise<Facets> {
  const records = await loadIndex();
  const projects = new Map<string, { path: string; count: number }>();
  const tags = new Map<string, number>();
  const statuses = new Map<SessionStatus, number>();

  for (const r of records.values()) {
    if (!includeAgent && r.kind === 'agent') continue;
    const p = projects.get(r.projectId) ?? { path: r.projectPath, count: 0 };
    p.count += 1; projects.set(r.projectId, p);
    for (const t of r.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    const st = r.status ?? 'unknown';
    statuses.set(st, (statuses.get(st) ?? 0) + 1);
  }

  return {
    projects: [...projects.entries()].map(([id, v]) => ({ id, path: v.path, count: v.count }))
      .sort((a, b) => b.count - a.count),
    tags: [...tags.entries()].map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    statuses: [...statuses.entries()].map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function search(
  query: string,
  mode: SearchMode = 'hybrid',
  filters: SearchFilters = {},
  limit = 60,
  sort: SortBy = 'relevance'
): Promise<{ hits: SearchHit[]; total: number; mode: SearchMode; semanticAvailable: boolean }> {
  const records = await loadIndex();
  const pool = [...records.values()].filter(r => matchFilters(r, filters));
  const q = query.trim();
  const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  const byRecent = (a: IndexRecord, b: IndexRecord) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '');
  const byImpact = (a: IndexRecord, b: IndexRecord) => (b.impact?.score ?? 0) - (a.impact?.score ?? 0) || byRecent(a, b);

  // No query → browse mode: sort by recent or impact (respecting filters).
  if (!q) {
    const sorted = pool.sort(sort === 'impact' ? byImpact : byRecent);
    return {
      hits: sorted.slice(0, limit).map(r => toHit(r, 0, [])),
      total: pool.length,
      mode,
      semanticAvailable: false,
    };
  }

  const keywordMatch = (r: IndexRecord) => { const h = haystack(r); return terms.every(t => h.includes(t)); };

  let semanticAvailable = false;
  let semanticScores: Map<string, number> | null = null;

  if (mode === 'semantic' || mode === 'hybrid') {
    const embs = await loadEmbeddings();
    if (embs.size > 0 && (await isEmbeddingAvailable())) {
      semanticAvailable = true;
      const qv = await embedQuery(q);
      semanticScores = new Map();
      for (const r of pool) {
        const v = embs.get(r.key);
        if (v) semanticScores.set(r.key, cosine(qv, v));
      }
    }
  }

  let scored: Array<{ r: IndexRecord; score: number }>;

  if (mode === 'keyword' || (!semanticAvailable && mode !== 'semantic')) {
    // pure keyword (also the fallback when embeddings unavailable in hybrid)
    scored = pool.filter(keywordMatch).map(r => ({ r, score: 1 }))
      .sort((a, b) => (b.r.lastActivity ?? '').localeCompare(a.r.lastActivity ?? ''));
  } else if (mode === 'semantic') {
    if (!semanticScores) {
      return { hits: [], total: 0, mode, semanticAvailable: false };
    }
    scored = pool
      .map(r => ({ r, score: semanticScores!.get(r.key) ?? -1 }))
      .filter(x => x.score > 0.15)
      .sort((a, b) => b.score - a.score);
  } else {
    // hybrid: semantic score + keyword boost
    scored = pool.map(r => {
      const sem = semanticScores!.get(r.key) ?? 0;
      const kw = keywordMatch(r) ? 0.35 : 0;
      // exact tag/title hits get an extra nudge
      const tagHit = terms.some(t => (r.tags ?? []).includes(t)) ? 0.1 : 0;
      return { r, score: sem + kw + tagHit };
    })
      .filter(x => x.score > 0.18)
      .sort((a, b) => b.score - a.score);
  }

  // optional re-sort of the matched set (keeps relevance as the default ranking)
  if (sort === 'recent') scored.sort((a, b) => byRecent(a.r, b.r));
  else if (sort === 'impact') scored.sort((a, b) => byImpact(a.r, b.r));

  return {
    hits: scored.slice(0, limit).map(x => toHit(x.r, x.score, terms)),
    total: scored.length,
    mode,
    semanticAvailable,
  };
}
