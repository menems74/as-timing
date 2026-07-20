// Autenticazione e risoluzione ruolo: Admin (amministratori/{email}), Responsabile
// (dipendente con ruolo "responsabile"), Dipendente (sola lettura). Admin e Responsabile
// sono equivalenti: entrambi "privileged" (scrittura completa ovunque nell'app).

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./app.js?v=25";
import { findAmministratore, findLoginDipendente } from "./data.js?v=25";

let sessionPromise = null;

async function resolveRuolo(user) {
  if (!user || !user.email) return null;

  const admin = await findAmministratore(user.email);
  if (admin) {
    return {
      email: user.email,
      ruolo: "admin",
      privileged: true,
      dipendenteId: null,
      nome: admin.nome || "Admin",
      cognome: "",
    };
  }

  const dip = await findLoginDipendente(user.email);
  if (dip) {
    const privileged = dip.ruolo === "responsabile";
    return {
      email: user.email,
      ruolo: dip.ruolo,
      privileged,
      dipendenteId: dip.id,
      nome: dip.nome,
      cognome: dip.cognome,
    };
  }

  return { unauthorized: true, email: user.email };
}

function initSession() {
  if (!sessionPromise) {
    sessionPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();
        if (!user) {
          resolve(null);
          return;
        }
        const session = await resolveRuolo(user);
        if (session && session.unauthorized) {
          await signOut(auth);
          resolve(null);
        } else {
          resolve(session);
        }
      });
    });
  }
  return sessionPromise;
}

// Risolve la sessione corrente (null se non autenticato). Non reindirizza.
export function getSession() {
  return initSession();
}

// Da chiamare in cima a ogni pagina protetta. Reindirizza se serve e ritorna
// la sessione (o null se ha già reindirizzato: interrompere l'esecuzione).
export async function requireSession({ requirePrivileged = false } = {}) {
  const session = await getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  if (requirePrivileged && !session.privileged) {
    window.location.href = "calendario.html";
    return null;
  }
  return session;
}

// Usata solo da login.html: tenta l'accesso e restituisce { unauthorized: true }
// se le credenziali sono valide ma l'email non è né admin né dipendente collegato.
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const session = await resolveRuolo(cred.user);
  if (session && session.unauthorized) {
    await signOut(auth);
    sessionPromise = Promise.resolve(null);
    return { unauthorized: true };
  }
  sessionPromise = Promise.resolve(session);
  return session;
}

export async function logout() {
  await signOut(auth);
  sessionPromise = Promise.resolve(null);
  window.location.href = "login.html";
}
