import { NextResponse } from 'next/server';
import { scanBase, getStatus } from '@/lib/index-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  const stats = await scanBase();
  const status = await getStatus();
  return NextResponse.json({ stats, status });
}
