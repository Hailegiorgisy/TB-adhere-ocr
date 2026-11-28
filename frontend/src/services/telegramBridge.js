export function isTelegramMiniApp() {
  return typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
}

export function initTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#1E1713");
      tg.setBackgroundColor("#1E1713");
    } catch {
      // Ignore
    }
    return tg.initDataUnsafe?.user || null;
  }
  return null;
}

export function triggerTelegramHaptic(type = "success") {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Ignore
  }
}
