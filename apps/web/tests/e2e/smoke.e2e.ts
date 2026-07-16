import { expect, test } from "@playwright/test";

test("serves the web app and API app together", async ({ page, request }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Point to a line/i }),
  ).toBeVisible();

  const response = await request.get("/api/ready");
  expect(response.ok()).toBe(true);
});
