export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "decide-frontend",
    backend: "http://127.0.0.1:8090"
  });
}