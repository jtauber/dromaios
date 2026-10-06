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
    if not isinstance(record, dict) or set(record) != {"sha256", "regions", "routines", "labels"} or record["sha256"] != firmware["sha256"]:
        raise ValueError("ROM annotations must identify the machine's declared firmware.")
    regions = record["regions"]
    if not isinstance(regions, list) or not regions:
        raise ValueError("The ROM guide must declare named regions.")
    previous = 0xcfff
    for region in regions:
        if (not isinstance(region, dict) or set(region) != {"start", "end", "name"}
                or not all(isinstance(value, str) and value.strip() for value in region.values())
                or not all(re.fullmatch(r"[D-F][0-9A-F]{3}", region[key]) for key in ("start", "end"))
                or not previous < int(region["start"], 16) <= int(region["end"], 16)):
            raise ValueError("ROM regions need names and ordered, non-overlapping ROM bounds.")
        previous = int(region["end"], 16)
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
        if not any(int(region["start"], 16) <= int(routine["address"], 16) <= int(region["end"], 16) for region in regions):
            raise ValueError("Every ROM entry must belong to a declared region.")
    labels = record["labels"]
    if not isinstance(labels, list):
        raise ValueError("The ROM guide's address labels must be a list.")
    for label in labels:
        if (not isinstance(label, dict) or set(label) not in ({"address", "name", "description", "scope"}, {"address", "name", "description", "scope", "bytes"})
                or not all(isinstance(label[key], str) and label[key].strip() for key in ("address", "name", "description", "scope"))
                or not re.fullmatch(r"[0-9A-F]{4}", label["address"])
                or label["address"] in addresses or label["name"] in names
                or label["scope"] not in {"workspace", "hardware", "rom"}):
            raise ValueError("Address labels need unique names and addresses, descriptions, and a known scope.")
        address = int(label["address"], 16)
        if "bytes" in label and (type(label["bytes"]) is not int or label["bytes"] != 2
                                or label["scope"] != "workspace" or address + 1 >= 0xc000):
            raise ValueError("Workspace words need two bytes within RAM.")
        if not (label["scope"] == "workspace" and address < 0xc000
                or label["scope"] == "hardware" and 0xc000 <= address <= 0xcfff
                or label["scope"] == "rom" and any(int(region["start"], 16) <= address <= int(region["end"], 16) for region in regions)):
            raise ValueError("Address labels must belong to the storage declared by their scope.")
        addresses.add(label["address"])
        names.add(label["name"])
    return record


def explorer_catalogue():
    result = subprocess.run(["node", "site/apple2-instructions.ts"], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True)
    cpu = json.loads(result.stdout)
    return {**rom_annotations(APPLE2_ROM.read_text(), cpu["firmware"]), "instructions": cpu["instructions"], "hardware": cpu["hardware"]}
