import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";
import type { ArticleFilters } from "../types";

export function useUserFeed(filters: Partial<ArticleFilters>) {
  return useQuery({
    queryKey: ["userFeed", filters],
    queryFn: () => articlesApi.getUserFeed(filters),
  });
}
