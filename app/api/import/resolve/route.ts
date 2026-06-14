import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateSplits, RawSplitInput } from '@/lib/splittingEngine';

// Date parser helper
const parseCSVDate = (dateStr: string): Date => {
  const cleanStr = dateStr.trim();
  // Check if it's YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
    const parts = cleanStr.split('-');
    const y = parseInt(parts[0]);
    const m = parseInt(parts[1]) - 1;
    const d = parseInt(parts[2]);
    return new Date(Date.UTC(y, m, d));
  }
  const parts = cleanStr.split('-');
  if (parts.length === 3) {
    // Check if parts[0] is year (YYYY-MM-DD) or day (DD-MM-YYYY)
    if (parts[0].length === 4) {
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]) - 1;
      const d = parseInt(parts[2]);
      return new Date(Date.UTC(y, m, d));
    } else {
      const d = parseInt(parts[0]);
      const m = parseInt(parts[1]) - 1;
      const y = parseInt(parts[2]);
      return new Date(Date.UTC(y, m, d));
    }
  }
  if (parts.length === 2) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const monthPart = parts[0].toLowerCase().substring(0, 3);
    const dayPart = parseInt(parts[1]);
    if (monthPart in months && !isNaN(dayPart)) {
      return new Date(Date.UTC(2026, months[monthPart], dayPart));
    }
  }
  const d = new Date(cleanStr);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date format: "${dateStr}"`);
  }
  return d;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stagedExpenseId, action, overrides } = body;

    if (!stagedExpenseId || !action) {
      return NextResponse.json(
        { success: false, error: 'Body parameters "stagedExpenseId" and "action" are required.' },
        { status: 400 }
      );
    }

    // 1. Fetch the target StagedExpense record
    const staged = await prisma.stagedExpense.findUnique({
      where: { id: stagedExpenseId },
    });

    if (!staged) {
      return NextResponse.json(
        { success: false, error: `StagedExpense with ID "${stagedExpenseId}" was not found.` },
        { status: 404 }
      );
    }

    if (staged.status === 'APPROVED' || staged.status === 'RESOLVED' || staged.status === 'REJECTED') {
      return NextResponse.json(
        { success: false, error: `StagedExpense has already been processed with status "${staged.status}".` },
        { status: 400 }
      );
    }

    // 2. Reject Action
    if (action === 'REJECT') {
      await prisma.stagedExpense.update({
        where: { id: stagedExpenseId },
        data: { status: 'REJECTED' },
      });
      return NextResponse.json({ success: true, message: 'Expense staged record successfully rejected.' });
    }

    // 3. Approve or Resolve Action
    if (action !== 'APPROVE' && action !== 'RESOLVE_EDIT') {
      return NextResponse.json(
        { success: false, error: `Invalid action "${action}". Supported actions are "APPROVE", "REJECT", and "RESOLVE_EDIT".` },
        { status: 400 }
      );
    }

    // Parse rawData JSON
    let rawRow: any = {};
    try {
      rawRow = JSON.parse(staged.rawData);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: 'Failed to parse raw staging data.' },
        { status: 500 }
      );
    }

    // Apply correction overrides
    const paidBy = overrides?.paidBy || rawRow.paid_by || '';
    const amountStr = overrides?.amount !== undefined ? String(overrides.amount) : String(rawRow.amount || '0');
    const currency = overrides?.currency || rawRow.currency || 'INR';
    const dateStr = overrides?.date || rawRow.date || '';
    const splitType = overrides?.splitType !== undefined ? overrides.splitType : rawRow.split_type;
    
    // splitWith can be passed as array of strings, or fallback to parsing the raw semi-colon separated string
    let splitWith: string[] = [];
    if (overrides?.splitWith) {
      splitWith = Array.isArray(overrides.splitWith)
        ? overrides.splitWith
        : String(overrides.splitWith).split(';').map(s => s.trim()).filter(Boolean);
    } else {
      splitWith = (rawRow.split_with || '').split(';').map((s: string) => s.trim()).filter(Boolean);
    }

    const splitDetails = overrides?.splitDetails !== undefined ? overrides.splitDetails : rawRow.split_details;
    const description = overrides?.description || rawRow.description || 'Staged Ingested Expense';
    const notes = overrides?.notes || rawRow.notes || '';

    // Numeric parsing and normalization
    const cleanAmountStr = amountStr.replace(/,/g, '').trim();
    const amountVal = parseFloat(cleanAmountStr);
    if (isNaN(amountVal)) {
      return NextResponse.json(
        { success: false, error: `Invalid amount value: "${amountStr}".` },
        { status: 400 }
      );
    }

    let parsedDate = new Date();
    try {
      parsedDate = parseCSVDate(dateStr);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: `Invalid date format: "${dateStr}".` },
        { status: 400 }
      );
    }

    // Start a transactional write
    const result = await prisma.$transaction(async (tx) => {
      // Load all users to construct name-to-id mapping
      const dbUsers = await tx.user.findMany();
      const userMap: Record<string, string> = {};
      for (const u of dbUsers) {
        userMap[u.name.trim().toLowerCase()] = u.id;
      }

      const resolveUser = (name: string): { id: string; name: string } | null => {
        const norm = name.trim().toLowerCase();
        for (const u of dbUsers) {
          if (u.name.trim().toLowerCase() === norm) {
            return { id: u.id, name: u.name };
          }
        }
        return null;
      };

      // Match the paidBy string to a verified database user record
      const resolvedPayer = resolveUser(paidBy);
      if (!resolvedPayer) {
        throw new Error(`Payer "${paidBy}" could not be matched to a valid user in the database.`);
      }

      // Query the main Group in database
      const mainGroup = await tx.group.findFirst();
      if (!mainGroup) {
        throw new Error('No default group exists in the database. Ensure database has been seeded.');
      }

      // Check if this row is a settlement
      const isSettlement = !splitType || 
        description.toLowerCase().includes('settlement') || 
        description.toLowerCase().includes('paid back') || 
        notes.toLowerCase().includes('settlement') || 
        notes.toLowerCase().includes('paid back');

      // Setup inputs for splitting engine calculations
      const splitInput: RawSplitInput = {
        amount: amountVal,
        currency,
        date: parsedDate,
        splitType: isSettlement ? 'equal' : splitType, // Settlements just mock equal splits or are simple 0 balance splits
        splitWith: isSettlement ? [resolvedPayer.name] : splitWith,
        splitDetails: isSettlement ? '' : splitDetails,
      };

      // Pass normalized values to splitting engine
      const calculation = await calculateSplits(splitInput, userMap);

      if (!calculation.success) {
        throw new Error(`Splitting engine validation failed: ${calculation.errors.join(' | ')}`);
      }

      // Create solid production Expense entry
      const exchangeRate = currency.trim().toUpperCase() === 'USD' ? 83.0 : 1.0;
      const expense = await tx.expense.create({
        data: {
          groupId: mainGroup.id,
          paidById: resolvedPayer.id,
          description,
          amount: calculation.baseAmountINR,
          rawAmount: amountVal,
          currency,
          exchangeRate,
          date: parsedDate,
          splitType: isSettlement ? 'equal' : splitType,
          isSettlement,
          notes,
        },
      });

      // Create correspondending ExpenseSplit records
      for (const split of calculation.splits) {
        await tx.expenseSplit.create({
          data: {
            expenseId: expense.id,
            userId: split.userId,
            owedAmount: split.owedAmount, // standard INR
          },
        });
      }

      // Update StagedExpense status
      const finalStatus = action === 'APPROVE' ? 'APPROVED' : 'RESOLVED';
      await tx.stagedExpense.update({
        where: { id: stagedExpenseId },
        data: {
          status: finalStatus,
        },
      });

      return {
        expenseId: expense.id,
        baseAmountINR: calculation.baseAmountINR,
        splits: calculation.splits,
      };
    });

    return NextResponse.json({
      success: true,
      message: `Expense staging record successfully ${action === 'APPROVE' ? 'approved' : 'resolved'}.`,
      expenseId: result.expenseId,
      baseAmountINR: result.baseAmountINR,
      splits: result.splits,
    });
  } catch (err: any) {
    console.error('Error resolving staged expense:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred during resolution.' },
      { status: 400 }
    );
  }
}
