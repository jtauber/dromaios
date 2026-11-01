"""The XT chapter owns the BIOS guide and its exact logical execution checkpoints."""

import json
import re

from rom_annotations import validate_rom_annotations


def xt_annotations(source, catalogue):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError("The XT chapter must contain one BIOS annotation collection.")

    def execution_address(text, physical):
        if not re.fullmatch(r"[0-9A-F]{4}:[0-9A-F]{4}", text):
            return False
        segment, offset = (int(part, 16) for part in text.split(":"))
        return (segment * 16 + offset) & 0xfffff == physical

    storage = catalogue["storage"]
    return validate_rom_annotations(json.loads(fences[0]), catalogue["romImages"]["bios"],
                                    rom_ranges=[(r["start"], r["start"] + r["size"] - 1) for r in storage if r["component"] == "bios"],
                                    ram_end=next(r["size"] for r in storage if r["component"] == "ram"),
                                    hardware_ranges=[], instruction_bytes=32, address_digits=5, execution_address=execution_address)
