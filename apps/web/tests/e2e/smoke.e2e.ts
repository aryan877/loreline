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

test("creates nested stacks and confirms recursive deletion", async ({
  page,
}) => {
  const email = `stack-flow-${Date.now()}@example.invalid`;

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Stack Flow Check");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("temporary-password-20260719");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  await page.getByRole("button", { name: /Stack Flow Check/ }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Settings/i })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New stack" }).click();
  await page.getByLabel("Stack name").fill("Work");
  await page.getByRole("button", { name: "Create stack" }).click();
  await page.getByRole("link", { name: /Work/ }).click();

  await page.getByRole("button", { name: "New stack" }).click();
  await page.getByLabel("Stack name").fill("History");
  await page.getByRole("button", { name: "Create stack" }).click();
  await page.getByRole("button", { name: "Shelf" }).click();

  await page.getByRole("button", { name: "Actions for Work" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("1 nested stack", { exact: true })).toBeVisible();
  await page.getByLabel(/Type Work to confirm/).fill("Work");
  await page.getByRole("button", { name: "Delete stack" }).click();
  await expect(page.getByRole("link", { name: /Work/ })).toHaveCount(0);
});
