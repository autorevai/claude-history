import Link from 'next/link';
import { listRecentAcrossProjects } from '@/lib/sessions';
import { SessionCard } from '@/components/SessionCard';

export const dynamic = 'force-dynamic';

export default async function RecentPage() {
  const recent = await listRecentAcrossProjects(30);

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-xs text-[color:var(--muted)] hover:text-white">← all projects</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Recent across all projects</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Last {recent.length} sessions touched across any project. Click a card to view, or use "copy resume" to get the terminal command.
        </p>
      </div>

      <div className="space-y-3">
        {recent.map(s => (
          <div key={`${s.project}-${s.id}`}>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)] font-mono mb-1 ml-1 truncate">
              {s.projectPath}
            </div>
            <SessionCard
              project={s.project}
              sessionId={s.id}
              lastActivity={s.lastActivityAt}
              bytes={s.bytes}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
