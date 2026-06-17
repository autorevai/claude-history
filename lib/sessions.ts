import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// The AI labeler (lib/enrich.ts) runs `claude -p` in a throwaway cwd under
// ~/.claude/history-cache; the sessions it spawns must never show up as a project.
export function isIgnoredProjectPath(decodedPath: string): boolean {
  return decodedPath.includes('history-cache');
}

export type RawLine = {
  type?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  sessionId?: string;
  timestamp?: string;
  message?: {
    role?: 'user' | 'assistant' | 'system';
    content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown; content?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  toolUseResult?: unknown;
  operation?: string;
  content?: unknown;
};

export type ProjectSummary = {
  id: string;
  decodedPath: string;
  sessionCount: number;
  totalBytes: number;
  lastActivity: string | null;
};

export type SessionSummary = {
  id: string;
  project: string;
  title: string;
  firstUserMessageAt: string | null;
  lastActivityAt: string | null;
  messageCount: number;
  approxTokens: number;
  bytes: number;
};

export type Message = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolUses: Array<{ name: string; input: unknown }>;
  toolResults: Array<{ content: string }>;
  timestamp: string | null;
  tokens?: { input?: number; output?: number };
};

const cwdCache = new Map<string, string>();

function dumbDecode(id: string): string {
  if (id.startsWith('-')) return '/' + id.slice(1).replace(/-/g, '/');
  return id.replace(/-/g, '/');
}

async function readCwdFromJsonl(projectId: string): Promise<string | null> {
  try {
    const files = (await readdir(join(PROJECTS_DIR, projectId))).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) return null;
    for (const f of files.slice(0, 3)) {
      try {
        for await (const line of readJsonlLines(join(PROJECTS_DIR, projectId, f))) {
          const cwd = (line as unknown as { cwd?: string }).cwd;
          if (cwd && typeof cwd === 'string') return cwd;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeProjectId(id: string): string {
  return cwdCache.get(id) ?? dumbDecode(id);
}

export async function resolveProjectPath(id: string): Promise<string> {
  if (cwdCache.has(id)) return cwdCache.get(id)!;
  const cwd = await readCwdFromJsonl(id);
  const resolved = cwd ?? dumbDecode(id);
  cwdCache.set(id, resolved);
  return resolved;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectPath = join(PROJECTS_DIR, entry.name);
    try {
      const files = await readdir(projectPath);
      const jsonl = files.filter(f => f.endsWith('.jsonl'));
      if (jsonl.length === 0) continue;

      const decodedPath = await resolveProjectPath(entry.name);
      if (isIgnoredProjectPath(decodedPath)) continue;

      let totalBytes = 0;
      let lastActivity = 0;
      for (const f of jsonl) {
        const s = await stat(join(projectPath, f));
        totalBytes += s.size;
        if (s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
      }

      projects.push({
        id: entry.name,
        decodedPath,
        sessionCount: jsonl.length,
        totalBytes,
        lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
      });
    } catch {
      continue;
    }
  }

  projects.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
  return projects;
}

async function* readJsonlLines(path: string): AsyncGenerator<RawLine> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as RawLine;
    } catch {
      continue;
    }
  }
}

function extractText(content: RawLine['message'] extends infer M ? M extends { content?: infer C } ? C : never : never): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text?: string } => typeof c === 'object' && c !== null && 'type' in c)
      .map(c => (c.type === 'text' && c.text ? c.text : ''))
      .join('');
  }
  return '';
}

export async function summarizeSession(project: string, sessionId: string): Promise<SessionSummary | null> {
  const path = join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
  try {
    const s = await stat(path);
    let firstUserAt: string | null = null;
    let lastAt: string | null = null;
    let title = '(no user message)';
    let messageCount = 0;
    let approxTokens = 0;

    for await (const line of readJsonlLines(path)) {
      if (line.type === 'user' || line.type === 'assistant') {
        messageCount += 1;
        if (line.timestamp) lastAt = line.timestamp;
        const text = extractText(line.message?.content ?? '');
        approxTokens += Math.ceil(text.length / 4);
        if (line.type === 'user' && !firstUserAt && line.timestamp) {
          firstUserAt = line.timestamp;
          const cleaned = text
            .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
            .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
            .replace(/<command-args>/g, '')
            .replace(/<\/command-args>/g, '')
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
            .trim();
          if (cleaned) title = cleaned.slice(0, 140).replace(/\s+/g, ' ');
        }
      }
      if (line.message?.usage) {
        const u = line.message.usage;
        approxTokens = Math.max(approxTokens, (u.input_tokens ?? 0) + (u.output_tokens ?? 0));
      }
    }

    return {
      id: sessionId,
      project,
      title,
      firstUserMessageAt: firstUserAt,
      lastActivityAt: lastAt ?? new Date(s.mtimeMs).toISOString(),
      messageCount,
      approxTokens,
      bytes: s.size,
    };
  } catch {
    return null;
  }
}

export type SessionLite = {
  id: string;
  lastActivityAt: string;
  bytes: number;
};

export async function listSessionsLite(project: string): Promise<SessionLite[]> {
  const projectPath = join(PROJECTS_DIR, project);
  let files: string[];
  try {
    files = await readdir(projectPath);
  } catch {
    return [];
  }
  const out: SessionLite[] = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const s = await stat(join(projectPath, f));
      out.push({
        id: f.replace(/\.jsonl$/, ''),
        lastActivityAt: new Date(s.mtimeMs).toISOString(),
        bytes: s.size,
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export async function listSessions(project: string): Promise<SessionSummary[]> {
  const projectPath = join(PROJECTS_DIR, project);
  const files = await readdir(projectPath);
  const jsonl = files.filter(f => f.endsWith('.jsonl'));

  const summaries = await Promise.all(
    jsonl.map(f => summarizeSession(project, f.replace(/\.jsonl$/, '')))
  );

  return summaries
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
}

export async function readSession(project: string, sessionId: string): Promise<Message[]> {
  const path = join(PROJECTS_DIR, project, `${sessionId}.jsonl`);
  const messages: Message[] = [];

  for await (const line of readJsonlLines(path)) {
    if (line.type !== 'user' && line.type !== 'assistant') continue;
    const role = line.message?.role ?? (line.type as 'user' | 'assistant');
    const content = line.message?.content;

    const toolUses: Message['toolUses'] = [];
    const toolResults: Message['toolResults'] = [];
    let text = '';

    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c !== 'object' || c === null || !('type' in c)) continue;
        const block = c as { type: string; text?: string; name?: string; input?: unknown; content?: unknown };
        if (block.type === 'text' && block.text) text += block.text;
        else if (block.type === 'tool_use') toolUses.push({ name: block.name ?? '?', input: block.input });
        else if (block.type === 'tool_result') {
          const raw = block.content;
          const rendered = typeof raw === 'string'
            ? raw
            : Array.isArray(raw)
              ? raw.map((r: unknown) => (typeof r === 'object' && r !== null && 'text' in r ? String((r as { text?: string }).text ?? '') : '')).join('')
              : JSON.stringify(raw);
          toolResults.push({ content: rendered });
        }
      }
    }

    messages.push({
      role,
      text,
      toolUses,
      toolResults,
      timestamp: line.timestamp ?? null,
      tokens: line.message?.usage
        ? { input: line.message.usage.input_tokens, output: line.message.usage.output_tokens }
        : undefined,
    });
  }

  return messages;
}

export type RecentSessionLite = {
  id: string;
  project: string;
  projectPath: string;
  lastActivityAt: string;
  bytes: number;
};

export async function listRecentAcrossProjects(limit = 20): Promise<RecentSessionLite[]> {
  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const all: RecentSessionLite[] = [];

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const projectPath = join(PROJECTS_DIR, entry.name);
    const decodedPath = await resolveProjectPath(entry.name);
    if (isIgnoredProjectPath(decodedPath)) continue;
    let files: string[];
    try {
      files = await readdir(projectPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const s = await stat(join(projectPath, f));
        all.push({
          id: f.replace(/\.jsonl$/, ''),
          project: entry.name,
          projectPath: decodedPath,
          lastActivityAt: new Date(s.mtimeMs).toISOString(),
          bytes: s.size,
        });
      } catch {
        continue;
      }
    }
  }
  return all
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, limit);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
