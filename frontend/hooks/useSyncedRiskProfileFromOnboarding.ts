import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { ONBOARDING_LOCALSTORAGE_CHANGED_EVENT } from "../components/OnboardingFlowBar";
import {
  DecideRiskProfile,
  ONBOARDING_LS_KEYS_SYNC_RISK_PROFILE,
  persistOnboardingRiskProfile,
  readDefaultRiskProfileFromOnboarding,
} from "../lib/decideOnboardingRiskProfile";

const RISK_PROFILE_EVENT = "decide_onboarding_risk_profile_changed";

/**
 * Perfil de risco alinhado ao onboarding (localStorage MiFID + `decide_onboarding_risk_profile_v1`).
 * - Inicializa a partir do onboarding quando existir.
 * - Actualiza quando o onboarding muda (eventos, outro separador, regresso de rotas como `/mifid-test`).
 * - Alterações no selector gravam com `persistOnboardingRiskProfile` para manter uma única fonte de verdade.
 */
export function useSyncedRiskProfileFromOnboarding(): {
  profile: DecideRiskProfile;
  setProfile: (p: DecideRiskProfile) => void;
} {
  const router = useRouter();
  const [profile, setProfileState] = useState<DecideRiskProfile>("moderado");

  const applyFromOnboarding = useCallback(() => {
    const p = readDefaultRiskProfileFromOnboarding();
    if (p) setProfileState(p);
  }, []);

  useEffect(() => {
    applyFromOnboarding();
  }, [applyFromOnboarding]);

  useEffect(() => {
    const onSync = () => applyFromOnboarding();
    window.addEventListener(RISK_PROFILE_EVENT, onSync);
    window.addEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, onSync);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !ONBOARDING_LS_KEYS_SYNC_RISK_PROFILE.includes(e.key)) return;
      onSync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RISK_PROFILE_EVENT, onSync);
      window.removeEventListener(ONBOARDING_LOCALSTORAGE_CHANGED_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyFromOnboarding]);

  useEffect(() => {
    const onRoute = () => applyFromOnboarding();
    router.events?.on("routeChangeComplete", onRoute);
    return () => {
      router.events?.off("routeChangeComplete", onRoute);
    };
  }, [router, applyFromOnboarding]);

  const setProfile = useCallback((p: DecideRiskProfile) => {
    setProfileState(p);
    persistOnboardingRiskProfile(p);
  }, []);

  return { profile, setProfile };
}
