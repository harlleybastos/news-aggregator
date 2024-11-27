import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/authContext';
import { articlesApi } from '../../services/api';
import ArticleGrid from '../../components/Articles/ArticleGrid';
import { ArticleFilters as ArticleFiltersType } from '../../types';
import ArticleFilters from '../../components/Articles/ArticleFilters';

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = React.useState<ArticleFiltersType>({
    search: '',
    from_date: '',
    to_date: '',
    sort_by: 'published_at',
    sort_order: 'desc',
    categories: [],
    sources: [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ['articles', filters],
    queryFn: () => articlesApi.getArticles(filters),
  });

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg shadow">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          {isAuthenticated ? 'Your News Feed' : 'Latest News'}
        </h1>
        <ArticleFilters filters={filters} onFilterChange={setFilters} />
      </div>

      <ArticleGrid articles={data?.data || []} isLoading={isLoading} />
    </div>
  );
}
