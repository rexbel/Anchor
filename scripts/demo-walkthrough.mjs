// Walks the full demo in a real browser and saves screenshots.
// Usage: BASE_URL=http://localhost:3000 node scripts/demo-walkthrough.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, ...opts });
const step = (msg) => console.log(`✓ ${msg}`);

// Reset to seeded state.
await page.request.post(`${BASE}/api/reset`);

// 1. Dashboard
await page.goto(BASE);
await page.getByRole("heading", { name: /Your agentic life alert/ }).waitFor();
await page.getByText("Jordan R.").first().waitFor();
await shot("01-dashboard");
step("dashboard");

// 2. Tier 3 inbound call (the judge moment)
await page.getByRole("link", { name: "Run the Tier 3 demo" }).click();
await page.getByRole("heading", { name: "Inbound call" }).waitFor();
await page.getByRole("button", { name: /Inbound disclosure/ }).click();
await shot("02-inbound-call");
await page.getByRole("button", { name: "Send to Anchor" }).click();
await page.getByText("Processing on the GB10").waitFor();
await page.waitForTimeout(700);
await shot("03-processing", { fullPage: false });
await page.getByText("escalate_to_clinician() fired. Always open, never gated.").waitFor({ timeout: 15000 });
await shot("04-tier3-result");
step("tier 3 escalation");
await page.getByRole("button", { name: "Finish check-in" }).click();
await page.getByText("Check-in complete").waitFor();
await shot("05-confirmation");
step("confirmation");

// 3. Tier 2: complex patient, third consecutive craving -> gated pattern flag
await page.goto(`${BASE}/checkin/demo-patient-complex?direction=outbound`);
await page.getByRole("heading", { name: "Scheduled check-in" }).waitFor();
for (const expected of ["Resolved in conversation", "held at the OpenShell gate"]) {
  await page.getByRole("button", { name: /Situational craving/ }).click();
  await page.getByRole("button", { name: "Send to Anchor" }).click();
  await page.getByText(expected).waitFor({ timeout: 15000 });
  if (expected.includes("gate")) await shot("06-tier2-pattern");
  else {
    await shot("06a-tier1-craving");
    await page.getByRole("button", { name: "Try another response" }).click();
    await page.getByRole("button", { name: "Send to Anchor" }).waitFor();
  }
}
step("tier 1 then tier 2 on third craving");

// 4. Draft a scheduled call from the queue -> held at the gate
await page.goto(BASE);
await page.getByRole("row", { name: /Bridge-Scenario J\./ }).getByRole("button", { name: /Draft script/ }).click();
await page.getByRole("row", { name: /Bridge-Scenario J\./ }).getByText("Awaiting approval").waitFor();
step("script drafted and gated");

// 5. Clinician queue: approve both gate requests, resolve the escalation
await page.goto(`${BASE}/clinician?tab=gate`);
await page.getByRole("button", { name: /Approve and execute/ }).first().waitFor();
await shot("07-openshell-gate");
while ((await page.getByRole("button", { name: /Approve and execute/ }).count()) > 0) {
  await page.getByRole("button", { name: /Approve and execute/ }).first().click();
  await page.waitForTimeout(400);
}
step("gate approvals");
await page.getByRole("tab", { name: /Escalations/ }).click();
await page.getByLabel("Resolution note").first().fill("Reached the patient by phone. Safety plan reviewed with the care team.");
await shot("08-escalation-queue");
await page.getByRole("button", { name: "Mark resolved" }).first().click();
await page.getByText(/Resolved by Dr\. M\. Alvarez/).waitFor();
step("escalation resolved by clinician");

// 6. Audit log shows commit before handoff
await page.goto(`${BASE}/audit`);
await page.getByText("Escalation committed").first().waitFor();
await shot("09-audit-log");
step("audit log");

await page.goto(`${BASE}/how-it-works`);
await page.getByRole("heading", { name: "How Anchor works" }).waitFor();
await shot("10-how-it-works");
step("how it works");

// Mobile check
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/checkin/demo-patient-edge?direction=inbound`);
await page.getByRole("heading", { name: "Inbound call" }).waitFor();
await shot("11-mobile-checkin", { fullPage: false });
step("mobile viewport");

await browser.close();
if (errors.length) {
  console.error("Browser errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Demo walkthrough passed with no browser errors.");
