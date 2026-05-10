import { useEffect } from "react";
import { useRouter } from "next/router";

export default function LogoutPage() {
  const router = useRouter();
  useEffect(() => {
    // Clear any session/auth data if needed
    try { localStorage.removeItem("decide_auth"); } catch {}
    router.replace("/");
  }, [router]);
  return null;
}
