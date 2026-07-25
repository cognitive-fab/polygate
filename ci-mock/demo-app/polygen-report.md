# polygen — authored spec report

> Consistency check, not a proof. This code has been model-checked against
> its own stated invariants and its demo corpus has been independently
> replayed — that is not the same as being correct. Review the contract and
> invariants below before trusting either.

- artifact: **SAM v2 strict-profile module** (`{ instance, init, actions, getState, setState }`, vendored sam-lib 2.0.0-alpha; strict validate() gate at every stage boundary)

## Contract

⚠️ **Model-drafted, not extracted from existing code — review before use.**

```json
{
  "lang": "javascript",
  "stateKeys": [
    {
      "name": "status",
      "type": "string — 'trial' | 'paid' | 'grace' | 'lapsed'"
    },
    {
      "name": "autoRenew",
      "type": "boolean — false once the owner cancels; a cancelled plan is never charged again"
    },
    {
      "name": "attempts",
      "type": "number — dunning retry counter 0..3; non-zero only while status is 'grace'"
    }
  ],
  "initState": {
    "status": "trial",
    "autoRenew": true,
    "attempts": 0
  },
  "actions": {
    "CONVERT": {
      "dataFields": {
        "cardOnFile": "boolean — a payment card is on file when the trial clock elapses"
      }
    },
    "CANCEL": {
      "dataFields": {}
    },
    "CHARGE_FAILED": {
      "dataFields": {}
    },
    "CHARGE_OK": {
      "dataFields": {}
    },
    "LAPSE": {
      "dataFields": {}
    },
    "REACTIVATE": {
      "dataFields": {
        "newCard": "boolean — a new payment card was provided"
      }
    }
  },
  "dataDomain": {
    "CONVERT": {
      "cardOnFile": [
        true,
        false
      ]
    },
    "REACTIVATE": {
      "newCard": [
        true,
        false
      ]
    }
  },
  "terminalStates": [],
  "specialRules": [
    {
      "name": "cancelled-trial-never-converts",
      "whenState": "trial",
      "whenAction": "CONVERT",
      "note": "A cancelled trial (autoRenew=false) must reject CONVERT regardless of cardOnFile — a plan is never charged while cancelled. This rejection applies ONLY when autoRenew=false; an active trial (autoRenew=true) with cardOnFile=true transitions to paid."
    },
    {
      "name": "no-card-no-conversion",
      "whenState": "trial",
      "whenAction": "CONVERT",
      "note": "CONVERT with cardOnFile=false is a rejected no-op even for an active trial — the first-period charge requires a card on file. This rejection applies ONLY when cardOnFile=false."
    },
    {
      "name": "duplicate-convert-rejected",
      "whenState": "paid",
      "whenAction": "CONVERT",
      "note": "CONVERT redelivered to an already-paid plan (webhook retry/redelivery) is always a rejected no-op — the plan is never charged twice for the first period. CONVERT from grace or lapsed is likewise a rejected no-op (reason 'convert-only-from-trial')."
    },
    {
      "name": "stale-charge-webhook-in-trial",
      "whenState": "trial",
      "whenAction": "CHARGE_OK | CHARGE_FAILED",
      "note": "Charge webhooks arriving while status is trial are stale and always rejected — no renewal charge exists before conversion."
    },
    {
      "name": "stale-charge-webhook-in-lapsed",
      "whenState": "lapsed",
      "whenAction": "CHARGE_OK | CHARGE_FAILED",
      "note": "Charge webhooks arriving on a lapsed plan are stale and always rejected."
    },
    {
      "name": "attempts-capped-at-three",
      "whenState": "grace",
      "whenAction": "CHARGE_FAILED",
      "note": "In grace, CHARGE_FAILED increments attempts by 1 up to a maximum of 3 (BEHAVIORAL branch); a further CHARGE_FAILED when attempts is already 3 is a rejected no-op. This rejection applies ONLY when attempts >= 3."
    },
    {
      "name": "lapse-requires-exhausted-dunning",
      "whenState": "grace",
      "whenAction": "LAPSE",
      "note": "LAPSE is accepted ONLY in grace with attempts >= 3 (moves to lapsed and resets attempts to 0 — attempts is non-zero only in grace); in grace with attempts < 3, and in every other status, LAPSE is a rejected no-op."
    },
    {
      "name": "reactivate-requires-new-card",
      "whenState": "lapsed",
      "whenAction": "REACTIVATE",
      "note": "REACTIVATE with newCard=false is a rejected no-op; with newCard=true a lapsed plan returns to paid with attempts=0 and autoRenew=true. From any status other than lapsed REACTIVATE is always rejected (reason 'reactivate-only-from-lapsed')."
    },
    {
      "name": "cancel-is-idempotent",
      "whenAction": "CANCEL",
      "note": "CANCEL when autoRenew is already false is a rejected no-op (idempotent, harmless); otherwise it sets autoRenew=false in ANY status and never changes status or attempts — a paid plan stays paid until period end, a trial simply never converts."
    }
  ],
  "noOpRule": "An action that does not apply in the current state yields post == pre (an observable reject(reason), never a throw). No terminal states are declared: lapsed is re-activatable and a cancelled trial is an absorbing configuration under status 'trial', so no primary-state value uniquely ends every scenario."
}
```

## Code (`C:\Users\jjdub\code\polygraph-control-plane\ci-mock\demo-app\next.cjs`)

```javascript
// Subscription plan lifecycle — SAM v2 strict-profile module.
// States: trial -> (CONVERT) -> paid -> (CHARGE_FAILED) -> grace -> (LAPSE) -> lapsed,
// with CANCEL (autoRenew off, any time), CHARGE_OK (grace -> paid, attempts reset),
// and REACTIVATE (lapsed -> paid with a new card). Every not-applicable action is
// an observable reject(reason) — never a throw, never a silent fall-through.
'use strict';
const { createInstance } = require('@cognitive-fab/sam-pattern');

const INITIAL_STATE = { status: 'trial', autoRenew: true, attempts: 0 };

const instance = createInstance({ strict: true, hasAsyncActions: false });

const modelShape = {
  status: { type: 'string' },
  autoRenew: { type: 'boolean' },
  attempts: { type: 'number' },
};

const actions = {
  CONVERT: {
    action: (data = {}) => ({ ...data }),
    schema: { cardOnFile: { type: 'boolean', required: true } },
    domain: [{ cardOnFile: true }, { cardOnFile: false }],
  },
  CANCEL: { action: (data = {}) => ({ ...data }), schema: {}, domain: [{}] },
  CHARGE_FAILED: { action: (data = {}) => ({ ...data }), schema: {}, domain: [{}] },
  CHARGE_OK: { action: (data = {}) => ({ ...data }), schema: {}, domain: [{}] },
  LAPSE: { action: (data = {}) => ({ ...data }), schema: {}, domain: [{}] },
  REACTIVATE: {
    action: (data = {}) => ({ ...data }),
    schema: { newCard: { type: 'boolean', required: true } },
    domain: [{ newCard: true }, { newCard: false }],
  },
};

const acceptors = {
  // Only an active (autoRenew=true) trial with a card on file converts to paid.
  CONVERT: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.status === 'paid') return reject('duplicate-convert-rejected');
    if (model.status !== 'trial') return reject('convert-only-from-trial');
    if (model.autoRenew === false) return reject('cancelled-trial-never-converts');
    if (proposal.cardOnFile !== true) return reject('no-card-no-conversion');
    next.status = 'paid';
    unchanged('autoRenew', 'attempts');
  },
  // The owner can cancel at any time; cancelling twice is an idempotent no-op.
  CANCEL: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.autoRenew === false) return reject('cancel-is-idempotent');
    next.autoRenew = false;
    unchanged('status', 'attempts');
  },
  // paid -> grace (attempts=1); grace -> attempts+1 capped at 3; else stale.
  CHARGE_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.status === 'paid') {
      next.status = 'grace';
      next.attempts = 1;
      unchanged('autoRenew');
      return;
    }
    if (model.status === 'grace') {
      if (model.attempts >= 3) return reject('attempts-capped-at-three');
      next.attempts = model.attempts + 1;
      unchanged('status', 'autoRenew');
      return;
    }
    if (model.status === 'trial') return reject('stale-charge-webhook-in-trial');
    return reject('stale-charge-webhook-in-lapsed');
  },
  // grace -> paid (attempts reset). In paid a successful renewal changes no
  // observable state, so it is an observable reject(reason) no-op (the strict
  // profile requires every do-nothing branch to reject, never fall through).
  // Anywhere else the webhook is stale.
  CHARGE_OK: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.status === 'grace') {
      next.status = 'paid';
      next.attempts = 0;
      unchanged('autoRenew');
      return;
    }
    if (model.status === 'paid') return reject('renewal-already-settled');
    if (model.status === 'trial') return reject('stale-charge-webhook-in-trial');
    return reject('stale-charge-webhook-in-lapsed');
  },
  // Only exhausted dunning (grace, attempts >= 3) lapses; attempts resets so it
  // is non-zero only in grace.
  LAPSE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.status !== 'grace' || model.attempts < 3) return reject('lapse-requires-exhausted-dunning');
    next.status = 'lapsed';
    next.attempts = 0;
    unchanged('autoRenew');
  },
  // A lapsed plan returns to paid only with a new card; renewal turns back on.
  REACTIVATE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.status !== 'lapsed') return reject('reactivate-only-from-lapsed');
    if (proposal.newCard !== true) return reject('reactivate-requires-new-card');
    next.status = 'paid';
    next.attempts = 0;
    next.autoRenew = true;
  },
};

const control = instance({
  initialState: { ...INITIAL_STATE },
  component: { modelShape, actions, acceptors, reactors: [] },
});
const { intents } = control;

const getState = () => instance({}).getState();
const setState = (snapshot) => instance({}).setState(snapshot);
const init = () => { setState(INITIAL_STATE); };

const intentActions = {
  CONVERT: (data = {}) => intents.CONVERT(data),
  CANCEL: (data = {}) => intents.CANCEL(data),
  CHARGE_FAILED: (data = {}) => intents.CHARGE_FAILED(data),
  CHARGE_OK: (data = {}) => intents.CHARGE_OK(data),
  LAPSE: (data = {}) => intents.LAPSE(data),
  REACTIVATE: (data = {}) => intents.REACTIVATE(data),
};

module.exports = { instance, init, actions: intentActions, getState, setState };
```

⚠️ **Proposed invariants — review before trusting; these encode the model's
reading of intent, not a verified spec.**

```javascript
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
```

## Self-repair loop

Two defect classes are checked every round, in order: domain-ref gaps (a
`dataDomain` value the contract declares but the code never handles — these
are fixed FIRST, since until they're gone the checker may never even reach
what an invariant is meant to guard) and invariant violations.

| iteration | states explored | cap hit | nondeterministic | domain gaps | violations |
|---|---|---|---|---|---|
| 0 | 12 | no | no | — | — |

**Converged — no domain-ref gaps and no invariant violations reachable in the
final code**, over the explored (bounded) state space. Not a proof.

## Demo / regression trace corpus

- scenarios: **11** · windows: **65**
- corpus validated clean: no chaining/terminal problems.

## Independent replay sanity check

- windows replayed (separate process): **65** · non-pass: **0**

## Next steps

1. Review the contract and invariants above — both are the model's reading of
   your intent, not ground truth.
2. Wire the machine into the real handler/reducer via its exported `actions` —
   call the intents, do not reimplement the transition logic inline.
3. After integration, run `/polygraph:verify` against REAL captured traces to
   catch drift between this pure model and the glue code around it.