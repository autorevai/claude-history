import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/index-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getStatus());
}
