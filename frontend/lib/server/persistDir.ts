import * as os from "os";
import path from "path";

/**
 * Pasta para ficheiros JSON usados pelas API routes (rate limit, OTP pendente, etc.).
 * Na Vercel (e Lambda) o cwd do projecto é só leitura — gravações em `.data/` rebentam com EROFS → HTTP 500.
 */
export function getServerPersistDir(): string {
  const serverless =
    process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (serverless) {
    return path.join(os.tmpdir(), "decide-core-data");
  }
  return path.join(process.cwd(), ".data");
}
