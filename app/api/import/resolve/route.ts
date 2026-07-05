import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { calculateSplits, RawSplitInput } from "@/lib/splittingEngine";
import {
  ANOMALY_DEFINITIONS,
  AnomalyCode,
  RawExpenseRow,
  ResolvedExpenseRow,
  applyPolicy,
  fetchUsdToInrRate,
  normalizeRow,
  parseCSVDate,
  parseJsonArray,
  parseJsonObject,
  roundMoney,
} from "@/lib/import/anomalyEngine";

type ResolveAction =
  | "APPROVE"
  | "REJECT"
  | "RESOLVE_EDIT"
  | "APPLY_POLICY"
  | "APPLY_CATEGORY_POLICY";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as ResolveAction;

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'Body parameter "action" is required.' },
        { status: 400 }
      );
    }

    if (action === "APPLY_CATEGORY_POLICY") {
      return await applyCategoryPolicy(body.sessionId, body.anomalyCode);
    }

    const stagedExpenseId = body.stagedExpenseId as string | undefined;
    if (!stagedExpenseId) {
      return NextResponse.json(
        { success: false, error: 'Body parameter "stagedExpenseId" is required for row actions.' },
        { status: 400 }
      );
    }

    const staged = await prisma.stagedExpense.findUnique({ where: { id: stagedExpenseId } });
    if (!staged) {
      return NextResponse.json(
        { success: false, error: `StagedExpense with ID "${stagedExpenseId}" was not found.` },
        { status: 404 }
      );
    }

    if (action === "REJECT") {
      await rejectStagedRow(staged.id, staged.committedExpenseId, "Rejected by reviewer.");
      return NextResponse.json({ success: true, message: "Staged row rejected." });
    }

    const rawRow = parseJsonObject<RawExpenseRow>(staged.rawData, {});
    const anomalies = parseJsonArray(staged.detectedAnomalies);

    if (action === "APPLY_POLICY") {
      const result = await resolveWithPolicy(staged.id, rawRow, anomalies, staged.committedExpenseId);
      return NextResponse.json({ success: true, ...result });
    }

    if (action !== "APPROVE" && action !== "RESOLVE_EDIT") {
      return NextResponse.json(
        { success: false, error: `Unsupported action "${action}".` },
        { status: 400 }
      );
    }

    const resolved = action === "RESOLVE_EDIT"
      ? coerceOverrides(body.overrides || {}, rawRow)
      : normalizeRow(rawRow);
    const summary = action === "RESOLVE_EDIT"
      ? ["Manual reviewer edits applied."]
      : ["Reviewer approved parsed row without additional edits."];

    const result = await commitResolvedRow({
      stagedExpenseId: staged.id,
      committedExpenseId: staged.committedExpenseId,
      resolved,
      resolutionMode: action === "RESOLVE_EDIT" ? "MANUAL" : "APPROVED",
      summary,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    console.error("Error resolving staged expense:", err);
    const message = err instanceof Error ? err.message : "An error occurred during resolution.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}

async function applyCategoryPolicy(sessionId?: string, anomalyCode?: AnomalyCode | "ALL") {
  if (!sessionId || !anomalyCode) {
    return NextResponse.json(
      { success: false, error: 'Parameters "sessionId" and "anomalyCode" are required.' },
      { status: 400 }
    );
  }

  const rows = await prisma.stagedExpense.findMany({
    where: { sessionId, status: "PENDING_APPROVAL" },
    orderBy: { rawRowNumber: "asc" },
  });

  let resolvedCount = 0;
  let rejectedCount = 0;
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  for (const row of rows) {
    const anomalies = parseJsonArray(row.detectedAnomalies);
    const shouldAttempt = anomalyCode === "ALL" || anomalies.includes(anomalyCode);
    if (!shouldAttempt) continue;

    const unsupported = anomalies.filter((code) => {
      const definition = ANOMALY_DEFINITIONS[code as AnomalyCode];
      return definition && !definition.canApplyPolicy;
    });

    if (unsupported.length > 0) {
      skipped.push({
        rowNumber: row.rawRowNumber,
        reason: `Manual review required for ${unsupported.join(", ")}.`,
      });
      continue;
    }

    try {
      const rawRow = parseJsonObject<RawExpenseRow>(row.rawData, {});
      const result = await resolveWithPolicy(row.id, rawRow, anomalies, row.committedExpenseId);
      if (result.status === "REJECTED") rejectedCount += 1;
      else resolvedCount += 1;
    } catch (err: unknown) {
      skipped.push({ rowNumber: row.rawRowNumber, reason: err instanceof Error ? err.message : "Policy failed." });
    }
  }

  return NextResponse.json({
    success: true,
    resolvedCount,
    rejectedCount,
    skipped,
    message: `Policy run completed for ${anomalyCode}.`,
  });
}

async function resolveWithPolicy(
  stagedExpenseId: string,
  rawRow: RawExpenseRow,
  anomalies: string[],
  committedExpenseId?: string | null
) {
  const unsupported = anomalies.filter((code) => {
    const definition = ANOMALY_DEFINITIONS[code as AnomalyCode];
    return definition && !definition.canApplyPolicy;
  });
  if (unsupported.length > 0) {
    throw new Error(`Manual review required for ${unsupported.join(", ")}.`);
  }

  if (anomalies.includes("POTENTIAL_DUPLICATE")) {
    await rejectStagedRow(
      stagedExpenseId,
      committedExpenseId,
      "Rejected by duplicate policy: kept earlier matching row."
    );
    return { status: "REJECTED", message: "Duplicate row rejected by approved policy." };
  }

  let liveUsdRate: number | undefined;
  let rateSummary: string | undefined;
  if (anomalies.includes("MULTI_CURRENCY_USD")) {
    const rate = await fetchUsdToInrRate();
    liveUsdRate = rate.rate;
    rateSummary = `Exchange rate source: ${rate.source}, as of ${rate.asOf}.`;
  }

  const { resolved, summary } = applyPolicy(rawRow, anomalies, liveUsdRate);
  if (rateSummary) summary.push(rateSummary);

  if (resolved.skipLedger) {
    await rejectStagedRow(stagedExpenseId, committedExpenseId, summary.join(" "));
    return { status: "REJECTED", message: "Zero-value row ignored by approved policy." };
  }

  return await commitResolvedRow({
    stagedExpenseId,
    committedExpenseId,
    resolved,
    resolutionMode: "POLICY",
    summary,
  });
}

function coerceOverrides(overrides: Record<string, unknown>, rawRow: RawExpenseRow): ResolvedExpenseRow {
  const fallback = normalizeRow(rawRow);
  const splitWith = Array.isArray(overrides.splitWith)
    ? overrides.splitWith.map(String).filter(Boolean)
    : fallback.splitWith;

  const splitTypeValue = typeof overrides.splitType === "string" ? overrides.splitType : fallback.splitType;
  const splitType = ["equal", "unequal", "percentage", "share"].includes(splitTypeValue)
    ? splitTypeValue as ResolvedExpenseRow["splitType"]
    : fallback.splitType;

  return {
    date: stringOverride(overrides.date, fallback.date),
    description: stringOverride(overrides.description, fallback.description || "Staged Ingested Expense"),
    paidBy: stringOverride(overrides.paidBy, fallback.paidBy),
    amount: roundMoney(Number(overrides.amount ?? fallback.amount)),
    currency: stringOverride(overrides.currency, fallback.currency || "INR").toUpperCase(),
    exchangeRate: overrides.exchangeRate ? Number(overrides.exchangeRate) : fallback.exchangeRate,
    splitType,
    splitWith,
    splitDetails: stringOverride(overrides.splitDetails, fallback.splitDetails),
    notes: stringOverride(overrides.notes, fallback.notes),
    isSettlement: Boolean(overrides.isSettlement ?? fallback.isSettlement),
  };
}

function stringOverride(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

async function commitResolvedRow(args: {
  stagedExpenseId: string;
  committedExpenseId?: string | null;
  resolved: ResolvedExpenseRow;
  resolutionMode: string;
  summary: string[];
}) {
  const { stagedExpenseId, committedExpenseId, resolved, resolutionMode, summary } = args;

  if (!resolved.paidBy) throw new Error("Payer is required before committing.");
  if (!resolved.description) throw new Error("Description is required before committing.");
  if (!Number.isFinite(resolved.amount)) throw new Error("Amount must be a valid number.");

  const parsedDate = parseCSVDate(resolved.date).date;

  let exchangeRate = resolved.currency === "USD" ? resolved.exchangeRate : 1.0;
  if (resolved.currency === "USD" && !exchangeRate) {
    const rate = await fetchUsdToInrRate();
    exchangeRate = rate.rate;
    summary.push(`Exchange rate source: ${rate.source}, as of ${rate.asOf}.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    if (committedExpenseId) {
      await tx.expense.deleteMany({ where: { id: committedExpenseId } });
    }

    const dbUsers = await tx.user.findMany();
    const userMap: Record<string, string> = {};
    for (const user of dbUsers) userMap[user.name] = user.id;

    const resolvedPayer = dbUsers.find((user) => user.name === resolved.paidBy);
    if (!resolvedPayer) throw new Error(`Payer "${resolved.paidBy}" does not match a seeded user.`);

    const mainGroup = await tx.group.findFirst();
    if (!mainGroup) throw new Error("No default group exists. Seed the database first.");

    const splitWith = resolved.isSettlement
      ? [resolved.splitWith[0]].filter(Boolean)
      : resolved.splitWith;
    if (splitWith.length === 0) throw new Error("At least one split participant is required.");

    const splitInput: RawSplitInput = {
      amount: resolved.amount,
      currency: resolved.currency,
      exchangeRate,
      date: parsedDate,
      splitType: resolved.isSettlement ? "equal" : resolved.splitType,
      splitWith,
      splitDetails: resolved.isSettlement ? "" : resolved.splitDetails,
    };

    const calculation = await calculateSplits(splitInput, userMap);
    if (!calculation.success) {
      throw new Error(`Splitting engine validation failed: ${calculation.errors.join(" | ")}`);
    }

    const expense = await tx.expense.create({
      data: {
        groupId: mainGroup.id,
        paidById: resolvedPayer.id,
        description: resolved.description,
        amount: calculation.baseAmountINR,
        rawAmount: resolved.amount,
        currency: resolved.currency,
        exchangeRate: exchangeRate || 1.0,
        date: parsedDate,
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

    await tx.stagedExpense.update({
      where: { id: stagedExpenseId },
      data: {
        status: resolutionMode === "APPROVED" ? "APPROVED" : "RESOLVED",
        resolvedPayerId: resolvedPayer.id,
        resolvedAmount: calculation.baseAmountINR,
        resolvedData: JSON.stringify({ ...resolved, exchangeRate }),
        resolutionSummary: summary.join(" "),
        resolutionMode,
        committedExpenseId: expense.id,
      },
    });

    return {
      status: resolutionMode === "APPROVED" ? "APPROVED" : "RESOLVED",
      expenseId: expense.id,
      baseAmountINR: calculation.baseAmountINR,
      splits: calculation.splits,
    };
  });

  return {
    ...result,
    message: "Staged row committed to the ledger.",
  };
}

async function rejectStagedRow(stagedExpenseId: string, committedExpenseId: string | null | undefined, summary: string) {
  await prisma.$transaction(async (tx) => {
    if (committedExpenseId) {
      await tx.expense.deleteMany({ where: { id: committedExpenseId } });
    }
    await tx.stagedExpense.update({
      where: { id: stagedExpenseId },
      data: {
        status: "REJECTED",
        resolutionMode: "REJECTED",
        resolutionSummary: summary,
        committedExpenseId: null,
      },
    });
  });
}
