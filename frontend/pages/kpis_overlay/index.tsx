/**
 * /kpis_overlay — página de debug (obsoleta).
 * Redireccionada para o back-office: /backoffice/rolling-diagnostics
 */
import type { GetServerSideProps } from "next";

export default function KpisOverlayRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/backoffice/rolling-diagnostics",
      permanent: false,
    },
  };
};
