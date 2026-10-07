# Architecture

This document describes the internal design of `hefesto-back`: the NestJS module graph, the full request lifecycle, the auth/permission model, the data model, the BOM-based cost engine, the Tiendanube pricing calculator, and the migration strategy. It focuses on **why** things are done the way they are, not just what exists.

---

## System Overview

`hefesto-back` is a REST API for a leather-goods business. Its three core responsibilities are:

1. **Cost tracking** — maintain a Bill of Materials (BOM) for each product and compute the real cost from current supply prices at query time, with no denormalization.
2. **Tiendanube pricing** — given a selling price (or a target profit), calculate the net margin after every Argentine e-commerce cost layer: gateway commission, installment financing, IVA debit/credit offset, IIBB retention, and platform transaction cost.
3. **Scenario planning** — let each user save named configurations of selling prices to compare margin outcomes across different gateways or pricing strategies.

Authentication is Google OAuth only (no password). Authorization is a flat-flag permission model carried on a Role entity.

---

## Module Graph

```
AppModule
├── ConfigModule (global)         env validation via Joi, abortEarly: false
├── ThrottlerModule               100 req/60 s, applied at AppModule level as APP_GUARD
├── TypeOrmModule                 postgres, migrationsRun: true, synchronize: false
│
├── AuthModule ──────────────────> UsersModule (import)
│   ├── JwtAuthGuard  (APP_GUARD) validates Bearer token + re-queries DB on every request
│   └── PermissionsGuard (APP_GUARD) checks @RequirePermission metadata
│
├── UsersModule ─────────────────> ScenariosModule (import, for transferOwnership)
├── RolesModule
├── CatalogsModule                product taxonomy + supply taxonomy read-only lookup tables
├── SuppliersModule
├── SuppliesModule
├── CostsModule ─────────────────> (no module imports; injects BOM + PriceHistory repos)
├── ExpensesModule
├── ProductsModule
├── TiendanubeConfigModule        rate tables, installment rates, tax config, plans
├── CalculatorModule ────────────> TiendanubeConfigModule, CostsModule, ProductsModule
└── ScenariosModule ─────────────> CalculatorModule, CostsModule, ProductsModule,
                                    TiendanubeConfigModule
```

Guards are registered as `APP_GUARD` providers — NestJS applies them to **every** route in registration order:

1. `ThrottlerGuard` (AppModule) — rate limit before any auth work
2. `JwtAuthGuard` (AuthModule) — validates JWT, re-queries user from DB
3. `PermissionsGuard` (AuthModule) — checks `@RequirePermission` metadata

The `@Public()` decorator short-circuits `JwtAuthGuard` (and therefore `PermissionsGuard`) by setting `IS_PUBLIC_KEY` metadata that `canActivate` reads via `Reflector`.

---

## Request Lifecycle

```
Client
  │
  ▼
ThrottlerGuard          100 req / 60 s window
  │
  ▼
JwtAuthGuard            extracts Bearer token → JwtStrategy.validate()
  │                     → DB query: usersService.findActiveByEmail()
  │                     → attaches { id, email, permissions } to req.user
  ▼
PermissionsGuard        reads @RequirePermission(...) metadata via Reflector
  │                     → checks each flag against req.user.permissions
  ▼
ValidationPipe          whitelist: true, forbidNonWhitelisted: true, transform: true
  │                     class-validator decorators on DTOs strip unknown props
  ▼
Controller              routes request to service method
  ▼
Service                 business logic, TypeORM repository calls
  ▼
TypeORM / PostgreSQL
  │
  ▼
ResponseInterceptor     wraps successful response: { data: T }
  │                     (Swagger routes at /api/docs are excluded from wrapping)
  ▼
LoggingInterceptor      logs: METHOD /path STATUS DURATIONms
  │
  ▼
HttpExceptionFilter     catches all exceptions (HttpException and unexpected)
                        normalizes to: { statusCode, error, message, timestamp }
```

**Why re-query the DB on every JWT validation?**
The JWT payload embeds `permissions` at sign time. If an admin demotes a user's role, the token would grant stale permissions until it expires (7 days). `JwtStrategy.validate()` re-reads from the DB on every request so role changes take effect immediately. The cost is one indexed `findOne` per request — acceptable for a low-concurrency internal tool.

---

## Auth and Permission Model

### Authentication flow

```
Frontend                            hefesto-back
   │                                    │
   │─── POST /api/auth/google ─────────>│
   │    { idToken: "google-id-token" }  │
   │                                    │── verifyIdToken() via google-auth-library
   │                                    │   (validates audience = GOOGLE_CLIENT_ID)
   │                                    │── usersService.findActiveByEmail(payload.email)
   │                                    │   (must be pre-registered + isActive = true)
   │                                    │── extractPermissions(user.role)
   │                                    │── jwtService.sign({ sub, email, permissions })
   │<── { accessToken, user } ─────────│
```

There is no self-registration. A user account must exist in the `users` table before login is possible. The admin creates users via `POST /api/users`.

A demo login path exists (`POST /api/auth/demo-login`) that is active only when `DEMO_LOGIN_ENABLED=true`. It is hard-pinned to the email configured in `DEMO_EMAIL` (default `demo@hefesto.com`) — the endpoint rejects any other email even if `DEMO_LOGIN_ENABLED` is true, so it cannot be used to mint tokens for real accounts.

### Permission model

Permissions are stored as 11 boolean columns on the `roles` table, not as a junction table. Every request re-derives the live permission set from the role loaded in `JwtStrategy.validate()`.

```
Role entity
  canViewProducts       canEditProducts
  canViewSupplies       canEditSupplies
  canViewExpenses       canEditExpenses
  canUseCalculator      canManageScenarios
  canViewDashboard      canManageConfig
  canManageUsers        ← also used as "system admin" flag in ScenariosService
```

`@RequirePermission(...permissions: Permission[])` is a metadata decorator. `PermissionsGuard` resolves the snake_case `Permission` union type to the camelCase `Permissions` interface via the `PERMISSION_TO_CAMEL` map before checking `req.user.permissions`.

Roles with `isSystem = true` cannot be deleted.

### Last-active-admin protection (users.service)

`update()` and `remove()` must prevent the system from being left with zero active admins. This guard involves:

1. Read the victim user (with role) under a **pessimistic write lock**
2. Compute whether the operation would remove the last active user with `canManageUsers = true`
3. Count other active admins via `countOtherActiveAdmins()` — a plain `getCount()` with no lock (see below)
4. Reject if count is zero

Both operations run inside a **SERIALIZABLE transaction** rather than a weaker isolation level. PostgreSQL serializes concurrent transactions by aborting the loser with error code `40001` (serialization_failure). Both services catch `QueryFailedError` with `code === '40001'` and re-throw as `ConflictException(409)`, which the client can surface as a retry prompt.

**Why not use `pessimistic_write` on the COUNT query?**
PostgreSQL prohibits `SELECT ... FOR UPDATE` combined with aggregate functions. The SERIALIZABLE isolation level already ensures that two concurrent "demote last admin" transactions cannot both succeed — no additional row lock on the count is needed.

---

## Data Model

### BaseEntity

Every entity extends `BaseEntity`:

```
id         uuid  PRIMARY KEY DEFAULT uuid_generate_v4()
created_at timestamptz DEFAULT now()
updated_at timestamptz DEFAULT now()
```

All entities end up with UUID primary keys; an early users migration used SERIAL and was later migrated to UUID.

### Key entities and relationships

```
roles ──────────────────────────────────────────────────── (1)
  │ 1:N
users ──────────────────────────────────────────────────── (N)
  │ 1:N
scenarios ──────────────────────────────────────────────── (N)
  │ 1:N
scenario_overrides (scenario_id FK, product_id FK)

supply_types ── (catalog)
suppliers    ── (catalog)
supplies ──── ManyToOne(supply_type), ManyToOne(supplier)
  │ 1:N
supply_price_history ── append-only, price as decimal(12,2)

product_types, product_names, product_finishes,
product_colors, product_sizes ── (catalogs, each with sku_code)
products ── ManyToOne to each catalog dimension
  │ 1:N
supplies_per_product_history (BOM) ── product_id FK, supply_id FK, quantity, is_active
  │
product_price_history ── product_id FK, price decimal(12,2), currency varchar(10)

tn_payment_gateways ── slug, label
tn_gateway_rates    ── gateway_id FK, payment_method, withdrawal_days, rate_percent
tn_installment_rates ── installments, rate_percent
tn_tax_config       ── iva_rate, iibb_rate
tn_plans            ── slug, cpt_pago_nube, cpt_other_gateways
```

### Append-only price history pattern

Neither supply prices nor product prices are updated in-place. Every change inserts a new row. The "current" value is always the row with the highest `created_at` for a given foreign key. This preserves a full audit trail and makes it possible to reconstruct historical cost calculations.

The BOM table (`supplies_per_product_history`) follows the same pattern. Changing a product's bill of materials soft-deactivates (`is_active = false`) the old rows and inserts new active ones. This allows `CostsService` to see both the current BOM and any prior composition.

### Decimal-as-string discipline

TypeORM maps PostgreSQL `decimal`/`numeric` columns to JavaScript strings by default (to avoid IEEE 754 floating-point loss). This project **deliberately keeps that TypeScript type as `string`** on every entity that stores money or rates:

- `SupplyPriceHistory.price: string`
- `SuppliesPerProductHistory.quantity: string`
- `ProductPriceHistory.price: string`
- `ScenarioOverride.overridePrice: string`
- `TnPlan.cptPagoNube: string`, `cptOtherGateways: string`
- `TnGatewayRate.ratePercent: string`, `TnInstallmentRate.ratePercent: string`
- `TnTaxConfig.ivaRate: string`, `iibbRate: string`

Conversion to `number` happens at **read time**, as late as possible, at the service layer (`parseFloat()`). `TiendanubeConfigService` exposes `Parsed*` interfaces for all rate entities to make the type boundary explicit. The test suite (`calculator.service.spec.ts`) covers the `calcBatch` path specifically because `currentPrice` arriving as a string is a common source of silent bugs.

---

## BOM-Based Cost Engine (`CostsService`)

The cost engine computes the real material cost of a product by joining the current BOM with the latest supply prices. It operates in exactly **two queries** regardless of how many products or supplies are involved.

### calculateAll() — two-query batch pattern

```
Query 1: bomRepo.find({ where: { isActive: true }, relations: ['product', 'supply'] })
         → loads all active BOM lines for all products in one round-trip

Query 2: SELECT DISTINCT ON (supply_id) supply_id, price
         FROM supply_price_history
         ORDER BY supply_id, created_at DESC
         → fetches the latest price for every supply mentioned in the BOM
```

`DISTINCT ON (supply_id)` is a PostgreSQL extension that returns the first row per group after the `ORDER BY`, making this a single-pass scan rather than a correlated subquery per supply. Both results are assembled in memory into a `Map<supplyId, price>` and a `Map<productId, BomLines[]>`, then the cost map is built entirely in JavaScript.

For a single-product query (`calculateForProduct()`), query 2 adds a `WHERE supply_id IN (...)` clause scoped to only the supplies in that product's BOM.

### Cost computation

Line cost = `unitPrice × quantity`, rounded to 2 decimal places. The total is the sum of all lines. If a supply has no price record, `lineCost` is `null` and a warning string is added to `costWarnings`. Inactive supplies also generate a warning but still contribute to the total if they have a price.

---

## Tiendanube Pricing Calculator (`CalculatorService`)

### Domain context

Selling on Tiendanube (Argentine e-commerce platform) involves several cost layers deducted from the gross sale before the seller receives money:

- **Gateway commission** (`gatewayFee`) — a percentage of the total paid by the buyer (product + shipping charged), which varies by gateway, payment method, and withdrawal settlement period
- **IVA on the commission** — Argentine VAT (21%) is charged on the gateway fee, but the seller recovers IVA credits from the product cost, the gateway fee and the shipping cost
- **Installment financing cost** (`financingCost`) — if the buyer pays in installments, the gateway charges the seller the financing cost
- **CPT (Costo Por Transacción)** — Tiendanube's own platform fee, which depends on the seller's plan and the gateway used (Pago Nube has 0% CPT on most plans)
- **IIBB withholding** (`iibbWithholding`) — Ingresos Brutos, a provincial gross revenue tax retained at source

### calcForward — the 12-step formula

`calcForward(params)` is a **pure synchronous function**. It receives an already-loaded `TiendanubeConfigAll` object (rates are picked out of it by `resolveRates`, no I/O) so it can be called in hot loops (e.g., `calcBatch`) without extra DB queries per product.

Steps (no intermediate rounding — rounding only on the two final outputs):

```
1.  customerTotal       = sellingPrice + shippingCharged
2.  baseRate            = gateway rate %  (e.g. 3.49)
3.  rateWithIva         = baseRate × (1 + ivaRate)        // ivaRate = 0.21
4.  gatewayFee          = customerTotal × (rateWithIva / 100)
5.  financingCost       = customerTotal × (installmentRate / 100)
6.  cpt                 = customerTotal × (cptRate / 100)
7a. taxableBase         = customerTotal / (1 + ivaRate)
7b. ivaDebit            = customerTotal − taxableBase
7c. ivaCreditProduct    = productCost × ivaRate
7d. ivaCreditGatewayFee = gatewayFee × (ivaRate / (1 + ivaRate))
7e. ivaCreditShipping   = shippingCost × (ivaRate / (1 + ivaRate))
7f. ivaNet              = ivaDebit − ivaCreditProduct − ivaCreditGatewayFee − ivaCreditShipping
8.  iibbWithholding     = customerTotal × iibbRate          // iibbRate = 0.035
9.  netReceived         = customerTotal − gatewayFee − financingCost
                                        − iibbWithholding − cpt
10. productCostWithIva  = productCost × (1 + ivaRate)
11. realProfit          = netReceived − productCostWithIva − shippingCost − ivaNet
12. marginPercent       = (realProfit / sellingPrice) × 100

    [round realProfit and marginPercent to 2 decimal places]
```

Shipping enters through two separate fields: `shippingCharged` (what the buyer pays, so it inflates every fee base) and `shippingCost` (what the seller pays the carrier, subtracted in full in step 11 with its IVA recovered in step 7e). The whole chain assumes the seller is **Responsable Inscripto** — IVA débito on the customer total, IVA crédito on product cost, gateway fee and shipping cost; Monotributo is not modelled.

The CPT rate branches on whether the gateway is `pago_nube`: for Pago Nube, `plan.cptPagoNube` is used; for all other gateways, `plan.cptOtherGateways` is used. This matches Tiendanube's pricing structure where Pago Nube is its own gateway with a waived CPT.

### calcInverse — binary search for target profit

`calcInverse(params)` answers "at what selling price will I earn `targetProfit` with these rates?" Because `realProfit` is a monotonically increasing function of `sellingPrice`, binary search converges in at most 100 iterations (epsilon = 0.01 ARS). `targetProfit = 0` is accepted (break-even price).

Guard conditions checked before the search:

- `productCost <= 0` → error (undefined without a known cost)
- `targetProfit < 0` → error (caller likely mixed units)
- `realProfit at upper bound (productCost × 20 or 100,000) < targetProfit` → error (unreachable)

### calcBatch — full-catalog margin snapshot

`calcBatch(dto)` loads config, costs, and products in **5 total queries** (1 config `getAll`, 2 from `calculateAll`, 2 from `productsService.findAll`), then calls `calcForward` in a JavaScript loop — no additional DB queries per product. Shipping comes from the configured defaults (`config.shipping.defaultShippingCharged` / `defaultShippingCost`, `0` when no shipping row exists); the intent is margin at the current list price under the store's usual shipping terms.

`currentPrice` from `ProductsService.findAll()` is typed as `string | null` (TypeORM decimal). `calcBatch` explicitly calls `parseFloat()` and guards against `NaN` before computing.

---

## Scenarios Domain

A `Scenario` is a named set of calculator parameters (gateway, payment method, plan) belonging to a user, plus zero or more `ScenarioOverride` rows that substitute a product's list price for "what-if" analysis.

**Visibility**: A scenario is either private (default) or `isPublic = true`. Public scenarios are readable by all authenticated users but writable only by the owner. Deleting a scenario cascades to its overrides. System admins (`canManageUsers = true`) can delete any scenario for cleanup purposes.

**Ownership transfer on user deletion**: When `UsersService.remove()` deletes a user, it calls `ScenariosService.transferOwnership()` within the same SERIALIZABLE transaction _before_ the `DELETE` on the user row. This re-assigns all the victim's scenarios to the deleting admin and appends a suffix (`- <victim name> #<shortId>`) to disambiguate from the admin's own scenarios. The suffix is computed to avoid truncating the discriminator when the base name is long.

---

## Migration Strategy

All migrations are in `src/database/migrations/`. Filenames follow the pattern `<timestamp>-<PascalCaseName>.ts`. TypeORM is configured with `synchronize: false` and `migrationsRun: true`, so migrations run automatically on boot — no manual `migration:run` step needed in production.

**Hand-written, fully reversible**: Every migration implements both `up()` and `down()` with explicit DDL. TypeORM's schema-sync is never used in any environment.

**Expand/contract for schema changes**: The migration sequence follows the expand/contract pattern: additive changes (new columns with defaults, new tables) are made in one migration, data backfills in a subsequent migration, and removal of obsolete columns in a final migration. This keeps the `down()` path valid at every step.

**Seeding in migrations**: Reference data (catalog entries, Tiendanube rate seeds, the admin user) is seeded inside migrations rather than in separate seed scripts. This ensures a fresh database is always in a consistent known state after `migrationsRun`. Seed data is idempotent where possible (using `INSERT ... ON CONFLICT DO NOTHING` or conditional logic).

**Index strategy**: All FK columns that appear in `WHERE` clauses have explicit indexes. Columns used as `DISTINCT ON` sort keys have composite descending indexes (`created_at DESC`) so PostgreSQL can satisfy the sort with an index scan rather than a full-table sort.

Example indexes created in migrations:

- `IDX_bom_product_active` — partial index on `supplies_per_product_history(product_id) WHERE is_active = true`
- `IDX_product_price_created` — composite on `product_price_history(product_id, created_at DESC)`
- `IDX_tn_gateway_rates_lookup` — composite on `tn_gateway_rates(gateway_id, payment_method, withdrawal_days, created_at DESC)`
- `IDX_scenarios_user` — on `scenarios(user_id)`

---

## Directory Structure Rationale

```
src/
  app.module.ts              root module, registers global guards and config
  main.ts                    bootstrap: Helmet, CORS, global pipes/filters/interceptors, Swagger
  config/
    env.validation.ts        Joi schema — application refuses to start on missing vars
    typeorm.config.ts        re-exports dataSourceOptions for NestJS TypeOrmModule
  database/
    data-source.ts           TypeORM DataSource for standalone CLI use (migration generation)
    migrations/              one file per migration, timestamped
  common/
    entities/base.entity.ts  UUID PK + created_at + updated_at
    types/permission.ts      Permission union, Permissions interface, PERMISSION_TO_CAMEL map
    filters/                 HttpExceptionFilter — normalizes all error shapes
    interceptors/            ResponseInterceptor (envelope), LoggingInterceptor
  auth/                      Google OAuth validation, JWT sign, demo login, guards, JwtStrategy
  users/                     CRUD + last-admin SERIALIZABLE guard
  roles/                     CRUD, isSystem protection
  catalogs/                  read-only taxonomy tables (product dimensions, supply types)
  suppliers/                 CRUD for leather/hardware/packaging suppliers
  supplies/                  CRUD for raw materials + supply price history
  costs/                     stateless BOM cost engine (no controller, service only)
  products/                  CRUD for finished products + BOM management + product prices
  expenses/                  expense categories and expense entries
  tiendanube-config/         rate tables configuration CRUD + getAll() aggregator
  calculator/                calcForward, calcInverse, calcBatch (pure domain logic)
  scenarios/                 user-scoped what-if scenarios with per-product overrides
  constants/
    tiendanube.ts            slug constants: TN_GATEWAY_PAGO_NUBE, TN_PAYMENT_TARJETA, TN_PLAN_ESENCIAL
```

`CostsModule` deliberately has no controller — it exists purely to be injected by `CalculatorModule`, `ScenariosModule`, and `ProductsModule`. Exposing cost calculation as a standalone endpoint would require duplicating auth/permission context that those consumers already have.

---

## Non-Obvious Engineering Decisions

| Decision                                                       | Rationale                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT re-validates against DB on every request                   | Role changes take effect immediately without waiting for token expiry (7d). The indexed `findOne` cost is acceptable for internal tool scale.                                                                                      |
| `decimal` columns typed as `string` in entities                | Prevents silent IEEE 754 rounding on Argentine peso amounts. Conversion to `number` happens at service layer, never at entity layer.                                                                                               |
| `DISTINCT ON` instead of correlated subquery for latest prices | Single-pass PostgreSQL scan; performs well without a separate `MAX(created_at)` group-by join. Requires composite descending index on `(fk_id, created_at DESC)`.                                                                  |
| Append-only for prices and BOM                                 | Full audit trail with no extra audit table. Enables historical cost reconstruction. `is_active` flag on BOM rows distinguishes current from superseded without deleting data.                                                      |
| SERIALIZABLE isolation + 40001 → 409                           | Last-admin guard is a read-then-write operation that is unsafe at READ COMMITTED. SERIALIZABLE aborts the losing concurrent transaction deterministically; mapping 40001 to 409 surfaces a retry prompt rather than an opaque 500. |
| Binary search for `calcInverse`                                | The forward formula has no algebraically invertible closed form because of the IVA netting across multiple components. Binary search converges within 100 iterations to ±0.01 ARS.                                                 |
| No intermediate rounding in `calcForward`                      | Rounding at each step would accumulate error across 14 steps. Only `gananciaReal` and `margen` are rounded in the final return.                                                                                                    |
| Demo login pinned to a single email constant                   | Even with `DEMO_LOGIN_ENABLED=true`, the endpoint cannot mint a token for a real account — the pinned email check in `AuthService.validateDemoLogin()` makes it a static credential, not a bypass.                                 |
| Seed data inside migrations                                    | A fresh Railway deployment reaches a known consistent state on first boot without a separate seeding command. The migration runner is the single source of truth for schema + reference data.                                      |
