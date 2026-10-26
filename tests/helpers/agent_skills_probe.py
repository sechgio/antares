import json
import os
import sys
from pathlib import Path

from backend.core.agent import skills

options = json.load(sys.stdin)
root = Path(options["root"])
os.environ["SKILLS_HOME"] = str(root / "base-skills")
library = root / "probe-library"
ids = {}
for item in options.get("catalog", []):
    file = library / item["name"] / "SKILL.md"
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(f"---\nname: {item['name']}\ndescription: {item['description']}\n---\nContenido de biblioteca", encoding="utf-8")
    ids[str(file)] = item["id"]
original_id = skills._skill_id
skills._skill_id = lambda file: ids.get(str(file), original_id(file))
pages = []
while True:
    result = skills.run("skills_read" if options["name"] == "skills_pages" else options["name"],
                        options["params"], {}, root / "workspace", library, profile_skills=options["profile_skills"])
    if options["name"] != "skills_pages":
        break
    pages.append(result)
    if result["next_offset"] is None:
        break
    options["params"]["offset"] = result["next_offset"]
print(json.dumps(pages if options["name"] == "skills_pages" else result, ensure_ascii=False))
