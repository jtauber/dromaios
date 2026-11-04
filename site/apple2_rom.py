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


def _dos_observation(text, pc):
    catalogue = re.fullmatch(r"read \$([0-9A-F]{4}) = \$([0-9A-F]{2}) for `([A-Z0-9 ][A-Z0-9 ]{0,29})`", text)
    if catalogue:
        return dict(address=int(catalogue[1], 16), value=int(catalogue[2], 16), catalogueName=catalogue[3])
    cell = re.fullmatch(r"page ([12]) text \((\d+),(\d+)\) \$([0-9A-F]{2}) → \$([0-9A-F]{2})", text)
    if cell and int(cell[2]) < 24 and int(cell[3]) < 40 and cell[4] != cell[5]:
        return dict(page=int(cell[1]), textCell=[int(cell[2]), int(cell[3])], before=int(cell[4], 16), after=int(cell[5], 16))
    pixel = re.fullmatch(r"page ([12]) lores \((\d+),(\d+)\) \$([0-9A-F]) → \$([0-9A-F])", text)
    if pixel and int(pixel[2]) < 40 and int(pixel[3]) < 48 and pixel[4] != pixel[5]:
        return dict(page=int(pixel[1]), loresPixel=[int(pixel[2]), int(pixel[3])], before=int(pixel[4], 16), after=int(pixel[5], 16))
    command = re.fullmatch(r"DOS command `([A-Z0-9 ,$]+)`", text)
    if command:
        return dict(dosCommand=command[1])
    store = re.fullmatch(r"write bank ([12]) \$(D[0-9A-F]{3}) = \$([0-9A-F]{2})", text)
    if store:
        return dict(bank=f"bank{store[1]}", address=int(store[2], 16), value=int(store[3], 16))
    sector = re.fullmatch(r"T(\d+) S(\d+) → \$([0-9A-F]{4})", text)
    if sector and int(sector[1]) < 35 and int(sector[2]) < 16:
        return dict(track=int(sector[1]), sector=int(sector[2]), buffer=int(sector[3], 16))
    access = re.fullmatch(r"(read|write) \$([0-9A-F]{4})(?: = \$([0-9A-F]{2}))?", text)
    if access:
        expect = dict(kind=access[1], address=int(access[2], 16))
        if access[3] is not None:
            expect["value"] = int(access[3], 16)
        return expect
    jump = re.fullmatch(r"JMP \(\$([0-9A-F]{4})\) at \$([0-9A-F]{4})", text)
    if jump:
        return dict(indirect=int(jump[1], 16), jumpFrom=int(jump[2], 16), target=int(pc[1:], 16))
    raise ValueError(f"Invalid observation at {pc}: {text}.")


def dos_walkthroughs(source):
    """Publish named stops from the machine chapter, retaining each tour's media and input requirements."""
    specs = {}
    for disk in ("Completed", "Interrupted"):
        specs[disk] = dict(id=f"answer-{disk.lower()}", title=f"LOAD ANSWER · {disk.lower()} disk",
                           file=dict(name="ANSWER", type="A"), setup=f"Boot the {disk.lower()} ANSWER export, run NEW and pause at the prompt. "
                           "Clear the DOS sector read trace in Disk to isolate this load.")
    specs["BEACON"] = dict(id="beacon", title="BLOAD and BRUN BEACON", file=dict(name="BEACON", type="B", address=0x6000, length=300),
                           setup="Boot the exported BEACON disk and pause at the Applesoft prompt. Clear the DOS sector read trace in Disk before starting BLOAD.")
    specs["System Master"] = dict(id="basic-switch", title="HELLO, INT and FP", fromPowerOn=True,
                                  file=dict(name="INTBASIC", type="B", address=0x1000, length=0x3000),
                                  setup="Insert the DOS 3.3 System Master read-only. Start at fresh power-on with the CPU paused.")
    specs["COLOR DEMO"] = dict(id="color-demo", title="RUN COLOR DEMO", file=dict(name="COLOR DEMO", type="I", entry=0x11e51, length=1921),
                               setup="Boot the DOS 3.3 System Master read-only. Pause at the first ] prompt with DOS VERSION still at the top left.")
    commands = {"Completed": {"LOAD ANSWER", "LIST"}, "Interrupted": {"LOAD ANSWER", "LIST"},
                "BEACON": {"BLOAD BEACON", "BRUN BEACON"}, "System Master": {"Boot", "INT", "FP"}, "COLOR DEMO": {"RUN COLOR DEMO", "3"}}
    boot_inputs = {
        "INT": "Resume until HELLO finishes at the ] prompt. Pause, queue INT with Return, then run to this checkpoint.",
        "FP": "Resume to the > prompt and enter PRINT 6*7. After 42, pause and queue FP with Return.",
    }
    header = "| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |"
    for tour in specs.values():
        tour["steps"] = []
    previous = {}
    for table in source.split(header)[1:]:
        lines = table.strip().split("\n\n", 1)[0].splitlines()
        for line in lines[1:]:
            medium, command, title, pc, observed, inspect, note = (c.strip() for c in line.strip("|").split("|"))
            destinations = ("Completed", "Interrupted") if medium == "Both" else (medium,)
            match = re.fullmatch(r"\$([0-9A-F]{4})(?: in (ROM|LC upper))?", pc)
            if not match or not re.fullmatch(r"\$[0-9A-F]{4}", inspect):
                raise ValueError(f"Invalid address in DOS checkpoint {title}.")
            address, mapping = match.groups()
            for disk in destinations:
                if disk not in specs or command not in commands[disk] or not title or not note:
                    raise ValueError(f"Invalid disk, command or description for DOS checkpoint {title}.")
                if command == "Boot":
                    prepare = "Continue the cold boot without entering a command."
                elif disk == "System Master":
                    prepare = boot_inputs[command]
                elif command == "3":
                    prepare = ("Continue Kaleidoscope without entering another key." if previous.get(disk) == command else
                               "Resume to WHICH WOULD YOU LIKE?, pause, then type 3 and press Return on the screen with Inspect off.")
                elif previous.get(disk) == command:
                    prepare = f"Continue {command} without entering another command."
                else:
                    prepare = f"With the CPU paused, queue {command} and press Return on the screen."
                previous[disk] = command
                step = dict(title=title, address=address, inspect=int(inspect[1:], 16),
                            expect=_dos_observation(observed, "$" + address), observe=note, prepare=prepare)
                if mapping:
                    step["space"] = {"ROM": "rom", "LC upper": "lc-upper"}[mapping]
                if command == "Boot":
                    step["limit"] = 25_000_000  # Cold boot reaches the first store after 20 million instructions.
                specs[disk]["steps"].append(step)
    if any(not tour["steps"] for tour in specs.values()):
        raise ValueError("Each DOS walkthrough needs checkpoints in the machine chapter.")
    return list(specs.values())
