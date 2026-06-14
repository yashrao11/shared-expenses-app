import { PrismaClient } from '@prisma/client';
import { calculateSplits, RawSplitInput } from '../lib/splittingEngine';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- STARTING SPLITTING ENGINE TESTS ---');

  // 1. Fetch users from DB to populate userMap
  console.log('Fetching users from SQLite database...');
  const users = await prisma.user.findMany();
  const userMap: Record<string, string> = {};
  for (const user of users) {
    userMap[user.name] = user.id;
  }
  console.log(`Fetched ${users.length} users: ${Object.keys(userMap).join(', ')}\n`);

  // 2. Fetch membership timelines from DB for temporal testing
  console.log('Fetching membership timelines from SQLite database...');
  const memberships = await prisma.groupMembership.findMany();
  const membershipTimelines: Record<string, { joinedAt: Date; leftAt: Date | null }[]> = {};
  for (const m of memberships) {
    if (!membershipTimelines[m.userId]) {
      membershipTimelines[m.userId] = [];
    }
    membershipTimelines[m.userId].push({
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
    });
  }

  let failedTests = 0;

  // Test cases definition
  interface TestCase {
    name: string;
    input: RawSplitInput;
    expectedSuccess: boolean;
    validateOutput?: (result: any) => string | null;
  }

  const testCases: TestCase[] = [
    {
      name: 'Case 1: Equal split with even pennies distribution (10.00 INR split 3 ways)',
      input: {
        amount: 10.00,
        currency: 'INR',
        date: new Date('2026-02-15T00:00:00Z'), // Aisha, Rohan, Priya active
        splitType: 'equal',
        splitWith: ['Aisha', 'Rohan', 'Priya'],
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        if (res.baseAmountINR !== 10.00) return `Expected baseAmountINR 10.00, got ${res.baseAmountINR}`;
        const sumSplits = res.splits.reduce((sum: number, s: any) => sum + s.owedAmount, 0);
        if (Math.abs(sumSplits - 10.00) > 0.001) return `Sum of splits is ${sumSplits}, must be exactly 10.00`;
        // Pennies distributed: Aisha gets 3.34, Rohan gets 3.33, Priya gets 3.33
        const sharesMap = res.splits.reduce((acc: Record<string, number>, s: any) => {
          acc[s.userName] = s.owedAmount;
          return acc;
        }, {});
        if (sharesMap['Aisha'] !== 3.34 || sharesMap['Rohan'] !== 3.33 || sharesMap['Priya'] !== 3.33) {
          return `Expected Aisha: 3.34, Rohan: 3.33, Priya: 3.33, got ${JSON.stringify(sharesMap)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 2: Temporal Check Failure (Meera inactive on April 15, 2026)',
      input: {
        amount: 1000,
        currency: 'INR',
        date: new Date('2026-04-15T00:00:00Z'), // Meera left Mar 31, 2026
        splitType: 'equal',
        splitWith: ['Aisha', 'Rohan', 'Meera'], // Meera should be reported inactive
      },
      expectedSuccess: false, // Inactive user is a blocking validation error
      validateOutput: (res) => {
        if (!res.errors.some((e: string) => e.includes('Meera was inactive on the expense date 2026-04-15'))) {
          return `Expected Meera temporal error, got errors: ${JSON.stringify(res.errors)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 3: Temporal Check Success (Meera active on February 15, 2026)',
      input: {
        amount: 1000,
        currency: 'INR',
        date: new Date('2026-02-15T00:00:00Z'), // Meera active
        splitType: 'equal',
        splitWith: ['Aisha', 'Rohan', 'Meera'],
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        if (res.errors.length > 0) return `Expected no errors, got: ${JSON.stringify(res.errors)}`;
        return null;
      },
    },
    {
      name: 'Case 4: Unequal split with raw currency match (Rohan 700; Priya 400; Meera 400)',
      input: {
        amount: 1500,
        currency: 'INR',
        date: new Date('2026-02-15T00:00:00Z'),
        splitType: 'unequal',
        splitWith: ['Rohan', 'Priya', 'Meera'],
        splitDetails: 'Rohan 700; Priya 400; Meera 400',
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        const rohanSplit = res.splits.find((s: any) => s.userName === 'Rohan')?.owedAmount;
        const priyaSplit = res.splits.find((s: any) => s.userName === 'Priya')?.owedAmount;
        const meeraSplit = res.splits.find((s: any) => s.userName === 'Meera')?.owedAmount;
        if (rohanSplit !== 700 || priyaSplit !== 400 || meeraSplit !== 400) {
          return `Expected Rohan=700, Priya=400, Meera=400, got ${JSON.stringify(res.splits)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 5: Unequal split sum mismatch (should fail)',
      input: {
        amount: 1500,
        currency: 'INR',
        date: new Date('2026-02-15T00:00:00Z'),
        splitType: 'unequal',
        splitWith: ['Rohan', 'Priya', 'Meera'],
        splitDetails: 'Rohan 700; Priya 400; Meera 300',
      },
      expectedSuccess: false,
      validateOutput: (res) => {
        if (!res.errors.some((e: string) => e.includes('does not match the transaction amount'))) {
          return `Expected mismatch error, got: ${JSON.stringify(res.errors)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 6: Name Matching Cleanliness (Case-insensitivity and whitespace trimming)',
      input: {
        amount: 1500,
        currency: 'INR',
        date: new Date('2026-02-15T00:00:00Z'),
        splitType: 'unequal',
        splitWith: ['Rohan', 'Priya', 'Meera'],
        // Typo/spaces case: "rohan  " (lowercase & trailing space)
        splitDetails: 'rohan  700; PRIYA 400; meera 400',
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        const rohanSplit = res.splits.find((s: any) => s.userName === 'Rohan')?.owedAmount;
        if (rohanSplit !== 700) {
          return `Expected Rohan=700, got ${JSON.stringify(res.splits)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 7: Percentage split validation failure (Pizza Friday - 1440 INR, 110% total)',
      input: {
        amount: 1440,
        currency: 'INR',
        date: new Date('2026-02-28T00:00:00Z'),
        splitType: 'percentage',
        splitWith: ['Aisha', 'Rohan', 'Priya', 'Meera'],
        splitDetails: 'Aisha 30%; Rohan 30%; Priya 30%; Meera 20%', // 110%
      },
      expectedSuccess: false,
      validateOutput: (res) => {
        if (!res.errors.some((e: string) => e.includes('must equal 100%'))) {
          return `Expected percentage sum error, got: ${JSON.stringify(res.errors)}`;
        }
        return null;
      },
    },
    {
      name: 'Case 8: Correct Percentage split (Aisha 30%; Rohan 30%; Priya 20%; Meera 20%)',
      input: {
        amount: 1000,
        currency: 'INR',
        date: new Date('2026-02-28T00:00:00Z'),
        splitType: 'percentage',
        splitWith: ['Aisha', 'Rohan', 'Priya', 'Meera'],
        splitDetails: 'Aisha 30%; Rohan 30%; Priya 20%; Meera 20%',
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        const aisha = res.splits.find((s: any) => s.userName === 'Aisha')?.owedAmount;
        if (aisha !== 300) return `Expected Aisha 300, got ${aisha}`;
        return null;
      },
    },
    {
      name: 'Case 9: Share split (Scooter rentals - 3600 INR, Aisha 1; Rohan 2; Priya 1; Dev 2)',
      input: {
        amount: 3600,
        currency: 'INR',
        date: new Date('2026-03-10T00:00:00Z'),
        splitType: 'share',
        splitWith: ['Aisha', 'Rohan', 'Priya', 'Dev'],
        splitDetails: 'Aisha 1; Rohan 2; Priya 1; Dev 2',
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        const dev = res.splits.find((s: any) => s.userName === 'Dev')?.owedAmount;
        if (dev !== 1200) return `Expected Dev 1200, got ${dev}`;
        return null;
      },
    },
    {
      name: 'Case 10: USD transaction conversion (Goa villa booking - 540 USD, split equally among Aisha, Rohan, Priya, Dev)',
      input: {
        amount: 540,
        currency: 'USD',
        date: new Date('2026-03-09T00:00:00Z'),
        splitType: 'equal',
        splitWith: ['Aisha', 'Rohan', 'Priya', 'Dev'],
      },
      expectedSuccess: true,
      validateOutput: (res) => {
        // 540 * 83.0 = 44820.00
        if (res.baseAmountINR !== 44820.00) return `Expected baseAmountINR 44820.00, got ${res.baseAmountINR}`;
        const individualShare = 44820.00 / 4; // 11205.00
        const devShare = res.splits.find((s: any) => s.userName === 'Dev')?.owedAmount;
        if (devShare !== 11205.00) return `Expected individual share 11205.00, got ${devShare}`;
        return null;
      },
    },
  ];

  for (const tc of testCases) {
    console.log(`Running: ${tc.name}...`);
    // Run the async function
    const result = await calculateSplits(tc.input, userMap, membershipTimelines);

    if (result.success !== tc.expectedSuccess) {
      console.log(`❌ FAILED: Success value mismatch. Got success=${result.success}, expected=${tc.expectedSuccess}`);
      console.log('Errors returned:', result.errors);
      failedTests++;
      continue;
    }

    if (tc.validateOutput) {
      const errorMsg = tc.validateOutput(result);
      if (errorMsg) {
        console.log(`❌ FAILED validation: ${errorMsg}`);
        console.log('Resulting Object:', JSON.stringify(result, null, 2));
        failedTests++;
        continue;
      }
    }

    console.log(`✅ PASSED`);
    if (result.success) {
      console.log(`   Base INR: ${result.baseAmountINR}`);
      console.log(`   Splits: ${result.splits.map(s => `${s.userName}: ${s.owedAmount} INR`).join(', ')}`);
      if (result.errors.length > 0) {
        console.log(`   Warnings: ${result.errors.join(' | ')}`);
      }
    } else {
      console.log(`   Expected Errors: ${result.errors.join(' | ')}`);
    }
    console.log();
  }

  console.log('---------------------------------------');
  if (failedTests > 0) {
    console.log(`❌ TEST RUN FAILED with ${failedTests} failure(s).`);
    process.exit(1);
  } else {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

runTests()
  .catch((e) => {
    console.error('Fatal testing error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
