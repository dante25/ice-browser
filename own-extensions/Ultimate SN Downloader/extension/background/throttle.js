// Pacing profiles. api = pause before every data request to Instagram / Facebook (what gets accounts flagged);
// scroll = pause between page scrolls; file = pause between media files from the CDN (never counts against the account).
// burst/burstBreak: after `burst` data requests a longer break; hourlyApi: cap on data requests per hour (0 = none).
export const PROFILES = {
  safe:   { api: [3.5, 8],    scroll: [3, 7],     file: [0.4, 1.2],  burst: 25,  burstBreak: [60, 150], hourlyApi: 240 },
  normal: { api: [1.2, 3],    scroll: [1.5, 3.5], file: [0.1, 0.45], burst: 80,  burstBreak: [20, 50],  hourlyApi: 0 },
  quiet:  { api: [8, 18],     scroll: [4, 10],    file: [0.6, 1.6],  burst: 12, burstBreak: [180, 420], hourlyApi: 90 },
  fast:   { api: [0.35, 0.9], scroll: [0.8, 2],   file: [0, 0.12],   burst: 0,   burstBreak: [10, 30],  hourlyApi: 0 }
};

export function nextDelay([lo, hi]) { return lo + Math.random() * (hi - lo); }

// first block: base minutes (default 35), each further block within 12 h multiplies by 1.6, capped at 4 h
export function cooldownFor(level, baseMin) {
  const base = (Number(baseMin) || 35) * 60;
  return Math.min(4 * 3600, base * Math.pow(1.6, level));
}

// Facebook is much stricter than Instagram about the one-request-per-photo lookups, so its profiles are slower and take longer breaks.
export const FB_PROFILES = {
  safe:   { api: [5, 11],   scroll: [3, 7],     file: [0.4, 1.2],  burst: 20, burstBreak: [120, 240], hourlyApi: 150 },
  normal: { api: [3, 7],    scroll: [1.5, 3.5], file: [0.1, 0.45], burst: 40, burstBreak: [60, 150],  hourlyApi: 300 },
  quiet:  { api: [10, 22],  scroll: [4, 10],    file: [0.6, 1.6],  burst: 10, burstBreak: [240, 480], hourlyApi: 80 },
  fast:   { api: [1.2, 3],  scroll: [0.8, 2],   file: [0, 0.12],   burst: 80, burstBreak: [30, 80],   hourlyApi: 0 }
};
