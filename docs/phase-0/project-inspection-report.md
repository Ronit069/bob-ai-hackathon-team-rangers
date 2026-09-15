# Phase 0 — Project Inspection Report

**Project:** L2 — Supply Chain Disruption Assistant & Fleet Utilisation Optimizer (Bobathon 2026)
**Inspected by:** OpenCode Go / DeepSeek V4.1 Flash (buildathon technical lead role)
**Date:** 2026-09-14
**Working project name:** ChainSentinel *(conflict with "ChainPulse" — see Conflicts §5; final name requires team approval)*

---

## 1. How this inspection was performed

- Full recursive listing of `C:\Users\ronit\Desktop\Bobathon` (including hidden files).
- Complete read of both Markdown documents in the project folder.
- Complete text extraction and read of `ChainSentinel_L2_Solution_Blueprint.docx` (Word document XML parsed directly).
- Complete text extraction and read of `Bobathon_Submission_Template_Guide.pdf` (ASCII85 + Flate streams decoded directly).
- Search of `Desktop` and `Downloads` for the official Industry Problem Statements document, because it was **not present in the project folder**.
- Complete text extraction and read of `Industry Problem Statements - 2026.pdf` (found in `C:\Users\ronit\Downloads`).
- Complete read of two additional variant DOCX files found in `C:\Users\ronit\Downloads` (`L2_Main_Project_Document.docx`, `L2_Two_Person_Execution_Plan.docx`).
- No files were modified during inspection.

---

## 2. What files exist

### 2.1 Inside the project folder (`C:\Users\ronit\Desktop\Bobathon`)

| File | Type | Size | Role |
|---|---|---|---|
| `Bobathon_Submission_Template_Guide.pdf` | PDF | 22 KB | **Authoritative** — packaging, repo structure, evaluation rubric, submission checklist |
| `ChainSentinel_L2_Solution_Blueprint.docx` | DOCX | 623 KB | **Reference** — design blueprint (problem analysis, AI/ML decisions, architecture, data, workflow, evaluator Q&A) |
| `Document1_Proposal_and_Technical_Design.md` | Markdown | 59 KB | **Reference** — detailed proposal ("ChainPulse"): modules, formulas, 25-scenario test matrix, API list, UI spec |
| `Document2_Implementation_Execution_Contribution_Plan.md` | Markdown | 30 KB | **Reference** — two-person execution plan, phases, backlog sample, checkpoints, risk register |

### 2.2 Found outside the project folder (relevant)

| File | Location | Role |
|---|---|---|
| `Industry Problem Statements - 2026.pdf` | `C:\Users\ronit\Downloads` | **Authoritative** — the official L2 problem statement (source of truth for required features) |
| `L2_Main_Project_Document.docx` | `C:\Users\ronit\Downloads` | **Reference (superseded variant)** — earlier "SupplyChain Sentinel" design; content substantially covered by Document 1 |
| `L2_Two_Person_Execution_Plan.docx` | `C:\Users\ronit\Downloads` | **Reference (superseded variant)** — earlier execution plan; content substantially covered by Document 2 |

### 2.3 Nothing else exists

- No `src/`, `frontend/`, `backend/`, `data/`, `demo/`, `presentation/`, or `docs/` folders existed before this Phase 0 work.
- No `README.md`, `submission.yaml`, `package.json`, `.env`, or any source code.
- The folder is **not a git repository** (`git status` → `fatal: not a git repository`).
- No hidden files.

---

## 3. Authoritative vs reference documents

| Document | Status | Why |
|---|---|---|
| `Industry Problem Statements - 2026.pdf` (Downloads) | **Authoritative** | Official organiser document; defines the L2 challenge. Note: it is not in the project folder — should be copied into the repo as a reference during repo setup. |
| `Bobathon_Submission_Template_Guide.pdf` | **Authoritative** | Official organiser document; defines required repo structure, files, demo evidence, and the 100-point rubric. |
| `ChainSentinel_L2_Solution_Blueprint.docx` | Reference only | Design proposal. Explicitly states it was generated from the two official PDFs. Contains `[PROPOSED]`, `[ENHANCEMENT]`, `[ASSUMPTION]` labels. **Not proof that any code exists.** |
| `Document1_Proposal_and_Technical_Design.md` | Reference only | More detailed design ("ChainPulse"). Good source for formulas, data model, API list, test matrix. Not authoritative, not implemented. |
| `Document2_Implementation_Execution_Contribution_Plan.md` | Reference only | Team process plan. Good source for phases, ownership split, checkpoints. Not authoritative. |
| Downloads DOCX variants | Reference only (superseded) | Earlier drafts with a third project name. Use only if they contain something the project-folder docs lack. |

**Rule adopted for Phase 0:** official PDFs are the source of truth for *what must be built and how it is judged*; the blueprint and Documents 1–2 are design inputs to be reconciled, not implementation evidence.

---

## 4. Implementation status

| Area | Status |
|---|---|
| Source code | **None** — no files exist |
| Dependencies / package manifests | **None** |
| Database / migrations | **None** |
| Synthetic datasets | **None** |
| Tests | **None** |
| Git history / branches | **None** (folder is not a repo) |
| README / submission files | **None** |
| Planning documents | **Only the four documents listed above** (proposals, not frozen contracts) |

**Verdict: the folder is a documents-only, pre-implementation project.** Nothing is partially implemented; nothing was deleted or overwritten by this Phase 0 work.

---

## 5. Conflicts between documents

| # | Conflict | Detail | Resolution in Phase 0 docs |
|---|---|---|---|
| C1 | **Project name** | `ChainPulse` (Document 1) vs `ChainSentinel` (Blueprint) vs `SupplyChain Sentinel` (Downloads variants) | Use **ChainSentinel** as working name; final name is an approval item (Review Checklist Q1) |
| C2 | **Requirement count** | Official PDF states 4 challenge bullets (bullet 4 bundles monitor + detect + classify). Document 1 splits into 6 requirements; the team brief also specifies 6 | Requirements matrix uses **6 mandatory requirements (R1–R6)**, each traced to the official bullet |
| C3 | **Backend stack** | Document 1 selects Node.js/Express. Blueprint proposes "FastAPI (Python) or Node/Express". Downloads variant says "FastAPI or Node.js/Express; PostgreSQL or MongoDB" | ADR-001 selects **Node.js + Express + PostgreSQL** — one language across the app; Python used only for data generation |
| C4 | **Bob integration method** | Document 1: 10 tool definitions mapping 1:1 to REST endpoints. Blueprint: 5 MCP tools including GenAI unstructured-text extraction | ADR-004 selects **REST-first + thin MCP tool server**; tool list is frozen in the API contract. Unstructured-text extraction is **not MVP** (disruptions are created via form/API) |
| C5 | **ML stance** | Both documents mark ML optional/future; Document 1 excludes ML from MVP entirely; Blueprint proposes optional risk-scoring ML and sensor anomaly detection | Scope freeze: **no ML in MVP**; ML listed under Future production scope |
| C6 | **Disruption matching granularity** | Document 1: region-level matching (no PostGIS). Blueprint: PostGIS spatial queries with bounding-box fallback | ADR/scope freeze: **region-code matching** (deterministic, simple); geometry/PostGIS is future scope |
| C7 | **Scope size** | Document 1's MVP lists 14 modules and a 25-scenario test matrix; blueprint suggests 150–300 shipments, 30–50 assets, 4–6 trade lanes | Scope freeze keeps the 6 official capabilities + minimum supporting features; dataset sized for demo (see data contract / phase plan) |
| C8 | **Bob chat UI vs Bob CLI** | Documents assume an embedded chat panel; the submission guide's example shows IBM Bob CLI calling an MCP server | MVP: MCP tool server + grounding tests are mandatory; embedded chat proxy is **conditional on credentials**. Dashboard works with Bob disabled |
| C9 | **Repo structure** | Phase 0 docs live in `docs/phase-0/`; the submission template mandates `docs/problem-statement.md`, `docs/solution-overview.md`, `docs/architecture.md`, `docs/setup-guide.md` at fixed paths | Both coexist; extra files are allowed by the template FAQ. Required template docs are produced in Phase 7 (some drafted earlier) — mapped in `phase-plan.md` |
| C10 | **Timeline** | Document 2 offers 3-day, 7-day and 14-day plans; the actual deadline is unknown | Phase plan is deadline-agnostic with gates; a default 7-day sequence is noted. Deadline is an open question |
| C11 | **Test matrix** | Document 1 defines 25 scenarios; Downloads variant defines a 10-scenario list | 25-scenario matrix retained as the target; 10 core scenarios are the minimum gate |

No conflict requires discarding work: all are design-level and are resolved by the frozen Phase 0 documents.

---

## 6. Gaps to close before Phase 1

| Gap | Action |
|---|---|
| Official problem statement PDF is outside the repo | Copy into `docs/reference/` when the repo is created |
| No git repository | Create repo from the official template (do not fork) — Phase 0/1 bootstrap task P0-08 |
| No `submission.yaml`, `README.md`, template folders | Bootstrap from template in Phase 0/1 (P0-08), fill content in later phases |
| Team member names/emails unknown | Required for `submission.yaml`; open question Q2 |
| Bob credentials/availability unknown | `BOB_ENABLED` design already covers the offline case; confirm Bob access method (Q3) |
| Event deadline unknown | Confirm and pin the 3/7/14-day plan choice (Q4) |
| Temperature policy values are illustrative | Keep configurable; label as placeholders, never as regulatory truth (already enforced in the data contract) |

---

## 7. What this inspection did NOT do

- No source code was created.
- No dependencies were installed.
- No datasets were generated.
- No existing document was deleted, renamed or rewritten.
- No claim is made that any proposed feature is implemented — nothing is implemented yet.
