import { isTwilioSmsConfigured } from "./twilioSms";

/**
 * Modo dev: simula o fluxo SMS no registo sem Twilio (código devolvido na resposta da API).
 * Só activo com NODE_ENV=development + DEV_SIGNUP_SMS_SIMULATE=1.
 */
export function isDevSignupSmsSimulate(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_SIGNUP_SMS_SIMULATE === "1";
}

/** Rotas send/verify de telemóvel podem correr? */
export function isPhoneVerificationApiEnabled(): boolean {
  if (isDevSignupSmsSimulate()) return true;
  return isTwilioSmsConfigured() && process.env.ALLOW_CLIENT_PHONE_VERIFY === "1";
}

/**
 * Se true, o registo cliente exige telemóvel confirmado por SMS (quando a API SMS está activa).
 * `ALLOW_SIGNUP_WITHOUT_PHONE_SMS=1` desliga essa exigência em qualquer ambiente.
 * Em **development**, por defeito o SMS não bloqueia; para forçar SMS: `REQUIRE_PHONE_SMS_FOR_SIGNUP=1`.
 * Em **produção** Twilio + `ALLOW_CLIENT_PHONE_VERIFY` **não** implicam SMS obrigatório: sem isto, o utilizador
 * cria a conta com o telefone só recolhido, sem depender de entregas de SMS a PT (trial, geo, etc.). Para tornar
 * o SMS bloqueante no registo, defina explicitamente `REQUIRE_PHONE_SMS_FOR_SIGNUP=1`.
 */
export function isPhoneSmsRequiredForClientSignup(): boolean {
  if (process.env.ALLOW_SIGNUP_WITHOUT_PHONE_SMS === "1") return false;
  if (process.env.NODE_ENV === "development" && process.env.REQUIRE_PHONE_SMS_FOR_SIGNUP !== "1") {
    return false;
  }
  if (process.env.REQUIRE_PHONE_SMS_FOR_SIGNUP !== "1") {
    return false;
  }
  return isPhoneVerificationApiEnabled();
}
