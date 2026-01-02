import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateBookingRequest, type CreateReviewRequest } from "@shared/routes";

// === SPECIALISTS ===

export function useSpecialists() {
  return useQuery({
    queryKey: [api.specialists.list.path],
    queryFn: async () => {
      const res = await fetch(api.specialists.list.path);
      if (!res.ok) throw new Error("Failed to fetch specialists");
      return api.specialists.list.responses[200].parse(await res.json());
    },
  });
}

export function useSpecialist(id: number) {
  return useQuery({
    queryKey: [api.specialists.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.specialists.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch specialist");
      return api.specialists.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// === BOOKINGS ===

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateBookingRequest) => {
      const res = await fetch(api.bookings.create.path, {
        method: api.bookings.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.bookings.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create booking");
      }
      return api.bookings.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      // Invalidate bookings list if we had one (for admin)
      queryClient.invalidateQueries({ queryKey: [api.bookings.list.path] });
    },
  });
}

export function useBookings() {
  return useQuery({
    queryKey: [api.bookings.list.path],
    queryFn: async () => {
      const res = await fetch(api.bookings.list.path);
      if (!res.ok) throw new Error("Failed to fetch bookings");
      return api.bookings.list.responses[200].parse(await res.json());
    },
  });
}

export function useCompleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.bookings.complete.path, { id });
      const res = await fetch(url, { method: api.bookings.complete.method });
      if (!res.ok) throw new Error("Failed to complete booking");
      return api.bookings.complete.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.bookings.list.path] });
    },
  });
}

// === REVIEWS ===

export function useCreateReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateReviewRequest) => {
      const res = await fetch(api.reviews.create.path, {
        method: api.reviews.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.reviews.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        if (res.status === 409) {
          const error = api.reviews.create.responses[409].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to submit review");
      }
      return api.reviews.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.specialists.get.path, variables.specialistId] });
      queryClient.invalidateQueries({ queryKey: [api.specialists.list.path] });
    },
  });
}
