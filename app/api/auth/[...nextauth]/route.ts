import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth/options";

/** Google ログインの入口と戻り先（next-auth が両方さばく） */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
