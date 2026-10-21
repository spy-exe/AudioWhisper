"""Isolates the python-magic (libmagic) dependency behind a lazy import.

libmagic is a Linux/C dependency provided by the Docker image (apt libmagic1). Importing the
`magic` binding at module load time is unsafe outside that environment, so the import happens
only inside this function, at call time, keeping local tooling (tests, type-checkers) that never
call it unaffected.
"""


def sniff_mime(path: str) -> str:
    import magic

    return magic.from_file(path, mime=True)
