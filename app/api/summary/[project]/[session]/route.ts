import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECTS_DIR } from '@/lib/sessions';
import { getSummary } from '@/lib/summarize';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ project: string; session: string }> }
) {
  const { project, session } = await params;
  const decoded = decodeURIComponent(project);
  const jsonlPath = join(PROJECTS_DIR, decoded, `${session}.jsonl`);

  let mtime = 0;
  try {
    mtime = (await stat(jsonlPath)).mtimeMs;
  } catch {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  const result = await getSummary(decoded, session, mtime);
  if ('error' in result) {
    return NextResponse.json(result, { status: result.error === 'no-api-key' ? 503 : 500 });
  }
  return NextResponse.json(result);
}
