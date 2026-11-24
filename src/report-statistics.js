// Normal CDF approximation, used only for source-specified normal conversions.
export function normalPercentile(value, reference) {
  if (!Number.isFinite(value) || reference?.method !== 'normal_cdf' || !Number.isFinite(reference.mean) || !Number.isFinite(reference.sd) || reference.sd <= 0) return null;
  const z=(value-reference.mean)/reference.sd, x=Math.abs(z), t=1/(1+.2316419*x);
  const tail=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return 100*(z>=0?1-tail:tail);
}
