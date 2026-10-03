"""The ROM walkthrough owns its versioned symbols; the CPU chapter owns instruction metadata."""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPLE2_ROM = ROOT / "docs/software/apple2p-rom.md"


def rom_annotations(source, firmware):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError("The ROM guide must have exactly one annotation record.")
    record = json.loads(fences[0])
    if not isinstance(record, dict) or set(record) != {"sha256", "routines"} or record["sha256"] != firmware["sha256"]:
        raise ValueError("ROM annotations must identify the machine's declared firmware.")
    routines = record["routines"]
    if not isinstance(routines, list) or not routines:
        raise ValueError("The ROM guide must declare routine stops.")
    addresses, names = set(), set()
    for routine in routines:
        if (not isinstance(routine, dict) or set(routine) != {"address", "name", "description"}
                or not all(isinstance(value, str) and value.strip() for value in routine.values())
                or not re.fullmatch(r"[D-F][0-9A-F]{3}", routine["address"])
                or routine["address"] in addresses or routine["name"] in names):
            raise ValueError("ROM routines need unique names and ROM addresses, and descriptions.")
        addresses.add(routine["address"])
        names.add(routine["name"])
    return record


def explorer_catalogue():
    result = subprocess.run(["node", "site/apple2-instructions.ts"], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True)
    cpu = json.loads(result.stdout)
    return {**rom_annotations(APPLE2_ROM.read_text(), cpu["firmware"]), "instructions": cpu["instructions"]}
