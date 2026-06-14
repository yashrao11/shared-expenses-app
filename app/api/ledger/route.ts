import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getUserLedger } from '@/lib/balanceEngine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    let groupId = searchParams.get('groupId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Query parameter "userId" is required.' },
        { status: 400 }
      );
    }

    // Validate user exists
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      return NextResponse.json(
        { success: false, error: `User with ID "${userId}" was not found.` },
        { status: 404 }
      );
    }

    if (!groupId) {
      const firstGroup = await prisma.group.findFirst();
      if (!firstGroup) {
        return NextResponse.json(
          { success: false, error: 'No groups exist in the database. Run DB seed first.' },
          { status: 404 }
        );
      }
      groupId = firstGroup.id;
    } else {
      // Validate group exists
      const groupExists = await prisma.group.findUnique({
        where: { id: groupId },
      });
      if (!groupExists) {
        return NextResponse.json(
          { success: false, error: `Group with ID "${groupId}" was not found.` },
          { status: 404 }
        );
      }
    }

    // Fetch user ledger
    const ledger = await getUserLedger(userId, groupId);

    return NextResponse.json({
      success: true,
      userId,
      groupId,
      ledger,
    });
  } catch (err: any) {
    console.error('Error fetching ledger:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching ledger.' },
      { status: 500 }
    );
  }
}
