"""The ROM walkthrough owns its versioned symbols; the CPU chapter owns instruction metadata."""

import json
import re
import subprocess
from pathlib import Path

from rom_annotations import validate_rom_annotations

ROOT = Path(__file__).resolve().parent.parent
APPLE2_ROM = ROOT / "docs/software/apple2p-rom.md"


def rom_annotations(source, firmware):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError("The ROM guide must have exactly one annotation record.")
    return validate_rom_annotations(json.loads(fences[0]), firmware, rom_ranges=[(0xd000, 0xffff)],
                                    ram_end=0xc000, hardware_ranges=[(0xc000, 0xcfff)], instruction_bytes=3)


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


def load_answer_walkthroughs(source):
    """Read the named stops from the machine chapter's laboratory table."""
    header = "| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |"
    if source.count(header) != 1:
        raise ValueError("The Apple II guide needs one LOAD ANSWER checkpoint table.")
    table = source.split(header)[1].strip().split("\n\n", 1)[0]
    rows = [[cell.strip() for cell in line.strip("|").split("|")] for line in table.splitlines()[1:]]
    tours = []
    for disk in ("Completed", "Interrupted"):
        steps = []
        previous_command = None
        for medium, command, title, pc, observed, inspect, note in rows:
            if medium not in {"Both", "Completed", "Interrupted"}:
                raise ValueError(f"Unknown ANSWER disk {medium}.")
            if medium not in {"Both", disk}:
                continue
            if command not in {"LOAD ANSWER", "LIST"} or not title or not note:
                raise ValueError(f"Missing command or description for ANSWER checkpoint {title}.")
            if not all(re.fullmatch(r"\$[0-9A-F]{4}", text) for text in (pc, inspect)):
                raise ValueError(f"Invalid address in ANSWER checkpoint {title}.")
            sector = re.fullmatch(r"T(\d+) S(\d+) → \$([0-9A-F]{4})", observed)
            access = re.fullmatch(r"(read|write) \$([0-9A-F]{4})(?: = \$([0-9A-F]{2}))?", observed)
            if sector and int(sector[1]) < 35 and int(sector[2]) < 16:
                expect = dict(track=int(sector[1]), sector=int(sector[2]), buffer=int(sector[3], 16))
            elif access:
                expect = dict(kind=access[1], address=int(access[2], 16))
                if access[3] is not None:
                    expect["value"] = int(access[3], 16)
            else:
                raise ValueError(f"Invalid observation in ANSWER checkpoint {title}.")
            prepare = (f"With the CPU paused, queue {command} and press Return on the screen." if previous_command != command
                       else f"Continue {command} without entering another command.")
            previous_command = command
            steps.append(dict(title=title, address=pc[1:], inspect=int(inspect[1:], 16),
                              expect=expect, observe=note, prepare=prepare))
        if not steps:
            raise ValueError(f"No LOAD checkpoints for the {disk.lower()} disk.")
        tours.append(dict(id=f"answer-{disk.lower()}", title=f"LOAD ANSWER · {disk.lower()} disk",
                          setup=f"Boot the {disk.lower()} ANSWER export, run NEW and pause at the prompt. "
                                "Clear the DOS sector read trace in Disk to isolate this load.", steps=steps))
    return tours
