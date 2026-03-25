# Como testar alertas (email + SMS)

O Chat / Cursor **não envia** mensagens por ti. Só o servidor Next.js na **tua máquina**, com chaves válidas, envia.

## 1. Ficheiro de ambiente

Na pasta `frontend`, copia `.env.local.example` para `.env.local` e preenche:

- `ALLOW_CLIENT_NOTIFY_API=1`
- `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` (conta [Resend](https://resend.com))
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` ([Twilio](https://www.twilio.com))

Sem Resend/Twilio a API responde em **modo simulado** (sem entrega real).

## 2. Arrancar o site

```powershell
cd frontend
npm run dev
```

Abre `http://127.0.0.1:4701`.

## 3. Conta com email + telemóvel

No registo de cliente, **email e telemóvel são obrigatórios** (E.164, ex. `+351912345678`).

Contas antigas: em **Registo** → secção **«Email e telemóvel da conta»** (com login).

## 4. Teste imediato (PowerShell)

Substitui o email e o telemóvel:

```powershell
$body = @{
  event         = "monthly_review"
  email         = "teu@email.com"
  phone         = "+351912345678"
  clientLabel   = "teste-manual"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:4701/api/client/notify-portfolio" `
  -Method POST -Body $body -ContentType "application/json"
```

## 5. Teste pelo dashboard

Com **constituição ainda não marcada** ou **dia de revisão mensal**, ao abrir o dashboard o envio automático corre **no máximo uma vez por dia** (chave em `localStorage`).

Para repetir no mesmo dia, apaga no browser a chave que começa por `decide_preadvice_sent_v1_` (F12 → Application → Local Storage).
