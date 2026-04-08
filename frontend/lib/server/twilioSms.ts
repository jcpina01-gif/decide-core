/**
 * SMS via Twilio REST (partilhado entre alertas e verificação de telemóvel).
 */
export function isTwilioSmsConfigured(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const mg = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  return !!(sid && token && (from || (mg && mg.startsWith("MG"))));
}

type TwilioErrJson = {
  code?: number;
  message?: string;
  more_info?: string;
  status?: number;
};

/** Mensagem para o utilizador (PT) + detalhe técnico da Twilio quando existir. */
export function formatTwilioSmsError(j: TwilioErrJson, httpStatus: number): string {
  const code = typeof j.code === "number" ? j.code : undefined;
  const msg = (j.message || "").trim();

  if (httpStatus === 401) {
    return (
      "Twilio: autenticação recusada (401). Confirme TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN no .env.local (token completo, sem espaços ou aspas a mais) e reinicie npm run dev." +
      (msg ? ` — ${msg}` : "")
    );
  }

  if (httpStatus === 403) {
    const base =
      "Twilio recusou o pedido (403 Forbidden). Isto é quase sempre configuração da conta, não do código. Verifique por esta ordem: " +
      "(1) Consola Twilio → Messaging → Settings → Geo permissions → activa Portugal (+351) para SMS de saída; " +
      "(2) Se estiver em trial: Phone Numbers → Manage → Verified caller IDs → adicione o número de destino +351… e confirme-o; " +
      "(3) TWILIO_FROM_NUMBER tem de ser um número SMS seu na Twilio (ex. +1… que a Twilio atribuiu) ou um Messaging Service SID (MG…); " +
      "(4) Monitor → Logs → Messaging na Twilio mostra o motivo exacto do 403.";
    const devSkip =
      process.env.NODE_ENV === "development"
        ? " — Para contornar em desenvolvimento: em `frontend/.env.local` pode definir `ALLOW_SIGNUP_WITHOUT_PHONE_SMS=1` e concluir o registo sem SMS."
        : "";
    return (msg ? `${base} Mensagem da API: ${msg}` : base) + devSkip;
  }

  const hint =
    code === 21608 || /unverified numbers only/i.test(msg)
      ? "Conta Twilio em trial: só recebe SMS em números que adicionou em Phone Numbers → Manage → Verified Caller IDs (ou passe a conta paga)."
      : code === 21408 || /permission.*geo|not authorized.*country/i.test(msg)
        ? "Na Twilio: Messaging → Settings → Geo permissions — activa o país do número de destino (ex. Portugal +351)."
        : code === 21211 || /not a valid phone number|invalid.*to/i.test(msg)
          ? "Número de destino inválido. Utilize formato internacional no registo, ex. +351912345678."
          : code === 21614 || /'from'.*not valid/i.test(msg)
            ? "TWILIO_FROM_NUMBER inválido: tem de ser o número ou Messaging Service SID que a Twilio atribuiu (E.164 ou MG…)."
            : code === 20003 || /authenticate/i.test(msg)
              ? "Credenciais Twilio inválidas: verifique TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN no .env.local e reinicie o servidor."
              : code === 20404 || /resource not found/i.test(msg)
                ? "Conta Twilio / SID incorrecto — confirme TWILIO_ACCOUNT_SID no console."
                : null;

  const tail = msg ? ` Twilio: ${msg}` : "";
  const http = !msg && !hint ? ` (HTTP ${httpStatus})` : "";
  return (hint || "Não foi possível enviar o SMS.") + tail + http;
}

export async function sendTwilioSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER?.trim() || "";
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || "";
  if (!sid || !token) return { ok: false, error: "missing_twilio" };
  if (!from && !(messagingServiceSid && messagingServiceSid.startsWith("MG"))) {
    return { ok: false, error: "missing_twilio" };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid.startsWith("MG")) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else {
    params.set("From", from);
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const j = (await r.json().catch(() => ({}))) as TwilioErrJson & { sid?: string };
  if (!r.ok) {
    const userMsg = formatTwilioSmsError(j, r.status);
    console.error("[twilioSms] send failed", { to, httpStatus: r.status, twilio: j });
    return { ok: false, error: userMsg };
  }
  return { ok: true, sid: j.sid };
}
