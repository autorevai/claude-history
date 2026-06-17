'use client';

import { useState } from 'react';

/**
 * Copies `claude --resume <id>` to the clipboard. The intended flow: copy here,
 * open a new integrated terminal in VS Code (Ctrl+`), paste, hit enter. No desktop
 * Terminal window, no auto-launch — you stay in your editor.
 */
export function ResumeButton({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cmd = `claude --resume ${sessionId}`;

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  if (compact) {
    return (
      <button
        onClick={copy}
        title={`Copy "${cmd}" — paste into a VS Code terminal`}
        className="shrink-0 font-mono rounded border border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-zinc-100 hover:bg-[color:var(--accent)]/30 transition-colors text-[10px] px-2 py-1"
      >
        {copied ? '✓ copied' : '⧉ resume'}
      </button>
    );
  }

  return (
    <button
      onClick={copy}
      title="Paste into a new VS Code terminal (Ctrl+`)"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[color:var(--accent)] hover:opacity-90 text-white text-xs font-mono"
    >
      {copied ? '✓ copied — paste in a terminal' : `⧉ copy: ${cmd}`}
    </button>
  );
}
