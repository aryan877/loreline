import { describe, expect, it } from "vitest";
import { currentUserResponseSchema } from "./auth";

describe("current user contract", () => {
  const user = {
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
  };

  it("preserves a Google profile image URL", () => {
    const image = "https://lh3.googleusercontent.com/a/profile";
    const result = currentUserResponseSchema.parse({
      user: { ...user, image },
    });

    expect(result.user.image).toBe(image);
  });

  it("accepts users without a profile image", () => {
    expect(
      currentUserResponseSchema.safeParse({ user: { ...user, image: null } })
        .success,
    ).toBe(true);
    expect(currentUserResponseSchema.safeParse({ user }).success).toBe(true);
  });
});
