import { NextRequest, NextResponse } from 'next/server';
import { embedBatch } from '@/lib/embed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '64') || 64;
  const result = await embedBatch(Math.min(limit, 128));
  return NextResponse.json(result);
}
