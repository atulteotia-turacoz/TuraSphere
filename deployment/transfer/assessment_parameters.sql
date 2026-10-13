-- =====================================================================
-- assessment_parameters — standard parameter table as on 2026-10-13
-- Scoring per "parameters (1).xlsx": 48 parameters, full scale 50.
-- Tiers of one criterion share a score_group and count together up to
-- group_max_score (C.2 → 4, C.3 articles → 3, C.5 → 3, C.6 → 2, C.7 → 2,
-- C.8 → 2, C.10 Practo → 1).
--
-- Safe to run more than once. Matches standard rows by `code`: updates the
-- ones that exist, inserts the ones that don't. Row ids, user preferences,
-- custom (user-created) parameters and past assessment scores are untouched.
--   mysql --default-character-set=utf8mb4 -u turaquant_user -p turaquant_db < assessment_parameters.sql
-- =====================================================================

SET NAMES utf8mb4;

-- 1. New columns (the backend also adds these on start; skipped if present)
SET @db = DATABASE();
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='assessment_parameters' AND COLUMN_NAME='score_group')=0,
  'ALTER TABLE assessment_parameters ADD COLUMN score_group VARCHAR(50) NULL', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='assessment_parameters' AND COLUMN_NAME='group_max_score')=0,
  'ALTER TABLE assessment_parameters ADD COLUMN group_max_score FLOAT NULL', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. Load the standard table into a temp table
DROP TEMPORARY TABLE IF EXISTS tmp_std_params;
CREATE TEMPORARY TABLE tmp_std_params (
  category VARCHAR(100) NOT NULL, code VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL,
  description TEXT, max_score FLOAT, score_group VARCHAR(50), group_max_score FLOAT,
  is_active TINYINT(1), scoring_source VARCHAR(50), sort_order INT
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO tmp_std_params (category, code, name, description, max_score, score_group, group_max_score, is_active, scoring_source, sort_order) VALUES
('Selection Criteria - Qualification', 'SC_GRADUATION', 'Graduation', 'Relevant graduation degree', 1, NULL, NULL, 1, 'cv', 1),
('Selection Criteria - Qualification', 'SC_POST_GRADUATION', 'Post Graduation', 'Post graduation degree', 2, NULL, NULL, 1, 'cv', 2),
('Selection Criteria - Qualification', 'SC_FELLOWSHIP', 'Fellowship', 'Fellowship qualification', 2, NULL, NULL, 1, 'cv', 3),
('Selection Criteria - Qualification', 'SC_OTHER_QUALIFICATION', 'Any Other Qualification', 'Any other relevant qualification', 1, NULL, NULL, 1, 'cv', 4),
('Selection Criteria - Qualification', 'SC_NON_DOCTOR_DEGREE', 'For non-doctors - Any Relevant Degree / Diploma', 'Relevant degree or diploma for non-doctor HCPs', 1, NULL, NULL, 1, 'cv', 5),
('Selection Criteria - Experience', 'SC_YEARS_EXPERIENCE', 'No. of Years of Experience', 'Less than 5 (1), 5-10 (2), 10-15 (3), 15+ (4)', 2, NULL, NULL, 1, 'cv', 6),
('Selection Criteria - Surgeons', 'SC_SURGERIES_PER_YEAR', 'No. of surgeries / procedures per year', 'Less than 100 (1), 100-200 (2), 200-500 (3), 500+ (4)', 2, NULL, NULL, 1, 'cv', 7),
('Selection Criteria - Surgeons', 'SC_SURGICAL_DESCRIPTION', 'Brief Description of surgical procedure undertaken', 'Description of surgical procedures', 1, NULL, NULL, 1, 'cv', 8),
('Selection Criteria - Surgeons', 'SC_UNIQUE_EXPERTISE', 'Any Unique Surgical / Clinical Expertise', 'Unique surgical or clinical expertise', 1, NULL, NULL, 1, 'cv', 9),
('Selection Criteria - Publications', 'SC_PUB_NATIONAL', 'Publication / Presentation - National Level', 'National level publications or presentations', 1, NULL, NULL, 1, 'pubmed', 10),
('Selection Criteria - Publications', 'SC_PUB_INTERNATIONAL', 'Publication / Presentation - International Level', 'International level publications or presentations', 2, NULL, NULL, 1, 'pubmed', 11),
('Selection Criteria - Faculty', 'SC_FACULTY_POSITIONS', 'Faculty Positions', 'Holds faculty positions at academic institutions', 1, NULL, NULL, 1, 'cv', 12),
('C.1 Leadership', 'C1_BOARD_MEMBER', 'Board member on one or more medical association(s)', 'Physician is a board member on one or more medical association(s)', 1, NULL, NULL, 1, 'cv', 13),
('C.1 Leadership', 'C1_ADVISORY_BOARDS', 'Participates regularly in advisory boards (industry sponsored)', 'Physician participates regularly in advisory boards (industry sponsored)', 1, NULL, NULL, 1, 'cv', 14),
('C.1 Leadership', 'C1_TOP_INSTITUTION', 'Current affiliation with top institution as Chief or full Professor', 'Current affiliation with top institution in area of specialty as Chief or full Professor at top teaching hospital or Medical College', 2, NULL, NULL, 1, 'cv', 15),
('C.1 Leadership', 'C1_SOCIETY_LEADER', 'Past/current leader of a National / International Society/Associations', 'Past/current leader of a National / International Society/Associations', 1, NULL, NULL, 1, 'cv', 16),
('C.1 Leadership', 'C1_EXECUTIVE_BOARD', 'Member of executive board or governing body in international committee/society', 'Member in the last 5 years of an executive board or governing body in an international committee/society or professional medical association', 1, NULL, NULL, 1, 'cv', 17),
('C.2 Presentations', 'C2_1_TO_5_ENGAGEMENTS', '1 to 5 domestic and/or global speaking engagements (past 5 years)', 'In the past five years, between 1 to 5 domestic and/or global speaking engagements', 2, 'C2_SPEAKING', 4, 1, 'cv', 18),
('C.2 Presentations', 'C2_5_TO_10_ENGAGEMENTS', '5 to 10 domestic and/or global speaking engagements (past 5 years)', 'In the past five years, between 5 to 10 domestic and/or global speaking engagements', 3, 'C2_SPEAKING', 4, 1, 'cv', 19),
('C.2 Presentations', 'C2_10_PLUS_ENGAGEMENTS', 'More than 10 domestic and/or global speaking engagements (past 5 years)', 'In the past five years, has completed more than 10 domestic and/or global speaking engagements', 4, 'C2_SPEAKING', 4, 1, 'cv', 20),
('C.2 Presentations', 'C2_INTL_SPEAKER', '5+ speaker engagements at international committee/society (past 5 years)', 'In the past 5 years, has completed 5 or more Speaker/presenter engagements at an international committee/society or international professional medical association', 4, 'C2_SPEAKING', 4, 1, 'cv', 21),
('C.3 Publications', 'C3_1_TO_5_ARTICLES', '1-5 peer reviewed articles (past 5 years)', 'In past five years, published 1-5 peer reviewed articles', 2, 'C3_ARTICLES', 3, 1, 'pubmed', 22),
('C.3 Publications', 'C3_5_TO_10_ARTICLES', '5-10 peer reviewed articles or journal editorial board (past 5 years)', 'In past five years, published 5 to 10 peer reviewed articles or participated on 1 journal editorial board or performed systematic reviews', 3, 'C3_ARTICLES', 3, 1, 'pubmed', 23),
('C.3 Publications', 'C3_INTL_PUBLICATION', 'Article in international peer-reviewed journals (past 5 years)', 'In past five years, published at least one article in international peer-reviewed journals or participated in international clinical research/trial or contributed in international product development', 1, 'C3_ARTICLES', 3, 1, 'pubmed', 24),
('C.3 Publications', 'C3_TEXTBOOK_AUTHOR', 'Contributed to a textbook as editor or author', 'Contributed to a textbook as an editor or an author', 1, NULL, NULL, 1, 'cv', 25),
('C.4 Clinical Experience', 'C4_YEARS_CLINICAL', 'No. of Years of Clinical Experience', 'Years of clinical experience score from Selection Criteria', 3, NULL, NULL, 1, 'cv', 26),
('C.4 Clinical Experience', 'C4_PROCEDURES_PER_YEAR', 'No. of surgeries / procedures per year', 'Procedures per year score from Selection Criteria', 0, NULL, NULL, 1, 'cv', 27),
('C.4 Clinical Experience', 'C4_UNIQUE_EXPERTISE', 'Unique clinical expertise', 'Has unique clinical expertise', 2, NULL, NULL, 1, 'cv', 28),
('C.5 Citation Velocity', 'C5_10_PLUS_PUBS_YR', '>10 publications/year (2024-26)', 'More than 10 publications per year in recent period. Source: PubMed date filter', 3, 'C5_PUBS_PER_YEAR', 3, 1, 'pubmed', 29),
('C.5 Citation Velocity', 'C5_5_TO_10_PUBS_YR', '5-10 publications/year', 'Between 5 and 10 publications per year. Source: PubMed date filter', 2, 'C5_PUBS_PER_YEAR', 3, 1, 'pubmed', 30),
('C.5 Citation Velocity', 'C5_2_TO_5_PUBS_YR', '2-5 publications/year', 'Between 2 and 5 publications per year. Source: PubMed date filter', 1, 'C5_PUBS_PER_YEAR', 3, 1, 'pubmed', 31),
('C.6 Network Centrality', 'C6_PAGERANK_TOP_10', 'PageRank Top 10%', 'In the top 10% of their field''s co-author network. Not measurable from PubMed alone; scored by the reviewer (PubMed co-author count shown for reference).', 1, 'C6_NETWORK', 2, 1, 'pubmed', 32),
('C.6 Network Centrality', 'C6_PAGERANK_TOP_25', 'PageRank Top 25%', 'In the top 25% of their field''s co-author network. Not measurable from PubMed alone; scored by the reviewer (PubMed co-author count shown for reference).', 2, 'C6_NETWORK', 2, 1, 'pubmed', 33),
('C.6 Network Centrality', 'C6_COAUTHORS_20_PLUS', 'Co-authors >20', 'Has more than 20 unique co-authors. Source: PubMed co-author count', 2, 'C6_NETWORK', 2, 1, 'pubmed', 34),
('C.7 Patient Impact', 'C7_5_PLUS_TRIALS', '5 or more trials led', 'Led 5 or more clinical trials. Source: ClinicalTrials.gov API', 2, 'C7_TRIALS', 2, 1, 'clinical_trials', 35),
('C.7 Patient Impact', 'C7_3_TO_4_TRIALS', '3-4 trials led', 'Led 3 to 4 clinical trials. Source: ClinicalTrials.gov API', 2, 'C7_TRIALS', 2, 1, 'clinical_trials', 36),
('C.7 Patient Impact', 'C7_1_TO_2_TRIALS', '1-2 trials led', 'Led 1 to 2 clinical trials. Source: ClinicalTrials.gov API', 1, 'C7_TRIALS', 2, 1, 'clinical_trials', 37),
('C.8 Guideline Authority', 'C8_INTL_GUIDELINE', 'International guideline author', 'Author of international clinical guidelines. Source: Google Scholar guideline search', 2, 'C8_GUIDELINES', 2, 1, 'google_scholar', 38),
('C.8 Guideline Authority', 'C8_NATL_GUIDELINE', 'National guideline author', 'Author of national clinical guidelines or consensus statements. Source: Google Scholar consensus search', 1, 'C8_GUIDELINES', 2, 1, 'google_scholar', 39),
('C.9 Emerging Leader', 'C9_PUB_GROWTH_20PCT', 'Publication growth >20%/year', 'Year-over-year publication growth exceeding 20%. Source: PubMed year-over-year analysis', 1, NULL, NULL, 1, 'pubmed', 40),
('C.9 Emerging Leader', 'C9_YOUNG_PROLIFIC', 'Age <45 with significant publications', 'HCP under 45 years old with significant publication record. Source: CV age estimate + publication count', 2, NULL, NULL, 1, 'cv', 41),
('C.10 Practo Patient Influence', 'PRACTO_REVIEWS_HIGH', '100+ patient reviews on Practo', 'High patient engagement with 100 or more reviews on Practo. Source: Practo profile', 1, 'C10_PRACTO', 1, 1, 'practo', 42),
('C.10 Practo Patient Influence', 'PRACTO_REVIEWS_MODERATE', '25+ patient reviews on Practo', 'Moderate patient engagement with 25 or more reviews. Source: Practo profile', 1, 'C10_PRACTO', 1, 1, 'practo', 43),
('C.10 Practo Patient Influence', 'PRACTO_RATING_HIGH', 'High patient rating on Practo', 'Patient rating of 4.5+ (or 90%+) on Practo. Source: Practo profile', 1, 'C10_PRACTO', 1, 1, 'practo', 44),
('C.10 Practo Patient Influence', 'PRACTO_RECOMMENDATIONS', '50+ recommendations on Practo', '50 or more patient/peer recommendations on Practo. Source: Practo profile', 1, 'C10_PRACTO', 1, 1, 'practo', 45),
('C.10 Practo Patient Influence', 'PRACTO_EXPERIENCE', '15+ years experience (Practo verified)', '15 or more years of experience as listed on Practo profile. Source: Practo profile', 1, 'C10_PRACTO', 1, 1, 'practo', 46),
('Medical registration number', 'MEDICAL_REGISTRATION_NO', 'Medical registration number', 'Has a valid medical registration number', 0, NULL, NULL, 1, 'cv', 47),
('Government organisation', 'GOVERNMENT_ORGANISATION', 'Government organisation ', 'Is affiliated to a government institution.', 1, NULL, NULL, 1, 'cv', 48);

-- 3. Update existing standard rows
UPDATE assessment_parameters p
JOIN tmp_std_params t ON t.code = p.code COLLATE utf8mb4_general_ci
SET p.category = t.category, p.name = t.name, p.description = t.description,
    p.max_score = t.max_score, p.score_group = t.score_group, p.group_max_score = t.group_max_score,
    p.is_active = t.is_active, p.scoring_source = t.scoring_source, p.sort_order = t.sort_order,
    p.is_standard = 1, p.created_by = NULL, p.updated_at = NOW()
WHERE p.is_standard = 1 OR p.created_by IS NULL OR p.code IN ('MEDICAL_REGISTRATION_NO', 'GOVERNMENT_ORGANISATION');

-- 4. Insert any that are missing
INSERT INTO assessment_parameters
  (category, code, name, description, max_score, score_group, group_max_score, is_active, is_standard, scoring_source, sort_order, created_by, created_at)
SELECT t.category, t.code, t.name, t.description, t.max_score, t.score_group, t.group_max_score, t.is_active, 1, t.scoring_source, t.sort_order, NULL, NOW()
FROM tmp_std_params t
WHERE NOT EXISTS (SELECT 1 FROM assessment_parameters p WHERE p.code = t.code COLLATE utf8mb4_general_ci AND p.is_standard = 1);

DROP TEMPORARY TABLE tmp_std_params;

-- 5. Check: expect 48 rows and full_scale = 50
SELECT COUNT(*) AS standard_params,
       SUM(CASE WHEN score_group IS NULL THEN max_score ELSE 0 END)
       + (SELECT COALESCE(SUM(cap),0) FROM (SELECT MAX(group_max_score) AS cap FROM assessment_parameters
          WHERE is_standard = 1 AND is_active = 1 AND score_group IS NOT NULL GROUP BY score_group) g) AS full_scale
FROM assessment_parameters WHERE is_standard = 1 AND is_active = 1;
