import { useSpecialists } from "@/hooks/use-specialists";
import { RatingStars } from "@/components/RatingStars";
import { Link, useLocation } from "wouter";
import { MapPin, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export default function SpecialistList() {
  const { data: specialists, isLoading } = useSpecialists();
  const { user, role, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && role === 'specialist') {
      setLocation('/specialist-dashboard');
    }
  }, [loading, role, setLocation]);

  if (loading) {
    return <div style={{ color: 'white', padding: 20 }}>Загрузка...</div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 px-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card h-32 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-background">
      {/* Header */}
      <header className="pt-16 pb-8 px-6 bg-gradient-to-b from-primary/10 to-background">
        <h1 className="text-4xl font-display font-bold text-foreground">
          Найди своего <br />
          <span className="text-primary">Мастера</span>
        </h1>
        <p className="mt-2 text-muted-foreground text-lg">
          Запишись к проверенным специалистам рядом с тобой.
        </p>
      </header>

      {/* List */}
      <main className="px-4 space-y-4">
        {specialists?.map((specialist, index) => (
          <motion.div
            key={specialist.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Link href={`/specialist/${specialist.id}`}>
              <div className="group relative overflow-hidden bg-card rounded-3xl border border-white/5 shadow-lg active:scale-[0.98] transition-all duration-200">
                <div className="flex p-4 gap-4">
                  {/* Avatar */}
                  <div className="relative w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden bg-muted">
                    {/* specialist portrait */}
                    <img 
                      src={specialist.imageUrl} 
                      alt={specialist.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 flex flex-col justify-center">
                    <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">
                      {specialist.name}
                    </h3>
                    <p className="text-sm text-primary/80 font-medium mb-1">
                      {specialist.specialty}
                    </p>
                    
                    <div className="flex items-center gap-1 mb-3">
                      <RatingStars rating={specialist.averageRating / 10} size={14} />
                      <span className="text-xs text-muted-foreground ml-1">
                        ({specialist.reviewCount} {(() => {
                          const n = specialist.reviewCount % 100;
                          if (n >= 11 && n <= 19) return 'отзывов';
                          const last = n % 10;
                          if (last === 1) return 'отзыв';
                          if (last >= 2 && last <= 4) return 'отзыва';
                          return 'отзывов';
                        })()})
                      </span>
                    </div>

                    <div className="flex items-center text-xs text-muted-foreground">
                      <MapPin size={12} className="mr-1" />
                      <span>2.4 км</span>
                    </div>
                  </div>

                  {/* Arrow Action */}
                  <div className="flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all">
                    <ArrowRight size={20} />
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}

        {specialists?.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            Специалисты не найдены.
          </div>
        )}
      </main>
    </div>
  );
}
