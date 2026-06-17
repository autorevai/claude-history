import { NextRequest, NextResponse } from 'next/server';
import { computeFacets } from '@/lib/search-index';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const includeAgent = req.nextUrl.searchParams.get('includeAgent') === '1';
  return NextResponse.json(await computeFacets(includeAgent));
}
