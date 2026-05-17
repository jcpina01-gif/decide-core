import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import { isBackofficeEnabled } from "./backofficeGate";
import { isValidSessionCookie } from "../pages/api/backoffice/auth";

function hasValidSession(ctx: GetServerSidePropsContext): boolean {
  // Mock the NextApiRequest shape that isValidSessionCookie expects
  const req = ctx.req as Parameters<typeof isValidSessionCookie>[0];
  return isValidSessionCookie(req);
}

export const backofficeGetServerSideProps: GetServerSideProps = async (ctx) => {
  if (!isBackofficeEnabled()) return { notFound: true };

  // If a back-office password is configured, require the session cookie
  const adminPwd = process.env.DECIDE_BACKOFFICE_PASSWORD?.trim();
  if (adminPwd && !hasValidSession(ctx)) {
    const dest = encodeURIComponent(ctx.resolvedUrl ?? "/backoffice");
    return { redirect: { destination: `/backoffice/login?next=${dest}`, permanent: false } };
  }

  return { props: {} };
};
