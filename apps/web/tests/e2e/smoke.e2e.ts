import { expect, test } from "@playwright/test";

test("serves the web app and API app together", async ({ page, request }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Point to a line/i }),
  ).toBeVisible();

  const response = await request.get("/api/ready");
  expect(response.ok()).toBe(true);
});

test("returns OAuth failures to a clean sign-in screen", async ({ page }) => {
  await page.goto("/sign-in?error=access_denied");

  await expect(
    page.getByText("Google sign-in wasn’t completed. Please try again."),
  ).toBeVisible();
  await expect(page).toHaveURL("/sign-in");
});
