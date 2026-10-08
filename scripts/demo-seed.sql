-- Demo seed: resets the business data of a DEMO instance to a fixed, invented
-- catalog with a year of history. Every name below is made up.
--
-- DESTRUCTIVE. It empties catalogs, suppliers, supplies, products, prices,
-- bills of materials, expenses and scenarios, deletes every user except the
-- demo user and every non-system role. Roles ADMIN/USER, the Tiendanube config
-- and the migrations table are left alone. Never run it against a real
-- instance.
--
-- Dates are relative to the run (now() - N months), so "the leather price
-- jumped two months ago" stays true on every reset.
--
-- Usage (the demo user must exist: boot the app once so the SeedDemoUser
-- migration creates it from DEMO_EMAIL):
--   psql "$DATABASE_URL" -v demo_email="$DEMO_EMAIL" -f scripts/demo-seed.sql
-- or through the compose service:
--   docker exec -i <postgres-container> psql -U <user> -d <db> \
--     -v demo_email="$DEMO_EMAIL" < scripts/demo-seed.sql

\set ON_ERROR_STOP on

BEGIN;

-- The demo user is looked up by the env value, never written in this file.
CREATE TEMP TABLE seed_demo_user ON COMMIT DROP AS
  SELECT id FROM users WHERE email = :'demo_email' AND is_active;

DO $$
BEGIN
  IF (SELECT count(*) FROM seed_demo_user) <> 1 THEN
    RAISE EXCEPTION 'demo seed: no active user with DEMO_EMAIL; boot the app once so the SeedDemoUser migration creates it';
  END IF;
END $$;

TRUNCATE
  scenario_overrides, scenarios, expenses,
  product_price_history, supplies_per_product_history, products,
  supply_price_history, supplies, suppliers,
  product_types, product_names, product_finishes, product_colors,
  product_sizes, supply_types, expense_categories;

DELETE FROM users WHERE id NOT IN (SELECT id FROM seed_demo_user);
DELETE FROM roles WHERE NOT is_system;

-- Catalogs: manual order (sort_order dense from 0) and the SKU digit of each
-- product dimension.
INSERT INTO product_types (sort_order, sku_code, name) VALUES
  (0, 5, 'Mochila'), (1, 3, 'Deskpad'), (2, 1, 'Billetera'), (3, 2, 'Cinturon'),
  (4, 4, 'Porta Notebook'), (5, 6, 'Posavasos'), (6, 7, 'Estuche Anteojos'),
  (7, 8, 'Riñonera'), (8, 9, 'Campera');

INSERT INTO product_names (sort_order, sku_code, name) VALUES
  (0, 7, 'Atenea'), (1, 4, 'Apolo'), (2, 2, 'Ares'), (3, 9, 'Odiseo'),
  (4, 6, 'Artemisa'), (5, 8, 'Afrodita'), (6, 1, 'Hefesto'), (7, 3, 'Hermes'),
  (8, 5, 'Poseidon');

INSERT INTO product_finishes (sort_order, sku_code, name) VALUES
  (0, 1, 'Lisa'), (1, 2, 'Grabada'), (2, 3, 'Teñida'), (3, 4, 'Repujada'),
  (4, 5, 'Print');

INSERT INTO product_colors (sort_order, sku_code, name) VALUES
  (0, 5, 'Azul'), (1, 4, 'Bordo'), (2, 2, 'Negro'), (3, 3, 'Suela'),
  (4, 7, 'Natural'), (5, 6, 'Verde'), (6, 1, 'Marron');

INSERT INTO product_sizes (sort_order, sku_code, name) VALUES
  (0, 0, 'Unico'), (1, 1, 'Chico'), (2, 2, 'Mediano'), (3, 3, 'Grande'),
  (4, 4, 'XS'), (5, 5, 'S'), (6, 6, 'M'), (7, 7, 'L'), (8, 8, 'XL'),
  (9, 9, 'XXL');

INSERT INTO supply_types (sort_order, name) VALUES
  (0, 'Cuero'), (1, 'Adhesivo'), (2, 'Herraje'), (3, 'Hilo'), (4, 'Packaging'),
  (5, 'Produccion externa'), (6, 'Tela'), (7, 'Varios');

INSERT INTO expense_categories (sort_order, name) VALUES
  (0, 'Materia prima'), (1, 'Herramientas'), (2, 'Envio'), (3, 'Otros'),
  (4, 'Packaging'), (5, 'Servicios');

INSERT INTO suppliers (name, description) VALUES
  ('Curtiembre Prometeo', 'Cueros vacunos: vaqueta, suela y graso'),
  ('Herrajes Vulcano', 'Hebillas, cierres, remaches y argollas'),
  ('Hilados Ariadna', 'Hilos encerados, adhesivos y forros'),
  ('Embalajes Pandora', 'Cajas, bolsas y packaging'),
  ('Taller Dedalo', 'Confeccion tercerizada');

-- Supplies with their CURRENT price (without VAT, like every supply price).
CREATE TEMP TABLE seed_supply (
  name text, type_name text, unit text, supplier text, price numeric
) ON COMMIT DROP;

INSERT INTO seed_supply VALUES
  ('Vaqueta 2 mm',          'Cuero',              'm2',     'Curtiembre Prometeo', 48000),
  ('Vaqueta 3 mm',          'Cuero',              'm2',     'Curtiembre Prometeo', 56000),
  ('Suela 4 mm',            'Cuero',              'm2',     'Curtiembre Prometeo', 62000),
  ('Cuero graso 1,4 mm',    'Cuero',              'm2',     'Curtiembre Prometeo', 52000),
  ('Hebilla 35 mm',         'Herraje',            'unidad', 'Herrajes Vulcano',     2400),
  ('Hebilla 40 mm',         'Herraje',            'unidad', 'Herrajes Vulcano',     2900),
  ('Cierre metalico 20 cm', 'Herraje',            'unidad', 'Herrajes Vulcano',     1300),
  ('Remache doble',         'Herraje',            'unidad', 'Herrajes Vulcano',       90),
  ('Argolla D 25 mm',       'Herraje',            'unidad', 'Herrajes Vulcano',      350),
  ('Hilo encerado 0,8 mm',  'Hilo',               'metro',  'Hilados Ariadna',       120),
  ('Adhesivo de contacto',  'Adhesivo',           'kg',     'Hilados Ariadna',     18000),
  ('Forro de lienzo',       'Tela',               'm2',     'Hilados Ariadna',      9000),
  ('Caja regalo',           'Packaging',          'unidad', 'Embalajes Pandora',    1900),
  ('Bolsa de tela',         'Packaging',          'unidad', 'Embalajes Pandora',    1400),
  ('Confeccion mochila',    'Produccion externa', 'unidad', 'Taller Dedalo',       38000);

INSERT INTO supplies (name, type_id, supplier_id, unit_type, created_at, updated_at)
SELECT s.name, t.id, p.id, s.unit::supplies_unit_type_enum,
       now() - interval '12 months', now() - interval '12 months'
FROM seed_supply s
JOIN supply_types t ON t.name = s.type_name
JOIN suppliers p ON p.name = s.supplier;

-- A year of monthly prices: about 3 % a month, and leather jumped 25 % two
-- months ago (every leather point from three months back is pre-jump).
INSERT INTO supply_price_history (supply_id, price, created_at, updated_at)
SELECT su.id,
       round(s.price / power(1.03, k)
             / CASE WHEN s.type_name = 'Cuero' AND k >= 3 THEN 1.25 ELSE 1 END, -1),
       now() - make_interval(months => k) - interval '3 days',
       now() - make_interval(months => k) - interval '3 days'
FROM seed_supply s
JOIN supplies su ON su.name = s.name
CROSS JOIN generate_series(0, 11) AS k;

-- Products: one row per variant, with its CURRENT sale price.
CREATE TEMP TABLE seed_product (
  type_name text, name text, finish text, color text, size text, price numeric
) ON COMMIT DROP;

INSERT INTO seed_product VALUES
  ('Billetera', 'Hefesto', 'Lisa', 'Negro', 'Unico', 32000),
  ('Billetera', 'Hefesto', 'Lisa', 'Marron', 'Unico', 32000),
  ('Billetera', 'Hefesto', 'Lisa', 'Suela', 'Unico', 32000),
  ('Billetera', 'Hefesto', 'Grabada', 'Negro', 'Unico', 36000),
  ('Billetera', 'Hefesto', 'Grabada', 'Marron', 'Unico', 36000),
  ('Mochila', 'Odiseo', 'Lisa', 'Negro', 'Unico', 150000),
  ('Mochila', 'Odiseo', 'Lisa', 'Suela', 'Unico', 150000),
  ('Deskpad', 'Hermes', 'Lisa', 'Natural', 'Mediano', 38000),
  ('Deskpad', 'Hermes', 'Lisa', 'Natural', 'Grande', 45000),
  ('Deskpad', 'Hermes', 'Lisa', 'Negro', 'Grande', 45000),
  ('Riñonera', 'Artemisa', 'Lisa', 'Negro', 'Unico', 68000),
  ('Riñonera', 'Artemisa', 'Lisa', 'Marron', 'Unico', 68000),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Negro', 'Mediano', 72000),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Natural', 'Mediano', 72000),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Negro', 'Grande', 82000),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Natural', 'Grande', 82000),
  ('Posavasos', 'Apolo', 'Print', 'Natural', 'Unico', 18000),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', 'Marron', 'Unico', 26000),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', 'Bordo', 'Unico', 26000);

INSERT INTO seed_product
SELECT 'Cinturon', 'Ares', 'Grabada', c, s, 38000
FROM unnest(ARRAY['Negro', 'Marron']) AS c
CROSS JOIN unnest(ARRAY['S', 'M', 'L', 'XL']) AS s;

INSERT INTO seed_product
SELECT 'Cinturon', 'Poseidon', 'Teñida', c, s, 42000
FROM unnest(ARRAY['Negro', 'Suela', 'Verde']) AS c
CROSS JOIN unnest(ARRAY['M', 'L', 'XL']) AS s;

INSERT INTO products (sku_code, product_type_id, product_name_id, product_finish_id,
                      product_color_id, product_size_id, created_at, updated_at)
SELECT concat_ws('.', t.sku_code, n.sku_code, f.sku_code, c.sku_code, z.sku_code),
       t.id, n.id, f.id, c.id, z.id,
       now() - interval '10 months', now() - interval '10 months'
FROM seed_product p
JOIN product_types t ON t.name = p.type_name
JOIN product_names n ON n.name = p.name
JOIN product_finishes f ON f.name = p.finish
JOIN product_colors c ON c.name = p.color
JOIN product_sizes z ON z.name = p.size;

-- Sale price history: four raises over nine months, the last one ten days ago.
INSERT INTO product_price_history (product_id, price, created_at, updated_at)
SELECT pr.id, round(p.price / step.divisor / 500) * 500, step.at, step.at
FROM seed_product p
JOIN product_types t ON t.name = p.type_name
JOIN product_names n ON n.name = p.name
JOIN product_finishes f ON f.name = p.finish
JOIN product_colors c ON c.name = p.color
JOIN product_sizes z ON z.name = p.size
JOIN products pr ON pr.product_type_id = t.id AND pr.product_name_id = n.id
  AND pr.product_finish_id = f.id AND pr.product_color_id = c.id
  AND pr.product_size_id = z.id
CROSS JOIN (VALUES
  (1.60, now() - interval '9 months'),
  (1.35, now() - interval '6 months'),
  (1.15, now() - interval '3 months'),
  (1.00, now() - interval '10 days')
) AS step(divisor, at);

-- Bills of materials per model; a NULL size applies to every size.
CREATE TEMP TABLE seed_bom (
  type_name text, name text, finish text, size text, supply text, quantity numeric
) ON COMMIT DROP;

INSERT INTO seed_bom VALUES
  ('Billetera', 'Hefesto', 'Lisa', NULL, 'Vaqueta 2 mm', 0.06),
  ('Billetera', 'Hefesto', 'Lisa', NULL, 'Hilo encerado 0,8 mm', 2),
  ('Billetera', 'Hefesto', 'Lisa', NULL, 'Adhesivo de contacto', 0.01),
  ('Billetera', 'Hefesto', 'Lisa', NULL, 'Caja regalo', 1),
  ('Billetera', 'Hefesto', 'Grabada', NULL, 'Vaqueta 2 mm', 0.06),
  ('Billetera', 'Hefesto', 'Grabada', NULL, 'Hilo encerado 0,8 mm', 2),
  ('Billetera', 'Hefesto', 'Grabada', NULL, 'Adhesivo de contacto', 0.01),
  ('Billetera', 'Hefesto', 'Grabada', NULL, 'Caja regalo', 1),
  ('Cinturon', 'Ares', 'Grabada', NULL, 'Suela 4 mm', 0.04),
  ('Cinturon', 'Ares', 'Grabada', NULL, 'Hebilla 35 mm', 1),
  ('Cinturon', 'Ares', 'Grabada', NULL, 'Remache doble', 2),
  ('Cinturon', 'Poseidon', 'Teñida', NULL, 'Suela 4 mm', 0.05),
  ('Cinturon', 'Poseidon', 'Teñida', NULL, 'Hebilla 40 mm', 1),
  ('Cinturon', 'Poseidon', 'Teñida', NULL, 'Remache doble', 2),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Vaqueta 3 mm', 0.9),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Forro de lienzo', 0.6),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Cierre metalico 20 cm', 2),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Argolla D 25 mm', 4),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Remache doble', 12),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Hilo encerado 0,8 mm', 20),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Confeccion mochila', 1),
  ('Mochila', 'Odiseo', 'Lisa', NULL, 'Bolsa de tela', 1),
  ('Deskpad', 'Hermes', 'Lisa', 'Mediano', 'Cuero graso 1,4 mm', 0.24),
  ('Deskpad', 'Hermes', 'Lisa', 'Mediano', 'Hilo encerado 0,8 mm', 3),
  ('Deskpad', 'Hermes', 'Lisa', 'Grande', 'Cuero graso 1,4 mm', 0.32),
  ('Deskpad', 'Hermes', 'Lisa', 'Grande', 'Hilo encerado 0,8 mm', 4),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Vaqueta 2 mm', 0.25),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Forro de lienzo', 0.15),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Cierre metalico 20 cm', 1),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Argolla D 25 mm', 2),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Hilo encerado 0,8 mm', 6),
  ('Riñonera', 'Artemisa', 'Lisa', NULL, 'Bolsa de tela', 1),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Mediano', 'Vaqueta 2 mm', 0.35),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Mediano', 'Forro de lienzo', 0.3),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Mediano', 'Hilo encerado 0,8 mm', 8),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Grande', 'Vaqueta 2 mm', 0.45),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Grande', 'Forro de lienzo', 0.4),
  ('Porta Notebook', 'Atenea', 'Lisa', 'Grande', 'Hilo encerado 0,8 mm', 10),
  ('Porta Notebook', 'Atenea', 'Lisa', NULL, 'Cierre metalico 20 cm', 1),
  ('Porta Notebook', 'Atenea', 'Lisa', NULL, 'Bolsa de tela', 1),
  ('Posavasos', 'Apolo', 'Print', NULL, 'Cuero graso 1,4 mm', 0.04),
  ('Posavasos', 'Apolo', 'Print', NULL, 'Caja regalo', 1),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', NULL, 'Vaqueta 2 mm', 0.05),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', NULL, 'Hilo encerado 0,8 mm', 2),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', NULL, 'Adhesivo de contacto', 0.01),
  ('Estuche Anteojos', 'Afrodita', 'Repujada', NULL, 'Caja regalo', 1);

INSERT INTO supplies_per_product_history (product_id, supply_id, quantity, created_at, updated_at)
SELECT pr.id, su.id, b.quantity, now() - interval '10 months', now() - interval '10 months'
FROM seed_bom b
JOIN product_types t ON t.name = b.type_name
JOIN product_names n ON n.name = b.name
JOIN product_finishes f ON f.name = b.finish
JOIN products pr ON pr.product_type_id = t.id AND pr.product_name_id = n.id
  AND pr.product_finish_id = f.id
JOIN product_sizes z ON z.id = pr.product_size_id
  AND (b.size IS NULL OR z.name = b.size)
JOIN supplies su ON su.name = b.supply;

-- Six months of expenses; amounts drift ~3 % a month; no date in the future.
INSERT INTO expenses (amount, concept, date, category_id, created_at, updated_at)
SELECT round(e.amount / power(1.03, k), -2),
       e.concept,
       LEAST(current_date,
             (date_trunc('month', current_date) - make_interval(months => k))::date
               + e.day - 1),
       c.id, now(), now()
FROM (VALUES
  ('Materia prima', 'Compra de cuero - Curtiembre Prometeo', 780000, 5),
  ('Materia prima', 'Herrajes - Herrajes Vulcano', 140000, 6),
  ('Packaging', 'Cajas y bolsas - Embalajes Pandora', 95000, 8),
  ('Envio', 'Envios a clientes', 64000, 20),
  ('Servicios', 'Plan Tiendanube', 32000, 1),
  ('Servicios', 'Luz y alquiler del taller', 180000, 10)
) AS e(category, concept, amount, day)
JOIN expense_categories c ON c.name = e.category
CROSS JOIN generate_series(0, 5) AS k;

INSERT INTO expenses (amount, concept, date, category_id, created_at, updated_at)
SELECT e.amount, e.concept, current_date - e.days_ago, c.id, now(), now()
FROM (VALUES
  ('Herramientas', 'Service de la maquina de coser', 120000, 120),
  ('Herramientas', 'Juego de sacabocados', 45000, 35),
  ('Otros', 'Stand en feria de diseno', 150000, 65)
) AS e(category, concept, amount, days_ago)
JOIN expense_categories c ON c.name = e.category;

-- A read-only investor role, so the roles screen has a custom role to show.
INSERT INTO roles (name, description, is_system, can_view_products, can_view_supplies,
                   can_use_calculator, can_manage_scenarios)
VALUES ('Inversor', 'Ve costos y margenes y simula escenarios; no edita', false,
        true, true, true, true);

-- Invented users: data only (the demo instance has no Google sign-in).
INSERT INTO users (email, name, role_id)
SELECT u.email, u.name, r.id
FROM (VALUES
  ('inversora@example.com', 'Inversora Ejemplo', 'Inversor'),
  ('taller@example.com', 'Taller Ejemplo', 'USER')
) AS u(email, name, role_name)
JOIN roles r ON r.name = u.role_name;

-- Scenarios: two of the demo user, one public of the invented investor.
INSERT INTO scenarios (name, user_id, is_public, gateway_slug, payment_method,
                       withdrawal_days, installments, plan_id)
SELECT s.name, coalesce(d.id, i.id), s.is_public, 'pago_nube', s.payment_method,
       s.withdrawal_days, s.installments, pl.id
FROM (VALUES
  ('Black Friday -15 %', true, false, 'tarjeta_debito_credito', 14, 3),
  ('Lista 2027 +20 %', true, false, 'transferencia', 1, 1),
  ('Lista mayorista', false, true, 'transferencia', 1, 1)
) AS s(name, of_demo, is_public, payment_method, withdrawal_days, installments)
LEFT JOIN seed_demo_user d ON s.of_demo
LEFT JOIN users i ON NOT s.of_demo AND i.email = 'inversora@example.com'
JOIN tn_plans pl ON pl.slug = 'esencial';

INSERT INTO scenario_overrides (scenario_id, product_id, override_price)
SELECT sc.id, pr.id, round(cur.price * f.factor / 500) * 500
FROM (VALUES
  ('Black Friday -15 %', 0.85, ARRAY['Billetera', 'Mochila', 'Riñonera']),
  ('Lista 2027 +20 %', 1.20, NULL),
  ('Lista mayorista', 0.70, NULL)
) AS f(scenario, factor, only_types)
JOIN scenarios sc ON sc.name = f.scenario
CROSS JOIN products pr
JOIN product_types t ON t.id = pr.product_type_id
JOIN LATERAL (
  SELECT h.price FROM product_price_history h
  WHERE h.product_id = pr.id ORDER BY h.created_at DESC LIMIT 1
) AS cur ON true
WHERE f.only_types IS NULL OR t.name = ANY (f.only_types);

COMMIT;
