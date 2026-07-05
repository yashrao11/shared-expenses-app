import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import db from "@/lib/db";
import { ANOMALY_DEFINITIONS, RawExpenseRow, analyzeRows, buildBreakdown } from "@/lib/import/anomalyEngine";

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

    const session = await db.importSession.create({
      data: { status: "PROCESSING" },
    });

    await db.$transaction(async (tx) => {
      for (const analysis of analyses) {
        await tx.stagedExpense.create({
          data: {
            sessionId: session.id,
            rawRowNumber: analysis.rowNumber,
            rawData: JSON.stringify(analysis.row),
            detectedAnomalies: JSON.stringify(analysis.anomalies),
            status: "PENDING_APPROVAL",
            resolvedData: JSON.stringify(analysis.normalized),
            resolutionSummary: "Parsed only. Awaiting reviewer approval before ledger commit.",
            resolutionMode: "PARSED",
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
      sessionId: session.id,
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
