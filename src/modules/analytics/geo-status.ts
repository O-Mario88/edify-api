// Pure district-status classification for the geo-analytics map — combines the
// SSA average with the share of critical (avg<5) schools so the choropleth and
// drawer read the same leadership signal. Exported for unit testing.

export type DistrictStatus = 'healthy' | 'needs_attention' | 'high_risk' | 'insufficient_data';

export function districtStatus(avgSsa: number | null, schools: number, criticalCount: number): DistrictStatus {
  if (avgSsa == null) return 'insufficient_data';
  const criticalShare = schools ? criticalCount / schools : 0;
  if (avgSsa < 5 || criticalShare >= 0.3) return 'high_risk';
  if (avgSsa < 7 || criticalShare > 0) return 'needs_attention';
  return 'healthy';
}
