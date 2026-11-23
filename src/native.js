// Comportamiento de "app nativa": pantalla completa, horizontal, pantalla encendida.

export async function goNative() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* iOS Safari no tiene pantalla completa: se usa la PWA instalada */ }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch { /* algunos navegadores no permiten bloquear la orientación */ }
}

let wake = null;
export async function keepAwake() {
  try {
    wake = await navigator.wakeLock?.request('screen');
  } catch { /* */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wake) keepAwake();
});

/** Vibración corta (feedback háptico) si el móvil la tiene. */
export function buzz(ms = 25) {
  try { navigator.vibrate?.(ms); } catch { /* */ }
}

// Evita gestos del navegador que delatan que es una web (zoom, menú contextual).
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
