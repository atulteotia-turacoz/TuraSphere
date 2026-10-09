-- =====================================================================
-- Add EVERY column the code expects but the server database is missing.
-- Generated from the backend models on 2026-10-06.
--
-- Safe to run any number of times: each column is added only if it does not
-- exist yet (checked in information_schema). Nothing is dropped or changed.
-- Tables that don't exist at all are skipped — the backend creates those
-- itself on startup.
--
-- Run (either):
--   * command line:  mysql -u <user> -p <database_name> < fix_missing_columns.sql
--   * phpMyAdmin:    select the database -> Import -> choose this file -> Import
-- The last result lists every column that was added (empty = nothing missing).
-- Then: sudo systemctl restart turaquant
-- =====================================================================

DROP PROCEDURE IF EXISTS tq_add_column;
DROP TABLE IF EXISTS tq_added_columns;
CREATE TABLE tq_added_columns (added VARCHAR(140) NOT NULL);
DELIMITER $$
CREATE PROCEDURE tq_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table)
     AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @tq_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE tq_stmt FROM @tq_sql;
    EXECUTE tq_stmt;
    DEALLOCATE PREPARE tq_stmt;
    -- Recorded rather than SELECTed: a result set per CALL breaks phpMyAdmin
    -- ("Commands out of sync").
    INSERT INTO tq_added_columns VALUES (CONCAT(p_table, '.', p_column));
  END IF;
END$$
DELIMITER ;


-- advisory_services
CALL tq_add_column('advisory_services', 'slug', 'VARCHAR(80) NULL');
CALL tq_add_column('advisory_services', 'name', 'VARCHAR(255) NULL');
CALL tq_add_column('advisory_services', 'description', 'TEXT NULL');
CALL tq_add_column('advisory_services', 'fee_label', 'VARCHAR(255) NULL');
CALL tq_add_column('advisory_services', 'phase', 'ENUM(''pre_meeting'',''meeting'',''post_meeting'',''ongoing_support'',''event_specific'') NULL');
CALL tq_add_column('advisory_services', 'default_unit', 'ENUM(''fixed'',''hourly'',''per_day'',''per_kol'',''per_region'',''per_seat'') NOT NULL DEFAULT ''fixed''');
CALL tq_add_column('advisory_services', 'default_price', 'NUMERIC(12, 2) NOT NULL DEFAULT 0');
CALL tq_add_column('advisory_services', 'currency', 'VARCHAR(10) NOT NULL DEFAULT ''USD''');
CALL tq_add_column('advisory_services', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('advisory_services', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('advisory_services', 'created_at', 'DATETIME NULL');
CALL tq_add_column('advisory_services', 'updated_at', 'DATETIME NULL');

-- ai_configurations
CALL tq_add_column('ai_configurations', 'provider', 'VARCHAR(50) NULL');
CALL tq_add_column('ai_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('ai_configurations', 'api_key', 'VARCHAR(500) NULL');
CALL tq_add_column('ai_configurations', 'api_base_url', 'VARCHAR(500) NULL');
CALL tq_add_column('ai_configurations', 'model_name', 'VARCHAR(100) NULL');
CALL tq_add_column('ai_configurations', 'max_tokens', 'INTEGER NULL DEFAULT 4096');
CALL tq_add_column('ai_configurations', 'temperature', 'FLOAT NULL DEFAULT 0.7');
CALL tq_add_column('ai_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('ai_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('ai_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('ai_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('ai_configurations', 'updated_at', 'DATETIME NULL');

-- clinical_trials_configurations
CALL tq_add_column('clinical_trials_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('clinical_trials_configurations', 'base_url', 'VARCHAR(500) NULL DEFAULT ''https://clinicaltrials.gov/api/v2''');
CALL tq_add_column('clinical_trials_configurations', 'requests_per_second', 'INTEGER NULL DEFAULT 3');
CALL tq_add_column('clinical_trials_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('clinical_trials_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('clinical_trials_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('clinical_trials_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('clinical_trials_configurations', 'updated_at', 'DATETIME NULL');

-- ctri_investigators
CALL tq_add_column('ctri_investigators', 'name', 'VARCHAR(255) NULL');
CALL tq_add_column('ctri_investigators', 'name_key', 'VARCHAR(255) NULL');
CALL tq_add_column('ctri_investigators', 'surname', 'VARCHAR(120) NULL');
CALL tq_add_column('ctri_investigators', 'designation', 'VARCHAR(255) NULL');
CALL tq_add_column('ctri_investigators', 'institution', 'VARCHAR(500) NULL');
CALL tq_add_column('ctri_investigators', 'address', 'TEXT NULL');
CALL tq_add_column('ctri_investigators', 'city', 'VARCHAR(120) NULL');
CALL tq_add_column('ctri_investigators', 'state', 'VARCHAR(120) NULL');
CALL tq_add_column('ctri_investigators', 'postal_code', 'VARCHAR(10) NULL');
CALL tq_add_column('ctri_investigators', 'emails_data', 'TEXT NULL');
CALL tq_add_column('ctri_investigators', 'phones_data', 'TEXT NULL');
CALL tq_add_column('ctri_investigators', 'trials_data', 'TEXT NULL');
CALL tq_add_column('ctri_investigators', 'trial_count', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_investigators', 'pi_count', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_investigators', 'thesis_only', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_investigators', 'keywords', 'TEXT NULL');
CALL tq_add_column('ctri_investigators', 'created_at', 'DATETIME NULL');
CALL tq_add_column('ctri_investigators', 'updated_at', 'DATETIME NULL');

-- ctri_trials
CALL tq_add_column('ctri_trials', 'ctri_no', 'VARCHAR(40) NULL');
CALL tq_add_column('ctri_trials', 'title', 'TEXT NULL');
CALL tq_add_column('ctri_trials', 'status', 'VARCHAR(120) NULL');
CALL tq_add_column('ctri_trials', 'condition', 'TEXT NULL');
CALL tq_add_column('ctri_trials', 'registered', 'VARCHAR(20) NULL');
CALL tq_add_column('ctri_trials', 'pg_thesis', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_trials', 'investigators_data', 'TEXT NULL');
CALL tq_add_column('ctri_trials', 'fetched_at', 'DATETIME NULL');

-- linkedin_configurations
CALL tq_add_column('linkedin_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('linkedin_configurations', 'client_id', 'VARCHAR(500) NULL');
CALL tq_add_column('linkedin_configurations', 'client_secret', 'VARCHAR(500) NULL');
CALL tq_add_column('linkedin_configurations', 'redirect_uri', 'VARCHAR(500) NULL');
CALL tq_add_column('linkedin_configurations', 'access_token', 'TEXT NULL');
CALL tq_add_column('linkedin_configurations', 'scopes', 'VARCHAR(500) NULL DEFAULT ''r_liteprofile r_emailaddress''');
CALL tq_add_column('linkedin_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('linkedin_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('linkedin_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('linkedin_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('linkedin_configurations', 'updated_at', 'DATETIME NULL');

-- payment_gateways
CALL tq_add_column('payment_gateways', 'provider', 'VARCHAR(50) NULL');
CALL tq_add_column('payment_gateways', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('payment_gateways', 'api_key', 'VARCHAR(500) NULL');
CALL tq_add_column('payment_gateways', 'api_secret', 'VARCHAR(500) NULL');
CALL tq_add_column('payment_gateways', 'merchant_id', 'VARCHAR(200) NULL');
CALL tq_add_column('payment_gateways', 'is_live', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('payment_gateways', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('payment_gateways', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('payment_gateways', 'supported_methods', 'TEXT NULL');
CALL tq_add_column('payment_gateways', 'supported_currencies', 'TEXT NULL');
CALL tq_add_column('payment_gateways', 'webhook_url', 'VARCHAR(500) NULL');
CALL tq_add_column('payment_gateways', 'description', 'TEXT NULL');
CALL tq_add_column('payment_gateways', 'created_at', 'DATETIME NULL');
CALL tq_add_column('payment_gateways', 'updated_at', 'DATETIME NULL');

-- pubmed_configurations
CALL tq_add_column('pubmed_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('pubmed_configurations', 'api_key', 'VARCHAR(500) NULL');
CALL tq_add_column('pubmed_configurations', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('pubmed_configurations', 'base_url', 'VARCHAR(500) NULL DEFAULT ''https://eutils.ncbi.nlm.nih.gov/entrez/eutils''');
CALL tq_add_column('pubmed_configurations', 'requests_per_second', 'INTEGER NULL DEFAULT 3');
CALL tq_add_column('pubmed_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('pubmed_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('pubmed_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('pubmed_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('pubmed_configurations', 'updated_at', 'DATETIME NULL');

-- site_settings
CALL tq_add_column('site_settings', 'key', 'VARCHAR(100) NULL');
CALL tq_add_column('site_settings', 'value', 'TEXT NULL');
CALL tq_add_column('site_settings', 'updated_at', 'DATETIME NULL');

-- subscription_plans
CALL tq_add_column('subscription_plans', 'name', 'VARCHAR(100) NULL');
CALL tq_add_column('subscription_plans', 'slug', 'VARCHAR(100) NULL');
CALL tq_add_column('subscription_plans', 'description', 'TEXT NULL');
CALL tq_add_column('subscription_plans', 'price_monthly', 'FLOAT NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'price_yearly', 'FLOAT NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'currency', 'VARCHAR(10) NULL DEFAULT ''USD''');
CALL tq_add_column('subscription_plans', 'max_assessments', 'INTEGER NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'max_hcps', 'INTEGER NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'features', 'TEXT NULL');
CALL tq_add_column('subscription_plans', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('subscription_plans', 'is_popular', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'sort_order', 'INTEGER NULL DEFAULT 0');
CALL tq_add_column('subscription_plans', 'badge_text', 'VARCHAR(50) NULL');
CALL tq_add_column('subscription_plans', 'created_at', 'DATETIME NULL');
CALL tq_add_column('subscription_plans', 'updated_at', 'DATETIME NULL');

-- users
CALL tq_add_column('users', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('users', 'full_name', 'VARCHAR(255) NULL');
CALL tq_add_column('users', 'hashed_password', 'VARCHAR(512) NULL');
CALL tq_add_column('users', 'role', 'ENUM(''super_admin'',''admin'',''user'') NOT NULL DEFAULT ''user''');
CALL tq_add_column('users', 'organization', 'VARCHAR(255) NULL');
CALL tq_add_column('users', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('users', 'granted_services', 'TEXT NULL');
CALL tq_add_column('users', 'ai_enabled', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('users', 'kol_tiers_seeded', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('users', 'allowed_services', 'TEXT NULL');
CALL tq_add_column('users', 'created_at', 'DATETIME NULL');
CALL tq_add_column('users', 'updated_at', 'DATETIME NULL');

-- advisory_boards
CALL tq_add_column('advisory_boards', 'title', 'VARCHAR(255) NULL');
CALL tq_add_column('advisory_boards', 'client', 'VARCHAR(255) NULL');
CALL tq_add_column('advisory_boards', 'sponsor', 'VARCHAR(255) NULL');
CALL tq_add_column('advisory_boards', 'therapeutic_areas', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'regions', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'currency', 'VARCHAR(10) NULL');
CALL tq_add_column('advisory_boards', 'status', 'ENUM(''planning'',''scheduled'',''in_progress'',''completed'',''cancelled'') NOT NULL DEFAULT ''planning''');
CALL tq_add_column('advisory_boards', 'current_phase', 'ENUM(''pre_meeting'',''meeting'',''post_meeting'',''ongoing_support'',''event_specific'') NOT NULL DEFAULT ''pre_meeting''');
CALL tq_add_column('advisory_boards', 'scheduled_date', 'DATETIME NULL');
CALL tq_add_column('advisory_boards', 'start_time', 'VARCHAR(5) NULL');
CALL tq_add_column('advisory_boards', 'end_time', 'VARCHAR(5) NULL');
CALL tq_add_column('advisory_boards', 'format', 'ENUM(''in_person'',''virtual'',''hybrid'') NOT NULL DEFAULT ''virtual''');
CALL tq_add_column('advisory_boards', 'venue', 'VARCHAR(500) NULL');
CALL tq_add_column('advisory_boards', 'objective', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'notes', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'kol_ids', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'service_ids', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'pricing', 'TEXT NULL');
CALL tq_add_column('advisory_boards', 'created_by', 'INTEGER NULL');
CALL tq_add_column('advisory_boards', 'created_at', 'DATETIME NULL');
CALL tq_add_column('advisory_boards', 'updated_at', 'DATETIME NULL');

-- billing_profiles
CALL tq_add_column('billing_profiles', 'user_id', 'INTEGER NULL');
CALL tq_add_column('billing_profiles', 'company_name', 'VARCHAR(255) NULL');
CALL tq_add_column('billing_profiles', 'address_line1', 'VARCHAR(255) NULL');
CALL tq_add_column('billing_profiles', 'address_line2', 'VARCHAR(255) NULL');
CALL tq_add_column('billing_profiles', 'city', 'VARCHAR(100) NULL');
CALL tq_add_column('billing_profiles', 'state', 'VARCHAR(100) NULL');
CALL tq_add_column('billing_profiles', 'zip_code', 'VARCHAR(20) NULL');
CALL tq_add_column('billing_profiles', 'country', 'VARCHAR(100) NULL');
CALL tq_add_column('billing_profiles', 'tax_id', 'VARCHAR(100) NULL');
CALL tq_add_column('billing_profiles', 'phone', 'VARCHAR(50) NULL');
CALL tq_add_column('billing_profiles', 'created_at', 'DATETIME NULL');
CALL tq_add_column('billing_profiles', 'updated_at', 'DATETIME NULL');

-- board_kols
CALL tq_add_column('board_kols', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('board_kols', 'name', 'VARCHAR(255) NULL');
CALL tq_add_column('board_kols', 'specialty', 'VARCHAR(255) NULL');
CALL tq_add_column('board_kols', 'affiliation', 'VARCHAR(255) NULL');
CALL tq_add_column('board_kols', 'country', 'VARCHAR(120) NULL');
CALL tq_add_column('board_kols', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('board_kols', 'phone', 'VARCHAR(60) NULL');
CALL tq_add_column('board_kols', 'tier', 'VARCHAR(20) NULL DEFAULT ''tier_2''');
CALL tq_add_column('board_kols', 'notes', 'TEXT NULL');
CALL tq_add_column('board_kols', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('board_kols', 'created_at', 'DATETIME NULL');
CALL tq_add_column('board_kols', 'updated_at', 'DATETIME NULL');

-- ctri_harvests
CALL tq_add_column('ctri_harvests', 'user_id', 'INTEGER NULL');
CALL tq_add_column('ctri_harvests', 'keyword', 'VARCHAR(255) NULL');
CALL tq_add_column('ctri_harvests', 'trials_matched', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_harvests', 'trials_total', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_harvests', 'trials_done', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_harvests', 'trials_new', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_harvests', 'investigators_saved', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('ctri_harvests', 'status', 'VARCHAR(20) NOT NULL DEFAULT ''running''');
CALL tq_add_column('ctri_harvests', 'error', 'TEXT NULL');
CALL tq_add_column('ctri_harvests', 'created_at', 'DATETIME NULL');
CALL tq_add_column('ctri_harvests', 'finished_at', 'DATETIME NULL');

-- form_links
CALL tq_add_column('form_links', 'user_id', 'INTEGER NULL');
CALL tq_add_column('form_links', 'token', 'VARCHAR(64) NULL');
CALL tq_add_column('form_links', 'title', 'VARCHAR(255) NULL');
CALL tq_add_column('form_links', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('form_links', 'created_at', 'DATETIME NULL');

-- google_scholar_configurations
CALL tq_add_column('google_scholar_configurations', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('google_scholar_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('google_scholar_configurations', 'api_key', 'VARCHAR(500) NULL');
CALL tq_add_column('google_scholar_configurations', 'provider', 'VARCHAR(50) NULL DEFAULT ''direct''');
CALL tq_add_column('google_scholar_configurations', 'base_url', 'VARCHAR(500) NULL DEFAULT ''https://scholar.google.com/scholar''');
CALL tq_add_column('google_scholar_configurations', 'proxy_url', 'VARCHAR(500) NULL');
CALL tq_add_column('google_scholar_configurations', 'requests_per_minute', 'INTEGER NULL DEFAULT 10');
CALL tq_add_column('google_scholar_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('google_scholar_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('google_scholar_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('google_scholar_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('google_scholar_configurations', 'updated_at', 'DATETIME NULL');

-- hcp_profiles
CALL tq_add_column('hcp_profiles', 'user_id', 'INTEGER NULL');
CALL tq_add_column('hcp_profiles', 'full_name', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'mobile', 'VARCHAR(50) NULL');
CALL tq_add_column('hcp_profiles', 'therapeutic_area', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'city', 'VARCHAR(100) NULL');
CALL tq_add_column('hcp_profiles', 'country', 'VARCHAR(100) NULL');
CALL tq_add_column('hcp_profiles', 'specialty', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'medical_registration_no', 'VARCHAR(100) NULL');
CALL tq_add_column('hcp_profiles', 'hcp_type', 'VARCHAR(100) NULL');
CALL tq_add_column('hcp_profiles', 'institution', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'affiliations', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'years_of_experience', 'INTEGER NULL');
CALL tq_add_column('hcp_profiles', 'procedures_per_year', 'INTEGER NULL');
CALL tq_add_column('hcp_profiles', 'unique_expertise', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'faculty_positions', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'education', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'age_estimate', 'INTEGER NULL');
CALL tq_add_column('hcp_profiles', 'designation', 'VARCHAR(255) NULL');
CALL tq_add_column('hcp_profiles', 'key_clinical_interests', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'publications', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'conference_presentations', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'advisory_board', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'textbooks', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'office_bearer_positions', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'affiliated_to_government', 'VARCHAR(10) NULL');
CALL tq_add_column('hcp_profiles', 'professional_memberships', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'awards_recognitions', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'cv_file_path', 'VARCHAR(512) NULL');
CALL tq_add_column('hcp_profiles', 'cv_file_hash', 'VARCHAR(64) NULL');
CALL tq_add_column('hcp_profiles', 'consent_file_path', 'VARCHAR(512) NULL');
CALL tq_add_column('hcp_profiles', 'consent_uploaded_at', 'DATETIME NULL');
CALL tq_add_column('hcp_profiles', 'cv_parsed_data', 'TEXT NULL');
CALL tq_add_column('hcp_profiles', 'status', 'ENUM(''draft'',''submitted'',''assessed'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('hcp_profiles', 'created_at', 'DATETIME NULL');
CALL tq_add_column('hcp_profiles', 'updated_at', 'DATETIME NULL');

-- mabm_role_assignments
CALL tq_add_column('mabm_role_assignments', 'user_id', 'INTEGER NULL');
CALL tq_add_column('mabm_role_assignments', 'role', 'ENUM(''super_admin'',''sub_admin'',''medical_writer'',''turacoz_team'') NULL');
CALL tq_add_column('mabm_role_assignments', 'permissions', 'TEXT NULL');
CALL tq_add_column('mabm_role_assignments', 'granted_by', 'INTEGER NULL');
CALL tq_add_column('mabm_role_assignments', 'granted_at', 'DATETIME NULL');
CALL tq_add_column('mabm_role_assignments', 'is_active', 'BOOL NOT NULL DEFAULT 1');

-- master_data
CALL tq_add_column('master_data', 'type', 'ENUM(''therapeutic_area'',''specialty'',''hcp_type'',''pharma_sponsor'',''region'',''currency'') NULL');
CALL tq_add_column('master_data', 'label', 'VARCHAR(255) NULL');
CALL tq_add_column('master_data', 'value', 'VARCHAR(255) NULL');
CALL tq_add_column('master_data', 'keywords', 'TEXT NULL');
CALL tq_add_column('master_data', 'sort_order', 'INTEGER NULL DEFAULT 0');
CALL tq_add_column('master_data', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('master_data', 'user_id', 'INTEGER NULL');
CALL tq_add_column('master_data', 'created_at', 'DATETIME NULL');
CALL tq_add_column('master_data', 'updated_at', 'DATETIME NULL');

-- meeting_provider_config
CALL tq_add_column('meeting_provider_config', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_provider_config', 'provider', 'ENUM(''teams'',''zoom'',''livekit'') NULL');
CALL tq_add_column('meeting_provider_config', 'is_active', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_provider_config', 'client_id', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_provider_config', 'client_secret', 'TEXT NULL');
CALL tq_add_column('meeting_provider_config', 'tenant_id', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_provider_config', 'account_id', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_provider_config', 'extra_config', 'TEXT NULL');
CALL tq_add_column('meeting_provider_config', 'updated_by', 'INTEGER NULL');
CALL tq_add_column('meeting_provider_config', 'created_at', 'DATETIME NULL');
CALL tq_add_column('meeting_provider_config', 'updated_at', 'DATETIME NULL');

-- polls
CALL tq_add_column('polls', 'user_id', 'INTEGER NULL');
CALL tq_add_column('polls', 'title', 'VARCHAR(500) NULL');
CALL tq_add_column('polls', 'description', 'TEXT NULL');
CALL tq_add_column('polls', 'cover_image', 'VARCHAR(500) NULL');
CALL tq_add_column('polls', 'questions', 'TEXT NULL');
CALL tq_add_column('polls', 'options', 'TEXT NULL');
CALL tq_add_column('polls', 'allow_multiple', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('polls', 'show_results', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('polls', 'require_name', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('polls', 'token', 'VARCHAR(64) NULL');
CALL tq_add_column('polls', 'status', 'ENUM(''draft'',''active'',''closed'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('polls', 'created_at', 'DATETIME NULL');
CALL tq_add_column('polls', 'updated_at', 'DATETIME NULL');

-- smtp_config
CALL tq_add_column('smtp_config', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('smtp_config', 'host', 'VARCHAR(255) NULL');
CALL tq_add_column('smtp_config', 'port', 'INTEGER NOT NULL DEFAULT 587');
CALL tq_add_column('smtp_config', 'username', 'VARCHAR(255) NULL');
CALL tq_add_column('smtp_config', 'password', 'TEXT NULL');
CALL tq_add_column('smtp_config', 'use_tls', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('smtp_config', 'from_name', 'VARCHAR(255) NULL');
CALL tq_add_column('smtp_config', 'from_email', 'VARCHAR(320) NULL');
CALL tq_add_column('smtp_config', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('smtp_config', 'updated_by', 'INTEGER NULL');
CALL tq_add_column('smtp_config', 'created_at', 'DATETIME NULL');
CALL tq_add_column('smtp_config', 'updated_at', 'DATETIME NULL');

-- surveys
CALL tq_add_column('surveys', 'user_id', 'INTEGER NULL');
CALL tq_add_column('surveys', 'title', 'VARCHAR(255) NULL');
CALL tq_add_column('surveys', 'description', 'TEXT NULL');
CALL tq_add_column('surveys', 'cover_image', 'VARCHAR(500) NULL');
CALL tq_add_column('surveys', 'intro_fields', 'TEXT NULL');
CALL tq_add_column('surveys', 'settings', 'TEXT NULL');
CALL tq_add_column('surveys', 'token', 'VARCHAR(64) NULL');
CALL tq_add_column('surveys', 'status', 'ENUM(''draft'',''active'',''closed'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('surveys', 'created_at', 'DATETIME NULL');
CALL tq_add_column('surveys', 'updated_at', 'DATETIME NULL');

-- twitter_config
CALL tq_add_column('twitter_config', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('twitter_config', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('twitter_config', 'username', 'VARCHAR(100) NULL');
CALL tq_add_column('twitter_config', 'api_key', 'VARCHAR(255) NULL');
CALL tq_add_column('twitter_config', 'client_id', 'VARCHAR(255) NULL');
CALL tq_add_column('twitter_config', 'api_secret', 'TEXT(500) NULL');
CALL tq_add_column('twitter_config', 'client_secret', 'TEXT(500) NULL');
CALL tq_add_column('twitter_config', 'bearer_token', 'TEXT(1000) NULL');
CALL tq_add_column('twitter_config', 'access_token', 'TEXT(1000) NULL');
CALL tq_add_column('twitter_config', 'access_token_secret', 'TEXT(500) NULL');
CALL tq_add_column('twitter_config', 'is_active', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('twitter_config', 'description', 'TEXT NULL');
CALL tq_add_column('twitter_config', 'created_at', 'DATETIME NULL');
CALL tq_add_column('twitter_config', 'updated_at', 'DATETIME NULL');

-- user_subscriptions
CALL tq_add_column('user_subscriptions', 'user_id', 'INTEGER NULL');
CALL tq_add_column('user_subscriptions', 'plan_id', 'INTEGER NULL');
CALL tq_add_column('user_subscriptions', 'status', 'ENUM(''active'',''cancelled'',''expired'',''past_due'') NULL DEFAULT ''active''');
CALL tq_add_column('user_subscriptions', 'billing_cycle', 'VARCHAR(20) NULL DEFAULT ''monthly''');
CALL tq_add_column('user_subscriptions', 'current_period_start', 'DATETIME NULL');
CALL tq_add_column('user_subscriptions', 'current_period_end', 'DATETIME NULL');
CALL tq_add_column('user_subscriptions', 'cancelled_at', 'DATETIME NULL');
CALL tq_add_column('user_subscriptions', 'created_at', 'DATETIME NULL');
CALL tq_add_column('user_subscriptions', 'updated_at', 'DATETIME NULL');

-- web_search_configurations
CALL tq_add_column('web_search_configurations', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('web_search_configurations', 'display_name', 'VARCHAR(100) NULL');
CALL tq_add_column('web_search_configurations', 'provider', 'VARCHAR(50) NULL DEFAULT ''serpapi''');
CALL tq_add_column('web_search_configurations', 'api_key', 'VARCHAR(500) NULL');
CALL tq_add_column('web_search_configurations', 'is_active', 'BOOL NULL DEFAULT 1');
CALL tq_add_column('web_search_configurations', 'is_default', 'BOOL NULL DEFAULT 0');
CALL tq_add_column('web_search_configurations', 'description', 'TEXT NULL');
CALL tq_add_column('web_search_configurations', 'created_at', 'DATETIME NULL');
CALL tq_add_column('web_search_configurations', 'updated_at', 'DATETIME NULL');

-- web_search_usage
CALL tq_add_column('web_search_usage', 'created_at', 'DATETIME NULL');
CALL tq_add_column('web_search_usage', 'user_id', 'INTEGER NULL');
CALL tq_add_column('web_search_usage', 'config_id', 'INTEGER NULL');
CALL tq_add_column('web_search_usage', 'key_scope', 'VARCHAR(20) NULL');
CALL tq_add_column('web_search_usage', 'feature', 'VARCHAR(40) NOT NULL DEFAULT ''find_kols''');
CALL tq_add_column('web_search_usage', 'provider', 'VARCHAR(20) NULL');
CALL tq_add_column('web_search_usage', 'status', 'VARCHAR(20) NULL');
CALL tq_add_column('web_search_usage', 'results', 'INTEGER NULL DEFAULT 0');
CALL tq_add_column('web_search_usage', 'query', 'VARCHAR(500) NULL');
CALL tq_add_column('web_search_usage', 'error', 'VARCHAR(255) NULL');

-- assessments
CALL tq_add_column('assessments', 'hcp_id', 'INTEGER NULL');
CALL tq_add_column('assessments', 'assessed_by', 'INTEGER NULL');
CALL tq_add_column('assessments', 'c1_leadership_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c1_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c2_presentations_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c2_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c3_publications_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c3_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c4_clinical_experience_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c4_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c5_citation_velocity_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c5_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c6_network_centrality_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c6_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c7_patient_impact_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c7_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c8_guideline_authority_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c8_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'c9_emerging_leader_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'c9_details', 'TEXT NULL');
CALL tq_add_column('assessments', 'base_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'bonus_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'final_score', 'FLOAT NULL');
CALL tq_add_column('assessments', 'tier', 'VARCHAR(50) NULL');
CALL tq_add_column('assessments', 'justification', 'TEXT NULL');
CALL tq_add_column('assessments', 'confidence_flags', 'TEXT NULL');
CALL tq_add_column('assessments', 'pubmed_data', 'TEXT NULL');
CALL tq_add_column('assessments', 'clinical_trials_data', 'TEXT NULL');
CALL tq_add_column('assessments', 'network_data', 'TEXT NULL');
CALL tq_add_column('assessments', 'created_at', 'DATETIME NULL');
CALL tq_add_column('assessments', 'updated_at', 'DATETIME NULL');

-- board_activities
CALL tq_add_column('board_activities', 'board_id', 'INTEGER NULL');
CALL tq_add_column('board_activities', 'action', 'VARCHAR(255) NULL');
CALL tq_add_column('board_activities', 'details', 'TEXT NULL');
CALL tq_add_column('board_activities', 'performed_by', 'INTEGER NULL');
CALL tq_add_column('board_activities', 'actor_label', 'VARCHAR(255) NULL');
CALL tq_add_column('board_activities', 'created_at', 'DATETIME NULL');

-- board_clients
CALL tq_add_column('board_clients', 'board_id', 'INTEGER NULL');
CALL tq_add_column('board_clients', 'name', 'VARCHAR(255) NULL');
CALL tq_add_column('board_clients', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('board_clients', 'organization', 'VARCHAR(255) NULL');
CALL tq_add_column('board_clients', 'access_token', 'VARCHAR(64) NULL');
CALL tq_add_column('board_clients', 'password_hash', 'VARCHAR(255) NULL');
CALL tq_add_column('board_clients', 'password_set_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'token_issued_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'invited_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'invite_sent_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'last_seen_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'created_by', 'INTEGER NULL');
CALL tq_add_column('board_clients', 'created_at', 'DATETIME NULL');
CALL tq_add_column('board_clients', 'updated_at', 'DATETIME NULL');

-- board_meetings
CALL tq_add_column('board_meetings', 'board_id', 'INTEGER NULL');
CALL tq_add_column('board_meetings', 'title', 'VARCHAR(255) NULL');
CALL tq_add_column('board_meetings', 'agenda_summary', 'TEXT NULL');
CALL tq_add_column('board_meetings', 'scheduled_at', 'DATETIME NULL');
CALL tq_add_column('board_meetings', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 60');
CALL tq_add_column('board_meetings', 'format', 'ENUM(''in_person'',''virtual'',''hybrid'') NOT NULL DEFAULT ''virtual''');
CALL tq_add_column('board_meetings', 'status', 'ENUM(''scheduled'',''live'',''completed'',''cancelled'') NOT NULL DEFAULT ''scheduled''');
CALL tq_add_column('board_meetings', 'provider_id', 'INTEGER NULL');
CALL tq_add_column('board_meetings', 'join_url', 'VARCHAR(1000) NULL');
CALL tq_add_column('board_meetings', 'zoom_meeting_id', 'VARCHAR(64) NULL');
CALL tq_add_column('board_meetings', 'zoom_password', 'VARCHAR(64) NULL');
CALL tq_add_column('board_meetings', 'chat_enabled', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('board_meetings', 'organizer_id', 'INTEGER NULL');
CALL tq_add_column('board_meetings', 'created_at', 'DATETIME NULL');
CALL tq_add_column('board_meetings', 'updated_at', 'DATETIME NULL');

-- board_sections
CALL tq_add_column('board_sections', 'board_id', 'INTEGER NULL');
CALL tq_add_column('board_sections', 'kind', 'VARCHAR(20) NOT NULL DEFAULT ''section''');
CALL tq_add_column('board_sections', 'title', 'VARCHAR(300) NULL');
CALL tq_add_column('board_sections', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('board_sections', 'created_at', 'DATETIME NULL');
CALL tq_add_column('board_sections', 'updated_at', 'DATETIME NULL');

-- board_team_members
CALL tq_add_column('board_team_members', 'board_id', 'INTEGER NULL');
CALL tq_add_column('board_team_members', 'user_id', 'INTEGER NULL');
CALL tq_add_column('board_team_members', 'role', 'VARCHAR(50) NOT NULL DEFAULT ''medical_writer''');
CALL tq_add_column('board_team_members', 'assigned_by', 'INTEGER NULL');
CALL tq_add_column('board_team_members', 'assigned_at', 'DATETIME NULL');

-- form_submissions
CALL tq_add_column('form_submissions', 'form_link_id', 'INTEGER NULL');
CALL tq_add_column('form_submissions', 'full_name', 'VARCHAR(255) NULL');
CALL tq_add_column('form_submissions', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('form_submissions', 'city', 'VARCHAR(100) NULL');
CALL tq_add_column('form_submissions', 'specialty', 'VARCHAR(255) NULL');
CALL tq_add_column('form_submissions', 'institution', 'VARCHAR(255) NULL');
CALL tq_add_column('form_submissions', 'designation', 'VARCHAR(255) NULL');
CALL tq_add_column('form_submissions', 'years_of_experience', 'INTEGER NULL');
CALL tq_add_column('form_submissions', 'key_clinical_interests', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'publications', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'conference_presentations', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'professional_memberships', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'awards_recognitions', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'cv_file_path', 'VARCHAR(512) NULL');
CALL tq_add_column('form_submissions', 'cv_parsed_data', 'TEXT NULL');
CALL tq_add_column('form_submissions', 'status', 'ENUM(''pending'',''processing'',''assessed'',''failed'') NOT NULL DEFAULT ''pending''');
CALL tq_add_column('form_submissions', 'hcp_id', 'INTEGER NULL');
CALL tq_add_column('form_submissions', 'created_at', 'DATETIME NULL');

-- invoices
CALL tq_add_column('invoices', 'invoice_number', 'VARCHAR(50) NULL');
CALL tq_add_column('invoices', 'subscription_id', 'INTEGER NULL');
CALL tq_add_column('invoices', 'user_id', 'INTEGER NULL');
CALL tq_add_column('invoices', 'plan_name', 'VARCHAR(100) NULL');
CALL tq_add_column('invoices', 'billing_cycle', 'VARCHAR(20) NULL');
CALL tq_add_column('invoices', 'amount', 'FLOAT NULL');
CALL tq_add_column('invoices', 'currency', 'VARCHAR(10) NULL DEFAULT ''USD''');
CALL tq_add_column('invoices', 'status', 'ENUM(''paid'',''pending'',''failed'',''refunded'') NULL DEFAULT ''paid''');
CALL tq_add_column('invoices', 'billing_name', 'VARCHAR(255) NULL');
CALL tq_add_column('invoices', 'billing_email', 'VARCHAR(255) NULL');
CALL tq_add_column('invoices', 'billing_company', 'VARCHAR(255) NULL');
CALL tq_add_column('invoices', 'billing_address', 'TEXT NULL');
CALL tq_add_column('invoices', 'billing_tax_id', 'VARCHAR(100) NULL');
CALL tq_add_column('invoices', 'period_start', 'DATETIME NULL');
CALL tq_add_column('invoices', 'period_end', 'DATETIME NULL');
CALL tq_add_column('invoices', 'paid_at', 'DATETIME NULL');
CALL tq_add_column('invoices', 'created_at', 'DATETIME NULL');

-- kol_directory
CALL tq_add_column('kol_directory', 'user_id', 'INTEGER NULL');
CALL tq_add_column('kol_directory', 'title', 'VARCHAR(20) NULL');
CALL tq_add_column('kol_directory', 'first_name', 'VARCHAR(150) NULL');
CALL tq_add_column('kol_directory', 'last_name', 'VARCHAR(150) NULL');
CALL tq_add_column('kol_directory', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'contact_no', 'VARCHAR(120) NULL');
CALL tq_add_column('kol_directory', 'therapeutic_area', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'geographic_zone', 'VARCHAR(60) NULL');
CALL tq_add_column('kol_directory', 'state_city', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'specialty', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'subspecialty', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'institution', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'designation', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'influence_level', 'VARCHAR(40) NULL');
CALL tq_add_column('kol_directory', 'functional_expertise', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_directory', 'experience_years', 'INTEGER NULL');
CALL tq_add_column('kol_directory', 'notes', 'TEXT NULL');
CALL tq_add_column('kol_directory', 'x_username', 'VARCHAR(120) NULL');
CALL tq_add_column('kol_directory', 'practo_profile_url', 'VARCHAR(300) NULL');
CALL tq_add_column('kol_directory', 'web_profile_url', 'VARCHAR(500) NULL');
CALL tq_add_column('kol_directory', 'ctri_key', 'VARCHAR(300) NULL');
CALL tq_add_column('kol_directory', 'ctri_data', 'TEXT NULL');
CALL tq_add_column('kol_directory', 'ctri_updated_at', 'DATETIME NULL');
CALL tq_add_column('kol_directory', 'source', 'VARCHAR(20) NOT NULL DEFAULT ''manual''');
CALL tq_add_column('kol_directory', 'hcp_id', 'INTEGER NULL');
CALL tq_add_column('kol_directory', 'enrichment_status', 'VARCHAR(20) NOT NULL DEFAULT ''none''');
CALL tq_add_column('kol_directory', 'enrichment_data', 'TEXT NULL');
CALL tq_add_column('kol_directory', 'enrichment_updated_at', 'DATETIME NULL');
CALL tq_add_column('kol_directory', 'created_at', 'DATETIME NULL');
CALL tq_add_column('kol_directory', 'updated_at', 'DATETIME NULL');

-- poll_votes
CALL tq_add_column('poll_votes', 'poll_id', 'INTEGER NULL');
CALL tq_add_column('poll_votes', 'selected_options', 'TEXT NULL');
CALL tq_add_column('poll_votes', 'voter_name', 'VARCHAR(255) NULL');
CALL tq_add_column('poll_votes', 'voter_email', 'VARCHAR(255) NULL');
CALL tq_add_column('poll_votes', 'created_at', 'DATETIME NULL');

-- survey_questions
CALL tq_add_column('survey_questions', 'survey_id', 'INTEGER NULL');
CALL tq_add_column('survey_questions', 'label', 'TEXT NULL');
CALL tq_add_column('survey_questions', 'question_type', 'ENUM(''text'',''textarea'',''number'',''select'',''multi_select'',''radio'',''checkbox'',''rating'',''date'',''email'',''phone'',''url'',''time'',''yes_no'',''linear_scale'',''file_upload'',''section_header'',''page_break'',''matrix'') NULL');
CALL tq_add_column('survey_questions', 'options', 'TEXT NULL');
CALL tq_add_column('survey_questions', 'image', 'VARCHAR(500) NULL');
CALL tq_add_column('survey_questions', 'is_required', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('survey_questions', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');

-- survey_responses
CALL tq_add_column('survey_responses', 'survey_id', 'INTEGER NULL');
CALL tq_add_column('survey_responses', 'respondent_name', 'VARCHAR(255) NULL');
CALL tq_add_column('survey_responses', 'respondent_email', 'VARCHAR(255) NULL');
CALL tq_add_column('survey_responses', 'intro_data', 'TEXT NULL');
CALL tq_add_column('survey_responses', 'status', 'VARCHAR(16) NOT NULL DEFAULT ''complete''');
CALL tq_add_column('survey_responses', 'last_question_id', 'INTEGER NULL');
CALL tq_add_column('survey_responses', 'submitted_at', 'DATETIME NULL');
CALL tq_add_column('survey_responses', 'updated_at', 'DATETIME NULL');

-- audit_logs
CALL tq_add_column('audit_logs', 'assessment_id', 'INTEGER NULL');
CALL tq_add_column('audit_logs', 'action', 'VARCHAR(255) NULL');
CALL tq_add_column('audit_logs', 'details', 'TEXT NULL');
CALL tq_add_column('audit_logs', 'performed_by', 'INTEGER NULL');
CALL tq_add_column('audit_logs', 'created_at', 'DATETIME NULL');

-- kol_pending
CALL tq_add_column('kol_pending', 'user_id', 'INTEGER NULL');
CALL tq_add_column('kol_pending', 'status', 'VARCHAR(20) NOT NULL DEFAULT ''pending''');
CALL tq_add_column('kol_pending', 'title', 'VARCHAR(20) NULL');
CALL tq_add_column('kol_pending', 'first_name', 'VARCHAR(150) NULL');
CALL tq_add_column('kol_pending', 'last_name', 'VARCHAR(150) NULL');
CALL tq_add_column('kol_pending', 'email', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'contact_no', 'VARCHAR(120) NULL');
CALL tq_add_column('kol_pending', 'therapeutic_area', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'geographic_zone', 'VARCHAR(60) NULL');
CALL tq_add_column('kol_pending', 'state_city', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'specialty', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'subspecialty', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'institution', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'designation', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'influence_level', 'VARCHAR(40) NULL');
CALL tq_add_column('kol_pending', 'functional_expertise', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'experience_years', 'INTEGER NULL');
CALL tq_add_column('kol_pending', 'x_username', 'VARCHAR(120) NULL');
CALL tq_add_column('kol_pending', 'x_name', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'x_bio', 'TEXT NULL');
CALL tq_add_column('kol_pending', 'x_location', 'VARCHAR(255) NULL');
CALL tq_add_column('kol_pending', 'x_followers', 'INTEGER NULL');
CALL tq_add_column('kol_pending', 'x_profile_url', 'VARCHAR(300) NULL');
CALL tq_add_column('kol_pending', 'practo_profile_url', 'VARCHAR(300) NULL');
CALL tq_add_column('kol_pending', 'web_profile_url', 'VARCHAR(500) NULL');
CALL tq_add_column('kol_pending', 'ctri_key', 'VARCHAR(300) NULL');
CALL tq_add_column('kol_pending', 'ctri_data', 'TEXT NULL');
CALL tq_add_column('kol_pending', 'ctri_updated_at', 'DATETIME NULL');
CALL tq_add_column('kol_pending', 'notes', 'TEXT NULL');
CALL tq_add_column('kol_pending', 'source', 'VARCHAR(20) NOT NULL DEFAULT ''twitter''');
CALL tq_add_column('kol_pending', 'enrichment_status', 'VARCHAR(20) NOT NULL DEFAULT ''none''');
CALL tq_add_column('kol_pending', 'enrichment_data', 'TEXT NULL');
CALL tq_add_column('kol_pending', 'enrichment_updated_at', 'DATETIME NULL');
CALL tq_add_column('kol_pending', 'reviewed_by_user_id', 'INTEGER NULL');
CALL tq_add_column('kol_pending', 'reviewed_at', 'DATETIME NULL');
CALL tq_add_column('kol_pending', 'review_notes', 'TEXT NULL');
CALL tq_add_column('kol_pending', 'kol_id', 'INTEGER NULL');
CALL tq_add_column('kol_pending', 'created_at', 'DATETIME NULL');
CALL tq_add_column('kol_pending', 'updated_at', 'DATETIME NULL');

-- meeting_agenda_items
CALL tq_add_column('meeting_agenda_items', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_agenda_items', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_agenda_items', 'title', 'VARCHAR(500) NULL');
CALL tq_add_column('meeting_agenda_items', 'description', 'TEXT NULL');
CALL tq_add_column('meeting_agenda_items', 'duration_minutes', 'INTEGER NULL');
CALL tq_add_column('meeting_agenda_items', 'presenter_user_id', 'INTEGER NULL');

-- meeting_participants
CALL tq_add_column('meeting_participants', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_participants', 'user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_participants', 'hcp_id', 'INTEGER NULL');
CALL tq_add_column('meeting_participants', 'board_kol_id', 'INTEGER NULL');
CALL tq_add_column('meeting_participants', 'role', 'ENUM(''host'',''moderator'',''panel_member'',''participant'',''observer'') NOT NULL DEFAULT ''participant''');
CALL tq_add_column('meeting_participants', 'invite_status', 'ENUM(''pending'',''sent'',''accepted'',''declined'') NOT NULL DEFAULT ''pending''');
CALL tq_add_column('meeting_participants', 'can_speak', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_participants', 'permissions', 'TEXT NULL');
CALL tq_add_column('meeting_participants', 'access_token', 'VARCHAR(64) NULL');
CALL tq_add_column('meeting_participants', 'token_issued_at', 'DATETIME NULL');
CALL tq_add_column('meeting_participants', 'access_code', 'VARCHAR(12) NULL');
CALL tq_add_column('meeting_participants', 'invited_at', 'DATETIME NULL');
CALL tq_add_column('meeting_participants', 'joined_at', 'DATETIME NULL');
CALL tq_add_column('meeting_participants', 'left_at', 'DATETIME NULL');
CALL tq_add_column('meeting_participants', 'updated_at', 'DATETIME NULL');

-- meeting_polls
CALL tq_add_column('meeting_polls', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_polls', 'poll_id', 'INTEGER NULL');
CALL tq_add_column('meeting_polls', 'phase', 'ENUM(''live'') NOT NULL DEFAULT ''live''');
CALL tq_add_column('meeting_polls', 'created_by', 'INTEGER NULL');
CALL tq_add_column('meeting_polls', 'created_at', 'DATETIME NULL');

-- meeting_recordings
CALL tq_add_column('meeting_recordings', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_recordings', 'source', 'ENUM(''provider'',''manual_upload'') NOT NULL DEFAULT ''manual_upload''');
CALL tq_add_column('meeting_recordings', 'file_path_or_url', 'VARCHAR(1000) NULL');
CALL tq_add_column('meeting_recordings', 'duration_seconds', 'INTEGER NULL');
CALL tq_add_column('meeting_recordings', 'recorded_at', 'DATETIME NULL');
CALL tq_add_column('meeting_recordings', 'created_at', 'DATETIME NULL');

-- meeting_surveys
CALL tq_add_column('meeting_surveys', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_surveys', 'survey_id', 'INTEGER NULL');
CALL tq_add_column('meeting_surveys', 'phase', 'ENUM(''pre'',''post'') NULL');
CALL tq_add_column('meeting_surveys', 'created_by', 'INTEGER NULL');
CALL tq_add_column('meeting_surveys', 'created_at', 'DATETIME NULL');

-- meeting_transcript_segments
CALL tq_add_column('meeting_transcript_segments', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_transcript_segments', 'speaker_identity', 'VARCHAR(128) NULL');
CALL tq_add_column('meeting_transcript_segments', 'speaker_name', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_transcript_segments', 'text', 'TEXT NULL');
CALL tq_add_column('meeting_transcript_segments', 'offset_seconds', 'FLOAT NULL');
CALL tq_add_column('meeting_transcript_segments', 'created_at', 'DATETIME NULL');

-- survey_answers
CALL tq_add_column('survey_answers', 'response_id', 'INTEGER NULL');
CALL tq_add_column('survey_answers', 'question_id', 'INTEGER NULL');
CALL tq_add_column('survey_answers', 'answer_text', 'TEXT NULL');

-- meeting_chat_messages
CALL tq_add_column('meeting_chat_messages', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_chat_messages', 'user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_chat_messages', 'participant_id', 'INTEGER NULL');
CALL tq_add_column('meeting_chat_messages', 'sender_name', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_chat_messages', 'sender_role', 'VARCHAR(32) NULL');
CALL tq_add_column('meeting_chat_messages', 'body', 'TEXT NULL');
CALL tq_add_column('meeting_chat_messages', 'created_at', 'DATETIME NULL');

-- meeting_documents
CALL tq_add_column('meeting_documents', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_documents', 'section_id', 'INTEGER NULL');
CALL tq_add_column('meeting_documents', 'doc_session_id', 'INTEGER NULL');
CALL tq_add_column('meeting_documents', 'agenda_item_id', 'INTEGER NULL');
CALL tq_add_column('meeting_documents', 'phase', 'ENUM(''pre'',''during'',''post'') NULL');
CALL tq_add_column('meeting_documents', 'category', 'ENUM(''agenda'',''ppt'',''draft'',''cv'',''reference'',''report'',''questionnaire'',''minutes'',''manuscript'',''other'',''slide_deck'',''pre_read'',''survey_draft'',''approved_materials'',''moderator_guide'',''poll_questions'',''meeting_notes'',''transcript'',''draft_report'',''final_report'',''analysis'',''survey_results'',''client_feedback'') NOT NULL DEFAULT ''other''');
CALL tq_add_column('meeting_documents', 'title', 'VARCHAR(500) NULL');
CALL tq_add_column('meeting_documents', 'version', 'INTEGER NOT NULL DEFAULT 1');
CALL tq_add_column('meeting_documents', 'approval_status', 'ENUM(''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''pending''');
CALL tq_add_column('meeting_documents', 'file_path', 'VARCHAR(1000) NULL');
CALL tq_add_column('meeting_documents', 'mime_type', 'VARCHAR(150) NULL');
CALL tq_add_column('meeting_documents', 'size_bytes', 'BIGINT NULL');
CALL tq_add_column('meeting_documents', 'public_token', 'VARCHAR(64) NULL');
CALL tq_add_column('meeting_documents', 'uploaded_by', 'INTEGER NULL');
CALL tq_add_column('meeting_documents', 'is_enabled', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('meeting_documents', 'allow_comments', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_documents', 'client_visible', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_documents', 'kol_visible', 'BOOL NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_documents', 'created_at', 'DATETIME NULL');
CALL tq_add_column('meeting_documents', 'updated_at', 'DATETIME NULL');

-- meeting_session_comments
CALL tq_add_column('meeting_session_comments', 'agenda_item_id', 'INTEGER NULL');
CALL tq_add_column('meeting_session_comments', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_session_comments', 'participant_id', 'INTEGER NULL');
CALL tq_add_column('meeting_session_comments', 'client_id', 'INTEGER NULL');
CALL tq_add_column('meeting_session_comments', 'user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_session_comments', 'author_type', 'VARCHAR(20) NOT NULL DEFAULT ''participant''');
CALL tq_add_column('meeting_session_comments', 'author_name', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_session_comments', 'body', 'TEXT NULL');
CALL tq_add_column('meeting_session_comments', 'created_at', 'DATETIME NULL');

-- meeting_transcripts
CALL tq_add_column('meeting_transcripts', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_transcripts', 'recording_id', 'INTEGER NULL');
CALL tq_add_column('meeting_transcripts', 'raw_text', 'MEDIUMTEXT NULL');
CALL tq_add_column('meeting_transcripts', 'edited_text', 'MEDIUMTEXT NULL');
CALL tq_add_column('meeting_transcripts', 'status', 'ENUM(''draft'',''edited'',''finalized'',''shared'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('meeting_transcripts', 'edited_by', 'INTEGER NULL');
CALL tq_add_column('meeting_transcripts', 'finalized_by', 'INTEGER NULL');
CALL tq_add_column('meeting_transcripts', 'shared_at', 'DATETIME NULL');
CALL tq_add_column('meeting_transcripts', 'created_at', 'DATETIME NULL');
CALL tq_add_column('meeting_transcripts', 'updated_at', 'DATETIME NULL');

-- document_approvals
CALL tq_add_column('document_approvals', 'document_id', 'INTEGER NULL');
CALL tq_add_column('document_approvals', 'board_client_id', 'INTEGER NULL');
CALL tq_add_column('document_approvals', 'status', 'ENUM(''pending'',''approved'',''changes_requested'',''rejected'') NOT NULL DEFAULT ''pending''');
CALL tq_add_column('document_approvals', 'comment', 'TEXT NULL');
CALL tq_add_column('document_approvals', 'decided_at', 'DATETIME NULL');
CALL tq_add_column('document_approvals', 'created_at', 'DATETIME NULL');
CALL tq_add_column('document_approvals', 'updated_at', 'DATETIME NULL');

-- manuscripts
CALL tq_add_column('manuscripts', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('manuscripts', 'title', 'VARCHAR(500) NULL');
CALL tq_add_column('manuscripts', 'document_id', 'INTEGER NULL');
CALL tq_add_column('manuscripts', 'status', 'ENUM(''draft'',''review'',''finalized'',''submitted'',''under_review'',''accepted'',''rejected'',''resubmitted'',''published'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('manuscripts', 'journal_name', 'VARCHAR(255) NULL');
CALL tq_add_column('manuscripts', 'submitted_at', 'DATETIME NULL');
CALL tq_add_column('manuscripts', 'accepted_at', 'DATETIME NULL');
CALL tq_add_column('manuscripts', 'published_at', 'DATETIME NULL');
CALL tq_add_column('manuscripts', 'published_url', 'VARCHAR(1000) NULL');
CALL tq_add_column('manuscripts', 'doi', 'VARCHAR(255) NULL');
CALL tq_add_column('manuscripts', 'last_status_email_at', 'DATETIME NULL');
CALL tq_add_column('manuscripts', 'created_by', 'INTEGER NULL');
CALL tq_add_column('manuscripts', 'created_at', 'DATETIME NULL');
CALL tq_add_column('manuscripts', 'updated_at', 'DATETIME NULL');

-- meeting_document_comments
CALL tq_add_column('meeting_document_comments', 'document_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_comments', 'user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_comments', 'body', 'TEXT NULL');
CALL tq_add_column('meeting_document_comments', 'created_at', 'DATETIME NULL');

-- meeting_document_views
CALL tq_add_column('meeting_document_views', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_views', 'document_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_views', 'agenda_item_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_views', 'participant_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_views', 'participant_label', 'VARCHAR(255) NULL');
CALL tq_add_column('meeting_document_views', 'source', 'ENUM(''view'',''download'') NOT NULL DEFAULT ''view''');
CALL tq_add_column('meeting_document_views', 'seconds_spent', 'INTEGER NOT NULL DEFAULT 0');
CALL tq_add_column('meeting_document_views', 'opened_at', 'DATETIME NULL');
CALL tq_add_column('meeting_document_views', 'updated_at', 'DATETIME NULL');

-- meeting_document_visibility
CALL tq_add_column('meeting_document_visibility', 'document_id', 'INTEGER NULL');
CALL tq_add_column('meeting_document_visibility', 'user_id', 'INTEGER NULL');

-- meeting_minutes
CALL tq_add_column('meeting_minutes', 'meeting_id', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes', 'source_transcript_id', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes', 'draft_text', 'MEDIUMTEXT NULL');
CALL tq_add_column('meeting_minutes', 'final_text', 'MEDIUMTEXT NULL');
CALL tq_add_column('meeting_minutes', 'status', 'ENUM(''draft'',''shared'',''finalized'') NOT NULL DEFAULT ''draft''');
CALL tq_add_column('meeting_minutes', 'created_by', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes', 'finalized_by', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes', 'shared_at', 'DATETIME NULL');
CALL tq_add_column('meeting_minutes', 'finalized_at', 'DATETIME NULL');
CALL tq_add_column('meeting_minutes', 'created_at', 'DATETIME NULL');
CALL tq_add_column('meeting_minutes', 'updated_at', 'DATETIME NULL');

-- email_logs
CALL tq_add_column('email_logs', 'owner_user_id', 'INTEGER NULL');
CALL tq_add_column('email_logs', 'recipient_email', 'VARCHAR(320) NULL');
CALL tq_add_column('email_logs', 'subject', 'VARCHAR(500) NULL');
CALL tq_add_column('email_logs', 'body_preview', 'TEXT NULL');
CALL tq_add_column('email_logs', 'kind', 'ENUM(''meeting_reminder_24h'',''meeting_reminder_1h'',''minutes_shared'',''minutes_finalized'',''manuscript_shared'',''manuscript_status_change'',''manuscript_15day_ping'',''survey_invite'',''thank_you'',''kol_invite'',''survey_reminder'',''document_review'',''client_invite'',''report_review'',''other'') NOT NULL DEFAULT ''other''');
CALL tq_add_column('email_logs', 'related_board_id', 'INTEGER NULL');
CALL tq_add_column('email_logs', 'related_meeting_id', 'INTEGER NULL');
CALL tq_add_column('email_logs', 'related_manuscript_id', 'INTEGER NULL');
CALL tq_add_column('email_logs', 'success', 'BOOL NOT NULL DEFAULT 1');
CALL tq_add_column('email_logs', 'error', 'TEXT NULL');
CALL tq_add_column('email_logs', 'sent_at', 'DATETIME NULL');

-- manuscript_comments
CALL tq_add_column('manuscript_comments', 'manuscript_id', 'INTEGER NULL');
CALL tq_add_column('manuscript_comments', 'user_id', 'INTEGER NULL');
CALL tq_add_column('manuscript_comments', 'body', 'TEXT NULL');
CALL tq_add_column('manuscript_comments', 'created_at', 'DATETIME NULL');

-- manuscript_status_history
CALL tq_add_column('manuscript_status_history', 'manuscript_id', 'INTEGER NULL');
CALL tq_add_column('manuscript_status_history', 'status', 'ENUM(''draft'',''review'',''finalized'',''submitted'',''under_review'',''accepted'',''rejected'',''resubmitted'',''published'') NULL');
CALL tq_add_column('manuscript_status_history', 'note', 'TEXT NULL');
CALL tq_add_column('manuscript_status_history', 'changed_by', 'INTEGER NULL');
CALL tq_add_column('manuscript_status_history', 'changed_at', 'DATETIME NULL');

-- meeting_minutes_comments
CALL tq_add_column('meeting_minutes_comments', 'minutes_id', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes_comments', 'user_id', 'INTEGER NULL');
CALL tq_add_column('meeting_minutes_comments', 'body', 'TEXT NULL');
CALL tq_add_column('meeting_minutes_comments', 'created_at', 'DATETIME NULL');

DROP PROCEDURE IF EXISTS tq_add_column;
-- Columns this run added. phpMyAdmin's Import page may not show this result —
-- open the tq_added_columns table to see the list, then delete it:
--   DROP TABLE tq_added_columns;
SELECT added AS columns_added FROM tq_added_columns;
