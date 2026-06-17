import Link from 'next/link';
import { listSessionsLite, resolveProjectPath, formatBytes } from '@/lib/sessions';
import { SessionCard } from '@/components/SessionCard';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const decoded = decodeURIComponent(project);
  const [sessions, decodedPath] = await Promise.all([
    listSessionsLite(decoded),
    resolveProjectPath(decoded),
  ]);

  // Group by day for chronological readability
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const day = s.lastActivityAt.slice(0, 10); // YYYY-MM-DD
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(s);
  }
  const sortedDays = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
  const totalBytes = sessions.reduce((s, x) => s + x.bytes, 0);

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-xs text-[color:var(--muted)] hover:text-white">← all projects</Link>
        <h1 className="mt-2 text-xl font-semibold font-mono tracking-tight break-all">{decodedPath}</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          {sessions.length} sessions · {formatBytes(totalBytes)} · grouped by day, newest first
        </p>
      </div>

      <div className="space-y-6">
        {sortedDays.map(day => (
          <section key={day}>
            <h2 className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-mono mb-2 sticky top-12 bg-[color:var(--bg)] py-1 z-[5]">
              {day} <span className="text-zinc-600">({groups.get(day)!.length})</span>
            </h2>
            <div className="space-y-2">
              {groups.get(day)!.map(s => (
                <SessionCard
                  key={s.id}
                  project={decoded}
                  sessionId={s.id}
                  lastActivity={s.lastActivityAt}
                  bytes={s.bytes}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
