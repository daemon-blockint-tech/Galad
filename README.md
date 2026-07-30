<div align="center">

<!-- Generated: 2026-06-17 -->
# MAVEN SYSTEM

**Enterprise Threat Intelligence & Autonomous Mission Platform**

*Advanced command and control platform with AI-driven threat analysis, real-time entity tracking, distributed mesh networking, and autonomous mission execution.*

[![CI Build](https://github.com/daemon-blockint-tech/maven-system/actions/workflows/ci.yml/badge.svg)](https://github.com/daemon-blockint-tech/maven-system/actions/workflows/ci.yml)
[![License: Enterprise](https://img.shields.io/badge/License-Enterprise-blue.svg)](LICENSE)
[![Phase 5 Complete](https://img.shields.io/badge/Phase-5%20Complete-brightgreen.svg)](#phase-5-complete)
[![15,000+ LOC](https://img.shields.io/badge/Code-15%2C000%2B%20LOC-blue.svg)](#architecture)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED?logo=docker)](https://www.docker.com/)

![MAVEN SYSTEM Interface](docs/assets/screenshot.png)

</div>

---

## Overview

MAVEN SYSTEM is a comprehensive enterprise platform for threat intelligence, command & control, and autonomous mission planning. Built with Anduril Lattice parity in mind, it provides:

- **Real-Time Threat Intelligence**: ML-based anomaly detection, multi-channel alert routing, entity correlation
- **Advanced Command & Control**: Entity management, C2 commands, playbook-based automation
- **Mission Autonomy**: Intent-to-task decomposition, sensor fusion, dynamic planning
- **Tactical Operations**: Geo-spatial track visualization, multi-domain platform orchestration
- **Distributed Mesh Networking**: Resilient multi-hop routing with intelligent data prioritization

## Key Features

### Intelligence & Analysis
- **ML-Based Anomaly Detection**: Isolation Forest with 100-tree ensemble
- **Multi-Channel Alerts**: Slack, PagerDuty, Email, Webhooks, Custom
- **Entity Correlation**: Temporal alignment, spatial proximity, threat patterns
- **Natural Language Queries**: Deepseek V4 via OpenRouter API
- **Predictive Forecasting**: Linear regression trend analysis

### Command & Control (C2)
- **Entity Explorer**: Multi-column table with advanced filtering
- **Bulk Operations**: Multi-select and batch management
- **Domain Commands**: Status, restart, isolate, collect, block, quarantine
- **Command History**: Full execution tracking with audit trails
- **Asset Hierarchy**: Parent-child relationships with tree view

### Mission Autonomy
- **Intent-to-Task**: Natural language objective decomposition
- **Sensor Fusion**: Multi-source threat signal integration
- **Resource Management**: Intelligent allocation and scheduling
- **Dynamic Planning**: Real-time plan adaptation (escalate/de-escalate/pivot/abort)

### Tactical Operations
- **Tactical Map**: Geo-spatial entity visualization with temporal playback
- **Multi-Domain**: Air/Land/Sea/Space platform orchestration
- **Distributed Mesh**: Resilient networking with intelligent routing
- **Mission Planning**: Full cycle (Design → Plan → Execute → Debrief)

## Architecture

```
MAVEN SYSTEM (15,000+ LOC)
├── Phase 5a: ML Foundation (1,200+ LOC)
│   ├── Isolation Forest Anomaly Detection
│   ├── Statistical Baselines
│   └── Feature Engineering
├── Phase 5b: Alert Routing (1,400+ LOC)
│   ├── Multi-Channel Broadcasting
│   ├── Circuit Breaker Pattern
│   └── Delivery Tracking
├── Phase 5c: Distributed Queue (900+ LOC)
│   ├── Redis + BullMQ
│   ├── Worker Pool Management
│   └── Message Caching
├── Phase 5d: Visualization (1,140+ LOC)
│   ├── 3D Force-Directed Graph
│   ├── Temporal Timeline Playback
│   └── Dashboard Integration
├── Phase 5e: Query Engines (1,980+ LOC)
│   ├── Full-Text Search (BM25)
│   ├── Temporal Query Engine
│   ├── Predictive Forecasting
│   ├── Entity Correlation
│   └── LLM Query Interpreter
├── Phase 5f: C2 Dashboard (2,900+ LOC)
│   ├── Entity Management
│   ├── Command Execution
│   ├── Playbook Orchestration
│   └── Lattice-Quality UX
├── Phase 5f.2: Mission Autonomy (2,220+ LOC)
│   ├── Intent-to-Task Breakdown
│   ├── Sensor Fusion
│   ├── Resource Management
│   └── Dynamic Planning
└── Phase 5g: Tactical Systems (2,448+ LOC)
    ├── Tactical Map Visualization
    ├── Multi-Domain Integration
    ├── Distributed Mesh Network
    └── Mission Planning Workflow
```

## Core Technologies

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript 5
- **State Management:** Zustand
- **3D Visualization:** Three.js, Cesium.js
- **Database:** PostgreSQL via Prisma 7
- **Queue System:** Redis + BullMQ
- **LLM Integration:** OpenRouter API
- **Deployment:** Docker multi-stage build

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- [Docker](https://www.docker.com/) (for databases and self-hosting)
- PostgreSQL (via Docker compose)
- Redis (via Docker compose)

## Quick Start

### Development Setup

```bash
# Clone repository
git clone https://github.com/daemon-blockint-tech/maven-system.git
cd maven-system

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local

# Start databases (Docker required)
pnpm db:up

# Run dev server
pnpm dev
```

Visit `http://localhost:3000` to access MAVEN SYSTEM.

### Docker Deployment

```bash
docker compose up -d
```

## API Documentation

### Threat Intelligence
- `POST /api/ops/alerts`: Create alert
- `GET /api/ops/alerts`: List alerts with filtering
- `GET /api/ops/correlations`: Entity correlation analysis
- `POST /api/ops/query`: Natural language queries

### Command & Control
- `GET /api/ops/c2/entities`: List entities
- `POST /api/ops/c2/commands`: Execute C2 command
- `GET /api/ops/c2/commands/history`: Execution history
- `GET/POST /api/ops/c2/playbooks`: Playbook management

### Mission Autonomy
- `POST /api/ops/missions/intent`: Decompose intent to tasks
- `POST /api/ops/missions/plan`: Create mission plan
- `POST /api/ops/missions/execute`: Execute mission
- `GET /api/ops/missions/status`: Mission status

## Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/maven

# Redis
REDIS_URL=redis://localhost:6379

# LLM Integration
OPENROUTER_API_KEY=your_key_here

# Authentication (required — no default; `pnpm setup` generates one)
AUTH_SECRET=your_secret
AUTH_URL=http://localhost:3000

# Monitoring
SENTRY_DSN=your_dsn_here
```

## Project Structure

```
maven-system/
├── src/
│   ├── app/              # Next.js App Router
│   ├── components/       # React components
│   │   ├── c2/          # C2 Dashboard components
│   │   ├── mission/     # Mission planning UI
│   │   ├── tactical/    # Tactical map components
│   │   └── ...
│   ├── core/            # Core business logic
│   │   ├── alerts/      # Alert system
│   │   ├── ml/          # ML models
│   │   ├── mission/     # Mission workflow
│   │   ├── network/     # Mesh networking
│   │   ├── tactical/    # Tactical systems
│   │   └── ...
│   ├── lib/             # Utilities
│   └── types/           # TypeScript types
├── docs/                # Documentation
├── scripts/             # Build and setup scripts
└── tests/               # Test files
```

## Development Workflow

### Running Tests

```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Mutation testing
pnpm test:mutate
```

### Code Quality

```bash
# Linting
pnpm lint

# Type checking
npx tsc --noEmit
```

### Building for Production

```bash
pnpm build
pnpm start
```

## Features by Phase

### Phase 5a - ML Foundation ✅
- Isolation Forest anomaly detection
- Statistical baseline modeling
- Feature engineering pipeline

### Phase 5b - Alert Routing ✅
- Multi-channel broadcasting (5+ platforms)
- Circuit breaker pattern for resilience
- Delivery tracking and retry logic

### Phase 5c - Distributed Queue ✅
- Redis-backed message queue
- BullMQ worker pool management
- Message caching and deduplication

### Phase 5d - Visualization ✅
- 3D force-directed graph with physics
- Temporal timeline with playback controls
- Integrated visualization dashboard

### Phase 5e - Query Engines ✅
- Full-text search with BM25 scoring
- Temporal query engine with time-bucketing
- Predictive forecasting with linear regression
- Entity correlation analysis
- Natural language query interpretation

### Phase 5f - C2 Dashboard ✅
- Real-time entity management
- Multi-select bulk operations
- Domain-specific command execution
- Playbook-based automation
- Lattice-quality UX/UI design

### Phase 5f.2 - Mission Autonomy ✅
- Intent-to-task decomposition
- Multi-source sensor fusion
- Intelligent resource allocation
- Real-time plan adaptation

### Phase 5g - Tactical Systems ✅
- Geo-spatial track visualization
- Multi-domain platform orchestration
- Distributed mesh networking
- Full mission planning cycle

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Licensed under the Enterprise License. See [LICENSE](LICENSE) for details.

## Support

- [Documentation](docs/index.md)
- [Architecture Guide](docs/ARCHITECTURE.md)
- [Development Guide](docs/development.md)

---

Built with ❤️ for enterprise threat intelligence and autonomous operations.
