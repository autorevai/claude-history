import { NextRequest, NextResponse } from 'next/server';
import { enrichBatch } from '@/lib/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '12') || 12;
  const result = await enrichBatch(Math.min(limit, 20));
  return NextResponse.json(result);
}
