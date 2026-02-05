import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

export default function JoinPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const ref = params.get("ref");
    
    if (ref) {
      sessionStorage.setItem("referrer_specialist_id", ref);
    }
    
    navigate("/specialist-signup", { replace: true });
  }, [searchString, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-muted-foreground">Перенаправление...</div>
    </div>
  );
}
