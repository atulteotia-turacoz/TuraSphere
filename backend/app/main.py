import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import engine, Base
from app.api.router import api_router

# Create upload directory
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

# The therapeutic areas this app used to seed as global/built-in rows. They are no
# longer created, and the startup migration deletes any that remain: a global row
# is read-only to end users, so nobody could attach the supporting keywords the KOL
# scrape depends on, and creating a personal area of the same name was rejected as
# a duplicate. Therapeutic areas are now purely user-managed.
# Listed explicitly so a global area an admin adds later is not swept up.
SEEDED_THERAPEUTIC_AREA_VALUES = (
    "oncology", "cardiovascular", "neurology", "orthopedics",
    "dermatology", "gastroenterology", "pulmonology", "endocrinology",
)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="AI-enabled KOL Assessment Tool with SAS-style scoring model",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

# Serve uploaded files (images, etc.)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# LiveKit Egress custom template (see app/static/egress_template.html). Fetched by
# the egress container's headless Chrome, NOT by end users — it must therefore be
# reachable from inside Docker, which is what settings.EGRESS_TEMPLATE_BASE_URL
# resolves. Unauthenticated on purpose: egress joins with the one-shot room token
# in the query string and has no session to carry.
app.mount(
    "/egress-template",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
    name="egress_template",
)


def _backfill_cv_hashes(conn):
    """Fingerprint the CVs already stored, once, when the column first appears.

    Without this, "the same CV file" only ever recognises HCPs assessed after
    this change — every profile already on file would have a NULL hash and a
    re-uploaded CV would fall back to matching on email / mobile / registration
    number, which some CVs simply do not carry. Rows whose file has since been
    removed are left NULL and matched on their identity fields as before.
    """
    import hashlib
    from sqlalchemy import text as _t

    # Filtered on the NULL hash, so this is a no-op on every start after the
    # first — and still does the right thing if the column was added by hand.
    rows = conn.execute(_t(
        "SELECT id, cv_file_path FROM hcp_profiles "
        "WHERE cv_file_hash IS NULL AND cv_file_path IS NOT NULL AND cv_file_path <> ''"
    )).fetchall()
    done = 0
    for row_id, path in rows:
        try:
            if not path or not os.path.exists(path):
                continue
            with open(path, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
        except Exception:
            continue
        conn.execute(
            _t("UPDATE hcp_profiles SET cv_file_hash = :h WHERE id = :i"),
            {"h": digest, "i": row_id},
        )
        done += 1
    if done:
        print(f"[hcp_profiles.cv_file_hash] fingerprinted {done} stored CV(s)")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

    # ⚠️ ORDER MATTERS: any migration on the `users` table must run HERE, before
    # the super-admin seed below. That seed queries User through the ORM, which
    # names every mapped column in its SELECT — so a column that exists on the
    # model but not yet in MySQL fails startup with
    # "Unknown column 'users.granted_services' in 'field list'".
    # (The other migrations further down are safe where they are: they touch
    # tables nothing queries during startup.)
    try:
        from sqlalchemy import inspect as _inspect, text as _text
        _insp = _inspect(engine)
        if "users" in _insp.get_table_names():
            _cols = {c["name"] for c in _insp.get_columns("users")}
            if "ai_enabled" not in _cols:
                with engine.begin() as conn:
                    conn.execute(_text(
                        "ALTER TABLE users ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 1"
                    ))
            if "kol_tiers_seeded" not in _cols:
                with engine.begin() as conn:
                    conn.execute(_text(
                        "ALTER TABLE users ADD COLUMN kol_tiers_seeded TINYINT(1) NOT NULL DEFAULT 0"
                    ))
                    # Anything that already HAS bands was seeded long ago — mark
                    # it, so an admin clearing those bands is not undone by the
                    # seeder on the next read.
                    conn.execute(_text(
                        "UPDATE users SET kol_tiers_seeded = 1 WHERE id IN "
                        "(SELECT DISTINCT user_id FROM kol_tiers WHERE user_id IS NOT NULL)"
                    ))
            if "granted_services" not in _cols:
                with engine.begin() as conn:
                    conn.execute(_text("ALTER TABLE users ADD COLUMN granted_services TEXT NULL"))
                    # Backfill from allowed_services. Without this every existing
                    # user is granted nothing the moment the clamp goes live and
                    # loses access to every module they had.
                    conn.execute(_text(
                        "UPDATE users SET granted_services = allowed_services "
                        "WHERE allowed_services IS NOT NULL"
                    ))
                print("[users.granted_services] column added and backfilled")
    except Exception as e:
        print(f"[users.granted_services migration] skipped: {e}")

    # Create default super admin
    from sqlalchemy.orm import Session
    from app.core.database import SessionLocal
    from app.models.user import User
    from app.core.security import get_password_hash

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin@tura.com").first()
        if not admin:
            admin = User(
                email="admin@tura.com",
                full_name="Super Admin",
                hashed_password=get_password_hash("Admin@123"),
                role="super_admin",
                organization="Tura",
                is_active=True,
            )
            db.add(admin)
            db.commit()

        # Seed default subscription plans
        import json
        from app.models.subscription_plan import SubscriptionPlan

        existing_plans = db.query(SubscriptionPlan).count()
        if existing_plans == 0:
            default_plans = [
                SubscriptionPlan(
                    name="Starter", slug="starter",
                    description="Perfect for trying out KOL assessments",
                    price_monthly=0, price_yearly=0, currency="USD",
                    max_assessments=5, max_hcps=10,
                    features=json.dumps([
                        "5 Assessments/month", "10 HCP Profiles",
                        "Basic Scoring (C.1\u2013C.4)", "CSV Export", "Email Support",
                    ]),
                    is_active=True, is_popular=False, sort_order=1,
                ),
                SubscriptionPlan(
                    name="Professional", slug="professional",
                    description="For growing medical affairs teams",
                    price_monthly=99, price_yearly=990, currency="USD",
                    max_assessments=100, max_hcps=500,
                    features=json.dumps([
                        "100 Assessments/month", "500 HCP Profiles",
                        "Full Scoring (C.1\u2013C.9)", "PubMed & ClinicalTrials.gov",
                        "Network Centrality Analysis",
                        "CV Parsing (PDF, DOCX, Images)", "Priority Support",
                    ]),
                    is_active=True, is_popular=True, sort_order=2,
                    badge_text="Most Popular",
                ),
                SubscriptionPlan(
                    name="Enterprise", slug="enterprise",
                    description="For large organizations with custom needs",
                    price_monthly=299, price_yearly=2990, currency="USD",
                    max_assessments=0, max_hcps=0,
                    features=json.dumps([
                        "Unlimited Assessments", "Unlimited HCP Profiles",
                        "Full Scoring + Custom Criteria", "All Data Integrations",
                        "SSO & Role-Based Access", "Audit Trail & Compliance",
                        "Dedicated Account Manager", "Custom API Access",
                    ]),
                    is_active=True, is_popular=False, sort_order=3,
                    badge_text="Best Value",
                ),
            ]
            db.add_all(default_plans)
            db.commit()

        # Seed default site settings
        from app.models.configuration import SiteSetting

        if not db.query(SiteSetting).filter(SiteSetting.key == "show_pricing").first():
            db.add(SiteSetting(key="show_pricing", value="false"))
            db.commit()

        # Seed / migrate master data
        from app.models.master_data import MasterData, MasterDataType
        from sqlalchemy import bindparam, inspect, text

        # ── In-place schema migration (no Alembic in this project) ──
        # 1. Add user_id column if missing
        # 2. Widen the `type` enum to include the new user-managed values
        # 3. Replace legacy unique constraint with the user-scoped one
        try:
            insp = inspect(engine)
            if "master_data" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("master_data")}
                with engine.begin() as conn:
                    if "user_id" not in cols:
                        conn.execute(text("ALTER TABLE master_data ADD COLUMN user_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_master_data_user_id ON master_data (user_id)"))
                        conn.execute(text(
                            "ALTER TABLE master_data ADD CONSTRAINT fk_master_data_user "
                            "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
                        ))
                    # Widen enum (safe to re-run; MySQL replaces the column definition)
                    conn.execute(text(
                        "ALTER TABLE master_data MODIFY COLUMN type "
                        "ENUM('therapeutic_area','specialty','hcp_type','pharma_sponsor','region','currency') NOT NULL"
                    ))
                    # Swap unique constraint to the user-scoped form
                    existing_indexes = {i["name"] for i in insp.get_indexes("master_data")}
                    existing_uniques = {u["name"] for u in insp.get_unique_constraints("master_data")}
                    if "uq_master_data_type_value" in existing_indexes or "uq_master_data_type_value" in existing_uniques:
                        conn.execute(text("ALTER TABLE master_data DROP INDEX uq_master_data_type_value"))
                    if "uq_master_data_type_value_user" not in existing_indexes and "uq_master_data_type_value_user" not in existing_uniques:
                        conn.execute(text(
                            "ALTER TABLE master_data ADD CONSTRAINT uq_master_data_type_value_user "
                            "UNIQUE (type, value, user_id)"
                        ))
        except Exception as e:
            print(f"[master_data migration] skipped: {e}")

        # ── master_data: add keywords (KOL scrape supporting search terms) ──
        try:
            insp = inspect(engine)
            if "master_data" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("master_data")}
                if "keywords" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE master_data ADD COLUMN keywords TEXT NULL"))
        except Exception as e:
            print(f"[master_data.keywords migration] skipped: {e}")

        # ── Remove the built-in (global) therapeutic areas ──
        # They were read-only to end users, so nobody could attach the supporting
        # keywords the KOL scrape needs — and a personal area of the same name was
        # rejected as a duplicate. Therapeutic areas are now purely user-managed.
        #
        # Scoped to the values we originally seeded, so a global one an admin adds
        # later is left alone. Idempotent: after the first run there is nothing to
        # delete. Users' own rows (user_id IS NOT NULL) are never touched, and
        # advisory boards keep their saved values — those are stored as plain
        # strings, and the board pickers can create an area inline.
        try:
            insp = inspect(engine)
            if "master_data" in insp.get_table_names():
                with engine.begin() as conn:
                    res = conn.execute(
                        text("DELETE FROM master_data WHERE type = 'therapeutic_area' "
                             "AND user_id IS NULL AND value IN :vals")
                        .bindparams(bindparam("vals", expanding=True)),
                        {"vals": list(SEEDED_THERAPEUTIC_AREA_VALUES)},
                    )
                    if res.rowcount:
                        print(f"[master_data] removed {res.rowcount} built-in therapeutic area(s)")
        except Exception as e:
            print(f"[master_data built-in therapeutic_area removal] skipped: {e}")

        # ── KOL scrape: add practo_profile_url (Practo-sourced KOL identity) ──
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    if "practo_profile_url" not in cols:
                        with engine.begin() as conn:
                            conn.execute(text(
                                f"ALTER TABLE {_table} ADD COLUMN practo_profile_url VARCHAR(300) NULL"
                            ))
                            conn.execute(text(
                                f"CREATE INDEX ix_{_table}_practo_profile_url "
                                f"ON {_table} (practo_profile_url)"
                            ))
            except Exception as e:
                print(f"[{_table}.practo_profile_url migration] skipped: {e}")

        # ── KOL scrape: add web_profile_url (Google-sourced KOL identity) ──
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    if "web_profile_url" not in cols:
                        with engine.begin() as conn:
                            conn.execute(text(
                                f"ALTER TABLE {_table} ADD COLUMN web_profile_url VARCHAR(500) NULL"
                            ))
                            conn.execute(text(
                                f"CREATE INDEX ix_{_table}_web_profile_url "
                                f"ON {_table} (web_profile_url)"
                            ))
            except Exception as e:
                print(f"[{_table}.web_profile_url migration] skipped: {e}")

        # ── KOL pending + directory: CTRI identity + trials ──
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    with engine.begin() as conn:
                        if "ctri_key" not in cols:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN ctri_key VARCHAR(300) NULL"))
                            conn.execute(text(f"CREATE INDEX ix_{_table}_ctri_key ON {_table} (ctri_key)"))
                        if "ctri_data" not in cols:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN ctri_data TEXT NULL"))
                        if "ctri_updated_at" not in cols:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN ctri_updated_at DATETIME NULL"))
            except Exception as e:
                print(f"[{_table}.ctri migration] skipped: {e}")

        # ── KOL pending + directory: title (Dr. / Prof. / …) ──
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    if "title" not in cols:
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN title VARCHAR(20) NULL"))
            except Exception as e:
                print(f"[{_table}.title migration] skipped: {e}")

        # ── KOL pending + directory: experience_years (total years of practice) ──
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    if "experience_years" not in cols:
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN experience_years INT NULL"))
            except Exception as e:
                print(f"[{_table}.experience_years migration] skipped: {e}")

        # ── Assessment parameters: group caps (tiers of one criterion) ──
        try:
            insp = inspect(engine)
            if "assessment_parameters" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("assessment_parameters")}
                with engine.begin() as conn:
                    if "score_group" not in cols:
                        conn.execute(text("ALTER TABLE assessment_parameters ADD COLUMN score_group VARCHAR(50) NULL"))
                    if "group_max_score" not in cols:
                        conn.execute(text("ALTER TABLE assessment_parameters ADD COLUMN group_max_score FLOAT NULL"))
        except Exception as e:
            print(f"[assessment_parameters.score_group migration] skipped: {e}")

        # ── Integrations: per-account keys (owner_user_id NULL = platform) ──
        # `web_search_usage` itself is created by create_all above.
        for _table in ("web_search_configurations", "google_scholar_configurations"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    if "owner_user_id" not in cols:
                        with engine.begin() as conn:
                            conn.execute(text(
                                f"ALTER TABLE {_table} ADD COLUMN owner_user_id INT NULL"
                            ))
                            # No FK here: adding one locks `users`, which an earlier
                            # startup session still holds open — it deadlocks startup.
                            # Account rows are removed by the account endpoints instead.
                            conn.execute(text(
                                f"CREATE INDEX ix_{_table}_owner_user_id ON {_table} (owner_user_id)"
                            ))
            except Exception as e:
                print(f"[{_table}.owner_user_id migration] skipped: {e}")

        # ── KOL pending + directory: research enrichment columns ──
        # Both tables carry the same three columns: pending rows are enriched when
        # sent for verification, directory rows on demand from the KOL card.
        for _table in ("kol_pending", "kol_directory"):
            try:
                insp = inspect(engine)
                if _table in insp.get_table_names():
                    cols = {c["name"] for c in insp.get_columns(_table)}
                    with engine.begin() as conn:
                        if "enrichment_status" not in cols:
                            conn.execute(text(
                                f"ALTER TABLE {_table} ADD COLUMN enrichment_status "
                                "VARCHAR(20) NOT NULL DEFAULT 'none'"))
                            conn.execute(text(
                                f"CREATE INDEX ix_{_table}_enrichment_status "
                                f"ON {_table} (enrichment_status)"))
                        if "enrichment_data" not in cols:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN enrichment_data TEXT NULL"))
                        if "enrichment_updated_at" not in cols:
                            conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN enrichment_updated_at DATETIME NULL"))
            except Exception as e:
                print(f"[{_table}.enrichment migration] skipped: {e}")

        # ── KOL: advisory board + government affiliation on hcp_profiles ──
        try:
            insp = inspect(engine)
            if "hcp_profiles" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("hcp_profiles")}
                with engine.begin() as conn:
                    if "advisory_board" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN advisory_board TEXT NULL"))
                    if "affiliated_to_government" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN affiliated_to_government VARCHAR(10) NULL"))
                    # Contact details captured on the New Assessment form (and
                    # auto-filled from an uploaded CV). email already existed.
                    if "mobile" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN mobile VARCHAR(50) NULL"))
                    if "consent_file_path" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN consent_file_path VARCHAR(512) NULL"))
                    if "consent_uploaded_at" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN consent_uploaded_at DATETIME NULL"))
                    # Repeatable sections the scoring rubric needs but the form
                    # could not capture: C3_TEXTBOOK_AUTHOR, and the C1 leadership
                    # criteria (board member / society leader / executive board).
                    if "textbooks" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN textbooks TEXT NULL"))
                    if "office_bearer_positions" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN office_bearer_positions TEXT NULL"))
                    # Fingerprint of the uploaded CV, so re-uploading the same
                    # file is recognised as the same HCP instead of creating a
                    # second record for one person.
                    if "cv_file_hash" not in cols:
                        conn.execute(text("ALTER TABLE hcp_profiles ADD COLUMN cv_file_hash VARCHAR(64) NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_hcp_profiles_cv_file_hash "
                            "ON hcp_profiles (cv_file_hash)"))
                    _backfill_cv_hashes(conn)
        except Exception as e:
            print(f"[hcp_profiles.advisory_board migration] skipped: {e}")

        # ── MABM: add public_token to meeting_documents (public share links) ──
        try:
            insp = inspect(engine)
            if "meeting_documents" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("meeting_documents")}
                if "public_token" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE meeting_documents ADD COLUMN public_token VARCHAR(64) NULL"))
                        conn.execute(text(
                            "CREATE UNIQUE INDEX ix_meeting_documents_public_token "
                            "ON meeting_documents (public_token)"
                        ))
        except Exception as e:
            print(f"[meeting_documents.public_token migration] skipped: {e}")

        # ── Sections: board_sections + meeting_documents.section_id ──
        # `board_sections` itself is created by Base.metadata.create_all above.
        # Documents used to be filed under an AGENDA ITEM; agenda_item_id is kept
        # for what is already filed that way, and new uploads set section_id.
        #
        # These folders shipped for a few hours as "sessions" before the name was
        # corrected (a session is a part of the MEETING and holds no documents).
        # create_all has already made the empty `board_sections` by the time this
        # runs, so the old table cannot simply be RENAMEd — its rows are copied
        # across with their ids intact (documents point at those ids), the FK is
        # repointed, and only then does the old table go.
        try:
            insp = inspect(engine)
            tables = set(insp.get_table_names())
            if "meeting_documents" in tables and "board_sections" in tables:
                cols = {c["name"] for c in insp.get_columns("meeting_documents")}
                fks = {fk["name"]: fk for fk in insp.get_foreign_keys("meeting_documents")}
                with engine.begin() as conn:
                    if "session_id" in cols and "section_id" not in cols:
                        conn.execute(text(
                            "ALTER TABLE meeting_documents CHANGE COLUMN session_id section_id INT NULL"
                        ))
                    elif "section_id" not in cols:
                        conn.execute(text("ALTER TABLE meeting_documents ADD COLUMN section_id INT NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_meeting_documents_section_id ON meeting_documents (section_id)"
                        ))

                    if "board_sessions" in tables:
                        conn.execute(text(
                            "INSERT IGNORE INTO board_sections (id, board_id, title, sequence, created_at, updated_at) "
                            "SELECT id, board_id, title, sequence, created_at, updated_at FROM board_sessions"
                        ))
                    # The old FK still points at board_sessions, which would block
                    # dropping it.
                    stale = fks.get("fk_md_session")
                    if stale and stale.get("referred_table") == "board_sessions":
                        conn.execute(text("ALTER TABLE meeting_documents DROP FOREIGN KEY fk_md_session"))
                    if not any(fk.get("referred_table") == "board_sections" for fk in fks.values()):
                        conn.execute(text(
                            "ALTER TABLE meeting_documents ADD CONSTRAINT fk_md_section "
                            "FOREIGN KEY (section_id) REFERENCES board_sections(id) ON DELETE SET NULL"
                        ))
                    if "board_sessions" in tables:
                        conn.execute(text("DROP TABLE board_sessions"))
        except Exception as e:
            print(f"[meeting_documents.section_id migration] skipped: {e}")

        # ── Sections AND sessions: board_sections.kind + documents.doc_session_id ──
        # Sections and sessions are two lists of headings a document can be filed
        # under, sharing one table. Rows created before `kind` existed were all
        # sections, which is what the default says.
        try:
            insp = inspect(engine)
            tables = set(insp.get_table_names())
            if "board_sections" in tables:
                cols = {c["name"] for c in insp.get_columns("board_sections")}
                if "kind" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text(
                            "ALTER TABLE board_sections ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'section'"
                        ))
                        conn.execute(text(
                            "CREATE INDEX ix_board_sections_kind ON board_sections (kind)"
                        ))
            if "meeting_documents" in tables and "board_sections" in tables:
                cols = {c["name"] for c in insp.get_columns("meeting_documents")}
                if "doc_session_id" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE meeting_documents ADD COLUMN doc_session_id INT NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_meeting_documents_doc_session_id ON meeting_documents (doc_session_id)"
                        ))
                        conn.execute(text(
                            "ALTER TABLE meeting_documents ADD CONSTRAINT fk_md_doc_session "
                            "FOREIGN KEY (doc_session_id) REFERENCES board_sections(id) ON DELETE SET NULL"
                        ))
        except Exception as e:
            print(f"[board_sections.kind / documents.doc_session_id migration] skipped: {e}")

        # ── MABM: add zoom_meeting_id to board_meetings if missing (Phase 4) ──
        try:
            insp = inspect(engine)
            if "board_meetings" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("board_meetings")}
                if "zoom_meeting_id" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE board_meetings ADD COLUMN zoom_meeting_id VARCHAR(64) NULL"))
                        conn.execute(text("CREATE INDEX ix_board_meetings_zoom_meeting_id ON board_meetings (zoom_meeting_id)"))
        except Exception as e:
            print(f"[board_meetings.zoom_meeting_id migration] skipped: {e}")

        # ── MABM: add chat_enabled to board_meetings (in-app chat on/off) ──
        try:
            insp = inspect(engine)
            if "board_meetings" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("board_meetings")}
                if "chat_enabled" not in cols:
                    with engine.begin() as conn:
                        # Existing meetings default to chat ON, matching the model.
                        conn.execute(text(
                            "ALTER TABLE board_meetings ADD COLUMN chat_enabled TINYINT(1) NOT NULL DEFAULT 1"
                        ))
        except Exception as e:
            print(f"[board_meetings.chat_enabled migration] skipped: {e}")

        # ── MABM: allow 'livekit' as a meeting provider (see livekit.md) ──
        # Safe to re-run; MySQL just replaces the column definition. Widening an
        # enum never invalidates existing 'teams'/'zoom' rows.
        try:
            insp = inspect(engine)
            if "meeting_provider_config" in insp.get_table_names():
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE meeting_provider_config MODIFY COLUMN provider "
                        "ENUM('teams','zoom','livekit') NOT NULL"
                    ))
        except Exception as e:
            print(f"[meeting_provider_config.provider enum widening] skipped: {e}")

        # ── MABM: transcripts become per-RECORDING, not per-meeting ──
        # A meeting is often started/stopped several times, so it holds several
        # recordings and each needs its own transcript. The old
        # unique(meeting_id) made transcribing a second recording overwrite the
        # first. recording_id stays NULLABLE so pre-existing transcripts (and
        # Zoom's meeting-level auto-transcript, which has no recording row of
        # ours) still fit — MySQL permits multiple NULLs under a unique index.
        try:
            insp = inspect(engine)
            if "meeting_transcripts" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("meeting_transcripts")}
                idx = {i["name"] for i in insp.get_indexes("meeting_transcripts")}
                uqs = {u["name"] for u in insp.get_unique_constraints("meeting_transcripts")}
                with engine.begin() as conn:
                    if "recording_id" not in cols:
                        conn.execute(text(
                            "ALTER TABLE meeting_transcripts ADD COLUMN recording_id INT NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_meeting_transcripts_recording_id "
                            "ON meeting_transcripts (recording_id)"))
                        conn.execute(text(
                            "ALTER TABLE meeting_transcripts ADD CONSTRAINT fk_mt_recording "
                            "FOREIGN KEY (recording_id) REFERENCES meeting_recordings(id) "
                            "ON DELETE CASCADE"))
                    # Drop the one-per-meeting rule; add one-per-recording.
                    if "uq_meeting_transcript" in idx or "uq_meeting_transcript" in uqs:
                        conn.execute(text(
                            "ALTER TABLE meeting_transcripts DROP INDEX uq_meeting_transcript"))
                    if ("uq_meeting_transcript_recording" not in idx
                            and "uq_meeting_transcript_recording" not in uqs):
                        conn.execute(text(
                            "ALTER TABLE meeting_transcripts "
                            "ADD CONSTRAINT uq_meeting_transcript_recording UNIQUE (recording_id)"))
        except Exception as e:
            print(f"[meeting_transcripts.recording_id migration] skipped: {e}")

        # ── Surveys: widen survey_questions.question_type to include matrix ──
        try:
            insp = inspect(engine)
            if "survey_questions" in insp.get_table_names():
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE survey_questions MODIFY COLUMN question_type ENUM("
                        "'text','textarea','number','select','multi_select','radio','checkbox',"
                        "'rating','date','email','phone','url','time','yes_no','linear_scale',"
                        "'file_upload','section_header','page_break','matrix') NOT NULL"
                    ))
        except Exception as e:
            print(f"[survey_questions.question_type enum widening] skipped: {e}")

        # ── Surveys: add settings (display options) column to surveys ──
        try:
            insp = inspect(engine)
            if "surveys" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("surveys")}
                if "settings" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE surveys ADD COLUMN settings TEXT NULL"))
        except Exception as e:
            print(f"[surveys.settings migration] skipped: {e}")

        # ── Surveys: add status + last_question_id + updated_at to survey_responses ──
        # Supports partial-save / resume + dedup on unique intro fields.
        try:
            insp = inspect(engine)
            if "survey_responses" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("survey_responses")}
                with engine.begin() as conn:
                    if "status" not in cols:
                        conn.execute(text("ALTER TABLE survey_responses ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'complete'"))
                        conn.execute(text("CREATE INDEX ix_survey_responses_status ON survey_responses (status)"))
                    if "last_question_id" not in cols:
                        conn.execute(text("ALTER TABLE survey_responses ADD COLUMN last_question_id INT NULL"))
                    if "updated_at" not in cols:
                        conn.execute(text("ALTER TABLE survey_responses ADD COLUMN updated_at DATETIME NULL"))
                        conn.execute(text("UPDATE survey_responses SET updated_at = submitted_at WHERE updated_at IS NULL"))
        except Exception as e:
            print(f"[survey_responses migration] skipped: {e}")

        # ── MABM: relax user_id on meeting_participants ──
        # Invitees are KOLs (hcp_id / board_kol_id), so there is no User row.
        # The old contact book (`participants` + meeting_participants.participant_id)
        # was removed on 2026-09-18; dropping those lives in
        # deployment/transfer/04_DATABASE_QUERIES.sql, run by hand, never here.
        try:
            insp = inspect(engine)
            if "meeting_participants" in insp.get_table_names():
                cols_info = insp.get_columns("meeting_participants")
                user_id_col = next((c for c in cols_info if c["name"] == "user_id"), None)
                if user_id_col and not user_id_col.get("nullable", True):
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE meeting_participants MODIFY COLUMN user_id INT NULL"))
        except Exception as e:
            print(f"[meeting_participants.user_id migration] skipped: {e}")

        # ── MABM: per-participant roles, permissions & join token ──
        # Adds the granular permission column + the per-participant "separate
        # login" join token, and widens the role enum (host/moderator/observer).
        try:
            insp = inspect(engine)
            if "meeting_participants" in insp.get_table_names():
                col_names = {c["name"] for c in insp.get_columns("meeting_participants")}
                with engine.begin() as conn:
                    if "permissions" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_participants ADD COLUMN permissions TEXT NULL"))
                    if "access_token" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_participants ADD COLUMN access_token VARCHAR(64) NULL"))
                        conn.execute(text(
                            "ALTER TABLE meeting_participants "
                            "ADD CONSTRAINT uq_meeting_participant_access_token UNIQUE (access_token)"
                        ))
                    if "token_issued_at" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_participants ADD COLUMN token_issued_at DATETIME NULL"))
                    # Widen the per-meeting role enum (safe to re-run)
                    conn.execute(text(
                        "ALTER TABLE meeting_participants MODIFY COLUMN role "
                        "ENUM('host','moderator','panel_member','participant','observer') "
                        "NOT NULL DEFAULT 'participant'"
                    ))
        except Exception as e:
            print(f"[meeting_participants roles/permissions/token migration] skipped: {e}")

        # ── MABM: link a meeting participant to their KOL/HCP record ──
        # The advisory-board expert IS their HCP directory row, so the participant
        # dashboard can read affiliations / years_of_experience straight off it and
        # the expert roster can link to /hcp/:id. Nullable — teammates and ad-hoc
        # contacts still come in via user_id / participant_id.
        try:
            insp = inspect(engine)
            if "meeting_participants" in insp.get_table_names():
                col_names = {c["name"] for c in insp.get_columns("meeting_participants")}
                with engine.begin() as conn:
                    if "board_kol_id" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_participants ADD COLUMN board_kol_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_meeting_participants_board_kol_id ON meeting_participants (board_kol_id)"))
                        conn.execute(text(
                            "ALTER TABLE meeting_participants ADD CONSTRAINT fk_mp_board_kol "
                            "FOREIGN KEY (board_kol_id) REFERENCES board_kols(id) ON DELETE CASCADE"
                        ))
                        conn.execute(text(
                            "ALTER TABLE meeting_participants ADD CONSTRAINT uq_meeting_participant_board_kol "
                            "UNIQUE (meeting_id, board_kol_id)"
                        ))
                    if "hcp_id" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_participants ADD COLUMN hcp_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_meeting_participants_hcp_id ON meeting_participants (hcp_id)"))
                        conn.execute(text(
                            "ALTER TABLE meeting_participants ADD CONSTRAINT fk_mp_hcp "
                            "FOREIGN KEY (hcp_id) REFERENCES hcp_profiles(id) ON DELETE CASCADE"
                        ))
                        conn.execute(text(
                            "ALTER TABLE meeting_participants ADD CONSTRAINT uq_meeting_participant_hcp "
                            "UNIQUE (meeting_id, hcp_id)"
                        ))
        except Exception as e:
            print(f"[meeting_participants.hcp_id migration] skipped: {e}")

        # ── Adboard: per-session materials + per-session discussion forum ──
        # The expert dashboard groups reading material under each session
        # ("Session 1 Agenda / Slides / Excel sheet") and gives every session its
        # own comment thread. `meeting_session_comments` is auto-created by
        # create_all above; the column below is the in-place part.
        try:
            insp = inspect(engine)
            if "meeting_documents" in insp.get_table_names():
                col_names = {c["name"] for c in insp.get_columns("meeting_documents")}
                with engine.begin() as conn:
                    if "agenda_item_id" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_documents ADD COLUMN agenda_item_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_meeting_documents_agenda_item_id ON meeting_documents (agenda_item_id)"))
                        conn.execute(text(
                            "ALTER TABLE meeting_documents ADD CONSTRAINT fk_md_agenda_item "
                            "FOREIGN KEY (agenda_item_id) REFERENCES meeting_agenda_items(id) ON DELETE SET NULL"
                        ))
        except Exception as e:
            print(f"[meeting_documents.agenda_item_id migration] skipped: {e}")

        # ── Adboard: the session forum becomes a three-way discussion ──
        # It started KOL-only (author = a meeting_participants row). The client
        # and the organizer could read the rollup but never answer, so a board's
        # discussion was a suggestion box. All three sides now post into the same
        # thread and `author_type` says which one wrote each row. Existing rows
        # were all written on a join token, which is what the default says.
        try:
            insp = inspect(engine)
            if "meeting_session_comments" in insp.get_table_names():
                col_names = {c["name"] for c in insp.get_columns("meeting_session_comments")}
                with engine.begin() as conn:
                    if "author_type" not in col_names:
                        conn.execute(text(
                            "ALTER TABLE meeting_session_comments ADD COLUMN author_type "
                            "VARCHAR(20) NOT NULL DEFAULT 'participant'"
                        ))
                    if "client_id" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_session_comments ADD COLUMN client_id INT NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_meeting_session_comments_client_id "
                            "ON meeting_session_comments (client_id)"
                        ))
                        conn.execute(text(
                            "ALTER TABLE meeting_session_comments ADD CONSTRAINT fk_msc_client "
                            "FOREIGN KEY (client_id) REFERENCES board_clients(id) ON DELETE SET NULL"
                        ))
                    # A comment on the meeting rather than on one session —
                    # what the expert's flat Discussion tab writes.
                    agenda_col = next(
                        (c for c in insp.get_columns("meeting_session_comments")
                         if c["name"] == "agenda_item_id"), None)
                    if agenda_col is not None and not agenda_col.get("nullable", True):
                        conn.execute(text(
                            "ALTER TABLE meeting_session_comments "
                            "MODIFY COLUMN agenda_item_id INT NULL"
                        ))
                    if "user_id" not in col_names:
                        conn.execute(text("ALTER TABLE meeting_session_comments ADD COLUMN user_id INT NULL"))
                        conn.execute(text(
                            "CREATE INDEX ix_meeting_session_comments_user_id "
                            "ON meeting_session_comments (user_id)"
                        ))
                        conn.execute(text(
                            "ALTER TABLE meeting_session_comments ADD CONSTRAINT fk_msc_user "
                            "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL"
                        ))
        except Exception as e:
            print(f"[meeting_session_comments.author_type migration] skipped: {e}")

        # ── Adboard: when the client portal link was emailed ──
        try:
            insp = inspect(engine)
            if "board_clients" in insp.get_table_names():
                col_names = {c["name"] for c in insp.get_columns("board_clients")}
                with engine.begin() as conn:
                    if "invite_sent_at" not in col_names:
                        conn.execute(text("ALTER TABLE board_clients ADD COLUMN invite_sent_at DATETIME NULL"))
                    if "password_hash" not in col_names:
                        conn.execute(text("ALTER TABLE board_clients ADD COLUMN password_hash VARCHAR(255) NULL"))
                    if "password_set_at" not in col_names:
                        conn.execute(text("ALTER TABLE board_clients ADD COLUMN password_set_at DATETIME NULL"))
        except Exception as e:
            print(f"[board_clients.invite_sent_at migration] skipped: {e}")

        # ── Adboard: the module's own KOL list ──
        # `board_kols` is auto-created by create_all above. Advisory Boards →
        # KOLs used to keep this list in the BROWSER (localStorage), so its
        # entries could never be assigned to a board. See 04_DATABASE_QUERIES.sql.

        # ── Adboard: reading-material view tracking ──
        # `meeting_document_views` is auto-created by create_all above; nothing
        # in-place is needed. Noted here so the table is not mistaken for one
        # that predates the engagement dashboard — see 04_DATABASE_QUERIES.sql.

        # ── SaaS: per-account owner on meeting_provider_config ──
        # owner_user_id NULL = platform/global default; non-null = a specific
        # account's config. Swaps the single-active unique(provider) for
        # (owner_user_id, provider). The smtp_config table is auto-created above.
        try:
            insp = inspect(engine)
            if "meeting_provider_config" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("meeting_provider_config")}
                uniques = {u["name"] for u in insp.get_unique_constraints("meeting_provider_config")}
                with engine.begin() as conn:
                    if "owner_user_id" not in cols:
                        conn.execute(text("ALTER TABLE meeting_provider_config ADD COLUMN owner_user_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_meeting_provider_config_owner_user_id ON meeting_provider_config (owner_user_id)"))
                        conn.execute(text(
                            "ALTER TABLE meeting_provider_config ADD CONSTRAINT fk_mpc_owner "
                            "FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE"
                        ))
                    if "uq_meeting_provider_config_provider" in uniques:
                        conn.execute(text("ALTER TABLE meeting_provider_config DROP INDEX uq_meeting_provider_config_provider"))
                    if "uq_meeting_provider_config_owner_provider" not in uniques:
                        conn.execute(text(
                            "ALTER TABLE meeting_provider_config ADD CONSTRAINT uq_meeting_provider_config_owner_provider "
                            "UNIQUE (owner_user_id, provider)"
                        ))
        except Exception as e:
            print(f"[meeting_provider_config.owner_user_id migration] skipped: {e}")

        # ── SaaS: stamp email_logs with the owning account ──
        try:
            insp = inspect(engine)
            if "email_logs" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("email_logs")}
                if "owner_user_id" not in cols:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE email_logs ADD COLUMN owner_user_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_email_logs_owner_user_id ON email_logs (owner_user_id)"))
                        conn.execute(text(
                            "ALTER TABLE email_logs ADD CONSTRAINT fk_email_logs_owner "
                            "FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL"
                        ))
        except Exception as e:
            print(f"[email_logs.owner_user_id migration] skipped: {e}")

        # The DDL blocks above (ALTER/MODIFY/DELETE on master_data and other
        # tables) ran on separate connections and bumped those tables'
        # definition versions. This long-lived ORM session may still hold a read
        # snapshot taken before them (e.g. from the SiteSetting query above, when
        # nothing was committed), and reading master_data on that stale snapshot
        # raises MySQL 1412 "Table definition has changed, please retry
        # transaction". Rolling back drops the stale snapshot so the next query
        # opens a fresh one against the current schema.
        db.rollback()

        existing_md = db.query(MasterData).count()
        if existing_md == 0:
            seed_md = [
                # HCP Types
                MasterData(type=MasterDataType.hcp_type, label="Surgeon", value="surgeon", sort_order=1),
                MasterData(type=MasterDataType.hcp_type, label="Non-Surgeon Doctor", value="non_surgeon_doctor", sort_order=2),
                MasterData(type=MasterDataType.hcp_type, label="Non-Doctor", value="non_doctor", sort_order=3),
                # Therapeutic areas are deliberately NOT seeded. They are purely
                # user-managed (Account → Categories) because each one carries the
                # supporting keywords the KOL scrape runs on — and a global row
                # cannot be edited by the user who needs to add those keywords.
                # See SEEDED_THERAPEUTIC_AREA_VALUES for the removal of the old ones.
                # Specialties
                MasterData(type=MasterDataType.specialty, label="Cardiology", value="cardiology", sort_order=1),
                MasterData(type=MasterDataType.specialty, label="Neurology", value="neurology", sort_order=2),
                MasterData(type=MasterDataType.specialty, label="Orthopedics", value="orthopedics", sort_order=3),
                MasterData(type=MasterDataType.specialty, label="Oncology", value="oncology", sort_order=4),
                MasterData(type=MasterDataType.specialty, label="Dermatology", value="dermatology", sort_order=5),
                MasterData(type=MasterDataType.specialty, label="Gastroenterology", value="gastroenterology", sort_order=6),
                MasterData(type=MasterDataType.specialty, label="Pulmonology", value="pulmonology", sort_order=7),
                MasterData(type=MasterDataType.specialty, label="Endocrinology", value="endocrinology", sort_order=8),
                MasterData(type=MasterDataType.specialty, label="General Surgery", value="general_surgery", sort_order=9),
                MasterData(type=MasterDataType.specialty, label="Interventional Cardiology", value="interventional_cardiology", sort_order=10),
            ]
            db.add_all(seed_md)
            db.commit()

        # Seed global currencies (user_id NULL = available to all users)
        if db.query(MasterData).filter(MasterData.type == MasterDataType.currency).count() == 0:
            default_currencies = [
                ("US Dollar", "USD"), ("Euro", "EUR"), ("British Pound", "GBP"),
                ("Indian Rupee", "INR"), ("Australian Dollar", "AUD"),
                ("Singapore Dollar", "SGD"), ("Japanese Yen", "JPY"),
            ]
            for idx, (label, value) in enumerate(default_currencies, start=1):
                db.add(MasterData(type=MasterDataType.currency, label=label, value=value, sort_order=idx))
            db.commit()

        # ── Seed advisory service catalog (one-time, mirrors frontend data.js) ──
        from app.models.advisory_service import AdvisoryService, FeeUnit
        from app.models.advisory_board import BoardPhase as _BoardPhase

        if db.query(AdvisoryService).count() == 0:
            _ADVISORY_SERVICE_SEED = [
                # ─── Pre-Meeting ─────────────────────────────────────────
                ("pre_concept_dev", "Advisory Board Concept Development", "Design of meeting objectives, agenda, and participant selection criteria.", "Strategy and planning fee", "pre_meeting", "fixed"),
                ("pre_stakeholder", "Stakeholder Consultation", "Engaging with key internal stakeholders for input.", "Stakeholder management fee", "pre_meeting", "fixed"),
                ("pre_kol_recruitment", "KOL Identification and Recruitment", "Researching and engaging with suitable KOLs.", "KOL identification and invitation fee", "pre_meeting", "per_kol"),
                ("pre_materials", "Pre-Meeting Materials Development", "Developing materials like the agenda, pre-reads, presentations, and briefing documents.", "Content creation fee", "pre_meeting", "fixed"),
                ("pre_invitations", "Invitation & Communication Management", "Sending invites, tracking RSVPs, and coordinating with participants.", "Administrative and logistics fee", "pre_meeting", "fixed"),
                ("pre_logistics", "Logistics Management", "Venue booking, travel and accommodation coordination, and technology setup.", "Event logistics fee", "pre_meeting", "fixed"),
                ("pre_compliance", "Compliance and Regulatory Consultation", "Ensuring the meeting aligns with regulatory guidelines (e.g. fair market value, Sunshine Act, GDPR).", "Compliance consultation fee", "pre_meeting", "fixed"),
                ("pre_kol_contracts", "KOL Contract Management", "Drafting, reviewing, and managing KOL contracts and confidentiality agreements.", "Legal and contract management fee", "pre_meeting", "per_kol"),
                ("pre_briefing", "Pre-Meeting Training/Briefing", "Conducting sessions to prepare KOLs or internal teams for the advisory board.", "Training session fee", "pre_meeting", "hourly"),
                ("pre_risk_mitigation", "Risk Mitigation Strategy", "Identifying and addressing potential risks (e.g. KOL conflicts of interest or participant unavailability).", "Risk assessment and mitigation strategy fee", "pre_meeting", "fixed"),
                ("pre_agenda_tuning", "Agenda Fine-Tuning", "Ongoing revisions and fine-tuning of the agenda based on client or KOL feedback.", "Agenda refinement fee", "pre_meeting", "fixed"),
                ("pre_competency_gap", "Competency Gap Analysis", "Identifying gaps in knowledge or competencies among participants to tailor pre-meeting materials or the agenda.", "Competency gap analysis fee", "pre_meeting", "fixed"),
                ("pre_medical_risk", "Risk Assessment (Medical/Scientific)", "Conducting a medical or scientific risk assessment related to the topics being discussed.", "Medical risk assessment fee", "pre_meeting", "fixed"),
                ("pre_regional_content", "Content Customization for Regional or Global Variations", "Tailoring meeting materials and discussions to account for regional regulations, market conditions, or cultural differences.", "Regional content customization fee", "pre_meeting", "per_region"),
                ("pre_ethics_review", "Ethics Review Preparation", "Preparing any necessary documentation or reports for an ethics review process.", "Ethics review documentation fee", "pre_meeting", "fixed"),
                ("pre_focus_groups", "Pre-Meeting Focus Groups", "Organizing smaller focus groups prior to the advisory board to gather targeted insights.", "Focus group setup and facilitation fee", "pre_meeting", "fixed"),

                # ─── Meeting ────────────────────────────────────────────
                ("mtg_facilitation", "Meeting Facilitation", "Providing moderators, facilitators, or support personnel for smooth meeting execution.", "Facilitation and support fee", "meeting", "per_day"),
                ("mtg_tech_support", "On-Site or Virtual Technical Support", "Ensuring AV setup, web conferencing tools, and other technical needs are met.", "Technical support fee", "meeting", "per_day"),
                ("mtg_moderation", "Meeting Moderation", "Conducting the meeting, ensuring engagement, and facilitating discussion.", "Moderation fee", "meeting", "per_day"),
                ("mtg_mom", "Meeting Documentation (Minutes of Meeting)", "Capturing key discussion points, decisions, and actionable items.", "MoM creation fee", "meeting", "fixed"),
                ("mtg_engagement_tools", "Interactive Engagement Tools", "Setting up digital tools like polling systems, audience response systems, or live Q&A platforms.", "Technology setup and tool management fee", "meeting", "fixed"),
                ("mtg_av_production", "Audio-Visual Production", "Recording the meeting (if approved), video editing, or providing high-quality visuals for presentations.", "AV production and editing fee", "meeting", "fixed"),
                ("mtg_interpretation", "Simultaneous Interpretation Services", "Providing real-time language interpretation for international participants.", "Interpretation services fee", "meeting", "hourly"),
                ("mtg_transcription", "Meeting Transcription", "Providing a full verbatim transcription of the meeting for legal, internal, or compliance use.", "Transcription services fee", "meeting", "hourly"),
                ("mtg_social_listening", "Real-Time Social Listening / Media Monitoring", "Monitoring social media or other digital platforms for real-time feedback or discussions.", "Media monitoring fee", "meeting", "fixed"),
                ("mtg_legal_oversight", "Legal and Regulatory Oversight During Meeting", "Having legal experts on hand during the meeting to ensure compliance.", "On-site legal oversight fee", "meeting", "per_day"),
                ("mtg_engagement_metrics", "Engagement Metrics Monitoring", "Tracking and analyzing real-time engagement metrics during the meeting.", "Engagement metrics analysis fee", "meeting", "fixed"),
                ("mtg_panel_summary", "Expert Panel Summarization", "After KOL discussions, providing real-time summarization and synthesis of complex data or topics.", "Panel summary fee", "meeting", "fixed"),
                ("mtg_clinical_feasibility", "Clinical Trial Discussion and Feasibility Analysis", "Conducting feasibility assessments for clinical trials based on discussions.", "Clinical trial feasibility analysis fee", "meeting", "fixed"),
                ("mtg_content_security", "Content Security", "Ensuring data privacy and security of shared information during the meeting.", "Content security management fee", "meeting", "fixed"),

                # ─── Post-Meeting ───────────────────────────────────────
                ("post_detailed_report", "Detailed Meeting Report", "Comprehensive report with discussion summaries, outcomes, and key insights.", "Report writing fee", "post_meeting", "fixed"),
                ("post_executive_summary", "Executive Summary", "A high-level summary of the meeting for senior management.", "Executive summary creation fee", "post_meeting", "fixed"),
                ("post_surveys", "Post-Meeting Surveys", "Feedback collection from participants for continuous improvement.", "Survey creation and analysis fee", "post_meeting", "fixed"),
                ("post_kol_followup", "KOL Follow-Up", "Continuing engagement with KOLs after the meeting for clarification or further input.", "Follow-up coordination fee", "post_meeting", "per_kol"),
                ("post_data_analysis", "Data Analysis and Insights", "Analysis of data or insights shared during the advisory board for internal use.", "Data analysis fee", "post_meeting", "fixed"),
                ("post_slide_deck", "Slide Deck for Stakeholder Presentation", "Creating a slide deck summarizing the advisory board outcomes for internal teams or management.", "Slide deck creation fee", "post_meeting", "fixed"),
                ("post_compliance_report", "Compliance and Legal Reporting", "Ensuring all documentation complies with industry regulations and requirements.", "Compliance reporting fee", "post_meeting", "fixed"),
                ("post_infographics", "Key Findings Infographics", "Designing infographics or visual summaries of key findings from the meeting.", "Infographic design fee", "post_meeting", "fixed"),
                ("post_kol_feedback", "KOL Feedback Summary Report", "Aggregating and summarizing individual KOL feedback on the meeting's effectiveness.", "Feedback summary fee", "post_meeting", "fixed"),
                ("post_competitor_analysis", "Competitor Analysis Post-Meeting", "Conducting a competitor landscape review based on the insights shared by KOLs.", "Competitor analysis fee", "post_meeting", "fixed"),
                ("post_publication", "Publication or Manuscript Support", "Assisting in writing and submitting a publication or manuscript based on the discussions.", "Publication support fee", "post_meeting", "fixed"),
                ("post_kol_database", "KOL Insights Database Development", "Creating a proprietary database of insights, recommendations, or suggestions from KOLs.", "Database creation and management fee", "post_meeting", "fixed"),
                ("post_marketing_material", "Post-Meeting Marketing Material", "Developing marketing materials, case studies, or newsletters based on the meeting outcomes.", "Marketing collateral creation fee", "post_meeting", "fixed"),
                ("post_strategic_recs", "Strategic Recommendations Report", "A strategic report with detailed recommendations, action items, and next steps.", "Strategic report creation fee", "post_meeting", "fixed"),
                ("post_debriefing", "Stakeholder Debriefing Sessions", "Organizing follow-up debriefing sessions for internal stakeholders.", "Stakeholder debriefing fee", "post_meeting", "hourly"),
                ("post_video_editing", "Video Recording Editing & Summary Clips", "Editing the video recording and creating short, digestible video clips.", "Video editing and summary creation fee", "post_meeting", "fixed"),
                ("post_scenario_planning", "Scenario Planning and Forecasting", "Using the insights from the advisory board to create scenario plans or forecast models.", "Scenario planning fee", "post_meeting", "fixed"),
                ("post_competitive_intel", "Post-Meeting Competitive Intelligence Analysis", "Analyzing competitor products, strategies, or market conditions based on the discussions.", "Competitive intelligence analysis fee", "post_meeting", "fixed"),
                ("post_scientific_writing", "Scientific Writing and Manuscript Development", "Supporting manuscript development if the advisory board focuses on a new scientific discovery.", "Scientific writing fee", "post_meeting", "fixed"),
                ("post_workshops", "Post-Meeting Workshops", "Organizing and facilitating workshops to delve deeper into specific outcomes.", "Workshop facilitation fee", "post_meeting", "per_day"),

                # ─── Ongoing Support ────────────────────────────────────
                ("ong_next_cycle", "Advisory Board Planning for Next Cycle", "Planning and strategy for follow-up or recurring advisory board meetings.", "Strategic planning fee for future boards", "ongoing_support", "fixed"),
                ("ong_kol_relationship", "KOL Relationship Management", "Maintaining relationships with KOLs between meetings for long-term collaboration.", "Relationship management fee", "ongoing_support", "fixed"),
                ("ong_consultancy", "Post-Meeting Consultancy / Recommendations", "Providing consultancy services based on the insights and discussions.", "Consultancy and recommendation fee", "ongoing_support", "hourly"),
                ("ong_benchmarking", "Advisory Board Benchmarking", "Benchmarking the advisory board's outcomes against industry standards or previous meetings.", "Benchmarking and performance review fee", "ongoing_support", "fixed"),
                ("ong_feedback_analytics", "Advisory Board Feedback Analytics", "Advanced analysis of feedback from attendees, including sentiment analysis.", "Feedback analytics fee", "ongoing_support", "fixed"),
                ("ong_influence_mapping", "KOL Influence Mapping", "Mapping the influence and network of KOLs to identify their potential impact on future strategy.", "Influence mapping fee", "ongoing_support", "fixed"),
                ("ong_education", "Post-Meeting Educational Sessions", "Conducting internal educational sessions to implement insights gained.", "Internal training or workshop fee", "ongoing_support", "per_day"),
                ("ong_tailored_followup", "Tailored Follow-Up Engagements", "Organizing follow-up calls or smaller roundtable discussions with specific KOLs.", "Tailored engagement session fee", "ongoing_support", "fixed"),
                ("ong_kol_compliance", "KOL Compliance Monitoring", "Ongoing monitoring of KOL activities to ensure they comply with legal and regulatory frameworks.", "Compliance monitoring fee", "ongoing_support", "fixed"),
                ("ong_data_storage", "Data Management and Storage", "Managing, storing, and securely archiving all advisory board data, documents, and recordings.", "Data storage and management fee", "ongoing_support", "fixed"),
                ("ong_retrospective", "Advisory Board Retrospective Analysis", "Conducting a retrospective review of previous advisory board meetings.", "Retrospective analysis fee", "ongoing_support", "fixed"),
                ("ong_alignment_meetings", "Long-Term Strategic Alignment Meetings", "Offering periodic strategic meetings to ensure ongoing alignment with insights.", "Strategic alignment meeting fee", "ongoing_support", "fixed"),
                ("ong_influence_trend", "KOL Influence Trend Monitoring", "Monitoring the influence of KOLs over time.", "Influence trend monitoring fee", "ongoing_support", "fixed"),
                ("ong_market_opportunity", "Market Opportunity Mapping", "Mapping out new market opportunities based on insights from the discussions.", "Opportunity mapping fee", "ongoing_support", "fixed"),
                ("ong_thought_leadership", "Targeted Thought Leadership Development", "Helping the client build thought leadership content based on key takeaways.", "Thought leadership content creation fee", "ongoing_support", "fixed"),
                ("ong_policy_impact", "Policy Impact Analysis", "Analyzing how policy changes or regulations might impact the business strategies discussed.", "Policy impact analysis fee", "ongoing_support", "fixed"),

                # ─── Event-Specific ─────────────────────────────────────
                ("evt_vip_handling", "VIP Handling for High-Profile KOLs", "Providing special handling and personalized services for high-profile KOLs.", "VIP handling fee", "event_specific", "per_kol"),
                ("evt_event_app", "Interactive Event App Development", "Developing a custom app for the advisory board.", "Event app development fee", "event_specific", "fixed"),
                ("evt_branded_kits", "Custom-Branded Meeting Kits", "Creating personalized meeting kits branded for the advisory board participants.", "Branded kit creation fee", "event_specific", "per_seat"),
                ("evt_data_viz", "Data Visualization Tools", "Providing advanced data visualization tools or dashboards.", "Data visualization fee", "event_specific", "fixed"),
                ("evt_digital_health", "Digital Health Tool Evaluation", "Providing a detailed evaluation of digital health tools or platforms.", "Digital tool evaluation fee", "event_specific", "fixed"),
                ("evt_competitor_bench", "Advisory Board Benchmarking Against Competitors", "Comparing the advisory board's outputs to similar boards held by competitors.", "Competitor benchmarking fee", "event_specific", "fixed"),
                ("evt_multi_country", "Multi-Country / Regional Advisory Board Management", "Managing advisory boards across different regions or countries.", "Multi-country management fee", "event_specific", "per_region"),
                ("evt_360_engagement", "360-Degree Stakeholder Engagement Report", "Offering a comprehensive report on the engagement and feedback from all stakeholders.", "360-degree engagement report fee", "event_specific", "fixed"),
                ("evt_ai_analysis", "Artificial Intelligence (AI)-Assisted Analysis", "Using AI tools to analyze large volumes of data or feedback.", "AI-assisted analysis fee", "event_specific", "fixed"),
            ]

            seeds = []
            for idx, (slug, name, desc, fee_label, phase, unit) in enumerate(_ADVISORY_SERVICE_SEED, start=1):
                seeds.append(AdvisoryService(
                    slug=slug, name=name, description=desc, fee_label=fee_label,
                    phase=phase, default_unit=unit,
                    default_price=0, currency="USD",
                    is_active=True, sort_order=idx,
                ))
            db.add_all(seeds)
            db.commit()

        # kol_tiers gained user_id after first release, and its `code` index was
        # globally unique — which blocks a second account from owning GLOBAL_KOL.
        try:
            insp = inspect(engine)
            if "kol_tiers" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("kol_tiers")}
                with engine.begin() as conn:
                    if "user_id" not in cols:
                        conn.execute(text("ALTER TABLE kol_tiers ADD COLUMN user_id INT NULL"))
                        conn.execute(text("CREATE INDEX ix_kol_tiers_user_id ON kol_tiers (user_id)"))
                        conn.execute(text(
                            "ALTER TABLE kol_tiers ADD CONSTRAINT fk_kol_tiers_user "
                            "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
                        ))
                    for idx in insp.get_indexes("kol_tiers"):
                        if idx.get("unique") and idx.get("column_names") == ["code"]:
                            conn.execute(text(f"ALTER TABLE kol_tiers DROP INDEX `{idx['name']}`"))
        except Exception as exc:
            logger.warning(f"kol_tiers migration skipped: {exc}")

        # Seed KOL tiers. These were hardcoded branches in
        # ScoringEngine.determine_tier; the seed reproduces those exact bands so
        # existing assessments keep their tier, and they are editable afterwards.
        from app.models.kol_tier import KolTier

        if db.query(KolTier).filter(KolTier.user_id.is_(None)).count() == 0:
            db.add_all([
                KolTier(code="GLOBAL_KOL",    name="Global KOL",    min_score=45, max_score=None, color="#7C3AED", sort_order=1, is_standard=True),
                KolTier(code="STRATEGIC_KOL", name="Strategic KOL", min_score=35, max_score=44.99, color="#3A57A7", sort_order=2, is_standard=True),
                KolTier(code="NATIONAL_KOL",  name="National KOL",  min_score=25, max_score=34.99, color="#3E8E8D", sort_order=3, is_standard=True),
                KolTier(code="EMERGING_KOL",  name="Emerging KOL",  min_score=15, max_score=24.99, color="#3EA151", sort_order=4, is_standard=True),
                KolTier(code="LOCAL_KOL",     name="Local KOL",     min_score=5,  max_score=14.99, color="#C77700", sort_order=5, is_standard=True),
                KolTier(code="NON_KOL",       name="Non KOL",       min_score=0,  max_score=4.99,  color="#6B7280", sort_order=6, is_standard=True),
            ])
            db.commit()

        # Seed default assessment parameters
        from app.models.assessment_parameter import AssessmentParameter

        existing_params = db.query(AssessmentParameter).count()
        if existing_params == 0:
            default_params = [
                # Selection Criteria - Qualification
                AssessmentParameter(category="Selection Criteria - Qualification", code="SC_GRADUATION", name="Graduation", description="Relevant graduation degree", max_score=1, sort_order=1),
                AssessmentParameter(category="Selection Criteria - Qualification", code="SC_POST_GRADUATION", name="Post Graduation", description="Post graduation degree", max_score=2, sort_order=2),
                AssessmentParameter(category="Selection Criteria - Qualification", code="SC_FELLOWSHIP", name="Fellowship", description="Fellowship qualification", max_score=2, sort_order=3),
                AssessmentParameter(category="Selection Criteria - Qualification", code="SC_OTHER_QUALIFICATION", name="Any Other Qualification", description="Any other relevant qualification", max_score=1, sort_order=4),
                AssessmentParameter(category="Selection Criteria - Qualification", code="SC_NON_DOCTOR_DEGREE", name="For non-doctors - Any Relevant Degree / Diploma", description="Relevant degree or diploma for non-doctor HCPs", max_score=1, sort_order=5),

                # Selection Criteria - Experience
                AssessmentParameter(category="Selection Criteria - Experience", code="SC_YEARS_EXPERIENCE", name="No. of Years of Experience", description="Less than 5 (1), 5-10 (2), 10-15 (3), 15+ (4)", max_score=2, sort_order=6),

                # Selection Criteria - Surgeons
                AssessmentParameter(category="Selection Criteria - Surgeons", code="SC_SURGERIES_PER_YEAR", name="No. of surgeries / procedures per year", description="Less than 100 (1), 100-200 (2), 200-500 (3), 500+ (4)", max_score=2, sort_order=7),
                AssessmentParameter(category="Selection Criteria - Surgeons", code="SC_SURGICAL_DESCRIPTION", name="Brief Description of surgical procedure undertaken", description="Description of surgical procedures", max_score=1, sort_order=8),
                AssessmentParameter(category="Selection Criteria - Surgeons", code="SC_UNIQUE_EXPERTISE", name="Any Unique Surgical / Clinical Expertise", description="Unique surgical or clinical expertise", max_score=1, sort_order=9),

                # Selection Criteria - Publications
                AssessmentParameter(category="Selection Criteria - Publications", code="SC_PUB_NATIONAL", name="Publication / Presentation - National Level", description="National level publications or presentations", max_score=1, sort_order=10),
                AssessmentParameter(category="Selection Criteria - Publications", code="SC_PUB_INTERNATIONAL", name="Publication / Presentation - International Level", description="International level publications or presentations", max_score=2, sort_order=11),

                # Selection Criteria - Faculty
                AssessmentParameter(category="Selection Criteria - Faculty", code="SC_FACULTY_POSITIONS", name="Faculty Positions", description="Holds faculty positions at academic institutions", max_score=1, sort_order=12),

                # C.1 Leadership
                AssessmentParameter(category="C.1 Leadership", code="C1_BOARD_MEMBER", name="Board member on one or more medical association(s)", description="Physician is a board member on one or more medical association(s)", max_score=1, sort_order=13),
                AssessmentParameter(category="C.1 Leadership", code="C1_ADVISORY_BOARDS", name="Participates regularly in advisory boards (industry sponsored)", description="Physician participates regularly in advisory boards (industry sponsored)", max_score=1, sort_order=14),
                AssessmentParameter(category="C.1 Leadership", code="C1_TOP_INSTITUTION", name="Current affiliation with top institution as Chief or full Professor", description="Current affiliation with top institution in area of specialty as Chief or full Professor at top teaching hospital or Medical College", max_score=2, sort_order=15),
                AssessmentParameter(category="C.1 Leadership", code="C1_SOCIETY_LEADER", name="Past/current leader of a National / International Society/Associations", description="Past/current leader of a National / International Society/Associations", max_score=1, sort_order=16),
                AssessmentParameter(category="C.1 Leadership", code="C1_EXECUTIVE_BOARD", name="Member of executive board or governing body in international committee/society", description="Member in the last 5 years of an executive board or governing body in an international committee/society or professional medical association", max_score=1, sort_order=17),

                # C.2 Presentations
                AssessmentParameter(category="C.2 Presentations", code="C2_1_TO_5_ENGAGEMENTS", name="1 to 5 domestic and/or global speaking engagements (past 5 years)", description="In the past five years, between 1 to 5 domestic and/or global speaking engagements", max_score=2, score_group="C2_SPEAKING", group_max_score=4, sort_order=18),
                AssessmentParameter(category="C.2 Presentations", code="C2_5_TO_10_ENGAGEMENTS", name="5 to 10 domestic and/or global speaking engagements (past 5 years)", description="In the past five years, between 5 to 10 domestic and/or global speaking engagements", max_score=3, score_group="C2_SPEAKING", group_max_score=4, sort_order=19),
                AssessmentParameter(category="C.2 Presentations", code="C2_10_PLUS_ENGAGEMENTS", name="More than 10 domestic and/or global speaking engagements (past 5 years)", description="In the past five years, has completed more than 10 domestic and/or global speaking engagements", max_score=4, score_group="C2_SPEAKING", group_max_score=4, sort_order=20),
                AssessmentParameter(category="C.2 Presentations", code="C2_INTL_SPEAKER", name="5+ speaker engagements at international committee/society (past 5 years)", description="In the past 5 years, has completed 5 or more Speaker/presenter engagements at an international committee/society or international professional medical association", max_score=4, score_group="C2_SPEAKING", group_max_score=4, sort_order=21),

                # C.3 Publications
                AssessmentParameter(category="C.3 Publications", code="C3_1_TO_5_ARTICLES", name="1-5 peer reviewed articles (past 5 years)", description="In past five years, published 1-5 peer reviewed articles", max_score=2, score_group="C3_ARTICLES", group_max_score=3, sort_order=22),
                AssessmentParameter(category="C.3 Publications", code="C3_5_TO_10_ARTICLES", name="5-10 peer reviewed articles or journal editorial board (past 5 years)", description="In past five years, published 5 to 10 peer reviewed articles or participated on 1 journal editorial board or performed systematic reviews", max_score=3, score_group="C3_ARTICLES", group_max_score=3, sort_order=23),
                AssessmentParameter(category="C.3 Publications", code="C3_INTL_PUBLICATION", name="Article in international peer-reviewed journals (past 5 years)", description="In past five years, published at least one article in international peer-reviewed journals or participated in international clinical research/trial or contributed in international product development", max_score=1, score_group="C3_ARTICLES", group_max_score=3, sort_order=24),
                AssessmentParameter(category="C.3 Publications", code="C3_TEXTBOOK_AUTHOR", name="Contributed to a textbook as editor or author", description="Contributed to a textbook as an editor or an author", max_score=1, sort_order=25),

                # C.4 Clinical Experience
                AssessmentParameter(category="C.4 Clinical Experience", code="C4_YEARS_CLINICAL", name="No. of Years of Clinical Experience", description="Years of clinical experience score from Selection Criteria", max_score=3, sort_order=26),
                AssessmentParameter(category="C.4 Clinical Experience", code="C4_PROCEDURES_PER_YEAR", name="No. of surgeries / procedures per year", description="Procedures per year score from Selection Criteria", max_score=0, sort_order=27),
                AssessmentParameter(category="C.4 Clinical Experience", code="C4_UNIQUE_EXPERTISE", name="Unique clinical expertise", description="Has unique clinical expertise", max_score=2, sort_order=28),

                # ── Phase 2/3 Advanced Metrics (C.5–C.9 BONUS, 0-15pts) ──

                # C.5 Citation Velocity (0-3pts)
                AssessmentParameter(category="C.5 Citation Velocity", code="C5_10_PLUS_PUBS_YR", name=">10 publications/year (2024-26)", description="More than 10 publications per year in recent period. Source: PubMed date filter", max_score=3, score_group="C5_PUBS_PER_YEAR", group_max_score=3, sort_order=29),
                AssessmentParameter(category="C.5 Citation Velocity", code="C5_5_TO_10_PUBS_YR", name="5-10 publications/year", description="Between 5 and 10 publications per year. Source: PubMed date filter", max_score=2, score_group="C5_PUBS_PER_YEAR", group_max_score=3, sort_order=30),
                AssessmentParameter(category="C.5 Citation Velocity", code="C5_2_TO_5_PUBS_YR", name="2-5 publications/year", description="Between 2 and 5 publications per year. Source: PubMed date filter", max_score=1, score_group="C5_PUBS_PER_YEAR", group_max_score=3, sort_order=31),

                # C.6 Network Centrality (0-4pts)
                AssessmentParameter(category="C.6 Network Centrality", code="C6_PAGERANK_TOP_10", name="PageRank Top 10%", description="In the top 10% of PageRank scores among co-author network. Source: PubMed co-authors + NetworkX", max_score=1, score_group="C6_NETWORK", group_max_score=2, sort_order=32),
                AssessmentParameter(category="C.6 Network Centrality", code="C6_PAGERANK_TOP_25", name="PageRank Top 25%", description="In the top 25% of PageRank scores among co-author network. Source: PubMed co-authors + NetworkX", max_score=2, score_group="C6_NETWORK", group_max_score=2, sort_order=33),
                AssessmentParameter(category="C.6 Network Centrality", code="C6_COAUTHORS_20_PLUS", name="Co-authors >20", description="Has more than 20 unique co-authors. Source: PubMed co-author count", max_score=2, score_group="C6_NETWORK", group_max_score=2, sort_order=34),

                # C.7 Patient Impact (0-3pts)
                AssessmentParameter(category="C.7 Patient Impact", code="C7_5_PLUS_TRIALS", name="5 or more trials led", description="Led 5 or more clinical trials. Source: ClinicalTrials.gov API", max_score=2, score_group="C7_TRIALS", group_max_score=2, sort_order=35),
                AssessmentParameter(category="C.7 Patient Impact", code="C7_3_TO_4_TRIALS", name="3-4 trials led", description="Led 3 to 4 clinical trials. Source: ClinicalTrials.gov API", max_score=2, score_group="C7_TRIALS", group_max_score=2, sort_order=36),
                AssessmentParameter(category="C.7 Patient Impact", code="C7_1_TO_2_TRIALS", name="1-2 trials led", description="Led 1 to 2 clinical trials. Source: ClinicalTrials.gov API", max_score=1, score_group="C7_TRIALS", group_max_score=2, sort_order=37),

                # C.8 Guideline Authority (0-3pts)
                AssessmentParameter(category="C.8 Guideline Authority", code="C8_INTL_GUIDELINE", name="International guideline author", description="Author of international clinical guidelines. Source: Google Scholar 'guideline' search", max_score=2, score_group="C8_GUIDELINES", group_max_score=2, sort_order=38),
                AssessmentParameter(category="C.8 Guideline Authority", code="C8_NATL_GUIDELINE", name="National guideline author", description="Author of national clinical guidelines or consensus statements. Source: Google Scholar 'consensus' search", max_score=1, score_group="C8_GUIDELINES", group_max_score=2, sort_order=39),

                # C.9 Emerging Leader (0-2pts)
                AssessmentParameter(category="C.9 Emerging Leader", code="C9_PUB_GROWTH_20PCT", name="Publication growth >20%/year", description="Year-over-year publication growth exceeding 20%. Source: PubMed year-over-year analysis", max_score=1, sort_order=40),
                AssessmentParameter(category="C.9 Emerging Leader", code="C9_YOUNG_PROLIFIC", name="Age <45 with significant publications", description="HCP under 45 years old with significant publication record. Source: CV age estimate + publication count", max_score=2, sort_order=41),

                # C.10 Practo Patient Influence (0-4pts bonus)
                AssessmentParameter(category="C.10 Practo Patient Influence", code="PRACTO_REVIEWS_HIGH", name="100+ patient reviews on Practo", description="High patient engagement with 100 or more reviews on Practo. Source: Practo profile", max_score=1, score_group="C10_PRACTO", group_max_score=1, scoring_source="practo", sort_order=42),
                AssessmentParameter(category="C.10 Practo Patient Influence", code="PRACTO_REVIEWS_MODERATE", name="25+ patient reviews on Practo", description="Moderate patient engagement with 25 or more reviews. Source: Practo profile", max_score=1, score_group="C10_PRACTO", group_max_score=1, scoring_source="practo", sort_order=43),
                AssessmentParameter(category="C.10 Practo Patient Influence", code="PRACTO_RATING_HIGH", name="High patient rating on Practo", description="Patient rating of 4.5+ (or 90%+) on Practo. Source: Practo profile", max_score=1, score_group="C10_PRACTO", group_max_score=1, scoring_source="practo", sort_order=44),
                AssessmentParameter(category="C.10 Practo Patient Influence", code="PRACTO_RECOMMENDATIONS", name="50+ recommendations on Practo", description="50 or more patient/peer recommendations on Practo. Source: Practo profile", max_score=1, score_group="C10_PRACTO", group_max_score=1, scoring_source="practo", sort_order=45),
                AssessmentParameter(category="C.10 Practo Patient Influence", code="PRACTO_EXPERIENCE", name="15+ years experience (Practo verified)", description="15 or more years of experience as listed on Practo profile. Source: Practo profile", max_score=1, score_group="C10_PRACTO", group_max_score=1, scoring_source="practo", sort_order=46),
                # Registration / affiliation
                AssessmentParameter(category="Medical registration number", code="MEDICAL_REGISTRATION_NO", name="Medical registration number", description="Has a valid medical registration number", max_score=0, sort_order=47),
                AssessmentParameter(category="Government organisation", code="GOVERNMENT_ORGANISATION", name="Government organisation", description="Is affiliated to a government institution.", max_score=1, sort_order=48),
            ]
            db.add_all(default_params)
            db.commit()
    finally:
        db.close()


@app.get("/")
def root():
    return {"message": "TuraQuant API", "version": settings.VERSION}


@app.get("/health")
def health():
    return {"status": "healthy"}
