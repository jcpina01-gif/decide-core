import dynamic from "next/dynamic";

/**
 * Registo depende de localStorage/sessionStorage e de APIs do browser; em Windows o SSR desta
 * página por vezes falha (500) por cache `.next` / EPERM. Carregar só no cliente evita erro de
 * servidor e alinha com o comportamento real do fluxo.
 */
const RegisterForm = dynamic(() => import("./RegisterForm"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#a1a1aa",
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      A carregar…
    </div>
  ),
});

export default RegisterForm;
