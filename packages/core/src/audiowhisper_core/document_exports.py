from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape


def export_document(fmt: str, title: str, markdown: str) -> bytes:
    """Render plain, escaped document content without evaluating HTML or fetching assets."""
    output = BytesIO()
    if fmt == "docx":
        from docx import Document
        from docx.shared import Inches, Pt, RGBColor
        document = Document()
        section = document.sections[0]
        section.top_margin = section.bottom_margin = Inches(.8)
        normal = document.styles["Normal"]
        normal.font.name, normal.font.size = "Calibri", Pt(11)
        normal.font.color.rgb = RGBColor.from_string("253442")
        normal.paragraph_format.space_after = Pt(8)
        document.core_properties.title = title
        for line in markdown.splitlines():
            if line.startswith("# "):
                document.add_heading(line[2:], 0)
            elif line.startswith("## "):
                document.add_heading(line[3:], 1)
            elif line.startswith("- "):
                document.add_paragraph(line[2:], style="List Bullet")
            elif line.strip():
                document.add_paragraph(line)
        section.footer.paragraphs[0].text = "AudioWhisper Studio · Processamento local"
        document.save(output)
    elif fmt == "pdf":
        import reportlab
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
        font = Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"
        if "AudioWhisper" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("AudioWhisper", str(font)))
        styles = getSampleStyleSheet()
        for style in styles.byName.values():
            style.fontName = "AudioWhisper"
        styles["Normal"].leading = 16
        styles["Normal"].spaceAfter = 8
        styles["Title"].textColor = colors.HexColor("#163948")
        story = []
        for line in markdown.splitlines():
            style = "Title" if line.startswith("# ") else "Heading2" if line.startswith("## ") else "Normal"
            content = line[2:] if line.startswith("# ") else line[3:] if line.startswith("## ") else line
            if content.strip():
                story.append(Paragraph(escape(content), styles[style]))
            else:
                story.append(Spacer(1, 6))
        def footer(canvas, document):
            canvas.setFont("AudioWhisper", 8)
            canvas.setFillColor(colors.HexColor("#526879"))
            canvas.drawString(48, 30, "AudioWhisper Studio · Processamento local")
            canvas.drawRightString(A4[0] - 48, 30, str(document.page))
        SimpleDocTemplate(output, pagesize=A4, rightMargin=48, leftMargin=48, topMargin=48, bottomMargin=54, title=title).build(story, onFirstPage=footer, onLaterPages=footer)
    else:
        raise ValueError("Formato de documento não suportado")
    return output.getvalue()
