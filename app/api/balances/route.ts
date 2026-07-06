import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateNetBalances, calculateDirectDebts } from '@/lib/balanceEngine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let groupId = searchParams.get('groupId');

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

    // Auto-reject any pending staged rows when viewing dashboard
    await prisma.stagedExpense.updateMany({
      where: { status: 'PENDING_APPROVAL' },
      data: {
        status: 'REJECTED',
        resolutionMode: 'REJECTED',
        resolutionSummary: 'Automatically rejected because reviewer navigated to the dashboard without resolving.',
      },
    });

    // Compute balances
    const balances = await calculateNetBalances(groupId);

    // Calculate direct peer-to-peer debts (no routing simplification)
    const simplifiedDebts = await calculateDirectDebts(groupId);

    return NextResponse.json({
      success: true,
      groupId,
      balances,
      simplifiedDebts,
    });
  } catch (err: any) {
    console.error('Error fetching balances:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching balances.' },
      { status: 500 }
    );
  }
}
