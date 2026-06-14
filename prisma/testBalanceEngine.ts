import { PrismaClient } from '@prisma/client';
import { calculateNetBalances, simplifyDebts, getUserLedger } from '../lib/balanceEngine';

const prisma = new PrismaClient();

async function runBalanceTests() {
  console.log('--- STARTING BALANCE ENGINE INTEGRATION TESTS ---');

  // 1. Setup clean environment and sample database records
  console.log('Cleaning old expenses and splits...');
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});

  const users = await prisma.user.findMany();
  const userMap: Record<string, string> = {};
  for (const u of users) {
    userMap[u.name] = u.id;
  }

  const group = await prisma.group.findFirst();
  if (!group) {
    console.error('❌ FAILED: No group found. Seed database first.');
    process.exit(1);
  }

  console.log('Creating controlled production test expenses...');

  // Expense 1: rent 48000 INR paid by Aisha, split equally between Aisha, Rohan, Priya, Meera
  const rent = await prisma.expense.create({
    data: {
      groupId: group.id,
      paidById: userMap['Aisha'],
      description: 'February Rent',
      amount: 48000,
      currency: 'INR',
      exchangeRate: 1.0,
      date: new Date('2026-02-01T00:00:00Z'),
      splitType: 'equal',
    },
  });

  const rentUsers = ['Aisha', 'Rohan', 'Priya', 'Meera'];
  for (const name of rentUsers) {
    await prisma.expenseSplit.create({
      data: {
        expenseId: rent.id,
        userId: userMap[name],
        owedAmount: 12000.0,
      },
    });
  }

  // Expense 2: groceries 2400 INR paid by Priya, split equally between Aisha, Rohan, Priya, Meera
  const groceries = await prisma.expense.create({
    data: {
      groupId: group.id,
      paidById: userMap['Priya'],
      description: 'Groceries BigBasket',
      amount: 2400,
      currency: 'INR',
      exchangeRate: 1.0,
      date: new Date('2026-02-03T00:00:00Z'),
      splitType: 'equal',
    },
  });

  for (const name of rentUsers) {
    await prisma.expenseSplit.create({
      data: {
        expenseId: groceries.id,
        userId: userMap[name],
        owedAmount: 600.0,
      },
    });
  }

  // Expense 3: Goa booking (USD) 540 USD (44820 INR) paid by Dev, split equally between Aisha, Rohan, Priya, Dev
  const goaVilla = await prisma.expense.create({
    data: {
      groupId: group.id,
      paidById: userMap['Dev'],
      description: 'Goa villa booking',
      amount: 540,
      currency: 'USD',
      exchangeRate: 83.0,
      date: new Date('2026-03-09T00:00:00Z'),
      splitType: 'equal',
    },
  });

  const goaUsers = ['Aisha', 'Rohan', 'Priya', 'Dev'];
  for (const name of goaUsers) {
    await prisma.expenseSplit.create({
      data: {
        expenseId: goaVilla.id,
        userId: userMap[name],
        owedAmount: 11205.0, // 44820 / 4
      },
    });
  }

  // Expense 4: Settlement Rohan pays Aisha back 5000 INR
  const settlement = await prisma.expense.create({
    data: {
      groupId: group.id,
      paidById: userMap['Rohan'],
      description: 'Rohan paid Aisha back',
      amount: 5000,
      currency: 'INR',
      exchangeRate: 1.0,
      date: new Date('2026-02-25T00:00:00Z'),
      splitType: 'equal',
      isSettlement: true,
    },
  });

  await prisma.expenseSplit.create({
    data: {
      expenseId: settlement.id,
      userId: userMap['Aisha'],
      owedAmount: 5000.0,
    },
  });

  // 2. Run calculateNetBalances
  console.log('\nRunning net balance calculations...');
  const balances = await calculateNetBalances(group.id);

  // Assert sum of balances is exactly 0.00
  const sumNet = balances.reduce((sum, b) => sum + b.netBalance, 0);
  console.log(`Sum of all net balances: ${sumNet.toFixed(2)} INR`);
  if (Math.abs(sumNet) > 0.01) {
    console.error(`❌ FAILED: Net balances sum must be exactly 0.00, got ${sumNet}`);
    process.exit(1);
  } else {
    console.log('✅ Balance Integrity Check: PASSED (Sum = 0.00)');
  }

  console.log('\nCalculated Net Balances:');
  for (const b of balances) {
    console.log(`   - ${b.userName}: Paid ${b.totalPaid} | Owed ${b.totalOwed} | Net: ${b.netBalance} INR`);
  }

  // Check specific expected values:
  // Aisha:
  // Paid: Rent (48000) = 48000
  // Owed: Rent (12000) + Groceries (600) + Goa (11205) + Settlement Owed (5000) = 28805
  // Net Balance: 48000 - 28805 = 19195
  const aishaBal = balances.find(b => b.userName === 'Aisha');
  if (aishaBal && aishaBal.netBalance === 19195) {
    console.log('✅ Aisha net balance calculation: PASSED (+19195.00 INR)');
  } else {
    console.error(`❌ Aisha net balance check: FAILED. Expected 19195, got ${aishaBal?.netBalance}`);
    process.exit(1);
  }

  // Rohan:
  // Paid: Settlement (5000) = 5000
  // Owed: Rent (12000) + Groceries (600) + Goa (11205) = 23805
  // Net: 5000 - 23805 = -18805
  const rohanBal = balances.find(b => b.userName === 'Rohan');
  if (rohanBal && rohanBal.netBalance === -18805) {
    console.log('✅ Rohan net balance calculation: PASSED (-18805.00 INR)');
  } else {
    console.error(`❌ Rohan net balance check: FAILED. Expected -18805, got ${rohanBal?.netBalance}`);
    process.exit(1);
  }

  // 3. Test debt simplification
  console.log('\nSimplifying debts...');
  const simplified = simplifyDebts(balances);
  console.log('Simplified Settlement Steps:');
  for (const s of simplified) {
    console.log(`   - ${s.fromUserName} pays ${s.toUserName} -> ${s.amount} INR`);
  }

  // Verify simplified debt payouts reconcile balances
  const initialBalances: Record<string, number> = {};
  for (const b of balances) {
    initialBalances[b.userId] = b.netBalance;
  }

  for (const transfer of simplified) {
    initialBalances[transfer.fromUserId] = Math.round((initialBalances[transfer.fromUserId] + transfer.amount) * 100) / 100;
    initialBalances[transfer.toUserId] = Math.round((initialBalances[transfer.toUserId] - transfer.amount) * 100) / 100;
  }

  const allReconciled = Object.values(initialBalances).every(val => Math.abs(val) < 0.01);
  if (allReconciled) {
    console.log('✅ Debt Simplification Reconcile: PASSED');
  } else {
    console.error('❌ Debt Simplification Reconcile: FAILED', initialBalances);
    process.exit(1);
  }

  // 4. Test User Ledger Audit
  console.log('\nFetching Ledger for Aisha...');
  const aishaLedger = await getUserLedger(userMap['Aisha'], group.id);
  console.log('Aisha Ledger:');
  for (const item of aishaLedger) {
    console.log(`   - ${item.date.toISOString().split('T')[0]} | ${item.description}: Total: ${item.totalAmount} | My Owed: ${item.myOwedShare} | Net Impact: ${item.myNetImpact} INR`);
  }

  // Rent row check for Aisha
  const rentRow = aishaLedger.find(i => i.description === 'February Rent');
  if (rentRow && rentRow.wasPaidByMe === true && rentRow.totalAmount === 48000 && rentRow.myOwedShare === 12000 && rentRow.myNetImpact === 36000) {
    console.log('✅ Aisha Rent Ledger calculations: PASSED');
  } else {
    console.error('❌ Aisha Rent Ledger check: FAILED', rentRow);
    process.exit(1);
  }

  // Settlement row check for Aisha
  const settlementRow = aishaLedger.find(i => i.description === 'Rohan paid Aisha back');
  if (settlementRow && settlementRow.wasPaidByMe === false && settlementRow.totalAmount === 5000 && settlementRow.myOwedShare === 5000 && settlementRow.myNetImpact === -5000) {
    console.log('✅ Aisha Settlement Ledger calculations: PASSED');
  } else {
    console.error('❌ Aisha Settlement Ledger check: FAILED', settlementRow);
    process.exit(1);
  }

  console.log('\n🎉 ALL BALANCE ENGINE INTEGRATION TESTS PASSED!');
  process.exit(0);
}

runBalanceTests()
  .catch((e) => {
    console.error('Fatal balance test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
