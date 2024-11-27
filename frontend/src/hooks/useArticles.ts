import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";
import type { ArticleFilters } from "../types";

export function useArticles(filters: ArticleFilters) {
  return useQuery({
    queryKey: ["articles", filters],
    queryFn: () => articlesApi.getArticles(filters),
  });
}
