// Stand-in for the machine under verification (think: kanjo's billing plan
// lifecycle). The CI mock only cares that this file's content hash matches the
// one recorded in out/verify-manifest.json — edit this file without
// regenerating and the polygraph-check job must fail as "stale".

export const initState = { planTier: 'trial', autoRenew: true, attempts: 0 };

export function next(state, action) {
  switch (action) {
    case 'CONVERT':
      if (state.planTier === 'trial' && state.autoRenew) return { ...state, planTier: 'paid' };
      return state;
    case 'CHARGE_FAILED':
      if (state.planTier === 'paid') return { ...state, planTier: 'grace', attempts: 1 };
      if (state.planTier === 'grace') return { ...state, attempts: state.attempts + 1 };
      return state;
    case 'CHARGE_OK':
      if (state.planTier === 'grace') return { ...state, planTier: 'paid', attempts: 0 };
      return state;
    case 'LAPSE':
      if (state.planTier === 'grace' && state.attempts >= 3) return { ...state, planTier: 'lapsed' };
      return state;
    case 'CANCEL':
      return { ...state, autoRenew: false };
    default:
      return state;
  }
}
