'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '@/lib/sessions';
import { useState } from 'react';

function RoleLabel({ role }: { role: Message['role'] }) {
  const color = role === 'user' ? 'text-sky-400' : role === 'assistant' ? 'text-emerald-400' : 'text-zinc-400';
  return <div className={`text-[10px] uppercase tracking-widest font-mono ${color}`}>{role}</div>;
}

function ToolUse({ name, input }: { name: string; input: unknown }) {
  const [open, setOpen] = useState(false);
  const preview = JSON.stringify(input).slice(0, 120);
  return (
    <div className="my-2 border border-[color:var(--border)] rounded-md bg-[#0f0f0f]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-3 py-2 font-mono text-xs flex items-center justify-between hover:bg-[#151515]"
      >
        <span className="text-amber-400">🔧 {name}</span>
        <span className="text-[color:var(--muted)] truncate ml-3">{preview}</span>
      </button>
      {open && (
        <pre className="px-3 pb-3 text-xs overflow-x-auto text-zinc-300">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResult({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const preview = content.slice(0, 120).replace(/\s+/g, ' ');
  return (
    <div className="my-2 border border-[color:var(--border)] rounded-md bg-[#0f0f0f]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-3 py-2 font-mono text-xs flex items-center justify-between hover:bg-[#151515]"
      >
        <span className="text-zinc-500">↪ result ({content.length} chars)</span>
        <span className="text-[color:var(--muted)] truncate ml-3">{preview}</span>
      </button>
      {open && (
        <pre className="px-3 pb-3 text-xs overflow-x-auto text-zinc-400 whitespace-pre-wrap">
          {content.slice(0, 20_000)}
          {content.length > 20_000 && `\n\n... (${content.length - 20_000} more chars)`}
        </pre>
      )}
    </div>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="space-y-5">
      {messages.map((m, i) => (
        <div key={i} className="border-l-2 pl-4 py-1" style={{ borderColor: m.role === 'user' ? '#0284c7' : m.role === 'assistant' ? '#10b981' : '#52525b' }}>
          <div className="flex items-center gap-3 mb-1">
            <RoleLabel role={m.role} />
            {m.timestamp && (
              <span className="text-[10px] text-[color:var(--muted)] font-mono">
                {new Date(m.timestamp).toLocaleString()}
              </span>
            )}
            {m.tokens && (
              <span className="text-[10px] text-[color:var(--muted)] font-mono">
                {m.tokens.input ? `${m.tokens.input}↓ ` : ''}{m.tokens.output ? `${m.tokens.output}↑` : ''}
              </span>
            )}
          </div>

          {m.text && (
            <div className="prose-claude text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const inline = !className;
                    return !inline && match ? (
                      <SyntaxHighlighter
                        language={match[1]}
                        style={oneDark}
                        customStyle={{ background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 8, fontSize: 13 }}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className={className} {...props}>{children}</code>
                    );
                  },
                }}
              >
                {m.text}
              </ReactMarkdown>
            </div>
          )}

          {m.toolUses.map((t, j) => <ToolUse key={`u-${j}`} name={t.name} input={t.input} />)}
          {m.toolResults.map((t, j) => <ToolResult key={`r-${j}`} content={t.content} />)}
        </div>
      ))}
    </div>
  );
}
