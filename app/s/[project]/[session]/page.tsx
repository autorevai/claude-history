import Link from 'next/link';
import { readSession, summarizeSession, resolveProjectPath, formatRelative } from '@/lib/sessions';
import { MessageList } from '@/components/MessageView';
import { ResumeButton } from '@/components/ResumeButton';

export const dynamic = 'force-dynamic';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ project: string; session: string }>;
}) {
  const { project, session } = await params;
  const decoded = decodeURIComponent(project);
  const summary = await summarizeSession(decoded, session);
  const messages = await readSession(decoded, session);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/p/${encodeURIComponent(decoded)}`}
            className="text-xs text-[color:var(--muted)] hover:text-white"
          >
            ← {await resolveProjectPath(decoded)}
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight break-words">
            {summary?.title ?? '(session)'}
          </h1>
          <p className="text-xs text-[color:var(--muted)] mt-1 font-mono">
            {summary?.messageCount ?? messages.length} messages · last activity {formatRelative(summary?.lastActivityAt ?? null)} · {session}
          </p>
        </div>
        <div className="shrink-0">
          <ResumeButton sessionId={session} />
        </div>
      </div>

      <MessageList messages={messages} />
    </div>
  );
}
