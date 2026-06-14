# SCOPE: Data Anomaly Log & Database Schema

This document details the data quality issues identified within the messy raw `expenses_export.csv` import file, our programmatic detection strategies, active resolution policies, and the resulting relational database architecture designed to enforce clean, temporal splitting rules.

---

## 1. Deep-Dive Anomaly Log & Resolution Decisions

During our static analysis and import ingestion, we identified 20 distinct data quality issues. Rather than quietly discarding rows or executing silent guesses, our importer loads all rows into a relational Staging Area (`StagedExpense`), surfaces anomalies to the user interface, and prompts for explicit human resolution before writing to the production ledger.

| Row # | Expense Description | Detected Problem | Technical Detection Rule | UI Surface & Resolution Policy |
| :--- | :--- | :--- | :--- | :--- |
| **4 & 5** | Dinner at Marina Bites / dinner - marina bites | **Duplicate Entry (Conflict)** | Matches date, raw numeric amount, and similar normalized descriptions. | Flagged as "Potential Duplicate". The UI prompts the user to select one row to commit and reject/delete the other. |
| **6** | Electricity Feb | **String/Comma Formatting** | Non-numeric characters matched within string `"1,200"`. | Strip non-numeric characters (except decimals) during parsing. Notify the user of auto-sanitization. |
| **9** | Cylinder refill | **Over-precision (3 decimals)** | Floating-point value has $> 2$ decimal places (`899.995`). | Rounded to 2 decimal places (`900.00`) to prevent database fractional money leaks. |
| **10** | Groceries DMart | **Payer Name Aliasing** | Name `"Priya S"` does not map directly to any seeded system user. | Prompt user to map `"Priya S"` to an existing user ("Priya") during resolution. |
| **11** | Aisha birthday cake | **Unequal Split Format** | `split_type` is unequal; `split_details` has custom values. | Parse details string (`Name Value`). Sum details values and verify they match the normalized transaction amount. |
| **12** | House cleaning supplies | **Missing Payer Entity** | `paid_by` column is empty/null. | Block final ledger write. Flag row as "Unassigned Payer" in UI. User must select a payer from a dropdown to resolve. |
| **13** | Rohan paid Aisha back | **Settlement Logged as Expense** | `split_type` is empty; description indicates payback or settlement. | Categorize as a peer-to-peer Settlement rather than a group expense. Adjusts net balances without impacting expense ledgers. |
| **14 & 31** | Pizza Friday / Weekend brunch | **Math Mismatch (110%)** | `split_type` percentage detail values do not sum to exactly 100%. | Flag as "Invalid Split Percentage" (110%). Block auto-commit. Force user to manually re-allocate shares in UI before writing. |
| **19 & 20** | Goa villa / Beach shack | **Multi-Currency (USD)** | Currency is `"USD"`. Priya noted the sheet previously treated USD as INR. | Use fixed conversion rate of $1 \text{ USD} = 83.0 \text{ INR}$ to normalize transaction to base currency INR for net balance calculations. |
| **21** | Scooter rentals | **Share-Based Split** | `split_type` is share; parsed elements contain weights. | Sum total shares ($6$). Divide total amount by $6$ to define unit share value, then allocate shares proportionally. |
| **22** | Parasailing | **Unregistered Group Member** | `split_with` includes `"Dev's friend Kabir"`. | Flag "Unregistered Member". The user can choose to add Kabir as a temp user, or omit him and redistribute his share. |
| **23 & 24** | Dinner at Thalassa / Thalassa dinner | **Conflicting Duplicate Duopoly** | Identical event with conflicting payers ("Aisha" vs "Rohan") and amounts. | Flag conflict. Force user to choose which payer/amount record is the correct source of truth. Reject the other. |
| **25** | Parasailing refund | **Negative Balance Entry** | Amount is negative (`-30`). | Treat as an expense offset/refund. Split the negative value proportionally among original transaction participants. |
| **26** | Airport cab | **Date Inconsistency & Space** | Non-standard date "Mar-14"; payer `"rohan "` contains trailing space. | Apply strict date format patterns to normalize date, and trim name whitespace strings to safely match existing user profiles. |
| **27** | Groceries DMart | **Missing Currency Field** | Currency field is blank. | Assume default base currency ("INR"). Write warning to import report. |
| **29** | Dinner order Swiggy | **Zero-Value Entry** | Amount is `0`. | Flag as informational; skip from active balance calculations to avoid divide-by-zero errors. |
| **33** | Deep cleaning service | **Ambiguous Date Pattern** | "04-05-2026" (Ambiguous DD-MM or MM-DD structure). | Resolve by referencing surrounding rows (April timeline). Treat as April 5th based on sequence context. |
| **35** | Groceries BigBasket | **Temporal Boundary Violation** | Meera included in split on April 2nd (after she moved out March 31st). | Flag "Temporal Membership Boundary Warning" in UI. Ask user to approve exclusion of Meera or force inclusion anyway. |
| **37** | Sam deposit share | **Non-Group Transfer** | Deposit transfer directly from Sam to Aisha. | Flag as direct peer-to-peer transaction. Keep out of active shared group expense math. |
| **41** | Furniture for common room | **Split Type Conflict** | Type states "equal", but detail fields contain custom shares. | Flag conflict. Resolve by prioritizing explicit shares in `split_details` over the general "equal" label. |

---

## 2. Database Schema (Prisma / Entity-Relationship Format)

To support temporal group memberships, dynamic staging, and explicit audit trails, we implement the following normalized relational schema:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id               String            @id @default(uuid())
  name             String            @unique
  memberships      GroupMembership[]
  paidExpenses     Expense[]         @relation("PaidExpenses")
  expenseSplits    ExpenseSplit[]
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
}

model Group {
  id          String            @id @default(uuid())
  name        String
  memberships GroupMembership[]
  expenses    Expense[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
}

model GroupMembership {
  id        String    @id @default(uuid())
  groupId   String
  userId    String
  joinedAt  DateTime
  leftAt    DateTime? // NULL indicates membership is active
  group     Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([groupId, userId])
}

model Expense {
  id            String         @id @default(uuid())
  groupId       String
  paidById      String
  description   String
  amount        Float          // Always stored in normalized base currency (INR)
  rawAmount     Float          // Keeps original amount for transparency (Rohan's audit)
  currency      String         @default("INR") // e.g., "USD", "INR"
  exchangeRate  Float          @default(1.0)
  date          DateTime
  splitType     String         // "equal", "unequal", "percentage", "share"
  isSettlement  Boolean        @default(false) // Marks settlements vs traditional expenses
  notes         String?
  group         Group          @relation(fields: [groupId], references: [id], onDelete: Cascade)
  payer         User           @relation("PaidExpenses", fields: [paidById], references: [id], onDelete: Cascade)
  splits        ExpenseSplit[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model ExpenseSplit {
  id         String   @id @default(uuid())
  expenseId  String
  userId     String
  owedAmount Float    // Normalized INR value
  expense    Expense  @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([expenseId, userId])
}

model ImportSession {
  id         String          @id @default(uuid())
  importedAt DateTime        @default(now())
  status     String          // "PENDING", "COMPLETED", "FAILED"
  stagedRows StagedExpense[]
}

model StagedExpense {
  id                String        @id @default(uuid())
  sessionId         String
  rawRowNumber      Int
  rawData           String        // Serialized JSON of original CSV text
  detectedAnomalies String        // Serialized JSON array of anomaly strings
  status            String        // "PENDING_APPROVAL", "APPROVED", "REJECTED", "RESOLVED"
  session           ImportSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
```
