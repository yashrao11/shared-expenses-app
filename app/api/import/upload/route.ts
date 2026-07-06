import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import db from "@/lib/db";
import { calculateSplits, RawSplitInput } from "@/lib/splittingEngine";
import { ANOMALY_DEFINITIONS, RawExpenseRow, analyzeRows, buildBreakdown, parseCSVDate } from "@/lib/import/anomalyEngine";

export async function POST(request: NextRequest) {
  try {
    const fileContent = await readCsvContent(request);
    const records: RawExpenseRow[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: false,
      bom: true,
    });

    const [users, group] = await Promise.all([
      db.user.findMany(),
      db.group.findFirst(),
    ]);

    if (!group) {
      return NextResponse.json(
        { success: false, error: "Default group not found. Run migrations and seed first." },
        { status: 500 }
      );
    }

    const memberships = await db.groupMembership.findMany({
      where: { groupId: group.id },
    });

    const analyses = analyzeRows(records, users, memberships);

    let sessionId = "";

    await db.$transaction(async (tx) => {
      // Clean previous session data and production ledger
      await tx.expenseSplit.deleteMany({});
      await tx.expense.deleteMany({});
      await tx.stagedExpense.deleteMany({});
      await tx.importSession.deleteMany({});

      const session = await tx.importSession.create({
        data: { status: "PROCESSING" },
      });
      sessionId = session.id;

      const dbUsers = await tx.user.findMany();
      const userMap: Record<string, string> = {};
      for (const u of dbUsers) {
        userMap[u.name.trim().toLowerCase()] = u.id;
      }

      for (const analysis of analyses) {
        const isClean = analysis.anomalies.length === 0;
        let committedExpenseId: string | null = null;
        let status = "PENDING_APPROVAL";
        let resolutionMode = "PARSED";
        let resolutionSummary = "Parsed only. Awaiting reviewer approval before ledger commit.";
        let resolvedDataStr: string | null = null;
        let resolvedAmount: number | null = null;
        let resolvedPayerId: string | null = null;

        if (isClean) {
          try {
            const resolved = analysis.normalized;
            const resolvedPayer = dbUsers.find((user) => user.name === resolved.paidBy);
            if (resolvedPayer) {
              const splitWith = resolved.isSettlement
                ? [resolved.splitWith[0]].filter(Boolean)
                : resolved.splitWith;

              const splitInput: RawSplitInput = {
                amount: resolved.amount,
                currency: resolved.currency,
                exchangeRate: 1.0,
                date: parseCSVDate(resolved.date).date,
                splitType: resolved.isSettlement ? "equal" : resolved.splitType,
                splitWith,
                splitDetails: resolved.isSettlement ? "" : resolved.splitDetails,
              };

              const calculation = await calculateSplits(splitInput, userMap);
              if (calculation.success) {
                const expense = await tx.expense.create({
                  data: {
                    groupId: group.id,
                    paidById: resolvedPayer.id,
                    description: resolved.description,
                    amount: calculation.baseAmountINR,
                    rawAmount: resolved.amount,
                    currency: resolved.currency,
                    exchangeRate: 1.0,
                    date: parseCSVDate(resolved.date).date,
                    splitType: resolved.isSettlement ? "equal" : resolved.splitType,
                    isSettlement: resolved.isSettlement,
                    notes: resolved.notes || null,
                  },
                });

                for (const split of calculation.splits) {
                  await tx.expenseSplit.create({
                    data: {
                      expenseId: expense.id,
                      userId: split.userId,
                      owedAmount: split.owedAmount,
                    },
                  });
                }

                committedExpenseId = expense.id;
                status = "APPROVED";
                resolutionMode = "AUTO_COMMITTED";
                resolutionSummary = "Automatically approved clean row.";
                resolvedDataStr = JSON.stringify({ ...resolved, exchangeRate: 1.0 });
                resolvedAmount = calculation.baseAmountINR;
                resolvedPayerId = resolvedPayer.id;
              }
            }
          } catch (err) {
            console.error(`Failed to auto-commit clean row ${analysis.rowNumber}:`, err);
          }
        }

        await tx.stagedExpense.create({
          data: {
            sessionId: session.id,
            rawRowNumber: analysis.rowNumber,
            rawData: JSON.stringify(analysis.row),
            detectedAnomalies: JSON.stringify(analysis.anomalies),
            status,
            resolvedPayerId,
            resolvedAmount,
            resolvedData: resolvedDataStr || JSON.stringify(analysis.normalized),
            resolutionSummary,
            resolutionMode,
            committedExpenseId,
          },
        });
      }

      await tx.importSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED" },
      });
    });

    const stagedRows = analyses.map((analysis) => ({
      detectedAnomalies: JSON.stringify(analysis.anomalies),
      status: "PENDING_APPROVAL",
    }));
    const breakdown = buildBreakdown(stagedRows);
    const anomalyRowCount = analyses.filter((analysis) => analysis.anomalies.length > 0).length;

    return NextResponse.json({
      success: true,
      sessionId: sessionId,
      totalRows: records.length,
      stagedPending: records.length,
      anomalyRows: anomalyRowCount,
      cleanRows: records.length - anomalyRowCount,
      breakdown,
      anomalyDefinitions: ANOMALY_DEFINITIONS,
      message: "CSV parsed and staged. No production ledger rows were committed.",
    });
  } catch (error: unknown) {
    console.error("Ingestion failed:", error);
    const message = error instanceof Error ? error.message : "Unknown import error.";
    return NextResponse.json(
      { success: false, error: "CSV import failed.", details: message },
      { status: 500 }
    );
  }
}

async function readCsvContent(request: NextRequest): Promise<string> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      throw new Error("No CSV file was provided in the upload.");
    }
    return await file.text();
  }

  const csvFilePath = path.join(process.cwd(), "data", "expenses_export.csv");
  if (!fs.existsSync(csvFilePath)) {
    throw new Error("No uploaded file and sample CSV was not found at data/expenses_export.csv.");
  }
  return fs.readFileSync(csvFilePath, "utf-8");
}
