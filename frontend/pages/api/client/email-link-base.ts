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
      ? "O telemóvel NÃO consegue abrir 127.0.0.1. Abra o registo/dashboard no PC com http://<IP-LAN>:porta (npm run dev:lan); em dev o link no email segue esse Host. Opcional: EMAIL_LINK_BASE_URL + EMAIL_LINK_BASE_URL_STRICT=1."
      : "Em dev, linkBaseResolved segue o Host do último pedido quando não utiliza modo estrito. Confirme Wi‑Fi e firewall na porta do Next.",
  });
}
