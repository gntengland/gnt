import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertUserProfile } from "@shared/routes";

export function useProfile() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: [api.profile.get.path],
    queryFn: async () => {
      const res = await fetch(api.profile.get.path, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to fetch profile"));
      return api.profile.get.responses[200].parse(await res.json());
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (updates: Partial<InsertUserProfile>) => {
      const validated = api.profile.update.input.parse(updates);
      const res = await fetch(api.profile.update.path, {
        method: api.profile.update.method, // Must be PATCH (fixed below)
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to update profile"));
      return api.profile.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.profile.get.path] });
    },
  });

  return { profileQuery, updateProfile };
}
