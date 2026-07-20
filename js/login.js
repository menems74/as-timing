import { getSession, login } from "./auth.js?v=29";

const form = document.getElementById("login-form");
const emailField = document.getElementById("email");
const passwordField = document.getElementById("password");
const errorMsg = document.getElementById("error-msg");
const submitBtn = document.getElementById("submit-btn");

function showError(text) {
  errorMsg.textContent = text;
  errorMsg.classList.remove("hidden");
}

// Se già autenticato e autorizzato, salta direttamente al calendario.
const existing = await getSession();
if (existing) {
  window.location.href = "calendario.html";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Accesso in corso…";

  try {
    const session = await login(emailField.value, passwordField.value);
    if (session.unauthorized) {
      showError("Questa email non è abilitata all'accesso. Contatta l'amministratore.");
    } else {
      window.location.href = "calendario.html";
      return;
    }
  } catch (err) {
    showError("Credenziali non valide. Riprova.");
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Accedi";
});
