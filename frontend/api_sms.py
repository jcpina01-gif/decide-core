"""
Teste Twilio isolado (não faz parte do Next.js).

1) pip install fastapi uvicorn twilio

2) Credenciais — ou edita as variáveis em baixo OU define no PowerShell antes do uvicorn:
   $env:TWILIO_ACCOUNT_SID="AC..."
   $env:TWILIO_AUTH_TOKEN="..."
   $env:TWILIO_MESSAGING_SERVICE_SID="MG..."   # OU usa TWILIO_FROM_NUMBER="+1..."
   $env:TWILIO_TEST_TO="+351912345678"

3) uvicorn api_sms:app --host 127.0.0.1 --port 8000

4) Invoke-WebRequest http://127.0.0.1:8000/send-test-sms

Se der 500, vê o corpo JSON na resposta ou o terminal do uvicorn.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

app = FastAPI()

# Fallback se não usares variáveis de ambiente (não commits com segredos reais)
ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "COLOCA_AQUI_O_TEU_SID")
AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "COLOCA_AQUI_O_TEU_TOKEN")
MESSAGING_SERVICE_SID = os.environ.get("TWILIO_MESSAGING_SERVICE_SID", "COLOCA_AQUI_O_MGxxxx")
FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
TO_NUMBER = os.environ.get("TWILIO_TEST_TO", "+351XXXXXXXXX")


def _client() -> Client:
    return Client(ACCOUNT_SID, AUTH_TOKEN)


@app.get("/send-test-sms")
def send_sms():
    if "COLOCA_AQUI" in ACCOUNT_SID or "COLOCA_AQUI" in AUTH_TOKEN:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Credenciais por preencher. Usa TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN (env ou edita api_sms.py).",
            },
        )

    if TO_NUMBER.startswith("+351X") or "X" in TO_NUMBER.replace("+351", ""):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Define TWILIO_TEST_TO com o número E.164 real (ex: +351912345678).",
            },
        )

    if not MESSAGING_SERVICE_SID.startswith("MG") and not FROM_NUMBER:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Define TWILIO_MESSAGING_SERVICE_SID (MG...) ou TWILIO_FROM_NUMBER (número Twilio em E.164).",
            },
        )

    try:
        kwargs = {
            "body": "DECIDE AI: teste de SMS com sucesso",
            "to": TO_NUMBER,
        }
        if MESSAGING_SERVICE_SID.startswith("MG"):
            kwargs["messaging_service_sid"] = MESSAGING_SERVICE_SID
        else:
            kwargs["from_"] = FROM_NUMBER

        message = _client().messages.create(**kwargs)
        return {"ok": True, "status": "sent", "sid": message.sid}
    except TwilioRestException as e:
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "error": "Twilio recusou o pedido",
                "twilio_code": e.code,
                "twilio_message": str(e.msg or e),
                "twilio_status": e.status,
            },
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": type(e).__name__, "detail": str(e)},
        )
