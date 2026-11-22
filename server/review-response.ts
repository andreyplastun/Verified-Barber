import type { Review } from '../shared/schema';
import { isPublishedReview } from '../shared/review-visibility';

export function maskReviewsForViewer(reviews: Review[], role: 'admin' | 'specialist' | 'client' | null, verifiedViewerId?: string) {
  if (role === 'admin') return reviews;
  return reviews.filter(r => !r.isPrivate && (isPublishedReview(r) || (verifiedViewerId && r.clientId === verifiedViewerId))).map(r => {
    const hidden = !r.showName || r.hiddenName || /@|^\+?[\d() -]{8,}$/.test(r.customerName);
    return {
      id: r.id, specialistId: r.specialistId, rating: r.rating, comment: r.comment,
      triggers: r.triggers, showName: !hidden, hiddenName: hidden, createdAt: r.createdAt,
      priceMismatch: r.priceMismatch, isFinalized: r.isFinalized, publishReview: r.publishReview,
      customerName: hidden ? 'Аноним' : r.customerName,
      ...(verifiedViewerId && verifiedViewerId === r.clientId ? {bookingId:r.bookingId, editableUntil:r.editableUntil} : {}),
    };
  });
}
