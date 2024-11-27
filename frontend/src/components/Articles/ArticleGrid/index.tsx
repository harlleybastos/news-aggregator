import React from "react";
import ArticleCard from "../ArticleCard";
import { Article } from "../../../types";

interface ArticleGridProps {
  articles: Article[];
  isLoading: boolean;
}

export default function ArticleGrid({ articles, isLoading }: ArticleGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 h-48 rounded-t-lg" />
            <div className="p-6 bg-white rounded-b-lg">
              <div className="h-4 bg-gray-200 rounded w-1/4" />
              <div className="h-6 bg-gray-200 rounded mt-2" />
              <div className="h-4 bg-gray-200 rounded mt-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}
