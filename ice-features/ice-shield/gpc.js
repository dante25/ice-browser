// Global Privacy Control i u JavaScriptu (navigator.globalPrivacyControl), uz Sec-GPC zaglavlje
try {
  Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
} catch { /* stranica je već definisala */ }
