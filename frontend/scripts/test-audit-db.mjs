import { neon } from "@neondatabase/serverless";
const sql = neon("postgresql://neondb_owner:npg_m28HwsDAWilY@ep-summer-forest-ap9j1a6k-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");

console.log("Testing DB write...");
await sql(
  "INSERT INTO order_logs (id,client_id,ticker,side,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())",
  ["test-debug-001", "jcpina01", "TEST", "SELL", "submitted"]
);
console.log("Write OK");

const rows = await sql("SELECT id,client_id,ticker,status FROM order_logs ORDER BY created_at DESC LIMIT 10");
console.log("All order_logs:", JSON.stringify(rows, null, 2));

await sql("DELETE FROM order_logs WHERE id=$1", ["test-debug-001"]);
console.log("Cleanup OK — DB is working correctly");
