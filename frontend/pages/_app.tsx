import type { AppProps } from "next/app";
import { Nunito } from "next/font/google";
import AppLayout from "../components/AppLayout";
import EnterKeySubmitGlobal from "../components/EnterKeySubmitGlobal";
import "../styles/globals.css";

const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AppLayout className={nunito.className}>
      <EnterKeySubmitGlobal />
      <Component {...pageProps} />
    </AppLayout>
  );
}
