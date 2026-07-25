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