/** WHEN THE FIRST-RUN WALKTHROUGH OPENS BY ITSELF (v36.6).
 *
 *  It used to be "whenever this browser has no flag", and the flag was written
 *  only when the tour was closed with Done or ✕. Any other way out — closing the
 *  app mid-tour, a browser that clears site data, the Android app vs. the
 *  browser, a second device — met it again from step 1 on every visit. The
 *  member row now carries `tour_seen_at`, set the moment it OPENS.
 *
 *  Pure so the rule can be tested without a browser. */
export interface TourSeenInputs {
  /** members.tour_seen_at is set */
  serverSeen: boolean;
  /** this browser still has the pre-v36.6 localStorage flag */
  browserSeen: boolean;
  /** an admin's test view — never open for, or write on behalf of, someone else */
  impersonated: boolean;
}

export interface TourDecision {
  /** open the walkthrough now, unasked */
  autoOpen: boolean;
  /** tell the server it has been seen (on open, or to carry the old browser
   *  flag over so the next device knows too) */
  markSeen: boolean;
}

export function tourDecision({ serverSeen, browserSeen, impersonated }: TourSeenInputs): TourDecision {
  if (serverSeen) return { autoOpen: false, markSeen: false };
  if (impersonated) return { autoOpen: false, markSeen: false };
  if (browserSeen) return { autoOpen: false, markSeen: true };
  return { autoOpen: true, markSeen: true };
}
