import { requireSession } from "./auth.js?v=16";

const session = await requireSession({ requirePrivileged: false });
if (session && !session.privileged) {
  document.querySelectorAll("[data-privileged-only]").forEach((el) => el.remove());
}
