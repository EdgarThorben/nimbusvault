// Creates (or resets the password of) Leo's login. The app has no other accounts.
//   LEO_EMAIL=leo@example.com LEO_PASSWORD='…' npm run db:seed
import "dotenv/config";
import { db } from "../src/db/client";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";

const email = process.env.LEO_EMAIL?.trim().toLowerCase();
const password = process.env.LEO_PASSWORD;
if (!email || !password || password.length < 10) {
  console.error("Set LEO_EMAIL and LEO_PASSWORD (at least 10 characters).");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
await db
  .insert(users)
  .values({ email, passwordHash, displayName: "Leo" })
  .onConflictDoUpdate({ target: users.email, set: { passwordHash } });

console.log(`Login ready for ${email}`);
process.exit(0);
