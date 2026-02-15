---
description: enforce rigorous testing and verification before reporting success
---

# Autonomous Universal Dev Cycle

When the user asks for a feature or bug fix, you MUST follow this strict cycle. Do not skip steps.

## 1. Discovery & Environment Setup
- **Analyze:** Identify the stack (Python, JS, Go, etc.) by checking config files.
- **Environment:** If dependencies are missing, install them autonomously (npm install, pip install, etc.).
- **Infrastructure:** Start required services (Databases, Redis) using docker-compose if present.

## 2. Reproduction / Specification
- **Bug:** Create a reproduction script (e.g., `repro.ts` or `test_fix.py`) that fails. Run it to confirm failure.
- **Feature:** Create a verification script/test that asserts the expected behavior. 

## 3. Implementation
- Write the code to fix the bug or implement the feature.
- Follow existing architectural patterns in the project.

## 4. Verification & Self-Correction (CRITICAL)
- **Execution:** Run the verification scripts.
- **UI/Integration:** If it's a web app, run a headless check (e.g., Playwright) to ensure the UI function works.
- **Loop:** If tests fail, analyze the terminal output, apply fixes, and REPEAT Step 4. 
- **Wait Policy:** Do not ask the user for help unless you are stuck for more than 3 correction attempts.

## 5. Build & Docs
- Run `build` commands to ensure no regression.
- Update `README.md` or API docs if logic has changed.

## 6. Report
- Only AFTER steps 1-5 are successful, report to the user.
- Provide proof: "I ran tests, they passed, and the build is stable."