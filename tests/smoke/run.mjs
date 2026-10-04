// Headless-Chrome smoke test: loads the REAL app with seeded data and checks
// that each view renders the right things without runtime errors. Unit tests
// cover the logic; this covers app.js + the DOM. Run: npm run smoke
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) { console.log(`SKIP: Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`); process.exit(0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const base = (over = {}) => ({
  schema: 7,
  profile: { name: 'Sasa', persona: 'companion', region: '', goalsSet: true, onboardingDismissed: false, age: 35,
    routine: { wake: 420, workStart: 540, workEnd: 1020, winddown: 1320, note: '' },
    goals: { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 5 }, ...(over.profile || {}) },
  library: { activities: [{ id: 'a1', category: 'meditation', title: 'Box breathing', durationMin: 5, indoor: true, tags: [] }, { id: 'a2', category: 'movement', title: 'Brisk walk', durationMin: 20, indoor: false, tags: [] }] },
  days: { [today]: { commitments: [], activities: [], activityLog: [{ id: 'l1', category: 'movement', text: 'morning walk', durationMin: 30, source: 'voice', at: '' }], checkin: null, health: { restingHR: 58, sleepHours: 6.2, source: 'manual' }, weatherNote: '', ...(over.day || {}) } },
});

// Async on purpose: a sync spawn would block this process's static server.
// Chrome dumps the DOM but often lingers (background updater), so we resolve
// as soon as the dump is complete and kill it.
function load(view, state, ai = null) {
  const hash = encodeURIComponent(Buffer.from(JSON.stringify({ view, state, ai })).toString('base64'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'daywell-smoke-'));
  return new Promise((resolve) => {
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
      '--disable-background-networking', '--disable-component-update', '--enable-logging=stderr', '--v=0',
      '--virtual-time-budget=6000', '--dump-dom', `http://127.0.0.1:${port}/tests/smoke/seed.html#${hash}`]);
    let dom = ''; let errors = ''; let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(timer); child.kill('SIGKILL');
      setTimeout(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, () => {}), 500); // best-effort temp cleanup
      resolve({ dom, errors });
    };
    const timer = setTimeout(finish, 45000);
    child.stdout.on('data', (b) => { dom += b; if (dom.includes('</html>')) finish(); });
    child.stderr.on('data', (b) => { errors += b; });
    child.on('exit', finish);
  });
}

// A meeting happening right now (relative to the real clock), running late, in the rain.
const nowM = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
const hack = () => {
  const st = base({ day: { checkin: { mood: 3, energy: 3, note: '', at: '' }, weatherNote: "sundai hack will run late and it's raining outside.",
    commitments: [{ id: 'c1', title: 'Sundai Hack 143 — Biomarkers of Aging', start: Math.max(0, nowM - 60), end: Math.min(1430, nowM + 30), protected: true, source: 'ics' }] } });
  st.profile.routine.winddown = Math.min(1430, nowM + 30); // free right around wind-down
  return st;
};

const cases = [
  { name: 'first run (empty) → setup card, check-in, composer', view: 'today', state: null,
    has: ['Let’s get you set up', 'How are you feeling?', 'Do next', 'id="composer-input"', 'Good '], lacks: ['Uncaught'] },
  { name: 'returning user, low energy → greeting by name, adapted next step', view: 'today',
    state: base({ day: { checkin: { mood: 3, energy: 1, note: '', at: '' } } }),
    has: ['Sasa', 'Adapted to your mood &amp; energy', 'Based on your check-in', 'keeping it gentle', 'energy is low', 'class="ring', 'Healthy-aging guidelines', 'What you’ve done'], lacks: ['Let’s get you set up'] },
  { name: 'crisis in check-in note → support card + crisis line, no goal nudge', view: 'today',
    state: base({ profile: { region: 'TH' }, day: { checkin: { mood: 1, energy: 2, note: 'I feel hopeless', at: '' } } }),
    has: ['You don’t have to go through this alone', '1323', 'findahelpline.com', 'Breathe with me'], lacks: ['class="nudge '] },
  { name: 'contingency plan (late meeting + rain) shapes Do next', view: 'today', state: hack(),
    has: ['Today’s plan:', 'Sundai Hack 143 — Biomarkers of Aging', 'may run late', 'indoors', 'after '], lacks: ['Brisk walk'] },
  { name: 'Plan shows what Daywell understood from the note', view: 'plan', state: hack(),
    has: ['Your note mentions bad weather', 'may run late', 'wind-down instead of exercise'], lacks: [] },
  { name: 'history view', view: 'history', state: base(), has: ['Logged today', 'morning walk', 'Sleep &amp; heart rate', 'Import'], lacks: [] },
  { name: 'plan view', view: 'plan', state: base(), has: ['Today\'s plan', 'Suggested activities'], lacks: [] },
  { name: 'setup view', view: 'setup', state: base(), has: ['About you', 'Region (for support lines)', 'Voice', 'Weekly goals', 'Use recommended', 'AI assistant', 'Off — built-in rules only'], lacks: [] },
  { name: 'AI enabled but unavailable → still a recommendation (rules fallback)', view: 'today', state: base(), ai: { provider: 'ondevice' },
    has: ['Do next', 'class="rec primary'], hasAny: ['AI unavailable', 'AI read', 'Personalizing with AI'], lacks: [] },
];

let failed = 0;
for (const c of cases) {
  const { dom, errors } = await load(c.view, c.state, c.ai || null);
  const problems = [];
  if (!dom.includes('id="view"')) problems.push('page did not load');
  if (dom.includes('data-render-error')) problems.push('render error boundary was shown');
  if (!dom.includes('id="composer-input"')) problems.push('composer missing');
  for (const h of c.has) if (!dom.includes(h)) problems.push(`missing: ${h}`);
  for (const l of c.lacks) if (dom.includes(l)) problems.push(`unexpected: ${l}`);
  if (c.hasAny && !c.hasAny.some((h) => dom.includes(h))) problems.push(`missing one of: ${c.hasAny.join(' | ')}`);
  const jsErrors = errors.split('\n').filter((l) => /Uncaught|SyntaxError|ReferenceError|TypeError/.test(l));
  if (jsErrors.length) problems.push(...jsErrors.map((l) => `JS error: ${l.trim().slice(0, 200)}`));
  if (problems.length) { failed += 1; console.log(`✖ ${c.name}\n   ${problems.join('\n   ')}`); }
  else console.log(`✔ ${c.name}`);
}
server.close();
console.log(failed ? `\n${failed} smoke case(s) failed` : `\nall ${cases.length} smoke cases passed`);
process.exit(failed ? 1 : 0);
