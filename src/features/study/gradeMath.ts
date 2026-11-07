export interface GradedAssessment {
  /** Weight in basis points (25% = 2500). */
  weightBp: number;
  markObtained: number | null;
  markTotal: number | null;
}

export interface GradeSummary {
  totalWeightBp: number;
  /** Weight of assessments with a confirmed mark. */
  markedWeightBp: number;
  /** Percentage of the whole subject already secured (confirmed only). */
  confirmedPercent: number;
  /** Average score across marked work, as a percentage; null if nothing is marked. */
  currentAveragePercent: number | null;
  /** Projected final if remaining work scores the current average; null if nothing is marked. */
  projectedPercent: number | null;
  issues: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Confirmed results only use recorded marks. Projections are labelled
 * separately and assume unmarked work matches the current average.
 */
export function summariseGrades(items: readonly GradedAssessment[]): GradeSummary {
  const issues: string[] = [];
  let totalWeightBp = 0;
  let markedWeightBp = 0;
  let weightedScore = 0; // Σ weightBp × fraction

  items.forEach((a, i) => {
    const label = `Assessment ${i + 1}`;
    if (!Number.isInteger(a.weightBp) || a.weightBp < 0 || a.weightBp > 10_000) {
      issues.push(`${label} has an invalid weighting.`);
      return;
    }
    totalWeightBp += a.weightBp;
    const hasObtained = a.markObtained !== null;
    const hasTotal = a.markTotal !== null;
    if (hasObtained !== hasTotal) {
      issues.push(`${label} needs both a mark and a total.`);
      return;
    }
    if (!hasObtained) return;
    const obtained = a.markObtained!;
    const total = a.markTotal!;
    if (total <= 0 || obtained < 0 || obtained > total) {
      issues.push(`${label} has a mark outside 0–${total}.`);
      return;
    }
    markedWeightBp += a.weightBp;
    weightedScore += a.weightBp * (obtained / total);
  });

  if (totalWeightBp > 10_000) issues.push(`Weightings add up to ${totalWeightBp / 100}%, which is over 100%.`);
  else if (items.length > 0 && totalWeightBp < 10_000) {
    issues.push(`Weightings add up to ${totalWeightBp / 100}%; ${(10_000 - totalWeightBp) / 100}% is unaccounted for.`);
  }

  const confirmedPercent = round1(weightedScore / 100);
  const currentAveragePercent = markedWeightBp > 0 ? round1((weightedScore / markedWeightBp) * 100) : null;
  const projectedPercent =
    currentAveragePercent === null
      ? null
      : round1(confirmedPercent + ((Math.min(totalWeightBp, 10_000) - markedWeightBp) / 100) * (weightedScore / markedWeightBp));

  return { totalWeightBp, markedWeightBp, confirmedPercent, currentAveragePercent, projectedPercent, issues };
}

/** Score needed on remaining work (as a %) to reach `targetPercent`, or null if impossible/unknown. */
export function requiredAverageFor(summary: GradeSummary, targetPercent: number): number | null {
  const remainingBp = Math.min(summary.totalWeightBp, 10_000) - summary.markedWeightBp;
  if (remainingBp <= 0) return null;
  const needed = ((targetPercent - summary.confirmedPercent) / (remainingBp / 100)) * 100;
  if (needed > 100) return null;
  return Math.max(0, round1(needed));
}

/** Australian university grade bands (most common scheme). */
export function gradeBand(percent: number): 'HD' | 'D' | 'C' | 'P' | 'N' {
  if (percent >= 80) return 'HD';
  if (percent >= 70) return 'D';
  if (percent >= 60) return 'C';
  if (percent >= 50) return 'P';
  return 'N';
}
