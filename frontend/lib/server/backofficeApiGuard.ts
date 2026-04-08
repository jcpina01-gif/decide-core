import type { NextApiResponse } from "next";
import { isBackofficeEnabled } from "../backofficeGate";

/** @returns true if request must stop (already sent 404). */
export function denyIfBackofficeDisabled(res: NextApiResponse): boolean {
  if (!isBackofficeEnabled()) {
    res.status(404).json({ ok: false, error: "not_found" });
    return true;
  }
  return false;
}
