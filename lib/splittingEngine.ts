import prisma from './db';

export interface RawSplitInput {
  amount: number;         // Raw transaction amount
  currency: string;       // "INR" or "USD"
  date: Date;             // Transaction date
  splitType: 'equal' | 'unequal' | 'percentage' | 'share';
  splitWith: string[];    // Array of User names to split with
  splitDetails?: string;  // Optional raw details string from the CSV
}

export interface SplitOutput {
  userId: string;
  userName: string;
  owedAmount: number;     // Standardized to INR (2 decimal places)
}

export interface CalculationResult {
  success: boolean;
  errors: string[];       // All mathematical or logic validation errors
  splits: SplitOutput[];  // Final outputs if successful
  baseAmountINR: number;  // Standardized transaction total in INR
}

export interface UserMembershipTimeline {
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * Standard USD to INR exchange rate used in the system if currency is USD.
 */
export const DEFAULT_USD_TO_INR_RATE = 83.0;

/**
 * Calculates and validates splits for an expense based on the split type, details, and active memberships.
 * 
 * @param input The raw split input details from CSV or form
 * @param userMap Map of userName (case-insensitive) to userId
 * @param membershipTimelines Optional timelines map mapping userId to their membership periods
 * @returns CalculationResult containing validation status, errors, and calculated splits in INR
 */
export async function calculateSplits(
  input: RawSplitInput,
  userMap: Record<string, string>,
  membershipTimelines?: Record<string, UserMembershipTimeline[]>
): Promise<CalculationResult> {
  const errors: string[] = [];
  const { amount, currency, date, splitType, splitWith, splitDetails } = input;

  // 1. Validate splitWith has users
  if (!splitWith || splitWith.length === 0) {
    return {
      success: false,
      errors: ['At least one user must be specified to split the expense.'],
      splits: [],
      baseAmountINR: 0,
    };
  }

  // 2. Determine exchange rate and base amount in INR
  let exchangeRate = 1.0;
  const normCurrency = (currency || '').trim().toUpperCase();
  if (normCurrency === 'USD') {
    exchangeRate = DEFAULT_USD_TO_INR_RATE;
  } else if (normCurrency !== 'INR' && normCurrency !== '') {
    errors.push(`Unsupported currency: "${currency}". Only INR and USD are supported.`);
  }

  // Keep internal precision to 4 decimal places
  const rawBaseAmountINR = amount * exchangeRate;
  const baseAmountINR = Math.round(rawBaseAmountINR * 10000) / 10000;

  // Helper function to resolve case-insensitive user name to userId and correct casing name
  const resolveUser = (name: string): { id: string; name: string } | null => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return null;
    for (const [key, value] of Object.entries(userMap)) {
      if (key.trim().toLowerCase() === trimmed) {
        return { id: value, name: key };
      }
    }
    return null;
  };

  // Resolve splitWith users
  const resolvedSplitWith: { id: string; name: string; originalInputName: string }[] = [];
  const splitWithUserIds = new Set<string>();

  for (const name of splitWith) {
    const resolved = resolveUser(name);
    if (!resolved) {
      errors.push(`Participant user "${name}" could not be found in the system.`);
    } else {
      resolvedSplitWith.push({
        id: resolved.id,
        name: resolved.name,
        originalInputName: name,
      });
      splitWithUserIds.add(resolved.id);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      splits: [],
      baseAmountINR: Math.round(baseAmountINR * 100) / 100,
    };
  }

  // 3. Temporal Checking
  let timelines = membershipTimelines;
  if (!timelines) {
    timelines = {};
    const resolvedIds = resolvedSplitWith.map(u => u.id);
    try {
      const dbMemberships = await prisma.groupMembership.findMany({
        where: {
          userId: { in: resolvedIds },
        },
      });
      for (const m of dbMemberships) {
        if (!timelines[m.userId]) {
          timelines[m.userId] = [];
        }
        timelines[m.userId].push({
          joinedAt: m.joinedAt,
          leftAt: m.leftAt,
        });
      }
    } catch (dbError) {
      // If database query fails, we continue but warn/handle
      console.warn('Database membership lookup failed, skipping DB temporal check:', dbError);
    }
  }

  const expenseTime = new Date(date).getTime();
  for (const user of resolvedSplitWith) {
    const userPeriods = timelines[user.id] || [];
    if (userPeriods.length > 0) {
      const isActive = userPeriods.some(p => {
        const joinedTime = new Date(p.joinedAt).getTime();
        const leftTime = p.leftAt ? new Date(p.leftAt).getTime() : null;
        return expenseTime >= joinedTime && (leftTime === null || expenseTime <= leftTime);
      });
      if (!isActive) {
        errors.push(`User ${user.name} was inactive on the expense date ${new Date(date).toISOString().split('T')[0]}.`);
      }
    }
  }

  // Keep track of internal share values (in INR, 4 decimal places)
  const internalSharesMap: Record<string, number> = {};
  for (const user of resolvedSplitWith) {
    internalSharesMap[user.id] = 0;
  }

  // 4. Calculate splits based on type
  if (splitType === 'equal') {
    const individualShare = baseAmountINR / resolvedSplitWith.length;
    for (const user of resolvedSplitWith) {
      internalSharesMap[user.id] = Math.round(individualShare * 10000) / 10000;
    }
  } else {
    // splitDetails is required for non-equal types
    if (!splitDetails || splitDetails.trim() === '') {
      errors.push(`Split details are required for split type "${splitType}".`);
      return {
        success: false,
        errors,
        splits: [],
        baseAmountINR: Math.round(baseAmountINR * 100) / 100,
      };
    }

    const parts = splitDetails
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);

    const parsedDetails: { userId: string; userName: string; value: number }[] = [];
    const matchedDetailNames = new Set<string>();

    for (const part of parts) {
      const match = part.match(/^(.+?)\s+([\d.-]+)%?$/);
      if (!match) {
        errors.push(`Invalid split detail format: "${part}". Expected format like "User Name value".`);
        continue;
      }

      const detailName = match[1].trim(); // Trimming whitespace
      const value = parseFloat(match[2]);

      if (isNaN(value)) {
        errors.push(`Invalid numeric value in split detail: "${part}".`);
        continue;
      }

      const resolved = resolveUser(detailName);
      if (!resolved) {
        errors.push(`User "${detailName}" in split details could not be found in the system.`);
      } else if (!splitWithUserIds.has(resolved.id)) {
        errors.push(`User "${resolved.name}" specified in split details is not present in the split participants (splitWith) list.`);
      } else {
        parsedDetails.push({
          userId: resolved.id,
          userName: resolved.name,
          value,
        });
        matchedDetailNames.add(resolved.id);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
        splits: [],
        baseAmountINR: Math.round(baseAmountINR * 100) / 100,
      };
    }

    if (splitType === 'unequal') {
      // Validate that raw parsed values sum matches total transaction amount
      const totalParsedAmount = parsedDetails.reduce((sum, d) => sum + d.value, 0);
      if (Math.abs(totalParsedAmount - amount) > 0.01) {
        errors.push(`Sum of split details (${totalParsedAmount}) does not match the transaction amount (${amount}).`);
      } else {
        for (const detail of parsedDetails) {
          const detailBaseAmountINR = detail.value * exchangeRate;
          internalSharesMap[detail.userId] = Math.round(detailBaseAmountINR * 10000) / 10000;
        }
      }
    } else if (splitType === 'percentage') {
      const totalPercentage = parsedDetails.reduce((sum, d) => sum + d.value, 0);
      if (Math.abs(totalPercentage - 100) > 0.0001) {
        errors.push(`Sum of percentages (${totalPercentage}%) must equal 100%.`);
      } else {
        for (const detail of parsedDetails) {
          const percentShare = baseAmountINR * (detail.value / 100.0);
          internalSharesMap[detail.userId] = Math.round(percentShare * 10000) / 10000;
        }
      }
    } else if (splitType === 'share') {
      const totalShares = parsedDetails.reduce((sum, d) => sum + d.value, 0);
      if (totalShares <= 0) {
        errors.push(`Total shares must be greater than 0. Current total is ${totalShares}.`);
      } else {
        const perShareValue = baseAmountINR / totalShares;
        for (const detail of parsedDetails) {
          const userShare = perShareValue * detail.value;
          internalSharesMap[detail.userId] = Math.round(userShare * 10000) / 10000;
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      splits: [],
      baseAmountINR: Math.round(baseAmountINR * 100) / 100,
    };
  }

  // 5. Build preliminary rounded values (final output to 2 decimal places)
  const calculatedSplits = resolvedSplitWith.map((user) => {
    const internalShare = internalSharesMap[user.id] || 0;
    const owedAmount = Math.round(internalShare * 100) / 100;
    return {
      userId: user.id,
      userName: user.name,
      owedAmount,
    };
  });

  // 6. Rounding adjustment: distribute any fractional remaining pennies evenly
  const finalBaseAmountINR = Math.round(baseAmountINR * 100) / 100;
  const targetCents = Math.round(finalBaseAmountINR * 100);
  const sumRoundedCents = calculatedSplits.reduce((sum, s) => sum + Math.round(s.owedAmount * 100), 0);
  let remainingCents = targetCents - sumRoundedCents;

  if (remainingCents !== 0 && calculatedSplits.length > 0) {
    const step = Math.sign(remainingCents); // +1 or -1 cent
    let idx = 0;
    while (remainingCents !== 0) {
      calculatedSplits[idx].owedAmount = Math.round((calculatedSplits[idx].owedAmount + step * 0.01) * 100) / 100;
      remainingCents -= step;
      idx = (idx + 1) % calculatedSplits.length; // distribute evenly one penny at a time
    }
  }

  return {
    success: true,
    errors: [],
    splits: calculatedSplits,
    baseAmountINR: finalBaseAmountINR,
  };
}
