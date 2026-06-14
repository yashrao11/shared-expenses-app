import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  try {
    const users = await prisma.user.findMany();
    return NextResponse.json({
      success: true,
      users,
    });
  } catch (err: any) {
    console.error('Error fetching users:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching users.' },
      { status: 500 }
    );
  }
}
