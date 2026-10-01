import { readFileSync, readdirSync } from "node:fs";
import { parseBasicLesson } from "./basic-lesson.ts";

// Like chapters.ts, provide validated authoring data to the Python publisher.
const directory = new URL("./content/basic/", import.meta.url);
const lessons = readdirSync(directory).filter(name => name.endsWith(".md")).sort().map(file => ({
  slug: file.slice(0, -3),
  ...parseBasicLesson(readFileSync(new URL(file, directory), "utf8"), `site/content/basic/${file}`),
}));
process.stdout.write(JSON.stringify(lessons));
