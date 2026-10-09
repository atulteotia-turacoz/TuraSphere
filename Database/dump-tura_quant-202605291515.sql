-- MySQL dump 10.13  Distrib 9.0.1, for macos14 (arm64)
--
-- Host: localhost    Database: tura_quant
-- ------------------------------------------------------
-- Server version	9.0.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `advisory_boards`
--

DROP TABLE IF EXISTS `advisory_boards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `advisory_boards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `client` varchar(255) DEFAULT NULL,
  `sponsor` varchar(255) DEFAULT NULL,
  `therapeutic_areas` text,
  `regions` text,
  `currency` varchar(10) DEFAULT NULL,
  `status` enum('planning','scheduled','in_progress','completed','cancelled') NOT NULL,
  `current_phase` enum('pre_meeting','meeting','post_meeting','ongoing_support','event_specific') NOT NULL,
  `scheduled_date` datetime DEFAULT NULL,
  `format` enum('in_person','virtual','hybrid') NOT NULL,
  `venue` varchar(500) DEFAULT NULL,
  `objective` text,
  `notes` text,
  `kol_ids` text,
  `service_ids` text,
  `pricing` text,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_advisory_boards_created_by` (`created_by`),
  KEY `ix_advisory_boards_id` (`id`),
  KEY `ix_advisory_boards_status` (`status`),
  CONSTRAINT `advisory_boards_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `advisory_boards`
--

LOCK TABLES `advisory_boards` WRITE;
/*!40000 ALTER TABLE `advisory_boards` DISABLE KEYS */;
INSERT INTO `advisory_boards` VALUES (2,'Test Adboard','ram','','[\"menuscript\"]','[\"india\"]','USD','planning','pre_meeting','2026-05-13 00:00:00','virtual','','Testtst Objective','','[]','[\"pre_concept_dev\", \"pre_stakeholder\", \"mtg_facilitation\", \"mtg_tech_support\", \"mtg_moderation\", \"mtg_mom\", \"post_detailed_report\", \"post_executive_summary\", \"post_data_analysis\", \"post_kol_followup\", \"ong_next_cycle\", \"ong_kol_relationship\", \"ong_consultancy\", \"evt_data_viz\", \"evt_competitor_bench\"]',NULL,7,'2026-05-05 07:37:11','2026-05-05 07:37:11');
/*!40000 ALTER TABLE `advisory_boards` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `advisory_services`
--

DROP TABLE IF EXISTS `advisory_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `advisory_services` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(80) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `fee_label` varchar(255) DEFAULT NULL,
  `phase` enum('pre_meeting','meeting','post_meeting','ongoing_support','event_specific') NOT NULL,
  `default_unit` enum('fixed','hourly','per_day','per_kol','per_region','per_seat') NOT NULL,
  `default_price` decimal(12,2) NOT NULL,
  `currency` varchar(10) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `sort_order` int NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_advisory_services_slug` (`slug`),
  KEY `ix_advisory_services_id` (`id`),
  KEY `ix_advisory_services_phase` (`phase`),
  KEY `ix_advisory_services_is_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=76 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `advisory_services`
--

LOCK TABLES `advisory_services` WRITE;
/*!40000 ALTER TABLE `advisory_services` DISABLE KEYS */;
INSERT INTO `advisory_services` VALUES (1,'pre_concept_dev','Advisory Board Concept Development','Design of meeting objectives, agenda, and participant selection criteria.','Strategy and planning fee','pre_meeting','fixed',0.00,'USD',1,1,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(2,'pre_stakeholder','Stakeholder Consultation','Engaging with key internal stakeholders for input.','Stakeholder management fee','pre_meeting','fixed',0.00,'USD',1,2,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(3,'pre_kol_recruitment','KOL Identification and Recruitment','Researching and engaging with suitable KOLs.','KOL identification and invitation fee','pre_meeting','per_kol',0.00,'USD',1,3,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(4,'pre_materials','Pre-Meeting Materials Development','Developing materials like the agenda, pre-reads, presentations, and briefing documents.','Content creation fee','pre_meeting','fixed',0.00,'USD',1,4,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(5,'pre_invitations','Invitation & Communication Management','Sending invites, tracking RSVPs, and coordinating with participants.','Administrative and logistics fee','pre_meeting','fixed',0.00,'USD',1,5,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(6,'pre_logistics','Logistics Management','Venue booking, travel and accommodation coordination, and technology setup.','Event logistics fee','pre_meeting','fixed',0.00,'USD',1,6,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(7,'pre_compliance','Compliance and Regulatory Consultation','Ensuring the meeting aligns with regulatory guidelines (e.g. fair market value, Sunshine Act, GDPR).','Compliance consultation fee','pre_meeting','fixed',0.00,'USD',1,7,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(8,'pre_kol_contracts','KOL Contract Management','Drafting, reviewing, and managing KOL contracts and confidentiality agreements.','Legal and contract management fee','pre_meeting','per_kol',0.00,'USD',1,8,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(9,'pre_briefing','Pre-Meeting Training/Briefing','Conducting sessions to prepare KOLs or internal teams for the advisory board.','Training session fee','pre_meeting','hourly',0.00,'USD',1,9,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(10,'pre_risk_mitigation','Risk Mitigation Strategy','Identifying and addressing potential risks (e.g. KOL conflicts of interest or participant unavailability).','Risk assessment and mitigation strategy fee','pre_meeting','fixed',0.00,'USD',1,10,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(11,'pre_agenda_tuning','Agenda Fine-Tuning','Ongoing revisions and fine-tuning of the agenda based on client or KOL feedback.','Agenda refinement fee','pre_meeting','fixed',0.00,'USD',1,11,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(12,'pre_competency_gap','Competency Gap Analysis','Identifying gaps in knowledge or competencies among participants to tailor pre-meeting materials or the agenda.','Competency gap analysis fee','pre_meeting','fixed',0.00,'USD',1,12,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(13,'pre_medical_risk','Risk Assessment (Medical/Scientific)','Conducting a medical or scientific risk assessment related to the topics being discussed.','Medical risk assessment fee','pre_meeting','fixed',0.00,'USD',1,13,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(14,'pre_regional_content','Content Customization for Regional or Global Variations','Tailoring meeting materials and discussions to account for regional regulations, market conditions, or cultural differences.','Regional content customization fee','pre_meeting','per_region',0.00,'USD',1,14,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(15,'pre_ethics_review','Ethics Review Preparation','Preparing any necessary documentation or reports for an ethics review process.','Ethics review documentation fee','pre_meeting','fixed',0.00,'USD',1,15,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(16,'pre_focus_groups','Pre-Meeting Focus Groups','Organizing smaller focus groups prior to the advisory board to gather targeted insights.','Focus group setup and facilitation fee','pre_meeting','fixed',0.00,'USD',1,16,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(17,'mtg_facilitation','Meeting Facilitation','Providing moderators, facilitators, or support personnel for smooth meeting execution.','Facilitation and support fee','meeting','per_day',0.00,'USD',1,17,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(18,'mtg_tech_support','On-Site or Virtual Technical Support','Ensuring AV setup, web conferencing tools, and other technical needs are met.','Technical support fee','meeting','per_day',0.00,'USD',1,18,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(19,'mtg_moderation','Meeting Moderation','Conducting the meeting, ensuring engagement, and facilitating discussion.','Moderation fee','meeting','per_day',0.00,'USD',1,19,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(20,'mtg_mom','Meeting Documentation (Minutes of Meeting)','Capturing key discussion points, decisions, and actionable items.','MoM creation fee','meeting','fixed',0.00,'USD',1,20,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(21,'mtg_engagement_tools','Interactive Engagement Tools','Setting up digital tools like polling systems, audience response systems, or live Q&A platforms.','Technology setup and tool management fee','meeting','fixed',0.00,'USD',1,21,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(22,'mtg_av_production','Audio-Visual Production','Recording the meeting (if approved), video editing, or providing high-quality visuals for presentations.','AV production and editing fee','meeting','fixed',0.00,'USD',1,22,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(23,'mtg_interpretation','Simultaneous Interpretation Services','Providing real-time language interpretation for international participants.','Interpretation services fee','meeting','hourly',0.00,'USD',1,23,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(24,'mtg_transcription','Meeting Transcription','Providing a full verbatim transcription of the meeting for legal, internal, or compliance use.','Transcription services fee','meeting','hourly',0.00,'USD',1,24,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(25,'mtg_social_listening','Real-Time Social Listening / Media Monitoring','Monitoring social media or other digital platforms for real-time feedback or discussions.','Media monitoring fee','meeting','fixed',0.00,'USD',1,25,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(26,'mtg_legal_oversight','Legal and Regulatory Oversight During Meeting','Having legal experts on hand during the meeting to ensure compliance.','On-site legal oversight fee','meeting','per_day',0.00,'USD',1,26,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(27,'mtg_engagement_metrics','Engagement Metrics Monitoring','Tracking and analyzing real-time engagement metrics during the meeting.','Engagement metrics analysis fee','meeting','fixed',0.00,'USD',1,27,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(28,'mtg_panel_summary','Expert Panel Summarization','After KOL discussions, providing real-time summarization and synthesis of complex data or topics.','Panel summary fee','meeting','fixed',0.00,'USD',1,28,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(29,'mtg_clinical_feasibility','Clinical Trial Discussion and Feasibility Analysis','Conducting feasibility assessments for clinical trials based on discussions.','Clinical trial feasibility analysis fee','meeting','fixed',0.00,'USD',1,29,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(30,'mtg_content_security','Content Security','Ensuring data privacy and security of shared information during the meeting.','Content security management fee','meeting','fixed',0.00,'USD',1,30,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(31,'post_detailed_report','Detailed Meeting Report','Comprehensive report with discussion summaries, outcomes, and key insights.','Report writing fee','post_meeting','fixed',0.00,'USD',1,31,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(32,'post_executive_summary','Executive Summary','A high-level summary of the meeting for senior management.','Executive summary creation fee','post_meeting','fixed',0.00,'USD',1,32,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(33,'post_surveys','Post-Meeting Surveys','Feedback collection from participants for continuous improvement.','Survey creation and analysis fee','post_meeting','fixed',0.00,'USD',1,33,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(34,'post_kol_followup','KOL Follow-Up','Continuing engagement with KOLs after the meeting for clarification or further input.','Follow-up coordination fee','post_meeting','per_kol',0.00,'USD',1,34,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(35,'post_data_analysis','Data Analysis and Insights','Analysis of data or insights shared during the advisory board for internal use.','Data analysis fee','post_meeting','fixed',0.00,'USD',1,35,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(36,'post_slide_deck','Slide Deck for Stakeholder Presentation','Creating a slide deck summarizing the advisory board outcomes for internal teams or management.','Slide deck creation fee','post_meeting','fixed',0.00,'USD',1,36,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(37,'post_compliance_report','Compliance and Legal Reporting','Ensuring all documentation complies with industry regulations and requirements.','Compliance reporting fee','post_meeting','fixed',0.00,'USD',1,37,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(38,'post_infographics','Key Findings Infographics','Designing infographics or visual summaries of key findings from the meeting.','Infographic design fee','post_meeting','fixed',0.00,'USD',1,38,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(39,'post_kol_feedback','KOL Feedback Summary Report','Aggregating and summarizing individual KOL feedback on the meeting\'s effectiveness.','Feedback summary fee','post_meeting','fixed',0.00,'USD',1,39,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(40,'post_competitor_analysis','Competitor Analysis Post-Meeting','Conducting a competitor landscape review based on the insights shared by KOLs.','Competitor analysis fee','post_meeting','fixed',0.00,'USD',1,40,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(41,'post_publication','Publication or Manuscript Support','Assisting in writing and submitting a publication or manuscript based on the discussions.','Publication support fee','post_meeting','fixed',0.00,'USD',1,41,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(42,'post_kol_database','KOL Insights Database Development','Creating a proprietary database of insights, recommendations, or suggestions from KOLs.','Database creation and management fee','post_meeting','fixed',0.00,'USD',1,42,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(43,'post_marketing_material','Post-Meeting Marketing Material','Developing marketing materials, case studies, or newsletters based on the meeting outcomes.','Marketing collateral creation fee','post_meeting','fixed',0.00,'USD',1,43,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(44,'post_strategic_recs','Strategic Recommendations Report','A strategic report with detailed recommendations, action items, and next steps.','Strategic report creation fee','post_meeting','fixed',0.00,'USD',1,44,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(45,'post_debriefing','Stakeholder Debriefing Sessions','Organizing follow-up debriefing sessions for internal stakeholders.','Stakeholder debriefing fee','post_meeting','hourly',0.00,'USD',1,45,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(46,'post_video_editing','Video Recording Editing & Summary Clips','Editing the video recording and creating short, digestible video clips.','Video editing and summary creation fee','post_meeting','fixed',0.00,'USD',1,46,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(47,'post_scenario_planning','Scenario Planning and Forecasting','Using the insights from the advisory board to create scenario plans or forecast models.','Scenario planning fee','post_meeting','fixed',0.00,'USD',1,47,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(48,'post_competitive_intel','Post-Meeting Competitive Intelligence Analysis','Analyzing competitor products, strategies, or market conditions based on the discussions.','Competitive intelligence analysis fee','post_meeting','fixed',0.00,'USD',1,48,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(49,'post_scientific_writing','Scientific Writing and Manuscript Development','Supporting manuscript development if the advisory board focuses on a new scientific discovery.','Scientific writing fee','post_meeting','fixed',0.00,'USD',1,49,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(50,'post_workshops','Post-Meeting Workshops','Organizing and facilitating workshops to delve deeper into specific outcomes.','Workshop facilitation fee','post_meeting','per_day',0.00,'USD',1,50,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(51,'ong_next_cycle','Advisory Board Planning for Next Cycle','Planning and strategy for follow-up or recurring advisory board meetings.','Strategic planning fee for future boards','ongoing_support','fixed',0.00,'USD',1,51,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(52,'ong_kol_relationship','KOL Relationship Management','Maintaining relationships with KOLs between meetings for long-term collaboration.','Relationship management fee','ongoing_support','fixed',0.00,'USD',1,52,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(53,'ong_consultancy','Post-Meeting Consultancy / Recommendations','Providing consultancy services based on the insights and discussions.','Consultancy and recommendation fee','ongoing_support','hourly',0.00,'USD',1,53,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(54,'ong_benchmarking','Advisory Board Benchmarking','Benchmarking the advisory board\'s outcomes against industry standards or previous meetings.','Benchmarking and performance review fee','ongoing_support','fixed',0.00,'USD',1,54,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(55,'ong_feedback_analytics','Advisory Board Feedback Analytics','Advanced analysis of feedback from attendees, including sentiment analysis.','Feedback analytics fee','ongoing_support','fixed',0.00,'USD',1,55,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(56,'ong_influence_mapping','KOL Influence Mapping','Mapping the influence and network of KOLs to identify their potential impact on future strategy.','Influence mapping fee','ongoing_support','fixed',0.00,'USD',1,56,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(57,'ong_education','Post-Meeting Educational Sessions','Conducting internal educational sessions to implement insights gained.','Internal training or workshop fee','ongoing_support','per_day',0.00,'USD',1,57,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(58,'ong_tailored_followup','Tailored Follow-Up Engagements','Organizing follow-up calls or smaller roundtable discussions with specific KOLs.','Tailored engagement session fee','ongoing_support','fixed',0.00,'USD',1,58,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(59,'ong_kol_compliance','KOL Compliance Monitoring','Ongoing monitoring of KOL activities to ensure they comply with legal and regulatory frameworks.','Compliance monitoring fee','ongoing_support','fixed',0.00,'USD',1,59,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(60,'ong_data_storage','Data Management and Storage','Managing, storing, and securely archiving all advisory board data, documents, and recordings.','Data storage and management fee','ongoing_support','fixed',0.00,'USD',1,60,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(61,'ong_retrospective','Advisory Board Retrospective Analysis','Conducting a retrospective review of previous advisory board meetings.','Retrospective analysis fee','ongoing_support','fixed',0.00,'USD',1,61,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(62,'ong_alignment_meetings','Long-Term Strategic Alignment Meetings','Offering periodic strategic meetings to ensure ongoing alignment with insights.','Strategic alignment meeting fee','ongoing_support','fixed',0.00,'USD',1,62,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(63,'ong_influence_trend','KOL Influence Trend Monitoring','Monitoring the influence of KOLs over time.','Influence trend monitoring fee','ongoing_support','fixed',0.00,'USD',1,63,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(64,'ong_market_opportunity','Market Opportunity Mapping','Mapping out new market opportunities based on insights from the discussions.','Opportunity mapping fee','ongoing_support','fixed',0.00,'USD',1,64,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(65,'ong_thought_leadership','Targeted Thought Leadership Development','Helping the client build thought leadership content based on key takeaways.','Thought leadership content creation fee','ongoing_support','fixed',0.00,'USD',1,65,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(66,'ong_policy_impact','Policy Impact Analysis','Analyzing how policy changes or regulations might impact the business strategies discussed.','Policy impact analysis fee','ongoing_support','fixed',0.00,'USD',1,66,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(67,'evt_vip_handling','VIP Handling for High-Profile KOLs','Providing special handling and personalized services for high-profile KOLs.','VIP handling fee','event_specific','per_kol',0.00,'USD',1,67,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(68,'evt_event_app','Interactive Event App Development','Developing a custom app for the advisory board.','Event app development fee','event_specific','fixed',0.00,'USD',1,68,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(69,'evt_branded_kits','Custom-Branded Meeting Kits','Creating personalized meeting kits branded for the advisory board participants.','Branded kit creation fee','event_specific','per_seat',0.00,'USD',1,69,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(70,'evt_data_viz','Data Visualization Tools','Providing advanced data visualization tools or dashboards.','Data visualization fee','event_specific','fixed',0.00,'USD',1,70,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(71,'evt_digital_health','Digital Health Tool Evaluation','Providing a detailed evaluation of digital health tools or platforms.','Digital tool evaluation fee','event_specific','fixed',0.00,'USD',1,71,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(72,'evt_competitor_bench','Advisory Board Benchmarking Against Competitors','Comparing the advisory board\'s outputs to similar boards held by competitors.','Competitor benchmarking fee','event_specific','fixed',0.00,'USD',1,72,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(73,'evt_multi_country','Multi-Country / Regional Advisory Board Management','Managing advisory boards across different regions or countries.','Multi-country management fee','event_specific','per_region',0.00,'USD',1,73,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(74,'evt_360_engagement','360-Degree Stakeholder Engagement Report','Offering a comprehensive report on the engagement and feedback from all stakeholders.','360-degree engagement report fee','event_specific','fixed',0.00,'USD',1,74,'2026-05-05 07:50:18','2026-05-05 07:50:18'),(75,'evt_ai_analysis','Artificial Intelligence (AI)-Assisted Analysis','Using AI tools to analyze large volumes of data or feedback.','AI-assisted analysis fee','event_specific','fixed',0.00,'USD',1,75,'2026-05-05 07:50:18','2026-05-05 07:50:18');
/*!40000 ALTER TABLE `advisory_services` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ai_configurations`
--

DROP TABLE IF EXISTS `ai_configurations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_base_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_tokens` int DEFAULT NULL,
  `temperature` float DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL,
  `is_default` tinyint(1) NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `config_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_ai_configurations_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ai_configurations`
--

LOCK TABLES `ai_configurations` WRITE;
/*!40000 ALTER TABLE `ai_configurations` DISABLE KEYS */;
INSERT INTO `ai_configurations` VALUES (3,'openai','GPT-4o','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','','gpt-4o',4096,0.7,1,1,'',NULL,'2026-03-06 11:54:02',NULL);
/*!40000 ALTER TABLE `ai_configurations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `assessment_parameter_scores`
--

DROP TABLE IF EXISTS `assessment_parameter_scores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assessment_parameter_scores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assessment_id` int NOT NULL,
  `parameter_id` int NOT NULL,
  `parameter_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parameter_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parameter_category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` float DEFAULT NULL,
  `max_score` float DEFAULT NULL,
  `justification` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `scoring_source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'cv',
  `source_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_verified` tinyint(1) DEFAULT '0',
  `verified_by` int DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `parameter_id` (`parameter_id`),
  KEY `ix_assessment_parameter_scores_assessment_id` (`assessment_id`),
  KEY `ix_assessment_parameter_scores_id` (`id`),
  KEY `fk_verified_by` (`verified_by`),
  CONSTRAINT `assessment_parameter_scores_ibfk_1` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `assessment_parameter_scores_ibfk_2` FOREIGN KEY (`parameter_id`) REFERENCES `assessment_parameters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=494 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `assessment_parameter_scores`
--

LOCK TABLES `assessment_parameter_scores` WRITE;
/*!40000 ALTER TABLE `assessment_parameter_scores` DISABLE KEYS */;
INSERT INTO `assessment_parameter_scores` VALUES (204,9,1,'SC_GRADUATION','Graduation','Selection Criteria - Qualification',0,2,'No evidence found of relevant graduation degree.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(205,9,2,'SC_POST_GRADUATION','Post Graduation','Selection Criteria - Qualification',0,3,'No evidence found of post graduation degree.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(206,9,3,'SC_FELLOWSHIP','Fellowship','Selection Criteria - Qualification',0,1,'No evidence found of fellowship qualification.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(207,9,4,'SC_OTHER_QUALIFICATION','Any Other Qualification','Selection Criteria - Qualification',0,0,'No evidence found of any other relevant qualification.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(208,9,5,'SC_NON_DOCTOR_DEGREE','For non-doctors - Any Relevant Degree / Diploma','Selection Criteria - Qualification',0,1,'The HCP is a doctor; this parameter is not applicable.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(209,9,6,'SC_YEARS_EXPERIENCE','No. of Years of Experience','Selection Criteria - Experience',0,4,'No evidence found of years of experience.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(210,9,7,'SC_SURGERIES_PER_YEAR','No. of surgeries / procedures per year','Selection Criteria - Surgeons',0,4,'No evidence found of the number of surgeries/procedures per year.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(211,9,8,'SC_SURGICAL_DESCRIPTION','Brief Description of surgical procedure undertaken','Selection Criteria - Surgeons',0,0,'No evidence found of a description of surgical procedures.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(212,9,9,'SC_UNIQUE_EXPERTISE','Any Unique Surgical / Clinical Expertise','Selection Criteria - Surgeons',0,0,'No evidence found of unique surgical or clinical expertise.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(213,9,12,'SC_FACULTY_POSITIONS','Faculty Positions','Selection Criteria - Faculty',0,2,'No evidence found of faculty positions at academic institutions.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(214,9,13,'C1_BOARD_MEMBER','Board member on one or more medical association(s)','C.1 Leadership',0,1,'No evidence found of board membership in medical associations.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(215,9,14,'C1_ADVISORY_BOARDS','Participates regularly in advisory boards (industry sponsored)','C.1 Leadership',0,1,'No evidence found of regular participation in industry-sponsored advisory boards.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(216,9,15,'C1_TOP_INSTITUTION','Current affiliation with top institution as Chief or full Professor','C.1 Leadership',0,3,'No evidence found of current affiliation with a top institution as Chief or full Professor.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(217,9,16,'C1_SOCIETY_LEADER','Past/current leader of a National / International Society/Associations','C.1 Leadership',0,5,'No evidence found of past/current leadership of a National/International Society/Associations.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(218,9,17,'C1_EXECUTIVE_BOARD','Member of executive board or governing body in international committee/society','C.1 Leadership',0,5,'No evidence found of membership in executive boards of international committees/societies.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(219,9,18,'C2_1_TO_5_ENGAGEMENTS','1 to 5 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,1,'No evidence found of 1 to 5 domestic and/or global speaking engagements.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(220,9,19,'C2_5_TO_10_ENGAGEMENTS','5 to 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,2,'No evidence found of 5 to 10 domestic and/or global speaking engagements.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(221,9,20,'C2_10_PLUS_ENGAGEMENTS','More than 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,5,'No evidence found of more than 10 domestic and/or global speaking engagements.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(222,9,21,'C2_INTL_SPEAKER','5+ speaker engagements at international committee/society (past 5 years)','C.2 Presentations',0,5,'No evidence found of 5+ international speaker engagements.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(223,9,25,'C3_TEXTBOOK_AUTHOR','Contributed to a textbook as editor or author','C.3 Publications',0,3,'No evidence found of contribution to a textbook as author or editor.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(224,9,26,'C4_YEARS_CLINICAL','No. of Years of Clinical Experience','C.4 Clinical Experience',0,4,'No evidence found of years of clinical experience.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(225,9,27,'C4_PROCEDURES_PER_YEAR','No. of surgeries / procedures per year','C.4 Clinical Experience',0,4,'No evidence found of procedures per year.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(226,9,28,'C4_UNIQUE_EXPERTISE','Unique clinical expertise','C.4 Clinical Experience',0,3,'No evidence found of unique clinical expertise.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(227,9,42,'HH','Test','Custom Parameters',0,2,'No evidence found related to this custom parameter.','cv',NULL,0,NULL,NULL,'2026-03-17 15:40:26'),(228,9,10,'SC_PUB_NATIONAL','Publication / Presentation - National Level','Selection Criteria - Publications',1,1,'Found 3 total publications on PubMed, indicating national-level publication activity.','pubmed','{\"total_publications\": 3, \"publications_last_5_years\": 3, \"pubs_per_year\": 0.7, \"coauthor_count\": 24, \"pagerank_percentile\": 100.0, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [{\"title\": \"Beyond the Follicle: A Narrative Review on How Systemic Diseases and Drugs Affect Alopecia.\", \"journal\": \"Pharmaceutical medicine\", \"year\": \"2026\", \"pmid\": \"41563713\", \"doi\": \"10.1007/s40290-025-00600-y\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/41563713/\"}, {\"title\": \"\\\"Effectiveness of minimally invasive injectable modalities in the management of androgenetic alopecia among adults-A systematic review\\\".\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2024\", \"pmid\": \"39176982\", \"doi\": \"10.1111/jocd.16493\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/39176982/\"}, {\"title\": \"Evaluation of the safety and effectiveness of intradermal administration of QR678 Neo\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2022\", \"pmid\": \"34997995\", \"doi\": \"10.1111/jocd.14715\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/34997995/\"}], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"\", \"_specialty\": \"Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-03-17 15:40:26'),(229,9,11,'SC_PUB_INTERNATIONAL','Publication / Presentation - International Level','Selection Criteria - Publications',0,2,'No international journal publications found on PubMed.','pubmed','{\"total_publications\": 3, \"publications_last_5_years\": 3, \"pubs_per_year\": 0.7, \"coauthor_count\": 24, \"pagerank_percentile\": 100.0, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [{\"title\": \"Beyond the Follicle: A Narrative Review on How Systemic Diseases and Drugs Affect Alopecia.\", \"journal\": \"Pharmaceutical medicine\", \"year\": \"2026\", \"pmid\": \"41563713\", \"doi\": \"10.1007/s40290-025-00600-y\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/41563713/\"}, {\"title\": \"\\\"Effectiveness of minimally invasive injectable modalities in the management of androgenetic alopecia among adults-A systematic review\\\".\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2024\", \"pmid\": \"39176982\", \"doi\": \"10.1111/jocd.16493\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/39176982/\"}, {\"title\": \"Evaluation of the safety and effectiveness of intradermal administration of QR678 Neo\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2022\", \"pmid\": \"34997995\", \"doi\": \"10.1111/jocd.14715\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/34997995/\"}], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"\", \"_specialty\": \"Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-03-17 15:40:26'),(230,9,22,'C3_1_TO_5_ARTICLES','1-5 peer reviewed articles (past 5 years)','C.3 Publications',1,1,'Found 3 peer-reviewed articles in the last 5 years on PubMed.','pubmed','{\"total_publications\": 3, \"publications_last_5_years\": 3, \"pubs_per_year\": 0.7, \"coauthor_count\": 24, \"pagerank_percentile\": 100.0, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [{\"title\": \"Beyond the Follicle: A Narrative Review on How Systemic Diseases and Drugs Affect Alopecia.\", \"journal\": \"Pharmaceutical medicine\", \"year\": \"2026\", \"pmid\": \"41563713\", \"doi\": \"10.1007/s40290-025-00600-y\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/41563713/\"}, {\"title\": \"\\\"Effectiveness of minimally invasive injectable modalities in the management of androgenetic alopecia among adults-A systematic review\\\".\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2024\", \"pmid\": \"39176982\", \"doi\": \"10.1111/jocd.16493\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/39176982/\"}, {\"title\": \"Evaluation of the safety and effectiveness of intradermal administration of QR678 Neo\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2022\", \"pmid\": \"34997995\", \"doi\": \"10.1111/jocd.14715\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/34997995/\"}], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"\", \"_specialty\": \"Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-03-17 15:40:26'),(231,9,23,'C3_5_TO_10_ARTICLES','5-10 peer reviewed articles or journal editorial board (past 5 years)','C.3 Publications',0,2,'Found 3 articles (below 5 threshold) in the last 5 years.','pubmed','{\"total_publications\": 3, \"publications_last_5_years\": 3, \"pubs_per_year\": 0.7, \"coauthor_count\": 24, \"pagerank_percentile\": 100.0, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [{\"title\": \"Beyond the Follicle: A Narrative Review on How Systemic Diseases and Drugs Affect Alopecia.\", \"journal\": \"Pharmaceutical medicine\", \"year\": \"2026\", \"pmid\": \"41563713\", \"doi\": \"10.1007/s40290-025-00600-y\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/41563713/\"}, {\"title\": \"\\\"Effectiveness of minimally invasive injectable modalities in the management of androgenetic alopecia among adults-A systematic review\\\".\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2024\", \"pmid\": \"39176982\", \"doi\": \"10.1111/jocd.16493\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/39176982/\"}, {\"title\": \"Evaluation of the safety and effectiveness of intradermal administration of QR678 Neo\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2022\", \"pmid\": \"34997995\", \"doi\": \"10.1111/jocd.14715\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/34997995/\"}], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"\", \"_specialty\": \"Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-03-17 15:40:26'),(232,9,24,'C3_INTL_PUBLICATION','Article in international peer-reviewed journals (past 5 years)','C.3 Publications',0,5,'No publications in recognized international journals found on PubMed.','pubmed','{\"total_publications\": 3, \"publications_last_5_years\": 3, \"pubs_per_year\": 0.7, \"coauthor_count\": 24, \"pagerank_percentile\": 100.0, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [{\"title\": \"Beyond the Follicle: A Narrative Review on How Systemic Diseases and Drugs Affect Alopecia.\", \"journal\": \"Pharmaceutical medicine\", \"year\": \"2026\", \"pmid\": \"41563713\", \"doi\": \"10.1007/s40290-025-00600-y\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/41563713/\"}, {\"title\": \"\\\"Effectiveness of minimally invasive injectable modalities in the management of androgenetic alopecia among adults-A systematic review\\\".\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2024\", \"pmid\": \"39176982\", \"doi\": \"10.1111/jocd.16493\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/39176982/\"}, {\"title\": \"Evaluation of the safety and effectiveness of intradermal administration of QR678 Neo\", \"journal\": \"Journal of cosmetic dermatology\", \"year\": \"2022\", \"pmid\": \"34997995\", \"doi\": \"10.1111/jocd.14715\", \"url\": \"https://pubmed.ncbi.nlm.nih.gov/34997995/\"}], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"\", \"_specialty\": \"Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-03-17 15:40:26'),(436,17,1,'SC_GRADUATION','Graduation','Selection Criteria - Qualification',2,2,'Graduation in MBBS from a recognized medical college.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(437,17,2,'SC_POST_GRADUATION','Post Graduation','Selection Criteria - Qualification',3,3,'Postgraduate degree (MD) in General Medicine.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(438,17,3,'SC_FELLOWSHIP','Fellowship','Selection Criteria - Qualification',0,1,'No fellowship qualification mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(439,17,4,'SC_OTHER_QUALIFICATION','Any Other Qualification','Selection Criteria - Qualification',0,0,'No other relevant qualifications beyond stated degrees.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(440,17,5,'SC_NON_DOCTOR_DEGREE','For non-doctors - Any Relevant Degree / Diploma','Selection Criteria - Qualification',0,1,'Not applicable as Anupam Kumar Singh is a doctor.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(441,17,6,'SC_YEARS_EXPERIENCE','No. of Years of Experience','Selection Criteria - Experience',4,4,'18 years of experience as per profile information.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(442,17,7,'SC_SURGERIES_PER_YEAR','No. of surgeries / procedures per year','Selection Criteria - Surgeons',0,4,'No specific number of surgeries/procedures per year mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(443,17,8,'SC_SURGICAL_DESCRIPTION','Brief Description of surgical procedure undertaken','Selection Criteria - Surgeons',0,0,'No detailed description of surgical procedures provided.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(444,17,9,'SC_UNIQUE_EXPERTISE','Any Unique Surgical / Clinical Expertise','Selection Criteria - Surgeons',0,0,'No unique surgical or clinical expertise mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(445,17,12,'SC_FACULTY_POSITIONS','Faculty Positions','Selection Criteria - Faculty',0,2,'No faculty positions at academic institutions mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(446,17,13,'C1_BOARD_MEMBER','Board member on one or more medical association(s)','C.1 Leadership',0,1,'No evidence of being a board member on medical associations.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(447,17,14,'C1_ADVISORY_BOARDS','Participates regularly in advisory boards (industry sponsored)','C.1 Leadership',0,1,'No participation in advisory boards mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(448,17,15,'C1_TOP_INSTITUTION','Current affiliation with top institution as Chief or full Professor','C.1 Leadership',0,3,'Not affiliated as Chief or full Professor at a top institution.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(449,17,16,'C1_SOCIETY_LEADER','Past/current leader of a National / International Society/Associations','C.1 Leadership',0,5,'No leadership roles in National/International Societies mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(450,17,17,'C1_EXECUTIVE_BOARD','Member of executive board or governing body in international committee/society','C.1 Leadership',0,5,'No membership in executive or governing bodies mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(451,17,18,'C2_1_TO_5_ENGAGEMENTS','1 to 5 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',1,1,'Mentions multiple national and international presentations.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(452,17,19,'C2_5_TO_10_ENGAGEMENTS','5 to 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,2,'No specific count of 5 to 10 speaking engagements provided.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(453,17,20,'C2_10_PLUS_ENGAGEMENTS','More than 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,5,'No evidence of more than 10 speaking engagements.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(454,17,21,'C2_INTL_SPEAKER','5+ speaker engagements at international committee/society (past 5 years)','C.2 Presentations',0,5,'No evidence of 5+ international speaking engagements.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(455,17,25,'C3_TEXTBOOK_AUTHOR','Contributed to a textbook as editor or author','C.3 Publications',3,3,'Authored a textbook, \'Manual of Surgery: short cases in surgery\'.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(456,17,26,'C4_YEARS_CLINICAL','No. of Years of Clinical Experience','C.4 Clinical Experience',4,4,'18 years of clinical experience.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(457,17,27,'C4_PROCEDURES_PER_YEAR','No. of surgeries / procedures per year','C.4 Clinical Experience',0,4,'No specific number of procedures per year mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(458,17,28,'C4_UNIQUE_EXPERTISE','Unique clinical expertise','C.4 Clinical Experience',0,3,'No unique clinical expertise mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(459,17,42,'HH','Test','Custom Parameters',0,2,'No relevant information found.','cv',NULL,0,NULL,NULL,'2026-04-08 16:09:43'),(460,17,10,'SC_PUB_NATIONAL','Publication / Presentation - National Level','Selection Criteria - Publications',0,1,'No publications found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Anupam Kumar Singh\", \"_institution\": \"Pushpanjali Crosslay Hospital\", \"_specialty\": \"Gastroenterology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:09:43'),(461,17,11,'SC_PUB_INTERNATIONAL','Publication / Presentation - International Level','Selection Criteria - Publications',0,2,'No international journal publications found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Anupam Kumar Singh\", \"_institution\": \"Pushpanjali Crosslay Hospital\", \"_specialty\": \"Gastroenterology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:09:43'),(462,17,22,'C3_1_TO_5_ARTICLES','1-5 peer reviewed articles (past 5 years)','C.3 Publications',0,1,'Found 0 articles in the last 5 years on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Anupam Kumar Singh\", \"_institution\": \"Pushpanjali Crosslay Hospital\", \"_specialty\": \"Gastroenterology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:09:43'),(463,17,23,'C3_5_TO_10_ARTICLES','5-10 peer reviewed articles or journal editorial board (past 5 years)','C.3 Publications',0,2,'Found 0 articles (below 5 threshold) in the last 5 years.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Anupam Kumar Singh\", \"_institution\": \"Pushpanjali Crosslay Hospital\", \"_specialty\": \"Gastroenterology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:09:43'),(464,17,24,'C3_INTL_PUBLICATION','Article in international peer-reviewed journals (past 5 years)','C.3 Publications',0,5,'No publications in recognized international journals found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Anupam Kumar Singh\", \"_institution\": \"Pushpanjali Crosslay Hospital\", \"_specialty\": \"Gastroenterology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:09:43'),(465,18,1,'SC_GRADUATION','Graduation','Selection Criteria - Qualification',2,2,'Holds an MBBS degree, a relevant graduation degree for the field.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(466,18,2,'SC_POST_GRADUATION','Post Graduation','Selection Criteria - Qualification',3,3,'Holds an MD in Dermatology, a relevant post-graduation degree.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(467,18,3,'SC_FELLOWSHIP','Fellowship','Selection Criteria - Qualification',1,1,'Completed a fellowship in Cosmetic Dermatology, Dermatosurgery and Dermatologic Lasers.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(468,18,4,'SC_OTHER_QUALIFICATION','Any Other Qualification','Selection Criteria - Qualification',0,0,'No other qualifications mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(469,18,5,'SC_NON_DOCTOR_DEGREE','For non-doctors - Any Relevant Degree / Diploma','Selection Criteria - Qualification',0,1,'Not applicable as Dr. Rinky Kapoor is a doctor.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(470,18,6,'SC_YEARS_EXPERIENCE','No. of Years of Experience','Selection Criteria - Experience',4,4,'Has 20 years of experience, qualifying for the highest score bracket.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(471,18,7,'SC_SURGERIES_PER_YEAR','No. of surgeries / procedures per year','Selection Criteria - Surgeons',4,4,'Performed more than 5000 procedures, fitting the highest score category.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(472,18,8,'SC_SURGICAL_DESCRIPTION','Brief Description of surgical procedure undertaken','Selection Criteria - Surgeons',0,0,'No brief description of surgical procedure required for scoring.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(473,18,9,'SC_UNIQUE_EXPERTISE','Any Unique Surgical / Clinical Expertise','Selection Criteria - Surgeons',0,0,'No unique surgical expertise explicitly highlighted.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(474,18,12,'SC_FACULTY_POSITIONS','Faculty Positions','Selection Criteria - Faculty',0,2,'No evidence of faculty position at academic institutions.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(475,18,13,'C1_BOARD_MEMBER','Board member on one or more medical association(s)','C.1 Leadership',0,1,'No evidence found of board membership in medical associations.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(476,18,14,'C1_ADVISORY_BOARDS','Participates regularly in advisory boards (industry sponsored)','C.1 Leadership',0,1,'No evidence found of participation in advisory boards.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(477,18,15,'C1_TOP_INSTITUTION','Current affiliation with top institution as Chief or full Professor','C.1 Leadership',0,3,'No affiliation with top institution as Chief or full Professor mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(478,18,16,'C1_SOCIETY_LEADER','Past/current leader of a National / International Society/Associations','C.1 Leadership',0,5,'No leadership role in a national or international society mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(479,18,17,'C1_EXECUTIVE_BOARD','Member of executive board or governing body in international committee/society','C.1 Leadership',0,5,'No membership in executive boards of international committees/societies mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(480,18,18,'C2_1_TO_5_ENGAGEMENTS','1 to 5 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',1,1,'Participated in various workshops and conferences, suggesting at least 1 to 5 speaking engagements.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(481,18,19,'C2_5_TO_10_ENGAGEMENTS','5 to 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,2,'No specific evidence of 5 to 10 speaking engagements in the past 5 years.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(482,18,20,'C2_10_PLUS_ENGAGEMENTS','More than 10 domestic and/or global speaking engagements (past 5 years)','C.2 Presentations',0,5,'No specific evidence of more than 10 speaking engagements in the past 5 years.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(483,18,21,'C2_INTL_SPEAKER','5+ speaker engagements at international committee/society (past 5 years)','C.2 Presentations',0,5,'No evidence of 5 or more international speaker engagements.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(484,18,25,'C3_TEXTBOOK_AUTHOR','Contributed to a textbook as editor or author','C.3 Publications',0,3,'No contributions to textbooks as editor or author mentioned.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(485,18,26,'C4_YEARS_CLINICAL','No. of Years of Clinical Experience','C.4 Clinical Experience',4,4,'Years of clinical experience correlate to the highest score for this parameter.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(486,18,27,'C4_PROCEDURES_PER_YEAR','No. of surgeries / procedures per year','C.4 Clinical Experience',4,4,'Consistent with the score for the number of procedures per year.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(487,18,28,'C4_UNIQUE_EXPERTISE','Unique clinical expertise','C.4 Clinical Experience',0,3,'No unique clinical expertise explicitly highlighted.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(488,18,42,'HH','Test','Custom Parameters',0,2,'No specific information provided for this custom parameter.','cv',NULL,0,NULL,NULL,'2026-04-08 16:40:05'),(489,18,10,'SC_PUB_NATIONAL','Publication / Presentation - National Level','Selection Criteria - Publications',0,1,'No publications found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"SL Raheja Fortis Hospital, The Esthetic Clinic\", \"_specialty\": \"Cosmetic Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:40:05'),(490,18,11,'SC_PUB_INTERNATIONAL','Publication / Presentation - International Level','Selection Criteria - Publications',0,2,'No international journal publications found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"SL Raheja Fortis Hospital, The Esthetic Clinic\", \"_specialty\": \"Cosmetic Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:40:05'),(491,18,22,'C3_1_TO_5_ARTICLES','1-5 peer reviewed articles (past 5 years)','C.3 Publications',0,1,'Found 0 articles in the last 5 years on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"SL Raheja Fortis Hospital, The Esthetic Clinic\", \"_specialty\": \"Cosmetic Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:40:05'),(492,18,23,'C3_5_TO_10_ARTICLES','5-10 peer reviewed articles or journal editorial board (past 5 years)','C.3 Publications',0,2,'Found 0 articles (below 5 threshold) in the last 5 years.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"SL Raheja Fortis Hospital, The Esthetic Clinic\", \"_specialty\": \"Cosmetic Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:40:05'),(493,18,24,'C3_INTL_PUBLICATION','Article in international peer-reviewed journals (past 5 years)','C.3 Publications',0,5,'No publications in recognized international journals found on PubMed.','pubmed','{\"total_publications\": 0, \"publications_last_5_years\": 0, \"pubs_per_year\": 0.0, \"coauthor_count\": 0, \"pagerank_percentile\": null, \"pub_growth_rate\": null, \"international_journals\": 0, \"recent_articles\": [], \"_author_name\": \"Dr. Rinky Kapoor\", \"_institution\": \"SL Raheja Fortis Hospital, The Esthetic Clinic\", \"_specialty\": \"Cosmetic Dermatology\", \"_linkedin_url\": \"\"}',0,NULL,NULL,'2026-04-08 16:40:05');
/*!40000 ALTER TABLE `assessment_parameter_scores` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `assessment_parameters`
--

DROP TABLE IF EXISTS `assessment_parameters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assessment_parameters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `max_score` float DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_standard` tinyint(1) DEFAULT '1',
  `scoring_source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'cv',
  `created_by` int DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `ix_assessment_parameters_id` (`id`),
  KEY `fk_param_created_by` (`created_by`),
  CONSTRAINT `fk_param_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `assessment_parameters`
--

LOCK TABLES `assessment_parameters` WRITE;
/*!40000 ALTER TABLE `assessment_parameters` DISABLE KEYS */;
INSERT INTO `assessment_parameters` VALUES (1,'Selection Criteria - Qualification','SC_GRADUATION','Graduation','Relevant graduation degree',2,1,1,'cv',NULL,1,'2026-03-06 11:26:07',NULL),(2,'Selection Criteria - Qualification','SC_POST_GRADUATION','Post Graduation','Post graduation degree',3,1,1,'cv',NULL,2,'2026-03-06 11:26:07',NULL),(3,'Selection Criteria - Qualification','SC_FELLOWSHIP','Fellowship','Fellowship qualification',1,1,1,'cv',NULL,3,'2026-03-06 11:26:07',NULL),(4,'Selection Criteria - Qualification','SC_OTHER_QUALIFICATION','Any Other Qualification','Any other relevant qualification',0,1,1,'cv',NULL,4,'2026-03-06 11:26:07',NULL),(5,'Selection Criteria - Qualification','SC_NON_DOCTOR_DEGREE','For non-doctors - Any Relevant Degree / Diploma','Relevant degree or diploma for non-doctor HCPs',1,1,1,'cv',NULL,5,'2026-03-06 11:26:07',NULL),(6,'Selection Criteria - Experience','SC_YEARS_EXPERIENCE','No. of Years of Experience','Less than 5 (1), 5-10 (2), 10-15 (3), 15+ (4)',4,1,1,'cv',NULL,6,'2026-03-06 11:26:07',NULL),(7,'Selection Criteria - Surgeons','SC_SURGERIES_PER_YEAR','No. of surgeries / procedures per year','Less than 100 (1), 100-200 (2), 200-500 (3), 500+ (4)',4,1,1,'cv',NULL,7,'2026-03-06 11:26:07',NULL),(8,'Selection Criteria - Surgeons','SC_SURGICAL_DESCRIPTION','Brief Description of surgical procedure undertaken','Description of surgical procedures',0,1,1,'cv',NULL,8,'2026-03-06 11:26:07',NULL),(9,'Selection Criteria - Surgeons','SC_UNIQUE_EXPERTISE','Any Unique Surgical / Clinical Expertise','Unique surgical or clinical expertise',0,1,1,'cv',NULL,9,'2026-03-06 11:26:07',NULL),(10,'Selection Criteria - Publications','SC_PUB_NATIONAL','Publication / Presentation - National Level','National level publications or presentations',1,1,1,'pubmed',NULL,10,'2026-03-06 11:26:07',NULL),(11,'Selection Criteria - Publications','SC_PUB_INTERNATIONAL','Publication / Presentation - International Level','International level publications or presentations',2,1,1,'pubmed',NULL,11,'2026-03-06 11:26:07',NULL),(12,'Selection Criteria - Faculty','SC_FACULTY_POSITIONS','Faculty Positions','Holds faculty positions at academic institutions',2,1,1,'cv',NULL,12,'2026-03-06 11:26:07',NULL),(13,'C.1 Leadership','C1_BOARD_MEMBER','Board member on one or more medical association(s)','Physician is a board member on one or more medical association(s)',1,1,1,'cv',NULL,13,'2026-03-06 11:26:07',NULL),(14,'C.1 Leadership','C1_ADVISORY_BOARDS','Participates regularly in advisory boards (industry sponsored)','Physician participates regularly in advisory boards (industry sponsored)',1,1,1,'cv',NULL,14,'2026-03-06 11:26:07',NULL),(15,'C.1 Leadership','C1_TOP_INSTITUTION','Current affiliation with top institution as Chief or full Professor','Current affiliation with top institution in area of specialty as Chief or full Professor at top teaching hospital or Medical College',3,1,1,'cv',NULL,15,'2026-03-06 11:26:07',NULL),(16,'C.1 Leadership','C1_SOCIETY_LEADER','Past/current leader of a National / International Society/Associations','Past/current leader of a National / International Society/Associations',5,1,1,'cv',NULL,16,'2026-03-06 11:26:07',NULL),(17,'C.1 Leadership','C1_EXECUTIVE_BOARD','Member of executive board or governing body in international committee/society','Member in the last 5 years of an executive board or governing body in an international committee/society or professional medical association',5,1,1,'cv',NULL,17,'2026-03-06 11:26:07',NULL),(18,'C.2 Presentations','C2_1_TO_5_ENGAGEMENTS','1 to 5 domestic and/or global speaking engagements (past 5 years)','In the past five years, between 1 to 5 domestic and/or global speaking engagements',1,1,1,'cv',NULL,18,'2026-03-06 11:26:07',NULL),(19,'C.2 Presentations','C2_5_TO_10_ENGAGEMENTS','5 to 10 domestic and/or global speaking engagements (past 5 years)','In the past five years, between 5 to 10 domestic and/or global speaking engagements',2,1,1,'cv',NULL,19,'2026-03-06 11:26:07',NULL),(20,'C.2 Presentations','C2_10_PLUS_ENGAGEMENTS','More than 10 domestic and/or global speaking engagements (past 5 years)','In the past five years, has completed more than 10 domestic and/or global speaking engagements',5,1,1,'cv',NULL,20,'2026-03-06 11:26:07',NULL),(21,'C.2 Presentations','C2_INTL_SPEAKER','5+ speaker engagements at international committee/society (past 5 years)','In the past 5 years, has completed 5 or more Speaker/presenter engagements at an international committee/society or international professional medical association',5,1,1,'cv',NULL,21,'2026-03-06 11:26:07',NULL),(22,'C.3 Publications','C3_1_TO_5_ARTICLES','1-5 peer reviewed articles (past 5 years)','In past five years, published 1-5 peer reviewed articles',1,1,1,'pubmed',NULL,22,'2026-03-06 11:26:07',NULL),(23,'C.3 Publications','C3_5_TO_10_ARTICLES','5-10 peer reviewed articles or journal editorial board (past 5 years)','In past five years, published 5 to 10 peer reviewed articles or participated on 1 journal editorial board or performed systematic reviews',2,1,1,'pubmed',NULL,23,'2026-03-06 11:26:07',NULL),(24,'C.3 Publications','C3_INTL_PUBLICATION','Article in international peer-reviewed journals (past 5 years)','In past five years, published at least one article in international peer-reviewed journals or participated in international clinical research/trial or contributed in international product development',5,1,1,'pubmed',NULL,24,'2026-03-06 11:26:07',NULL),(25,'C.3 Publications','C3_TEXTBOOK_AUTHOR','Contributed to a textbook as editor or author','Contributed to a textbook as an editor or an author',3,1,1,'cv',NULL,25,'2026-03-06 11:26:07',NULL),(26,'C.4 Clinical Experience','C4_YEARS_CLINICAL','No. of Years of Clinical Experience','Years of clinical experience score from Selection Criteria',4,1,1,'cv',NULL,26,'2026-03-06 11:26:07',NULL),(27,'C.4 Clinical Experience','C4_PROCEDURES_PER_YEAR','No. of surgeries / procedures per year','Procedures per year score from Selection Criteria',4,1,1,'cv',NULL,27,'2026-03-06 11:26:07',NULL),(28,'C.4 Clinical Experience','C4_UNIQUE_EXPERTISE','Unique clinical expertise','Has unique clinical expertise',3,1,1,'cv',NULL,28,'2026-03-06 11:26:07',NULL),(29,'C.5 Citation Velocity','C5_10_PLUS_PUBS_YR','>10 publications/year (2024-26)','More than 10 publications per year in recent period. Source: PubMed date filter',3,1,1,'pubmed',NULL,29,'2026-03-06 11:43:13',NULL),(30,'C.5 Citation Velocity','C5_5_TO_10_PUBS_YR','5-10 publications/year','Between 5 and 10 publications per year. Source: PubMed date filter',2,1,1,'pubmed',NULL,30,'2026-03-06 11:43:13',NULL),(31,'C.5 Citation Velocity','C5_2_TO_5_PUBS_YR','2-5 publications/year','Between 2 and 5 publications per year. Source: PubMed date filter',1,1,1,'pubmed',NULL,31,'2026-03-06 11:43:13',NULL),(32,'C.6 Network Centrality','C6_PAGERANK_TOP_10','PageRank Top 10%','In the top 10% of PageRank scores among co-author network. Source: PubMed co-authors + NetworkX',4,1,1,'pubmed',NULL,32,'2026-03-06 11:43:13',NULL),(33,'C.6 Network Centrality','C6_PAGERANK_TOP_25','PageRank Top 25%','In the top 25% of PageRank scores among co-author network. Source: PubMed co-authors + NetworkX',3,1,1,'pubmed',NULL,33,'2026-03-06 11:43:13',NULL),(34,'C.6 Network Centrality','C6_COAUTHORS_20_PLUS','Co-authors >20','Has more than 20 unique co-authors. Source: PubMed co-author count',2,1,1,'pubmed',NULL,34,'2026-03-06 11:43:13',NULL),(35,'C.7 Patient Impact','C7_5_PLUS_TRIALS','5 or more trials led','Led 5 or more clinical trials. Source: ClinicalTrials.gov API',3,1,1,'clinical_trials',NULL,35,'2026-03-06 11:43:13',NULL),(36,'C.7 Patient Impact','C7_3_TO_4_TRIALS','3-4 trials led','Led 3 to 4 clinical trials. Source: ClinicalTrials.gov API',2,1,1,'clinical_trials',NULL,36,'2026-03-06 11:43:13',NULL),(37,'C.7 Patient Impact','C7_1_TO_2_TRIALS','1-2 trials led','Led 1 to 2 clinical trials. Source: ClinicalTrials.gov API',1,1,1,'clinical_trials',NULL,37,'2026-03-06 11:43:13',NULL),(38,'C.8 Guideline Authority','C8_INTL_GUIDELINE','International guideline author','Author of international clinical guidelines. Source: Google Scholar guideline search',3,1,1,'google_scholar',NULL,38,'2026-03-06 11:43:13',NULL),(39,'C.8 Guideline Authority','C8_NATL_GUIDELINE','National guideline author','Author of national clinical guidelines or consensus statements. Source: Google Scholar consensus search',2,1,1,'google_scholar',NULL,39,'2026-03-06 11:43:13',NULL),(40,'C.9 Emerging Leader','C9_PUB_GROWTH_20PCT','Publication growth >20%/year','Year-over-year publication growth exceeding 20%. Source: PubMed year-over-year analysis',2,1,1,'pubmed',NULL,40,'2026-03-06 11:43:13',NULL),(41,'C.9 Emerging Leader','C9_YOUNG_PROLIFIC','Age <45 with significant publications','HCP under 45 years old with significant publication record. Source: CV age estimate + publication count',1,1,1,'cv',NULL,41,'2026-03-06 11:43:13',NULL),(42,'Custom Parameters','HH','Test','gfh hghsd fsd hg',2,1,0,'cv',7,99,'2026-03-06 11:56:03','2026-03-06 12:00:01'),(44,'C.10 Practo Patient Influence','PRACTO_REVIEWS_HIGH','100+ patient reviews on Practo','High patient engagement with 100 or more reviews on Practo. Source: Practo profile',2,1,1,'practo',NULL,42,'2026-03-17 14:56:28',NULL),(45,'C.10 Practo Patient Influence','PRACTO_REVIEWS_MODERATE','25+ patient reviews on Practo','Moderate patient engagement with 25 or more reviews. Source: Practo profile',1,1,1,'practo',NULL,43,'2026-03-17 14:56:28',NULL),(46,'C.10 Practo Patient Influence','PRACTO_RATING_HIGH','High patient rating on Practo','Patient rating of 4.5+ (or 90%+) on Practo. Source: Practo profile',2,1,1,'practo',NULL,44,'2026-03-17 14:56:28',NULL),(47,'C.10 Practo Patient Influence','PRACTO_RECOMMENDATIONS','50+ recommendations on Practo','50 or more patient/peer recommendations on Practo. Source: Practo profile',1,1,1,'practo',NULL,45,'2026-03-17 14:56:28',NULL),(48,'C.10 Practo Patient Influence','PRACTO_EXPERIENCE','15+ years experience (Practo verified)','15 or more years of experience as listed on Practo profile. Source: Practo profile',2,1,1,'practo',NULL,46,'2026-03-17 14:56:28',NULL);
/*!40000 ALTER TABLE `assessment_parameters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `assessments`
--

DROP TABLE IF EXISTS `assessments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assessments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hcp_id` int NOT NULL,
  `assessed_by` int DEFAULT NULL,
  `c1_leadership_score` float DEFAULT NULL,
  `c1_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c2_presentations_score` float DEFAULT NULL,
  `c2_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c3_publications_score` float DEFAULT NULL,
  `c3_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c4_clinical_experience_score` float DEFAULT NULL,
  `c4_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c5_citation_velocity_score` float DEFAULT NULL,
  `c5_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c6_network_centrality_score` float DEFAULT NULL,
  `c6_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c7_patient_impact_score` float DEFAULT NULL,
  `c7_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c8_guideline_authority_score` float DEFAULT NULL,
  `c8_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `c9_emerging_leader_score` float DEFAULT NULL,
  `c9_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `base_score` float DEFAULT NULL,
  `bonus_score` float DEFAULT NULL,
  `final_score` float DEFAULT NULL,
  `tier` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `justification` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `confidence_flags` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `pubmed_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `clinical_trials_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `network_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_assessments_id` (`id`),
  KEY `ix_assessments_hcp_id` (`hcp_id`),
  KEY `ix_assessments_tier` (`tier`),
  KEY `ix_assessments_assessed_by` (`assessed_by`),
  CONSTRAINT `assessments_ibfk_1` FOREIGN KEY (`hcp_id`) REFERENCES `hcp_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `assessments_ibfk_2` FOREIGN KEY (`assessed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `assessments`
--

LOCK TABLES `assessments` WRITE;
/*!40000 ALTER TABLE `assessments` DISABLE KEYS */;
INSERT INTO `assessments` VALUES (9,11,7,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,2,'NON_KOL','Dr. Rinky Kapoor\'s profile lacks specific details to assess her qualifications, experience, or achievements in the field of dermatology accurately. No information was provided on education, years of experience, clinical expertise, or leadership roles.','{\"scoring_method\": \"multi_source\", \"sources_used\": [\"pubmed\", \"cv\"], \"parameters_scored\": 29, \"cv_params\": 24, \"pubmed_params\": 5, \"clinical_trials_params\": 0, \"google_scholar_params\": 0, \"practo_params\": 0, \"has_cv\": false, \"has_form_data\": true, \"linkedin_found\": false, \"linkedin_url\": null}',NULL,NULL,NULL,'2026-03-17 10:10:26','2026-03-17 10:10:26'),(17,19,7,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,17,'EMERGING_KOL','Anupam Kumar Singh is an experienced gastroenterologist with 18 years in the field. He has strong academic credentials with a postgraduate degree in General Medicine and has authored a textbook. However, there is limited evidence of leadership roles or significant international recognition in the field.','{\"scoring_method\": \"multi_source\", \"sources_used\": [\"cv\", \"pubmed\"], \"parameters_scored\": 29, \"cv_params\": 24, \"pubmed_params\": 5, \"clinical_trials_params\": 0, \"google_scholar_params\": 0, \"practo_params\": 0, \"practo_profile_found\": false, \"practo_profile_url\": \"\", \"has_cv\": true, \"has_form_data\": true, \"linkedin_found\": false, \"linkedin_url\": null}',NULL,NULL,NULL,'2026-04-08 10:39:44','2026-04-08 10:39:44'),(18,20,7,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,23,'EMERGING_KOL','Dr. Rinky Kapoor is a highly experienced and qualified cosmetic dermatologist with 20 years of experience and expertise in various advanced dermatological procedures. Her educational background and extensive clinical practice in cosmetic dermatology make her a prominent figure in her field, although she lacks documented leadership roles or significant speaking engagements in recent years.','{\"scoring_method\": \"multi_source\", \"sources_used\": [\"cv\", \"pubmed\"], \"parameters_scored\": 29, \"cv_params\": 24, \"pubmed_params\": 5, \"clinical_trials_params\": 0, \"google_scholar_params\": 0, \"practo_params\": 0, \"practo_profile_found\": false, \"practo_profile_url\": \"\", \"has_cv\": true, \"has_form_data\": true, \"linkedin_found\": false, \"linkedin_url\": null}',NULL,NULL,NULL,'2026-04-08 11:10:05','2026-04-08 11:10:05');
/*!40000 ALTER TABLE `assessments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assessment_id` int DEFAULT NULL,
  `action` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `performed_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_audit_logs_id` (`id`),
  KEY `ix_audit_logs_assessment_id` (`assessment_id`),
  KEY `ix_audit_logs_performed_by` (`performed_by`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `audit_logs_ibfk_2` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (9,9,'ai_assessment','Multi-source scoring completed. Sources: pubmed, cv. Tier: NON_KOL, Score: 2.0/72.0',7,'2026-03-17 10:10:26'),(17,17,'ai_assessment','Multi-source scoring completed. Sources: cv, pubmed. Tier: EMERGING_KOL, Score: 17.0/72.0',7,'2026-04-08 10:39:44'),(18,18,'ai_assessment','Multi-source scoring completed. Sources: cv, pubmed. Tier: EMERGING_KOL, Score: 23.0/72.0',7,'2026-04-08 11:10:05');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `billing_profiles`
--

DROP TABLE IF EXISTS `billing_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `company_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address_line1` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address_line2` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `zip_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tax_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `ix_billing_profiles_id` (`id`),
  CONSTRAINT `billing_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `billing_profiles`
--

LOCK TABLES `billing_profiles` WRITE;
/*!40000 ALTER TABLE `billing_profiles` DISABLE KEYS */;
INSERT INTO `billing_profiles` VALUES (5,7,'Turacoz Healtcare Solutions Pvt Ltd','105 Surendra Enclave','','Meerut','Uttar Pradesh','250001','India','988898KHJHKJ90','9720936940','2026-03-05 20:44:43','2026-03-05 20:45:33');
/*!40000 ALTER TABLE `billing_profiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `board_meetings`
--

DROP TABLE IF EXISTS `board_meetings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_meetings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `board_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `agenda_summary` text,
  `scheduled_at` datetime DEFAULT NULL,
  `duration_minutes` int NOT NULL,
  `format` enum('in_person','virtual','hybrid') NOT NULL,
  `status` enum('scheduled','live','completed','cancelled') NOT NULL,
  `provider_id` int DEFAULT NULL,
  `join_url` varchar(1000) DEFAULT NULL,
  `organizer_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `zoom_meeting_id` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `provider_id` (`provider_id`),
  KEY `ix_board_meetings_board_id` (`board_id`),
  KEY `ix_board_meetings_scheduled_at` (`scheduled_at`),
  KEY `ix_board_meetings_status` (`status`),
  KEY `ix_board_meetings_organizer_id` (`organizer_id`),
  KEY `ix_board_meetings_id` (`id`),
  KEY `ix_board_meetings_zoom_meeting_id` (`zoom_meeting_id`),
  CONSTRAINT `board_meetings_ibfk_1` FOREIGN KEY (`board_id`) REFERENCES `advisory_boards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `board_meetings_ibfk_2` FOREIGN KEY (`provider_id`) REFERENCES `meeting_provider_config` (`id`) ON DELETE SET NULL,
  CONSTRAINT `board_meetings_ibfk_3` FOREIGN KEY (`organizer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `board_meetings`
--

LOCK TABLES `board_meetings` WRITE;
/*!40000 ALTER TABLE `board_meetings` DISABLE KEYS */;
INSERT INTO `board_meetings` VALUES (2,2,'Test Meetings','Test','2026-05-13 14:57:00',60,'virtual','scheduled',NULL,NULL,7,'2026-05-05 09:27:38','2026-05-05 09:27:38',NULL);
/*!40000 ALTER TABLE `board_meetings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `clinical_trials_configurations`
--

DROP TABLE IF EXISTS `clinical_trials_configurations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clinical_trials_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `base_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requests_per_second` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_clinical_trials_configurations_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clinical_trials_configurations`
--

LOCK TABLES `clinical_trials_configurations` WRITE;
/*!40000 ALTER TABLE `clinical_trials_configurations` DISABLE KEYS */;
INSERT INTO `clinical_trials_configurations` VALUES (1,'ClinicalTrials.gov (Default)','https://clinicaltrials.gov/api/v2',3,1,1,'Default ClinicalTrials.gov v2 API configuration. Free public API - no API key required.','2026-03-06 16:49:05',NULL);
/*!40000 ALTER TABLE `clinical_trials_configurations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `email_logs`
--

DROP TABLE IF EXISTS `email_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `recipient_email` varchar(320) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `body_preview` text,
  `kind` enum('meeting_reminder_24h','meeting_reminder_1h','minutes_shared','minutes_finalized','manuscript_shared','manuscript_status_change','manuscript_15day_ping','survey_invite','thank_you','other') NOT NULL,
  `related_meeting_id` int DEFAULT NULL,
  `related_manuscript_id` int DEFAULT NULL,
  `success` tinyint(1) NOT NULL,
  `error` text,
  `sent_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_email_logs_kind` (`kind`),
  KEY `ix_email_logs_related_manuscript_id` (`related_manuscript_id`),
  KEY `ix_email_logs_sent_at` (`sent_at`),
  KEY `ix_email_logs_id` (`id`),
  KEY `ix_email_logs_related_meeting_id` (`related_meeting_id`),
  KEY `ix_email_logs_recipient_email` (`recipient_email`),
  CONSTRAINT `email_logs_ibfk_1` FOREIGN KEY (`related_meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `email_logs_ibfk_2` FOREIGN KEY (`related_manuscript_id`) REFERENCES `manuscripts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_logs`
--

LOCK TABLES `email_logs` WRITE;
/*!40000 ALTER TABLE `email_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `email_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `form_links`
--

DROP TABLE IF EXISTS `form_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_links` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_form_links_token` (`token`),
  KEY `ix_form_links_user_id` (`user_id`),
  KEY `ix_form_links_id` (`id`),
  CONSTRAINT `form_links_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `form_links`
--

LOCK TABLES `form_links` WRITE;
/*!40000 ALTER TABLE `form_links` DISABLE KEYS */;
INSERT INTO `form_links` VALUES (1,7,'68f6d21a53b14387b4413d5360a87b7f','Test Form',1,'2026-04-01 10:42:13'),(2,7,'c9ea0cd2fba643df931d8139129ab6a9','Test Title Form',1,'2026-04-02 10:37:31');
/*!40000 ALTER TABLE `form_links` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `form_submissions`
--

DROP TABLE IF EXISTS `form_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_submissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_link_id` int NOT NULL,
  `full_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `specialty` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `institution` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `years_of_experience` int DEFAULT NULL,
  `key_clinical_interests` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `publications` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `conference_presentations` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `professional_memberships` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `awards_recognitions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `cv_file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cv_parsed_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','processing','assessed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `hcp_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `hcp_id` (`hcp_id`),
  KEY `ix_form_submissions_form_link_id` (`form_link_id`),
  KEY `ix_form_submissions_status` (`status`),
  KEY `ix_form_submissions_id` (`id`),
  CONSTRAINT `form_submissions_ibfk_1` FOREIGN KEY (`form_link_id`) REFERENCES `form_links` (`id`) ON DELETE CASCADE,
  CONSTRAINT `form_submissions_ibfk_2` FOREIGN KEY (`hcp_id`) REFERENCES `hcp_profiles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `form_submissions`
--

LOCK TABLES `form_submissions` WRITE;
/*!40000 ALTER TABLE `form_submissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `form_submissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `google_scholar_configurations`
--

DROP TABLE IF EXISTS `google_scholar_configurations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `google_scholar_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `base_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proxy_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requests_per_minute` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_google_scholar_configurations_id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `google_scholar_configurations`
--

LOCK TABLES `google_scholar_configurations` WRITE;
/*!40000 ALTER TABLE `google_scholar_configurations` DISABLE KEYS */;
/*!40000 ALTER TABLE `google_scholar_configurations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `hcp_profiles`
--

DROP TABLE IF EXISTS `hcp_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hcp_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `full_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `therapeutic_area` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `specialty` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `medical_registration_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hcp_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `institution` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `affiliations` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `years_of_experience` int DEFAULT NULL,
  `procedures_per_year` int DEFAULT NULL,
  `unique_expertise` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `faculty_positions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `education` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `age_estimate` int DEFAULT NULL,
  `cv_file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cv_parsed_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` enum('draft','submitted','assessed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `designation` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `key_clinical_interests` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `publications` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `conference_presentations` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `professional_memberships` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `awards_recognitions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `ix_hcp_profiles_id` (`id`),
  KEY `ix_hcp_profiles_full_name` (`full_name`),
  KEY `ix_hcp_profiles_user_id` (`user_id`),
  KEY `ix_hcp_profiles_status` (`status`),
  CONSTRAINT `hcp_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `hcp_profiles`
--

LOCK TABLES `hcp_profiles` WRITE;
/*!40000 ALTER TABLE `hcp_profiles` DISABLE KEYS */;
INSERT INTO `hcp_profiles` VALUES (11,7,'Dr. Rinky Kapoor',NULL,NULL,'Mumbai',NULL,'Dermatology',NULL,'non_surgeon_doctor',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'assessed','2026-03-17 10:10:02','2026-03-17 10:10:26',NULL,NULL,NULL,NULL,NULL,NULL),(19,7,'Anupam Kumar Singh','anupampom@gmail.com',NULL,'Ghaziabad','India','Gastroenterology',NULL,'non_surgeon_doctor','Pushpanjali Crosslay Hospital',NULL,18,NULL,NULL,'consultant, Professor, Consultant, Director','MD, MBBS, ms',NULL,'uploads/7/218b17bc38c64e4f946a62e3ad2cde10.pdf','{\"raw_text\": \" Anupam kumar singh \\n.\\n1.PERSONAL INFORMATION\\n1. Name:    Anupam Kumar Singh\\n2. Permanent Address : 44, Gulab Vihar apartment, sector-9,rohini,delhi-110085 phone \\nno. 011-27556538. Mobile-89897660568\\n3. Email id: anupampom@gmail.com\\n4. Date of Birth: 06.04.1981\\n5. Educational Background\\nDegree Institute Period\\nFrom             ToPart / Full Time /\\nCorrespondence\\nMD (General \\nMedicine)Rajendra Institute Of\\nMedical Sciences, \\nRanchi UniversityJune \\n2011June \\n2014Full time\\nMBBS Maulana azad \\nmedical college, \\nDelhi UniversityJuly 1998 January \\n2004Full Time\\n12th D.A.V. Public \\nSchool,Moonidih \\n,Dhanbad1995 1997 Full Time\\n10th I.S.L., Moonidih, \\nDhanbad1994 1995 Full Time\\n2.SKILL SET & PREVIOUS JOB PROFILES\\nSKILL SET :\\n1. Proficient in handling cases in a general medicine ward, OPD and emergency \\n2. Experience in working in CCU, RCU and medical ICU and handling invasive and non \\ninvasive ventilators\\n3. Experience in reading and interpretation of ECG, Pulmonary function and Chest X-ray.\\n4. Proficient in conducting emergency and maintenance hemodialysis and routine medical \\nprocedures\\n5. Experience in doing screening echocardiography and emergency ultrasonography in ER.\\nCurrent Job Profile :\\nDesignation:   Junior consultant, Department Of Gastroenterology, \\nOrganization:  Pushpanjali Crosslay Hospital, Vaishali,Ghaziabad\\nFrom: 27-08-2014    T o:  Present            \\nLocation : Ghaziabad\\nRole Description:\\n1.   Managing routine ward and OPD patients in Department of Gastroenterology.\\n Anupam kumar singh \\n.\\nPrevious Job Profiles :\\nDesignation:      Academic Resident, Department of General Medicine ( M.D. ),Rajendra \\nInstitute Of Medical Sciences, Ranchi\\nOrganization:    Rajendra Institute Of Medical Sciences, Ranchi\\nFrom: 2-6-2011   T o:  30-6-2014             \\nLocation: Ranchi\\nRole Description:\\n1. T o work up and handle cases of general medicine in both outpatient departments and \\nfloor.\\n2. To intubate the patients and manage ventilator and non invasive ventilator \\nsettings in the  I.C.U.\\n3. Manage cardiology patients and conducting screening echocardiography in cardiology \\nrotation\\n4.  To put Central Venous  Line in  internal jugular veins and femoral veins for \\nhemodialysis\\n5. T o perform diagnostic procedures like lumbar puncture, chest tube insertion, Ascitic tap \\n,diagnostic thoracentensis\\n6. securing intravenous access and putting foley\\u2019s catheter in patients on floor and I.C.U.\\n7.  trained in reading  and interpretation of Chest X-ray, ECG and Pulmonary \\nFunction test\\nJunior Resident Medicine (Bronx Lebanon Hospital, New York)\\nDuration : 1-7-2009 to 11-5-2010\\nRole Description\\n1. Work up and handle cases of general Medicine in both outpatient and floor\\n2. Performing emergency screening ultrasound and echocardiography in \\ndepartment of emergency medicine\\n3. Performing ultrasound guided procedures in ward.\\nJunior Resident Pulmonary Medicine ( VallabhbhaiPatel Chest Hospital, Delhi)\\nDuration : 1-5-2005 to 1-6-2007\\nRole Description :\\n1. Handle routine outpatient and inpatient cases in pulmonary Medicine\\n2. Carried out clinical research in Department of Pulmonary Medicine ,published \\nand presented in multiple national and International conferences\\nMajor Achievements:\\nAcademic:\\n1. Was among top three students throughout in school.\\n2. Obtained 92.4% mark in all India secondary school examinations in class XII. Overall 27 th\\nrank in total marks in All India exams in 1997\\n3. Obtained sixth rank all over india, in all india pre-medical entrance test conducted by \\nCBSE in 1998. Was 4th and 7 th in other all india level pre-medical exams like BHU and \\nAFMC In 1998.\\n4. had distinction marks  (above 75%) in biochemistry in first professional in M.B.B.S.\\n5. Was awarded silver medal for second highest internal assessment in pharmacology in \\nDelhi university in second professional in M.B.B.S.\\n6. Was a part of national immunization program and went on door to door campaign to \\nimmunize each and every child below 5 years in slums surrounding Delhi\\n Anupam kumar singh \\n.\\n7. Worked in a public health center in rural areas surrounding Delhi and immunized \\npregnant women and children who are not immunized\\n8.was   author of the book  \\u201cManual of Surgery:short cases in surgery\\u201d published in 2004 \\nin india by Jaypee Medical Publishers\\n9. was awarded a diploma in \\u201cA part-time course in internet and web-designing \\u201d in \\n2001 by hindu college of delhi-university\\n10. succesfully submitted a doctoral thesis in \\u201c A comparative analysis of Intravenous and\\nInhaled Magnesium sulphate  as an adjunct to standard therapy in treatment of severe \\nexacerbation of acute asthma\\u201d in 2007.\\n11. successful submitted a doctoral thesis : Comparative analysis of sputum based \\ncartridge based nucleic acid amplification assay and microscopy in diagnosis of pulmonary \\ntuberculosis\\u201d in 2013.\\n12. USMLE certified in july 2008 with scores of 99 percentile both in step 1 and step 2 CK\\n13. presented research papers in conferences in USA and India\\n14. Attended workshops on airway Management, Bronchoscopy  in India.\\n.\\nNON-ACAEDEMIC ACHIEVEMENTS\\n1.was a member of football team of Maulana azad medical college in various inter-\\nmedical college football tournaments\\n2.Won gold medal as a team member in intra-college football tournament in maulana \\nazad medical college.\\n3.Trained for fifteen days in saral \\u2013yoga for 15 days in 2004. awarded an achievement \\ncertificate\\n4.Won several awards in creative writing and essay writing both in English and Hindi at\\nschool level competitions.\\n5.Was a voluntary participant of \\u201cKaafila \\u2013a health project for slum dwellers \\u201c which \\nwas an initiative of Kutumb a reputed NGO in delhi.\\nCurrent Salary:\\nJunior Consultant : 90,000 per month\\nPREFERRED SPECIALTY : INTERNAL MEDICINE , MEDICINE SUBSPECIALTIES\\n3.Clinical Research\\nInternational Publications :\\nA randomized controlled trial of intravenous magnesium sulphate as an adjunct to standard \\ntherapy in acute severe asthma. Iranian journal of allergy, asthma, and immunology  (Impact\\nFactor: 0.65). 01/2009; 7(4):221-9.\\nFEV1/FEV6: A Reliable, Easy-to-Use, and Cheaper Alternative to FEV1/FVC in Diagnosing \\nAirway Obstruction in Indian Population. ISRN Pulmonology 10/2012; 2012. \\nDOI: 10.5402/2012/109295\\nNational Publications:\\nAssociation of B12 deficiency and clinical neuropathy with metformin use in type 2 diabetes \\npatients. Journal of Postgraduate Medicine  (Impact Factor: 1.26). 12/2013; 59(4):253-257. \\nDOI: 10.4103/0022-3859.123143\\nComparative validation of clinical disease activity index (CDAI) and simplified disease \\nactivity index (SDAI) in rheumatoid arthritis in India\\nIndian Journal of Rheumatology  01/2013; 8(3):102\\u2013106.\\n Anupam kumar singh \\n.\\nCartridge based Nucleic Acid Amplification T est : A game changer for diagnosis of pulmonary\\nTB in HIV patients ? ( Accepted for publication in JIMA 2014 )\\nA clinical approach to tremor ( Anupam K Singh,DK Jha ) chapter in Medicine Update 2013\\nPresentations:\\nMultiple national and International presentations  details at \\n(https://www.researchgate.net/profile/Anupam_Singh9/contributions?ev=prf_act )\\nHighlights :\\n1. young scientist sponsorship ERS  Berlin 2008\\n2. Best oral presentation award ASICON,Kolkata 2013\\nREFERENCES:\\n1. Professor R.K.Jha , Professor Medicine, RIMS Ranchi  Mobile no.  9431170046\\n2.  Dr. Danish Jamal, Consultant, Head Pulmonology ,Sarvodaya Hosptal Faridabad, mobile \\nno. 9811565345\\n3. Dr. Sridhar Chilimuri , Program Director Internal Medicine ,Bronx Lebanon Hospital ,New \\nYork , +1-  718-590-1800\\n\", \"parsed\": {\"education\": \"MD, MBBS, ms\", \"specialty\": \"Cardiology\", \"faculty_positions\": \"consultant, Professor, Consultant, Director\", \"likely_surgeon\": true}}','assessed','2026-04-08 10:39:15','2026-04-08 10:39:44','Junior Consultant, Department Of Gastroenterology','General Medicine, Gastroenterology',NULL,NULL,NULL,NULL),(20,7,'Dr. Rinky Kapoor',NULL,NULL,'Mumbai','India','Cosmetic Dermatology',NULL,'non_surgeon_doctor','SL Raheja Fortis Hospital, The Esthetic Clinic',NULL,20,NULL,NULL,'Fellow, Hod, director, Consultant, Professor, Head of Department, fellow, Chief, Director','MBBS, MD, Fellowship, ms, dm',NULL,'uploads/7/4ca7e957ab5244f5bee708ab3bcdc42b.pdf','{\"raw_text\": \"                                                                Curriculum Vita  \\n \\nDr. Rinky Kapoor  \\nConsultant Cosmetic Dermatologist                                                                                                                      \\nSL Raheja Fortis Hospital , Mumbai  &                                                                                                                  \\nDirector, The Es thetic clinic,  Mumbai, India.  \\nMBBS, MD (Dermatology), DDV (LTMMC and LTMGH, Mumbai, India).                                                                   \\nFellowship trained in Cosmetic Dermatology, Dermatosurgery and Dermatologic Lasers from \\nNational S kin Centre, Singapore.                                                                                                         \\nVisiting fellow at the Stanford Dermatology  Center, USA.  \\nInterests:  \\n \\nCosmetic Dermatology, Non surgical facial skin rejuvenatio n, Botulinum toxin & Filler therapy \\nfor functional & cosmetic facial therapy, Non surgical facelift via Radiofrequency Thermage and \\nFractional lasers, Management of Hair and Nail disorders, Pigment disorders, Pediatric \\nDermatology, Dermatologic Phototherap y, Dermatosurgery including Skin grafting and Non \\nculture Melanocyte transplant for treatment of Vitiligo, Acne scar revision surgeries, Cellulite \\nand fat reduction therapies, Dermatologic Lasers including fractional lasers, pigment and \\nvascular lasers, ta ttoo removal and hair removal lasers.  \\n \\nImmediate Past Position:  \\n \\n1) Ex-Consultant  and H ead - Department of Cosmetic Dermatology and Lasers, Apollo \\nHospitals, Hyderabad, India.  \\n- From April 2009  to April 2011 . \\nDetails of Past & Current Work Experi ence:  \\n2009 - 2011   Institute of Aesthetic Surgery, Apollo Health City, Hyderabad, India.   \\nConsultant and Head , Cosmetic Dermatology and Dermatosurgery  \\n Planned and set up a  world class Aesthetic center  equipped with the latest state -of-the-\\nart equipment an d facilities from the inception to completion stage, from finances and \\npurchase of equipment to infrastructure planning.  \\n \\n In capacity as the Head of the Department of Cosmetic Dermatology and \\nDermatosurgery, examined, diagnosed and treated more than 5000 p atients.  \\n \\n Assisted in advertising campaign and other techniques to generate patient footfalls etc.  \\n \\n Conducted regular training of staff in the center  \\n \\n Conducted research activities (currently on  Growth factors for scalp hair growth ) - \\nCoordinated research thrust, arranging funding, publishing papers in peer reviewed \\nscientific journals, etc.  \\n \\n Conducted  clinical trials  on drugs and laser/non -laser treatments for Aesthetic \\nindications  \\n \\n2006 \\u2013 2009 Dr.  Rekha Sheth\\u2019s Skin And Hair Clinic,  Mumbai, India   \\n Consu ltant, Cosmetic Dermatology  \\n Examined, diagnosed and managed  more than 10000 patients for dermatological and \\naesthetic complaints.  \\n \\n Gained experience in the latest advances  in Cosmetic Dermatology under the \\nmentorship of Dr. Rekha Sheth {Founder, President Emeritus of Cosmetic Dermatology \\nSociety (India)}, especially honed skills required in management of elite aesthetic clients \\nincluding models, actors and clients from the entertainment industry. Trained to perform, \\nmodify and  adapt treatments to Indian ski n, since a good number of trials and studies \\non many recent advances in Aesthetic Dermatology report results on fair skin.  \\n \\n Part of a team of ten professionals to plan, develop and improve the Laser suite and \\nDermatosurgery facility at the clinic, resultin g in an  increased revenue generation  for \\nthe center.  \\n \\n Trained a team of 20 beauty and salon professionals to provide their services as adjuncts \\nto mainstream treatment; Conducted  regular staff orientation  programs to ensure well \\ninformed and scientifically  sound technicians resulting in better patient management and \\nhigher consumer satisfaction.  \\n \\n Participated in the center\\u2019s  external branding  initiative by publishing various articles on \\nskin health in top Indian newspapers and magazines, led to an increased  awareness of the \\nclinic and increase in patient count.  \\n \\n Participated in the center\\u2019s  internal branding  strategy by designing procedure and \\nproduct brochures for the improvement of clinic services, assisting in the development of \\ncontent for the center\\u2019s w ebsite and designing and conducting presentations and lectures \\non skin health for many clients including corporates, medical professionals and \\ncelebrities.  \\n \\n Conducted regular trials of drugs, laser treatments and other latest available cosmetic \\ntherapies s o as to provide adequate quality of care to consumers.  \\n \\n Appointed  Coordinator of the Organizing Committee  for organizing the Annual \\nConference of the Cosmetic Dermatology Society  (India) (CSI) every year, since 2006; \\nAssisted in formulating the conference program, coordinating and networking with \\nnational and international faculty, corresponding with pharmaceutical companies for \\nsponsorships, designing, deciding and managing content of the society\\u2019s website and \\nassisting the team for editing of the CSI jour nal publication,  \\n \\n Performed  Radio frequency  for Nonsurgical face lift for patients including \\nlatest  Thermage  technique for 25 patients with good success rates, attended Thermage \\ntraining and workshops by  Mr. Boris Kunsevitsky  (Singapore based world renown ed \\ntraining expert on Thermage use).  \\n \\n Trained in  Botox and fillers  by Dr.Susan Weinkle in  December 2007 (World renowned \\nexpert dermatologist on board of directors of American Academy of Dermatology, USA, \\npracticing in Florida, USA).  \\n \\n Performed more than 80 0 Dermatosurgeries  including skin grafting and cryotherapies \\nPerformed and improved techniques of different types of  Chemical Peels  i.e. TCA, \\nGlycolic, Salicylic, Retinol, Pyruvic, Jessner\\u2019s, Arginine, Lactic, Kojic, Biopeel and \\nCombination peels.  \\n \\n Perform ed more than 3000  Laser  procedures including Diode hair removal laser, Skin \\nstation, Nd YAG laser for hair removal, Intense Pulse Light therapy, Smooth beam (long \\npulsed Nd YAG), laser peel (Erbium glass), fractional lasers including Fraxel, \\nAffirm , Pixel laser, Harmony platform for acne scars, pigmentation, skin rejuvenation \\nand tightening, scar management, stretch marks, etc. Managed patients with \\ncomplications from other practices effectively.  \\n \\n Administered  Botox , Dermal fillers  & Mesotherapy  for facial rejuvenation (for fat \\nreduction, cellulite reduction, hair regrowth).  \\n \\n Attended and presented papers in many workshops on Botox, fillers, lasers, \\ndermatosurgeries, micro -dermabrasion and advanced micro -dermabrasion to keep abreast \\nof the latest in the fiel d. \\n \\n Performed  Cellulite reduction  by Slim Concept with 50% patient satisfaction rate.  \\n \\n2008     National Skin Center, Singapore.  \\nVisiting International fellow,  Dermatology, Dermatosurgery and Dermatological Lasers  \\n Awarded the  International Dermatology Fell owship  by the International Society of \\nDermatology (2008). This was the  first ever  international fellowship at the National Skin \\nCentre (NSC) that has ever been sponsored by the International Society of Dermatology. \\nThe NSC is the largest and only institut ion of its kind in Asia completely equipped and \\nwholly dedicated to providing comprehensive total care in Dermatology.    \\n \\n Improved understanding of therapy in different skin types by examining more  than 2500 \\npatients  with Dermatological complaints catering  to almost every demographic and \\nethnic group, by evaluating new and improvised investigation systems and treatment \\nprotocols in patient management.  \\n \\n Trained in  Advanced Dermatologic Lasers on Asian skin  in about 350 patients, under \\nthe mentorship of Prof.  CL Goh , Director emeritus and Head of the Department of \\nLasers, including Fractional lasers Fraxel, MixtoFractional CO2 laser, Pigment lasers, \\nPulse dye lasers, Carbon Dioxide laser, Ellipse Intense Pulse light, Neodymium YAG \\nLaser, at the Mandalay Laser Clinic. Evaluated the requirements and functioning of an \\nideal laser set -up of International standards, selection of laser treatment protocols and \\nmanagement of complications of laser procedures.  \\n \\n Trained in advanced cosmetic uses of  Botulinum toxin and Fi llers, with special \\nemphasis on Non -surgical facial contouring techniques.  \\n \\n Observed  Non surgical facial rejuvenation  techniques including Thermage and \\nFractional Lasers in 30 patients, and also use of Thermage for skin tightening and \\ncontouring for arms, buttocks, abdomen.  \\n \\n Trained in improved techniques in performing  Dermatosurgical  procedures like \\ncryotherapy, skin grafting, skin excisions, ablative radiofrequency and derma -rollers.  \\n \\n Assisted in  Non culture melanocyte transplant  for the treatment of stab le vitiligo.This \\nlatest technique has high success rates but is still not available in India.  \\n \\n Participated in the intricacies of establishment, functioning and participated in the \\nmanagement of a well equipped  Phototherapy  centre.  \\n \\n Conducted examination a nd reporting of  Immunoflorescence  slides independently, \\nunder the guidance of Prof. Chuah, an authority on the subject.  \\n \\n Trained in  Photodynamic therapy , an internationally upcoming preferred modality of \\ntherapy for various Dermatological disorders.  \\n \\n Train ed in specialty management of various Functional dermatologic disorders including \\nhair disorders, contact dermatitis, skin allergy, bullous disease, wound care, pigment  \\ndisorders and pediatric dermatology.    \\n \\n Attended and presented in various seminars, jou rnal clubs, case management forums, \\nlecture series and live demonstrations, thereby developing relationships and future \\nnetworking opportunities with the best known dermatologists in the Asia -Pacific region, \\nmany of whom are at the forefront of cosmetic de rmatology practices worldwide today.  \\n \\n Invited by the Director Emeritus of the NSC to educate and address post graduate \\nstudents and fellowship aspirants about the need for acquiring sound international \\nexposure and experience in the practice of dermatology  and cosmetology in different \\nraces.  \\n2003 \\u2013 2006   Lokmanya Tilak Municipal Medical College  and General Hospital,  Mumbai, \\nIndia  \\nResident , Department of Dermatology  \\n Examined, diagnosed and managed about 100,000 patients with dermatological problems.  \\n \\n Manage d hair, pigment, allergy, eczema, bullous disease, sexually transmitted disease in \\nindividual special clinics resulting in organized management of patients and convenient \\nfollow up visits.  \\n \\n Initiated cosmetic procedures  like chemical peels and micro -dermab rasion, and skin \\ngrafting by suction blister technique for vitiligo treatment in the department and  further \\ndeveloped sub -specialty training in cosmetic dermatology , resulting in increased \\nrevenue generation for the Department which was utilized for develo ping better \\neducational facilities for post graduate students.  \\n \\n Assisted in  developing further the immunoflorescence department, the only one of its \\nkind in Maharashtra , resulting in better patient care and increased revenue generation \\nfor the Department.  \\n \\n Appointed  as Co -Investigator for clinical trials conducted at Unilever, India  (2004).  \\n \\n Awarded  the \\u2018Best thesis of the year\\u2019 award for 2006  at the National Conference of the \\nIndian Academy of Dermatologists, Venereologists and Leprologists (IADVL) for> a \\nthesis on \\u2018Evaluation of safety and efficacy of topical Prostaglandin E2 in the treatment \\nof vitiligo\\u2019, at the National IADVL conference, 2006. Selected as the best thesis across \\nIndia from a total of about 100 post graduate theses submitted.  \\nEducational qu alifications:  \\n2008   NATIONAL SKIN CENTRE,  Singapore  - Awarded Visiting International fellowship in \\nDermatology, Dermatosurgery and Lasers for professional excellence  \\n2005   COLLEGE OF PHYSICIANS AND SURGEONS,  Mumbai, India  - DDV (Diploma in \\nDermatology and Venereology)  \\n2003 - 2006   MUMBAI UNIVERSITY (LOKMANYA TILAK MUNICIPAL MEDICAL \\nCOLLEGE AND GENERAL HOSPITAL , Mumbai, India  ) - MD Dermatology, Venereology \\nand Leprology, Second in University Winner of the best thesis award for 2006 out of 100 all \\nIndia post graduate theses submitted  \\n2001 - 2002   MUMBAI UNIVERSITY (LOKMANYA TILAK MUNICIPAL MEDICAL \\nCOLLEGE AND GENERAL HOSPITAL , Mumbai, India  ) - Resident, Department of Pediatrics  \\n1995 - 2000   MUMBAI UNIVERSITY (LOKMANYA TILAK MUNICIPAL MEDICAL \\nCOLLEGE AND GENER AL HOSPITAL , Mumbai, India  ) - Bachelor of Medicine and \\nBachelor of Surgery (MBBS), Top 1% of class Distinction in Pathology, Microbiology, \\nPreventive and Social Medicine   \\nObserverships and courses:  \\n2009   STANFORD SKIN AND LASER CENTRE , California, USA  - Visited Dr. Hayes \\nGladstone, Head of Department of Advanced Cosmetic Surgery Center, Stanford University \\nSchool of Medicine  \\n2009   CALIFORNIA SKIN INSTITUTE,  California, USA  - Visited and assisted Dr. Greg \\nMorganroth, Director, Dermatologic Surgery and Lase rs \\n2009   HANKENSACK UNIVERSITY MEDICAL CENTER,  New York, USA  - Visited \\nDr.David Goldberg, Head ofDepartment of Dermatologic Surgery and Lasers  \\n2009   SIRIRAJ HOSPITAL, MAHIDOL UNIVERSITY,  Bangkok, Thailand  - Visited and \\nassisted Dr. Woraphong Manuskiatti, H ead of Department of Dermatosurgery and Lasers  \\n2009   BUMRUNGRAD INTERNATIONAL HOSPITAL,  Bangkok, Thailand  - Visited and \\nassisted Dr. Woraphong Manuskiatti, Head of Department of Dermatosurgery and Lasers  \\n2009    MJ AND ORACLE DERMATOLOGIC CLINICS,  South Kor ea - Visiting Observer in \\nDermatosurgery and Lasers  \\n2009    WON TECHNOLOGIES,  South Korea  - Certificate course in Pigment, vascular and hair \\nremoval lasers  \\nHonours/Awards:  \\n Nominated in the category of India\\u2019s Most Admired Beauty Expert  (Medical \\nProfession) in the  4th Annual India Leadership Conclave and Indian Affairs Business \\nLeadership Award 2013 Nominations   \\n \\n Awarded the  WCD 2011 Scholarship  to attend the World Congress of Dermatology in \\nSeoul, South Korea - Awarded by the Indian Association of Dermatolo gists, \\nVenereologists and Leprologists (IADVL) in 2010.  \\n \\n Selected for the  WCD 2011 Scholarship  to attend the World Congress of Dermatology \\nin Seoul, South Korea - Awarded by the Cosmetic Dermatology Society (India) in 2010.  \\n \\n Biography selected for inclusio n in the 2011 (28th) Edition as well as the forthcoming \\n2014 edition of  Marquis Who\'s Who in the World , the world -renowned reference \\ndirectory by the publisher of  Who\'s Who in America . \\n \\n Appointed by invitation by Pantaloons Femina as Consultant Cosmetic De rmatologist for \\nthe Femina Miss India 2009  finalists, and as official skin care expert for  Dance India \\nDance  contestants for Zee Television channel, 2009.  \\n \\n Awarded  International Dermatology Fellowship  for the year 2008 at the National Skin \\nCentre Singapore  under the mentorship of Professor CL Goh, Director Emeritus, \\nProfessor and Head Department of Dermatologic Lasers, National Skin Centre, \\nSingapore. This fellowship is awarded on the basis of academic excellence, professional \\nexpertise and demonstrated abi lity to contribute to the future research and progress of \\nDermatology.  \\n \\n Selected  Fellowship in Clinical Dermatology/Phototherapy/Dermatosurgery  under \\nDr.S.Criton, by a panel comprising of the senior most Dermatologists in the country from \\nthe Indian Academ y of Dermatology, Venereology and Leprology (IADVL), 2008.  Only \\none fellowship awarded every year for demonstrated professional excellence , \\nselected from young dermatologists across India  \\n \\n Awarded  Best thesis of 2006 (All India award)  for my thesis \\u2018Evalua tion of safety and \\nefficacy of topical Prostaglandin E2 in the treatment of vitiligo\\u2019, at the National IADVL \\nConference, 2006.  \\n \\n Secured Runner up position in  National Dermatology Quiz , West zone, from amongst \\n40 teams, organized by IADVL, 2005.  \\n \\n Awarded me rit scholarship by the  Government of India , under the  National \\nScholarship  Scheme, 1994.  \\n \\n Awarded runner\\u2019s up position in North Mumbai T Ward Science Competition, from \\namongst 25 teams, 1992 - 1993.  \\n \\nMemberships:  \\n Life member - Indian Academy of Dermatology,  Venereology and Leprology \\nLM/M /4437  \\n \\n Life member - Cosmetic dermatology Society (India) (LF 940)  \\n \\n Life member - Indian Medical Association  \\n \\n Member of International Society of Dermatology  \\nList of scientific research publications:  \\nPeer Reviewed  \\n1. Shome D, Nair AG,  Kapoor R , Jain V.  \\nBotulinum toxin: Is it really that fragile a molecule? Dermatol Surg. 2010 Dec;36 Suppl 4:2106 -\\n10. doi: 10.1111/j.1524 -4725.2010.01702.x.  \\n2. Kapoor R , Shome D, Jain V, Dikshit R.  \\nFacial rejuvenation post intradermal Botulinum tox in: Is it really the Botulinum toxin or is it the \\npricks? Dermatol Surg. 2010 Dec;36 Suppl 4:2098 -105. doi: 10.1111/j.1524 -4725.2010.01703.x.  \\n3. Kapoor R , Phiske M, Jerajani HR. Evaluation of safety and efficacy of topical Prostaglandin \\nE2 in the treatment  of vitiligo. Br J Dermatol 2009; 160: 861 -63. \\n4. Mehta J, Phiske M, Dhurat RS, Jerajani HR,  Kapoor R . Composite lymphoma: mycosis \\nfungoides with Hodgkin\\u2019s lymphoma. Indian J Dermatol 2005; 50: 227 -30. \\n5. Subramanian S, Phiske M,  Kapoor R . Lichenoid papulo vesicular eruption following measles. \\nEur J Pediat Dermatol 2005; 15:177 -80. \\n Non-Peer reviewed:  \\nDhurat RS, Shinde S, Kapoor R . \\nRare forms of cutaneous tuberculosis \\u2013 Photofeature. What\\u2019s new in dermatology, STD\\u2019s and \\nleprosy. October 2003.  \\nResearch project s: \\n1. Growth factors for hair regrowth in c ollaboration with the Department of Chemical \\nengineering and School of Biosciences and Bioengineering, Indian Institute of Technology (IIT) \\n\\u2013 Powai, Mumbai -400076, India.  \\nList of presentations:  \\nTo evaluate the s afety and efficacy of the QR678 injections in treatmen t of hair loss \\u2013 a pilot \\nstudy \\u2013 Speaker at the Cosmetic Dermatology society of India annual conference 2014, Mumbai, \\nIndia, July 2014.  \\nShine me up: Expan ding horizons in skin rejuvenation - Faculty for instruction course at the 69th \\nAnnual Conference of the All India Ophthalmological Society of India, Ahmedabad, February \\n2011.  \\nW-Plasty, Cheek Rotation Flap & Carbon Dioxide Laser Scar Re -Surfacing to Remove  \\nAesthetically a Huge Malar Scar - Co-author of video presentation presented at the 69th Annual \\nConference of the All India Ophthalmological Society of India, Ahmedabad, February 2011.  \\nUse of a novel combined radiofrequency and ultrasound skin tightening d evice to treat cellulite \\nand for lipolysis - the first 25 patients  - Chief author of oral paper presented at the Annual \\nConference of the Association of Plastic Surgeons of India (APSICON), Goa, October 2010.  \\nW-Plasty, Cheek Rotation Flap & Carbon Dioxide Laser Scar Re -Surfacing to Remove \\nAesthetically a Huge Malar Scar - Co-author of video presentation presented at Annual \\nConference of the Association of Plastic Surgeons of India (APSICON), Goa, October 2010.  \\nRhinoplasty - Tip refinement techniques in a br oken and traumatized nose! - Co-author of video \\npresentation presented at Annual Conference of the Association of Plastic Surgeons of India \\n(APSICON), Goa, October 2010.  \\nUse of a novel combined radiofrequency and ultrasound skin tightening device to treat cellulite \\nand for lipolysis - the first 25 patients  - Chief author of poster presentation accepted at Annual \\nConference of the European Academy of  Dermatologists and Venereologists (EADV), Sweden, \\nOctober 2010.  \\nExpanding Horizons in Skin Rejuvenation - Faculty for instruction course at the Annual Meeting \\nof the Hyderabad Ophthalmological Society, Hyderabad, October 2010.  \\nUse of a novel combined radiofrequency and ultrasound skin tightening device to treat cellulite \\nand for lipolysis - the first 25 patients  - Chief author of poster presentation accepted at the \\nAnnual Conference of the American Society of Laser Medicine and Surgery (ASLMS), Arizona, \\n2010.  \\nBotulinum toxin: Is it really that fragile a molecule? - Co-author of oral paper presented at \\nAnnual Confe rence of the Association of Plastic Surgeons of India (APSICON), Goa, October \\n2010.    \\nBotulinum toxin: Is it really that fragile a molecule? - Co-author of poster presentation accepted \\nat the Annual Conference of the European Academy of Dermatologists and Venereologists \\n(EADV), Sweden, October 2010.  \\nFractional Carbon Dioxide Laser Results In Type 4, 5, 6 Skin - First 50 Patients - Chief author of \\noral paper presented at the Annual Conference of the Association of Plastic Surgeons of India \\n(APSICON), Goa, Oc tober 2010.  \\nFractional Carbon Dioxide Laser Results In Type 4, 5, 6 Skin - First 50 Patients - Chief author of \\npaper accepted for oral presentation at Annual Conference of the American Society of Laser \\nMedicine and Surgery (ASLMS) 2010, Arizona, USA.  \\nFract ional Carbon Dioxide Laser Results In Type 4, 5, 6 Skin - First 50 Patients - Chief author of \\nE-paper accepted at the Annual Conference of the European Academy of Dermatologists and \\nVenereologists (EADV), Sweden, October 2010.  \\nFacial rejuvenation post intr adermal Botulinum toxin: Is it really the Botulinum toxin or is it the \\npricks? - Co-author of oral paper presented at the Annual Conference of the Association of \\nPlastic Surgeons of India (APSICON), Goa, October 2010.  \\nFacial rejuvenation post intradermal B otulinum toxin: Is it really the Botulinum toxin or is it the \\npricks? - Co-author of E -paper accepted at Annual Conference of the European Academy of \\nDermatologists and Venereologists (EADV), Sweden, October 2010.  \\nComparative study between two novel radiof requency skin tightening technologies - Tripollar \\nRadiofrequency device, and, Selective ultrasound and Radiofrequency combination device - Co-\\nauthor of E -paper accepted at Annual Conference of the European Academy of Dermatologists \\nand Venereologists (EADV ), Sweden, October, 2010.  \\nComparative study between two novel radiofrequency skin tightening technologies - Tripollar \\nRadiofrequency device, and, Selective ultrasound and Radiofrequency combination device - Co-\\nauthor of oral paper presented at the Annual C onference of the Association of Plastic Surgeons \\nof India (APSICON), Goa, October 2010.  \\nBotulinum toxin: Is it really that fragile a molecule? - Co-author of oral paper presented at the \\nAnnual Asia Conference of the International Masters Course on Aging Sk in (IMCAS)  \\nHongkong, July 2010.    \\nUse of a novel combined radiofrequency and ultrasound skin tightening device to treat cellulite \\nand for lipolysis - the first 25 patients  - Chief author of oral paper presented at the Annual Asia \\nConference of the Internat ional Masters Course on Aging Skin (IMCAS), Hongkong, July 2010.  \\nComparative study between two novel radiofrequency skin tightening technologies - Tripollar \\nRadiofrequency device, and, Selective ultrasound and Radiofrequency combination device - Co-\\nauthor of E-Poster presented at the Annual Asia Conference of the International Masters  Course \\non Aging Skin (IMCAS), Hongkong, July 2010.  \\nFractional Carbon Dioxide Laser Results In Type 4, 5, 6 Skin - First 50 Patients - Chief author of  \\nE-poster presented at the  Annual Asia Conference of the International Masters Course on Aging \\nSkin (IMCAS), Hongkong, July 2010.  \\nFacial rejuvenation post intradermal Botulinum toxin: Is it really the Botulinum toxin or is it the \\npricks? - Co-author of E -poster presented at the Ann ual Asia Conference of the International \\nMasters Course on Aging Skin (IMCAS), Hongkong, July 2010.  \\nLasers in facial rejuvenation - Faculty at the Hyderabad Oculoplasty Association Conference, \\nHyderabad, March 2010.  \\nFacial rejuvenation post intradermal Bot ulinum toxin: Is it really the Botulinum toxin or is it the \\npricks? - Co-author of paper accepted for oral presentation at the Annual Asia Conference of the \\nInternational Masters Course on Aging Skin (IMCAS), Paris, January 2010.  \\nFractional Carbon Dioxide Laser Results In Type 4, 5, 6 Skin - First 50 Patients - Chief author of \\noral paper presented at International Masters Course on Aging Skin (IMCAS), Paris, January \\n2010.  \\nBotulinum toxin: Is it really that fragile a molecule? - Co-author of poster presentat ion at \\nInternational Masters Course on Aging Skin (IMCAS) Paris, January 2010.  \\nExpanding Horizons in Skin Rejuvenation - Faculty for instruction course at the 68th Annual \\nConference of the All India Ophthalmological Society of India, Kolkata, January 2010.  \\nUse of a novel combined radiofrequency and ultrasound skin tightening device to treat cellulite \\nand for lipolysis - the first 25 patients  - Chief author of poster presentation    \\naccepted at IMCAS, Paris, January 2010.  \\nBotulinum toxin \\u2013 Is it really that f ragile a molecule? - Co-author of oral paper presented at the \\nAnnual meeting of the American Academy of Ophthalmology, San Francisco, California, \\nOctober 2009.  \\nIntradermal Botulinuum toxin \\u2013 Is it the botox or is it the pricks? - Co-author of oral paper \\npresented  at the Annual meeting of the American Society of Ophthalmic Plastic and \\nReconstructive Surgeons, San Francisco, California, October 2009.  \\nFoot care - Chief author of oral paper presented at Cosmetic Dermatology Society (India) \\nseminar, Mumbai, Augu st 2008.  \\nOral Ivermectin verses topical Ivermectin in the treatment of Scabies\\u2019 - Chief author of poster \\npresented at 34th National Conference of Indian Association of Dermatologists, Venereologists \\nand Leprologists (IADVL), Hyderabad, 2006.  \\nCutaneous tuber culosis: varied and unusual manifestations - Co-author of poster presented at \\nSingapore National Dermatology Conference, Singapore, 2005.  \\nDrug induced gastritis mimicking lactic acidosis - Chief author of oral paper presented at the \\nHIV Congress, Mumbai, M arch 2005.  \\nSerodiagnosis and monitoring of activity in Pemphigus by Desmoglein \\u2013 ELISA test \\u2013 Co-author \\nof oral paper presented at the 33rd National Conference of Indian Association of Dermatologists, \\nVenereologists and Leprologists (IADVL), New Delhi, Feb ruary 2005.  \\nEfficacy of topical 10% KOH in treatment of molluscum contagiosum in children: double  \\nblind, placebo - controlled study - Co-author of poster presented at Annual meeting of Indian \\nAssociation of Dermatologists, Venereologists and Leprologists (I ADVL), Maharashtra, 2004.  \\nUnusual drug reaction - Chief author of oral paper presented at the clinical meeting of Indian \\nAssociation of Dermatologists, Venereologists and Leprologists (IADVL), Maharashtra branch, \\nat Lokmanya Tilak Municipal Medical College  and Lokmanya Tilak Municipal General \\nHospital, Mumbai, October 2004.  \\nCutaneous tuberculosis: varied and unusual manifestations - Chief author of oral paper presented \\nat the 32nd National Conference of Indian Association of Dermatologists, Venereologists a nd \\nLeprologists (IADVL), Mumbai, January 2004.  \\nSpot cases - Chief author of oral paper presented at the clinical meeting of Indian Association of \\nDermatologists, Venereologists and Leprologists (IADVL), Maharashtra branch, at Lokmanya \\nTilak  Municipal Medic al College and Lokmanya Tilak Municipal General Hospital, Mumbai, \\nAugust 2003.  \\nEminent personalities in leprosy in the Indian context - Chief author of oral paper presented at \\nthe CME conducted by Bombay Leprosy Project, Mumbai, October 2003  \\nSeminars and C ME\\u2019s attended:  \\nAnnu al conference of the Cosmetic Dermatology Society of India, C osdermindia 2014 \\u2013 As \\nspeaker.  \\n69th Annual Conference of All India Ophthalmological Society, Ahmedabad, February 2011 -\\n As Faculty for Instruction Course.  \\nAssociation of Plastic Surgeons of India Conference (APSICON), Goa, October 2010 - As \\nFaculty . \\nInternational Masters Course on Aging Skin (IMCAS), Hongkong, July 2010 - As Faculty . \\nHyderabad Oculoplasty Association conference, Hyderabad, March 2010 - As Faculty . \\n68th Annual Conference of the All India Ophthalmological Society of India, Kolkata, January \\n2010 \\u2013 As Faculty for Instruction course  \\nCosmetic Dermatology Society (India) National conference and workshop, Hyderabad, August \\n2009 - As Member of National Organising Committee.  \\nCosmetic Dermatology Society (India) Seminar and hands on training workshop, Mumbai, \\nAugust 2 008 -As Member of National Organising Committee.  \\n36th National conference of Indian Association of Dermatologists, Venereologists and \\nLeprologists (IADVL), Chandigarh, January 2008.  \\nCosdermIndia\\u201907, Mumbai, December 2007 - As Member of National Organising Committee . \\nWorkshop on Photography, Bombay Hospital and Research Centre, Mumbai, 2007.  \\nCosdermIndia\\u201906, Goa, August 2006 - As Member of National Organising Committee . \\nGuest lectures by Dr.Stephen Tyring and Dr.Shehnaz, BYL Nair Hospital, Mumbai, March 2005 . \\nHIV Congress, Mumbai, March 2005.  \\nDermatopathological meeting, KEM Hospital Mumbai, March 2005.  \\nAllergy testing, Oration by Dr. David Basketter, Mumbai, 2005.  \\nAll clinical meetings of Indian Association of Dermatologists, Venereologists and \\nLeprologists( IADVL), Maharashtra branch, Mumbai, 2005.  \\n33rd National Conference of Indian Association of Dermatologists, Venereologists and \\nLeprologists (IADVL), New Delhi, February 2005.    \\nHIV/ AIDS Training Workshop, Lokmanya Tilak Municipal Medical College and Gener al \\nHospital, Mumbai, July 2004.  \\nWorkshop on Statistics in Medical Research, Grant Medical College, Mumbai, February 2004.  \\nSoft tissue enhancement and office based dermatoplastic surgery - PG CME series, Bombay \\nHospital and Medical Research Centre, Mumbai, March 2004.  \\n1st National Workshop on Phototherapy \\u2013 Photocon, Bangalore, April 2004.  \\nDermatopathology Teaching Programme, P.D Hinduja National Hospital and Medical Research \\nCenter, Mumbai, October 2004.  \\nAll clinical meetings of Indian Association of Dermat ologists, Venereologists and Leprologists \\n(IADVL), Maharashtra branch, Mumbai, 2004.  \\nCME on HIV, Holy Family hospital, Mumbai, 2004.  \\nCurrent trends in Leprosy, Bombay Leprosy project, 2004.  \\n32nd National Conference of Indian Association of Dermatologists, Venereologists and \\nLeprologists (IADVL), Mumbai, January 2004.  \\n2nd International CME on Dermatopathology, New Delhi, November 2003.  \\n2nd World Congress of Cosmetic Surgery, Mumbai, December 2003.  \\nAll clinical meetings of Indian Association of Dermatologists , Venereologists and Leprologists \\n(IADVL), Maharashtra branch, 2003, Mumbai.  \\nCME by Bombay Leprosy Project, Mumbai, October 2003.  \\n \\nDr. Rinky Kapoor.  \\n \\n \\n \\n \\n \\n \\n \\n \\n \\n \\n\", \"parsed\": {\"education\": \"MBBS, MD, Fellowship, ms, dm\", \"specialty\": \"Ophthalmology\", \"faculty_positions\": \"Fellow, Hod, director, Consultant, Professor, Head of Department, fellow, Chief, Director\", \"likely_surgeon\": true}}','assessed','2026-04-08 11:09:37','2026-04-08 11:10:05','Consultant Cosmetic Dermatologist, Director','Cosmetic Dermatology, Non-surgical facial skin rejuvenation, Botulinum toxin & Filler therapy, Non-surgical facelift, Management of Hair and Nail disorders, Pigment disorders, Pediatric Dermatology, Dermatologic Phototherapy, Dermatosurgery',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `hcp_profiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoice_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subscription_id` int NOT NULL,
  `user_id` int NOT NULL,
  `plan_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `billing_cycle` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` float NOT NULL,
  `currency` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('paid','pending','failed','refunded') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_company` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `billing_tax_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `period_start` datetime DEFAULT NULL,
  `period_end` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_number` (`invoice_number`),
  KEY `subscription_id` (`subscription_id`),
  KEY `user_id` (`user_id`),
  KEY `ix_invoices_id` (`id`),
  CONSTRAINT `invoices_ibfk_1` FOREIGN KEY (`subscription_id`) REFERENCES `user_subscriptions` (`id`),
  CONSTRAINT `invoices_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoices`
--

LOCK TABLES `invoices` WRITE;
/*!40000 ALTER TABLE `invoices` DISABLE KEYS */;
INSERT INTO `invoices` VALUES (2,'INV-202603-00001',2,7,'Professional','monthly',99,'USD','paid','Atul Kumar','atul.teotia@turacoz.com','Turacoz Healtcare Solutions Pvt Ltd','105 Surendra Enclave, Meerut, Uttar Pradesh, 250001, India','988898KHJHKJ90','2026-03-05 15:16:13','2026-04-04 15:16:13','2026-03-05 15:16:13','2026-03-05 20:46:13');
/*!40000 ALTER TABLE `invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `linkedin_configurations`
--

DROP TABLE IF EXISTS `linkedin_configurations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `linkedin_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_id` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_secret` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `redirect_uri` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `access_token` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `scopes` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_linkedin_configurations_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `linkedin_configurations`
--

LOCK TABLES `linkedin_configurations` WRITE;
/*!40000 ALTER TABLE `linkedin_configurations` DISABLE KEYS */;
INSERT INTO `linkedin_configurations` VALUES (1,'TuraKOL LinkedIn App','86t6qvdkcky232','WPL_AP1.EFe99KsQ26xufavR.OZlNLg==','','','technovb@gmail.com',1,1,'','2026-03-06 17:01:55','2026-03-06 17:08:20');
/*!40000 ALTER TABLE `linkedin_configurations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mabm_role_assignments`
--

DROP TABLE IF EXISTS `mabm_role_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mabm_role_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `role` enum('super_admin','sub_admin','medical_writer','turacoz_team') NOT NULL,
  `permissions` text,
  `granted_by` int DEFAULT NULL,
  `granted_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mabm_role_user_role` (`user_id`,`role`),
  KEY `granted_by` (`granted_by`),
  KEY `ix_mabm_role_assignments_role` (`role`),
  KEY `ix_mabm_role_assignments_id` (`id`),
  KEY `ix_mabm_role_assignments_user_id` (`user_id`),
  CONSTRAINT `mabm_role_assignments_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `mabm_role_assignments_ibfk_2` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mabm_role_assignments`
--

LOCK TABLES `mabm_role_assignments` WRITE;
/*!40000 ALTER TABLE `mabm_role_assignments` DISABLE KEYS */;
/*!40000 ALTER TABLE `mabm_role_assignments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `manuscript_comments`
--

DROP TABLE IF EXISTS `manuscript_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `manuscript_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `manuscript_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_manuscript_comments_user_id` (`user_id`),
  KEY `ix_manuscript_comments_manuscript_id` (`manuscript_id`),
  KEY `ix_manuscript_comments_id` (`id`),
  CONSTRAINT `manuscript_comments_ibfk_1` FOREIGN KEY (`manuscript_id`) REFERENCES `manuscripts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `manuscript_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `manuscript_comments`
--

LOCK TABLES `manuscript_comments` WRITE;
/*!40000 ALTER TABLE `manuscript_comments` DISABLE KEYS */;
/*!40000 ALTER TABLE `manuscript_comments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `manuscript_status_history`
--

DROP TABLE IF EXISTS `manuscript_status_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `manuscript_status_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `manuscript_id` int NOT NULL,
  `status` enum('draft','review','finalized','submitted','under_review','accepted','rejected','resubmitted','published') NOT NULL,
  `note` text,
  `changed_by` int DEFAULT NULL,
  `changed_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `changed_by` (`changed_by`),
  KEY `ix_manuscript_status_history_id` (`id`),
  KEY `ix_manuscript_status_history_manuscript_id` (`manuscript_id`),
  CONSTRAINT `manuscript_status_history_ibfk_1` FOREIGN KEY (`manuscript_id`) REFERENCES `manuscripts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `manuscript_status_history_ibfk_2` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `manuscript_status_history`
--

LOCK TABLES `manuscript_status_history` WRITE;
/*!40000 ALTER TABLE `manuscript_status_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `manuscript_status_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `manuscripts`
--

DROP TABLE IF EXISTS `manuscripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `manuscripts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `title` varchar(500) NOT NULL,
  `document_id` int DEFAULT NULL,
  `status` enum('draft','review','finalized','submitted','under_review','accepted','rejected','resubmitted','published') NOT NULL,
  `journal_name` varchar(255) DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `accepted_at` datetime DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `published_url` varchar(1000) DEFAULT NULL,
  `doi` varchar(255) DEFAULT NULL,
  `last_status_email_at` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `document_id` (`document_id`),
  KEY `ix_manuscripts_id` (`id`),
  KEY `ix_manuscripts_created_by` (`created_by`),
  KEY `ix_manuscripts_meeting_id` (`meeting_id`),
  KEY `ix_manuscripts_status` (`status`),
  CONSTRAINT `manuscripts_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `manuscripts_ibfk_2` FOREIGN KEY (`document_id`) REFERENCES `meeting_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `manuscripts_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `manuscripts`
--

LOCK TABLES `manuscripts` WRITE;
/*!40000 ALTER TABLE `manuscripts` DISABLE KEYS */;
/*!40000 ALTER TABLE `manuscripts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `master_data`
--

DROP TABLE IF EXISTS `master_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `master_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('therapeutic_area','specialty','hcp_type','pharma_sponsor','region','currency') COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT (now()),
  `updated_at` datetime DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_master_data_type_value_user` (`type`,`value`,`user_id`),
  KEY `ix_master_data_type` (`type`),
  KEY `ix_master_data_id` (`id`),
  KEY `ix_master_data_user_id` (`user_id`),
  CONSTRAINT `fk_master_data_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `master_data`
--

LOCK TABLES `master_data` WRITE;
/*!40000 ALTER TABLE `master_data` DISABLE KEYS */;
INSERT INTO `master_data` VALUES (1,'hcp_type','Surgeon','surgeon',1,1,'2026-03-09 17:16:56',NULL,NULL),(2,'hcp_type','Non-Surgeon Doctor','non_surgeon_doctor',2,1,'2026-03-09 17:16:56',NULL,NULL),(3,'hcp_type','Non-Doctor','non_doctor',3,1,'2026-03-09 17:16:56','2026-03-09 17:19:24',NULL),(4,'therapeutic_area','Oncology','oncology',1,1,'2026-03-09 17:16:56',NULL,NULL),(5,'therapeutic_area','Cardiovascular','cardiovascular',2,1,'2026-03-09 17:16:56',NULL,NULL),(6,'therapeutic_area','Neurology','neurology',3,1,'2026-03-09 17:16:56',NULL,NULL),(7,'therapeutic_area','Orthopedics','orthopedics',4,1,'2026-03-09 17:16:56',NULL,NULL),(8,'therapeutic_area','Dermatology','dermatology',5,1,'2026-03-09 17:16:56',NULL,NULL),(9,'therapeutic_area','Gastroenterology','gastroenterology',6,1,'2026-03-09 17:16:56',NULL,NULL),(10,'therapeutic_area','Pulmonology','pulmonology',7,1,'2026-03-09 17:16:56',NULL,NULL),(11,'therapeutic_area','Endocrinology','endocrinology',8,1,'2026-03-09 17:16:56',NULL,NULL),(12,'specialty','Cardiology','cardiology',1,1,'2026-03-09 17:16:56',NULL,NULL),(13,'specialty','Neurology','neurology',2,1,'2026-03-09 17:16:56',NULL,NULL),(14,'specialty','Orthopedics','orthopedics',3,1,'2026-03-09 17:16:56',NULL,NULL),(15,'specialty','Oncology','oncology',4,1,'2026-03-09 17:16:56',NULL,NULL),(16,'specialty','Dermatology','dermatology',5,1,'2026-03-09 17:16:56',NULL,NULL),(17,'specialty','Gastroenterology','gastroenterology',6,1,'2026-03-09 17:16:56',NULL,NULL),(18,'specialty','Pulmonology','pulmonology',7,1,'2026-03-09 17:16:56',NULL,NULL),(19,'specialty','Endocrinology','endocrinology',8,1,'2026-03-09 17:16:56',NULL,NULL),(20,'specialty','General Surgery','general_surgery',9,1,'2026-03-09 17:16:56',NULL,NULL),(21,'specialty','Interventional Cardiology','interventional_cardiology',10,1,'2026-03-09 17:16:56',NULL,NULL),(22,'currency','US Dollar','USD',1,1,'2026-04-29 14:19:37',NULL,NULL),(23,'currency','Euro','EUR',2,1,'2026-04-29 14:19:37',NULL,NULL),(24,'currency','British Pound','GBP',3,1,'2026-04-29 14:19:37',NULL,NULL),(25,'currency','Indian Rupee','INR',4,1,'2026-04-29 14:19:37',NULL,NULL),(26,'currency','Australian Dollar','AUD',5,1,'2026-04-29 14:19:37',NULL,NULL),(27,'currency','Singapore Dollar','SGD',6,1,'2026-04-29 14:19:37',NULL,NULL),(28,'currency','Japanese Yen','JPY',7,1,'2026-04-29 14:19:37',NULL,NULL),(33,'therapeutic_area','Menuscript','menuscript',0,1,'2026-04-29 17:11:38',NULL,7),(34,'pharma_sponsor','Ram','ram',0,1,'2026-05-01 17:30:10',NULL,7),(35,'region','India','india',0,1,'2026-05-01 17:30:18',NULL,7);
/*!40000 ALTER TABLE `master_data` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_agenda_items`
--

DROP TABLE IF EXISTS `meeting_agenda_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_agenda_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `sequence` int NOT NULL,
  `title` varchar(500) NOT NULL,
  `description` text,
  `duration_minutes` int DEFAULT NULL,
  `presenter_user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `presenter_user_id` (`presenter_user_id`),
  KEY `ix_meeting_agenda_items_meeting_id` (`meeting_id`),
  KEY `ix_meeting_agenda_items_id` (`id`),
  CONSTRAINT `meeting_agenda_items_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_agenda_items_ibfk_2` FOREIGN KEY (`presenter_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_agenda_items`
--

LOCK TABLES `meeting_agenda_items` WRITE;
/*!40000 ALTER TABLE `meeting_agenda_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_agenda_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_document_comments`
--

DROP TABLE IF EXISTS `meeting_document_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_document_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_meeting_document_comments_id` (`id`),
  KEY `ix_meeting_document_comments_user_id` (`user_id`),
  KEY `ix_meeting_document_comments_document_id` (`document_id`),
  CONSTRAINT `meeting_document_comments_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `meeting_documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_document_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_document_comments`
--

LOCK TABLES `meeting_document_comments` WRITE;
/*!40000 ALTER TABLE `meeting_document_comments` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_document_comments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_document_visibility`
--

DROP TABLE IF EXISTS `meeting_document_visibility`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_document_visibility` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_id` int NOT NULL,
  `user_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_document_visibility_user` (`document_id`,`user_id`),
  KEY `ix_meeting_document_visibility_document_id` (`document_id`),
  KEY `ix_meeting_document_visibility_user_id` (`user_id`),
  KEY `ix_meeting_document_visibility_id` (`id`),
  CONSTRAINT `meeting_document_visibility_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `meeting_documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_document_visibility_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_document_visibility`
--

LOCK TABLES `meeting_document_visibility` WRITE;
/*!40000 ALTER TABLE `meeting_document_visibility` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_document_visibility` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_documents`
--

DROP TABLE IF EXISTS `meeting_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `phase` enum('pre','during','post') NOT NULL,
  `category` enum('agenda','ppt','draft','cv','reference','report','questionnaire','minutes','manuscript','other') NOT NULL,
  `title` varchar(500) NOT NULL,
  `file_path` varchar(1000) NOT NULL,
  `mime_type` varchar(150) DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `is_enabled` tinyint(1) NOT NULL,
  `allow_comments` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_meeting_documents_id` (`id`),
  KEY `ix_meeting_documents_uploaded_by` (`uploaded_by`),
  KEY `ix_meeting_documents_meeting_id` (`meeting_id`),
  KEY `ix_meeting_documents_phase` (`phase`),
  CONSTRAINT `meeting_documents_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_documents_ibfk_2` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_documents`
--

LOCK TABLES `meeting_documents` WRITE;
/*!40000 ALTER TABLE `meeting_documents` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_documents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_minutes`
--

DROP TABLE IF EXISTS `meeting_minutes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_minutes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `source_transcript_id` int DEFAULT NULL,
  `draft_text` mediumtext,
  `final_text` mediumtext,
  `status` enum('draft','shared','finalized') NOT NULL,
  `created_by` int DEFAULT NULL,
  `finalized_by` int DEFAULT NULL,
  `shared_at` datetime DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_minutes` (`meeting_id`),
  KEY `source_transcript_id` (`source_transcript_id`),
  KEY `created_by` (`created_by`),
  KEY `finalized_by` (`finalized_by`),
  KEY `ix_meeting_minutes_meeting_id` (`meeting_id`),
  KEY `ix_meeting_minutes_id` (`id`),
  CONSTRAINT `meeting_minutes_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_minutes_ibfk_2` FOREIGN KEY (`source_transcript_id`) REFERENCES `meeting_transcripts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `meeting_minutes_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `meeting_minutes_ibfk_4` FOREIGN KEY (`finalized_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_minutes`
--

LOCK TABLES `meeting_minutes` WRITE;
/*!40000 ALTER TABLE `meeting_minutes` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_minutes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_minutes_comments`
--

DROP TABLE IF EXISTS `meeting_minutes_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_minutes_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `minutes_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_meeting_minutes_comments_id` (`id`),
  KEY `ix_meeting_minutes_comments_user_id` (`user_id`),
  KEY `ix_meeting_minutes_comments_minutes_id` (`minutes_id`),
  CONSTRAINT `meeting_minutes_comments_ibfk_1` FOREIGN KEY (`minutes_id`) REFERENCES `meeting_minutes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_minutes_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_minutes_comments`
--

LOCK TABLES `meeting_minutes_comments` WRITE;
/*!40000 ALTER TABLE `meeting_minutes_comments` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_minutes_comments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_participants`
--

DROP TABLE IF EXISTS `meeting_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `role` enum('panel_member','participant') NOT NULL,
  `invite_status` enum('pending','sent','accepted','declined') NOT NULL,
  `can_speak` tinyint(1) NOT NULL,
  `invited_at` datetime NOT NULL,
  `joined_at` datetime DEFAULT NULL,
  `left_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  `participant_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_participant_user` (`meeting_id`,`user_id`),
  UNIQUE KEY `uq_meeting_participant_participant` (`meeting_id`,`participant_id`),
  KEY `ix_meeting_participants_user_id` (`user_id`),
  KEY `ix_meeting_participants_meeting_id` (`meeting_id`),
  KEY `ix_meeting_participants_id` (`id`),
  KEY `ix_meeting_participants_participant_id` (`participant_id`),
  CONSTRAINT `fk_mp_participant` FOREIGN KEY (`participant_id`) REFERENCES `participants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_participants_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_participants_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_participants`
--

LOCK TABLES `meeting_participants` WRITE;
/*!40000 ALTER TABLE `meeting_participants` DISABLE KEYS */;
INSERT INTO `meeting_participants` VALUES (1,2,NULL,'panel_member','pending',1,'2026-05-06 05:56:47',NULL,NULL,'2026-05-06 05:56:54',1);
/*!40000 ALTER TABLE `meeting_participants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_polls`
--

DROP TABLE IF EXISTS `meeting_polls`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_polls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `poll_id` int NOT NULL,
  `phase` enum('live') NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_poll` (`meeting_id`,`poll_id`),
  KEY `created_by` (`created_by`),
  KEY `ix_meeting_polls_id` (`id`),
  KEY `ix_meeting_polls_meeting_id` (`meeting_id`),
  KEY `ix_meeting_polls_poll_id` (`poll_id`),
  CONSTRAINT `meeting_polls_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_polls_ibfk_2` FOREIGN KEY (`poll_id`) REFERENCES `polls` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_polls_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_polls`
--

LOCK TABLES `meeting_polls` WRITE;
/*!40000 ALTER TABLE `meeting_polls` DISABLE KEYS */;
INSERT INTO `meeting_polls` VALUES (1,2,2,'live',7,'2026-05-05 09:29:01');
/*!40000 ALTER TABLE `meeting_polls` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_provider_config`
--

DROP TABLE IF EXISTS `meeting_provider_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_provider_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` enum('teams','zoom') NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `client_id` varchar(255) DEFAULT NULL,
  `client_secret` varchar(1000) DEFAULT NULL,
  `tenant_id` varchar(255) DEFAULT NULL,
  `account_id` varchar(255) DEFAULT NULL,
  `extra_config` text,
  `updated_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_provider_config_provider` (`provider`),
  KEY `updated_by` (`updated_by`),
  KEY `ix_meeting_provider_config_is_active` (`is_active`),
  KEY `ix_meeting_provider_config_id` (`id`),
  CONSTRAINT `meeting_provider_config_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_provider_config`
--

LOCK TABLES `meeting_provider_config` WRITE;
/*!40000 ALTER TABLE `meeting_provider_config` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_provider_config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_recordings`
--

DROP TABLE IF EXISTS `meeting_recordings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_recordings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `source` enum('provider','manual_upload') NOT NULL,
  `file_path_or_url` varchar(1000) NOT NULL,
  `duration_seconds` int DEFAULT NULL,
  `recorded_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_meeting_recordings_id` (`id`),
  KEY `ix_meeting_recordings_meeting_id` (`meeting_id`),
  CONSTRAINT `meeting_recordings_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_recordings`
--

LOCK TABLES `meeting_recordings` WRITE;
/*!40000 ALTER TABLE `meeting_recordings` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_recordings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_surveys`
--

DROP TABLE IF EXISTS `meeting_surveys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_surveys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `survey_id` int NOT NULL,
  `phase` enum('pre','post') NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_survey_phase` (`meeting_id`,`survey_id`,`phase`),
  KEY `created_by` (`created_by`),
  KEY `ix_meeting_surveys_survey_id` (`survey_id`),
  KEY `ix_meeting_surveys_meeting_id` (`meeting_id`),
  KEY `ix_meeting_surveys_id` (`id`),
  CONSTRAINT `meeting_surveys_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_surveys_ibfk_2` FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_surveys_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_surveys`
--

LOCK TABLES `meeting_surveys` WRITE;
/*!40000 ALTER TABLE `meeting_surveys` DISABLE KEYS */;
INSERT INTO `meeting_surveys` VALUES (4,2,2,'pre',7,'2026-05-06 05:30:27');
/*!40000 ALTER TABLE `meeting_surveys` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `meeting_transcripts`
--

DROP TABLE IF EXISTS `meeting_transcripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_transcripts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `raw_text` mediumtext,
  `edited_text` mediumtext,
  `status` enum('draft','edited','finalized','shared') NOT NULL,
  `edited_by` int DEFAULT NULL,
  `finalized_by` int DEFAULT NULL,
  `shared_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meeting_transcript` (`meeting_id`),
  KEY `edited_by` (`edited_by`),
  KEY `finalized_by` (`finalized_by`),
  KEY `ix_meeting_transcripts_meeting_id` (`meeting_id`),
  KEY `ix_meeting_transcripts_id` (`id`),
  CONSTRAINT `meeting_transcripts_ibfk_1` FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meeting_transcripts_ibfk_2` FOREIGN KEY (`edited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `meeting_transcripts_ibfk_3` FOREIGN KEY (`finalized_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `meeting_transcripts`
--

LOCK TABLES `meeting_transcripts` WRITE;
/*!40000 ALTER TABLE `meeting_transcripts` DISABLE KEYS */;
/*!40000 ALTER TABLE `meeting_transcripts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `participants`
--

DROP TABLE IF EXISTS `participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `owner_user_id` int NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `organization` varchar(255) DEFAULT NULL,
  `designation` varchar(255) DEFAULT NULL,
  `notes` text,
  `is_active` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_participants_email` (`email`),
  KEY `ix_participants_id` (`id`),
  KEY `ix_participants_owner_active` (`owner_user_id`,`is_active`),
  KEY `ix_participants_owner_user_id` (`owner_user_id`),
  CONSTRAINT `participants_ibfk_1` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `participants`
--

LOCK TABLES `participants` WRITE;
/*!40000 ALTER TABLE `participants` DISABLE KEYS */;
INSERT INTO `participants` VALUES (1,7,'Atul Kumar','teotia.atul92@gmail.com','Turacoz','Developer','ssdg dfgdfg',1,'2026-05-06 05:54:58','2026-05-06 05:54:58');
/*!40000 ALTER TABLE `participants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payment_gateways`
--

DROP TABLE IF EXISTS `payment_gateways`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_gateways` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_secret` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `merchant_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_live` tinyint(1) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT NULL,
  `supported_methods` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `supported_currencies` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `webhook_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_payment_gateways_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_gateways`
--

LOCK TABLES `payment_gateways` WRITE;
/*!40000 ALTER TABLE `payment_gateways` DISABLE KEYS */;
INSERT INTO `payment_gateways` VALUES (1,'razorpay','Razor Pay Test','rzp_test_SFWzUEbERUVFSY','p5zcftC6GmGG0LUoY35oAvhu','',0,1,1,'[\"card\",\"upi\",\"netbanking\",\"wallet\"]','INR','turacoz_webhook_secret_2026_secure','','2026-03-05 20:14:59',NULL);
/*!40000 ALTER TABLE `payment_gateways` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `poll_votes`
--

DROP TABLE IF EXISTS `poll_votes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `poll_votes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `poll_id` int NOT NULL,
  `selected_options` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `voter_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voter_email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_poll_votes_id` (`id`),
  KEY `ix_poll_votes_poll_id` (`poll_id`),
  CONSTRAINT `poll_votes_ibfk_1` FOREIGN KEY (`poll_id`) REFERENCES `polls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `poll_votes`
--

LOCK TABLES `poll_votes` WRITE;
/*!40000 ALTER TABLE `poll_votes` DISABLE KEYS */;
INSERT INTO `poll_votes` VALUES (1,2,'{\"0\": [1], \"1\": [0]}','Atul','test@gmail.com','2026-04-03 06:12:59');
/*!40000 ALTER TABLE `poll_votes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `polls`
--

DROP TABLE IF EXISTS `polls`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `polls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `cover_image` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `questions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `options` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `allow_multiple` tinyint(1) NOT NULL,
  `show_results` tinyint(1) NOT NULL,
  `require_name` tinyint(1) NOT NULL,
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','active','closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_polls_token` (`token`),
  KEY `ix_polls_user_id` (`user_id`),
  KEY `ix_polls_id` (`id`),
  KEY `ix_polls_status` (`status`),
  CONSTRAINT `polls_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `polls`
--

LOCK TABLES `polls` WRITE;
/*!40000 ALTER TABLE `polls` DISABLE KEYS */;
INSERT INTO `polls` VALUES (1,1,'Test Poll',NULL,NULL,'[{\"title\": \"Fav color?\", \"options\": [{\"text\": \"Red\"}, {\"text\": \"Blue\"}], \"allow_multiple\": false}]',NULL,0,1,0,'9a74a90974d14a15a9d803533aac4819','draft','2026-04-03 05:48:38','2026-04-03 05:48:38'),(2,7,'Test Poll Title',NULL,NULL,'[{\"title\": \"Test Question 1\", \"options\": [{\"text\": \"A\"}, {\"text\": \"B\"}], \"allow_multiple\": false}, {\"title\": \"Test Question 2\", \"options\": [{\"text\": \"A\"}, {\"text\": \"B\"}], \"allow_multiple\": false}]',NULL,0,1,0,'4b7d118cfc8f4690b986f233f0b60530','closed','2026-04-03 05:49:25','2026-05-06 06:05:09'),(3,7,'test pool',NULL,NULL,'[{\"title\": \"test q 1\", \"options\": [{\"text\": \"A\"}, {\"text\": \"B\"}], \"allow_multiple\": false}]',NULL,0,1,0,'e5f099866d7c48e8b0a5d02a36b6340d','active','2026-05-06 05:33:16','2026-05-06 06:05:08');
/*!40000 ALTER TABLE `polls` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pubmed_configurations`
--

DROP TABLE IF EXISTS `pubmed_configurations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pubmed_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `base_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requests_per_second` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_default` tinyint(1) DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_pubmed_configurations_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pubmed_configurations`
--

LOCK TABLES `pubmed_configurations` WRITE;
/*!40000 ALTER TABLE `pubmed_configurations` DISABLE KEYS */;
INSERT INTO `pubmed_configurations` VALUES (1,'NCBI Production','5b42013e7b1c3537aae5b7680e9fc8052408','turacozdelhi@gmail.com','https://eutils.ncbi.nlm.nih.gov/entrez/eutils',10,1,1,'','2026-03-06 15:53:31','2026-03-06 15:53:43');
/*!40000 ALTER TABLE `pubmed_configurations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `site_settings`
--

DROP TABLE IF EXISTS `site_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_site_settings_key` (`key`),
  KEY `ix_site_settings_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `site_settings`
--

LOCK TABLES `site_settings` WRITE;
/*!40000 ALTER TABLE `site_settings` DISABLE KEYS */;
INSERT INTO `site_settings` VALUES (1,'show_pricing','false','2026-03-09 18:11:18');
/*!40000 ALTER TABLE `site_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subscription_plans`
--

DROP TABLE IF EXISTS `subscription_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_plans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `price_monthly` float DEFAULT NULL,
  `price_yearly` float DEFAULT NULL,
  `currency` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_assessments` int DEFAULT NULL,
  `max_hcps` int DEFAULT NULL,
  `features` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) DEFAULT NULL,
  `is_popular` tinyint(1) DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  `badge_text` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `ix_subscription_plans_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscription_plans`
--

LOCK TABLES `subscription_plans` WRITE;
/*!40000 ALTER TABLE `subscription_plans` DISABLE KEYS */;
INSERT INTO `subscription_plans` VALUES (1,'Starter','starter','Perfect for trying out KOL assessments',0,0,'USD',5,10,'[\"5 Assessments/month\",\"10 HCP Profiles\",\"Basic Scoring (C.1–C.4)\",\"CSV Export\",\"Email Support\"]',1,0,1,'','2026-03-05 18:20:15','2026-03-05 18:21:35'),(2,'Professional','professional','For growing medical affairs teams',99,990,'USD',100,500,'[\"100 Assessments/month\", \"500 HCP Profiles\", \"Full Scoring (C.1\\u2013C.9)\", \"PubMed & ClinicalTrials.gov\", \"Network Centrality Analysis\", \"CV Parsing (PDF, DOCX, Images)\", \"Priority Support\"]',1,1,2,'Most Popular','2026-03-05 18:20:15',NULL),(3,'Enterprise','enterprise','For large organizations with custom needs',299,2990,'USD',0,0,'[\"Unlimited Assessments\", \"Unlimited HCP Profiles\", \"Full Scoring + Custom Criteria\", \"All Data Integrations\", \"SSO & Role-Based Access\", \"Audit Trail & Compliance\", \"Dedicated Account Manager\", \"Custom API Access\"]',1,0,3,'Best Value','2026-03-05 18:20:15',NULL);
/*!40000 ALTER TABLE `subscription_plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `survey_answers`
--

DROP TABLE IF EXISTS `survey_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `response_id` int NOT NULL,
  `question_id` int NOT NULL,
  `answer_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `ix_survey_answers_response_id` (`response_id`),
  KEY `ix_survey_answers_question_id` (`question_id`),
  KEY `ix_survey_answers_id` (`id`),
  CONSTRAINT `survey_answers_ibfk_1` FOREIGN KEY (`response_id`) REFERENCES `survey_responses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `survey_answers_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `survey_questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=159 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `survey_answers`
--

LOCK TABLES `survey_answers` WRITE;
/*!40000 ALTER TABLE `survey_answers` DISABLE KEYS */;
INSERT INTO `survey_answers` VALUES (115,16,240,'Others (please specify)||~~||میرا نام اتُل کمار ہے۔'),(116,16,241,'b'),(117,16,242,'میرا نام اتُل کمار ہے۔'),(118,16,243,'Logic Not Working'),(119,16,244,'میرا نام اتُل کمار ہے۔'),(120,16,245,'میرا نام اتُل کمار ہے۔'),(121,16,246,'میرا نام اتُل کمار ہے۔'),(122,16,248,'{\"ST1\":[\"B\"],\"st2\":[\"B\"],\"ST3\":[\"B\",\"c\"]}'),(151,17,240,'Others (please specify)||~~||Je m\'appelle'),(152,17,241,'b'),(153,17,242,'Je m\'appelle'),(154,17,243,'Logic Not Working'),(155,17,244,'Je m\'appelle'),(156,17,245,'Je m\'appelle'),(157,17,246,'Je m\'appelle'),(158,17,248,'{\"ST1\":[\"A\"],\"st2\":[\"A\"],\"ST3\":[\"A\"]}');
/*!40000 ALTER TABLE `survey_answers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `survey_questions`
--

DROP TABLE IF EXISTS `survey_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `survey_id` int NOT NULL,
  `label` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_type` enum('text','textarea','number','select','multi_select','radio','checkbox','rating','date','email','phone','url','time','yes_no','linear_scale','file_upload','section_header','page_break','matrix') COLLATE utf8mb4_unicode_ci NOT NULL,
  `options` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_required` tinyint(1) NOT NULL,
  `sort_order` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_survey_questions_survey_id` (`survey_id`),
  KEY `ix_survey_questions_id` (`id`),
  CONSTRAINT `survey_questions_ibfk_1` FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=249 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `survey_questions`
--

LOCK TABLES `survey_questions` WRITE;
/*!40000 ALTER TABLE `survey_questions` DISABLE KEYS */;
INSERT INTO `survey_questions` VALUES (240,2,'Test 1','radio','[{\"text\": \"success\", \"image\": \"/uploads/surveys/7/95fb862fb9ce45869ab67a29ca42d44b.webp\", \"go_to\": \"2\"}, {\"text\": \"Fail\", \"go_to\": \"3\"}, {\"text\": \"Others (please specify)\", \"requires_text\": true}]',NULL,0,0),(241,2,'twstts','radio','[\"e\", \"b\"]',NULL,0,1),(242,2,'After Success','text','[{\"go_to\": \"4\"}]',NULL,0,2),(243,2,'After Fail','radio','[\"Logic Working \", \"Logic Not Working\"]',NULL,0,3),(244,2,'text','text',NULL,NULL,0,4),(245,2,'Question After Section A','text',NULL,NULL,0,5),(246,2,'Section B Question','text',NULL,NULL,0,6),(247,2,'TEst Test','section_header',NULL,NULL,0,7),(248,2,'','matrix','{\"rows\": [\"ST1\", \"st2\", \"ST3\"], \"columns\": [\"A\", \"B\", \"c\", \"D\"], \"multi_select\": true}',NULL,0,8);
/*!40000 ALTER TABLE `survey_questions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `survey_responses`
--

DROP TABLE IF EXISTS `survey_responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `survey_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `survey_id` int NOT NULL,
  `respondent_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `respondent_email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `intro_data` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `submitted_at` datetime NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'complete',
  `last_question_id` int DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_survey_responses_id` (`id`),
  KEY `ix_survey_responses_survey_id` (`survey_id`),
  KEY `ix_survey_responses_status` (`status`),
  CONSTRAINT `survey_responses_ibfk_1` FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `survey_responses`
--

LOCK TABLES `survey_responses` WRITE;
/*!40000 ALTER TABLE `survey_responses` DISABLE KEYS */;
INSERT INTO `survey_responses` VALUES (16,2,'میرا نام اتُل کمار ہے۔','میرا نام اتُل کمار ہے۔','{\"Name\": \"میرا نام اتُل کمار ہے۔\", \"Email\": \"میرا نام اتُل کمار ہے۔\"}','2026-05-29 09:32:40','complete',NULL,'2026-05-29 09:33:09'),(17,2,'Je m\'appelle','Je m\'appelle','{\"Name\": \"Je m\'appelle\", \"Email\": \"Je m\'appelle\"}','2026-05-29 09:43:53','complete',NULL,'2026-05-29 09:44:11');
/*!40000 ALTER TABLE `survey_responses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `surveys`
--

DROP TABLE IF EXISTS `surveys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `surveys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `cover_image` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `intro_fields` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','active','closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `settings` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_surveys_token` (`token`),
  KEY `ix_surveys_user_id` (`user_id`),
  KEY `ix_surveys_id` (`id`),
  KEY `ix_surveys_status` (`status`),
  CONSTRAINT `surveys_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `surveys`
--

LOCK TABLES `surveys` WRITE;
/*!40000 ALTER TABLE `surveys` DISABLE KEYS */;
INSERT INTO `surveys` VALUES (2,7,'Test Servey','<p>Test&nbsp;Servey&nbsp;Description&nbsp;Test&nbsp;hgh&nbsp;jhsgdhf&nbsp;gjsdfsjdfg&nbsp;dklfhgjkhdkjf&nbsp;hgjkhdjkfhkjghdkj&nbsp;fghjk&nbsp;df&nbsp;hgjhs&nbsp;dfhgjhsdg&nbsp;fjgjhdfg</p><p></p><p>ghjghsdf</p><p></p><p>jhgjkdsf</p><p>jhg&nbsp;sdf</p><p>jkhghsdf&nbsp;</p><p>bjnjkdsf</p>','/uploads/surveys/7/84fe1d28cefc4ec69696a7d6ddfd1b0a.webp','[{\"label\": \"Name\", \"field_type\": \"text\", \"is_required\": true}, {\"label\": \"Email\", \"field_type\": \"email\", \"is_required\": true, \"is_unique\": true}]','704934dc5adf4533ae80b1644360077b','active','2026-04-02 08:23:48','2026-05-29 08:55:25','{\"show_title\": true, \"progress_bar\": \"off\", \"page_titles\": true, \"page_numbers\": false, \"question_numbers\": \"on\", \"required_asterisks\": true, \"language\": \"en\"}'),(4,7,'test 2 servay','<p>hhj&nbsp;ghgj</p>',NULL,NULL,'f3ceebe1279a4144ad1f6efef490c4ce','closed','2026-05-06 05:26:40','2026-05-06 05:32:08',NULL);
/*!40000 ALTER TABLE `surveys` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_parameter_preferences`
--

DROP TABLE IF EXISTS `user_parameter_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_parameter_preferences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `parameter_id` int NOT NULL,
  `is_enabled` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `parameter_id` (`parameter_id`),
  KEY `ix_user_parameter_preferences_id` (`id`),
  CONSTRAINT `user_parameter_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_parameter_preferences_ibfk_2` FOREIGN KEY (`parameter_id`) REFERENCES `assessment_parameters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_parameter_preferences`
--

LOCK TABLES `user_parameter_preferences` WRITE;
/*!40000 ALTER TABLE `user_parameter_preferences` DISABLE KEYS */;
INSERT INTO `user_parameter_preferences` VALUES (1,7,1,1,'2026-03-06 12:09:51',NULL),(2,7,2,1,'2026-03-06 12:09:51',NULL),(3,7,3,1,'2026-03-06 12:09:51',NULL),(4,7,4,1,'2026-03-06 12:09:51',NULL),(5,7,5,1,'2026-03-06 12:09:51',NULL),(6,7,6,1,'2026-03-06 12:09:51',NULL),(7,7,7,1,'2026-03-06 12:09:51',NULL),(8,7,8,1,'2026-03-06 12:09:51',NULL),(9,7,9,1,'2026-03-06 12:09:51',NULL),(10,7,10,1,'2026-03-06 12:09:51',NULL),(11,7,11,1,'2026-03-06 12:09:51',NULL),(12,7,12,1,'2026-03-06 12:09:51',NULL),(13,7,13,1,'2026-03-06 12:09:51','2026-03-06 12:11:47'),(14,7,14,1,'2026-03-06 12:09:51','2026-03-06 12:11:47'),(15,7,15,1,'2026-03-06 12:09:51','2026-03-06 12:11:47'),(16,7,16,1,'2026-03-06 12:09:51','2026-03-06 12:11:47'),(17,7,17,1,'2026-03-06 12:09:51','2026-03-06 12:11:47'),(18,7,18,1,'2026-03-06 12:09:51',NULL),(19,7,19,1,'2026-03-06 12:09:51',NULL),(20,7,20,1,'2026-03-06 12:09:51',NULL),(21,7,21,1,'2026-03-06 12:09:51',NULL),(22,7,22,1,'2026-03-06 12:09:51',NULL),(23,7,23,1,'2026-03-06 12:09:51',NULL),(24,7,24,1,'2026-03-06 12:09:51',NULL),(25,7,25,1,'2026-03-06 12:09:51',NULL),(26,7,26,1,'2026-03-06 12:09:51',NULL),(27,7,27,1,'2026-03-06 12:09:51',NULL),(28,7,28,1,'2026-03-06 12:09:51',NULL),(29,7,29,0,'2026-03-06 12:09:51',NULL),(30,7,30,0,'2026-03-06 12:09:51',NULL),(31,7,31,0,'2026-03-06 12:09:51',NULL),(32,7,32,0,'2026-03-06 12:09:51',NULL),(33,7,33,0,'2026-03-06 12:09:51',NULL),(34,7,34,0,'2026-03-06 12:09:51',NULL),(35,7,35,0,'2026-03-06 12:09:51',NULL),(36,7,36,0,'2026-03-06 12:09:51',NULL),(37,7,37,0,'2026-03-06 12:09:51',NULL),(38,7,38,0,'2026-03-06 12:09:51',NULL),(39,7,39,0,'2026-03-06 12:09:51',NULL),(40,7,40,0,'2026-03-06 12:09:51',NULL),(41,7,41,0,'2026-03-06 12:09:51',NULL),(42,7,42,1,'2026-03-06 12:09:51',NULL);
/*!40000 ALTER TABLE `user_parameter_preferences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_subscriptions`
--

DROP TABLE IF EXISTS `user_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_subscriptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `plan_id` int NOT NULL,
  `status` enum('active','cancelled','expired','past_due') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_cycle` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_period_start` datetime DEFAULT NULL,
  `current_period_end` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  KEY `ix_user_subscriptions_user_id` (`user_id`),
  KEY `ix_user_subscriptions_id` (`id`),
  CONSTRAINT `user_subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `user_subscriptions_ibfk_2` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_subscriptions`
--

LOCK TABLES `user_subscriptions` WRITE;
/*!40000 ALTER TABLE `user_subscriptions` DISABLE KEYS */;
INSERT INTO `user_subscriptions` VALUES (2,7,2,'active','monthly','2026-03-05 15:16:13','2026-04-04 15:16:13',NULL,'2026-03-05 20:46:13',NULL);
/*!40000 ALTER TABLE `user_subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `hashed_password` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('super_admin','admin','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `organization` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL,
  `allowed_services` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_users_email` (`email`),
  KEY `ix_users_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin@tura.com','Turacoz Super Admin','$2b$12$08At2zZW2CUnsWlRPQDzp.ccDpFHaVecX2Wg0.omdypbmifmftJdG','super_admin','Turacoz',1,'[\"surveys\", \"assessments\", \"polling\", \"assessment_forms\", \"advisory_boards\", \"publications\", \"consensus\", \"recent_guidelines\"]','2026-03-05 12:04:15','2026-04-03 07:13:14'),(7,'atul.teotia@turacoz.com','Atul Kumar','$2b$12$t7t4xlSIianeT02nkRnmiOgV6MbAk49y4c3TF4kW4WyNK5daILQPi','user','Turacoz Healthcare',1,'[\"polling\", \"assessments\", \"surveys\", \"assessment_forms\", \"advisory_boards\"]','2026-03-05 15:14:43','2026-05-04 07:06:03');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'tura_quant'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-29 15:15:28
