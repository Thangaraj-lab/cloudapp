# Test datasets (real, public)

Load 1–4 with **Upload my file** (Welcome → Connect). Load 5 under **Data sources → CPU utilization**.

| # | File | Size | Source | What it is | Checked through the app engine |
|---|---|---|---|---|---|
| 1 | `1_focus_sample_aws.csv` | 0.75 MB | [FinOps Foundation FOCUS-Sample-Data](https://github.com/FinOps-Open-Cost-and-Usage-Spec/FOCUS-Sample-Data) `FOCUS-1.0/focus_sample.csv` | FOCUS 1.0 export, AWS, Sept 2024, 1,000 lines | Auto-mapped; 782 daily rows, 30 days, $22.86, 33 services. No anomalies (too small). |
| 2 | `2_focus_sample_100000.csv.gz` | 9.2 MB | same repo, `focus_sample_100000.csv.gz` | 100,000 FOCUS lines, gzipped (tests the .gz path) | 35,469 daily rows, $2,614.39, 95 services, 547 non-usage rows kept apart. **2 cases + 19 service signals.** A few stray March rows leave date gaps (Data health flags them). |
| 3 | `3_azure_EA-Cost-FOCUS_1.0.csv` | 204 MB | [Microsoft FinOps toolkit](https://github.com/microsoft/finops-toolkit) `src/open-data/dataset-examples` | Azure Cost Management export in FOCUS 1.0 format, June 2024 | 135,272 lines → 3,146 daily rows, 19 days, $35,425.22, 35 services. **1 case + 1 signal.** |
| 4 | `4_azure_EA-Cost-Actual.csv` | 141 MB | same folder, `EA-Cost-Actual.csv` | The same Azure costs in the native "Actual cost" export format | 135,253 lines → 14,272 daily rows, $35,425.22 (matches #3), 343 products. **1 case.** |
| 5 | `5_azure_vm_utilization_50k_demo-priced.csv` | 6 MB | built from [Azure Public Dataset V1](https://github.com/Azure/AzurePublicDataset) `vmtable.csv.gz` (also kept here, 163 MB, with `5_azure_schema.csv`) | Real VM CPU: average, max, P95 and lifetime for the first 50,000 VMs | 50,000 VMs read; **917 idle** (avg CPU < 5%, P95 < 20%, ≥ 14 days). |

Notes
- Files 3 and 4 are large. The browser streams them, but expect 10–30 seconds to import.
- File 5: the original trace has no header and no prices. I added the header from `5_azure_schema.csv`, shortened the hashed VM ids to 16 characters, and added `monthly_cost_usd` = cores × **$30 per core per month**. That is a stated **demo price** (the same one the app uses for its paired Azure sample), not a real bill. The CPU numbers are real.
- The Azure trace is not linked to any billing file. Treat it as paired demo data for idle detection, as the app's labels say.
