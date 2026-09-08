# Privaagent

> **Adaptive Minimum-Disclosure Browser Agent (SIH26171)**
> *On-device Visual Perception for Light-weight Browser Agents*

---

## 🚀 Quickstart

### 1. Chrome Extension (MV3)
```bash
cd extension
npm install
npm run build
```
Load the unpacked extension in Chrome via `chrome://extensions` pointing to `extension/dist/`.

### 2. FastAPI Backend Server
```bash
cd server
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Install requirements:
pip install -r requirements.txt
# Run server:
uvicorn app.main:app --reload --port 8000
```
Visit `http://127.0.0.1:8000/health` to confirm server status.

### 3. Benchmark Fixture
Open `benchmark/pages/test-page-1.html` in Chrome to view the test fixture containing PII, API tokens, and canvas chart.

---

## 🏛 Architecture & Contracts
- See [docs/contracts.md](docs/contracts.md) for data schema definitions.
- See [docs/architecture.md](docs/architecture.md) for architectural overview.
- See [docs/threat-model.md](docs/threat-model.md) for security boundaries and policies.
- See [docs/evaluation-plan.md](docs/evaluation-plan.md) for scoring methodology.
