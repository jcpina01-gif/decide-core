import { useEffect } from "react";
import { useRouter } from "next/router";

/** Página «Plano» removida — redireciona para Recomendações no Dashboard. */
export default function PlanRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/client-dashboard");
  }, [router]);
  return null;
}
