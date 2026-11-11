"""The owner's private footprint. Reads `Personal Data/`, writes only to `private/`."""


def run_part(part: str) -> int:
    parts = ["roles", "connections", "education", "footprint"] if part == "all" else [part]
    for p in parts:
        mod = __import__(f"imap.personal.{p}", fromlist=["run"])
        rc = mod.run_education() if p == "education" else mod.run()
        if rc:
            return rc
    return 0
