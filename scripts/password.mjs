import { pbkdf2Sync, randomBytes } from "node:crypto";
import readline from "node:readline";
console.log(
  "Generate OWNER_PASSWORD_HASH locally; paste the hash into .dev.vars or Wrangler secret input.",
);
process.stdout.write("Owner password (input hidden): ");
async function readPassword() {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    const value = await new Promise((resolve) => rl.once("line", resolve));
    rl.close();
    return String(value);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (data) => {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.exit(1);
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}
const password = await readPassword();
if (password.length < 14 || password.length > 256)
  throw new Error("Use a password between 14 and 256 characters.");
const salt = randomBytes(16).toString("hex");
console.log(
  `pbkdf2$100000$${salt}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex")}`,
);
