'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  project: string;
  sessionId: string;
  fallbackTitle?: string;
  lastActivity: string;
  messageCount?: number;
  approxTokens?: number;
  bytes: number;
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function SessionCard({ project, sessionId, fallbackTitle, lastActivity, messageCount, approxTokens, bytes }: Props) {
  const [summary, setSummary] = useState<{ topic: string; outcome: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/summary/${encodeURIComponent(project)}/${sessionId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => { if (!cancelled) setSummary({ topic: data.topic, outcome: data.outcome }); })
      .catch(() => { /* fallback title shown */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, sessionId]);

  async function copyResume(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(`claude --resume ${sessionId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function open() {
    router.push(`/s/${encodeURIComponent(project)}/${sessionId}`);
  }

  return (
    <div
      onClick={open}
      className="block border border-[color:var(--border)] rounded-lg p-4 hover:border-[color:var(--accent)] hover:bg-[#111] transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {summary?.topic ? (
            <div className="text-sm font-medium text-zinc-100">{summary.topic}</div>
          ) : (
            <div className={`text-sm ${loading ? 'text-zinc-500 italic' : 'text-zinc-300'}`}>
              {loading ? 'summarizing...' : (fallbackTitle ?? sessionId.slice(0, 8))}
            </div>
          )}
          {summary?.outcome && (
            <div className="text-xs text-zinc-400 mt-1 leading-snug">{summary.outcome}</div>
          )}
        </div>
        <button
          onClick={copyResume}
          className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-[color:var(--border)] hover:border-[color:var(--accent)] text-zinc-300 hover:text-white"
          title={`Copies: claude --resume ${sessionId}`}
        >
          {copied ? '✓ copied' : 'copy resume'}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted)] font-mono">
        <span>{formatRelative(lastActivity)}</span>
        {messageCount !== undefined && (<><span>·</span><span>{messageCount} msgs</span></>)}
        {approxTokens !== undefined && approxTokens > 0 && (<><span>·</span><span>~{approxTokens.toLocaleString()} tokens</span></>)}
        <span>·</span>
        <span>{formatBytes(bytes)}</span>
        <span>·</span>
        <span className="opacity-60">{sessionId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
