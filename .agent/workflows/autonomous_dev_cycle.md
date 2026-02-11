---
description: enforce rigorous testing and verification before reporting success
---

# Autonomous Development Cycle

When the user asks for a feature or bug fix, you MUST follow this strict cycle. Do not skip steps.

## 1. Reproduction / Specification
- **Bug:** Create a reproduction script (e.g., `src/repro-issue.ts`) that fails. Run it to confirm failure.
- **Feature:** Create a verification script (e.g., `src/verify-feature.ts`) that asserts the expected behavior. Run it to confirm it fails (or doesn't pass yet).

## 2. Implementation
- Write the code to fix the bug or implement the feature.
- Follow architectural patterns (check KIs if applicable).

## 3. Verification
- Run the reproduction/verification script again.
- **CRITICAL:** It MUST pass. If it fails, return to Step 2. Do not ask the user for help unless blocked by missing info.
- If the fix requires a DB migration, run it and verify.

## 4. Build Check
- Run `npm run build` (or relevant build command) to ensure no compilation errors were introduced.
- If build fails, fix errors and repeat Step 3.

## 5. Report
- Only AFTER steps 1-4 are successful, report to the user.
- Provide proof: "I ran `verify-feature.ts` and it passed. I ran `npm run build` and it succeeded."
