import { requireSession } from "./auth.js?v=18";

const session = await requireSession({ requirePrivileged: false });
if (session) {
  document.querySelectorAll("[data-privileged-only]").forEach((el) => {
    if (session.privileged) el.classList.remove("hidden");
    else el.remove();
  });
}
