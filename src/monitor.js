// Local monitoring (PRD §6). Tracks latency, invalid proposals, save failures,
// retries, and corrections locally only. Content-bearing records expire after
// seven days and are deletable. No silent uploads.

const KEY = 'daywell.diag.v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function read() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function prune(records) {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  return records.filter((r) => typeof r.at === 'number' && r.at >= cutoff).slice(-200);
}

export function log(event, detail = {}) {
  try {
    const records = prune(read());
    records.push({ at: Date.now(), event, detail });
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* diagnostics are best-effort; never block the workflow */
  }
}

export function summary() {
  const records = prune(read());
  const counts = {};
  let latencyTotal = 0;
  let latencyN = 0;
  for (const r of records) {
    counts[r.event] = (counts[r.event] || 0) + 1;
    if (r.event === 'compute' && typeof r.detail.ms === 'number') {
      latencyTotal += r.detail.ms;
      latencyN += 1;
    }
  }
  return { counts, avgComputeMs: latencyN ? Math.round(latencyTotal / latencyN) : null, n: records.length };
}

export function clearDiagnostics() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
