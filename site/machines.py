"""Published machine guides and the media records authored in them."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALTAIR = ROOT / "src/machines/8080/altair-basic.md"
MACHINES = {ALTAIR: "machines/altair-8800/"}


def media_record(source):
    records = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(records) != 1:
        raise ValueError("The Altair guide must have exactly one JSON media record.")
    media = json.loads(records[0])
    if (set(media) != {"bytes", "sha256"} or type(media["bytes"]) is not int
            or media["bytes"] <= 0 or not isinstance(media["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", media["sha256"])):
        raise ValueError("Media requires a positive byte count and a lowercase SHA-256 digest.")
    return media
