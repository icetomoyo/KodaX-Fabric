import "../config.js";
import { refreshEmployeeDingtalkPresence } from "../lib/employee-dingtalk-presence.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const enterprises = await refreshEmployeeDingtalkPresence({ dryRun });
  console.log(JSON.stringify({ dryRun, enterprises }, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
