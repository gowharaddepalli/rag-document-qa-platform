"""Page-preserving PDF text extraction. Page numbers are 1-based, matching what PDF viewers show."""
from io import BytesIO

from pypdf import PdfReader


def extract_pages(data: bytes) -> list[dict]:
    reader = PdfReader(BytesIO(data))
    return [{"page": i + 1, "text": page.extract_text() or ""} for i, page in enumerate(reader.pages)]