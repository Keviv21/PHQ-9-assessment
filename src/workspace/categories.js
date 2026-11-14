// Browse categories adapted from Sagar; organizational tags, not clinical recommendations.
export function categorizeAssessment(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  if (/adhd|executive|hyperactiv|attention deficit/i.test(text))
    return "ADHD & Executive Functioning";
  if (/trauma|ptsd|post-traumatic|dissociat/i.test(text))
    return "PTSD & Trauma";
  if (/autis|asperger|social responsiveness|neurodiverg/i.test(text))
    return "Autism & Neurodiversity";
  if (/insomnia|sleep|fatigue|sleepiness/i.test(text)) return "Sleep & Fatigue";
  if (/substance|addict|alcohol|drug|crafft|smok|drink/i.test(text))
    return "Substance Use & Addiction";
  if (/eating|binge|anorexi|bulimi/i.test(text)) return "Eating Disorders";
  if (/child|youth|pediatric|parent|adolescent|yp-core/i.test(text))
    return "Child & Youth";
  if (/bipolar|mania|depress|phq|mood|dass/i.test(text))
    return "Depression & Mood";
  if (/anxiet|panic|gad|worry|phobia|obsess|ocd/i.test(text))
    return "Anxiety & Stress";
  if (/cognit|memory|dementia|alzheimer|brain/i.test(text))
    return "Cognitive & Neurological";
  if (/personality|psychopathol|borderline|mapsy|schizo/i.test(text))
    return "Personality & Psychopathology";
  return "General Health & Well-being";
}
