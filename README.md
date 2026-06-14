# SplitSmart 💸 — Shared Roommate Expenses & Ingestion Engine

Welcome to **SplitSmart**, a highly polished, robust shared expenses application built to rescue four flatmates (Aisha, Rohan, Priya, and Meera) from a chaotic, multi-month spreadsheet log (`expenses_export.csv`). The app handles temporal roommate memberships, multi-currency conversions, and custom split calculations, providing a clean staging area to resolve data conflicts.

SplitSmart has been designed as a professional-grade software engineering solution, matching the exact constraints of the flatmates' requests while maintaining mathematical and relational integrity.

---

## 🚀 Live Application & Deployment Details

- **Deployment URL:** [http://localhost:3001](http://localhost:3001) (Local Development Instance)
- **Database Engine:** Relational SQLite Database managed via Prisma ORM.

---

## 🛠️ Local Installation & Development Setup

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v18.x or v20.x recommended)
- **npm** or **yarn**

### 2. Clone the Repository & Install Dependencies
```bash
# Navigate to the project folder
cd shared-expenses-app

# Install dependencies
npm install
```

### 3. Database Migration & Seeding
The application runs on a local relational SQLite database file (`prisma/dev.db`). Initialize the database, apply schemas, and run the roommate seed script:
```bash
# Push schema changes to the SQLite database and generate the client
npx prisma db push --force-reset

# Seed roommates, groups, and membership timelines
npx prisma db seed
```

This populates the initial database with:
- **7 Seeded Users:** Aisha, Rohan, Priya, Meera, Sam, Dev, and Kabir.
- **1 Shared Group:** "Flatmates Shared Space".
- **Temporal Membership Timelines:**
  - **Aisha, Rohan, Priya, Dev:** Active from February 1st, 2026 onwards.
  - **Meera:** Active from Feb 1st, 2026. Left on March 31st, 2026.
  - **Sam:** Active from April 15th, 2026 onwards (joined mid-April).
  - **Kabir:** Dev's trip friend, active from March 10th, 2026.

### 4. Running the Development Server
```bash
# Start Next.js development server
npm run dev
```
Open [http://localhost:3001](http://localhost:3001) in your browser. The main roommate select page allows you to pick any user, log in, view live balances, audit ledgers, settle debts, and open the CSV Ingestion Console.

---

## 💡 How Roommate Requests Were Solved

### 👩‍🦰 Aisha: "I just want one number per person. Who pays whom, how much, done."
We implement a **Greedy Creditor-Debtor Heap-Matching Algorithm** (located in `lib/balanceEngine.ts`). It takes roommate net balances and simplifies payments to the absolute minimum path by matching the highest debtors to the highest creditors. Aisha gets a single, clean list of simple transfer instructions (e.g., "Priya pays Dev ₹21,405").

### 👦 Rohan: "No magic numbers. If the app says I owe ₹2,300, I want to see exactly which expenses make that up."
Every transaction committed to the production database creates detailed [ExpenseSplit](file:///Users/yashrao/Documents/YASH%20RAO/To%20MAANG/Companies/Spreetail/shared-expenses-app/prisma/schema.prisma) records. Rohan can switch to his name under the **Individual Audit Ledger** on the dashboard. It displays every transaction he participated in, showing the total expense cost, the exact split type, his specific owed share, and his net financial impact (paid minus owed). No hidden figures.

### 👩 Priya: "Half the trip was in dollars. The sheet pretends a dollar is a rupee. That can't be right."
The **Splitting Engine** incorporates a multi-currency parser. When an expense is recorded in **USD**, it automatically multiplies the cost by a fixed rate of **83.0 INR**.
- The production `Expense` stores the original raw currency and amount (e.g., $540 USD) for transparent record-keeping.
- The `amount` field and all `owedAmount` splits are normalized and stored in **INR base currency** to ensure roommate net balances sum to exactly zero.

### 👨 Sam: "I moved in mid-April. Why would March electricity affect my balance?"
We implemented **Temporal Group Memberships**. The database tracks exactly when users join and leave the group. The Splitting Engine performs date-boundary checks for every split calculation:
- If an expense is dated March 15th, and someone attempts to split it with Sam (who joined April 15th), the system flags a **Temporal Membership Violation** and blocks auto-committing.
- Sam is strictly excluded from splits that occurred outside his active residency timeline.

### 👩‍🦳 Meera: "Clean up the duplicates — but I want to approve anything the app deletes or changes."
We built an **Isolated Staging Area** (`StagedExpense` table) and an **Interactive Ingestion Console**.
- Ingesting `expenses_export.csv` loads raw CSV rows into SQLite staging.
- Clean rows can be **Quick Approved**. Flagged anomaly rows (duplicates, currency issues, missing payers, date overlaps) show descriptive warning badges.
- Roommates can click **Interactive Resolve** to edit the fields (payer override, split detail adjustments, currency corrections) inline or **Reject** duplicates before they ever write to the production ledger.

---

## 🛠️ Tech Stack & Relational Architecture

- **Core Framework:** Next.js 16 (App Router, Turbopack) & React 19.
- **Styling:** Vanilla Tailwind CSS with modern UI accents (glassmorphism, subtle micro-animations).
- **ORM / Client:** Prisma Client JavaScript.
- **Database:** SQLite (local relational database storing strict cascade relationships).
- **CSV Ingestor:** Synchronous `csv-parse` parsing stream.

---

## 🤖 AI Development Collaboration

This project was developed in partnership with **Gemini 3.5 Flash**, working as an agentic AI coding companion. The developer reviewed, verified, and manually corrected the mathematical engine boundaries, temporal query checks, and string parsers to guarantee correct production ledgers. 

For full details on prompts, bugs caught, and code modifications, see the [AI_USAGE.md](file:///Users/yashrao/Documents/YASH%20RAO/To%20MAANG/Companies/Spreetail/shared-expenses-app/AI_USAGE.md) log.
