'use client';

import { useEffect, useState, useCallback } from 'react';

type Status = { total: number; interactive: number; agent: number; enriched: number; embedded: number; hasApiKey: boolean; lastScanAt: string | null };

/**
 * Index control panel: shows coverage (indexed / AI-labeled / embedded) and runs
 * the three build passes as resumable batch loops with live progress. Lives at the
 * top of the search command center.
 */
export function IndexBar({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | string>(null);
  const [progress, setProgress] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/index/status');
      setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function scan() {
    setBusy('scan'); setProgress('scanning transcripts…');
    try {
      const r = await fetch('/api/index/scan', { method: 'POST' });
      const d = await r.json();
      setProgress(`+${d.stats.added} new, ${d.stats.updated} updated, ${d.stats.total} total`);
      await refresh(); onChange?.();
    } finally { setBusy(null); }
  }

  async function loop(kind: 'enrich' | 'embed', limit: number) {
    setBusy(kind);
    try {
      for (let i = 0; i < 200; i++) {
        const r = await fetch(`/api/index/${kind}?limit=${limit}`, { method: 'POST' });
        const d = await r.json();
        if (d.cliUnavailable) { setProgress('claude CLI not found — install Claude Code to label'); break; }
        if (d.unavailable) { setProgress('embedding model unavailable'); break; }
        const done = d.total - d.remaining;
        setProgress(`${kind === 'enrich' ? 'labeling' : 'embedding'} ${done}/${d.total} (${d.remaining} left)`);
        await refresh();
        if (d.remaining === 0 || (d.processed === 0 && !d.remaining)) break;
        if (d.processed === 0) break;
      }
      onChange?.();
    } finally { setBusy(null); setTimeout(() => setProgress(''), 4000); }
  }

  if (!status) return null;

  const denom = status.interactive || status.total;
  const pct = (n: number) => (denom ? Math.min(100, Math.round((n / denom) * 100)) : 0);
  const Stat = ({ label, n, color, showPct = true }: { label: string; n: number; color: string; showPct?: boolean }) => (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-zinc-300">{n.toLocaleString()}</span>
      <span className="text-[color:var(--muted)]">{label}</span>
      {showPct && <span className="text-[color:var(--muted)] opacity-60">{pct(n)}%</span>}
    </div>
  );

  return (
    <div className="card p-3 mb-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono">
        <Stat label="real chats" n={status.interactive} color="bg-zinc-300" showPct={false} />
        {status.agent > 0 && (
          <span className="flex items-center gap-1.5 text-[color:var(--muted)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500/60" />
            {status.agent.toLocaleString()} app/bot hidden
          </span>
        )}
        <Stat label="AI-labeled" n={status.enriched} color="bg-emerald-500" />
        <Stat label="embedded" n={status.embedded} color="bg-sky-500" />
        <div className="flex-1" />
        <button onClick={scan} disabled={!!busy}
          className="px-2.5 py-1 rounded border border-[color:var(--border)] hover:border-[color:var(--accent)] disabled:opacity-40">
          {busy === 'scan' ? 'scanning…' : 'rescan'}
        </button>
        <button onClick={() => loop('embed', 128)} disabled={!!busy}
          className="px-2.5 py-1 rounded border border-[color:var(--border)] hover:border-sky-500 disabled:opacity-40">
          {busy === 'embed' ? 'embedding…' : 'build semantic'}
        </button>
        <button onClick={() => loop('enrich', 12)} disabled={!!busy}
          title="Generate AI titles, summaries, tags via your claude CLI subscription (no API key)"
          className="px-2.5 py-1 rounded border border-[color:var(--border)] hover:border-emerald-500 disabled:opacity-40">
          {busy === 'enrich' ? 'labeling…' : 'AI labels'}
        </button>
      </div>
      {progress && <div className="mt-2 text-[11px] font-mono text-[color:var(--accent)]">{progress}</div>}
      <div className="mt-2 text-[11px] font-mono text-[color:var(--muted)]">
        AI labels run through your local <span className="text-zinc-300">claude</span> CLI (Max subscription) — no API key, no token charges.
      </div>
    </div>
  );
}
