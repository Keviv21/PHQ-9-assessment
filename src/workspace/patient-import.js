function flatten(value, prefix = "", lines = []) {
  if (Array.isArray(value)) value.forEach((v) => flatten(v, prefix, lines));
  else if (value && typeof value === "object")
    Object.entries(value).forEach(([k, v]) =>
      flatten(
        v,
        `${prefix}${prefix ? " · " : ""}${k.replaceAll("_", " ")}`,
        lines,
      ),
    );
  else if (value !== null && value !== undefined)
    lines.push(`${prefix}: ${value}`);
  return lines;
}
export function patientImportRecord(input) {
  const report = input?.digital_twin_report;
  const sections = report?.sections;
  const clinical = sections?.clinical__notes_summary;
  const profile = clinical?.patient_profile;
  if (
    !report?.patient_id ||
    !profile ||
    typeof profile.name !== "string" ||
    !profile.name.trim()
  )
    throw new Error("Patient report requires an ID and patient profile name.");
  const summaries = {};
  for (const [key, value] of Object.entries(clinical))
    if (key !== "patient_profile") summaries[key] = value;
  summaries.diagnosis = profile.diagnosis;
  for (const [section, value] of Object.entries(sections)) {
    if (section === "clinical__notes_summary") continue;
    for (const [key, item] of Object.entries(value))
      if (
        /summary|conclusion|overall_observation|clinical_findings|safety_alerts|clinical_inference/.test(
          key,
        )
      )
        summaries[`${section}: ${key}`] = item;
  }
  let summary = flatten(summaries).join("\n");
  for (const identifier of [
    profile.name,
    report.patient_id,
    profile.patient_id,
  ].filter((v) => typeof v === "string" && v.length > 1))
    summary = summary.replaceAll(identifier, "[patient]");
  summary = summary.replace(
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    "[email removed]",
  );
  const gender =
    ["Male", "Female", "Other", "Prefer not to say"].find(
      (g) => g.toLowerCase() === String(profile.gender).toLowerCase(),
    ) || "Prefer not to say";
  return {
    externalId: String(report.patient_id),
    name: profile.name.trim(),
    gender,
    recordedAge:
      Number.isInteger(profile.age) && profile.age >= 0 && profile.age <= 130
        ? profile.age
        : null,
    historySummary: summary.slice(0, 24000),
    sourceProfile: report,
  };
}
