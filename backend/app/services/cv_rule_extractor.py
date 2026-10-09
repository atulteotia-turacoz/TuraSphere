"""Rule-based CV field extraction — the same form fields, no LLM.

Used when an account has AI turned off. `/hcp/extract-cv-fields` previously
refused outright in that case and left the user to retype an eleven-page CV by
hand; this module fills the same fields by reading the document's own structure,
so nothing leaves the system and the same CV always produces the same form.

How it works, and why it is built this way:

1. The text is normalised (ligatures, dashes, running page headers) and cut into
   *entries* — one logical record each: a degree, a job, a paper, a talk.
2. Every entry is then classified **by its own content**, with the section
   heading it fell under acting only as a tie-breaker. That ordering is
   deliberate: PDF text layers routinely emit a sidebar heading *after* the block
   it labels (one sample CV lists four degrees and only then prints "ACADEMIC
   PROFILE"), so trusting headings first mis-files whole sections.
3. Each category has its own parser producing exactly the columns the form
   renders, so the response is drop-in identical in shape to the AI path's.

Nothing here guesses: a field the rules cannot read stays empty for the user to
fill, which is the honest failure mode for a form they are about to review.
"""
import re
from datetime import date
from typing import Dict, List, Optional, Tuple

# ── Text normalisation ─────────────────────────────────────────────────────

# PDF text layers emit typographic ligatures and dashes that break every
# keyword and date-range regex below ("quali<ligature>cation", "2015 – 2020").
_TRANSLATIONS = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "–": "-", "—": "-", "‒": "-", "−": "-", "‐": "-", "‑": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"', " ": " ",
    "•": "*", "▪": "*", "●": "*", "❖": "*", "❯": "*",
    "‣": "*", "·": "*", "⁃": "*", "■": "*", "♦": "*",
}

# Modern CV templates letter-space their headings ("E D U C A T I O N") and the
# name at the top. The PDF text layer preserves that spacing literally, so every
# heading and the name were invisible to matching until they are put back
# together. Words inside such a line are separated by two or more spaces.
LETTERSPACED_RE = re.compile(r"^(?:\S(?:\s\S)*)(?:\s{2,}\S(?:\s\S)*)*$")


def _unspace(line: str) -> str:
    """Rejoin a letter-spaced line, or return it unchanged."""
    stripped = line.strip()
    tokens = [t for t in stripped.split(" ") if t]
    if len(tokens) < 4 or not LETTERSPACED_RE.match(stripped):
        return line
    # Two or more spaces separate words; one space separates letters.
    return " ".join(word.replace(" ", "") for word in re.split(r"\s{2,}", stripped))


# Kerning pairs come out of a PDF as a space inside the word ("T raining",
# "V enereology"). Only a capital is safe to rejoin — "A" and "I" are words in
# their own right ("A cross-sectional study" must not become "Across-...").
KERNING_RE = re.compile(r"(?<![A-Za-z])([B-HJ-Z])\s+([a-z]{2,})")
# "A" and "I" are words in their own right, so the same repair cannot be applied
# blindly — "A cross-sectional study" must not become "Across-sectional". Join
# only when the document uses the joined word somewhere else ("A ward" alongside
# the "AWARDS" heading), which is evidence the split is an artefact.
AMBIGUOUS_KERNING_RE = re.compile(r"(?<![A-Za-z])([AI])\s+([a-z]{2,})")
# The same artefact around punctuation, which breaks emails and ID numbers:
# "aarav .mehta@x.com", "DMC-TEST -458921".
TIGHTEN_RE = re.compile(r"(\w)\s+([.\-/@])(?=[^\s])")
# "201 1" is a split year, and a year that does not parse is a year the rubric
# cannot score. Three digits then one is unambiguous — "2010 1" cannot match.
SPLIT_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d)\s+(\d)(?!\d)")

# A reference list that reflowed into one paragraph still numbers its entries,
# and those numbers are the only record boundary left in it.
INLINE_NUMBERING_RE = re.compile(r"(?<=[.)\]])\s+(\d{1,2})\.\s+(?=[A-Z])")
DATE_OPENER_RE = re.compile(r"\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d"
                            r"|\s*(?:19|20)\d{2}(?![\d-])", re.I)

BULLET_RE = re.compile(r"^\s*(?:[*\-–>+»]+|\d{1,3}\s*[.)\]]|[a-zA-Z]\s*[.)\]]|\([a-zA-Z0-9]{1,3}\))\s+")
YEAR_RE = re.compile(r"(?<!\d)(19[4-9]\d|20[0-4]\d)(?!\d)")
# "08/2016 - 02/2022", "2015-2020", "2018 - Till date", "since 2020", "2022-24"
OPEN_END = r"(?:till\s*date|to\s*date|present|date|ongoing|onwards?|current(?:ly)?|now|contin\w*)"
# Searched on its own, OPEN_END has to be whole words: "now" sits inside
# "Nowrosjee" and "date" inside "candidate", and either one read a post that
# plainly ended in 2017 as still held.
OPEN_END_RE = re.compile(r"(?<![A-Za-z])" + OPEN_END + r"(?![A-Za-z])", re.I)
MONTH = (r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+")
# Indian CVs write the day out in full — "1st July 2005 to 04 September 2025".
# Without the day, the right-hand side of that range matched the bare "04" and
# the form showed "July 2005 to 04" as the period.
_DAY = r"(?:\d{1,2}(?:st|nd|rd|th)?\s+)?"
_SIDE = _DAY + r"(?:" + MONTH + r")?(?:\d{1,2}[/.])?(?:19|20)\d{2}"
DATE_RANGE_RE = re.compile(
    r"(" + _SIDE + r")\s*(?:-|to|until|till|through)\s*"
    r"(" + _SIDE + r"|\d{2}|" + OPEN_END + r")",
    re.I,
)
MONTH_TAIL_RE = re.compile(r"[\s,;-]*(?:" + MONTH.rstrip("\\s+") + r")\s*$", re.I)
SINCE_RE = re.compile(r"\b(?:since|from|w\.e\.f\.?|with effect from)\s+"
                      r"(?:\w+\s+){0,2}((?:19|20)\d{2})", re.I)
# "since 2006" says the post is still held; a bare "from 2006" is half a range
# whose end the page break took off, and must not be read as still current.
OPEN_START_RE = re.compile(r"\b(?:since|w\.e\.f\.?|with effect from)\s+"
                           r"(?:\w+\s+){0,2}((?:19|20)\d{2})", re.I)
PAGE_NOISE_RE = re.compile(r"^\s*(?:page\s*)?\d{1,3}\s*(?:of\s*\d{1,3})?\s*$", re.I)
# A page number that landed on the same line as the item beneath it: "35 *
# Federation of…", "12 52. Tambe P…". Left in place it welds two list items
# together, so the society above swallowed the one below it.
INLINE_PAGE_RE = re.compile(r"^\s*\d{1,3}\s+(?=[*\-–>+»]\s|\d{1,3}\.\s)")


def _normalize_lines(raw: str) -> List[str]:
    """Flatten the raw text into clean single-spaced lines, noise removed."""
    for src, dst in _TRANSLATIONS.items():
        raw = raw.replace(src, dst)
    # Order matters: un-spacing reads the double spaces that mark word breaks,
    # so it has to run before runs of whitespace are collapsed.
    lines = [_unspace(ln.replace("\t", " ")) for ln in raw.splitlines()]
    lines = [INLINE_PAGE_RE.sub("", re.sub(r"[ ​]+", " ", ln).strip()) for ln in lines]
    lines = [SPLIT_YEAR_RE.sub(r"\1\2", TIGHTEN_RE.sub(r"\1\2", KERNING_RE.sub(r"\1\2", ln)))
             for ln in lines]
    vocabulary = {w.lower() for w in re.findall(r"[A-Za-z]{3,}", " ".join(lines))}

    def rejoin(match: re.Match) -> str:
        joined = (match.group(1) + match.group(2)).lower()
        return match.group(1) + match.group(2) if any(
            word.startswith(joined) for word in vocabulary
        ) else match.group(0)

    lines = [AMBIGUOUS_KERNING_RE.sub(rejoin, ln) for ln in lines]
    # "M. D. (OB-GYN)" and "M.B.B.S" name the same degrees; only the second form
    # survives a keyword match, so close the gaps between dotted initials first.
    lines = [re.sub(r"(?<![A-Za-z])([A-Za-z])\.\s+(?=[A-Za-z]\.)", r"\1.", ln) for ln in lines]

    # A running header ("MBBS, MD (DVL)") repeats on every page of a PDF and
    # would otherwise be read as an education entry once per page. What makes it
    # a header rather than content is the *spacing*: page furniture reappears a
    # page apart, whereas "Department of Dermatology" repeats every few lines
    # because it belongs to each of four consecutive posts — and dropping that
    # broke the block it sat in away from its employer.
    positions: Dict[str, List[int]] = {}
    for index, ln in enumerate(lines):
        if ln and len(ln) <= 70:
            positions.setdefault(ln, []).append(index)
    repeated = {
        ln for ln, spots in positions.items()
        if len(spots) >= 3
        and min(b - a for a, b in zip(spots, spots[1:])) >= 12
    }

    return [
        "" if (not ln or ln in repeated or PAGE_NOISE_RE.match(ln)) else ln
        for ln in lines
    ]


# ── Sections ───────────────────────────────────────────────────────────────

# Longest keywords first inside each group: "teaching experience" must win over
# the bare "experience" that follows it, or every heading collapses to one kind.
SECTION_KEYWORDS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("advisory", ("advisory board", "advisory committee", "advisory", "expert panel",
                  "expert committee", "consultancy", "key opinion")),
    ("books", ("books and chapters", "book chapters", "textbook", "text book", "chapters authored",
               "chapters", "monograph", "editorial work", "books", "book", "editorship")),
    ("publications", ("paper publications", "research publications", "journal publications",
                      "original research", "research articles", "research papers",
                      "publications in journals", "publication", "publications",
                      "articles published", "papers published", "articles", "papers",
                      "peer reviewed")),
    ("presentations", ("research and presentation", "guest lectures", "invited lectures",
                       "invited talks", "papers presented", "scientific presentations",
                       "lectures delivered", "conferences attended", "conferences",
                       "presentations", "presentation", "guest lecture", "orations",
                       "oration", "speaker", "talks", "workshops", "workshop",
                       "cme", "symposia", "webinars")),
    ("office", ("posts in associations", "organisational work", "organizational work",
                "office bearer", "office bearers", "positions in associations",
                "society positions", "organisational positions", "administrative positions",
                "committees", "organisational activities", "professional positions",
                "posts held")),
    ("memberships", ("professional memberships", "professional bodies", "professional societies",
                     "society memberships", "memberships", "membership", "societies",
                     "professional affiliations", "affiliations")),
    ("awards", ("awards and recognitions", "awards", "award", "prizes", "prize",
                "honours", "honors", "recognitions", "achievements", "accolades",
                "medals", "distinctions")),
    ("education", ("academic qualifications", "educational qualifications",
                   "professional qualifications", "academic qualification",
                   "educational qualification", "academic profile", "qualifications",
                   "qualification", "education", "academics", "academic record",
                   "degrees")),
    ("experience", ("current professional position", "present professional position",
                    "present appointment", "present designation", "current appointment",
                    "current position", "previous positions", "previous appointments",
                    "professional experience", "teaching experience", "clinical experience",
                    "work experiences", "work experience", "work profile", "employment",
                    "career", "positions held", "appointments", "experience",
                    "academic positions", "professional career", "training")),
    ("interests", ("areas of special interest", "areas of interest", "area of interest",
                   "special interest", "clinical interests", "research interests",
                   "field of interest", "interests")),
    ("registration", ("medical registrations", "medical registration", "council registration",
                      "registration number", "registration no", "registration", "license",
                      "licence")),
    ("personal", ("personal data", "personal details", "personal information",
                  "personal profile", "contact details", "curriculum vitae",
                  "bio data", "biodata", "profile")),
    ("specialty", ("speciality", "specialty")),
)

# Labels that appear inline mid-line in table-style CVs ("Specialty: Paediatrics
# Areas of Special Interest: Asthma") and must be split apart before anything
# else reads the line.
INLINE_LABELS = (
    "residential address", "areas of special interest", "areas of interest",
    "area of interest", "present designation", "present appointment",
    "previous positions", "date of birth", "medical registration",
    "professional memberships", "work experience", "qualification", "qualifications",
    "specialty", "speciality", "publications", "presentations", "designation",
    "institution", "education", "address", "mobile", "phone", "email", "e-mail",
    "name", "clinic", "dob", "awards", "memberships", "experience",
)
INLINE_LABEL_RE = re.compile(
    r"(?<![A-Za-z])(" + "|".join(re.escape(l) for l in INLINE_LABELS) + r")\s*:\s*",
    re.I,
)
# A label belonging to somebody else. "Father's Name : ..." matched the plain
# "name" label and put a relative in the HCP's name field.
RELATION_RE = re.compile(r"(?:father|mother|spouse|husband|wife|guardian|parent|"
                         r"referee|reference|emergency contact)(?:'s|s')?\s*$", re.I)

# Labels that fix a position's tense on their own, whatever the dates say.
CURRENT_LABELS = ("present designation", "present appointment", "current appointment",
                  "current position", "current professional position",
                  "present professional position")
PAST_LABELS = ("previous positions", "previous appointments")


def _heading_section(line: str) -> Optional[Tuple[str, str]]:
    """Return (section, keyword) for a heading line, or None if it is content."""
    text = line.strip().strip("*").strip()
    text = re.sub(r"^[^A-Za-z]+", "", text)
    text = text.rstrip(":").strip()
    if not text or len(text) > 60 or len(text.split()) > 7:
        return None
    # A heading looks like one: shouty, colon-terminated, or a short noun phrase
    # with no sentence punctuation and no dates.
    shouty = text.isupper()
    if not shouty and not line.rstrip().endswith(":") and len(text.split()) > 4:
        return None
    if YEAR_RE.search(text) or "," in text:
        return None
    low = text.lower()
    for section, keywords in SECTION_KEYWORDS:
        for keyword in keywords:
            if low == keyword or low.startswith(keyword) or low.endswith(keyword):
                return section, keyword
    return None


def _split_inline_labels(line: str) -> List[Tuple[Optional[str], str]]:
    """Break "Specialty: X Areas of Interest: Y" into (label, value) pieces."""
    matches = list(INLINE_LABEL_RE.finditer(line))
    if not matches:
        return [(None, line)]
    pieces: List[Tuple[Optional[str], str]] = []
    if matches[0].start() > 0:
        head = line[: matches[0].start()].strip()
        if head:
            pieces.append((None, head))
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(line)
        value = line[match.end():end].strip()
        if RELATION_RE.search(line[max(0, match.start() - 24):match.start()]):
            pieces.append((None, line[match.start():end].strip()))
            continue
        pieces.append((match.group(1).lower(), value))
    return pieces


class Entry:
    """One logical record from the CV, with the section it was found under."""

    __slots__ = ("text", "section", "label", "lines", "number")

    def __init__(self, text: str, section: Optional[str], label: Optional[str],
                 lines: List[str], number: Optional[int] = None):
        self.text = text
        self.section = section
        self.label = label
        self.lines = lines
        # The "7." of a numbered list, when the entry opened one. Runs of these
        # are what `_vote_runs` uses to keep a long list under one heading.
        self.number = number

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"Entry({self.section}/{self.label}: {self.text[:60]!r})"


def _build_entries(lines: List[str]) -> Tuple[List[Entry], Dict[str, List[str]], List[str]]:
    """Cut the document into entries, and collect the labelled one-liners.

    Returns (entries, label_values, all_lines_used). `label_values` keeps the
    raw text of every inline label ("email", "date of birth", ...) so the scalar
    field readers do not have to re-scan the document.
    """
    entries: List[Entry] = []
    labels: Dict[str, List[str]] = {}
    section: Optional[str] = None
    label: Optional[str] = None
    buffer: List[str] = []
    number: Optional[int] = None

    def flush():
        nonlocal buffer, label, number
        text = " ".join(part.strip() for part in buffer if part.strip()).strip()
        if text:
            entries.append(Entry(text, section, label, list(buffer), number))
        buffer = []
        number = None

    for raw_line in lines:
        if not raw_line:
            flush()
            continue

        heading = _heading_section(raw_line)
        if heading:
            flush()
            section, keyword = heading
            # "PRESENT APPOINTMENT" / "PREVIOUS POSITIONS" date the block they
            # head, which is often the only tense a CV gives those posts.
            label = keyword if keyword in CURRENT_LABELS + PAST_LABELS else None
            continue

        pieces = _split_inline_labels(raw_line)
        for piece_label, value in pieces:
            # "…115-121. 2. Mehta A, Kapoor S. Assessment…" — a reference list
            # that reflowed into a paragraph still numbers its entries, and the
            # numbers are the only record boundary left.
            value = INLINE_NUMBERING_RE.sub(r"\n\1. ", value)
            if piece_label:
                flush()
                label = piece_label
                labels.setdefault(piece_label, []).append(value)
                mapped = _heading_section(piece_label + ":")
                if mapped:
                    section = mapped[0]
                if not value:
                    continue
            if not value:
                continue
            for fragment in value.split("\n"):
                fragment = fragment.strip()
                if not fragment:
                    continue
                # A bullet or a number always starts a new record; so does a
                # line that follows one already closed by its own date range.
                marker = BULLET_RE.match(fragment)
                # "- January 2026 Presentation: ..." is the tail of the line
                # above, not a new bullet: a list item never opens with a date.
                if marker and DATE_OPENER_RE.match(fragment[marker.end():]):
                    marker = None
                # Two-line templates print the employer above the post and the
                # college above the degree, so a lone institution line opens the
                # record that follows it rather than standing on its own.
                heads_next = (_starts_record(fragment) and len(buffer) == 1
                              and _is_bare_institution(buffer[0]))
                # One dated, dash-separated header per record. Modern templates
                # write "<Meeting> - <City> - <Month Year>" and wrap it over two
                # lines, so nothing else marks where the next one begins.
                dated_header = (bool(re.search(r"\s-\s", fragment)) and YEAR_RE.search(fragment)
                                and any(YEAR_RE.search(part) for part in buffer))
                if buffer and not heads_next and (
                    marker or dated_header or _starts_record(fragment)
                    or (_ends_record(buffer[-1]) and not _is_continuation(fragment, buffer))):
                    flush()
                if marker and not buffer:
                    digits = re.search(r"\d{1,3}", marker.group(0))
                    number = int(digits.group(0)) if digits else None
                buffer.append(BULLET_RE.sub("", fragment, count=1))

    flush()
    return entries, labels, [ln for ln in lines if ln]


RECORD_OPENERS = re.compile(
    r"^\s*(?:M\.?B\.?B\.?S|M\.?D\.?S|M\.?D|M\.?S|M\.?Ch|D\.?N\.?B|D\.?M|Ph\.?D|M\.?Sc"
    r"|B\.?D\.?S|B\.?Sc|D\.?G\.?O|D\.?C\.?H|MRCP|MRCOG|FRCS|PGPN"
    r"|Bachelor of|Doctor of|Master of|Diploma|Certificate|Fellowship|Post\s?Graduate)"
    r"(?![A-Za-z])",
    re.I,
)


def _starts_record(line: str) -> bool:
    """True when a line can only be the first line of a new record.

    A degree name or a job title in the left-hand column starts the next entry
    even when the previous one carried no dates to close it — without this, the
    five degrees of a table-style qualifications block merge into one row and
    the postgraduate year is read off the wrong line.
    """
    if RECORD_OPENERS.match(line):
        return True
    head = line[:60]
    return any(_word_re(word).match(head.strip()) for word in POSITION_WORDS + OFFICE_WORDS)


def _is_bare_institution(line: str) -> bool:
    """A line naming only a place — no degree, no job title, no dates."""
    return (_has_any(line, INSTITUTION_WORDS)
            and not DEGREE_RE.search(line)
            and not _has_word(line, POSITION_WORDS)
            and not YEAR_RE.search(line))


def _is_continuation(line: str, buffer: Optional[List[str]] = None) -> bool:
    """A line that can only be the tail of the record above it.

    Table-style CVs put the degree and its year on one line and the awarding
    college on the next ("MBBS in December 1979" / "University College of
    Medical Sciences"). The year closes the first line, but the college is not a
    record of its own — carrying no date and naming an institution is the tell.
    """
    if _starts_record(line) or YEAR_RE.search(line):
        return False
    # One record names one employer. A second institution line is the next
    # record — in templates that print the college *above* its degree, absorbing
    # it dated every qualification to the wrong school.
    if buffer and any(_has_any(part, INSTITUTION_WORDS) for part in buffer):
        return False
    return _has_any(line, INSTITUTION_WORDS) and len(line) < 120


def _ends_record(line: str) -> bool:
    """True when a line closes its record — a trailing date range or period.

    Career blocks in PDFs run "Assistant Professor / Department of Dermatology /
    <College> 08/2016 - 02/2022", three lines for one post. The dates are what
    mark the end, so the next line safely starts the next post.
    """
    tail = line.rstrip().rstrip(".").rstrip()
    if not tail:
        return False
    last = tail[-30:]
    return bool(DATE_RANGE_RE.search(last) or re.search(r"(?<!\d)(19|20)\d{2}\s*$", tail)
                or re.search(OPEN_END + r"\s*$", tail, re.I))


# ── Lexicons ───────────────────────────────────────────────────────────────

PG_DEGREES = ("md", "ms", "dnb", "dm", "mch", "m.d", "m.s", "d.n.b", "d.m", "m.ch",
              "mds", "m.d.s", "doctor of medicine", "master of surgery", "postgraduate degree")
UG_DEGREES = ("mbbs", "m.b.b.s", "bds", "b.d.s", "bams", "bhms", "bpt", "bsc", "b.sc",
              "bachelor of medicine")
DEGREE_RE = re.compile(
    r"(?<![A-Za-z])(M\.?B\.?B\.?S|B\.?D\.?S|B\.?A\.?M\.?S|B\.?H\.?M\.?S|B\.?P\.?T|B\.?Sc"
    r"|M\.?D\.?S|M\.?D|M\.?S(?![a-z])|D\.?N\.?B|D\.?M(?![a-z])|M\.?Ch|Ph\.?D|M\.?Sc"
    r"|D\.?G\.?O|D\.?C\.?H|D\.?L\.?O|D\.?O\.?M\.?S|M\.?B\.?A|M\.?H\.?A|M\.?P\.?H"
    r"|MRCP(?:CH)?|MRCS|MRCOG|MRCEM|FRCS|FRCP|FRCOG|FRCR|FACS|FACP|FACC|FAMS|FCPS"
    r"|FICOG|FICMCH|FICS|FICP"
    r"|Bachelor of Medicine|Doctor of Medicine|Master of Surgery"
    r"|Fellowship|Fellow|Diploma|Certificate|PGPN|PGPCC)\b",
    re.I,
)
INSTITUTION_WORDS = ("college", "hospital", "institute", "institution", "university",
                     "school", "academy", "centre", "center", "clinic", "foundation",
                     "trust", "nursing home", "medical sciences", "infirmary", "aiims",
                     "jipmer", "pgimer", "kgmu", "nimhans", "cmc", "sgpgi")
POSITION_WORDS = ("professor and hod", "professor & hod", "associate professor",
                  "assistant professor", "senior consultant", "chief consultant",
                  "consultant", "professor", "additional professor", "lecturer", "reader",
                  "tutor", "senior resident", "junior resident", "resident", "registrar",
                  "head of department", "head of the department", "head, department",
                  "hod", "director", "dean", "principal", "medical officer",
                  "casualty medical officer", "specialist", "attending",
                  "unit head", "in-charge", "incharge", "visiting faculty",
                  "honorary", "hon.", "scientist", "research officer",
                  "post graduate teacher", "pg teacher", "teacher", "trainer",
                  "examiner", "fellow", "surgeon", "physician", "gynaecologist",
                  "gynecologist", "obstetrician", "founder", "proprietor")
OFFICE_WORDS = ("organising joint secretary", "organizing joint secretary",
                "organising secretary", "organizing secretary", "scientific secretary",
                "joint secretary", "general secretary", "hon. secretary", "secretary",
                "vice chairperson", "vice chairman", "vice president", "vice-president",
                "president", "chairperson", "chairman", "treasurer", "patron",
                "governing council member", "governing council", "executive committee",
                "executive board", "council member", "committee member", "board member",
                "committee", "convener", "convenor", "coordinator", "course director",
                "editor-in-chief", "website editor", "co editor", "co-editor", "editor",
                "peer reviewer", "reviewer", "zonal", "chair", "office bearer",
                "cell", "zone coordinator", "south zone", "liason", "liaison",
                "broadcast member", "faculty member", "governing body")
SOCIETY_WORDS = ("association", "society", "academy", "federation", "council", "college of",
                 "chapter", "forum", "board", "committee", "organisation", "organization",
                 "iadvl", "ima", "iap", "fogsi", "icog", "csi", "nnf", "ims", "acsi",
                 "cdsi", "sodc", "ashrs", "eadv", "dasil", "aaam", "isoparb", "rcog",
                 "amogs", "espghan", "pogs", "muhs")
CONFERENCE_RE = re.compile(
    r"\b([A-Z][A-Za-z]{2,}CON(?:\s*\d{2,4})?|[A-Z]{2,}\s?CON\b|\w*CONGRESS\b|"
    r"CONFERENCE|SYMPOSIUM|SUMMIT|MASTERCLASS|MASTER CLASS|WORKSHOP|CME|MEET\b|"
    r"CONCLAVE|WEBINAR|COURSE)\b",
    re.I,
)
JOURNAL_CUE_RE = re.compile(
    r"\b(?:International |Indian |Asian |African |European |American |British |Global |World |"
    r"Open |National |Saudi |Japanese |Chinese )?"
    r"(?:Journals?|J\.|Jour\.|Annals|Ann\.|Archives|Arch\.|Bulletin|Review of|Reviews|"
    r"Proceedings|Lancet|BMJ|NEJM|JAMA|Cureus|PLoS|Springer|Elsevier|Wiley|"
    r"GJMEDPH|JPTCP|Afr\.?J|Int\.? ?J|Am\.? ?J|Ind\.? ?J|Br\.? ?J|Eur\.? ?J)\b"
    # A journal club is a teaching activity, not a journal.
    r"(?!\s+clubs?\b)",
    re.I,
)
CITATION_RE = re.compile(r"(?:\b(?:19|20)\d{2}\s*[;:]\s*\d+|\d+\s*\(\s*\d+\s*\)\s*[:;]\s*\d+"
                         r"|\bvol\.?\s*\d+|\bissue\s*\d+|\bpp?\.\s*\d+|\bdoi\b|\bpages\b"
                         r"|\bet\s+al\b|\bpublished in\b|\bindexed\b)", re.I)
# Wording that only ever appears in a reference or an abstract's by-line. The
# degrees inside one are other people's initials — "Eds: Hansotia MD, Desai SK"
# was filing three book chapters as this doctor's own MD.
CITATION_CONTEXT_RE = re.compile(r"\b(?:eds?\.?\s*:|editors?\s*:|in\s*:|co-?authors?\s*:"
                                 r"|pp\.?\s*\d|et\s+al\b)", re.I)
# A reference opens with its authors — "Damania KR, Tank PD. HIV Infection…".
# Fifty book chapters written that way name FOGSI somewhere in the book's title,
# and were being read as fifty memberships of it.
# The initials are undotted — "Tank PD." — so "Seth G.S. Medical College" is a
# place, not a by-line.
AUTHOR_LIST_RE = re.compile(r"^\s*(?:\d{1,3}\.\s*)?[A-Z][A-Za-z'\-]{2,}\s+[A-Z]{1,3}(?![.A-Za-z])\s*[,.]")
# The body that ran a meeting is named after the meeting, never before it, so a
# "Committee"/"Chapter" downstream of "organised by" belongs to the organiser.
ORGANISER_CUE_RE = re.compile(r"\b(?:organi[sz]ed by|conducted by|hosted by|arranged by"
                              r"|under the aegis of|in association with|at the|during the)\b",
                              re.I)
PRESENTATION_WORDS = ("presented", "presentation", "poster", "guest lecture", "invited talk",
                      "invited lecture", "oration", "panelist", "panellist", "moderator",
                      "chairperson in", "chaired", "delivered", "speaker", "faculty for",
                      "faculty at", "live demonstration", "demonstration", "hands on",
                      "handson", "workshop", "masterclass", "session", "lecture", "talk",
                      "keynote", "plenary", "webinar", "read paper")
BOOK_WORDS = ("textbook", "text book", "year book", "yearbook", "book chapter", "chapters",
              "chapter", "monograph", "manual", "edited book", "edited books", "co editor",
              "co-editor", "editor of", "authored the book", "book")
AWARD_WORDS = ("award", "prize", "gold medal", "medalist", "medallist", "best paper",
               "recipient", "honoured", "honored", "citation", "won ", "winner",
               "distinction", "rank holder", "felicitat", "first place", "first prize")
MEMBER_WORDS = ("life member", "member -", "member of", "member", "fellow of", "fellowship of",
                "associate member", "affiliate")
ADVISORY_WORDS = ("advisory board", "advisory committee", "medical advisory", "advisor to",
                  "adviser to", "expert panel", "expert committee", "consultancy",
                  "key opinion leader", "scientific advisory")
GOVERNMENT_WORDS = ("government", "govt", "municipal corporation", "aiims", "jipmer",
                    "pgimer", "kgmu", "nimhans", "sgpgi", "civil hospital",
                    "district hospital", "esi ", "employees state insurance", "railway",
                    "army", "military", "armed forces", "icmr", "ministry",
                    "medical council", "public health foundation", "unfpa", "who ",
                    "state ", "national institute", "central government")
INTERNATIONAL_HINTS = ("international", "global", "world", "european", "american",
                       "asian", "asia pacific", "asia-pacific", "african", "british",
                       "royal college", "saudi", "japanese", "chinese", "esc", "acc ",
                       "aha", "asco", "ers ", "who", "eadv", "aad ", "espghan", "rcog",
                       "mrcog", "ifaas", "dasil", "aaam", "abroad", "overseas", "usa",
                       "united states", "united kingdom", "prague", "glasgow", "spain",
                       "london", "paris", "dubai", "singapore", "germany", "italy")
NATIONAL_HINTS = ("indian", "india", "national", "state ", "zone", "zonal", "chapter",
                  "tamilnadu", "tamil nadu", "kerala", "maharashtra", "karnataka",
                  "of india", "iap", "ima", "iadvl", "fogsi", "icog", "csi", "nnf",
                  "apollo", "aiims", "kgmu", "pedicon", "cuticon", "dermacon",
                  "acsicon", "aicog", "amogs", "muhs", "pogs")
INDIAN_CITIES = (
    "mumbai", "delhi", "new delhi", "bangalore", "bengaluru", "hyderabad", "chennai",
    "kolkata", "pune", "ahmedabad", "surat", "jaipur", "lucknow", "kanpur", "nagpur",
    "indore", "thane", "bhopal", "visakhapatnam", "patna", "vadodara", "ghaziabad",
    "ludhiana", "agra", "nashik", "faridabad", "meerut", "rajkot", "varanasi",
    "srinagar", "aurangabad", "dhanbad", "amritsar", "allahabad", "prayagraj",
    "ranchi", "howrah", "coimbatore", "jabalpur", "gwalior", "vijayawada", "jodhpur",
    "madurai", "raipur", "kota", "chandigarh", "guwahati", "solapur", "hubli",
    "mysore", "mysuru", "tiruchirappalli", "trichy", "bareilly", "aligarh", "moradabad",
    "gurgaon", "gurugram", "noida", "jalandhar", "bhubaneswar", "salem", "warangal",
    "guntur", "bhiwandi", "saharanpur", "gorakhpur", "bikaner", "amravati", "cuttack",
    "firozabad", "kochi", "cochin", "ernakulam", "nellore", "bhavnagar", "dehradun",
    "durgapur", "asansol", "rourkela", "nanded", "kolhapur", "ajmer", "akola",
    "jamnagar", "ujjain", "siliguri", "jhansi", "jammu", "mangalore", "erode",
    "belgaum", "ambattur", "tirunelveli", "malegaon", "gaya", "udaipur", "maheshtala",
    "tirupati", "davanagere", "kozhikode", "calicut", "thiruvananthapuram", "trivandrum",
    "thrissur", "kollam", "pondicherry", "puducherry", "manipal", "vellore", "kovilpatti",
    "theni", "jalgaon", "merrut", "kulasekaram", "perinthalmanna", "mahabalipuram", "goa",
    "shimla", "patiala", "rohtak", "karnal", "hisar", "panipat", "sonipat", "haldwani",
)


# ── Small shared helpers ───────────────────────────────────────────────────

def _has_any(text: str, words) -> bool:
    low = text.lower()
    return any(w in low for w in words)


def _word_re(word: str) -> re.Pattern:
    """Whole-phrase matcher, cached — plain substring tests are not safe here.

    "President" contains "resident" and "Head of Department" contains "MD", so a
    naive `in` check filed every society presidency as a hospital job.
    """
    cached = _WORD_RE_CACHE.get(word)
    if cached is None:
        cached = re.compile(r"(?<![A-Za-z])" + re.sub(r"\\?\s+", r"\\s+", re.escape(word)) + r"(?![A-Za-z])", re.I)
        _WORD_RE_CACHE[word] = cached
    return cached


_WORD_RE_CACHE: Dict[str, re.Pattern] = {}


def _has_word(text: str, words) -> bool:
    return any(_word_re(w).search(text) for w in words)


def _first_word(text: str, words) -> str:
    """Longest phrase in `words` that occurs in `text`, as the CV spelled it."""
    best = ""
    for word in words:
        match = _word_re(word).search(text)
        if match and len(match.group(0)) > len(best):
            best = match.group(0)
    return best


def _word_pos(text: str, words) -> int:
    """Where the earliest of `words` occurs in `text`, or -1 if none does."""
    best = -1
    for word in words:
        match = _word_re(word).search(text)
        if match and (best < 0 or match.start() < best):
            best = match.start()
    return best


def _first_match(text: str, words) -> str:
    """Longest-first lookup — POSITION_WORDS/OFFICE_WORDS are ordered that way."""
    low = text.lower()
    for word in words:
        idx = low.find(word)
        if idx != -1:
            return text[idx:idx + len(word)]
    return ""


def _years(text: str) -> List[int]:
    return [int(y) for y in YEAR_RE.findall(text)]


def _period(text: str) -> str:
    """The date range exactly as written, for the form's 'years' column."""
    match = DATE_RANGE_RE.search(text)
    if match:
        return re.sub(r"\s+", " ", match.group(0)).strip()
    since = OPEN_START_RE.search(text)
    if since:
        return f"{since.group(1)}-Present"
    found = YEAR_RE.findall(text)
    return found[-1] if found else ""


PAST_TENSE_RE = re.compile(r"^\s*(?:was|were|worked|formerly|ex[-\s]|erstwhile|previously|"
                           r"served|retired)\b", re.I)


def _status_of(text: str) -> str:
    low = text.lower()
    # A CV that opens the line with "Was ..." has said the post is over, even
    # though the "since 2015" further along reads as open-ended.
    if PAST_TENSE_RE.match(text):
        return "past"
    if OPEN_END_RE.search(low):
        return "current"
    # A written end date settles it before "since" does: "since February 2006 to
    # April 2017" is a finished post, however open-ended its opening words read.
    match = DATE_RANGE_RE.search(text)
    if match:
        end = match.group(2)
        end_years = YEAR_RE.findall(end) or YEAR_RE.findall(match.group(0))
        if not end_years:
            return ""
        today = date.today()
        end_year = int(end_years[-1])
        month = re.match(r"(\d{1,2})[/.]", end)
        # "08/2025 - 01/2026" has already finished even though 2026 is this year,
        # so read the month when the CV gives one.
        if end_year > today.year or (end_year == today.year and
                                     (not month or int(month.group(1)) >= today.month)):
            return "current"
        return "past"
    return "current" if OPEN_START_RE.search(low) else ""


def _scope_of(text: str) -> str:
    """national | international | '' from the wording of a journal or meeting.

    National wins on a tie: an "Indian Journal of ..." is the organ of one
    country however international-sounding the rest of the title, and the
    scoring rubric pays for genuine international reach only.
    """
    low = " " + text.lower() + " "

    def hit(hints) -> bool:
        # Short hints are society acronyms and must match whole words: "ESC" is
        # otherwise found inside "Dermescon", making a state meeting European.
        return any(
            (re.search(r"(?<![a-z])" + re.escape(h.strip()) + r"(?![a-z])", low) if len(h.strip()) <= 5
             else h in low)
            for h in hints
        )

    national = hit(NATIONAL_HINTS)
    international = hit(INTERNATIONAL_HINTS)
    if national and not international:
        return "national"
    if international and not national:
        return "international"
    if national and international:
        # "International Journal of ... India" — the leading word decides.
        for hint in INTERNATIONAL_HINTS:
            if low.strip().startswith(hint.strip()):
                return "international"
        return "national"
    return ""


def _clean(text: str, limit: int = 300) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = text.strip(" ,;:-*.")
    return text[:limit].strip()


TRAILING_HEADING_RE = re.compile(r"(?:\s+[A-Z]{3,}){2,}\s*$")


def _strip_heading(text: str) -> str:
    """Drop a page heading the PDF printed at the end of a content line."""
    return _clean(TRAILING_HEADING_RE.sub("", text), 200)


def _strip_quotes(text: str) -> str:
    return _clean(text.strip().strip('"').strip("'"), 400)


def _dedupe(values: List[str]) -> List[str]:
    seen, out = set(), []
    for value in values:
        key = re.sub(r"[^a-z0-9]", "", value.lower())
        if key and key not in seen:
            seen.add(key)
            out.append(value)
    return out


# ── Entry classification ───────────────────────────────────────────────────

# Content beats section, but only just: a strong content signal scores 4-6 and
# the section it was found under adds 2. That lets a clearly-worded publication
# filed under "Presentations" land correctly, while an ambiguous one-liner
# still follows its heading.
SECTION_PRIOR = 2

# Sections whose content belongs in one field, never in a repeatable table.
SCALAR_SECTIONS = ("registration", "personal", "specialty")
# Sections that concatenate into one text box. A false positive costs a clause;
# a miss loses the whole field, so their own heading is evidence enough.
TEXT_SECTIONS = ("memberships", "awards", "interests")


def _content_scores(text: str) -> Dict[str, int]:
    low = text.lower()
    scores: Dict[str, int] = {}
    years = _years(text)
    has_range = bool(DATE_RANGE_RE.search(text) or SINCE_RE.search(text))

    degree = DEGREE_RE.search(text)
    if degree and not CITATION_CONTEXT_RE.search(text):
        scores["education"] = 3
        if years:
            scores["education"] += 2
        if _has_any(low, ("university", "college", "school of medicine", "institute")):
            scores["education"] += 1
        # A fellowship or diploma line is still education, but a "Fellow of the
        # Royal College" with no year is a membership claim.
        if degree.group(1).lower().startswith(("fellow", "f.")) and not years:
            scores["education"] -= 3
        # "Association of Fellow Gynecologists" is a society's name. A degree
        # names what follows it only through "of"/"in"; a capital straight after
        # it means the word is part of somebody else's title.
        if (degree.group(1).lower().startswith("fellow")
                and re.match(r"\s+[A-Z]", text[degree.end():])):
            scores["education"] -= 4

    if _has_word(text, POSITION_WORDS):
        scores["experience"] = 3
        if RECORD_OPENERS.match(text):
            scores["experience"] -= 3
        if _has_any(low, INSTITUTION_WORDS):
            scores["experience"] += 2
        elif years and not has_range:
            # A single date and no employer: "Fellow Gynaecologists on 24th July
            # 2011" is a fragment of a meeting's name, not a post. Only the
            # heading it sits under can make a record of it. An undated line
            # keeps its score — "Sr Consultant Ob-Gyn, Pune" is a real post.
            scores["experience"] -= 1
        if has_range:
            scores["experience"] += 2

    if _has_word(text, OFFICE_WORDS):
        scores["office"] = 3
        if _has_any(low, SOCIETY_WORDS):
            scores["office"] += 3
        if years:
            scores["office"] += 1

    if JOURNAL_CUE_RE.search(text):
        scores["publications"] = 4
    if CITATION_RE.search(text):
        scores["publications"] = scores.get("publications", 0) + 3

    if _has_word(text, PRESENTATION_WORDS):
        scores["presentations"] = 3
    if CONFERENCE_RE.search(text):
        scores["presentations"] = scores.get("presentations", 0) + 2

    if _has_word(text, BOOK_WORDS):
        scores["books"] = 4
        if _has_any(low, ("edited", "editor", "authored", "chapter")):
            scores["books"] += 2

    if _has_word(text, AWARD_WORDS):
        scores["awards"] = 4

    if _has_word(text, ADVISORY_WORDS):
        # Decisive: "Advisory Board Member" also reads as a society "board
        # member", and the two tables are scored differently.
        scores["advisory"] = 8

    if _has_word(text, MEMBER_WORDS) or (
        _has_any(low, SOCIETY_WORDS) and not scores and len(text) < 200
        and not AUTHOR_LIST_RE.match(text) and not CITATION_CONTEXT_RE.search(text)
    ):
        scores["memberships"] = 3

    # A talk names the committee that convened the meeting and the society
    # chapter that hosted it. Neither is a post this person held or a book they
    # wrote — and both were filling the office-bearer and textbook tables with
    # rows lifted out of a lecture list.
    if CONFERENCE_RE.search(text):
        cue = ORGANISER_CUE_RE.search(text)
        for kind, words in (("office", OFFICE_WORDS), ("books", BOOK_WORDS)):
            if scores.get(kind) and cue and cue.start() < _word_pos(text, words):
                scores.pop(kind)

    # Disambiguation the raw counts get wrong on their own.
    if scores.get("books") and scores.get("office"):
        # "Co-Editor of <book>" is a book, "Website Editor, FOGSI" is an office.
        scores["office"] -= 3 if _has_any(low, ("book", "manual", "chapter")) else 0
    if scores.get("publications") and scores.get("presentations"):
        if _has_any(low, ("presented", "poster", "oration", "lecture", "panelist", "delivered")):
            scores["publications"] -= 2
        else:
            scores["presentations"] -= 2
    if scores.get("experience") and scores.get("office") and _has_any(low, INSTITUTION_WORDS):
        # A hospital post outranks the word "director" reading as a society office.
        scores["office"] -= 2
    return scores


def _vote_runs(entries: List[Entry], kinds: List[Optional[str]]) -> List[Optional[str]]:
    """Make every item of a numbered list agree with the list it belongs to.

    A CV that numbers forty guest lectures 1..40 has already told us they are
    one section; classifying each line alone then files the terse ones ("PRP vs
    PRF vs GFC in hairloss, FADS, Goa 2023") wherever their few keywords point.
    An unbroken 1,2,3… run is unambiguous evidence, so the run's majority wins.
    """
    numbered = [i for i, entry in enumerate(entries) if entry.number is not None]
    position = 0
    while position < len(numbered):
        run = [numbered[position]]
        while (position + 1 < len(numbered)
               and entries[numbered[position + 1]].number == entries[numbered[position]].number + 1):
            position += 1
            run.append(numbered[position])
        position += 1
        # Unnumbered strays between items do not break the run: a page heading
        # or a wrapped address interrupts the text, not the list.
        if len(run) < 4:
            continue
        tally: Dict[str, int] = {}
        for i in run:
            if kinds[i]:
                tally[kinds[i]] = tally.get(kinds[i], 0) + 1
        if not tally:
            continue
        winner, votes = max(tally.items(), key=lambda kv: kv[1])
        if votes * 2 > len(run):
            for i in run:
                kinds[i] = winner
    return kinds


def _classify(entry: Entry) -> Optional[str]:
    scores = _content_scores(entry.text)
    if entry.section:
        agreed = scores.get(entry.section, 0) > 0
        scores[entry.section] = scores.get(entry.section, 0) + SECTION_PRIOR
        # Heading and wording agreeing is far stronger evidence than either
        # alone: a line under "Prizes" that names a prize is an award, whatever
        # committee or society it also mentions on the way.
        if agreed:
            scores[entry.section] += SECTION_PRIOR
    if entry.label in CURRENT_LABELS or entry.label in PAST_LABELS:
        scores["experience"] = scores.get("experience", 0) + SECTION_PRIOR
    if not scores:
        return None
    best = max(scores.items(), key=lambda kv: kv[1])
    # "Delhi Medical Council Registration Number: ..." names a council, which is
    # enough to read as a membership. Sections that only ever fill a single text
    # box need a strong content signal before they contribute a row at all.
    floor = 3
    if entry.section in SCALAR_SECTIONS:
        floor = 4
    elif entry.section in TEXT_SECTIONS:
        floor = 2
    elif (entry.section and best[0] == entry.section
          and (entry.number is not None or AUTHOR_LIST_RE.match(entry.text))
          and (YEAR_RE.search(entry.text) or len(entry.text) >= 60)):
        # Filed under a heading, numbered as one item of that heading's list,
        # and nothing in the wording pulls elsewhere: the heading is the best
        # evidence there is. Fifty book chapters listed under "Chapters" say
        # nothing about themselves beyond their citation, and the plain floor
        # dropped every one of them. A bare bullet is not enough — that is how
        # "English (Fluent)" under a skills heading becomes a conference talk —
        # and neither is a two-word line with no date.
        floor = SECTION_PRIOR
    return best[0] if best[1] >= floor else None


# ── Row parsers, one per form section ──────────────────────────────────────

DEGREE_CANON = (
    (r"\bM\.?B\.?B\.?S\b", "MBBS"), (r"\bM\.?D\.?S\b", "MDS"),
    (r"\bM\.?Ch\b", "MCh"), (r"\bD\.?N\.?B\b", "DNB"),
    (r"\bM\.?D\b", "MD"), (r"\bM\.?S\b", "MS"), (r"\bD\.?M\b", "DM"),
    (r"\bPh\.?D\b", "PhD"), (r"\bM\.?Sc\b", "MSc"), (r"\bB\.?D\.?S\b", "BDS"),
    (r"\bD\.?G\.?O\b", "DGO"), (r"\bD\.?C\.?H\b", "DCH"),
)


# "Passed First MBBS with Distinction in Human Physiology, Nov. 1993" dates a
# university exam on the way to the degree, not the degree. Reading all three as
# qualifications put an MBBS in 1993, 1995 and 1996 on the form — and dated the
# person's whole career from the first of them.
INTERMEDIATE_EXAM_RE = re.compile(
    r"\b(?:first|second|third|1st|2nd|3rd|pre[\s-]?final|part\s*[i1]{1,3})\s+"
    r"(?:year\s+|prof(?:essional)?\s+)?(?:M\.?B\.?B\.?S|B\.?D\.?S)\b", re.I)


def _parse_education(entry: Entry) -> Optional[Dict[str, str]]:
    text = _clean(entry.text, 400)
    if not text or INTERMEDIATE_EXAM_RE.search(text):
        return None
    degree = ""
    for pattern, canonical in DEGREE_CANON:
        if re.search(pattern, text, re.I):
            degree = canonical
            break
    if not degree:
        match = DEGREE_RE.search(text)
        degree = match.group(1) if match else ""
    # Keep the speciality parenthetical — "MD (DVL)" is what the form shows.
    qualifier = re.search(re.escape(degree) + r"\.?\s*\(([^)]{2,40})\)", text, re.I) if degree else None
    if qualifier:
        degree = f"{degree} ({qualifier.group(1).strip()})"

    institution = _institution_span(text)

    years = _years(text)
    match = DATE_RANGE_RE.search(text)
    if match:
        end_years = _years(match.group(2)) or _years(match.group(0))
        year = str(end_years[-1]) if end_years else ""
    else:
        # The year that follows the degree, not the largest in the entry: a line
        # naming a degree and a later award year must still date the degree.
        anchor = DEGREE_RE.search(text)
        after = YEAR_RE.search(text, anchor.end()) if anchor else None
        year = after.group(1) if after else (str(years[0]) if years else "")

    level = "other"
    low = text.lower()
    if any(word in low for word in ("diploma", "certificate", "fellowship", "fellow",
                                    "foundation course", "mini ", "short course",
                                    "training programme", "observership")):
        level = "extra"
    elif any(re.search(r"\b" + re.escape(d).replace(r"\.", r"\.?") + r"\b", low) for d in PG_DEGREES):
        level = "pg"
    elif any(d in low for d in UG_DEGREES):
        level = "ug"

    return {
        "degree": degree or _clean(text, 60),
        "institution": institution,
        "year": year,
        "level": level,
        "start_year": str(min(years)) if years else "",
        "text": text,
    }


# A department is a place inside an institution, never the front half of its
# name, so it can never supply the words a line break took off.
DEPARTMENT_RE = re.compile(r"^\s*(?:dept\.?|department|division|unit|faculty|section)\b", re.I)
INSTITUTION_WORD_RE = re.compile(
    r"(?<![A-Za-z])(" + "|".join(re.escape(w) for w in INSTITUTION_WORDS) + r")(?![A-Za-z])", re.I)
# Where an institution's name stops on the right: the dates that follow it.
INSTITUTION_STOP_RE = re.compile(
    r"[,;(]|(?<![A-Za-z])(?:since|from|till|until|during|w\.e\.f)(?![A-Za-z])"
    r"|(?<![A-Za-z])(?:MBBS|MDS|MCh|DNB|MSc|BDS|DGO|DCH|PhD|MD|MS|DM)(?![A-Za-z])"
    # A written-out date ends the name as surely as a bare year does, and
    # "…College of Physicians and Surgeons 01 June 2011" was keeping the day.
    # The month has to be followed by a figure, or "Mayo Clinic" stops at "May".
    r"|(?<!\d)\d{1,2}(?:st|nd|rd|th)?\s+(?:" + MONTH.rstrip("\\s+") + r")"
    r"|(?<![A-Za-z])(?:" + MONTH + r")\d"
    r"|(?<!\d)(?:\d{1,2}\s*[/.]\s*)?(?:19|20)\d{2}",
    re.I)


def _institution_span(text: str) -> str:
    """The institution's name alone, pulled out of the sentence around it.

    Written once and shared by the degree and career parsers: both bury the
    employer mid-sentence ("MD in Paediatrics in March 1984 Maulana Azad Medical
    College, Delhi University"), and both were dragging the surrounding prose,
    the dates and the street address into the form's Institution box.

    The name is grown outwards from the keyword that identifies it — leftwards
    over capitalised words only, since that is exactly where a proper noun ends
    and the sentence resumes, and rightwards to the first comma or date.
    """
    body = _clean(text, 300)
    match = INSTITUTION_WORD_RE.search(body)
    if not match:
        return ""

    left = body[: match.start()]
    start = match.start()
    while True:
        word = re.search(r"(?:^|[\s(,])([A-Z][\w&'.\-]*)\s*$", left)
        if not word:
            break
        start = word.start(1)
        left = left[: word.start(1)]

    tail = body[match.end():]
    stop = INSTITUTION_STOP_RE.search(tail)
    end = match.end() + (stop.start() if stop else len(tail))
    span = _clean(body[start:end], 140)
    # PDF sidebars print their heading into the text layer right after the block
    # they label, leaving "...Medical College ACADEMIC PROFILE" on one line.
    span = _strip_heading(span)
    # A trailing "and"/"of" is what is left when the stop landed mid-phrase.
    return _clean(re.sub(r"\s+(?:and|of|the|in|at)$", "", span, flags=re.I), 140)


# Where a job title ends and the employer's address begins.
TITLE_STOP_RE = re.compile(r"[,;(]|(?<![A-Za-z])(?:at|in|attached to|from|since|with|for the)"
                           r"(?![A-Za-z])", re.I)
# A wrapped line leaves the employer's first words hanging off the job title
# ("Senior Registrar, Department of … at the Seth G S"). The name is read off
# the line below, so the fragment is noise wherever it lands.
DANGLING_PLACE_RE = re.compile(r"[,;]?\s+(?:at|in)\s+the\s+\S+(?:\s+\S+){0,3}\s*$", re.I)


def _leading_title(text: str) -> str:
    """The job title as the CV spelled it, from the first title word onwards.

    `_first_word` returns the *longest* keyword, which on "Consultant
    Obstetrician and Gynaecologist attached to Surya Hospital" is
    "Gynaecologist" — the tail of the title rather than the title.
    """
    start = _word_pos(text, POSITION_WORDS)
    if start < 0:
        return ""
    tail = text[start:]
    stop = TITLE_STOP_RE.search(tail, 1)
    title = _clean(tail[: stop.start()] if stop else tail, 70)
    # Still carrying the employer means the stop landed too late; the single
    # keyword is the safer answer then. Whole words only — "Clinical Associate"
    # is a job, and a substring test reads "clinic" inside it.
    if not title or _has_word(title, INSTITUTION_WORDS):
        return _clean(_first_word(text, POSITION_WORDS), 70)
    return title


def _parse_faculty(entry: Entry) -> Optional[Dict[str, str]]:
    text = _clean(entry.text, 400)
    if not text:
        return None

    position, institution = "", ""
    institution_line = -1
    # A multi-line block writes the post, the department and the employer on
    # their own lines — that layout is more reliable than any comma-splitting.
    if len(entry.lines) > 1:
        for position_in_entry, line in enumerate(entry.lines):
            body = _clean(DATE_RANGE_RE.sub("", line), 200)
            if not body:
                continue
            if not position and _has_word(body, POSITION_WORDS) and not _has_any(body, INSTITUTION_WORDS):
                position = _clean(body, 110)
            elif not institution and _has_any(body, INSTITUTION_WORDS) and not _has_word(body, POSITION_WORDS):
                institution = _institution_span(body)
                institution_line = position_in_entry
                # OCR breaks "G.D. Hospital and Diabetes Institute" across two
                # lines; reading this line alone loses the "G.D." that ended the
                # one above, so re-read the whole entry when the name starts the
                # line and take the longer form of the same name.
                if institution and body.lower().startswith(institution.lower()) and position_in_entry:
                    joined = _institution_span(text)
                    prefix = _clean(joined[: len(joined) - len(institution)], 40)
                    above = _clean(entry.lines[position_in_entry - 1], 200)
                    # Accept the longer form only when the missing words are
                    # literally what the line above ended with — a break splits
                    # "G.D." off its hospital. Everything else that can end the
                    # line above belongs to the person, not the employer: a
                    # qualification ("…Founder and MD" -> "MD Aesthetiq Clinic"),
                    # a job title, or the department they work in.
                    if (prefix and joined.lower().endswith(institution.lower())
                            and above.lower().endswith(prefix.lower())
                            and not DEGREE_RE.fullmatch(prefix)
                            and not _has_word(prefix, POSITION_WORDS)
                            and not re.fullmatch(r"(?:" + MONTH + r"|" + OPEN_END + r")\s*",
                                                 prefix + " ", re.I)
                            and not DEPARTMENT_RE.match(above)):
                        institution = joined

    # The employer is the one the entry names first. Skipping every line that
    # carries a job title as well ("Consultant … at The Ashwini Pluro Clinic and
    # The Ashwini" / "Pluro Fertility and IVF Center since 2025") left the post
    # filed under the *second* hospital on the wrap — "IVF Center", or "Zen
    # Hospital" out of a list that opened with Surya.
    if institution_line > 0:
        for index, line in enumerate(entry.lines[:institution_line]):
            if not _has_any(line, INSTITUTION_WORDS):
                continue
            # Read on from that line, not just it: the name is what wrapped in
            # the first place, and stopping at the break keeps "…Pluro Clinic
            # and The Ashwini" hanging off the end of it.
            rest = " ".join(entry.lines[index:])
            earlier = _institution_span(_clean(DATE_RANGE_RE.sub("", rest), 400))
            if earlier:
                institution = earlier
            break

    if not position or not institution:
        # One-liner: "Consultant at Acadis Hospital since 2018 till present".
        segments = [seg for seg in re.split(r"\s*[,;:]\s*|\bat\b|\bin\b|\|| - ", text) if _clean(seg)]
        leading = []
        for segment in segments:
            if _has_any(segment, INSTITUTION_WORDS):
                institution = institution or _institution_span(text)
                break
            leading.append(_clean(segment, 60))
        if not position and leading and _has_word(" ".join(leading), POSITION_WORDS):
            position = _clean(", ".join(leading), 110)
        # Anything carrying a date, or longer than a job title plausibly is, has
        # swept up the sentence around the title — keep just the title.
        if not position or len(position) > 70 or YEAR_RE.search(position):
            position = _leading_title(text) or position

    if not institution:
        for line in entry.lines:
            body = _clean(DATE_RANGE_RE.sub("", line), 200)
            if body and body.lower() != position.lower() and len(body) > 6:
                institution = _institution_span(body)
                break

    status = _status_of(text)
    if entry.label in CURRENT_LABELS:
        status = "current"
    elif entry.label in PAST_LABELS and not status:
        status = "past"

    position = _clean(MONTH_TAIL_RE.sub("", position), 110)
    # The post and the employer came off different lines, so a place trailing
    # the title is the wrap, not part of the job.
    if position and institution and institution.lower() not in position.lower():
        position = _clean(DANGLING_PLACE_RE.sub("", position), 110) or position
    if not position and not institution:
        return None
    # A summary paragraph mentions the person's title in passing. Without an
    # employer, a block that long is prose, not a post.
    if not institution and len(text) > 180:
        return None
    return {"institution": institution, "position": position,
            "status": status, "years": _period(text)}


def _parse_publication(entry: Entry) -> Optional[Dict[str, str]]:
    raw = entry.text
    text = _clean(entry.text, 500)
    if not text:
        return None
    journal = ""
    cue = JOURNAL_CUE_RE.search(text)
    if cue:
        # Grow rightwards until the citation numbers start, and leftwards over
        # the capitalised words that lead into the cue — "Indian Dermatology
        # Online Journal". Bounded on the left by the end of the previous
        # sentence and by any token holding a digit, which is how an author list
        # ("Subhash Chand Arya2 Annals of ...") gives itself away.
        start = cue.start()
        left = text[:start].rstrip()
        for _ in range(4):
            word = re.search(r"(?:^|(?<=[\s(]))([A-Z][\w&'\-]*)\s*$", left)
            if not word or re.search(r"\d", word.group(1)) or word.group(1).isupper():
                break
            if left[: word.start(1)].rstrip().endswith((".", "!", "?", ":", ";")):
                start = word.start(1)
                break
            start = word.start(1)
            left = left[: word.start(1)].rstrip()
        tail = text[cue.end():]
        stop = re.search(r"[.,;]\s*(?:\d|vol|issue|volume|pp?\.)|[.;]\s+[A-Z]{2,}|\s\d{4}\b", tail, re.I)
        end = cue.end() + (stop.start() if stop else min(len(tail), 70))
        journal = _clean(text[start:end], 120)

    segments = [seg for seg in re.split(r"(?<=[.?!])\s+", text) if _clean(seg)]
    # A by-line is neither the title nor the journal. Taking it off first stops
    # "Tank PD, Salvi VS." being left as the entire title once the journal guess
    # below has claimed the sentence that follows it.
    while len(segments) > 1 and _looks_like_authors(segments[0]):
        segments.pop(0)
    if not journal and len(segments) > 1:
        for index in range(len(segments) - 1, 0, -1):
            if not CITATION_RE.search(segments[index]):
                continue
            # "J Obstet Gynecol India 2002;76:27-31" carries its journal in front
            # of its own volume and year. Only when the citation stands alone is
            # the sentence before it the journal rather than the article title.
            inline = _clean(re.split(r"(?<!\d)(?:19|20)\d{2}|\d+\s*[(;:]",
                                     segments[index], maxsplit=1)[0], 120)
            # Letters and spaces only: "doi: 10.1002/jcu.22919" and
            # "May;49(4):385-389" are the rest of the citation, not its journal.
            if (inline and 1 < len(inline.split()) <= 8
                    and re.fullmatch(r"[A-Za-z][A-Za-z.'&\- ]+", inline)):
                journal = inline
                segments = segments[:index]
                break
            candidate = _clean(segments[index - 1], 60)
            # A journal name is a short noun phrase; a sentence of prose is the
            # article's title and must stay in the title column.
            if candidate and 1 < len(candidate.split()) <= 8:
                journal = candidate
                segments = segments[: index - 1]
            break

    quoted = re.search(r'"([^"]{12,300})"', raw)
    if quoted:
        title = _clean(quoted.group(1), 300)
    else:
        head = text[: cue.start()] if cue else " ".join(segments)
        segments = [seg for seg in re.split(r"(?<=[.?!])\s+", head) if _clean(seg)]
        # Drop a leading author list ("Raja SK, premlal KS.") — short, and mostly
        # surname + initials pairs rather than prose.
        while segments and _looks_like_authors(segments[0]):
            segments.pop(0)
        title = _clean(" ".join(segments), 300) or _clean(head, 300) or _clean(text, 300)
    title = _strip_quotes(re.sub(r"^\d{1,3}[.)]\s*", "", title))

    years = _years(text)
    year = str(years[-1]) if years else ""
    if not title and not journal:
        return None
    scope = _scope_of(journal or text)
    if not scope and journal and JOURNAL_CUE_RE.search(journal):
        # The rubric's rule for reach: a journal counts as international unless
        # it is plainly one country's organ, which the national hints catch.
        scope = "international"
    return {"title": title or _clean(text, 200), "year": year,
            "journal": journal, "scope": scope}


def _looks_like_authors(segment: str) -> bool:
    segment = segment.strip()
    if not segment or len(segment) > 120:
        return False
    initials = len(re.findall(r"\b[A-Z][a-z]+\s+[A-Z]{1,3}\b(?![a-z])", segment))
    numbered = len(re.findall(r"[A-Za-z]\d(?:[,\s]|$)", segment))
    return (initials >= 1 and len(segment.split()) <= 20) or numbered >= 2


ACRONYM_RE = re.compile(r"(?<![A-Za-z])[A-Z]{3,}(?![a-z])")
TALK_LABEL_RE = re.compile(r"(?:poster|oral|invited|guest|keynote)?\s*"
                           r"(?:presentation|presented|lecture|talk|topic|title)\s*:\s*", re.I)


def _parse_presentation(entry: Entry) -> Optional[Dict[str, str]]:
    # "…at the 28th MOGS Conference, 2000, Mumbai. Coauthors: Dr K R Damania…"
    # — the people who wrote it with them are not the meeting, and left in place
    # they were what landed in the "with whom" column.
    text = _clean(re.split(r"\bco-?authors?\s*:", entry.text, maxsplit=1, flags=re.I)[0], 400)
    if not text:
        return None
    years = _years(text)
    year = str(years[-1]) if years else ""

    # Strip the written-out date first — "15th April 2023" is the year column,
    # and left in place it reads as part of the meeting's name.
    # Some templates label the two halves outright: "<Meeting> - <City> -
    # <Date> Presentation: <Topic>". Believe the label over any guess.
    labelled = TALK_LABEL_RE.search(text)
    if labelled:
        topic = _strip_quotes(text[labelled.end():])
        meeting = _clean(MONTH_TAIL_RE.sub("", YEAR_RE.sub("", text[: labelled.start()])), 100)
        meeting = _clean(re.sub(r"[\s,;-]+$", "", meeting), 100)
        if topic:
            return {"topic": topic, "year": year, "with_whom": meeting,
                    "scope": _scope_of(meeting or text)}

    body = re.sub(r"\b\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}\b", " ", text)
    parts = [p for p in re.split(r"\s*[,;.]\s*", body) if _clean(p)]

    with_whom = ""
    if len(parts) > 1:
        for part in parts[1:]:
            if CONFERENCE_RE.search(part) or _has_any(part, SOCIETY_WORDS) or ACRONYM_RE.search(part):
                with_whom = _strip_heading(part)
                break
        topic = _strip_quotes(parts[0])
        if not with_whom:
            with_whom = _strip_heading(parts[-1])
    else:
        # One unpunctuated line: the meeting starts at its own name, so cut there
        # rather than handing the whole sentence to both columns.
        anchor = CONFERENCE_RE.search(body) or ACRONYM_RE.search(body)
        if anchor:
            with_whom = _strip_heading(body[anchor.start():])
            topic = _strip_quotes(body[: anchor.start()])
        else:
            topic = _strip_quotes(body)

    with_whom = re.sub(r"^(?:in|at|on|during|for|by)\s+", "", with_whom, flags=re.I)
    topic = _clean(re.sub(r"\s+(?:in|at|on|during|for|by|of)$", "", _strip_heading(topic)), 200)
    if with_whom and topic.lower() == with_whom.lower():
        with_whom = ""
    if not topic:
        topic = _clean(text, 200)
    return {"topic": topic, "year": year, "with_whom": _clean(with_whom, 100),
            "scope": _scope_of(with_whom or text)}


GENERIC_BODY_RE = re.compile(r"(?:the\s+)?(?:committee|board|council|cell|chapter|zone|forum|"
                             r"section|faculty)\b(?!\s*(?:member|chair|head|secretary|president))",
                             re.I)


def _parse_office(entry: Entry) -> List[Dict[str, str]]:
    text = _clean(entry.text, 300)
    if not text:
        return []
    # "FOGSI : Chairman, Young Talent Promotion Committee (2008-2010)" writes the
    # society first; most other CVs write the post first. Handle both.
    org_first = re.match(r"^([A-Z][\w&.\- ]{2,40}?)\s*[:\-]\s+(.{4,})$", text)
    position, organization = "", ""
    if org_first and _has_any(org_first.group(1), SOCIETY_WORDS):
        organization = _clean(org_first.group(1), 100)
        position = _clean(DATE_RANGE_RE.sub("", org_first.group(2)), 120)
    else:
        matched = _first_match(text, OFFICE_WORDS)
        if matched:
            idx = text.lower().find(matched.lower())
            head = _clean(text[:idx], 60)
            position = _clean(matched + text[idx + len(matched):idx + len(matched) + 40].split(",")[0], 90)
            position = _clean(f"{head} {position}" if head and len(head) < 45 else position, 110)
        rest = text
        for cue in SOCIETY_WORDS:
            pos = rest.lower().find(cue)
            if pos != -1:
                left = rest[:pos]
                word = re.search(r"((?:(?:[A-Z][\w&'.\-]*|&)\s+){0,4})$", left)
                start = pos - len(word.group(1)) if word else pos
                organization = _clean(DATE_RANGE_RE.sub("", rest[start:start + 90]), 100)
                break
        if not organization:
            organization = _clean(DATE_RANGE_RE.sub("", text.replace(position, "")), 100)
    organization = _clean(re.sub(r"[\s,;-]*(?:19|20)\d{2}\s*[-/]?\s*(?:(?:19|20)?\d{2})?\s*$",
                                 "", organization), 100)
    organization = _clean(re.sub(r"\(\s*[-,;]?\s*\)", "", organization), 100)
    position = _clean(re.sub(r"\(\s*[-,;]?\s*\)", "", position), 90)
    position = _clean(re.split(r"(?<![A-Za-z])(?:in|of|at|for|-)(?![A-Za-z])", position, maxsplit=1)[0], 90)
    if position and organization and position.lower() in organization.lower():
        organization = _clean(organization.replace(position, ""), 100)
    if not position and not organization:
        return []
    # A committee is a body, not an office. "…at the FOGSI Safe Motherhood
    # Committee meeting" leaves the bare noun as the post, and a row saying a
    # person was a "Committee" is worse than no row at all.
    if GENERIC_BODY_RE.match(position):
        return []
    return [{"position": position or _clean(text, 90), "organization": organization,
             "scope": _scope_of(organization or text), "year": _period(text)}]


ROLE_HINTS = ((("co editor", "co-editor", "coeditor", "edited", "editor"), "editor"),
              (("chapter", "contributed a chapter", "section"), "chapter_author"),
              (("co author", "co-author", "coauthor"), "co_author"),
              (("author", "authored", "wrote", "written"), "author"))


def _parse_textbooks(entry: Entry) -> List[Dict[str, str]]:
    text = _clean(entry.text, 600)
    if not text:
        return []
    low = text.lower()
    role = ""
    for hints, value in ROLE_HINTS:
        if any(hint in low for hint in hints):
            role = value
            break

    quoted = re.findall(r'"([^"]{6,200})"', text)
    if quoted:
        titles = [_clean(q, 200) for q in quoted]
    else:
        body = re.sub(r"^.*?:\s*", "", text)
        titles = [_clean(part, 200) for part in re.split(r"\s*;\s*", body)]
    titles = [t for t in titles if t and len(t) > 4]
    if not titles:
        return []

    rows = []
    for title in titles:
        years = _years(title) or _years(text)
        clean_title = _clean(YEAR_RE.sub("", title), 200) if _years(title) else title
        rows.append({"title": clean_title or title, "role": role,
                     "year": str(years[-1]) if years else ""})
    return rows


def _parse_advisory(entry: Entry) -> Optional[Dict[str, str]]:
    text = _clean(entry.text, 300)
    if not text:
        return None
    years = _years(text)
    # "…Advisory Board organized by Ferring Pharmaceuticals" names the sponsor
    # after the verb; that is what the With Whom column asks for.
    sponsor = re.search(r"(?:organi[sz]ed|convened|sponsored|conducted|hosted|run)\s+by\s+(.{3,80})"
                        r"|(?:advisor|adviser|consultant)\s+(?:to|for)\s+(.{3,80})", text, re.I)
    with_whom = _clean(sponsor.group(1) or sponsor.group(2), 100) if sponsor else ""
    with_whom = _clean(re.sub(r"[\s,;-]*(?:19|20)\d{2}\s*$", "", with_whom), 100)
    topic = _clean(re.split(r"[,;]", text)[0], 200)
    if not with_whom:
        for part in re.split(r"[,;]|\bwith\b|\bfor\b|\bat\b", text):
            part = _clean(part, 100)
            if part and part != topic and (_has_any(part, SOCIETY_WORDS)
                                           or re.search(r"\b[A-Z]{3,}\b", part)):
                with_whom = part
                break
    if with_whom and with_whom.lower() == topic.lower():
        with_whom = ""
    return {"topic": topic, "year": str(years[-1]) if years else "", "with_whom": with_whom}


# ── Scalar fields ──────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[\s\-]?)?(?:\(?\d{2,5}\)?[\s\-]?)?\d{5}[\s\-]?\d{5}"
                      r"|\+?\d{1,3}[\s\-]?\d{10}\b|\b[6-9]\d{9}\b")
REG_RE = re.compile(r"(?<![A-Za-z])(?:reg(?:d|n|istration)?\.?\s*(?:no\.?|number)?|"
                    r"licen[cs]e\s*(?:no\.?)?|mci|nmc|tnmc|mmc|dmc|kmc|apmc|wbmc|omc)"
                    r"\s*[:\-.]*\s*([A-Z]{0,6}(?:[\-/][A-Z0-9]{1,10})*[\-/]?\d{3,10}[A-Z]?)",
                    re.I)
# OCR of a two-column form emits every label, then every value, so the number
# ends up on a line of its own far from the word "Registration". What still
# identifies it is the council named on the line after it.
REG_ORPHAN_RE = re.compile(r"^\s*([A-Z]{0,4}[\-/]?\d{4,10}[A-Z]?)\s*$")
DOB_RE = re.compile(r"(?:date of birth|d\.?o\.?b\.?|born)\s*[:\-]?\s*"
                    r"(?:\d{1,2}[/\-.]\d{1,2}[/\-.])?((?:19|20)\d{2})", re.I)
PROCEDURES_RE = re.compile(
    r"(?:over|more than|about|approx(?:imately)?|around|\+)?\s*([\d,]{2,7})\s*\+?\s*"
    r"(?:surger(?:ies|y)|procedures?|operations?|cases|deliveries|scopies|implants?)"
    r"[^.\n]{0,30}?(?:per\s*year|a\s*year|annually|/\s*year|yearly|per\s*annum)",
    re.I,
)
UNIQUE_RE = re.compile(
    r"[^.\n]*\b(?:world'?s first|first and only|only\s+\w[^.\n]{0,40}\bin india\b|"
    r"first in india|first of its kind|pioneer\w*|patent\w*|indigenous(?:ly)? develop\w*|"
    r"exclusive\w* (?:trained|certified))\b[^.\n]*",
    re.I,
)
NAME_RE = re.compile(r"^\s*((?:Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?)\s*\.?\s*"
                     r"[A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,4})\s*$")
MASK_RE = re.compile(r"^(.)\1{3,}$")

SPECIALTY_LEXICON = (
    ("dermatology", "Dermatology"), ("dermatologist", "Dermatology"),
    ("venereology", "Dermatology"), ("dvl", "Dermatology"),
    ("cardiology", "Cardiology"), ("cardiologist", "Cardiology"),
    ("oncology", "Oncology"), ("oncologist", "Oncology"),
    ("neurology", "Neurology"), ("neurologist", "Neurology"),
    ("neurosurgery", "Neurosurgery"),
    ("nephrology", "Nephrology"), ("gastroenterology", "Gastroenterology"),
    ("endocrinology", "Endocrinology"), ("rheumatology", "Rheumatology"),
    ("pulmonology", "Pulmonology"), ("respiratory medicine", "Pulmonology"),
    ("haematology", "Haematology"), ("hematology", "Haematology"),
    ("paediatric", "Paediatrics"), ("pediatric", "Paediatrics"),
    ("paediatrics", "Paediatrics"), ("pediatrics", "Paediatrics"),
    ("neonatology", "Neonatology"),
    ("obstetric", "Obstetrics & Gynaecology"), ("gynaecolog", "Obstetrics & Gynaecology"),
    ("gynecolog", "Obstetrics & Gynaecology"), ("ob-gyn", "Obstetrics & Gynaecology"),
    ("ob gyn", "Obstetrics & Gynaecology"), ("obgyn", "Obstetrics & Gynaecology"),
    ("orthopaedic", "Orthopaedics"), ("orthopedic", "Orthopaedics"),
    ("ophthalmolog", "Ophthalmology"), ("otorhinolaryngolog", "ENT"), ("ent", "ENT"),
    ("urology", "Urology"), ("psychiatry", "Psychiatry"), ("radiology", "Radiology"),
    ("anaesthesiolog", "Anaesthesiology"), ("anesthesiolog", "Anaesthesiology"),
    ("pathology", "Pathology"), ("microbiology", "Microbiology"),
    ("general surgery", "General Surgery"), ("plastic surgery", "Plastic Surgery"),
    ("cardiac surgery", "Cardiothoracic Surgery"), ("critical care", "Critical Care"),
    ("emergency medicine", "Emergency Medicine"), ("family medicine", "Family Medicine"),
    ("internal medicine", "Internal Medicine"), ("general medicine", "General Medicine"),
    ("consultant physician", "General Medicine"), ("general physician", "General Medicine"),
    ("physician", "General Medicine"),
    ("diabetolog", "Diabetology"), ("aesthetic medicine", "Aesthetic Medicine"),
    ("trichology", "Trichology"), ("transplant", "Transplant Medicine"),
)


def _find_registration(text: str, lines: List[str]) -> Optional[str]:
    match = REG_RE.search(text)
    if match:
        return _clean(match.group(1), 40)
    for index, line in enumerate(lines):
        orphan = REG_ORPHAN_RE.match(line)
        if not orphan:
            continue
        following = " ".join(lines[index + 1:index + 3]).lower()
        if "medical council" in following or "council of" in following:
            return _clean(orphan.group(1), 40)
    return None


def _find_name(lines: List[str], labels: Dict[str, List[str]]) -> Optional[str]:
    for value in labels.get("name", []):
        cleaned = _clean(value, 80)
        if cleaned and not MASK_RE.match(cleaned.replace(" ", "")):
            return cleaned
    # A CV that omits the label puts the name on its own line, usually the first
    # or the sign-off at the end.
    for line in lines[:8] + lines[-6:]:
        match = NAME_RE.match(line.strip())
        if match:
            candidate = _clean(match.group(1), 80)
            if candidate and not MASK_RE.match(candidate.replace(" ", "").replace("Dr.", "")):
                return candidate
    return None


def _find_city(text: str, labels: Dict[str, List[str]], institution: str) -> Optional[str]:
    def city_in(haystack: str) -> Optional[str]:
        low = " " + re.sub(r"[^a-z0-9]+", " ", haystack.lower()).strip() + " "
        hits = [(low.find(" " + c + " "), c) for c in INDIAN_CITIES if (" " + c + " ") in low]
        if not hits:
            return None
        # "New Delhi" must beat "Delhi": prefer the longest name at the same spot.
        best = min(hits, key=lambda h: (h[0], -len(h[1])))
        return best[1].title()

    for key in ("address", "residential address", "clinic"):
        for value in labels.get(key, []):
            found = city_in(value)
            if found:
                return found
    return city_in(institution) or city_in(text)


def _specialty_hits(needle: str, text: str) -> int:
    """Occurrences of a speciality keyword, anchored at a word start.

    Both ends are anchored for the short abbreviations: unanchored, "ENT" is
    found inside "Department" and "Intensivist" on almost every CV.
    """
    edge = r"(?![a-z])" if len(needle) <= 4 else ""
    return len(re.findall(r"(?<![a-z])" + re.escape(needle) + edge, text, re.I))


def _find_specialty(text: str, labels: Dict[str, List[str]], education: List[Dict],
                    designation: str = "") -> Optional[str]:
    for key in ("specialty", "speciality", "department"):
        for value in labels.get(key, []):
            cleaned = _clean(value, 60)
            if cleaned:
                for needle, canonical in SPECIALTY_LEXICON:
                    if _specialty_hits(needle, cleaned):
                        return canonical
                return cleaned
    # The PG degree's parenthetical names the speciality outright — "MD (DVL)".
    for row in education:
        if row.get("level") == "pg":
            for needle, canonical in SPECIALTY_LEXICON:
                if _specialty_hits(needle, row.get("degree", "")) or _specialty_hits(needle, row.get("text", "")):
                    return canonical
    # Then the current title. A one-off mention in a talk title counts the same
    # as the person's own role once you are only counting words, which made a
    # physician who once spoke on gut disease a gastroenterologist.
    for needle, canonical in SPECIALTY_LEXICON:
        if _specialty_hits(needle, designation):
            return canonical
    counted = []
    for needle, canonical in SPECIALTY_LEXICON:
        hits = _specialty_hits(needle, text)
        if hits:
            counted.append((hits, canonical))
    if counted:
        return max(counted, key=lambda c: c[0])[1]
    return None


def _pg_year(education: List[Dict]) -> Optional[int]:
    """The year the primary postgraduate degree finished.

    Earliest, not latest: a DM taken years after an MD is super-speciality
    training, and the rubric counts experience from the first PG qualification.
    Diplomas, certificates and fellowships are excluded by `level`.
    """
    years = [int(r["year"]) for r in education if r.get("level") == "pg" and r.get("year")]
    if years:
        return min(years)
    ug = [int(r["year"]) for r in education if r.get("level") == "ug" and r.get("year")]
    return min(ug) if ug else None


def _age_estimate(text: str, education: List[Dict]) -> Optional[int]:
    this_year = date.today().year
    dob = DOB_RE.search(text)
    if dob:
        birth = int(dob.group(1))
        if 1930 <= birth <= this_year - 20:
            return this_year - birth
    for row in education:
        if row.get("level") != "ug":
            continue
        start = row.get("start_year") or row.get("year")
        if not start:
            continue
        start_year = int(start)
        # Entry to medical school at ~18; if only the completion year is on the
        # CV it is ~5.5 years later, so read back from whichever is present.
        offset = 18 if row.get("start_year") and int(row["start_year"]) < int(row.get("year") or start) else 23
        birth = start_year - offset
        if 1930 <= birth <= this_year - 20:
            return this_year - birth
    return None


# ── Orchestration ──────────────────────────────────────────────────────────

def extract_fields(raw_text: str) -> Dict:
    """Read a CV's text into the same field set the AI path returns.

    Every value comes from the document itself; nothing is inferred beyond the
    arithmetic (`age_estimate`) and the fixed vocabularies above. Fields the
    rules cannot read are left as None/[] for the user to complete.
    """
    lines = _normalize_lines(raw_text or "")
    entries, labels, kept = _build_entries(lines)
    text = "\n".join(kept)

    kinds = _vote_runs(entries, [_classify(entry) for entry in entries])
    buckets: Dict[str, List[Entry]] = {}
    for entry, kind in zip(entries, kinds):
        if kind:
            buckets.setdefault(kind, []).append(entry)

    education = [row for row in (_parse_education(e) for e in buckets.get("education", [])) if row]
    career = [(e, _parse_faculty(e)) for e in buckets.get("experience", [])]
    career = [(e, row) for e, row in career if row]
    faculty = [row for _, row in career]
    publications = [row for row in (_parse_publication(e) for e in buckets.get("publications", [])) if row]
    presentations = [row for row in (_parse_presentation(e) for e in buckets.get("presentations", [])) if row]
    advisory = [row for row in (_parse_advisory(e) for e in buckets.get("advisory", [])) if row]
    office: List[Dict[str, str]] = []
    for entry in buckets.get("office", []):
        office.extend(_parse_office(entry))
    textbooks: List[Dict[str, str]] = []
    for entry in buckets.get("books", []):
        textbooks.extend(_parse_textbooks(entry))

    # Both boxes are capped, so what the CV filed under its own Memberships or
    # Awards heading goes in first: a working group picked up by wording alone
    # was pushing the actual list of societies past the 800-character cut.
    def _heading_first(kind: str) -> List[Entry]:
        return sorted(buckets.get(kind, []), key=lambda e: 0 if e.section == kind else 1)

    memberships = _dedupe([_clean(e.text, 220) for e in _heading_first("memberships")])
    awards = _dedupe([_clean(e.text, 200) for e in _heading_first("awards")])
    interests = _dedupe([_clean(e.text, 220) for e in buckets.get("interests", [])])
    for key in ("areas of special interest", "areas of interest", "area of interest",
                "special interest"):
        interests.extend(_clean(v, 120) for v in labels.get(key, []) if _clean(v))
    interests = _dedupe([i for i in interests if i])

    # A CV that prints "PRESENT APPOINTMENT" has named the current post outright;
    # trust that over reading tense off the dates of every other post, which on a
    # long teaching history returns half a career as "current".
    declared = [row for entry, row in career if entry.label in CURRENT_LABELS]
    current = declared or [row for row in faculty if row.get("status") == "current"]
    institution = ", ".join(_dedupe([r["institution"] for r in current if r["institution"]]))[:400] or None
    designation = ", ".join(_dedupe([r["position"] for r in current if r["position"]]))[:300] or None
    if not institution and faculty:
        # No post reads as still held, so the latest one dated is the closest
        # thing to a current employer. Taking the first row instead put a house
        # job from the start of the career on the form; ties break in favour of
        # the one written last, which is where a chronological CV puts it.
        named = [row for row in faculty if row["institution"]] or faculty
        ranked = max(enumerate(named),
                     key=lambda pair: (max(_years(pair[1]["years"]), default=0), pair[0]))
        anchor = ranked[1] if max(_years(ranked[1]["years"]), default=0) else named[0]
        institution = anchor["institution"] or None
        designation = designation or (anchor["position"] or None)

    # Only dated qualifications, one per (degree, year): the same degree is
    # commonly restated under "Medical Registrations", and a stray degree
    # abbreviation in prose has no year at all — neither should reach the form.
    seen_degrees = set()
    education_parts = []
    for row in sorted(education, key=lambda r: r["year"] or "0", reverse=True):
        key = (re.sub(r"[^a-z]", "", row["degree"].lower()), row["year"])
        if not row["year"] or key in seen_degrees:
            continue
        seen_degrees.add(key)
        education_parts.append(_clean(
            ", ".join(part for part in (row["degree"], row["institution"], row["year"]) if part), 160))
    education_line = "; ".join(education_parts)[:900] or None

    emails = EMAIL_RE.findall(text)
    phones = [_clean(p, 24) for p in PHONE_RE.findall(text)]
    phones = [p for p in phones if len(re.sub(r"\D", "", p)) >= 10]
    procedures = PROCEDURES_RE.search(text)
    # "Ian Donald: the pioneer of ultrasound in medicine" is the title of a paper
    # this doctor wrote, not a claim about them, so a sentence that reads as a
    # citation cannot answer "what is unique about this person".
    def _cites(match: re.Match) -> bool:
        # Judge the whole line: "6. Dastur AE, Tank PD. Ian Donald: the pioneer
        # of ultrasound in medicine. J Obstet Gynecol India 2010" keeps its
        # by-line and its journal outside the sentence that matched.
        line = text[text.rfind("\n", 0, match.start()) + 1:]
        line = line[: line.find("\n")] if "\n" in line else line
        return bool(AUTHOR_LIST_RE.match(line) or JOURNAL_CUE_RE.search(line)
                    or CITATION_RE.search(line) or CITATION_CONTEXT_RE.search(line))

    unique = next((m for m in UNIQUE_RE.finditer(text) if not _cites(m)), None)

    government = "yes" if _has_any(
        " ".join([institution or "", designation or "",
                  " ".join(r["institution"] for r in faculty)]), GOVERNMENT_WORDS
    ) else "no"

    return {
        "full_name": _find_name(kept, labels),
        "city": _find_city(text, labels, institution or ""),
        "specialty": _find_specialty(text, labels, education, designation or ""),
        "institution": institution,
        "designation": designation,
        "years_of_experience": None,  # the endpoint derives this from the PG year
        "pg_qualification_year": _pg_year(education),
        "education": education_line,
        "unique_expertise": _clean(unique.group(0), 200) if unique else None,
        "procedures_per_year": int(procedures.group(1).replace(",", "")) if procedures else None,
        "age_estimate": _age_estimate(text, education),
        "key_clinical_interests": ", ".join(interests)[:400] or None,
        "publications": publications,
        "conference_presentations": presentations,
        "professional_memberships": "; ".join(memberships)[:800] or None,
        "awards_recognitions": "; ".join(awards)[:800] or None,
        "medical_registration_no": _find_registration(text, kept),
        "advisory_board": advisory,
        "affiliated_to_government": government,
        "email": emails[0] if emails else None,
        "mobile": phones[0] if phones else None,
        "textbooks": textbooks,
        "office_bearer_positions": office,
        "faculty_positions": faculty,
    }


# ── Bulk paste, without AI ─────────────────────────────────────────────────

# The paste box asks the user which section they are pasting into, so unlike a
# whole CV there is nothing to classify — each entry is parsed straight into the
# columns of the section it was pasted under.
_ROW_PARSERS = {
    "publications": lambda e: [r for r in [_parse_publication(e)] if r],
    "conference_presentations": lambda e: [r for r in [_parse_presentation(e)] if r],
    "advisory_board": lambda e: [r for r in [_parse_advisory(e)] if r],
    "textbooks": _parse_textbooks,
    "faculty_positions": lambda e: [r for r in [_parse_faculty(e)] if r],
    "office_bearer_positions": _parse_office,
}


def parse_rows(kind: str, text: str) -> List[Dict[str, str]]:
    """Split a pasted block into rows for one form section, by rule."""
    parser = _ROW_PARSERS.get(kind)
    if not parser:
        return []
    rows: List[Dict[str, str]] = []
    for line in _normalize_lines(text or ""):
        if not line.strip():
            continue
        # One entry per line here: a person pasting a list means the line breaks,
        # so honouring them beats re-guessing where each record ends.
        entry = Entry(_clean(BULLET_RE.sub("", line, count=1), 600), kind, None,
                      [BULLET_RE.sub("", line, count=1)])
        if entry.text:
            rows.extend(parser(entry))
    return rows
