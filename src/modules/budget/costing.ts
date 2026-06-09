import { ActivityType, DeliveryType } from '@prisma/client';

// ── The automatic costing engine ────────────────────────────────────────────
// Every scheduled activity is costed from the CD-owned rate card (CostSetting,
// keyed by a stable string). No staff invents a cost. If a required rate is
// missing, the activity is flagged `costMissing` and must not enter a budget /
// fund request until the CD resolves it (spec §10).

export type RateCard = Record<string, number>; // CostSetting.key -> unitCost

export interface CostLine {
  label: string;
  key: string;
  unit: number | null; // null = rate missing
  qty: number;
  amount: number; // 0 when the rate is missing
  missing: boolean;
}

export interface ActivityCost {
  amount: number;
  lines: CostLine[];
  costMissing: boolean;
}

// Minimal shape the engine needs from an Activity row.
export interface CostableActivity {
  activityType: ActivityType;
  deliveryType: DeliveryType;
  districtType?: string | null; // 'primary' | 'secondary' — affects staff transport
  teachersAttended?: number | null;
  leadersAttended?: number | null;
  otherParticipants?: number | null;
}

// Default participant estimate for a not-yet-delivered training, used only when
// no attendance figures exist yet (planning-time estimate).
const DEFAULT_TRAINING_PARTICIPANTS = 25;

const VISIT_TYPES: ActivityType[] = [
  ActivityType.school_visit,
  ActivityType.follow_up_visit,
  ActivityType.coaching_visit,
  ActivityType.in_school_support,
  ActivityType.core_visit,
];
const TRAINING_TYPES: ActivityType[] = [
  ActivityType.training,
  ActivityType.school_improvement_training,
  ActivityType.cluster_training,
  ActivityType.core_training,
];

function participantsOf(a: CostableActivity): number {
  const counted =
    (a.teachersAttended ?? 0) + (a.leadersAttended ?? 0) + (a.otherParticipants ?? 0);
  return counted > 0 ? counted : DEFAULT_TRAINING_PARTICIPANTS;
}

export function costForActivity(a: CostableActivity, rates: RateCard): ActivityCost {
  const lines: CostLine[] = [];
  const add = (label: string, key: string, qty = 1) => {
    const unit = rates[key];
    const missing = unit == null;
    lines.push({
      label,
      key,
      unit: missing ? null : unit,
      qty,
      amount: missing ? 0 : unit * qty,
      missing,
    });
  };

  const isPartner = a.deliveryType === DeliveryType.partner;
  const type = a.activityType;

  if (isPartner) {
    // Partner work (visit OR training) is a configured lump sum.
    add('Partner lump sum', 'partner_visit_lump_sum');
  } else if (VISIT_TYPES.includes(type)) {
    // Staff visit = transport (by district tier) + lunch.
    const transportKey =
      a.districtType === 'secondary'
        ? 'staff_visit_transport_secondary'
        : 'staff_visit_transport_primary';
    add('Transport', transportKey);
    add('Lunch', 'lunch');
  } else if (TRAINING_TYPES.includes(type)) {
    // Staff training = session fee + venue + meals per participant.
    const n = participantsOf(a);
    add('Training session', 'training_session_fee');
    add('Venue', 'venue');
    add('Meals', 'meals_per_participant', n);
  } else if (type === ActivityType.cluster_meeting) {
    add('Cluster meeting', 'cluster_meeting_cost');
  } else if (type === ActivityType.partner_activity || type === ActivityType.project_activity) {
    add('Partner/project', 'partner_visit_lump_sum');
  } else {
    // ssa_activity and anything else default to a staff visit cost.
    add('Transport', 'staff_visit_transport_primary');
    add('Lunch', 'lunch');
  }

  const costMissing = lines.some((l) => l.missing);
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  return { amount, lines, costMissing };
}
