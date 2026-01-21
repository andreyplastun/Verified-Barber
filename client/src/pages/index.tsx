import { useSpecialists } from "@/hooks/use-specialists";
import { Link, useLocation } from "wouter";
import { MapPin, ArrowRight, Filter, ChevronDown, Star, Info } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortOption = 'default' | 'rating' | 'visits';
type RatingFilter = 'all' | 'formed' | 'forming';

export default function SpecialistList() {
  const { data: specialists, isLoading } = useSpecialists();
  const { user, role, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');

  useEffect(() => {
    if (!loading && role === 'specialist') {
      setLocation('/specialist-dashboard');
    }
  }, [loading, role, setLocation]);

  const filteredAndSortedSpecialists = useMemo(() => {
    if (!specialists) return [];
    
    let result = [...specialists];
    
    // Apply rating filter
    if (ratingFilter === 'formed') {
      result = result.filter(s => s.reviewCount >= 10);
    } else if (ratingFilter === 'forming') {
      result = result.filter(s => s.reviewCount < 10);
    }
    
    // Apply sorting
    if (sortBy === 'default') {
      // Default: formed rating first, then by rating
      result.sort((a, b) => {
        const aFormed = a.reviewCount >= 10 ? 1 : 0;
        const bFormed = b.reviewCount >= 10 ? 1 : 0;
        if (bFormed !== aFormed) return bFormed - aFormed;
        return (b.averageRating || 0) - (a.averageRating || 0);
      });
    } else if (sortBy === 'rating') {
      result.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
    } else if (sortBy === 'visits') {
      result.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
    }
    
    return result;
  }, [specialists, sortBy, ratingFilter]);

  if (loading) {
    return <div className="p-5 text-[#6B7280]">Загрузка...</div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 px-4 space-y-3 bg-[#FAFAFA]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white h-24 rounded-xl border border-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-[#FAFAFA]">
      {/* Header */}
      <header className="pt-12 pb-4 px-6 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-[#1F2933]">
              Специалисты
            </h1>
            <p className="mt-1 text-[#6B7280] text-sm">
              Запишись к проверенным мастерам
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="text-[#6B7280]"
            data-testid="button-toggle-filters"
          >
            <Filter size={16} className="mr-1" />
            Фильтры
            <ChevronDown size={14} className={`ml-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        
        {/* Filters panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
            {/* Rating filter */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-[#6B7280] mr-2 self-center">Рейтинг:</span>
              {[
                { value: 'all', label: 'Все' },
                { value: 'formed', label: 'Сформированный' },
                { value: 'forming', label: 'Формируется' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRatingFilter(opt.value as RatingFilter)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    ratingFilter === opt.value
                      ? 'bg-[#1F2933] text-white'
                      : 'bg-[#F1F5F9] text-[#475569] hover:bg-gray-200'
                  }`}
                  data-testid={`filter-rating-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            
            {/* Sort */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-[#6B7280] mr-2 self-center">Сортировка:</span>
              {[
                { value: 'default', label: 'По умолчанию' },
                { value: 'rating', label: 'По рейтингу' },
                { value: 'visits', label: 'По визитам' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSortBy(opt.value as SortOption)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    sortBy === opt.value
                      ? 'bg-[#1F2933] text-white'
                      : 'bg-[#F1F5F9] text-[#475569] hover:bg-gray-200'
                  }`}
                  data-testid={`sort-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* List */}
      <main className="px-4 py-4 space-y-3">
        {filteredAndSortedSpecialists.map((specialist, index) => (
          <motion.div
            key={specialist.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Link href={`/specialist/${specialist.id}`}>
              <div className="group bg-white rounded-xl border border-gray-100 shadow-sm active:scale-[0.99] transition-transform duration-150 p-3">
                {/* Top row: Avatar + Basic info + Trust block */}
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                    <img 
                      src={specialist.imageUrl} 
                      alt={specialist.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Basic Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-[#1F2933] truncate">
                      {specialist.name}
                    </h3>
                    <p className="text-sm text-[#6B7280]">
                      {specialist.specialty}
                    </p>
                    <div className="flex items-center text-xs text-[#9CA3AF] mt-1">
                      <MapPin size={11} className="mr-1" />
                      <span>Алматы</span>
                    </div>
                  </div>

                  {/* Trust Block (right) */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    {/* Rating */}
                    <div className="flex items-center gap-1">
                      <Star size={14} className="text-amber-400 fill-amber-400" />
                      <span className="text-sm font-semibold text-[#1F2933]">
                        {(specialist.averageRating / 10).toFixed(1)}
                      </span>
                    </div>
                    
                    {/* Review count */}
                    <span className="text-xs text-[#6B7280]">
                      {specialist.reviewCount} {(() => {
                        const n = specialist.reviewCount % 100;
                        if (n >= 11 && n <= 19) return 'отзывов';
                        const last = n % 10;
                        if (last === 1) return 'отзыв';
                        if (last >= 2 && last <= 4) return 'отзыва';
                        return 'отзывов';
                      })()}
                    </span>
                    
                    {/* Rating status badge */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          specialist.reviewCount >= 10
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-[#F1F5F9] text-[#475569]'
                        }`}>
                          <span>
                            {specialist.reviewCount >= 10 ? 'Сформированный' : 'Формируется'}
                          </span>
                          <Info size={10} className="opacity-60" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                        {specialist.reviewCount >= 10
                          ? 'Рейтинг основан на достаточном количестве подтверждённых визитов'
                          : 'Рейтинг станет точнее по мере увеличения количества отзывов'}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center justify-center text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors">
                    <ArrowRight size={18} />
                  </div>
                </div>

                {/* Description block (below, separated) */}
                {specialist.bio && (
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    <p className="text-sm text-[#6B7280] line-clamp-2">
                      {specialist.bio}
                    </p>
                  </div>
                )}
              </div>
            </Link>
          </motion.div>
        ))}

        {filteredAndSortedSpecialists.length === 0 && (
          <div className="text-center py-16 px-4">
            <p className="text-[#6B7280]">
              {ratingFilter === 'formed' 
                ? 'В этом районе пока нет специалистов со сформированным рейтингом'
                : ratingFilter === 'forming'
                ? 'По выбранным параметрам специалисты не найдены'
                : specialists && specialists.length === 0
                ? 'В этом районе пока нет специалистов'
                : 'По выбранным параметрам специалисты не найдены'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
