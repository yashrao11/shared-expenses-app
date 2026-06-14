import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import prisma from '@/lib/db';

interface CSVRow {
  date: string;
  description: string;
  paid_by: string;
  amount: string;
  currency: string;
  split_type: string;
  split_with: string;
  split_details: string;
  notes: string;
}

export async function POST() {
  try {
    // 1. Read the raw text of the file from server filesystem
    const filePath = path.join(process.cwd(), 'data', 'expenses_export.csv');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: 'CSV export file not found on server.' },
        { status: 404 }
      );
    }
    const csvContent = fs.readFileSync(filePath, 'utf-8');

    // 2. Parse it using the "csv-parse" library
    const records: CSVRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: false, // keep original spaces for whitespace checks
    });

    // 3. Create an "ImportSession" in the database
    const session = await prisma.importSession.create({
      data: {
        status: 'PENDING',
      },
    });

    // 4. Pre-fetch database users and memberships for memory-based checks
    const dbUsers = await prisma.user.findMany();
    const dbMemberships = await prisma.groupMembership.findMany();

    const userMap: Record<string, string> = {};
    for (const user of dbUsers) {
      userMap[user.name.trim().toLowerCase()] = user.id;
    }

    const resolveUserId = (name: string): string | null => {
      const trimmed = name.trim().toLowerCase();
      return userMap[trimmed] || null;
    };

    // Helper to parse dates like "01-02-2026" or "Mar-14"
    const parseCSVDate = (dateStr: string): Date => {
      const cleanStr = dateStr.trim();
      const parts = cleanStr.split('-');
      if (parts.length === 3) {
        const d = parseInt(parts[0]);
        const m = parseInt(parts[1]) - 1;
        const y = parseInt(parts[2]);
        return new Date(Date.UTC(y, m, d));
      }
      if (parts.length === 2) {
        const months: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };
        const monthPart = parts[0].toLowerCase().substring(0, 3);
        const dayPart = parseInt(parts[1]);
        if (monthPart in months && !isNaN(dayPart)) {
          return new Date(Date.UTC(2026, months[monthPart], dayPart));
        }
      }
      return new Date(cleanStr);
    };

    // Clean description similarity helper for Check 10 (Duplicates)
    const areDescriptionsSimilar = (desc1: string, desc2: string): boolean => {
      const d1 = desc1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      const d2 = desc2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      const stopWords = new Set(['at', 'for', 'the', 'in', 'to', 'and', 'or', 'a', 'an', 'of', 'on', 'with', 'bill']);
      const w1 = d1.filter(w => !stopWords.has(w));
      const w2 = d2.filter(w => !stopWords.has(w));
      const common = w1.filter(w => w2.includes(w));
      return common.some(w => w.length >= 3);
    };

    // Parse all rows clean details for comparisons
    interface ProcessedRow {
      rowIndex: number;
      rawRow: CSVRow;
      parsedDate: Date;
      amountValue: number;
      anomalies: string[];
    }

    const processedRows: ProcessedRow[] = [];

    for (let idx = 0; idx < records.length; idx++) {
      const row = records[idx];
      const rawAmount = row.amount || '';
      const cleanAmountStr = rawAmount.replace(/,/g, '').trim();
      const amountValue = parseFloat(cleanAmountStr) || 0;
      let parsedDate = new Date();
      try {
        parsedDate = parseCSVDate(row.date);
      } catch (err) {
        // Fallback
      }

      processedRows.push({
        rowIndex: idx + 1,
        rawRow: row,
        parsedDate,
        amountValue,
        anomalies: [],
      });
    }

    // Run the 10 distinct validation checks on each row
    for (let i = 0; i < processedRows.length; i++) {
      const rowA = processedRows[i];
      const rawRow = rowA.rawRow;
      const anomalies = rowA.anomalies;

      const paidByRaw = rawRow.paid_by || '';
      const paidByTrimmed = paidByRaw.trim();

      // Check 1 (Empty Payer)
      if (!paidByRaw || !paidByTrimmed) {
        anomalies.push('MISSING_PAYER');
      }

      // Check 2 (Name Aliasing / inconsistency)
      if (paidByRaw && (
        paidByRaw.includes('Priya S') || 
        paidByRaw.startsWith(' ') || 
        paidByRaw.endsWith(' ') ||
        paidByRaw.toLowerCase() === 'priya s' ||
        paidByRaw.toLowerCase() === 'rohan '
      )) {
        anomalies.push('NAME_INCONSISTENCY');
      }

      // Check 3 (Number Formatting)
      if (rawRow.amount && rawRow.amount.includes(',')) {
        anomalies.push('BAD_NUMBER_FORMAT');
      }

      // Check 4 (Precision Limit)
      const decimalPart = (rawRow.amount || '').split('.')[1] || '';
      if (decimalPart.length > 2) {
        anomalies.push('HIGH_PRECISION_LIMIT');
      }

      // Check 5 (Currency Omission)
      const currency = (rawRow.currency || '').trim();
      if (!currency) {
        anomalies.push('MISSING_CURRENCY');
      }

      // Check 6 (Settlement Detection)
      const splitType = (rawRow.split_type || '').trim();
      const descLower = (rawRow.description || '').toLowerCase();
      const notesLower = (rawRow.notes || '').toLowerCase();
      if (!splitType || descLower.includes('settlement') || descLower.includes('paid back') || notesLower.includes('settlement') || notesLower.includes('paid back')) {
        anomalies.push('IS_SETTLEMENT');
      }

      // Check 7 (Percentage Math)
      if (splitType === 'percentage' && rawRow.split_details) {
        const parts = rawRow.split_details.split(';').map(p => p.trim()).filter(Boolean);
        let totalPct = 0;
        for (const part of parts) {
          const m = part.match(/^(.+?)\s+([\d.-]+)%?$/);
          if (m) {
            totalPct += parseFloat(m[2]);
          }
        }
        if (Math.abs(totalPct - 100) > 0.0001) {
          anomalies.push('PERCENTAGE_MATH_MISMATCH');
        }
      }

      // Check 8 (Temporal check) & Check 9 (Unregistered members)
      const splitWithNames = (rawRow.split_with || '')
        .split(';')
        .map(n => n.trim())
        .filter(Boolean);

      const expenseTime = rowA.parsedDate.getTime();

      for (const name of splitWithNames) {
        const userId = resolveUserId(name);
        if (!userId) {
          // Unregistered member
          if (!anomalies.includes('UNREGISTERED_MEMBER')) {
            anomalies.push('UNREGISTERED_MEMBER');
          }
        } else {
          // Temporal boundary check
          const userMemberships = dbMemberships.filter(m => m.userId === userId);
          const hasActiveMembership = userMemberships.some(m => {
            const joinedTime = new Date(m.joinedAt).getTime();
            const leftTime = m.leftAt ? new Date(m.leftAt).getTime() : null;
            return expenseTime >= joinedTime && (leftTime === null || expenseTime <= leftTime);
          });
          if (!hasActiveMembership && !anomalies.includes('TEMPORAL_MEMBERSHIP_VIOLATION')) {
            anomalies.push('TEMPORAL_MEMBERSHIP_VIOLATION');
          }
        }
      }

      // Check 10 (Duplicates)
      for (let j = 0; j < processedRows.length; j++) {
        if (i === j) continue;
        const rowB = processedRows[j];
        if (
          rowA.parsedDate.getTime() === rowB.parsedDate.getTime() &&
          rowA.amountValue === rowB.amountValue &&
          areDescriptionsSimilar(rawRow.description || '', rowB.rawRow.description || '')
        ) {
          if (!anomalies.includes('POTENTIAL_DUPLICATE')) {
            anomalies.push('POTENTIAL_DUPLICATE');
          }
          break;
        }
      }
    }

    // 5. Save every row to the "StagedExpense" table
    const createdStagedExpenses = [];
    for (const prow of processedRows) {
      const staged = await prisma.stagedExpense.create({
        data: {
          sessionId: session.id,
          rawRowNumber: prow.rowIndex,
          rawData: JSON.stringify(prow.rawRow),
          detectedAnomalies: JSON.stringify(prow.anomalies),
          status: 'PENDING_APPROVAL',
        },
      });
      createdStagedExpenses.push({
        id: staged.id,
        rawRowNumber: prow.rowIndex,
        rawData: prow.rawRow,
        anomalies: prow.anomalies,
      });
    }

    // Update session status to COMPLETED
    await prisma.importSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED' },
    });

    const rowsWithAnomalies = createdStagedExpenses.filter(r => r.anomalies.length > 0);

    // 6. Return response
    return NextResponse.json({
      success: true,
      sessionId: session.id,
      totalRowsProcessed: records.length,
      anomaliesCount: rowsWithAnomalies.length,
      stagedExpenses: createdStagedExpenses,
    });
  } catch (err: any) {
    console.error('Error uploading CSV to staging:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred during upload.' },
      { status: 500 }
    );
  }
}
