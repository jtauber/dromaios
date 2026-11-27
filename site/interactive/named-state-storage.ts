export type StateStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export function checkStateName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 80) {
    throw new Error("Give the state a name of 1–80 characters.");
  }
}

/** Each name has its own entry. A previous single-slot save can keep its original key. */
export function namedStateStorage(storage: () => StateStorage, prefix: string, previous?: { name: string; key: string }) {
  function key(name: string): string {
    checkStateName(name);
    return name === previous?.name ? previous.key : prefix + encodeURIComponent(name);
  }
  return {
    names(): string[] {
      const store = storage(), names: string[] = [];
      for (let index = 0; index < store.length; index++) {
        const entry = store.key(index);
        if (previous && entry === previous.key) names.push(previous.name);
        else if (entry?.startsWith(prefix)) {
          try {
            const name = decodeURIComponent(entry.slice(prefix.length));
            if (key(name) === entry) names.push(name);
          } catch { /* Ignore malformed keys. Damaged payloads can still be listed and deleted. */ }
        }
      }
      return names.sort((a, b) => a.localeCompare(b));
    },
    read(name: string): string {
      const text = storage().getItem(key(name));
      if (text === null) throw new Error("This state is no longer saved.");
      return text;
    },
    save(name: string, text: string): void {
      const store = storage(), entry = key(name);
      if (store.getItem(entry) !== null) throw new Error("That name is already saved. Choose another name or delete the old state first.");
      try { store.setItem(entry, text); }
      catch { throw new Error("The browser could not save this state. Storage may be full or unavailable."); }
    },
    remove(name: string): void { storage().removeItem(key(name)); },
  };
}
