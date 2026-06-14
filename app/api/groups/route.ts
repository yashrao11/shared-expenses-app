import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  try {
    const groups = await prisma.group.findMany();
    return NextResponse.json({
      success: true,
      groups,
    });
  } catch (err: any) {
    console.error('Error fetching groups:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching groups.' },
      { status: 500 }
    );
  }
}
