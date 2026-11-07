from __future__ import annotations

import io
from typing import Any

import pypdf

from docuteach.export.typst_inline import PageStyle, read_page_style
from docuteach.export.typst_render import compile_pdf, render_source
from docuteach.md.parser import ParseResult, parse_markdown
from docuteach.md.project import StudentDoc, project_student


def student_doc(md: str) -> tuple[ParseResult, StudentDoc, PageStyle]:
    res = parse_markdown(md)
    sdoc = project_student(res.doc)
    page = read_page_style(res.doc.meta)
    return res, sdoc, page


def build_source(md: str) -> str:
    _, sdoc, page = student_doc(md)
    return render_source(sdoc, page).source


def build_pdf(md: str) -> bytes:
    return compile_pdf(build_source(md))


def pdf_text(pdf: bytes) -> str:
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def pdf_page_count(pdf: bytes) -> int:
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    return len(reader.pages)


def pdf_everything(pdf: bytes) -> str:
    parts: list[str] = []
    try:
        reader: Any = pypdf.PdfReader(io.BytesIO(pdf))
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        meta: Any = reader.metadata
        if meta is not None:
            for key in meta:
                parts.append(repr(meta[key]))
        for page in reader.pages:
            annots: Any = page.get("/Annots")
            if annots is not None:
                annots_obj: Any = annots.get_object()
                for item in annots_obj:
                    parts.append(repr(item))
        trailer: Any = reader.trailer
        info: Any = trailer.get("/Info")
        if info is not None:
            info_obj: Any = info.get_object()
            for key in info_obj:
                parts.append(repr(info_obj[key]))
    except Exception:
        pass
    return "\n".join(parts)


def pdf_fonts(pdf: bytes) -> set[str]:
    reader: Any = pypdf.PdfReader(io.BytesIO(pdf))
    fonts: set[str] = set()
    for page in reader.pages:
        try:
            resources: Any = page.get("/Resources")
            if resources is None:
                continue
            resources_obj: Any = resources.get_object()
            font_dict: Any = resources_obj.get("/Font")
            if font_dict is None:
                continue
            font_obj: Any = font_dict.get_object()
            for key in font_obj:
                font_entry: Any = font_obj[key].get_object()
                base_font: Any = font_entry.get("/BaseFont")
                if base_font is not None:
                    fonts.add(str(base_font).lstrip("/"))
        except Exception:
            continue
    return fonts


def squash(s: str) -> str:
    return "".join(s.split())
