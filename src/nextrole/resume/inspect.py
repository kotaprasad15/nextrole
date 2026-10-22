"""Inspect, sanitize and extract text from an uploaded resume (PDF or DOCX).

An upload is untrusted input to a parser, to the database and, through its text, to an LLM. This
module is the one place that decides what is allowed to go any further:

1. Type by MAGIC BYTES (never the extension or the client's content type), size and page limits.
2. Active content is rejected: JavaScript, launch actions, XFA forms (PDF); macros, embedded OLE
   objects, ActiveX, remote templates (DOCX). Zip bombs (entry count, expanded size, ratio) too.
3. Hidden text is detected (white fill, invisible render mode, tiny fonts, text positioned off the
   page; hidden runs in DOCX), REMOVED from the text the model will see, and reported. Hidden text
   that addresses an AI is grounds for rejecting the file.
4. Instruction-like phrases in visible text are flagged (they still reach the model only inside a
   delimited data block with no tools attached; see llm/untrusted.py).
5. A sanitized copy is produced (PDF rebuilt page by page without annotations, attachments,
   scripts or document metadata; DOCX core properties cleared). THAT copy is what gets stored.

Nothing is executed or rendered: we read text and structure only. Run this through
`resume/sandbox.py` so a parser crash or hang cannot take the API down.
"""
import io
import math
import re
import zipfile
from dataclasses import dataclass, field

from docx import Document
from docx.shared import Pt
from pypdf import PdfReader, PdfWriter

from nextrole.security.injection import scan

REJECT, FLAG = "reject", "flag"
ACTIVE_PDF_ACTIONS = {"/JavaScript", "/Launch", "/ImportData", "/SubmitForm", "/Rendition", "/Movie",
                      "/Sound", "/GoToR", "/GoToE", "/SetOCGState"}
_RAW_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|RichMedia|XFA|SubmitForm|ImportData)\b")
_RAW_ATTACH = re.compile(rb"/(EmbeddedFile|EmbeddedFiles|FileAttachment)\b")
_TINY_PT = 3.5
_NEAR_WHITE = 0.92
_OFFPAGE_MARGIN = 10.0


class ResumeError(ValueError):
    """User-correctable (or hostile) problem with an uploaded resume; the message is safe to show."""


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 5 * 1024 * 1024
    max_pages: int = 10
    max_text_chars: int = 60_000
    max_zip_entries: int = 2_000
    max_zip_uncompressed: int = 50 * 1024 * 1024
    max_zip_ratio: int = 200
    min_text_chars: int = 50


@dataclass
class Finding:
    code: str
    severity: str  # "reject" | "flag"
    detail: str = ""


@dataclass
class Inspection:
    kind: str  # "pdf" | "docx"
    text: str  # visible text only: this is all the model ever sees
    hidden_text: str = ""
    findings: list[Finding] = field(default_factory=list)
    sanitized: bytes = b""
    pages: int = 0

    @property
    def flags(self) -> list[str]:
        return sorted({f.code for f in self.findings})


# ---------------------------------------------------------------------------------------------
def inspect_resume(data: bytes, limits: Limits | None = None) -> Inspection:
    limits = limits or Limits()
    if not data:
        raise ResumeError("empty file")
    if len(data) > limits.max_bytes:
        raise ResumeError(f"file too large (max {limits.max_bytes // (1024 * 1024)} MB)")
    if data.startswith(b"%PDF"):
        result = _inspect_pdf(data, limits)
    elif data.startswith(b"PK") and zipfile.is_zipfile(io.BytesIO(data)):
        result = _inspect_docx(data, limits)
    else:
        raise ResumeError("unsupported file type: upload a PDF or DOCX")
    return _finish(result, limits)


def _finish(result: Inspection, limits: Limits) -> Inspection:
    if len(result.text) > limits.max_text_chars:
        raise ResumeError("that file has far more text than a resume; upload just your resume")
    if len(result.text.strip()) < limits.min_text_chars:
        raise ResumeError("could not read text from the file (scanned image PDFs are unsupported)")
    if result.hidden_text:
        hidden_hits = scan(result.hidden_text)
        if hidden_hits:
            raise ResumeError("this file contains hidden text that tries to instruct an AI, so it was rejected")
        result.findings.append(Finding("hidden_text", FLAG, f"{len(result.hidden_text)} characters removed"))
    for hit in scan(result.text):
        result.findings.append(Finding("injection_phrase", FLAG, hit.code))
    rejects = [f for f in result.findings if f.severity == REJECT]
    if rejects:
        raise ResumeError(_REJECT_MESSAGES.get(rejects[0].code, "this file contains content we cannot accept"))
    return result


_REJECT_MESSAGES = {
    "pdf_encrypted": "encrypted or password-protected PDFs are not supported",
    "pdf_too_many_pages": "that PDF has too many pages for a resume",
    "pdf_active_content": "this PDF contains scripts or launch actions, so it was rejected",
    "pdf_xfa": "this PDF contains an interactive form with scripts, so it was rejected",
    "zip_bomb": "this file expands to an unreasonable size, so it was rejected",
    "docx_macro": "this document contains macros or embedded objects, so it was rejected",
    "docx_external_template": "this document links to an external template, so it was rejected",
}


# ---- PDF ------------------------------------------------------------------------------------
def _name(obj) -> str:
    try:
        return str(obj.get_object())
    except Exception:
        return ""


def _action_findings(action, out: list[Finding], where: str) -> None:
    try:
        action = action.get_object()
        kind = _name(action.get("/S"))
    except Exception:
        return
    if kind in ACTIVE_PDF_ACTIONS:
        out.append(Finding("pdf_active_content", REJECT, f"{where}: {kind}"))
    nxt = action.get("/Next") if hasattr(action, "get") else None
    if nxt is not None:
        for a in (nxt if isinstance(nxt, list) else [nxt]):
            _action_findings(a, out, where)


def _structure_findings(reader: PdfReader, data: bytes) -> list[Finding]:
    out: list[Finding] = []
    try:
        root = reader.trailer["/Root"]
    except Exception:
        return [Finding("pdf_unreadable", REJECT, "no catalog")]
    if "/OpenAction" in root:
        _action_findings(root["/OpenAction"], out, "open action")
    if "/AA" in root:
        out.append(Finding("pdf_active_content", REJECT, "document additional actions"))
    names = root.get("/Names")
    if names is not None:
        names = names.get_object()
        if "/JavaScript" in names:
            out.append(Finding("pdf_active_content", REJECT, "named JavaScript"))
        if "/EmbeddedFiles" in names:
            out.append(Finding("pdf_embedded_file", FLAG, "attachments removed"))
    form = root.get("/AcroForm")
    if form is not None and "/XFA" in form.get_object():
        out.append(Finding("pdf_xfa", REJECT, "XFA form"))
    for i, page in enumerate(reader.pages):
        if "/AA" in page:
            out.append(Finding("pdf_active_content", REJECT, f"page {i + 1} actions"))
        for annot in page.get("/Annots") or []:
            try:
                annot = annot.get_object()
            except Exception:
                continue
            if "/A" in annot:
                _action_findings(annot["/A"], out, f"page {i + 1} link")
            if "/AA" in annot:
                out.append(Finding("pdf_active_content", REJECT, f"page {i + 1} annotation actions"))
            if _name(annot.get("/Subtype")) == "/FileAttachment":
                out.append(Finding("pdf_embedded_file", FLAG, "attachment removed"))
    # Belt and braces for what the object walk can miss (names are matched after #xx unescaping).
    plain = re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), data)
    if _RAW_ACTIVE.search(plain) and not any(f.code in {"pdf_active_content", "pdf_xfa"} for f in out):
        out.append(Finding("pdf_active_content", REJECT, "script marker in file bytes"))
    if _RAW_ATTACH.search(plain) and not any(f.code == "pdf_embedded_file" for f in out):
        out.append(Finding("pdf_embedded_file", FLAG, "attachment marker in file bytes"))
    return out


class _TextWalker:
    """Collects visible and hidden text from one PDF page via pypdf's content-stream visitors,
    tracking fill colour (g/rg/k/sc/scn with q/Q), render mode (Tr) and the effective font size."""

    def __init__(self, width: float, height: float) -> None:
        self.w, self.h = width, height
        self.color: tuple[float, ...] = (0.0,)
        self.stack: list[tuple[float, ...]] = []
        self.render_mode = 0
        self.visible: list[str] = []
        self.hidden: list[str] = []
        self.reasons: set[str] = set()

    def operand(self, op, args, cm, tm) -> None:
        op = op.decode() if isinstance(op, bytes) else str(op)
        vals = [float(a) for a in args if isinstance(a, (int, float))] if args else []
        if op == "q":
            self.stack.append(self.color)
        elif op == "Q" and self.stack:
            self.color = self.stack.pop()
        elif op in {"g", "rg", "k"} and vals or op in {"sc", "scn"} and len(vals) in {1, 3, 4}:
            self.color = tuple(vals)
        elif op == "Tr" and vals:
            self.render_mode = int(vals[0])

    def _near_white(self) -> bool:
        c = self.color
        if len(c) == 1:
            return c[0] >= _NEAR_WHITE
        if len(c) == 3:
            return min(c) >= _NEAR_WHITE
        if len(c) == 4:  # CMYK: all inks ~0 is white
            return max(c) <= 1 - _NEAR_WHITE
        return False

    def text(self, text, cm, tm, font_dict, font_size) -> None:
        if not text or not text.strip():
            self.visible.append(text or "")
            return
        cm = list(cm or [1, 0, 0, 1, 0, 0])
        tm = list(tm or [1, 0, 0, 1, 0, 0])
        a = tm[0] * cm[0] + tm[1] * cm[2]
        b = tm[0] * cm[1] + tm[1] * cm[3]
        c = tm[2] * cm[0] + tm[3] * cm[2]
        d = tm[2] * cm[1] + tm[3] * cm[3]
        size = abs(float(font_size or 0)) * math.sqrt(abs(a * d - b * c))
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        reasons = set()
        if self.render_mode == 3:
            reasons.add("invisible_render_mode")
        if self._near_white():
            reasons.add("white_text")
        if 0 < size < _TINY_PT:
            reasons.add("tiny_text")
        if not (-_OFFPAGE_MARGIN <= x <= self.w + _OFFPAGE_MARGIN and -_OFFPAGE_MARGIN <= y <= self.h + _OFFPAGE_MARGIN):
            reasons.add("offpage_text")
        if reasons:
            self.hidden.append(text)
            self.reasons |= reasons
        else:
            self.visible.append(text)


def _inspect_pdf(data: bytes, limits: Limits) -> Inspection:
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise ResumeError(_REJECT_MESSAGES["pdf_encrypted"])
        pages = len(reader.pages)
    except ResumeError:
        raise
    except Exception as exc:
        raise ResumeError("could not parse PDF") from exc
    if pages > limits.max_pages:
        raise ResumeError(_REJECT_MESSAGES["pdf_too_many_pages"])
    try:
        findings = _structure_findings(reader, data)
    except Exception as exc:
        raise ResumeError("could not parse PDF") from exc
    if any(f.severity == REJECT for f in findings):
        raise ResumeError(_REJECT_MESSAGES.get(next(f.code for f in findings if f.severity == REJECT),
                                               "this PDF cannot be accepted"))
    visible: list[str] = []
    hidden: list[str] = []
    for page in reader.pages:
        walker = _TextWalker(float(page.mediabox.width), float(page.mediabox.height))
        try:
            page.extract_text(visitor_operand_before=walker.operand, visitor_text=walker.text)
        except Exception as exc:
            raise ResumeError("could not parse PDF") from exc
        visible.append("".join(walker.visible))
        hidden.append("".join(walker.hidden))
        for reason in sorted(walker.reasons):
            findings.append(Finding(reason, FLAG))
    return Inspection(kind="pdf", text="\n".join(visible).strip(), hidden_text="\n".join(hidden).strip(),
                      findings=findings, sanitized=_sanitize_pdf(reader), pages=pages)


def _sanitize_pdf(reader: PdfReader) -> bytes:
    """Rebuild the PDF page by page: no annotations/links, attachments, scripts, forms or metadata."""
    writer = PdfWriter()
    for page in reader.pages:
        for key in ("/Annots", "/AA", "/Metadata"):
            if key in page:
                del page[key]
        writer.add_page(page)
    writer.add_metadata({"/Producer": "", "/Creator": "", "/Author": "", "/Title": ""})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ---- DOCX -----------------------------------------------------------------------------------
_EXTERNAL_REL = re.compile(
    rb'Type="[^"]*/(attachedTemplate|oleObject|frame|subDocument|externalLink)"[^>]*TargetMode="External"|'
    rb'TargetMode="External"[^>]*Type="[^"]*/(attachedTemplate|oleObject|frame|subDocument|externalLink)"')


def _docx_container_findings(data: bytes, limits: Limits) -> list[Finding]:
    out: list[Finding] = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        if len(infos) > limits.max_zip_entries or sum(i.file_size for i in infos) > limits.max_zip_uncompressed:
            return [Finding("zip_bomb", REJECT, "too many or too large entries")]
        for i in infos:
            if i.compress_size and i.file_size / i.compress_size > limits.max_zip_ratio and i.file_size > 1_000_000:
                return [Finding("zip_bomb", REJECT, "extreme compression ratio")]
        names = [i.filename.lower() for i in infos]
        if any("vbaproject" in n or n.startswith(("word/embeddings/", "word/activex/"))
               or n.endswith("oleobject1.bin") for n in names):
            out.append(Finding("docx_macro", REJECT, "macro or embedded object parts"))
        for i in infos:
            if i.filename.endswith(".rels") and _EXTERNAL_REL.search(z.read(i)):
                out.append(Finding("docx_external_template", REJECT, i.filename))
    return out


def _near_white_rgb(rgb) -> bool:
    return rgb is not None and min(rgb[0], rgb[1], rgb[2]) >= int(_NEAR_WHITE * 255)


def _inspect_docx(data: bytes, limits: Limits) -> Inspection:
    try:
        findings = _docx_container_findings(data, limits)
    except zipfile.BadZipFile as exc:
        raise ResumeError("could not parse DOCX") from exc
    if any(f.severity == REJECT for f in findings):
        raise ResumeError(_REJECT_MESSAGES[next(f.code for f in findings if f.severity == REJECT)])
    try:
        doc = Document(io.BytesIO(data))
    except Exception as exc:
        raise ResumeError("could not parse DOCX") from exc

    visible: list[str] = []
    hidden: list[str] = []
    reasons: set[str] = set()

    def walk_paragraph(p) -> None:
        keep, drop = [], []
        for run in p.runs:
            why = []
            if run.font.hidden:
                why.append("hidden_run")
            if run.font.size is not None and run.font.size < Pt(_TINY_PT):
                why.append("tiny_text")
            try:
                color = run.font.color.rgb if run.font.color is not None else None
            except Exception:
                color = None
            if _near_white_rgb(color):
                why.append("white_text")
            (drop if why else keep).append(run.text)
            reasons.update(why)
        if keep:
            visible.append("".join(keep))
        if drop:
            hidden.append("".join(drop))

    def walk_container(container) -> None:
        for p in container.paragraphs:
            walk_paragraph(p)
        for table in container.tables:
            for row in table.rows:
                for cell in row.cells:
                    walk_container(cell)

    walk_container(doc)
    for section in doc.sections:
        walk_container(section.header)
        walk_container(section.footer)
    for reason in sorted(reasons):
        findings.append(Finding(reason, FLAG))

    props = doc.core_properties  # metadata: names, company, comments, revision history hints
    for attr in ("author", "last_modified_by", "title", "subject", "comments", "keywords", "category",
                 "content_status", "identifier", "language", "version"):
        try:
            setattr(props, attr, "")
        except Exception:
            pass
    out = io.BytesIO()
    doc.save(out)
    return Inspection(kind="docx", text="\n".join(visible).strip(), hidden_text="\n".join(hidden).strip(),
                      findings=findings, sanitized=out.getvalue())
