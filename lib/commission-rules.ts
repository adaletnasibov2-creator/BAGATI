export type CommissionInterval = {
  startsAt: Date;
  endsAt: Date | null;
};

export function commissionIntervalsOverlap(left: CommissionInterval, right: CommissionInterval) {
  return (!left.endsAt || right.startsAt < left.endsAt) &&
    (!right.endsAt || left.startsAt < right.endsAt);
}

export function hasCommissionRuleConflict(
  candidate: CommissionInterval,
  existing: readonly CommissionInterval[],
) {
  return existing.some((rule) => commissionIntervalsOverlap(candidate, rule));
}
