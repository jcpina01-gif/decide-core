# Registo com SMS obrigatório (produção)

Este documento alinha **Twilio**, **variáveis de ambiente** e **comportamento da app** para um produto em que o telemóvel tem de ser confirmado por SMS antes de **«Criar conta»**.

## Comportamento da aplicação

| Ambiente | SMS obrigatório no registo? |
|----------|----------------------------|
| **Produção** (`NODE_ENV=production`) | Sim, **se** `TWILIO_*` estiver completo **e** `ALLOW_CLIENT_PHONE_VERIFY=1`. |
| **Produção** | Não definir `ALLOW_SIGNUP_WITHOUT_PHONE_SMS=1`. |
| **Produção** | Não usar `DEV_SIGNUP_SMS_SIMULATE` (só faz sentido em `development`). |
| **Desenvolvimento** | Por defeito o SMS **não** bloqueia; para testar como produção: `REQUIRE_PHONE_SMS_FOR_SIGNUP=1` no `.env.local`. |

A API `GET /api/client/phone-verification/config` expõe `phoneSmsRequiredForSignup` e `smsVerificationEnabled` — o formulário de registo usa isto.

## Checklist Twilio (conta “séria”)

1. **Conta**  
   - Trial: só envia para números em **Verified Caller IDs** (ou limitações semelhantes).  
   - **Recomendado:** conta com billing / número próprio para enviar para clientes reais em +351.

2. **Messaging → Settings → Geo permissions**  
   - Activar **Portugal (+351)** para SMS de saída.

3. **Origem do SMS** — define **um** dos dois no `.env` do servidor Next:  
   - **`TWILIO_FROM_NUMBER`**: número **SMS** em **E.164** (ex. `+1…`), **ou**  
   - **`TWILIO_MESSAGING_SERVICE_SID`**: `MG…` (o `twilioSms.ts` envia com `MessagingServiceSid` quando `MG` está definido).

4. **Monitor → Logs → Messaging**  
   - Em caso de 403/21608/21408, a consola mostra o motivo exacto.

## Variáveis obrigatórias (produção)

Definir no hosting (ex. Vercel, VM, Docker) — **nunca** commitar segredos.

```bash
NODE_ENV=production

# Twilio — registo + (opcionalmente) alertas
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
# Um dos dois:
TWILIO_FROM_NUMBER=+1234567890
# TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxx

# Obrigatório para activar SMS no registo
ALLOW_CLIENT_PHONE_VERIFY=1

# Email de confirmação (pré-registo / conta)
VERIFY_EMAIL_SECRET=<mínimo 16 caracteres aleatórios>

# URL pública da app (links nos emails)
EMAIL_LINK_BASE_URL=https://app.teudominio.com
# ou NEXT_PUBLIC_APP_URL conforme o vosso setup
```

## Não definir em produção

- `ALLOW_SIGNUP_WITHOUT_PHONE_SMS=1` — desliga a exigência de SMS na criação da conta.  
- `DEV_SIGNUP_SMS_SIMULATE=1` — só desenvolvimento.  
- `NEXT_PUBLIC_DECIDE_REGISTER_DEV_UI=1` — painéis de debug no registo.

## Teste antes de lançar

1. Build local de produção (opcional): `npm run build && npm start` com `.env.production` ou env vars iguais ao servidor.  
2. Fluxo completo: registo → email → passo 2 → **Enviar SMS** → código → **Continuar** → **Criar conta**.  
3. Testar com número **real** +351 que a Twilio permita na tua conta.  
4. Rever **RGPD / bases legais** para SMS e telefone (consentimento, política de privacidade).

## Ficheiro de teste Python (`api_sms.py`)

É **independente** do Next.js. Serve só para validar credenciais Twilio. Em produção o que conta é o **Next** + `.env` do servidor.
