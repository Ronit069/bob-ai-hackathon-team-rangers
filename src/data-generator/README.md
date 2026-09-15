# data-generator/ — seeded synthetic fixtures + deterministic ground truth

Python 3.11 **standard library only**. No ML. No real data. No regulatory claims.

## Usage

```bash
cd src/data-generator

# Generate fixtures + ground truth (deterministic)
python generate.py --seed 20260914 --now 2026-09-14T09:00:00Z --out ../../data/seed

# Validate existing fixtures
python validate.py --dir ../../data/seed

# Run the generator test suite (48 tests)
python -m unittest discover -s tests -t .
```

Then, from `src/backend`:

```bash
npm run validate       # fast pre-seed referential check
npm run seed           # load fixtures into PostgreSQL (transactional; truncates by default)
node scripts/verify-seed.js   # compare the real JS services against the Python ground truth
```

## Layout

```text
data-generator/
├── generate.py               # CLI: build + validate + export
├── validate.py               # CLI: validate exported fixtures
├── chainsentinel/
│   ├── common.py             # vocabularies, seed policies, time helpers
│   ├── logistics.py          # carriers, routes, segments, shipments, disruptions, fleet
│   ├── coldchain.py          # cargo profiles, policies, sensor readings (scenario patterns)
│   ├── groundtruth.py        # Python mirrors of the frozen JS rules (expected outputs)
│   └── validator.py          # contract + scenario + ground-truth consistency checks
└── tests/                    # unittest: generator, validator, ground-truth formulas
```

## Reproducibility

- Same `--seed` **and** `--now` → byte-identical `logistics.json`, `coldchain.json`, `ground_truth.json` (verified by SHA-256).
- All randomness flows through one seeded `random.Random` instance (filler values only; scenario values are explicit).
- `--now` anchors every timestamp; the default is the frozen demo window `2026-09-14T09:00:00Z`.

## Outputs (`data/seed/`)

| File | Contents |
|---|---|
| `logistics.json` | carriers, routes, route_segments, shipments, disruptions, fleet_assets, asset_assignments |
| `coldchain.json` | cargo_profiles, temperature_policies, sensor_readings |
| `ground_truth.json` | expected matching, excursions, review flags, fleet idle/exclusions, redeployment, alternatives, risk, per-scenario expectations |

Ground truth is **not** seeded into PostgreSQL: fixtures are inputs, ground truth is the expected output used by tests and verification.
