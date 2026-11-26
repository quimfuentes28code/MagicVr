// Pantallas de cuenta: entrar, crear cuenta, perfil y clasificación.

import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import {
  accountsEnabled, currentUser, signIn, signUp, signOut, resetPassword, leaderboard,
  fetchLibrary, pushLibrary, mergeLibraries,
} from '../account.js';
import { getLibrary, setLibrary } from './library.js';

/** Une la biblioteca del dispositivo con la del perfil y guarda el resultado en ambos. */
export async function syncLibrary({ quiet = false } = {}) {
  if (!currentUser()) return;
  try {
    const remote = await fetchLibrary();
    const merged = mergeLibraries(getLibrary(), remote && remote.data);
    setLibrary(merged);
    await pushLibrary(merged);
    if (!quiet) toast('Biblioteca sincronizada con tu perfil.', 'info');
  } catch (e) {
    if (!quiet) toast('No se pudo sincronizar la biblioteca: ' + e.message, 'warn');
  }
}

export function openAccount({ app, subScreen, onBack, tab = 'login' }) {
  if (!accountsEnabled()) {
    clear(app).append(subScreen('Cuenta', onBack, h('div', { class: 'panel setup-panel' },
      h('p', {}, 'Las cuentas de usuario todavía no están activadas en esta versión.'),
      h('p', { class: 'muted' }, 'Mientras tanto, tu biblioteca se guarda en este dispositivo.'))));
    return;
  }
  if (currentUser()) { profileScreen({ app, subScreen, onBack }); return; }
  const box = h('div', { class: 'panel setup-panel account-panel' });
  const tabs = h('div', { class: 'book-tabs' },
    h('button', { class: 'sigil-opt' + (tab === 'login' ? ' on' : ''), onClick: () => openAccount({ app, subScreen, onBack, tab: 'login' }) }, 'Entrar'),
    h('button', { class: 'sigil-opt' + (tab === 'signup' ? ' on' : ''), onClick: () => openAccount({ app, subScreen, onBack, tab: 'signup' }) }, 'Crear cuenta'));
  const msg = h('p', { class: 'muted account-msg' });
  const busy = (b, btn) => { btn.disabled = b; btn.classList.toggle('loading', b); };
  if (tab === 'login') {
    const login = h('input', { class: 'field-input', placeholder: 'Usuario o correo', autocomplete: 'username', autocapitalize: 'none' });
    const pass = h('input', { class: 'field-input', type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' });
    const go = h('button', { class: 'gem wide', onClick: async () => {
      if (!login.value.trim() || !pass.value) { msg.textContent = 'Escribe tu usuario y tu contraseña.'; return; }
      busy(true, go); msg.textContent = 'Entrando…';
      try {
        const u = await signIn({ login: login.value, password: pass.value });
        toast(`¡Hola, ${u.username}!`, 'info');
        await syncLibrary({ quiet: true });
        onBack();
      } catch (e) { msg.textContent = e.message; } finally { busy(false, go); }
    } }, 'Entrar');
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    const forgot = h('button', { class: 'link-btn', onClick: async () => {
      const email = login.value.includes('@') ? login.value : prompt('Escribe el correo de tu cuenta para cambiar la contraseña:');
      if (!email) return;
      try { await resetPassword(email); msg.textContent = 'Te hemos enviado un correo para cambiar la contraseña.'; } catch (e) { msg.textContent = e.message; }
    } }, '¿Has olvidado la contraseña?');
    box.append(h('div', { class: 'field-label' }, 'Entrar en tu cuenta'), login, pass, go, forgot, msg);
  } else {
    const email = h('input', { class: 'field-input', type: 'email', placeholder: 'Correo electrónico', autocomplete: 'email', autocapitalize: 'none' });
    const user = h('input', { class: 'field-input', placeholder: 'Nombre de usuario (3-18: letras, números, _)', maxLength: 18, autocomplete: 'username', autocapitalize: 'none' });
    const pass = h('input', { class: 'field-input', type: 'password', placeholder: 'Contraseña (mínimo 8)', autocomplete: 'new-password' });
    const pass2 = h('input', { class: 'field-input', type: 'password', placeholder: 'Repite la contraseña', autocomplete: 'new-password' });
    const go = h('button', { class: 'gem wide', onClick: async () => {
      if (pass.value !== pass2.value) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
      busy(true, go); msg.textContent = 'Creando tu cuenta…';
      try {
        const r = await signUp({ email: email.value, username: user.value, password: pass.value });
        if (r.needsConfirm) {
          clear(box).append(h('p', {}, `¡Cuenta creada! Te hemos enviado un correo a ${email.value.trim()} para confirmarla.`),
            h('p', { class: 'muted' }, 'Abre el enlace del correo (mira también en spam) y después entra con tu usuario y contraseña.'),
            h('button', { class: 'gem wide', onClick: () => openAccount({ app, subScreen, onBack, tab: 'login' }) }, 'Ir a entrar'));
          return;
        }
        toast(`¡Bienvenido, ${user.value.trim()}!`, 'info');
        await syncLibrary({ quiet: true });
        onBack();
      } catch (e) { msg.textContent = e.message; } finally { busy(false, go); }
    } }, 'Crear cuenta');
    box.append(h('div', { class: 'field-label' }, 'Crear una cuenta nueva'), email, user, pass, pass2, go, msg,
      h('p', { class: 'muted small' }, 'Con tu cuenta, tus mazos y tu colección se guardan en tu perfil y los tienes en cualquier dispositivo. Más adelante: partidas clasificatorias y ranking.'));
  }
  clear(app).append(subScreen('Cuenta', onBack, h('div', {}, tabs, box)));
}

function profileScreen({ app, subScreen, onBack }) {
  const u = currentUser();
  const lib = getLibrary();
  const board = h('div', { class: 'leaderboard' }, h('p', { class: 'muted' }, 'Cargando clasificación…'));
  leaderboard(20).then((rows) => {
    clear(board).append(h('div', { class: 'field-label' }, 'Clasificación'),
      h('ol', { class: 'lb-list' }, rows.map((r) => h('li', { class: r.username === u.username ? 'me' : '' },
        h('b', {}, r.username), h('span', {}, `${r.rating} · ${r.wins}V / ${r.losses}D`)))));
  }).catch(() => clear(board));
  clear(app).append(subScreen('Tu perfil', onBack, h('div', { class: 'panel setup-panel account-panel' },
    h('div', { class: 'profile-head' }, icon('person'), h('div', {}, h('h3', {}, u.username), h('div', { class: 'muted' }, u.email))),
    h('div', { class: 'profile-stats' },
      h('div', {}, h('b', {}, u.rating), h('span', {}, 'Puntuación')),
      h('div', {}, h('b', {}, u.wins), h('span', {}, 'Victorias')),
      h('div', {}, h('b', {}, u.losses), h('span', {}, 'Derrotas')),
      h('div', {}, h('b', {}, lib.decks.length), h('span', {}, 'Mazos'))),
    h('div', { class: 'row-btns' },
      h('button', { class: 'gem small bronze', onClick: () => syncLibrary() }, 'Sincronizar biblioteca'),
      h('button', { class: 'gem small bronze', onClick: async () => { await signOut(); toast('Has cerrado sesión.'); onBack(); } }, 'Cerrar sesión')),
    h('p', { class: 'muted small' }, 'Tus mazos y tu colección se guardan solos en tu perfil cada vez que los cambias.'),
    board)));
}
