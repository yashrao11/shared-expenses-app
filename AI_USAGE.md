# AI Collaboration & Engineering Override Log

This document outlines our collaborative workflow with AI coding assistants (specifically **Gemini 3.5 Flash** and agentic extensions) used during the development of this shared expenses application. While AI was utilized to draft initial boilerplate templates and structural formats, the engineering of record reviewed, verified, and manually rewrote multiple sections to address critical logic failures.

---

## 1. Key High-Impact Prompts

### Prompt A (Stage 1 Database Definition):
```text
Design a strict relational Prisma database schema using SQLite. 
Include tables for Users, Groups, GroupMembership, Expenses, ExpenseSplits, and a Staging Area 
called StagedExpense to catch duplicate and anomalous transactions. 
GroupMembership must track join and leave times to validate temporal boundaries.
```

### Prompt B (Stage 2 Mathematical Engine):
```text
Write a robust splitting parser in TypeScript. 
The function must parse four types of splits: equal, unequal, percentage, and share. 
It must convert USD amounts to INR at a rate of 83.0, handle remaining pennies rounding, 
and return clean errors if splits or percentages do not sum correctly.
```

---

## 2. In-Depth Case Studies of AI Deficiencies & Engineering Overrides

The following three cases detail occurrences where the AI generated incorrect, unstable, or logically incomplete code, and explain how those issues were identified and corrected.

### Case 1: Floating-Point Penny Rounding Mismatch (Equal Split Leak)

#### The AI's Mistake:
For equal splits, the AI divided the normalized INR total by the count of split members using standard float division:
```typescript
const share = baseAmountINR / splitWith.length;
return splitWith.map(user => ({ userId: user.id, owedAmount: share }));
```

#### How It Was Caught:
When testing a cylinder refill expense of ₹899.99 split across 4 people, the math evaluated to ₹224.9975 per person. Storing this directly caused discrepancies when summing the splits (which totaled ₹899.99, but database column roundings made the splits sum to either ₹900.00 or ₹899.96).

#### The Manual Fix:
The code was updated to use integer cents for division, with the remainder penny distributed to the first participant:
```typescript
const totalCents = Math.round(baseAmountINR * 100);
const shareCents = Math.floor(totalCents / splitWith.length);
const remainderCents = totalCents % splitWith.length;

const splits = splitWith.map((user, index) => {
  const extra = index === 0 ? remainderCents : 0;
  return {
    userId: user.id,
    owedAmount: (shareCents + extra) / 100
  };
});
```

### Case 2: Broken Null Check in Temporal Membership Queries

#### The AI's Mistake:
To check if a user was an active member on the date of an expense, the AI generated a Prisma query assuming leftAt was always a valid date:
```typescript
const membership = await prisma.groupMembership.findFirst({
  where: {
    userId,
    groupId,
    joinedAt: { lte: expenseDate },
    leftAt: { gte: expenseDate }
  }
});
```

#### How It Was Caught:
During the import of April expenses, active roommates (Aisha, Rohan, Priya) were flagged as "Temporal Membership Boundary Violation". Because they had not moved out, their leftAt fields were NULL in the SQLite database. The AI's query failed to retrieve these active records because it assumed leftAt was a date.

#### The Manual Fix:
The query logic was updated to check both conditions explicitly, handling the null state:
```typescript
const membership = await prisma.groupMembership.findFirst({
  where: {
    userId,
    groupId,
    joinedAt: { lte: expenseDate },
    OR: [
      { leftAt: null },
      { leftAt: { gte: expenseDate } }
    ]
  }
});
```

### Case 3: Case-Sensitivity and Untrimmed String Matches

#### The AI's Mistake:
When parsing custom strings for unequal or percentage splits (such as "Rohan 700; Priya 400"), the AI split strings using space delimiters and mapped them directly to database profiles:
```typescript
const name = pair.split(' ')[0]; // E.g. "Rohan"
```

#### How It Was Caught:
The CSV contained trailing spaces in some names (such as "rohan " in the Cab Expense and "Priya S" in DMart). The AI's code attempted to match these directly against the seeded database, which resulted in database reference errors and aborted the import process.

#### The Manual Fix:
A string normalization and alias matching layer was introduced:
```typescript
const namePart = pair.split(' ')[0].trim().toLowerCase();
// Name alias mapping
let matchedUser = users.find(u => u.name.toLowerCase() === namePart);
if (!matchedUser && namePart === "priya s") {
  matchedUser = users.find(u => u.name.toLowerCase() === "priya");
}
```
