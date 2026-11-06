// Explicit state machine for the whole experience. Illegal transitions are rejected,
// which is what prevents out-of-order or repeated transitions.

export const S = Object.freeze({
  LOADING: 'LOADING',
  CLOSED: 'CLOSED',
  OPENING: 'OPENING',              // card unfolding (finger-driven or settling)
  CLOSING: 'CLOSING',              // card folding back (finger-driven or settling)
  OPEN: 'OPEN',
  PAGE_TRANSITION_IN: 'PAGE_TRANSITION_IN',
  PAGE_02: 'PAGE_02',
  PAGE_TRANSITION_OUT: 'PAGE_TRANSITION_OUT',
});

const EDGES = {
  LOADING: ['CLOSED'],
  CLOSED: ['OPENING'],
  OPENING: ['OPEN', 'CLOSING', 'CLOSED'],
  CLOSING: ['CLOSED', 'OPENING', 'OPEN'],
  OPEN: ['CLOSING', 'PAGE_TRANSITION_IN', 'OPENING'],
  PAGE_TRANSITION_IN: ['PAGE_02'],
  PAGE_02: ['PAGE_TRANSITION_OUT'],
  PAGE_TRANSITION_OUT: ['OPEN'],
};

export class StateMachine {
  constructor(initial = S.LOADING) {
    this.state = initial;
    this.listeners = new Set();
  }
  is(...states) { return states.includes(this.state); }
  can(next) { return next === this.state || EDGES[this.state].includes(next); }
  go(next, info) {
    if (next === this.state) return true;
    if (!EDGES[this.state].includes(next)) {
      console.debug(`[state] rejected ${this.state} → ${next}`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    for (const fn of this.listeners) fn(next, prev, info);
    return true;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
