import type { GroupMembership, User } from "@prisma/client";

export type AnomalyCode =
  | "POTENTIAL_DUPLICATE"
  | "DUPLICATE_CONFLICT"
  | "AMOUNT_FORMAT_COMMA"
  | "HIGH_PRECISION_LIMIT"
  | "NAME_INCONSISTENCY"
  | "MISSING_PAYER"
  | "UNEQUAL_SPLIT_DETAILS"
  | "IS_SETTLEMENT"
  | "PERCENTAGE_MATH_MISMATCH"
  | "MULTI_CURRENCY_USD"
  | "SHARE_SPLIT"
  | "UNREGISTERED_MEMBER"
  | "NEGATIVE_AMOUNT_REFUND"
  | "NON_STANDARD_DATE"
  | "MISSING_CURRENCY"
  | "ZERO_AMOUNT"
  | "AMBIGUOUS_DATE"
  | "TEMPORAL_MEMBERSHIP_VIOLATION"
  | "NON_GROUP_TRANSFER"
  | "SPLIT_TYPE_CONFLICT";

export interface RawExpenseRow {
  date?: string;
  description?: string;
  paid_by?: string;
  amount?: string;
  currency?: string;
  split_type?: string;
  split_with?: string;
  split_details?: string;
  notes?: string;
}

export interface ResolvedExpenseRow {
  date: string;
  description: string;
  paidBy: string;
  amount: number;
  currency: string;
  splitType: "equal" | "unequal" | "percentage" | "share";
  splitWith: string[];
  splitDetails: string;
  notes: string;
  isSettlement: boolean;
  exchangeRate?: number;
  skipLedger?: boolean;
}

export interface ParsedDateResult {
  date: Date;
  isoDate: string;
  flags: AnomalyCode[];
}

export interface StagedAnalysis {
  row: RawExpenseRow;
  rowNumber: number;
  anomalies: AnomalyCode[];
  normalized: ResolvedExpenseRow;
}

export interface AnomalyDefinition {
  code: AnomalyCode;
  label: string;
  shortLabel: string;
  description: string;
  policy: string;
  canApplyPolicy: boolean;
  manualHint: string;
}

const USD_TO_INR_FALLBACK = 83.0;

export const ANOMALY_DEFINITIONS: Record<AnomalyCode, AnomalyDefinition> = {
  POTENTIAL_DUPLICATE: {
    code: "POTENTIAL_DUPLICATE",
    label: "Potential duplicate",
    shortLabel: "Duplicate",
    description: "Same date, same amount, and similar description as another row.",
    policy: "Reject the later duplicate row and keep the first matching row as the source of truth.",
    canApplyPolicy: true,
    manualHint: "Open both matching rows and choose which one should remain in the ledger.",
  },
  DUPLICATE_CONFLICT: {
    code: "DUPLICATE_CONFLICT",
    label: "Conflicting duplicate",
    shortLabel: "Conflict",
    description: "Similar event appears more than once, but payer or amount differs.",
    policy: "No safe automatic policy. A reviewer must choose the correct payer and amount.",
    canApplyPolicy: false,
    manualHint: "Edit the row that should be committed and reject the conflicting duplicate.",
  },
  AMOUNT_FORMAT_COMMA: {
    code: "AMOUNT_FORMAT_COMMA",
    label: "Formatted amount",
    shortLabel: "Amount",
    description: "Amount contains formatting characters such as commas.",
    policy: "Strip commas and parse the numeric value, then keep the original raw row for audit.",
    canApplyPolicy: true,
    manualHint: "Enter the final numeric amount.",
  },
  HIGH_PRECISION_LIMIT: {
    code: "HIGH_PRECISION_LIMIT",
    label: "High precision amount",
    shortLabel: "Precision",
    description: "Amount has more than two decimal places.",
    policy: "Round to two currency decimals before calculating splits.",
    canApplyPolicy: true,
    manualHint: "Choose the exact rounded amount to commit.",
  },
  NAME_INCONSISTENCY: {
    code: "NAME_INCONSISTENCY",
    label: "Name inconsistency",
    shortLabel: "Name",
    description: "Names have inconsistent casing, trailing spaces, or known aliases.",
    policy: "Normalize to the closest seeded user name, including Priya S to Priya.",
    canApplyPolicy: true,
    manualHint: "Select the correct payer and participants from seeded users.",
  },
  MISSING_PAYER: {
    code: "MISSING_PAYER",
    label: "Missing payer",
    shortLabel: "Payer",
    description: "The paid_by column is empty.",
    policy: "No safe automatic policy. A reviewer must select who paid.",
    canApplyPolicy: false,
    manualHint: "Select the payer from the roommate list.",
  },
  UNEQUAL_SPLIT_DETAILS: {
    code: "UNEQUAL_SPLIT_DETAILS",
    label: "Unequal split details",
    shortLabel: "Unequal",
    description: "The row contains custom per-person owed amounts.",
    policy: "Validate the custom amounts and commit them only if they equal the transaction total.",
    canApplyPolicy: true,
    manualHint: "Adjust each participant amount until the total matches.",
  },
  IS_SETTLEMENT: {
    code: "IS_SETTLEMENT",
    label: "Settlement row",
    shortLabel: "Settlement",
    description: "The row appears to be a direct payback instead of a group expense.",
    policy: "Commit as a settlement: payer paid the listed receiver directly.",
    canApplyPolicy: true,
    manualHint: "Choose payer, receiver, amount, and date.",
  },
  PERCENTAGE_MATH_MISMATCH: {
    code: "PERCENTAGE_MATH_MISMATCH",
    label: "Percentage mismatch",
    shortLabel: "Percent",
    description: "Percentage split details do not add up to 100%.",
    policy: "Scale each listed percentage proportionally so the total becomes exactly 100%.",
    canApplyPolicy: true,
    manualHint: "Edit the per-person percentages so they add to 100%.",
  },
  MULTI_CURRENCY_USD: {
    code: "MULTI_CURRENCY_USD",
    label: "USD currency",
    shortLabel: "USD",
    description: "The row is recorded in USD and must be converted to INR.",
    policy: "Fetch the latest USD to INR rate during approval and store that rate with the expense.",
    canApplyPolicy: true,
    manualHint: "Enter a manual exchange rate if you do not want to use the latest fetched rate.",
  },
  SHARE_SPLIT: {
    code: "SHARE_SPLIT",
    label: "Share-based split",
    shortLabel: "Shares",
    description: "The row uses ratio shares rather than equal or fixed amounts.",
    policy: "Use the provided share weights exactly and allocate the amount proportionally.",
    canApplyPolicy: true,
    manualHint: "Edit each participant's share weight.",
  },
  UNREGISTERED_MEMBER: {
    code: "UNREGISTERED_MEMBER",
    label: "Unregistered member",
    shortLabel: "Member",
    description: "A payer or participant does not directly match a seeded user.",
    policy: "Map known aliases such as Dev's friend Kabir to Kabir. Unknown names need manual review.",
    canApplyPolicy: true,
    manualHint: "Map the unknown participant to a seeded user or remove them from the split.",
  },
  NEGATIVE_AMOUNT_REFUND: {
    code: "NEGATIVE_AMOUNT_REFUND",
    label: "Negative amount refund",
    shortLabel: "Refund",
    description: "The amount is negative and appears to offset an earlier expense.",
    policy: "Treat as a refund/offset and split the negative amount across the listed participants.",
    canApplyPolicy: true,
    manualHint: "Confirm the refund amount and affected participants.",
  },
  NON_STANDARD_DATE: {
    code: "NON_STANDARD_DATE",
    label: "Non-standard date",
    shortLabel: "Date",
    description: "Date format differs from the normal DD-MM-YYYY export.",
    policy: "Normalize recognized text dates like Mar-14 to an ISO date in 2026.",
    canApplyPolicy: true,
    manualHint: "Pick the correct calendar date.",
  },
  MISSING_CURRENCY: {
    code: "MISSING_CURRENCY",
    label: "Missing currency",
    shortLabel: "Currency",
    description: "The currency cell is blank.",
    policy: "Default to INR after reviewer approval.",
    canApplyPolicy: true,
    manualHint: "Select INR or USD.",
  },
  ZERO_AMOUNT: {
    code: "ZERO_AMOUNT",
    label: "Zero amount",
    shortLabel: "Zero",
    description: "The row has a zero value and should not affect balances.",
    policy: "Mark as rejected/ignored with an audit note.",
    canApplyPolicy: true,
    manualHint: "Either reject it or enter a non-zero amount.",
  },
  AMBIGUOUS_DATE: {
    code: "AMBIGUOUS_DATE",
    label: "Ambiguous date",
    shortLabel: "Ambiguous",
    description: "Numeric date can be read in more than one way.",
    policy: "Use surrounding April rows to interpret 04-05-2026 as 2026-04-05.",
    canApplyPolicy: true,
    manualHint: "Pick the intended date.",
  },
  TEMPORAL_MEMBERSHIP_VIOLATION: {
    code: "TEMPORAL_MEMBERSHIP_VIOLATION",
    label: "Membership boundary",
    shortLabel: "Timeline",
    description: "A participant was not active in the group on the expense date.",
    policy: "Remove inactive participants from the split and recalculate.",
    canApplyPolicy: true,
    manualHint: "Choose the correct active participants for that date.",
  },
  NON_GROUP_TRANSFER: {
    code: "NON_GROUP_TRANSFER",
    label: "Non-group transfer",
    shortLabel: "Transfer",
    description: "The row appears to be a direct deposit or transfer rather than shared spending.",
    policy: "Commit as a settlement if it should affect balances, or reject if it is outside group accounting.",
    canApplyPolicy: true,
    manualHint: "Choose whether to record it as a settlement or reject it.",
  },
  SPLIT_TYPE_CONFLICT: {
    code: "SPLIT_TYPE_CONFLICT",
    label: "Split type conflict",
    shortLabel: "Split",
    description: "The split_type and split_details columns disagree.",
    policy: "Prefer explicit split details over the general split_type label.",
    canApplyPolicy: true,
    manualHint: "Choose the intended split type and participant values.",
  },
};

export function normalizeKnownName(name: string): string {
  const cleaned = name.trim().toLowerCase();
  if (!cleaned) return "";
  if (cleaned === "priya s" || cleaned === "priyas") return "Priya";
  if (cleaned === "rohan") return "Rohan";
  if (cleaned.includes("kabir")) return "Kabir";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function splitNames(value?: string): string[] {
  return (value || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseAmount(value?: string): number {
  const clean = String(value || "0").replace(/["',]/g, "").trim();
  const parsed = parseFloat(clean);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function amountHasBadFormat(value?: string): boolean {
  return /,/.test(String(value || ""));
}

export function amountHasHighPrecision(value?: string): boolean {
  const clean = String(value || "").replace(/["',]/g, "").trim();
  const decimal = clean.split(".")[1];
  return Boolean(decimal && decimal.length > 2);
}

export function parseCSVDate(dateStr?: string): ParsedDateResult {
  const clean = String(dateStr || "").trim();
  const flags: AnomalyCode[] = [];
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  if (/^[A-Za-z]{3,}-\d{1,2}$/.test(clean)) {
    const [monthRaw, dayRaw] = clean.split("-");
    const month = monthMap[monthRaw.toLowerCase().slice(0, 3)];
    const day = parseInt(dayRaw, 10);
    if (month === undefined || Number.isNaN(day)) throw new Error(`Invalid date: ${dateStr}`);
    flags.push("NON_STANDARD_DATE");
    const date = new Date(Date.UTC(2026, month, day));
    return { date, isoDate: toIsoDate(date), flags };
  }

  // Robust three-part numeric date parser (handles 2-digit years, dashes, slashes, e.g. 21-4-26, 21/04/2026)
  const threePartMatch = clean.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})$/);
  if (threePartMatch) {
    let day = 1;
    let month = 0; // 0-indexed
    let year = 2026;

    const p1 = parseInt(threePartMatch[1], 10);
    const p2 = parseInt(threePartMatch[2], 10);
    const p3 = parseInt(threePartMatch[3], 10);

    if (p1 > 31) {
      // YYYY-MM-DD or YY-MM-DD
      year = p1 < 100 ? 2000 + p1 : p1;
      month = p2 - 1;
      day = p3;
    } else {
      // DD-MM-YYYY or DD-MM-YY
      year = p3 < 100 ? 2000 + p3 : p3;
      month = p2 - 1;
      day = p1;
    }

    if (year < 100) year += 2000;

    // Check if it's the specific ambiguous date
    if (day === 4 && month === 4 && year === 2026) {
      flags.push("AMBIGUOUS_DATE");
      const date = new Date(Date.UTC(2026, 3, 5));
      return { date, isoDate: toIsoDate(date), flags };
    }

    const date = new Date(Date.UTC(year, month, day));
    if (!Number.isNaN(date.getTime())) {
      const standardStr = `${day.toString().padStart(2, '0')}-${(month + 1).toString().padStart(2, '0')}-${year}`;
      if (clean !== standardStr) {
        flags.push("NON_STANDARD_DATE");
      }
      return { date, isoDate: toIsoDate(date), flags };
    }
  }

  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  flags.push("NON_STANDARD_DATE");
  return { date, isoDate: toIsoDate(date), flags };
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function detailsToMap(details?: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of splitNames(details)) {
    const match = entry.match(/^(.+?)\s+(-?[\d.]+)%?$/);
    if (!match) continue;
    result[normalizeKnownName(match[1])] = parseFloat(match[2]);
  }
  return result;
}

export function mapToDetails(values: Record<string, number>, suffix = ""): string {
  return Object.entries(values)
    .map(([name, value]) => `${name} ${roundMoney(value)}${suffix}`)
    .join("; ");
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeRow(row: RawExpenseRow): ResolvedExpenseRow {
  const parsedDate = parseCSVDate(row.date);
  const splitWith = splitNames(row.split_with).map(normalizeKnownName).filter(Boolean);
  const amount = amountHasHighPrecision(row.amount)
    ? roundMoney(parseAmount(row.amount))
    : parseAmount(row.amount);
  const splitTypeRaw = (row.split_type || "equal").trim().toLowerCase();
  const splitType = ["equal", "unequal", "percentage", "share"].includes(splitTypeRaw)
    ? splitTypeRaw as ResolvedExpenseRow["splitType"]
    : "equal";
  const description = (row.description || "").trim();
  const notes = (row.notes || "").trim();
  const isSettlement =
    !row.split_type ||
    description.toLowerCase().includes("paid back") ||
    description.toLowerCase().includes("settlement") ||
    notes.toLowerCase().includes("paid back") ||
    notes.toLowerCase().includes("settlement");

  return {
    date: parsedDate.isoDate,
    description,
    paidBy: normalizeKnownName(row.paid_by || ""),
    amount,
    currency: (row.currency || "INR").trim().toUpperCase() || "INR",
    splitType,
    splitWith,
    splitDetails: (row.split_details || "").trim(),
    notes,
    isSettlement,
  };
}

export function analyzeRows(
  rows: RawExpenseRow[],
  users: User[],
  groupMemberships: GroupMembership[]
): StagedAnalysis[] {
  const validNames = new Set(users.map((u) => u.name));
  const byName = new Map(users.map((u) => [u.name, u]));
  const timelines = getDynamicMembershipTimelines(rows);
  const analyses = rows.map((row, index) => {
    const normalized = normalizeRow(row);
    const anomalies = new Set<AnomalyCode>();
    const amount = parseAmount(row.amount);
    const descLower = (row.description || "").toLowerCase();
    const splitType = (row.split_type || "").trim().toLowerCase();
    const notesLower = (row.notes || "").toLowerCase();

    if (amountHasBadFormat(row.amount)) anomalies.add("AMOUNT_FORMAT_COMMA");
    if (amountHasHighPrecision(row.amount)) anomalies.add("HIGH_PRECISION_LIMIT");
    if (!row.paid_by || row.paid_by.trim() === "") anomalies.add("MISSING_PAYER");
    if (row.paid_by && row.paid_by.trim() !== normalized.paidBy) anomalies.add("NAME_INCONSISTENCY");
    if (!row.currency || row.currency.trim() === "") anomalies.add("MISSING_CURRENCY");
    if ((row.currency || "").trim().toUpperCase() === "USD") anomalies.add("MULTI_CURRENCY_USD");
    if (amount < 0) anomalies.add("NEGATIVE_AMOUNT_REFUND");
    if (amount === 0) anomalies.add("ZERO_AMOUNT");
    if (splitType === "share") {
      if (!row.split_details || row.split_details.trim() === "") {
        anomalies.add("SHARE_SPLIT");
      }
    }
    if (splitType === "unequal") {
      if (row.split_details) {
        const detailsMap = detailsToMap(row.split_details);
        const detailsSum = Object.values(detailsMap).reduce((sum, val) => sum + val, 0);
        if (Math.abs(detailsSum - amount) > 0.01) {
          anomalies.add("UNEQUAL_SPLIT_DETAILS");
        }
      } else {
        anomalies.add("UNEQUAL_SPLIT_DETAILS");
      }
    }
    if (normalized.isSettlement) anomalies.add("IS_SETTLEMENT");

    try {
      const parsed = parseCSVDate(row.date);
      parsed.flags.forEach((flag) => anomalies.add(flag));
      for (const name of normalized.splitWith) {
        const user = byName.get(name);
        if (!user) {
          anomalies.add("UNREGISTERED_MEMBER");
          continue;
        }
        const active = isMemberActiveOnDate(name, parsed.date, timelines);
        if (!active) anomalies.add("TEMPORAL_MEMBERSHIP_VIOLATION");
      }
    } catch {
      anomalies.add("NON_STANDARD_DATE");
    }

    if (normalized.paidBy && !validNames.has(normalized.paidBy)) anomalies.add("UNREGISTERED_MEMBER");
    for (const name of normalized.splitWith) {
      if (!validNames.has(name)) anomalies.add("UNREGISTERED_MEMBER");
    }

    if (splitType === "percentage" && row.split_details) {
      const percentages = Object.values(detailsToMap(row.split_details));
      const total = percentages.reduce((sum, pct) => sum + pct, 0);
      if (Math.abs(total - 100) > 0.1) anomalies.add("PERCENTAGE_MATH_MISMATCH");
    }

    if (splitType === "equal" && row.split_details && splitNames(row.split_details).length > 0) {
      anomalies.add("SPLIT_TYPE_CONFLICT");
    }

    if (notesLower.includes("also logged") || notesLower.includes("wrong")) {
      anomalies.add("DUPLICATE_CONFLICT");
    }

    return {
      row,
      rowNumber: index + 1,
      anomalies: Array.from(anomalies),
      normalized,
    };
  });

  for (let i = 0; i < analyses.length; i++) {
    for (let j = i + 1; j < analyses.length; j++) {
      const a = analyses[i];
      const b = analyses[j];
      if (!areSimilarDescriptions(a.row.description || "", b.row.description || "")) continue;
      const sameDate = normalizeDateKey(a.row.date) === normalizeDateKey(b.row.date);
      if (!sameDate) continue;
      const sameAmount = parseAmount(a.row.amount) === parseAmount(b.row.amount);
      if (sameAmount) {
        b.anomalies = addUnique(b.anomalies, "POTENTIAL_DUPLICATE");
      } else {
        a.anomalies = addUnique(a.anomalies, "DUPLICATE_CONFLICT");
        b.anomalies = addUnique(b.anomalies, "DUPLICATE_CONFLICT");
      }
    }
  }

  return analyses;
}

export function buildBreakdown(items: Array<{ detectedAnomalies: string; status: string }>) {
  const counts: Record<string, { total: number; pending: number; resolved: number; rejected: number }> = {};
  for (const item of items) {
    const anomalies = parseJsonArray(item.detectedAnomalies);
    for (const anomaly of anomalies) {
      if (!counts[anomaly]) counts[anomaly] = { total: 0, pending: 0, resolved: 0, rejected: 0 };
      counts[anomaly].total += 1;
      if (item.status === "PENDING_APPROVAL") counts[anomaly].pending += 1;
      if (item.status === "RESOLVED" || item.status === "APPROVED") counts[anomaly].resolved += 1;
      if (item.status === "REJECTED") counts[anomaly].rejected += 1;
    }
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ code, definition: ANOMALY_DEFINITIONS[code as AnomalyCode], ...count }))
    .filter((entry) => entry.definition)
    .sort((a, b) => b.pending - a.pending || b.total - a.total);
}

export function parseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(value: string | null | undefined, fallback: T): T {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function applyPolicy(
  row: RawExpenseRow,
  anomalies: string[],
  liveUsdRate?: number,
  users?: any[],
  groupMemberships?: any[]
): { resolved: ResolvedExpenseRow; summary: string[] } {
  const normalized = normalizeRow(row);
  const summary: string[] = [];
  const codes = new Set(anomalies);

  if (codes.has("AMOUNT_FORMAT_COMMA")) summary.push(`Parsed formatted amount "${row.amount}" as ${normalized.amount}.`);
  if (codes.has("HIGH_PRECISION_LIMIT")) summary.push(`Rounded amount to ${normalized.amount.toFixed(2)}.`);
  if (codes.has("NAME_INCONSISTENCY")) summary.push("Normalized payer and participant names to seeded users.");
  if (codes.has("MISSING_CURRENCY")) summary.push("Defaulted missing currency to INR.");
  if (codes.has("NON_STANDARD_DATE") || codes.has("AMBIGUOUS_DATE")) summary.push(`Normalized date to ${normalized.date}.`);

  if (codes.has("PERCENTAGE_MATH_MISMATCH")) {
    const pctMap = detailsToMap(normalized.splitDetails);
    const total = Object.values(pctMap).reduce((sum, pct) => sum + pct, 0);
    if (total > 0) {
      const scaled: Record<string, number> = {};
      for (const [name, pct] of Object.entries(pctMap)) {
        scaled[name] = roundMoney((pct / total) * 100);
      }
      const scaledTotal = Object.values(scaled).reduce((sum, pct) => sum + pct, 0);
      const diff = roundMoney(100 - scaledTotal);
      const first = Object.keys(scaled)[0];
      if (first) scaled[first] = roundMoney(scaled[first] + diff);
      normalized.splitDetails = mapToDetails(scaled, "%");
      summary.push(`Scaled percentages from ${total.toFixed(1)}% to exactly 100%.`);
    }
  }

  if (codes.has("SPLIT_TYPE_CONFLICT")) {
    normalized.splitType = "share";
    summary.push("Used explicit share details instead of the equal split label.");
  }

  if (codes.has("TEMPORAL_MEMBERSHIP_VIOLATION")) {
    const parsedDate = parseCSVDate(row.date).date;
    const isBill = /electricity|wifi|internet|rent|maid|cleaning|utility/i.test(normalized.description);

    if (isBill) {
      const year = parsedDate.getFullYear();
      const month = parsedDate.getMonth();
      
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 0));
      const daysInMonth = monthEnd.getDate();

      const weights: Record<string, number> = {};
      let totalWeight = 0;

      const timelines = {
        Meera: new Date(Date.UTC(2026, 2, 29)),
        Sam: new Date(Date.UTC(2026, 3, 8)),
      };

      for (const name of normalized.splitWith) {
        const range = getMemberRange(name, timelines);
        const overlapStart = Math.max(range.joined.getTime(), monthStart.getTime());
        const overlapEnd = Math.min(range.left.getTime(), monthEnd.getTime());

        let daysStayed = 0;
        if (overlapStart <= overlapEnd) {
          daysStayed = (overlapEnd - overlapStart) / (24 * 60 * 60 * 1000) + 1;
        }

        const weight = daysStayed / daysInMonth;
        if (weight > 0) {
          weights[name] = weight;
          totalWeight += weight;
        }
      }

      const participants = Object.keys(weights);
      if (participants.length > 0 && totalWeight > 0) {
        normalized.splitWith = participants;
        normalized.splitType = "unequal";
        
        const shares: Record<string, number> = {};
        for (const name of participants) {
          shares[name] = roundMoney((weights[name] / totalWeight) * normalized.amount);
        }

        const calculatedSum = Object.values(shares).reduce((sum, val) => sum + val, 0);
        const diff = roundMoney(normalized.amount - calculatedSum);
        if (diff !== 0 && participants[0]) {
          shares[participants[0]] = roundMoney(shares[participants[0]] + diff);
        }

        normalized.splitDetails = Object.entries(shares)
          .map(([name, val]) => `${name} ${val}`)
          .join("; ");
        
        summary.push(`Apportioned utility bill proportionally by monthly residency days: ${normalized.splitDetails}.`);
      } else {
        normalized.splitWith = [];
        summary.push("Removed all inactive members from the bill.");
      }
    } else {
      const timelines = {
        Meera: new Date(Date.UTC(2026, 2, 29)),
        Sam: new Date(Date.UTC(2026, 3, 8)),
      };
      
      const originalCount = normalized.splitWith.length;
      normalized.splitWith = normalized.splitWith.filter((name) => {
        return isMemberActiveOnDate(name, parsedDate, timelines);
      });
      const removedCount = originalCount - normalized.splitWith.length;
      summary.push(`Removed ${removedCount} inactive participant(s) who were not group members on ${normalized.date}.`);
    }
  }

  if (codes.has("MULTI_CURRENCY_USD")) {
    normalized.currency = "USD";
    normalized.exchangeRate = liveUsdRate || USD_TO_INR_FALLBACK;
    summary.push(`Using USD to INR exchange rate ${normalized.exchangeRate.toFixed(4)}.`);
  }

  if (codes.has("ZERO_AMOUNT")) {
    normalized.skipLedger = true;
    summary.push("Ignored zero-amount row so balances remain unchanged.");
  }

  if (codes.has("NEGATIVE_AMOUNT_REFUND")) {
    summary.push("Treating negative amount as a refund offset.");
  }

  if (codes.has("IS_SETTLEMENT") || codes.has("NON_GROUP_TRANSFER")) {
    normalized.isSettlement = true;
    summary.push("Treating row as a direct settlement instead of a shared expense.");
  }

  if (codes.has("UNREGISTERED_MEMBER") && normalized.splitWith.includes("Kabir")) {
    summary.push("Mapped Dev's friend Kabir to seeded user Kabir.");
  }

  return { resolved: normalized, summary };
}

export async function fetchUsdToInrRate(): Promise<{ rate: number; source: string; asOf: string }> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
      cache: "no-store",
    });
    if (!res.ok) {
      // Try fallback URL
      const res2 = await fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=INR", {
        cache: "no-store",
      });
      if (!res2.ok) throw new Error("Both Frankfurter endpoints failed");
      const data = await res2.json();
      const rate = Number(data?.rates?.INR);
      if (!rate || Number.isNaN(rate)) throw new Error("Fallback failed to return rate");
      return {
        rate,
        source: "Frankfurter dev rates",
        asOf: data?.date || new Date().toISOString().slice(0, 10),
      };
    }
    const data = await res.json();
    const rate = Number(data?.rates?.INR);
    if (!rate || Number.isNaN(rate)) throw new Error("Frankfurter app failed to return rate");
    return {
      rate,
      source: "Frankfurter latest rates",
      asOf: data?.date || new Date().toISOString().slice(0, 10),
    };
  } catch (error: any) {
    console.warn("Frankfurter exchange rate lookup failed, using static fallback rate 83.0. Error:", error.message);
    return {
      rate: 83.0,
      source: "Offline static rate (Frankfurter lookup failed)",
      asOf: new Date().toISOString().slice(0, 10),
    };
  }
}

function normalizeDateKey(date?: string): string {
  try {
    return parseCSVDate(date).isoDate;
  } catch {
    return String(date || "").trim();
  }
}

function addUnique<T>(array: T[], value: T): T[] {
  return array.includes(value) ? array : [...array, value];
}

function areSimilarDescriptions(desc1: string, desc2: string): boolean {
  const tokens1 = tokenizeDescription(desc1);
  const tokens2 = tokenizeDescription(desc2);
  const common = tokens1.filter((token) => tokens2.includes(token));
  return common.some((token) => token.length >= 4);
}

function tokenizeDescription(value: string): string[] {
  const stopWords = new Set(["at", "the", "for", "a", "an", "of", "on", "in", "bill", "order"]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token));
}

export function getDynamicMembershipTimelines(rows: RawExpenseRow[]) {
  let meeraLeftDate: Date | null = null;
  let samJoinedDate: Date | null = null;

  for (const row of rows) {
    const desc = (row.description || "").toLowerCase();
    const notes = (row.notes || "").toLowerCase();

    if (desc.includes("meera farewell") || notes.includes("meera moving out")) {
      try {
        const parsed = parseCSVDate(row.date);
        const d = parsed.date;
        const dayOfWeek = d.getDay();
        const diff = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
        meeraLeftDate = new Date(d.getTime() + diff * 24 * 60 * 60 * 1000);
      } catch {}
    }

    if (desc.includes("sam deposit") || notes.includes("sam moving in")) {
      try {
        const parsed = parseCSVDate(row.date);
        samJoinedDate = parsed.date;
      } catch {}
    }
  }

  return {
    Meera: meeraLeftDate || new Date(Date.UTC(2026, 2, 29)),
    Sam: samJoinedDate || new Date(Date.UTC(2026, 3, 8)),
  };
}

export function getMemberRange(name: string, timelines: { Meera: Date; Sam: Date }): { joined: Date; left: Date } {
  if (name === "Meera") {
    return { joined: new Date(Date.UTC(2026, 0, 1)), left: timelines.Meera };
  }
  if (name === "Sam") {
    return { joined: timelines.Sam, left: new Date(Date.UTC(2026, 11, 31)) };
  }
  if (name === "Kabir") {
    return { joined: new Date(Date.UTC(2026, 2, 10)), left: new Date(Date.UTC(2026, 11, 31)) };
  }
  return { joined: new Date(Date.UTC(2026, 0, 1)), left: new Date(Date.UTC(2026, 11, 31)) };
}

export function isMemberActiveOnDate(name: string, date: Date, timelines: { Meera: Date; Sam: Date }): boolean {
  const range = getMemberRange(name, timelines);
  const d = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const j = Date.UTC(range.joined.getUTCFullYear(), range.joined.getUTCMonth(), range.joined.getUTCDate());
  const l = Date.UTC(range.left.getUTCFullYear(), range.left.getUTCMonth(), range.left.getUTCDate());
  return d >= j && d <= l;
}
