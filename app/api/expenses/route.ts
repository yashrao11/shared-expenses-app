import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateSplits, RawSplitInput } from '@/lib/splittingEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      groupId,
      paidById,
      description,
      amount,
      currency,
      date,
      splitType,
      splitWith,
      splitDetails,
      notes,
    } = body;

    if (!groupId || !paidById || !description || !amount || !splitType || !splitWith || splitWith.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Parameters "groupId", "paidById", "description", "amount", "splitType", and "splitWith" are required.' },
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

    // Perform database transaction writes
    const result = await prisma.$transaction(async (tx) => {
      // Check group and payer
      const group = await tx.group.findUnique({ where: { id: groupId } });
      const payer = await tx.user.findUnique({ where: { id: paidById } });
      if (!group || !payer) {
        throw new Error('Group or payer does not exist in the database.');
      }

      // Load all users to construct name-to-id mapping
      const dbUsers = await tx.user.findMany();
      const userMap: Record<string, string> = {};
      for (const u of dbUsers) {
        userMap[u.name.trim().toLowerCase()] = u.id;
      }

      // Prepare split engine input
      const splitInput: RawSplitInput = {
        amount: amountVal,
        currency: currency || 'INR',
        date: parsedDate,
        splitType,
        splitWith,
        splitDetails: splitDetails || '',
      };

      // Calculate splits
      const calculation = await calculateSplits(splitInput, userMap);
      if (!calculation.success) {
        throw new Error(`Splitting Engine Error: ${calculation.errors.join(' | ')}`);
      }

      const exchangeRate = (currency || 'INR').trim().toUpperCase() === 'USD' ? 83.0 : 1.0;

      // Create production Expense entry
      const expense = await tx.expense.create({
        data: {
          groupId,
          paidById,
          description,
          amount: calculation.baseAmountINR,
          rawAmount: amountVal,
          currency: currency || 'INR',
          exchangeRate,
          date: parsedDate,
          splitType,
          isSettlement: false,
          notes: notes || '',
        },
      });

      // Create Splits
      for (const split of calculation.splits) {
        await tx.expenseSplit.create({
          data: {
            expenseId: expense.id,
            userId: split.userId,
            owedAmount: split.owedAmount,
          },
        });
      }

      return { expenseId: expense.id, baseAmountINR: calculation.baseAmountINR };
    });

    return NextResponse.json({
      success: true,
      message: 'Expense created successfully.',
      expenseId: result.expenseId,
      baseAmountINR: result.baseAmountINR,
    });
  } catch (err: any) {
    console.error('Error creating manual expense:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred creating manual expense.' },
      { status: 400 }
    );
  }
}
