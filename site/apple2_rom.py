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
    if not isinstance(record, dict) or set(record) != {"sha256", "regions", "routines", "labels", "notes", "walkthroughs"} or record["sha256"] != firmware["sha256"]:
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
        if (not isinstance(routine, dict) or set(routine) not in ({"address", "name", "description"}, {"address", "name", "description", "details"})
                or not all(isinstance(routine[key], str) and routine[key].strip() for key in ("address", "name", "description"))
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
    routine_names = {entry["name"] for entry in routines}
    workspace_names = {entry["name"] for entry in labels if entry["scope"] == "workspace"}

    def references(value, allowed):
        return (isinstance(value, list) and all(isinstance(name, str) and name in allowed for name in value)
                and len(value) == len(set(value)))

    for routine in routines:
        if "details" not in routine:
            continue
        details = routine["details"]
        if (not isinstance(details, dict) or set(details) != {"inputs", "outputs", "workspace", "related"}
                or not all(isinstance(details[key], str) and details[key].strip() for key in ("inputs", "outputs"))
                or not references(details["workspace"], workspace_names)
                or not references(details["related"], routine_names)):
            raise ValueError("Routine details need inputs, outputs, and valid workspace/routine references.")

    def rom_address(address):
        return (isinstance(address, str) and re.fullmatch(r"[D-F][0-9A-F]{3}", address)
                and any(int(region["start"], 16) <= int(address, 16) <= int(region["end"], 16) for region in regions))

    notes = record["notes"]
    if not isinstance(notes, list):
        raise ValueError("ROM instruction notes must be a list.")
    note_addresses = set()
    for note in notes:
        if (not isinstance(note, dict) or set(note) != {"address", "bytes", "text"}
                or not rom_address(note["address"]) or note["address"] in note_addresses
                or not isinstance(note["bytes"], str) or not re.fullmatch(r"[0-9A-F]{2}( [0-9A-F]{2}){0,2}", note["bytes"])
                or int(note["address"], 16) + len(note["bytes"].split()) > 0x10000
                or not isinstance(note["text"], str) or not note["text"].strip()):
            raise ValueError("ROM notes need unique ROM addresses, one instruction's bytes, and explanatory text.")
        note_addresses.add(note["address"])
    tours = record["walkthroughs"]
    if not isinstance(tours, list) or not tours:
        raise ValueError("The guide must declare ROM walkthroughs.")
    tour_ids = set()
    for tour in tours:
        if (not isinstance(tour, dict) or set(tour) != {"id", "title", "setup", "steps"}
                or not all(isinstance(tour[key], str) and tour[key].strip() for key in ("id", "title", "setup"))
                or not re.fullmatch(r"[a-z][a-z0-9-]*", tour["id"]) or tour["id"] in tour_ids
                or not isinstance(tour["steps"], list) or not tour["steps"]):
            raise ValueError("Walkthroughs need unique IDs, titles, setup instructions, and checkpoints.")
        tour_ids.add(tour["id"])
        for step in tour["steps"]:
            if (not isinstance(step, dict) or set(step) != {"title", "address", "prepare", "observe", "routine"}
                    or not all(isinstance(value, str) and value.strip() for value in step.values())
                    or not rom_address(step["address"]) or step["routine"] not in routine_names
                    or step["address"] not in note_addresses | {entry["address"] for entry in routines}):
                raise ValueError("Checkpoints need a documented ROM instruction, guidance, and a known routine reference.")
    return record


def explorer_catalogue():
    result = subprocess.run(["node", "site/apple2-instructions.ts"], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True)
    cpu = json.loads(result.stdout)
    guide = rom_annotations(APPLE2_ROM.read_text(), cpu["firmware"])
    for note in guide["notes"]:
        encoded = note["bytes"].split()
        instruction = cpu["instructions"].get(str(int(encoded[0], 16)))
        if instruction is None or instruction["length"] != len(encoded):
            raise ValueError(f"ROM note at ${note['address']} must describe one supported instruction.")
    return {**guide, "instructions": cpu["instructions"], "hardware": cpu["hardware"]}
