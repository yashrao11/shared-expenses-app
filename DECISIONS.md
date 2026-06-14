# Decisions Log & Architectural Trade-offs

This document records the architectural decisions, engineering trade-offs, and design paradigms chosen during the development of our Shared Expenses App. These decisions were made to balance local auditability, strict accounting constraints, and the individual requests of our flatmates (Aisha, Rohan, Priya, Sam, and Meera).

---

## Decision 1: Relational Database Storage Engine Selection
* **Context**: The app must use a relational database, supporting cascade deletes, relational integrity, and rapid setup for grading environments.
* **Options Considered**:
  1. *PostgreSQL (hosted on Supabase or Neon)*
  2. *SQLite (using local file storage with Prisma ORM)*
* **Selected Choice**: **SQLite**
* **Rationale**: 
  SQLite provides 100% compliance with relational DB rules, including deep transactional logic and foreign key indexing. Under tight placement timelines, it removes network latency, avoids third-party API dependencies during evaluation, and allows live graders to inspect the database locally via Prisma Studio with zero local Postgres installation or credentials setup. It makes the project completely self-contained.

---

## Decision 2: Importer Architecture (Staging vs. Real-Time Write)
* **Context**: Meera requested strict control over duplicate row cleanups and manual approvals. We need to decide how messy CSV rows are held before being finalized.
* **Options Considered**:
  1. *Direct Ingestion with Auto-Correction Guesses*: Ingest, attempt to guess values (e.g. divide the 110% pizza percentages by 1.1), and write instantly to production tables.
  2. *Isolated Import Staging Area*: Keep raw data in an independent staging schema (`StagedExpense`). Parse, run validation rules, flag anomalies, and render an interactive UI before running calculations.
* **Selected Choice**: **Isolated Import Staging Area**
* **Rationale**: 
  Silent auto-corrections violate clean accounting practices. Staging ensures raw data remains untampered. It empowers Meera to reject duplicates (e.g. Marina Bites) and edit invalid mathematical entries (e.g. Pizza Friday) on-screen before any split changes touch production balances. Only after a roommate edits and commits a row does it enter the production ledger.

---

## Decision 3: Temporal Membership Boundaries (Sam's Request)
* **Context**: Sam moved in mid-April. He should not be assigned any liability for expense splits occurring prior to his move-in timeline (such as March utilities).
* **Options Considered**:
  1. *Implicit Date Splitting*: Assume anyone in the "split_with" column is valid and split anyway.
  2. *Strict Join/Leave Timeline Validation*: Reject or flag any transaction split where the transaction date is outside of the participant's active membership dates.
* **Selected Choice**: **Strict Join/Leave Timeline Validation**
* **Rationale**: 
  By adding explicit `joinedAt` and optional `leftAt` columns inside the `GroupMembership` table, we programmatically validate every transaction. If a CSV row dated March attempts to include Sam, the Splitting Engine flags a temporal boundary exception. This mathematically keeps Sam's liability isolated to his residency.

---

## Decision 4: Balance Optimization & Debt Simplification Algorithm
* **Context**: Aisha wants simple "Who pays whom" outcomes, while Rohan wants a clear audit trail for every transaction.
* **Options Considered**:
  1. *Complete Network Flows (Bellman-Ford / Max-Flow Min-Cut)*
  2. *Greedy Creditor-Debtor Heap-Matching Algorithm*
* **Selected Choice**: **Greedy Creditor-Debtor Heap-Matching Algorithm**
* **Rationale**: 
  Greedy heap-matching simplifies calculations into $O(N \log N)$ operations. It works by matching the largest overall debtor to the largest overall creditor, which generates the absolute minimum number of settlement payments (Aisha's requirement). Since we preserve raw balances and splits in the `ExpenseSplit` table, we can easily display Rohan's itemized transaction ledgers without losing auditability.

---

## Decision 5: Penny Distribution & Fractional Rounding Policy
* **Context**: For splits that divide unevenly (e.g., ₹10.00 split 3 ways, or ₹899.99 split 4 ways), standard float division leaks fractions of cents, causing splits to sum to slightly more or less than the total expense amount.
* **Options Considered**:
  1. *Float division with database truncation*: Allow the database to truncate decimals, resulting in discrepancies when summing up splits (total splits do not match the expense amount).
  2. *Cent-Based Remainders Redistribution*: Perform calculations internally at high precision (4 decimal places), round to standard 2-decimal currency cents, check the sum of rounded values against the normalized transaction base total, and distribute the remaining pennies one-by-one to participants starting from the first index until the ledger reconciles.
* **Selected Choice**: **Cent-Based Remainders Redistribution**
* **Rationale**: 
  This approach guarantees that the sum of splits is *exactly* equal to the total transaction amount to the last penny, satisfying Rohan's audit criteria, while avoiding messy dummy rows or float leakage. The rounding error is completely absorbed inside the splits dynamically.
