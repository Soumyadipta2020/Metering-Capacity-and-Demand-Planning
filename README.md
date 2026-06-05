# ABC Smart Meter Capacity and Demand Planning Platform

ABC is a Flask-based planning and analytics application for smart meter appointment operations. It combines appointment journey analytics, dialler performance, cancellation risk, engineer capacity planning, financial scenario modelling, and single-meter lookup into one browser-based dashboard.

The repository is self-contained: it includes the Flask API, the single-page frontend, analytics engines, synthetic operational datasets, SQLite cache support, Docker/Render deployment files, and smoke tests.

## What This App Does

- Tracks the journey from customer contact through booking, completion, cancellation, and abort outcomes.
- Forecasts contact attempts, appointment demand, and field resource requirements.
- Highlights D-1 cancellation and same-day abort patterns by reason, supplier, region, and period.
- Models engineer capacity, patch-level utilisation, absence, bank holidays, and workforce rebalancing options.
- Simulates financial impact across revenue, cost, margin, completion rates, and operational scenarios.
- Provides dialler performance views by time slot, business type, channel, and agent.
- Offers a single meter view for grouped visit and meter history.
- Includes a floating chatbot endpoint that can use Hugging Face Inference Providers when configured.

## Technology Stack

| Area | Technology |
| --- | --- |
| Backend | Python, Flask, Flask-CORS |
| Frontend | HTML, CSS, vanilla JavaScript |
| Charts | Chart.js |
| Data | CSV inputs with optional SQLite acceleration |
| Analytics | Python engine modules |
| Testing | Python unittest smoke tests |
| Deployment | Gunicorn, Docker, Docker Compose, Render |

## Quick Start

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open the app at:

```text
http://localhost:5000
```

If the CSV data is missing or stale and `ABC_AUTO_GENERATE_DATA=true`, the app can refresh the rolling data window during startup. You can also regenerate data manually:

```bash
python engine/data_generator.py
```

## Configuration

Copy `.env.example` to `.env` for local development:

```bash
copy .env.example .env
```

Important settings:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Flask secret key. Set a strong value in production. |
| `PORT` | Local or production port. Defaults to `5000`. |
| `ENABLE_AI_RECOMMENDATIONS` | Enables the local recommendation endpoints when set to `true`. |
| `ABC_AUTO_GENERATE_DATA` | Allows startup data generation or rolling refresh when data is stale. |
| `ABC_SQLITE_ENABLED` | Enables the SQLite read cache at `data/abc.db`. |
| `ABC_DISABLE_AUTO_GENERATE_DATA` | Prevents automatic generation when set to `true`. |
| `HF_TOKEN` | Optional server-side token for the chatbot. |
| `HF_CHAT_PROVIDER` | Hugging Face provider name, for example `novita`. |
| `HF_CHAT_MODEL` | Chat model used by the chatbot proxy. |

The app can run without chatbot credentials. In that case, normal dashboards and APIs still work, but `/api/chatbot/message` will report missing Hugging Face configuration.

## Running Tests

```bash
python -m unittest tests.test_app_smoke
```

The smoke suite checks that:

- The main dashboard renders.
- Required data files are available.
- Core API endpoints return JSON.
- Region and filter endpoints are populated.
- Financial forecast months align to the current rolling window.
- Timeslot dashboard payloads contain expected sections.

If you have `pytest` installed, you can also run:

```bash
python -m pytest tests/test_app_smoke.py
```

## Project Structure

```text
Metering-Capacity-and-Demand-Planning/
|-- app.py                         Flask app, API routes, startup data checks
|-- requirements.txt               Python dependencies
|-- Dockerfile                     Container image definition
|-- docker-compose.yml             App + PostgreSQL local stack
|-- render.yaml                    Render deployment blueprint
|-- .env.example                   Local/production environment template
|-- tests/
|   `-- test_app_smoke.py          End-to-end API and page smoke tests
|-- templates/
|   `-- index.html                 Single-page dashboard shell
|-- static/
|   |-- css/
|   |   `-- style.css              App layout, theme, dashboard styling
|   |-- js/
|   |   |-- config.js              Shared ABC frontend utilities and icons
|   |   |-- theme.js               Theme persistence and theme-change events
|   |   |-- app.js                 View switching, global filters, chatbot, exports
|   |   |-- dashboard.js           Appointment journey dashboard
|   |   |-- forecasting.js         Contact attempt forecast dashboard
|   |   |-- cancellations.js       Risk and recovery dashboard
|   |   |-- field_ops.js           Resource planning and optimisation
|   |   |-- financial.js           Scenario impact dashboard
|   |   |-- timeslot.js            Dialler performance dashboard
|   |   |-- fieldscorecard.js      Engineer scorecard view
|   |   |-- roster.js              Roster timeline/pivot view
|   |   |-- longterm.js            Long-term capacity overview
|   |   `-- meterview.js           Single meter view
|   `-- data/
|       `-- gb-all.geo.json        UK geographic reference data
|-- engine/
|   |-- data_generator.py          Synthetic data generation
|   |-- date_windows.py            Rolling actual/forecast date windows
|   |-- date_roller.py             Date-only CSV rolling refresh
|   |-- ingestion.py               CSV/SQLite loading, filtering, health checks
|   |-- sqlite_store.py            SQLite cache builder and query helpers
|   |-- forecasting_engine.py      Forecasting and conversion analytics
|   |-- cancellation_engine.py     Cancellation, abort, and rebooking analytics
|   |-- field_ops_engine.py        Engineer capacity and optimisation logic
|   |-- financial_engine.py        Financial KPIs and scenario calculations
|   `-- ai_recommendations.py      Operational recommendation summaries
|-- data/
|   |-- abc.db                     Generated SQLite cache
|   `-- inputs/                    Source CSV inputs and manifest
|-- scripts/
|   |-- build_sqlite_store.py      Manual SQLite cache build
|   `-- refresh_data.py            Rolling data refresh helper
`-- deployment/
    `-- schema.sql                 Optional PostgreSQL schema
```

## Data Model

The app primarily reads from `data/inputs/`.

| File | Role |
| --- | --- |
| `master_operations.csv` | Main appointment/job ledger used by most dashboards. |
| `booking_journey.csv` | Weekly funnel aggregation for requests, bookings, cancellations, aborts, and completions. |
| `channel_volume.csv` | Daily contact/channel volume and booking conversion data. |
| `capacity_demand.csv` | Weekly regional and patch-level demand versus capacity. |
| `engineers.csv` | Engineer dimension data. |
| `field_engineers.csv` | Field engineer scorecard data. |
| `engineer_availability.csv` | Daily engineer availability, absence, and completed work. |
| `financial_data.csv` | Monthly revenue, cost, margin, and job-type financials. |
| `forecast_baseline_2025.csv` | Baseline forecast reference data. |
| `suppliers.csv` | Supplier reference list. |
| `manifest.json` | Actual and forecast date-window metadata. |

The rolling data window is managed by `engine/date_windows.py`. For the current dataset, actuals and forecasts are kept aligned to the app's rolling monthly profile.

## SQLite Cache

CSV files are the source of truth, but the app can build and read from `data/abc.db` for faster local queries.

Build or rebuild manually:

```bash
python scripts/build_sqlite_store.py
```

Check status from the running app:

```text
GET /api/data/store-status
```

Disable SQLite by setting:

```text
ABC_SQLITE_ENABLED=false
```

## Main Dashboard Areas

### Appointment Journey

Shows booking funnel performance, completion rate, regional heatmaps, supplier behaviour, interaction mix, and decomposition views.

Relevant files:

- `static/js/dashboard.js`
- `engine/forecasting_engine.py`
- Journey routes in `app.py`

### Contact Attempt Forecast

Shows channel KPIs, booking conversion funnel, model comparison, forecast bands, and planning target performance.

Relevant files:

- `static/js/forecasting.js`
- `engine/forecasting_engine.py`

### Risk and Recovery

Shows cancellation and abort KPIs, Pareto reasons, supplier/reason concentration, trend forecasts, rebooking performance, and prediction cards.

Relevant files:

- `static/js/cancellations.js`
- `engine/cancellation_engine.py`

### Resource Planning

Shows engineer utilisation, regional capacity gap, capacity forecast, patch-level planning, engineer performance, roster views, long-term capacity, and workforce optimisation output.

Relevant files:

- `static/js/field_ops.js`
- `static/js/roster.js`
- `static/js/longterm.js`
- `engine/field_ops_engine.py`

### Scenario Impact

Shows financial KPIs, monthly trends, job-type margin, forecast profitability, and scenario simulations.

Relevant files:

- `static/js/financial.js`
- `engine/financial_engine.py`

### Dialler Performance

Shows channel booking, business type, attempt outcomes, agent view, and dialler outcome analytics.

Relevant file:

- `static/js/timeslot.js`

### Single Meter View

Searches meter-style references and displays grouped appointment/visit history.

Relevant file:

- `static/js/meterview.js`

## API Overview

Most GET endpoints support `region`, `year`, and sometimes `month`, `supplier`, `filter_type`, or `filter_value`.

### System and Reference

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | App and data health. |
| `/api/regions` | GET | Region reference list. |
| `/api/filters` | GET | Region/month/supplier filter options. |
| `/api/data/status` | GET | Current rolling data-window status. |
| `/api/data/actual-window` | GET | Actual period metadata for frontend filters. |
| `/api/data/reload` | GET | Clear and reload data caches. |
| `/api/data/store-status` | GET | SQLite cache status. |
| `/api/data/generate` | GET | Generate or refresh data when enabled. |

### Appointment Journey

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/journey/dashboard` | GET | Combined payload for the journey dashboard. |
| `/api/journey/kpis` | GET | Funnel and conversion KPIs. |
| `/api/journey/weekly-trend` | GET | Weekly appointment trend. |
| `/api/journey/suppliers` | GET | Supplier performance and behaviour. |
| `/api/journey/regional-heatmap` | GET | Regional completion/cancellation view. |
| `/api/journey/interactions` | GET | Interaction-channel performance. |
| `/api/journey/decomposition-tree` | GET | Hierarchical decomposition payload. |

### Forecasting

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/forecasting/channel-kpis` | GET | Channel volume and conversion KPIs. |
| `/api/forecasting/forecast` | GET | Forecast by channel with model outputs and confidence bands. |
| `/api/forecasting/funnel` | GET | Booking conversion funnel. |
| `/api/forecasting/planning-target-kpis` | GET | Planning target KPIs. |

### Cancellations

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/cancellations/dashboard` | GET | Combined risk and recovery dashboard payload. |
| `/api/cancellations/kpis` | GET | Cancellation and abort KPIs. |
| `/api/cancellations/root-causes` | GET | Reason and supplier Pareto views. |
| `/api/cancellations/trends` | GET | Monthly trend and forecast. |
| `/api/cancellations/heatmap` | GET | Regional cancellation heatmap. |
| `/api/cancellations/predict` | GET | Cancellation risk prediction payload. |
| `/api/cancellations/rebooking` | GET | Rebooking analytics. |

### Field Operations

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/field-ops/kpis` | GET | Engineer and utilisation KPIs. |
| `/api/field-ops/capacity-matrix` | GET | Regional demand/capacity matrix. |
| `/api/field-ops/patch-plan` | GET | Patch-level planning detail. |
| `/api/field-ops/engineer-performance` | GET | Engineer performance table. |
| `/api/field-ops/capacity-forecast` | GET | Forward capacity forecast. |
| `/api/field-ops/optimise` | GET | Workforce allocation recommendation. |
| `/api/field-engineers` | GET | Field engineer scorecard data. |
| `/api/roster/timeline` | GET | Roster timeline data. |
| `/api/longterm/overview` | GET | Long-term capacity overview. |

### Financial

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/financial/kpis` | GET | Revenue, cost, margin, and trend KPIs. |
| `/api/financial/scenario` | POST | Run one scenario. |
| `/api/financial/compare-scenarios` | POST | Compare several scenarios. |
| `/api/financial/forecast-profitability` | GET | Forecast profitability by period. |

### Timeslot and Meter View

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/timeslot/dashboard` | GET | Full dialler performance payload. |
| `/api/timeslot/channel-booking` | GET | Channel booking breakdown. |
| `/api/timeslot/business-type` | GET | Business type breakdown. |
| `/api/timeslot/attempts-overview` | GET | Attempt outcome overview. |
| `/api/timeslot/agent-view` | GET | Agent-level dialler metrics. |
| `/api/timeslot/dialler-outcome` | GET | Dialler outcome breakdown. |
| `/api/meter-view` | GET | Single meter history lookup. |

### AI and Chatbot

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/ai/recommendations` | GET | Operational recommendations. |
| `/api/ai/summary` | GET | Natural language operational summary. |
| `/api/ai/dashboard` | GET | Dashboard-ready AI recommendation payload. |
| `/api/chatbot/config` | GET | Chatbot configuration status. |
| `/api/chatbot/message` | POST | Server-side chatbot proxy. |

## Docker

Build and run the app with Docker Compose:

```bash
docker-compose up --build
```

Then open:

```text
http://localhost:5000
```

`docker-compose.yml` also defines a PostgreSQL service for environments that want to experiment with database-backed storage. The current app remains CSV/SQLite-first unless database integration is explicitly enabled.

## Render Deployment

The included `render.yaml` defines a web service suitable for Render.

Typical production settings:

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 2 --timeout 120 app:app`
- Set `SECRET_KEY` as a secret.
- Set `HF_TOKEN` only if chatbot responses are required.
- Keep generated data committed or enable generation intentionally with `ABC_AUTO_GENERATE_DATA=true`.

Runtime memory is helped by lazy CSV loading and optional SQLite reads.

## Data Refresh Workflow

Check whether data needs rolling:

```bash
python scripts/refresh_data.py --status
```

Refresh existing CSV dates without rebuilding the whole dataset:

```bash
python scripts/refresh_data.py
```

Regenerate the full connected synthetic dataset:

```bash
python engine/data_generator.py
```

After changing source CSVs, rebuild SQLite if enabled:

```bash
python scripts/build_sqlite_store.py
```

## Development Notes

- `app.py` owns the Flask routes and combines engine-layer results into dashboard-ready JSON.
- `engine/ingestion.py` is the shared data access layer. Prefer using it instead of reading CSV files directly in new analytics code.
- Frontend modules are loaded directly in `templates/index.html`; there is no JavaScript build step.
- Shared frontend formatting, Chart.js defaults, icon SVGs, and loading helpers live in `static/js/config.js`.
- The frontend global namespace is `ABC`.
- The sidebar logo is an inline icon and text lockup, not an image asset.
- Generated job references use the `ABC-YYYY-NNNNNNN` format.

## Troubleshooting

### `No module named pytest`

Use the built-in unittest runner:

```bash
python -m unittest tests.test_app_smoke
```

### Dashboard opens but charts are empty

Check data health:

```text
GET /api/health
```

Then verify files exist in `data/inputs/` and rebuild the SQLite cache if required.

### Chatbot says configuration is missing

Set `HF_TOKEN` and restart Flask. The dashboards do not require chatbot credentials.

### Data looks stale

Run:

```bash
python scripts/refresh_data.py --status
python scripts/refresh_data.py
```

If the source data itself should be rebuilt, run:

```bash
python engine/data_generator.py
```
