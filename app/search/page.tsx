'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IndexBar } from '@/components/IndexBar';
import { ResumeButton } from '@/components/ResumeButton';

type Impact = {
  edits: number; writes: number; bash: number; commits: number;
  pushes: number; prs: number; filesTouched: number; toolTotal: number; score: number;
};
type Hit = {
  key: string;
  projectId: string;
  projectPath: string;
  sessionId: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  kind: 'interactive' | 'agent';
  impact: Impact;
  lastCommit: string | null;
  commitSubjects: string[];
  lastActivityAt: string | null;
  messageCount: number;
  approxTokens: number;
  score: number;
  snippet: string;
};
type Sort = 'relevance' | 'recent' | 'impact';
type Facets = {
  projects: Array<{ id: string; path: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
};
type Mode = 'hybrid' | 'semantic' | 'keyword';

function rel(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-400',
  in_progress: 'text-amber-400',
  abandoned: 'text-rose-400',
  unknown: 'text-zinc-500',
};

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [sort, setSort] = useState<Sort>('relevance');
  const [includeAgent, setIncludeAgent] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [semAvail, setSemAvail] = useState(true);
  const [facets, setFacets] = useState<Facets | null>(null);

  const loadFacets = useCallback(async () => {
    try { const r = await fetch(`/api/facets${includeAgent ? '?includeAgent=1' : ''}`); setFacets(await r.json()); } catch { /* ignore */ }
  }, [includeAgent]);
  useEffect(() => { loadFacets(); }, [loadFacets]);

  const run = useCallback(async (
    query: string, m: Mode, s: Sort, incAgent: boolean,
    f: { project: string | null; tag: string | null; status: string | null }
  ) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (query) sp.set('q', query);
      sp.set('mode', m);
      sp.set('sort', s);
      if (incAgent) sp.set('includeAgent', '1');
      if (f.project) sp.set('project', f.project);
      if (f.tag) sp.set('tag', f.tag);
      if (f.status) sp.set('status', f.status);
      const r = await fetch(`/api/search2?${sp.toString()}`);
      const d = await r.json();
      setHits(d.hits ?? []);
      setTotal(d.total ?? 0);
      setSemAvail(d.semanticAvailable ?? false);
    } finally { setLoading(false); }
  }, []);

  // re-run whenever query/mode/sort/filters change (debounced on query)
  useEffect(() => {
    const t = setTimeout(() => { run(q.trim(), mode, sort, includeAgent, { project, tag, status }); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, mode, sort, includeAgent, project, tag, status, run]);

  function syncUrl(query: string) {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    router.replace(`/search${sp.toString() ? `?${sp}` : ''}`);
  }

  const activeFilters = [project, tag, status].filter(Boolean).length;

  return (
    <div>
      <div className="mb-4">
        <Link href="/" className="text-xs text-[color:var(--muted)] hover:text-white">← all projects</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Find &amp; resume a session</h1>
      </div>

      <IndexBar onChange={loadFacets} />

      {/* search row */}
      <div className="flex gap-2 mb-3">
        <input
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); syncUrl(e.target.value); }}
          placeholder="search by meaning or keyword — e.g. 'the chat where we emailed resumes to apply for a job'"
          className="flex-1 bg-[#0f0f0f] border border-[color:var(--border)] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
        />
        <div className="flex rounded-md border border-[color:var(--border)] overflow-hidden text-xs font-mono">
          {(['hybrid', 'semantic', 'keyword'] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 ${mode === m ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* sort + scope controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs font-mono">
        <span className="text-[color:var(--muted)]">sort</span>
        <div className="flex rounded-md border border-[color:var(--border)] overflow-hidden">
          {(['relevance', 'recent', 'impact'] as Sort[]).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-2.5 py-0.5 ${sort === s ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}>
              {s === 'impact' ? '★ impact' : s}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[color:var(--muted)] cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={includeAgent} onChange={e => setIncludeAgent(e.target.checked)} className="accent-[color:var(--accent)]" />
          show app/bot sessions
        </label>
      </div>

      {(mode !== 'keyword') && !semAvail && q && (
        <div className="text-[11px] font-mono text-amber-400/80 mb-3">
          semantic index empty — click &quot;build semantic&quot; above. Showing keyword results.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
        {/* facet sidebar */}
        <aside className="text-xs font-mono space-y-5">
          {activeFilters > 0 && (
            <button onClick={() => { setProject(null); setTag(null); setStatus(null); }}
              className="text-[color:var(--accent)] hover:underline">✕ clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}</button>
          )}
          {facets && facets.tags.length > 0 && (
            <FacetGroup title="topics">
              {facets.tags.slice(0, 22).map(t => (
                <FacetRow key={t.tag} active={tag === t.tag} label={t.tag} count={t.count}
                  onClick={() => setTag(tag === t.tag ? null : t.tag)} />
              ))}
            </FacetGroup>
          )}
          {facets && (
            <FacetGroup title="status">
              {facets.statuses.map(s => (
                <FacetRow key={s.status} active={status === s.status}
                  label={s.status} count={s.count} colorClass={STATUS_COLOR[s.status]}
                  onClick={() => setStatus(status === s.status ? null : s.status)} />
              ))}
            </FacetGroup>
          )}
          {facets && (
            <FacetGroup title="projects">
              {facets.projects.slice(0, 16).map(p => (
                <FacetRow key={p.id} active={project === p.id}
                  label={p.path.split('/').pop() || p.id} count={p.count}
                  onClick={() => setProject(project === p.id ? null : p.id)} />
              ))}
            </FacetGroup>
          )}
        </aside>

        {/* results */}
        <div>
          <div className="text-xs text-[color:var(--muted)] mb-3 font-mono">
            {loading ? 'searching…' : `${total.toLocaleString()} session${total === 1 ? '' : 's'}${q ? '' : ' (most recent)'}`}
          </div>
          <div className="space-y-2.5">
            {hits.map(h => (
              <div
                key={h.key}
                onClick={() => router.push(`/s/${encodeURIComponent(h.projectId)}/${h.sessionId}`)}
                className="block card card-accent p-3.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-100 leading-snug">{h.title}</div>
                    {h.summary && <div className="text-xs text-zinc-400 mt-0.5 leading-snug">{h.summary}</div>}
                  </div>
                  <ResumeButton sessionId={h.sessionId} compact />
                </div>
                {h.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {h.tags.map(t => (
                      <button key={t} onClick={(e) => { e.stopPropagation(); setTag(t); }} className="chip chip-btn font-mono">
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {h.lastCommit && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] font-mono text-emerald-400/80" title={h.commitSubjects.slice(-6).join('\n')}>
                    <span className="opacity-60 shrink-0">⎇ latest commit:</span>
                    <span className="text-emerald-300/90 truncate">{h.lastCommit}</span>
                    {h.impact.commits > 1 && <span className="opacity-50 shrink-0">+{h.impact.commits - 1} more</span>}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[color:var(--muted)] font-mono">
                  <span className="truncate max-w-[260px]">{h.projectPath.split('/').slice(-2).join('/')}</span>
                  <span>·</span><span>{rel(h.lastActivityAt)}</span>
                  <span>·</span><span>{h.messageCount} msgs</span>
                  {h.impact?.score > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-amber-300/90" title={`impact score ${h.impact.score}`}>★ {h.impact.score}</span>
                      {h.impact.commits > 0 && <span className="text-emerald-400/90">{h.impact.commits} commit{h.impact.commits > 1 ? 's' : ''}</span>}
                      {h.impact.prs > 0 && <span className="text-sky-400/90">{h.impact.prs} PR{h.impact.prs > 1 ? 's' : ''}</span>}
                      {h.impact.filesTouched > 0 && <span>{h.impact.filesTouched} file{h.impact.filesTouched > 1 ? 's' : ''}</span>}
                    </>
                  )}
                  {h.kind === 'agent' && (<><span>·</span><span className="text-rose-400/70">app/bot</span></>)}
                  {h.status !== 'unknown' && (<><span>·</span><span className={STATUS_COLOR[h.status]}>{h.status}</span></>)}
                  {h.score > 0 && mode !== 'keyword' && sort === 'relevance' && (<><span>·</span><span className="opacity-60">{(h.score * 100).toFixed(0)}% match</span></>)}
                </div>
              </div>
            ))}
            {!loading && hits.length === 0 && (
              <div className="text-sm text-[color:var(--muted)]">No sessions matched.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)] mb-1.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function FacetRow({ label, count, active, onClick, colorClass }: { label: string; count: number; active: boolean; onClick: () => void; colorClass?: string }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-1.5 py-0.5 rounded hover:bg-[#161616] ${active ? 'bg-[color:var(--accent)]/20 text-white' : colorClass ?? 'text-zinc-400'}`}>
      <span className="truncate">{label}</span>
      <span className="opacity-50 shrink-0">{count}</span>
    </button>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[color:var(--muted)]">loading…</div>}>
      <SearchInner />
    </Suspense>
  );
}
