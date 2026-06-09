import { useSpecialists } from "@/hooks/use-specialists";
import { LegalFooter } from "@/components/LegalFooter";
import { Link, useLocation, useRoute } from "wouter";
import { MapPin, ArrowRight, Filter, ChevronDown, Star, Info } from "lucide-react";
import { BookingButton } from "@/components/BookingButton";
import { motion } from "framer-motion";
import { AnimatedRating, AnimatedStar } from "@/components/ui/animations";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SortOption = 'default' | 'rating' | 'visits';
type RatingFilter = 'all' | 'formed' | 'forming';

// Category labels in Russian
const categoryLabels: Record<string, string> = {
  barber: "Барбер",
  manicure: "Маникюр",
  cosmetology: "Косметология",
  doctor: "Врач",
  trainer: "Тренер",
  auto_service: "Автосервис"
};

export default function SpecialistList() {
  const { data: specialists, isLoading } = useSpecialists();
  const { user, role, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  
  // Fetch filter options
  const { data: filterOptions } = useQuery<{ cities: string[]; districts: string[]; categories: string[] }>({
    queryKey: ['/api/filter-options'],
  });

  useEffect(() => {
    if (!loading && role === 'specialist') {
      setLocation('/specialist-dashboard');
    }
  }, [loading, role, setLocation]);

  const filteredAndSortedSpecialists = useMemo(() => {
    if (!specialists) return [];
    
    let result = [...specialists];
    
    // Apply category filter
    if (categoryFilter !== 'all') {
      result = result.filter(s => (s as any).category === categoryFilter);
    }
    
    // Apply country filter
    if (countryFilter !== 'all') {
      result = result.filter(s => ((s as any).country || 'KZ') === countryFilter);
    }
    
    // Apply city filter
    if (cityFilter !== 'all') {
      result = result.filter(s => (s as any).city === cityFilter);
    }
    
    // Apply district filter
    if (districtFilter !== 'all') {
      result = result.filter(s => (s as any).district === districtFilter);
    }
    
    // Apply rating filter (using validReviewCount for "Сформированный рейтинг" status)
    if (ratingFilter === 'formed') {
      result = result.filter(s => ((s as any).validReviewCount || 0) >= 10);
    } else if (ratingFilter === 'forming') {
      result = result.filter(s => ((s as any).validReviewCount || 0) < 10);
    }
    
    // Apply sorting - matches backend logic exactly
    if (sortBy === 'default') {
      // Default: formed rating first, then by trustedRating, then by reviewCount
      result.sort((a, b) => {
        // 1. Formed rating first (validReviewCount >= 10)
        const aFormed = ((a as any).validReviewCount || 0) >= 10 ? 1 : 0;
        const bFormed = ((b as any).validReviewCount || 0) >= 10 ? 1 : 0;
        if (bFormed !== aFormed) return bFormed - aFormed;
        
        // 2. By trustedRating (desc)
        const aTrusted = (a as any).trustedRating || 0;
        const bTrusted = (b as any).trustedRating || 0;
        if (bTrusted !== aTrusted) return bTrusted - aTrusted;
        
        // 3. By reviewCount (desc)
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      });
    } else if (sortBy === 'rating') {
      result.sort((a, b) => ((b as any).trustedRating || 0) - ((a as any).trustedRating || 0));
    } else if (sortBy === 'visits') {
      result.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
    }
    
    return result;
  }, [specialists, sortBy, ratingFilter, categoryFilter, countryFilter, cityFilter, districtFilter]);

  if (loading) {
    return <div className="p-5 text-muted-foreground">Загрузка...</div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 px-4 space-y-3 bg-background">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card h-24 rounded-xl border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-background">
      {/* Header */}
      <header className="pt-12 pb-4 px-6 bg-card border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">
              {categoryFilter !== 'all' ? categoryLabels[categoryFilter] || 'Специалисты' : 'Специалисты'}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Запишись к проверенным мастерам
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="text-muted-foreground"
            data-testid="button-toggle-filters"
          >
            <Filter size={16} className="mr-1" />
            Фильтры
            <ChevronDown size={14} className={`ml-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        
        {/* Filters panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-border space-y-4">
            {/* Category filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20">Категория:</span>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-category">
                  <SelectValue placeholder="Все категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  {(filterOptions?.categories || []).map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {categoryLabels[cat] || cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Country filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20">Страна:</span>
              <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setCityFilter('all'); setDistrictFilter('all'); }}>
                <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-country">
                  <SelectValue placeholder="Все страны" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все страны</SelectItem>
                  <SelectItem value="KZ">Казахстан</SelectItem>
                  <SelectItem value="UZ">Узбекистан</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* City filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20">Город:</span>
              <Select value={cityFilter} onValueChange={(v) => { setCityFilter(v); setDistrictFilter('all'); }}>
                <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-city">
                  <SelectValue placeholder="Все города" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все города</SelectItem>
                  {(filterOptions?.cities || []).map((city) => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* District filter */}
            {filterOptions?.districts && filterOptions.districts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20">Район:</span>
                <Select value={districtFilter} onValueChange={setDistrictFilter}>
                  <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-district">
                    <SelectValue placeholder="Все районы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все районы</SelectItem>
                    {(filterOptions?.districts || []).map((district) => (
                      <SelectItem key={district} value={district}>{district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Rating filter */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground mr-2 self-center">Статус:</span>
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
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-border'
                  }`}
                  data-testid={`filter-rating-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            
            {/* Sort */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground mr-2 self-center">Сортировка:</span>
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
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-border'
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
            <div className="group bg-card rounded-xl border border-border shadow-sm transition-transform duration-150 p-3">
            <Link href={`/specialist/${specialist.id}`}>
              <div className="cursor-pointer active:scale-[0.99]">
                {/* Top row: Avatar + Basic info + Trust block */}
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                    <img 
                      src={specialist.imageUrl} 
                      alt={specialist.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Block 1 - Identification */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-foreground truncate">
                      {specialist.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {categoryLabels[(specialist as any).category] || specialist.specialty}
                      {(specialist as any).subcategory && ` · ${(specialist as any).subcategory}`}
                    </p>
                    {/* Location */}
                    <div className="flex items-center text-xs text-muted-foreground/60 mt-1">
                      <MapPin size={11} className="mr-1" />
                      <span>
                        {(specialist as any).city || 'Алматы'}
                        {(specialist as any).district && ` · ${(specialist as any).district}`}
                      </span>
                    </div>
                    {/* Base service price */}
                    {(specialist as any).baseServiceName && (specialist as any).baseServicePrice && (
                      <div className="flex items-center gap-1 mt-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()}>
                        <Popover>
                          <PopoverTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 whitespace-nowrap cursor-pointer" data-testid={`text-price-${specialist.id}`}>
                              {(specialist as any).baseServiceName}{'\u00A0'}—{'\u00A0'}{Number((specialist as any).baseServicePrice).toLocaleString('ru-RU')}{'\u00A0'}₸
                              <Info size={10} className="opacity-60" />
                            </span>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="max-w-xs text-sm p-3">
                            <p>Это цена базовой услуги.<br/>Итоговая стоимость может отличаться в зависимости от выбранного набора услуг.</p>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}
                  </div>

                  {/* Trust Block (right) */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    {(() => {
                      const trc = (specialist as any).trustedReviewsCount || 0;
                      const tr = (specialist as any).trustedRating || 0;
                      const isNew = trc < 3;
                      const noData = tr === 0;
                      
                      if (isNew) {
                        return <span className="text-sm text-muted-foreground" data-testid="text-new-profile">Новый профиль</span>;
                      }
                      if (noData) {
                        return <span className="text-sm text-muted-foreground" data-testid="text-no-data">Недостаточно данных</span>;
                      }
                      return (
                        <>
                          <div className="flex items-center gap-1">
                            <AnimatedStar ratingValue={tr}>
                              <Star size={14} className="text-amber-400 fill-amber-400" />
                            </AnimatedStar>
                            <AnimatedRating value={tr.toFixed(1)} className="text-base font-semibold text-foreground" />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {specialist.reviewCount} {(() => {
                              const n = specialist.reviewCount % 100;
                              if (n >= 11 && n <= 19) return 'отзывов';
                              const last = n % 10;
                              if (last === 1) return 'отзыв';
                              if (last >= 2 && last <= 4) return 'отзыва';
                              return 'отзывов';
                            })()}
                          </span>
                          {((specialist as any).validReviewCount || 0) >= 10 ? (
                            <span className="text-xs text-emerald-600" data-testid="badge-rating-formed">Сформированный</span>
                          ) : (
                            <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()}>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground/60 cursor-pointer" data-testid="badge-rating-forming">
                                    Формируется
                                    <Info size={10} className="opacity-60" />
                                  </span>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="max-w-[200px] text-sm p-3 text-center">
                                  <p className="text-xs">С увеличением количества отзывов рейтинг станет точнее</p>
                                </PopoverContent>
                              </Popover>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center justify-center text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
                    <ArrowRight size={18} />
                  </div>
                </div>

                {/* Description block (below, separated) */}
                {specialist.bio && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide mb-1">
                      О мастере
                    </p>
                    <p className="text-xs text-muted-foreground/60 line-clamp-2">
                      {specialist.bio}
                    </p>
                  </div>
                )}
              </div>
            </Link>
            <BookingButton specialist={specialist as any} variant="feed" />
            </div>
          </motion.div>
        ))}

        {filteredAndSortedSpecialists.length === 0 && (
          <div className="text-center py-16 px-4">
            <p className="text-muted-foreground">
              {ratingFilter === 'formed' 
                ? 'В этом районе пока нет специалистов со сформированным рейтингом'
                : specialists && specialists.length === 0
                ? 'Специалисты не найдены'
                : 'По выбранным параметрам специалисты не найдены'}
            </p>
            {ratingFilter === 'formed' && specialists && specialists.length > 0 && (
              <p className="text-sm text-muted-foreground/60 mt-2">
                Показаны специалисты, у которых рейтинг формируется
              </p>
            )}
          </div>
        )}

        <LegalFooter />
      </main>
    </div>
  );
}
