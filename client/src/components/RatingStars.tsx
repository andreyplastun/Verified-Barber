import { Star, StarHalf } from "lucide-react";

interface RatingStarsProps {
  rating: number; // 0-5
  size?: number;
  className?: string;
  showCount?: boolean;
  count?: number;
}

export function RatingStars({ rating, size = 16, className = "", showCount = false, count = 0 }: RatingStarsProps) {
  const stars = [];
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;

  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      stars.push(<Star key={i} className="fill-yellow-400 text-yellow-400" size={size} />);
    } else if (i === fullStars && hasHalfStar) {
      stars.push(<StarHalf key={i} className="fill-yellow-400 text-yellow-400" size={size} />);
    } else {
      stars.push(<Star key={i} className="text-muted-foreground/30" size={size} />);
    }
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <div className="flex gap-0.5">
        {stars}
      </div>
      {showCount && (
        <span className="text-sm text-muted-foreground ml-1">
          ({count})
        </span>
      )}
    </div>
  );
}
