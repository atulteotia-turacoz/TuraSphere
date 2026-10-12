-- =====================================================================
-- 2026-10-09 · Find KOLs bulk scrape → temp table kol_scrape_import → Pending Verification
-- =====================================================================
-- NOT auto-applied on startup (no SQLAlchemy model); only the bulk script creates these tables.
-- kol_pending itself is unchanged.
--
-- EASY WAY (one command): deployment/transfer/kol_scrape_import.sql already contains Steps 1-3
-- (CREATE + rows + the INSERT into kol_pending for atul.teotia@turacoz.com). Safe to run twice.
--   mysql --default-character-set=utf8mb4 -u turaquant_user -p turaquant_db < kol_scrape_import.sql
-- Only run Steps 2-3 below by hand to put the rows under a DIFFERENT account.
--
-- Step 1. Load the data file (it creates kol_scrape_import, then fills it):
--   mysql --default-character-set=utf8mb4 -u turaquant_user -p turaquant_db < kol_scrape_import.sql
-- For reference, the table it creates:
CREATE TABLE `kol_scrape_import` (
  `id` int NOT NULL AUTO_INCREMENT,
  `identity_hash` char(40) COLLATE utf8mb4_general_ci NOT NULL,
  `source` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `title` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `first_name` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_name` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contact_no` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `therapeutic_area` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `also_found_under` varchar(1000) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `geographic_zone` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `state_city` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `specialty` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `subspecialty` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `institution` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `designation` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `influence_level` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `experience_years` int DEFAULT NULL,
  `practo_profile_url` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `web_profile_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kol_scrape_import_identity` (`identity_hash`),
  KEY `ix_kol_scrape_import_ta` (`therapeutic_area`),
  KEY `ix_kol_scrape_import_zone` (`geographic_zone`),
  KEY `ix_kol_scrape_import_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Local-only progress log of the scrape (which TA × country pairs are done). NOT needed on the server.
-- CREATE TABLE `kol_scrape_import_progress` (
--   `therapeutic_area` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
--   `geographic_zone` varchar(60) COLLATE utf8mb4_general_ci NOT NULL,
--   `status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
--   `found` int NOT NULL DEFAULT '0',
--   `inserted` int NOT NULL DEFAULT '0',
--   `notes` text COLLATE utf8mb4_general_ci,
--   `finished_at` datetime DEFAULT NULL,
--   PRIMARY KEY (`therapeutic_area`,`geographic_zone`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Step 2. Choose the account that should own the rows in Pending Verification
-- (admins see every account's queue). Rows the account already has queued or in its
-- directory (same profile link) are skipped.
SET @owner_id = (SELECT id FROM users WHERE email = 'atul.teotia@turacoz.com');
SELECT @owner_id;   -- must not be NULL

-- Step 3. Move the rows into Pending Verification:
INSERT INTO kol_pending
  (user_id, status, source, title, first_name, last_name, email, contact_no, therapeutic_area,
   geographic_zone, state_city, specialty, subspecialty, institution, designation, influence_level,
   experience_years, practo_profile_url, web_profile_url, notes, enrichment_status, created_at, updated_at)
SELECT @owner_id, 'pending', i.source, i.title, i.first_name, i.last_name, i.email, i.contact_no,
       i.therapeutic_area, i.geographic_zone, i.state_city, i.specialty, i.subspecialty, i.institution,
       i.designation, i.influence_level, i.experience_years, i.practo_profile_url, i.web_profile_url,
       CONCAT_WS(' | ', i.notes, IF(i.also_found_under IS NULL, NULL,
                 CONCAT('Also found under: ', REPLACE(i.also_found_under, ',', ', ')))),
       'none', NOW(), NOW()
FROM kol_scrape_import i
WHERE NOT EXISTS (SELECT 1 FROM kol_pending p WHERE p.user_id = @owner_id AND (
        (i.web_profile_url IS NOT NULL AND p.web_profile_url = i.web_profile_url COLLATE utf8mb4_general_ci)
     OR (i.practo_profile_url IS NOT NULL AND p.practo_profile_url = i.practo_profile_url COLLATE utf8mb4_general_ci)))
  AND NOT EXISTS (SELECT 1 FROM kol_directory d WHERE d.user_id = @owner_id AND (
        (i.web_profile_url IS NOT NULL AND d.web_profile_url = i.web_profile_url COLLATE utf8mb4_general_ci)
     OR (i.practo_profile_url IS NOT NULL AND d.practo_profile_url = i.practo_profile_url COLLATE utf8mb4_general_ci)));

-- Verify:
--   SELECT source, therapeutic_area, COUNT(*) FROM kol_pending
--    WHERE user_id = @owner_id AND status = 'pending' GROUP BY 1, 2;
--   SELECT COUNT(*) FROM kol_scrape_import;
-- Step 4 (once verified). Drop the temp table:
--   DROP TABLE kol_scrape_import;
-- Rollback (removes ONLY imported rows that are still pending and unreviewed):
--   DELETE p FROM kol_pending p JOIN kol_scrape_import i
--     ON (p.web_profile_url = i.web_profile_url COLLATE utf8mb4_general_ci
--         OR p.practo_profile_url = i.practo_profile_url COLLATE utf8mb4_general_ci)
--    WHERE p.user_id = @owner_id AND p.status = 'pending' AND p.reviewed_at IS NULL;

