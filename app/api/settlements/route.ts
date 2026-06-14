import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { groupId, payerId, payeeId, amount, date } = body;

    if (!groupId || !payerId || !payeeId || !amount) {
      return NextResponse.json(
        { success: false, error: 'Parameters "groupId", "payerId", "payeeId", and "amount" are required.' },
        { status: 400 }
      );
    }

    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number.' },
        { status: 400 }
      );
    }

    const parsedDate = date ? new Date(date) : new Date();

    const payer = await prisma.user.findUnique({ where: { id: payerId } });
    const payee = await prisma.user.findUnique({ where: { id: payeeId } });
    if (!payer || !payee) {
      return NextResponse.json(
        { success: false, error: 'Payer or payee does not exist in the database.' },
        { status: 400 }
      );
    }

    // Record settlement in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          groupId,
          paidById: payerId,
          description: `${payer.name} paid ${payee.name} back (Settlement)`,
          amount: amountVal,
          rawAmount: amountVal,
          currency: 'INR',
          exchangeRate: 1.0,
          date: parsedDate,
          splitType: 'equal',
          isSettlement: true,
        },
      });

      const split = await tx.expenseSplit.create({
        data: {
          expenseId: expense.id,
          userId: payeeId,
          owedAmount: amountVal,
        },
      });

      return { expenseId: expense.id, splitId: split.id };
    });

    return NextResponse.json({
      success: true,
      message: 'Settlement recorded successfully.',
      expenseId: result.expenseId,
    });
  } catch (err: any) {
    console.error('Error creating settlement:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred creating settlement.' },
      { status: 500 }
    );
  }
}
