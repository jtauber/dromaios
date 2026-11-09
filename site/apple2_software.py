"""Publish Ultima IV's authored tours, resolving stops from its existing acceptance record."""

import json
from pathlib import Path
import re

ULTIMA_IV = Path(__file__).resolve().parent.parent / "docs/software/ultima-iv.md"


def ultima4_walkthroughs(source):
    fences = re.findall(r"^```json\n(.*?)^```$", source, re.M | re.S)
    if len(fences) != 1:
        raise ValueError("The Ultima IV guide needs one acceptance record.")
    record = json.loads(fences[0])

    def text(value):
        return isinstance(value, str) and bool(value.strip())

    def check_bytes(check):
        if not isinstance(check, dict) or set(check) != {"address", "bytes"}:
            raise ValueError("A software condition needs an address and bytes.")
        address, values = check["address"], check["bytes"]
        if (type(address) is not int or not isinstance(values, list) or not values
                or not 0 <= address < address + len(values) <= 0xc000
                or any(type(byte) is not int or not 0 <= byte <= 255 for byte in values)):
            raise ValueError("Software conditions must compare bytes in main RAM.")
        return check

    def stop(name):
        if not isinstance(name, str) or not re.fullmatch(r"(?:stops|save|(?:combat|magic)\.stops)\.[A-Za-z]+", name):
            raise ValueError(f"Invalid software stop reference: {name!r}.")
        value = record
        for part in name.split("."):
            if not isinstance(value, dict) or part not in value:
                raise ValueError(f"Missing software stop: {name}.")
            value = value[part]
        return check_bytes(value)

    tours = record.get("walkthroughs")
    if not isinstance(tours, list) or not tours:
        raise ValueError("Ultima IV needs walkthroughs.")
    result, ids = [], set()
    for tour in tours:
        if not isinstance(tour, dict) or set(tour) != {"id", "title", "setup", "requires", "steps"}:
            raise ValueError("Invalid Ultima IV walkthrough fields.")
        if not all(text(tour[key]) for key in ("id", "title", "setup")) or tour["id"] in ids:
            raise ValueError("Walkthroughs need unique IDs and introductions.")
        ids.add(tour["id"])
        if not isinstance(tour["requires"], list) or not tour["requires"] or not isinstance(tour["steps"], list) or not tour["steps"]:
            raise ValueError("Walkthroughs need loaded-code checks and checkpoints.")
        steps = []
        for step in tour["steps"]:
            if not isinstance(step, dict) or set(step) != {"title", "stop", "prepare", "observe", "when", "inspect", "limit"}:
                raise ValueError("Invalid software checkpoint fields.")
            if not all(text(step[key]) for key in ("title", "prepare", "observe")):
                raise ValueError("Software checkpoints need preparation and observations.")
            if type(step["limit"]) is not int or not 0 < step["limit"] <= 200_000_000:
                raise ValueError("Software checkpoints need a bounded instruction budget.")
            if not isinstance(step["when"], list) or not isinstance(step["inspect"], list) or not step["inspect"]:
                raise ValueError("Software checkpoints need conditions and inspection links.")
            for link in step["inspect"]:
                if not isinstance(link, dict) or set(link) != {"label", "address", "space"} or not text(link["label"]):
                    raise ValueError("Invalid software inspection link.")
                address, space = link["address"], link["space"]
                if type(address) is not int or not ((space == "ram" and 0 <= address < 0xc000)
                                                   or (space == "lc-upper" and 0xe000 <= address <= 0xffff)):
                    raise ValueError("Software inspections must name main or upper Language Card RAM.")
            resolved = stop(step["stop"])
            steps.append({key: value for key, value in step.items() if key != "stop"} | {
                "address": f"{resolved['address']:04X}", "bytes": resolved["bytes"],
                "when": [check_bytes(check) for check in step["when"]],
            })
        result.append({**tour, "requires": [stop(name) for name in tour["requires"]], "steps": steps})
    return result
