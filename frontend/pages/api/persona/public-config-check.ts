import type { NextApiRequest, NextApiResponse } from "next";
import { getResolvedPersonaEnvironmentId, getResolvedPersonaTemplateId } from "../../../lib/personaPublicEnv";

/**
 * GET — diagnóstico: a Vercel / o runtime vê as variáveis Persona (sem expor valores).
 * Útil quando o UI diz «Falta environment» mas as vars parecem preenchidas no dashboard:
 * - `NEXT_PUBLIC_*` no **browser** vêm do **último build**; sem redeploy o JS antigo fica vazio.
 * - Confirma **Production** (não só Preview) e nome exacto das chaves.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const templateId = getResolvedPersonaTemplateId();
  const environmentId = getResolvedPersonaEnvironmentId();
  const hasLegacyEnvName =
    Boolean(String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || "").trim()) &&
    !String(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID || "").trim();
  const versionId = String(process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_VERSION_ID || "").trim();

  return res.status(200).json({
    ok: true,
    /** Só existe `NEXT_PUBLIC_PERSONA_ENVIRONMENT` (nome antigo/errado) — renomear para `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID` evita confusão. */
    usingLegacyEnvironmentVarName: hasLegacyEnvName,
    /** O servidor (API) vê valor não vazio — não garante que o bundle JS do cliente foi reconstruído. */
    serverSeesTemplateId: templateId.length > 0,
    serverSeesEnvironmentId: environmentId.length > 0,
    serverSeesTemplateVersionId: versionId.length > 0,
    templateIdLooksLikePersona: /^itmpl_|^tmpl_/.test(templateId),
    environmentIdLooksLikePersona: /^env_/.test(environmentId),
    templateVersionLooksLikePersona: !versionId || /^itmplv_/.test(versionId),
    hint:
      "Se serverSees* for true mas a página ainda diz que falta env: faz Redeploy (NEXT_PUBLIC_* entra no build do browser). Se for false: variáveis não estão neste projeto/ambiente Production ou o nome da chave está errado. O nome correcto do ID de ambiente é NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID (não ..._ENVIRONMENT).",
  });
}
