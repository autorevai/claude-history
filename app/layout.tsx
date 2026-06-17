import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Claude History — search & resume your Claude Code sessions',
  description:
    'A local, private dashboard to search, grade, and resume every Claude Code session on your machine. Semantic search, AI labels, and one-click resume. Runs entirely on your machine.',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%238b5cf6"/><path d="M16 7a9 9 0 1 0 8.5 6" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round"/><path d="M16 10v6l4 2.4" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
};

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#8b5cf6" />
      <path d="M16 7a9 9 0 1 0 8.5 6" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 10v6l4 2.4" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-[color:var(--border)] sticky top-0 bg-[color:var(--bg)]/85 backdrop-blur z-10">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <Logo />
              <span className="font-mono text-sm font-semibold tracking-tight">
                claude<span className="text-[color:var(--accent-fg)]">·</span>history
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-xs font-mono">
              <Link href="/search" className="px-2.5 py-1.5 rounded-md text-[color:var(--muted)] hover:text-white hover:bg-[color:var(--card)]">search</Link>
              <Link href="/recent" className="px-2.5 py-1.5 rounded-md text-[color:var(--muted)] hover:text-white hover:bg-[color:var(--card)]">recent</Link>
              <a href="https://github.com/autorevai/claude-history" target="_blank" rel="noreferrer"
                 className="px-2.5 py-1.5 rounded-md text-[color:var(--muted)] hover:text-white hover:bg-[color:var(--card)] flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub
              </a>
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-7 w-full flex-1">{children}</main>

        <footer className="border-t border-[color:var(--border)] mt-8">
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[color:var(--muted)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              100% local · binds to 127.0.0.1 · never phones home
            </span>
            <span>reads <span className="text-zinc-400">~/.claude/projects</span> · AI labels via your Claude subscription, no API key</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
