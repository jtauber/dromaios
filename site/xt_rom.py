"""Publish the BIOS annotations and the Ultima V walkthrough from their respective chapters."""

import json
import re

from rom_annotations import validate_rom_annotations


def _guide_record(source, title):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError(f"The {title} must contain one JSON guide.")
    return json.loads(fences[0])


def _physical_address(text):
    if not isinstance(text, str) or not re.fullmatch(r"[0-9A-F]{4}:[0-9A-F]{4}", text):
        raise ValueError(f"Expected a canonical CS:IP pair, got {text!r}.")
    segment, offset = (int(part, 16) for part in text.split(":"))
    return (segment * 16 + offset) & 0xfffff


def _ultima_observation(expect):
    if not isinstance(expect, dict):
        return False
    if set(expect) == {"missingFile"}:
        name = expect["missingFile"]
        return isinstance(name, str) and name.isascii() and bool(name)
    if set(expect) not in ({"party"}, {"party", "partyRead"}) or expect.get("partyRead", True) is not True:
        return False
    party = expect["party"]
    return isinstance(party, list) and len(party) == 3 and all(type(b) is int and 0 <= b <= 255 for b in party)


def ultima_walkthrough(source):
    """The software guide describes a particular DOS load layout in RAM."""
    tour = _guide_record(source, "Ultima V workload")
    if not tour.get("steps") or not all(isinstance(tour.get(k), str) and tour[k].strip() for k in ("id", "title", "setup")):
        raise ValueError("The Ultima V walkthrough needs an introduction and checkpoints.")
    for step in tour["steps"]:
        if not all(isinstance(step.get(k), str) and step[k].strip() for k in ("title", "prepare", "observe")):
            raise ValueError("Each Ultima V checkpoint needs preparation and observations.")
        step["address"] = f"{_physical_address(step.get('execution')):05X}"
        if not _ultima_observation(step.get("expect")):
            raise ValueError(f"Invalid guest observation at {step['execution']}.")
    return tour


def _dos_observation(expect, ram_end):
    if not isinstance(expect, dict) or not {"bytes"} <= set(expect) <= {"bytes", "registers", "screen"}:
        return False
    signature = expect["bytes"]
    if (not isinstance(signature, dict) or set(signature) != {"address", "value"}
            or not isinstance(signature["address"], str) or not re.fullmatch(r"[0-9A-F]{5}", signature["address"])
            or not isinstance(signature["value"], str) or not re.fullmatch(r"[0-9A-F]{2}( [0-9A-F]{2}){0,63}", signature["value"])
            or int(signature["address"], 16) + len(signature["value"].split()) > ram_end):
        return False
    registers = expect.get("registers", {})
    if (not isinstance(registers, dict) or not set(registers) <= {"ax", "cx", "dx", "ds", "es", "ss", "sp"}
            or not all(isinstance(v, str) and re.fullmatch(r"[0-9A-F]{4}", v) for v in registers.values())):
        return False
    if "screen" not in expect:
        return True
    screen = expect["screen"]
    return (isinstance(screen, dict) and set(screen) == {"contains", "lastLine"}
            and all(isinstance(v, str) and v.strip() and v.isascii() for v in screen.values()))


def xt_annotations(source, catalogue):
    storage = catalogue["storage"]
    ram_end = next(r["size"] for r in storage if r["component"] == "ram")
    record = _guide_record(source, "XT chapter")
    io = record.pop("io", None)
    if (not isinstance(io, dict) or set(io) != {"ports", "irqs"} or not isinstance(io["ports"], list)
            or not isinstance(io["irqs"], list) or len(io["irqs"]) != 8
            or not all(isinstance(name, str) and name.strip() for name in io["irqs"])):
        raise ValueError("XT I/O labels need ports and eight IRQ sources.")
    previous = -1
    for port in io["ports"]:
        if (not isinstance(port, dict) or set(port) not in ({"address", "input"}, {"address", "output"}, {"address", "input", "output"})
                or not all(isinstance(value, str) and value.strip() for value in port.values())
                or not re.fullmatch(r"[0-9A-F]{4}", port["address"]) or int(port["address"], 16) <= previous):
            raise ValueError("XT port labels need unique ordered 16-bit addresses and input/output names.")
        previous = int(port["address"], 16)
    # Event checkpoints retain a documented ROM location for explanation and browsing.
    # Validate machine-specific conditions here; the common guide still validates all ROM references.
    extras = []
    for tour in record["walkthroughs"]:
        for step in tour["steps"]:
            extra = {key: step.pop(key) for key in ("event", "memory", "expect", "file") if key in step}
            if tour["id"] == "hello-com":
                if (set(step) != {"title", "address", "execution", "prepare", "observe"}
                        or not all(isinstance(v, str) and v.strip() for v in step.values())
                        or not re.fullmatch(r"[0-9A-F]{5}", step["address"])
                        or _physical_address(step["execution"]) != int(step["address"], 16)
                        or not (int(step["address"], 16) < ram_end or 0xfe000 <= int(step["address"], 16) <= 0xfffff)
                        or extra.get("file") != "HELLO.COM" or "memory" not in extra
                        or not _dos_observation(extra.get("expect"), ram_end)):
                    raise ValueError("HELLO.COM checkpoints need checked code locations, memory, file links and DOS observations.")
            elif "expect" in extra or "file" in extra:
                raise ValueError("DOS observations belong to the HELLO.COM walkthrough.")
            if "memory" in extra and (not isinstance(extra["memory"], str) or not re.fullmatch(r"[0-9A-F]{5}", extra["memory"])
                                       or int(extra["memory"], 16) >= next(r["size"] for r in storage if r["component"] == "ram")):
                raise ValueError("XT checkpoint memory must identify conventional RAM.")
            if "event" in extra:
                event = extra["event"]
                valid = isinstance(event, dict) and (
                    set(event) == {"kind", "address"} and event["kind"] == "dma"
                    and type(event["address"]) is int and 0 <= event["address"] <= 0xfffff
                    or set(event) == {"kind", "port", "value"} and event["kind"] in ("input", "output")
                    and type(event["port"]) is int and 0 <= event["port"] <= 0xffff
                    and type(event["value"]) is int and 0 <= event["value"] <= 255)
                if not valid:
                    raise ValueError("XT walkthrough events require an exact DMA address or port and byte.")
            extras.append((step, extra))
    software = [tour for tour in record["walkthroughs"] if tour["id"] == "hello-com"]
    if len(software) > 1 or any(set(tour) != {"id", "title", "setup", "steps"} or not tour["steps"]
                               or not all(isinstance(tour[k], str) and tour[k].strip() for k in ("title", "setup")) for tour in software):
        raise ValueError("The HELLO.COM walkthrough needs a unique introduction and checkpoints.")
    record["walkthroughs"] = [tour for tour in record["walkthroughs"] if tour not in software]
    validated = validate_rom_annotations(record, catalogue["romImages"]["bios"],
                                    rom_ranges=[(r["start"], r["start"] + r["size"] - 1) for r in storage if r["component"] == "bios"],
                                    ram_end=next(r["size"] for r in storage if r["component"] == "ram"),
                                    hardware_ranges=[], instruction_bytes=32, address_digits=5,
                                    execution_address=lambda text, physical: _physical_address(text) == physical)
    for step, extra in extras:
        step.update(extra)
    validated["walkthroughs"].extend(software)
    return {**validated, "io": io}
