"""CoCo annotations belong to the machine chapter and its two verified ROM sockets."""

import json
import re

from rom_annotations import validate_rom_annotations


def validate_after(after, rom_address):
    def hex_field(value, digits):
        return isinstance(value, str) and re.fullmatch(rf"[0-9A-F]{{{digits}}}", value)

    if (not isinstance(after, dict) or not rom_address(after.get("pc"))
            or not set(after) <= {"pc", "register", "access"} or len(after) < 2):
        raise ValueError("A CoCo instruction result needs a ROM continuation and a register or bus observation.")
    if "register" in after:
        register = after["register"]
        if (not isinstance(register, dict) or set(register) != {"name", "value"}
                or register["name"] not in ("a", "b", "dp", "d", "x", "y", "u", "s")
                or not hex_field(register["value"], 2 if register["name"] in ("a", "b", "dp") else 4)):
            raise ValueError("A CoCo register observation needs a numeric register and a value of its width.")
    if "access" in after:
        access = after["access"]
        if (not isinstance(access, dict) or set(access) != {"kind", "address", "value"}
                or access["kind"] not in ("read", "write") or not hex_field(access["address"], 4)
                or not hex_field(access["value"], 2)):
            raise ValueError("A CoCo bus observation needs a direction, address and byte.")


def coco_annotations(source, images, cpu):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError("The CoCo chapter must have exactly one ROM annotation collection.")
    guides = json.loads(fences[0])
    if not isinstance(guides, dict) or set(guides) != {"firmware", "extended"}:
        raise ValueError("CoCo annotations must identify both ROM sockets.")
    addresses, names, tours = set(), set(), set()
    for socket, bounds in [("firmware", [(0xa000, 0xbfff), (0xffe0, 0xffff)]), ("extended", [(0x8000, 0x9fff)])]:
        guide = validate_rom_annotations(guides[socket], images[socket], rom_ranges=bounds,
                                        ram_end=0x8000, hardware_ranges=[(0xff00, 0xff3f), (0xffc0, 0xffdf)],
                                        instruction_bytes=5, validate_after=validate_after)
        for entry in guide["routines"] + guide["labels"]:
            if entry["address"] in addresses or entry["name"] in names:
                raise ValueError("CoCo ROMs must not disagree on an address or label name.")
            addresses.add(entry["address"])
            names.add(entry["name"])
        for tour in guide["walkthroughs"]:
            if tour["id"] in tours:
                raise ValueError("CoCo walkthrough IDs must be unique across ROMs.")
            tours.add(tour["id"])
        for note in guide["notes"]:
            encoded = bytes.fromhex(note["bytes"])
            prefixed = encoded[0] in cpu["prefixes"]
            opcode_bytes = 2 if prefixed else 1
            opcode = int.from_bytes(encoded[:opcode_bytes], "big")
            instruction = cpu["instructions"].get(str(opcode))
            shape = instruction["shape"] if instruction else None
            if isinstance(shape, list):
                shape = shape[encoded[opcode_bytes]] if len(encoded) > opcode_bytes else None
            shape = cpu["shapes"][shape] if shape is not None else None
            if not shape or not shape["supported"] or shape["length"] != len(encoded):
                raise ValueError(f"CoCo ROM note at ${note['address']} must describe one supported instruction.")
    return guides
