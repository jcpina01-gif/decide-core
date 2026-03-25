import type { NextApiRequest, NextApiResponse } from "next";
import { getEmailLinkBaseUrl, isLocalhostLinkBase, resolveEmailLinkBaseUrl } from "../../../lib/server/emailLinkBase";

/**
 * GET — mostra que base URL o servidor usa nos links (para configurar telemóvel / Wi‑Fi).
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const linkBase = getEmailLinkBaseUrl();
  const linkBaseResolved = resolveEmailLinkBaseUrl(req);
  const localhost = isLocalhostLinkBase(linkBase);

  return res.status(200).json({
    ok: true,
    linkBase,
    linkBaseResolved,
    localhost,
    hint: localhost
      ? "O telemóvel NÃO consegue abrir 127.0.0.1. Define EMAIL_LINK_BASE_URL=http://IP-DO-PC:4701 em frontend/.env.local, corre npm run dev:lan, reinicia o servidor e volta a enviar o email. Abre a firewall TCP 4701 no Windows se precisares."
      : "Link base parece acessível na rede. Confirma que o telemóvel está na mesma Wi‑Fi e que corres npm run dev:lan.",
  });
}
