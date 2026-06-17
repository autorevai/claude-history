import { NextRequest, NextResponse } from 'next/server';
import { search, type SearchMode, type SortBy } from '@/lib/search-index';
import type { SessionStatus } from '@/lib/index-store';

export const dynamic = 'force-dynamic';

const MODES: SearchMode[] = ['keyword', 'semantic', 'hybrid'];
const SORTS: SortBy[] = ['relevance', 'recent', 'impact'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q') ?? '';
  const modeParam = sp.get('mode') ?? 'hybrid';
  const mode: SearchMode = MODES.includes(modeParam as SearchMode) ? (modeParam as SearchMode) : 'hybrid';
  const sortParam = sp.get('sort') ?? 'relevance';
  const sort: SortBy = SORTS.includes(sortParam as SortBy) ? (sortParam as SortBy) : 'relevance';
  const filters = {
    project: sp.get('project') || undefined,
    tag: sp.get('tag') || undefined,
    status: (sp.get('status') as SessionStatus) || undefined,
    includeAgent: sp.get('includeAgent') === '1',
  };
  const result = await search(q, mode, filters, 60, sort);
  return NextResponse.json(result);
}
