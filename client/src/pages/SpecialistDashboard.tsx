import { Link } from "wouter";
import { ChevronLeft, Wrench, Calendar, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SpecialistDashboard() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="flex items-center gap-4 mb-8">
        <Link href="/">
          <button className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80">
            <ChevronLeft size={24} />
          </button>
        </Link>
        <h1 className="text-2xl font-bold">Specialist Dashboard</h1>
      </header>

      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="text-primary" />
              Welcome, Specialist!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This is your specialist dashboard. Here you will find tools to manage your appointments, 
              view reviews, and interact with your clients.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover-elevate cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Calendar className="text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold">Appointments</h3>
                  <p className="text-sm text-muted-foreground">Manage bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover-elevate cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Star className="text-yellow-500" />
                </div>
                <div>
                  <h3 className="font-semibold">Reviews</h3>
                  <p className="text-sm text-muted-foreground">See client feedback</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover-elevate cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Users className="text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold">Clients</h3>
                  <p className="text-sm text-muted-foreground">View client history</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center pt-8">
          <p className="text-sm text-muted-foreground italic">
            More tools coming soon...
          </p>
        </div>
      </div>
    </div>
  );
}
