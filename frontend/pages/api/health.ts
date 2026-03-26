export default function handler(req, res) {
  const backend =
    process.env.DECIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_DECIDE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8090";
  res.status(200).json({
    ok: true,
    service: "decide-frontend",
    backend
  });
}