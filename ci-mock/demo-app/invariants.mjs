// Proposed invariants for the subscription plan lifecycle. These encode the
// intent's must-never-happen rules; predicates return TRUE when the rule HOLDS.
const same = (pre, post) =>
  pre.status === post.status &&
  pre.autoRenew === post.autoRenew &&
  pre.attempts === post.attempts;

export const stateInvariants = [
  {
    name: 'attempts-in-range',
    pred: (s) => Number.isInteger(s.attempts) && s.attempts >= 0 && s.attempts <= 3,
  },
  {
    name: 'attempts-nonzero-only-in-grace',
    pred: (s) => (s.status === 'grace' ? s.attempts >= 1 : s.attempts === 0),
  },
];

export const transitionInvariants = [
  {
    // A plan is never charged while cancelled, and only an active carded trial
    // converts: any other CONVERT is an observable no-op (post == pre).
    name: 'convert-only-active-trial-with-card',
    pred: (pre, action, data, post) =>
      action !== 'CONVERT'
      || (pre.status === 'trial' && pre.autoRenew === true && data.cardOnFile === true)
      || same(pre, post),
  },
  {
    // Stale webhook safety: charge events outside paid/grace change nothing.
    name: 'stale-charge-webhooks-are-noops',
    pred: (pre, action, data, post) =>
      (action !== 'CHARGE_OK' && action !== 'CHARGE_FAILED')
      || pre.status === 'paid'
      || pre.status === 'grace'
      || same(pre, post),
  },
  {
    // lapsed is only ever entered via LAPSE from grace with attempts >= 3.
    name: 'lapsed-only-via-exhausted-grace',
    pred: (pre, action, data, post) =>
      post.status !== 'lapsed'
      || pre.status === 'lapsed'
      || (action === 'LAPSE' && pre.status === 'grace' && pre.attempts >= 3),
  },
  {
    // Every entry into paid is one of the three sanctioned routes (each of
    // which implies a legitimate charge/card): trial conversion with consent
    // and a card, a successful retry from grace, or reactivation with a new card.
    name: 'paid-entry-gated',
    pred: (pre, action, data, post) =>
      post.status !== 'paid'
      || pre.status === 'paid'
      || (action === 'CONVERT' && pre.status === 'trial' && pre.autoRenew === true && data.cardOnFile === true)
      || (action === 'CHARGE_OK' && pre.status === 'grace')
      || (action === 'REACTIVATE' && pre.status === 'lapsed' && data.newCard === true),
  },
];