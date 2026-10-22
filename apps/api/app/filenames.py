import re
import unicodedata

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._\- ]")
_MAX_DISPLAY_NAME_LENGTH = 255


def sanitize_display_name(raw_name: str) -> str:
    """Strip any path components and unsafe characters. Used only for display/metadata,
    never as part of an on-disk path (stored files are always named by their generated id)."""
    name = raw_name.replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFKC", name).strip()
    name = _UNSAFE_CHARS.sub("_", name)
    name = name.lstrip(".")  # avoid dotfiles / ".." collapsing into an empty name
    if not name:
        name = "arquivo"
    return name[:_MAX_DISPLAY_NAME_LENGTH]


def extract_extension(display_name: str) -> str:
    if "." not in display_name:
        return ""
    return display_name.rsplit(".", 1)[-1].lower()


def content_disposition(filename: str) -> str:
    """attachment header with an ASCII fallback plus the RFC 6266/5987 UTF-8 name."""
    from urllib.parse import quote

    fallback = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    fallback = re.sub(r'[^A-Za-z0-9._ -]+', "_", fallback).strip() or "download"
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(filename, safe="")}'
