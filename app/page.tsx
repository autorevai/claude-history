import Link from 'next/link';
import { listProjects, formatBytes, formatRelative } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const projects = await listProjects();
  const totalSessions = projects.reduce((s, p) => s + p.sessionCount, 0);
  const totalBytes = projects.reduce((s, p) => s + p.totalBytes, 0);

  return (
    <div>
      {/* hero */}
      <section className="mb-9">
        <h1 className="text-3xl font-semibold tracking-tight">
          Every Claude Code session, <span className="brand-gradient">searchable</span>.
        </h1>
        <p className="text-sm text-[color:var(--muted)] mt-2 max-w-2xl leading-relaxed">
          Search by meaning, grade your sessions by impact, and jump back into any conversation —
          all from the transcripts already on your machine. Private, local, no API key.
        </p>

        {/* fake search bar → /search */}
        <Link href="/search"
          className="mt-5 flex items-center gap-3 card card-accent px-4 py-3 max-w-2xl text-sm text-[color:var(--muted)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <span>Search your sessions by meaning or keyword…</span>
          <span className="ml-auto chip">⌘ open</span>
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs font-mono text-[color:var(--muted)]">
          <span>{projects.length} projects</span>
          <span>·</span>
          <span>{totalSessions.toLocaleString()} sessions</span>
          <span>·</span>
          <span>{formatBytes(totalBytes)} of history</span>
        </div>
      </section>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-mono text-[color:var(--muted)] uppercase tracking-widest">projects</h2>
        <Link href="/recent" className="text-xs px-3 py-1.5 rounded-md border border-[color:var(--border)] hover:border-[color:var(--border-strong)] font-mono text-[color:var(--muted)] hover:text-white">
          recent across projects →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {projects.map(p => (
          <Link key={p.id} href={`/p/${encodeURIComponent(p.id)}`} className="block card card-hover p-4">
            <div className="font-mono text-sm truncate text-zinc-200">{p.decodedPath.split('/').slice(-2).join('/')}</div>
            <div className="text-[11px] font-mono text-[color:var(--muted)] opacity-60 truncate mt-0.5">{p.decodedPath}</div>
            <div className="mt-2.5 flex items-center gap-3 text-xs text-[color:var(--muted)] font-mono">
              <span className="text-zinc-300">{p.sessionCount}</span><span>session{p.sessionCount === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{formatBytes(p.totalBytes)}</span>
              <span>·</span>
              <span>{formatRelative(p.lastActivity)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
