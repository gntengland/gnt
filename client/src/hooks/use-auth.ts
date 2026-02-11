import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useAuth() {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: [api.auth.me.path],
    queryFn: async () => {
      const res = await fetch(api.auth.me.path, { credentials: "include" });

      // Important: when not logged in, a 401 should not crash the app
      if (res.status === 401) return null;

      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load auth"));
      return api.auth.me.responses[200].parse(await res.json());
    },
    retry: false,
  });

  const login = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const validated = api.auth.login.input.parse(data);
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(validated),
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Login failed");
        console.error("❌ Login failed:", errorText);
        throw new Error(errorText);
      }
      const result = api.auth.login.responses[200].parse(await res.json());
      console.log("✅ Login successful:", result);
      return result;
    },
    onSuccess: () => {
      console.log("🔄 Invalidating auth queries");
      queryClient.invalidateQueries({ queryKey: [api.auth.me.path] });
    },
  });

  const register = useMutation({
    mutationFn: async (data: { email: string; password: string; name?: string }) => {
      const validated = api.auth.register.input.parse(data);
      const res = await fetch(api.auth.register.path, {
        method: api.auth.register.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(validated),
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Register failed");
        console.error("❌ Register failed:", errorText);
        throw new Error(errorText);
      }
      const result = api.auth.register.responses[200].parse(await res.json());
      console.log("✅ Register successful:", result);
      return result;
    },
    onSuccess: () => {
      console.log("🔄 Invalidating auth queries");
      queryClient.invalidateQueries({ queryKey: [api.auth.me.path] });
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.auth.logout.path, {
        method: api.auth.logout.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Logout failed"));
      return true;
    },
    onSuccess: () => {
      console.log("🔄 Logged out, invalidating queries");
      queryClient.invalidateQueries({ queryKey: [api.auth.me.path] });
    },
  });

  // ✅ FIX: API برمی‌گردونه { id, email, name } نه { user: {...} }
  const user = me.data ?? null;

  const isLoading = me.isLoading;

  return useMemo(
    () => ({
      user,
      isLoading,
      login,
      register,
      logout,
    }),
    [user, isLoading, login, register, logout]
  );
}
