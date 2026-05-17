import type { NextApiRequest, NextApiResponse } from "next";
import { isBackofficeEnabled } from "../backofficeGate";
import { isValidSessionCookie } from "../../pages/api/backoffice/auth";

/** @returns true if request must stop (already sent 401/404). */
export function denyIfBackofficeDisabled(res: NextApiResponse, req?: NextApiRequest): boolean {
  if (!isBackofficeEnabled()) {
    res.status(404).json({ ok: false, error: "not_found" });
    return true;
  }
  // If a back-office password is configured, require the session cookie
  const adminPwd = process.env.DECIDE_BACKOFFICE_PASSWORD?.trim();
  if (adminPwd && req && !isValidSessionCookie(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return true;
  }
  return false;
}
