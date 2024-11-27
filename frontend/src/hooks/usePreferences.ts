import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { preferencesApi } from "../services/api";
import type { PreferenceUpdatePayload } from "../types";

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: () => preferencesApi.getPreferences(),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (preferences: PreferenceUpdatePayload) =>
      preferencesApi.updatePreferences(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
      queryClient.invalidateQueries({ queryKey: ["userFeed"] });
    },
  });
}
