import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateNetBalances, simplifyDebts } from '@/lib/balanceEngine';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await context.params;

    if (!groupId) {
      return NextResponse.json(
        { success: false, error: 'Group ID is required.' },
        { status: 400 }
      );
    }

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

    // Calculate balances
    const balances = await calculateNetBalances(groupId);

    // Simplify debts
    const simplifiedDebts = simplifyDebts(balances);

    return NextResponse.json({
      success: true,
      groupId,
      balances,
      simplifiedDebts,
    });
  } catch (err: any) {
    console.error('Error fetching group balances:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching group balances.' },
      { status: 500 }
    );
  }
}
