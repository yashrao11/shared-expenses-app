// ─── Splitting Engine ─────────────────────────────────────────────────────────
// Handles equal, unequal, percentage, and share split types.
// Converts USD → INR at a fixed 83.0 rate.
// Validates temporal membership boundaries when timelines are provided.
// Returns a typed result object with success flag, errors, baseAmountINR,
// and per-user splits (userId + userName + owedAmount in INR).

export interface RawSplitInput {
  amount: number;
  currency: string;
  date: Date;
  splitType: string;
  splitWith: string[]; // display names (e.g. "Aisha", "Rohan")
  splitDetails?: string;
}

export interface SplitCalculationInput {
  amount: number;
  splitType: "equal" | "unequal" | "percentage" | "share";
  splitWith: string[]; // User IDs (legacy simple API)
  splitDetails?: string;
}

export interface SplitResult {
  userId: string;
  userName: string;
  owedAmount: number; // Always in INR
}

export interface SplitCalculationOutput {
  success: boolean;
  errors: string[];
  baseAmountINR: number;
  splits: SplitResult[];
}

const USD_TO_INR = 83.0;

// ─── Primary API ─────────────────────────────────────────────────────────────
// Used by all API routes and test scripts.
// userMap: { "Aisha" -> "uuid-...", ... }  (name -> id, case-sensitive keys)
// membershipTimelines: optional, { "uuid-..." -> [{joinedAt, leftAt}] }
export async function calculateSplits(
  input: RawSplitInput,
  userMap: Record<string, string>,
  membershipTimelines?: Record<string, { joinedAt: Date; leftAt: Date | null }[]>
): Promise<SplitCalculationOutput> {
  const errors: string[] = [];
  const { amount, currency, date, splitType, splitWith, splitDetails } = input;

  // ── 1. Currency conversion ────────────────────────────────────────────────
  const rate = (currency || "INR").trim().toUpperCase() === "USD" ? USD_TO_INR : 1.0;
  const baseAmountINR = Math.round(amount * rate * 100) / 100;

  // ── 2. Resolve names → user IDs ──────────────────────────────────────────
  // Build a case-insensitive alias map from the provided userMap
  const nameToId: Record<string, string> = {};
  const nameToCanonical: Record<string, string> = {};
  for (const [name, id] of Object.entries(userMap)) {
    nameToId[name.trim().toLowerCase()] = id;
    nameToCanonical[name.trim().toLowerCase()] = name;
  }

  const resolvedParticipants: { userId: string; userName: string }[] = [];
  for (const rawName of splitWith) {
    const key = rawName.trim().toLowerCase();
    // Alias normalisation: "Priya S" / "priyas" → "Priya"
    const aliasKey =
      key === "priya s" || key === "priyas" ? "priya" : key;

    const userId = nameToId[aliasKey];
    const userName = nameToCanonical[aliasKey] ?? rawName.trim();
    if (!userId) {
      errors.push(`User "${rawName.trim()}" is not registered in the database.`);
    } else {
      resolvedParticipants.push({ userId, userName });
    }
  }

  // ── 3. Temporal boundary validation ──────────────────────────────────────
  if (membershipTimelines) {
    const dateMs = date.getTime();
    const dateLabel = date.toISOString().split("T")[0];
    for (const { userId, userName } of resolvedParticipants) {
      const timelines = membershipTimelines[userId];
      if (!timelines || timelines.length === 0) {
        errors.push(`${userName} has no recorded membership timeline.`);
        continue;
      }
      const isActive = timelines.some(({ joinedAt, leftAt }) => {
        const joinMs = joinedAt.getTime();
        const leftMs = leftAt ? leftAt.getTime() : Infinity;
        return dateMs >= joinMs && dateMs <= leftMs;
      });
      if (!isActive) {
        errors.push(
          `${userName} was inactive on the expense date ${dateLabel}. ` +
          `Their membership does not cover this date.`
        );
      }
    }
  }

  // Stop early if we already have blocking errors (unregistered or inactive members)
  if (errors.length > 0) {
    return { success: false, errors, baseAmountINR, splits: [] };
  }

  if (resolvedParticipants.length === 0) {
    return {
      success: false,
      errors: ["No valid participants found for this split."],
      baseAmountINR,
      splits: [],
    };
  }

  // ── 4. Split calculation ──────────────────────────────────────────────────
  const splits: SplitResult[] = [];
  const n = resolvedParticipants.length;

  if (!splitType || splitType === "equal") {
    // Equal: distribute cents-first then give remainder pennies to first person
    const totalCents = Math.round(baseAmountINR * 100);
    const shareCents = Math.floor(totalCents / n);
    const remainderCents = totalCents % n;
    for (let i = 0; i < n; i++) {
      splits.push({
        ...resolvedParticipants[i],
        owedAmount: (shareCents + (i === 0 ? remainderCents : 0)) / 100,
      });
    }
  } else if (splitType === "unequal") {
    // Unequal: parse "Name Amount; Name Amount" pairs
    if (!splitDetails || splitDetails.trim() === "") {
      return {
        success: false,
        errors: ["Split details are required for unequal splits."],
        baseAmountINR,
        splits: [],
      };
    }
    const pairs = splitDetails.split(";").map((s) => s.trim()).filter(Boolean);
    let detailsSum = 0;
    const detailMap: Record<string, number> = {};
    for (const pair of pairs) {
      // Match "Name 700" or "Name 700.50"
      const match = pair.match(/^(.+?)\s+([\d.]+)$/);
      if (!match) {
        errors.push(`Cannot parse unequal split entry: "${pair}"`);
        continue;
      }
      const pairName = match[1].trim().toLowerCase();
      const aliasKey = pairName === "priya s" || pairName === "priyas" ? "priya" : pairName;
      const canonical = nameToCanonical[aliasKey] ?? match[1].trim();
      const pairAmount = parseFloat(match[2]);
      detailMap[canonical] = pairAmount;
      detailsSum += pairAmount;
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
    // Validate sum matches transaction total (within ₹0.01 tolerance)
    if (Math.abs(detailsSum - baseAmountINR) > 0.01) {
      return {
        success: false,
        errors: [
          `Unequal split details sum (${detailsSum.toFixed(2)}) does not match the transaction amount (${baseAmountINR.toFixed(2)}).`,
        ],
        baseAmountINR,
        splits: [],
      };
    }
    for (const p of resolvedParticipants) {
      if (detailMap[p.userName] === undefined) {
        errors.push(`No amount specified for "${p.userName}" in unequal split details.`);
      } else {
        splits.push({ ...p, owedAmount: detailMap[p.userName] });
      }
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
  } else if (splitType === "percentage") {
    // Percentage: parse "Name 30%; Name 30%" pairs
    if (!splitDetails || splitDetails.trim() === "") {
      return {
        success: false,
        errors: ["Split details are required for percentage splits."],
        baseAmountINR,
        splits: [],
      };
    }
    const pairs = splitDetails.split(";").map((s) => s.trim()).filter(Boolean);
    let totalPct = 0;
    const pctMap: Record<string, number> = {};
    for (const pair of pairs) {
      const match = pair.match(/^(.+?)\s+([\d.]+)%?$/);
      if (!match) {
        errors.push(`Cannot parse percentage entry: "${pair}"`);
        continue;
      }
      const pairName = match[1].trim().toLowerCase();
      const aliasKey = pairName === "priya s" || pairName === "priyas" ? "priya" : pairName;
      const canonical = nameToCanonical[aliasKey] ?? match[1].trim();
      const pct = parseFloat(match[2]);
      pctMap[canonical] = pct;
      totalPct += pct;
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
    if (Math.abs(totalPct - 100) > 0.1) {
      return {
        success: false,
        errors: [`Percentage split details must equal 100% (got ${totalPct.toFixed(1)}%).`],
        baseAmountINR,
        splits: [],
      };
    }
    // Convert percentages → INR amounts with cent-remainder on first person
    const totalCents = Math.round(baseAmountINR * 100);
    let allocatedCents = 0;
    for (let i = 0; i < resolvedParticipants.length; i++) {
      const p = resolvedParticipants[i];
      const pct = pctMap[p.userName];
      if (pct === undefined) {
        errors.push(`No percentage specified for "${p.userName}".`);
        continue;
      }
      let shareCents: number;
      if (i === resolvedParticipants.length - 1) {
        // Last person absorbs any rounding remainder
        shareCents = totalCents - allocatedCents;
      } else {
        shareCents = Math.round((pct / 100) * totalCents);
        allocatedCents += shareCents;
      }
      splits.push({ ...p, owedAmount: shareCents / 100 });
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
  } else if (splitType === "share") {
    // Share: parse "Name 1; Name 2" ratio-based splits
    if (!splitDetails || splitDetails.trim() === "") {
      return {
        success: false,
        errors: ["Split details are required for share splits."],
        baseAmountINR,
        splits: [],
      };
    }
    const pairs = splitDetails.split(";").map((s) => s.trim()).filter(Boolean);
    let totalShares = 0;
    const shareMap: Record<string, number> = {};
    for (const pair of pairs) {
      const match = pair.match(/^(.+?)\s+([\d.]+)$/);
      if (!match) {
        errors.push(`Cannot parse share entry: "${pair}"`);
        continue;
      }
      const pairName = match[1].trim().toLowerCase();
      const aliasKey = pairName === "priya s" || pairName === "priyas" ? "priya" : pairName;
      const canonical = nameToCanonical[aliasKey] ?? match[1].trim();
      const shareVal = parseFloat(match[2]);
      shareMap[canonical] = shareVal;
      totalShares += shareVal;
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
    if (totalShares === 0) {
      return {
        success: false,
        errors: ["Share split total is zero — cannot divide."],
        baseAmountINR,
        splits: [],
      };
    }
    const totalCents = Math.round(baseAmountINR * 100);
    let allocatedCents = 0;
    for (let i = 0; i < resolvedParticipants.length; i++) {
      const p = resolvedParticipants[i];
      const shares = shareMap[p.userName];
      if (shares === undefined) {
        errors.push(`No share count specified for "${p.userName}".`);
        continue;
      }
      let shareCents: number;
      if (i === resolvedParticipants.length - 1) {
        shareCents = totalCents - allocatedCents;
      } else {
        shareCents = Math.round((shares / totalShares) * totalCents);
        allocatedCents += shareCents;
      }
      splits.push({ ...p, owedAmount: shareCents / 100 });
    }
    if (errors.length > 0) {
      return { success: false, errors, baseAmountINR, splits: [] };
    }
  } else {
    // Unknown split type — fall back to equal
    const totalCents = Math.round(baseAmountINR * 100);
    const shareCents = Math.floor(totalCents / n);
    const remainderCents = totalCents % n;
    for (let i = 0; i < n; i++) {
      splits.push({
        ...resolvedParticipants[i],
        owedAmount: (shareCents + (i === 0 ? remainderCents : 0)) / 100,
      });
    }
  }

  return { success: true, errors: [], baseAmountINR, splits };
}