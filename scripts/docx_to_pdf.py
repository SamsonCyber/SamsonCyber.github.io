"""Convert Samson's resume docx into a themed PDF for the portfolio site.

Reads the docx with python-docx, renders with reportlab. Faithful text.
Theme matches the portfolio site: void-dark background, steel accent,
Outfit type. Email is kept as written in the draft.
"""
import os
import re
from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
)

SRC = r"C:\Users\shotg\Downloads\Samson_Laird_Resume_Stifel_CSIR_Final.docx"
OUT = r"C:\Users\shotg\OneDrive\Desktop\Code\portfolio\public\resume.pdf"
FONT_DIR = r"C:\Code\outfit-fonts"

# ── Site palette (src/style.css :root) ─────────────────
VOID = HexColor("#090b10")      # --void
TEXT = HexColor("#eef1f6")      # --text
DIM = HexColor("#b6bdc9")       # --text-dim
MUTE = HexColor("#8a919e")      # --text-mute
HEAT = HexColor("#a8b8d0")      # --heat (steel blue-gray)
RULE = HexColor("#2a3240")      # line on void

# ── Fonts ──────────────────────────────────────────────
_weights = {400: "Outfit400", 500: "Outfit500", 600: "Outfit600", 700: "Outfit700"}
for w, name in _weights.items():
    pdfmetrics.registerFont(TTFont(name, os.path.join(FONT_DIR, f"Outfit-{w}.ttf")))
pdfmetrics.registerFontFamily(
    "Outfit", normal=_weights[400], bold=_weights[700],
    italic=_weights[400], boldItalic=_weights[700],
)

# ── Styles ─────────────────────────────────────────────
name_style = ParagraphStyle(
    "name", fontName=_weights[700], fontSize=19, leading=21, textColor=TEXT,
)
contact_style = ParagraphStyle(
    "contact", fontName=_weights[400], fontSize=8.2, leading=11.2, textColor=MUTE,
)
section = ParagraphStyle(
    "section", fontName=_weights[600], fontSize=9.6, leading=11.8,
    textColor=HEAT, spaceBefore=5.5, spaceAfter=2,
)
body = ParagraphStyle(
    "body", fontName=_weights[400], fontSize=8.2, leading=11.1, textColor=DIM,
    spaceAfter=1.5,
)
bullet = ParagraphStyle(
    "bullet", parent=body, leftIndent=12, bulletIndent=3, spaceAfter=1.2,
)
meta = ParagraphStyle(
    "meta", fontName=_weights[500], fontSize=8.2, leading=11.1, textColor=TEXT,
    spaceAfter=0.8,
)

SECTION_RE = re.compile(
    r"^(SUMMARY|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE|SELECTED PROJECTS|EDUCATION & CERTIFICATIONS)$"
)
CAT_RE = re.compile(r"^([A-Z][A-Za-z &]+):\s*(.+)$")


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def normalize(t):
    """Text transforms so the PDF matches reality + site copy."""
    t = t.replace("multi-hundred-user organization", "~300-user organization")
    return t


def main():
    doc = Document(SRC)
    paras = [normalize(p.text.strip()) for p in doc.paragraphs if p.text.strip()]

    story = []
    first = True
    for t in paras:
        if first:
            story.append(Paragraph(esc(t), name_style))
            first = False
            continue
        if re.match(r"^SAMSON LAIRD$", t):
            continue
        if "·" in t and "@" not in t and len(t) < 160 and len(story) < 4:
            story.append(Paragraph(esc(t), contact_style))
            story.append(Spacer(1, 2))
            continue
        if SECTION_RE.match(t):
            story.append(Spacer(1, 0.5))
            story.append(HRFlowable(width="100%", thickness=0.5, color=RULE))
            story.append(Paragraph(esc(t), section))
            continue
        m = re.match(r"^([^·]{3,80}?)\s+·\s+(.+)$", t)
        if m and len(t) < 180:
            story.append(
                Paragraph(
                    f'<b>{esc(m.group(1).strip())}</b> &nbsp;·&nbsp; {esc(m.group(2).strip())}',
                    meta,
                )
            )
            continue
        cat = CAT_RE.match(t)
        if cat and len(t) < 260:
            story.append(
                Paragraph(f"<b>{esc(cat.group(1))}:</b> {esc(cat.group(2))}", body)
            )
            continue
        story.append(Paragraph(f"&bull; {esc(t)}", bullet))

    def on_page(canv, doc_):
        canv.saveState()
        canv.setFillColor(VOID)
        canv.rect(0, 0, doc_.pagesize[0], doc_.pagesize[1], fill=1, stroke=0)
        canv.restoreState()

    pdf = SimpleDocTemplate(
        OUT, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.45 * inch, bottomMargin=0.45 * inch,
        title="Samson Laird - Resume",
        author="Samson Laird",
    )
    pdf.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
