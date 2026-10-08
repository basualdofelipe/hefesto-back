# hefesto-back

REST API backend for **Hefesto** — a cost management and pricing tool for a leather-goods business. Built with NestJS, TypeORM, and PostgreSQL. Deployment-ready for Railway, but runs locally for evaluation — there is no hosted instance (see [Local setup](#local-setup)).

---

## Stack

| Layer      | Technology                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Framework  | NestJS 11                                                                                                                            |
| Language   | TypeScript 5 (strict, no `any`, explicit return types)                                                                               |
| ORM        | TypeORM 0.3 with hand-written reversible migrations                                                                                  |
| Database   | PostgreSQL 16                                                                                                                        |
| Auth       | Google OAuth (ID token exchange) + JWT (Bearer)                                                                                      |
| Validation | class-validator + class-transformer, Joi env validation (fail-fast)                                                                  |
| API docs   | Swagger / OpenAPI (`@nestjs/swagger`) — development only                                                                             |
| Security   | Helmet, CORS, `@nestjs/throttler` (100 req / 60 s per CF-Connecting-IP; requests without it — internal Docker traffic — not limited) |
| Process    | Procfile (`node dist/main.js`) for Railway                                                                                           |
| Local DB   | Docker Compose (PostgreSQL 16 Alpine)                                                                                                |

---

## Features

| Module            | Path prefix                 | Description                                                                                                                 |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Auth              | `POST /api/auth/google`     | Exchange Google `id_token` for a signed JWT                                                                                 |
| Auth              | `POST /api/auth/demo-login` | Env-gated demo login (hard-pinned account)                                                                                  |
| Auth              | `GET /api/auth/me`          | Authenticated user profile                                                                                                  |
| Users             | `/api/users`                | Whitelist-based user management (admin only)                                                                                |
| Roles             | `/api/roles`                | Custom roles with per-permission boolean flags (admin only)                                                                 |
| Catalogs          | `/api/catalogs/:dimension`  | Reference data: product types, names, finishes, colors, sizes, supply types, expense categories                             |
| Suppliers         | `/api/suppliers`            | Supplier CRUD with active/inactive toggle                                                                                   |
| Supplies          | `/api/supplies`             | Supply CRUD with price history log                                                                                          |
| Products          | `/api/products`             | Product CRUD, BOM management, price history, batch operations                                                               |
| Costs             | (service)                   | BOM-based dynamic cost engine — calculates cost from current supply prices                                                  |
| Expenses          | `/api/expenses`             | Business expense log with category filtering                                                                                |
| Tiendanube Config | `/api/tiendanube-config`    | Payment gateways, installment rates, tax config (IVA/IIBB), plans                                                           |
| Calculator        | `/api/calculator`           | Forward pricing (margin from sell price), inverse pricing (sell price from target margin), batch margin across all products |
| Scenarios         | `/api/scenarios`            | Named what-if pricing scenarios with per-product price overrides and margin calculation                                     |

### Supuesto fiscal

The pricing formula behind `/api/calculator` (and the scenarios that reuse it) assumes the seller is **Responsable Inscripto**: IVA débito is computed on the customer total, and IVA crédito is recovered on the product cost, the gateway fee and the shipping cost. Monotributo is not modelled.

---

## Auth model

Authentication is **whitelist-based**: only users pre-added to the `users` table can log in. Google OAuth is the primary login method — the frontend obtains a Google `id_token`, sends it to `POST /api/auth/google`, and receives a signed JWT.

The JWT payload carries a `permissions` object derived from the user's assigned `Role`. All endpoints (except `POST /api/auth/*`) require a valid `Authorization: Bearer <token>` header.

### Permission system

Roles are fully custom: each role stores 11 boolean permission flags. The flags are embedded directly in the JWT, so permission checks are stateless (no DB query per request).

| Permission             | Controls access to                             |
| ---------------------- | ---------------------------------------------- |
| `can_view_products`    | Read products, BOM, price history, catalogs    |
| `can_edit_products`    | Create/update products, BOM, prices            |
| `can_view_supplies`    | Read supplies, suppliers                       |
| `can_edit_supplies`    | Create/update supplies, suppliers              |
| `can_view_expenses`    | Read expenses                                  |
| `can_edit_expenses`    | Create/update/delete expenses                  |
| `can_use_calculator`   | Calculator endpoints                           |
| `can_manage_scenarios` | Scenarios CRUD and calculation                 |
| `can_view_dashboard`   | Dashboard data access                          |
| `can_manage_config`    | Update Tiendanube config (rates, taxes, plans) |
| `can_manage_users`     | User and role management (admin-tier)          |

---

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker + Docker Compose (for the local PostgreSQL containers)
- A Google OAuth Client ID (for auth — see setup below)

---

## Local setup

### 1. Clone and install

```bash
git clone <repo-url>
cd hefesto-back
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# App
NODE_ENV=development
PORT=4000

# Database — matches docker-compose.yml defaults, no change needed for local dev
DATABASE_URL=postgresql://hefesto:hefesto_dev@localhost:5432/hefesto_db

# CORS
FRONTEND_URL=http://localhost:3000

# Auth (required)
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>.apps.googleusercontent.com

# Enables /api/auth/demo-login endpoint — on by default for local clone-and-run
# (lets you log in without configuring Google OAuth)
DEMO_LOGIN_ENABLED=true
```

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

This starts a PostgreSQL 16 container on port `5432` with database `hefesto_db`, user `hefesto`, password `hefesto_dev`.

### 4. Run migrations

Migrations run automatically on startup (`migrationsRun: true` in the TypeORM config). To run them manually:

```bash
npm run migration:run
```

### 5. Start the dev server

```bash
npm run start:dev
```

The API is available at `http://localhost:4000/api`.

---

## Available scripts

| Command                      | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `npm run start:dev`          | Start with hot-reload (development)          |
| `npm run start`              | Start without watch                          |
| `npm run start:prod`         | Start compiled output (`dist/main.js`)       |
| `npm run build`              | Compile TypeScript to `dist/`                |
| `npm run migration:run`      | Run all pending TypeORM migrations           |
| `npm run migration:revert`   | Revert the last applied migration            |
| `npm run migration:generate` | Generate a new migration from entity changes |
| `npm run test`               | Run unit tests (Jest)                        |
| `npm run test:watch`         | Run tests in watch mode                      |
| `npm run test:cov`           | Run tests with coverage report               |
| `npm run test:e2e`           | Run end-to-end tests                         |
| `npm run lint`               | Run ESLint                                   |
| `npm run lint:fix`           | Run ESLint with auto-fix                     |
| `npm run prettier:fix`       | Format all source files with Prettier        |

---

## Project structure

```
src/
├── auth/                   # JWT strategy, Google OAuth exchange, demo login
│   ├── decorators/         # @CurrentUser, @Public, @RequirePermission
│   ├── dto/
│   ├── guards/             # JwtAuthGuard, PermissionsGuard
│   └── strategies/         # passport-jwt strategy
├── catalogs/               # Reference data dimensions (types, colors, sizes, etc.)
├── calculator/             # Forward / inverse / batch pricing calculator
├── common/
│   ├── entities/           # BaseEntity (UUID PK, createdAt, updatedAt)
│   ├── filters/            # HttpExceptionFilter
│   ├── interceptors/       # ResponseInterceptor (data envelope), LoggingInterceptor
│   └── types/              # Permission type + extractPermissions()
├── config/
│   ├── env.validation.ts   # Joi schema — validates env vars at startup
│   └── typeorm.config.ts   # TypeORM module options
├── costs/                  # BOM-based cost calculation engine
├── database/
│   ├── data-source.ts      # TypeORM DataSource for CLI + app
│   └── migrations/         # Hand-written reversible migrations (16 files)
├── expenses/               # Business expense log with categories
├── products/               # Product catalog, BOM, price history
├── roles/                  # Custom roles with boolean permission flags
├── scenarios/              # What-if pricing scenarios with overrides
├── suppliers/              # Supplier catalog
├── supplies/               # Supply catalog with price history
├── tiendanube-config/      # Payment gateway rates, installment rates, taxes, plans
├── users/                  # User whitelist management
├── app.module.ts
└── main.ts                 # Bootstrap: global prefix /api, Helmet, CORS, Swagger, throttler
```

---

## API response envelope

All responses are wrapped by `ResponseInterceptor`:

```json
{
  "data": { ... }
}
```

Errors return standard NestJS `HttpException` shape:

```json
{
  "statusCode": 404,
  "message": "Producto no encontrado",
  "error": "Not Found"
}
```

---

## Swagger docs

Interactive API documentation is available at `http://localhost:4000/api/docs` when `NODE_ENV` is not `production`. All endpoints include operation summaries, permission requirements, and response schemas.

---

## Database

Migrations are hand-written and reversible. The `AppDataSource` uses `synchronize: false` and `migrationsRun: true` — the schema is never auto-synced. All entities extend `BaseEntity` which provides a UUID primary key and `createdAt` / `updatedAt` timestamps.

For local E2E tests a separate database runs on port `5433`:

```bash
docker compose up -d postgres-test
```

Set `DATABASE_URL_TEST=postgresql://hefesto:hefesto_test@localhost:5433/hefesto_test` in `.env` before running `npm run test:e2e`.

---

## Rebranding

To deploy under a different brand, set these environment variables before building:

**Backend (`.env`)**

| Variable      | Default             | Description                            |
| ------------- | ------------------- | -------------------------------------- |
| `APP_NAME`    | `Hefesto`           | App name (Swagger title + description) |
| `DEMO_EMAIL`  | `demo@hefesto.com`  | Email of the seeded demo account       |
| `ADMIN_EMAIL` | `admin@hefesto.com` | Email of the seeded admin account      |
| `ADMIN_NAME`  | `Admin`             | Display name of the seeded admin       |

**Frontend (`.env.local`)**

| Variable                    | Default             | Description                                   |
| --------------------------- | ------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`      | `Hefesto`           | App name (page title, heading, alt text)      |
| `NEXT_PUBLIC_DEMO_EMAIL`    | `demo@hefesto.com`  | Demo email shown on the login page            |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `admin@hefesto.com` | Contact email shown on the access-denied page |

**Important notes:**

- Reemplazá el logo en `public/brand/` (reemplazo manual de asset).
- Las variables `NEXT_PUBLIC_*` se hornean en build time — hacé rebuild del frontend después de cambiarlas.
- `ADMIN_EMAIL` debe ser una cuenta Google real del deployer para poder autenticarse como admin. El default `admin@hefesto.com` es un seed válido para DB fresca pero no es logueable.
- `DEMO_EMAIL` (back) y `NEXT_PUBLIC_DEMO_EMAIL` (front) deben tener el MISMO valor o el demo-login devuelve 401.

---

## Deployment

The project is configured for deployment to Railway but is **not currently hosted** — run it locally to evaluate it (see [Local setup](#local-setup)). The deployment setup is in place: the `Procfile` declares the web process:

```
web: node dist/main.js
```

Build step: `npm run build`. The SSL option `rejectUnauthorized: false` is applied automatically when `NODE_ENV=production` to support Railway's managed PostgreSQL.

Required environment variables in production: `DATABASE_URL`, `FRONTEND_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`. Set these in the Railway service dashboard.

---

## Known trade-offs & roadmap

Deliberate engineering decisions and their accepted trade-offs — documented rather than hidden. Each notes the current approach, why it was chosen, and the path to the next level.

### Accepted trade-offs (intentional at current scale)

- **Postgres error mapping is repeated per service.** The `23505` (unique) / `23503` (FK) / `40001` (serialization) → HTTP status mapping is inlined in each service rather than abstracted into a `mapPgError` helper or a `@HandleDbError` decorator. Chosen for explicitness over indirection; the natural refactor lands once a third variant appears.
- **The SERIALIZABLE transaction boilerplate** in `UsersService.update`/`remove` (enforcing the last-active-admin lockout invariant) is duplicated across the two methods rather than extracted into a `withSerializableTx()` helper. Kept inline while there are only two call sites.
- **Latest-price resolution scans the full price-history table** (`products`/`supplies` `findAll`). Correct and fast at the current catalog size; the next step is to filter by the active product/supply set before the `DISTINCT ON` as data grows.
- **Batch endpoints (`batchUpdateBom`, scenario ownership transfer) iterate row-by-row** inside a transaction. Correct, but set-based SQL scales better — deferred until batch sizes justify it.

### Roadmap (raising the ceiling)

- **Single source of truth for permissions.** The 11-permission set is currently expressed in the `roles` table columns, the `permission.ts` type/const, and the frontend mirror. A shared definition (codegen or a small shared package) would remove the cross-boundary drift risk.
- **Response DTOs on all controllers.** A few endpoints (`auth/me`, users) return TypeORM entities directly. No secret columns exist today, but explicit response DTOs would harden the contract against future leakage.
- **Integration tests against a real database.** The concurrency guard (SERIALIZABLE last-admin) and the raw `DISTINCT ON` queries are unit-tested with mocks; Testcontainers-backed integration tests would verify them against real Postgres.
- **Platform hardening.** Rate-limiting / idempotency keys on mutating batch endpoints, structured logging with correlation IDs, and an ADR documenting the boolean-permission-columns vs. join-table decision.
