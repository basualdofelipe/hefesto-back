-- Demo seed: resets the business data of a DEMO instance to a fixed, invented
-- catalog with a year of history. Every name below is made up.
--
-- DESTRUCTIVE. It empties catalogs, suppliers, supplies, products, prices,
-- bills of materials, expenses, scenarios and the whole Tiendanube config and
-- reloads them; it deletes every user except the demo user and the initial
-- admin, every non-system role, and puts the USER role's permissions back.
-- Only the migrations table and the system roles' rows are left alone.
-- Never run it against a real instance.
--
-- Dates are relative to the run (now() - N months), so "the leather price
-- jumped two months ago" stays true on every reset.
--
-- Usage (the demo user must exist: boot the app once so the SeedDemoUser
-- migration creates it from DEMO_EMAIL):
--   psql "$DATABASE_URL" -v demo_email="$DEMO_EMAIL" -v admin_email="$ADMIN_EMAIL" \
--     -f scripts/demo-seed.sql
-- or through the compose service:
--   docker exec -i <postgres-container> psql -U <user> -d <db> \
--     -v demo_email="$DEMO_EMAIL" -v admin_email="$ADMIN_EMAIL" < scripts/demo-seed.sql

\set ON_ERROR_STOP on

BEGIN;

-- The demo user and the initial admin are looked up by their env values,
-- never written in this file.
CREATE TEMP TABLE seed_demo_user ON COMMIT DROP AS
  SELECT id FROM users WHERE email = :'demo_email';
CREATE TEMP TABLE seed_kept_user ON COMMIT DROP AS
  SELECT id FROM users WHERE email IN (:'demo_email', :'admin_email');

DO $$
BEGIN
  IF (SELECT count(*) FROM seed_demo_user) <> 1 THEN
    RAISE EXCEPTION 'demo seed: no user with DEMO_EMAIL; boot the app once so the SeedDemoUser migration creates it';
  END IF;
END $$;

TRUNCATE
  scenario_overrides, scenarios, expenses,
  product_price_history, supplies_per_product_history, products,
  supply_price_history, supplies, suppliers,
  product_types, product_names, product_finishes, product_colors,
  product_sizes, supply_types, expense_categories,
  tn_gateway_rates, tn_installment_rates, tn_tax_config, tn_shipping_config,
  tn_plans, tn_payment_gateways;

DELETE FROM users WHERE id NOT IN (SELECT id FROM seed_kept_user);
DELETE FROM roles WHERE NOT is_system;

-- System roles: ADMIN's permissions are locked by the app; USER's are
-- editable, so put them back.
UPDATE roles SET
  can_view_products = true, can_edit_products = false,
  can_view_supplies = true, can_edit_supplies = false,
  can_view_expenses = true, can_edit_expenses = false,
  can_use_calculator = true, can_manage_scenarios = true,
  can_view_dashboard = true, can_manage_config = false,
  can_manage_users = false
WHERE name = 'USER';

-- The initial admin is required: recreate it if a visitor deleted it. Both
-- kept users end as active ADMINs.
INSERT INTO users (email, name, role_id)
SELECT :'admin_email', 'Administrador', r.id
FROM roles r
WHERE r.name = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = :'admin_email');

UPDATE users SET is_active = true,
  role_id = (SELECT id FROM roles WHERE name = 'ADMIN')
WHERE email IN (:'demo_email', :'admin_email');

-- Tiendanube config: the values of the Hefesto dev database on 2026-10-08,
-- same ids (nothing in the code depends on them, they just stay stable).
INSERT INTO tn_payment_gateways (id, created_at, updated_at, slug, label, is_active) VALUES ('840a6e46-036a-498e-af93-34d1534692ba', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'pago_nube', 'Pago Nube', true);
INSERT INTO tn_payment_gateways (id, created_at, updated_at, slug, label, is_active) VALUES ('9dbd8205-c5c6-4154-a140-d3f798d6dcc6', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'mercado_pago', 'Mercado Pago', true);
INSERT INTO tn_payment_gateways (id, created_at, updated_at, slug, label, is_active) VALUES ('98af3285-c926-4ac5-a8c3-fe551de9a3fa', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'modo', 'MODO', false);
INSERT INTO tn_plans (id, created_at, updated_at, slug, label, cpt_pago_nube, cpt_other_gateways, only_pago_nube, is_active) VALUES ('6fd9c3c9-c991-4e58-b81c-60a6079d42a1', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'inicial', 'Inicial', 0.00, 0.00, true, true);
INSERT INTO tn_plans (id, created_at, updated_at, slug, label, cpt_pago_nube, cpt_other_gateways, only_pago_nube, is_active) VALUES ('c9822920-938d-477b-8f02-8100946ac5d4', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'esencial', 'Esencial', 0.00, 2.00, false, true);
INSERT INTO tn_plans (id, created_at, updated_at, slug, label, cpt_pago_nube, cpt_other_gateways, only_pago_nube, is_active) VALUES ('277c4919-43b4-44ed-975c-c66bff52911e', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'impulso', 'Impulso', 0.00, 1.00, false, true);
INSERT INTO tn_plans (id, created_at, updated_at, slug, label, cpt_pago_nube, cpt_other_gateways, only_pago_nube, is_active) VALUES ('c519affe-e972-4261-9053-277805ad3207', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 'escala', 'Escala', 0.00, 0.70, false, true);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('09918a5b-8710-48e8-be8a-b91557fe0227', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 7, 4.39, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('5b48bb64-4938-4d14-a3ca-c9fc1bc45b4d', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 14, 3.49, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('4450810b-bf76-4085-bff9-e73f184f3689', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'billetera_virtual', 1, 6.09, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('e0b70725-3fe1-416d-9f70-c9632dad2149', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'billetera_virtual', 7, 4.39, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('6e102ce9-a378-4e99-bd0a-89338123f5fd', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'billetera_virtual', 14, 3.49, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('94f71d93-2e3a-435c-a59d-7e6852e72113', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'transferencia', 1, 1.50, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('71c68bfb-86a4-4a0e-9379-608725668282', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '9dbd8205-c5c6-4154-a140-d3f798d6dcc6', 'todos_los_medios', 0, 6.29, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('101e7aac-5ef6-4283-9567-e4b40793666f', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '9dbd8205-c5c6-4154-a140-d3f798d6dcc6', 'todos_los_medios', 10, 4.39, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('aae02421-f5d8-4e26-ab48-df64b8972f52', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '9dbd8205-c5c6-4154-a140-d3f798d6dcc6', 'todos_los_medios', 18, 3.39, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('61f66482-9402-46d4-a8d8-616b624a496b', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '9dbd8205-c5c6-4154-a140-d3f798d6dcc6', 'todos_los_medios', 35, 1.49, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('299e7450-21c0-4e2c-b450-a733f5cad359', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '98af3285-c926-4ac5-a8c3-fe551de9a3fa', 'tarjeta_credito', 1, 7.11, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('318b998a-0f21-4e95-9f82-a7cf3cdc5178', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '98af3285-c926-4ac5-a8c3-fe551de9a3fa', 'tarjeta_credito', 8, 2.80, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('d141156e-4771-4a9f-93fb-d8988221469b', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '98af3285-c926-4ac5-a8c3-fe551de9a3fa', 'tarjeta_debito', 1, 1.80, true, NULL);
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('4b989a71-d9d2-4077-86c0-bf7d3a4fe9f0', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 7, 4.45, true, '6fd9c3c9-c991-4e58-b81c-60a6079d42a1');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('a6146450-4012-4209-9119-a049d9c30de8', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 14, 3.50, true, '6fd9c3c9-c991-4e58-b81c-60a6079d42a1');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('4f54bcdb-b419-4ec9-b68f-15d1f8f262bd', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'transferencia', 1, 1.50, true, '6fd9c3c9-c991-4e58-b81c-60a6079d42a1');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('e3a231d9-c945-4e1b-8a3c-6a4d43093cb7', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 7, 4.39, true, 'c9822920-938d-477b-8f02-8100946ac5d4');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('19b2a0dc-e869-4427-a6f8-69a18fc2f3ff', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 14, 3.49, true, 'c9822920-938d-477b-8f02-8100946ac5d4');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('3352937c-d6a9-4a2f-8c6c-c1576fa7ed67', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'transferencia', 1, 1.50, true, 'c9822920-938d-477b-8f02-8100946ac5d4');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('b2956c07-8747-428d-82b3-54dc5ffccd38', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 7, 4.19, true, '277c4919-43b4-44ed-975c-c66bff52911e');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('17c9aa1a-4a7c-4844-8ae8-9862bdbabbb5', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 14, 3.29, true, '277c4919-43b4-44ed-975c-c66bff52911e');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('6cd22f15-e2ed-4f9c-b423-f111bb99ef5b', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'transferencia', 1, 0.99, true, '277c4919-43b4-44ed-975c-c66bff52911e');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('46d9974a-5580-4e94-99a4-827338dc0f63', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 7, 3.89, true, 'c519affe-e972-4261-9053-277805ad3207');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('bef30095-b587-4a87-942c-f45c7be9cbdb', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'tarjeta_debito_credito', 14, 2.99, true, 'c519affe-e972-4261-9053-277805ad3207');
INSERT INTO tn_gateway_rates (id, created_at, updated_at, gateway_id, payment_method, withdrawal_days, rate_percent, is_active, plan_id) VALUES ('a88da9f3-ade2-473c-8e36-987436bf4b24', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', '840a6e46-036a-498e-af93-34d1534692ba', 'transferencia', 1, 0.85, true, 'c519affe-e972-4261-9053-277805ad3207');
INSERT INTO tn_installment_rates (id, created_at, updated_at, installments, rate_percent, is_active) VALUES ('c19b67be-1e04-4e60-837e-03a7d90cf8c6', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 1, 0.00, true);
INSERT INTO tn_installment_rates (id, created_at, updated_at, installments, rate_percent, is_active) VALUES ('29c862d6-732b-4907-bd25-245df9a1ae63', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 3, 8.42, true);
INSERT INTO tn_installment_rates (id, created_at, updated_at, installments, rate_percent, is_active) VALUES ('95072279-dd26-4f43-b5b7-ce37bdca145c', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 6, 17.41, true);
INSERT INTO tn_installment_rates (id, created_at, updated_at, installments, rate_percent, is_active) VALUES ('7cdac7d8-c0db-4e95-9d77-dd5edc48ce09', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 9, 27.04, true);
INSERT INTO tn_installment_rates (id, created_at, updated_at, installments, rate_percent, is_active) VALUES ('fb63b23e-6f48-409f-8712-240610b18bee', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 12, 37.39, true);
INSERT INTO tn_shipping_config (id, created_at, updated_at, default_shipping_cost, default_shipping_charged, is_active) VALUES ('39717c56-ea28-45b1-b2db-0c7191925045', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 0.00, 0.00, true);
INSERT INTO tn_shipping_config (id, created_at, updated_at, default_shipping_cost, default_shipping_charged, is_active) VALUES ('199b78a6-ddb1-438a-8834-ce1dc445a31f', '2026-09-19 00:26:04.986917+00', '2026-09-19 00:26:04.986917+00', 4000.00, 5000.00, true);
INSERT INTO tn_tax_config (id, created_at, updated_at, iva_rate, iibb_rate, is_active) VALUES ('f26a626a-f188-4cab-bfa1-859f57706a86', '2026-09-18 22:39:39.007461+00', '2026-09-18 22:39:39.007461+00', 21.00, 3.50, true);


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
