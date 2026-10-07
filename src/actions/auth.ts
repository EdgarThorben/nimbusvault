import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { SESSION_COOKIE_NAME, createSession, deleteSession, verifyPassword } from "../lib/auth";

export const login = defineAction({
  accept: "form",
  input: z.object({
    email: z.email(),
    password: z.string().min(1),
  }),
  handler: async ({ email, password }, context) => {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new ActionError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
    }

    const session = await createSession(user.id);
    context.cookies.set(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });

    return { displayName: user.displayName };
  },
});

export const logout = defineAction({
  accept: "form",
  handler: async (_input, context) => {
    const sessionId = context.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionId) {
      await deleteSession(sessionId);
    }
    context.cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    return { success: true };
  },
});
