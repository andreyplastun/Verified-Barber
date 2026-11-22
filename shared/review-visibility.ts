/** Contract shared by the public profile, the full feed and response tests. */
export function isPublishedReview(r: { isFinalized: boolean; publishReview: boolean }) {
  return r.isFinalized && r.publishReview;
}
