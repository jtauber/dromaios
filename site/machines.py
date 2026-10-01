"""Published machine guides and the media records authored in them."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALTAIR = ROOT / "src/machines/8080/altair-basic.md"
APPLE2 = ROOT / "src/machines/6502/apple2.md"
MACHINES = {ALTAIR: "machines/altair-8800/", APPLE2: "machines/apple-ii-plus/"}


def media_record(source):
    return read_media_record(source, {"bytes", "sha256"})


def rom_container_record(source):
    media = read_media_record(source, {"bytes", "sha256", "offset"})
    if type(media["offset"]) is not int or not 0 <= media["offset"] < media["bytes"]:
        raise ValueError("ROM container offset must lie within the file.")
    return media


def read_media_record(source, fields):
    records = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(records) != 1:
        raise ValueError("The machine guide must have exactly one JSON media record.")
    media = json.loads(records[0])
    if (set(media) != fields or type(media["bytes"]) is not int
            or media["bytes"] <= 0 or not isinstance(media["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", media["sha256"])):
        raise ValueError("Media requires a positive byte count and a lowercase SHA-256 digest.")
    return media
