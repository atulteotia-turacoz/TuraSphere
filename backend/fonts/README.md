# Fonts for document previews

Every `.ttf` / `.otf` / `.ttc` in this folder is given to LibreOffice when it
converts a Word/PowerPoint/Excel file to PDF for the in-browser preview (see
`app/services/document_preview.py`). Without the fonts a deck was designed in,
LibreOffice uses a substitute and the slides look different. For example,
Trebuchet MS and Aptos came out as a serif font.

Microsoft fonts can't be committed to git (licence), so the font files are
ignored and each server fills this folder itself. Use `PREVIEW_FONTS_DIR` in
`.env` to point somewhere else.

**Mac (local):** copy the fonts that come with Office and macOS:

    cp "/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts/"*.tt[fc] backend/fonts/
    cp /System/Library/Fonts/Supplemental/{Arial,Trebuchet,Verdana,Georgia,Tahoma,Times}*.ttf backend/fonts/

**Linux (live):** fonts installed system-wide are already seen by LibreOffice:

    sudo apt install ttf-mscorefonts-installer fonts-crosextra-carlito fonts-crosextra-caladea
    sudo fc-cache -f

That covers Arial, Trebuchet MS, Times New Roman, Verdana, Georgia and others,
and Carlito/Caladea, which have the same metrics as Calibri/Cambria. Aptos (the
Office default since 2023) is not in any package. Copy Aptos*.ttf from an
Office install, or download it from Microsoft, into this folder.

Cached previews re-render on their own when the set of fonts here changes.
After a system-wide install, clear them once: `rm <UPLOAD_DIR>/previews/*.pdf`.
