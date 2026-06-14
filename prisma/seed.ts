import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing database tables...');
  
  // Clean tables in reverse dependency order
  await prisma.stagedExpense.deleteMany({});
  await prisma.importSession.deleteMany({});
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.groupMembership.deleteMany({});
  await prisma.group.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Seeding users...');
  const usersData = [
    { name: 'Aisha' },
    { name: 'Rohan' },
    { name: 'Priya' },
    { name: 'Meera' },
    { name: 'Sam' },
    { name: 'Dev' },
    { name: 'Kabir' },
  ];

  const createdUsers: Record<string, any> = {};
  for (const userData of usersData) {
    const user = await prisma.user.create({
      data: userData,
    });
    createdUsers[user.name] = user;
    console.log(`Created user: ${user.name} (ID: ${user.id})`);
  }

  console.log('Seeding default group...');
  const group = await prisma.group.create({
    data: {
      name: 'Flatmates Shared Space',
    },
  });
  console.log(`Created group: ${group.name} (ID: ${group.id})`);

  console.log('Seeding group memberships with timelines...');
  const memberships = [
    {
      userId: createdUsers['Aisha'].id,
      groupId: group.id,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'), // Jan 1 avoids timezone offsets on Feb 1 expenses
      leftAt: null,
    },
    {
      userId: createdUsers['Rohan'].id,
      groupId: group.id,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'), // Jan 1 avoids timezone offsets on Feb 1 expenses
      leftAt: null,
    },
    {
      userId: createdUsers['Priya'].id,
      groupId: group.id,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'), // Jan 1 avoids timezone offsets on Feb 1 expenses
      leftAt: null,
    },
    {
      userId: createdUsers['Meera'].id,
      groupId: group.id,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'), // Jan 1 avoids timezone offsets on Feb 1 expenses
      leftAt: new Date('2026-03-31T23:59:59Z'), // left Mar 31, 2026
    },
    {
      userId: createdUsers['Sam'].id,
      groupId: group.id,
      joinedAt: new Date('2026-04-15T00:00:00Z'), // joined Apr 15, 2026
      leftAt: null,
    },
    {
      userId: createdUsers['Dev'].id,
      groupId: group.id,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'), // Jan 1 avoids timezone offsets on Feb 1 expenses
      leftAt: null, // Temporary for trip, but active
    },
    {
      userId: createdUsers['Kabir'].id,
      groupId: group.id,
      joinedAt: new Date('2026-03-10T00:00:00Z'), // Dev's friend, joined Mar 10, 2026
      leftAt: null,
    },
  ];

  for (const membership of memberships) {
    const mem = await prisma.groupMembership.create({
      data: membership,
      include: { user: true },
    });
    const leftStr = mem.leftAt ? `Left: ${mem.leftAt.toISOString().split('T')[0]}` : 'Active';
    console.log(
      `Added membership for User: ${mem.user.name} | Joined: ${mem.joinedAt.toISOString().split('T')[0]} | Status: ${leftStr}`
    );
  }

  console.log('Seeding process completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
