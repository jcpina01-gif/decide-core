import { neon } from "@neondatabase/serverless";
const sql = neon("postgresql://neondb_owner:npg_m28HwsDAWilY@ep-summer-forest-ap9j1a6k-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");

console.log("=== order_logs (all) ===");
const orders = await sql("SELECT id, client_id, ticker, side, status, created_at FROM order_logs ORDER BY created_at DESC LIMIT 20");
console.log(JSON.stringify(orders, null, 2));

console.log("\n=== client_approvals (all) ===");
const approvals = await sql("SELECT id, client_id, action, approved_at FROM client_approvals ORDER BY approved_at DESC LIMIT 10");
console.log(JSON.stringify(approvals, null, 2));

console.log("\n=== config_change_logs (all) ===");
const configs = await sql("SELECT id, client_id, change_type, changed_at FROM config_change_logs ORDER BY changed_at DESC LIMIT 10");
console.log(JSON.stringify(configs, null, 2));
