"""Regression tests for the zero-AI CV reader.

These pin the rule engine's behaviour — the path taken when an account has
`ai_enabled` off and `hcp.py` / `form_links.py` route the upload to
`cv_rule_extractor` instead of a model. No model, no network, no fixtures on
disk: every case below is a short string that reproduces one real defect found
on a real CV, so the suite runs anywhere in under a second.

Each test names the CV that exposed the bug. Adding a case when a new CV format
breaks something is the point of this file — that is how the engine gets better
at formats nobody has seen yet, without silently losing the ones that work.

Run it directly (no pytest needed):

    ./venv/bin/python tests/test_cv_rule_extractor.py

The function names follow pytest's convention too, so `pytest tests/` picks them
up unchanged if pytest is ever added to requirements.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import cv_rule_extractor as X  # noqa: E402
from app.services.cv_rule_extractor import Entry  # noqa: E402


def entry(*lines, section=None, label=None, number=None):
    """One CV record, spelled the way `_build_entries` would hand it over."""
    return Entry(" ".join(lines), section, label, list(lines), number)


# ── Dates and tense ────────────────────────────────────────────────────────
# A post's tense drives `institution`/`designation` on the form, so reading it
# wrong renames the doctor's employer.

def test_open_end_words_are_not_matched_inside_other_words():
    """CV 5 / CV 9: "now" sits inside "Nowrosjee", "date" inside "Update"."""
    assert X._status_of(
        "Honorary Clinical Associate at the Nowrosjee Wadia Maternity Hospital "
        "since 14th February 2006 to 05th April 2017") == "past"
    assert X._status_of("Consultant, Update Diagnostics, 2015 to 2018") == "past"


def test_written_end_date_beats_an_opening_since():
    """CV 5: "since … to …" is a finished post, not an open-ended one."""
    assert X._status_of("Guest Lecturer, College of Physicians since May 2006 "
                        "to April 2017") == "past"
    assert X._status_of("Consultant at Apollo Hospital since 2018") == "current"


def test_bare_from_with_no_end_is_not_current():
    """CV 5: a page break took the end off "from 3rd November 2002"."""
    assert X._status_of("Fourth Year Resident, Department of Obstetrics at the "
                        "Seth G S Medical College from 3rd November 2002") == ""


def test_till_date_is_still_current():
    assert X._status_of("Professor, AIIMS, 2015 - till date") == "current"
    assert X._status_of("Consultant, Fortis, 2006 - PRESENT") == "current"


def test_written_out_day_is_part_of_the_range():
    """CV 5: the right-hand side used to match the bare "04"."""
    assert X._period("Consultant at the Ashwini Maternity Hospital 1st July 2005 "
                     "to 04 September 2025") == "1st July 2005 to 04 September 2025"


def test_since_a_written_date_reads_as_present():
    assert X._period("Consultant at The Ashwini Pluro Clinic since "
                     "5th September 2025") == "2025-Present"


# ── Institution names ──────────────────────────────────────────────────────

def test_institution_stops_at_a_written_out_date():
    """CV 5: the name kept the day — "…Surgeons 01 June"."""
    assert X._institution_span(
        "Recognized teacher for FCPS course of the College of Physicians and "
        "Surgeons 01 June 2011 to 01 June 2016") == "College of Physicians and Surgeons"


def test_a_month_only_ends_a_name_when_a_figure_follows_it():
    """The date stop must not cut "Mayo Clinic" at "May"."""
    assert X._institution_span("Consultant at Mayo Clinic, Rochester") == "Mayo Clinic"


def test_employer_is_the_one_named_first_on_a_wrapped_line():
    """CV 5: the post was filed under "IVF Center", the tail of the wrap."""
    row = X._parse_faculty(entry(
        "Consultant Obstetrician and Gynaecologist at The Ashwini Pluro Clinic and The Ashwini",
        "Pluro Fertility and IVF Center since 5th September 2025."))
    assert row["institution"] == ("The Ashwini Pluro Clinic and The Ashwini Pluro "
                                  "Fertility and IVF Center")
    assert row["position"] == "Consultant Obstetrician and Gynaecologist"
    assert row["status"] == "current"


def test_first_hospital_of_a_list_wins():
    """CV 5: a list opening with Surya was filed under Zen."""
    row = X._parse_faculty(entry(
        "Consultant Obstetrician and Gynaecologist attached to Surya Hospital (Chembur,",
        "Santacruz), Zen Hospital (Chembur), Zynova Hospital (Ghatkopar)"))
    assert row["institution"] == "Surya Hospital"


# ── Job titles ─────────────────────────────────────────────────────────────

def test_title_reads_from_its_first_word_not_its_longest():
    """CV 5: `_first_word` returned "Gynaecologist" — the tail of the title."""
    assert X._leading_title(
        "Consultant Obstetrician and Gynaecologist attached to Surya Hospital"
    ) == "Consultant Obstetrician and Gynaecologist"
    assert X._leading_title(
        "Honorary Clinical Associate at the Nowrosjee Wadia Maternity Hospital"
    ) == "Honorary Clinical Associate"


def test_a_wrapped_place_is_trimmed_off_the_title():
    """CV 5: "…Gynaecology at the Seth G S" — the employer's first words."""
    row = X._parse_faculty(entry(
        "Senior Registrar, Department of Obstetrics and Gynaecology at the Seth G S",
        "Medical College and King Edward VII Memorial Hospital from 7th August 2001 to 31st"))
    assert row["position"] == "Senior Registrar, Department of Obstetrics and Gynaecology"


# ── Qualifications ─────────────────────────────────────────────────────────
# `pg_qualification_year` is what the endpoint subtracts to get years of
# experience, so a stray degree here moves the figure on the form.

def test_intermediate_exams_are_not_qualifications():
    """CV 5: First/Second MBBS dated the career from 1993 instead of 1996."""
    assert X._parse_education(entry(
        "Passed First MBBS with Distinction in Human Physiology, Nov. 1993")) is None
    assert X._parse_education(entry(
        "Passed Second MBBS with Distinctions in Microbiology, April 1995")) is None
    final = X._parse_education(entry(
        "Passed Final MBBS with Distinctions in Ob-Gyn, Oct. 1996"))
    assert final["degree"] == "MBBS" and final["year"] == "1996"


def test_author_initials_are_not_degrees():
    """CV 5: "Eds: Hansotia MD" and "Ms Jyotsana Khare" became MD/MS rows."""
    assert "education" not in X._content_scores(
        "Tank JD, Desai A, Tank PD. Oocyte and Embryo Donation. In: Advanced "
        "Infertility Management. Eds: Hansotia MD, Desai SK. New Delhi, 2002, pp 293-298")
    assert "education" not in X._content_scores(
        "Preventing Mother to Child Transmission of HIV at the 28th MOGS "
        "Conference, 2000, Mumbai. Coauthors: Dr K R Damania, Ms Jyotsana Khare")


def test_a_society_named_fellow_is_not_a_fellowship():
    """CV 5: "Association of Fellow Gynecologists" scored as a qualification."""
    scores = X._content_scores("Vaginal Infections at the Gynaecon 2010 organized "
                               "by the Association of Fellow Gynecologists (AFG) 2010")
    assert scores.get("education", 0) < scores.get("presentations", 0)


def test_pg_year_is_the_first_postgraduate_degree():
    education = [
        {"level": "ug", "year": "1996"},
        {"level": "pg", "year": "2001"},
        {"level": "extra", "year": "2017"},
    ]
    assert X._pg_year(education) == 2001


# ── Publications ───────────────────────────────────────────────────────────

def test_byline_is_not_the_title_and_the_journal_comes_off_the_citation():
    """CV 5: 26 of 41 papers had the author list as the title."""
    row = X.parse_rows("publications", "Tank PD, Salvi VS. Liver failure in "
                                       "pregnancy. J Obstet Gynecol India 2002;76:27-31")[0]
    assert row["title"] == "Liver failure in pregnancy"
    assert row["journal"] == "J Obstet Gynecol India"
    assert row["year"] == "2002"


def test_a_doi_is_not_a_journal_name():
    """CV 11: the citation's tail must not pose as the journal."""
    row = X.parse_rows("publications", "Sharma A, Rao B. Uterine artery embolisation. "
                                       "doi: 10.1002/jcu.22919. Epub 2020 Sep 14.")[0]
    assert "doi" not in (row["journal"] or "").lower()


# ── Office-bearer posts and books ──────────────────────────────────────────

def test_the_organisers_committee_is_not_a_post_held():
    """CV 5: 16 lectures became office-bearer rows via their organiser."""
    scores = X._content_scores(
        "Panelist for Discussion on Antenatal Care at the Masterclass 2016 organized "
        "by the Chandrapur Obstetrics and Gynecological Society under the aegis of "
        "FOGSI Safe Motherhood Committee on 27th March 2016")
    assert "office" not in scores


def test_a_real_office_bearer_post_still_scores():
    scores = X._content_scores("Chairperson, Safe Motherhood Committee of the "
                               "Federation of Obstetric and Gynaecological Societies "
                               "of India (FOGSI) for 2014 to 2017")
    assert scores.get("office", 0) >= 3


def test_a_bare_committee_is_not_an_office():
    assert X._parse_office(entry("Committee of the Vadodara Obstetrics and "
                                 "Gynaecological Society on 5th July 2015")) == []


def test_a_society_chapter_is_not_a_book_chapter():
    """CV 5: "…Mumbai Chapter" put lectures in the textbooks table."""
    scores = X._content_scores(
        "The Hot Flush at the conference on Menopause organized by the Mumbai "
        "Obstetrics and Gynaecological Society and Indian Menopause Society (IMS) "
        "- Mumbai Chapter on 24th November 2002")
    assert "books" not in scores


# ── Text layer artefacts ───────────────────────────────────────────────────

def test_an_inline_page_number_does_not_weld_two_list_items_together():
    """CV 5: "35 * Federation of…" glued one society onto the one above it."""
    lines = X._normalize_lines("* Mumbai Obstetrics and Gynaecological Society\n"
                               "35 * Federation of Obstetrics and Gynaecological "
                               "Societies of India\n")
    assert lines[1].startswith("* Federation")


def test_coauthors_are_not_the_meeting():
    """CV 5: the "with whom" column named a co-author."""
    row = X._parse_presentation(entry(
        "Preventing Mother to Child Transmission of HIV at the 28th MOGS Conference, "
        "2000, Mumbai. Coauthors: Dr K R Damania, Ms Jyotsana Khare"))
    assert "Damania" not in row["with_whom"]
    assert "Jyotsana" not in row["with_whom"]


# ── Whole-document behaviour ───────────────────────────────────────────────

def test_a_masked_cv_invents_nothing():
    """The samples have name, e-mail, phone and DOB removed. Leave them empty."""
    result = X.extract_fields(
        "MD DNBE FCPS DGO\n"
        "Residence:\n601, Sunflower, Ghatkopar, Mumbai - 400077\n"
        "Tel: , Mob:\nEmail:\n"
        "Date of Birth:\n"
        "Current Professional Position\n"
        "* Consultant Obstetrician at The Ashwini Pluro Clinic since 5th September 2025.\n")
    assert result["full_name"] is None
    assert result["email"] is None
    assert result["mobile"] is None
    assert result["city"] == "Mumbai"


def test_current_professional_position_heading_is_read():
    """CV 5: the heading was unknown, so its posts inherited "personal"."""
    result = X.extract_fields(
        "Current Professional Position\n"
        "* Consultant Obstetrician and Gynaecologist at The Ashwini Pluro Clinic "
        "since 5th September 2025.\n")
    assert result["institution"] == "The Ashwini Pluro Clinic"
    assert result["designation"] == "Consultant Obstetrician and Gynaecologist"


def test_years_of_experience_is_left_for_the_endpoint():
    """The rules return the PG year; `hcp.py` does the subtraction."""
    result = X.extract_fields("Qualifications\nMD (Obstetrics and Gynaecology), "
                              "University of Mumbai, March 2001\n")
    assert result["years_of_experience"] is None
    assert result["pg_qualification_year"] == 2001


def test_the_endpoint_turns_that_year_into_experience():
    from app.api.endpoints.hcp import _years_since_pg
    assert _years_since_pg({"pg_qualification_year": 2001}) == date.today().year - 2001
    # A misread year is dropped rather than published as a nonsense figure.
    assert _years_since_pg({"pg_qualification_year": 1849}) is None
    assert _years_since_pg({"pg_qualification_year": date.today().year + 5}) is None
    assert _years_since_pg({"pg_qualification_year": None}) is None


def main() -> int:
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    failed = []
    for name, fn in tests:
        try:
            fn()
            print(f"  ok    {name}")
        except AssertionError as exc:
            failed.append(name)
            print(f"  FAIL  {name}  {exc}")
        except Exception as exc:  # noqa: BLE001 - report, do not mask
            failed.append(name)
            print(f"  ERROR {name}  {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - len(failed)}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
