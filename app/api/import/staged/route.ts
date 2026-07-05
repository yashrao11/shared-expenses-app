import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { ANOMALY_DEFINITIONS, buildBreakdown } from '@/lib/import/anomalyEngine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const anomaly = searchParams.get('anomaly');
    const status = searchParams.get('status');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Query parameter "sessionId" is required.' },
        { status: 400 }
      );
    }

    // Retrieve staged expenses
    const allSessionRows = await prisma.stagedExpense.findMany({
      where: {
        sessionId: sessionId,
      },
      orderBy: {
        rawRowNumber: 'asc',
      },
    });

    const breakdown = buildBreakdown(allSessionRows);
    const stagedExpenses = allSessionRows.filter((expense) => {
      const anomalies = JSON.parse(expense.detectedAnomalies || '[]') as string[];
      const matchesAnomaly = !anomaly || anomaly === 'ALL' || anomalies.includes(anomaly);
      const matchesStatus = !status || status === 'ALL' || expense.status === status;
      return matchesAnomaly && matchesStatus;
    });

    // Parse internal JSON fields back into objects
    const parsedExpenses = stagedExpenses.map((expense) => {
      let rawDataObj = {};
      let anomaliesArr: string[] = [];

      try {
        rawDataObj = JSON.parse(expense.rawData);
      } catch {
        console.warn(`Failed to parse rawData for StagedExpense ID: ${expense.id}`);
      }

      try {
        anomaliesArr = JSON.parse(expense.detectedAnomalies);
      } catch {
        console.warn(`Failed to parse detectedAnomalies for StagedExpense ID: ${expense.id}`);
      }

      return {
        id: expense.id,
        sessionId: expense.sessionId,
        rawRowNumber: expense.rawRowNumber,
        status: expense.status,
        resolvedPayerId: expense.resolvedPayerId,
        resolvedAmount: expense.resolvedAmount,
        resolvedData: parseOptionalJson(expense.resolvedData),
        resolutionSummary: expense.resolutionSummary,
        resolutionMode: expense.resolutionMode,
        committedExpenseId: expense.committedExpenseId,
        rawData: rawDataObj,
        detectedAnomalies: anomaliesArr,
      };
    });

    const totalRows = allSessionRows.length;
    const pending = allSessionRows.filter((row) => row.status === 'PENDING_APPROVAL').length;
    const resolved = allSessionRows.filter((row) => row.status === 'APPROVED' || row.status === 'RESOLVED').length;
    const rejected = allSessionRows.filter((row) => row.status === 'REJECTED').length;
    const anomalyRows = allSessionRows.filter((row) => JSON.parse(row.detectedAnomalies || '[]').length > 0).length;

    return NextResponse.json({
      success: true,
      sessionId,
      count: parsedExpenses.length,
      report: {
        totalRows,
        pending,
        resolved,
        rejected,
        anomalyRows,
        cleanRows: totalRows - anomalyRows,
        breakdown,
      },
      anomalyDefinitions: ANOMALY_DEFINITIONS,
      stagedExpenses: parsedExpenses,
    });
  } catch (err: unknown) {
    console.error('Error fetching staged expenses:', err);
    const message = err instanceof Error ? err.message : 'An error occurred fetching staged expenses.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

function parseOptionalJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
