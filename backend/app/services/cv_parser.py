"""CV parsing service supporting PDF, DOCX, PPTX, and images with OCR."""
import os
import re
from typing import Dict, Optional


class CVParser:

    @staticmethod
    def parse_file(file_path: str) -> Dict:
        ext = os.path.splitext(file_path)[1].lower()
        text = ""

        if ext == ".pdf":
            text = CVParser._parse_pdf(file_path)
        elif ext in (".doc", ".docx"):
            text = CVParser._parse_docx(file_path)
        elif ext in (".ppt", ".pptx"):
            text = CVParser._parse_pptx(file_path)
        elif ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp"):
            text = CVParser._parse_image(file_path)
        else:
            text = ""

        if not text.strip():
            return {"raw_text": "", "parsed": {}, "error": f"Could not extract text from {ext}"}

        return {
            "raw_text": text,
            "parsed": CVParser._extract_fields(text),
        }

    @staticmethod
    def _parse_pdf(file_path: str) -> str:
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            if not text.strip():
                text = CVParser._ocr_pdf(file_path)
            return text
        except Exception:
            return CVParser._ocr_pdf(file_path)

    @staticmethod
    def _ocr_pdf(file_path: str) -> str:
        try:
            from pdf2image import convert_from_path
            import pytesseract
            images = convert_from_path(file_path)
            text = ""
            for img in images:
                text += pytesseract.image_to_string(img) + "\n"
            return text
        except Exception:
            return ""

    @staticmethod
    def _parse_docx(file_path: str) -> str:
        ext = os.path.splitext(file_path)[1].lower()

        # .doc (old binary format) — try converting via textutil (macOS) or antiword
        if ext == ".doc":
            text = CVParser._parse_doc_legacy(file_path)
            if text.strip():
                return text
            # textutil is macOS-only and antiword is rarely installed on a
            # server, so LibreOffice is the fallback that actually runs in prod.
            text = CVParser._convert_via_soffice(file_path)
            if text.strip():
                return text

        try:
            from docx import Document
            from docx.oxml.ns import qn
            from docx.table import Table
            from docx.text.paragraph import Paragraph
            doc = Document(file_path)
            parts = []

            # Walk paragraphs AND tables in document order. Reading all paragraphs
            # first and all tables afterwards orphans each table from the heading it
            # sits under — e.g. an "Academic qualifications" heading on line 9 with
            # its MBBS/MD rows dumped 190 lines later at the end of the text. That
            # costs the model the context it needs, and makes tables the first thing
            # lost when the text is truncated for the prompt.
            for child in doc.element.body.iterchildren():
                if child.tag == qn("w:p"):
                    p = Paragraph(child, doc)
                    if p.text.strip():
                        parts.append(p.text)
                elif child.tag == qn("w:tbl"):
                    try:
                        for row in Table(child, doc).rows:
                            row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                            if row_text:
                                parts.append(" | ".join(row_text))
                    except Exception:
                        # Merged/nested cells can trip python-docx — skip that table
                        # rather than losing the whole document.
                        continue

            # Extract text from headers/footers
            for section in doc.sections:
                if section.header:
                    for p in section.header.paragraphs:
                        if p.text.strip():
                            parts.append(p.text)

            # Extract text from VML text boxes (Word often puts content in these)
            WP_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
            VML_NS = 'urn:schemas-microsoft-com:vml'
            WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
            body = doc.element.body

            # VML text boxes (<v:textbox>)
            vml_texts = []
            for txbox in body.iter(f'{{{VML_NS}}}textbox'):
                for t_elem in txbox.iter(f'{{{WP_NS}}}t'):
                    if t_elem.text and t_elem.text.strip():
                        vml_texts.append(t_elem.text)
            if vml_texts:
                # Join fragmented VML text intelligently
                parts.append(CVParser._join_vml_fragments(vml_texts))

            # WPS text boxes (<wps:txbxContent>)
            for txbox in body.iter(f'{{{WPS_NS}}}txbxContent'):
                for t_elem in txbox.iter(f'{{{WP_NS}}}t'):
                    if t_elem.text and t_elem.text.strip():
                        parts.append(t_elem.text)

            return "\n".join(parts)
        except Exception:
            return ""

    @staticmethod
    def _join_vml_fragments(texts):
        """Join fragmented VML text box content into readable text."""
        result = []
        current_line = []
        for t in texts:
            t = t.strip()
            if not t:
                continue
            # If it looks like a start of a new section/sentence, flush current line
            if t.endswith(':') or t.endswith('.') or len(t) > 40:
                current_line.append(t)
                result.append(' '.join(current_line))
                current_line = []
            else:
                current_line.append(t)
        if current_line:
            result.append(' '.join(current_line))
        return '\n'.join(result)

    @staticmethod
    def _parse_doc_legacy(file_path: str) -> str:
        """Parse old .doc format using available system tools."""
        import subprocess
        # Try textutil (available on macOS)
        try:
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", file_path],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        # Try antiword (Linux)
        try:
            result = subprocess.run(
                ["antiword", file_path],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        return ""

    @staticmethod
    def _convert_via_soffice(file_path: str) -> str:
        """Convert a legacy binary Office file to PDF with LibreOffice, if present.

        python-docx and python-pptx read only the modern zipped XML formats, so a
        genuine binary .doc or .ppt yields nothing from either. macOS has
        `textutil` for .doc; a Linux server has neither that nor antiword, so
        those uploads produced an empty parse and a misleading error.

        LibreOffice handles both and is the only realistic converter. Returns the
        extracted text, or "" when it is not installed — the caller then reports
        what is missing instead of pretending the file was unreadable.
        """
        import subprocess, tempfile, os as _os, glob as _glob
        binary = None
        for candidate in ("soffice", "libreoffice"):
            try:
                subprocess.run([candidate, "--version"], capture_output=True, timeout=20)
                binary = candidate
                break
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                continue
        if not binary:
            return ""
        try:
            with tempfile.TemporaryDirectory() as outdir:
                subprocess.run(
                    [binary, "--headless", "--convert-to", "pdf", "--outdir", outdir, file_path],
                    capture_output=True, timeout=120,
                )
                produced = _glob.glob(_os.path.join(outdir, "*.pdf"))
                if not produced:
                    return ""
                return CVParser._parse_pdf(produced[0])
        except Exception:
            return ""

    @staticmethod
    def _parse_pptx(file_path: str) -> str:
        # Legacy binary .ppt is not a zip archive, so python-pptx cannot open it.
        # Go straight to conversion rather than raising and returning "".
        if os.path.splitext(file_path)[1].lower() == ".ppt":
            return CVParser._convert_via_soffice(file_path)
        try:
            from pptx import Presentation
            prs = Presentation(file_path)
            text = ""
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        text += shape.text + "\n"
            if text.strip():
                return text
            # A deck whose slides are images has no text runs to read.
            return CVParser._convert_via_soffice(file_path)
        except Exception:
            return CVParser._convert_via_soffice(file_path)

    @staticmethod
    def _parse_image(file_path: str) -> str:
        try:
            import pytesseract
            from PIL import Image
            img = Image.open(file_path)
            return pytesseract.image_to_string(img)
        except Exception:
            return ""

    @staticmethod
    def _extract_fields(text: str) -> Dict:
        fields = {}

        # Extract education
        education_patterns = [
            r"(MBBS|MD|DM|PhD|MS|MCh|DNB|FRCS|MRCP|Fellowship)[^,\n]*",
        ]
        educations = []
        for p in education_patterns:
            educations.extend(re.findall(p, text, re.IGNORECASE))
        if educations:
            seen = {}
            for e in educations:
                key = e.strip().upper()
                if key not in seen:
                    seen[key] = e.strip()
            fields["education"] = ", ".join(seen.values())

        # Extract years of experience
        exp_match = re.search(r"(\d{1,2})\+?\s*years?\s*(of\s*)?(clinical\s*)?experience", text, re.IGNORECASE)
        if exp_match:
            fields["years_of_experience"] = int(exp_match.group(1))

        # Extract specialty
        specialties = ["cardiology", "oncology", "neurology", "orthopedics", "ophthalmology",
                       "dermatology", "gastroenterology", "pulmonology", "nephrology",
                       "endocrinology", "rheumatology", "urology", "pediatrics",
                       "psychiatry", "radiology", "anesthesiology", "surgery",
                       "internal medicine", "general medicine", "critical care"]
        for spec in specialties:
            if spec.lower() in text.lower():
                fields["specialty"] = spec.title()
                break

        # Extract positions/titles
        titles = []
        title_patterns = [
            r"(Professor|Associate Professor|Assistant Professor|Head of Department|Chairman|Director|Chief)",
            r"(Dean|HOD|Consultant|Senior Consultant|Fellow)",
        ]
        for p in title_patterns:
            found = re.findall(p, text, re.IGNORECASE)
            titles.extend(found)
        if titles:
            fields["faculty_positions"] = ", ".join(set(titles))

        # Detect if surgeon
        surgeon_keywords = ["surgeon", "surgery", "surgical", "orthopedic", "cardiac surgery",
                           "neurosurgery", "transplant"]
        fields["likely_surgeon"] = any(kw in text.lower() for kw in surgeon_keywords)

        # Extract publication mentions
        pub_match = re.search(r"(\d+)\s*publications?", text, re.IGNORECASE)
        if pub_match:
            fields["publications_mentioned"] = int(pub_match.group(1))

        # Extract procedures
        proc_match = re.search(r"(\d+)\s*(?:procedures?|surgeries|operations?)\s*(?:per\s*year|annually|/\s*year)", text, re.IGNORECASE)
        if proc_match:
            fields["procedures_per_year"] = int(proc_match.group(1))

        return fields
