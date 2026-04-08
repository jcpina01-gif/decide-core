import { useState } from "react";
import type { ClientPendingTextLinkProps } from "./ClientPendingTextLink";
import ClientPendingTextLink from "./ClientPendingTextLink";
import ClientFundDepositBlockedDialog from "./ClientFundDepositBlockedDialog";
import { useFundDepositEligibility } from "../hooks/useFundDepositEligibility";
import { CLIENT_FUND_ACCOUNT_HREF } from "./ClientMainNav";

export type ClientFundDepositNavLinkProps = Omit<ClientPendingTextLinkProps, "href"> & {
  href?: ClientPendingTextLinkProps["href"];
};

/**
 * Ligação para `/client/fund-account` que, se o registo não estiver completo (incl. IBKR na app),
 * abre um diálogo em vez de navegar.
 */
export default function ClientFundDepositNavLink({
  href = CLIENT_FUND_ACCOUNT_HREF,
  onClick,
  children,
  ...rest
}: ClientFundDepositNavLinkProps) {
  const unlocked = useFundDepositEligibility();
  const [blockedOpen, setBlockedOpen] = useState(false);

  return (
    <>
      <ClientPendingTextLink
        {...rest}
        href={href}
        onClick={(e) => {
          onClick?.(e);
          if (!unlocked) {
            e.preventDefault();
            setBlockedOpen(true);
          }
        }}
      >
        {children}
      </ClientPendingTextLink>
      <ClientFundDepositBlockedDialog open={blockedOpen} onClose={() => setBlockedOpen(false)} />
    </>
  );
}
