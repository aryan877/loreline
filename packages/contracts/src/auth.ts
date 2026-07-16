import { z } from "zod";

export const currentUserResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.email(),
  }),
});

export type CurrentUser = z.infer<
  typeof currentUserResponseSchema
>["user"];
