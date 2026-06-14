import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Query parameter "sessionId" is required.' },
        { status: 400 }
      );
    }

    // Retrieve staged expenses
    const stagedExpenses = await prisma.stagedExpense.findMany({
      where: {
        sessionId: sessionId,
      },
      orderBy: {
        rawRowNumber: 'asc',
      },
    });

    // Parse internal JSON fields back into objects
    const parsedExpenses = stagedExpenses.map((expense) => {
      let rawDataObj = {};
      let anomaliesArr: string[] = [];

      try {
        rawDataObj = JSON.parse(expense.rawData);
      } catch (err) {
        console.warn(`Failed to parse rawData for StagedExpense ID: ${expense.id}`);
      }

      try {
        anomaliesArr = JSON.parse(expense.detectedAnomalies);
      } catch (err) {
        console.warn(`Failed to parse detectedAnomalies for StagedExpense ID: ${expense.id}`);
      }

      return {
        id: expense.id,
        sessionId: expense.sessionId,
        rawRowNumber: expense.rawRowNumber,
        status: expense.status,
        resolvedPayerId: expense.resolvedPayerId,
        resolvedAmount: expense.resolvedAmount,
        rawData: rawDataObj,
        detectedAnomalies: anomaliesArr,
      };
    });

    return NextResponse.json({
      success: true,
      sessionId,
      count: parsedExpenses.length,
      stagedExpenses: parsedExpenses,
    });
  } catch (err: any) {
    console.error('Error fetching staged expenses:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred fetching staged expenses.' },
      { status: 500 }
    );
  }
}
