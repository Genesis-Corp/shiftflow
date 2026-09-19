import { ReactNode } from 'react';
import { PhoneMissed, XCircle, UserX, CheckCircle, Clock } from 'lucide-react';
import { IncidentType } from './types';

/** Shared label/icon/badge/delta for each reliability incident type —
 *  used by both the Reliability page's own log and the Settings page's
 *  condensed copy of it, so the two never drift apart. */
export const INCIDENT_META: Record<IncidentType, { label: string; icon: ReactNode; badge: string; delta: string }> = {
  no_show:  { label: 'No Show',    icon: <UserX size={13} />,       badge: 'badge-red',   delta: '−15%' },
  no_answer:{ label: 'No Answer',  icon: <PhoneMissed size={13} />, badge: 'badge-amber', delta: '−5%'  },
  rejected: { label: 'Rejected',   icon: <XCircle size={13} />,     badge: 'badge-amber', delta: '−3%'  },
  covered:  { label: 'Covered',    icon: <CheckCircle size={13} />, badge: 'badge-green', delta: '+10'  },
  late:     { label: 'Late',       icon: <Clock size={13} />,       badge: 'badge-amber', delta: '−5%'  },
};
