// Gestione degli accessi (Firebase Authentication) dei dipendenti dal lato Admin/Responsabile.
//
// Vincolo di Firebase da cui derivano queste funzioni:
// - createUserWithEmailAndPassword crea l'account MA disconnette la sessione corrente e
//   accede automaticamente come il nuovo utente. Per evitarlo (l'Admin verrebbe buttato
//   fuori dalla propria sessione) lo eseguiamo su una ISTANZA FIREBASE SECONDARIA, temporanea,
//   che scartiamo subito dopo. La sessione principale (quella dell'Admin) non viene toccata.
// - Non esiste, senza un vero backend (Cloud Functions), un modo per impostare/cambiare da
//   client la password di un account che esiste già: l'unica via è mandare un'email di
//   reimpostazione che il dipendente stesso apre per scegliere una nuova password.

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { auth } from "./app.js?v=28";

// Crea il primo accesso per un'email che non ha ancora un account Authentication.
// Lancia "auth/email-already-in-use" se l'account esiste già (va usato inviaResetPassword).
export async function creaAccessoDipendente(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    await signOut(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }
}

// Manda l'email di reimpostazione password di Firebase. Funziona solo se l'account esiste già.
export async function inviaResetPassword(email) {
  await sendPasswordResetEmail(auth, email.trim());
}
