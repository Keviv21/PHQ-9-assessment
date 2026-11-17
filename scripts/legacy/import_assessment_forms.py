"""Extract only GAD-7 and PCL-5 questionnaire fields from the supplied draft export.

Usage: py scripts/legacy/import_assessment_forms.py "C:\\path\\to\\novopsych-all-186-cleaned-assessments (1).json"
Clinical scoring is implemented separately from primary instrument guidance.
"""

import json
import sys
from pathlib import Path


DEFINITIONS = {
    "gad7": {
        "catalog_id": "GAD7",
        "count": 7,
        "title": "Generalised Anxiety Disorder Assessment (GAD-7)",
        "reference_period": "Past two weeks",
        "source": "https://novopsych.com/wp-content/uploads/2023/03/Generalised-Anxiety-Disorder-Assessment-GAD-7.pdf",
    },
    "pcl5": {
        "catalog_id": "ptsd-checklist-5-pcl-5--5a88422b610e",
        "count": 20,
        "title": "PTSD Checklist for DSM-5 (PCL-5)",
        "reference_period": "Past month",
        "source": "https://novopsych.com/wp-content/uploads/2023/02/pcl-5-assessment-trauma-online.pdf",
        "scoring_source": "https://www.ptsd.va.gov/professional/assessment/documents/using-PCL5.pdf",
    },
}


def extract_form(assessments, form_id, config):
    matches = [item for item in assessments if item.get("assessment_id") == config["catalog_id"]]
    if len(matches) != 1:
        raise ValueError(f"Expected one {form_id} entry")
    item = matches[0]
    questionnaire = item["questionnaire"]
    source_items = sorted(questionnaire["items"], key=lambda row: row["order"])
    if len(source_items) != config["count"] or [row["order"] for row in source_items] != list(range(1, config["count"] + 1)):
        raise ValueError(f"Incomplete {form_id} questionnaire")
    response_sets = questionnaire["response_sets"]
    if len(response_sets) != 1:
        raise ValueError(f"Expected one {form_id} response set")
    source_options = sorted(response_sets[0]["options"], key=lambda row: row["response_value"])
    maximum = 4 if form_id == "pcl5" else 3
    if [row["response_value"] for row in source_options] != list(range(maximum + 1)):
        raise ValueError(f"Unexpected {form_id} response values")
    if any(row.get("response_set_id") != response_sets[0]["id"] or not row.get("text", "").strip() for row in source_items):
        raise ValueError(f"Invalid {form_id} item")
    return {
        "formId": form_id,
        "language": "en",
        "version": "v1-prototype",
        "title": config["title"],
        "referencePeriod": config["reference_period"],
        "instructions": item["administration"].get("instructions") or "Keep the stressful experience in mind and rate how much each problem bothered you in the past month.",
        "source": config["source"],
        "scoringSource": config.get("scoring_source"),
        "catalogDraftId": config["catalog_id"],
        "options": [
            {"value": row["response_value"], "label": row["label"].capitalize(), "description": config["reference_period"]}
            for row in source_options
        ],
        "questions": [
            {"id": f"Q{row['order']:02d}", "text": row["text"].strip().replace("( ", "(").replace(" ?", "?").replace("behaviour", "behavior").replace("“", '"').replace("”", '"')}
            for row in source_items
        ],
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Pass the draft export JSON path")
    source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    assessments = source["assessments"]
    destination = Path(__file__).resolve().parents[2] / "data" / "legacy"
    for form_id, config in DEFINITIONS.items():
        form = extract_form(assessments, form_id, config)
        (destination / f"{form_id}.json").write_text(json.dumps(form, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {form_id}: {len(form['questions'])} items")


if __name__ == "__main__":
    main()
