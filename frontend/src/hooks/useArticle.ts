import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";

export function useArticle(id: number) {
  return useQuery({
    queryKey: ["article", id],
    queryFn: () => articlesApi.getArticle(id),
  });
}
