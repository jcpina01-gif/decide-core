import type { GetServerSideProps } from "next";

export default function BackofficeKpiDiagnosticsRedirect() {
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
