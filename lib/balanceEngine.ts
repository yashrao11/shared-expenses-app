import prisma from './db';

export interface MemberNetBalance {
  userId: string;
  userName: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // totalPaid - totalOwed
}

export interface SimplifiedDebt {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number; // Positive float value normalized to INR
}

export interface UserLedgerItem {
  expenseId: string;
  description: string;
  date: Date;
  wasPaidByMe: boolean;
  totalAmount: number;
  myOwedShare: number;
  myNetImpact: number; // Paid minus Owed Share
}

/**
 * Calculates total paid, total owed, and net balance for each member in a group.
 * 
 * @param groupId The unique ID of the group
 * @returns Promise<MemberNetBalance[]>
 */
export async function calculateNetBalances(groupId: string): Promise<MemberNetBalance[]> {
  // Fetch group memberships to get active/inactive participants
  const memberships = await prisma.groupMembership.findMany({
    where: { groupId },
    include: { user: true },
  });

  const memberBalances: Record<string, MemberNetBalance> = {};

  for (const membership of memberships) {
    memberBalances[membership.userId] = {
      userId: membership.userId,
      userName: membership.user.name,
      totalPaid: 0,
      totalOwed: 0,
      netBalance: 0,
    };
  }

  // Fetch all expenses with their splits for the group
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: { splits: true },
  });

  const uniqueExpenses: typeof expenses = [];
  const seenKeys = new Set<string>();

  for (const exp of expenses) {
    const key = `${exp.description}-${exp.amount}-${new Date(exp.date).getTime()}-${exp.paidById}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueExpenses.push(exp);
    }
  }

  for (const expense of uniqueExpenses) {
    const baseAmount = expense.amount;

    // Add to payer's totalPaid (ensure payer is in the tracking map, otherwise initialize)
    if (memberBalances[expense.paidById]) {
      memberBalances[expense.paidById].totalPaid += baseAmount;
    } else {
      // Fallback in case payer is not in memberships list
      const payer = await prisma.user.findUnique({ where: { id: expense.paidById } });
      memberBalances[expense.paidById] = {
        userId: expense.paidById,
        userName: payer ? payer.name : 'Unknown User',
        totalPaid: baseAmount,
        totalOwed: 0,
        netBalance: 0,
      };
    }

    // Add to each split user's totalOwed
    for (const split of expense.splits) {
      if (memberBalances[split.userId]) {
        memberBalances[split.userId].totalOwed += split.owedAmount;
      } else {
        // Fallback in case split user is not in memberships
        const user = await prisma.user.findUnique({ where: { id: split.userId } });
        memberBalances[split.userId] = {
          userId: split.userId,
          userName: user ? user.name : 'Unknown User',
          totalPaid: 0,
          totalOwed: split.owedAmount,
          netBalance: 0,
        };
      }
    }
  }

  // Calculate final rounded balances
  return Object.values(memberBalances).map((member) => {
    const totalPaid = Math.round(member.totalPaid * 100) / 100;
    const totalOwed = Math.round(member.totalOwed * 100) / 100;
    const netBalance = Math.round((totalPaid - totalOwed) * 100) / 100;

    return {
      userId: member.userId,
      userName: member.userName,
      totalPaid,
      totalOwed,
      netBalance,
    };
  });
}

/**
 * Greedily simplifies peer-to-peer debts to minimize the total number of transactions.
 * Uses integer math (cents) to avoid floating point issues.
 * 
 * @param balances Array of member net balances
 * @returns SimplifiedDebt[]
 */
export function simplifyDebts(balances: MemberNetBalance[]): SimplifiedDebt[] {
  // Map balances to cent values to ensure precise calculations
  const creditors = balances
    .filter((b) => b.netBalance > 0.009)
    .map((b) => ({
      userId: b.userId,
      userName: b.userName,
      balance: Math.round(b.netBalance * 100),
    }));

  const debtors = balances
    .filter((b) => b.netBalance < -0.009)
    .map((b) => ({
      userId: b.userId,
      userName: b.userName,
      balance: Math.round(b.netBalance * 100), // Negative cent balance
    }));

  const debts: SimplifiedDebt[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    // Sort creditors descending, debtors ascending (most negative first)
    creditors.sort((a, b) => b.balance - a.balance);
    debtors.sort((a, b) => a.balance - b.balance);

    const creditor = creditors[0];
    const debtor = debtors[0];

    const amountCents = Math.min(creditor.balance, Math.abs(debtor.balance));
    if (amountCents <= 0) break;

    debts.push({
      fromUserId: debtor.userId,
      fromUserName: debtor.userName,
      toUserId: creditor.userId,
      toUserName: creditor.userName,
      amount: Math.round(amountCents) / 100,
    });

    creditor.balance -= amountCents;
    debtor.balance += amountCents;

    if (creditor.balance === 0) {
      creditors.shift();
    }
    if (debtor.balance === 0) {
      debtors.shift();
    }
  }

  return debts;
}

/**
 * Generates a detailed audit ledger of expenses for a specific user in a group.
 * 
 * @param userId The unique user ID
 * @param groupId The unique group ID
 * @returns Promise<UserLedgerItem[]>
 */
export async function getUserLedger(userId: string, groupId: string): Promise<any[]> {
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      OR: [
        { paidById: userId },
        { splits: { some: { userId } } },
      ],
    },
    include: {
      payer: true,
      splits: {
        include: {
          user: true,
        },
      },
    },
    orderBy: {
      date: 'desc',
    },
  });

  // Deduplicate identical expense records committed in the DB
  const uniqueExpenses: typeof expenses = [];
  const seenKeys = new Set<string>();

  for (const exp of expenses) {
    const key = `${exp.description}-${exp.amount}-${new Date(exp.date).getTime()}-${exp.paidById}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueExpenses.push(exp);
    }
  }

  return uniqueExpenses.map((expense) => {
    const wasPaidByMe = expense.paidById === userId;
    const totalAmount = Math.round(expense.amount * 100) / 100;

    // Find my split share
    const mySplit = expense.splits.find((s) => s.userId === userId);
    const myOwedShare = mySplit ? Math.round(mySplit.owedAmount * 100) / 100 : 0;

    const paidByMe = wasPaidByMe ? totalAmount : 0;
    const myNetImpact = Math.round((paidByMe - myOwedShare) * 100) / 100;

    return {
      expenseId: expense.id,
      description: expense.description,
      date: expense.date,
      wasPaidByMe,
      totalAmount,
      rawAmount: expense.rawAmount,
      currency: expense.currency,
      exchangeRate: expense.exchangeRate,
      splitType: expense.splitType,
      isSettlement: expense.isSettlement,
      notes: expense.notes,
      paidByUserName: expense.payer.name,
      myOwedShare,
      myNetImpact,
      allSplits: expense.splits.map((s) => ({
        userName: s.user.name,
        owedAmount: Math.round(s.owedAmount * 100) / 100,
      })),
    };
  });
}

export async function getGroupLedger(groupId: string): Promise<any[]> {
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      payer: true,
      splits: {
        include: {
          user: true,
        },
      },
    },
    orderBy: {
      date: 'desc',
    },
  });

  const uniqueExpenses: typeof expenses = [];
  const seenKeys = new Set<string>();

  for (const exp of expenses) {
    const key = `${exp.description}-${exp.amount}-${new Date(exp.date).getTime()}-${exp.paidById}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueExpenses.push(exp);
    }
  }

  return uniqueExpenses.map((expense) => {
    const totalAmount = Math.round(expense.amount * 100) / 100;
    return {
      expenseId: expense.id,
      description: expense.description,
      date: expense.date,
      paidById: expense.paidById,
      paidByUserName: expense.payer.name,
      totalAmount,
      isSettlement: expense.isSettlement,
      allSplits: expense.splits.map((s) => ({
        userId: s.userId,
        userName: s.user.name,
        owedAmount: Math.round(s.owedAmount * 100) / 100,
      })),
    };
  });
}

export async function calculateDirectDebts(groupId: string): Promise<SimplifiedDebt[]> {
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      payer: true,
      splits: {
        include: {
          user: true,
        },
      },
    },
  });

  const users = await prisma.user.findMany({
    where: {
      memberships: {
        some: { groupId }
      }
    }
  });

  const matrix: Record<string, Record<string, number>> = {};
  for (const u of users) {
    matrix[u.id] = {};
    for (const other of users) {
      matrix[u.id][other.id] = 0;
    }
  }

  const uniqueExpenses: typeof expenses = [];
  const seenKeys = new Set<string>();

  for (const exp of expenses) {
    const key = `${exp.description}-${exp.amount}-${new Date(exp.date).getTime()}-${exp.paidById}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueExpenses.push(exp);
    }
  }

  for (const exp of uniqueExpenses) {
    const payerId = exp.paidById;
    if (!matrix[payerId]) continue;

    for (const split of exp.splits) {
      const debtorId = split.userId;
      if (debtorId === payerId) continue;
      if (!matrix[debtorId]) continue;

      matrix[debtorId][payerId] += split.owedAmount;
    }
  }

  const results: SimplifiedDebt[] = [];
  const visited = new Set<string>();

  for (const u1 of users) {
    for (const u2 of users) {
      if (u1.id === u2.id) continue;
      const pairKey = [u1.id, u2.id].sort().join('-');
      if (visited.has(pairKey)) continue;
      visited.add(pairKey);

      const u1OwesU2 = matrix[u1.id][u2.id];
      const u2OwesU1 = matrix[u2.id][u1.id];

      if (u1OwesU2 > u2OwesU1) {
        const net = u1OwesU2 - u2OwesU1;
        if (net > 0.009) {
          results.push({
            fromUserId: u1.id,
            fromUserName: u1.name,
            toUserId: u2.id,
            toUserName: u2.name,
            amount: Math.round(net * 100) / 100,
          });
        }
      } else if (u2OwesU1 > u1OwesU2) {
        const net = u2OwesU1 - u1OwesU2;
        if (net > 0.009) {
          results.push({
            fromUserId: u2.id,
            fromUserName: u2.name,
            toUserId: u1.id,
            toUserName: u1.name,
            amount: Math.round(net * 100) / 100,
          });
        }
      }
    }
  }

  return results;
}


