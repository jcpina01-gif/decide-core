import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="pt">
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      <body style={{ margin: 0, background: "transparent", color: "var(--text-primary)" }}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}