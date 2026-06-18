import { useQuery } from "@tanstack/react-query";

export type RatingThemeResolved = {
  active: boolean;
  iconType?: "emoji" | "image";
  value?: string;
  color?: string;
};

/**
 * Resolves the currently active rating-icon theme (seasonal swap, e.g. footballs
 * during a championship). Returns the theme only when it is enabled AND within its
 * date range; otherwise null (callers fall back to the default star).
 *
 * `isResolved` is false until the query has settled once. Callers should render
 * nothing (a sized placeholder) until then, so the default star never flashes
 * before the themed icon arrives.
 *
 * NOTE: by product decision the themed icon is used ONLY where a user actively
 * gives a rating. Display surfaces (feed, cards, rating badges) always keep stars.
 */
export function useRatingTheme(): { theme: RatingThemeResolved | null; isResolved: boolean } {
  const { data, isFetched } = useQuery<RatingThemeResolved>({
    queryKey: ["/api/rating-theme"],
    staleTime: 5 * 60 * 1000,
  });
  return { theme: data?.active ? data : null, isResolved: isFetched };
}
