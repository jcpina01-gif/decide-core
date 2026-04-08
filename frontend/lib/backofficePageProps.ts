import type { GetServerSideProps } from "next";
import { isBackofficeEnabled } from "./backofficeGate";

export const backofficeGetServerSideProps: GetServerSideProps = async () => {
  if (!isBackofficeEnabled()) return { notFound: true };
  return { props: {} };
};
