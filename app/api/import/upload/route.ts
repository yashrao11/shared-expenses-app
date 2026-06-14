import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import db from "@/lib/db";
import { calculateSplits } from "@/lib/splittingEngine";

// Helper to normalize and match roommate names
function normalizeName(name: string): string {
  const cleaned = name.trim().toLowerCase();
  if (cleaned === "priya s" || cleaned === "priyas") return "Priya";
  if (cleaned === "rohan") return "Rohan";
  // Capitalize first letter as default
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// Helper to parse dates in various CSV formats
function parseCSVDate(dateStr: string): Date {
  const cleaned = dateStr.trim();
  // Handle Mar-14 format
  if (cleaned.includes("-") && isNaN(Number(cleaned.split("-")[0]))) {
    const parts = cleaned.split("-");
    const monthMap: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const month = monthMap[parts[0].toLowerCase()] ?? 2; // Default to March
    const day = parseInt(parts[1], 10);
    return new Date(2026, month, day);
  }
  // Handle standard DD-MM-YYYY format
  if (cleaned.includes("-")) {
    const parts = cleaned.split("-");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  return new Date(cleaned);
}

export async function POST() {
  try {
    const csvFilePath = path.join(process.cwd(), "data", "expenses_export.csv");
    if (!fs.existsSync(csvFilePath)) {
      return NextResponse.json({ error: "CSV file not found at data/expenses_export.csv" }, { status: 404 });
    }

    const fileContent = fs.readFileSync(csvFilePath, "utf-8");
    const records: Record<string, string>[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Fetch database users and group for validations
    const users = await db.user.findMany();
    const group = await db.group.findFirst();
    if (!group) {
      return NextResponse.json({ error: "Default group not found. Run migrations and seeds first." }, { status: 500 });
    }

    const validUserNames = new Set(users.map(u => u.name));

    // Create an import session
    const session = await db.importSession.create({
      data: { status: "PROCESSING" }
    });

    let autoCommittedCount = 0;
    let stagedCount = 0;

    // We process sequentially to detect duplicate entries across rows
    const processedHistory: Array<{ date: string; amount: number; desc: string }> = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const anomalies: string[] = [];
      const rowNum = i + 1;

      // Extract raw properties
      const rawDateStr = row.date;
      const rawDesc = row.description;
      const rawPaidBy = row.paid_by;
      let rawAmountStr = row.amount;
      const rawCurrency = row.currency;
      const rawSplitType = row.split_type;
      const rawSplitWith = row.split_with;
      const rawSplitDetails = row.split_details;
      const rawNotes = row.notes;

      // Parse and normalize amount
      let parsedAmount = 0;
      if (!rawAmountStr || rawAmountStr.trim() === "" || rawAmountStr.trim() === "0") {
        parsedAmount = 0;
      } else {
        // Strip commas and quotes
        const cleanedAmountStr = rawAmountStr.replace(/["',]/g, "").trim();
        parsedAmount = parseFloat(cleanedAmountStr);
        if (isNaN(parsedAmount)) {
          anomalies.push("BAD_NUMBER_FORMAT");
        } else if (cleanedAmountStr.split(".")[1]?.length > 2) {
          anomalies.push("HIGH_PRECISION_LIMIT");
        }
      }

      // Check Missing Payer
      if (!rawPaidBy || rawPaidBy.trim() === "") {
        anomalies.push("MISSING_PAYER");
      }

      // Check Missing Currency
      if (!rawCurrency || rawCurrency.trim() === "") {
        anomalies.push("MISSING_CURRENCY");
      }

      // Normalize Payer Name
      let matchedPayer = null;
      if (rawPaidBy && rawPaidBy.trim() !== "") {
        const normalizedPayer = normalizeName(rawPaidBy);
        if (rawPaidBy.trim() !== normalizedPayer) {
          anomalies.push("NAME_INCONSISTENCY");
        }
        matchedPayer = users.find(u => u.name === normalizedPayer);
        if (!matchedPayer) {
          anomalies.push("UNREGISTERED_MEMBER");
        }
      }

      // Parse and Normalize Split-With roommates
      const splitWithNames: string[] = [];
      if (rawSplitWith && rawSplitWith.trim() !== "") {
        const rawNames = rawSplitWith.split(";");
        for (const rawName of rawNames) {
          const cleanedName = normalizeName(rawName);
          splitWithNames.push(cleanedName);
          if (!validUserNames.has(cleanedName)) {
            anomalies.push("UNREGISTERED_MEMBER");
          }
        }
      }

      // Check Duplicates (Compare against previous rows in this file)
      const isDuplicate = processedHistory.some(h => 
        h.date === rawDateStr && 
        h.amount === parsedAmount && 
        (h.desc.toLowerCase().includes(rawDesc.toLowerCase()) || rawDesc.toLowerCase().includes(h.desc.toLowerCase()))
      );
      if (isDuplicate) {
        anomalies.push("POTENTIAL_DUPLICATE");
      }
      processedHistory.push({ date: rawDateStr, amount: parsedAmount, desc: rawDesc });

      // Check Settlements
      const isSettlement = !rawSplitType || rawSplitType.trim() === "" || rawDesc.toLowerCase().includes("paid back") || rawDesc.toLowerCase().includes("deposit");
      if (isSettlement) {
        anomalies.push("IS_SETTLEMENT");
      }

      // Parse Date and validate Temporal boundaries
      let parsedDate = new Date();
      try {
        parsedDate = parseCSVDate(rawDateStr);
        // Check active timelines for members in split
        for (const name of splitWithNames) {
          const dbUser = users.find(u => u.name === name);
          if (dbUser) {
            const membership = await db.groupMembership.findFirst({
              where: {
                userId: dbUser.id,
                groupId: group.id,
                joinedAt: { lte: parsedDate },
                OR: [
                  { leftAt: null },
                  { leftAt: { gte: parsedDate } }
                ]
              }
            });
            if (!membership) {
              anomalies.push("TEMPORAL_MEMBERSHIP_VIOLATION");
            }
          }
        }
      } catch (err) {
        anomalies.push("INVALID_DATE_FORMAT");
      }

      // Check Percentage Splits Math
      if (rawSplitType === "percentage" && rawSplitDetails) {
        const pctMatches = rawSplitDetails.match(/[\d.]+(?=%)/g);
        if (pctMatches) {
          const totalPct = pctMatches.map(Number).reduce((sum: number, val: number) => sum + val, 0);
          if (Math.abs(totalPct - 100) > 0.1) {
            anomalies.push("PERCENTAGE_MATH_MISMATCH");
          }
        }
      }

      const hasCriticalAnomalies = anomalies.some(a => 
        ["MISSING_PAYER", "UNREGISTERED_MEMBER", "PERCENTAGE_MATH_MISMATCH", "POTENTIAL_DUPLICATE", "TEMPORAL_MEMBERSHIP_VIOLATION", "BAD_NUMBER_FORMAT"].includes(a)
      );

      // POLICY DECISION: If there are no critical anomalies, commit directly to production!
      if (!hasCriticalAnomalies && matchedPayer && parsedAmount > 0) {
        const finalCurrency = rawCurrency || "INR";
        const exchangeRate = finalCurrency.toUpperCase() === "USD" ? 83.0 : 1.0;
        const normalizedAmount = parsedAmount * exchangeRate;

        // Build a name→id map for the engine
        const userMap: Record<string, string> = {};
        for (const u of users) userMap[u.name] = u.id;

        // Call the full splitting engine
        const splitResult = await calculateSplits(
          {
            amount: parsedAmount,
            currency: finalCurrency,
            date: parsedDate,
            splitType: rawSplitType || "equal",
            splitWith: splitWithNames,
            splitDetails: rawSplitDetails || undefined,
          },
          userMap
        );

        await db.$transaction(async (tx) => {
          const expense = await tx.expense.create({
            data: {
              groupId: group.id,
              paidById: matchedPayer.id,
              description: rawDesc,
              amount: splitResult.baseAmountINR,
              rawAmount: parsedAmount,
              currency: finalCurrency,
              exchangeRate,
              date: parsedDate,
              splitType: rawSplitType || "equal",
              isSettlement: false,
              notes: rawNotes || null
            }
          });

          for (const split of splitResult.splits) {
            await tx.expenseSplit.create({
              data: {
                expenseId: expense.id,
                userId: split.userId,
                owedAmount: split.owedAmount
              }
            });
          }
        });

        // Save to staging as AUTO-APPROVED
        await db.stagedExpense.create({
          data: {
            sessionId: session.id,
            rawRowNumber: rowNum,
            rawData: JSON.stringify(row),
            detectedAnomalies: JSON.stringify(Array.from(new Set(anomalies))),
            status: "APPROVED",
            resolvedPayerId: matchedPayer.id,
            resolvedAmount: normalizedAmount
          }
        });
        autoCommittedCount++;
      } else {
        // Pause in staging area for manual human-in-the-loop validation
        await db.stagedExpense.create({
          data: {
            sessionId: session.id,
            rawRowNumber: rowNum,
            rawData: JSON.stringify(row),
            detectedAnomalies: JSON.stringify(Array.from(new Set(anomalies))),
            status: "PENDING_APPROVAL"
          }
        });
        stagedCount++;
      }
    }

    await db.importSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED" }
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      totalRows: records.length,
      autoCommitted: autoCommittedCount,
      stagedPending: stagedCount
    });

  } catch (error: any) {
    console.error("Ingestion failed:", error);
    return NextResponse.json({ error: "Internal server error during CSV processing.", details: error.message }, { status: 500 });
  }
}