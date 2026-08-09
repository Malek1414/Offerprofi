-- ============================================================================
-- A caterer to demo against.
--
-- Not a fixture: this writes to the development database so the flows can be
-- walked in a browser against real rows, which is the standard this repo holds
-- itself to. Idempotent — re-running replaces the tenant rather than adding a
-- second one.
--
-- The numbers are plausible for a Cologne caterer rather than round, because
-- round numbers hide rounding bugs and also look fake on a screen.
--
-- Sign in as johannes@krautundrueben.test / DemoPasswort2026!
-- The hash below was produced by the app's own `hashPassword`, so it verifies
-- through the real login path rather than through a shortcut.
-- ============================================================================

\set ON_ERROR_STOP on

\set agency '''dddddddd-0000-0000-0000-00000000cafe'''
\set owner  '''dddddddd-0000-0000-0000-00000000beef'''

delete from agencies where id = :agency;
delete from users where id = :owner;

insert into users (id, email, password_hash, display_name)
values (:owner, 'johannes@krautundrueben.test',
        'scrypt$65536$8$1$qERKkS0TxX-qnT0aovblsw$JLmuxbd81qPSca13e0spLw7IwU3TjYH_qrS9uMBcz1TCb1TcPHrXgK3tRiBqytVovFMbtmx7rUasAS1vXRiGmw', 'Johannes Weber');

insert into agencies (id, name, legal_name, owner_display_name, locale,
                      default_formality, sla_hours, privacy_notice_url, imprint_url)
values (:agency, 'Kraut & Rüben Catering', 'Kraut & Rüben Catering GmbH',
        'Johannes', 'de', 'sie', 24, '/datenschutz', '/impressum');

insert into agency_members (agency_id, user_id, role) values (:agency, :owner, 'owner');
insert into agency_slugs (agency_id, slug, alias_email)
values (:agency, 'kraut-und-rueben', 'anfragen-kraut-und-rueben@in.example.invalid');
insert into brand_profiles (agency_id, color_primary) values (:agency, '#2F6F4F');

-- The catalogue. Costs are filled in for most items and deliberately missing on
-- one, so the "no cost recorded" path is visible on screen rather than only in a
-- test.
insert into catalog_items
  (id, agency_id, name, description, unit, unit_price_cents, floor_price_cents,
   cost_cents, vat_rate, quantity_driver, active, confirmed_by, confirmed_at)
values
  ('dddddddd-0000-0000-0000-000000000001', :agency,
   'Buffet Klassik', 'Warme und kalte Speisen, drei Hauptgänge, saisonale Beilagen',
   'Person', 7850, 6500, 3140, 7, 'per_guest', true, :owner, now()),
  ('dddddddd-0000-0000-0000-000000000002', :agency,
   'Menü serviert', 'Drei-Gänge-Menü am Tisch serviert, inkl. Eindeckung',
   'Person', 9600, 8200, 4180, 7, 'per_guest', true, :owner, now()),
  ('dddddddd-0000-0000-0000-000000000003', :agency,
   'Servicekraft', 'Auf- und Abbau, Ausgabe, Getränkeservice',
   'Stunde', 4200, 3600, 2650, 19, 'per_hour', true, :owner, now()),
  ('dddddddd-0000-0000-0000-000000000004', :agency,
   'Getränkepauschale', 'Softdrinks, Wasser, Kaffee — offener Ausschank',
   'Person', 1850, 1500, 720, 19, 'per_guest', true, :owner, now()),
  -- No cost recorded. This is the line the owner's page reports as unknown.
  ('dddddddd-0000-0000-0000-000000000005', :agency,
   'Anlieferung und Aufbau', 'Transport, Aufbau vor Ort, Abholung am Folgetag',
   'Pauschale', 24000, 19000, null, 19, 'flat', true, :owner, now());

-- Staffelpreise: the tier for 80 people is the one the suggestion applies.
insert into price_rules (agency_id, catalog_item_id, min_qty, max_qty, unit_price_cents)
values
  (:agency, 'dddddddd-0000-0000-0000-000000000001', 0, 49, 7850),
  (:agency, 'dddddddd-0000-0000-0000-000000000001', 50, 99, 7200),
  (:agency, 'dddddddd-0000-0000-0000-000000000001', 100, null, 6800);

-- A weekend surcharge, so the trace has something to explain.
insert into modifiers (agency_id, kind, condition_json, adjustment_type, value, order_index)
values (:agency, 'weekend', '{"kind": "weekend"}'::jsonb, 'pct', 10, 1);

-- Phase C, structured half: facts he has confirmed. These make the questions
-- specific rather than generic.
insert into agency_facts (agency_id, key, value, confirmed_by_user_id, confirmed_at)
values
  (:agency, 'min_order', 'Mindestbestellung ab 20 Personen.', :owner, now()),
  (:agency, 'delivery_radius', 'Wir liefern im Umkreis von 60 km um Köln.', :owner, now()),
  (:agency, 'notice', 'Anfragen bitte mindestens 14 Tage vorher.', :owner, now()),
  (:agency, 'dietary', 'Vegane, vegetarische und glutenfreie Optionen sind Standard.',
   :owner, now()),
  (:agency, 'payment', 'Anzahlung 30 % bei Bestätigung, Rest nach der Veranstaltung.',
   :owner, now());

-- A linked WhatsApp account, so the mitigations can be demonstrated.
insert into whatsapp_accounts (agency_id, provider_account_id, display_phone, daily_new_thread_cap)
values (:agency, 'demo-unipile-account', '+4922199887766', 20);

select 'seeded: /a/kraut-und-rueben' as result;
