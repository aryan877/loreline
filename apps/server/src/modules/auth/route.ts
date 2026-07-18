import { auth } from "@/modules/auth/service";

export const handleAuth = (request: Request) => auth.handler(request);
