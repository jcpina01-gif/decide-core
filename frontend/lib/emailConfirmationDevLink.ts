/**
 * Links de confirmação gerados em dev apontam muitas vezes para 127.0.0.1/localhost.
 * Noutro dispositivo (ex. telemóvel) isso não alcança o PC — o browser mostra erro de ligação.
 */
export function devConfirmationLinkUsesLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(url);
  }
}

/** Porta esperada do `npm run dev` / `dev:lan` neste repo (package.json). */
export const DECIDE_NEXT_DEV_PORT = "4701";

/**
 * Se o link de confirmação usar outra porta, o telemóvel abre o sítio errado → erro de ligação ou 404.
 */
export function devConfirmationLinkWrongPort(url: string, expectedPort: string = DECIDE_NEXT_DEV_PORT): boolean {
  try {
    const u = new URL(url);
    const p = u.port || (u.protocol === "https:" ? "443" : "80");
    return p !== expectedPort;
  } catch {
    return false;
  }
}
