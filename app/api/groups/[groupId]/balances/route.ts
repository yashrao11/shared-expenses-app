import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateNetBalances, calculateDirectDebts } from '@/lib/balanceEngine';

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

    // Auto-reject any pending staged rows when viewing dashboard
    await prisma.stagedExpense.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: {
        status: 'REJECTED',
        resolutionMode: 'REJECTED',
        resolutionSummary: 'Automatically rejected because reviewer navigated to the dashboard without resolving.',
      },
    });

    // Calculate balances
    const balances = await calculateNetBalances(groupId);

    // Calculate direct peer-to-peer debts (no routing simplification)
    const simplifiedDebts = await calculateDirectDebts(groupId);

    // Fetch memberships for temporal active/inactive timeline view
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId },
      include: { user: true },
    });

    return NextResponse.json({
      success: true,
      groupId,
      balances,
      simplifiedDebts,
      memberships,
    });
  } catch (err: any) {
    console.error('Error fetching group balances:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching group balances.' },
      { status: 500 }
    );
  }
}
