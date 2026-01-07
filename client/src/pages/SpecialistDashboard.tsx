import { useAuth } from '@/contexts/AuthContext';

export default function SpecialistDashboard() {
  const { currentUser } = useAuth();
  return (
    <div style={{ padding: 24, color: 'white' }} data-testid="specialist-dashboard">
      <h1>Welcome Specialist!</h1>
      <p>{currentUser?.email}</p>
    </div>
  );
}
